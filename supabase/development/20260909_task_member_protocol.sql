-- PRIVATE DEVELOPMENT CANDIDATE. Install after c448 record store, quiescent only.
-- No browser grants. Original UI and generic request/receipt signatures unchanged.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
create sequence if not exists public.ship_dynamics_member_fence_seq;
create table if not exists public.ship_dynamics_member_fences(
 workspace_key text not null,task_id text not null,scope text not null,version bigint not null,
 primary key(workspace_key,task_id,scope));
alter table public.ship_dynamics_member_fences enable row level security;
revoke all on public.ship_dynamics_member_fences,public.ship_dynamics_member_fence_seq from public,anon,authenticated;
alter table public.ship_dynamics_edit_locks add column if not exists lease_version bigint not null default nextval('public.ship_dynamics_member_fence_seq');
create or replace function public.ship_dynamics_task_member_key_v1(p_task text,p_vessel text)
returns text language sql immutable strict as $$ select 'task-member-v1:'||jsonb_build_array(p_task,p_vessel)::text $$;
create or replace function public.ship_dynamics_task_lock_family_v1(p_key text)
returns text language plpgsql immutable as $$
declare j jsonb;
begin
 if left(p_key,5)='task:' then return substring(p_key from 6); end if;
 if left(p_key,15)='task-member-v1:' then
  begin j:=substring(p_key from 16)::jsonb; exception when others then raise exception 'invalid-member-key'; end;
  if jsonb_typeof(j) is distinct from 'array' or jsonb_array_length(j)<>2
   or jsonb_typeof(j->0) is distinct from 'string' or jsonb_typeof(j->1) is distinct from 'string'
   or j->>0='' or j->>1='' or p_key is distinct from public.ship_dynamics_task_member_key_v1(j->>0,j->>1)
  then raise exception 'invalid-member-key'; end if;
  return j->>0;
 end if;
 return null;
end $$;
-- Task-family mutations share one gate BEFORE touching a lease row. A retained
-- lease row also makes later record calls follow-ups: reuse the existing shared
-- nonexclusive marker so legacy/native multi-call consumers never reverse-WAIT.
create or replace function public.ship_dynamics_task_lease_gate_v1(p_workspace text,p_key text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare family text;followup boolean;
begin
 family:=public.ship_dynamics_task_lock_family_v1(p_key);
 if family is null then return; end if;
 perform public.ship_dynamics_record_writer_gate_v1(p_workspace,false);
 followup:=public.ship_dynamics_record_lock_held_v1(hashtext('record-published-v1'),hashtext(p_workspace)) or public.ship_dynamics_record_other_writer_held_v1(p_workspace);
 if followup then
  if not pg_try_advisory_xact_lock(hashtext('task-lease-family:'||p_workspace),hashtext(family)) then raise exception 'record-writer-restart-transaction' using errcode='40001'; end if;
  begin perform 1 from public.ship_dynamics_edit_locks where workspace_key=p_workspace and section_key=p_key for update nowait;
  exception when lock_not_available then raise exception 'record-writer-restart-transaction' using errcode='40001'; end;
 else
  perform pg_advisory_xact_lock(hashtext('task-lease-family:'||p_workspace),hashtext(family));
  perform 1 from public.ship_dynamics_edit_locks where workspace_key=p_workspace and section_key=p_key for update;
 end if;
 perform pg_advisory_xact_lock_shared(hashtext('record-published-v1'),hashtext(p_workspace));
end $$;
revoke all on function public.ship_dynamics_task_lease_gate_v1(text,text) from public,anon,authenticated;
-- Same public signature: rollback/old clients participate in hierarchy too.
create or replace function public.claim_ship_dynamics_edit_lock(p_workspace_key text,p_section_key text,p_locked_by text,p_locked_by_name text,p_ttl_seconds integer default 75)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare family text; e public.ship_dynamics_edit_locks%rowtype; c public.ship_dynamics_edit_locks%rowtype;
begin
 family:=public.ship_dynamics_task_lock_family_v1(p_section_key);
 if family is not null then
  perform public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
  select * into e from public.ship_dynamics_edit_locks l where l.workspace_key=p_workspace_key
   and l.expires_at>clock_timestamp() and l.section_key<>p_section_key
   and public.ship_dynamics_task_lock_family_v1(l.section_key)=family
   and (p_section_key='task:'||family or l.section_key='task:'||family) order by l.section_key limit 1;
  if found then return jsonb_build_object('ok',false,'code','parent-child-lock-conflict','section_key',e.section_key,'locked_by',e.locked_by); end if;
 end if;
 insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,locked_at,expires_at)
 values(p_workspace_key,p_section_key,p_locked_by,p_locked_by_name,clock_timestamp(),clock_timestamp()+make_interval(secs=>least(greatest(p_ttl_seconds,30),120)))
 on conflict(workspace_key,section_key) do update set locked_by=excluded.locked_by,locked_by_name=excluded.locked_by_name,locked_at=excluded.locked_at,expires_at=excluded.expires_at,
 lease_version=case when ship_dynamics_edit_locks.expires_at<=clock_timestamp() or ship_dynamics_edit_locks.locked_by<>excluded.locked_by then nextval('public.ship_dynamics_member_fence_seq') else ship_dynamics_edit_locks.lease_version end
 where ship_dynamics_edit_locks.expires_at<=clock_timestamp() or ship_dynamics_edit_locks.locked_by=excluded.locked_by returning * into c;
 if not found then return jsonb_build_object('ok',false,'code','lock-conflict','section_key',p_section_key); end if;
 return jsonb_build_object('ok',true,'section_key',c.section_key,'locked_by',c.locked_by,'locked_by_name',c.locked_by_name,'expires_at',c.expires_at,'lease_version',c.lease_version::text);
end $$;
create or replace function public.renew_ship_dynamics_edit_lock(
  p_workspace_key text,
  p_section_key text,
  p_locked_by text,
  p_ttl_seconds integer default 75
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  renewed public.ship_dynamics_edit_locks%rowtype;
  existing public.ship_dynamics_edit_locks%rowtype;
begin
  if left(p_section_key,15)='task-member-v1:' then return jsonb_build_object('ok',false,'code','member-lease-fence-required'); end if;
  perform public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
  update public.ship_dynamics_edit_locks
  set expires_at = (case when left(p_section_key,5)='task:' then clock_timestamp() else now() end) + make_interval(secs => least(greatest(p_ttl_seconds, 30), 120))
  where workspace_key = p_workspace_key
    and section_key = p_section_key
    and locked_by = p_locked_by
    and expires_at > (case when left(p_section_key,5)='task:' then clock_timestamp() else now() end)
  returning * into renewed;

  if renewed.workspace_key is null then
    select * into existing
    from public.ship_dynamics_edit_locks
    where workspace_key = p_workspace_key and section_key = p_section_key;
    return jsonb_build_object(
      'ok', false,
      'section_key', coalesce(existing.section_key, p_section_key),
      'locked_by', existing.locked_by,
      'locked_by_name', existing.locked_by_name,
      'expires_at', existing.expires_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'section_key', renewed.section_key,
    'locked_by', renewed.locked_by,
    'locked_by_name', renewed.locked_by_name,
    'expires_at', renewed.expires_at
  );
end;
$$;

create or replace function public.release_ship_dynamics_edit_lock(
  p_workspace_key text,
  p_section_key text,
  p_locked_by text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if left(p_section_key,15)='task-member-v1:' then return false; end if;
  perform public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
  delete from public.ship_dynamics_edit_locks
  where workspace_key = p_workspace_key
    and section_key = p_section_key
    and locked_by = p_locked_by;
  return true;
end;
$$;


-- Only member scope requires new fenced cleanup/heartbeat. Legacy parent signatures unchanged.
create or replace function public.renew_ship_dynamics_task_member_lock_v1(p_workspace_key text,p_section_key text,p_locked_by text,p_lease_version text,p_ttl_seconds integer default 75)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare renewed public.ship_dynamics_edit_locks%rowtype;
begin
 if left(p_section_key,15) is distinct from 'task-member-v1:' then return jsonb_build_object('ok',false,'code','invalid-member-key'); end if;
 perform public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
 update public.ship_dynamics_edit_locks set expires_at=clock_timestamp()+make_interval(secs=>least(greatest(p_ttl_seconds,30),120))
 where workspace_key=p_workspace_key and section_key=p_section_key and locked_by=p_locked_by and lease_version::text=p_lease_version and expires_at>clock_timestamp() returning * into renewed;
 if not found then return jsonb_build_object('ok',false,'code','lock-conflict'); end if;
 return jsonb_build_object('ok',true,'section_key',renewed.section_key,'locked_by',renewed.locked_by,'lease_version',renewed.lease_version::text,'expires_at',renewed.expires_at);
end $$;
create or replace function public.release_ship_dynamics_task_member_lock_v1(p_workspace_key text,p_section_key text,p_locked_by text,p_lease_version text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if left(p_section_key,15) is distinct from 'task-member-v1:' then return false; end if;
 perform public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
 delete from public.ship_dynamics_edit_locks where workspace_key=p_workspace_key and section_key=p_section_key and locked_by=p_locked_by and lease_version::text=p_lease_version;
 return found;
end $$;
revoke all on function public.renew_ship_dynamics_task_member_lock_v1(text,text,text,text,integer),public.release_ship_dynamics_task_member_lock_v1(text,text,text,text) from public,anon,authenticated;
create or replace function public.ship_dynamics_member_track_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare w text;t text;k text;v jsonb;
begin
 if TG_TABLE_NAME='ship_dynamics_records' then
  if coalesce(new.collection,old.collection)<>'tasks' then return null; end if;
  if TG_OP='UPDATE' and (old.value-array['vesselProgress','updatedAt','updatedBy']) is not distinct from (new.value-array['vesselProgress','updatedAt','updatedBy'])
   and ((old.task_progress_meta->>'kind' in ('array','absent') and new.task_progress_meta->>'kind' in ('array','absent')) or old.task_progress_meta is not distinct from new.task_progress_meta)
  then return null; end if;
  w:=coalesce(new.workspace_key,old.workspace_key);t:=coalesce(new.entity_id,old.entity_id);k:='structure';
  insert into public.ship_dynamics_member_fences values(w,t,k,nextval('public.ship_dynamics_member_fence_seq')) on conflict(workspace_key,task_id,scope) do update set version=excluded.version;
 else
  if TG_OP='UPDATE' and old.value=new.value then return null; end if;
  w:=coalesce(new.workspace_key,old.workspace_key);t:=coalesce(new.task_id,old.task_id);
  for v in select old.value where TG_OP<>'INSERT' union select new.value where TG_OP<>'DELETE' loop
   if jsonb_typeof(v->'vesselId')='string' then
    k:='member:'||(v->>'vesselId');
    insert into public.ship_dynamics_member_fences values(w,t,k,nextval('public.ship_dynamics_member_fence_seq')) on conflict(workspace_key,task_id,scope) do update set version=excluded.version;
   end if;
  end loop;
 end if;
 return null;
end $$;
drop trigger if exists ship_dynamics_member_structure on public.ship_dynamics_records;
create trigger ship_dynamics_member_structure after insert or update or delete on public.ship_dynamics_records for each row execute function public.ship_dynamics_member_track_v1();
drop trigger if exists ship_dynamics_member_progress on public.ship_dynamics_record_task_progress;
create trigger ship_dynamics_member_progress after insert or update or delete on public.ship_dynamics_record_task_progress for each row execute function public.ship_dynamics_member_track_v1();
insert into public.ship_dynamics_member_fences select workspace_key,entity_id,'structure',nextval('public.ship_dynamics_member_fence_seq') from public.ship_dynamics_records where collection='tasks' on conflict do nothing;
insert into public.ship_dynamics_member_fences select distinct workspace_key,task_id,'member:'||(value->>'vesselId'),nextval('public.ship_dynamics_member_fence_seq') from public.ship_dynamics_record_task_progress where jsonb_typeof(value->'vesselId')='string' on conflict do nothing;
create or replace function public.ship_dynamics_member_source_v1(p_workspace text,p_task text)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('collection',r.collection,'id',r.entity_id,'version',r.revision) order by r.collection collate "C",r.entity_id collate "C"),'[]'::jsonb)
 from public.ship_dynamics_records r join public.ship_dynamics_records t on t.workspace_key=r.workspace_key and t.collection='tasks' and t.entity_id=p_task
 where r.workspace_key=p_workspace and ((r.collection='meetings' and r.entity_id=t.value->>'sourceMeetingId')
 or (r.collection='internalControlCases' and (r.entity_id=t.value->>'internalControlCaseId' or r.value->>'linkedTaskId'=p_task)))
$$;
create or replace function public.read_ship_dynamics_task_member_v1(p_workspace_key text,p_task_id text,p_vessel_id text,p_actor_user_id text)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare task jsonb;progress jsonb;guard jsonb;auth jsonb;s text;m text;closure jsonb;
begin
 select public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) into task from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='tasks' and r.entity_id=p_task_id;
 if task is null then return jsonb_build_object('ok',false,'code','task-not-found'); end if;
 select w.root||coalesce(jsonb_object_agg(c.collection,(select coalesce(jsonb_agg(r.value order by x.n),'[]'::jsonb) from jsonb_array_elements_text(c.ids) with ordinality x(id,n) join public.ship_dynamics_records r on r.workspace_key=c.workspace_key and r.collection=c.collection and r.entity_id=x.id)),'{}'::jsonb) into auth
 from public.ship_dynamics_record_workspaces w left join public.ship_dynamics_record_collections c on c.workspace_key=w.workspace_key and c.collection in ('users','vessels') where w.workspace_key=p_workspace_key group by w.root;
 guard:=public.ship_dynamics_actor_guard(auth,p_actor_user_id);
 if guard is null or not (guard->'visibleVesselIds') ? p_vessel_id then return jsonb_build_object('ok',false,'code','authorization-conflict'); end if;
 if jsonb_typeof(task->'vesselIds') is distinct from 'array' or not (task->'vesselIds') ? p_vessel_id or task->'distributeToVessels' is distinct from 'true'::jsonb or (select count(distinct x) from jsonb_array_elements_text(task->'vesselIds') x where x<>'')<2 or nullif(task->>'sourceMeetingId','') is null then return jsonb_build_object('ok',false,'code','invalid-member-target'); end if;
 if (task ? 'vesselProgress' and jsonb_typeof(task->'vesselProgress') is distinct from 'array')
  or exists(select 1 from jsonb_array_elements(coalesce(task->'vesselProgress','[]'::jsonb)) x where jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'vesselId') is distinct from 'string')
  or exists(select 1 from jsonb_array_elements(coalesce(task->'vesselProgress','[]'::jsonb)) x group by x->>'vesselId' having count(*)>1)
 then return jsonb_build_object('ok',false,'code','ambiguous-progress-parent-required'); end if;
 select x into progress from jsonb_array_elements(coalesce(task->'vesselProgress','[]'::jsonb)) x where x->>'vesselId'=p_vessel_id;
 progress:=coalesce(progress,jsonb_build_object('vesselId',p_vessel_id,'status','','isClosed',false,'statusLogs','[]'::jsonb));
 select version::text into s from public.ship_dynamics_member_fences where workspace_key=p_workspace_key and task_id=p_task_id and scope='structure';
 select version::text into m from public.ship_dynamics_member_fences where workspace_key=p_workspace_key and task_id=p_task_id and scope='member:'||p_vessel_id;
 select jsonb_agg(jsonb_build_object('vesselId',id,'isClosed',coalesce((select x->'isClosed' from jsonb_array_elements(coalesce(task->'vesselProgress','[]'::jsonb)) x where x->>'vesselId'=id),'false'::jsonb)) order by n) into closure from jsonb_array_elements_text(task->'vesselIds') with ordinality v(id,n);
 return jsonb_build_object('ok',true,'protocol','ship-dynamics-task-member-v1','section_key',public.ship_dynamics_task_member_key_v1(p_task_id,p_vessel_id),'task',task-'vesselProgress','progress',progress,'expected',jsonb_build_object('structure',s,'member',coalesce(m,'0'),'source',public.ship_dynamics_member_source_v1(p_workspace_key,p_task_id)),'actor_guard',guard,'closure',closure,'revision',auth->'revision');
end $$;
create or replace function public.get_ship_dynamics_task_member_receipt_v1(p_workspace_key text,p_operation_id text,p_task_id text,p_vessel_id text,p_command jsonb,p_expected jsonb,p_actor_user_id text,p_actor_guard jsonb,p_lock_guards jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare r public.ship_dynamics_record_receipts%rowtype;s jsonb:=jsonb_build_array('ship-dynamics-task-member-v1',p_task_id,p_vessel_id,p_command,p_expected,p_actor_user_id,p_actor_guard,p_lock_guards);
begin
 select * into r from public.ship_dynamics_record_receipts where workspace_key=p_workspace_key and operation_id=p_operation_id;
 if not found then return jsonb_build_object('status','missing'); end if;
 if r.signature is distinct from s then return jsonb_build_object('ok',false,'status','mismatch','code','operation-id-mismatch'); end if;
 return r.result||jsonb_build_object('replayed',true);
end $$;
-- Exact non-DOM richTextToPlainText projection used only for meeting audit detail.
create or replace function public.ship_dynamics_member_plain_text_v1(p_value text)
returns text language plpgsql immutable as $$
declare result text; entity text[]; number numeric; digit text; code integer;
begin
 result:=regexp_replace(coalesce(p_value,''),'<(script|style)[^>]*>.*?</\1>','','gis');
 result:=regexp_replace(result,'<br\s*/?>',E'\n','gi');
 result:=regexp_replace(result,'</(p|div|li|h[1-6]|blockquote)>',E'\n','gi');
 result:=regexp_replace(result,'<[^>]*>','','g');
 result:=regexp_replace(result,'&nbsp;',' ','gi');result:=regexp_replace(result,'&amp;','&','gi');
 result:=regexp_replace(result,'&lt;','<','gi');result:=regexp_replace(result,'&gt;','>','gi');
 result:=regexp_replace(result,'&quot;','"','gi');result:=regexp_replace(result,'&#39;|&apos;',chr(39),'gi');
 for entity in select regexp_matches(result,'&#([0-9]+);','g') loop
  number:=entity[1]::numeric;
  result:=replace(result,'&#'||entity[1]||';',case when number>1114111 or number between 55296 and 57343 then chr(65533) else chr(number::integer) end);
 end loop;
 for entity in select regexp_matches(result,'&#[xX]([0-9a-fA-F]+);','g') loop
  number:=0;for code in 1..length(entity[1]) loop number:=number*16+strpos('0123456789abcdef',lower(substr(entity[1],code,1)))-1; end loop;
  digit:=case when number>1114111 or number between 55296 and 57343 then chr(65533) else chr(number::integer) end;
  result:=replace(replace(result,'&#x'||entity[1]||';',digit),'&#X'||entity[1]||';',digit);
 end loop;
 result:=replace(result,E'\r','');
 result:=translate(result,chr(8203)||chr(8204)||chr(8205)||chr(8288)||chr(65279),'');
 result:=regexp_replace(result,E'[\t ]+\n',E'\n','g');result:=regexp_replace(result,E'\n{2,}',E'\n','g');
 return btrim(result,E' \t\n\r\f\v'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
end $$;
revoke all on function public.ship_dynamics_member_plain_text_v1(text) from public,anon,authenticated;
-- ECMAScript WhiteSpace + LineTerminator, comparison only; raw strings persist.
create or replace function public.ship_dynamics_member_js_trim_v1(p_value text)
returns text language sql immutable strict as $$
 select btrim(p_value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
revoke all on function public.ship_dynamics_member_js_trim_v1(text) from public,anon,authenticated;
create or replace function public.save_ship_dynamics_task_member_v1(p_workspace_key text,p_operation_id text,p_task_id text,p_vessel_id text,p_command jsonb,p_expected jsonb,p_actor_user_id text,p_actor_guard jsonb,p_lock_guards jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public set statement_timeout='8s' as $$
declare
 r jsonb;ctx jsonb;task jsonb;old jsonb;updated jsonb;meeting jsonb;mi jsonb;guard jsonb;ag jsonb;actor jsonb;perms jsonb;
 operations jsonb:='[]'::jsonb;orders jsonb;nextorders jsonb;root jsonb;logs jsonb;log jsonb;source jsonb;keys jsonb;
 item jsonb;vessel jsonb;usr jsonb;audit jsonb;notices jsonb:='[]'::jsonb;auds jsonb:='[]'::jsonb;
 lock_number integer;target record;followup boolean;beforeclosed boolean;afterclosed boolean;shared boolean;changed boolean;
 section text;required text[];stamped text;day text;newid text;name text;removed_id text;ids jsonb;actorname text;role text;signature jsonb;
begin
 if nullif(p_operation_id,'') is null or length(p_operation_id)>200 then return jsonb_build_object('ok',false,'code','invalid-operation-id'); end if;
 perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,false);
 followup:=public.ship_dynamics_record_lock_held_v1(hashtext('record-published-v1'),hashtext(p_workspace_key)) or public.ship_dynamics_record_other_writer_held_v1(p_workspace_key);
 if followup then
  if not pg_try_advisory_xact_lock(hashtext('record-operation:'||p_workspace_key),hashtext(p_operation_id)) then raise exception 'record-writer-restart-transaction' using errcode='40001'; end if;
 else perform pg_advisory_xact_lock(hashtext('record-operation:'||p_workspace_key),hashtext(p_operation_id)); end if;
 r:=public.get_ship_dynamics_task_member_receipt_v1(p_workspace_key,p_operation_id,p_task_id,p_vessel_id,p_command,p_expected,p_actor_user_id,p_actor_guard,p_lock_guards);
 if r->>'status'<>'missing' then return r; end if;
 signature:=jsonb_build_array('ship-dynamics-task-member-v1',p_task_id,p_vessel_id,p_command,p_expected,p_actor_user_id,p_actor_guard,p_lock_guards);
 if jsonb_typeof(p_command) is distinct from 'object' or jsonb_typeof(p_command->'status') is distinct from 'string' or jsonb_typeof(p_command->'isClosed') is distinct from 'boolean'
 or exists(select 1 from jsonb_object_keys(p_command) k where k<>all(array['status','isClosed','closedDate','newStatusLogs','mode']))
 or coalesce(p_command->>'mode','leaf') not in ('leaf','shared') or jsonb_typeof(p_expected->'source') is distinct from 'array' or jsonb_typeof(p_lock_guards) is distinct from 'array'
 then return jsonb_build_object('ok',false,'code','invalid-member-command'); end if;
 shared:=p_command->>'mode'='shared';shared:=coalesce(shared,false);
 -- Original intent provides only a versioned source identity vector, never graph bodies.
 keys:=jsonb_build_array(jsonb_build_object('collection','tasks','id',p_task_id))||(p_expected->'source');
 for lock_number in select distinct hashtext(jsonb_build_array(x->>'collection',x->>'id')::text) from jsonb_array_elements(keys) x order by 1 loop
  if followup then
   if not pg_try_advisory_xact_lock(hashtext('record-entity-v1:'||p_workspace_key),lock_number) then raise exception 'record-writer-restart-transaction' using errcode='40001'; end if;
  else perform pg_advisory_xact_lock(hashtext('record-entity-v1:'||p_workspace_key),lock_number); end if;
 end loop;
 for target in select distinct (x->>'collection') collate "C" c,(x->>'id') collate "C" id from jsonb_array_elements(keys) x order by 1,2 loop
  if followup then
   begin perform 1 from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection=target.c and r.entity_id=target.id for update nowait;
   exception when lock_not_available then raise exception 'record-writer-restart-transaction' using errcode='40001'; end;
  else perform 1 from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection=target.c and r.entity_id=target.id for update; end if;
 end loop;
 if followup then
  begin select w.root into root from public.ship_dynamics_record_workspaces w where workspace_key=p_workspace_key for no key update nowait;
  exception when lock_not_available then raise exception 'record-writer-restart-transaction' using errcode='40001'; end;
 else select w.root into root from public.ship_dynamics_record_workspaces w where workspace_key=p_workspace_key for no key update; end if;
 perform pg_advisory_xact_lock_shared(hashtext('record-published-v1'),hashtext(p_workspace_key));
 ctx:=public.read_ship_dynamics_task_member_v1(p_workspace_key,p_task_id,p_vessel_id,p_actor_user_id);
 if ctx->'ok' is distinct from 'true'::jsonb then return ctx; end if;
 if ctx->'expected' is distinct from p_expected then return jsonb_build_object('ok',false,'code','member-context-conflict'); end if;
 ag:=ctx->'actor_guard';actor:=ag->'actor';actorname:=actor->>'name';role:=actor->>'role';perms:=ag->'effectivePermissions';
 if ag is distinct from p_actor_guard or role='vessel' or not (role='owner' or coalesce((perms->>'editBusinessContent')::boolean,role in ('admin','operator'))) then return jsonb_build_object('ok',false,'code','authorization-conflict'); end if;
 task:=ctx->'task';old:=ctx->'progress';
 select value into meeting from public.ship_dynamics_records where workspace_key=p_workspace_key and collection='meetings' and entity_id=task->>'sourceMeetingId';
 if meeting is null or task->>'sourceType' is distinct from 'temporary' or task->>'attentionDimension' is distinct from 'meeting'
  or (select count(*) from jsonb_array_elements(meeting->'taskItems') x where x->>'id'=task->>'sourceMeetingItemId')<>1
  or task->'isInternalControl' is distinct from meeting->'isInternalControl'
  or coalesce(task->>'vesselScopeMode','vessels')<>coalesce(meeting->>'vesselScopeMode','vessels')
  or not ((task->'vesselIds') @> (meeting->'vessels') and (meeting->'vessels') @> (task->'vesselIds'))
  or (coalesce(task->>'vesselScopeMode','vessels')='types' and not(coalesce(task->'vesselTypeScopes','[]'::jsonb) @> coalesce(meeting->'vesselTypeScopes','[]'::jsonb) and coalesce(meeting->'vesselTypeScopes','[]'::jsonb) @> coalesce(task->'vesselTypeScopes','[]'::jsonb)))
 then return jsonb_build_object('ok',false,'code','source-graph-conflict'); end if;
 select x into mi from jsonb_array_elements(meeting->'taskItems') x where x->>'id'=task->>'sourceMeetingItemId';
 if mi->'distributeToVessels' is distinct from 'true'::jsonb then return jsonb_build_object('ok',false,'code','source-graph-conflict'); end if;
 required:=case when shared then array['task:'||p_task_id,'meeting:'||(task->>'sourceMeetingId')] else array[ctx->>'section_key'] end;
 if shared then for item in select x from jsonb_array_elements(p_expected->'source') x where x->>'collection'='internalControlCases' loop required:=array_append(required,'internal-control:'||(item->>'id')); end loop; end if;
 foreach section in array required loop
  select x into guard from jsonb_array_elements(p_lock_guards) x where x->>'section_key'=section;
  if guard is null then return jsonb_build_object('ok',false,'code','lock-conflict','conflict_key',section); end if;
  perform 1 from public.ship_dynamics_edit_locks l where l.workspace_key=p_workspace_key and l.section_key=section and l.locked_by=guard->>'locked_by' and l.lease_version::text=guard->>'lease_version' and l.expires_at>clock_timestamp() for share;
  if not found then return jsonb_build_object('ok',false,'code','lock-conflict','conflict_key',section); end if;
 end loop;
 changed:=old->'isClosed' is distinct from p_command->'isClosed';
 if changed and not(role='owner' or coalesce((perms->>'closeTasks')::boolean,role in ('admin','operator'))) then return jsonb_build_object('ok',false,'code','close-permission-denied'); end if;
 logs:=coalesce(p_command->'newStatusLogs','[]'::jsonb);
 if jsonb_typeof(logs) is distinct from 'array' or exists(select 1 from jsonb_array_elements(logs) x where jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'text') is distinct from 'string' or x-'text'<>'{}'::jsonb) then return jsonb_build_object('ok',false,'code','invalid-member-logs'); end if;
 if old->'isClosed'='true'::jsonb and p_command->'isClosed'='true'::jsonb and (old->'status' is distinct from p_command->'status' or jsonb_array_length(logs)>0 or (p_command ? 'closedDate' and old->'closedDate' is distinct from p_command->'closedDate')) then return jsonb_build_object('ok',false,'code','closed-member-readonly'); end if;
 if old->'status' is distinct from p_command->'status' and jsonb_array_length(logs)=0 then logs:=jsonb_build_array(jsonb_build_object('text',p_command->'status')); end if;
 if jsonb_array_length(logs)>0 and public.ship_dynamics_member_js_trim_v1(logs#>>'{0,text}')<>public.ship_dynamics_member_js_trim_v1(p_command->>'status') then return jsonb_build_object('ok',false,'code','status-log-mismatch'); end if;
 stamped:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');day:=to_char(clock_timestamp() at time zone 'Asia/Taipei','YYYY-MM-DD');
 updated:=old||jsonb_build_object('status',p_command->'status','isClosed',p_command->'isClosed','updatedAt',stamped,'updatedBy',p_actor_user_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid()::text,'at',stamped,'by',actorname,'byUserId',p_actor_user_id,'text',x->'text') order by n),'[]'::jsonb) into logs from jsonb_array_elements(logs) with ordinality a(x,n);
 updated:=updated||jsonb_build_object('statusLogs',logs||coalesce(old->'statusLogs','[]'::jsonb));
 if p_command->'isClosed'='true'::jsonb and changed then
  begin if btrim(p_command->>'closedDate') ~ '^\d{4}-\d{2}-\d{2}$' and to_char((btrim(p_command->>'closedDate'))::date,'YYYY-MM-DD')=btrim(p_command->>'closedDate') then day:=btrim(p_command->>'closedDate'); end if; exception when others then null; end;
  updated:=updated||jsonb_build_object('closedDate',day,'closedBy',p_actor_user_id);
 elsif p_command->'isClosed'='false'::jsonb then updated:=updated-array['closedDate','closedBy']; end if;
 select bool_and(x->'isClosed'='true'::jsonb),bool_and(case when x->>'vesselId'=p_vessel_id then p_command->'isClosed'='true'::jsonb else x->'isClosed'='true'::jsonb end) into beforeclosed,afterclosed from jsonb_array_elements(ctx->'closure') x;
 if beforeclosed is distinct from afterclosed then
  if not(role='owner' or (coalesce((perms->>'manageMeetings')::boolean,role='admin') and coalesce((perms->>'viewAllVessels')::boolean,role='admin'))) then return jsonb_build_object('ok',false,'code','meeting-permission-denied'); end if;
  if not afterclosed and meeting->>'status'='已完成' then return jsonb_build_object('ok',false,'code','meeting-reopen-required'); end if;
  if not shared then return jsonb_build_object('ok',false,'code','transition-required'); end if;
 end if;
 -- Fresh siblings, exact raw values and order; only existing helper's prepend/retention effects.
 select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into item from public.ship_dynamics_records r cross join lateral jsonb_array_elements(public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision)->'vesselProgress') with ordinality a(x,n) where r.workspace_key=p_workspace_key and r.collection='tasks' and r.entity_id=p_task_id and x->>'vesselId'<>p_vessel_id and ((task->'vesselIds') ? (x->>'vesselId') or x->'isClosed'='true'::jsonb);
 task:=task||jsonb_build_object('vesselProgress',jsonb_build_array(updated)||item,'updatedAt',stamped,'updatedBy',p_actor_user_id);
 operations:=jsonb_build_array(jsonb_build_object('kind','entity','collection','tasks','entityId',p_task_id,'value',task));
 if beforeclosed is distinct from afterclosed then
  mi:=mi||jsonb_build_object('isClosed',afterclosed);
  mi:=mi-array['closedDate','closedBy'];
  if afterclosed then
   -- Original meetingDecisionLifecycleFromTask: latest closed progress by
   -- updatedAt, stable ties in task scope order (not prepended progress order).
   select x into item from jsonb_array_elements_text(task->'vesselIds') with ordinality v(id,n)
    cross join lateral jsonb_array_elements(task->'vesselProgress') x
    where x->>'vesselId'=v.id and x->'isClosed'='true'::jsonb
    order by coalesce(x->>'updatedAt','') collate "C" desc,v.n desc limit 1;
   if coalesce(nullif(item->>'closedDate',''),nullif(task->>'closedDate','')) is not null then mi:=mi||jsonb_build_object('closedDate',coalesce(nullif(item->>'closedDate',''),task->>'closedDate')); end if;
   if coalesce(nullif(item->>'closedBy',''),nullif(task->>'closedBy','')) is not null then mi:=mi||jsonb_build_object('closedBy',coalesce(nullif(item->>'closedBy',''),task->>'closedBy')); end if;
  end if;
  select jsonb_agg(case when x->>'id'=task->>'sourceMeetingItemId' then mi else x end order by n) into item from jsonb_array_elements(meeting->'taskItems') with ordinality a(x,n);
  name:=case when afterclosed then '決議待辦已完成' else '決議待辦重新開啟' end;
  meeting:=meeting||jsonb_build_object('taskItems',item,'latestStatus',name,'updatedAt',stamped,'statusLogs',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'at',stamped,'by',actorname,'byUserId',p_actor_user_id,'text',name))||coalesce(meeting->'statusLogs','[]'::jsonb));
  operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','meetings','entityId',meeting->>'id','value',meeting));
 end if;
 select value into vessel from public.ship_dynamics_records where workspace_key=p_workspace_key and collection='vessels' and entity_id=p_vessel_id;
 -- Server-owned audit and notification suffixes preserve original collections/caps.
 audit:=jsonb_build_object('id',gen_random_uuid()::text,'at',stamped,'actorId',p_actor_user_id,'actorName',actorname,'actorRole',role,'action','更新單船進度','entityType','task','entityId',p_task_id,'detail',coalesce(nullif(btrim(vessel->>'fullName'),''),nullif(btrim(vessel->>'name'),''),nullif(btrim(vessel->>'shortName'),''),p_vessel_id)||'｜'||coalesce(nullif(updated->>'status',''),'未填狀態')||'｜'||case when updated->'isClosed'='true'::jsonb then '已結案' else '未結' end);
 auds:=jsonb_build_array(audit);
 if beforeclosed is distinct from afterclosed then auds:=jsonb_build_array(audit||jsonb_build_object('id',gen_random_uuid()::text,'action',case when afterclosed then '同步完成臨會/專題待辦' else '同步重新開啟臨會/專題待辦' end,'entityType','meeting','entityId',meeting->>'id','detail',coalesce(nullif(public.ship_dynamics_member_plain_text_v1(task->>'description'),''),p_task_id)))||auds; end if;
 -- Original stable concatenation: supervisors in users order, then eligible
 -- owners in ownerUserIds order, deduplicating by the first occurrence.
 for usr in
  with users as (
   select r.value u,a.n,
    (coalesce(vessel->'assignedUserIds','[]'::jsonb) ? r.entity_id or coalesce(r.value->'managedVesselIds','[]'::jsonb) ? p_vessel_id or exists(select 1 from jsonb_array_elements(coalesce(vessel->'delegateManagers','[]'::jsonb)) x where x->>'userId'=r.entity_id and x->'isActive'='true'::jsonb)) assigned
   from public.ship_dynamics_record_collections c cross join lateral jsonb_array_elements_text(c.ids) with ordinality a(id,n)
   join public.ship_dynamics_records r on r.workspace_key=c.workspace_key and r.collection=c.collection and r.entity_id=a.id
   where c.workspace_key=p_workspace_key and c.collection='users' and r.entity_id<>p_actor_user_id and r.value->'isActive' is distinct from 'false'::jsonb and r.value->>'role'<>'vessel'
  ), recipients as (
   select u,1 phase,n from users where assigned and coalesce(u->>'department','') ~ '督導|航運處'
   union all
   select u,2 phase,o.n from jsonb_array_elements_text(coalesce(task->'ownerUserIds','[]'::jsonb)) with ordinality o(id,n) join users on u->>'id'=o.id
   where assigned or u->>'role' in ('owner','admin') or root#>array['settings','rolePermissions',u->>'role','viewAllVessels']='true'::jsonb
  ), dedup as (select distinct on (u->>'id') u,phase,n from recipients order by u->>'id',phase,n)
  select u from dedup order by phase,n
 loop
   notices:=notices||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'userId',usr->>'id','vesselId',p_vessel_id,'taskId',p_task_id,'kind','task_updated','title','更新待辦｜'||case when task->'isInternalControl'='true'::jsonb then '內部管控｜' else '' end||coalesce(nullif(task->>'description',''),'未命名事項'),'message',actorname||' 更新待辦：'||coalesce(nullif(task->>'description',''),'未命名事項'),'actorId',p_actor_user_id,'createdAt',stamped));
 end loop;
 select jsonb_object_agg(collection,c.ids) into orders from public.ship_dynamics_record_collections c where workspace_key=p_workspace_key;nextorders:=orders;
 foreach name in array array['auditLogs','notifications'] loop
  item:=case when name='auditLogs' then auds else notices end;
  for log in select x from jsonb_array_elements(item) x loop
   -- New generated notification identities also require assertWriter prelock. Since
   -- publication is already held these MUST be try locks, never reverse waits.
   if name<>'auditLogs' and not pg_try_advisory_xact_lock(hashtext('record-entity-v1:'||p_workspace_key),hashtext(jsonb_build_array(name,log->>'id')::text)) then raise exception 'record-writer-restart-transaction' using errcode='40001'; end if;
   operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection',name,'entityId',log->>'id','value',log));
  end loop;
  select coalesce(jsonb_agg(x->'id' order by n),'[]'::jsonb) into ids from jsonb_array_elements(item) with ordinality a(x,n);
  select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into ids from jsonb_array_elements(ids||coalesce(orders->name,'[]'::jsonb)) with ordinality a(x,n) where n<=case when name='auditLogs' then 500 else 1000 end;
  for removed_id in select x from jsonb_array_elements_text(coalesce(orders->name,'[]'::jsonb)) x where not ids ? x loop
   if name<>'auditLogs' and not pg_try_advisory_xact_lock(hashtext('record-entity-v1:'||p_workspace_key),hashtext(jsonb_build_array(name,removed_id)::text)) then raise exception 'record-writer-restart-transaction' using errcode='40001'; end if;
   operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection',name,'entityId',removed_id,'value',null));
  end loop;
  if item<>'[]'::jsonb then nextorders:=jsonb_set(nextorders,array[name],ids,true); end if;
 end loop;
 return public.ship_dynamics_record_commit_validated_v1(p_workspace_key,operations,root,nextorders,actorname,p_operation_id,signature);
end $$;
revoke all on function public.ship_dynamics_task_member_key_v1(text,text),public.ship_dynamics_task_lock_family_v1(text),public.ship_dynamics_member_track_v1(),public.ship_dynamics_member_source_v1(text,text),public.read_ship_dynamics_task_member_v1(text,text,text,text),public.get_ship_dynamics_task_member_receipt_v1(text,text,text,text,jsonb,jsonb,text,jsonb,jsonb),public.save_ship_dynamics_task_member_v1(text,text,text,text,jsonb,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
commit;

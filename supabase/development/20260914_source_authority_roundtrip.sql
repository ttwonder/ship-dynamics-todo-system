-- DEVELOPMENT ONLY. Idle install after pause, stage, authority and browser addons.
-- Exact local cutover materialization. No production handoff or browser write grant.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
create table if not exists ship_dynamics_authority_private.forward_stages_v1(
 request_id uuid primary key,workspace_key text not null,transition_id uuid not null,
 actor name not null,request jsonb not null,result jsonb not null,staged_watermark jsonb not null,
 unique(workspace_key,transition_id)
);
create table if not exists ship_dynamics_authority_private.forward_row_context_v1(
 backend integer primary key,transaction_id xid8 not null,actor name not null,
 table_oid oid not null,operation text not null,old_sha text,new_sha text,used boolean not null
);
revoke all on table ship_dynamics_authority_private.forward_stages_v1,ship_dynamics_authority_private.forward_row_context_v1 from public,anon,authenticated,service_role;

-- One exact row, transaction, session actor and table/verb; consumed before any
-- other trigger can attempt a second write. Never a broad service-role bypass.
create or replace function ship_dynamics_authority_private.forward_row_v1(t oid,op text,o jsonb,n jsonb)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c ship_dynamics_authority_private.forward_row_context_v1%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role' then return false;end if;
 select * into c from ship_dynamics_authority_private.forward_row_context_v1 where backend=pg_backend_pid();
 if not found or c.transaction_id<>pg_current_xact_id() or c.actor<>session_user or c.used or c.table_oid<>t or c.operation<>op
  or c.old_sha is distinct from public.sd_legacy_jsonb_sha256(o) or c.new_sha is distinct from public.sd_legacy_jsonb_sha256(n) then return false;end if;
 update ship_dynamics_authority_private.forward_row_context_v1 set used=true where backend=c.backend;
 return true;
end $$;
select ship_dynamics_quiescence_private.splice_terminal_v1('ship_dynamics_quiescence_private.row_guard_v1()'::regprocedure,
 ' -- BOTH old and new identities are checked, including moves into/out of pause.',
 $add$ -- forward_exact_row_v1
 if ship_dynamics_authority_private.forward_row_v1(TG_RELID,TG_OP,
  case when TG_OP='INSERT' then null else to_jsonb(OLD) end,
  case when TG_OP='DELETE' then null else to_jsonb(NEW) end) then
  if TG_OP='DELETE' then return OLD;end if;return NEW;
 end if;
$add$,'-- forward_exact_row_v1');

-- Private, table-allowlisted materializer. Callers supply an in-memory plan
-- derived only from the frozen database source; there is no public payload API.
create or replace function ship_dynamics_authority_private.forward_apply_v1(t text,op text,o jsonb,n jsonb)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare keys text[];cols text;projection text;predicate text;affected bigint;
begin
 keys:=case t when 'ship_dynamics_record_workspaces' then array['workspace_key']
 when 'ship_dynamics_record_collections' then array['workspace_key','collection']
 when 'ship_dynamics_records' then array['workspace_key','collection','entity_id']
 when 'ship_dynamics_record_versions' then array['workspace_key','revision']
 when 'ship_dynamics_record_history' then array['workspace_key','collection','entity_id','valid_from_revision']
 when 'ship_dynamics_record_task_progress' then array['workspace_key','task_id','entry_id']
 when 'ship_dynamics_record_task_progress_history' then array['workspace_key','task_id','entry_id','valid_from_revision'] end;
 if keys is null or op not in ('INSERT','UPDATE','DELETE') or current_setting('role',true) is distinct from 'service_role'
  or not public.ship_dynamics_record_lock_held_v1(hashtext('record-maintenance-v1'),0,true) then raise exception 'forward-materializer-invalid' using errcode='55000';end if;
 select string_agg(format('%I',a.attname),',' order by a.attnum),string_agg(format('x.%I',a.attname),',' order by a.attnum)
 into cols,projection from pg_attribute a where a.attrelid=to_regclass('public.'||t) and a.attnum>0 and not a.attisdropped;
 select string_agg(format('d.%I=x.%I',k,k),' and ') into predicate from unnest(keys) k;
 insert into ship_dynamics_authority_private.forward_row_context_v1 values(pg_backend_pid(),pg_current_xact_id(),session_user,to_regclass('public.'||t),op,public.sd_legacy_jsonb_sha256(o),public.sd_legacy_jsonb_sha256(n),false);
 if op='INSERT' then execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) x',t,cols,projection,t) using n;
 elsif op='UPDATE' then execute format('update public.%I d set (%s)=(%s) from jsonb_populate_record(null::public.%I,$1) x where %s',t,cols,projection,t,predicate) using n;
 else execute format('delete from public.%I d using jsonb_populate_record(null::public.%I,$1) x where %s',t,t,predicate) using o;end if;
 get diagnostics affected=row_count;
 if affected<>1 or not exists(select 1 from ship_dynamics_authority_private.forward_row_context_v1 where backend=pg_backend_pid() and used) then raise exception 'forward-row-readback-mismatch' using errcode='55000';end if;
 delete from ship_dynamics_authority_private.forward_row_context_v1 where backend=pg_backend_pid();
end $$;

create or replace function public.stage_ship_dynamics_paused_legacy_to_records_v1(
 p_workspace text,p_workspace_id uuid,p_transition uuid,p_watermark jsonb,
 p_source_revision integer,p_source_sha256 text,p_target_revision integer,p_target_sha256 text,
 p_frozen_at timestamptz,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare
 req jsonb;prev ship_dynamics_authority_private.forward_stages_v1%rowtype;c record;authority jsonb;v_freeze jsonb;
 source public.ship_dynamics_app_state%rowtype;target public.ship_dynamics_record_workspaces%rowtype;
 names text[]:=array['users','vessels','tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'];
 mutable text[]:=array['ship_dynamics_record_workspaces','ship_dynamics_record_collections','ship_dynamics_records','ship_dynamics_record_versions','ship_dynamics_record_history','ship_dynamics_record_task_progress','ship_dynamics_record_task_progress_history'];
 name text;t text;item jsonb;ids jsonb;orders jsonb:='{}';seen jsonb;rows jsonb;expected jsonb:='{}';actual jsonb;
 nr integer;stamp timestamptz;stamp_text text;payload jsonb;next_root jsonb;row_new jsonb;row_old jsonb;mark jsonb;v_result jsonb;
 meta jsonb;slot text;progress jsonb:='[]';bodies jsonb:='[]';old_revision integer;plan jsonb:='[]';step jsonb;current_rows jsonb;desired jsonb;
begin
 perform ship_dynamics_authority_private.operator_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_workspace_id is null or p_transition is null or p_request_id is null
  or jsonb_typeof(p_watermark) is distinct from 'object' or p_source_revision is null or p_source_revision<0
  or coalesce(p_source_sha256,'')!~'^[0-9a-f]{64}$' or p_frozen_at is null
  or (p_target_revision is null)<>(p_target_sha256 is null) or p_target_revision<0
  or (p_target_sha256 is not null and p_target_sha256!~'^[0-9a-f]{64}$') then raise exception 'forward-invalid-request' using errcode='22023';end if;
 req:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'watermark',p_watermark,'sourceRevision',p_source_revision,'sourceSha256',p_source_sha256,'targetRevision',p_target_revision,'targetSha256',p_target_sha256,'frozenAt',p_frozen_at,'requestId',p_request_id);
 select * into prev from ship_dynamics_authority_private.forward_stages_v1 where request_id=p_request_id;
 if found then
  if prev.actor<>session_user or prev.request is distinct from req then raise exception 'forward-replay-mismatch' using errcode='55000';end if;
  return prev.result;
 end if;
 perform ship_dynamics_authority_private.lock_target_v1(p_workspace);
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w join ship_dynamics_quiescence_private.transitions t using(workspace_key,transition_id) where workspace_key=p_workspace;
 if c.workspace_id is distinct from p_workspace_id or c.transition_id is distinct from p_transition or c.state is distinct from 'paused' or c.watermark is distinct from p_watermark
  or not exists(select 1 from public.sd_workspaces where id=p_workspace_id and legacy_key=p_workspace) then raise exception 'forward-pause-binding-mismatch' using errcode='55000';end if;
 select to_jsonb(a) into authority from ship_dynamics_authority_private.current_v1 a where workspace_key=p_workspace;
 if authority is not null and (authority->>'source'<>'legacy' or authority->>'phase'<>'resumed') then raise exception 'source-authority-retired' using errcode='55000';end if;
 if exists(select 1 from ship_dynamics_quiescence_private.stages_v1 where workspace_key=p_workspace and transition_id=p_transition)
  or exists(select 1 from ship_dynamics_authority_private.forward_stages_v1 where workspace_key=p_workspace and transition_id=p_transition)
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from p_watermark then raise exception 'forward-transition-changed' using errcode='55000';end if;
 perform public.sd_assert_legacy_freeze_boundary(p_workspace);
 select to_jsonb(f) into v_freeze from public.sd_legacy_write_controls f where workspace_key=p_workspace;
 select * into source from public.ship_dynamics_app_state where workspace_key=p_workspace;
 if source.revision is distinct from p_source_revision or public.sd_legacy_jsonb_sha256(source.payload) is distinct from p_source_sha256
  or (v_freeze->>'frozen_at')::timestamptz is distinct from p_frozen_at then raise exception 'forward-source-mismatch' using errcode='55000';end if;
 -- Global drain first; old ungated tuple holders fail without a reversed WAIT.
 foreach t in array mutable loop
  begin execute format('select 1 from public.%I where workspace_key=$1 for update nowait',t) using p_workspace;
  exception when lock_not_available then raise exception 'source-authority-retry-transaction' using errcode='40001';end;
 end loop;
 select * into target from public.ship_dynamics_record_workspaces where workspace_key=p_workspace;
 if target.revision is distinct from p_target_revision or (p_target_revision is not null and public.sd_legacy_jsonb_sha256(public.read_ship_dynamics_records_v1(p_workspace)->'payload') is distinct from p_target_sha256) then raise exception 'forward-target-mismatch' using errcode='55000';end if;
 if greatest(p_source_revision,coalesce(p_target_revision,0))=2147483647 then raise exception 'forward-revision-exhausted' using errcode='22023';end if;
 nr:=greatest(p_source_revision,coalesce(p_target_revision,0))+1;stamp:=date_trunc('milliseconds',clock_timestamp());stamp_text:=to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 payload:=source.payload||jsonb_build_object('revision',nr,'updatedAt',stamp_text);next_root:=payload-names;
 -- Validate complete ordered source before any materialization, preserving exact IDs.
 foreach name in array names loop
  if not(payload ? name) then continue;end if;
  if jsonb_typeof(payload->name) is distinct from 'array' then raise exception 'invalid-record-collection:%',name;end if;
  ids:='[]';seen:='[]';
  for item in select value from jsonb_array_elements(payload->name) loop
   if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'string' or item->>'id'='' or seen ? (item->>'id') then raise exception 'invalid-record-id:%',name;end if;
   ids:=ids||jsonb_build_array(item->'id');seen:=ids;meta:=null;
   if name='tasks' then
    if not(item ? 'vesselProgress') then meta:=jsonb_build_object('kind','absent');
    elsif jsonb_typeof(item->'vesselProgress')<>'array' then meta:=jsonb_build_object('kind','literal','value',item->'vesselProgress');
    else
     meta:=jsonb_build_object('kind','array','ids','[]'::jsonb);
     for row_new in select value from jsonb_array_elements(item->'vesselProgress') loop
      slot:=gen_random_uuid()::text;meta:=jsonb_set(meta,'{ids}',(meta->'ids')||jsonb_build_array(slot));
      progress:=progress||jsonb_build_array(jsonb_build_object('workspace_key',p_workspace,'task_id',item->>'id','entry_id',slot,'value',row_new,'revision',nr));
     end loop;
    end if;
   end if;
   bodies:=bodies||jsonb_build_array(jsonb_build_object('workspace_key',p_workspace,'collection',name,'entity_id',item->>'id','value',case when name='tasks' then item-'vesselProgress' else item end,'revision',nr,'task_progress_meta',meta));
  end loop;
  orders:=orders||jsonb_build_object(name,ids);
 end loop;
 -- Full table expectations retain all historical rows. Only current records and
 -- progress are rematerialized at a new revision; receipts/read bases stay intact.
 foreach t in array mutable loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]'') from public.%I x where workspace_key=$1',t) into rows using p_workspace;
  expected:=expected||jsonb_build_object(t,rows);
 end loop;
 for row_old in select value from jsonb_array_elements(expected->'ship_dynamics_records') loop
  row_new:=(row_old-'revision')||jsonb_build_object('valid_from_revision',(row_old->>'revision')::integer,'valid_to_revision',nr);
  expected:=jsonb_set(expected,array['ship_dynamics_record_history'],(expected->'ship_dynamics_record_history')||jsonb_build_array(row_new));
 end loop;
 for row_old in select value from jsonb_array_elements(expected->'ship_dynamics_record_task_progress') loop
  row_new:=(row_old-'revision')||jsonb_build_object('valid_from_revision',(row_old->>'revision')::integer,'valid_to_revision',nr);
  expected:=jsonb_set(expected,array['ship_dynamics_record_task_progress_history'],(expected->'ship_dynamics_record_task_progress_history')||jsonb_build_array(row_new));
 end loop;
 expected:=jsonb_set(expected,'{ship_dynamics_records}',bodies);
 expected:=jsonb_set(expected,'{ship_dynamics_record_task_progress}',progress);
 select coalesce(jsonb_agg(jsonb_build_object('workspace_key',p_workspace,'collection',key,'ids',value)),'[]') into rows from jsonb_each(orders);
 expected:=jsonb_set(expected,'{ship_dynamics_record_collections}',rows);
 expected:=jsonb_set(expected,'{ship_dynamics_record_workspaces}',jsonb_build_array(jsonb_build_object('workspace_key',p_workspace,'root',next_root,'revision',nr,'updated_at',stamp,'updated_by',coalesce(source.updated_by,''),'import_token',md5(req::text))));
 expected:=jsonb_set(expected,'{ship_dynamics_record_versions}',(expected->'ship_dynamics_record_versions')||jsonb_build_array(jsonb_build_object('workspace_key',p_workspace,'revision',nr,'root',next_root,'orders',orders,'updated_at',stamp)));
 -- Archive old current data first, then remove only current rows, recreate exact
 -- active sets in FK order. History/receipt tables are never deleted or rewritten.
 foreach t in array array['ship_dynamics_record_history','ship_dynamics_record_task_progress_history'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from public.%I x where workspace_key=$1',t) into current_rows using p_workspace;
  for row_new in select value from jsonb_array_elements(expected->t) where not current_rows @> jsonb_build_array(value) loop perform ship_dynamics_authority_private.forward_apply_v1(t,'INSERT',null,row_new);end loop;
 end loop;
 foreach t in array array['ship_dynamics_records','ship_dynamics_record_task_progress','ship_dynamics_record_collections'] loop
  for row_old in execute format('select to_jsonb(x) from public.%I x where workspace_key=$1',t) using p_workspace loop perform ship_dynamics_authority_private.forward_apply_v1(t,'DELETE',row_old,null);end loop;
 end loop;
 perform ship_dynamics_authority_private.forward_apply_v1('ship_dynamics_record_workspaces',case when target.workspace_key is null then 'INSERT' else 'UPDATE' end,case when target.workspace_key is null then null else to_jsonb(target) end,expected->'ship_dynamics_record_workspaces'->0);
 foreach t in array array['ship_dynamics_record_collections','ship_dynamics_record_task_progress','ship_dynamics_records'] loop
  for row_new in select value from jsonb_array_elements(expected->t) loop perform ship_dynamics_authority_private.forward_apply_v1(t,'INSERT',null,row_new);end loop;
 end loop;
 perform ship_dynamics_authority_private.forward_apply_v1('ship_dynamics_record_versions','INSERT',null,expected->'ship_dynamics_record_versions'->-1);
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id);
 if (mark-mutable) is distinct from (p_watermark-mutable) then raise exception 'forward-independent-state-mismatch' using errcode='55000';end if;
 v_result:=jsonb_build_object('state','staged-paused','workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'requestId',p_request_id,'requestSha256',public.sd_legacy_jsonb_sha256(req),'source','legacy','target','records-v1','sourceRevision',p_source_revision,'sourceSha256',p_source_sha256,'targetRevision',nr,'targetSha256',public.sd_legacy_jsonb_sha256(payload),'previousAuthority',authority,'freeze',v_freeze);
 insert into ship_dynamics_authority_private.forward_stages_v1 values(p_request_id,p_workspace,p_transition,session_user,req,v_result,mark);
 -- Read all expected tables AFTER receipt and triggers; never derive the oracle
 -- from a tampered result. Exact logical payload comparison includes audit fields.
 foreach t in array mutable loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]'') from public.%I x where workspace_key=$1',t) into actual using p_workspace;
  select coalesce(jsonb_agg(value order by value::text),'[]') into desired from jsonb_array_elements(expected->t);
  if actual is distinct from desired then raise exception 'forward-final-readback-mismatch:%',t using errcode='55000';end if;
 end loop;
 if public.read_ship_dynamics_records_v1(p_workspace)->'payload' is distinct from payload
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from mark
  or not exists(select 1 from ship_dynamics_authority_private.forward_stages_v1 f where f.request_id=p_request_id and f.request=req and f.result=v_result and f.staged_watermark=mark and f.actor=session_user)
  or (select to_jsonb(a) from ship_dynamics_authority_private.current_v1 a where workspace_key=p_workspace) is distinct from authority
  or (select to_jsonb(f) from public.sd_legacy_write_controls f where workspace_key=p_workspace) is distinct from v_freeze then raise exception 'forward-final-proof-mismatch' using errcode='55000';end if;
 return v_result;
end $$;
-- Both sources share the already-installed admission fan-in. Preserve historical
-- v1 entrypoints; new transitions use v2 rather than rewriting old receipts.
alter table ship_dynamics_authority_private.current_v1 drop constraint if exists current_v1_source_check;
alter table ship_dynamics_authority_private.current_v1 add constraint current_v1_source_check check(source in ('legacy','records-v1'));
alter table ship_dynamics_authority_private.current_v1 drop constraint if exists current_v1_epoch_browser_check;
alter table ship_dynamics_authority_private.current_v1 add constraint current_v1_epoch_browser_check check(epoch<=9007199254740991);
do $$
declare def text;old text:=E' if exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace) then raise exception ''source-authority-retired'' using errcode=''55000'';end if;';
 replacement text:=E' if exists(select 1 from ship_dynamics_authority_private.current_v1 ca where ca.workspace_key=p_workspace and (ca.source<>''records-v1'' or ca.phase<>''resumed'')) then raise exception ''source-authority-retired'' using errcode=''55000'';end if;\n if exists(select 1 from ship_dynamics_authority_private.forward_stages_v1 where workspace_key=p_workspace and transition_id=p_transition) then raise exception ''forward-transition-changed'' using errcode=''55000'';end if; -- authority_roundtrip_stage_v1';
begin
 def:=pg_get_functiondef('public.stage_ship_dynamics_paused_records_to_legacy_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid)'::regprocedure);
 if position('-- authority_roundtrip_stage_v1' in def)>0 then
  if position(replacement in def)=0 then raise exception 'roundtrip-install-source-mismatch';end if;
 elsif (length(def)-length(replace(def,old,'')))/length(old)<>1 then raise exception 'roundtrip-install-source-mismatch';
 else execute replace(def,old,replacement);end if;
end $$;

create or replace function ship_dynamics_authority_private.binding_v2(p_workspace text,p_workspace_id uuid,p_transition uuid,p_stage uuid,p_result jsonb,p_target text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare s ship_dynamics_authority_private.forward_stages_v1%rowtype;c record;f jsonb;l jsonb;r jsonb;
begin
 if p_target='legacy' then return ship_dynamics_authority_private.binding_v1(p_workspace,p_workspace_id,p_transition,p_stage,p_result);end if;
 if p_target is distinct from 'records-v1' then raise exception 'source-authority-invalid-target' using errcode='22023';end if;
 select * into s from ship_dynamics_authority_private.forward_stages_v1 where request_id=p_stage;
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w join ship_dynamics_quiescence_private.transitions t using(workspace_key,transition_id) where workspace_key=p_workspace;
 if s.request_id is null or s.workspace_key is distinct from p_workspace or s.transition_id is distinct from p_transition or s.result is distinct from p_result
  or c.workspace_id is distinct from p_workspace_id or c.transition_id is distinct from p_transition or c.state is distinct from 'paused'
  or c.watermark is distinct from s.request->'watermark' or s.result->>'requestSha256' is distinct from public.sd_legacy_jsonb_sha256(s.request)
  or not exists(select 1 from public.sd_workspaces where id=p_workspace_id and legacy_key=p_workspace)
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from s.staged_watermark then raise exception 'source-authority-stage-binding-mismatch' using errcode='55000';end if;
 select to_jsonb(x) into f from public.sd_legacy_write_controls x where workspace_key=p_workspace;
 select to_jsonb(x) into l from public.ship_dynamics_app_state x where workspace_key=p_workspace;
 r:=public.read_ship_dynamics_records_v1(p_workspace);
 if f is distinct from s.result->'freeze' or f->'writes_frozen' is distinct from 'true'::jsonb or f->'restore_in_progress' is distinct from 'false'::jsonb
  or (l->>'revision')::integer is distinct from (s.result->>'sourceRevision')::integer or public.sd_legacy_jsonb_sha256(l->'payload') is distinct from s.result->>'sourceSha256'
  or (r->>'revision')::integer is distinct from (s.result->>'targetRevision')::integer or public.sd_legacy_jsonb_sha256(r->'payload') is distinct from s.result->>'targetSha256' then raise exception 'source-authority-proof-mismatch' using errcode='55000';end if;
 return jsonb_build_object('stage',to_jsonb(s),'freeze',f);
end $$;

create or replace function public.publish_ship_dynamics_source_authority_v2(p_workspace text,p_workspace_id uuid,p_transition uuid,p_stage uuid,p_stage_result jsonb,p_target text,p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare req jsonb;prev ship_dynamics_authority_private.receipts_v1%rowtype;prior ship_dynamics_authority_private.current_v1%rowtype;v_binding jsonb;v_result jsonb;v_epoch bigint;
begin
 perform ship_dynamics_authority_private.operator_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_workspace_id is null or p_transition is null or p_stage is null or p_request_id is null
  or jsonb_typeof(p_stage_result) is distinct from 'object' or p_target is null or p_target not in ('legacy','records-v1') then raise exception 'source-authority-invalid-request' using errcode='22023';end if;
 req:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'stageId',p_stage,'stageResult',p_stage_result,'target',p_target,'requestId',p_request_id);
 select * into prev from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id;
 if found then
  if prev.actor<>session_user or prev.action<>'publish-v2' or prev.request is distinct from req then raise exception 'source-authority-replay-mismatch' using errcode='55000';end if;
  return prev.result;
 end if;
 perform ship_dynamics_authority_private.lock_target_v1(p_workspace);
 v_binding:=ship_dynamics_authority_private.binding_v2(p_workspace,p_workspace_id,p_transition,p_stage,p_stage_result,p_target);
 select * into prior from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace;
 if found and (prior.workspace_id is distinct from p_workspace_id or prior.source=p_target or prior.phase<>'resumed' or prior.transition_id=p_transition) then raise exception 'source-authority-transition-mismatch' using errcode='55000';end if;
 if p_target='records-v1' and nullif(p_stage_result->'previousAuthority','null'::jsonb) is distinct from (case when prior.workspace_key is null then null else to_jsonb(prior) end) then raise exception 'source-authority-transition-mismatch' using errcode='55000';end if;
 if coalesce(prior.epoch,0)>=9007199254740991 then raise exception 'source-authority-epoch-exhausted' using errcode='22023';end if;
 v_epoch:=coalesce(prior.epoch,0)+1;
 v_result:=jsonb_build_object('state','published-paused','workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'publicationId',p_request_id,'stageId',p_stage,'source',p_target,'epoch',v_epoch);
 insert into ship_dynamics_authority_private.current_v1 values(p_workspace,p_workspace_id,v_epoch,p_target,p_request_id,p_transition,'published-paused')
 on conflict(workspace_key) do update set epoch=excluded.epoch,source=excluded.source,publication_id=excluded.publication_id,transition_id=excluded.transition_id,phase=excluded.phase;
 insert into ship_dynamics_authority_private.receipts_v1 values(p_request_id,session_user,'publish-v2',req,v_result,v_binding);
 if not exists(select 1 from ship_dynamics_authority_private.receipts_v1 x where request_id=p_request_id and actor=session_user and action='publish-v2' and request=req and x.result=v_result and x.binding=v_binding)
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and epoch=v_epoch and source=p_target and publication_id=p_request_id and transition_id=p_transition and phase='published-paused')
  or ship_dynamics_authority_private.binding_v2(p_workspace,p_workspace_id,p_transition,p_stage,p_stage_result,p_target) is distinct from v_binding then raise exception 'source-authority-final-readback-mismatch' using errcode='55000';end if;
 return v_result;
end $$;

create or replace function public.resume_ship_dynamics_source_authority_v2(p_workspace text,p_workspace_id uuid,p_transition uuid,p_publication uuid,p_publication_result jsonb,p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare req jsonb;prev ship_dynamics_authority_private.receipts_v1%rowtype;pub ship_dynamics_authority_private.receipts_v1%rowtype;v_binding jsonb;v_result jsonb;ctl jsonb;target text;
begin
 perform ship_dynamics_authority_private.operator_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_workspace_id is null or p_transition is null or p_publication is null or p_request_id is null or jsonb_typeof(p_publication_result) is distinct from 'object' then raise exception 'source-authority-invalid-request' using errcode='22023';end if;
 req:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'publicationId',p_publication,'publicationResult',p_publication_result,'requestId',p_request_id);
 select * into prev from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id;
 if found then
  if prev.actor<>session_user or prev.action<>'resume-v2' or prev.request is distinct from req then raise exception 'source-authority-replay-mismatch' using errcode='55000';end if;
  return prev.result;
 end if;
 select * into pub from ship_dynamics_authority_private.receipts_v1 where request_id=p_publication;target:=pub.result->>'source';
 if pub.action is distinct from 'publish-v2' or pub.result is distinct from p_publication_result or pub.request->>'workspace' is distinct from p_workspace
  or pub.request->>'workspaceId' is distinct from p_workspace_id::text or pub.request->>'transition' is distinct from p_transition::text
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and transition_id=p_transition and publication_id=p_publication and phase='published-paused' and source=target and epoch=(pub.result->>'epoch')::bigint) then raise exception 'source-authority-publication-mismatch' using errcode='55000';end if;
 perform ship_dynamics_authority_private.lock_target_v1(p_workspace);
 v_binding:=ship_dynamics_authority_private.binding_v2(p_workspace,p_workspace_id,p_transition,(pub.request->>'stageId')::uuid,pub.request->'stageResult',target);
 if v_binding is distinct from pub.binding then raise exception 'source-authority-proof-mismatch' using errcode='55000';end if;
 if target='legacy' then update public.sd_legacy_write_controls set writes_frozen=false,updated_at=clock_timestamp() where workspace_key=p_workspace;end if;
 update ship_dynamics_quiescence_private.transitions set state='resumed' where workspace_key=p_workspace and transition_id=p_transition;
 update ship_dynamics_authority_private.current_v1 set phase='resumed' where workspace_key=p_workspace;
 v_result:=p_publication_result||jsonb_build_object('state','resumed','resumeId',p_request_id);
 insert into ship_dynamics_authority_private.receipts_v1 values(p_request_id,session_user,'resume-v2',req,v_result,v_binding);
 select to_jsonb(c) into ctl from public.sd_legacy_write_controls c where workspace_key=p_workspace;
 if not exists(select 1 from ship_dynamics_authority_private.receipts_v1 x where request_id=p_request_id and actor=session_user and action='resume-v2' and request=req and x.result=v_result and x.binding=v_binding)
  or (target='records-v1' and ctl is distinct from v_binding->'freeze')
  or (target='legacy' and ((ctl-'writes_frozen'-'updated_at') is distinct from ((v_binding->'freeze')-'writes_frozen'-'updated_at') or ctl->'writes_frozen' is distinct from 'false'::jsonb))
  or not exists(select 1 from ship_dynamics_quiescence_private.transitions where workspace_key=p_workspace and transition_id=p_transition and state='resumed' and watermark=v_binding->'stage'->'request'->'watermark')
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and publication_id=p_publication and transition_id=p_transition and phase='resumed' and source=target and epoch=(pub.result->>'epoch')::bigint)
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from v_binding->'stage'->'staged_watermark' then raise exception 'source-authority-final-readback-mismatch' using errcode='55000';end if;
 return v_result;
end $$;
-- Literal source-checked browser projection change, no new fields or grants.
do $$
declare def text;old text:='a.epoch<>1 or a.source<>''legacy''';replacement text:='a.epoch<1 or a.epoch>9007199254740991 or a.source not in (''legacy'',''records-v1'')';
begin
 def:=pg_get_functiondef('public.read_ship_dynamics_browser_authority_v1(text)'::regprocedure);
 if position(replacement in def)>0 then null;
 elsif (length(def)-length(replace(def,old,'')))/length(old)<>1 then raise exception 'roundtrip-browser-source-mismatch';
 else execute replace(def,old,replacement);end if;
end $$;
revoke all on function public.publish_ship_dynamics_source_authority_v2(text,uuid,uuid,uuid,jsonb,text,uuid),public.resume_ship_dynamics_source_authority_v2(text,uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.publish_ship_dynamics_source_authority_v2(text,uuid,uuid,uuid,jsonb,text,uuid),public.resume_ship_dynamics_source_authority_v2(text,uuid,uuid,uuid,jsonb,uuid) to service_role;
revoke all on all functions in schema ship_dynamics_authority_private from public,anon,authenticated,service_role;
revoke all on function public.stage_ship_dynamics_paused_legacy_to_records_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.stage_ship_dynamics_paused_legacy_to_records_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid) to service_role;
commit;

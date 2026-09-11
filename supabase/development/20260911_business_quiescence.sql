-- DEVELOPMENT ONLY. Explicit local install LAST, on an idle owned database.
-- Business quiescence, not route cutover or a browser maintenance UX.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
create schema if not exists ship_dynamics_quiescence_private;
revoke all on schema ship_dynamics_quiescence_private from public,anon,authenticated,service_role;
create table if not exists ship_dynamics_quiescence_private.workspaces(
  workspace_key text primary key check(workspace_key<>'' and workspace_key=btrim(workspace_key)),
  workspace_id uuid unique,
  transition_id uuid not null
);
create table if not exists ship_dynamics_quiescence_private.transitions(
  workspace_key text not null references ship_dynamics_quiescence_private.workspaces(workspace_key),
  transition_id uuid not null,
  state text not null check(state in ('paused','resumed')),
  watermark jsonb not null check(jsonb_typeof(watermark)='object'),
  primary key(workspace_key,transition_id)
);
revoke all on all tables in schema ship_dynamics_quiescence_private from public,anon,authenticated,service_role;

create or replace function ship_dynamics_quiescence_private.tables_v1()
returns table(table_name text,key_column text) language sql immutable set search_path=pg_catalog as $$
 values
 ('ship_dynamics_app_state','workspace_key'),('ship_dynamics_app_revisions','workspace_key'),
 ('ship_dynamics_block_operations','workspace_key'),('ship_dynamics_data_management_operations','workspace_key'),
 ('ship_dynamics_record_workspaces','workspace_key'),('ship_dynamics_record_collections','workspace_key'),
 ('ship_dynamics_records','workspace_key'),('ship_dynamics_record_receipts','workspace_key'),
 ('ship_dynamics_record_versions','workspace_key'),('ship_dynamics_record_history','workspace_key'),
 ('ship_dynamics_record_task_progress','workspace_key'),('ship_dynamics_record_task_progress_history','workspace_key'),
 ('ship_dynamics_record_prune_operations','workspace_key'),
 ('sd_itinerary_documents','workspace_id'),('sd_itinerary_history','workspace_id'),
 ('sd_itinerary_operations','workspace_id'),('sd_itinerary_daily_reports','workspace_id'),
 ('sd_itinerary_daily_report_operations','workspace_id'),('sd_itinerary_rollout','workspace_id'),
 ('sd_itinerary_role_permissions','workspace_id'),('sd_saved_reports','workspace_id'),
 ('sd_saved_report_vessels','workspace_id'),('sd_audit_events','workspace_id'),('sd_operations','workspace_id'),
 ('sd_vessels','workspace_id'),('sd_workspaces','id')
$$;

create or replace function ship_dynamics_quiescence_private.operator_v1()
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if coalesce(nullif(current_setting('role',true),'none'),session_user) not in ('service_role',current_user::text) then
   raise exception 'business-pause-operator-required' using errcode='42501';
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'business-pause-read-committed-required' using errcode='25001';
 end if;
end $$;

create or replace function ship_dynamics_quiescence_private.assert_write_v1(p_workspace text)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c record;
begin
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'business-pause-read-committed-required' using errcode='25001';
 end if;
 -- Never wait here: direct DML or an existing RPC may already own a tuple or
 -- subsystem lock. A queued exclusive pause must not make a lock-order cycle.
 if not pg_try_advisory_xact_lock_shared(hashtext('record-maintenance-v1'),0) then
   raise exception 'business-pause-retry-transaction' using errcode='40001';
 end if;
 if p_workspace is null or p_workspace='' then
   raise exception 'business-pause-workspace-required' using errcode='55000';
 end if;
 -- VOLATILE + READ COMMITTED: fresh SPI statement after gate admission.
 select w.transition_id,t.state,t.watermark into c
 from ship_dynamics_quiescence_private.workspaces w
 left join ship_dynamics_quiescence_private.transitions t
 on t.workspace_key=w.workspace_key and t.transition_id=w.transition_id
 where w.workspace_key=p_workspace;
 if found then
   if c.state is null or c.watermark is null then
     raise exception 'business-pause-control-invalid' using errcode='55000';
   end if;
   if c.state='paused' then raise exception 'business-writes-paused' using errcode='55000';end if;
 elsif exists(select 1 from ship_dynamics_quiescence_private.transitions where workspace_key=p_workspace) then
   raise exception 'business-pause-control-invalid' using errcode='55000';
 end if;
end $$;

create or replace function ship_dynamics_quiescence_private.row_guard_v1()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare item jsonb; k text; mapped text; uid uuid;
begin
 -- BOTH old and new identities are checked, including moves into/out of pause.
 for item in select v from unnest(case when TG_OP='INSERT' then array[to_jsonb(NEW)]
   when TG_OP='DELETE' then array[to_jsonb(OLD)] else array[to_jsonb(OLD),to_jsonb(NEW)] end) v loop
   if TG_ARGV[0]='workspace_key' then k:=item->>'workspace_key';
   else
     uid:=(item->>TG_ARGV[0])::uuid;
     select workspace_key into k from ship_dynamics_quiescence_private.workspaces where workspace_id=uid;
     select legacy_key into mapped from public.sd_workspaces where id=uid;
     if k is not null and mapped is distinct from k then
       raise exception 'business-pause-workspace-binding' using errcode='55000';
     end if;
     k:=coalesce(k,mapped,case when TG_TABLE_NAME='sd_workspaces' then item->>'legacy_key' end);
   end if;
   perform ship_dynamics_quiescence_private.assert_write_v1(k);
   if TG_TABLE_NAME='sd_workspaces' then
     perform ship_dynamics_quiescence_private.assert_write_v1(item->>'legacy_key');
   end if;
 end loop;
 if TG_OP='DELETE' then return OLD;end if;return NEW;
end $$;

create or replace function ship_dynamics_quiescence_private.truncate_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 -- TRUNCATE has no workspace predicate; no maintenance exception in this slice.
 raise exception 'business-pause-truncate-unsupported' using errcode='55000';
end $$;

create or replace function ship_dynamics_quiescence_private.watermark_v1(p_workspace text,p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare t record; h text; n bigint; result jsonb:='{}';
begin
 -- MVCC only. Never SELECT FOR UPDATE / LOCK TABLE after exclusive drain.
 for t in select * from ship_dynamics_quiescence_private.tables_v1() loop
   execute format('select count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' order by to_jsonb(r)::text),'''')) from public.%I r where %I::text=$1',t.table_name,t.key_column)
     into n,h using case when t.key_column='workspace_key' then p_workspace else p_id::text end;
   result:=result||jsonb_build_object(t.table_name,jsonb_build_object('rows',n,'digest',h));
 end loop;
 return result;
end $$;

create or replace function ship_dynamics_quiescence_private.drain_v1()
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform ship_dynamics_quiescence_private.operator_v1();
 -- Operator must start without prior business tuple/writer locks. No unsafe
 -- shared-to-exclusive upgrade or arbitrary SELECT FOR UPDATE -> drain cycle.
 if exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.granted and (
   (l.locktype='advisory' and l.classid=hashtext('record-maintenance-v1')::oid and l.objid=0 and l.objsubid=2)
   or (l.locktype='relation' and l.mode<>'AccessShareLock' and l.relation in
     (select to_regclass('public.'||table_name) from ship_dynamics_quiescence_private.tables_v1())))) then
   raise exception 'business-pause-fresh-transaction-required' using errcode='25001';
 end if;
 perform pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
end $$;

create or replace function public.pause_ship_dynamics_business_v1(p_workspace text,p_transition uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c record; uid uuid; mark jsonb;
begin
 perform ship_dynamics_quiescence_private.drain_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_transition is null then
   raise exception 'business-pause-invalid-transition' using errcode='22023';
 end if;
 select id into uid from public.sd_workspaces where legacy_key=p_workspace;
 if uid is null and not exists(select 1 from public.ship_dynamics_app_state where workspace_key=p_workspace)
   and not exists(select 1 from public.ship_dynamics_record_workspaces where workspace_key=p_workspace) then
   raise exception 'business-pause-workspace-missing' using errcode='55000';
 end if;
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w
 left join ship_dynamics_quiescence_private.transitions t on t.workspace_key=w.workspace_key and t.transition_id=w.transition_id
 where w.workspace_key=p_workspace;
 if found then
   if c.state is null or c.workspace_id is distinct from uid then raise exception 'business-pause-control-invalid' using errcode='55000';end if;
   if c.state='paused' then
     if c.transition_id is distinct from p_transition then raise exception 'business-pause-transition-mismatch' using errcode='55000';end if;
     return jsonb_build_object('state','paused','workspace',p_workspace,'transition',p_transition,'watermark',c.watermark);
   end if;
 end if;
 if exists(select 1 from ship_dynamics_quiescence_private.transitions where transition_id=p_transition) then
   raise exception 'business-pause-transition-reused' using errcode='55000';
 end if;
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,uid);
 insert into ship_dynamics_quiescence_private.workspaces values(p_workspace,uid,p_transition)
 on conflict(workspace_key) do update set transition_id=excluded.transition_id;
 insert into ship_dynamics_quiescence_private.transitions values(p_workspace,p_transition,'paused',mark);
 return jsonb_build_object('state','paused','workspace',p_workspace,'transition',p_transition,'watermark',mark);
end $$;

create or replace function public.read_ship_dynamics_business_pause_v1(p_workspace text,p_transition uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c record; mark jsonb;
begin
 perform ship_dynamics_quiescence_private.operator_v1();
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w
 left join ship_dynamics_quiescence_private.transitions t on t.workspace_key=w.workspace_key and t.transition_id=w.transition_id
 where w.workspace_key=p_workspace;
 if not found or c.state is null or c.transition_id is distinct from p_transition then
   raise exception 'business-pause-transition-mismatch' using errcode='55000';
 end if;
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,c.workspace_id);
 return jsonb_build_object('state',c.state,'workspace',p_workspace,'transition',p_transition,'watermark',c.watermark,'unchanged',mark=c.watermark);
end $$;

create or replace function public.resume_ship_dynamics_business_v1(p_workspace text,p_transition uuid,p_watermark jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c record; mark jsonb;
begin
 perform ship_dynamics_quiescence_private.drain_v1();
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w
 left join ship_dynamics_quiescence_private.transitions t on t.workspace_key=w.workspace_key and t.transition_id=w.transition_id
 where w.workspace_key=p_workspace;
 if not found or c.state is distinct from 'paused' or c.transition_id is distinct from p_transition then
   raise exception 'business-pause-transition-mismatch' using errcode='55000';
 end if;
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,c.workspace_id);
 if p_watermark is distinct from c.watermark or mark is distinct from c.watermark then
   raise exception 'business-pause-state-mismatch' using errcode='55000';
 end if;
 update ship_dynamics_quiescence_private.transitions set state='resumed'
 where workspace_key=p_workspace and transition_id=p_transition;
 return jsonb_build_object('state','resumed','workspace',p_workspace,'transition',p_transition);
end $$;

-- Existing terminal requests must remain readable while writes are paused.
-- This helper never creates a ledger row, takes a writer lock, or changes the
-- current actor policy. Input-array normalization remains in the original RPC.
create or replace function ship_dynamics_quiescence_private.prune_terminal_v1(
 p_workspace text,p_actor text,p_operation uuid,p_request jsonb,p_records boolean
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare entry jsonb; actor_role text;
begin
 if p_records then
  select to_jsonb(r) into entry from public.ship_dynamics_record_prune_operations r where operation_id=p_operation;
 else
  select to_jsonb(r) into entry from public.ship_dynamics_data_management_operations r where operation_id=p_operation;
 end if;
 if entry is null then return null;end if;
 if p_records then
  if not exists(select 1 from public.ship_dynamics_record_workspaces where workspace_key=p_workspace) then
   return jsonb_build_object('ok',false,'error','WORKSPACE_NOT_FOUND');end if;
  select r.value->>'role' into actor_role from public.ship_dynamics_records r
   where r.workspace_key=p_workspace and r.collection='users' and r.entity_id=p_actor and r.value->'isActive'='true'::jsonb;
 else
  if not exists(select 1 from public.ship_dynamics_app_state where workspace_key=p_workspace) then
   return jsonb_build_object('ok',false,'error','WORKSPACE_NOT_FOUND');end if;
  select item->>'role' into actor_role from public.ship_dynamics_app_state s
   cross join lateral jsonb_array_elements(case when jsonb_typeof(s.payload->'users')='array' then s.payload->'users' else '[]'::jsonb end) item
   where s.workspace_key=p_workspace and item->>'id'=p_actor and coalesce((item->>'isActive')::boolean,false) limit 1;
 end if;
 if actor_role is distinct from 'owner' then return jsonb_build_object('ok',false,'error','OWNER_REQUIRED');end if;
 if entry->>'workspace_key' is distinct from p_workspace or entry->>'actor_user_id' is distinct from p_actor
  or entry->>'command_type' is distinct from 'prune_revision_history' or entry->'request_payload' is distinct from p_request then
  return jsonb_build_object('ok',false,'error','IDEMPOTENCY_MISMATCH');end if;
 if entry->>'status' in ('COMMITTED','REJECTED') then return entry->'result';end if;
 return null;
end $$;

-- Installation-only, source-shape-checked extension. Preserve the original
-- function body, OID, ACL and newline representation outside the named insertion.
create or replace function ship_dynamics_quiescence_private.splice_terminal_v1(
 p_function regprocedure,p_needle text,p_addition text,p_marker text
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare def text; needle text:=p_needle; addition text:=p_addition;
begin
 def:=pg_get_functiondef(p_function);
 if position(p_marker in def)>0 then return;end if;
 if position(needle in def)=0 and position(replace(needle,chr(10),chr(13)||chr(10)) in def)>0 then
  needle:=replace(needle,chr(10),chr(13)||chr(10));addition:=replace(addition,chr(10),chr(13)||chr(10));end if;
 if length(def)-length(replace(def,needle,''))<>length(needle) then raise exception 'business-pause-terminal-source-mismatch';end if;
 execute replace(def,needle,addition||needle);
end $$;

do $$
declare is_records boolean; signature regprocedure; needle text; addition text;
begin
 for is_records in select unnest(array[false,true]) loop
  signature:=case when is_records then 'public.prune_ship_dynamics_record_revision_history_v1(text,text,uuid,jsonb,jsonb)'::regprocedure
   else 'public.prune_ship_dynamics_revision_history(text,text,uuid,jsonb,jsonb)'::regprocedure end;
  needle:=case when is_records then '  perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,true);'
   else E'  select * into current_row\n  from public.ship_dynamics_app_state' end;
  addition:=format($add$  -- business_pause_terminal_prune_v1
  response := ship_dynamics_quiescence_private.prune_terminal_v1(
    p_workspace_key,p_actor_user_id,p_operation_id,
    jsonb_build_object('expectedRevisions',normalized_expected,'deleteRevisions',normalized_delete),%L::boolean);
  if response is not null then return response;end if;
$add$,is_records);
  perform ship_dynamics_quiescence_private.splice_terminal_v1(signature,needle,addition,'-- business_pause_terminal_prune_v1');
 end loop;
 perform ship_dynamics_quiescence_private.splice_terminal_v1(
  'public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz)'::regprocedure,
  '  perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,true);',
  $add$  -- business_pause_terminal_scheduler_v1
  select * into ledger from public.ship_dynamics_record_receipts where workspace_key=p_workspace_key and operation_id=operation_key;
  if found then
    if ledger.signature is distinct from signature then raise exception 'operation-id-mismatch';end if;
    return ledger.result || jsonb_build_object('replayed',true);
  end if;
$add$,'-- business_pause_terminal_scheduler_v1');
end $$;

-- Task/member lease upkeep uses the unchanged locking protocol, not business
-- admission. Keep an installation-derived private copy of the original gate;
-- actual saves still use the public gated entry and every business row trigger.
do $lease$
declare def text; lease_def text;
 source_name constant text:='public.ship_dynamics_record_writer_gate_v1(';
 target_name constant text:='ship_dynamics_quiescence_private.lease_writer_gate_v1(';
 injected constant text:=E'\n  perform ship_dynamics_quiescence_private.assert_write_v1(p_workspace);';
 old_call constant text:='perform public.ship_dynamics_record_writer_gate_v1(p_workspace,false);';
 new_call constant text:='perform ship_dynamics_quiescence_private.lease_writer_gate_v1(p_workspace,false);';
begin
 def:=pg_get_functiondef('public.ship_dynamics_record_writer_gate_v1(text,boolean)'::regprocedure);
 def:=replace(def,injected,'');
 if position('ship_dynamics_quiescence_private.assert_write_v1' in def)>0
 or length(def)-length(replace(def,source_name,''))<>length(source_name) then
  raise exception 'business-pause-lease-gate-source-mismatch';end if;
 execute replace(def,source_name,target_name);
 if to_regprocedure('public.ship_dynamics_task_lease_gate_v1(text,text)') is not null then
  lease_def:=pg_get_functiondef('public.ship_dynamics_task_lease_gate_v1(text,text)'::regprocedure);
  if length(lease_def)-length(replace(lease_def,old_call,''))=length(old_call) and position(new_call in lease_def)=0 then
   execute replace(lease_def,old_call,new_call);
  elsif position(old_call in lease_def)=0 and length(lease_def)-length(replace(lease_def,new_call,''))=length(new_call) then null;
  else raise exception 'business-pause-task-lease-source-mismatch';end if;
 end if;
end $lease$;

-- A narrow, fail-closed installation splice preserves every existing writer
-- early-return / cross-workspace / try-upgrade branch and its function OID/ACL.
do $$
declare def text; needle text:='perform pg_advisory_xact_lock_shared(hashtext(''record-maintenance-v1''),0);'; t record;
begin
 def:=pg_get_functiondef('public.ship_dynamics_record_writer_gate_v1(text,boolean)'::regprocedure);
 if position('ship_dynamics_quiescence_private.assert_write_v1(p_workspace)' in def)=0 then
   if (length(def)-length(replace(def,needle,'')))/length(needle)<>1 then
     raise exception 'business-pause-writer-gate-source-mismatch';
   end if;
   execute replace(def,needle,needle||E'\n  perform ship_dynamics_quiescence_private.assert_write_v1(p_workspace);');
 end if;
 for t in select * from ship_dynamics_quiescence_private.tables_v1() loop
   -- Required families must exist: no partial installation silently accepted.
   if to_regclass('public.'||t.table_name) is null then raise exception 'business-pause-required-table-missing: %',t.table_name;end if;
   execute format('drop trigger if exists sd_business_pause_row_v1 on public.%I',t.table_name);
   execute format('create trigger sd_business_pause_row_v1 before insert or update or delete on public.%I for each row execute function ship_dynamics_quiescence_private.row_guard_v1(%L)',t.table_name,t.key_column);
   execute format('drop trigger if exists sd_business_pause_truncate_v1 on public.%I',t.table_name);
   execute format('create trigger sd_business_pause_truncate_v1 before truncate on public.%I for each statement execute function ship_dynamics_quiescence_private.truncate_guard_v1()',t.table_name);
 end loop;
end $$;
revoke all on all functions in schema ship_dynamics_quiescence_private from public,anon,authenticated,service_role;
revoke all on function public.pause_ship_dynamics_business_v1(text,uuid),public.read_ship_dynamics_business_pause_v1(text,uuid),public.resume_ship_dynamics_business_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pause_ship_dynamics_business_v1(text,uuid),public.read_ship_dynamics_business_pause_v1(text,uuid),public.resume_ship_dynamics_business_v1(text,uuid,jsonb) to service_role;
commit;

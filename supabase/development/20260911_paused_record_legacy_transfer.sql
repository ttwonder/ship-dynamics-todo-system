-- DEVELOPMENT ONLY: install after business_quiescence and legacy cutover.
-- Dedicated staging, not authority publication, resume, or arbitrary restore.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
create table if not exists ship_dynamics_quiescence_private.stages_v1(
 request_id uuid primary key,
 workspace_key text not null,
 transition_id uuid not null,
 actor name not null,
 request jsonb not null,
 result jsonb not null,
 staged_watermark jsonb not null,
 unique(workspace_key,transition_id),
 foreign key(workspace_key,transition_id) references ship_dynamics_quiescence_private.transitions
);
-- Exists only between exact validation and readback in the same transaction.
-- No business payload or credentials are stored here.
create table if not exists ship_dynamics_quiescence_private.stage_context_v1(
 backend integer primary key,
 transaction_id xid8 not null,
 actor name not null,
 workspace_key text not null,
 old_row_sha256 text not null,
 new_row_sha256 text not null,
 history_row_sha256 text not null,
 state_used boolean not null default false,
 history_used boolean not null default false
);
revoke all on table ship_dynamics_quiescence_private.stages_v1,ship_dynamics_quiescence_private.stage_context_v1 from public,anon,authenticated,service_role;

create or replace function ship_dynamics_quiescence_private.stage_row_v1(
 p_table oid,p_operation text,p_old jsonb,p_new jsonb
) returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c ship_dynamics_quiescence_private.stage_context_v1%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role' then return false;end if;
 select * into c from ship_dynamics_quiescence_private.stage_context_v1
 where backend=pg_backend_pid() and transaction_id=pg_current_xact_id() and actor=session_user;
 if not found or p_new->>'workspace_key' is distinct from c.workspace_key then return false;end if;
 if p_table='public.ship_dynamics_app_state'::regclass and p_operation='UPDATE'
  and not c.state_used and public.sd_legacy_jsonb_sha256(p_old)=c.old_row_sha256
  and public.sd_legacy_jsonb_sha256(p_new)=c.new_row_sha256 then
  update ship_dynamics_quiescence_private.stage_context_v1 set state_used=true where backend=c.backend;
  return true;
 elsif p_table='public.ship_dynamics_app_revisions'::regclass and p_operation='INSERT'
  and c.state_used and not c.history_used and public.sd_legacy_jsonb_sha256(p_new)=c.history_row_sha256 then
  update ship_dynamics_quiescence_private.stage_context_v1 set history_used=true where backend=c.backend;
  return true;
 end if;
 return false;
end $$;

-- Keep every ordinary row guard branch/ACL/OID. Base then addon restores this
-- single source-checked insertion; unknown installed shapes abort installation.
select ship_dynamics_quiescence_private.splice_terminal_v1(
 'ship_dynamics_quiescence_private.row_guard_v1()'::regprocedure,
 ' -- BOTH old and new identities are checked, including moves into/out of pause.',
 $add$ -- paused_record_legacy_stage_row_v1
 if ship_dynamics_quiescence_private.stage_row_v1(TG_RELID,TG_OP,
  case when TG_OP='INSERT' then null else to_jsonb(OLD) end,
  case when TG_OP='DELETE' then null else to_jsonb(NEW) end) then return NEW;end if;
$add$,'-- paused_record_legacy_stage_row_v1');

create or replace function public.stage_ship_dynamics_paused_records_to_legacy_v1(
 p_workspace text,p_workspace_id uuid,p_transition uuid,p_watermark jsonb,
 p_source_revision integer,p_source_sha256 text,p_target_revision integer,
 p_target_sha256 text,p_frozen_at timestamptz,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare
 c record; legacy public.ship_dynamics_app_state%rowtype;
 v_freeze public.sd_legacy_write_controls%rowtype;
 source jsonb; source_row public.ship_dynamics_record_workspaces%rowtype;
 v_request jsonb; previous ship_dynamics_quiescence_private.stages_v1%rowtype;
 target_revision integer; target_at timestamptz; target_text text; target_payload jsonb;
 target_hash text; expected_row jsonb; expected_history jsonb; actual_row jsonb;
 actual_history jsonb; mark jsonb; v_result jsonb; ctx record;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception 'paused-stage-service-required' using errcode='42501';end if;
 -- A fresh operator transaction owns no advisory/subsystem/control/business
 -- locks. All subsequent potentially contested locks are TRY/NOWAIT, so an
 -- ungated legacy operator or tuple holder cannot form a reversed wait cycle.
 perform ship_dynamics_quiescence_private.operator_v1();
 if exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.granted
  and (l.locktype='advisory' or (l.locktype='relation' and l.mode<>'AccessShareLock'
   and l.relation in(select cl.oid from pg_class cl join pg_namespace n on n.oid=cl.relnamespace
    where n.nspname in ('public','ship_dynamics_quiescence_private'))))) then
  raise exception 'paused-stage-fresh-transaction-required' using errcode='25001';end if;
 perform ship_dynamics_quiescence_private.drain_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace)
  or p_workspace_id is null or p_transition is null or p_request_id is null
  or jsonb_typeof(p_watermark) is distinct from 'object'
  or p_source_revision is null or p_source_revision<0 or p_target_revision is null or p_target_revision<0
  or coalesce(p_source_sha256,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_target_sha256,'') !~ '^[0-9a-f]{64}$' or p_frozen_at is null then
  raise exception 'paused-stage-invalid-request' using errcode='22023';end if;
 v_request:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,
  'watermark',p_watermark,'sourceRevision',p_source_revision,'sourceSha256',p_source_sha256,
  'targetRevision',p_target_revision,'targetSha256',p_target_sha256,'frozenAt',p_frozen_at,'requestId',p_request_id);
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w
 join ship_dynamics_quiescence_private.transitions t using(workspace_key,transition_id)
 where w.workspace_key=p_workspace;
 if not found or c.state is distinct from 'paused' or c.transition_id is distinct from p_transition
  or c.workspace_id is distinct from p_workspace_id or c.watermark is distinct from p_watermark
  or not exists(select 1 from public.sd_workspaces where id=p_workspace_id and legacy_key=p_workspace) then
  raise exception 'paused-stage-pause-binding-mismatch' using errcode='55000';end if;
 -- MVCC source read is fresh after global exclusive admission. No source write,
 -- row lock, externally supplied snapshot, or reconstruction from the target.
 select * into source_row from public.ship_dynamics_record_workspaces where workspace_key=p_workspace;
 source:=public.read_ship_dynamics_records_v1(p_workspace);
 if source->>'status' is distinct from 'snapshot' or source_row.revision is distinct from p_source_revision
  or (source->>'revision')::integer is distinct from p_source_revision
  or public.sd_legacy_jsonb_sha256(source->'payload') is distinct from p_source_sha256
  or (source->'payload'->>'revision')::integer is distinct from p_source_revision
  or (source->'payload'->>'updatedAt')::timestamptz is distinct from date_trunc('milliseconds',source_row.updated_at) then
  raise exception 'paused-stage-source-mismatch' using errcode='55000';end if;
 perform public.sd_assert_legacy_freeze_boundary(p_workspace);
 select * into v_freeze from public.sd_legacy_write_controls where workspace_key=p_workspace;
 select * into legacy from public.ship_dynamics_app_state where workspace_key=p_workspace;
 if not found or v_freeze.frozen_at is distinct from p_frozen_at then
  raise exception 'paused-stage-target-mismatch' using errcode='55000';end if;
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id);
 select * into previous from ship_dynamics_quiescence_private.stages_v1 where request_id=p_request_id;
 if found then
  if previous.actor is distinct from session_user or previous.request is distinct from v_request
   or mark is distinct from previous.staged_watermark
   or legacy.revision is distinct from (previous.result->>'targetRevision')::integer
   or public.sd_legacy_jsonb_sha256(legacy.payload) is distinct from previous.result->>'targetSha256'
   or v_freeze.expected_revision is distinct from legacy.revision::bigint
   or v_freeze.payload_sha256 is distinct from previous.result->>'targetSha256' then
   raise exception 'paused-stage-replay-mismatch' using errcode='55000';end if;
  return previous.result;
 end if;
 if exists(select 1 from ship_dynamics_quiescence_private.stages_v1 where workspace_key=p_workspace and transition_id=p_transition)
  or mark is distinct from p_watermark then
  raise exception 'paused-stage-transition-already-changed' using errcode='55000';end if;
 if legacy.revision is distinct from p_target_revision
  or public.sd_legacy_jsonb_sha256(legacy.payload) is distinct from p_target_sha256
  or v_freeze.expected_revision is distinct from p_target_revision::bigint
  or v_freeze.payload_sha256 is distinct from p_target_sha256 then
  raise exception 'paused-stage-target-mismatch' using errcode='55000';end if;
 if greatest(p_source_revision,p_target_revision)=2147483647 then
  raise exception 'paused-stage-revision-exhausted' using errcode='22023';end if;
 target_revision:=greatest(p_source_revision,p_target_revision)+1;
 target_at:=date_trunc('milliseconds',clock_timestamp());
 target_text:=to_char(target_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 target_payload:=source->'payload'||jsonb_build_object('revision',target_revision,'updatedAt',target_text);
 target_hash:=public.sd_legacy_jsonb_sha256(target_payload);
 expected_row:=jsonb_build_object('workspace_key',p_workspace,'payload',target_payload,'revision',target_revision,
  'updated_at',target_at,'updated_by',source_row.updated_by);
 expected_history:=jsonb_build_object('workspace_key',p_workspace,'payload',target_payload,'revision',target_revision,
  'saved_at',target_at,'saved_by',source_row.updated_by);
 if exists(select 1 from public.ship_dynamics_app_revisions where workspace_key=p_workspace and revision=target_revision) then
  raise exception 'paused-stage-history-collision' using errcode='55000';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_workspace,731921)) then
  raise exception 'paused-stage-retry-transaction' using errcode='40001';end if;
 -- NOWAIT also covers a caller holding a tuple before entering its row guard.
 begin
  perform 1 from public.sd_legacy_write_controls where workspace_key=p_workspace for update nowait;
  perform 1 from public.ship_dynamics_app_state where workspace_key=p_workspace for update nowait;
 exception when lock_not_available then
  raise exception 'paused-stage-retry-transaction' using errcode='40001';end;
 insert into ship_dynamics_quiescence_private.stage_context_v1
  (backend,transaction_id,actor,workspace_key,old_row_sha256,new_row_sha256,history_row_sha256)
 values(pg_backend_pid(),pg_current_xact_id(),session_user,p_workspace,public.sd_legacy_jsonb_sha256(to_jsonb(legacy)),
  public.sd_legacy_jsonb_sha256(expected_row),public.sd_legacy_jsonb_sha256(expected_history));
 update public.sd_legacy_write_controls set restore_in_progress=true where workspace_key=p_workspace;
 update public.ship_dynamics_app_state set payload=target_payload,revision=target_revision,
  updated_at=target_at,updated_by=source_row.updated_by where workspace_key=p_workspace;
 -- Read after all row AND statement triggers, against precomputed expectations.
 select to_jsonb(s) into actual_row from public.ship_dynamics_app_state s where workspace_key=p_workspace;
 select to_jsonb(s) into actual_history from public.ship_dynamics_app_revisions s where workspace_key=p_workspace and revision=target_revision;
 select * into ctx from ship_dynamics_quiescence_private.stage_context_v1 where backend=pg_backend_pid();
 if actual_row is distinct from expected_row or actual_history is distinct from expected_history
  or public.sd_legacy_jsonb_sha256(actual_row->'payload') is distinct from target_hash
  or ctx.state_used is distinct from true or ctx.history_used is distinct from true then
  raise exception 'paused-stage-readback-mismatch' using errcode='55000';end if;
 update public.sd_legacy_write_controls set restore_in_progress=false,expected_revision=target_revision,
  payload_sha256=target_hash,updated_at=target_at where workspace_key=p_workspace;
 delete from ship_dynamics_quiescence_private.stage_context_v1 where backend=pg_backend_pid();
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id);
 if (mark-'ship_dynamics_app_state'-'ship_dynamics_app_revisions') is distinct from
  (p_watermark-'ship_dynamics_app_state'-'ship_dynamics_app_revisions') then
  raise exception 'paused-stage-independent-state-mismatch' using errcode='55000';end if;
 v_result:=jsonb_build_object('state','staged-paused','workspace',p_workspace,'workspaceId',p_workspace_id,
  'transition',p_transition,'requestId',p_request_id,'requestSha256',public.sd_legacy_jsonb_sha256(v_request),
  'sourceRevision',p_source_revision,'sourceSha256',p_source_sha256,'sourceUpdatedAt',source->'payload'->'updatedAt',
  'previousTargetRevision',p_target_revision,'previousTargetSha256',p_target_sha256,
  'targetRevision',target_revision,'targetSha256',target_hash,'targetUpdatedAt',target_text,
  'metadataMapping','max(source,target)+1; server UTC milliseconds; preserve source updated_by');
 insert into ship_dynamics_quiescence_private.stages_v1 values(p_request_id,p_workspace,p_transition,session_user,v_request,v_result,mark);
 -- Receipt-trigger faults/tampering cannot turn an unverified mutation into ACK.
 if not exists(select 1 from ship_dynamics_quiescence_private.stages_v1 s where s.request_id=p_request_id
  and s.request=v_request and s.result=v_result and s.staged_watermark=mark and s.actor=session_user)
  or (select restore_in_progress or not writes_frozen or expected_revision is distinct from target_revision::bigint
      or payload_sha256 is distinct from target_hash or frozen_at is distinct from p_frozen_at
      from public.sd_legacy_write_controls where workspace_key=p_workspace) is distinct from false
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from mark then
  raise exception 'paused-stage-final-readback-mismatch' using errcode='55000';end if;
 return v_result;
end $$;
revoke all on function ship_dynamics_quiescence_private.stage_row_v1(oid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stage_ship_dynamics_paused_records_to_legacy_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.stage_ship_dynamics_paused_records_to_legacy_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid) to service_role;
commit;

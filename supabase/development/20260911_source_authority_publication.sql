-- DEVELOPMENT ONLY: idle install after pause + paused transfer; no client adoption.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
create schema if not exists ship_dynamics_authority_private;
revoke all on schema ship_dynamics_authority_private from public,anon,authenticated,service_role;
create table if not exists ship_dynamics_authority_private.current_v1(
 workspace_key text primary key, workspace_id uuid not null unique,
 epoch bigint not null check(epoch>0), source text not null check(source='legacy'),
 publication_id uuid not null unique, transition_id uuid not null,
 phase text not null check(phase in ('published-paused','resumed'))
);
create table if not exists ship_dynamics_authority_private.receipts_v1(
 request_id uuid primary key, actor name not null, action text not null,
 request jsonb not null, result jsonb not null, binding jsonb not null
);
revoke all on all tables in schema ship_dynamics_authority_private from public,anon,authenticated,service_role;

-- Admission-only shared maintenance read. It changes no business/ledger state.
-- TRY is required: old direct callers can already own subsystem or tuple locks.
create or replace function ship_dynamics_authority_private.gate_v1()
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'source-authority-read-committed-required' using errcode='25001';end if;
 if not pg_try_advisory_xact_lock_shared(hashtext('record-maintenance-v1'),0) then raise exception 'source-authority-retry-transaction' using errcode='40001';end if;
 return true;
end $$;
create or replace function ship_dynamics_authority_private.assert_source_v1(p_workspace text,p_source text)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c ship_dynamics_authority_private.current_v1%rowtype;
begin
 perform ship_dynamics_quiescence_private.assert_write_v1(p_workspace);
 select * into c from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace;
 if found then
  if not exists(select 1 from public.sd_workspaces where id=c.workspace_id and legacy_key=p_workspace) then raise exception 'source-authority-binding-mismatch' using errcode='55000';end if;
  if c.phase<>'resumed' then raise exception 'business-writes-paused' using errcode='55000';end if;
  if p_source is null or p_source not in (c.source,'neutral-formal') then raise exception 'source-authority-retired' using errcode='55000';end if;
 end if;
end $$;
create or replace function ship_dynamics_authority_private.operator_v1()
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'source-authority-service-required' using errcode='42501';end if;
 perform ship_dynamics_quiescence_private.operator_v1();
 if exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.granted and
  (l.locktype='advisory' or (l.locktype='relation' and l.mode<>'AccessShareLock' and l.relation in
   (select cl.oid from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname in ('public','ship_dynamics_quiescence_private','ship_dynamics_authority_private'))))) then
  raise exception 'source-authority-fresh-transaction-required' using errcode='25001';end if;
 perform ship_dynamics_quiescence_private.drain_v1();
end $$;
-- Pin the frozen target against old ungated maintenance operators without
-- reversing WAIT order. Both controls acquire these before reading the proof.
create or replace function ship_dynamics_authority_private.lock_target_v1(p_workspace text)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended(p_workspace,731921)) then raise exception 'source-authority-retry-transaction' using errcode='40001';end if;
 begin
  perform 1 from public.sd_legacy_write_controls where workspace_key=p_workspace for update nowait;
  perform 1 from public.ship_dynamics_app_state where workspace_key=p_workspace for update nowait;
 exception when lock_not_available then raise exception 'source-authority-retry-transaction' using errcode='40001';end;
end $$;
create or replace function ship_dynamics_authority_private.binding_v1(p_workspace text,p_workspace_id uuid,p_transition uuid,p_stage uuid,p_result jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare s ship_dynamics_quiescence_private.stages_v1%rowtype;c record;f jsonb;r jsonb;l jsonb;
begin
 select * into s from ship_dynamics_quiescence_private.stages_v1 where request_id=p_stage;
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w join ship_dynamics_quiescence_private.transitions t using(workspace_key,transition_id) where workspace_key=p_workspace;
 if s.request_id is null or s.workspace_key is distinct from p_workspace or s.transition_id is distinct from p_transition
  or s.result is distinct from p_result or c.workspace_id is distinct from p_workspace_id or c.transition_id is distinct from p_transition
  or c.state is distinct from 'paused' or c.watermark is distinct from s.request->'watermark'
  or s.result->>'requestSha256' is distinct from public.sd_legacy_jsonb_sha256(s.request)
  or not exists(select 1 from public.sd_workspaces where id=p_workspace_id and legacy_key=p_workspace)
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from s.staged_watermark then
  raise exception 'source-authority-stage-binding-mismatch' using errcode='55000';end if;
 select to_jsonb(x) into f from public.sd_legacy_write_controls x where workspace_key=p_workspace;
 select to_jsonb(x) into l from public.ship_dynamics_app_state x where workspace_key=p_workspace;
 r:=public.read_ship_dynamics_records_v1(p_workspace);
 if f->'writes_frozen' is distinct from 'true'::jsonb or f->'restore_in_progress' is distinct from 'false'::jsonb
  or (f->>'frozen_at')::timestamptz is distinct from (s.request->>'frozenAt')::timestamptz
  or (f->>'expected_revision')::integer is distinct from (s.result->>'targetRevision')::integer
  or f->>'payload_sha256' is distinct from s.result->>'targetSha256'
  or (l->>'revision')::integer is distinct from (s.result->>'targetRevision')::integer
  or public.sd_legacy_jsonb_sha256(l->'payload') is distinct from s.result->>'targetSha256'
  or (r->>'revision')::integer is distinct from (s.result->>'sourceRevision')::integer
  or public.sd_legacy_jsonb_sha256(r->'payload') is distinct from s.result->>'sourceSha256' then
  raise exception 'source-authority-proof-mismatch' using errcode='55000';end if;
 return jsonb_build_object('stage',to_jsonb(s),'freeze',f);
end $$;
create or replace function public.publish_ship_dynamics_source_authority_v1(
 p_workspace text,p_workspace_id uuid,p_transition uuid,p_stage uuid,p_stage_result jsonb,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare req jsonb;prev ship_dynamics_authority_private.receipts_v1%rowtype;v_binding jsonb;v_result jsonb;v_epoch bigint;
begin
 perform ship_dynamics_authority_private.operator_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_workspace_id is null or p_transition is null or p_stage is null or p_request_id is null or jsonb_typeof(p_stage_result) is distinct from 'object' then raise exception 'source-authority-invalid-request' using errcode='22023';end if;
 req:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'stageId',p_stage,'stageResult',p_stage_result,'requestId',p_request_id);
 select * into prev from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id;
 if found then
  if prev.actor is distinct from session_user or prev.action<>'publish' or prev.request is distinct from req then raise exception 'source-authority-replay-mismatch' using errcode='55000';end if;
  return prev.result;
 end if;
 perform ship_dynamics_authority_private.lock_target_v1(p_workspace);
 v_binding:=ship_dynamics_authority_private.binding_v1(p_workspace,p_workspace_id,p_transition,p_stage,p_stage_result);
 -- This bounded reverse has only records -> legacy ownership. It cannot recycle
 -- a later pause into another stale records publication after target progress.
 if exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace) then raise exception 'source-authority-already-managed' using errcode='55000';end if;
 v_epoch:=1;
 v_result:=jsonb_build_object('state','published-paused','workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'publicationId',p_request_id,'stageId',p_stage,'source','legacy','epoch',v_epoch);
 insert into ship_dynamics_authority_private.current_v1 values(p_workspace,p_workspace_id,v_epoch,'legacy',p_request_id,p_transition,'published-paused');
 insert into ship_dynamics_authority_private.receipts_v1 values(p_request_id,session_user,'publish',req,v_result,v_binding);
 if not exists(select 1 from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id and actor=session_user and action='publish' and request=req and receipts_v1.result=v_result and receipts_v1.binding=v_binding)
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and epoch=v_epoch and source='legacy' and publication_id=p_request_id and transition_id=p_transition and phase='published-paused')
  or ship_dynamics_authority_private.binding_v1(p_workspace,p_workspace_id,p_transition,p_stage,p_stage_result) is distinct from v_binding then raise exception 'source-authority-final-readback-mismatch' using errcode='55000';end if;
 return v_result;
end $$;
create or replace function public.resume_ship_dynamics_legacy_authority_v1(
 p_workspace text,p_workspace_id uuid,p_transition uuid,p_publication uuid,p_publication_result jsonb,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare req jsonb;prev ship_dynamics_authority_private.receipts_v1%rowtype;pub ship_dynamics_authority_private.receipts_v1%rowtype;v_result jsonb;v_binding jsonb;ctl jsonb;
begin
 perform ship_dynamics_authority_private.operator_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_workspace_id is null or p_transition is null or p_publication is null or p_request_id is null or jsonb_typeof(p_publication_result) is distinct from 'object' then raise exception 'source-authority-invalid-request' using errcode='22023';end if;
 req:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'publicationId',p_publication,'publicationResult',p_publication_result,'requestId',p_request_id);
 select * into prev from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id;
 if found then
  if prev.actor is distinct from session_user or prev.action<>'resume' or prev.request is distinct from req then raise exception 'source-authority-replay-mismatch' using errcode='55000';end if;
  return prev.result;
 end if;
 select * into pub from ship_dynamics_authority_private.receipts_v1 where request_id=p_publication;
 if pub.action is distinct from 'publish' or pub.result is distinct from p_publication_result
  or pub.request->>'workspace' is distinct from p_workspace or pub.request->>'workspaceId' is distinct from p_workspace_id::text or pub.request->>'transition' is distinct from p_transition::text
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and transition_id=p_transition and publication_id=p_publication and phase='published-paused' and source='legacy' and epoch=(pub.result->>'epoch')::bigint) then raise exception 'source-authority-publication-mismatch' using errcode='55000';end if;
 perform ship_dynamics_authority_private.lock_target_v1(p_workspace);
 v_binding:=ship_dynamics_authority_private.binding_v1(p_workspace,p_workspace_id,p_transition,(pub.request->>'stageId')::uuid,pub.request->'stageResult');
 if v_binding is distinct from pub.binding then raise exception 'source-authority-proof-mismatch' using errcode='55000';end if;
 update public.sd_legacy_write_controls set writes_frozen=false,updated_at=clock_timestamp() where workspace_key=p_workspace;
 update ship_dynamics_quiescence_private.transitions set state='resumed' where workspace_key=p_workspace and transition_id=p_transition;
 update ship_dynamics_authority_private.current_v1 set phase='resumed' where workspace_key=p_workspace;
 v_result:=p_publication_result||jsonb_build_object('state','resumed','resumeId',p_request_id);
 insert into ship_dynamics_authority_private.receipts_v1 values(p_request_id,session_user,'resume',req,v_result,v_binding);
 select to_jsonb(c) into ctl from public.sd_legacy_write_controls c where workspace_key=p_workspace;
 if not exists(select 1 from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id and actor=session_user and action='resume' and request=req and receipts_v1.result=v_result and receipts_v1.binding=v_binding)
  or (ctl-'writes_frozen'-'updated_at') is distinct from ((v_binding->'freeze')-'writes_frozen'-'updated_at') or ctl->'writes_frozen' is distinct from 'false'::jsonb
  or not exists(select 1 from ship_dynamics_quiescence_private.transitions where workspace_key=p_workspace and transition_id=p_transition and state='resumed' and watermark=v_binding->'stage'->'request'->'watermark')
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and publication_id=p_publication and transition_id=p_transition and phase='resumed' and source='legacy' and epoch=(pub.result->>'epoch')::bigint)
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from v_binding->'stage'->'staged_watermark' then raise exception 'source-authority-final-readback-mismatch' using errcode='55000';end if;
 return v_result;
end $$;
create or replace function public.read_ship_dynamics_source_authority_v1(p_workspace text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c record;
begin
 perform ship_dynamics_quiescence_private.operator_v1();
 select a.*,t.state into c from ship_dynamics_authority_private.current_v1 a join ship_dynamics_quiescence_private.workspaces w using(workspace_key) join ship_dynamics_quiescence_private.transitions t on t.workspace_key=w.workspace_key and t.transition_id=w.transition_id where a.workspace_key=p_workspace;
 if not found then return jsonb_build_object('managed',false,'workspace',p_workspace);end if;
 return jsonb_build_object('managed',true,'workspace',c.workspace_key,'workspaceId',c.workspace_id,'source',c.source,'epoch',c.epoch,'publicationId',c.publication_id,'publicationPhase',c.phase,'pauseState',c.state,'admitted',c.phase='resumed' and c.state='resumed');
end $$;

-- Source-checked extensions; original OIDs/signatures/ACLs and business bodies.
-- Records fan-in deliberately excludes the private lease-only copied gate.
select ship_dynamics_quiescence_private.splice_terminal_v1('public.ship_dynamics_record_writer_gate_v1(text,boolean)'::regprocedure,
 '  perform ship_dynamics_quiescence_private.assert_write_v1(p_workspace);',
 E'  -- authority_records_gate_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace,''records-v1'');\n','-- authority_records_gate_v1');
-- Base pause reapplication derives its lease copy from the current public
-- writer. Strip precisely our business-only insertion from that private copy.
do $$
declare def text;injected text:=E'  -- authority_records_gate_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace,''records-v1'');\n';
begin
 def:=pg_get_functiondef('ship_dynamics_quiescence_private.lease_writer_gate_v1(text,boolean)'::regprocedure);
 if position(injected in def)>0 then execute replace(def,injected,'');
 elsif position('ship_dynamics_authority_private.assert_source_v1' in def)>0 then raise exception 'source-authority-lease-copy-mismatch';end if;
end $$;
-- Direct legacy fallback: source ownership is known for this aggregate only.
select ship_dynamics_quiescence_private.splice_terminal_v1('ship_dynamics_quiescence_private.row_guard_v1()'::regprocedure,
 '   perform ship_dynamics_quiescence_private.assert_write_v1(k);',
 E'   -- authority_legacy_row_v1\n   if TG_TABLE_NAME in (''ship_dynamics_app_state'',''ship_dynamics_app_revisions'',''ship_dynamics_block_operations'',''ship_dynamics_data_management_operations'') then perform ship_dynamics_authority_private.assert_source_v1(k,''legacy'');end if;\n','-- authority_legacy_row_v1');
-- These are exclusively the record representation, NOT the shared formal
-- tables. Keep a physical backstop for maintenance/direct-owner misuse too.
select ship_dynamics_quiescence_private.splice_terminal_v1('ship_dynamics_quiescence_private.row_guard_v1()'::regprocedure,
 '   perform ship_dynamics_quiescence_private.assert_write_v1(k);',
 E'   -- authority_record_row_v1\n   if TG_TABLE_NAME in (''ship_dynamics_record_workspaces'',''ship_dynamics_record_collections'',''ship_dynamics_records'',''ship_dynamics_record_receipts'',''ship_dynamics_record_versions'',''ship_dynamics_record_history'',''ship_dynamics_record_task_progress'',''ship_dynamics_record_task_progress_history'',''ship_dynamics_record_prune_operations'') then perform ship_dynamics_authority_private.assert_source_v1(k,''records-v1'');end if;\n','-- authority_record_row_v1');
-- Fresh staging must never overwrite progressed managed legacy. Historical stage
-- lookup above this anchor retains the original stricter paused/hash contract.
select ship_dynamics_quiescence_private.splice_terminal_v1('public.stage_ship_dynamics_paused_records_to_legacy_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid)'::regprocedure,
 ' if exists(select 1 from ship_dynamics_quiescence_private.stages_v1 where workspace_key=p_workspace and transition_id=p_transition)',
 E' -- authority_no_stale_stage_v1\n if exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace) then raise exception ''source-authority-retired'' using errcode=''55000'';end if;\n','-- authority_no_stale_stage_v1');

-- Mode-specific reports retain their original terminal branches and their
-- intentionally different record-actor initialization / legacy replay policies.
do $$
declare fn regprocedure;mode text;actor text;needle text;
begin
 for fn,mode in select f::regprocedure,m from (values
 ('public.sd_itinerary_record_report_save_manual_v1(text,text,uuid)','records-v1'),
 ('public.sd_itinerary_record_report_delete_ids_v1(text,text,uuid,text,jsonb)','records-v1'),
 ('public.sd_itinerary_record_report_delete_dates_v1(text,text,uuid,text,jsonb)','records-v1'),
 ('public.sd_save_manual_itinerary_report(text,text,uuid)','legacy'),
 ('public.delete_sd_itinerary_daily_report_records(text,text,uuid,text,jsonb)','legacy'),
 ('public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb)','legacy')) x(f,m) loop
  perform ship_dynamics_quiescence_private.splice_terminal_v1(fn,E'declare\n',E'-- authority_report_lock_v1\n','-- authority_report_lock_v1');
  -- Insert initialization immediately after DECLARE without altering actor code.
  perform ship_dynamics_quiescence_private.splice_terminal_v1(fn,'  v_actor jsonb',E'  authority_gate boolean := ship_dynamics_authority_private.gate_v1(); -- authority_report_admission_lock_v1\n','-- authority_report_admission_lock_v1');
  needle:=case when mode='records-v1' then '  v_actor_workspace_id := nullif(v_actor' else '  v_actor := public.sd_itinerary_main_actor' end;
  actor:=case when mode='records-v1' then E'  v_actor := public.sd_itinerary_record_actor_v1(p_workspace_key,p_actor_user_id);\n' else '' end;
  perform ship_dynamics_quiescence_private.splice_terminal_v1(fn,needle,format(E'  -- authority_report_new_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace_key,%L);\n%s',mode,actor),'-- authority_report_new_v1');
 end loop;
end $$;

-- Shared formal core gets installation-derived private route variants rather
-- than a caller-set GUC/source parameter. The same original replay/CAS/lease/
-- actor/business statements execute. No persistent or forgeable entry context.
do $$
declare def text;copy text;mode text;route text;fn regprocedure;needle text;
begin
 def:=pg_get_functiondef('public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)'::regprocedure);
 -- Remove only our own admission insertion when reapplying the extension.
 def:=replace(def,E'  -- authority_core_new_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace_key,NULL);\n','');
 needle:='  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text||'':itinerary:''||p_vessel_id,0));';
 if length(def)-length(replace(def,needle,''))<>length(needle) then raise exception 'source-authority-core-source-mismatch';end if;
 for mode,route in select * from (values('records-v1','record'),('legacy','legacy'),('neutral-formal','public')) x(m,r) loop
  copy:=replace(def,'public.sd_itinerary_save_internal(','ship_dynamics_authority_private.itinerary_'||route||'_v1(');
  copy:=replace(copy,needle,format(E'  perform ship_dynamics_authority_private.assert_source_v1(p_workspace_key,%L);\n',mode)||needle);
  execute copy;
 end loop;
 -- Unclassified direct core calls may recover terminal outcomes but cannot
 -- introduce managed writes. Public-vessel wrappers explicitly choose neutral.
 execute replace(def,needle,E'  -- authority_core_new_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace_key,NULL);\n'||needle);
 for fn,route in select f::regprocedure,r from (values
 ('public.sd_itinerary_record_save_v1(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb)','record'),
 ('public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb)','legacy'),
 ('public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint,jsonb)','public')) x(f,r) loop
  copy:=pg_get_functiondef(fn);
  if position('ship_dynamics_authority_private.itinerary_'||route||'_v1(' in copy)=0 then
   if length(copy)-length(replace(copy,'public.sd_itinerary_save_internal(',''))<>length('public.sd_itinerary_save_internal(') then raise exception 'source-authority-wrapper-source-mismatch';end if;
   copy:=replace(copy,'public.sd_itinerary_save_internal(','ship_dynamics_authority_private.itinerary_'||route||'_v1(');
   -- Gate before DECLARE actor/authorization evaluation, never on actor helpers.
   copy:=replace(copy,E'declare\n',E'declare\n  authority_gate boolean := ship_dynamics_authority_private.gate_v1(); -- authority_wrapper_lock_v1\n');
   if position('-- authority_wrapper_lock_v1' in copy)=0 then raise exception 'source-authority-wrapper-declaration-mismatch';end if;
   execute copy;
  end if;
 end loop;
end $$;
-- The separate Auth/rollout office endpoint is formal-store-only, not the
-- original-App legacy main actor route. Preserve its existing auth/permissions
-- and classify that explicit entry as neutral, rather than its 'office' label.
do $$
declare def text;copy text;needle text:='public.sd_itinerary_save_internal(';
begin
 def:=pg_get_functiondef('public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint)'::regprocedure);
 if (length(def)-length(replace(def,needle,'')))/length(needle)<>2 then raise exception 'source-authority-neutral-overload-mismatch';end if;
 execute replace(def,needle,'ship_dynamics_authority_private.itinerary_public_v1(');
 def:=pg_get_functiondef('public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)'::regprocedure);
 if position('-- authority_office_neutral_v1' in def)=0 then
  if length(def)-length(replace(def,needle,''))<>length(needle) or position('declare v_workspace uuid:=' in def)=0 then raise exception 'source-authority-office-source-mismatch';end if;
  copy:=replace(def,needle,'ship_dynamics_authority_private.itinerary_public_v1(');
  copy:=replace(copy,'declare v_workspace uuid:=',E'declare authority_gate boolean := ship_dynamics_authority_private.gate_v1(); -- authority_office_neutral_v1\n v_workspace uuid:=');
  execute copy;
 end if;
end $$;
select ship_dynamics_quiescence_private.splice_terminal_v1('public.prune_ship_dynamics_revision_history(text,text,uuid,jsonb,jsonb)'::regprocedure,
 E'  select * into current_row\n  from public.ship_dynamics_app_state',
 E'  -- authority_legacy_prune_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace_key,''legacy'');\n','-- authority_legacy_prune_v1');
select ship_dynamics_quiescence_private.splice_terminal_v1('public.ship_dynamics_run_daily_morning_snapshots()'::regprocedure,
 '    v_report_id := ''daily-morning-'' || v_business_date::text;',
 E'    -- authority_legacy_scheduler_v1\n    perform ship_dynamics_authority_private.assert_source_v1((select legacy_key from public.sd_workspaces where id=v_workspace.id),''legacy'');\n','-- authority_legacy_scheduler_v1');
-- Formal scheduled Itinerary uses UUID + formal documents only, no AppData
-- source actor. It remains neutral, protected by existing pause row guards.
revoke all on all functions in schema ship_dynamics_authority_private from public,anon,authenticated,service_role;
revoke all on function public.publish_ship_dynamics_source_authority_v1(text,uuid,uuid,uuid,jsonb,uuid),public.resume_ship_dynamics_legacy_authority_v1(text,uuid,uuid,uuid,jsonb,uuid),public.read_ship_dynamics_source_authority_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.publish_ship_dynamics_source_authority_v1(text,uuid,uuid,uuid,jsonb,uuid),public.resume_ship_dynamics_legacy_authority_v1(text,uuid,uuid,uuid,jsonb,uuid),public.read_ship_dynamics_source_authority_v1(text) to service_role;
commit;

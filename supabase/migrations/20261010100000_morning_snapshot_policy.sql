-- Owner-run forward function change; NO cron installation here.
-- No business-row writes, legacy/history migration, normalized RPC change,
-- builder recreation, new grants, source-authority change or pause bypass.
-- Source baseline: HEAD e520c9690574e1fb3430c9a0a8c66bd297f68e30,
-- supabase/development/20260906_record_daily_morning_scheduler.sql:86-138.
-- Accept that exact body, optionally with the exact installed pause replay
-- splice, or this exact forward body. Unknown body/anchor => transaction fails.
begin;
set local lock_timeout = '5s';
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
do $install$
declare
  fn regprocedure := to_regprocedure('public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz)');
  p pg_catalog.pg_proc%rowtype;
  before_meta jsonb; deps_before jsonb; deps_after jsonb; dep_ids oid[];
  raw_source text; source_lf text; checked_source text; definition text; next_definition text;
  expected_source text; next_raw text; nl text; old_part text; new_part text; i integer;
  pause_installed boolean := false; gate_source text;
  baseline constant text := replace($baseline$
declare
  w public.ship_dynamics_record_workspaces%rowtype;
  ledger public.ship_dynamics_record_receipts%rowtype;
  signature jsonb := jsonb_build_array('record-daily-morning-scheduler-v1',p_workspace_key,p_captured_at);
  operation_key text := 'record-daily-morning-scheduler:' || p_operation_id;
  business_date date := (p_captured_at at time zone 'Asia/Taipei')::date;
  report_id text; existing jsonb; report jsonb; snapshot jsonb; owner_row jsonb;
  orders jsonb; remaining jsonb; audit_id text; audit jsonb; operations jsonb; result jsonb;
begin
  if nullif(p_workspace_key,'') is null or nullif(p_operation_id,'') is null or length(p_operation_id)>160
    or p_captured_at is null or not isfinite(p_captured_at) then raise exception 'invalid-scheduler-request'; end if;
  perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,true);
  perform pg_advisory_xact_lock(hashtext('record-operation:' || p_workspace_key),hashtext(operation_key));
  select * into ledger from public.ship_dynamics_record_receipts where workspace_key=p_workspace_key and operation_id=operation_key;
  if found then
    if ledger.signature is distinct from signature then raise exception 'operation-id-mismatch'; end if;
    return ledger.result || jsonb_build_object('replayed',true);
  end if;
  select * into w from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key for update;
  if not found then raise exception 'record-workspace-not-found'; end if;
  if extract(isodow from business_date)>5 then return jsonb_build_object('ok',true,'status','not-business-day','count',0); end if;
  select r.value into owner_row from public.ship_dynamics_records r
  join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection=r.collection
  cross join lateral jsonb_array_elements_text(c.ids) with ordinality ids(id,ordinal)
  where r.workspace_key=p_workspace_key and r.collection='users' and ids.id=r.entity_id
    and r.value ->> 'role'='owner' and r.value -> 'isActive'='true'::jsonb order by ids.ordinal limit 1;
  -- Owner is attribution/eligibility metadata, never a forged browser actor/guard.
  if owner_row is null then return jsonb_build_object('ok',true,'status','no-active-owner','count',0); end if;
  report_id := 'daily-morning-' || business_date::text;
  select value into existing from public.ship_dynamics_records where workspace_key=p_workspace_key and collection='agendaReports' and entity_id=report_id;
  if existing is not null and existing ->> 'kind' is distinct from 'daily-morning' then raise exception 'report-kind-conflict'; end if;
  snapshot := public.build_ship_dynamics_record_daily_morning_v1(p_workspace_key,p_captured_at);
  report := jsonb_build_object('id',report_id,'title',to_char(business_date,'YYYY/MM/DD') || ' 早會內容',
    'vesselIds',(select coalesce(jsonb_agg(v -> 'id'),'[]'::jsonb) from jsonb_array_elements(snapshot -> 'vessels') v),
    'createdBy',coalesce(existing ->> 'createdBy',owner_row ->> 'id'),'createdAt',coalesce(existing -> 'createdAt',to_jsonb(p_captured_at)),
    'taskCount',jsonb_array_length(snapshot -> 'tasks'),'kind','daily-morning','businessDate',business_date,
    'source',case when existing ->> 'source'='manual' then 'manual' else 'scheduled' end,'updatedAt',p_captured_at,'snapshot',snapshot);
  select coalesce(jsonb_object_agg(collection,ids),'{}'::jsonb) into orders from public.ship_dynamics_record_collections where workspace_key=p_workspace_key;
  select coalesce(jsonb_agg(id order by ordinal),'[]'::jsonb) into remaining
    from jsonb_array_elements(coalesce(orders -> 'agendaReports','[]'::jsonb)) with ordinality source(id,ordinal) where id<>to_jsonb(report_id);
  orders := jsonb_set(orders,'{agendaReports}',jsonb_build_array(report_id)||remaining,true);
  audit_id := gen_random_uuid()::text;
  audit := jsonb_build_object('id',audit_id,'actorId',owner_row ->> 'id','actorName',owner_row ->> 'name',
    'action','scheduled_daily_morning_report','actorRole','system','entityType','agenda','entityId',report_id,
    'detail',jsonb_build_object('businessDate',business_date,'revision',w.revision+1)::text,'at',p_captured_at,'source','scheduled');
  orders := jsonb_set(orders,'{auditLogs}',jsonb_build_array(audit_id)||coalesce(orders -> 'auditLogs','[]'::jsonb),true);
  operations := jsonb_build_array(
    jsonb_build_object('kind','entity','collection','agendaReports','entityId',report_id,'expected',existing,'value',report),
    jsonb_build_object('kind','entity','collection','auditLogs','entityId',audit_id,'expected',null,'value',audit));
  result := public.ship_dynamics_record_commit_validated_v1(p_workspace_key,operations,w.root,orders,
    'scheduled-daily-morning:' || (owner_row ->> 'id'),operation_key,signature);
  return result;
end;
$baseline$,chr(13)||chr(10),chr(10));
  pause_block constant text := replace($pause$  -- business_pause_terminal_scheduler_v1
  select * into ledger from public.ship_dynamics_record_receipts where workspace_key=p_workspace_key and operation_id=operation_key;
  if found then
    if ledger.signature is distinct from signature then raise exception 'operation-id-mismatch';end if;
    return ledger.result || jsonb_build_object('replayed',true);
  end if;
$pause$,chr(13)||chr(10),chr(10));
  weekday_anchor constant text := replace($weekday$  if extract(isodow from business_date)>5 then return jsonb_build_object('ok',true,'status','not-business-day','count',0); end if;
$weekday$,chr(13)||chr(10),chr(10));
  report_anchor constant text := replace($old_report$  report_id := 'daily-morning-' || business_date::text;
  select value into existing from public.ship_dynamics_records where workspace_key=p_workspace_key and collection='agendaReports' and entity_id=report_id;
  if existing is not null and existing ->> 'kind' is distinct from 'daily-morning' then raise exception 'report-kind-conflict'; end if;
$old_report$,chr(13)||chr(10),chr(10));
  report_replacement constant text := replace($new_report$  -- record_daily_morning_freeze_once_v1
  report_id := 'daily-morning-' || business_date::text || '-scheduled';
  -- Match business identity, NOT the new ID: old unsuffixed scheduled rows count.
  select r.value into existing from public.ship_dynamics_records r
  where r.workspace_key=p_workspace_key and r.collection='agendaReports'
    and r.value ->> 'source'='scheduled' and r.value ->> 'kind'='daily-morning'
    and r.value ->> 'businessDate'=business_date::text
  order by r.entity_id limit 1;
  if existing is not null then
    -- Durable receipt for this NEW operation; no report/order/audit/revision or
    -- history changes, and no builder invocation. Keep the original receipt schema.
    select coalesce(jsonb_object_agg(collection,ids),'{}'::jsonb) into orders
    from public.ship_dynamics_record_collections where workspace_key=p_workspace_key;
    return public.ship_dynamics_record_commit_validated_v1(p_workspace_key,'[]'::jsonb,w.root,orders,
      'scheduled-daily-morning:' || (owner_row ->> 'id'),operation_key,signature);
  end if;
  -- Never repurpose a manual/foreign/malformed occupant of the scheduled ID.
  select value into existing from public.ship_dynamics_records
  where workspace_key=p_workspace_key and collection='agendaReports' and entity_id=report_id;
  if found then raise exception 'scheduled-report-id-conflict'; end if;
$new_report$,chr(13)||chr(10),chr(10));
  source_anchor constant text := $old_source$'source',case when existing ->> 'source'='manual' then 'manual' else 'scheduled' end$old_source$;
  source_replacement constant text := $new_source$'source','scheduled'$new_source$;
begin
  if fn is null then raise exception 'morning-existing-record-runner-required'; end if;
  select * into strict p from pg_catalog.pg_proc where oid=fn;
  if p.proowner <> (select oid from pg_catalog.pg_roles where rolname=current_user)
    or p.prosecdef or p.prolang <> (select oid from pg_catalog.pg_language where lanname='plpgsql') then
    raise exception 'morning-existing-invoker-owner-required' using errcode='42501';
  end if;
  dep_ids := array[
    to_regprocedure('public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz)')::oid,
    to_regprocedure('public.ship_dynamics_record_writer_gate_v1(text,boolean)')::oid,
    to_regprocedure('public.ship_dynamics_record_commit_validated_v1(text,jsonb,jsonb,jsonb,text,text,jsonb)')::oid];
  if array_position(dep_ids,null::oid) is not null then raise exception 'morning-record-dependencies-required'; end if;
  select jsonb_agg(to_jsonb(d) order by d.oid) into deps_before from pg_catalog.pg_proc d where d.oid=any(dep_ids);
  select prosrc into gate_source from pg_catalog.pg_proc where oid=dep_ids[2];
  raw_source := p.prosrc;
  source_lf := replace(raw_source,chr(13)||chr(10),chr(10));
  checked_source := source_lf;
  if position('-- business_pause_terminal_scheduler_v1' in source_lf)>0 then
    if length(source_lf)-length(replace(source_lf,pause_block,'')) <> length(pause_block) then
      raise exception 'morning-pause-replay-splice-mismatch';
    end if;
    pause_installed := true;
    -- Comparison ONLY: the executed definition retains this whole installed splice.
    checked_source := replace(source_lf,pause_block,'');
  end if;
  if position('ship_dynamics_quiescence_private.assert_write_v1(p_workspace)' in gate_source)>0
    and not pause_installed then raise exception 'morning-partial-pause-predecessor'; end if;
  if position('ship_dynamics_authority_private.assert_source_v1' in gate_source)>0 and
    position('ship_dynamics_authority_private.assert_source_v1(p_workspace,''records-v1'')' in gate_source)=0 then
    raise exception 'morning-record-authority-predecessor-mismatch';
  end if;
  expected_source := replace(replace(replace(baseline,weekday_anchor,''),report_anchor,report_replacement),source_anchor,source_replacement);
  if checked_source=expected_source then
    raise notice 'morning-freeze-once-already-installed; no function write';
    return;
  end if;
  if checked_source is distinct from baseline then raise exception 'morning-unknown-runner-predecessor'; end if;
  before_meta := to_jsonb(p)-'prosrc';
  definition := pg_get_functiondef(fn);
  next_definition := definition;
  next_raw := raw_source;
  nl := case when position(chr(13)||chr(10) in raw_source)>0 then chr(13)||chr(10) else chr(10) end;
  for i in 1..3 loop
    old_part := (array[weekday_anchor,report_anchor,source_anchor])[i];
    new_part := (array['',report_replacement,source_replacement])[i];
    old_part := replace(old_part,chr(10),nl);
    new_part := replace(new_part,chr(10),nl);
    if length(next_definition)-length(replace(next_definition,old_part,''))<>length(old_part)
      or length(next_raw)-length(replace(next_raw,old_part,''))<>length(old_part) then
      raise exception 'morning-anchor-missing-or-ambiguous: %',i;
    end if;
    next_definition := replace(next_definition,old_part,new_part);
    next_raw := replace(next_raw,old_part,new_part);
  end loop;
  execute next_definition;
  select * into strict p from pg_catalog.pg_proc where oid=fn;
  select jsonb_agg(to_jsonb(d) order by d.oid) into deps_after from pg_catalog.pg_proc d where d.oid=any(dep_ids);
  if to_regprocedure('public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz)')::oid<>fn::oid
    or (to_jsonb(p)-'prosrc') is distinct from before_meta or p.prosrc is distinct from next_raw
    or deps_after is distinct from deps_before then
    raise exception 'morning-function-or-dependency-readback-mismatch';
  end if;
  raise notice 'morning-freeze-once-installed; OID/ACL/config and dependencies preserved';
end;
$install$;
commit;

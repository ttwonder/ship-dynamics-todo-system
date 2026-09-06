-- DEVELOPMENT ONLY. Explicit owner-side workspace/operation/clock input.
-- No cron registration, workspace auto-enrolment, legacy write, browser grants,
-- fabricated user session, or invocation of the browser patch authorization path.
begin;

create or replace function public.build_ship_dynamics_record_daily_morning_v1(
  p_workspace_key text,p_captured_at timestamptz
)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  v_workspace uuid := public.sd_itinerary_workspace_id(p_workspace_key);
  v_vessels jsonb; v_tasks jsonb; v_meetings jsonb; v_projections jsonb;
begin
  if v_workspace is null then raise exception 'formal-workspace-not-found'; end if;
  -- Schedule semantics, NOT the manual cutoff/window helper. Row contents are
  -- preserved from records, including literal IDs and source-owned metadata.
  select coalesce(jsonb_agg(r.value order by r.entity_id),'[]'::jsonb) into v_vessels
  from public.ship_dynamics_records r
  where r.workspace_key=p_workspace_key and r.collection='vessels'
    and r.value -> 'isActive' is distinct from 'false'::jsonb;

  select coalesce(jsonb_agg(t.value order by t.entity_id),'[]'::jsonb) into v_tasks
  from public.ship_dynamics_records t
  where t.workspace_key=p_workspace_key and t.collection='tasks'
    and t.value -> 'isInternalControl' is distinct from 'true'::jsonb
    and t.value -> 'isClosed' is distinct from 'true'::jsonb
    and exists (
      select 1 from jsonb_array_elements(v_vessels) v
      where (case when jsonb_array_length(coalesce(t.value -> 'vesselIds','[]'::jsonb))>0
        then t.value -> 'vesselIds' else jsonb_build_array(t.value -> 'vesselId') end) ? (v ->> 'id')
      and not exists (select 1 from jsonb_array_elements(coalesce(t.value -> 'vesselProgress','[]'::jsonb)) progress
        where progress ->> 'vesselId'=v ->> 'id' and progress -> 'isClosed'='true'::jsonb)
    )
    and (nullif(t.value ->> 'sourceMeetingId','') is null or exists (
      select 1 from public.ship_dynamics_records m
      where m.workspace_key=p_workspace_key and m.collection='meetings' and m.entity_id=t.value ->> 'sourceMeetingId'
        and m.value -> 'includeInMorning'='true'::jsonb and m.value -> 'isInternalControl' is distinct from 'true'::jsonb
    ));

  -- Legacy schedule includes an eligible meeting with ANY open linked task,
  -- even when that task has no active vessel. Do not silently adopt manual rules.
  select coalesce(jsonb_agg(m.value order by m.entity_id),'[]'::jsonb) into v_meetings
  from public.ship_dynamics_records m
  where m.workspace_key=p_workspace_key and m.collection='meetings'
    and m.value -> 'includeInMorning'='true'::jsonb and m.value -> 'isInternalControl' is distinct from 'true'::jsonb
    and exists (select 1 from public.ship_dynamics_records t
      where t.workspace_key=p_workspace_key and t.collection='tasks' and t.value ->> 'sourceMeetingId'=m.entity_id
        and t.value -> 'isInternalControl' is distinct from 'true'::jsonb and t.value -> 'isClosed' is distinct from 'true'::jsonb);

  -- Same final formal six-group projection as 20260903230000. Vessel membership
  -- comes from records; ONLY shared formal documents supply operational values.
  select coalesce(jsonb_object_agg(v.value ->> 'id',
    case when d.vessel_id is null or first_row.value is null then jsonb_build_object('source','legacy')
    else jsonb_build_object(
      'source','itinerary','revision',d.revision,'updatedAt',d.updated_at,
      'rowId',coalesce(first_row.value ->> 'rowId',''),
      'values',jsonb_build_object(
        'previousPortName',btrim(coalesce(first_row.value ->> 'previousPortName','')),
        'portDockName',btrim(coalesce(first_row.value ->> 'portDockName','')),
        'etaUtc',nullif(btrim(coalesce(first_row.value ->> 'etaUtc','')),''),
        'etaTimeZone',coalesce(nullif(btrim(coalesce(first_row.value ->> 'etaTimeZone','')),''),nullif(btrim(coalesce(first_row.value ->> 'portTimeZone','')),''),''),
        'etbUtc',nullif(btrim(coalesce(first_row.value ->> 'etbUtc','')),''),
        'etbTimeZone',coalesce(nullif(btrim(coalesce(first_row.value ->> 'etbTimeZone','')),''),nullif(btrim(coalesce(first_row.value ->> 'portTimeZone','')),''),''),
        'etdUtc',nullif(btrim(coalesce(first_row.value ->> 'etdUtc','')),''),
        'etdTimeZone',coalesce(nullif(btrim(coalesce(first_row.value ->> 'etdTimeZone','')),''),nullif(btrim(coalesce(first_row.value ->> 'portTimeZone','')),''),''),
        'cargoQuantityText',btrim(coalesce(first_row.value ->> 'cargoQuantityText',''))
      )
    ) end order by v.value ->> 'id'),'{}'::jsonb) into v_projections
  from jsonb_array_elements(v_vessels) v(value)
  left join public.sd_itinerary_documents d on d.workspace_id=v_workspace and d.vessel_id=v.value ->> 'id'
  left join lateral (
    select row_item.value from jsonb_array_elements(d.rows_payload) with ordinality row_item(value,ordinality)
    order by case when coalesce(row_item.value ->> 'sortOrder','') ~ '^[0-9]+$'
      then (row_item.value ->> 'sortOrder')::integer else row_item.ordinality::integer-1 end,row_item.ordinality limit 1
  ) first_row on d.vessel_id is not null;
  return jsonb_build_object('schemaVersion',2,'capturedAt',p_captured_at,'projectionCapturedAt',p_captured_at,
    'itineraryProjections',v_projections,'vessels',v_vessels,'tasks',v_tasks,'meetings',v_meetings);
end;
$$;

create or replace function public.run_ship_dynamics_record_daily_morning_v1(
  p_workspace_key text,p_operation_id text,p_captured_at timestamptz
)
returns jsonb language plpgsql volatile security invoker set search_path = pg_catalog, public as $$
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
$$;
revoke all on function public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz) from public,anon,authenticated;
revoke all on function public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz) from public,anon,authenticated;
commit;

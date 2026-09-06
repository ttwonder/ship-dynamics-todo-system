-- DEVELOPMENT ONLY. Explicit records actor; same report/history/operation authority.
-- Existing report IDs, receipt payloads and formal snapshot builder remain unchanged.
-- Mounted main migration makes both sd_vessels.id and document.vessel_id text.
begin;


create or replace function public.sd_itinerary_record_report_save_manual_v1(
  p_workspace_key text,
  p_actor_user_id text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid;
  v_actor_workspace_id uuid;
  v_actor_role text;
  operation_row public.sd_itinerary_daily_report_operations%rowtype;
  request_payload jsonb;
  result_payload jsonb;
  report_row public.sd_itinerary_daily_reports%rowtype;
  report_snapshot jsonb;
  generated_at timestamptz;
  business_date date;
begin
  if p_operation_id is null or length(btrim(coalesce(p_actor_user_id, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  select workspace.id into v_workspace_id
  from public.sd_workspaces workspace
  where workspace.id = (v_actor ->> 'workspaceId')::uuid;
  if v_workspace_id is null then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':daily-itinerary-report', 0));

  request_payload := jsonb_build_object('snapshotSource', 'authoritative-formal-main-v1');

  select * into operation_row
  from public.sd_itinerary_daily_report_operations operation
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id
  for update;

  if found then
    if operation_row.command_type <> 'save_manual_itinerary_report'
      or operation_row.actor_user_id is distinct from p_actor_user_id
      or operation_row.request_payload is distinct from request_payload then
      return jsonb_build_object('ok', false, 'error', 'OPERATION_ID_REUSED');
    end if;
    if operation_row.status in ('COMMITTED', 'REJECTED') then
      if operation_row.result is null then
        return jsonb_build_object('ok', false, 'error', 'INVALID_OPERATION_RECEIPT');
      end if;
      if operation_row.status = 'COMMITTED' then
        return operation_row.result || jsonb_build_object('created', false);
      end if;
      return operation_row.result;
    end if;
  end if;

  v_actor_workspace_id := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role := lower(btrim(coalesce(v_actor ->> 'role', '')));
  if v_actor_workspace_id is null or v_actor_workspace_id is distinct from v_workspace_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_actor_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'OWNER_OR_ADMIN_REQUIRED');
  end if;

  if operation_row.operation_id is null then
    insert into public.sd_itinerary_daily_report_operations(
      workspace_id, operation_id, actor_user_id, command_type, request_payload, status
    ) values (
      v_workspace_id, p_operation_id, p_actor_user_id,
      'save_manual_itinerary_report', request_payload, 'STARTED'
    );
  end if;

  generated_at := clock_timestamp();
  business_date := (generated_at at time zone 'Asia/Taipei')::date;
  report_snapshot := public.sd_build_daily_itinerary_report_snapshot(
    v_workspace_id,
    business_date,
    generated_at
  );

  insert into public.sd_itinerary_daily_reports(
    workspace_id, business_date, timezone, generated_at, generated_by,
    generated_by_actor_id, operation_id,
    vessel_count, row_count, source_max_revision, snapshot
  ) values (
    v_workspace_id,
    business_date,
    'Asia/Taipei',
    generated_at,
    'manual',
    p_actor_user_id,
    p_operation_id,
    (report_snapshot ->> 'vesselCount')::integer,
    (report_snapshot ->> 'rowCount')::integer,
    (report_snapshot ->> 'sourceMaxRevision')::bigint,
    report_snapshot
  )
  returning * into report_row;

  result_payload := jsonb_build_object(
    'ok', true,
    'created', true,
    'operationId', p_operation_id,
    'report', jsonb_build_object(
      'reportId', report_row.report_id::text,
      'businessDate', report_row.business_date::text,
      'timezone', report_row.timezone,
      'generatedAt', report_row.generated_at,
      'generatedBy', report_row.generated_by,
      'generatedByActorId', report_row.generated_by_actor_id,
      'vesselCount', report_row.vessel_count,
      'rowCount', report_row.row_count,
      'sourceMaxRevision', report_row.source_max_revision,
      'logicalBytes', pg_column_size(report_row.snapshot)
    )
  );

  update public.sd_itinerary_daily_report_operations operation
  set status = 'COMMITTED',
      result = result_payload,
      completed_at = clock_timestamp()
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id;

  return result_payload;
end;
$$;

revoke all on function public.sd_itinerary_record_report_save_manual_v1(text,text,uuid) from public, anon, authenticated;

create or replace function public.sd_itinerary_record_report_load_v1(
  p_workspace_key text,
  p_report_id bigint,
  p_actor_user_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role text := lower(btrim(coalesce(v_actor ->> 'role', '')));
  report_row public.sd_itinerary_daily_reports%rowtype;
begin
  if v_workspace_id is null or v_actor_role not in ('owner', 'admin', 'operator', 'vessel') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_report_id is null or p_report_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  select * into report_row
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.report_id = p_report_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'REPORT_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'report', jsonb_build_object(
      'reportId', report_row.report_id::text,
      'businessDate', report_row.business_date::text,
      'timezone', report_row.timezone,
      'generatedAt', report_row.generated_at,
      'generatedBy', report_row.generated_by,
      'generatedByActorId', report_row.generated_by_actor_id,
      'vesselCount', report_row.vessel_count,
      'rowCount', report_row.row_count,
      'sourceMaxRevision', report_row.source_max_revision,
      'logicalBytes', pg_column_size(report_row.snapshot),
      'snapshot', report_row.snapshot
    )
  );
end;
$$;

revoke all on function public.sd_itinerary_record_report_load_v1(text,bigint,text) from public, anon, authenticated;


create or replace function public.sd_itinerary_record_report_list_v1(
  p_workspace_key text,
  p_actor_user_id text,
  p_page integer default 1,
  p_page_size integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role text := lower(btrim(coalesce(v_actor ->> 'role', '')));
  v_page_size integer := least(30, greatest(1, coalesce(p_page_size, 30)));
  v_date_total bigint := 0;
  v_report_total bigint := 0;
  v_page_count integer := 1;
  v_page integer := greatest(1, coalesce(p_page, 1));
  reports jsonb := '[]'::jsonb;
begin
  if v_workspace_id is null or v_actor_role not in ('owner', 'admin', 'operator', 'vessel') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select count(distinct report.business_date), count(*)
  into v_date_total, v_report_total
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id;
  v_page_count := greatest(1, ceil(v_date_total::numeric / v_page_size)::integer);
  v_page := least(v_page, v_page_count);

  with page_dates as (
    select distinct candidate.business_date
    from public.sd_itinerary_daily_reports candidate
    where candidate.workspace_id = v_workspace_id
    order by candidate.business_date desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'reportId', report.report_id::text,
    'businessDate', report.business_date::text,
    'timezone', report.timezone,
    'generatedAt', report.generated_at,
    'generatedBy', report.generated_by,
    'generatedByActorId', report.generated_by_actor_id,
    'vesselCount', report.vessel_count,
    'rowCount', report.row_count,
    'sourceMaxRevision', report.source_max_revision,
    'logicalBytes', pg_column_size(report.snapshot)
  ) order by report.business_date desc, report.generated_at desc, report.report_id desc), '[]'::jsonb)
  into reports
  from public.sd_itinerary_daily_reports report
  join page_dates selected on selected.business_date = report.business_date
  where report.workspace_id = v_workspace_id;

  return jsonb_build_object(
    'ok', true,
    'timezone', 'Asia/Taipei',
    'generatedAt', clock_timestamp(),
    'page', v_page,
    'pageSize', v_page_size,
    'pageCount', v_page_count,
    'total', v_date_total,
    'dateTotal', v_date_total,
    'reportTotal', v_report_total,
    'setToken', public.sd_itinerary_daily_report_set_token(v_workspace_id),
    'reports', reports
  );
end;
$$;

revoke all on function public.sd_itinerary_record_report_list_v1(text,text,integer,integer) from public, anon, authenticated;

create or replace function public.sd_itinerary_record_report_locate_v1(
  p_workspace_key text,
  p_business_date date,
  p_actor_user_id text,
  p_page_size integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role text := lower(btrim(coalesce(v_actor ->> 'role', '')));
  v_page_size integer := least(30, greatest(1, coalesce(p_page_size, 30)));
  v_preceding bigint := 0;
begin
  if v_workspace_id is null or v_actor_role not in ('owner', 'admin', 'operator', 'vessel') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_business_date is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;
  if not exists (
    select 1 from public.sd_itinerary_daily_reports report
    where report.workspace_id = v_workspace_id
      and report.business_date = p_business_date
  ) then
    return jsonb_build_object(
      'ok', true,
      'found', false,
      'businessDate', p_business_date::text,
      'pageSize', v_page_size,
      'setToken', public.sd_itinerary_daily_report_set_token(v_workspace_id)
    );
  end if;

  select count(distinct report.business_date) into v_preceding
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.business_date > p_business_date;

  return jsonb_build_object(
    'ok', true,
    'found', true,
    'businessDate', p_business_date::text,
    'page', floor(v_preceding::numeric / v_page_size)::integer + 1,
    'pageSize', v_page_size,
    'setToken', public.sd_itinerary_daily_report_set_token(v_workspace_id)
  );
end;
$$;

revoke all on function public.sd_itinerary_record_report_locate_v1(text,date,text,integer) from public, anon, authenticated;

create or replace function public.sd_itinerary_record_report_delete_ids_v1(
  p_workspace_key text,
  p_actor_user_id text,
  p_operation_id uuid,
  p_expected_set_token text,
  p_delete_report_ids jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid;
  v_actor_workspace_id uuid;
  v_actor_role text;
  operation_row public.sd_itinerary_daily_report_operations%rowtype;
  normalized_delete jsonb := '[]'::jsonb;
  current_set_token text := '';
  remaining_set_token text := '';
  request_payload jsonb;
  response jsonb;
  delete_count integer := 0;
  delete_distinct_count integer := 0;
  current_count integer := 0;
  deleted_count integer := 0;
  deleted_bytes bigint := 0;
begin
  if p_operation_id is null
    or p_expected_set_token is null
    or p_expected_set_token !~ '^[0-9a-f]{32}$'
    or jsonb_typeof(p_delete_report_ids) is distinct from 'array'
    or jsonb_array_length(p_delete_report_ids) < 1
    or exists (
      select 1
      from jsonb_array_elements(p_delete_report_ids) value
      where jsonb_typeof(value) <> 'string'
         or not public.sd_itinerary_daily_report_id_valid(value #>> '{}')
    ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  select workspace.id into v_workspace_id
  from public.sd_workspaces workspace
  where workspace.id = (v_actor ->> 'workspaceId')::uuid;
  if v_workspace_id is null then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select
    coalesce(jsonb_agg(to_jsonb(report_id::text) order by report_id), '[]'::jsonb),
    count(*)::integer,
    count(distinct report_id)::integer
  into normalized_delete, delete_count, delete_distinct_count
  from (
    select (value #>> '{}')::bigint as report_id
    from jsonb_array_elements(p_delete_report_ids) value
  ) normalized;

  if delete_count <> delete_distinct_count or delete_count > 100 then
    return jsonb_build_object(
      'ok', false,
      'error', case when delete_count > 100 then 'BATCH_LIMIT_EXCEEDED' else 'INVALID_PAYLOAD' end
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':daily-itinerary-report', 0));

  request_payload := jsonb_build_object(
    'expectedSetToken', p_expected_set_token,
    'deleteReportIds', normalized_delete
  );

  select * into operation_row
  from public.sd_itinerary_daily_report_operations operation
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id
  for update;

  if found then
    if operation_row.actor_user_id <> p_actor_user_id
      or operation_row.command_type <> 'delete_daily_itinerary_report_records'
      or operation_row.request_payload is distinct from request_payload then
      return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_MISMATCH');
    end if;
    if operation_row.status in ('COMMITTED', 'REJECTED') then
      return operation_row.result;
    end if;
  end if;

  v_actor_workspace_id := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role := lower(btrim(coalesce(v_actor ->> 'role', '')));
  if v_actor_workspace_id is null or v_actor_workspace_id is distinct from v_workspace_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_actor_role is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'error', 'OWNER_REQUIRED');
  end if;

  if operation_row.operation_id is null then
    insert into public.sd_itinerary_daily_report_operations(
      workspace_id, operation_id, actor_user_id, command_type, request_payload, status
    ) values (
      v_workspace_id, p_operation_id, p_actor_user_id,
      'delete_daily_itinerary_report_records', request_payload, 'STARTED'
    );
  end if;

  select count(*)::integer into current_count
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id;
  current_set_token := public.sd_itinerary_daily_report_set_token(v_workspace_id);

  if current_set_token is distinct from p_expected_set_token then
    response := jsonb_build_object(
      'ok', false,
      'error', 'REPORT_SET_CHANGED',
      'currentReportCount', current_count,
      'currentSetToken', current_set_token
    );
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(normalized_delete) selected(report_id_text)
    where not exists (
      select 1 from public.sd_itinerary_daily_reports report
      where report.workspace_id = v_workspace_id
        and report.report_id = selected.report_id_text::bigint
    )
  ) then
    response := jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  select count(*)::integer, coalesce(sum(pg_column_size(report.snapshot)), 0)::bigint
  into deleted_count, deleted_bytes
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.report_id in (
      select selected.report_id_text::bigint
      from jsonb_array_elements_text(normalized_delete) selected(report_id_text)
    );

  if deleted_count <> delete_count then
    response := jsonb_build_object('ok', false, 'error', 'REPORT_SET_CHANGED');
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  delete from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.report_id in (
      select selected.report_id_text::bigint
      from jsonb_array_elements_text(normalized_delete) selected(report_id_text)
    );
  remaining_set_token := public.sd_itinerary_daily_report_set_token(v_workspace_id);

  response := jsonb_build_object(
    'ok', true,
    'operationId', p_operation_id,
    'deletedCount', deleted_count,
    'deletedBytes', deleted_bytes,
    'deletedReportIds', normalized_delete,
    'remainingReportCount', current_count - deleted_count,
    'remainingSetToken', remaining_set_token
  );

  update public.sd_itinerary_daily_report_operations operation
  set status = 'COMMITTED', result = response, completed_at = clock_timestamp()
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id;

  return response;
end;
$$;

revoke all on function public.sd_itinerary_record_report_delete_ids_v1(text,text,uuid,text,jsonb) from public, anon, authenticated;

create or replace function public.sd_itinerary_record_report_delete_dates_v1(
  p_workspace_key text,
  p_actor_user_id text,
  p_operation_id uuid,
  p_expected_set_token text,
  p_delete_dates jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid;
  v_actor_workspace_id uuid;
  v_actor_role text;
  operation_row public.sd_itinerary_daily_report_operations%rowtype;
  normalized_delete jsonb := '[]'::jsonb;
  current_set_token text := '';
  remaining_set_token text := '';
  request_payload jsonb;
  response jsonb;
  delete_count integer := 0;
  delete_distinct_count integer := 0;
  current_count integer := 0;
  deleted_count integer := 0;
  deleted_bytes bigint := 0;
begin
  if p_operation_id is null
    or p_expected_set_token is null
    or p_expected_set_token !~ '^[0-9a-f]{32}$'
    or jsonb_typeof(p_delete_dates) is distinct from 'array'
    or jsonb_array_length(p_delete_dates) < 1
    or exists (
      select 1
      from jsonb_array_elements(p_delete_dates) value
      where jsonb_typeof(value) <> 'string'
         or not public.sd_itinerary_daily_date_valid(value #>> '{}')
    ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  select
    coalesce(jsonb_agg(to_jsonb(date_value::text) order by date_value), '[]'::jsonb),
    count(*)::integer,
    count(distinct date_value)::integer
  into normalized_delete, delete_count, delete_distinct_count
  from (
    select (value #>> '{}')::date as date_value
    from jsonb_array_elements(p_delete_dates) value
  ) normalized;

  if delete_count <> delete_distinct_count or delete_count > 100 then
    return jsonb_build_object(
      'ok', false,
      'error', case when delete_count > 100 then 'BATCH_LIMIT_EXCEEDED' else 'INVALID_PAYLOAD' end
    );
  end if;

  select workspace.id into v_workspace_id
  from public.sd_workspaces workspace
  where workspace.id = (v_actor ->> 'workspaceId')::uuid
  limit 1;
  if v_workspace_id is null then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':daily-itinerary-report', 0));
  request_payload := jsonb_build_object(
    'expectedSetToken', p_expected_set_token,
    'deleteDates', normalized_delete
  );

  select * into operation_row
  from public.sd_itinerary_daily_report_operations operation
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id
  for update;

  if operation_row.operation_id is not null then
    if operation_row.actor_user_id <> p_actor_user_id
      or operation_row.command_type <> 'delete_daily_itinerary_reports'
      or operation_row.request_payload is distinct from request_payload then
      return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_MISMATCH');
    end if;
    if operation_row.status in ('COMMITTED', 'REJECTED') then
      return operation_row.result;
    end if;
  end if;

  v_actor_workspace_id := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role := lower(btrim(coalesce(v_actor ->> 'role', '')));
  if v_actor_workspace_id is null or v_actor_workspace_id is distinct from v_workspace_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_actor_role is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'error', 'OWNER_REQUIRED');
  end if;

  if operation_row.operation_id is null then
    insert into public.sd_itinerary_daily_report_operations(
      workspace_id, operation_id, actor_user_id, command_type, request_payload, status
    ) values (
      v_workspace_id, p_operation_id, p_actor_user_id,
      'delete_daily_itinerary_reports', request_payload, 'STARTED'
    );
  end if;

  select count(*)::integer
  into current_count
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.generated_by = 'scheduled';
  current_set_token := public.sd_itinerary_daily_report_set_token(v_workspace_id);

  if current_set_token is distinct from p_expected_set_token then
    response := jsonb_build_object(
      'ok', false,
      'error', 'REPORT_SET_CHANGED',
      'currentReportCount', current_count,
      'currentSetToken', current_set_token
    );
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(normalized_delete) selected(date_text)
    where not exists (
      select 1
      from public.sd_itinerary_daily_reports report
      where report.workspace_id = v_workspace_id
        and report.business_date = selected.date_text::date
        and report.generated_by = 'scheduled'
    )
  ) then
    response := jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  select count(*)::integer, coalesce(sum(pg_column_size(report.snapshot)), 0)::bigint
  into deleted_count, deleted_bytes
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.generated_by = 'scheduled'
    and report.business_date in (
      select selected.date_text::date
      from jsonb_array_elements_text(normalized_delete) selected(date_text)
    );

  if deleted_count <> delete_count then
    response := jsonb_build_object('ok', false, 'error', 'REPORT_SET_CHANGED');
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  delete from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.generated_by = 'scheduled'
    and report.business_date in (
      select selected.date_text::date
      from jsonb_array_elements_text(normalized_delete) selected(date_text)
    );
  remaining_set_token := public.sd_itinerary_daily_report_set_token(v_workspace_id);

  response := jsonb_build_object(
    'ok', true,
    'operationId', p_operation_id,
    'deletedCount', deleted_count,
    'deletedBytes', deleted_bytes,
    'deletedDates', normalized_delete,
    'remainingReportCount', current_count - deleted_count,
    'remainingSetToken', remaining_set_token
  );

  update public.sd_itinerary_daily_report_operations operation
  set status = 'COMMITTED', result = response, completed_at = clock_timestamp()
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id;
  return response;
end;
$$;

revoke all on function public.sd_itinerary_record_report_delete_dates_v1(text,text,uuid,text,jsonb) from public, anon, authenticated;

commit;

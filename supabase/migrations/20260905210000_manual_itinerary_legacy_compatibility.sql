begin;

-- Mixed-version safety: the pre-v2 browser must continue to see and mutate
-- only the single scheduled snapshot for each Taipei business date. Manual
-- snapshots remain visible only through the report-id v2 surface.
create or replace function public.sd_itinerary_daily_report_list(
  p_workspace_key text,
  p_actor_user_id text,
  p_page integer default 1,
  p_page_size integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := public.sd_itinerary_main_actor(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role text := lower(btrim(coalesce(v_actor ->> 'role', '')));
  v_page_size integer := least(30, greatest(1, coalesce(p_page_size, 30)));
  v_total bigint := 0;
  v_page_count integer := 1;
  v_page integer := greatest(1, coalesce(p_page, 1));
  reports jsonb := '[]'::jsonb;
begin
  if v_workspace_id is null or v_actor_role not in ('owner', 'admin', 'operator', 'vessel') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select count(*) into v_total
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.generated_by = 'scheduled';
  v_page_count := greatest(1, ceil(v_total::numeric / v_page_size)::integer);
  v_page := least(v_page, v_page_count);

  select coalesce(jsonb_agg(jsonb_build_object(
    'businessDate', report.business_date::text,
    'timezone', report.timezone,
    'generatedAt', report.generated_at,
    'generatedBy', 'scheduled',
    'vesselCount', report.vessel_count,
    'rowCount', report.row_count,
    'sourceMaxRevision', report.source_max_revision,
    'logicalBytes', pg_column_size(report.snapshot)
  ) order by report.business_date desc), '[]'::jsonb)
  into reports
  from (
    select candidate.*
    from public.sd_itinerary_daily_reports candidate
    where candidate.workspace_id = v_workspace_id
      and candidate.generated_by = 'scheduled'
    order by candidate.business_date desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  ) report;

  return jsonb_build_object(
    'ok', true,
    'timezone', 'Asia/Taipei',
    'generatedAt', clock_timestamp(),
    'page', v_page,
    'pageSize', v_page_size,
    'pageCount', v_page_count,
    'total', v_total,
    'setToken', public.sd_itinerary_daily_report_set_token(v_workspace_id),
    'reports', reports
  );
end;
$$;

create or replace function public.sd_itinerary_daily_report_locate(
  p_workspace_key text,
  p_business_date date,
  p_actor_user_id text,
  p_page_size integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := public.sd_itinerary_main_actor(p_workspace_key, p_actor_user_id);
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
    select 1
    from public.sd_itinerary_daily_reports report
    where report.workspace_id = v_workspace_id
      and report.business_date = p_business_date
      and report.generated_by = 'scheduled'
  ) then
    return jsonb_build_object(
      'ok', true,
      'found', false,
      'businessDate', p_business_date::text,
      'pageSize', v_page_size,
      'setToken', public.sd_itinerary_daily_report_set_token(v_workspace_id)
    );
  end if;

  select count(*) into v_preceding
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.generated_by = 'scheduled'
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

-- Preserve legacy v2 lost-ack recovery without granting the date-based command
-- authority over any manual report. Terminal receipts are resolved before
-- current role checks; new writes still require the current Owner.
create or replace function public.delete_sd_itinerary_daily_reports(
  p_workspace_key text,
  p_actor_user_id text,
  p_operation_id uuid,
  p_expected_set_token text,
  p_delete_dates jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor jsonb;
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
  where workspace.workspace_key = p_workspace_key
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

  v_actor := public.sd_itinerary_main_actor(p_workspace_key, p_actor_user_id);
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

-- Complete the function-hardening cutover for surviving baseline helpers.
alter function public.sd_itinerary_daily_date_valid(text) set search_path = '';
alter function public.sd_build_daily_itinerary_report_snapshot(uuid,date,timestamptz) set search_path = '';
alter function public.ship_dynamics_run_daily_itinerary_reports() set search_path = '';

revoke all on function public.sd_itinerary_daily_report_list(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.sd_itinerary_daily_report_list(text,text,integer,integer) to anon, authenticated;
revoke all on function public.sd_itinerary_daily_report_locate(text,date,text,integer) from public, anon, authenticated;
grant execute on function public.sd_itinerary_daily_report_locate(text,date,text,integer) to anon, authenticated;
revoke all on function public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb) to anon, authenticated;

comment on function public.sd_itinerary_daily_report_list(text,text,integer,integer) is
  'Legacy client surface: scheduled daily Itinerary reports only; maximum 30 rows per page.';
comment on function public.sd_itinerary_daily_report_locate(text,date,text,integer) is
  'Legacy client surface: locate scheduled daily Itinerary reports only.';
comment on function public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb) is
  'Legacy v2 recovery surface: Owner-only, status-first, scheduled reports only; never deletes manual snapshots.';

commit;

begin;

-- Upgrade safety: an earlier handoff preview used these signatures. PostgreSQL
-- treats the paged/token variants as overloads, so remove the obsolete entry
-- points explicitly without touching any report data.
drop function if exists public.sd_itinerary_daily_report_list(text,text);
drop function if exists public.delete_sd_itinerary_daily_reports(text,text,uuid,jsonb,jsonb);

-- Daily Itinerary reports are intentionally isolated from AppData.agendaReports.
-- A full fleet snapshot can be large; loading only metadata keeps the ordinary
-- AppData bootstrap and save paths bounded.
create table if not exists public.sd_itinerary_daily_reports (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  business_date date not null,
  timezone text not null default 'Asia/Taipei' check (timezone = 'Asia/Taipei'),
  generated_at timestamptz not null,
  generated_by text not null default 'scheduled' check (generated_by = 'scheduled'),
  vessel_count integer not null check (vessel_count >= 0),
  row_count integer not null check (row_count >= 0),
  source_max_revision bigint not null check (source_max_revision >= 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, business_date)
);

create index if not exists sd_itinerary_daily_reports_workspace_date_idx
  on public.sd_itinerary_daily_reports(workspace_id, business_date desc);

alter table public.sd_itinerary_daily_reports enable row level security;
revoke all on table public.sd_itinerary_daily_reports from public, anon, authenticated;

create table if not exists public.sd_itinerary_daily_report_operations (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  operation_id uuid not null,
  actor_user_id text not null,
  command_type text not null check (command_type = 'delete_daily_itinerary_reports'),
  request_payload jsonb not null,
  status text not null check (status in ('STARTED', 'COMMITTED', 'REJECTED')),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (workspace_id, operation_id)
);

alter table public.sd_itinerary_daily_report_operations enable row level security;
revoke all on table public.sd_itinerary_daily_report_operations from public, anon, authenticated;

create or replace function public.sd_itinerary_daily_date_valid(p_value text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  parsed date;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;
  parsed := p_value::date;
  return parsed::text = p_value;
exception when others then
  return false;
end;
$$;

create or replace function public.sd_build_daily_itinerary_report_snapshot(
  p_workspace_id uuid,
  p_business_date date,
  p_generated_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  vessel_rows jsonb := '[]'::jsonb;
  vessel_total integer := 0;
  itinerary_row_total integer := 0;
  max_revision bigint := 0;
begin
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'vesselId', fleet.vessel_id,
      'vesselName', fleet.vessel_name,
      'revision', fleet.revision,
      'updatedAt', fleet.updated_at,
      'rows', fleet.rows_payload
    ) order by fleet.vessel_name, fleet.vessel_id), '[]'::jsonb),
    count(*)::integer,
    coalesce(sum(jsonb_array_length(fleet.rows_payload)), 0)::integer,
    coalesce(max(fleet.revision), 0)::bigint
  into vessel_rows, vessel_total, itinerary_row_total, max_revision
  from (
    select
      vessel.id as vessel_id,
      vessel.name as vessel_name,
      coalesce(document.revision, 0)::bigint as revision,
      document.updated_at,
      case
        when jsonb_typeof(document.rows_payload) = 'array' then document.rows_payload
        else '[]'::jsonb
      end as rows_payload
    from public.sd_vessels vessel
    left join public.sd_itinerary_documents document
      on document.workspace_id = vessel.workspace_id
     and document.vessel_id = vessel.id
    where vessel.workspace_id = p_workspace_id
      and vessel.is_active
  ) fleet;

  return jsonb_build_object(
    'schemaVersion', 1,
    'businessDate', p_business_date::text,
    'timezone', 'Asia/Taipei',
    'generatedAt', p_generated_at,
    'vesselCount', vessel_total,
    'rowCount', itinerary_row_total,
    'sourceMaxRevision', max_revision,
    'vessels', vessel_rows
  );
end;
$$;

create or replace function public.sd_generate_daily_itinerary_report(
  p_workspace_id uuid,
  p_business_date date,
  p_generated_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  report_row public.sd_itinerary_daily_reports%rowtype;
  report_snapshot jsonb;
  inserted boolean := false;
begin
  if p_workspace_id is null or p_business_date is null or p_generated_at is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':daily-itinerary-report', 0));

  select * into report_row
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = p_workspace_id
    and report.business_date = p_business_date;

  if not found then
    report_snapshot := public.sd_build_daily_itinerary_report_snapshot(
      p_workspace_id,
      p_business_date,
      p_generated_at
    );

    insert into public.sd_itinerary_daily_reports(
      workspace_id, business_date, timezone, generated_at, generated_by,
      vessel_count, row_count, source_max_revision, snapshot
    ) values (
      p_workspace_id,
      p_business_date,
      'Asia/Taipei',
      p_generated_at,
      'scheduled',
      (report_snapshot ->> 'vesselCount')::integer,
      (report_snapshot ->> 'rowCount')::integer,
      (report_snapshot ->> 'sourceMaxRevision')::bigint,
      report_snapshot
    )
    on conflict (workspace_id, business_date) do nothing
    returning * into report_row;
    inserted := found;

    if not inserted then
      select * into report_row
      from public.sd_itinerary_daily_reports report
      where report.workspace_id = p_workspace_id
        and report.business_date = p_business_date;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', inserted,
    'report', jsonb_build_object(
      'businessDate', report_row.business_date::text,
      'timezone', report_row.timezone,
      'generatedAt', report_row.generated_at,
      'generatedBy', report_row.generated_by,
      'vesselCount', report_row.vessel_count,
      'rowCount', report_row.row_count,
      'sourceMaxRevision', report_row.source_max_revision,
      'logicalBytes', pg_column_size(report_row.snapshot)
    )
  );
end;
$$;

create or replace function public.ship_dynamics_run_daily_itinerary_reports()
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  generated_at timestamptz := clock_timestamp();
  business_date date := (generated_at at time zone 'Asia/Taipei')::date;
  workspace_row record;
  result_row jsonb;
  created_count integer := 0;
  existing_count integer := 0;
  failed_count integer := 0;
  failures jsonb := '[]'::jsonb;
begin
  for workspace_row in
    select workspace.id
    from public.sd_workspaces workspace
    where workspace.is_active
    order by workspace.id
  loop
    begin
      result_row := public.sd_generate_daily_itinerary_report(
        workspace_row.id,
        business_date,
        generated_at
      );
      if coalesce((result_row ->> 'created')::boolean, false) then
        created_count := created_count + 1;
      else
        existing_count := existing_count + 1;
      end if;
    exception when others then
      failed_count := failed_count + 1;
      failures := failures || jsonb_build_array(jsonb_build_object(
        'workspaceId', workspace_row.id,
        'sqlstate', sqlstate
      ));
    end;
  end loop;

  return jsonb_build_object(
    'ok', failed_count = 0,
    'businessDate', business_date::text,
    'timezone', 'Asia/Taipei',
    'generatedAt', generated_at,
    'createdCount', created_count,
    'existingCount', existing_count,
    'failedCount', failed_count,
    'failures', failures
  );
end;
$$;

create or replace function public.sd_itinerary_daily_report_set_token(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select md5(coalesce(string_agg(
    report.business_date::text || ':' || extract(epoch from report.generated_at)::text,
    '|' order by report.business_date, report.generated_at
  ), ''))
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = p_workspace_id
$$;

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
set search_path = pg_catalog, public
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
  where report.workspace_id = v_workspace_id;
  v_page_count := greatest(1, ceil(v_total::numeric / v_page_size)::integer);
  v_page := least(v_page, v_page_count);

  select coalesce(jsonb_agg(jsonb_build_object(
    'businessDate', report.business_date::text,
    'timezone', report.timezone,
    'generatedAt', report.generated_at,
    'generatedBy', report.generated_by,
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
set search_path = pg_catalog, public
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

  select count(*) into v_preceding
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

create or replace function public.sd_itinerary_daily_report_load(
  p_workspace_key text,
  p_business_date date,
  p_actor_user_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_main_actor(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role text := lower(btrim(coalesce(v_actor ->> 'role', '')));
  report_row public.sd_itinerary_daily_reports%rowtype;
begin
  if v_workspace_id is null or v_actor_role not in ('owner', 'admin', 'operator', 'vessel') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_business_date is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  select * into report_row
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.business_date = p_business_date;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'REPORT_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'report', jsonb_build_object(
      'businessDate', report_row.business_date::text,
      'timezone', report_row.timezone,
      'generatedAt', report_row.generated_at,
      'generatedBy', report_row.generated_by,
      'vesselCount', report_row.vessel_count,
      'rowCount', report_row.row_count,
      'sourceMaxRevision', report_row.source_max_revision,
      'logicalBytes', pg_column_size(report_row.snapshot),
      'snapshot', report_row.snapshot
    )
  );
end;
$$;

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
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_main_actor(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role text := lower(btrim(coalesce(v_actor ->> 'role', '')));
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
  if v_workspace_id is null then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_actor_role is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'error', 'OWNER_REQUIRED');
  end if;
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

  if delete_count <> delete_distinct_count
    or delete_count > 100 then
    return jsonb_build_object(
      'ok', false,
      'error', case when delete_count > 100 then 'BATCH_LIMIT_EXCEEDED' else 'INVALID_PAYLOAD' end
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':daily-itinerary-report', 0));

  request_payload := jsonb_build_object(
    'expectedSetToken', p_expected_set_token,
    'deleteDates', normalized_delete
  );

  insert into public.sd_itinerary_daily_report_operations(
    workspace_id, operation_id, actor_user_id, command_type, request_payload, status
  ) values (
    v_workspace_id, p_operation_id, p_actor_user_id,
    'delete_daily_itinerary_reports', request_payload, 'STARTED'
  ) on conflict (workspace_id, operation_id) do nothing;

  select * into operation_row
  from public.sd_itinerary_daily_report_operations operation
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id
  for update;

  if operation_row.actor_user_id <> p_actor_user_id
    or operation_row.command_type <> 'delete_daily_itinerary_reports'
    or operation_row.request_payload is distinct from request_payload then
    return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_MISMATCH');
  end if;
  if operation_row.status in ('COMMITTED', 'REJECTED') then
    return operation_row.result;
  end if;

  select count(*)::integer
  into current_count
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
    from jsonb_array_elements_text(normalized_delete) selected(date_text)
    where not exists (
      select 1 from public.sd_itinerary_daily_reports report
      where report.workspace_id = v_workspace_id
        and report.business_date = selected.date_text::date
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

revoke all on function public.sd_itinerary_daily_date_valid(text) from public, anon, authenticated;
revoke all on function public.sd_build_daily_itinerary_report_snapshot(uuid,date,timestamptz) from public, anon, authenticated;
revoke all on function public.sd_generate_daily_itinerary_report(uuid,date,timestamptz) from public, anon, authenticated;
revoke all on function public.ship_dynamics_run_daily_itinerary_reports() from public, anon, authenticated;
grant execute on function public.ship_dynamics_run_daily_itinerary_reports() to service_role;

revoke all on function public.sd_itinerary_daily_report_set_token(uuid) from public, anon, authenticated;

revoke all on function public.sd_itinerary_daily_report_list(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.sd_itinerary_daily_report_list(text,text,integer,integer) to anon, authenticated;

revoke all on function public.sd_itinerary_daily_report_locate(text,date,text,integer) from public, anon, authenticated;
grant execute on function public.sd_itinerary_daily_report_locate(text,date,text,integer) to anon, authenticated;

revoke all on function public.sd_itinerary_daily_report_load(text,date,text) from public, anon, authenticated;
grant execute on function public.sd_itinerary_daily_report_load(text,date,text) to anon, authenticated;

revoke all on function public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb) to anon, authenticated;

create extension if not exists pg_cron with schema extensions;
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'ship-dynamics-daily-itinerary-0900-taipei';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'ship-dynamics-daily-itinerary-0900-taipei',
    '0 1 * * *',
    'select public.ship_dynamics_run_daily_itinerary_reports();'
  );
end;
$$;

commit;

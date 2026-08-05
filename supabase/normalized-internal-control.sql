begin;

-- Internal-control aggregate slice. Apply after normalized-schema.sql.
-- The canonical case/task relationship lives only in
-- sd_internal_case_task_links; neither aggregate stores a reciprocal id.

alter table public.sd_tasks
  add column if not exists category text not null default '',
  add column if not exists equipment_subcategory text,
  add column if not exists internal_control_cancelled_at timestamptz,
  add column if not exists internal_control_cancelled_by uuid references auth.users(id);

alter table public.sd_tasks
  add constraint sd_tasks_internal_control_cancellation_consistent check (
    (
      internal_control_cancelled_at is null
      and internal_control_cancelled_by is null
    )
    or (
      not is_internal_control
      and internal_control_cancelled_at is not null
      and internal_control_cancelled_by is not null
    )
  );

create table public.sd_internal_cases (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  id text not null,
  vessel_id text not null,
  report_date date not null,
  report_source text not null check (report_source in ('日常', '訪船', '隨船', '外部')),
  description text not null,
  priority text not null check (priority in ('急', '高', '中', '低')),
  category text not null,
  equipment_subcategory text,
  is_aware boolean not null default false,
  status text not null,
  origin text not null check (origin in ('internal-control', 'task')),
  is_closed boolean not null default false,
  closed_date date,
  closed_by uuid references auth.users(id),
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id),
  primary key (workspace_id, id),
  foreign key (workspace_id, vessel_id)
    references public.sd_vessels(workspace_id, id),
  constraint sd_internal_cases_id_not_blank check (btrim(id) <> ''),
  constraint sd_internal_cases_description_not_blank check (btrim(description) <> ''),
  constraint sd_internal_cases_category_not_blank check (btrim(category) <> ''),
  constraint sd_internal_cases_status_not_blank check (btrim(status) <> ''),
  constraint sd_internal_cases_equipment_subcategory_consistent check (
    (category = '設備故障' and btrim(coalesce(equipment_subcategory, '')) <> '')
    or (category <> '設備故障' and equipment_subcategory is null)
  ),
  constraint sd_internal_cases_closure_consistent check (
    (is_closed and closed_date is not null and closed_by is not null)
    or (not is_closed and closed_date is null and closed_by is null)
  ),
  constraint sd_internal_cases_deletion_consistent check (
    (is_deleted and deleted_at is not null and deleted_by is not null)
    or (not is_deleted and deleted_at is null and deleted_by is null)
  ),
  constraint sd_internal_cases_closure_after_report check (
    closed_date is null or closed_date >= report_date
  )
);

create table public.sd_internal_case_departments (
  workspace_id uuid not null,
  case_id text not null,
  department text not null,
  ordinal integer not null check (ordinal >= 0),
  primary key (workspace_id, case_id, department),
  unique (workspace_id, case_id, ordinal),
  foreign key (workspace_id, case_id)
    references public.sd_internal_cases(workspace_id, id) on delete cascade,
  constraint sd_internal_case_departments_not_blank check (btrim(department) <> '')
);

create table public.sd_internal_case_status_events (
  workspace_id uuid not null,
  id uuid not null,
  case_id text not null,
  event_kind text not null check (
    event_kind in (
      'created', 'updated', 'closed', 'reopened', 'linked', 'unlinked',
      'cancelled', 'linked_task_deleted', 'deleted'
    )
  ),
  status text not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, id),
  foreign key (workspace_id, case_id)
    references public.sd_internal_cases(workspace_id, id) on delete cascade,
  constraint sd_internal_case_status_events_status_not_blank check (btrim(status) <> '')
);

create table public.sd_internal_case_task_links (
  workspace_id uuid not null,
  case_id text not null,
  task_id text not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  primary key (workspace_id, case_id),
  unique (workspace_id, task_id),
  foreign key (workspace_id, case_id)
    references public.sd_internal_cases(workspace_id, id) on delete cascade,
  foreign key (workspace_id, task_id)
    references public.sd_tasks(workspace_id, id) on delete restrict,
  constraint sd_internal_case_task_links_case_not_blank check (btrim(case_id) <> ''),
  constraint sd_internal_case_task_links_task_not_blank check (btrim(task_id) <> '')
);

-- Shared task categories, departments, and owners are owned by
-- normalized-core-domain.sql; internal-case commands only update them.

create index sd_internal_cases_vessel_idx
  on public.sd_internal_cases(workspace_id, vessel_id, is_closed);
create index sd_internal_case_status_events_case_idx
  on public.sd_internal_case_status_events(workspace_id, case_id, created_at, id);
create index sd_internal_case_links_task_idx
  on public.sd_internal_case_task_links(workspace_id, task_id);

alter table public.sd_internal_cases enable row level security;
alter table public.sd_internal_case_departments enable row level security;
alter table public.sd_internal_case_status_events enable row level security;
alter table public.sd_internal_case_task_links enable row level security;

revoke all on table public.sd_internal_cases from anon, authenticated;
revoke all on table public.sd_internal_case_departments from anon, authenticated;
revoke all on table public.sd_internal_case_status_events from anon, authenticated;
revoke all on table public.sd_internal_case_task_links from anon, authenticated;

grant select on table public.sd_internal_cases to authenticated;
grant select on table public.sd_internal_case_departments to authenticated;
grant select on table public.sd_internal_case_status_events to authenticated;
grant select on table public.sd_internal_case_task_links to authenticated;

create or replace function public.sd_can_read_task(
  p_workspace_id uuid,
  p_task_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_task public.sd_tasks%rowtype;
  v_scope_count integer;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_role is null then return false; end if;

  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id;
  if not found then return false; end if;
  if v_task.is_deleted then return false; end if;

  if v_role = 'vessel' then
    if v_task.is_internal_control
       or v_task.internal_control_cancelled_at is not null
       or v_task.internal_control_cancelled_by is not null
       or v_task.source_kind <> 'ordinary' then
      return false;
    end if;
    select count(*) into v_scope_count
    from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id
      and tv.task_id = p_task_id
      and tv.is_active_scope;
    if v_scope_count <> 1 then return false; end if;
    return exists (
      select 1
      from public.sd_task_vessels tv
      join public.sd_vessel_assignments a
        on a.workspace_id = tv.workspace_id
       and a.vessel_id = tv.vessel_id
       and a.user_id = auth.uid()
       and a.assignment_kind = 'vessel_account'
       and a.is_active
      where tv.workspace_id = p_workspace_id
        and tv.task_id = p_task_id
        and tv.is_active_scope
    );
  end if;

  if v_role in ('owner', 'admin')
     or public.sd_has_permission(p_workspace_id, 'viewAllVessels') then
    return true;
  end if;
  return exists (
    select 1
    from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id
      and tv.task_id = p_task_id
      and tv.is_active_scope
  ) and not exists (
    select 1
    from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id
      and tv.task_id = p_task_id
      and tv.is_active_scope
      and not public.sd_can_read_vessel(p_workspace_id, tv.vessel_id)
  );
end;
$$;

create function public.sd_can_read_internal_case(
  p_workspace_id uuid,
  p_case_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_vessel_id text;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_role is null or v_role = 'vessel' then return false; end if;

  select c.vessel_id into v_vessel_id
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and not c.is_deleted;
  if not found then return false; end if;

  if v_role in ('owner', 'admin') then return true; end if;
  return public.sd_can_read_vessel(p_workspace_id, v_vessel_id);
end;
$$;

create function public.sd_can_mutate_internal_vessel(
  p_workspace_id uuid,
  p_vessel_id text,
  p_permission_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_role is null
     or v_role = 'vessel'
     or not public.sd_has_permission(p_workspace_id, p_permission_key) then
    return false;
  end if;
  if not exists (
    select 1
    from public.sd_vessels v
    where v.workspace_id = p_workspace_id
      and v.id = p_vessel_id
      and v.is_active
  ) then
    return false;
  end if;
  if v_role in ('owner', 'admin') then return true; end if;
  return v_role = 'operator' and exists (
    select 1
    from public.sd_vessel_assignments a
    where a.workspace_id = p_workspace_id
      and a.vessel_id = p_vessel_id
      and a.user_id = auth.uid()
      and a.assignment_kind in ('manager', 'delegate')
      and a.is_active
  );
end;
$$;

create function public.sd_can_edit_internal_case(
  p_workspace_id uuid,
  p_case_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_vessel_id text;
  v_is_deleted boolean;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_role is null or v_role = 'vessel' then return false; end if;
  select c.vessel_id, c.is_deleted into v_vessel_id, v_is_deleted
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id and c.id = p_case_id;
  if found then
    if v_is_deleted then return false; end if;
    return public.sd_can_mutate_internal_vessel(
      p_workspace_id,
      v_vessel_id,
      'editBusinessContent'
    );
  end if;
  return false;
end;
$$;

create function public.sd_can_maintain_internal_case_lease(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case p_entity_type
    when 'internal-case' then public.sd_can_edit_internal_case(
      p_workspace_id,
      p_entity_id
    )
    when 'internal-case-create' then public.sd_can_mutate_internal_vessel(
      p_workspace_id,
      p_entity_id,
      'createTasks'
    )
    else true
  end
$$;

create policy sd_internal_cases_read on public.sd_internal_cases
  for select to authenticated
  using (public.sd_can_read_internal_case(workspace_id, id));

create policy sd_internal_case_departments_read
  on public.sd_internal_case_departments
  for select to authenticated
  using (public.sd_can_read_internal_case(workspace_id, case_id));

create policy sd_internal_case_status_events_read
  on public.sd_internal_case_status_events
  for select to authenticated
  using (public.sd_can_read_internal_case(workspace_id, case_id));

create policy sd_internal_case_task_links_read
  on public.sd_internal_case_task_links
  for select to authenticated
  using (
    public.sd_can_read_internal_case(workspace_id, case_id)
    and public.sd_can_read_task(workspace_id, task_id)
  );

create function public.sd_internal_assert_actor(
  p_workspace_id uuid,
  p_permission_key text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  v_role := public.sd_membership_role(p_workspace_id);
  if v_role is null
     or v_role = 'vessel'
     or not public.sd_has_permission(p_workspace_id, p_permission_key) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  return v_role;
end;
$$;

create function public.sd_internal_iso_date(
  p_value text,
  p_required boolean default true
)
returns date
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_date date;
begin
  if btrim(coalesce(p_value, '')) = '' then
    if p_required then
      raise exception using errcode = 'P0001', message = 'invalid-case';
    end if;
    return null;
  end if;
  if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
  begin
    v_date := p_value::date;
  exception when others then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end;
  if to_char(v_date, 'YYYY-MM-DD') <> p_value then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
  return v_date;
end;
$$;

create function public.sd_internal_json_text_array(
  p_payload jsonb,
  p_key text,
  p_required boolean default false
)
returns text[]
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_values text[];
begin
  if not (p_payload ? p_key) then
    if p_required then
      raise exception using errcode = 'P0001', message = 'invalid-case';
    end if;
    return '{}'::text[];
  end if;
  if jsonb_typeof(p_payload -> p_key) <> 'array'
     or exists (
       select 1
       from jsonb_array_elements(p_payload -> p_key) value
       where jsonb_typeof(value) <> 'string'
     ) then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
  select coalesce(array_agg(btrim(value) order by ordinal), '{}'::text[])
    into v_values
  from jsonb_array_elements_text(p_payload -> p_key)
       with ordinality item(value, ordinal);
  if (p_required and cardinality(v_values) = 0)
     or exists (select 1 from unnest(v_values) value where value = '')
     or cardinality(v_values) <> (
       select count(distinct value)
       from unnest(v_values) value
     ) then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
  return v_values;
end;
$$;

create function public.sd_internal_json_uuid_array(
  p_payload jsonb,
  p_key text
)
returns uuid[]
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_text_values text[];
  v_values uuid[] := '{}'::uuid[];
  v_value text;
begin
  v_text_values := public.sd_internal_json_text_array(p_payload, p_key, false);
  foreach v_value in array v_text_values loop
    begin
      v_values := array_append(v_values, v_value::uuid);
    exception when others then
      raise exception using errcode = 'P0001', message = 'invalid-task-metadata';
    end;
  end loop;
  return v_values;
end;
$$;

create function public.sd_internal_validate_case_payload(p_case jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_report_date date;
  v_closed_date date;
begin
  if p_case is null or jsonb_typeof(p_case) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_case) key
    where key not in (
      'vesselId', 'reportDate', 'reportSource', 'description', 'priority',
      'category', 'equipmentSubcategory', 'isAware', 'status', 'origin',
      'isClosed', 'closedDate', 'departments'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
  if btrim(coalesce(p_case ->> 'vesselId', '')) = ''
     or btrim(coalesce(p_case ->> 'description', '')) = ''
     or btrim(coalesce(p_case ->> 'category', '')) = ''
     or btrim(coalesce(p_case ->> 'status', '')) = ''
     or p_case ->> 'reportSource' not in ('日常', '訪船', '隨船', '外部')
     or p_case ->> 'priority' not in ('急', '高', '中', '低')
     or p_case ->> 'origin' not in ('internal-control', 'task')
     or jsonb_typeof(p_case -> 'isAware') <> 'boolean'
     or jsonb_typeof(p_case -> 'isClosed') <> 'boolean' then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
  if (
    p_case ->> 'category' = '設備故障'
    and btrim(coalesce(p_case ->> 'equipmentSubcategory', '')) = ''
  ) or (
    p_case ->> 'category' <> '設備故障'
    and p_case ? 'equipmentSubcategory'
    and nullif(btrim(coalesce(p_case ->> 'equipmentSubcategory', '')), '') is not null
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
  perform public.sd_internal_json_text_array(p_case, 'departments', false);
  v_report_date := public.sd_internal_iso_date(p_case ->> 'reportDate', true);
  if (p_case ->> 'isClosed')::boolean then
    v_closed_date := public.sd_internal_iso_date(p_case ->> 'closedDate', false);
    if v_closed_date is not null and v_closed_date < v_report_date then
      raise exception using errcode = 'P0001', message = 'invalid-case';
    end if;
  elsif p_case ? 'closedDate' then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
end;
$$;

create function public.sd_internal_validate_task_payload(
  p_workspace_id uuid,
  p_vessel_id text,
  p_task jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_categories text[];
  v_owner_ids uuid[];
begin
  if p_task is null or jsonb_typeof(p_task) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid-task-metadata';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_task) key
    where key not in ('id', 'expectedDate', 'categories', 'ownerUserIds')
  ) or btrim(coalesce(p_task ->> 'id', '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-task-metadata';
  end if;
  if btrim(coalesce(p_task ->> 'expectedDate', '')) <> '' then
    perform public.sd_internal_iso_date(p_task ->> 'expectedDate', false);
  end if;
  v_categories := public.sd_internal_json_text_array(p_task, 'categories', true);
  v_owner_ids := public.sd_internal_json_uuid_array(p_task, 'ownerUserIds');
  if exists (
    select 1
    from unnest(v_owner_ids) owner_id
    where not exists (
      select 1
      from public.sd_memberships m
      where m.workspace_id = p_workspace_id
        and m.user_id = owner_id
        and m.is_active
        and m.role <> 'vessel'
        and (
          m.role in ('owner', 'admin')
          or exists (
            select 1
            from public.sd_vessel_assignments a
            where a.workspace_id = p_workspace_id
              and a.vessel_id = p_vessel_id
              and a.user_id = owner_id
              and a.assignment_kind in ('manager', 'delegate')
              and a.is_active
          )
          or exists (
            select 1
            from public.sd_role_permissions rp
            where rp.workspace_id = p_workspace_id
              and rp.role = m.role
              and rp.permission_key = 'viewAllVessels'
              and rp.enabled
          )
        )
    )
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-task-owner';
  end if;
end;
$$;

create function public.sd_internal_assert_ordered_leases(
  p_workspace_id uuid,
  p_case_id text,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_task_id text,
  p_task_lease_key text,
  p_task_owner_session uuid,
  p_task_fencing_token bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lease record;
begin
  if p_case_id is null then
    if p_case_lease_key is not null
       or p_case_owner_session is not null
       or p_case_fencing_token is not null then
      raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
    end if;
  elsif p_case_lease_key is distinct from 'internal-case:' || p_case_id
        or p_case_owner_session is null
        or p_case_fencing_token is null then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;

  if p_task_id is null then
    if p_task_lease_key is not null
       or p_task_owner_session is not null
       or p_task_fencing_token is not null then
      raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
    end if;
  elsif p_task_lease_key is distinct from 'task:' || p_task_id
        or p_task_owner_session is null
        or p_task_fencing_token is null then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;

  if p_case_id is null and p_task_id is null then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;

  for v_lease in
    select lease_key, owner_session, fencing_token
    from (
      values
        (p_case_lease_key, p_case_owner_session, p_case_fencing_token),
        (p_task_lease_key, p_task_owner_session, p_task_fencing_token)
    ) leases(lease_key, owner_session, fencing_token)
    where lease_key is not null
    order by lease_key
  loop
    perform public.sd_assert_live_lease(
      p_workspace_id,
      v_lease.lease_key,
      v_lease.owner_session,
      v_lease.fencing_token
    );
  end loop;
end;
$$;

create function public.sd_internal_assert_ordered_create_leases(
  p_workspace_id uuid,
  p_vessel_id text,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_task_id text,
  p_task_lease_key text,
  p_task_owner_session uuid,
  p_task_fencing_token bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lease record;
begin
  if p_case_lease_key is distinct from 'internal-case-create:' || p_vessel_id
     or p_case_owner_session is null
     or p_case_fencing_token is null then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;

  if p_task_id is null then
    if p_task_lease_key is not null
       or p_task_owner_session is not null
       or p_task_fencing_token is not null then
      raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
    end if;
  elsif p_task_lease_key is distinct from 'task:' || p_task_id
        or p_task_owner_session is null
        or p_task_fencing_token is null then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;

  for v_lease in
    select lease_key, owner_session, fencing_token
    from (
      values
        (p_case_lease_key, p_case_owner_session, p_case_fencing_token),
        (p_task_lease_key, p_task_owner_session, p_task_fencing_token)
    ) leases(lease_key, owner_session, fencing_token)
    where lease_key is not null
    order by lease_key
  loop
    perform public.sd_assert_live_lease(
      p_workspace_id,
      v_lease.lease_key,
      v_lease.owner_session,
      v_lease.fencing_token
    );
  end loop;
end;
$$;

create function public.sd_internal_operation_replay(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_command text,
  p_target_key text,
  p_request jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operation public.sd_operations%rowtype;
begin
  if p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'invalid-operation';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0)
  );
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
  for update;
  if not found then return null; end if;
  if v_operation.actor_id is distinct from auth.uid()
     or v_operation.command <> p_command
     or v_operation.target_key <> p_target_key
     or v_operation.request_payload <> p_request then
    raise exception using errcode = 'P0001', message = 'operation-mismatch';
  end if;
  if v_operation.status <> 'committed' then
    raise exception using
      errcode = 'P0001',
      message = coalesce(v_operation.error_code, 'operation-rejected');
  end if;
  return v_operation.result || jsonb_build_object('replayed', true);
end;
$$;

create function public.sd_internal_record_operation(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_command text,
  p_target_key text,
  p_request jsonb,
  p_base_versions jsonb,
  p_lease_provenance jsonb,
  p_result jsonb,
  p_entity_type text,
  p_entity_id text,
  p_detail jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.sd_operations(
    workspace_id, operation_id, actor_id, command, target_key,
    request_payload, request_hash, base_versions, lease_provenance,
    status, result
  ) values (
    p_workspace_id, p_operation_id, auth.uid(), p_command, p_target_key,
    p_request, md5(p_request::text), coalesce(p_base_versions, '{}'::jsonb),
    coalesce(p_lease_provenance, '{}'::jsonb), 'committed', p_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, p_operation_id, auth.uid(), p_command,
    p_entity_type, p_entity_id, coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

create function public.sd_internal_replace_case_departments(
  p_workspace_id uuid,
  p_case_id text,
  p_departments text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.sd_internal_case_departments d
  where d.workspace_id = p_workspace_id and d.case_id = p_case_id;
  insert into public.sd_internal_case_departments(
    workspace_id, case_id, department, ordinal
  )
  select p_workspace_id, p_case_id, department, ordinal::integer - 1
  from unnest(p_departments) with ordinality item(department, ordinal);
end;
$$;

create function public.sd_internal_replace_task_departments(
  p_workspace_id uuid,
  p_task_id text,
  p_departments text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.sd_task_departments d
  where d.workspace_id = p_workspace_id and d.task_id = p_task_id;
  insert into public.sd_task_departments(
    workspace_id, task_id, department, ordinal
  )
  select p_workspace_id, p_task_id, department, ordinal::integer - 1
  from unnest(p_departments) with ordinality item(department, ordinal);
end;
$$;

create function public.sd_internal_replace_task_categories(
  p_workspace_id uuid,
  p_task_id text,
  p_categories text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.sd_task_categories c
  where c.workspace_id = p_workspace_id and c.task_id = p_task_id;
  insert into public.sd_task_categories(
    workspace_id, task_id, category, ordinal
  )
  select p_workspace_id, p_task_id, category, ordinal::integer - 1
  from unnest(p_categories) with ordinality item(category, ordinal);
end;
$$;

create function public.sd_internal_replace_task_owners(
  p_workspace_id uuid,
  p_task_id text,
  p_owner_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.sd_task_owners o
  where o.workspace_id = p_workspace_id and o.task_id = p_task_id;
  insert into public.sd_task_owners(
    workspace_id, task_id, owner_id, ordinal
  )
  select p_workspace_id, p_task_id, owner_id, ordinal::integer - 1
  from unnest(p_owner_ids) with ordinality item(owner_id, ordinal);
end;
$$;

create or replace function public.claim_ship_dynamics_entity_lease(
  p_workspace_id uuid,
  p_lease_key text,
  p_entity_type text,
  p_entity_id text,
  p_owner_session uuid,
  p_ttl_seconds integer default 75
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_now timestamptz := clock_timestamp();
  v_lease public.sd_edit_leases%rowtype;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_actor is null or v_role is null then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_owner_session is null then
    raise exception using errcode = 'P0001', message = 'invalid-owner-session';
  end if;

  if p_entity_type = 'task' then
    if p_lease_key <> 'task:' || p_entity_id
       or not public.sd_can_edit_task(p_workspace_id, p_entity_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'task-create' then
    if p_lease_key <> 'task-create:' || p_entity_id
       or not public.sd_can_create_task_for_vessel(p_workspace_id, p_entity_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'vessel' then
    if p_lease_key <> 'vessel:' || p_entity_id
       or not public.sd_can_edit_vessel(p_workspace_id, p_entity_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'internal-case' then
    if v_role = 'vessel'
       or p_lease_key <> 'internal-case:' || p_entity_id
       or not public.sd_can_edit_internal_case(p_workspace_id, p_entity_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'internal-case-create' then
    if p_lease_key <> 'internal-case-create:' || p_entity_id
       or not public.sd_can_mutate_internal_vessel(
         p_workspace_id, p_entity_id, 'createTasks'
       ) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'internal-task' then
    if v_role = 'vessel' or p_lease_key <> 'task:' || p_entity_id then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
    if exists (
      select 1
      from public.sd_tasks t
      where t.workspace_id = p_workspace_id and t.id = p_entity_id
    ) then
      if not public.sd_can_edit_task(p_workspace_id, p_entity_id)
         or exists (
           select 1
           from public.sd_tasks t
           where t.workspace_id = p_workspace_id
             and t.id = p_entity_id
             and t.source_kind <> 'ordinary'
         ) then
        raise exception using errcode = 'P0001', message = 'not-authorized';
      end if;
    elsif not public.sd_has_permission(p_workspace_id, 'createTasks') then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'unsupported-entity-type';
  end if;

  insert into public.sd_edit_leases(
    workspace_id, lease_key, entity_type, entity_id,
    owner_id, owner_session, fencing_token, expires_at, updated_at
  ) values (
    p_workspace_id, p_lease_key, p_entity_type, p_entity_id,
    v_actor, p_owner_session, 1,
    v_now + make_interval(secs => least(greatest(p_ttl_seconds, 30), 300)),
    v_now
  )
  on conflict (workspace_id, lease_key) do update
    set entity_type = excluded.entity_type,
        entity_id = excluded.entity_id,
        owner_id = excluded.owner_id,
        owner_session = excluded.owner_session,
        fencing_token = case
          when public.sd_edit_leases.owner_id = excluded.owner_id
           and public.sd_edit_leases.owner_session = excluded.owner_session
           and public.sd_edit_leases.expires_at > v_now
          then public.sd_edit_leases.fencing_token
          else public.sd_edit_leases.fencing_token + 1
        end,
        expires_at = excluded.expires_at,
        updated_at = v_now
    where public.sd_edit_leases.expires_at is null
       or public.sd_edit_leases.expires_at <= v_now
       or (
         public.sd_edit_leases.owner_id = excluded.owner_id
         and public.sd_edit_leases.owner_session = excluded.owner_session
       )
  returning * into v_lease;

  if v_lease.workspace_id is null then
    select * into v_lease
    from public.sd_edit_leases l
    where l.workspace_id = p_workspace_id and l.lease_key = p_lease_key;
    return jsonb_build_object(
      'ok', false,
      'leaseKey', p_lease_key,
      'expiresAt', v_lease.expires_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'leaseKey', v_lease.lease_key,
    'ownerSession', v_lease.owner_session,
    'fencingToken', v_lease.fencing_token,
    'expiresAt', v_lease.expires_at
  );
end;
$$;

create or replace function public.renew_ship_dynamics_entity_lease(
  p_workspace_id uuid,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_ttl_seconds integer default 75
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease public.sd_edit_leases%rowtype;
begin
  update public.sd_edit_leases l
  set expires_at = v_now + make_interval(secs => least(greatest(p_ttl_seconds, 30), 300)),
      updated_at = v_now
  where l.workspace_id = p_workspace_id
    and l.lease_key = p_lease_key
    and l.owner_id = auth.uid()
    and l.owner_session = p_owner_session
    and l.fencing_token = p_fencing_token
    and l.expires_at > v_now
    and public.sd_can_maintain_internal_case_lease(
      l.workspace_id, l.entity_type, l.entity_id
    )
  returning * into v_lease;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object(
    'ok', true,
    'leaseKey', v_lease.lease_key,
    'ownerSession', v_lease.owner_session,
    'fencingToken', v_lease.fencing_token,
    'expiresAt', v_lease.expires_at
  );
end;
$$;

create or replace function public.release_ship_dynamics_entity_lease(
  p_workspace_id uuid,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.sd_edit_leases l
  set owner_id = null,
      owner_session = null,
      expires_at = null,
      updated_at = clock_timestamp()
  where l.workspace_id = p_workspace_id
    and l.lease_key = p_lease_key
    and l.owner_id = auth.uid()
    and l.owner_session = p_owner_session
    and l.fencing_token = p_fencing_token
    and public.sd_can_maintain_internal_case_lease(
      l.workspace_id, l.entity_type, l.entity_id
    );
  return found;
end;
$$;

create function public.command_ship_dynamics_create_internal_case(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_case_id text,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_case jsonb,
  p_task jsonb default null,
  p_task_lease_key text default null,
  p_task_owner_session uuid default null,
  p_task_fencing_token bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_vessel_id text;
  v_task_id text;
  v_departments text[];
  v_categories text[];
  v_owner_ids uuid[];
  v_is_closed boolean;
  v_closed_date date;
begin
  perform public.sd_internal_assert_actor(p_workspace_id, 'createTasks');
  if btrim(coalesce(p_case_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
  perform public.sd_internal_validate_case_payload(p_case);
  v_vessel_id := p_case ->> 'vesselId';
  if not public.sd_can_mutate_internal_vessel(
    p_workspace_id,
    v_vessel_id,
    'createTasks'
  ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  v_departments := public.sd_internal_json_text_array(
    p_case,
    'departments',
    p_task is not null
  );
  v_is_closed := (p_case ->> 'isClosed')::boolean;
  if v_is_closed
     and not public.sd_can_mutate_internal_vessel(
       p_workspace_id,
       v_vessel_id,
       'closeTasks'
     ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if v_is_closed then
    v_closed_date := coalesce(
      public.sd_internal_iso_date(p_case ->> 'closedDate', false),
      public.sd_taipei_date(clock_timestamp())
    );
  end if;

  if p_task is not null then
    perform public.sd_internal_validate_task_payload(
      p_workspace_id,
      v_vessel_id,
      p_task
    );
    v_task_id := p_task ->> 'id';
    v_categories := public.sd_internal_json_text_array(
      p_task,
      'categories',
      true
    );
    v_owner_ids := public.sd_internal_json_uuid_array(p_task, 'ownerUserIds');
  end if;

  v_request := jsonb_build_object(
    'caseId', p_case_id,
    'caseLeaseKey', p_case_lease_key,
    'caseOwnerSession', p_case_owner_session,
    'caseFencingToken', p_case_fencing_token,
    'case', p_case,
    'task', p_task,
    'taskLeaseKey', p_task_lease_key,
    'taskOwnerSession', p_task_owner_session,
    'taskFencingToken', p_task_fencing_token
  );
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id,
    p_operation_id,
    'create_internal_case',
    'internal-case:' || p_case_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  perform public.sd_internal_assert_ordered_create_leases(
    p_workspace_id,
    v_vessel_id,
    p_case_lease_key,
    p_case_owner_session,
    p_case_fencing_token,
    v_task_id,
    p_task_lease_key,
    p_task_owner_session,
    p_task_fencing_token
  );

  if exists (
    select 1
    from public.sd_internal_cases c
    where c.workspace_id = p_workspace_id and c.id = p_case_id
  ) then
    raise exception using errcode = '23505', message = 'entity-exists';
  end if;
  if v_task_id is not null and exists (
    select 1
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = v_task_id
  ) then
    raise exception using errcode = '23505', message = 'entity-exists';
  end if;

  insert into public.sd_internal_cases(
    workspace_id, id, vessel_id, report_date, report_source,
    description, priority, category, equipment_subcategory,
    is_aware, status, origin, is_closed, closed_date, closed_by,
    version, created_by, updated_by
  ) values (
    p_workspace_id,
    p_case_id,
    v_vessel_id,
    public.sd_internal_iso_date(p_case ->> 'reportDate', true),
    p_case ->> 'reportSource',
    btrim(p_case ->> 'description'),
    p_case ->> 'priority',
    btrim(p_case ->> 'category'),
    case
      when p_case ->> 'category' = '設備故障'
      then btrim(p_case ->> 'equipmentSubcategory')
      else null
    end,
    (p_case ->> 'isAware')::boolean,
    btrim(p_case ->> 'status'),
    p_case ->> 'origin',
    v_is_closed,
    v_closed_date,
    case when v_is_closed then v_actor else null end,
    1,
    v_actor,
    v_actor
  );
  perform public.sd_internal_replace_case_departments(
    p_workspace_id,
    p_case_id,
    v_departments
  );
  insert into public.sd_internal_case_status_events(
    workspace_id, id, case_id, event_kind, status, actor_id
  ) values (
    p_workspace_id,
    p_operation_id,
    p_case_id,
    'created',
    btrim(p_case ->> 'status'),
    v_actor
  );

  if v_task_id is not null then
    insert into public.sd_tasks(
      workspace_id, id, description, status, priority,
      source_kind, attention_dimension, is_internal_control,
      is_abnormal, is_aware, is_closed, closed_date, closed_by,
      expected_date, report_date, category, equipment_subcategory,
      version, created_by, updated_by
    ) values (
      p_workspace_id,
      v_task_id,
      btrim(p_case ->> 'description'),
      btrim(p_case ->> 'status'),
      p_case ->> 'priority',
      'ordinary',
      'task',
      true,
      true,
      (p_case ->> 'isAware')::boolean,
      v_is_closed,
      v_closed_date,
      case when v_is_closed then v_actor else null end,
      public.sd_internal_iso_date(p_task ->> 'expectedDate', false),
      public.sd_internal_iso_date(p_case ->> 'reportDate', true),
      v_categories[1],
      case
        when '設備故障' = any(v_categories)
        then nullif(btrim(coalesce(p_case ->> 'equipmentSubcategory', '')), '')
        else null
      end,
      1,
      v_actor,
      v_actor
    );
    insert into public.sd_task_vessels(
      workspace_id, task_id, vessel_id, is_active_scope,
      status, is_closed, closed_date, closed_by, version, updated_by
    ) values (
      p_workspace_id,
      v_task_id,
      v_vessel_id,
      true,
      btrim(p_case ->> 'status'),
      v_is_closed,
      v_closed_date,
      case when v_is_closed then v_actor else null end,
      1,
      v_actor
    );
    perform public.sd_internal_replace_task_categories(
      p_workspace_id,
      v_task_id,
      v_categories
    );
    perform public.sd_internal_replace_task_departments(
      p_workspace_id,
      v_task_id,
      v_departments
    );
    perform public.sd_internal_replace_task_owners(
      p_workspace_id,
      v_task_id,
      v_owner_ids
    );
    insert into public.sd_task_status_events(
      workspace_id, id, task_id, status, actor_id
    ) values (
      p_workspace_id,
      p_operation_id,
      v_task_id,
      btrim(p_case ->> 'status'),
      v_actor
    );
    insert into public.sd_internal_case_task_links(
      workspace_id, case_id, task_id, version, created_by
    ) values (
      p_workspace_id,
      p_case_id,
      v_task_id,
      1,
      v_actor
    );
  end if;

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'caseId', p_case_id,
    'caseVersion', 1,
    'taskId', v_task_id,
    'taskVersion', case when v_task_id is null then null else 1 end
  );
  perform public.sd_internal_record_operation(
    p_workspace_id,
    p_operation_id,
    'create_internal_case',
    'internal-case:' || p_case_id,
    v_request,
    '{}'::jsonb,
    jsonb_build_object(
      'case', jsonb_build_object(
        'leaseKey', p_case_lease_key,
        'ownerSession', p_case_owner_session,
        'fencingToken', p_case_fencing_token
      ),
      'task', case
        when v_task_id is null then null
        else jsonb_build_object(
          'leaseKey', p_task_lease_key,
          'ownerSession', p_task_owner_session,
          'fencingToken', p_task_fencing_token
        )
      end
    ),
    v_result,
    'internal-case',
    p_case_id,
    jsonb_build_object(
      'caseVersion', 1,
      'taskId', v_task_id,
      'taskVersion', case when v_task_id is null then null else 1 end
    )
  );
  return v_result;
end;
$$;

create function public.command_ship_dynamics_update_internal_case(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_case_id text,
  p_base_case_version bigint,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_case jsonb,
  p_base_task_version bigint default null,
  p_task_lease_key text default null,
  p_task_owner_session uuid default null,
  p_task_fencing_token bigint default null,
  p_task jsonb default null,
  p_link_action text default 'preserve'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_case public.sd_internal_cases%rowtype;
  v_task public.sd_tasks%rowtype;
  v_linked_task_id text;
  v_current_linked_task_id text;
  v_task_id text;
  v_task_lease_expected text;
  v_departments text[];
  v_categories text[];
  v_owner_ids uuid[];
  v_is_closed boolean;
  v_closed_date date;
  v_case_version bigint;
  v_task_version bigint;
  v_scope_count integer;
  v_event_kind text;
  v_lease record;
  v_reminder constant text :=
    'FLOW reminder: report the abnormality in FLOW before completing internal-control handling.';
begin
  perform public.sd_internal_assert_actor(
    p_workspace_id, 'editBusinessContent'
  );
  if p_link_action not in ('preserve', 'materialize', 'unlink') then
    raise exception using errcode = 'P0001', message = 'invalid-link-action';
  end if;
  if p_link_action = 'materialize' then
    perform public.sd_internal_assert_actor(p_workspace_id, 'createTasks');
  elsif p_link_action = 'unlink' then
    perform public.sd_internal_assert_actor(p_workspace_id, 'closeTasks');
  end if;
  perform public.sd_internal_validate_case_payload(p_case);
  v_departments := public.sd_internal_json_text_array(
    p_case, 'departments', false
  );
  v_is_closed := (p_case ->> 'isClosed')::boolean;
  if v_is_closed then
    perform public.sd_internal_assert_actor(p_workspace_id, 'closeTasks');
    v_closed_date := coalesce(
      public.sd_internal_iso_date(p_case ->> 'closedDate', false),
      public.sd_taipei_date(clock_timestamp())
    );
  end if;

  v_request := jsonb_build_object(
    'caseId', p_case_id,
    'baseCaseVersion', p_base_case_version,
    'caseLeaseKey', p_case_lease_key,
    'caseOwnerSession', p_case_owner_session,
    'caseFencingToken', p_case_fencing_token,
    'case', p_case,
    'baseTaskVersion', p_base_task_version,
    'taskLeaseKey', p_task_lease_key,
    'taskOwnerSession', p_task_owner_session,
    'taskFencingToken', p_task_fencing_token,
    'task', p_task,
    'linkAction', p_link_action
  );
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id,
    p_operation_id,
    'update_internal_case',
    'internal-case:' || p_case_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and not c.is_deleted
    and public.sd_can_mutate_internal_vessel(
      p_workspace_id, c.vessel_id, 'editBusinessContent'
    );
  if not found then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if v_case.is_closed then
    raise exception using errcode = 'P0001', message = 'case-closed';
  end if;
  if not public.sd_can_mutate_internal_vessel(
    p_workspace_id, p_case ->> 'vesselId', 'editBusinessContent'
  ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if v_is_closed and (
    not public.sd_can_mutate_internal_vessel(
      p_workspace_id, v_case.vessel_id, 'closeTasks'
    )
    or not public.sd_can_mutate_internal_vessel(
      p_workspace_id, p_case ->> 'vesselId', 'closeTasks'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_link_action = 'materialize'
     and not public.sd_can_mutate_internal_vessel(
       p_workspace_id, p_case ->> 'vesselId', 'createTasks'
     ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_link_action = 'unlink' and (
    not public.sd_can_mutate_internal_vessel(
      p_workspace_id, v_case.vessel_id, 'closeTasks'
    )
    or not public.sd_can_mutate_internal_vessel(
      p_workspace_id, p_case ->> 'vesselId', 'closeTasks'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  select l.task_id into v_linked_task_id
  from public.sd_internal_case_task_links l
  where l.workspace_id = p_workspace_id and l.case_id = p_case_id;

  if p_link_action = 'preserve' then
    v_task_id := v_linked_task_id;
    if v_task_id is null then
      if p_task is not null
         or p_base_task_version is not null
         or p_task_lease_key is not null
         or p_task_owner_session is not null
         or p_task_fencing_token is not null then
        raise exception using errcode = 'P0001', message = 'link-conflict';
      end if;
    elsif p_task is null then
      raise exception using
        errcode = 'P0001', message = 'invalid-task-metadata';
    elsif p_base_task_version is null then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
  elsif p_link_action = 'materialize' then
    if v_linked_task_id is not null or p_base_task_version is not null then
      raise exception using errcode = 'P0001', message = 'link-conflict';
    end if;
    if p_task is null then
      raise exception using
        errcode = 'P0001', message = 'invalid-task-metadata';
    end if;
    v_task_id := p_task ->> 'id';
  else
    v_task_id := v_linked_task_id;
    if v_task_id is null or p_task is not null then
      raise exception using errcode = 'P0001', message = 'link-conflict';
    end if;
    if p_base_task_version is null then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
  end if;

  if v_task_id is not null and p_link_action <> 'materialize'
     and not public.sd_can_edit_task(p_workspace_id, v_task_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if v_task_id is not null
     and p_link_action in ('preserve', 'materialize') then
    if cardinality(v_departments) = 0 then
      raise exception using
        errcode = 'P0001', message = 'invalid-task-metadata';
    end if;
    perform public.sd_internal_validate_task_payload(
      p_workspace_id, p_case ->> 'vesselId', p_task
    );
    if p_task ->> 'id' is distinct from v_task_id then
      raise exception using errcode = 'P0001', message = 'link-conflict';
    end if;
    v_categories := public.sd_internal_json_text_array(
      p_task, 'categories', true
    );
    v_owner_ids := public.sd_internal_json_uuid_array(
      p_task, 'ownerUserIds'
    );
  end if;

  if p_case_lease_key is distinct from 'internal-case:' || p_case_id
     or p_case_owner_session is null
     or p_case_fencing_token is null then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;
  v_task_lease_expected := case
    when p_link_action = 'materialize'
      then 'task-create:' || (p_case ->> 'vesselId')
    when v_task_id is not null then 'task:' || v_task_id
    else null
  end;
  if v_task_lease_expected is null then
    if p_task_lease_key is not null
       or p_task_owner_session is not null
       or p_task_fencing_token is not null then
      raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
    end if;
  elsif p_task_lease_key is distinct from v_task_lease_expected
        or p_task_owner_session is null
        or p_task_fencing_token is null then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;
  for v_lease in
    select lease_key, owner_session, fencing_token
    from (
      values
        (p_case_lease_key, p_case_owner_session, p_case_fencing_token),
        (p_task_lease_key, p_task_owner_session, p_task_fencing_token)
    ) leases(lease_key, owner_session, fencing_token)
    where lease_key is not null
    order by lease_key
  loop
    perform public.sd_assert_live_lease(
      p_workspace_id,
      v_lease.lease_key,
      v_lease.owner_session,
      v_lease.fencing_token
    );
  end loop;

  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id and c.id = p_case_id
  for update;
  if not found
     or v_case.is_deleted
     or v_case.version <> p_base_case_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  select l.task_id into v_current_linked_task_id
  from public.sd_internal_case_task_links l
  where l.workspace_id = p_workspace_id and l.case_id = p_case_id
  for update;
  if v_current_linked_task_id is distinct from v_linked_task_id then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  if p_link_action = 'materialize' then
    if exists (
      select 1
      from public.sd_tasks t
      where t.workspace_id = p_workspace_id and t.id = v_task_id
    ) or exists (
      select 1
      from public.sd_internal_case_task_links l
      where l.workspace_id = p_workspace_id and l.task_id = v_task_id
    ) then
      raise exception using errcode = '23505', message = 'entity-exists';
    end if;
  elsif v_task_id is not null then
    select * into v_task
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = v_task_id
    for update;
    if not found
       or v_task.version <> p_base_task_version
       or v_task.source_kind <> 'ordinary'
       or not v_task.is_internal_control
       or v_task.is_deleted
       or v_task.internal_control_cancelled_at is not null then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
    select count(*) into v_scope_count
    from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id
      and tv.task_id = v_task_id
      and tv.is_active_scope;
    if v_scope_count <> 1
       or not exists (
         select 1
         from public.sd_task_vessels tv
         where tv.workspace_id = p_workspace_id
           and tv.task_id = v_task_id
           and tv.vessel_id = v_case.vessel_id
           and tv.is_active_scope
       ) then
      raise exception using errcode = 'P0001', message = 'link-conflict';
    end if;
    if p_link_action = 'preserve'
       and v_case.vessel_id is distinct from p_case ->> 'vesselId'
       and exists (
         select 1
         from public.sd_task_vessels tv
         where tv.workspace_id = p_workspace_id
           and tv.task_id = v_task_id
           and tv.vessel_id = p_case ->> 'vesselId'
       ) then
      raise exception using errcode = 'P0001', message = 'link-conflict';
    end if;
  end if;

  update public.sd_internal_cases c
  set vessel_id = p_case ->> 'vesselId',
      report_date = public.sd_internal_iso_date(
        p_case ->> 'reportDate', true
      ),
      report_source = p_case ->> 'reportSource',
      description = btrim(p_case ->> 'description'),
      priority = p_case ->> 'priority',
      category = btrim(p_case ->> 'category'),
      equipment_subcategory = case
        when p_case ->> 'category' = '設備故障'
          then btrim(p_case ->> 'equipmentSubcategory')
        else null
      end,
      is_aware = (p_case ->> 'isAware')::boolean,
      status = btrim(p_case ->> 'status'),
      is_closed = v_is_closed,
      closed_date = v_closed_date,
      closed_by = case when v_is_closed then v_actor else null end,
      version = c.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and c.version = p_base_case_version
  returning c.version into v_case_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  perform public.sd_internal_replace_case_departments(
    p_workspace_id, p_case_id, v_departments
  );
  v_event_kind := case
    when v_is_closed then 'closed'
    when p_link_action = 'materialize' then 'linked'
    when p_link_action = 'unlink' then 'unlinked'
    else 'updated'
  end;
  insert into public.sd_internal_case_status_events(
    workspace_id, id, case_id, event_kind, status, actor_id
  ) values (
    p_workspace_id,
    p_operation_id,
    p_case_id,
    v_event_kind,
    btrim(p_case ->> 'status'),
    v_actor
  );

  if p_link_action = 'preserve' and v_task_id is not null then
    update public.sd_tasks t
    set description = btrim(p_case ->> 'description'),
        status = btrim(p_case ->> 'status'),
        priority = p_case ->> 'priority',
        is_internal_control = true,
        is_abnormal = true,
        is_aware = (p_case ->> 'isAware')::boolean,
        is_closed = v_is_closed,
        closed_date = v_closed_date,
        closed_by = case when v_is_closed then v_actor else null end,
        expected_date = public.sd_internal_iso_date(
          p_task ->> 'expectedDate', false
        ),
        report_date = public.sd_internal_iso_date(
          p_case ->> 'reportDate', true
        ),
        category = v_categories[1],
        equipment_subcategory = case
          when '設備故障' = any(v_categories)
            then nullif(
              btrim(coalesce(p_case ->> 'equipmentSubcategory', '')), ''
            )
          else null
        end,
        version = t.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where t.workspace_id = p_workspace_id
      and t.id = v_task_id
      and t.version = p_base_task_version
    returning t.version into v_task_version;
    if not found then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
    update public.sd_task_vessels tv
    set vessel_id = p_case ->> 'vesselId',
        status = btrim(p_case ->> 'status'),
        is_closed = v_is_closed,
        closed_date = v_closed_date,
        closed_by = case when v_is_closed then v_actor else null end,
        version = tv.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where tv.workspace_id = p_workspace_id
      and tv.task_id = v_task_id
      and tv.vessel_id = v_case.vessel_id
      and tv.is_active_scope;
    if not found then
      raise exception using errcode = 'P0001', message = 'link-conflict';
    end if;
    perform public.sd_internal_replace_task_categories(
      p_workspace_id, v_task_id, v_categories
    );
    perform public.sd_internal_replace_task_departments(
      p_workspace_id, v_task_id, v_departments
    );
    perform public.sd_internal_replace_task_owners(
      p_workspace_id, v_task_id, v_owner_ids
    );
    insert into public.sd_task_status_events(
      workspace_id, id, task_id, status, actor_id
    ) values (
      p_workspace_id,
      public.sd_core_event_id(
        p_operation_id, 'task-status:' || v_task_id
      ),
      v_task_id,
      btrim(p_case ->> 'status'),
      v_actor
    );
    perform public.sd_core_emit_task_notifications(
      p_workspace_id, v_task_id, v_actor, p_operation_id, 'task_updated'
    );
  elsif p_link_action = 'materialize' then
    insert into public.sd_tasks(
      workspace_id, id, description, status, priority,
      source_kind, attention_dimension, is_internal_control,
      is_abnormal, is_aware, is_closed, closed_date, closed_by,
      expected_date, report_date, category, equipment_subcategory,
      version, created_by, updated_by
    ) values (
      p_workspace_id,
      v_task_id,
      btrim(p_case ->> 'description'),
      btrim(p_case ->> 'status'),
      p_case ->> 'priority',
      'ordinary',
      'task',
      true,
      true,
      (p_case ->> 'isAware')::boolean,
      v_is_closed,
      v_closed_date,
      case when v_is_closed then v_actor else null end,
      public.sd_internal_iso_date(p_task ->> 'expectedDate', false),
      public.sd_internal_iso_date(p_case ->> 'reportDate', true),
      v_categories[1],
      case
        when '設備故障' = any(v_categories)
          then nullif(
            btrim(coalesce(p_case ->> 'equipmentSubcategory', '')), ''
          )
        else null
      end,
      1,
      v_actor,
      v_actor
    );
    insert into public.sd_task_vessels(
      workspace_id, task_id, vessel_id, is_active_scope,
      status, is_closed, closed_date, closed_by, version, updated_by
    ) values (
      p_workspace_id,
      v_task_id,
      p_case ->> 'vesselId',
      true,
      btrim(p_case ->> 'status'),
      v_is_closed,
      v_closed_date,
      case when v_is_closed then v_actor else null end,
      1,
      v_actor
    );
    perform public.sd_internal_replace_task_categories(
      p_workspace_id, v_task_id, v_categories
    );
    perform public.sd_internal_replace_task_departments(
      p_workspace_id, v_task_id, v_departments
    );
    perform public.sd_internal_replace_task_owners(
      p_workspace_id, v_task_id, v_owner_ids
    );
    insert into public.sd_internal_case_task_links(
      workspace_id, case_id, task_id, version, created_by
    ) values (
      p_workspace_id, p_case_id, v_task_id, 1, v_actor
    );
    insert into public.sd_task_status_events(
      workspace_id, id, task_id, status, actor_id
    ) values (
      p_workspace_id,
      public.sd_core_event_id(
        p_operation_id, 'task-status:' || v_task_id
      ),
      v_task_id,
      btrim(p_case ->> 'status'),
      v_actor
    );
    v_task_version := 1;
    perform public.sd_core_emit_task_notifications(
      p_workspace_id, v_task_id, v_actor, p_operation_id, 'task_created'
    );
  elsif p_link_action = 'unlink' then
    perform public.sd_core_emit_task_notifications(
      p_workspace_id, v_task_id, v_actor, p_operation_id, 'task_updated'
    );
    delete from public.sd_internal_case_task_links l
    where l.workspace_id = p_workspace_id
      and l.case_id = p_case_id
      and l.task_id = v_task_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'link-conflict';
    end if;
    update public.sd_tasks t
    set is_internal_control = false,
        status = v_reminder,
        internal_control_cancelled_at = clock_timestamp(),
        internal_control_cancelled_by = v_actor,
        version = t.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where t.workspace_id = p_workspace_id
      and t.id = v_task_id
      and t.version = p_base_task_version
    returning t.version into v_task_version;
    if not found then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
    update public.sd_task_vessels tv
    set status = v_reminder,
        version = tv.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where tv.workspace_id = p_workspace_id
      and tv.task_id = v_task_id
      and tv.is_active_scope;
    insert into public.sd_task_status_events(
      workspace_id, id, task_id, status, actor_id
    ) values (
      p_workspace_id,
      public.sd_core_event_id(
        p_operation_id, 'task-status:' || v_task_id
      ),
      v_task_id,
      v_reminder,
      v_actor
    );
  end if;

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'caseId', p_case_id,
    'caseVersion', v_case_version,
    'taskId', v_task_id,
    'taskVersion', v_task_version,
    'linkAction', p_link_action
  );
  perform public.sd_internal_record_operation(
    p_workspace_id,
    p_operation_id,
    'update_internal_case',
    'internal-case:' || p_case_id,
    v_request,
    jsonb_build_object(
      'case', p_base_case_version,
      'task', p_base_task_version
    ),
    jsonb_build_object(
      'case', jsonb_build_object(
        'leaseKey', p_case_lease_key,
        'ownerSession', p_case_owner_session,
        'fencingToken', p_case_fencing_token
      ),
      'task', case
        when v_task_id is null then null
        else jsonb_build_object(
          'leaseKey', p_task_lease_key,
          'ownerSession', p_task_owner_session,
          'fencingToken', p_task_fencing_token
        )
      end
    ),
    v_result,
    'internal-case',
    p_case_id,
    jsonb_build_object(
      'caseVersion', v_case_version,
      'taskId', v_task_id,
      'taskVersion', v_task_version,
      'linkAction', p_link_action
    )
  );
  if v_task_id is not null then
    insert into public.sd_audit_events(
      workspace_id, id, actor_id, command, entity_type, entity_id, detail
    ) values (
      p_workspace_id,
      public.sd_core_event_id(
        p_operation_id, 'audit:task:' || v_task_id
      ),
      v_actor,
      'update_internal_case',
      'task',
      v_task_id,
      jsonb_build_object(
        'version', v_task_version,
        'caseId', p_case_id,
        'linkAction', p_link_action
      )
    );
  end if;
  return v_result;
end;
$$;

create function public.command_ship_dynamics_link_internal_case_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_case_id text,
  p_base_case_version bigint,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_task_id text,
  p_base_task_version bigint,
  p_task_lease_key text,
  p_task_owner_session uuid,
  p_task_fencing_token bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_case public.sd_internal_cases%rowtype;
  v_task public.sd_tasks%rowtype;
  v_departments text[];
  v_case_version bigint;
  v_task_version bigint;
  v_scope_count integer;
begin
  perform public.sd_internal_assert_actor(p_workspace_id, 'editBusinessContent');
  perform public.sd_internal_assert_actor(p_workspace_id, 'createTasks');
  if btrim(coalesce(p_task_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-task';
  end if;
  v_request := jsonb_build_object(
    'caseId', p_case_id,
    'baseCaseVersion', p_base_case_version,
    'caseLeaseKey', p_case_lease_key,
    'caseOwnerSession', p_case_owner_session,
    'caseFencingToken', p_case_fencing_token,
    'taskId', p_task_id,
    'baseTaskVersion', p_base_task_version,
    'taskLeaseKey', p_task_lease_key,
    'taskOwnerSession', p_task_owner_session,
    'taskFencingToken', p_task_fencing_token
  );
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id,
    p_operation_id,
    'link_internal_case_task',
    'internal-case:' || p_case_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and public.sd_can_mutate_internal_vessel(
      p_workspace_id,
      c.vessel_id,
      'editBusinessContent'
    );
  if not found then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if v_case.is_closed then
    raise exception using errcode = 'P0001', message = 'case-closed';
  end if;
  select coalesce(array_agg(d.department order by d.ordinal), '{}'::text[])
    into v_departments
  from public.sd_internal_case_departments d
  where d.workspace_id = p_workspace_id and d.case_id = p_case_id;
  if cardinality(v_departments) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;

  if not public.sd_can_edit_task(p_workspace_id, p_task_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_internal_assert_ordered_leases(
    p_workspace_id,
    p_case_id,
    p_case_lease_key,
    p_case_owner_session,
    p_case_fencing_token,
    p_task_id,
    p_task_lease_key,
    p_task_owner_session,
    p_task_fencing_token
  );

  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id and c.id = p_case_id
  for update;
  if v_case.version <> p_base_case_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id
  for update;
  if not found
     or v_task.version <> p_base_task_version
     or v_task.source_kind <> 'ordinary'
     or v_task.is_closed then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  if exists (
    select 1
    from public.sd_internal_case_task_links l
    where l.workspace_id = p_workspace_id
      and (l.case_id = p_case_id or l.task_id = p_task_id)
  ) then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;
  select count(*) into v_scope_count
  from public.sd_task_vessels tv
  where tv.workspace_id = p_workspace_id
    and tv.task_id = p_task_id
    and tv.is_active_scope;
  if v_scope_count <> 1
     or not exists (
       select 1
       from public.sd_task_vessels tv
       where tv.workspace_id = p_workspace_id
         and tv.task_id = p_task_id
         and tv.vessel_id = v_case.vessel_id
         and tv.is_active_scope
     ) then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;

  insert into public.sd_internal_case_task_links(
    workspace_id, case_id, task_id, version, created_by
  ) values (
    p_workspace_id, p_case_id, p_task_id, 1, v_actor
  );
  update public.sd_internal_cases c
  set version = c.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and c.version = p_base_case_version
  returning c.version into v_case_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  insert into public.sd_internal_case_status_events(
    workspace_id, id, case_id, event_kind, status, actor_id
  ) values (
    p_workspace_id, p_operation_id, p_case_id, 'linked', v_case.status, v_actor
  );

  update public.sd_tasks t
  set description = v_case.description,
      status = v_case.status,
      priority = v_case.priority,
      category = v_case.category,
      equipment_subcategory = v_case.equipment_subcategory,
      is_internal_control = true,
      is_abnormal = true,
      is_aware = v_case.is_aware,
      report_date = v_case.report_date,
      internal_control_cancelled_at = null,
      internal_control_cancelled_by = null,
      version = t.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where t.workspace_id = p_workspace_id
    and t.id = p_task_id
    and t.version = p_base_task_version
  returning t.version into v_task_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  update public.sd_task_vessels tv
  set status = v_case.status,
      is_closed = false,
      closed_date = null,
      closed_by = null,
      version = tv.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where tv.workspace_id = p_workspace_id
    and tv.task_id = p_task_id
    and tv.vessel_id = v_case.vessel_id
    and tv.is_active_scope;
  perform public.sd_internal_replace_task_categories(
    p_workspace_id,
    p_task_id,
    array[v_case.category]
  );
  perform public.sd_internal_replace_task_departments(
    p_workspace_id,
    p_task_id,
    v_departments
  );
  insert into public.sd_task_status_events(
    workspace_id, id, task_id, status, actor_id
  ) values (
    p_workspace_id, p_operation_id, p_task_id, v_case.status, v_actor
  );

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'caseId', p_case_id,
    'caseVersion', v_case_version,
    'taskId', p_task_id,
    'taskVersion', v_task_version
  );
  perform public.sd_internal_record_operation(
    p_workspace_id,
    p_operation_id,
    'link_internal_case_task',
    'internal-case:' || p_case_id,
    v_request,
    jsonb_build_object(
      'case', p_base_case_version,
      'task', p_base_task_version
    ),
    jsonb_build_object(
      'case', jsonb_build_object(
        'leaseKey', p_case_lease_key,
        'ownerSession', p_case_owner_session,
        'fencingToken', p_case_fencing_token
      ),
      'task', jsonb_build_object(
        'leaseKey', p_task_lease_key,
        'ownerSession', p_task_owner_session,
        'fencingToken', p_task_fencing_token
      )
    ),
    v_result,
    'internal-case',
    p_case_id,
    jsonb_build_object(
      'caseVersion', v_case_version,
      'taskId', p_task_id,
      'taskVersion', v_task_version
    )
  );
  return v_result;
end;
$$;

create function public.command_ship_dynamics_unlink_internal_case_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_case_id text,
  p_base_case_version bigint,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_base_task_version bigint,
  p_task_lease_key text,
  p_task_owner_session uuid,
  p_task_fencing_token bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_case public.sd_internal_cases%rowtype;
  v_task public.sd_tasks%rowtype;
  v_task_id text;
  v_case_version bigint;
  v_task_version bigint;
  v_reminder constant text :=
    'FLOW reminder: report the abnormality in FLOW before completing internal-control handling.';
begin
  perform public.sd_internal_assert_actor(p_workspace_id, 'editBusinessContent');
  perform public.sd_internal_assert_actor(p_workspace_id, 'closeTasks');
  v_request := jsonb_build_object(
    'caseId', p_case_id,
    'baseCaseVersion', p_base_case_version,
    'caseLeaseKey', p_case_lease_key,
    'caseOwnerSession', p_case_owner_session,
    'caseFencingToken', p_case_fencing_token,
    'baseTaskVersion', p_base_task_version,
    'taskLeaseKey', p_task_lease_key,
    'taskOwnerSession', p_task_owner_session,
    'taskFencingToken', p_task_fencing_token
  );
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id,
    p_operation_id,
    'unlink_internal_case_task',
    'internal-case:' || p_case_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and public.sd_can_mutate_internal_vessel(
      p_workspace_id,
      c.vessel_id,
      'closeTasks'
    );
  if not found then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if v_case.is_closed then
    raise exception using errcode = 'P0001', message = 'case-closed';
  end if;
  select l.task_id into v_task_id
  from public.sd_internal_case_task_links l
  where l.workspace_id = p_workspace_id and l.case_id = p_case_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;

  perform public.sd_internal_assert_ordered_leases(
    p_workspace_id,
    p_case_id,
    p_case_lease_key,
    p_case_owner_session,
    p_case_fencing_token,
    v_task_id,
    p_task_lease_key,
    p_task_owner_session,
    p_task_fencing_token
  );
  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id and c.id = p_case_id
  for update;
  if v_case.version <> p_base_case_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = v_task_id
  for update;
  if not found
     or v_task.version <> p_base_task_version
     or v_task.source_kind <> 'ordinary'
     or not v_task.is_internal_control then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  delete from public.sd_internal_case_task_links l
  where l.workspace_id = p_workspace_id
    and l.case_id = p_case_id
    and l.task_id = v_task_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;
  update public.sd_internal_cases c
  set version = c.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and c.version = p_base_case_version
  returning c.version into v_case_version;
  insert into public.sd_internal_case_status_events(
    workspace_id, id, case_id, event_kind, status, actor_id
  ) values (
    p_workspace_id, p_operation_id, p_case_id, 'unlinked', v_case.status, v_actor
  );

  update public.sd_tasks t
  set is_internal_control = false,
      status = v_reminder,
      internal_control_cancelled_at = clock_timestamp(),
      internal_control_cancelled_by = v_actor,
      version = t.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where t.workspace_id = p_workspace_id
    and t.id = v_task_id
    and t.version = p_base_task_version
  returning t.version into v_task_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  update public.sd_task_vessels tv
  set status = v_reminder,
      version = tv.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where tv.workspace_id = p_workspace_id
    and tv.task_id = v_task_id
    and tv.is_active_scope;
  insert into public.sd_task_status_events(
    workspace_id, id, task_id, status, actor_id
  ) values (
    p_workspace_id, p_operation_id, v_task_id, v_reminder, v_actor
  );

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'caseId', p_case_id,
    'caseVersion', v_case_version,
    'taskId', v_task_id,
    'taskVersion', v_task_version
  );
  perform public.sd_internal_record_operation(
    p_workspace_id,
    p_operation_id,
    'unlink_internal_case_task',
    'internal-case:' || p_case_id,
    v_request,
    jsonb_build_object(
      'case', p_base_case_version,
      'task', p_base_task_version
    ),
    jsonb_build_object(
      'case', jsonb_build_object(
        'leaseKey', p_case_lease_key,
        'ownerSession', p_case_owner_session,
        'fencingToken', p_case_fencing_token
      ),
      'task', jsonb_build_object(
        'leaseKey', p_task_lease_key,
        'ownerSession', p_task_owner_session,
        'fencingToken', p_task_fencing_token
      )
    ),
    v_result,
    'internal-case',
    p_case_id,
    jsonb_build_object(
      'caseVersion', v_case_version,
      'taskId', v_task_id,
      'taskVersion', v_task_version
    )
  );
  return v_result;
end;
$$;

create function public.command_ship_dynamics_cancel_internal_case(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_case_id text,
  p_base_case_version bigint,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_base_task_version bigint default null,
  p_task_lease_key text default null,
  p_task_owner_session uuid default null,
  p_task_fencing_token bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_case public.sd_internal_cases%rowtype;
  v_task public.sd_tasks%rowtype;
  v_task_id text;
  v_case_version bigint;
  v_task_version bigint;
  v_reminder constant text :=
    'FLOW reminder: report the abnormality in FLOW before completing internal-control handling.';
begin
  perform public.sd_internal_assert_actor(p_workspace_id, 'closeTasks');
  v_request := jsonb_build_object(
    'caseId', p_case_id,
    'baseCaseVersion', p_base_case_version,
    'caseLeaseKey', p_case_lease_key,
    'caseOwnerSession', p_case_owner_session,
    'caseFencingToken', p_case_fencing_token,
    'baseTaskVersion', p_base_task_version,
    'taskLeaseKey', p_task_lease_key,
    'taskOwnerSession', p_task_owner_session,
    'taskFencingToken', p_task_fencing_token
  );
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id,
    p_operation_id,
    'cancel_internal_case',
    'internal-case:' || p_case_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and public.sd_can_mutate_internal_vessel(
      p_workspace_id,
      c.vessel_id,
      'closeTasks'
    );
  if not found then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if v_case.is_closed then
    raise exception using errcode = 'P0001', message = 'case-closed';
  end if;
  select l.task_id into v_task_id
  from public.sd_internal_case_task_links l
  where l.workspace_id = p_workspace_id and l.case_id = p_case_id;
  if v_task_id is null and p_base_task_version is not null then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;
  if v_task_id is not null and p_base_task_version is null then
    raise exception using errcode = 'P0001', message = 'version-conflict';
  end if;

  perform public.sd_internal_assert_ordered_leases(
    p_workspace_id,
    p_case_id,
    p_case_lease_key,
    p_case_owner_session,
    p_case_fencing_token,
    v_task_id,
    p_task_lease_key,
    p_task_owner_session,
    p_task_fencing_token
  );
  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id and c.id = p_case_id
  for update;
  if v_case.version <> p_base_case_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if v_task_id is not null then
    select * into v_task
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = v_task_id
    for update;
    if not found
       or v_task.version <> p_base_task_version
       or v_task.source_kind <> 'ordinary'
       or not v_task.is_internal_control then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
  end if;

  update public.sd_internal_cases c
  set status = v_reminder,
      is_closed = true,
      closed_date = public.sd_taipei_date(clock_timestamp()),
      closed_by = v_actor,
      version = c.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and c.version = p_base_case_version
  returning c.version into v_case_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  insert into public.sd_internal_case_status_events(
    workspace_id, id, case_id, event_kind, status, actor_id
  ) values (
    p_workspace_id, p_operation_id, p_case_id, 'cancelled', v_reminder, v_actor
  );

  if v_task_id is not null then
    delete from public.sd_internal_case_task_links l
    where l.workspace_id = p_workspace_id
      and l.case_id = p_case_id
      and l.task_id = v_task_id;
    update public.sd_tasks t
    set is_internal_control = false,
        status = v_reminder,
        internal_control_cancelled_at = clock_timestamp(),
        internal_control_cancelled_by = v_actor,
        version = t.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where t.workspace_id = p_workspace_id
      and t.id = v_task_id
      and t.version = p_base_task_version
    returning t.version into v_task_version;
    if not found then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
    update public.sd_task_vessels tv
    set status = v_reminder,
        version = tv.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where tv.workspace_id = p_workspace_id
      and tv.task_id = v_task_id
      and tv.is_active_scope;
    insert into public.sd_task_status_events(
      workspace_id, id, task_id, status, actor_id
    ) values (
      p_workspace_id, p_operation_id, v_task_id, v_reminder, v_actor
    );
  end if;

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'caseId', p_case_id,
    'caseVersion', v_case_version,
    'taskId', v_task_id,
    'taskVersion', v_task_version
  );
  perform public.sd_internal_record_operation(
    p_workspace_id,
    p_operation_id,
    'cancel_internal_case',
    'internal-case:' || p_case_id,
    v_request,
    jsonb_build_object(
      'case', p_base_case_version,
      'task', p_base_task_version
    ),
    jsonb_build_object(
      'case', jsonb_build_object(
        'leaseKey', p_case_lease_key,
        'ownerSession', p_case_owner_session,
        'fencingToken', p_case_fencing_token
      ),
      'task', case
        when v_task_id is null then null
        else jsonb_build_object(
          'leaseKey', p_task_lease_key,
          'ownerSession', p_task_owner_session,
          'fencingToken', p_task_fencing_token
        )
      end
    ),
    v_result,
    'internal-case',
    p_case_id,
    jsonb_build_object(
      'caseVersion', v_case_version,
      'taskId', v_task_id,
      'taskVersion', v_task_version,
      'flowReminder', true
    )
  );
  return v_result;
end;
$$;

create function public.command_ship_dynamics_reopen_internal_case(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_case_id text,
  p_base_case_version bigint,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_status text,
  p_base_task_version bigint default null,
  p_task_lease_key text default null,
  p_task_owner_session uuid default null,
  p_task_fencing_token bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_case public.sd_internal_cases%rowtype;
  v_task public.sd_tasks%rowtype;
  v_task_id text;
  v_case_version bigint;
  v_task_version bigint;
begin
  perform public.sd_internal_assert_actor(p_workspace_id, 'closeTasks');
  if btrim(coalesce(p_status, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-status';
  end if;
  v_request := jsonb_build_object(
    'caseId', p_case_id,
    'baseCaseVersion', p_base_case_version,
    'caseLeaseKey', p_case_lease_key,
    'caseOwnerSession', p_case_owner_session,
    'caseFencingToken', p_case_fencing_token,
    'status', p_status,
    'baseTaskVersion', p_base_task_version,
    'taskLeaseKey', p_task_lease_key,
    'taskOwnerSession', p_task_owner_session,
    'taskFencingToken', p_task_fencing_token
  );
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id,
    p_operation_id,
    'reopen_internal_case',
    'internal-case:' || p_case_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and public.sd_can_mutate_internal_vessel(
      p_workspace_id,
      c.vessel_id,
      'closeTasks'
    );
  if not found then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if not v_case.is_closed then
    raise exception using errcode = 'P0001', message = 'case-not-closed';
  end if;
  select l.task_id into v_task_id
  from public.sd_internal_case_task_links l
  where l.workspace_id = p_workspace_id and l.case_id = p_case_id;
  if v_task_id is null and p_base_task_version is not null then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;
  if v_task_id is not null and p_base_task_version is null then
    raise exception using errcode = 'P0001', message = 'version-conflict';
  end if;

  perform public.sd_internal_assert_ordered_leases(
    p_workspace_id,
    p_case_id,
    p_case_lease_key,
    p_case_owner_session,
    p_case_fencing_token,
    v_task_id,
    p_task_lease_key,
    p_task_owner_session,
    p_task_fencing_token
  );
  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id and c.id = p_case_id
  for update;
  if v_case.version <> p_base_case_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if v_task_id is not null then
    select * into v_task
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = v_task_id
    for update;
    if not found
       or v_task.version <> p_base_task_version
       or not v_task.is_internal_control
       or not v_task.is_closed then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
  end if;

  update public.sd_internal_cases c
  set status = btrim(p_status),
      is_closed = false,
      closed_date = null,
      closed_by = null,
      version = c.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and c.version = p_base_case_version
  returning c.version into v_case_version;
  insert into public.sd_internal_case_status_events(
    workspace_id, id, case_id, event_kind, status, actor_id
  ) values (
    p_workspace_id, p_operation_id, p_case_id, 'reopened', btrim(p_status), v_actor
  );

  if v_task_id is not null then
    update public.sd_tasks t
    set status = btrim(p_status),
        is_closed = false,
        closed_date = null,
        closed_by = null,
        version = t.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where t.workspace_id = p_workspace_id
      and t.id = v_task_id
      and t.version = p_base_task_version
    returning t.version into v_task_version;
    if not found then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
    update public.sd_task_vessels tv
    set status = btrim(p_status),
        is_closed = false,
        closed_date = null,
        closed_by = null,
        version = tv.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where tv.workspace_id = p_workspace_id
      and tv.task_id = v_task_id
      and tv.is_active_scope;
    insert into public.sd_task_status_events(
      workspace_id, id, task_id, status, actor_id
    ) values (
      p_workspace_id, p_operation_id, v_task_id, btrim(p_status), v_actor
    );
  end if;

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'caseId', p_case_id,
    'caseVersion', v_case_version,
    'taskId', v_task_id,
    'taskVersion', v_task_version
  );
  perform public.sd_internal_record_operation(
    p_workspace_id,
    p_operation_id,
    'reopen_internal_case',
    'internal-case:' || p_case_id,
    v_request,
    jsonb_build_object(
      'case', p_base_case_version,
      'task', p_base_task_version
    ),
    jsonb_build_object(
      'case', jsonb_build_object(
        'leaseKey', p_case_lease_key,
        'ownerSession', p_case_owner_session,
        'fencingToken', p_case_fencing_token
      ),
      'task', case
        when v_task_id is null then null
        else jsonb_build_object(
          'leaseKey', p_task_lease_key,
          'ownerSession', p_task_owner_session,
          'fencingToken', p_task_fencing_token
        )
      end
    ),
    v_result,
    'internal-case',
    p_case_id,
    jsonb_build_object(
      'caseVersion', v_case_version,
      'taskId', v_task_id,
      'taskVersion', v_task_version
    )
  );
  return v_result;
end;
$$;

create function public.command_ship_dynamics_delete_internal_case(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_case_id text,
  p_base_case_version bigint,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_base_task_version bigint default null,
  p_task_lease_key text default null,
  p_task_owner_session uuid default null,
  p_task_fencing_token bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_case public.sd_internal_cases%rowtype;
  v_task public.sd_tasks%rowtype;
  v_task_id text;
  v_deleted_case_version bigint;
  v_deleted_task_version bigint;
begin
  v_role := public.sd_internal_assert_actor(p_workspace_id, 'deleteTasks');
  perform public.sd_internal_assert_actor(p_workspace_id, 'closeTasks');
  if v_role not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  v_request := jsonb_build_object(
    'caseId', p_case_id,
    'baseCaseVersion', p_base_case_version,
    'caseLeaseKey', p_case_lease_key,
    'caseOwnerSession', p_case_owner_session,
    'caseFencingToken', p_case_fencing_token,
    'baseTaskVersion', p_base_task_version,
    'taskLeaseKey', p_task_lease_key,
    'taskOwnerSession', p_task_owner_session,
    'taskFencingToken', p_task_fencing_token
  );
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id,
    p_operation_id,
    'delete_internal_case',
    'internal-case:' || p_case_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and public.sd_can_mutate_internal_vessel(
      p_workspace_id,
      c.vessel_id,
      'closeTasks'
    );
  if not found then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  select l.task_id into v_task_id
  from public.sd_internal_case_task_links l
  where l.workspace_id = p_workspace_id and l.case_id = p_case_id;
  if v_task_id is null and p_base_task_version is not null then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;
  if v_task_id is not null and p_base_task_version is null then
    raise exception using errcode = 'P0001', message = 'version-conflict';
  end if;

  perform public.sd_internal_assert_ordered_leases(
    p_workspace_id,
    p_case_id,
    p_case_lease_key,
    p_case_owner_session,
    p_case_fencing_token,
    v_task_id,
    p_task_lease_key,
    p_task_owner_session,
    p_task_fencing_token
  );
  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id and c.id = p_case_id
  for update;
  if v_case.version <> p_base_case_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if v_task_id is not null then
    select * into v_task
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = v_task_id
    for update;
    if not found
       or v_task.version <> p_base_task_version
       or v_task.source_kind <> 'ordinary'
       or not v_task.is_internal_control then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
    delete from public.sd_internal_case_task_links l
    where l.workspace_id = p_workspace_id
      and l.case_id = p_case_id
      and l.task_id = v_task_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'link-conflict';
    end if;
    update public.sd_tasks t
    set is_deleted = true,
        deleted_at = clock_timestamp(),
        deleted_by = auth.uid(),
        version = t.version + 1,
        updated_at = clock_timestamp(),
        updated_by = auth.uid()
    where t.workspace_id = p_workspace_id
      and t.id = v_task_id
      and t.version = p_base_task_version
      and not t.is_deleted
    returning t.version into v_deleted_task_version;
    if not found then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
  end if;
  insert into public.sd_internal_case_status_events(
    workspace_id, id, case_id, event_kind, status, actor_id
  ) values (
    p_workspace_id,
    p_operation_id,
    p_case_id,
    'deleted',
    v_case.status,
    auth.uid()
  );
  update public.sd_internal_cases c
  set is_deleted = true,
      deleted_at = clock_timestamp(),
      deleted_by = auth.uid(),
      version = c.version + 1,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and c.version = p_base_case_version
    and not c.is_deleted
  returning c.version into v_deleted_case_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'deleted', true,
    'caseId', p_case_id,
    'caseVersion', v_deleted_case_version,
    'taskId', v_task_id,
    'taskVersion', v_deleted_task_version
  );
  perform public.sd_internal_record_operation(
    p_workspace_id,
    p_operation_id,
    'delete_internal_case',
    'internal-case:' || p_case_id,
    v_request,
    jsonb_build_object(
      'case', p_base_case_version,
      'task', p_base_task_version
    ),
    jsonb_build_object(
      'case', jsonb_build_object(
        'leaseKey', p_case_lease_key,
        'ownerSession', p_case_owner_session,
        'fencingToken', p_case_fencing_token
      ),
      'task', case
        when v_task_id is null then null
        else jsonb_build_object(
          'leaseKey', p_task_lease_key,
          'ownerSession', p_task_owner_session,
          'fencingToken', p_task_fencing_token
        )
      end
    ),
    v_result,
    'internal-case',
    p_case_id,
    jsonb_build_object(
      'deleted', true,
      'caseVersion', v_deleted_case_version,
      'taskId', v_task_id,
      'taskVersion', v_deleted_task_version
    )
  );
  return v_result;
end;
$$;

create function public.command_ship_dynamics_delete_task_preserving_internal_case(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_task_id text,
  p_base_task_version bigint,
  p_task_lease_key text,
  p_task_owner_session uuid,
  p_task_fencing_token bigint,
  p_case_id text default null,
  p_base_case_version bigint default null,
  p_case_lease_key text default null,
  p_case_owner_session uuid default null,
  p_case_fencing_token bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_case public.sd_internal_cases%rowtype;
  v_task public.sd_tasks%rowtype;
  v_linked_case_id text;
  v_case_version bigint;
  v_case_status text;
  v_task_version bigint;
  v_reminder constant text :=
    'FLOW reminder: linked task deleted; internal-control evidence is preserved and closed.';
begin
  v_role := public.sd_internal_assert_actor(p_workspace_id, 'deleteTasks');
  perform public.sd_internal_assert_actor(p_workspace_id, 'closeTasks');
  if v_role not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if btrim(coalesce(p_task_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-task';
  end if;
  v_request := jsonb_build_object(
    'taskId', p_task_id,
    'baseTaskVersion', p_base_task_version,
    'taskLeaseKey', p_task_lease_key,
    'taskOwnerSession', p_task_owner_session,
    'taskFencingToken', p_task_fencing_token,
    'caseId', p_case_id,
    'baseCaseVersion', p_base_case_version,
    'caseLeaseKey', p_case_lease_key,
    'caseOwnerSession', p_case_owner_session,
    'caseFencingToken', p_case_fencing_token
  );
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id,
    p_operation_id,
    'delete_task_preserving_internal_case',
    'task:' || p_task_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  select l.case_id into v_linked_case_id
  from public.sd_internal_case_task_links l
  where l.workspace_id = p_workspace_id and l.task_id = p_task_id;
  if v_linked_case_id is distinct from p_case_id then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;
  if v_linked_case_id is null then
    if p_base_case_version is not null
       or p_case_lease_key is not null
       or p_case_owner_session is not null
       or p_case_fencing_token is not null then
      raise exception using errcode = 'P0001', message = 'link-conflict';
    end if;
  elsif p_base_case_version is null then
    raise exception using errcode = 'P0001', message = 'version-conflict';
  end if;

  if v_linked_case_id is not null then
    select * into v_case
    from public.sd_internal_cases c
    where c.workspace_id = p_workspace_id
      and c.id = v_linked_case_id
      and public.sd_can_mutate_internal_vessel(
        p_workspace_id,
        c.vessel_id,
        'closeTasks'
      );
    if not found then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  end if;

  perform public.sd_internal_assert_ordered_leases(
    p_workspace_id,
    v_linked_case_id,
    p_case_lease_key,
    p_case_owner_session,
    p_case_fencing_token,
    p_task_id,
    p_task_lease_key,
    p_task_owner_session,
    p_task_fencing_token
  );
  if v_linked_case_id is not null then
    select * into v_case
    from public.sd_internal_cases c
    where c.workspace_id = p_workspace_id and c.id = v_linked_case_id
    for update;
    if v_case.version <> p_base_case_version then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
  end if;
  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id
  for update;
  if not found
     or v_task.version <> p_base_task_version
     or v_task.source_kind <> 'ordinary' then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if v_linked_case_id is null and v_task.is_internal_control then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;
  if v_linked_case_id is not null and not v_task.is_internal_control then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;

  if v_linked_case_id is not null then
    if v_case.is_closed then
      v_case_version := v_case.version;
      v_case_status := v_case.status;
    else
      update public.sd_internal_cases c
      set status = v_reminder,
          is_closed = true,
          closed_date = public.sd_taipei_date(clock_timestamp()),
          closed_by = v_actor,
          version = c.version + 1,
          updated_at = clock_timestamp(),
          updated_by = v_actor
      where c.workspace_id = p_workspace_id
        and c.id = v_linked_case_id
        and c.version = p_base_case_version
      returning c.version, c.status into v_case_version, v_case_status;
      if not found then
        raise exception using errcode = '40001', message = 'version-conflict';
      end if;
    end if;
    insert into public.sd_internal_case_status_events(
      workspace_id, id, case_id, event_kind, status, actor_id
    ) values (
      p_workspace_id,
      p_operation_id,
      v_linked_case_id,
      'linked_task_deleted',
      v_case_status,
      v_actor
    );
    delete from public.sd_internal_case_task_links l
    where l.workspace_id = p_workspace_id
      and l.case_id = v_linked_case_id
      and l.task_id = p_task_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'link-conflict';
    end if;
  end if;

  update public.sd_tasks t
  set is_deleted = true,
      deleted_at = clock_timestamp(),
      deleted_by = v_actor,
      version = t.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where t.workspace_id = p_workspace_id
    and t.id = p_task_id
    and t.version = p_base_task_version
    and not t.is_deleted
  returning t.version into v_task_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'taskId', p_task_id,
    'taskVersion', v_task_version,
    'deleted', true,
    'casePreserved', v_linked_case_id is not null,
    'caseId', v_linked_case_id,
    'caseVersion', v_case_version
  );
  perform public.sd_internal_record_operation(
    p_workspace_id,
    p_operation_id,
    'delete_task_preserving_internal_case',
    'task:' || p_task_id,
    v_request,
    jsonb_build_object(
      'task', p_base_task_version,
      'case', p_base_case_version
    ),
    jsonb_build_object(
      'task', jsonb_build_object(
        'leaseKey', p_task_lease_key,
        'ownerSession', p_task_owner_session,
        'fencingToken', p_task_fencing_token
      ),
      'case', case
        when v_linked_case_id is null then null
        else jsonb_build_object(
          'leaseKey', p_case_lease_key,
          'ownerSession', p_case_owner_session,
          'fencingToken', p_case_fencing_token
        )
      end
    ),
    v_result,
    'task',
    p_task_id,
    jsonb_build_object(
      'deleted', true,
      'taskVersion', v_task_version,
      'casePreserved', v_linked_case_id is not null,
      'caseId', v_linked_case_id,
      'caseVersion', v_case_version,
      'flowReminder', v_linked_case_id is not null
    )
  );
  return v_result;
end;
$$;

-- The edit form owns one atomic boundary: case content and the optional linked
-- task projection commit together under the same operation id.
create function public.command_ship_dynamics_batch_create_internal_cases(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_item jsonb;
  v_case jsonb;
  v_task jsonb;
  v_case_id text;
  v_task_id text;
  v_vessel_id text;
  v_departments text[];
  v_categories text[];
  v_owner_ids uuid[];
  v_is_closed boolean;
  v_closed_date date;
  v_lease record;
  v_lease_provenance jsonb;
begin
  perform public.sd_internal_assert_actor(p_workspace_id, 'createTasks');
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid-internal-case-batch';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where jsonb_typeof(item) <> 'object'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-internal-case-batch-item';
  end if;
  if exists (
    select item ->> 'caseId'
    from jsonb_array_elements(p_items) item
    group by item ->> 'caseId'
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-case-identity';
  end if;
  if exists (
    select item -> 'task' ->> 'id'
    from jsonb_array_elements(p_items) item
    where jsonb_typeof(item -> 'task') = 'object'
    group by item -> 'task' ->> 'id'
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-task-identity';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items) with ordinality submitted(value, ordinal)
    order by ordinal
  loop
    if not (
      v_item ?& array[
        'caseId', 'caseLeaseKey', 'caseOwnerSession',
        'caseFencingToken', 'case', 'task', 'taskLeaseKey',
        'taskOwnerSession', 'taskFencingToken'
      ]
    ) or exists (
      select 1
      from jsonb_object_keys(v_item) key
      where key not in (
        'caseId', 'caseLeaseKey', 'caseOwnerSession',
        'caseFencingToken', 'case', 'task', 'taskLeaseKey',
        'taskOwnerSession', 'taskFencingToken'
      )
    ) or jsonb_typeof(v_item -> 'caseId') <> 'string'
       or jsonb_typeof(v_item -> 'caseLeaseKey') <> 'string'
       or jsonb_typeof(v_item -> 'caseOwnerSession') <> 'string'
       or jsonb_typeof(v_item -> 'caseFencingToken') <> 'number'
       or jsonb_typeof(v_item -> 'case') <> 'object'
       or jsonb_typeof(v_item -> 'task') not in ('object', 'null') then
      raise exception using
        errcode = 'P0001', message = 'invalid-internal-case-batch-item';
    end if;

    v_case_id := v_item ->> 'caseId';
    v_case := v_item -> 'case';
    v_task := nullif(v_item -> 'task', 'null'::jsonb);
    v_vessel_id := v_case ->> 'vesselId';
    if btrim(coalesce(v_case_id, '')) = ''
       or v_item ->> 'caseLeaseKey'
          is distinct from 'internal-case-create:' || v_vessel_id then
      raise exception using
        errcode = 'P0001', message = 'invalid-internal-case-batch-item';
    end if;
    begin
      perform (v_item ->> 'caseOwnerSession')::uuid;
      perform (v_item ->> 'caseFencingToken')::bigint;
    exception when others then
      raise exception using
        errcode = 'P0001', message = 'invalid-internal-case-batch-item';
    end;

    perform public.sd_internal_validate_case_payload(v_case);
    v_departments := public.sd_internal_json_text_array(
      v_case, 'departments', v_task is not null
    );
    if not public.sd_can_mutate_internal_vessel(
      p_workspace_id, v_vessel_id, 'createTasks'
    ) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
    v_is_closed := (v_case ->> 'isClosed')::boolean;
    if v_is_closed then
      perform public.sd_internal_assert_actor(p_workspace_id, 'closeTasks');
      if not public.sd_can_mutate_internal_vessel(
        p_workspace_id, v_vessel_id, 'closeTasks'
      ) then
        raise exception using errcode = 'P0001', message = 'not-authorized';
      end if;
    end if;

    if v_task is null then
      if jsonb_typeof(v_item -> 'taskLeaseKey') <> 'null'
         or jsonb_typeof(v_item -> 'taskOwnerSession') <> 'null'
         or jsonb_typeof(v_item -> 'taskFencingToken') <> 'null' then
        raise exception using
          errcode = 'P0001', message = 'invalid-internal-case-batch-item';
      end if;
    else
      if jsonb_typeof(v_item -> 'taskLeaseKey') <> 'string'
         or jsonb_typeof(v_item -> 'taskOwnerSession') <> 'string'
         or jsonb_typeof(v_item -> 'taskFencingToken') <> 'number'
         or v_item ->> 'taskLeaseKey'
            is distinct from 'task-create:' || v_vessel_id then
        raise exception using
          errcode = 'P0001', message = 'invalid-internal-case-batch-item';
      end if;
      begin
        perform (v_item ->> 'taskOwnerSession')::uuid;
        perform (v_item ->> 'taskFencingToken')::bigint;
      exception when others then
        raise exception using
          errcode = 'P0001', message = 'invalid-internal-case-batch-item';
      end;
      perform public.sd_internal_validate_task_payload(
        p_workspace_id, v_vessel_id, v_task
      );
    end if;
  end loop;

  if exists (
    select lease_key
    from (
      select
        item ->> 'caseLeaseKey' as lease_key,
        item ->> 'caseOwnerSession' as owner_session,
        item ->> 'caseFencingToken' as fencing_token
      from jsonb_array_elements(p_items) item
      union all
      select
        item ->> 'taskLeaseKey',
        item ->> 'taskOwnerSession',
        item ->> 'taskFencingToken'
      from jsonb_array_elements(p_items) item
      where jsonb_typeof(item -> 'task') = 'object'
    ) leases
    group by lease_key
    having count(distinct owner_session || ':' || fencing_token) <> 1
  ) then
    raise exception using errcode = 'P0001', message = 'lease-proof-mismatch';
  end if;

  v_request := jsonb_build_object('items', p_items);
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id,
    p_operation_id,
    'batch_create_internal_cases',
    'internal-case-batch:' || md5(p_items::text),
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  for v_lease in
    select distinct
      lease_key,
      owner_session::uuid as owner_session,
      fencing_token::bigint as fencing_token
    from (
      select
        item ->> 'caseLeaseKey' as lease_key,
        item ->> 'caseOwnerSession' as owner_session,
        item ->> 'caseFencingToken' as fencing_token
      from jsonb_array_elements(p_items) item
      union all
      select
        item ->> 'taskLeaseKey',
        item ->> 'taskOwnerSession',
        item ->> 'taskFencingToken'
      from jsonb_array_elements(p_items) item
      where jsonb_typeof(item -> 'task') = 'object'
    ) leases
    order by lease_key
  loop
    perform public.sd_assert_live_lease(
      p_workspace_id,
      v_lease.lease_key,
      v_lease.owner_session,
      v_lease.fencing_token
    );
  end loop;

  if exists (
    select 1
    from public.sd_internal_cases c
    where c.workspace_id = p_workspace_id
      and c.id in (
        select item ->> 'caseId'
        from jsonb_array_elements(p_items) item
      )
  ) or exists (
    select 1
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id
      and t.id in (
        select item -> 'task' ->> 'id'
        from jsonb_array_elements(p_items) item
        where jsonb_typeof(item -> 'task') = 'object'
      )
  ) then
    raise exception using errcode = '23505', message = 'entity-exists';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items) with ordinality submitted(value, ordinal)
    order by ordinal
  loop
    v_case_id := v_item ->> 'caseId';
    v_case := v_item -> 'case';
    v_task := nullif(v_item -> 'task', 'null'::jsonb);
    v_vessel_id := v_case ->> 'vesselId';
    v_departments := public.sd_internal_json_text_array(
      v_case, 'departments', v_task is not null
    );
    v_is_closed := (v_case ->> 'isClosed')::boolean;
    v_closed_date := null;
    if v_is_closed then
      v_closed_date := coalesce(
        public.sd_internal_iso_date(v_case ->> 'closedDate', false),
        public.sd_taipei_date(clock_timestamp())
      );
    end if;

    insert into public.sd_internal_cases(
      workspace_id, id, vessel_id, report_date, report_source,
      description, priority, category, equipment_subcategory,
      is_aware, status, origin, is_closed, closed_date, closed_by,
      version, created_by, updated_by
    ) values (
      p_workspace_id,
      v_case_id,
      v_vessel_id,
      public.sd_internal_iso_date(v_case ->> 'reportDate', true),
      v_case ->> 'reportSource',
      btrim(v_case ->> 'description'),
      v_case ->> 'priority',
      btrim(v_case ->> 'category'),
      case
        when v_case ->> 'category' = '設備故障'
          then btrim(v_case ->> 'equipmentSubcategory')
        else null
      end,
      (v_case ->> 'isAware')::boolean,
      btrim(v_case ->> 'status'),
      v_case ->> 'origin',
      v_is_closed,
      v_closed_date,
      case when v_is_closed then v_actor else null end,
      1,
      v_actor,
      v_actor
    );
    perform public.sd_internal_replace_case_departments(
      p_workspace_id, v_case_id, v_departments
    );
    insert into public.sd_internal_case_status_events(
      workspace_id, id, case_id, event_kind, status, actor_id
    ) values (
      p_workspace_id,
      public.sd_core_event_id(
        p_operation_id, 'case-status:' || v_case_id
      ),
      v_case_id,
      'created',
      btrim(v_case ->> 'status'),
      v_actor
    );
    insert into public.sd_audit_events(
      workspace_id, id, actor_id, command, entity_type, entity_id, detail
    ) values (
      p_workspace_id,
      public.sd_core_event_id(
        p_operation_id, 'audit:case:' || v_case_id
      ),
      v_actor,
      'batch_create_internal_cases',
      'internal-case',
      v_case_id,
      jsonb_build_object('version', 1)
    );

    if v_task is not null then
      v_task_id := v_task ->> 'id';
      v_categories := public.sd_internal_json_text_array(
        v_task, 'categories', true
      );
      v_owner_ids := public.sd_internal_json_uuid_array(
        v_task, 'ownerUserIds'
      );
      insert into public.sd_tasks(
        workspace_id, id, description, status, priority,
        source_kind, attention_dimension, is_internal_control,
        is_abnormal, is_aware, is_closed, closed_date, closed_by,
        expected_date, report_date, category, equipment_subcategory,
        version, created_by, updated_by
      ) values (
        p_workspace_id,
        v_task_id,
        btrim(v_case ->> 'description'),
        btrim(v_case ->> 'status'),
        v_case ->> 'priority',
        'ordinary',
        'task',
        true,
        true,
        (v_case ->> 'isAware')::boolean,
        v_is_closed,
        v_closed_date,
        case when v_is_closed then v_actor else null end,
        public.sd_internal_iso_date(v_task ->> 'expectedDate', false),
        public.sd_internal_iso_date(v_case ->> 'reportDate', true),
        v_categories[1],
        case
          when '設備故障' = any(v_categories)
            then nullif(
              btrim(coalesce(v_case ->> 'equipmentSubcategory', '')), ''
            )
          else null
        end,
        1,
        v_actor,
        v_actor
      );
      insert into public.sd_task_vessels(
        workspace_id, task_id, vessel_id, is_active_scope,
        status, is_closed, closed_date, closed_by, version, updated_by
      ) values (
        p_workspace_id,
        v_task_id,
        v_vessel_id,
        true,
        btrim(v_case ->> 'status'),
        v_is_closed,
        v_closed_date,
        case when v_is_closed then v_actor else null end,
        1,
        v_actor
      );
      perform public.sd_internal_replace_task_categories(
        p_workspace_id, v_task_id, v_categories
      );
      perform public.sd_internal_replace_task_departments(
        p_workspace_id, v_task_id, v_departments
      );
      perform public.sd_internal_replace_task_owners(
        p_workspace_id, v_task_id, v_owner_ids
      );
      insert into public.sd_internal_case_task_links(
        workspace_id, case_id, task_id, version, created_by
      ) values (
        p_workspace_id, v_case_id, v_task_id, 1, v_actor
      );
      insert into public.sd_task_status_events(
        workspace_id, id, task_id, status, actor_id
      ) values (
        p_workspace_id,
        public.sd_core_event_id(
          p_operation_id, 'task-status:' || v_task_id
        ),
        v_task_id,
        btrim(v_case ->> 'status'),
        v_actor
      );
      insert into public.sd_notifications(
        workspace_id, id, recipient_id, vessel_id, task_id,
        kind, title, message, actor_id
      )
      select
        p_workspace_id,
        'notice-' || md5(
          p_operation_id::text || ':' || v_task_id || ':' ||
          recipients.user_id::text
        ),
        recipients.user_id,
        recipients.vessel_id,
        v_task_id,
        'task_created',
        '新增待辦：' || btrim(v_case ->> 'description'),
        btrim(v_case ->> 'description'),
        v_actor
      from (
        select user_id, min(vessel_id) as vessel_id
        from (
          select a.user_id, tv.vessel_id
          from public.sd_task_vessels tv
          join public.sd_vessel_assignments a
            on a.workspace_id = tv.workspace_id
           and a.vessel_id = tv.vessel_id
           and a.assignment_kind in ('manager', 'delegate')
           and a.is_active
          join public.sd_memberships m
            on m.workspace_id = a.workspace_id
           and m.user_id = a.user_id
           and m.is_active
          where tv.workspace_id = p_workspace_id
            and tv.task_id = v_task_id
            and tv.is_active_scope
          union all
          select o.owner_id, null::text
          from public.sd_task_owners o
          join public.sd_memberships m
            on m.workspace_id = o.workspace_id
           and m.user_id = o.owner_id
           and m.is_active
          where o.workspace_id = p_workspace_id
            and o.task_id = v_task_id
        ) candidates
        group by user_id
      ) recipients
      where recipients.user_id <> v_actor
      on conflict (workspace_id, id) do nothing;
      insert into public.sd_audit_events(
        workspace_id, id, actor_id, command, entity_type, entity_id, detail
      ) values (
        p_workspace_id,
        public.sd_core_event_id(
          p_operation_id, 'audit:task:' || v_task_id
        ),
        v_actor,
        'batch_create_internal_cases',
        'task',
        v_task_id,
        jsonb_build_object('version', 1, 'caseId', v_case_id)
      );
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'leaseKey', lease_key,
        'ownerSession', owner_session,
        'fencingToken', fencing_token::bigint
      )
      order by lease_key
    ),
    '[]'::jsonb
  ) into v_lease_provenance
  from (
    select distinct lease_key, owner_session, fencing_token
    from (
      select
        item ->> 'caseLeaseKey' as lease_key,
        item ->> 'caseOwnerSession' as owner_session,
        item ->> 'caseFencingToken' as fencing_token
      from jsonb_array_elements(p_items) item
      union all
      select
        item ->> 'taskLeaseKey',
        item ->> 'taskOwnerSession',
        item ->> 'taskFencingToken'
      from jsonb_array_elements(p_items) item
      where jsonb_typeof(item -> 'task') = 'object'
    ) supplied
  ) unique_leases;

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'count', jsonb_array_length(p_items),
    'caseIds', (
      select jsonb_agg(item ->> 'caseId' order by ordinal)
      from jsonb_array_elements(p_items)
        with ordinality submitted(item, ordinal)
    ),
    'taskIds', (
      select coalesce(
        jsonb_agg(item -> 'task' ->> 'id' order by ordinal),
        '[]'::jsonb
      )
      from jsonb_array_elements(p_items)
        with ordinality submitted(item, ordinal)
      where jsonb_typeof(item -> 'task') = 'object'
    )
  );
  insert into public.sd_operations(
    workspace_id, operation_id, actor_id, command, target_key,
    request_payload, request_hash, base_versions, lease_provenance,
    status, result
  ) values (
    p_workspace_id,
    p_operation_id,
    v_actor,
    'batch_create_internal_cases',
    'internal-case-batch:' || md5(p_items::text),
    v_request,
    md5(v_request::text),
    '{}'::jsonb,
    v_lease_provenance,
    'committed',
    v_result
  );
  return v_result;
end;
$$;

revoke all on function public.sd_can_read_internal_case(uuid, text) from public;
revoke all on function public.sd_can_mutate_internal_vessel(uuid, text, text) from public;
revoke all on function public.sd_can_edit_internal_case(uuid, text) from public;
revoke all on function public.sd_can_maintain_internal_case_lease(uuid, text, text) from public;
revoke all on function public.sd_internal_assert_actor(uuid, text) from public;
revoke all on function public.sd_internal_iso_date(text, boolean) from public;
revoke all on function public.sd_internal_json_text_array(jsonb, text, boolean) from public;
revoke all on function public.sd_internal_json_uuid_array(jsonb, text) from public;
revoke all on function public.sd_internal_validate_case_payload(jsonb) from public;
revoke all on function public.sd_internal_validate_task_payload(uuid, text, jsonb) from public;
revoke all on function public.sd_internal_assert_ordered_leases(
  uuid, text, text, uuid, bigint, text, text, uuid, bigint
) from public;
revoke all on function public.sd_internal_assert_ordered_create_leases(
  uuid, text, text, uuid, bigint, text, text, uuid, bigint
) from public;
revoke all on function public.sd_internal_operation_replay(
  uuid, uuid, text, text, jsonb
) from public;
revoke all on function public.sd_internal_record_operation(
  uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, text, text, jsonb
) from public;
revoke all on function public.sd_internal_replace_case_departments(
  uuid, text, text[]
) from public;
revoke all on function public.sd_internal_replace_task_departments(
  uuid, text, text[]
) from public;
revoke all on function public.sd_internal_replace_task_categories(
  uuid, text, text[]
) from public;
revoke all on function public.sd_internal_replace_task_owners(
  uuid, text, uuid[]
) from public;

revoke all on function public.claim_ship_dynamics_entity_lease(
  uuid, text, text, text, uuid, integer
) from public;
revoke all on function public.command_ship_dynamics_create_internal_case(
  uuid, uuid, text, text, uuid, bigint, jsonb, jsonb, text, uuid, bigint
) from public;
revoke all on function public.command_ship_dynamics_update_internal_case(
  uuid, uuid, text, bigint, text, uuid, bigint, jsonb, bigint, text, uuid, bigint, jsonb, text
) from public;
revoke all on function public.command_ship_dynamics_batch_create_internal_cases(
  uuid, uuid, jsonb
) from public;
revoke all on function public.command_ship_dynamics_link_internal_case_task(
  uuid, uuid, text, bigint, text, uuid, bigint, text, bigint, text, uuid, bigint
) from public;
revoke all on function public.command_ship_dynamics_unlink_internal_case_task(
  uuid, uuid, text, bigint, text, uuid, bigint, bigint, text, uuid, bigint
) from public;
revoke all on function public.command_ship_dynamics_cancel_internal_case(
  uuid, uuid, text, bigint, text, uuid, bigint, bigint, text, uuid, bigint
) from public;
revoke all on function public.command_ship_dynamics_reopen_internal_case(
  uuid, uuid, text, bigint, text, uuid, bigint, text, bigint, text, uuid, bigint
) from public;
revoke all on function public.command_ship_dynamics_delete_internal_case(
  uuid, uuid, text, bigint, text, uuid, bigint, bigint, text, uuid, bigint
) from public;
revoke all on function public.command_ship_dynamics_delete_task_preserving_internal_case(
  uuid, uuid, text, bigint, text, uuid, bigint, text, bigint, text, uuid, bigint
) from public;

grant execute on function public.sd_can_read_internal_case(uuid, text)
  to authenticated;
grant execute on function public.claim_ship_dynamics_entity_lease(
  uuid, text, text, text, uuid, integer
) to authenticated;
grant execute on function public.command_ship_dynamics_create_internal_case(
  uuid, uuid, text, text, uuid, bigint, jsonb, jsonb, text, uuid, bigint
) to authenticated;
grant execute on function public.command_ship_dynamics_update_internal_case(
  uuid, uuid, text, bigint, text, uuid, bigint, jsonb, bigint, text, uuid, bigint, jsonb, text
) to authenticated;
grant execute on function public.command_ship_dynamics_batch_create_internal_cases(
  uuid, uuid, jsonb
) to authenticated;
grant execute on function public.command_ship_dynamics_link_internal_case_task(
  uuid, uuid, text, bigint, text, uuid, bigint, text, bigint, text, uuid, bigint
) to authenticated;
grant execute on function public.command_ship_dynamics_unlink_internal_case_task(
  uuid, uuid, text, bigint, text, uuid, bigint, bigint, text, uuid, bigint
) to authenticated;
grant execute on function public.command_ship_dynamics_cancel_internal_case(
  uuid, uuid, text, bigint, text, uuid, bigint, bigint, text, uuid, bigint
) to authenticated;
grant execute on function public.command_ship_dynamics_reopen_internal_case(
  uuid, uuid, text, bigint, text, uuid, bigint, text, bigint, text, uuid, bigint
) to authenticated;
grant execute on function public.command_ship_dynamics_delete_internal_case(
  uuid, uuid, text, bigint, text, uuid, bigint, bigint, text, uuid, bigint
) to authenticated;
grant execute on function public.command_ship_dynamics_delete_task_preserving_internal_case(
  uuid, uuid, text, bigint, text, uuid, bigint, text, bigint, text, uuid, bigint
) to authenticated;

commit;

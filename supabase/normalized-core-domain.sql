begin;

-- Additive normalized core-domain migration.
-- Execution order:
--   1. normalized-schema.sql
--   2. this migration
--   3. meeting/internal-control aggregate migrations
--
-- This slice deliberately owns only ordinary tasks, vessels, shared options,
-- role policy, notifications, saved reports, and migration quarantine. Meeting
-- and internal-control provenance is represented but can only be mutated by
-- their future aggregate commands.

alter table public.sd_tasks
  add column if not exists source_type text not null default 'morning',
  add column if not exists source_meeting_id text,
  add column if not exists source_meeting_item_id text,
  add column if not exists equipment_subcategory text,
  add column if not exists vessel_scope_mode text not null default 'vessels',
  add column if not exists distribute_to_vessels boolean not null default false,
  add column if not exists status_before_close text,
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id);

alter table public.sd_vessels
  add column if not exists created_by uuid references auth.users(id);

alter table public.sd_tasks
  drop constraint if exists sd_tasks_source_type_valid,
  add constraint sd_tasks_source_type_valid
    check (source_type in ('morning', 'temporary')),
  drop constraint if exists sd_tasks_vessel_scope_mode_valid,
  add constraint sd_tasks_vessel_scope_mode_valid
    check (vessel_scope_mode in ('all', 'types', 'vessels')),
  drop constraint if exists sd_tasks_delete_consistent,
  add constraint sd_tasks_delete_consistent
    check (
      (is_deleted and deleted_at is not null and deleted_by is not null)
      or (not is_deleted and deleted_at is null and deleted_by is null)
    );

create unique index if not exists sd_one_task_per_meeting_item
  on public.sd_tasks(workspace_id, source_meeting_item_id)
  where source_meeting_item_id is not null and not is_deleted;

create table if not exists public.sd_task_categories (
  workspace_id uuid not null,
  task_id text not null,
  category text not null,
  ordinal integer not null check (ordinal >= 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, task_id, category),
  unique (workspace_id, task_id, ordinal),
  foreign key (workspace_id, task_id)
    references public.sd_tasks(workspace_id, id) on delete cascade,
  constraint sd_task_categories_not_blank check (btrim(category) <> '')
);

create table if not exists public.sd_task_departments (
  workspace_id uuid not null,
  task_id text not null,
  department text not null,
  ordinal integer not null check (ordinal >= 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, task_id, department),
  unique (workspace_id, task_id, ordinal),
  foreign key (workspace_id, task_id)
    references public.sd_tasks(workspace_id, id) on delete cascade,
  constraint sd_task_departments_not_blank check (btrim(department) <> '')
);

create table if not exists public.sd_task_owners (
  workspace_id uuid not null,
  task_id text not null,
  owner_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, task_id, owner_id),
  unique (workspace_id, task_id, ordinal),
  foreign key (workspace_id, task_id)
    references public.sd_tasks(workspace_id, id) on delete cascade,
  foreign key (workspace_id, owner_id)
    references public.sd_memberships(workspace_id, user_id),
  constraint sd_task_owner_actor_not_null check (owner_id is not null)
);

create table if not exists public.sd_task_type_scopes (
  workspace_id uuid not null,
  task_id text not null,
  type_scope text not null,
  ordinal integer not null check (ordinal >= 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, task_id, type_scope),
  unique (workspace_id, task_id, ordinal),
  foreign key (workspace_id, task_id)
    references public.sd_tasks(workspace_id, id) on delete cascade,
  constraint sd_task_type_scopes_not_blank check (btrim(type_scope) <> '')
);

create table if not exists public.sd_task_vessel_status_events (
  workspace_id uuid not null,
  id uuid not null,
  task_id text not null,
  vessel_id text not null,
  status text not null,
  is_closed boolean not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, id),
  foreign key (workspace_id, task_id, vessel_id)
    references public.sd_task_vessels(workspace_id, task_id, vessel_id),
  constraint sd_task_vessel_status_not_blank check (btrim(status) <> '')
);

create table if not exists public.sd_settings (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  section_key text not null,
  value jsonb not null default '{}'::jsonb,
  value_hash text not null,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id),
  primary key (workspace_id, section_key),
  constraint sd_settings_section_not_blank check (btrim(section_key) <> ''),
  constraint sd_settings_hash_not_blank check (btrim(value_hash) <> '')
);

create table if not exists public.sd_public_site_gate (
  workspace_id uuid primary key references public.sd_workspaces(id) on delete cascade,
  password_hash text not null,
  content_hash text not null,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id),
  constraint sd_public_site_gate_sha256 check (
    password_hash ~ '^[0-9a-f]{64}$'
    and content_hash ~ '^[0-9a-f]{32}$'
  )
);

create table if not exists public.sd_departments (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  department text not null,
  ordinal integer not null check (ordinal >= 0),
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id),
  primary key (workspace_id, department),
  constraint sd_departments_not_blank check (btrim(department) <> '')
);

create table if not exists public.sd_category_options (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  category_scope text not null check (category_scope in ('ordinary', 'meeting')),
  category text not null,
  ordinal integer not null check (ordinal >= 0),
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id),
  primary key (workspace_id, category_scope, category),
  constraint sd_category_options_not_blank check (btrim(category) <> '')
);

create table if not exists public.sd_priority_options (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  priority text not null check (priority in ('急', '高', '中', '低')),
  ordinal integer not null check (ordinal >= 0),
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id),
  primary key (workspace_id, priority)
);

create table if not exists public.sd_equipment_options (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  equipment_option text not null,
  ordinal integer not null check (ordinal >= 0),
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id),
  primary key (workspace_id, equipment_option),
  constraint sd_equipment_options_not_blank check (btrim(equipment_option) <> '')
);

create table if not exists public.sd_notifications (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  id text not null,
  recipient_id uuid not null references auth.users(id),
  vessel_id text,
  task_id text,
  kind text not null check (
    kind in (
      'task_created', 'task_updated', 'task_archived',
      'internal_control_cancelled', 'task_deleted'
    )
  ),
  title text not null,
  message text not null,
  actor_id uuid not null references auth.users(id),
  read_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, id),
  foreign key (workspace_id, vessel_id)
    references public.sd_vessels(workspace_id, id),
  foreign key (workspace_id, task_id)
    references public.sd_tasks(workspace_id, id),
  constraint sd_notifications_id_not_blank check (btrim(id) <> ''),
  constraint sd_notifications_text_not_blank check (
    btrim(title) <> '' and btrim(message) <> ''
  )
);

create table if not exists public.sd_saved_reports (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  id text not null,
  title text not null,
  task_count integer not null default 0 check (task_count >= 0),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  primary key (workspace_id, id),
  constraint sd_saved_reports_id_not_blank check (btrim(id) <> ''),
  constraint sd_saved_reports_title_not_blank check (btrim(title) <> '')
);

create table if not exists public.sd_saved_report_vessels (
  workspace_id uuid not null,
  report_id text not null,
  vessel_id text not null,
  ordinal integer not null check (ordinal >= 0),
  primary key (workspace_id, report_id, vessel_id),
  unique (workspace_id, report_id, ordinal),
  foreign key (workspace_id, report_id)
    references public.sd_saved_reports(workspace_id, id) on delete cascade,
  foreign key (workspace_id, vessel_id)
    references public.sd_vessels(workspace_id, id)
);

create table if not exists public.sd_migration_quarantine (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  id text not null,
  reason text not null,
  legacy_revision bigint not null check (legacy_revision >= 0),
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null,
  resolution text check (resolution in ('accepted', 'discarded')),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, id),
  constraint sd_migration_quarantine_identity_not_blank check (
    btrim(id) <> '' and btrim(reason) <> ''
    and btrim(entity_type) <> '' and btrim(entity_id) <> ''
  ),
  constraint sd_migration_quarantine_resolution_consistent check (
    (resolution is null and resolution_note is null and resolved_at is null and resolved_by is null)
    or
    (resolution is not null and resolution_note is not null and resolved_at is not null and resolved_by is not null)
  )
);

alter table public.sd_task_categories enable row level security;
alter table public.sd_task_departments enable row level security;
alter table public.sd_task_owners enable row level security;
alter table public.sd_task_type_scopes enable row level security;
alter table public.sd_task_vessel_status_events enable row level security;
alter table public.sd_settings enable row level security;
alter table public.sd_public_site_gate enable row level security;
alter table public.sd_departments enable row level security;
alter table public.sd_category_options enable row level security;
alter table public.sd_priority_options enable row level security;
alter table public.sd_equipment_options enable row level security;
alter table public.sd_notifications enable row level security;
alter table public.sd_saved_reports enable row level security;
alter table public.sd_saved_report_vessels enable row level security;
alter table public.sd_migration_quarantine enable row level security;

revoke all on table public.sd_task_categories from anon, authenticated;
revoke all on table public.sd_task_departments from anon, authenticated;
revoke all on table public.sd_task_owners from anon, authenticated;
revoke all on table public.sd_task_type_scopes from anon, authenticated;
revoke all on table public.sd_task_vessel_status_events from anon, authenticated;
revoke all on table public.sd_settings from anon, authenticated;
revoke all on table public.sd_public_site_gate from anon, authenticated;
revoke all on table public.sd_departments from anon, authenticated;
revoke all on table public.sd_category_options from anon, authenticated;
revoke all on table public.sd_priority_options from anon, authenticated;
revoke all on table public.sd_equipment_options from anon, authenticated;
revoke all on table public.sd_notifications from anon, authenticated;
revoke all on table public.sd_saved_reports from anon, authenticated;
revoke all on table public.sd_saved_report_vessels from anon, authenticated;
revoke all on table public.sd_migration_quarantine from anon, authenticated;

grant select on table public.sd_task_categories to authenticated;
grant select on table public.sd_task_departments to authenticated;
grant select on table public.sd_task_owners to authenticated;
grant select on table public.sd_task_type_scopes to authenticated;
grant select on table public.sd_task_vessel_status_events to authenticated;
grant select on table public.sd_settings to authenticated;
grant select on table public.sd_departments to authenticated;
grant select on table public.sd_category_options to authenticated;
grant select on table public.sd_priority_options to authenticated;
grant select on table public.sd_equipment_options to authenticated;
grant select on table public.sd_notifications to authenticated;
grant select on table public.sd_saved_reports to authenticated;
grant select on table public.sd_saved_report_vessels to authenticated;
grant select on table public.sd_migration_quarantine to authenticated;

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
  where t.workspace_id = p_workspace_id
    and t.id = p_task_id
    and not t.is_deleted;
  if not found then return false; end if;

  if v_role = 'vessel' then
    if v_task.is_internal_control or v_task.source_kind <> 'ordinary' then
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

create or replace function public.sd_can_mutate_vessel(
  p_workspace_id uuid,
  p_vessel_id text,
  p_permission_key text default 'editBusinessContent'
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.sd_membership_role(p_workspace_id);
begin
  if v_role is null
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
  if v_role <> 'operator' then return false; end if;
  return exists (
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

create or replace function public.sd_can_create_task_for_vessel(
  p_workspace_id uuid,
  p_vessel_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.sd_membership_role(p_workspace_id);
begin
  if v_role is null
     or v_role = 'vessel'
     or not public.sd_has_permission(p_workspace_id, 'createTasks') then
    return false;
  end if;
  if not exists (
    select 1 from public.sd_vessels v
    where v.workspace_id = p_workspace_id
      and v.id = p_vessel_id
      and v.is_active
  ) then
    return false;
  end if;
  if v_role in ('owner', 'admin') then return true; end if;
  return v_role = 'operator' and exists (
    select 1 from public.sd_vessel_assignments a
    where a.workspace_id = p_workspace_id
      and a.vessel_id = p_vessel_id
      and a.user_id = auth.uid()
      and a.assignment_kind in ('manager', 'delegate')
      and a.is_active
  );
end;
$$;

create or replace function public.sd_can_read_saved_report(
  p_workspace_id uuid,
  p_report_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.sd_has_permission(p_workspace_id, 'exportReports') then
    return false;
  end if;
  if not exists (
    select 1 from public.sd_saved_reports r
    where r.workspace_id = p_workspace_id and r.id = p_report_id
  ) then
    return false;
  end if;
  return not exists (
    select 1
    from public.sd_saved_report_vessels rv
    where rv.workspace_id = p_workspace_id
      and rv.report_id = p_report_id
      and not public.sd_can_read_vessel(rv.workspace_id, rv.vessel_id)
  );
end;
$$;

create or replace function public.sd_can_read_notification(
  p_workspace_id uuid,
  p_notification_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_notification public.sd_notifications%rowtype;
begin
  select * into v_notification
  from public.sd_notifications n
  where n.workspace_id = p_workspace_id and n.id = p_notification_id;
  if not found
     or v_notification.recipient_id <> auth.uid()
     or public.sd_membership_role(p_workspace_id) is null then
    return false;
  end if;
  if v_notification.vessel_id is not null
     and not public.sd_can_read_vessel(
       p_workspace_id, v_notification.vessel_id
     ) then
    return false;
  end if;
  if v_notification.task_id is null
     or public.sd_can_read_task(p_workspace_id, v_notification.task_id) then
    return true;
  end if;
  return exists (
    select 1
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id
      and t.id = v_notification.task_id
      and t.is_deleted
      and t.source_kind = 'ordinary'
      and not t.is_internal_control
  );
end;
$$;

create policy sd_saved_reports_read on public.sd_saved_reports
  for select to authenticated
  using (public.sd_can_read_saved_report(workspace_id, id));

create policy sd_saved_report_vessels_read on public.sd_saved_report_vessels
  for select to authenticated
  using (
    public.sd_can_read_saved_report(workspace_id, report_id)
    and public.sd_can_read_vessel(workspace_id, vessel_id)
  );

drop policy if exists sd_vessel_assignments_read on public.sd_vessel_assignments;
create policy sd_vessel_assignments_read on public.sd_vessel_assignments
  for select to authenticated
  using (
    (
      public.sd_membership_role(workspace_id) = 'vessel'
      and user_id = auth.uid()
      and assignment_kind = 'vessel_account'
      and is_active
    )
    or (
      public.sd_membership_role(workspace_id) in ('owner', 'admin', 'operator')
      and public.sd_can_read_vessel(workspace_id, vessel_id)
    )
  );

create policy sd_task_categories_read on public.sd_task_categories
  for select to authenticated
  using (public.sd_can_read_task(workspace_id, task_id));

create policy sd_task_departments_read on public.sd_task_departments
  for select to authenticated
  using (public.sd_can_read_task(workspace_id, task_id));

create policy sd_task_owners_read on public.sd_task_owners
  for select to authenticated
  using (
    public.sd_membership_role(workspace_id) in ('owner', 'admin', 'operator')
    and public.sd_can_read_task(workspace_id, task_id)
  );

create policy sd_task_type_scopes_read on public.sd_task_type_scopes
  for select to authenticated
  using (public.sd_can_read_task(workspace_id, task_id));

create policy sd_task_vessel_status_events_read
  on public.sd_task_vessel_status_events
  for select to authenticated
  using (
    public.sd_can_read_task(workspace_id, task_id)
    and public.sd_can_read_vessel(workspace_id, vessel_id)
  );

create policy sd_settings_read on public.sd_settings
  for select to authenticated
  using (
    public.sd_membership_role(workspace_id) is not null
    and (
      section_key not in ('owner', 'security', 'workspace')
      or public.sd_membership_role(workspace_id) = 'owner'
    )
  );

create policy sd_departments_read on public.sd_departments
  for select to authenticated
  using (public.sd_membership_role(workspace_id) is not null);

create policy sd_category_options_read on public.sd_category_options
  for select to authenticated
  using (public.sd_membership_role(workspace_id) is not null);

create policy sd_priority_options_read on public.sd_priority_options
  for select to authenticated
  using (public.sd_membership_role(workspace_id) is not null);

create policy sd_equipment_options_read on public.sd_equipment_options
  for select to authenticated
  using (public.sd_membership_role(workspace_id) is not null);

create policy sd_notifications_read on public.sd_notifications
  for select to authenticated
  using (public.sd_can_read_notification(workspace_id, id));

create policy sd_migration_quarantine_owner_read
  on public.sd_migration_quarantine
  for select to authenticated
  using (public.sd_membership_role(workspace_id) = 'owner');

create or replace function public.sd_core_event_id(
  p_operation_id uuid,
  p_suffix text
)
returns uuid
language sql
immutable
set search_path = pg_catalog, public
as $$
  select (
    substr(md5(p_operation_id::text || ':' || p_suffix), 1, 8) || '-' ||
    substr(md5(p_operation_id::text || ':' || p_suffix), 9, 4) || '-' ||
    substr(md5(p_operation_id::text || ':' || p_suffix), 13, 4) || '-' ||
    substr(md5(p_operation_id::text || ':' || p_suffix), 17, 4) || '-' ||
    substr(md5(p_operation_id::text || ':' || p_suffix), 21, 12)
  )::uuid
$$;

create or replace function public.sd_core_assert_json_keys(
  p_value jsonb,
  p_allowed text[],
  p_error text
)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception using errcode = 'P0001', message = p_error;
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_value) k
    where not (k = any(p_allowed))
  ) then
    raise exception using errcode = 'P0001', message = p_error;
  end if;
end;
$$;

create or replace function public.sd_core_text_array(
  p_value jsonb,
  p_key text,
  p_allow_empty boolean default false
)
returns text[]
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_array jsonb := p_value -> p_key;
  v_result text[];
  v_count integer;
  v_distinct_count integer;
begin
  if v_array is null or jsonb_typeof(v_array) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid-' || p_key;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_array) item
    where jsonb_typeof(item) <> 'string'
       or btrim(item #>> '{}') = ''
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-' || p_key;
  end if;
  select
    coalesce(array_agg(btrim(value) order by ordinal), '{}'::text[]),
    count(*)::integer,
    count(distinct btrim(value))::integer
  into v_result, v_count, v_distinct_count
  from jsonb_array_elements_text(v_array) with ordinality item(value, ordinal);
  if (not p_allow_empty and v_count = 0) or v_count <> v_distinct_count then
    raise exception using errcode = 'P0001', message = 'invalid-' || p_key;
  end if;
  return v_result;
end;
$$;

create or replace function public.sd_core_uuid_array(
  p_value jsonb,
  p_key text,
  p_allow_empty boolean default true
)
returns uuid[]
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_text text[] := public.sd_core_text_array(p_value, p_key, p_allow_empty);
  v_result uuid[];
begin
  begin
    select coalesce(array_agg(value::uuid), '{}'::uuid[])
    into v_result
    from unnest(v_text) value;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid-' || p_key;
  end;
  return v_result;
end;
$$;

create or replace function public.sd_core_operation_replay(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_actor_id uuid,
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
  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0)
  );
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
  for update;
  if not found then return null; end if;
  if v_operation.actor_id <> p_actor_id
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

create or replace function public.sd_core_commit_operation(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_actor_id uuid,
  p_command text,
  p_target_key text,
  p_request jsonb,
  p_base_versions jsonb,
  p_lease_provenance jsonb,
  p_result jsonb
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
    status, result, created_at, completed_at
  ) values (
    p_workspace_id, p_operation_id, p_actor_id, p_command, p_target_key,
    p_request, md5(p_request::text), p_base_versions, p_lease_provenance,
    'committed', p_result, clock_timestamp(), clock_timestamp()
  );
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
  v_task_id text;
  v_vessel_id text;
  v_separator integer;
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
  elsif p_entity_type = 'task-progress' then
    v_separator := strpos(p_entity_id, ':');
    if v_separator <= 1 then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
    v_task_id := substr(p_entity_id, 1, v_separator - 1);
    v_vessel_id := substr(p_entity_id, v_separator + 1);
    if p_lease_key <> 'task-progress:' || p_entity_id
       or v_role = 'vessel'
       or not public.sd_has_permission(p_workspace_id, 'editBusinessContent')
       or not public.sd_can_mutate_vessel(p_workspace_id, v_vessel_id)
       or not exists (
         select 1
         from public.sd_task_vessels tv
         join public.sd_tasks t
           on t.workspace_id = tv.workspace_id and t.id = tv.task_id
         where tv.workspace_id = p_workspace_id
           and tv.task_id = v_task_id
           and tv.vessel_id = v_vessel_id
           and tv.is_active_scope
           and not t.is_deleted
       ) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'vessel' then
    if p_lease_key <> 'vessel:' || p_entity_id
       or not (
         public.sd_can_edit_vessel(p_workspace_id, p_entity_id)
         or (
           not exists (
             select 1 from public.sd_vessels v
             where v.workspace_id = p_workspace_id and v.id = p_entity_id
           )
           and v_role in ('owner', 'admin')
           and public.sd_has_permission(p_workspace_id, 'manageVessels')
         )
       ) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'settings' then
    if p_lease_key <> 'settings:' || p_entity_id then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
    if p_entity_id in (
      'role-permissions', 'site-gate', 'migration-quarantine',
      'workspace', 'owner', 'security'
    ) then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'not-authorized';
      end if;
    elsif p_entity_id not in (
      'departments', 'task-categories', 'meeting-task-categories',
      'priorities', 'equipment-options'
    ) or v_role not in ('owner', 'admin') then
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
    where l.workspace_id = p_workspace_id
      and l.lease_key = p_lease_key;
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

create or replace function public.sd_core_validate_task_content(p_content jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_vessels text[];
  v_categories text[];
  v_departments text[];
  v_owners uuid[];
  v_types text[];
begin
  perform public.sd_core_assert_json_keys(
    p_content,
    array[
      'description', 'status', 'priority', 'expectedDate', 'reportDate',
      'equipmentSubcategory', 'isAware', 'isAbnormal', 'vesselIds',
      'categories', 'departments', 'ownerUserIds', 'typeScopes'
    ],
    'invalid-task-payload'
  );
  if not (
    p_content ? 'description' and p_content ? 'status'
    and p_content ? 'priority' and p_content ? 'expectedDate'
    and p_content ? 'reportDate' and p_content ? 'equipmentSubcategory'
    and p_content ? 'isAware' and p_content ? 'isAbnormal'
    and p_content ? 'vesselIds' and p_content ? 'categories'
    and p_content ? 'departments' and p_content ? 'ownerUserIds'
    and p_content ? 'typeScopes'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-task-payload';
  end if;
  if btrim(coalesce(p_content ->> 'description', '')) = ''
     or btrim(coalesce(p_content ->> 'status', '')) = ''
     or p_content ->> 'priority' not in ('急', '高', '中', '低')
     or jsonb_typeof(p_content -> 'isAware') <> 'boolean'
     or jsonb_typeof(p_content -> 'isAbnormal') <> 'boolean'
     or jsonb_typeof(p_content -> 'description') <> 'string'
     or jsonb_typeof(p_content -> 'status') <> 'string'
     or jsonb_typeof(p_content -> 'priority') <> 'string'
     or jsonb_typeof(p_content -> 'expectedDate') <> 'string'
     or jsonb_typeof(p_content -> 'reportDate') <> 'string'
     or jsonb_typeof(p_content -> 'equipmentSubcategory') <> 'string' then
    raise exception using errcode = 'P0001', message = 'invalid-task-payload';
  end if;
  if (p_content ->> 'expectedDate') <> ''
     and (p_content ->> 'expectedDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = 'P0001', message = 'invalid-task-payload';
  end if;
  if (p_content ->> 'reportDate') <> ''
     and (p_content ->> 'reportDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = 'P0001', message = 'invalid-task-payload';
  end if;
  v_vessels := public.sd_core_text_array(p_content, 'vesselIds', false);
  v_categories := public.sd_core_text_array(p_content, 'categories', true);
  v_departments := public.sd_core_text_array(p_content, 'departments', true);
  v_owners := public.sd_core_uuid_array(p_content, 'ownerUserIds', true);
  v_types := public.sd_core_text_array(p_content, 'typeScopes', true);
end;
$$;

create or replace function public.sd_core_assert_task_scope(
  p_workspace_id uuid,
  p_vessel_ids text[],
  p_permission_key text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_vessel_id text;
begin
  if cardinality(p_vessel_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid-vesselIds';
  end if;
  foreach v_vessel_id in array p_vessel_ids loop
    if not public.sd_can_mutate_vessel(
      p_workspace_id, v_vessel_id, p_permission_key
    ) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  end loop;
  perform 1
  from public.sd_vessels v
  where v.workspace_id = p_workspace_id
    and v.id = any(p_vessel_ids)
    and v.is_active
  order by v.id
  for update;
  if (
    select count(*)
    from public.sd_vessels v
    where v.workspace_id = p_workspace_id
      and v.id = any(p_vessel_ids)
      and v.is_active
  ) <> cardinality(p_vessel_ids) then
    raise exception using errcode = 'P0001', message = 'invalid-vessel-scope';
  end if;
end;
$$;

create or replace function public.sd_core_assert_task_owners(
  p_workspace_id uuid,
  p_owner_ids uuid[],
  p_vessel_ids text[]
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid;
  v_role text;
  v_vessel_id text;
begin
  foreach v_owner_id in array p_owner_ids loop
    select m.role into v_role
    from public.sd_memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = v_owner_id
      and m.is_active;
    if v_role is null or v_role = 'vessel' then
      raise exception using errcode = 'P0001', message = 'invalid-task-owner';
    end if;
    if v_role not in ('owner', 'admin') then
      foreach v_vessel_id in array p_vessel_ids loop
        if not exists (
          select 1
          from public.sd_vessel_assignments a
          where a.workspace_id = p_workspace_id
            and a.vessel_id = v_vessel_id
            and a.user_id = v_owner_id
            and a.assignment_kind in ('manager', 'delegate')
            and a.is_active
        ) and not exists (
          select 1
          from public.sd_role_permissions rp
          where rp.workspace_id = p_workspace_id
            and rp.role = v_role
            and rp.permission_key = 'viewAllVessels'
            and rp.enabled
        ) then
          raise exception using errcode = 'P0001', message = 'invalid-task-owner';
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function public.sd_core_replace_task_relations(
  p_workspace_id uuid,
  p_task_id text,
  p_content jsonb,
  p_actor_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_vessels text[] := public.sd_core_text_array(p_content, 'vesselIds', false);
  v_categories text[] := public.sd_core_text_array(p_content, 'categories', true);
  v_departments text[] := public.sd_core_text_array(p_content, 'departments', true);
  v_owners uuid[] := public.sd_core_uuid_array(p_content, 'ownerUserIds', true);
  v_types text[] := public.sd_core_text_array(p_content, 'typeScopes', true);
  v_status text := btrim(p_content ->> 'status');
begin
  perform public.sd_core_assert_task_owners(
    p_workspace_id, v_owners, v_vessels
  );

  delete from public.sd_task_categories
  where workspace_id = p_workspace_id and task_id = p_task_id;
  insert into public.sd_task_categories(
    workspace_id, task_id, category, ordinal
  )
  select p_workspace_id, p_task_id, value, ordinal - 1
  from unnest(v_categories) with ordinality item(value, ordinal);

  delete from public.sd_task_departments
  where workspace_id = p_workspace_id and task_id = p_task_id;
  insert into public.sd_task_departments(
    workspace_id, task_id, department, ordinal
  )
  select p_workspace_id, p_task_id, value, ordinal - 1
  from unnest(v_departments) with ordinality item(value, ordinal);

  delete from public.sd_task_owners
  where workspace_id = p_workspace_id and task_id = p_task_id;
  insert into public.sd_task_owners(
    workspace_id, task_id, owner_id, ordinal
  )
  select p_workspace_id, p_task_id, value, ordinal - 1
  from unnest(v_owners) with ordinality item(value, ordinal);

  delete from public.sd_task_type_scopes
  where workspace_id = p_workspace_id and task_id = p_task_id;
  insert into public.sd_task_type_scopes(
    workspace_id, task_id, type_scope, ordinal
  )
  select p_workspace_id, p_task_id, value, ordinal - 1
  from unnest(v_types) with ordinality item(value, ordinal);

  update public.sd_task_vessels tv
  set is_active_scope = false,
      version = tv.version + 1,
      updated_at = clock_timestamp(),
      updated_by = p_actor_id
  where tv.workspace_id = p_workspace_id
    and tv.task_id = p_task_id
    and tv.is_active_scope
    and not (tv.vessel_id = any(v_vessels));

  insert into public.sd_task_vessels(
    workspace_id, task_id, vessel_id, is_active_scope,
    status, is_closed, version, updated_at, updated_by
  )
  select
    p_workspace_id, p_task_id, value, true,
    v_status, false, 1, clock_timestamp(), p_actor_id
  from unnest(v_vessels) value
  on conflict (workspace_id, task_id, vessel_id) do update
    set is_active_scope = true,
        version = case
          when public.sd_task_vessels.is_active_scope
          then public.sd_task_vessels.version
          else public.sd_task_vessels.version + 1
        end,
        updated_at = case
          when public.sd_task_vessels.is_active_scope
          then public.sd_task_vessels.updated_at
          else clock_timestamp()
        end,
        updated_by = case
          when public.sd_task_vessels.is_active_scope
          then public.sd_task_vessels.updated_by
          else p_actor_id
        end;
end;
$$;

create or replace function public.sd_core_emit_task_notifications(
  p_workspace_id uuid,
  p_task_id text,
  p_actor_id uuid,
  p_operation_id uuid,
  p_kind text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_description text;
  v_scope_count integer;
  v_is_ordinary_single boolean;
begin
  select t.description into v_description
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id;
  select count(*) into v_scope_count
  from public.sd_task_vessels tv
  where tv.workspace_id = p_workspace_id
    and tv.task_id = p_task_id
    and tv.is_active_scope;
  select (
    t.source_kind = 'ordinary'
    and not t.is_internal_control
    and v_scope_count = 1
  ) into v_is_ordinary_single
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id;

  insert into public.sd_notifications(
    workspace_id, id, recipient_id, vessel_id, task_id,
    kind, title, message, actor_id
  )
  select distinct
    p_workspace_id,
    'notice-' || md5(
      p_operation_id::text || ':' || recipients.user_id::text || ':' ||
      coalesce(recipients.vessel_id, '')
    ),
    recipients.user_id,
    recipients.vessel_id,
    p_task_id,
    p_kind,
    case p_kind
      when 'task_created' then '新增待辦｜'
      when 'task_deleted' then '刪除待辦｜'
      else '更新待辦｜'
    end || v_description,
    v_description,
    p_actor_id
  from (
    select a.user_id, tv.vessel_id
    from public.sd_task_vessels tv
    join public.sd_vessel_assignments a
      on a.workspace_id = tv.workspace_id
     and a.vessel_id = tv.vessel_id
     and a.is_active
     and (
       a.assignment_kind in ('manager', 'delegate')
       or (v_is_ordinary_single and a.assignment_kind = 'vessel_account')
     )
    join public.sd_memberships m
      on m.workspace_id = a.workspace_id
     and m.user_id = a.user_id
     and m.is_active
    where tv.workspace_id = p_workspace_id
      and tv.task_id = p_task_id
      and tv.is_active_scope
    union
    select o.owner_id, null::text
    from public.sd_task_owners o
    join public.sd_memberships m
      on m.workspace_id = o.workspace_id
     and m.user_id = o.owner_id
     and m.is_active
    where o.workspace_id = p_workspace_id
      and o.task_id = p_task_id
  ) recipients
  where recipients.user_id <> p_actor_id
  on conflict (workspace_id, id) do nothing;
end;
$$;

create or replace function public.command_ship_dynamics_create_ordinary_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_task_id text,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_content jsonb
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
  v_vessels text[];
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_actor is null or v_role is null
     or not public.sd_has_permission(p_workspace_id, 'createTasks') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if btrim(coalesce(p_task_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-task-id';
  end if;
  perform public.sd_core_validate_task_content(p_content);
  v_vessels := public.sd_core_text_array(p_content, 'vesselIds', false);
  if p_lease_key <> 'task-create:' || v_vessels[1] then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;
  if v_role = 'vessel' and (
    cardinality(v_vessels) <> 1
    or not public.sd_can_create_task_for_vessel(p_workspace_id, v_vessels[1])
  ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  v_request := jsonb_build_object(
    'taskId', p_task_id,
    'leaseKey', p_lease_key,
    'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'content', p_content
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'create_ordinary_task', 'task:' || p_task_id, v_request
  );
  if v_replay is not null then return v_replay; end if;

  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  perform public.sd_core_assert_task_scope(
    p_workspace_id, v_vessels, 'createTasks'
  );
  if exists (
    select 1 from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = p_task_id
  ) then
    raise exception using errcode = '23505', message = 'entity-exists';
  end if;

  insert into public.sd_tasks(
    workspace_id, id, description, status, priority,
    source_kind, source_type, attention_dimension,
    is_internal_control, is_abnormal, is_aware, is_closed,
    expected_date, report_date, equipment_subcategory,
    vessel_scope_mode, distribute_to_vessels,
    version, created_at, created_by, updated_at, updated_by
  ) values (
    p_workspace_id, p_task_id,
    btrim(p_content ->> 'description'),
    btrim(p_content ->> 'status'),
    p_content ->> 'priority',
    'ordinary', 'morning', 'task',
    false,
    (p_content ->> 'isAbnormal')::boolean,
    (p_content ->> 'isAware')::boolean,
    false,
    nullif(p_content ->> 'expectedDate', '')::date,
    nullif(p_content ->> 'reportDate', '')::date,
    btrim(p_content ->> 'equipmentSubcategory'),
    'vessels', false,
    1, clock_timestamp(), v_actor, clock_timestamp(), v_actor
  );
  perform public.sd_core_replace_task_relations(
    p_workspace_id, p_task_id, p_content, v_actor
  );
  insert into public.sd_task_status_events(
    workspace_id, id, task_id, status, actor_id, created_at
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'task-status'),
    p_task_id, btrim(p_content ->> 'status'), v_actor, clock_timestamp()
  );
  perform public.sd_core_emit_task_notifications(
    p_workspace_id, p_task_id, v_actor, p_operation_id, 'task_created'
  );

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'task', 'entityId', p_task_id, 'version', 1
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'create_ordinary_task', 'task:' || p_task_id, v_request,
    '{}'::jsonb,
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'create_ordinary_task', 'task', p_task_id,
    jsonb_build_object('version', 1, 'vesselIds', to_jsonb(v_vessels))
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_update_ordinary_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_task_id text,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_content jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.sd_tasks%rowtype;
  v_old_vessels text[];
  v_new_vessels text[];
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_version bigint;
  v_status_changed boolean;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) in ('vessel')
     or not public.sd_has_permission(p_workspace_id, 'editBusinessContent') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_core_validate_task_content(p_content);
  if p_lease_key <> 'task:' || p_task_id then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;
  v_request := jsonb_build_object(
    'taskId', p_task_id, 'baseVersion', p_base_version,
    'leaseKey', p_lease_key, 'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token, 'content', p_content
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'update_ordinary_task', 'task:' || p_task_id, v_request
  );
  if v_replay is not null then return v_replay; end if;

  if not public.sd_can_edit_task(p_workspace_id, p_task_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id
  for update;
  if not found or v_task.is_deleted then
    raise exception using errcode = 'P0001', message = 'entity-not-found';
  end if;
  if v_task.source_kind <> 'ordinary'
     or v_task.source_type <> 'morning'
     or v_task.is_internal_control
     or v_task.source_meeting_id is not null
     or v_task.source_meeting_item_id is not null then
    raise exception using
      errcode = 'P0001', message = 'ordinary-provenance-required';
  end if;
  if v_task.version <> p_base_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  select coalesce(array_agg(tv.vessel_id order by tv.vessel_id), '{}'::text[])
  into v_old_vessels
  from public.sd_task_vessels tv
  where tv.workspace_id = p_workspace_id
    and tv.task_id = p_task_id
    and tv.is_active_scope;
  v_new_vessels := public.sd_core_text_array(p_content, 'vesselIds', false);
  perform public.sd_core_assert_task_scope(
    p_workspace_id,
    (
      select array_agg(distinct value order by value)
      from unnest(v_old_vessels || v_new_vessels) value
    ),
    'editBusinessContent'
  );
  v_status_changed := v_task.status <> btrim(p_content ->> 'status');

  update public.sd_tasks t
  set description = btrim(p_content ->> 'description'),
      status = btrim(p_content ->> 'status'),
      priority = p_content ->> 'priority',
      expected_date = nullif(p_content ->> 'expectedDate', '')::date,
      report_date = nullif(p_content ->> 'reportDate', '')::date,
      equipment_subcategory = btrim(p_content ->> 'equipmentSubcategory'),
      is_aware = (p_content ->> 'isAware')::boolean,
      is_abnormal = (p_content ->> 'isAbnormal')::boolean,
      version = t.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where t.workspace_id = p_workspace_id
    and t.id = p_task_id
    and t.version = p_base_version
  returning t.version into v_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  perform public.sd_core_replace_task_relations(
    p_workspace_id, p_task_id, p_content, v_actor
  );
  if v_status_changed then
    insert into public.sd_task_status_events(
      workspace_id, id, task_id, status, actor_id, created_at
    ) values (
      p_workspace_id, public.sd_core_event_id(p_operation_id, 'task-status'),
      p_task_id, btrim(p_content ->> 'status'), v_actor, clock_timestamp()
    );
  end if;
  perform public.sd_core_emit_task_notifications(
    p_workspace_id, p_task_id, v_actor, p_operation_id, 'task_updated'
  );

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'task', 'entityId', p_task_id, 'version', v_version
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'update_ordinary_task', 'task:' || p_task_id, v_request,
    jsonb_build_object('task', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'update_ordinary_task', 'task', p_task_id,
    jsonb_build_object(
      'version', v_version,
      'oldVesselIds', to_jsonb(v_old_vessels),
      'newVesselIds', to_jsonb(v_new_vessels)
    )
  );
  return v_result;
end;
$$;

create or replace function public.sd_core_transition_ordinary_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_task_id text,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_transition text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.sd_tasks%rowtype;
  v_command text;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_version bigint;
  v_status text;
begin
  if p_transition not in ('close', 'reopen') then
    raise exception using errcode = 'P0001', message = 'unsupported-transition';
  end if;
  v_command := p_transition || '_ordinary_task';
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) in ('vessel')
     or not public.sd_has_permission(p_workspace_id, 'closeTasks') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_lease_key <> 'task:' || p_task_id then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;
  v_request := jsonb_build_object(
    'taskId', p_task_id, 'baseVersion', p_base_version,
    'leaseKey', p_lease_key, 'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    v_command, 'task:' || p_task_id, v_request
  );
  if v_replay is not null then return v_replay; end if;

  if not public.sd_can_edit_task(p_workspace_id, p_task_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id
  for update;
  if not found or v_task.is_deleted then
    raise exception using errcode = 'P0001', message = 'entity-not-found';
  end if;
  if v_task.source_kind <> 'ordinary'
     or v_task.source_type <> 'morning'
     or v_task.is_internal_control
     or v_task.source_meeting_id is not null
     or v_task.source_meeting_item_id is not null then
    raise exception using
      errcode = 'P0001', message = 'ordinary-provenance-required';
  end if;
  if v_task.version <> p_base_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if (p_transition = 'close' and v_task.is_closed)
     or (p_transition = 'reopen' and not v_task.is_closed) then
    raise exception using errcode = 'P0001', message = 'invalid-task-transition';
  end if;

  if p_transition = 'close' then
    v_status := '已結案';
    update public.sd_tasks t
    set status_before_close = t.status,
        status = v_status,
        is_closed = true,
        closed_date = current_date,
        closed_by = v_actor,
        version = t.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where t.workspace_id = p_workspace_id
      and t.id = p_task_id
      and t.version = p_base_version
    returning t.version into v_version;
  else
    v_status := coalesce(nullif(v_task.status_before_close, ''), '待處理');
    update public.sd_tasks t
    set status = v_status,
        status_before_close = null,
        is_closed = false,
        closed_date = null,
        closed_by = null,
        version = t.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where t.workspace_id = p_workspace_id
      and t.id = p_task_id
      and t.version = p_base_version
    returning t.version into v_version;
  end if;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  insert into public.sd_task_status_events(
    workspace_id, id, task_id, status, actor_id, created_at
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'task-status'),
    p_task_id, v_status, v_actor, clock_timestamp()
  );
  perform public.sd_core_emit_task_notifications(
    p_workspace_id, p_task_id, v_actor, p_operation_id, 'task_updated'
  );
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'task', 'entityId', p_task_id,
    'version', v_version, 'isClosed', p_transition = 'close'
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    v_command, 'task:' || p_task_id, v_request,
    jsonb_build_object('task', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, v_command, 'task', p_task_id,
    jsonb_build_object('version', v_version, 'status', v_status)
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_close_ordinary_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_task_id text,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint
)
returns jsonb
language sql
volatile
security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_transition_ordinary_task(
    p_operation_id, p_workspace_id, p_task_id, p_base_version,
    p_lease_key, p_owner_session, p_fencing_token, 'close'
  )
$$;

create or replace function public.command_ship_dynamics_reopen_ordinary_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_task_id text,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint
)
returns jsonb
language sql
volatile
security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_transition_ordinary_task(
    p_operation_id, p_workspace_id, p_task_id, p_base_version,
    p_lease_key, p_owner_session, p_fencing_token, 'reopen'
  )
$$;

create or replace function public.command_ship_dynamics_delete_ordinary_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_task_id text,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.sd_tasks%rowtype;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_version bigint;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) not in ('owner', 'admin')
     or not public.sd_has_permission(p_workspace_id, 'deleteTasks') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_lease_key <> 'task:' || p_task_id then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;
  v_request := jsonb_build_object(
    'taskId', p_task_id, 'baseVersion', p_base_version,
    'leaseKey', p_lease_key, 'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'delete_ordinary_task', 'task:' || p_task_id, v_request
  );
  if v_replay is not null then return v_replay; end if;
  if not public.sd_can_edit_task(p_workspace_id, p_task_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id
  for update;
  if not found or v_task.is_deleted then
    raise exception using errcode = 'P0001', message = 'entity-not-found';
  end if;
  if v_task.source_kind <> 'ordinary'
     or v_task.source_type <> 'morning'
     or v_task.is_internal_control
     or v_task.source_meeting_id is not null
     or v_task.source_meeting_item_id is not null then
    raise exception using
      errcode = 'P0001', message = 'ordinary-provenance-required';
  end if;
  if v_task.version <> p_base_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  perform public.sd_core_emit_task_notifications(
    p_workspace_id, p_task_id, v_actor, p_operation_id, 'task_deleted'
  );
  update public.sd_tasks t
  set status_before_close = t.status,
      status = '已刪除',
      is_deleted = true,
      deleted_at = clock_timestamp(),
      deleted_by = v_actor,
      version = t.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where t.workspace_id = p_workspace_id
    and t.id = p_task_id
    and t.version = p_base_version
  returning t.version into v_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  update public.sd_task_vessels tv
  set is_active_scope = false,
      version = tv.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where tv.workspace_id = p_workspace_id
    and tv.task_id = p_task_id
    and tv.is_active_scope;
  insert into public.sd_task_status_events(
    workspace_id, id, task_id, status, actor_id, created_at
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'task-status'),
    p_task_id, '已刪除', v_actor, clock_timestamp()
  );
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'task', 'entityId', p_task_id,
    'version', v_version, 'deleted', true
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'delete_ordinary_task', 'task:' || p_task_id, v_request,
    jsonb_build_object('task', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'delete_ordinary_task', 'task', p_task_id,
    jsonb_build_object('version', v_version)
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_update_task_vessel_progress(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_task_id text,
  p_vessel_id text,
  p_task_base_version bigint,
  p_progress_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_status text,
  p_is_closed boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.sd_tasks%rowtype;
  v_progress public.sd_task_vessels%rowtype;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_progress_version bigint;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) in ('vessel')
     or not public.sd_has_permission(p_workspace_id, 'editBusinessContent')
     or not public.sd_can_mutate_vessel(p_workspace_id, p_vessel_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if btrim(coalesce(p_status, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-status';
  end if;
  if p_lease_key <> 'task-progress:' || p_task_id || ':' || p_vessel_id then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;
  v_request := jsonb_build_object(
    'taskId', p_task_id, 'vesselId', p_vessel_id,
    'taskBaseVersion', p_task_base_version,
    'progressBaseVersion', p_progress_base_version,
    'leaseKey', p_lease_key, 'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'status', p_status, 'isClosed', p_is_closed
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'update_task_vessel_progress',
    'task-progress:' || p_task_id || ':' || p_vessel_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id
  for update;
  if not found or v_task.is_deleted then
    raise exception using errcode = 'P0001', message = 'entity-not-found';
  end if;
  if v_task.source_kind <> 'ordinary'
     or v_task.source_type <> 'morning'
     or v_task.is_internal_control
     or v_task.source_meeting_id is not null
     or v_task.source_meeting_item_id is not null then
    raise exception using
      errcode = 'P0001', message = 'ordinary-provenance-required';
  end if;
  if v_task.version <> p_task_base_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  select * into v_progress
  from public.sd_task_vessels tv
  where tv.workspace_id = p_workspace_id
    and tv.task_id = p_task_id
    and tv.vessel_id = p_vessel_id
    and tv.is_active_scope
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'progress-not-found';
  end if;
  if v_progress.version <> p_progress_base_version then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if v_progress.is_closed <> p_is_closed
     and not public.sd_has_permission(p_workspace_id, 'closeTasks') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if v_progress.is_closed and p_is_closed
     and v_progress.status <> btrim(p_status) then
    raise exception using errcode = 'P0001', message = 'closed-progress-immutable';
  end if;

  update public.sd_task_vessels tv
  set status = btrim(p_status),
      is_closed = p_is_closed,
      closed_date = case
        when p_is_closed and not v_progress.is_closed then current_date
        when p_is_closed then v_progress.closed_date
        else null
      end,
      closed_by = case
        when p_is_closed and not v_progress.is_closed then v_actor
        when p_is_closed then v_progress.closed_by
        else null
      end,
      version = tv.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where tv.workspace_id = p_workspace_id
    and tv.task_id = p_task_id
    and tv.vessel_id = p_vessel_id
    and tv.version = p_progress_base_version
  returning tv.version into v_progress_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  insert into public.sd_task_vessel_status_events(
    workspace_id, id, task_id, vessel_id,
    status, is_closed, actor_id, created_at
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'progress-status'),
    p_task_id, p_vessel_id, btrim(p_status), p_is_closed,
    v_actor, clock_timestamp()
  );
  perform public.sd_core_emit_task_notifications(
    p_workspace_id, p_task_id, v_actor, p_operation_id, 'task_updated'
  );
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'task-progress',
    'entityId', p_task_id || ':' || p_vessel_id,
    'taskVersion', p_task_base_version,
    'progressVersion', v_progress_version,
    'isClosed', p_is_closed
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'update_task_vessel_progress',
    'task-progress:' || p_task_id || ':' || p_vessel_id,
    v_request,
    jsonb_build_object(
      'task', p_task_base_version,
      'progress', p_progress_base_version
    ),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'update_task_vessel_progress', 'task-progress',
    p_task_id || ':' || p_vessel_id,
    jsonb_build_object(
      'taskVersion', p_task_base_version,
      'progressVersion', v_progress_version,
      'isClosed', p_is_closed
    )
  );
  return v_result;
end;
$$;

create or replace function public.sd_core_validate_vessel_profile(p_profile jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_tags text[];
begin
  perform public.sd_core_assert_json_keys(
    p_profile,
    array['name', 'shortName', 'fullName', 'shipType', 'fleetCategory', 'fleetTags'],
    'invalid-vessel-profile'
  );
  if not (
    p_profile ? 'name' and p_profile ? 'shortName'
    and p_profile ? 'fullName' and p_profile ? 'shipType'
    and p_profile ? 'fleetCategory' and p_profile ? 'fleetTags'
  ) or jsonb_typeof(p_profile -> 'name') <> 'string'
     or jsonb_typeof(p_profile -> 'shortName') <> 'string'
     or jsonb_typeof(p_profile -> 'fullName') <> 'string'
     or jsonb_typeof(p_profile -> 'shipType') <> 'string'
     or jsonb_typeof(p_profile -> 'fleetCategory') <> 'string'
     or (
       btrim(coalesce(p_profile ->> 'name', '')) = ''
       and btrim(coalesce(p_profile ->> 'shortName', '')) = ''
     ) then
    raise exception using
      errcode = 'P0001', message = 'invalid-vessel-profile';
  end if;
  v_tags := public.sd_core_text_array(p_profile, 'fleetTags', true);
end;
$$;

create or replace function public.sd_core_validate_vessel_value(
  p_field text,
  p_value jsonb
)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_items jsonb;
  v_attention text[];
begin
  if p_field = 'position' then
    perform public.sd_core_assert_json_keys(
      p_value,
      array[
        'source', 'location', 'speedKnots', 'navigationStatus',
        'lastPort', 'nextPort', 'eta', 'etb', 'etd', 'manualRemark'
      ],
      'invalid-vessel-position'
    );
    if not (
      p_value ? 'source' and p_value ? 'location'
      and p_value ? 'speedKnots' and p_value ? 'navigationStatus'
      and p_value ? 'lastPort' and p_value ? 'nextPort'
      and p_value ? 'eta' and p_value ? 'etb' and p_value ? 'etd'
      and p_value ? 'manualRemark'
    ) or jsonb_typeof(p_value -> 'speedKnots') <> 'number'
       or (p_value ->> 'speedKnots')::numeric < 0 then
      raise exception using
        errcode = 'P0001', message = 'invalid-vessel-position';
    end if;
  elsif p_field = 'cargo' then
    perform public.sd_core_assert_json_keys(
      p_value,
      array['source', 'loadStatus', 'name', 'quantity', 'items'],
      'invalid-vessel-cargo'
    );
    if not (
      p_value ? 'source' and p_value ? 'loadStatus'
      and p_value ? 'name' and p_value ? 'quantity' and p_value ? 'items'
    ) or jsonb_typeof(p_value -> 'items') <> 'array' then
      raise exception using errcode = 'P0001', message = 'invalid-vessel-cargo';
    end if;
    for v_items in select value from jsonb_array_elements(p_value -> 'items')
    loop
      perform public.sd_core_assert_json_keys(
        v_items, array['name', 'quantity'], 'invalid-vessel-cargo'
      );
      if not (v_items ? 'name' and v_items ? 'quantity')
         or jsonb_typeof(v_items -> 'name') <> 'string'
         or jsonb_typeof(v_items -> 'quantity') <> 'string' then
        raise exception using
          errcode = 'P0001', message = 'invalid-vessel-cargo';
      end if;
    end loop;
  elsif p_field = 'note' then
    perform public.sd_core_assert_json_keys(
      p_value,
      array['statusList', 'recentDynamics', 'subsequentDynamics'],
      'invalid-vessel-note'
    );
    if not (
      p_value ? 'statusList' and p_value ? 'recentDynamics'
      and p_value ? 'subsequentDynamics'
    ) or jsonb_typeof(p_value -> 'statusList') <> 'array'
       or jsonb_typeof(p_value -> 'recentDynamics') <> 'string'
       or jsonb_typeof(p_value -> 'subsequentDynamics') <> 'string' then
      raise exception using errcode = 'P0001', message = 'invalid-vessel-note';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_value -> 'statusList') item
      where jsonb_typeof(item) <> 'string'
    ) then
      raise exception using errcode = 'P0001', message = 'invalid-vessel-note';
    end if;
  elsif p_field = 'weekly_attention' then
    if p_value is null or jsonb_typeof(p_value) <> 'array' then
      raise exception using
        errcode = 'P0001', message = 'invalid-weekly-attention';
    end if;
    v_attention := public.sd_core_text_array(
      jsonb_build_object('values', p_value), 'values', true
    );
  else
    raise exception using errcode = 'P0001', message = 'unsupported-vessel-field';
  end if;
end;
$$;

create or replace function public.sd_core_update_vessel_content(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_vessel_id text,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_value jsonb,
  p_field text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_command text := 'update_vessel_' || p_field;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_version bigint;
  v_tags text[];
  v_attention text[];
  v_timestamp jsonb := jsonb_build_object(
    'updatedAt', to_jsonb(clock_timestamp()::text)
  );
begin
  if v_actor is null
     or (
       p_field = 'profile'
       and (
         public.sd_membership_role(p_workspace_id) not in ('owner', 'admin')
         or not public.sd_has_permission(p_workspace_id, 'manageVessels')
       )
     )
     or (
       p_field <> 'profile'
       and not public.sd_can_edit_vessel(p_workspace_id, p_vessel_id)
     ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_lease_key <> 'vessel:' || p_vessel_id then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;
  if p_field = 'profile' then
    perform public.sd_core_validate_vessel_profile(p_value);
  else
    perform public.sd_core_validate_vessel_value(p_field, p_value);
  end if;
  v_request := jsonb_build_object(
    'vesselId', p_vessel_id, 'baseVersion', p_base_version,
    'leaseKey', p_lease_key, 'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token, 'value', p_value
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    v_command, 'vessel:' || p_vessel_id, v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );

  if p_field = 'profile' then
    v_tags := public.sd_core_text_array(p_value, 'fleetTags', true);
    update public.sd_vessels v
    set name = coalesce(
          nullif(btrim(p_value ->> 'name'), ''),
          btrim(p_value ->> 'shortName')
        ),
        short_name = coalesce(
          nullif(btrim(p_value ->> 'shortName'), ''),
          btrim(p_value ->> 'name')
        ),
        full_name = btrim(p_value ->> 'fullName'),
        ship_type = btrim(p_value ->> 'shipType'),
        fleet_category = btrim(p_value ->> 'fleetCategory'),
        fleet_tags = v_tags,
        version = v.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where v.workspace_id = p_workspace_id
      and v.id = p_vessel_id
      and v.is_active
      and v.version = p_base_version
    returning v.version into v_version;
  elsif p_field = 'position' then
    update public.sd_vessels v
    set position = p_value || v_timestamp,
        version = v.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where v.workspace_id = p_workspace_id
      and v.id = p_vessel_id
      and v.is_active
      and v.version = p_base_version
    returning v.version into v_version;
  elsif p_field = 'cargo' then
    update public.sd_vessels v
    set cargo = p_value || v_timestamp,
        version = v.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where v.workspace_id = p_workspace_id
      and v.id = p_vessel_id
      and v.is_active
      and v.version = p_base_version
    returning v.version into v_version;
  elsif p_field = 'note' then
    update public.sd_vessels v
    set note = p_value || v_timestamp,
        version = v.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where v.workspace_id = p_workspace_id
      and v.id = p_vessel_id
      and v.is_active
      and v.version = p_base_version
    returning v.version into v_version;
  elsif p_field = 'weekly_attention' then
    v_attention := public.sd_core_text_array(
      jsonb_build_object('values', p_value), 'values', true
    );
    update public.sd_vessels v
    set weekly_attention = v_attention,
        version = v.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where v.workspace_id = p_workspace_id
      and v.id = p_vessel_id
      and v.is_active
      and v.version = p_base_version
    returning v.version into v_version;
  end if;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'vessel', 'entityId', p_vessel_id,
    'version', v_version
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    v_command, 'vessel:' || p_vessel_id, v_request,
    jsonb_build_object('vessel', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, v_command, 'vessel', p_vessel_id,
    jsonb_build_object('version', v_version)
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_update_vessel_profile(
  p_operation_id uuid, p_workspace_id uuid, p_vessel_id text,
  p_base_version bigint, p_lease_key text, p_owner_session uuid,
  p_fencing_token bigint, p_profile jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_update_vessel_content(
    p_operation_id, p_workspace_id, p_vessel_id, p_base_version,
    p_lease_key, p_owner_session, p_fencing_token, p_profile, 'profile'
  )
$$;

create or replace function public.command_ship_dynamics_update_vessel_position(
  p_operation_id uuid, p_workspace_id uuid, p_vessel_id text,
  p_base_version bigint, p_lease_key text, p_owner_session uuid,
  p_fencing_token bigint, p_position jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_update_vessel_content(
    p_operation_id, p_workspace_id, p_vessel_id, p_base_version,
    p_lease_key, p_owner_session, p_fencing_token, p_position, 'position'
  )
$$;

create or replace function public.command_ship_dynamics_update_vessel_cargo(
  p_operation_id uuid, p_workspace_id uuid, p_vessel_id text,
  p_base_version bigint, p_lease_key text, p_owner_session uuid,
  p_fencing_token bigint, p_cargo jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_update_vessel_content(
    p_operation_id, p_workspace_id, p_vessel_id, p_base_version,
    p_lease_key, p_owner_session, p_fencing_token, p_cargo, 'cargo'
  )
$$;

create or replace function public.command_ship_dynamics_update_vessel_note(
  p_operation_id uuid, p_workspace_id uuid, p_vessel_id text,
  p_base_version bigint, p_lease_key text, p_owner_session uuid,
  p_fencing_token bigint, p_note jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_update_vessel_content(
    p_operation_id, p_workspace_id, p_vessel_id, p_base_version,
    p_lease_key, p_owner_session, p_fencing_token, p_note, 'note'
  )
$$;

create or replace function public.command_ship_dynamics_update_vessel_weekly_attention(
  p_operation_id uuid, p_workspace_id uuid, p_vessel_id text,
  p_base_version bigint, p_lease_key text, p_owner_session uuid,
  p_fencing_token bigint, p_weekly_attention jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_update_vessel_content(
    p_operation_id, p_workspace_id, p_vessel_id, p_base_version,
    p_lease_key, p_owner_session, p_fencing_token,
    p_weekly_attention, 'weekly_attention'
  )
$$;

create or replace function public.command_ship_dynamics_create_vessel(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_vessel_id text,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_profile jsonb
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
  v_tags text[];
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) not in ('owner', 'admin')
     or not public.sd_has_permission(p_workspace_id, 'manageVessels') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if btrim(coalesce(p_vessel_id, '')) = ''
     or p_lease_key <> 'vessel:' || p_vessel_id then
    raise exception using errcode = 'P0001', message = 'invalid-vessel-id';
  end if;
  perform public.sd_core_validate_vessel_profile(p_profile);
  v_request := jsonb_build_object(
    'vesselId', p_vessel_id, 'leaseKey', p_lease_key,
    'ownerSession', p_owner_session, 'fencingToken', p_fencing_token,
    'profile', p_profile
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'create_vessel', 'vessel:' || p_vessel_id, v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  if exists (
    select 1 from public.sd_vessels v
    where v.workspace_id = p_workspace_id and v.id = p_vessel_id
  ) then
    raise exception using errcode = '23505', message = 'entity-exists';
  end if;
  v_tags := public.sd_core_text_array(p_profile, 'fleetTags', true);
  insert into public.sd_vessels(
    workspace_id, id, name, short_name, full_name, ship_type,
    fleet_category, fleet_tags, position, cargo, note,
    weekly_attention, is_active, version,
    created_at, created_by, updated_at, updated_by
  ) values (
    p_workspace_id, p_vessel_id,
    coalesce(
      nullif(btrim(p_profile ->> 'name'), ''),
      btrim(p_profile ->> 'shortName')
    ),
    coalesce(
      nullif(btrim(p_profile ->> 'shortName'), ''),
      btrim(p_profile ->> 'name')
    ),
    btrim(p_profile ->> 'fullName'),
    btrim(p_profile ->> 'shipType'),
    btrim(p_profile ->> 'fleetCategory'),
    v_tags,
    jsonb_build_object('updatedAt', clock_timestamp()::text),
    jsonb_build_object('items', jsonb_build_array(), 'updatedAt', clock_timestamp()::text),
    jsonb_build_object('statusList', jsonb_build_array(), 'updatedAt', clock_timestamp()::text),
    '{}'::text[], true, 1,
    clock_timestamp(), v_actor, clock_timestamp(), v_actor
  );
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'vessel', 'entityId', p_vessel_id, 'version', 1
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'create_vessel', 'vessel:' || p_vessel_id, v_request,
    '{}'::jsonb,
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'create_vessel', 'vessel', p_vessel_id,
    jsonb_build_object('version', 1)
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_replace_vessel_assignments(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_vessel_id text,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_assignments jsonb
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
  v_version bigint;
  v_item jsonb;
  v_user_id uuid;
  v_kind text;
  v_active boolean;
  v_role text;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) not in ('owner', 'admin')
     or not public.sd_has_permission(p_workspace_id, 'manageVessels') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_lease_key <> 'vessel:' || p_vessel_id
     or p_assignments is null
     or jsonb_typeof(p_assignments) <> 'array' then
    raise exception using
      errcode = 'P0001', message = 'invalid-vessel-assignments';
  end if;
  if (
    select count(*) from jsonb_array_elements(p_assignments)
  ) <> (
    select count(distinct item ->> 'userId')
    from jsonb_array_elements(p_assignments) item
  ) then
    raise exception using
      errcode = 'P0001', message = 'duplicate-vessel-assignment';
  end if;
  for v_item in select value from jsonb_array_elements(p_assignments)
  loop
    perform public.sd_core_assert_json_keys(
      v_item,
      array['userId', 'assignmentKind', 'isActive'],
      'invalid-vessel-assignments'
    );
    if not (
      v_item ? 'userId' and v_item ? 'assignmentKind' and v_item ? 'isActive'
    ) or jsonb_typeof(v_item -> 'isActive') <> 'boolean' then
      raise exception using
        errcode = 'P0001', message = 'invalid-vessel-assignments';
    end if;
    begin
      v_user_id := (v_item ->> 'userId')::uuid;
    exception when invalid_text_representation then
      raise exception using
        errcode = 'P0001', message = 'invalid-vessel-assignments';
    end;
    v_kind := v_item ->> 'assignmentKind';
    v_active := (v_item ->> 'isActive')::boolean;
    if v_kind not in ('manager', 'delegate', 'vessel_account') then
      raise exception using
        errcode = 'P0001', message = 'invalid-vessel-assignments';
    end if;
    select m.role into v_role
    from public.sd_memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = v_user_id
      and m.is_active;
    if v_role is null
       or (v_kind = 'vessel_account' and v_role <> 'vessel')
       or (v_kind in ('manager', 'delegate') and v_role not in ('admin', 'operator')) then
      raise exception using
        errcode = 'P0001', message = 'invalid-vessel-assignment-role';
    end if;
  end loop;

  v_request := jsonb_build_object(
    'vesselId', p_vessel_id, 'baseVersion', p_base_version,
    'leaseKey', p_lease_key, 'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token, 'assignments', p_assignments
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'replace_vessel_assignments', 'vessel:' || p_vessel_id, v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  perform 1
  from public.sd_vessels v
  where v.workspace_id = p_workspace_id
    and v.id = p_vessel_id
    and v.is_active
    and v.version = p_base_version
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  update public.sd_vessel_assignments a
  set is_active = false,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where a.workspace_id = p_workspace_id
    and a.vessel_id = p_vessel_id
    and a.is_active;
  for v_item in select value from jsonb_array_elements(p_assignments)
  loop
    v_user_id := (v_item ->> 'userId')::uuid;
    v_kind := v_item ->> 'assignmentKind';
    v_active := (v_item ->> 'isActive')::boolean;
    insert into public.sd_vessel_assignments(
      workspace_id, vessel_id, user_id, assignment_kind,
      is_active, created_at, updated_at, updated_by
    ) values (
      p_workspace_id, p_vessel_id, v_user_id, v_kind,
      v_active, clock_timestamp(), clock_timestamp(), v_actor
    )
    on conflict (workspace_id, vessel_id, user_id, assignment_kind) do update
      set is_active = excluded.is_active,
          updated_at = clock_timestamp(),
          updated_by = v_actor;
  end loop;
  update public.sd_vessels v
  set version = v.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where v.workspace_id = p_workspace_id
    and v.id = p_vessel_id
    and v.version = p_base_version
  returning v.version into v_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'vessel', 'entityId', p_vessel_id,
    'version', v_version
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'replace_vessel_assignments', 'vessel:' || p_vessel_id,
    v_request, jsonb_build_object('vessel', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'replace_vessel_assignments', 'vessel', p_vessel_id,
    jsonb_build_object(
      'version', v_version,
      'assignmentCount', jsonb_array_length(p_assignments)
    )
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_disable_vessel(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_vessel_id text,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint
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
  v_version bigint;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) not in ('owner', 'admin')
     or not public.sd_has_permission(p_workspace_id, 'manageVessels') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_lease_key <> 'vessel:' || p_vessel_id then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;
  v_request := jsonb_build_object(
    'vesselId', p_vessel_id, 'baseVersion', p_base_version,
    'leaseKey', p_lease_key, 'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'disable_vessel', 'vessel:' || p_vessel_id, v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  update public.sd_vessels v
  set is_active = false,
      version = v.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where v.workspace_id = p_workspace_id
    and v.id = p_vessel_id
    and v.is_active
    and v.version = p_base_version
  returning v.version into v_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  update public.sd_vessel_assignments a
  set is_active = false,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where a.workspace_id = p_workspace_id
    and a.vessel_id = p_vessel_id
    and a.is_active;
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'vessel', 'entityId', p_vessel_id,
    'version', v_version, 'disabled', true
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'disable_vessel', 'vessel:' || p_vessel_id, v_request,
    jsonb_build_object('vessel', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'disable_vessel', 'vessel', p_vessel_id,
    jsonb_build_object('version', v_version)
  );
  return v_result;
end;
$$;

create or replace function public.sd_core_validate_vessel_patch(p_patch jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  perform public.sd_core_assert_json_keys(
    p_patch,
    array['profile', 'position', 'cargo', 'note', 'weeklyAttention'],
    'invalid-vessel-patch'
  );
  if p_patch = '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'invalid-vessel-patch';
  end if;
  if p_patch ? 'profile' then
    perform public.sd_core_validate_vessel_profile(p_patch -> 'profile');
  end if;
  if p_patch ? 'position' then
    perform public.sd_core_validate_vessel_value('position', p_patch -> 'position');
  end if;
  if p_patch ? 'cargo' then
    perform public.sd_core_validate_vessel_value('cargo', p_patch -> 'cargo');
  end if;
  if p_patch ? 'note' then
    perform public.sd_core_validate_vessel_value('note', p_patch -> 'note');
  end if;
  if p_patch ? 'weeklyAttention' then
    perform public.sd_core_validate_vessel_value(
      'weekly_attention', p_patch -> 'weeklyAttention'
    );
  end if;
end;
$$;

create or replace function public.command_ship_dynamics_batch_update_vessels(
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
  v_patch jsonb;
  v_profile jsonb;
  v_vessel_id text;
  v_base_version bigint;
  v_lease_key text;
  v_owner_session uuid;
  v_fencing_token bigint;
  v_tags text[];
  v_attention text[];
  v_timestamp jsonb;
  v_count integer;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) in ('vessel')
     or not public.sd_has_permission(p_workspace_id, 'editBusinessContent')
     or p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if (
    select count(*) from jsonb_array_elements(p_items)
  ) <> (
    select count(distinct item ->> 'vesselId')
    from jsonb_array_elements(p_items) item
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-batch-target';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    perform public.sd_core_assert_json_keys(
      v_item,
      array[
        'vesselId', 'baseVersion', 'leaseKey',
        'ownerSession', 'fencingToken', 'patch'
      ],
      'invalid-batch-vessel-item'
    );
    if not (
      v_item ? 'vesselId' and v_item ? 'baseVersion'
      and v_item ? 'leaseKey' and v_item ? 'ownerSession'
      and v_item ? 'fencingToken' and v_item ? 'patch'
    ) then
      raise exception using
        errcode = 'P0001', message = 'invalid-batch-vessel-item';
    end if;
    begin
      v_owner_session := (v_item ->> 'ownerSession')::uuid;
      v_base_version := (v_item ->> 'baseVersion')::bigint;
      v_fencing_token := (v_item ->> 'fencingToken')::bigint;
    exception when others then
      raise exception using
        errcode = 'P0001', message = 'invalid-batch-vessel-item';
    end;
    v_vessel_id := v_item ->> 'vesselId';
    v_lease_key := v_item ->> 'leaseKey';
    if btrim(coalesce(v_vessel_id, '')) = ''
       or v_lease_key <> 'vessel:' || v_vessel_id
       or not public.sd_can_edit_vessel(p_workspace_id, v_vessel_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
    perform public.sd_core_validate_vessel_patch(v_item -> 'patch');
    if (v_item -> 'patch') ? 'profile'
       and (
         public.sd_membership_role(p_workspace_id) not in ('owner', 'admin')
         or not public.sd_has_permission(p_workspace_id, 'manageVessels')
       ) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  end loop;

  v_request := jsonb_build_object('items', p_items);
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'batch_update_vessels',
    'vessel-batch:' || md5(p_items::text),
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by value ->> 'vesselId'
  loop
    perform public.sd_assert_live_lease(
      p_workspace_id,
      v_item ->> 'leaseKey',
      (v_item ->> 'ownerSession')::uuid,
      (v_item ->> 'fencingToken')::bigint
    );
  end loop;
  perform 1
  from public.sd_vessels v
  where v.workspace_id = p_workspace_id
    and v.id in (
      select item ->> 'vesselId' from jsonb_array_elements(p_items) item
    )
  order by v.id
  for update;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by value ->> 'vesselId'
  loop
    v_vessel_id := v_item ->> 'vesselId';
    v_base_version := (v_item ->> 'baseVersion')::bigint;
    if not exists (
      select 1 from public.sd_vessels v
      where v.workspace_id = p_workspace_id
        and v.id = v_vessel_id
        and v.is_active
        and v.version = v_base_version
    ) then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
  end loop;

  v_timestamp := jsonb_build_object(
    'updatedAt', to_jsonb(clock_timestamp()::text)
  );
  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by value ->> 'vesselId'
  loop
    v_vessel_id := v_item ->> 'vesselId';
    v_base_version := (v_item ->> 'baseVersion')::bigint;
    v_patch := v_item -> 'patch';
    v_profile := v_patch -> 'profile';
    if v_profile is not null then
      v_tags := public.sd_core_text_array(v_profile, 'fleetTags', true);
    else
      v_tags := null;
    end if;
    if v_patch ? 'weeklyAttention' then
      v_attention := public.sd_core_text_array(
        jsonb_build_object('values', v_patch -> 'weeklyAttention'),
        'values', true
      );
    else
      v_attention := null;
    end if;
    update public.sd_vessels v
    set name = case when v_profile is null then v.name else
          coalesce(
            nullif(btrim(v_profile ->> 'name'), ''),
            btrim(v_profile ->> 'shortName')
          )
        end,
        short_name = case when v_profile is null then v.short_name else
          coalesce(
            nullif(btrim(v_profile ->> 'shortName'), ''),
            btrim(v_profile ->> 'name')
          )
        end,
        full_name = case when v_profile is null then v.full_name
          else btrim(v_profile ->> 'fullName') end,
        ship_type = case when v_profile is null then v.ship_type
          else btrim(v_profile ->> 'shipType') end,
        fleet_category = case when v_profile is null then v.fleet_category
          else btrim(v_profile ->> 'fleetCategory') end,
        fleet_tags = coalesce(v_tags, v.fleet_tags),
        position = case when v_patch ? 'position'
          then (v_patch -> 'position') || v_timestamp else v.position end,
        cargo = case when v_patch ? 'cargo'
          then (v_patch -> 'cargo') || v_timestamp else v.cargo end,
        note = case when v_patch ? 'note'
          then (v_patch -> 'note') || v_timestamp else v.note end,
        weekly_attention = coalesce(v_attention, v.weekly_attention),
        version = v.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where v.workspace_id = p_workspace_id
      and v.id = v_vessel_id
      and v.version = v_base_version;
    if not found then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
    insert into public.sd_audit_events(
      workspace_id, id, actor_id, command, entity_type, entity_id, detail
    ) values (
      p_workspace_id,
      public.sd_core_event_id(p_operation_id, 'audit:' || v_vessel_id),
      v_actor, 'batch_update_vessels', 'vessel', v_vessel_id,
      jsonb_build_object('version', v_base_version + 1)
    );
  end loop;

  v_count := jsonb_array_length(p_items);
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'vessel-batch', 'count', v_count
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'batch_update_vessels', 'vessel-batch:' || md5(p_items::text),
    v_request,
    (
      select jsonb_object_agg(
        item ->> 'vesselId', (item ->> 'baseVersion')::bigint
      )
      from jsonb_array_elements(p_items) item
    ),
    p_items,
    v_result
  );
  return v_result;
end;
$$;

create or replace function public.sd_core_batch_task_transition(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_items jsonb,
  p_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.sd_membership_role(p_workspace_id);
  v_command text := 'batch_' || p_action || '_ordinary_tasks';
  v_item jsonb;
  v_task public.sd_tasks%rowtype;
  v_task_id text;
  v_base_version bigint;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_status text;
  v_updated integer;
begin
  if p_action not in ('close', 'reopen', 'delete') then
    raise exception using errcode = 'P0001', message = 'unsupported-transition';
  end if;
  if v_actor is null
     or v_role = 'vessel'
     or p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or (
       p_action in ('close', 'reopen')
       and not public.sd_has_permission(p_workspace_id, 'closeTasks')
     )
     or (
       p_action = 'delete'
       and (
         v_role not in ('owner', 'admin')
         or not public.sd_has_permission(p_workspace_id, 'deleteTasks')
       )
     ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if (
    select count(*) from jsonb_array_elements(p_items)
  ) <> (
    select count(distinct item ->> 'taskId')
    from jsonb_array_elements(p_items) item
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-batch-target';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    perform public.sd_core_assert_json_keys(
      v_item,
      array[
        'taskId', 'baseVersion', 'leaseKey',
        'ownerSession', 'fencingToken'
      ],
      'invalid-batch-task-item'
    );
    if not (
      v_item ? 'taskId' and v_item ? 'baseVersion'
      and v_item ? 'leaseKey' and v_item ? 'ownerSession'
      and v_item ? 'fencingToken'
    ) or v_item ->> 'leaseKey' <> 'task:' || (v_item ->> 'taskId') then
      raise exception using
        errcode = 'P0001', message = 'invalid-batch-task-item';
    end if;
    begin
      perform (v_item ->> 'baseVersion')::bigint;
      perform (v_item ->> 'ownerSession')::uuid;
      perform (v_item ->> 'fencingToken')::bigint;
    exception when others then
      raise exception using
        errcode = 'P0001', message = 'invalid-batch-task-item';
    end;
  end loop;

  v_request := jsonb_build_object('items', p_items);
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    v_command, 'task-batch:' || md5(p_items::text), v_request
  );
  if v_replay is not null then return v_replay; end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by value ->> 'taskId'
  loop
    perform public.sd_assert_live_lease(
      p_workspace_id,
      v_item ->> 'leaseKey',
      (v_item ->> 'ownerSession')::uuid,
      (v_item ->> 'fencingToken')::bigint
    );
  end loop;
  perform 1
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id
    and t.id in (
      select item ->> 'taskId' from jsonb_array_elements(p_items) item
    )
  order by t.id
  for update;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by value ->> 'taskId'
  loop
    v_task_id := v_item ->> 'taskId';
    v_base_version := (v_item ->> 'baseVersion')::bigint;
    select * into v_task
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = v_task_id;
    if not found or v_task.is_deleted then
      raise exception using errcode = 'P0001', message = 'entity-not-found';
    end if;
    if v_task.source_kind <> 'ordinary'
       or v_task.source_type <> 'morning'
       or v_task.is_internal_control
       or v_task.source_meeting_id is not null
       or v_task.source_meeting_item_id is not null then
      raise exception using
        errcode = 'P0001', message = 'ordinary-provenance-required';
    end if;
    if v_task.version <> v_base_version then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
    if not public.sd_can_edit_task(p_workspace_id, v_task_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
    if (p_action = 'close' and v_task.is_closed)
       or (p_action = 'reopen' and not v_task.is_closed) then
      raise exception using
        errcode = 'P0001', message = 'invalid-task-transition';
    end if;
  end loop;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by value ->> 'taskId'
  loop
    v_task_id := v_item ->> 'taskId';
    v_base_version := (v_item ->> 'baseVersion')::bigint;
    select * into v_task
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = v_task_id;
    if p_action = 'close' then
      v_status := '已結案';
      update public.sd_tasks t
      set status_before_close = t.status,
          status = v_status,
          is_closed = true,
          closed_date = current_date,
          closed_by = v_actor,
          version = t.version + 1,
          updated_at = clock_timestamp(),
          updated_by = v_actor
      where t.workspace_id = p_workspace_id
        and t.id = v_task_id and t.version = v_base_version;
    elsif p_action = 'reopen' then
      v_status := coalesce(nullif(v_task.status_before_close, ''), '待處理');
      update public.sd_tasks t
      set status = v_status,
          status_before_close = null,
          is_closed = false,
          closed_date = null,
          closed_by = null,
          version = t.version + 1,
          updated_at = clock_timestamp(),
          updated_by = v_actor
      where t.workspace_id = p_workspace_id
        and t.id = v_task_id and t.version = v_base_version;
    else
      v_status := '已刪除';
      perform public.sd_core_emit_task_notifications(
        p_workspace_id, v_task_id, v_actor,
        public.sd_core_event_id(p_operation_id, 'notice:' || v_task_id),
        'task_deleted'
      );
      update public.sd_tasks t
      set status_before_close = t.status,
          status = v_status,
          is_deleted = true,
          deleted_at = clock_timestamp(),
          deleted_by = v_actor,
          version = t.version + 1,
          updated_at = clock_timestamp(),
          updated_by = v_actor
      where t.workspace_id = p_workspace_id
        and t.id = v_task_id and t.version = v_base_version;
    end if;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
    if p_action = 'delete' then
      update public.sd_task_vessels tv
      set is_active_scope = false,
          version = tv.version + 1,
          updated_at = clock_timestamp(),
          updated_by = v_actor
      where tv.workspace_id = p_workspace_id
        and tv.task_id = v_task_id
        and tv.is_active_scope;
    end if;
    insert into public.sd_task_status_events(
      workspace_id, id, task_id, status, actor_id, created_at
    ) values (
      p_workspace_id,
      public.sd_core_event_id(
        p_operation_id, 'task-status:' || v_task_id
      ),
      v_task_id, v_status, v_actor, clock_timestamp()
    );
    if p_action <> 'delete' then
      perform public.sd_core_emit_task_notifications(
        p_workspace_id, v_task_id, v_actor,
        public.sd_core_event_id(p_operation_id, 'notice:' || v_task_id),
        'task_updated'
      );
    end if;
    insert into public.sd_audit_events(
      workspace_id, id, actor_id, command, entity_type, entity_id, detail
    ) values (
      p_workspace_id,
      public.sd_core_event_id(p_operation_id, 'audit:' || v_task_id),
      v_actor, v_command, 'task', v_task_id,
      jsonb_build_object('version', v_base_version + 1)
    );
  end loop;

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'task-batch',
    'count', jsonb_array_length(p_items)
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    v_command, 'task-batch:' || md5(p_items::text), v_request,
    (
      select jsonb_object_agg(
        item ->> 'taskId', (item ->> 'baseVersion')::bigint
      )
      from jsonb_array_elements(p_items) item
    ),
    p_items,
    v_result
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_batch_close_ordinary_tasks(
  p_operation_id uuid, p_workspace_id uuid, p_items jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_batch_task_transition(
    p_operation_id, p_workspace_id, p_items, 'close'
  )
$$;

create or replace function public.command_ship_dynamics_batch_reopen_ordinary_tasks(
  p_operation_id uuid, p_workspace_id uuid, p_items jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_batch_task_transition(
    p_operation_id, p_workspace_id, p_items, 'reopen'
  )
$$;

create or replace function public.command_ship_dynamics_batch_delete_ordinary_tasks(
  p_operation_id uuid, p_workspace_id uuid, p_items jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_batch_task_transition(
    p_operation_id, p_workspace_id, p_items, 'delete'
  )
$$;

create or replace function public.sd_core_replace_options(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_values jsonb,
  p_option_kind text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.sd_membership_role(p_workspace_id);
  v_values text[];
  v_section_key text;
  v_command text;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_setting public.sd_settings%rowtype;
  v_exists boolean;
  v_version bigint;
  v_value text;
  v_ordinal bigint;
begin
  if p_option_kind = 'departments' then
    v_section_key := 'departments';
    v_command := 'update_departments';
  elsif p_option_kind = 'task-categories' then
    v_section_key := 'task-categories';
    v_command := 'update_task_categories';
  elsif p_option_kind = 'meeting-task-categories' then
    v_section_key := 'meeting-task-categories';
    v_command := 'update_meeting_task_categories';
  elsif p_option_kind = 'priorities' then
    v_section_key := 'priorities';
    v_command := 'update_priorities';
  elsif p_option_kind = 'equipment-options' then
    v_section_key := 'equipment-options';
    v_command := 'update_equipment_options';
  else
    raise exception using errcode = 'P0001', message = 'unsupported-option-kind';
  end if;
  if v_actor is null
     or v_role not in ('owner', 'admin')
     or p_lease_key <> 'settings:' || v_section_key then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  v_values := public.sd_core_text_array(
    jsonb_build_object('values', p_values), 'values', false
  );
  if p_option_kind = 'priorities' and exists (
    select 1 from unnest(v_values) value
    where value not in ('急', '高', '中', '低')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-priorities';
  end if;
  v_request := jsonb_build_object(
    'baseVersion', p_base_version, 'leaseKey', p_lease_key,
    'ownerSession', p_owner_session, 'fencingToken', p_fencing_token,
    'values', p_values
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    v_command, 'settings:' || v_section_key, v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  select * into v_setting
  from public.sd_settings s
  where s.workspace_id = p_workspace_id
    and s.section_key = v_section_key
  for update;
  v_exists := found;
  if (v_exists and v_setting.version <> p_base_version)
     or (not v_exists and p_base_version <> 0) then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if v_exists then
    update public.sd_settings s
    set value = jsonb_build_object('values', to_jsonb(v_values)),
        value_hash = md5(
          jsonb_build_object('values', to_jsonb(v_values))::text
        ),
        version = s.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where s.workspace_id = p_workspace_id
      and s.section_key = v_section_key
      and s.version = p_base_version
    returning s.version into v_version;
  else
    insert into public.sd_settings(
      workspace_id, section_key, value, value_hash,
      version, updated_at, updated_by
    ) values (
      p_workspace_id, v_section_key,
      jsonb_build_object('values', to_jsonb(v_values)),
      md5(jsonb_build_object('values', to_jsonb(v_values))::text),
      1, clock_timestamp(), v_actor
    )
    returning version into v_version;
  end if;

  if p_option_kind = 'departments' then
    update public.sd_departments
    set is_active = false, version = version + 1,
        updated_at = clock_timestamp(), updated_by = v_actor
    where workspace_id = p_workspace_id and is_active;
    for v_value, v_ordinal in
      select value, ordinal - 1
      from unnest(v_values) with ordinality item(value, ordinal)
    loop
      insert into public.sd_departments(
        workspace_id, department, ordinal, is_active,
        version, updated_at, updated_by
      ) values (
        p_workspace_id, v_value, v_ordinal, true,
        1, clock_timestamp(), v_actor
      )
      on conflict (workspace_id, department) do update
        set ordinal = excluded.ordinal, is_active = true,
            version = public.sd_departments.version + 1,
            updated_at = clock_timestamp(), updated_by = v_actor;
    end loop;
  elsif p_option_kind in ('task-categories', 'meeting-task-categories') then
    update public.sd_category_options
    set is_active = false, version = version + 1,
        updated_at = clock_timestamp(), updated_by = v_actor
    where workspace_id = p_workspace_id
      and category_scope = case
        when p_option_kind = 'task-categories' then 'ordinary'
        else 'meeting'
      end
      and is_active;
    for v_value, v_ordinal in
      select value, ordinal - 1
      from unnest(v_values) with ordinality item(value, ordinal)
    loop
      insert into public.sd_category_options(
        workspace_id, category_scope, category, ordinal,
        is_active, version, updated_at, updated_by
      ) values (
        p_workspace_id,
        case when p_option_kind = 'task-categories'
          then 'ordinary' else 'meeting' end,
        v_value, v_ordinal, true, 1, clock_timestamp(), v_actor
      )
      on conflict (workspace_id, category_scope, category) do update
        set ordinal = excluded.ordinal, is_active = true,
            version = public.sd_category_options.version + 1,
            updated_at = clock_timestamp(), updated_by = v_actor;
    end loop;
  elsif p_option_kind = 'priorities' then
    update public.sd_priority_options
    set is_active = false, version = version + 1,
        updated_at = clock_timestamp(), updated_by = v_actor
    where workspace_id = p_workspace_id and is_active;
    for v_value, v_ordinal in
      select value, ordinal - 1
      from unnest(v_values) with ordinality item(value, ordinal)
    loop
      insert into public.sd_priority_options(
        workspace_id, priority, ordinal, is_active,
        version, updated_at, updated_by
      ) values (
        p_workspace_id, v_value, v_ordinal, true,
        1, clock_timestamp(), v_actor
      )
      on conflict (workspace_id, priority) do update
        set ordinal = excluded.ordinal, is_active = true,
            version = public.sd_priority_options.version + 1,
            updated_at = clock_timestamp(), updated_by = v_actor;
    end loop;
  else
    update public.sd_equipment_options
    set is_active = false, version = version + 1,
        updated_at = clock_timestamp(), updated_by = v_actor
    where workspace_id = p_workspace_id and is_active;
    for v_value, v_ordinal in
      select value, ordinal - 1
      from unnest(v_values) with ordinality item(value, ordinal)
    loop
      insert into public.sd_equipment_options(
        workspace_id, equipment_option, ordinal, is_active,
        version, updated_at, updated_by
      ) values (
        p_workspace_id, v_value, v_ordinal, true,
        1, clock_timestamp(), v_actor
      )
      on conflict (workspace_id, equipment_option) do update
        set ordinal = excluded.ordinal, is_active = true,
            version = public.sd_equipment_options.version + 1,
            updated_at = clock_timestamp(), updated_by = v_actor;
    end loop;
  end if;

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'settings', 'entityId', v_section_key,
    'version', v_version, 'count', cardinality(v_values)
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    v_command, 'settings:' || v_section_key, v_request,
    jsonb_build_object('settings', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, v_command, 'settings', v_section_key,
    jsonb_build_object('version', v_version, 'count', cardinality(v_values))
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_update_departments(
  p_operation_id uuid, p_workspace_id uuid, p_base_version bigint,
  p_lease_key text, p_owner_session uuid, p_fencing_token bigint,
  p_values jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_replace_options(
    p_operation_id, p_workspace_id, p_base_version, p_lease_key,
    p_owner_session, p_fencing_token, p_values, 'departments'
  )
$$;

create or replace function public.command_ship_dynamics_update_task_categories(
  p_operation_id uuid, p_workspace_id uuid, p_base_version bigint,
  p_lease_key text, p_owner_session uuid, p_fencing_token bigint,
  p_values jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_replace_options(
    p_operation_id, p_workspace_id, p_base_version, p_lease_key,
    p_owner_session, p_fencing_token, p_values, 'task-categories'
  )
$$;

create or replace function public.command_ship_dynamics_update_meeting_task_categories(
  p_operation_id uuid, p_workspace_id uuid, p_base_version bigint,
  p_lease_key text, p_owner_session uuid, p_fencing_token bigint,
  p_values jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_replace_options(
    p_operation_id, p_workspace_id, p_base_version, p_lease_key,
    p_owner_session, p_fencing_token, p_values, 'meeting-task-categories'
  )
$$;

create or replace function public.command_ship_dynamics_update_priorities(
  p_operation_id uuid, p_workspace_id uuid, p_base_version bigint,
  p_lease_key text, p_owner_session uuid, p_fencing_token bigint,
  p_values jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_replace_options(
    p_operation_id, p_workspace_id, p_base_version, p_lease_key,
    p_owner_session, p_fencing_token, p_values, 'priorities'
  )
$$;

create or replace function public.command_ship_dynamics_update_equipment_options(
  p_operation_id uuid, p_workspace_id uuid, p_base_version bigint,
  p_lease_key text, p_owner_session uuid, p_fencing_token bigint,
  p_values jsonb
)
returns jsonb language sql volatile security definer
set search_path = pg_catalog, public
as $$
  select public.sd_core_replace_options(
    p_operation_id, p_workspace_id, p_base_version, p_lease_key,
    p_owner_session, p_fencing_token, p_values, 'equipment-options'
  )
$$;

create or replace function public.sd_core_permission_default(
  p_role text,
  p_permission_key text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p_role = 'admin' then p_permission_key in (
      'viewAllVessels', 'editBusinessContent', 'createTasks', 'closeTasks',
      'deleteTasks', 'manageMeetings', 'exportReports', 'enterManagement',
      'manageUsers', 'manageVessels', 'viewAuditLogs'
    )
    when p_role = 'operator' then p_permission_key in (
      'editBusinessContent', 'createTasks', 'closeTasks', 'exportReports'
    )
    when p_role = 'vessel' then p_permission_key = 'createTasks'
    else false
  end
$$;

create or replace function public.command_ship_dynamics_update_role_permissions(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_matrix jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_roles text[] := array['admin', 'operator', 'vessel'];
  v_keys text[] := array[
    'viewAllVessels', 'editBusinessContent', 'createTasks', 'closeTasks',
    'deleteTasks', 'manageMeetings', 'exportReports', 'enterManagement',
    'manageUsers', 'manageVessels', 'viewAuditLogs',
    'manageRolePermissions', 'manageSystemSettings'
  ];
  v_role text;
  v_key text;
  v_enabled boolean;
  v_existing boolean;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_setting public.sd_settings%rowtype;
  v_setting_exists boolean;
  v_version bigint;
  v_canonical_matrix jsonb := jsonb_build_object(
    'admin', '{}'::jsonb,
    'operator', '{}'::jsonb,
    'vessel', '{}'::jsonb
  );
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) <> 'owner'
     or p_lease_key <> 'settings:role-permissions' then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_core_assert_json_keys(
    p_matrix, v_roles, 'invalid-role-permissions'
  );
  foreach v_role in array v_roles loop
    if p_matrix ? v_role then
      perform public.sd_core_assert_json_keys(
        p_matrix -> v_role, v_keys, 'invalid-role-permissions'
      );
      if exists (
        select 1
        from jsonb_each(p_matrix -> v_role) item
        where jsonb_typeof(item.value) <> 'boolean'
      ) then
        raise exception using
          errcode = 'P0001', message = 'invalid-role-permissions';
      end if;
    end if;
  end loop;
  v_request := jsonb_build_object(
    'baseVersion', p_base_version, 'leaseKey', p_lease_key,
    'ownerSession', p_owner_session, 'fencingToken', p_fencing_token,
    'matrix', p_matrix
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'update_role_permissions', 'settings:role-permissions', v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  select * into v_setting
  from public.sd_settings s
  where s.workspace_id = p_workspace_id
    and s.section_key = 'role-permissions'
  for update;
  v_setting_exists := found;
  if (v_setting_exists and v_setting.version <> p_base_version)
     or (not v_setting_exists and p_base_version <> 0) then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  foreach v_role in array v_roles loop
    foreach v_key in array v_keys loop
      if p_matrix ? v_role and (p_matrix -> v_role) ? v_key then
        v_enabled := (p_matrix -> v_role ->> v_key)::boolean;
      else
        select rp.enabled into v_existing
        from public.sd_role_permissions rp
        where rp.workspace_id = p_workspace_id
          and rp.role = v_role
          and rp.permission_key = v_key;
        if found then
          v_enabled := v_existing;
        else
          v_enabled := public.sd_core_permission_default(v_role, v_key);
        end if;
      end if;

      if v_role = 'admin' and v_key in (
        'enterManagement', 'deleteTasks', 'manageUsers'
      ) then
        v_enabled := true;
      elsif v_role = 'admin' and v_key in (
        'manageRolePermissions', 'manageSystemSettings'
      ) then
        v_enabled := false;
      elsif v_role = 'operator' and v_key in (
        'enterManagement', 'deleteTasks', 'manageUsers', 'manageVessels',
        'viewAuditLogs', 'manageRolePermissions', 'manageSystemSettings'
      ) then
        v_enabled := false;
      elsif v_role = 'vessel' and v_key <> 'createTasks' then
        v_enabled := false;
      end if;
      insert into public.sd_role_permissions(
        workspace_id, role, permission_key, enabled,
        version, updated_at, updated_by
      ) values (
        p_workspace_id, v_role, v_key, v_enabled,
        1, clock_timestamp(), v_actor
      )
      on conflict (workspace_id, role, permission_key) do update
        set enabled = excluded.enabled,
            version = public.sd_role_permissions.version + 1,
            updated_at = clock_timestamp(),
            updated_by = v_actor;
      v_canonical_matrix := jsonb_set(
        v_canonical_matrix,
        array[v_role, v_key],
        to_jsonb(v_enabled),
        true
      );
    end loop;
  end loop;

  delete from public.sd_role_permissions
  where workspace_id = p_workspace_id
    and not (permission_key = any(v_keys));

  if v_setting_exists then
    update public.sd_settings s
    set value = v_canonical_matrix,
        value_hash = md5(v_canonical_matrix::text),
        version = s.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where s.workspace_id = p_workspace_id
      and s.section_key = 'role-permissions'
    returning s.version into v_version;
  else
    insert into public.sd_settings(
      workspace_id, section_key, value, value_hash,
      version, updated_at, updated_by
    ) values (
      p_workspace_id, 'role-permissions',
      v_canonical_matrix, md5(v_canonical_matrix::text),
      1, clock_timestamp(), v_actor
    )
    returning version into v_version;
  end if;

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'settings', 'entityId', 'role-permissions',
    'version', v_version
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'update_role_permissions', 'settings:role-permissions', v_request,
    jsonb_build_object('settings', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'update_role_permissions', 'settings', 'role-permissions',
    jsonb_build_object('version', v_version)
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_update_site_gate(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_password_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_gate public.sd_public_site_gate%rowtype;
  v_exists boolean;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_version bigint;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) <> 'owner'
     or p_lease_key <> 'settings:site-gate' then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_password_hash is null
     or p_password_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid-site-gate-hash';
  end if;
  v_request := jsonb_build_object(
    'baseVersion', p_base_version, 'leaseKey', p_lease_key,
    'ownerSession', p_owner_session, 'fencingToken', p_fencing_token,
    'passwordHash', p_password_hash
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'update_site_gate', 'settings:site-gate', v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  select * into v_gate
  from public.sd_public_site_gate g
  where g.workspace_id = p_workspace_id
  for update;
  v_exists := found;
  if (v_exists and v_gate.version <> p_base_version)
     or (not v_exists and p_base_version <> 0) then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if v_exists then
    update public.sd_public_site_gate g
    set password_hash = p_password_hash,
        content_hash = md5(p_password_hash),
        version = g.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where g.workspace_id = p_workspace_id
      and g.version = p_base_version
    returning g.version into v_version;
  else
    insert into public.sd_public_site_gate(
      workspace_id, password_hash, content_hash,
      version, updated_at, updated_by
    ) values (
      p_workspace_id, p_password_hash, md5(p_password_hash),
      1, clock_timestamp(), v_actor
    )
    returning version into v_version;
  end if;
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'settings', 'entityId', 'site-gate',
    'version', v_version
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'update_site_gate', 'settings:site-gate', v_request,
    jsonb_build_object('siteGate', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'update_site_gate', 'settings', 'site-gate',
    jsonb_build_object('version', v_version, 'hashChanged', true)
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_update_workspace_settings(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_value jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_setting public.sd_settings%rowtype;
  v_exists boolean;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_version bigint;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) <> 'owner'
     or p_lease_key <> 'settings:workspace' then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_core_assert_json_keys(
    p_value, array['systemTitle'], 'invalid-workspace-settings'
  );
  if not (p_value ? 'systemTitle')
     or jsonb_typeof(p_value -> 'systemTitle') <> 'string'
     or btrim(p_value ->> 'systemTitle') = '' then
    raise exception using
      errcode = 'P0001', message = 'invalid-workspace-settings';
  end if;
  v_request := jsonb_build_object(
    'baseVersion', p_base_version, 'leaseKey', p_lease_key,
    'ownerSession', p_owner_session, 'fencingToken', p_fencing_token,
    'value', p_value
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'update_workspace_settings', 'settings:workspace', v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  select * into v_setting
  from public.sd_settings s
  where s.workspace_id = p_workspace_id and s.section_key = 'workspace'
  for update;
  v_exists := found;
  if (v_exists and v_setting.version <> p_base_version)
     or (not v_exists and p_base_version <> 0) then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  update public.sd_workspaces
  set name = btrim(p_value ->> 'systemTitle')
  where id = p_workspace_id and is_active;
  if not found then
    raise exception using errcode = 'P0001', message = 'workspace-not-found';
  end if;
  if v_exists then
    update public.sd_settings s
    set value = p_value,
        value_hash = md5(p_value::text),
        version = s.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where s.workspace_id = p_workspace_id
      and s.section_key = 'workspace'
    returning s.version into v_version;
  else
    insert into public.sd_settings(
      workspace_id, section_key, value, value_hash,
      version, updated_at, updated_by
    ) values (
      p_workspace_id, 'workspace', p_value, md5(p_value::text),
      1, clock_timestamp(), v_actor
    )
    returning version into v_version;
  end if;
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'settings', 'entityId', 'workspace',
    'version', v_version
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'update_workspace_settings', 'settings:workspace', v_request,
    jsonb_build_object('settings', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'update_workspace_settings', 'settings', 'workspace',
    jsonb_build_object('version', v_version)
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_mark_notifications_read(
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
  v_item jsonb;
  v_notification_id text;
  v_base_version bigint;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) is null
     or p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if (
    select count(*) from jsonb_array_elements(p_items)
  ) <> (
    select count(distinct item ->> 'notificationId')
    from jsonb_array_elements(p_items) item
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-notification';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    perform public.sd_core_assert_json_keys(
      v_item,
      array['notificationId', 'baseVersion'],
      'invalid-notification-item'
    );
    if not (v_item ? 'notificationId' and v_item ? 'baseVersion')
       or btrim(coalesce(v_item ->> 'notificationId', '')) = '' then
      raise exception using
        errcode = 'P0001', message = 'invalid-notification-item';
    end if;
    begin
      perform (v_item ->> 'baseVersion')::bigint;
    exception when others then
      raise exception using
        errcode = 'P0001', message = 'invalid-notification-item';
    end;
  end loop;
  v_request := jsonb_build_object('items', p_items);
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'mark_notifications_read',
    'notifications:' || v_actor::text || ':' || md5(p_items::text),
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  perform 1
  from public.sd_notifications n
  where n.workspace_id = p_workspace_id
    and n.id in (
      select item ->> 'notificationId'
      from jsonb_array_elements(p_items) item
    )
  order by n.id
  for update;
  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by value ->> 'notificationId'
  loop
    v_notification_id := v_item ->> 'notificationId';
    v_base_version := (v_item ->> 'baseVersion')::bigint;
    if not exists (
      select 1 from public.sd_notifications n
      where n.workspace_id = p_workspace_id
        and n.id = v_notification_id
        and n.recipient_id = v_actor
        and n.version = v_base_version
    ) then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
  end loop;
  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by value ->> 'notificationId'
  loop
    v_notification_id := v_item ->> 'notificationId';
    v_base_version := (v_item ->> 'baseVersion')::bigint;
    update public.sd_notifications n
    set read_at = coalesce(n.read_at, clock_timestamp()),
        version = n.version + 1
    where n.workspace_id = p_workspace_id
      and n.id = v_notification_id
      and n.recipient_id = v_actor
      and n.version = v_base_version;
    if not found then
      raise exception using errcode = '40001', message = 'version-conflict';
    end if;
  end loop;
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'notifications',
    'count', jsonb_array_length(p_items)
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'mark_notifications_read',
    'notifications:' || v_actor::text || ':' || md5(p_items::text),
    v_request,
    (
      select jsonb_object_agg(
        item ->> 'notificationId', (item ->> 'baseVersion')::bigint
      )
      from jsonb_array_elements(p_items) item
    ),
    '{}'::jsonb,
    v_result
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_save_report(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_report_id text,
  p_content jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_vessels text[];
  v_vessel_id text;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
begin
  if v_actor is null
     or not public.sd_has_permission(p_workspace_id, 'exportReports')
     or btrim(coalesce(p_report_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_core_assert_json_keys(
    p_content,
    array['title', 'vesselIds', 'taskCount'],
    'invalid-report-payload'
  );
  if not (
    p_content ? 'title' and p_content ? 'vesselIds' and p_content ? 'taskCount'
  ) or jsonb_typeof(p_content -> 'title') <> 'string'
     or jsonb_typeof(p_content -> 'taskCount') <> 'number'
     or btrim(p_content ->> 'title') = ''
     or (p_content ->> 'taskCount')::integer < 0 then
    raise exception using errcode = 'P0001', message = 'invalid-report-payload';
  end if;
  v_vessels := public.sd_core_text_array(p_content, 'vesselIds', false);
  foreach v_vessel_id in array v_vessels loop
    if not public.sd_can_read_vessel(p_workspace_id, v_vessel_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  end loop;
  v_request := jsonb_build_object('reportId', p_report_id, 'content', p_content);
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'save_report', 'report:' || p_report_id, v_request
  );
  if v_replay is not null then return v_replay; end if;
  if exists (
    select 1 from public.sd_saved_reports r
    where r.workspace_id = p_workspace_id and r.id = p_report_id
  ) then
    raise exception using errcode = '23505', message = 'entity-exists';
  end if;
  perform 1
  from public.sd_vessels v
  where v.workspace_id = p_workspace_id and v.id = any(v_vessels)
  order by v.id
  for share;
  insert into public.sd_saved_reports(
    workspace_id, id, title, task_count, version, created_at, created_by
  ) values (
    p_workspace_id, p_report_id, btrim(p_content ->> 'title'),
    (p_content ->> 'taskCount')::integer, 1, clock_timestamp(), v_actor
  );
  insert into public.sd_saved_report_vessels(
    workspace_id, report_id, vessel_id, ordinal
  )
  select p_workspace_id, p_report_id, value, ordinal - 1
  from unnest(v_vessels) with ordinality item(value, ordinal);
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'report', 'entityId', p_report_id, 'version', 1
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'save_report', 'report:' || p_report_id, v_request,
    '{}'::jsonb, '{}'::jsonb, v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'save_report', 'report', p_report_id,
    jsonb_build_object('vesselCount', cardinality(v_vessels))
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_resolve_migration_quarantine(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_quarantine_id text,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_resolution text,
  p_resolution_note text
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
  v_version bigint;
begin
  -- Authorize before touching the quarantine table. All non-Owners receive the
  -- same response for existing and nonexistent identifiers.
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) <> 'owner'
     or p_lease_key <> 'settings:migration-quarantine' then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if btrim(coalesce(p_quarantine_id, '')) = ''
     or p_resolution not in ('accepted', 'discarded')
     or btrim(coalesce(p_resolution_note, '')) = '' then
    raise exception using
      errcode = 'P0001', message = 'invalid-quarantine-resolution';
  end if;
  v_request := jsonb_build_object(
    'quarantineId', p_quarantine_id, 'baseVersion', p_base_version,
    'leaseKey', p_lease_key, 'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'resolution', p_resolution, 'resolutionNote', p_resolution_note
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'resolve_migration_quarantine',
    'quarantine:' || p_quarantine_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  update public.sd_migration_quarantine q
  set resolution = p_resolution,
      resolution_note = btrim(p_resolution_note),
      resolved_at = clock_timestamp(),
      resolved_by = v_actor,
      version = q.version + 1
  where q.workspace_id = p_workspace_id
    and q.id = p_quarantine_id
    and q.version = p_base_version
    and q.resolution is null
  returning q.version into v_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'quarantine', 'entityId', p_quarantine_id,
    'version', v_version, 'resolved', true
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'resolve_migration_quarantine',
    'quarantine:' || p_quarantine_id, v_request,
    jsonb_build_object('quarantine', p_base_version),
    jsonb_build_object(
      'leaseKey', p_lease_key,
      'ownerSession', p_owner_session,
      'fencingToken', p_fencing_token
    ),
    v_result
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id, 'audit'),
    v_actor, 'resolve_migration_quarantine',
    'quarantine', p_quarantine_id,
    jsonb_build_object('version', v_version, 'resolution', p_resolution)
  );
  return v_result;
end;
$$;

create or replace function public.sd_core_reject_append_only_mutation()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = 'P0001', message = 'append-only-relation';
end;
$$;

drop trigger if exists sd_task_status_events_append_only
  on public.sd_task_status_events;
create trigger sd_task_status_events_append_only
  before update or delete on public.sd_task_status_events
  for each row execute function public.sd_core_reject_append_only_mutation();

drop trigger if exists sd_task_vessel_status_events_append_only
  on public.sd_task_vessel_status_events;
create trigger sd_task_vessel_status_events_append_only
  before update or delete on public.sd_task_vessel_status_events
  for each row execute function public.sd_core_reject_append_only_mutation();

drop trigger if exists sd_audit_events_append_only
  on public.sd_audit_events;
create trigger sd_audit_events_append_only
  before update or delete on public.sd_audit_events
  for each row execute function public.sd_core_reject_append_only_mutation();

do $$
declare
  v_signature text;
begin
  for v_signature in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'sd_core_%'
        or p.proname like 'command_ship_dynamics_%'
      )
  loop
    execute 'revoke all on function ' || v_signature || ' from public, anon';
    if split_part(v_signature, '(', 1) like 'command_ship_dynamics_%' then
      execute 'grant execute on function ' || v_signature || ' to authenticated';
    end if;
  end loop;
end;
$$;

revoke all on function public.sd_can_mutate_vessel(uuid, text, text)
  from public, anon;
revoke all on function public.sd_can_read_saved_report(uuid, text)
  from public, anon;
grant execute on function public.sd_can_read_saved_report(uuid, text)
  to authenticated;
revoke all on function public.sd_can_read_notification(uuid, text)
  from public, anon;
grant execute on function public.sd_can_read_notification(uuid, text)
  to authenticated;
revoke all on function public.claim_ship_dynamics_entity_lease(
  uuid, text, text, text, uuid, integer
) from public, anon;
grant execute on function public.claim_ship_dynamics_entity_lease(
  uuid, text, text, text, uuid, integer
) to authenticated;

-- The foundation's three partial write commands are intentionally retired once
-- this complete command slice is installed. Leaving them executable would
-- bypass provenance, relationship replacement, and strict payload validation.
revoke execute on function public.command_ship_dynamics_create_task(
  uuid, uuid, text, text, bigint, text, uuid, text, text, text
) from authenticated;
revoke execute on function public.command_ship_dynamics_update_task(
  uuid, uuid, text, bigint, bigint, text, uuid, text
) from authenticated;
revoke execute on function public.command_ship_dynamics_update_vessel_note(
  uuid, uuid, text, bigint, bigint, text, uuid, jsonb
) from authenticated;

commit;

begin;

-- Normalized, server-authoritative vertical slice. This file is additive and does
-- not alter the legacy shared-payload tables during development or staging.

create table if not exists public.sd_workspaces (
  id uuid primary key,
  legacy_key text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.sd_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  username_label text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint sd_profiles_username_label_not_blank check (btrim(username_label) <> '')
);

create table if not exists public.sd_memberships (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  user_id uuid not null references public.sd_profiles(id) on delete cascade,
  department text not null default '',
  role text not null check (role in ('owner', 'admin', 'operator', 'vessel')),
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  primary key (workspace_id, user_id)
);

create unique index if not exists sd_one_active_owner_per_workspace
  on public.sd_memberships(workspace_id)
  where role = 'owner' and is_active;

create table if not exists public.sd_role_permissions (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  role text not null check (role in ('admin', 'operator', 'vessel')),
  permission_key text not null,
  enabled boolean not null,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  primary key (workspace_id, role, permission_key)
);

create table if not exists public.sd_vessels (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  short_name text not null default '',
  full_name text not null default '',
  ship_type text not null default '',
  fleet_category text not null default '',
  fleet_tags text[] not null default '{}',
  position jsonb not null default '{}'::jsonb,
  cargo jsonb not null default '{}'::jsonb,
  note jsonb not null default '{}'::jsonb,
  weekly_attention text[] not null default '{}',
  manual_attention_level text,
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  primary key (workspace_id, id),
  constraint sd_vessels_id_not_blank check (btrim(id) <> '')
);

create table if not exists public.sd_vessel_assignments (
  workspace_id uuid not null,
  vessel_id text not null,
  user_id uuid not null,
  assignment_kind text not null check (assignment_kind in ('manager', 'delegate', 'vessel_account')),
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  primary key (workspace_id, vessel_id, user_id, assignment_kind),
  foreign key (workspace_id, vessel_id) references public.sd_vessels(workspace_id, id) on delete cascade,
  foreign key (workspace_id, user_id) references public.sd_memberships(workspace_id, user_id) on delete cascade
);

create unique index if not exists sd_one_active_vessel_account_per_vessel
  on public.sd_vessel_assignments(workspace_id, vessel_id)
  where assignment_kind = 'vessel_account' and is_active;

create unique index if not exists sd_one_active_vessel_per_vessel_account
  on public.sd_vessel_assignments(workspace_id, user_id)
  where assignment_kind = 'vessel_account' and is_active;

create table if not exists public.sd_tasks (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  id text not null,
  description text not null,
  status text not null,
  priority text not null check (priority in ('急', '高', '中', '低')),
  source_kind text not null check (source_kind in ('ordinary', 'meeting')),
  attention_dimension text not null default 'task' check (attention_dimension in ('task', 'meeting')),
  is_internal_control boolean not null default false,
  is_abnormal boolean not null default false,
  is_aware boolean not null default false,
  is_closed boolean not null default false,
  closed_date date,
  closed_by uuid references auth.users(id),
  expected_date date,
  report_date date,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  primary key (workspace_id, id),
  constraint sd_tasks_id_not_blank check (btrim(id) <> ''),
  constraint sd_tasks_description_not_blank check (btrim(description) <> ''),
  constraint sd_tasks_closure_consistent check (
    (is_closed and closed_date is not null and closed_by is not null)
    or (not is_closed and closed_date is null and closed_by is null)
  )
);

create table if not exists public.sd_task_vessels (
  workspace_id uuid not null,
  task_id text not null,
  vessel_id text not null,
  is_active_scope boolean not null default true,
  status text not null default '',
  is_closed boolean not null default false,
  closed_date date,
  closed_by uuid references auth.users(id),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  primary key (workspace_id, task_id, vessel_id),
  foreign key (workspace_id, task_id) references public.sd_tasks(workspace_id, id) on delete cascade,
  foreign key (workspace_id, vessel_id) references public.sd_vessels(workspace_id, id),
  constraint sd_task_vessels_closure_consistent check (
    (is_closed and closed_date is not null and closed_by is not null)
    or (not is_closed and closed_date is null and closed_by is null)
  )
);

create table if not exists public.sd_task_status_events (
  workspace_id uuid not null,
  id uuid not null,
  task_id text not null,
  status text not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, id),
  foreign key (workspace_id, task_id) references public.sd_tasks(workspace_id, id) on delete cascade,
  constraint sd_task_status_events_status_not_blank check (btrim(status) <> '')
);

create table if not exists public.sd_edit_leases (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  lease_key text not null,
  entity_type text not null,
  entity_id text not null,
  owner_id uuid references auth.users(id),
  owner_session uuid,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  expires_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, lease_key),
  constraint sd_edit_lease_owner_complete check (
    (owner_id is null and owner_session is null and expires_at is null)
    or (owner_id is not null and owner_session is not null and expires_at is not null)
  )
);

create table if not exists public.sd_operations (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  operation_id uuid not null,
  actor_id uuid not null references auth.users(id),
  command text not null,
  target_key text not null,
  request_payload jsonb not null,
  request_hash text not null,
  base_versions jsonb not null default '{}'::jsonb,
  lease_provenance jsonb not null default '{}'::jsonb,
  status text not null check (status in ('committed', 'rejected')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, operation_id),
  constraint sd_operations_outcome_complete check (
    (status = 'committed' and result is not null and error_code is null)
    or (status = 'rejected' and result is null and error_code is not null)
  )
);

create table if not exists public.sd_audit_events (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  id uuid not null,
  actor_id uuid not null references auth.users(id),
  command text not null,
  entity_type text not null,
  entity_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, id)
);

alter table public.sd_workspaces enable row level security;
alter table public.sd_profiles enable row level security;
alter table public.sd_memberships enable row level security;
alter table public.sd_role_permissions enable row level security;
alter table public.sd_vessels enable row level security;
alter table public.sd_vessel_assignments enable row level security;
alter table public.sd_tasks enable row level security;
alter table public.sd_task_vessels enable row level security;
alter table public.sd_task_status_events enable row level security;
alter table public.sd_edit_leases enable row level security;
alter table public.sd_operations enable row level security;
alter table public.sd_audit_events enable row level security;

revoke all on table public.sd_workspaces from anon, authenticated;
revoke all on table public.sd_profiles from anon, authenticated;
revoke all on table public.sd_memberships from anon, authenticated;
revoke all on table public.sd_role_permissions from anon, authenticated;
revoke all on table public.sd_vessels from anon, authenticated;
revoke all on table public.sd_vessel_assignments from anon, authenticated;
revoke all on table public.sd_tasks from anon, authenticated;
revoke all on table public.sd_task_vessels from anon, authenticated;
revoke all on table public.sd_task_status_events from anon, authenticated;
revoke all on table public.sd_edit_leases from anon, authenticated;
revoke all on table public.sd_operations from anon, authenticated;
revoke all on table public.sd_audit_events from anon, authenticated;

grant select on table public.sd_workspaces to authenticated;
grant select on table public.sd_profiles to authenticated;
grant select on table public.sd_memberships to authenticated;
grant select on table public.sd_role_permissions to authenticated;
grant select on table public.sd_vessels to authenticated;
grant select on table public.sd_vessel_assignments to authenticated;
grant select on table public.sd_tasks to authenticated;
grant select on table public.sd_task_vessels to authenticated;
grant select on table public.sd_task_status_events to authenticated;
grant select on table public.sd_operations to authenticated;
grant select on table public.sd_audit_events to authenticated;

create or replace function public.sd_membership_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.role
  from public.sd_memberships m
  where m.workspace_id = p_workspace_id
    and m.user_id = auth.uid()
    and m.is_active
    and exists (
      select 1 from public.sd_workspaces w
      where w.id = m.workspace_id and w.is_active
    )
$$;

create or replace function public.sd_has_permission(p_workspace_id uuid, p_permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_configured boolean;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_role is null then return false; end if;
  if v_role = 'owner' then return true; end if;

  -- Fixed security boundaries cannot be relaxed by configuration.
  if p_permission_key = 'enterManagement' then return v_role = 'admin'; end if;
  if p_permission_key = 'deleteTasks' then return v_role = 'admin'; end if;
  if p_permission_key = 'manageUsers' then return v_role = 'admin'; end if;
  if p_permission_key in ('manageRolePermissions', 'manageSystemSettings') then return false; end if;
  if v_role = 'vessel' and p_permission_key <> 'createTasks' then return false; end if;

  select rp.enabled into v_configured
  from public.sd_role_permissions rp
  where rp.workspace_id = p_workspace_id
    and rp.role = v_role
    and rp.permission_key = p_permission_key;
  if found then return v_configured; end if;

  if v_role = 'admin' then
    return p_permission_key in (
      'viewAllVessels', 'editBusinessContent', 'createTasks', 'closeTasks',
      'manageMeetings', 'exportReports', 'viewAuditLogs', 'manageVessels'
    );
  end if;
  if v_role = 'operator' then
    return p_permission_key in ('editBusinessContent', 'createTasks', 'closeTasks', 'exportReports');
  end if;
  return v_role = 'vessel' and p_permission_key = 'createTasks';
end;
$$;

create or replace function public.sd_can_read_vessel(p_workspace_id uuid, p_vessel_id text)
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
  if v_role is null then return false; end if;
  if not exists (
    select 1 from public.sd_vessels v
    where v.workspace_id = p_workspace_id and v.id = p_vessel_id and v.is_active
  ) then return false; end if;
  if v_role in ('owner', 'admin') or public.sd_has_permission(p_workspace_id, 'viewAllVessels') then return true; end if;
  return exists (
    select 1 from public.sd_vessel_assignments a
    where a.workspace_id = p_workspace_id
      and a.vessel_id = p_vessel_id
      and a.user_id = auth.uid()
      and a.is_active
      and (
        (v_role = 'operator' and a.assignment_kind in ('manager', 'delegate'))
        or (v_role = 'vessel' and a.assignment_kind = 'vessel_account')
      )
  );
end;
$$;

create or replace function public.sd_can_edit_vessel(p_workspace_id uuid, p_vessel_id text)
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
  if v_role is null or not public.sd_has_permission(p_workspace_id, 'editBusinessContent') then return false; end if;
  if not exists (
    select 1 from public.sd_vessels v
    where v.workspace_id = p_workspace_id and v.id = p_vessel_id and v.is_active
  ) then return false; end if;
  if v_role in ('owner', 'admin') then return true; end if;
  if v_role <> 'operator' then return false; end if;
  return exists (
    select 1 from public.sd_vessel_assignments a
    where a.workspace_id = p_workspace_id
      and a.vessel_id = p_vessel_id
      and a.user_id = auth.uid()
      and a.assignment_kind in ('manager', 'delegate')
      and a.is_active
  );
end;
$$;

create or replace function public.sd_can_read_task(p_workspace_id uuid, p_task_id text)
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

  if v_role = 'vessel' then
    if v_task.is_internal_control or v_task.source_kind <> 'ordinary' then return false; end if;
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

  if v_role in ('owner', 'admin') or public.sd_has_permission(p_workspace_id, 'viewAllVessels') then return true; end if;
  return exists (
    select 1 from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id and tv.task_id = p_task_id and tv.is_active_scope
  ) and not exists (
    select 1 from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id
      and tv.task_id = p_task_id
      and tv.is_active_scope
      and not public.sd_can_read_vessel(p_workspace_id, tv.vessel_id)
  );
end;
$$;

create or replace function public.sd_can_edit_task(p_workspace_id uuid, p_task_id text)
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
  if v_role is null or v_role = 'vessel' then return false; end if;
  if not public.sd_has_permission(p_workspace_id, 'editBusinessContent') then return false; end if;
  if not public.sd_can_read_task(p_workspace_id, p_task_id) then return false; end if;
  return exists (
    select 1 from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = p_task_id
  );
end;
$$;

create or replace function public.sd_can_create_task_for_vessel(p_workspace_id uuid, p_vessel_id text)
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
  if v_role is null or not public.sd_has_permission(p_workspace_id, 'createTasks') then return false; end if;
  if not exists (
    select 1 from public.sd_vessels v
    where v.workspace_id = p_workspace_id and v.id = p_vessel_id and v.is_active
  ) then return false; end if;
  if v_role in ('owner', 'admin') then return true; end if;
  if v_role = 'operator' then
    return exists (
      select 1 from public.sd_vessel_assignments a
      where a.workspace_id = p_workspace_id
        and a.vessel_id = p_vessel_id
        and a.user_id = auth.uid()
        and a.assignment_kind in ('manager', 'delegate')
        and a.is_active
    );
  end if;
  if v_role = 'vessel' then
    return exists (
      select 1 from public.sd_vessel_assignments a
      where a.workspace_id = p_workspace_id
        and a.vessel_id = p_vessel_id
        and a.user_id = auth.uid()
        and a.assignment_kind = 'vessel_account'
        and a.is_active
    );
  end if;
  return false;
end;
$$;

revoke all on function public.sd_membership_role(uuid) from public;
revoke all on function public.sd_has_permission(uuid, text) from public;
revoke all on function public.sd_can_read_vessel(uuid, text) from public;
revoke all on function public.sd_can_edit_vessel(uuid, text) from public;
revoke all on function public.sd_can_read_task(uuid, text) from public;
revoke all on function public.sd_can_edit_task(uuid, text) from public;
revoke all on function public.sd_can_create_task_for_vessel(uuid, text) from public;
grant execute on function public.sd_membership_role(uuid) to authenticated;
grant execute on function public.sd_has_permission(uuid, text) to authenticated;
grant execute on function public.sd_can_read_vessel(uuid, text) to authenticated;
grant execute on function public.sd_can_edit_vessel(uuid, text) to authenticated;
grant execute on function public.sd_can_read_task(uuid, text) to authenticated;
grant execute on function public.sd_can_edit_task(uuid, text) to authenticated;
grant execute on function public.sd_can_create_task_for_vessel(uuid, text) to authenticated;

create policy sd_workspaces_read on public.sd_workspaces
  for select to authenticated
  using (public.sd_membership_role(id) is not null);

create policy sd_profiles_read on public.sd_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.sd_memberships current_member
      join public.sd_memberships target_member
        on target_member.workspace_id = current_member.workspace_id
       and target_member.user_id = sd_profiles.id
       and target_member.is_active
      where current_member.user_id = auth.uid()
        and current_member.is_active
        and current_member.role <> 'vessel'
    )
  );

create policy sd_memberships_read on public.sd_memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      public.sd_membership_role(workspace_id) in ('owner', 'admin', 'operator')
      and is_active
    )
  );

create policy sd_role_permissions_read on public.sd_role_permissions
  for select to authenticated
  using (public.sd_membership_role(workspace_id) is not null);

create policy sd_vessels_read on public.sd_vessels
  for select to authenticated
  using (public.sd_can_read_vessel(workspace_id, id));

create policy sd_vessel_assignments_read on public.sd_vessel_assignments
  for select to authenticated
  using (public.sd_can_read_vessel(workspace_id, vessel_id));

create policy sd_tasks_read on public.sd_tasks
  for select to authenticated
  using (public.sd_can_read_task(workspace_id, id));

create policy sd_task_vessels_read on public.sd_task_vessels
  for select to authenticated
  using (
    public.sd_can_read_task(workspace_id, task_id)
    and public.sd_can_read_vessel(workspace_id, vessel_id)
  );

create policy sd_task_status_events_read on public.sd_task_status_events
  for select to authenticated
  using (public.sd_can_read_task(workspace_id, task_id));

create policy sd_operations_read on public.sd_operations
  for select to authenticated
  using (
    actor_id = auth.uid()
    or public.sd_membership_role(workspace_id) = 'owner'
  );

create policy sd_audit_events_read on public.sd_audit_events
  for select to authenticated
  using (
    public.sd_membership_role(workspace_id) = 'owner'
    or (
      public.sd_membership_role(workspace_id) = 'admin'
      and public.sd_has_permission(workspace_id, 'viewAuditLogs')
    )
  );

create or replace function public.sd_assert_live_lease(
  p_workspace_id uuid,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lease public.sd_edit_leases%rowtype;
begin
  select * into v_lease
  from public.sd_edit_leases l
  where l.workspace_id = p_workspace_id and l.lease_key = p_lease_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'lease-owner-mismatch';
  end if;
  if v_lease.owner_id is distinct from auth.uid()
     or v_lease.owner_session is distinct from p_owner_session then
    raise exception using errcode = 'P0001', message = 'lease-owner-mismatch';
  end if;
  if v_lease.fencing_token <> p_fencing_token then
    raise exception using errcode = 'P0001', message = 'lease-fencing-mismatch';
  end if;
  if v_lease.expires_at is null or v_lease.expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'lease-expired-mismatch';
  end if;
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
  v_now timestamptz := clock_timestamp();
  v_lease public.sd_edit_leases%rowtype;
begin
  if v_actor is null or public.sd_membership_role(p_workspace_id) is null then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_owner_session is null then
    raise exception using errcode = 'P0001', message = 'invalid-owner-session';
  end if;
  if p_entity_type = 'task' then
    if p_lease_key <> 'task:' || p_entity_id or not public.sd_can_edit_task(p_workspace_id, p_entity_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'task-create' then
    if p_lease_key <> 'task-create:' || p_entity_id or not public.sd_can_create_task_for_vessel(p_workspace_id, p_entity_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'vessel' then
    if p_lease_key <> 'vessel:' || p_entity_id or not public.sd_can_edit_vessel(p_workspace_id, p_entity_id) then
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
    v_now + make_interval(secs => least(greatest(p_ttl_seconds, 30), 300)), v_now
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
    and l.fencing_token = p_fencing_token;
  return found;
end;
$$;

create or replace function public.command_ship_dynamics_create_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_task_id text,
  p_vessel_id text,
  p_fencing_token bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_description text,
  p_priority text,
  p_status text
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
  v_result jsonb;
  v_operation public.sd_operations%rowtype;
begin
  if v_actor is null or public.sd_membership_role(p_workspace_id) is null then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if btrim(coalesce(p_task_id, '')) = '' or btrim(coalesce(p_description, '')) = '' or btrim(coalesce(p_status, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-task';
  end if;
  if p_priority not in ('急', '高', '中', '低') then
    raise exception using errcode = 'P0001', message = 'invalid-priority';
  end if;
  v_request := jsonb_build_object(
    'taskId', p_task_id,
    'vesselId', p_vessel_id,
    'leaseKey', p_lease_key,
    'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'description', p_description,
    'priority', p_priority,
    'status', p_status
  );

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0));
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id and o.operation_id = p_operation_id
  for update;
  if found then
    if v_operation.actor_id <> v_actor
       or v_operation.command <> 'create_task'
       or v_operation.target_key <> 'task:' || p_task_id
       or v_operation.request_payload <> v_request then
      raise exception using errcode = 'P0001', message = 'operation-mismatch';
    end if;
    if v_operation.status <> 'committed' then
      raise exception using errcode = 'P0001', message = coalesce(v_operation.error_code, 'operation-rejected');
    end if;
    return v_operation.result || jsonb_build_object('replayed', true);
  end if;

  if p_lease_key <> 'task-create:' || p_vessel_id
     or not public.sd_can_create_task_for_vessel(p_workspace_id, p_vessel_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_assert_live_lease(p_workspace_id, p_lease_key, p_owner_session, p_fencing_token);
  if exists (
    select 1 from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = p_task_id
  ) then
    raise exception using errcode = '23505', message = 'entity-exists';
  end if;

  insert into public.sd_tasks(
    workspace_id, id, description, status, priority,
    source_kind, attention_dimension, is_internal_control,
    is_abnormal, is_aware, is_closed,
    version, created_by, updated_by
  ) values (
    p_workspace_id, p_task_id, btrim(p_description), btrim(p_status), p_priority,
    'ordinary', 'task', false,
    false, false, false,
    1, v_actor, v_actor
  );
  insert into public.sd_task_vessels(
    workspace_id, task_id, vessel_id, is_active_scope,
    status, is_closed, version, updated_by
  ) values (
    p_workspace_id, p_task_id, p_vessel_id, true,
    btrim(p_status), false, 1, v_actor
  );
  insert into public.sd_task_status_events(workspace_id, id, task_id, status, actor_id)
  values (p_workspace_id, p_operation_id, p_task_id, btrim(p_status), v_actor);

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'entityType', 'task',
    'entityId', p_task_id,
    'version', 1
  );
  insert into public.sd_operations(
    workspace_id, operation_id, actor_id, command, target_key,
    request_payload, request_hash, base_versions, lease_provenance,
    status, result
  ) values (
    p_workspace_id, p_operation_id, v_actor, 'create_task', 'task:' || p_task_id,
    v_request, md5(v_request::text), '{}'::jsonb,
    jsonb_build_object('leaseKey', p_lease_key, 'ownerSession', p_owner_session, 'fencingToken', p_fencing_token),
    'committed', v_result
  );
  insert into public.sd_audit_events(workspace_id, id, actor_id, command, entity_type, entity_id, detail)
  values (
    p_workspace_id, p_operation_id, v_actor, 'create_task', 'task', p_task_id,
    jsonb_build_object('version', 1, 'vesselId', p_vessel_id)
  );
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_update_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_task_id text,
  p_base_version bigint,
  p_fencing_token bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_description text
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
  v_result jsonb;
  v_operation public.sd_operations%rowtype;
  v_version bigint;
begin
  if v_actor is null or public.sd_membership_role(p_workspace_id) is null then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if btrim(coalesce(p_description, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-description';
  end if;
  v_request := jsonb_build_object(
    'taskId', p_task_id,
    'baseVersion', p_base_version,
    'leaseKey', p_lease_key,
    'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'description', p_description
  );

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0));
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id and o.operation_id = p_operation_id
  for update;
  if found then
    if v_operation.actor_id <> v_actor
       or v_operation.command <> 'update_task'
       or v_operation.target_key <> 'task:' || p_task_id
       or v_operation.request_payload <> v_request then
      raise exception using errcode = 'P0001', message = 'operation-mismatch';
    end if;
    if v_operation.status <> 'committed' then
      raise exception using errcode = 'P0001', message = coalesce(v_operation.error_code, 'operation-rejected');
    end if;
    return v_operation.result || jsonb_build_object('replayed', true);
  end if;

  if p_lease_key <> 'task:' || p_task_id or not public.sd_can_edit_task(p_workspace_id, p_task_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_assert_live_lease(p_workspace_id, p_lease_key, p_owner_session, p_fencing_token);

  update public.sd_tasks t
  set description = btrim(p_description),
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

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'entityType', 'task',
    'entityId', p_task_id,
    'version', v_version
  );
  insert into public.sd_operations(
    workspace_id, operation_id, actor_id, command, target_key,
    request_payload, request_hash, base_versions, lease_provenance,
    status, result
  ) values (
    p_workspace_id, p_operation_id, v_actor, 'update_task', 'task:' || p_task_id,
    v_request, md5(v_request::text), jsonb_build_object('task', p_base_version),
    jsonb_build_object('leaseKey', p_lease_key, 'ownerSession', p_owner_session, 'fencingToken', p_fencing_token),
    'committed', v_result
  );
  insert into public.sd_audit_events(workspace_id, id, actor_id, command, entity_type, entity_id, detail)
  values (p_workspace_id, p_operation_id, v_actor, 'update_task', 'task', p_task_id, jsonb_build_object('version', v_version));
  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_update_vessel_note(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_vessel_id text,
  p_base_version bigint,
  p_fencing_token bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_note jsonb
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
  v_result jsonb;
  v_operation public.sd_operations%rowtype;
  v_version bigint;
begin
  if v_actor is null or public.sd_membership_role(p_workspace_id) is null then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_note is null or jsonb_typeof(p_note) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid-note';
  end if;
  v_request := jsonb_build_object(
    'vesselId', p_vessel_id,
    'baseVersion', p_base_version,
    'leaseKey', p_lease_key,
    'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'note', p_note
  );

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0));
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id and o.operation_id = p_operation_id
  for update;
  if found then
    if v_operation.actor_id <> v_actor
       or v_operation.command <> 'update_vessel_note'
       or v_operation.target_key <> 'vessel:' || p_vessel_id
       or v_operation.request_payload <> v_request then
      raise exception using errcode = 'P0001', message = 'operation-mismatch';
    end if;
    if v_operation.status <> 'committed' then
      raise exception using errcode = 'P0001', message = coalesce(v_operation.error_code, 'operation-rejected');
    end if;
    return v_operation.result || jsonb_build_object('replayed', true);
  end if;

  if p_lease_key <> 'vessel:' || p_vessel_id or not public.sd_can_edit_vessel(p_workspace_id, p_vessel_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_assert_live_lease(p_workspace_id, p_lease_key, p_owner_session, p_fencing_token);

  update public.sd_vessels v
  set note = p_note,
      version = v.version + 1,
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
    'status', 'committed',
    'replayed', false,
    'entityType', 'vessel',
    'entityId', p_vessel_id,
    'version', v_version
  );
  insert into public.sd_operations(
    workspace_id, operation_id, actor_id, command, target_key,
    request_payload, request_hash, base_versions, lease_provenance,
    status, result
  ) values (
    p_workspace_id, p_operation_id, v_actor, 'update_vessel_note', 'vessel:' || p_vessel_id,
    v_request, md5(v_request::text), jsonb_build_object('vessel', p_base_version),
    jsonb_build_object('leaseKey', p_lease_key, 'ownerSession', p_owner_session, 'fencingToken', p_fencing_token),
    'committed', v_result
  );
  insert into public.sd_audit_events(workspace_id, id, actor_id, command, entity_type, entity_id, detail)
  values (p_workspace_id, p_operation_id, v_actor, 'update_vessel_note', 'vessel', p_vessel_id, jsonb_build_object('version', v_version));
  return v_result;
end;
$$;

revoke all on function public.sd_assert_live_lease(uuid, text, uuid, bigint) from public;
revoke all on function public.claim_ship_dynamics_entity_lease(uuid, text, text, text, uuid, integer) from public;
revoke all on function public.renew_ship_dynamics_entity_lease(uuid, text, uuid, bigint, integer) from public;
revoke all on function public.release_ship_dynamics_entity_lease(uuid, text, uuid, bigint) from public;
revoke all on function public.command_ship_dynamics_create_task(uuid, uuid, text, text, bigint, text, uuid, text, text, text) from public;
revoke all on function public.command_ship_dynamics_update_task(uuid, uuid, text, bigint, bigint, text, uuid, text) from public;
revoke all on function public.command_ship_dynamics_update_vessel_note(uuid, uuid, text, bigint, bigint, text, uuid, jsonb) from public;

grant execute on function public.claim_ship_dynamics_entity_lease(uuid, text, text, text, uuid, integer) to authenticated;
grant execute on function public.renew_ship_dynamics_entity_lease(uuid, text, uuid, bigint, integer) to authenticated;
grant execute on function public.release_ship_dynamics_entity_lease(uuid, text, uuid, bigint) to authenticated;
grant execute on function public.command_ship_dynamics_create_task(uuid, uuid, text, text, bigint, text, uuid, text, text, text) to authenticated;
grant execute on function public.command_ship_dynamics_update_task(uuid, uuid, text, bigint, bigint, text, uuid, text) to authenticated;
grant execute on function public.command_ship_dynamics_update_vessel_note(uuid, uuid, text, bigint, bigint, text, uuid, jsonb) to authenticated;

commit;

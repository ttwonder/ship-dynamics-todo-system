begin;

-- Transactional, service-role-only importer for the final legacy AppData row.
-- Apply after the complete normalized manifest. This migration never reads,
-- updates, or deletes the legacy shared-payload tables.

alter table public.sd_memberships
  add column if not exists legacy_user_id text;
create unique index if not exists sd_memberships_legacy_user_unique
  on public.sd_memberships(workspace_id, legacy_user_id)
  where legacy_user_id is not null;

alter table public.sd_task_status_events
  add column if not exists legacy_id text,
  add column if not exists legacy_actor_label text,
  add column if not exists legacy_payload jsonb;
create unique index if not exists sd_task_status_events_legacy_unique
  on public.sd_task_status_events(workspace_id, task_id, legacy_id)
  where legacy_id is not null;

alter table public.sd_task_vessel_status_events
  add column if not exists legacy_id text,
  add column if not exists legacy_actor_label text,
  add column if not exists legacy_payload jsonb;
create unique index if not exists sd_task_vessel_status_events_legacy_unique
  on public.sd_task_vessel_status_events(
    workspace_id, task_id, vessel_id, legacy_id
  ) where legacy_id is not null;

alter table public.sd_meeting_status_events
  add column if not exists legacy_id text,
  add column if not exists legacy_actor_label text,
  add column if not exists legacy_payload jsonb;
create unique index if not exists sd_meeting_status_events_legacy_unique
  on public.sd_meeting_status_events(workspace_id, meeting_id, legacy_id)
  where legacy_id is not null;

alter table public.sd_internal_case_status_events
  add column if not exists legacy_id text,
  add column if not exists legacy_actor_label text,
  add column if not exists legacy_payload jsonb;
create unique index if not exists sd_internal_case_status_events_legacy_unique
  on public.sd_internal_case_status_events(workspace_id, case_id, legacy_id)
  where legacy_id is not null;

alter table public.sd_audit_events
  add column if not exists legacy_id text,
  add column if not exists legacy_actor_id text,
  add column if not exists legacy_actor_name text,
  add column if not exists legacy_actor_role text,
  add column if not exists legacy_detail text,
  add column if not exists legacy_payload jsonb;
create unique index if not exists sd_audit_events_legacy_unique
  on public.sd_audit_events(workspace_id, legacy_id)
  where legacy_id is not null;

create table if not exists public.sd_legacy_imports (
  workspace_id uuid not null references public.sd_workspaces(id) on delete restrict,
  legacy_revision bigint not null check (legacy_revision >= 0),
  payload_sha256 text not null,
  mapping_sha256 text not null,
  counts jsonb not null,
  quarantine_count integer not null check (quarantine_count >= 0),
  imported_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, legacy_revision),
  constraint sd_legacy_import_payload_hash check (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint sd_legacy_import_mapping_hash check (
    mapping_sha256 ~ '^[0-9a-f]{64}$'
  )
);
alter table public.sd_legacy_imports enable row level security;
revoke all on table public.sd_legacy_imports from public, anon, authenticated;
grant select on table public.sd_legacy_imports to authenticated;
create policy sd_legacy_imports_owner_read on public.sd_legacy_imports
  for select to authenticated
  using (public.sd_membership_role(workspace_id) = 'owner');

create or replace function public.sd_legacy_uuid(p_seed text)
returns uuid
language sql
immutable
set search_path = pg_catalog, public
as $$
  select (
    substr(md5(p_seed), 1, 8) || '-' ||
    substr(md5(p_seed), 9, 4) || '-' ||
    substr(md5(p_seed), 13, 4) || '-' ||
    substr(md5(p_seed), 17, 4) || '-' ||
    substr(md5(p_seed), 21, 12)
  )::uuid
$$;

create or replace function public.sd_legacy_text_array(
  p_object jsonb,
  p_key text,
  p_required boolean default false
)
returns text[]
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_result text[];
begin
  if p_object is null or jsonb_typeof(p_object) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid-' || p_key;
  end if;
  if not (p_object ? p_key) then
    if p_required then
      raise exception using errcode = 'P0001', message = 'missing-' || p_key;
    end if;
    return '{}'::text[];
  end if;
  if jsonb_typeof(p_object -> p_key) <> 'array'
     or exists (
       select 1
       from jsonb_array_elements(p_object -> p_key) value
       where jsonb_typeof(value) <> 'string'
          or btrim(value #>> '{}') = ''
     ) then
    raise exception using errcode = 'P0001', message = 'invalid-' || p_key;
  end if;
  select coalesce(array_agg(btrim(value) order by ordinal), '{}'::text[])
  into v_result
  from jsonb_array_elements_text(p_object -> p_key)
    with ordinality item(value, ordinal);
  if cardinality(v_result) <> (
    select count(distinct value) from unnest(v_result) value
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-' || p_key;
  end if;
  return v_result;
end;
$$;

create or replace function public.sd_legacy_actor(
  p_mapping jsonb,
  p_legacy_user_id text,
  p_fallback uuid
)
returns uuid
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select (item ->> 'authUserId')::uuid
      from jsonb_array_elements(p_mapping) item
      where item ->> 'legacyUserId' = p_legacy_user_id
      limit 1
    ),
    p_fallback
  )
$$;

create or replace function public.sd_legacy_date(
  p_value text,
  p_required boolean default false
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
      raise exception using errcode = 'P0001', message = 'invalid-date';
    end if;
    return null;
  end if;
  if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = 'P0001', message = 'invalid-date';
  end if;
  begin
    v_date := p_value::date;
  exception when others then
    raise exception using errcode = 'P0001', message = 'invalid-date';
  end;
  if to_char(v_date, 'YYYY-MM-DD') <> p_value then
    raise exception using errcode = 'P0001', message = 'invalid-date';
  end if;
  return v_date;
end;
$$;

create or replace function public.sd_legacy_timestamp(
  p_value text,
  p_fallback timestamptz
)
returns timestamptz
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_timestamp timestamptz;
begin
  if btrim(coalesce(p_value, '')) = '' then return p_fallback; end if;
  begin
    v_timestamp := p_value::timestamptz;
  exception when others then
    raise exception using errcode = 'P0001', message = 'invalid-timestamp';
  end;
  return v_timestamp;
end;
$$;

create or replace function public.import_ship_dynamics_legacy(
  p_workspace_id uuid,
  p_workspace_key text,
  p_workspace_name text,
  p_expected_legacy_revision bigint,
  p_legacy_payload jsonb,
  p_identity_mapping jsonb,
  p_expected_counts jsonb,
  p_expected_quarantine_count integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count_keys constant text[] := array[
    'users', 'activeUsers', 'loginOptions', 'vessels',
    'managerAssignments', 'delegateAssignments', 'vesselAccountAssignments',
    'sourceTasks', 'importedTasks', 'quarantine', 'taskVessels',
    'taskCategories', 'taskDepartments', 'taskOwners', 'taskTypeScopes',
    'taskStatusEvents', 'taskVesselStatusEvents', 'meetings',
    'meetingVessels', 'meetingTypeScopes', 'meetingDepartments',
    'meetingParticipants', 'meetingTracking', 'meetingResponsible',
    'meetingItems', 'meetingItemCategories', 'internalCases',
    'internalCaseDepartments', 'internalCaseStatusEvents', 'internalLinks',
    'notifications', 'legacyAuditEvents', 'migrationAuditEvents',
    'savedReports', 'savedReportVessels', 'departments',
    'ordinaryCategories', 'meetingCategories', 'priorities',
    'equipmentOptions', 'rolePermissions', 'settings'
  ];
  v_permission_keys constant text[] := array[
    'viewAllVessels', 'editBusinessContent', 'createTasks', 'closeTasks',
    'deleteTasks', 'manageMeetings', 'exportReports', 'enterManagement',
    'manageUsers', 'manageVessels', 'viewAuditLogs',
    'manageRolePermissions', 'manageSystemSettings'
  ];
  v_roles constant text[] := array['owner', 'admin', 'operator', 'vessel'];
  v_priorities constant text[] := array['急', '高', '中', '低'];
  v_ship_statuses constant text[] := array[
    'loading', 'unloading', 'to load', 'to unload',
    'waiting order', 'drydock/repiar'
  ];
  v_navigation_statuses constant text[] := array[
    '航行', '拋錨', '進港中', '出港中', '停泊', '漂航'
  ];
  v_load_statuses constant text[] := array['空載', '非空載', '滿載'];
  v_weekly_attention constant text[] := array[
    'crew-operation', 'bunkering-water', 'materials-parts',
    'maintenance', 'survey', 'audit-inspection', 'psc-window'
  ];
  v_notification_kinds constant text[] := array[
    'task_created', 'task_updated', 'task_archived',
    'internal_control_cancelled', 'task_deleted'
  ];
  v_imported_at timestamptz := clock_timestamp();
  v_owner_id uuid;
  v_payload_revision bigint;
  v_item jsonb;
  v_nested jsonb;
  v_log jsonb;
  v_mapping jsonb;
  v_settings jsonb;
  v_role text;
  v_key text;
  v_enabled boolean;
  v_auth_id uuid;
  v_actor_id uuid;
  v_created_at timestamptz;
  v_updated_at timestamptz;
  v_vessel_ids text[];
  v_categories text[];
  v_departments text[];
  v_owner_ids text[];
  v_type_scopes text[];
  v_statuses text[];
  v_item_ids text[];
  v_source_meeting_id text;
  v_source_meeting_item_id text;
  v_task_id text;
  v_case_id text;
  v_vessel_id text;
  v_progress jsonb;
  v_progress_status text;
  v_progress_closed boolean;
  v_progress_closed_date date;
  v_progress_closed_by uuid;
  v_meeting_semantics boolean;
  v_quarantine boolean;
  v_quarantine_count integer := 0;
  v_report_array jsonb;
  v_actual_counts jsonb;
  v_payload_hash text;
  v_mapping_hash text;
  v_canonical_permissions jsonb := '{}'::jsonb;
  v_ordinal integer;
  v_event_ordinal integer;
  v_closed boolean;
  v_closed_date date;
  v_closed_by uuid;
  v_report_date date;
  v_expected_date date;
begin
  -- `current_setting('role')` is the PostgREST JWT role even inside a
  -- SECURITY DEFINER function. Grants alone are not the only boundary.
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not-authorized';
  end if;
  if p_workspace_id is null
     or btrim(coalesce(p_workspace_key, '')) = ''
     or btrim(coalesce(p_workspace_name, '')) = ''
     or p_expected_legacy_revision is null
     or p_expected_legacy_revision < 0
     or p_expected_quarantine_count is null
     or p_expected_quarantine_count < 0 then
    raise exception using errcode = 'P0001', message = 'invalid-import-identity';
  end if;
  if exists (
    select 1 from public.sd_legacy_imports i
    where i.workspace_id = p_workspace_id
      and i.legacy_revision = p_expected_legacy_revision
  ) then
    raise exception using errcode = 'P0001', message = 'already-imported-idempotency';
  end if;
  if exists (
    select 1 from public.sd_workspaces w
    where w.id = p_workspace_id or w.legacy_key = p_workspace_key
  ) then
    raise exception using errcode = 'P0001', message = 'target-workspace-not-empty';
  end if;

  if p_legacy_payload is null
     or jsonb_typeof(p_legacy_payload) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_legacy_payload) key
       where key not in (
         'revision', 'updatedAt', 'settings', 'users', 'vessels', 'tasks',
         'meetings', 'internalControlCases', 'agendaReports', 'savedReports',
         'auditLogs', 'notifications'
       )
     )
     or jsonb_typeof(p_legacy_payload -> 'settings') <> 'object'
     or jsonb_typeof(p_legacy_payload -> 'users') <> 'array'
     or jsonb_typeof(p_legacy_payload -> 'vessels') <> 'array'
     or jsonb_typeof(p_legacy_payload -> 'tasks') <> 'array'
     or jsonb_typeof(p_legacy_payload -> 'meetings') <> 'array'
     or jsonb_typeof(p_legacy_payload -> 'internalControlCases') <> 'array'
     or jsonb_typeof(p_legacy_payload -> 'auditLogs') <> 'array'
     or jsonb_typeof(p_legacy_payload -> 'notifications') <> 'array'
     or (
       not (p_legacy_payload ? 'agendaReports')
       and not (p_legacy_payload ? 'savedReports')
     )
     or (
       p_legacy_payload ? 'agendaReports'
       and p_legacy_payload ? 'savedReports'
     ) then
    raise exception using errcode = 'P0001', message = 'invalid-legacy-payload';
  end if;
  v_report_array := coalesce(
    p_legacy_payload -> 'agendaReports',
    p_legacy_payload -> 'savedReports'
  );
  if jsonb_typeof(v_report_array) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid-saved-reports';
  end if;
  begin
    v_payload_revision := (p_legacy_payload ->> 'revision')::bigint;
  exception when others then
    raise exception using errcode = 'P0001', message = 'legacy-revision-mismatch';
  end;
  if v_payload_revision <> p_expected_legacy_revision then
    raise exception using errcode = 'P0001', message = 'legacy-revision-mismatch';
  end if;

  if p_expected_counts is null
     or jsonb_typeof(p_expected_counts) <> 'object'
     or (
       select count(*) from jsonb_object_keys(p_expected_counts)
     ) <> cardinality(v_count_keys)
     or exists (
       select 1 from jsonb_object_keys(p_expected_counts) key
       where not (key = any(v_count_keys))
     )
     or exists (
       select 1 from unnest(v_count_keys) key
       where not (p_expected_counts ? key)
          or jsonb_typeof(p_expected_counts -> key) <> 'number'
          or (p_expected_counts ->> key)::numeric < 0
          or trunc((p_expected_counts ->> key)::numeric)
             <> (p_expected_counts ->> key)::numeric
     ) then
    raise exception using errcode = 'P0001', message = 'invalid-expected-counts';
  end if;

  if p_identity_mapping is null
     or jsonb_typeof(p_identity_mapping) <> 'array'
     or jsonb_array_length(p_identity_mapping)
        <> jsonb_array_length(p_legacy_payload -> 'users')
     or exists (
       select 1
       from jsonb_array_elements(p_identity_mapping) mapping
       where jsonb_typeof(mapping) <> 'object'
          or (mapping - array[
            'legacyUserId', 'authUserId', 'authAlias', 'activationState'
          ]) <> '{}'::jsonb
          or btrim(coalesce(mapping ->> 'legacyUserId', '')) = ''
          or btrim(coalesce(mapping ->> 'authUserId', '')) = ''
          or btrim(coalesce(mapping ->> 'authAlias', '')) = ''
          or mapping ->> 'activationState' <> 'precreated'
     ) then
    raise exception using errcode = 'P0001', message = 'invalid-identity-mapping';
  end if;
  begin
    perform (mapping ->> 'authUserId')::uuid
    from jsonb_array_elements(p_identity_mapping) mapping;
  exception when others then
    raise exception using errcode = 'P0001', message = 'invalid-identity-mapping';
  end;
  if (
    select count(*) from jsonb_array_elements(p_identity_mapping)
  ) <> (
    select count(distinct mapping ->> 'legacyUserId')
    from jsonb_array_elements(p_identity_mapping) mapping
  ) or (
    select count(*) from jsonb_array_elements(p_identity_mapping)
  ) <> (
    select count(distinct mapping ->> 'authUserId')
    from jsonb_array_elements(p_identity_mapping) mapping
  ) or (
    select count(*) from jsonb_array_elements(p_identity_mapping)
  ) <> (
    select count(distinct lower(btrim(mapping ->> 'authAlias')))
    from jsonb_array_elements(p_identity_mapping) mapping
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-identity-mapping';
  end if;
  if exists (
    select mapping ->> 'legacyUserId'
    from jsonb_array_elements(p_identity_mapping) mapping
    except
    select legacy_user ->> 'id'
    from jsonb_array_elements(p_legacy_payload -> 'users') legacy_user
  ) or exists (
    select legacy_user ->> 'id'
    from jsonb_array_elements(p_legacy_payload -> 'users') legacy_user
    except
    select mapping ->> 'legacyUserId'
    from jsonb_array_elements(p_identity_mapping) mapping
  ) then
    raise exception using errcode = 'P0001', message = 'missing-identity-mapping';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_identity_mapping) mapping
    where not exists (
      select 1 from auth.users u
      where u.id = (mapping ->> 'authUserId')::uuid
    )
  ) then
    raise exception using errcode = 'P0001', message = 'mapped-auth-user-missing';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_legacy_payload -> 'users') legacy_user
    where jsonb_typeof(legacy_user) <> 'object'
       or btrim(coalesce(legacy_user ->> 'id', '')) = ''
       or btrim(coalesce(legacy_user ->> 'name', '')) = ''
       or btrim(coalesce(legacy_user ->> 'username', '')) = ''
       or btrim(coalesce(legacy_user ->> 'department', '')) = ''
       or legacy_user ->> 'role' <> all(v_roles)
       or jsonb_typeof(legacy_user -> 'isActive') <> 'boolean'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-user-domain';
  end if;
  if (
    select count(*) from jsonb_array_elements(p_legacy_payload -> 'users')
  ) <> (
    select count(distinct legacy_user ->> 'id')
    from jsonb_array_elements(p_legacy_payload -> 'users') legacy_user
  ) or (
    select count(*) from jsonb_array_elements(p_legacy_payload -> 'users')
  ) <> (
    select count(distinct lower(btrim(legacy_user ->> 'department'))
                          || chr(31)
                          || lower(btrim(legacy_user ->> 'username')))
    from jsonb_array_elements(p_legacy_payload -> 'users') legacy_user
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-user-id-or-login';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(p_legacy_payload -> 'users') legacy_user
    where (legacy_user ->> 'isActive')::boolean
      and legacy_user ->> 'role' = 'owner'
  ) <> 1 then
    raise exception using errcode = 'P0001', message = 'invalid-owner-cardinality';
  end if;
  select (mapping ->> 'authUserId')::uuid into v_owner_id
  from jsonb_array_elements(p_legacy_payload -> 'users') legacy_user
  join jsonb_array_elements(p_identity_mapping) mapping
    on mapping ->> 'legacyUserId' = legacy_user ->> 'id'
  where (legacy_user ->> 'isActive')::boolean
    and legacy_user ->> 'role' = 'owner';

  v_settings := p_legacy_payload -> 'settings';
  if btrim(coalesce(v_settings ->> 'systemTitle', '')) = ''
     or coalesce(v_settings ->> 'sitePasswordHash', '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(v_settings -> 'rolePermissions') <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid-settings-domain';
  end if;
  v_departments := public.sd_legacy_text_array(v_settings, 'departments', true);
  v_categories := public.sd_legacy_text_array(v_settings, 'taskCategories', true);
  v_item_ids := public.sd_legacy_text_array(v_settings, 'meetingTaskCategories', true);
  v_statuses := public.sd_legacy_text_array(
    v_settings, 'equipmentFailureSubcategories', true
  );
  v_vessel_ids := public.sd_legacy_text_array(v_settings, 'priorities', true);
  if v_vessel_ids is distinct from v_priorities then
    raise exception using errcode = 'P0001', message = 'unknown-priority-domain';
  end if;
  v_type_scopes := public.sd_legacy_text_array(v_settings, 'vesselStatuses', true);
  if v_type_scopes is distinct from v_ship_statuses then
    raise exception using errcode = 'P0001', message = 'unknown-vessel-status-domain';
  end if;
  if (
    select count(*) from jsonb_object_keys(v_settings -> 'rolePermissions')
  ) <> cardinality(v_roles)
     or exists (
       select 1 from jsonb_object_keys(v_settings -> 'rolePermissions') role_key
       where not (role_key = any(v_roles))
     ) then
    raise exception using errcode = 'P0001', message = 'invalid-role-permissions';
  end if;
  foreach v_role in array v_roles loop
    if jsonb_typeof(v_settings -> 'rolePermissions' -> v_role) <> 'object'
       or (
         select count(*)
         from jsonb_object_keys(v_settings -> 'rolePermissions' -> v_role)
       ) <> cardinality(v_permission_keys)
       or exists (
         select 1
         from jsonb_object_keys(v_settings -> 'rolePermissions' -> v_role) permission_key
         where not (permission_key = any(v_permission_keys))
       )
       or exists (
         select 1
         from jsonb_each(v_settings -> 'rolePermissions' -> v_role) permission
         where jsonb_typeof(permission.value) <> 'boolean'
       ) then
      raise exception using errcode = 'P0001', message = 'invalid-role-permissions';
    end if;
  end loop;

  -- Reject duplicate durable IDs before any destination row is accepted.
  if exists (
    select 1
    from (
      select 'vessel' kind, item ->> 'id' id
      from jsonb_array_elements(p_legacy_payload -> 'vessels') item
      union all
      select 'task', item ->> 'id'
      from jsonb_array_elements(p_legacy_payload -> 'tasks') item
      union all
      select 'meeting', item ->> 'id'
      from jsonb_array_elements(p_legacy_payload -> 'meetings') item
      union all
      select 'internal-case', item ->> 'id'
      from jsonb_array_elements(p_legacy_payload -> 'internalControlCases') item
      union all
      select 'notification', item ->> 'id'
      from jsonb_array_elements(p_legacy_payload -> 'notifications') item
      union all
      select 'audit', item ->> 'id'
      from jsonb_array_elements(p_legacy_payload -> 'auditLogs') item
      union all
      select 'saved-report', item ->> 'id'
      from jsonb_array_elements(v_report_array) item
    ) ids
    group by kind, id
    having btrim(coalesce(id, '')) = '' or count(*) <> 1
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-or-blank-entity-id';
  end if;
  if exists (
    select 1
    from (
      select item ->> 'id' id
      from jsonb_array_elements(p_legacy_payload -> 'meetings') meeting
      cross join lateral jsonb_array_elements(meeting -> 'taskItems') item
    ) meeting_item_ids
    group by id
    having btrim(coalesce(id, '')) = '' or count(*) <> 1
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-or-blank-meeting-item-id';
  end if;

  insert into public.sd_workspaces(id, legacy_key, name, is_active, created_at)
  values (
    p_workspace_id, btrim(p_workspace_key), btrim(p_workspace_name),
    true, v_imported_at
  );

  -- Identity, membership, and login options. Legacy password hashes never enter
  -- normalized identity tables.
  for v_item in
    select value from jsonb_array_elements(p_legacy_payload -> 'users')
  loop
    select value into v_mapping
    from jsonb_array_elements(p_identity_mapping)
    where value ->> 'legacyUserId' = v_item ->> 'id';
    v_auth_id := (v_mapping ->> 'authUserId')::uuid;
    v_created_at := public.sd_legacy_timestamp(
      v_item ->> 'createdAt', v_imported_at
    );
    v_updated_at := public.sd_legacy_timestamp(
      v_item ->> 'updatedAt', v_created_at
    );
    insert into public.sd_profiles(
      id, display_name, username_label, created_at, updated_at
    ) values (
      v_auth_id, btrim(v_item ->> 'name'), btrim(v_item ->> 'username'),
      v_created_at, v_updated_at
    )
    on conflict (id) do update
      set display_name = excluded.display_name,
          username_label = excluded.username_label,
          updated_at = excluded.updated_at;
    insert into public.sd_memberships(
      workspace_id, user_id, department, role, is_active, version,
      created_at, updated_at, updated_by, legacy_user_id
    ) values (
      p_workspace_id, v_auth_id, btrim(v_item ->> 'department'),
      v_item ->> 'role', (v_item ->> 'isActive')::boolean, 1,
      v_created_at, v_updated_at, v_owner_id, v_item ->> 'id'
    );
    insert into public.sd_login_options(
      workspace_id, user_id, department, username_label,
      display_name, auth_alias, is_active, updated_at
    ) values (
      p_workspace_id, v_auth_id, btrim(v_item ->> 'department'),
      btrim(v_item ->> 'username'), btrim(v_item ->> 'name'),
      lower(btrim(v_mapping ->> 'authAlias')),
      (v_item ->> 'isActive')::boolean, v_updated_at
    );
  end loop;

  -- Workspace settings, vocabularies, and fixed-boundary role policy.
  insert into public.sd_settings(
    workspace_id, section_key, value, value_hash, version, updated_at, updated_by
  ) values
    (
      p_workspace_id, 'workspace',
      jsonb_build_object('systemTitle', v_settings ->> 'systemTitle'),
      md5(jsonb_build_object('systemTitle', v_settings ->> 'systemTitle')::text),
      1, v_imported_at, v_owner_id
    ),
    (
      p_workspace_id, 'legacy-transition',
      jsonb_build_object(
        'legacyRevision', p_expected_legacy_revision,
        'payloadRevision', v_payload_revision,
        'updatedAt', p_legacy_payload ->> 'updatedAt',
        'lastCloudSyncAt', v_settings ->> 'lastCloudSyncAt',
        'taskCategorySchemaVersion', v_settings -> 'taskCategorySchemaVersion',
        'meetingTaskCategorySchemaVersion', v_settings -> 'meetingTaskCategorySchemaVersion',
        'equipmentFailureSubcategorySchemaVersion', v_settings -> 'equipmentFailureSubcategorySchemaVersion',
        'nonOwnerPasswordResetVersion', v_settings -> 'nonOwnerPasswordResetVersion',
        'meetingTaskAggregationVersion', v_settings -> 'meetingTaskAggregationVersion'
      ),
      md5(jsonb_build_object(
        'legacyRevision', p_expected_legacy_revision,
        'payloadRevision', v_payload_revision
      )::text),
      1, v_imported_at, v_owner_id
    );

  for v_key, v_statuses in
    values
      ('departments', v_departments),
      ('task-categories', v_categories),
      ('meeting-task-categories', v_item_ids),
      ('priorities', v_vessel_ids),
      ('equipment-options', v_statuses)
  loop
    insert into public.sd_settings(
      workspace_id, section_key, value, value_hash,
      version, updated_at, updated_by
    ) values (
      p_workspace_id, v_key, jsonb_build_object('values', to_jsonb(v_statuses)),
      md5(jsonb_build_object('values', to_jsonb(v_statuses))::text),
      1, v_imported_at, v_owner_id
    );
  end loop;

  for v_key, v_ordinal in
    select value, ordinal::integer - 1
    from unnest(v_departments) with ordinality item(value, ordinal)
  loop
    insert into public.sd_departments(
      workspace_id, department, ordinal, is_active, version, updated_at, updated_by
    ) values (
      p_workspace_id, v_key, v_ordinal, true, 1, v_imported_at, v_owner_id
    );
  end loop;
  for v_key, v_ordinal in
    select value, ordinal::integer - 1
    from unnest(v_categories) with ordinality item(value, ordinal)
  loop
    insert into public.sd_category_options(
      workspace_id, category_scope, category, ordinal,
      is_active, version, updated_at, updated_by
    ) values (
      p_workspace_id, 'ordinary', v_key, v_ordinal,
      true, 1, v_imported_at, v_owner_id
    );
  end loop;
  for v_key, v_ordinal in
    select value, ordinal::integer - 1
    from unnest(v_item_ids) with ordinality item(value, ordinal)
  loop
    insert into public.sd_category_options(
      workspace_id, category_scope, category, ordinal,
      is_active, version, updated_at, updated_by
    ) values (
      p_workspace_id, 'meeting', v_key, v_ordinal,
      true, 1, v_imported_at, v_owner_id
    );
  end loop;
  for v_key, v_ordinal in
    select value, ordinal::integer - 1
    from unnest(v_vessel_ids) with ordinality item(value, ordinal)
  loop
    insert into public.sd_priority_options(
      workspace_id, priority, ordinal, is_active, version, updated_at, updated_by
    ) values (
      p_workspace_id, v_key, v_ordinal, true, 1, v_imported_at, v_owner_id
    );
  end loop;
  for v_key, v_ordinal in
    select value, ordinal::integer - 1
    from unnest(v_statuses) with ordinality item(value, ordinal)
  loop
    insert into public.sd_equipment_options(
      workspace_id, equipment_option, ordinal,
      is_active, version, updated_at, updated_by
    ) values (
      p_workspace_id, v_key, v_ordinal, true, 1, v_imported_at, v_owner_id
    );
  end loop;

  foreach v_role in array array['admin', 'operator', 'vessel'] loop
    foreach v_key in array v_permission_keys loop
      v_enabled := (
        v_settings -> 'rolePermissions' -> v_role ->> v_key
      )::boolean;
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
        1, v_imported_at, v_owner_id
      );
      v_canonical_permissions := jsonb_set(
        v_canonical_permissions, array[v_role, v_key],
        to_jsonb(v_enabled), true
      );
    end loop;
  end loop;
  v_canonical_permissions := jsonb_set(
    v_canonical_permissions, array['owner'],
    v_settings -> 'rolePermissions' -> 'owner', true
  );
  insert into public.sd_settings(
    workspace_id, section_key, value, value_hash,
    version, updated_at, updated_by
  ) values (
    p_workspace_id, 'role-permissions', v_canonical_permissions,
    md5(v_canonical_permissions::text), 1, v_imported_at, v_owner_id
  );
  insert into public.sd_public_site_gate(
    workspace_id, password_hash, content_hash, version, updated_at, updated_by
  ) values (
    p_workspace_id, lower(v_settings ->> 'sitePasswordHash'),
    md5(lower(v_settings ->> 'sitePasswordHash')),
    1, v_imported_at, v_owner_id
  );

  -- Vessels and complete value objects.
  for v_item in
    select value from jsonb_array_elements(p_legacy_payload -> 'vessels')
  loop
    if jsonb_typeof(v_item) <> 'object'
       or btrim(coalesce(v_item ->> 'id', '')) = ''
       or btrim(coalesce(v_item ->> 'name', '')) = ''
       or jsonb_typeof(v_item -> 'isActive') <> 'boolean'
       or jsonb_typeof(v_item -> 'position') <> 'object'
       or jsonb_typeof(v_item -> 'cargo') <> 'object'
       or jsonb_typeof(v_item -> 'note') <> 'object'
       or v_item -> 'position' ->> 'source'
          not in ('mock-smart-ship-api', 'manual', 'smart-ship-api')
       or v_item -> 'position' ->> 'navigationStatus'
          <> all(v_navigation_statuses)
       or v_item -> 'cargo' ->> 'source'
          not in ('mock-smart-ship-api', 'manual', 'smart-ship-api')
       or v_item -> 'cargo' ->> 'loadStatus' <> all(v_load_statuses) then
      raise exception using errcode = 'P0001', message = 'unknown-vessel-domain';
    end if;
    v_statuses := public.sd_legacy_text_array(v_item -> 'note', 'statusList', false);
    if exists (
      select 1 from unnest(v_statuses) value
      where value <> all(v_ship_statuses)
    ) then
      raise exception using errcode = 'P0001', message = 'unknown-vessel-domain';
    end if;
    v_statuses := public.sd_legacy_text_array(v_item, 'weeklyAttention', false);
    if exists (
      select 1 from unnest(v_statuses) value
      where value <> all(v_weekly_attention)
    ) or (
      btrim(coalesce(v_item ->> 'manualAttentionLevel', '')) <> ''
      and v_item ->> 'manualAttentionLevel' <> all(
        v_priorities || array['特別關注']
      )
    ) then
      raise exception using errcode = 'P0001', message = 'unknown-vessel-domain';
    end if;
    perform public.sd_legacy_text_array(v_item, 'fleetTags', false);
    perform public.sd_legacy_text_array(v_item, 'assignedUserIds', false);
    if jsonb_typeof(v_item -> 'delegateManagers') <> 'array'
       or exists (
         select 1 from jsonb_array_elements(v_item -> 'delegateManagers') delegate
         where jsonb_typeof(delegate) <> 'object'
            or btrim(coalesce(delegate ->> 'userId', '')) = ''
            or jsonb_typeof(delegate -> 'isActive') <> 'boolean'
       )
       or (
         select count(*) from jsonb_array_elements(v_item -> 'delegateManagers')
       ) <> (
         select count(distinct delegate ->> 'userId')
         from jsonb_array_elements(v_item -> 'delegateManagers') delegate
       ) then
      raise exception using errcode = 'P0001', message = 'invalid-vessel-delegation';
    end if;
    v_created_at := public.sd_legacy_timestamp(
      v_item ->> 'createdAt', v_imported_at
    );
    v_updated_at := public.sd_legacy_timestamp(
      v_item ->> 'updatedAt', v_created_at
    );
    insert into public.sd_vessels(
      workspace_id, id, name, short_name, full_name, ship_type,
      fleet_category, fleet_tags, position, cargo, note,
      weekly_attention, manual_attention_level, is_active, version,
      created_at, created_by, updated_at, updated_by
    ) values (
      p_workspace_id, v_item ->> 'id', btrim(v_item ->> 'name'),
      coalesce(v_item ->> 'shortName', ''), coalesce(v_item ->> 'fullName', ''),
      coalesce(v_item ->> 'shipType', ''), coalesce(v_item ->> 'fleetCategory', ''),
      public.sd_legacy_text_array(v_item, 'fleetTags', false),
      v_item -> 'position', v_item -> 'cargo', v_item -> 'note',
      public.sd_legacy_text_array(v_item, 'weeklyAttention', false),
      nullif(v_item ->> 'manualAttentionLevel', ''),
      (v_item ->> 'isActive')::boolean, 1,
      v_created_at, v_owner_id, v_updated_at, v_owner_id
    );
  end loop;

  -- Canonical manager claims must agree in both legacy directions.
  if exists (
    select legacy_user ->> 'id' user_id, vessel_id
    from jsonb_array_elements(p_legacy_payload -> 'users') legacy_user
    cross join lateral unnest(
      public.sd_legacy_text_array(legacy_user, 'managedVesselIds', false)
    ) vessel_id
    where legacy_user ->> 'role' in ('admin', 'operator')
    except
    select user_id, vessel ->> 'id'
    from jsonb_array_elements(p_legacy_payload -> 'vessels') vessel
    cross join lateral unnest(
      public.sd_legacy_text_array(vessel, 'assignedUserIds', false)
    ) user_id
  ) or exists (
    select user_id, vessel ->> 'id'
    from jsonb_array_elements(p_legacy_payload -> 'vessels') vessel
    cross join lateral unnest(
      public.sd_legacy_text_array(vessel, 'assignedUserIds', false)
    ) user_id
    except
    select legacy_user ->> 'id', vessel_id
    from jsonb_array_elements(p_legacy_payload -> 'users') legacy_user
    cross join lateral unnest(
      public.sd_legacy_text_array(legacy_user, 'managedVesselIds', false)
    ) vessel_id
    where legacy_user ->> 'role' in ('admin', 'operator')
  ) then
    raise exception using errcode = 'P0001', message = 'manager-relation-drift';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_legacy_payload -> 'vessels') vessel
    cross join lateral unnest(
      public.sd_legacy_text_array(vessel, 'assignedUserIds', false)
    ) as assigned_user(legacy_user_id)
    where not exists (
      select 1 from public.sd_memberships m
      where m.workspace_id = p_workspace_id
        and m.legacy_user_id = assigned_user.legacy_user_id
        and m.role in ('admin', 'operator')
    )
  ) then
    raise exception using errcode = 'P0001', message = 'unknown-vessel-relation';
  end if;
  insert into public.sd_vessel_assignments(
    workspace_id, vessel_id, user_id, assignment_kind,
    is_active, created_at, updated_at, updated_by
  )
  select
    p_workspace_id, vessel ->> 'id', m.user_id, 'manager',
    m.is_active and (vessel ->> 'isActive')::boolean,
    v_imported_at, v_imported_at, v_owner_id
  from jsonb_array_elements(p_legacy_payload -> 'vessels') vessel
  cross join lateral unnest(
    public.sd_legacy_text_array(vessel, 'assignedUserIds', false)
  ) as assigned_user(legacy_user_id)
  join public.sd_memberships m
    on m.workspace_id = p_workspace_id
   and m.legacy_user_id = assigned_user.legacy_user_id;

  for v_item in
    select value from jsonb_array_elements(p_legacy_payload -> 'vessels')
  loop
    for v_nested in
      select value from jsonb_array_elements(v_item -> 'delegateManagers')
    loop
      select m.user_id into v_auth_id
      from public.sd_memberships m
      where m.workspace_id = p_workspace_id
        and m.legacy_user_id = v_nested ->> 'userId'
        and m.role in ('admin', 'operator');
      if v_auth_id is null
         or exists (
           select 1 from public.sd_vessel_assignments a
           where a.workspace_id = p_workspace_id
             and a.vessel_id = v_item ->> 'id'
             and a.user_id = v_auth_id
             and a.assignment_kind = 'manager'
         ) then
        raise exception using errcode = 'P0001', message = 'unknown-vessel-delegation';
      end if;
      insert into public.sd_vessel_assignments(
        workspace_id, vessel_id, user_id, assignment_kind,
        is_active, created_at, updated_at, updated_by
      ) values (
        p_workspace_id, v_item ->> 'id', v_auth_id, 'delegate',
        (v_nested ->> 'isActive')::boolean, v_imported_at,
        v_imported_at, v_owner_id
      );
    end loop;
  end loop;
  for v_item in
    select value
    from jsonb_array_elements(p_legacy_payload -> 'users')
    where value ->> 'role' = 'vessel'
  loop
    v_vessel_ids := public.sd_legacy_text_array(
      v_item, 'managedVesselIds', true
    );
    if cardinality(v_vessel_ids) <> 1
       or not exists (
         select 1 from public.sd_vessels v
         where v.workspace_id = p_workspace_id and v.id = v_vessel_ids[1]
       ) then
      raise exception using errcode = 'P0001', message = 'invalid-vessel-account-scope';
    end if;
    select m.user_id into v_auth_id
    from public.sd_memberships m
    where m.workspace_id = p_workspace_id
      and m.legacy_user_id = v_item ->> 'id';
    insert into public.sd_vessel_assignments(
      workspace_id, vessel_id, user_id, assignment_kind,
      is_active, created_at, updated_at, updated_by
    )
    select
      p_workspace_id, v_vessel_ids[1], v_auth_id, 'vessel_account',
      (v_item ->> 'isActive')::boolean and v.is_active,
      v_imported_at, v_imported_at, v_owner_id
    from public.sd_vessels v
    where v.workspace_id = p_workspace_id and v.id = v_vessel_ids[1];
  end loop;

  -- Meetings and all meeting-owned relation sets. No task lineage is inferred
  -- from description or date.
  for v_item in
    select value from jsonb_array_elements(p_legacy_payload -> 'meetings')
  loop
    if jsonb_typeof(v_item) <> 'object'
       or btrim(coalesce(v_item ->> 'id', '')) = ''
       or btrim(coalesce(v_item ->> 'subject', '')) = ''
       or btrim(coalesce(v_item ->> 'reason', '')) = ''
       or v_item ->> 'status' not in ('待召開', '追蹤中', '已完成')
       or v_item ->> 'priority' <> all(v_priorities)
       or coalesce(v_item ->> 'vesselScopeMode', 'vessels')
          not in ('all', 'types', 'vessels')
       or jsonb_typeof(v_item -> 'isAbnormal') <> 'boolean'
       or jsonb_typeof(v_item -> 'isInternalControl') <> 'boolean'
       or jsonb_typeof(v_item -> 'taskItems') <> 'array' then
      raise exception using errcode = 'P0001', message = 'unknown-meeting-domain';
    end if;
    v_vessel_ids := public.sd_legacy_text_array(v_item, 'vessels', true);
    v_type_scopes := public.sd_legacy_text_array(
      v_item, 'vesselTypeScopes', false
    );
    v_departments := public.sd_legacy_text_array(v_item, 'departments', false);
    v_report_date := public.sd_legacy_date(v_item ->> 'meetingDate', true);
    v_expected_date := public.sd_legacy_date(v_item ->> 'expectedDate', false);
    v_closed_date := public.sd_legacy_date(v_item ->> 'completedDate', false);
    if (v_item ->> 'status' = '已完成') is distinct from
       (v_closed_date is not null) then
      raise exception using errcode = 'P0001', message = 'invalid-meeting-completion';
    end if;
    if exists (
      select 1 from unnest(v_vessel_ids) vessel_id
      where not exists (
        select 1 from public.sd_vessels v
        where v.workspace_id = p_workspace_id
          and v.id = vessel_id and v.is_active
      )
    ) then
      raise exception using errcode = 'P0001', message = 'unknown-meeting-vessel';
    end if;
    if coalesce(v_item ->> 'vesselScopeMode', 'vessels') = 'all' then
      if cardinality(v_type_scopes) <> 0
         or v_vessel_ids is distinct from (
           select array_agg(v.id order by v.id)
           from public.sd_vessels v
           where v.workspace_id = p_workspace_id and v.is_active
         ) then
        raise exception using errcode = 'P0001', message = 'meeting-scope-drift';
      end if;
    elsif coalesce(v_item ->> 'vesselScopeMode', 'vessels') = 'types' then
      if cardinality(v_type_scopes) = 0
         or v_vessel_ids is distinct from (
           select array_agg(v.id order by v.id)
           from public.sd_vessels v
           where v.workspace_id = p_workspace_id
             and v.is_active and v.ship_type = any(v_type_scopes)
         ) then
        raise exception using errcode = 'P0001', message = 'meeting-scope-drift';
      end if;
    elsif cardinality(v_type_scopes) <> 0 then
      raise exception using errcode = 'P0001', message = 'meeting-scope-drift';
    end if;
    v_created_at := public.sd_legacy_timestamp(
      v_item ->> 'createdAt', v_imported_at
    );
    v_updated_at := public.sd_legacy_timestamp(
      v_item ->> 'updatedAt', v_created_at
    );
    v_actor_id := public.sd_legacy_actor(
      p_identity_mapping, v_item ->> 'createdBy', v_owner_id
    );
    insert into public.sd_meetings(
      workspace_id, id, scope_mode, subject, status, meeting_date,
      reason, resolution, expected_date, completed_date, completed_by,
      priority, is_abnormal, is_internal_control, include_in_morning,
      latest_status, version, created_at, created_by, updated_at, updated_by
    ) values (
      p_workspace_id, v_item ->> 'id',
      coalesce(v_item ->> 'vesselScopeMode', 'vessels'),
      btrim(v_item ->> 'subject'), v_item ->> 'status', v_report_date,
      btrim(v_item ->> 'reason'), coalesce(v_item ->> 'resolution', ''),
      v_expected_date, v_closed_date,
      case when v_closed_date is null then null else
        public.sd_legacy_actor(
          p_identity_mapping, v_item ->> 'completedBy', v_owner_id
        )
      end,
      v_item ->> 'priority',
      (v_item ->> 'isAbnormal')::boolean
        or (v_item ->> 'isInternalControl')::boolean,
      (v_item ->> 'isInternalControl')::boolean,
      coalesce((v_item ->> 'includeInMorning')::boolean, false),
      coalesce(v_item ->> 'latestStatus', ''),
      1, v_created_at, v_actor_id, v_updated_at, v_actor_id
    );
    insert into public.sd_meeting_vessels(workspace_id, meeting_id, vessel_id)
    select p_workspace_id, v_item ->> 'id', value
    from unnest(v_vessel_ids) value;
    insert into public.sd_meeting_type_scopes(
      workspace_id, meeting_id, ship_type
    )
    select p_workspace_id, v_item ->> 'id', value
    from unnest(v_type_scopes) value;
    insert into public.sd_meeting_departments(
      workspace_id, meeting_id, department
    )
    select p_workspace_id, v_item ->> 'id', value
    from unnest(v_departments) value;

    foreach v_key in array array[
      'participantUserIds', 'trackingUserIds', 'responsibleUserIds'
    ] loop
      v_owner_ids := public.sd_legacy_text_array(v_item, v_key, false);
      foreach v_task_id in array v_owner_ids loop
        select m.user_id into v_auth_id
        from public.sd_memberships m
        where m.workspace_id = p_workspace_id
          and m.legacy_user_id = v_task_id
          and m.is_active and m.role <> 'vessel';
        if v_auth_id is null then
          raise exception using errcode = 'P0001', message = 'unknown-meeting-person';
        end if;
        insert into public.sd_meeting_participants(
          workspace_id, meeting_id, user_id, participant_kind
        ) values (
          p_workspace_id, v_item ->> 'id', v_auth_id,
          case v_key
            when 'participantUserIds' then 'participant'
            when 'trackingUserIds' then 'tracking'
            else 'responsible'
          end
        );
      end loop;
    end loop;

    v_ordinal := 0;
    for v_nested in
      select value from jsonb_array_elements(v_item -> 'taskItems')
    loop
      v_ordinal := v_ordinal + 1;
      if jsonb_typeof(v_nested) <> 'object'
         or btrim(coalesce(v_nested ->> 'id', '')) = ''
         or btrim(coalesce(v_nested ->> 'description', '')) = ''
         or jsonb_typeof(v_nested -> 'distributeToVessels') <> 'boolean' then
        raise exception using errcode = 'P0001', message = 'invalid-meeting-item';
      end if;
      v_categories := public.sd_legacy_text_array(
        v_nested, 'categories', false
      );
      if exists (
        select 1 from unnest(v_categories) category
        where not (category = any(v_item_ids))
      ) then
        raise exception using errcode = 'P0001', message = 'unknown-meeting-category';
      end if;
      insert into public.sd_meeting_items(
        workspace_id, id, meeting_id, description,
        distribute_to_vessels, ordinal, is_active,
        created_at, created_by, updated_at, updated_by
      ) values (
        p_workspace_id, v_nested ->> 'id', v_item ->> 'id',
        btrim(v_nested ->> 'description'),
        (v_nested ->> 'distributeToVessels')::boolean,
        v_ordinal, true, v_created_at, v_actor_id, v_updated_at, v_actor_id
      );
      insert into public.sd_meeting_item_categories(
        workspace_id, meeting_item_id, category
      )
      select p_workspace_id, v_nested ->> 'id', value
      from unnest(v_categories) value;
    end loop;

    v_event_ordinal := 0;
    for v_log in
      select value from jsonb_array_elements(
        coalesce(v_item -> 'statusLogs', '[]'::jsonb)
      )
    loop
      v_event_ordinal := v_event_ordinal + 1;
      if btrim(coalesce(v_log ->> 'id', '')) = ''
         or btrim(coalesce(v_log ->> 'text', '')) = '' then
        raise exception using errcode = 'P0001', message = 'invalid-meeting-status-history';
      end if;
      insert into public.sd_meeting_status_events(
        workspace_id, id, meeting_id, status, actor_id, created_at,
        legacy_id, legacy_actor_label, legacy_payload
      ) values (
        p_workspace_id,
        public.sd_legacy_uuid(
          p_workspace_id::text || ':meeting-status:' ||
          (v_item ->> 'id') || ':' || (v_log ->> 'id')
        ),
        v_item ->> 'id', btrim(v_log ->> 'text'),
        public.sd_legacy_actor(
          p_identity_mapping, v_log ->> 'byUserId', v_owner_id
        ),
        public.sd_legacy_timestamp(v_log ->> 'at', v_updated_at),
        v_log ->> 'id', v_log ->> 'by', v_log
      );
    end loop;
  end loop;

  -- Tasks, canonical scope/progress relations, and status evidence.
  for v_item in
    select value from jsonb_array_elements(p_legacy_payload -> 'tasks')
  loop
    v_source_meeting_id := nullif(btrim(v_item ->> 'sourceMeetingId'), '');
    v_source_meeting_item_id := nullif(
      btrim(v_item ->> 'sourceMeetingItemId'), ''
    );
    v_meeting_semantics := (
      v_source_meeting_id is not null
      or v_source_meeting_item_id is not null
      or v_item ->> 'sourceType' = 'temporary'
      or v_item ->> 'attentionDimension' = 'meeting'
    );
    v_quarantine := v_meeting_semantics
      and v_source_meeting_id is null
      and v_source_meeting_item_id is null;
    if v_quarantine then
      v_quarantine_count := v_quarantine_count + 1;
      insert into public.sd_migration_quarantine(
        workspace_id, id, reason, legacy_revision,
        entity_type, entity_id, payload, version, created_at
      ) values (
        p_workspace_id,
        'legacy-task:' || (v_item ->> 'id') || ':r' ||
          p_expected_legacy_revision::text,
        'meeting_parent_item_missing',
        p_expected_legacy_revision,
        'task', v_item ->> 'id', v_item, 1, v_imported_at
      );
      continue;
    end if;
    if jsonb_typeof(v_item) <> 'object'
       or btrim(coalesce(v_item ->> 'id', '')) = ''
       or btrim(coalesce(v_item ->> 'description', '')) = ''
       or btrim(coalesce(v_item ->> 'status', '')) = ''
       or v_item ->> 'priority' <> all(v_priorities)
       or v_item ->> 'sourceType' not in ('morning', 'temporary')
       or coalesce(v_item ->> 'attentionDimension', 'task')
          not in ('task', 'meeting')
       or coalesce(v_item ->> 'vesselScopeMode', 'vessels')
          not in ('all', 'types', 'vessels')
       or jsonb_typeof(v_item -> 'isAware') <> 'boolean'
       or jsonb_typeof(v_item -> 'isAbnormal') <> 'boolean'
       or jsonb_typeof(v_item -> 'isInternalControl') <> 'boolean'
       or jsonb_typeof(v_item -> 'isClosed') <> 'boolean' then
      raise exception using errcode = 'P0001', message = 'unknown-task-domain';
    end if;
    if v_meeting_semantics and (
      v_source_meeting_id is null
      or v_source_meeting_item_id is null
      or v_item ->> 'sourceType' <> 'temporary'
      or coalesce(v_item ->> 'attentionDimension', 'task') <> 'meeting'
      or not exists (
        select 1
        from public.sd_meeting_items mi
        where mi.workspace_id = p_workspace_id
          and mi.id = v_source_meeting_item_id
          and mi.meeting_id = v_source_meeting_id
          and mi.is_active
      )
    ) then
      raise exception using errcode = 'P0001', message = 'invalid-meeting-task-relation';
    end if;
    if not v_meeting_semantics and (
      v_item ->> 'sourceType' <> 'morning'
      or coalesce(v_item ->> 'attentionDimension', 'task') <> 'task'
    ) then
      raise exception using errcode = 'P0001', message = 'invalid-task-provenance';
    end if;
    if v_meeting_semantics and (
      select count(*)
      from jsonb_array_elements(p_legacy_payload -> 'tasks') candidate
      where nullif(btrim(candidate ->> 'sourceMeetingItemId'), '')
        = v_source_meeting_item_id
    ) <> 1 then
      raise exception using errcode = 'P0001', message = 'ambiguous-meeting-task-relation';
    end if;

    v_vessel_ids := array(
      select distinct value
      from unnest(
        array[nullif(btrim(v_item ->> 'vesselId'), '')]
        || public.sd_legacy_text_array(v_item, 'vesselIds', false)
      ) value
      where value is not null
      order by value
    );
    if cardinality(v_vessel_ids) = 0
       or exists (
         select 1 from unnest(v_vessel_ids) vessel_id
         where not exists (
           select 1 from public.sd_vessels v
           where v.workspace_id = p_workspace_id and v.id = vessel_id
         )
       ) then
      raise exception using errcode = 'P0001', message = 'unknown-task-vessel-relation';
    end if;
    if v_meeting_semantics and v_vessel_ids is distinct from (
      select array_agg(mv.vessel_id order by mv.vessel_id)
      from public.sd_meeting_vessels mv
      where mv.workspace_id = p_workspace_id
        and mv.meeting_id = v_source_meeting_id
    ) then
      raise exception using errcode = 'P0001', message = 'meeting-task-scope-drift';
    end if;
    v_type_scopes := public.sd_legacy_text_array(
      v_item, 'vesselTypeScopes', false
    );
    v_categories := public.sd_legacy_text_array(v_item, 'categories', false);
    if cardinality(v_categories) = 0
       and btrim(coalesce(v_item ->> 'category', '')) <> '' then
      v_categories := array[btrim(v_item ->> 'category')];
    end if;
    if exists (
      select 1 from unnest(v_categories) category
      where not (
        category = any(
          case when v_meeting_semantics then v_item_ids else v_categories end
        )
      )
    ) then
      -- The ordinary branch is checked below without shadowing v_categories.
      null;
    end if;
    if v_meeting_semantics and exists (
      select 1 from unnest(v_categories) category
      where not (category = any(v_item_ids))
    ) then
      raise exception using errcode = 'P0001', message = 'unknown-task-category';
    elsif not v_meeting_semantics and exists (
      select 1 from unnest(v_categories) category
      where not exists (
        select 1 from public.sd_category_options option_row
        where option_row.workspace_id = p_workspace_id
          and option_row.category_scope = 'ordinary'
          and option_row.category = category
          and option_row.is_active
      )
    ) then
      raise exception using errcode = 'P0001', message = 'unknown-task-category';
    end if;
    v_departments := public.sd_legacy_text_array(v_item, 'departments', false);
    v_owner_ids := public.sd_legacy_text_array(v_item, 'ownerUserIds', false);
    foreach v_task_id in array v_owner_ids loop
      if not exists (
        select 1 from public.sd_memberships m
        where m.workspace_id = p_workspace_id
          and m.legacy_user_id = v_task_id
          and m.is_active and m.role <> 'vessel'
      ) then
        raise exception using errcode = 'P0001', message = 'unknown-task-owner';
      end if;
    end loop;
    v_created_at := public.sd_legacy_timestamp(
      v_item ->> 'createdAt', v_imported_at
    );
    v_updated_at := public.sd_legacy_timestamp(
      v_item ->> 'updatedAt', v_created_at
    );
    v_closed := (v_item ->> 'isClosed')::boolean;
    v_closed_date := public.sd_legacy_date(v_item ->> 'closedDate', false);
    if v_closed and v_closed_date is null then
      raise exception using errcode = 'P0001', message = 'invalid-task-closure';
    elsif not v_closed and v_closed_date is not null then
      raise exception using errcode = 'P0001', message = 'invalid-task-closure';
    end if;
    v_closed_by := case when v_closed then
      public.sd_legacy_actor(
        p_identity_mapping, v_item ->> 'closedBy', v_owner_id
      )
      else null end;
    v_expected_date := public.sd_legacy_date(
      v_item ->> 'expectedDate', false
    );
    v_report_date := public.sd_legacy_date(v_item ->> 'reportDate', false);
    v_actor_id := public.sd_legacy_actor(
      p_identity_mapping, v_item ->> 'updatedBy', v_owner_id
    );

    insert into public.sd_tasks(
      workspace_id, id, description, status, priority,
      source_kind, attention_dimension, is_internal_control, is_abnormal,
      is_aware, is_closed, closed_date, closed_by, expected_date, report_date,
      version, created_at, created_by, updated_at, updated_by,
      source_type, source_meeting_id, source_meeting_item_id,
      equipment_subcategory, vessel_scope_mode, distribute_to_vessels,
      category, internal_control_cancelled_at, internal_control_cancelled_by
    ) values (
      p_workspace_id, v_item ->> 'id', btrim(v_item ->> 'description'),
      btrim(v_item ->> 'status'), v_item ->> 'priority',
      case when v_meeting_semantics then 'meeting' else 'ordinary' end,
      coalesce(v_item ->> 'attentionDimension', 'task'),
      (v_item ->> 'isInternalControl')::boolean,
      (v_item ->> 'isAbnormal')::boolean
        or (v_item ->> 'isInternalControl')::boolean,
      (v_item ->> 'isAware')::boolean, v_closed, v_closed_date, v_closed_by,
      v_expected_date, v_report_date, 1,
      v_created_at,
      public.sd_legacy_actor(
        p_identity_mapping, v_item ->> 'createdBy', v_owner_id
      ),
      v_updated_at, v_actor_id,
      v_item ->> 'sourceType', v_source_meeting_id,
      v_source_meeting_item_id,
      nullif(btrim(v_item ->> 'equipmentSubcategory'), ''),
      coalesce(v_item ->> 'vesselScopeMode', 'vessels'),
      coalesce((v_item ->> 'distributeToVessels')::boolean, false),
      coalesce(v_categories[1], ''),
      public.sd_legacy_timestamp(
        v_item ->> 'internalControlCancelledAt', null
      ),
      case
        when btrim(coalesce(v_item ->> 'internalControlCancelledAt', '')) = ''
        then null
        else public.sd_legacy_actor(
          p_identity_mapping,
          v_item ->> 'internalControlCancelledBy',
          v_owner_id
        )
      end
    );
    insert into public.sd_task_categories(
      workspace_id, task_id, category, ordinal
    )
    select p_workspace_id, v_item ->> 'id', value, ordinal::integer - 1
    from unnest(v_categories) with ordinality category(value, ordinal);
    insert into public.sd_task_departments(
      workspace_id, task_id, department, ordinal
    )
    select p_workspace_id, v_item ->> 'id', value, ordinal::integer - 1
    from unnest(v_departments) with ordinality department(value, ordinal);
    insert into public.sd_task_type_scopes(
      workspace_id, task_id, type_scope, ordinal
    )
    select p_workspace_id, v_item ->> 'id', value, ordinal::integer - 1
    from unnest(v_type_scopes) with ordinality scope(value, ordinal);
    foreach v_task_id in array v_owner_ids loop
      select m.user_id into v_auth_id
      from public.sd_memberships m
      where m.workspace_id = p_workspace_id
        and m.legacy_user_id = v_task_id;
      insert into public.sd_task_owners(
        workspace_id, task_id, owner_id, ordinal
      ) values (
        p_workspace_id, v_item ->> 'id', v_auth_id,
        array_position(v_owner_ids, v_task_id) - 1
      );
    end loop;

    foreach v_vessel_id in array v_vessel_ids loop
      select value into v_progress
      from jsonb_array_elements(
        coalesce(v_item -> 'vesselProgress', '[]'::jsonb)
      )
      where value ->> 'vesselId' = v_vessel_id;
      if (
        select count(*)
        from jsonb_array_elements(
          coalesce(v_item -> 'vesselProgress', '[]'::jsonb)
        ) progress
        where progress ->> 'vesselId' = v_vessel_id
      ) > 1 then
        raise exception using errcode = 'P0001', message = 'duplicate-task-progress';
      end if;
      v_progress_status := coalesce(
        nullif(btrim(v_progress ->> 'status'), ''),
        btrim(v_item ->> 'status')
      );
      v_progress_closed := coalesce(
        (v_progress ->> 'isClosed')::boolean, v_closed
      );
      v_progress_closed_date := public.sd_legacy_date(
        v_progress ->> 'closedDate', false
      );
      if v_progress_closed and v_progress_closed_date is null then
        v_progress_closed_date := v_closed_date;
      end if;
      if v_progress_closed and v_progress_closed_date is null then
        raise exception using errcode = 'P0001', message = 'invalid-progress-closure';
      end if;
      v_progress_closed_by := case when v_progress_closed then
        public.sd_legacy_actor(
          p_identity_mapping,
          coalesce(v_progress ->> 'closedBy', v_item ->> 'closedBy'),
          v_owner_id
        )
        else null end;
      insert into public.sd_task_vessels(
        workspace_id, task_id, vessel_id, is_active_scope,
        status, is_closed, closed_date, closed_by,
        version, updated_at, updated_by
      ) values (
        p_workspace_id, v_item ->> 'id', v_vessel_id, true,
        v_progress_status, v_progress_closed,
        case when v_progress_closed then v_progress_closed_date else null end,
        v_progress_closed_by, 1,
        public.sd_legacy_timestamp(
          v_progress ->> 'updatedAt', v_updated_at
        ),
        public.sd_legacy_actor(
          p_identity_mapping,
          coalesce(v_progress ->> 'updatedBy', v_item ->> 'updatedBy'),
          v_owner_id
        )
      );
      for v_log in
        select value from jsonb_array_elements(
          coalesce(v_progress -> 'statusLogs', '[]'::jsonb)
        )
      loop
        if btrim(coalesce(v_log ->> 'id', '')) = ''
           or btrim(coalesce(v_log ->> 'text', '')) = '' then
          raise exception using errcode = 'P0001', message = 'invalid-progress-history';
        end if;
        insert into public.sd_task_vessel_status_events(
          workspace_id, id, task_id, vessel_id, status, is_closed,
          actor_id, created_at, legacy_id, legacy_actor_label, legacy_payload
        ) values (
          p_workspace_id,
          public.sd_legacy_uuid(
            p_workspace_id::text || ':task-progress-status:' ||
            (v_item ->> 'id') || ':' || v_vessel_id || ':' || (v_log ->> 'id')
          ),
          v_item ->> 'id', v_vessel_id, btrim(v_log ->> 'text'),
          v_progress_closed,
          public.sd_legacy_actor(
            p_identity_mapping, v_log ->> 'byUserId', v_owner_id
          ),
          public.sd_legacy_timestamp(v_log ->> 'at', v_updated_at),
          v_log ->> 'id', v_log ->> 'by', v_log
        );
      end loop;
    end loop;
    if exists (
      select 1
      from jsonb_array_elements(
        coalesce(v_item -> 'vesselProgress', '[]'::jsonb)
      ) progress
      where not ((progress ->> 'vesselId') = any(v_vessel_ids))
    ) then
      raise exception using errcode = 'P0001', message = 'unknown-progress-vessel';
    end if;
    for v_log in
      select value from jsonb_array_elements(
        coalesce(v_item -> 'statusLogs', '[]'::jsonb)
      )
    loop
      if btrim(coalesce(v_log ->> 'id', '')) = ''
         or btrim(coalesce(v_log ->> 'text', '')) = '' then
        raise exception using errcode = 'P0001', message = 'invalid-task-status-history';
      end if;
      insert into public.sd_task_status_events(
        workspace_id, id, task_id, status, actor_id, created_at,
        legacy_id, legacy_actor_label, legacy_payload
      ) values (
        p_workspace_id,
        public.sd_legacy_uuid(
          p_workspace_id::text || ':task-status:' ||
          (v_item ->> 'id') || ':' || (v_log ->> 'id')
        ),
        v_item ->> 'id', btrim(v_log ->> 'text'),
        public.sd_legacy_actor(
          p_identity_mapping, v_log ->> 'byUserId', v_owner_id
        ),
        public.sd_legacy_timestamp(v_log ->> 'at', v_updated_at),
        v_log ->> 'id', v_log ->> 'by', v_log
      );
    end loop;
  end loop;

  if v_quarantine_count <> p_expected_quarantine_count then
    raise exception using errcode = 'P0001', message = 'quarantine-count-mismatch';
  end if;

  -- Internal-control cases and exact reciprocal one-to-one links.
  if exists (
    select linked_task_id
    from (
      select nullif(btrim(item ->> 'linkedTaskId'), '') linked_task_id
      from jsonb_array_elements(
        p_legacy_payload -> 'internalControlCases'
      ) item
    ) links
    where linked_task_id is not null
    group by linked_task_id
    having count(*) <> 1
  ) then
    raise exception using errcode = 'P0001', message = 'ambiguous-internal-link';
  end if;
  for v_item in
    select value
    from jsonb_array_elements(p_legacy_payload -> 'internalControlCases')
  loop
    if jsonb_typeof(v_item) <> 'object'
       or btrim(coalesce(v_item ->> 'id', '')) = ''
       or btrim(coalesce(v_item ->> 'vesselId', '')) = ''
       or btrim(coalesce(v_item ->> 'description', '')) = ''
       or btrim(coalesce(v_item ->> 'category', '')) = ''
       or btrim(coalesce(v_item ->> 'status', '')) = ''
       or v_item ->> 'priority' <> all(v_priorities)
       or v_item ->> 'reportSource' not in ('日常', '訪船', '隨船', '外部')
       or v_item ->> 'origin' not in ('internal-control', 'task')
       or jsonb_typeof(v_item -> 'isAware') <> 'boolean'
       or jsonb_typeof(v_item -> 'isClosed') <> 'boolean'
       or jsonb_typeof(v_item -> 'syncToTask') <> 'boolean'
       or not exists (
         select 1 from public.sd_vessels v
         where v.workspace_id = p_workspace_id
           and v.id = v_item ->> 'vesselId'
       ) then
      raise exception using errcode = 'P0001', message = 'unknown-internal-domain';
    end if;
    v_task_id := nullif(btrim(v_item ->> 'linkedTaskId'), '');
    if ((v_item ->> 'syncToTask')::boolean) is distinct from
       (v_task_id is not null) then
      raise exception using errcode = 'P0001', message = 'invalid-internal-link';
    end if;
    if v_task_id is not null and not exists (
      select 1
      from public.sd_tasks t
      join public.sd_task_vessels tv
        on tv.workspace_id = t.workspace_id
       and tv.task_id = t.id
       and tv.is_active_scope
      where t.workspace_id = p_workspace_id
        and t.id = v_task_id
        and t.source_kind = 'ordinary'
        and t.is_internal_control
        and t.source_meeting_item_id is null
        and tv.vessel_id = v_item ->> 'vesselId'
        and (
          select count(*) from public.sd_task_vessels scope_row
          where scope_row.workspace_id = t.workspace_id
            and scope_row.task_id = t.id
            and scope_row.is_active_scope
        ) = 1
    ) then
      raise exception using errcode = 'P0001', message = 'invalid-internal-link';
    end if;
    if v_task_id is not null and not exists (
      select 1
      from jsonb_array_elements(p_legacy_payload -> 'tasks') task
      where task ->> 'id' = v_task_id
        and task ->> 'internalControlCaseId' = v_item ->> 'id'
    ) then
      raise exception using errcode = 'P0001', message = 'ambiguous-internal-link';
    end if;
    v_departments := public.sd_legacy_text_array(v_item, 'departments', false);
    v_created_at := public.sd_legacy_timestamp(
      v_item ->> 'createdAt', v_imported_at
    );
    v_updated_at := public.sd_legacy_timestamp(
      v_item ->> 'updatedAt', v_created_at
    );
    v_closed := (v_item ->> 'isClosed')::boolean;
    v_closed_date := public.sd_legacy_date(v_item ->> 'closedDate', false);
    if v_closed and v_closed_date is null then
      raise exception using errcode = 'P0001', message = 'invalid-internal-closure';
    elsif not v_closed and v_closed_date is not null then
      raise exception using errcode = 'P0001', message = 'invalid-internal-closure';
    end if;
    v_report_date := public.sd_legacy_date(v_item ->> 'reportDate', true);
    if v_closed_date is not null and v_closed_date < v_report_date then
      raise exception using errcode = 'P0001', message = 'invalid-internal-closure';
    end if;
    v_actor_id := public.sd_legacy_actor(
      p_identity_mapping, v_item ->> 'updatedBy', v_owner_id
    );
    insert into public.sd_internal_cases(
      workspace_id, id, vessel_id, report_date, report_source,
      description, priority, category, equipment_subcategory,
      is_aware, status, origin, is_closed, closed_date, closed_by,
      version, created_at, created_by, updated_at, updated_by
    ) values (
      p_workspace_id, v_item ->> 'id', v_item ->> 'vesselId',
      v_report_date, v_item ->> 'reportSource',
      btrim(v_item ->> 'description'), v_item ->> 'priority',
      btrim(v_item ->> 'category'),
      case when v_item ->> 'category' = '設備故障'
        then nullif(btrim(v_item ->> 'equipmentSubcategory'), '')
        else null end,
      (v_item ->> 'isAware')::boolean, btrim(v_item ->> 'status'),
      v_item ->> 'origin', v_closed, v_closed_date,
      case when v_closed then
        public.sd_legacy_actor(
          p_identity_mapping, v_item ->> 'closedBy', v_owner_id
        )
        else null end,
      1, v_created_at,
      public.sd_legacy_actor(
        p_identity_mapping, v_item ->> 'createdBy', v_owner_id
      ),
      v_updated_at, v_actor_id
    );
    insert into public.sd_internal_case_departments(
      workspace_id, case_id, department, ordinal
    )
    select p_workspace_id, v_item ->> 'id', value, ordinal::integer - 1
    from unnest(v_departments) with ordinality department(value, ordinal);
    for v_log in
      select value from jsonb_array_elements(
        coalesce(v_item -> 'statusLogs', '[]'::jsonb)
      )
    loop
      if btrim(coalesce(v_log ->> 'id', '')) = ''
         or btrim(coalesce(v_log ->> 'text', '')) = '' then
        raise exception using errcode = 'P0001', message = 'invalid-internal-history';
      end if;
      insert into public.sd_internal_case_status_events(
        workspace_id, id, case_id, event_kind, status,
        actor_id, created_at, legacy_id, legacy_actor_label, legacy_payload
      ) values (
        p_workspace_id,
        public.sd_legacy_uuid(
          p_workspace_id::text || ':internal-status:' ||
          (v_item ->> 'id') || ':' || (v_log ->> 'id')
        ),
        v_item ->> 'id', 'updated', btrim(v_log ->> 'text'),
        public.sd_legacy_actor(
          p_identity_mapping, v_log ->> 'byUserId', v_owner_id
        ),
        public.sd_legacy_timestamp(v_log ->> 'at', v_updated_at),
        v_log ->> 'id', v_log ->> 'by', v_log
      );
    end loop;
  end loop;
  if exists (
    select 1
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id
      and t.is_internal_control
      and t.source_kind = 'ordinary'
      and not exists (
        select 1
        from jsonb_array_elements(
          p_legacy_payload -> 'internalControlCases'
        ) legacy_case
        where legacy_case ->> 'id' = (
          select task ->> 'internalControlCaseId'
          from jsonb_array_elements(p_legacy_payload -> 'tasks') task
          where task ->> 'id' = t.id
        )
          and legacy_case ->> 'linkedTaskId' = t.id
          and (legacy_case ->> 'syncToTask')::boolean
      )
  ) then
    raise exception using errcode = 'P0001', message = 'ambiguous-internal-link';
  end if;
  insert into public.sd_internal_case_task_links(
    workspace_id, case_id, task_id, version, created_at, created_by
  )
  select
    p_workspace_id, legacy_case ->> 'id',
    legacy_case ->> 'linkedTaskId', 1, v_imported_at, v_owner_id
  from jsonb_array_elements(
    p_legacy_payload -> 'internalControlCases'
  ) legacy_case
  where nullif(btrim(legacy_case ->> 'linkedTaskId'), '') is not null;

  -- Notifications, saved reports, and legacy audit evidence.
  for v_item in
    select value from jsonb_array_elements(p_legacy_payload -> 'notifications')
  loop
    if jsonb_typeof(v_item) <> 'object'
       or btrim(coalesce(v_item ->> 'id', '')) = ''
       or btrim(coalesce(v_item ->> 'title', '')) = ''
       or btrim(coalesce(v_item ->> 'message', '')) = ''
       or v_item ->> 'kind' <> all(v_notification_kinds) then
      raise exception using errcode = 'P0001', message = 'unknown-notification-domain';
    end if;
    select m.user_id into v_auth_id
    from public.sd_memberships m
    where m.workspace_id = p_workspace_id
      and m.legacy_user_id = v_item ->> 'userId';
    if v_auth_id is null
       or not exists (
         select 1 from public.sd_vessels v
         where v.workspace_id = p_workspace_id
           and v.id = v_item ->> 'vesselId'
       )
       or not exists (
         select 1 from public.sd_tasks t
         where t.workspace_id = p_workspace_id
           and t.id = v_item ->> 'taskId'
       ) then
      raise exception using errcode = 'P0001', message = 'unknown-notification-relation';
    end if;
    insert into public.sd_notifications(
      workspace_id, id, recipient_id, vessel_id, task_id,
      kind, title, message, actor_id, read_at, version, created_at
    ) values (
      p_workspace_id, v_item ->> 'id', v_auth_id,
      v_item ->> 'vesselId', v_item ->> 'taskId',
      v_item ->> 'kind', btrim(v_item ->> 'title'),
      v_item ->> 'message',
      public.sd_legacy_actor(
        p_identity_mapping, v_item ->> 'actorId', v_owner_id
      ),
      public.sd_legacy_timestamp(v_item ->> 'readAt', null),
      1,
      public.sd_legacy_timestamp(v_item ->> 'createdAt', v_imported_at)
    );
  end loop;

  for v_item in select value from jsonb_array_elements(v_report_array)
  loop
    v_vessel_ids := public.sd_legacy_text_array(v_item, 'vesselIds', true);
    if btrim(coalesce(v_item ->> 'id', '')) = ''
       or btrim(coalesce(v_item ->> 'title', '')) = ''
       or exists (
         select 1 from unnest(v_vessel_ids) vessel_id
         where not exists (
           select 1 from public.sd_vessels v
           where v.workspace_id = p_workspace_id and v.id = vessel_id
         )
       ) then
      raise exception using errcode = 'P0001', message = 'unknown-saved-report-relation';
    end if;
    begin
      v_ordinal := (v_item ->> 'taskCount')::integer;
    exception when others then
      raise exception using errcode = 'P0001', message = 'invalid-saved-report';
    end;
    if v_ordinal < 0 then
      raise exception using errcode = 'P0001', message = 'invalid-saved-report';
    end if;
    insert into public.sd_saved_reports(
      workspace_id, id, title, task_count, version, created_at, created_by
    ) values (
      p_workspace_id, v_item ->> 'id', btrim(v_item ->> 'title'),
      v_ordinal, 1,
      public.sd_legacy_timestamp(v_item ->> 'createdAt', v_imported_at),
      public.sd_legacy_actor(
        p_identity_mapping, v_item ->> 'createdBy', v_owner_id
      )
    );
    insert into public.sd_saved_report_vessels(
      workspace_id, report_id, vessel_id, ordinal
    )
    select p_workspace_id, v_item ->> 'id', value, ordinal::integer - 1
    from unnest(v_vessel_ids) with ordinality vessel(value, ordinal);
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_legacy_payload -> 'auditLogs')
  loop
    if btrim(coalesce(v_item ->> 'id', '')) = ''
       or btrim(coalesce(v_item ->> 'action', '')) = ''
       or btrim(coalesce(v_item ->> 'entityType', '')) = ''
       or btrim(coalesce(v_item ->> 'entityId', '')) = ''
       or coalesce(v_item ->> 'actorRole', 'system')
          not in ('owner', 'admin', 'operator', 'vessel', 'system') then
      raise exception using errcode = 'P0001', message = 'unknown-audit-domain';
    end if;
    insert into public.sd_audit_events(
      workspace_id, id, actor_id, command, entity_type, entity_id,
      detail, created_at, legacy_id, legacy_actor_id,
      legacy_actor_name, legacy_actor_role, legacy_detail, legacy_payload
    ) values (
      p_workspace_id,
      public.sd_legacy_uuid(
        p_workspace_id::text || ':legacy-audit:' || (v_item ->> 'id')
      ),
      public.sd_legacy_actor(
        p_identity_mapping, v_item ->> 'actorId', v_owner_id
      ),
      'legacy:' || btrim(v_item ->> 'action'),
      btrim(v_item ->> 'entityType'), btrim(v_item ->> 'entityId'),
      jsonb_build_object(
        'source', 'legacy-import',
        'actorMapped', exists (
          select 1 from jsonb_array_elements(p_identity_mapping) mapping
          where mapping ->> 'legacyUserId' = v_item ->> 'actorId'
        )
      ),
      public.sd_legacy_timestamp(v_item ->> 'at', v_imported_at),
      v_item ->> 'id', v_item ->> 'actorId', v_item ->> 'actorName',
      coalesce(v_item ->> 'actorRole', 'system'),
      coalesce(v_item ->> 'detail', ''), v_item
    );
  end loop;

  v_payload_hash := encode(
    sha256(convert_to(p_legacy_payload::text, 'UTF8')), 'hex'
  );
  v_mapping_hash := encode(
    sha256(convert_to(p_identity_mapping::text, 'UTF8')), 'hex'
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id,
    detail, created_at
  ) values (
    p_workspace_id,
    public.sd_legacy_uuid(
      p_workspace_id::text || ':legacy-import:' ||
      p_expected_legacy_revision::text
    ),
    v_owner_id, 'legacy_import', 'workspace', p_workspace_id::text,
    jsonb_build_object(
      'source', 'legacy-import',
      'legacyRevision', p_expected_legacy_revision,
      'payloadSha256', v_payload_hash,
      'quarantineCount', v_quarantine_count
    ),
    v_imported_at
  );

  select jsonb_build_object(
    'users', (select count(*) from public.sd_memberships where workspace_id = p_workspace_id),
    'activeUsers', (select count(*) from public.sd_memberships where workspace_id = p_workspace_id and is_active),
    'loginOptions', (select count(*) from public.sd_login_options where workspace_id = p_workspace_id),
    'vessels', (select count(*) from public.sd_vessels where workspace_id = p_workspace_id),
    'managerAssignments', (select count(*) from public.sd_vessel_assignments where workspace_id = p_workspace_id and assignment_kind = 'manager'),
    'delegateAssignments', (select count(*) from public.sd_vessel_assignments where workspace_id = p_workspace_id and assignment_kind = 'delegate'),
    'vesselAccountAssignments', (select count(*) from public.sd_vessel_assignments where workspace_id = p_workspace_id and assignment_kind = 'vessel_account'),
    'sourceTasks', jsonb_array_length(p_legacy_payload -> 'tasks'),
    'importedTasks', (select count(*) from public.sd_tasks where workspace_id = p_workspace_id),
    'quarantine', (select count(*) from public.sd_migration_quarantine where workspace_id = p_workspace_id),
    'taskVessels', (select count(*) from public.sd_task_vessels where workspace_id = p_workspace_id),
    'taskCategories', (select count(*) from public.sd_task_categories where workspace_id = p_workspace_id),
    'taskDepartments', (select count(*) from public.sd_task_departments where workspace_id = p_workspace_id),
    'taskOwners', (select count(*) from public.sd_task_owners where workspace_id = p_workspace_id),
    'taskTypeScopes', (select count(*) from public.sd_task_type_scopes where workspace_id = p_workspace_id),
    'taskStatusEvents', (select count(*) from public.sd_task_status_events where workspace_id = p_workspace_id),
    'taskVesselStatusEvents', (select count(*) from public.sd_task_vessel_status_events where workspace_id = p_workspace_id),
    'meetings', (select count(*) from public.sd_meetings where workspace_id = p_workspace_id),
    'meetingVessels', (select count(*) from public.sd_meeting_vessels where workspace_id = p_workspace_id),
    'meetingTypeScopes', (select count(*) from public.sd_meeting_type_scopes where workspace_id = p_workspace_id),
    'meetingDepartments', (select count(*) from public.sd_meeting_departments where workspace_id = p_workspace_id),
    'meetingParticipants', (select count(*) from public.sd_meeting_participants where workspace_id = p_workspace_id and participant_kind = 'participant'),
    'meetingTracking', (select count(*) from public.sd_meeting_participants where workspace_id = p_workspace_id and participant_kind = 'tracking'),
    'meetingResponsible', (select count(*) from public.sd_meeting_participants where workspace_id = p_workspace_id and participant_kind = 'responsible'),
    'meetingItems', (select count(*) from public.sd_meeting_items where workspace_id = p_workspace_id),
    'meetingItemCategories', (select count(*) from public.sd_meeting_item_categories where workspace_id = p_workspace_id),
    'internalCases', (select count(*) from public.sd_internal_cases where workspace_id = p_workspace_id),
    'internalCaseDepartments', (select count(*) from public.sd_internal_case_departments where workspace_id = p_workspace_id),
    'internalCaseStatusEvents', (select count(*) from public.sd_internal_case_status_events where workspace_id = p_workspace_id),
    'internalLinks', (select count(*) from public.sd_internal_case_task_links where workspace_id = p_workspace_id),
    'notifications', (select count(*) from public.sd_notifications where workspace_id = p_workspace_id),
    'legacyAuditEvents', (select count(*) from public.sd_audit_events where workspace_id = p_workspace_id and legacy_id is not null),
    'migrationAuditEvents', (select count(*) from public.sd_audit_events where workspace_id = p_workspace_id and command = 'legacy_import'),
    'savedReports', (select count(*) from public.sd_saved_reports where workspace_id = p_workspace_id),
    'savedReportVessels', (select count(*) from public.sd_saved_report_vessels where workspace_id = p_workspace_id),
    'departments', (select count(*) from public.sd_departments where workspace_id = p_workspace_id),
    'ordinaryCategories', (select count(*) from public.sd_category_options where workspace_id = p_workspace_id and category_scope = 'ordinary'),
    'meetingCategories', (select count(*) from public.sd_category_options where workspace_id = p_workspace_id and category_scope = 'meeting'),
    'priorities', (select count(*) from public.sd_priority_options where workspace_id = p_workspace_id),
    'equipmentOptions', (select count(*) from public.sd_equipment_options where workspace_id = p_workspace_id),
    'rolePermissions', (select count(*) from public.sd_role_permissions where workspace_id = p_workspace_id),
    'settings', (select count(*) from public.sd_settings where workspace_id = p_workspace_id)
  ) into v_actual_counts;

  if v_actual_counts <> p_expected_counts then
    raise exception using errcode = 'P0001', message = 'import-count-drift';
  end if;
  if (v_actual_counts ->> 'quarantine')::integer
     <> p_expected_quarantine_count then
    raise exception using errcode = 'P0001', message = 'quarantine-count-mismatch';
  end if;

  insert into public.sd_legacy_imports(
    workspace_id, legacy_revision, payload_sha256, mapping_sha256,
    counts, quarantine_count, imported_at
  ) values (
    p_workspace_id, p_expected_legacy_revision, v_payload_hash, v_mapping_hash,
    v_actual_counts, v_quarantine_count, v_imported_at
  );

  return jsonb_build_object(
    'status', 'committed',
    'workspaceId', p_workspace_id,
    'legacyRevision', p_expected_legacy_revision,
    'payloadSha256', v_payload_hash,
    'mappingSha256', v_mapping_hash,
    'counts', v_actual_counts,
    'quarantineCount', v_quarantine_count
  );
end;
$$;

revoke all on function public.sd_legacy_uuid(text) from public, anon, authenticated;
revoke all on function public.sd_legacy_text_array(jsonb, text, boolean)
  from public, anon, authenticated;
revoke all on function public.sd_legacy_actor(jsonb, text, uuid)
  from public, anon, authenticated;
revoke all on function public.sd_legacy_date(text, boolean)
  from public, anon, authenticated;
revoke all on function public.sd_legacy_timestamp(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.import_ship_dynamics_legacy(
  uuid, text, text, bigint, jsonb, jsonb, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.import_ship_dynamics_legacy(
  uuid, text, text, bigint, jsonb, jsonb, jsonb, integer
) to service_role;

commit;

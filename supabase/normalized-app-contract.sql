begin;

-- Final server contract for the normalized application. Apply this migration
-- after normalized-auth-orchestration.sql. It deliberately leaves the legacy
-- shared payload and browser configuration untouched.

create table public.sd_operation_reservations (
  workspace_id uuid not null
    references public.sd_workspaces(id) on delete cascade,
  operation_id uuid not null,
  actor_id uuid not null references auth.users(id),
  command text not null,
  target_key text not null,
  request_payload jsonb not null,
  request_hash text not null,
  status text not null check (status in ('prepared', 'committed', 'rejected')),
  rejection_code text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (workspace_id, operation_id),
  constraint sd_operation_reservations_identity_not_blank check (
    btrim(command) <> '' and btrim(target_key) <> ''
  ),
  constraint sd_operation_reservations_outcome_consistent check (
    (status = 'prepared' and rejection_code is null and completed_at is null)
    or (status = 'committed' and rejection_code is null and completed_at is not null)
    or (status = 'rejected' and rejection_code is not null and completed_at is not null)
  )
);

alter table public.sd_operation_reservations enable row level security;
revoke all on table public.sd_operation_reservations
  from public, anon, authenticated;

create function public.reserve_ship_dynamics_operation(
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
  v_actor uuid := auth.uid();
  v_reservation public.sd_operation_reservations%rowtype;
  v_operation public.sd_operations%rowtype;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) is null
     or p_operation_id is null
     or btrim(coalesce(p_command, '')) = ''
     or btrim(coalesce(p_target_key, '')) = ''
     or p_request is null
     or jsonb_typeof(p_request) <> 'object' then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0)
  );

  -- A terminal command row is authoritative. This also makes adoption safe
  -- when the reservation migration is applied over existing operations.
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
  for update;
  if found then
    if v_operation.actor_id is distinct from v_actor
       or v_operation.command is distinct from p_command
       or v_operation.target_key is distinct from p_target_key
       or (
         case
           when p_command = 'update_site_gate'
             then v_operation.request_payload - 'credentialHash'
           when p_command like 'manage_user:%'
             then v_operation.request_payload - 'credentialFingerprint'
           else v_operation.request_payload
         end
       ) is distinct from p_request then
      raise exception using errcode = 'P0001', message = 'operation-mismatch';
    end if;
    return jsonb_build_object(
      'status', v_operation.status,
      'replayed', true,
      'result', v_operation.result,
      'errorCode', v_operation.error_code
    );
  end if;

  select * into v_reservation
  from public.sd_operation_reservations r
  where r.workspace_id = p_workspace_id
    and r.operation_id = p_operation_id
  for update;
  if found then
    if v_reservation.actor_id is distinct from v_actor
       or v_reservation.command is distinct from p_command
       or v_reservation.target_key is distinct from p_target_key
       or v_reservation.request_payload is distinct from p_request then
      raise exception using errcode = 'P0001', message = 'operation-mismatch';
    end if;
    return jsonb_build_object(
      'status', v_reservation.status,
      'replayed', true,
      'errorCode', v_reservation.rejection_code
    );
  end if;

  insert into public.sd_operation_reservations(
    workspace_id, operation_id, actor_id, command, target_key,
    request_payload, request_hash, status
  ) values (
    p_workspace_id, p_operation_id, v_actor, btrim(p_command),
    btrim(p_target_key), p_request, md5(p_request::text), 'prepared'
  );

  return jsonb_build_object('status', 'prepared', 'replayed', false);
end;
$$;

create function public.reject_ship_dynamics_operation_reservation(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_error_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_reservation public.sd_operation_reservations%rowtype;
begin
  if v_actor is null or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0)
  );
  select * into v_reservation
  from public.sd_operation_reservations r
  where r.workspace_id = p_workspace_id
    and r.operation_id = p_operation_id
    and r.actor_id = v_actor
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'operation-not-prepared';
  end if;
  if v_reservation.status = 'rejected' then
    return jsonb_build_object(
      'status', 'rejected',
      'replayed', true,
      'errorCode', v_reservation.rejection_code
    );
  end if;
  if v_reservation.status <> 'prepared'
     or exists (
       select 1 from public.sd_operations o
       where o.workspace_id = p_workspace_id
         and o.operation_id = p_operation_id
     ) then
    raise exception using errcode = 'P0001', message = 'operation-not-prepared';
  end if;

  update public.sd_operation_reservations r
  set status = 'rejected',
      rejection_code = coalesce(
        nullif(btrim(p_error_code), ''),
        'definitive-rpc-error'
      ),
      completed_at = clock_timestamp()
  where r.workspace_id = p_workspace_id
    and r.operation_id = p_operation_id;
  return jsonb_build_object(
    'status', 'rejected',
    'replayed', false,
    'errorCode', coalesce(
      nullif(btrim(p_error_code), ''),
      'definitive-rpc-error'
    )
  );
end;
$$;

create function public.get_ship_dynamics_operation_status(
  p_workspace_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_operation public.sd_operations%rowtype;
  v_reservation public.sd_operation_reservations%rowtype;
begin
  if v_actor is null or p_operation_id is null then return null; end if;

  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
    and o.actor_id = v_actor
    and o.status in ('committed', 'rejected');
  if found then
    return jsonb_build_object(
      'status', v_operation.status,
      'command', v_operation.command,
      'target', v_operation.target_key,
      'result', v_operation.result,
      'errorCode', v_operation.error_code,
      'completedAt', v_operation.completed_at
    );
  end if;

  select * into v_reservation
  from public.sd_operation_reservations r
  where r.workspace_id = p_workspace_id
    and r.operation_id = p_operation_id
    and r.actor_id = v_actor;
  if not found then return null; end if;
  return jsonb_build_object(
    'status', v_reservation.status,
    'command', v_reservation.command,
    'target', v_reservation.target_key,
    'errorCode', v_reservation.rejection_code,
    'completedAt', v_reservation.completed_at
  );
end;
$$;

create function public.sd_app_validate_operation_reservation()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reservation public.sd_operation_reservations%rowtype;
begin
  -- Auth Admin orchestration owns a separate prepared/external-effect state
  -- machine. Core, meeting, internal, and app commands must be reserved.
  if new.command = 'legacy_import'
     and auth.uid() is null
     and current_setting('ship_dynamics.legacy_import_authorized', true) = '1' then
    return new;
  end if;
  if new.status in ('prepared', 'recovery_required')
     or new.command like 'manage_user:%'
     or new.command = 'update_site_gate' then
    return new;
  end if;

  if auth.uid() is null or new.actor_id is distinct from auth.uid() then
    raise exception using errcode = 'P0001', message = 'operation-reservation-required';
  end if;
  select * into v_reservation
  from public.sd_operation_reservations r
  where r.workspace_id = new.workspace_id
    and r.operation_id = new.operation_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'operation-reservation-required';
  end if;
  if v_reservation.actor_id is distinct from new.actor_id
     or v_reservation.command is distinct from new.command
     or v_reservation.target_key is distinct from new.target_key
     or v_reservation.request_payload is distinct from new.request_payload then
    raise exception using errcode = 'P0001', message = 'operation-mismatch';
  end if;
  if v_reservation.status = 'rejected' then
    raise exception using
      errcode = 'P0001',
      message = 'operation-reservation-rejected';
  end if;
  if v_reservation.status <> 'prepared' then
    raise exception using errcode = 'P0001', message = 'operation-reservation-not-prepared';
  end if;

  update public.sd_operation_reservations r
  set status = new.status,
      rejection_code = case when new.status = 'rejected'
        then coalesce(new.error_code, 'operation-rejected')
        else null
      end,
      completed_at = clock_timestamp()
  where r.workspace_id = new.workspace_id
    and r.operation_id = new.operation_id;
  return new;
end;
$$;

create trigger sd_operations_validate_reservation
  before insert on public.sd_operations
  for each row execute function public.sd_app_validate_operation_reservation();

create function public.command_ship_dynamics_update_vessel_manual_attention(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_vessel_id text,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_manual_attention_level text
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
  v_level text;
  v_version bigint;
begin
  if v_actor is null
     or not public.sd_can_edit_vessel(p_workspace_id, p_vessel_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_lease_key is distinct from 'vessel:' || p_vessel_id then
    raise exception using errcode = 'P0001', message = 'lease-key-mismatch';
  end if;
  v_level := nullif(btrim(coalesce(p_manual_attention_level, '')), '');
  if v_level is not null
     and v_level not in ('急', '高', '中', '低', '特別關注') then
    raise exception using errcode = 'P0001', message = 'invalid-manual-attention';
  end if;
  v_request := jsonb_build_object(
    'vesselId', p_vessel_id,
    'baseVersion', p_base_version,
    'leaseKey', p_lease_key,
    'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'manualAttentionLevel', p_manual_attention_level
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'update_vessel_manual_attention', 'vessel:' || p_vessel_id, v_request
  );
  if v_replay is not null then return v_replay; end if;

  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );
  update public.sd_vessels v
  set manual_attention_level = v_level,
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

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'vessel', 'entityId', p_vessel_id,
    'version', v_version,
    'manualAttentionLevel', v_level
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'update_vessel_manual_attention', 'vessel:' || p_vessel_id, v_request,
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
    v_actor, 'update_vessel_manual_attention', 'vessel', p_vessel_id,
    jsonb_build_object('version', v_version, 'manualAttentionLevel', v_level)
  );
  return v_result;
end;
$$;

create function public.sd_app_can_manage_non_owner_user(
  p_workspace_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    auth.uid() is not null
    and public.sd_membership_role(p_workspace_id) in ('owner', 'admin')
    and exists (
      select 1
      from public.sd_memberships m
      where m.workspace_id = p_workspace_id
        and m.user_id = p_user_id
        and m.role <> 'owner'
    )
$$;

create function public.command_ship_dynamics_update_user(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_user_id uuid,
  p_base_membership_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_user jsonb
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
  v_display_name text;
  v_username_label text;
  v_department text;
  v_is_active boolean;
  v_assignments jsonb;
  v_assignment jsonb;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_version bigint;
begin
  if v_actor is null
     or not public.sd_app_can_manage_non_owner_user(p_workspace_id, p_user_id)
     or p_lease_key is distinct from 'user:' || p_user_id::text then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_core_assert_json_keys(
    p_user,
    array[
      'displayName', 'usernameLabel', 'department', 'role',
      'isActive', 'vesselAssignments'
    ],
    'invalid-user'
  );
  if not (
    p_user ? 'displayName'
    and p_user ? 'usernameLabel'
    and p_user ? 'department'
    and p_user ? 'role'
    and p_user ? 'isActive'
    and p_user ? 'vesselAssignments'
  ) or jsonb_typeof(p_user -> 'displayName') <> 'string'
     or jsonb_typeof(p_user -> 'usernameLabel') <> 'string'
     or jsonb_typeof(p_user -> 'department') <> 'string'
     or jsonb_typeof(p_user -> 'role') <> 'string'
     or jsonb_typeof(p_user -> 'isActive') <> 'boolean'
     or jsonb_typeof(p_user -> 'vesselAssignments') <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid-user';
  end if;
  v_display_name := btrim(p_user ->> 'displayName');
  v_username_label := btrim(p_user ->> 'usernameLabel');
  v_department := btrim(p_user ->> 'department');
  v_role := p_user ->> 'role';
  v_is_active := (p_user ->> 'isActive')::boolean;
  v_assignments := p_user -> 'vesselAssignments';
  if v_role = 'owner' then
    raise exception using errcode = 'P0001', message = 'invalid-user-role';
  end if;
  if v_role not in ('admin', 'operator', 'vessel')
     or v_display_name = ''
     or v_username_label = ''
     or v_department = '' then
    raise exception using errcode = 'P0001', message = 'invalid-user';
  end if;
  if v_role = 'vessel' and jsonb_array_length(v_assignments) <> 0 then
    raise exception using errcode = 'P0001', message = 'invalid-user-assignments';
  end if;
  for v_assignment in
    select value from jsonb_array_elements(v_assignments)
  loop
    perform public.sd_core_assert_json_keys(
      v_assignment,
      array['vesselId', 'assignmentKind'],
      'invalid-user-assignments'
    );
    if not (v_assignment ? 'vesselId' and v_assignment ? 'assignmentKind')
       or jsonb_typeof(v_assignment -> 'vesselId') <> 'string'
       or jsonb_typeof(v_assignment -> 'assignmentKind') <> 'string'
       or btrim(v_assignment ->> 'vesselId') = ''
       or v_assignment ->> 'assignmentKind' not in ('manager', 'delegate')
       or not exists (
         select 1 from public.sd_vessels v
         where v.workspace_id = p_workspace_id
           and v.id = btrim(v_assignment ->> 'vesselId')
           and v.is_active
       ) then
      raise exception using errcode = 'P0001', message = 'invalid-user-assignments';
    end if;
  end loop;
  if (
    select count(*) from jsonb_array_elements(v_assignments)
  ) <> (
    select count(distinct (
      btrim(value ->> 'vesselId'),
      value ->> 'assignmentKind'
    ))
    from jsonb_array_elements(v_assignments)
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-user-assignments';
  end if;

  v_request := jsonb_build_object(
    'userId', p_user_id,
    'baseMembershipVersion', p_base_membership_version,
    'leaseKey', p_lease_key,
    'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'user', p_user
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'update_user', 'user:' || p_user_id::text, v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );

  perform 1
  from public.sd_memberships m
  where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  for update;
  if not found
     or not public.sd_app_can_manage_non_owner_user(p_workspace_id, p_user_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  update public.sd_memberships m
  set department = v_department,
      role = v_role,
      is_active = v_is_active,
      version = m.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where m.workspace_id = p_workspace_id
    and m.user_id = p_user_id
    and m.role <> 'owner'
    and m.version = p_base_membership_version
  returning m.version into v_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  update public.sd_profiles p
  set display_name = v_display_name,
      username_label = v_username_label,
      updated_at = clock_timestamp()
  where p.id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  update public.sd_login_options l
  set department = v_department,
      username_label = v_username_label,
      display_name = v_display_name,
      is_active = v_is_active,
      updated_at = clock_timestamp()
  where l.workspace_id = p_workspace_id and l.user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  update public.sd_vessel_assignments a
  set is_active = false,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where a.workspace_id = p_workspace_id
    and a.user_id = p_user_id
    and a.assignment_kind in ('manager', 'delegate')
    and a.is_active;
  insert into public.sd_vessel_assignments(
    workspace_id, vessel_id, user_id, assignment_kind,
    is_active, updated_at, updated_by
  )
  select
    p_workspace_id,
    btrim(item ->> 'vesselId'),
    p_user_id,
    item ->> 'assignmentKind',
    true,
    clock_timestamp(),
    v_actor
  from jsonb_array_elements(v_assignments) item
  on conflict (workspace_id, vessel_id, user_id, assignment_kind) do update
    set is_active = true,
        updated_at = clock_timestamp(),
        updated_by = v_actor;

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'user', 'entityId', p_user_id,
    'membershipVersion', v_version
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'update_user', 'user:' || p_user_id::text, v_request,
    jsonb_build_object('membership', p_base_membership_version),
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
    v_actor, 'update_user', 'user', p_user_id::text,
    jsonb_build_object(
      'membershipVersion', v_version,
      'role', v_role,
      'isActive', v_is_active,
      'assignmentCount', jsonb_array_length(v_assignments)
    )
  );
  return v_result;
end;
$$;

create function public.command_ship_dynamics_create_internal_case_from_task(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_case_id text,
  p_task_id text,
  p_base_task_version bigint,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_task_lease_key text,
  p_task_owner_session uuid,
  p_task_fencing_token bigint,
  p_case jsonb
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
  v_task public.sd_tasks%rowtype;
  v_vessel_id text;
  v_departments text[];
  v_scope_count integer;
  v_task_version bigint;
begin
  perform public.sd_internal_assert_actor(p_workspace_id, 'createTasks');
  perform public.sd_internal_assert_actor(p_workspace_id, 'editBusinessContent');
  if btrim(coalesce(p_case_id, '')) = ''
     or btrim(coalesce(p_task_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-command-identity';
  end if;
  perform public.sd_internal_validate_case_payload(p_case);
  if p_case ->> 'origin' <> 'task'
     or (p_case ->> 'isClosed')::boolean then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;
  v_vessel_id := p_case ->> 'vesselId';
  v_departments := public.sd_internal_json_text_array(
    p_case, 'departments', true
  );
  if not public.sd_can_mutate_internal_vessel(
    p_workspace_id, v_vessel_id, 'editBusinessContent'
  ) or not public.sd_can_edit_task(p_workspace_id, p_task_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  v_request := jsonb_build_object(
    'caseId', p_case_id,
    'taskId', p_task_id,
    'baseTaskVersion', p_base_task_version,
    'caseLeaseKey', p_case_lease_key,
    'caseOwnerSession', p_case_owner_session,
    'caseFencingToken', p_case_fencing_token,
    'taskLeaseKey', p_task_lease_key,
    'taskOwnerSession', p_task_owner_session,
    'taskFencingToken', p_task_fencing_token,
    'case', p_case
  );
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id, p_operation_id,
    'create_internal_case_from_task',
    'internal-case:' || p_case_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;

  perform public.sd_internal_assert_ordered_create_leases(
    p_workspace_id,
    v_vessel_id, p_case_lease_key, p_case_owner_session, p_case_fencing_token,
    p_task_id, p_task_lease_key, p_task_owner_session, p_task_fencing_token
  );
  if exists (
    select 1 from public.sd_internal_cases c
    where c.workspace_id = p_workspace_id and c.id = p_case_id
  ) then
    raise exception using errcode = '23505', message = 'entity-exists';
  end if;
  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id
  for update;
  if not found
     or v_task.version <> p_base_task_version
     or v_task.source_kind <> 'ordinary'
     or v_task.is_deleted
     or v_task.is_closed then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if v_task.is_internal_control
     or exists (
       select 1 from public.sd_internal_case_task_links l
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
       select 1 from public.sd_task_vessels tv
       where tv.workspace_id = p_workspace_id
         and tv.task_id = p_task_id
         and tv.vessel_id = v_vessel_id
         and tv.is_active_scope
     ) then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;

  insert into public.sd_internal_cases(
    workspace_id, id, vessel_id, report_date, report_source,
    description, priority, category, equipment_subcategory,
    is_aware, status, origin, is_closed, version, created_by, updated_by
  ) values (
    p_workspace_id, p_case_id, v_vessel_id,
    public.sd_internal_iso_date(p_case ->> 'reportDate', true),
    p_case ->> 'reportSource', btrim(p_case ->> 'description'),
    p_case ->> 'priority', btrim(p_case ->> 'category'),
    case when p_case ->> 'category' = '設備故障'
      then btrim(p_case ->> 'equipmentSubcategory') else null end,
    (p_case ->> 'isAware')::boolean, btrim(p_case ->> 'status'),
    'task', false, 1, v_actor, v_actor
  );
  perform public.sd_internal_replace_case_departments(
    p_workspace_id, p_case_id, v_departments
  );
  insert into public.sd_internal_case_task_links(
    workspace_id, case_id, task_id, version, created_by
  ) values (p_workspace_id, p_case_id, p_task_id, 1, v_actor);
  insert into public.sd_internal_case_status_events(
    workspace_id, id, case_id, event_kind, status, actor_id
  ) values (
    p_workspace_id,
    public.sd_core_event_id(p_operation_id, 'case-created'),
    p_case_id, 'created', btrim(p_case ->> 'status'), v_actor
  ), (
    p_workspace_id,
    public.sd_core_event_id(p_operation_id, 'case-linked'),
    p_case_id, 'linked', btrim(p_case ->> 'status'), v_actor
  );

  update public.sd_tasks t
  set description = btrim(p_case ->> 'description'),
      status = btrim(p_case ->> 'status'),
      priority = p_case ->> 'priority',
      category = btrim(p_case ->> 'category'),
      equipment_subcategory = case
        when p_case ->> 'category' = '設備故障'
        then btrim(p_case ->> 'equipmentSubcategory')
        else null
      end,
      is_internal_control = true,
      is_abnormal = true,
      is_aware = (p_case ->> 'isAware')::boolean,
      report_date = public.sd_internal_iso_date(
        p_case ->> 'reportDate', true
      ),
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
  set status = btrim(p_case ->> 'status'),
      is_closed = false,
      closed_date = null,
      closed_by = null,
      version = tv.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where tv.workspace_id = p_workspace_id
    and tv.task_id = p_task_id
    and tv.vessel_id = v_vessel_id
    and tv.is_active_scope;
  perform public.sd_internal_replace_task_categories(
    p_workspace_id, p_task_id, array[btrim(p_case ->> 'category')]
  );
  perform public.sd_internal_replace_task_departments(
    p_workspace_id, p_task_id, v_departments
  );
  insert into public.sd_task_status_events(
    workspace_id, id, task_id, status, actor_id
  ) values (
    p_workspace_id,
    public.sd_core_event_id(p_operation_id, 'task-status'),
    p_task_id, btrim(p_case ->> 'status'), v_actor
  );

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'caseId', p_case_id, 'caseVersion', 1,
    'taskId', p_task_id, 'taskVersion', v_task_version
  );
  perform public.sd_internal_record_operation(
    p_workspace_id, p_operation_id,
    'create_internal_case_from_task',
    'internal-case:' || p_case_id,
    v_request,
    jsonb_build_object('task', p_base_task_version),
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
    'internal-case', p_case_id,
    jsonb_build_object(
      'caseVersion', 1,
      'taskId', p_task_id,
      'taskVersion', v_task_version
    )
  );
  return v_result;
end;
$$;

create function public.command_ship_dynamics_create_task_from_internal_case(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_case_id text,
  p_base_case_version bigint,
  p_task_id text,
  p_case_lease_key text,
  p_case_owner_session uuid,
  p_case_fencing_token bigint,
  p_task_lease_key text,
  p_task_owner_session uuid,
  p_task_fencing_token bigint,
  p_task jsonb
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
  v_departments text[];
  v_categories text[];
  v_owner_ids uuid[];
  v_expected_date date;
  v_case_version bigint;
begin
  perform public.sd_internal_assert_actor(p_workspace_id, 'createTasks');
  perform public.sd_internal_assert_actor(p_workspace_id, 'editBusinessContent');
  if btrim(coalesce(p_case_id, '')) = ''
     or btrim(coalesce(p_task_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-command-identity';
  end if;
  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and not c.is_deleted;
  if not found
     or not public.sd_can_mutate_internal_vessel(
       p_workspace_id, v_case.vessel_id, 'editBusinessContent'
     ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform public.sd_internal_validate_task_payload(
    p_workspace_id, v_case.vessel_id, p_task
  );
  if p_task ->> 'id' is distinct from p_task_id then
    raise exception using errcode = 'P0001', message = 'invalid-task-metadata';
  end if;
  v_categories := public.sd_internal_json_text_array(
    p_task, 'categories', true
  );
  v_owner_ids := public.sd_internal_json_uuid_array(p_task, 'ownerUserIds');
  v_expected_date := public.sd_internal_iso_date(
    p_task ->> 'expectedDate', false
  );

  v_request := jsonb_build_object(
    'caseId', p_case_id,
    'baseCaseVersion', p_base_case_version,
    'taskId', p_task_id,
    'caseLeaseKey', p_case_lease_key,
    'caseOwnerSession', p_case_owner_session,
    'caseFencingToken', p_case_fencing_token,
    'taskLeaseKey', p_task_lease_key,
    'taskOwnerSession', p_task_owner_session,
    'taskFencingToken', p_task_fencing_token,
    'task', p_task
  );
  v_replay := public.sd_internal_operation_replay(
    p_workspace_id, p_operation_id,
    'create_task_from_internal_case',
    'internal-case:' || p_case_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_internal_assert_ordered_leases(
    p_workspace_id,
    p_case_id, p_case_lease_key, p_case_owner_session, p_case_fencing_token,
    p_task_id, p_task_lease_key, p_task_owner_session, p_task_fencing_token
  );

  select * into v_case
  from public.sd_internal_cases c
  where c.workspace_id = p_workspace_id and c.id = p_case_id
  for update;
  if not found
     or v_case.version <> p_base_case_version
     or v_case.is_deleted
     or v_case.is_closed then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if exists (
    select 1 from public.sd_internal_case_task_links l
    where l.workspace_id = p_workspace_id
      and (l.case_id = p_case_id or l.task_id = p_task_id)
  ) then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;
  if exists (
    select 1 from public.sd_tasks t
    where t.workspace_id = p_workspace_id and t.id = p_task_id
  ) then
    raise exception using errcode = '23505', message = 'entity-exists';
  end if;
  select coalesce(
    array_agg(d.department order by d.ordinal),
    '{}'::text[]
  ) into v_departments
  from public.sd_internal_case_departments d
  where d.workspace_id = p_workspace_id and d.case_id = p_case_id;
  if cardinality(v_departments) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid-case';
  end if;

  insert into public.sd_tasks(
    workspace_id, id, description, status, priority,
    source_kind, attention_dimension, is_internal_control,
    is_abnormal, is_aware, is_closed,
    expected_date, report_date, category, equipment_subcategory,
    version, created_by, updated_by
  ) values (
    p_workspace_id, p_task_id, v_case.description, v_case.status,
    v_case.priority, 'ordinary', 'task', true, true, v_case.is_aware,
    false, v_expected_date, v_case.report_date, v_categories[1],
    case when '設備故障' = any(v_categories)
      then v_case.equipment_subcategory else null end,
    1, v_actor, v_actor
  );
  insert into public.sd_task_vessels(
    workspace_id, task_id, vessel_id, is_active_scope,
    status, is_closed, version, updated_by
  ) values (
    p_workspace_id, p_task_id, v_case.vessel_id, true,
    v_case.status, false, 1, v_actor
  );
  perform public.sd_internal_replace_task_categories(
    p_workspace_id, p_task_id, v_categories
  );
  perform public.sd_internal_replace_task_departments(
    p_workspace_id, p_task_id, v_departments
  );
  perform public.sd_internal_replace_task_owners(
    p_workspace_id, p_task_id, v_owner_ids
  );
  insert into public.sd_internal_case_task_links(
    workspace_id, case_id, task_id, version, created_by
  ) values (p_workspace_id, p_case_id, p_task_id, 1, v_actor);
  insert into public.sd_task_status_events(
    workspace_id, id, task_id, status, actor_id
  ) values (
    p_workspace_id,
    public.sd_core_event_id(p_operation_id, 'task-created'),
    p_task_id, v_case.status, v_actor
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
    p_workspace_id,
    public.sd_core_event_id(p_operation_id, 'case-linked'),
    p_case_id, 'linked', v_case.status, v_actor
  );

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'caseId', p_case_id, 'caseVersion', v_case_version,
    'taskId', p_task_id, 'taskVersion', 1
  );
  perform public.sd_internal_record_operation(
    p_workspace_id, p_operation_id,
    'create_task_from_internal_case',
    'internal-case:' || p_case_id,
    v_request,
    jsonb_build_object('case', p_base_case_version),
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
    'internal-case', p_case_id,
    jsonb_build_object(
      'caseVersion', v_case_version,
      'taskId', p_task_id,
      'taskVersion', 1
    )
  );
  return v_result;
end;
$$;

create table public.sd_meeting_status_event_corrections (
  workspace_id uuid not null
    references public.sd_workspaces(id) on delete restrict,
  id uuid not null,
  meeting_id text not null,
  original_event_id uuid not null,
  correction_kind text not null check (
    correction_kind in ('void', 'correct')
  ),
  corrected_status text check (
    corrected_status in ('待召開', '追蹤中', '已完成')
  ),
  reason text not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, id),
  unique (workspace_id, original_event_id),
  foreign key (workspace_id, meeting_id)
    references public.sd_meetings(workspace_id, id) on delete restrict,
  foreign key (workspace_id, original_event_id)
    references public.sd_meeting_status_events(workspace_id, id)
    on delete restrict,
  constraint sd_meeting_status_correction_reason_not_blank check (
    btrim(reason) <> ''
  ),
  constraint sd_meeting_status_correction_value_consistent check (
    (correction_kind = 'void' and corrected_status is null)
    or (correction_kind = 'correct' and corrected_status is not null)
  )
);

alter table public.sd_meeting_status_event_corrections
  enable row level security;
revoke all on table public.sd_meeting_status_event_corrections
  from public, anon, authenticated;
grant select on table public.sd_meeting_status_event_corrections
  to authenticated;
create policy sd_meeting_status_event_corrections_read
  on public.sd_meeting_status_event_corrections
  for select to authenticated
  using (public.sd_membership_role(workspace_id) in ('owner', 'admin'));

create function public.sd_app_reject_append_only_change()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = 'P0001', message = 'append-only-relation';
end;
$$;

create trigger sd_meeting_status_event_corrections_append_only
  before update or delete on public.sd_meeting_status_event_corrections
  for each row execute function public.sd_app_reject_append_only_change();

create function public.command_ship_dynamics_correct_meeting_status_event(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_meeting_id text,
  p_event_id uuid,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_correction_kind text,
  p_corrected_status text,
  p_reason text
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
     or not public.sd_can_manage_meetings(p_workspace_id)
     or p_lease_key is distinct from 'meeting:' || p_meeting_id then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_correction_kind not in ('void', 'correct')
     or btrim(coalesce(p_reason, '')) = ''
     or (
       p_correction_kind = 'void'
       and nullif(btrim(coalesce(p_corrected_status, '')), '') is not null
     )
     or (
       p_correction_kind = 'correct'
       and p_corrected_status not in ('待召開', '追蹤中', '已完成')
     ) then
    raise exception using errcode = 'P0001', message = 'invalid-correction';
  end if;
  v_request := jsonb_build_object(
    'meetingId', p_meeting_id,
    'eventId', p_event_id,
    'baseVersion', p_base_version,
    'leaseKey', p_lease_key,
    'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'correctionKind', p_correction_kind,
    'correctedStatus', p_corrected_status,
    'reason', p_reason
  );
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'correct_meeting_status_event',
    'meeting:' || p_meeting_id,
    v_request
  );
  if v_replay is not null then return v_replay; end if;
  perform public.sd_assert_live_lease(
    p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
  );

  perform 1
  from public.sd_meetings m
  where m.workspace_id = p_workspace_id
    and m.id = p_meeting_id
    and m.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if not exists (
    select 1 from public.sd_meetings m
    where m.workspace_id = p_workspace_id
      and m.id = p_meeting_id
      and m.version = p_base_version
  ) then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if not exists (
    select 1 from public.sd_meeting_status_events e
    where e.workspace_id = p_workspace_id
      and e.id = p_event_id
      and e.meeting_id = p_meeting_id
  ) then
    raise exception using errcode = 'P0001', message = 'event-not-found';
  end if;
  if exists (
    select 1 from public.sd_meeting_status_event_corrections c
    where c.workspace_id = p_workspace_id
      and c.original_event_id = p_event_id
  ) then
    raise exception using errcode = 'P0001', message = 'event-already-corrected';
  end if;

  insert into public.sd_meeting_status_event_corrections(
    workspace_id, id, meeting_id, original_event_id,
    correction_kind, corrected_status, reason, actor_id
  ) values (
    p_workspace_id, p_operation_id, p_meeting_id, p_event_id,
    p_correction_kind,
    case when p_correction_kind = 'correct'
      then p_corrected_status else null end,
    btrim(p_reason), v_actor
  );
  update public.sd_meetings m
  set version = m.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where m.workspace_id = p_workspace_id
    and m.id = p_meeting_id
    and m.version = p_base_version
  returning m.version into v_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  v_result := jsonb_build_object(
    'status', 'committed', 'replayed', false,
    'entityType', 'meeting-status-correction',
    'entityId', p_operation_id,
    'meetingId', p_meeting_id,
    'eventId', p_event_id,
    'correctionKind', p_correction_kind,
    'correctedStatus', case when p_correction_kind = 'correct'
      then p_corrected_status else null end,
    'version', v_version
  );
  perform public.sd_core_commit_operation(
    p_operation_id, p_workspace_id, v_actor,
    'correct_meeting_status_event',
    'meeting:' || p_meeting_id,
    v_request,
    jsonb_build_object('meeting', p_base_version),
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
    v_actor, 'correct_meeting_status_event',
    'meeting-status-event', p_event_id::text,
    jsonb_build_object(
      'meetingId', p_meeting_id,
      'correctionId', p_operation_id,
      'correctionKind', p_correction_kind,
      'version', v_version
    )
  );
  return v_result;
end;
$$;

create function public.sd_app_emit_meeting_task_notifications(
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
begin
  select t.description into v_description
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id;
  if not found or p_kind not in (
    'task_created', 'task_updated', 'task_archived'
  ) then
    return;
  end if;

  insert into public.sd_notifications(
    workspace_id, id, recipient_id, vessel_id, task_id,
    kind, title, message, actor_id
  )
  select distinct
    p_workspace_id,
    'notice-' || md5(
      p_operation_id::text || ':' || p_task_id || ':' || p_kind || ':' ||
      recipients.user_id::text || ':' || coalesce(recipients.vessel_id, '')
    ),
    recipients.user_id,
    recipients.vessel_id,
    p_task_id,
    p_kind,
    case p_kind
      when 'task_created' then '新增待辦｜'
      when 'task_archived' then '封存待辦｜'
      else '更新待辦｜'
    end || v_description,
    v_description,
    p_actor_id
  from (
    select candidates.user_id, min(candidates.vessel_id) as vessel_id
    from (
      select a.user_id, tv.vessel_id
      from public.sd_tasks t
      join public.sd_meeting_items mi
        on mi.workspace_id = t.workspace_id
       and mi.id = t.source_meeting_item_id
      join public.sd_meetings m
        on m.workspace_id = mi.workspace_id
       and m.id = mi.meeting_id
      join public.sd_task_vessels tv
        on tv.workspace_id = t.workspace_id and tv.task_id = t.id
      join public.sd_vessel_assignments a
        on a.workspace_id = tv.workspace_id
       and a.vessel_id = tv.vessel_id
       and a.is_active
       and (
         a.assignment_kind in ('manager', 'delegate')
         or (
           a.assignment_kind = 'vessel_account'
           and mi.distribute_to_vessels
           and not m.is_internal_control
           and not t.is_internal_control
         )
       )
      join public.sd_memberships member_row
        on member_row.workspace_id = a.workspace_id
       and member_row.user_id = a.user_id
       and member_row.is_active
      where t.workspace_id = p_workspace_id and t.id = p_task_id
      union
      select owner_row.owner_id, null::text
      from public.sd_task_owners owner_row
      join public.sd_memberships member_row
        on member_row.workspace_id = owner_row.workspace_id
       and member_row.user_id = owner_row.owner_id
       and member_row.is_active
      where owner_row.workspace_id = p_workspace_id
        and owner_row.task_id = p_task_id
    ) candidates
    group by candidates.user_id
  ) recipients
  where recipients.user_id <> p_actor_id
  on conflict (workspace_id, id) do nothing;
end;
$$;

create function public.sd_app_emit_meeting_operation_notifications()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task record;
  v_guard jsonb;
  v_base_version bigint;
  v_kind text;
begin
  if new.status <> 'committed'
     or new.command not in ('create_meeting', 'update_meeting') then
    return new;
  end if;

  for v_task in
    select key as task_id, value
    from jsonb_each(coalesce(new.result -> 'taskVersions', '{}'::jsonb))
    order by key
  loop
    if new.command = 'create_meeting' then
      v_kind := 'task_created';
    else
      select guard into v_guard
      from jsonb_array_elements(
        coalesce(new.request_payload -> 'taskGuards', '[]'::jsonb)
      ) guard
      where guard ->> 'taskId' = v_task.task_id;
      if v_guard is null then
        v_kind := 'task_created';
      else
        v_base_version := (v_guard ->> 'baseVersion')::bigint;
        if (v_task.value #>> '{}')::bigint <= v_base_version then
          continue;
        end if;
        if exists (
          select 1 from public.sd_tasks t
          where t.workspace_id = new.workspace_id
            and t.id = v_task.task_id
            and t.is_closed
            and not exists (
              select 1 from public.sd_task_vessels tv
              where tv.workspace_id = t.workspace_id
                and tv.task_id = t.id
                and tv.is_active_scope
            )
        ) then
          v_kind := 'task_archived';
        else
          v_kind := 'task_updated';
        end if;
      end if;
    end if;
    perform public.sd_app_emit_meeting_task_notifications(
      new.workspace_id, v_task.task_id, new.actor_id,
      new.operation_id, v_kind
    );
  end loop;
  return new;
end;
$$;

create trigger sd_operations_emit_meeting_task_notifications
  after insert on public.sd_operations
  for each row execute function
    public.sd_app_emit_meeting_operation_notifications();

create or replace function public.begin_ship_dynamics_user_operation(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_action text,
  p_target_user_id uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_operation public.sd_operations%rowtype;
  v_command text := 'manage_user:' || coalesce(p_action, '');
  v_target text := 'user:' || coalesce(p_target_user_id::text, 'new');
  v_requested_role text;
begin
  v_actor_role := public.sd_membership_role(p_workspace_id);
  if v_actor is null
     or v_actor_role not in ('owner', 'admin')
     or p_action not in (
       'create', 'disable', 'reset-password', 'change-role', 'transfer-owner'
     )
     or p_request is null
     or jsonb_typeof(p_request) <> 'object'
     or (p_action = 'create' and p_target_user_id is not null)
     or (p_action <> 'create' and p_target_user_id is null) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  if p_action in ('create', 'change-role') then
    v_requested_role := p_request ->> 'role';
    if v_requested_role = 'owner' then
      raise exception using errcode = 'P0001', message = 'invalid-user-role';
    end if;
    if v_requested_role not in ('admin', 'operator', 'vessel') then
      raise exception using errcode = 'P0001', message = 'invalid-user-role';
    end if;
  end if;
  if p_action = 'transfer-owner' then
    if v_actor_role = 'owner' then
      if not exists (
        select 1 from public.sd_memberships m
        where m.workspace_id = p_workspace_id
          and m.user_id = p_target_user_id
          and m.role <> 'owner'
          and m.is_active
      ) then
        raise exception using errcode = 'P0001', message = 'not-authorized';
      end if;
    elsif v_actor_role = 'admin' then
      if not exists (
        select 1
        from public.sd_operations o
        join public.sd_memberships m
          on m.workspace_id = o.workspace_id
         and m.user_id = p_target_user_id
         and m.role = 'owner'
         and m.is_active
        where o.workspace_id = p_workspace_id
          and o.operation_id = p_operation_id
          and o.actor_id = v_actor
          and o.command = v_command
          and o.target_key = v_target
          and o.request_payload = p_request
          and o.status in ('prepared', 'recovery_required', 'committed')
      ) then
        raise exception using errcode = 'P0001', message = 'not-authorized';
      end if;
    else
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_action <> 'create'
        and not public.sd_app_can_manage_non_owner_user(
          p_workspace_id, p_target_user_id
        ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0)
  );
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
  for update;
  if found then
    if v_operation.actor_id <> v_actor
       or v_operation.command <> v_command
       or v_operation.target_key <> v_target
       or v_operation.request_payload <> p_request then
      raise exception using errcode = 'P0001', message = 'operation-mismatch';
    end if;
    return jsonb_build_object(
      'status', v_operation.status,
      'result', v_operation.result,
      'authUserId', nullif(
        v_operation.external_effect ->> 'authUserId', ''
      )
    );
  end if;

  insert into public.sd_operations(
    workspace_id, operation_id, actor_id, command, target_key,
    request_payload, request_hash, status, result, error_code, completed_at
  ) values (
    p_workspace_id, p_operation_id, v_actor, v_command, v_target,
    p_request, md5(p_request::text), 'prepared', null, null, null
  );
  return jsonb_build_object(
    'status', 'prepared', 'result', null, 'authUserId', null
  );
end;
$$;

create or replace function public.disable_ship_dynamics_user(
  p_workspace_id uuid,
  p_user_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.sd_app_can_manage_non_owner_user(p_workspace_id, p_user_id)
     or not exists (
       select 1 from public.sd_operations o
       where o.workspace_id = p_workspace_id
         and o.operation_id = p_operation_id
         and o.actor_id = auth.uid()
         and o.command = 'manage_user:disable'
         and o.target_key = 'user:' || p_user_id::text
         and o.status in ('prepared', 'recovery_required')
     ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  update public.sd_memberships m
  set is_active = false,
      version = m.version + 1,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  where m.workspace_id = p_workspace_id
    and m.user_id = p_user_id
    and m.role <> 'owner'
    and m.is_active;
  update public.sd_login_options l
  set is_active = false,
      updated_at = clock_timestamp()
  where l.workspace_id = p_workspace_id
    and l.user_id = p_user_id
    and l.is_active;
  return true;
end;
$$;

create or replace function public.change_ship_dynamics_user_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text,
  p_operation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_role = 'owner' then
    raise exception using errcode = 'P0001', message = 'invalid-user-role';
  end if;
  if p_role not in ('admin', 'operator', 'vessel')
     or not public.sd_app_can_manage_non_owner_user(p_workspace_id, p_user_id)
     or not exists (
       select 1 from public.sd_operations o
       where o.workspace_id = p_workspace_id
         and o.operation_id = p_operation_id
         and o.actor_id = auth.uid()
         and o.command = 'manage_user:change-role'
         and o.target_key = 'user:' || p_user_id::text
         and o.status in ('prepared', 'recovery_required')
     ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  update public.sd_memberships m
  set role = p_role,
      version = m.version + 1,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  where m.workspace_id = p_workspace_id
    and m.user_id = p_user_id
    and m.role <> 'owner'
    and m.is_active;
  if not found then
    raise exception using errcode = 'P0001', message = 'target-inactive';
  end if;
  return true;
end;
$$;

alter function public.claim_ship_dynamics_entity_lease(
  uuid, text, text, text, uuid, integer
) rename to sd_app_claim_ship_dynamics_entity_lease_base;

create function public.claim_ship_dynamics_entity_lease(
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
  v_user_id uuid;
  v_now timestamptz := clock_timestamp();
  v_lease public.sd_edit_leases%rowtype;
begin
  if p_entity_type <> 'user' then
    return public.sd_app_claim_ship_dynamics_entity_lease_base(
      p_workspace_id, p_lease_key, p_entity_type, p_entity_id,
      p_owner_session, p_ttl_seconds
    );
  end if;
  if v_actor is null or p_owner_session is null then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  begin
    v_user_id := p_entity_id::uuid;
  exception when others then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end;
  if p_lease_key is distinct from 'user:' || p_entity_id
     or not public.sd_app_can_manage_non_owner_user(
       p_workspace_id, v_user_id
     ) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  insert into public.sd_edit_leases(
    workspace_id, lease_key, entity_type, entity_id,
    owner_id, owner_session, fencing_token, expires_at, updated_at
  ) values (
    p_workspace_id, p_lease_key, p_entity_type, p_entity_id,
    v_actor, p_owner_session, 1,
    v_now + make_interval(
      secs => least(greatest(p_ttl_seconds, 30), 300)
    ),
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

revoke all on function public.sd_app_claim_ship_dynamics_entity_lease_base(
  uuid, text, text, text, uuid, integer
) from public, anon, authenticated;

-- Remove default PUBLIC execution from every accumulated public routine. The
-- earlier migrations already grant their explicit browser/service surfaces;
-- this final pass protects functions introduced by extensions or replacements.
do $privileges$
declare
  v_signature text;
begin
  for v_signature in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute 'revoke all on function ' || v_signature || ' from public';
  end loop;
end;
$privileges$;

revoke all on function public.reserve_ship_dynamics_operation(
  uuid, uuid, text, text, jsonb
) from public, anon;
revoke all on function public.reject_ship_dynamics_operation_reservation(
  uuid, uuid, text
) from public, anon;
revoke all on function public.get_ship_dynamics_operation_status(
  uuid, uuid
) from public, anon;
revoke all on function public.command_ship_dynamics_update_vessel_manual_attention(
  uuid, uuid, text, bigint, text, uuid, bigint, text
) from public, anon;
revoke all on function public.command_ship_dynamics_update_user(
  uuid, uuid, uuid, bigint, text, uuid, bigint, jsonb
) from public, anon;
revoke all on function public.command_ship_dynamics_create_internal_case_from_task(
  uuid, uuid, text, text, bigint, text, uuid, bigint,
  text, uuid, bigint, jsonb
) from public, anon;
revoke all on function public.command_ship_dynamics_create_task_from_internal_case(
  uuid, uuid, text, bigint, text, text, uuid, bigint,
  text, uuid, bigint, jsonb
) from public, anon;
revoke all on function public.command_ship_dynamics_correct_meeting_status_event(
  uuid, uuid, text, uuid, bigint, text, uuid, bigint, text, text, text
) from public, anon;
revoke all on function public.claim_ship_dynamics_entity_lease(
  uuid, text, text, text, uuid, integer
) from public, anon;

grant execute on function public.reserve_ship_dynamics_operation(
  uuid, uuid, text, text, jsonb
) to authenticated;
grant execute on function public.reject_ship_dynamics_operation_reservation(
  uuid, uuid, text
) to authenticated;
grant execute on function public.get_ship_dynamics_operation_status(
  uuid, uuid
) to authenticated;
grant execute on function public.command_ship_dynamics_update_vessel_manual_attention(
  uuid, uuid, text, bigint, text, uuid, bigint, text
) to authenticated;
grant execute on function public.command_ship_dynamics_update_user(
  uuid, uuid, uuid, bigint, text, uuid, bigint, jsonb
) to authenticated;
grant execute on function public.command_ship_dynamics_create_internal_case_from_task(
  uuid, uuid, text, text, bigint, text, uuid, bigint,
  text, uuid, bigint, jsonb
) to authenticated;
grant execute on function public.command_ship_dynamics_create_task_from_internal_case(
  uuid, uuid, text, bigint, text, text, uuid, bigint,
  text, uuid, bigint, jsonb
) to authenticated;
grant execute on function public.command_ship_dynamics_correct_meeting_status_event(
  uuid, uuid, text, uuid, bigint, text, uuid, bigint, text, text, text
) to authenticated;
grant execute on function public.claim_ship_dynamics_entity_lease(
  uuid, text, text, text, uuid, integer
) to authenticated;

-- Operation lifecycle is exposed only through actor-scoped RPCs. Browser roles
-- do not need direct table reads or operation-row Realtime payloads.
revoke select on table public.sd_operations from authenticated;

commit;

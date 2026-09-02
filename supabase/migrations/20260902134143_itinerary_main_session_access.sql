begin;

-- Itinerary is now a permanent part of the signed-in main application.
-- The public ship-input page is permanent as well.  These flags remain only
-- for compatibility with already-deployed clients and are no longer user
-- controls.
alter table public.sd_memberships
  add column if not exists legacy_user_id text;

insert into public.sd_itinerary_rollout(
  workspace_id, main_enabled, ship_portal_enabled, version, updated_at
)
select workspace.id, true, true, 1, clock_timestamp()
from public.sd_workspaces workspace
where workspace.is_active
on conflict (workspace_id) do update
set main_enabled = true,
    ship_portal_enabled = true,
    version = public.sd_itinerary_rollout.version + 1,
    updated_at = clock_timestamp()
where public.sd_itinerary_rollout.main_enabled is distinct from true
   or public.sd_itinerary_rollout.ship_portal_enabled is distinct from true;

insert into public.sd_itinerary_role_permissions(
  workspace_id, role, can_view, can_edit, can_import, can_export, can_calendar,
  version, updated_at
)
select
  workspace.id,
  role_name,
  true,
  true,
  true,
  true,
  true,
  1,
  clock_timestamp()
from public.sd_workspaces workspace
cross join unnest(array['admin', 'operator', 'vessel']) role_name
on conflict (workspace_id, role) do update
set can_view = true,
    can_edit = true,
    can_import = true,
    can_export = true,
    can_calendar = true,
    version = public.sd_itinerary_role_permissions.version + 1,
    updated_at = clock_timestamp()
where not public.sd_itinerary_role_permissions.can_view
   or not public.sd_itinerary_role_permissions.can_edit
   or not public.sd_itinerary_role_permissions.can_import
   or not public.sd_itinerary_role_permissions.can_export
   or not public.sd_itinerary_role_permissions.can_calendar;

create or replace function public.sd_itinerary_can_action(
  p_workspace_id uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_permission public.sd_itinerary_role_permissions%rowtype;
begin
  select membership.role into v_role
  from public.sd_memberships membership
  join public.sd_login_options login
    on login.workspace_id = membership.workspace_id
   and login.user_id = membership.user_id
   and login.is_active
   and not login.must_change_password
  where membership.workspace_id = p_workspace_id
    and membership.user_id = auth.uid()
    and membership.is_active;

  if v_role is null or v_role not in ('owner', 'admin', 'operator', 'vessel') then
    return false;
  end if;
  if v_role = 'owner' then
    return true;
  end if;

  select * into v_permission
  from public.sd_itinerary_role_permissions permission
  where permission.workspace_id = p_workspace_id
    and permission.role = v_role;
  if not found then
    return false;
  end if;

  return case p_action
    when 'view' then v_permission.can_view
    when 'edit' then v_permission.can_edit
    when 'import' then v_permission.can_import
    when 'export' then v_permission.can_export
    when 'calendar' then v_permission.can_calendar
    else false
  end;
end;
$$;

create or replace function public.sd_itinerary_get_office_entry(
  p_workspace_key text,
  p_role text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when p_role not in ('owner', 'admin', 'operator', 'vessel') then false
    else coalesce(rollout.main_enabled, false)
      and (p_role = 'owner' or coalesce(permission.can_view, false))
  end
  from (select public.sd_itinerary_workspace_id(p_workspace_key) id) workspace
  left join public.sd_itinerary_rollout rollout on rollout.workspace_id = workspace.id
  left join public.sd_itinerary_role_permissions permission
    on permission.workspace_id = workspace.id
   and permission.role = p_role
$$;

-- Remove signatures from the unpublished guarded candidate if it was ever
-- rehearsed.  External dependants are removed before their helper functions.
drop function if exists public.sd_itinerary_main_get_rollout(text,text,jsonb);
drop function if exists public.sd_itinerary_main_load_many(text,text[],text,jsonb);
drop function if exists public.sd_itinerary_main_claim_lease(text,text,text,text,integer,text,jsonb);
drop function if exists public.sd_itinerary_main_renew_lease(text,text,uuid,text,bigint,integer,text,jsonb);
drop function if exists public.sd_itinerary_main_release_lease(text,text,uuid,text,bigint,text,jsonb);
drop function if exists public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb);
drop function if exists public.sd_itinerary_main_operation_status(text,uuid,text,jsonb);
drop function if exists public.sd_itinerary_main_owner_update_rollout(text,bigint,uuid,boolean,boolean,text,jsonb);
drop function if exists public.sd_itinerary_main_authorize(text,text,jsonb,text,boolean);
drop function if exists public.sd_itinerary_main_actor(text,text,jsonb);

create or replace function public.sd_itinerary_main_actor(
  p_workspace_key text,
  p_actor_user_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace uuid := public.sd_itinerary_workspace_id(p_workspace_key);
  v_candidate_uuid uuid;
  v_actor_uuid uuid;
  v_actor_key text;
  v_legacy_user_id text;
  v_department text;
  v_display_name text;
  v_username_label text;
  v_role text;
  v_payload jsonb;
  v_user jsonb;
begin
  if v_workspace is null or btrim(coalesce(p_actor_user_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  begin
    v_candidate_uuid := p_actor_user_id::uuid;
  exception when invalid_text_representation then
    v_candidate_uuid := null;
  end;

  if v_candidate_uuid is not null then
    select membership.user_id,
           membership.legacy_user_id,
           membership.department,
           profile.display_name,
           profile.username_label,
           membership.role
    into v_actor_uuid,
         v_legacy_user_id,
         v_department,
         v_display_name,
         v_username_label,
         v_role
    from public.sd_memberships membership
    join public.sd_profiles profile on profile.id = membership.user_id
    where membership.workspace_id = v_workspace
      and membership.user_id = v_candidate_uuid
      and membership.is_active
    limit 1;

    if found then
      return jsonb_build_object(
        'workspaceId', v_workspace,
        'legacyUserId', v_legacy_user_id,
        'actorKey', v_actor_uuid::text,
        'actorUuid', v_actor_uuid,
        'department', coalesce(v_department, ''),
        'displayName', coalesce(v_display_name, ''),
        'usernameLabel', coalesce(v_username_label, ''),
        'role', v_role
      );
    end if;
  end if;

  select state.payload
  into v_payload
  from public.ship_dynamics_app_state state
  where state.workspace_key = p_workspace_key;

  select item
  into v_user
  from jsonb_array_elements(coalesce(v_payload -> 'users', '[]'::jsonb)) item
  where item ->> 'id' = p_actor_user_id
    and coalesce((item ->> 'isActive')::boolean, false)
  limit 1;

  if v_user is null then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  v_role := lower(btrim(coalesce(v_user ->> 'role', '')));
  if v_role not in ('owner', 'admin', 'operator', 'vessel') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  select membership.user_id
  into v_actor_uuid
  from public.sd_memberships membership
  where membership.workspace_id = v_workspace
    and membership.legacy_user_id = p_actor_user_id
  order by membership.is_active desc, membership.user_id
  limit 1;

  v_actor_key := coalesce(v_actor_uuid::text, 'main:' || p_actor_user_id);
  return jsonb_build_object(
    'workspaceId', v_workspace,
    'legacyUserId', p_actor_user_id,
    'actorKey', v_actor_key,
    'actorUuid', v_actor_uuid,
    'department', coalesce(v_user ->> 'department', ''),
    'displayName', coalesce(v_user ->> 'name', ''),
    'usernameLabel', coalesce(v_user ->> 'username', ''),
    'role', v_role
  );
end;
$$;

create or replace function public.sd_itinerary_main_load_many(
  p_workspace_key text,
  p_vessel_ids text[],
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
  v_workspace uuid := (v_actor ->> 'workspaceId')::uuid;
  v_result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'vesselId', vessel.id,
    'vesselName', vessel.name,
    'document', public.sd_itinerary_document_for_vessel(v_workspace, p_workspace_key, vessel.id)
  ) order by vessel.name), '[]'::jsonb)
  into v_result
  from public.sd_vessels vessel
  where vessel.workspace_id = v_workspace
    and vessel.is_active
    and vessel.id = any(coalesce(p_vessel_ids, '{}'::text[]));
  return v_result;
end;
$$;

create or replace function public.sd_itinerary_main_claim_lease(
  p_workspace_key text,
  p_vessel_id text,
  p_holder_session text,
  p_holder_label text,
  p_ttl_seconds integer,
  p_actor_user_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_main_actor(p_workspace_key, p_actor_user_id);
begin
  return public.sd_itinerary_claim_lease_internal(
    (v_actor ->> 'workspaceId')::uuid,
    p_vessel_id,
    'office',
    v_actor ->> 'actorKey',
    p_holder_session,
    v_actor ->> 'displayName',
    p_ttl_seconds
  );
end;
$$;

create or replace function public.sd_itinerary_main_renew_lease(
  p_workspace_key text,
  p_vessel_id text,
  p_lease_id uuid,
  p_holder_session text,
  p_fencing_token bigint,
  p_ttl_seconds integer,
  p_actor_user_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_main_actor(p_workspace_key, p_actor_user_id);
begin
  return public.sd_itinerary_renew_lease_internal(
    (v_actor ->> 'workspaceId')::uuid,
    p_vessel_id,
    'office',
    v_actor ->> 'actorKey',
    p_lease_id,
    p_holder_session,
    p_fencing_token,
    p_ttl_seconds
  );
end;
$$;

create or replace function public.sd_itinerary_main_release_lease(
  p_workspace_key text,
  p_vessel_id text,
  p_lease_id uuid,
  p_holder_session text,
  p_fencing_token bigint,
  p_actor_user_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_main_actor(p_workspace_key, p_actor_user_id);
begin
  return public.sd_itinerary_release_lease_internal(
    (v_actor ->> 'workspaceId')::uuid,
    p_vessel_id,
    'office',
    v_actor ->> 'actorKey',
    p_lease_id,
    p_holder_session,
    p_fencing_token
  );
end;
$$;

create or replace function public.sd_itinerary_main_save(
  p_workspace_key text,
  p_vessel_id text,
  p_expected_revision bigint,
  p_operation_id uuid,
  p_rows jsonb,
  p_lease_id uuid,
  p_holder_session text,
  p_fencing_token bigint,
  p_actor_label text,
  p_actor_user_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_main_actor(p_workspace_key, p_actor_user_id);
begin
  return public.sd_itinerary_save_internal(
    p_workspace_key,
    p_vessel_id,
    p_expected_revision,
    p_operation_id,
    p_rows,
    'office',
    v_actor ->> 'actorKey',
    nullif(v_actor ->> 'actorUuid', '')::uuid,
    v_actor ->> 'displayName',
    p_lease_id,
    p_holder_session,
    p_fencing_token
  );
end;
$$;

create or replace function public.sd_itinerary_main_operation_status(
  p_workspace_key text,
  p_operation_id uuid,
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
  v_result jsonb;
begin
  select operation.result
  into v_result
  from public.sd_itinerary_operations operation
  where operation.workspace_id = (v_actor ->> 'workspaceId')::uuid
    and operation.operation_id = p_operation_id
    and operation.actor_key = v_actor ->> 'actorKey';
  return coalesce(v_result, jsonb_build_object('status', 'missing'));
end;
$$;

-- The historical control function remains in the catalog for migration
-- compatibility, but no browser role may execute it anymore.
revoke execute on function public.sd_itinerary_owner_update_rollout(text,bigint,uuid,boolean,boolean,jsonb)
  from public, anon, authenticated;

revoke all on function public.sd_itinerary_main_actor(text,text) from public, anon, authenticated;

revoke all on function public.sd_itinerary_main_load_many(text,text[],text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_main_claim_lease(text,text,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_main_renew_lease(text,text,uuid,text,bigint,integer,text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_main_release_lease(text,text,uuid,text,bigint,text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_main_operation_status(text,uuid,text) from public, anon, authenticated;

grant execute on function public.sd_itinerary_main_load_many(text,text[],text) to anon, authenticated;
grant execute on function public.sd_itinerary_main_claim_lease(text,text,text,text,integer,text) to anon, authenticated;
grant execute on function public.sd_itinerary_main_renew_lease(text,text,uuid,text,bigint,integer,text) to anon, authenticated;
grant execute on function public.sd_itinerary_main_release_lease(text,text,uuid,text,bigint,text) to anon, authenticated;
grant execute on function public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text) to anon, authenticated;
grant execute on function public.sd_itinerary_main_operation_status(text,uuid,text) to anon, authenticated;

commit;

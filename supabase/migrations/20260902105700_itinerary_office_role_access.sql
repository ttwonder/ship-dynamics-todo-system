begin;

-- Open the authenticated main-site Itinerary to every office role.
-- Owner, Admin and Operator receive the complete action set; Vessel remains
-- excluded from the main-site entry and continues to use the separate portal.
insert into public.sd_itinerary_role_permissions(
  workspace_id,
  role,
  can_view,
  can_edit,
  can_import,
  can_export,
  can_calendar,
  version,
  updated_at
)
select
  w.id,
  role_name,
  role_name in ('admin', 'operator'),
  role_name in ('admin', 'operator'),
  role_name in ('admin', 'operator'),
  role_name in ('admin', 'operator'),
  role_name in ('admin', 'operator'),
  1,
  clock_timestamp()
from public.sd_workspaces w
cross join unnest(array['admin', 'operator', 'vessel']) role_name
on conflict (workspace_id, role) do update
set can_view = excluded.can_view,
    can_edit = excluded.can_edit,
    can_import = excluded.can_import,
    can_export = excluded.can_export,
    can_calendar = excluded.can_calendar,
    version = public.sd_itinerary_role_permissions.version + 1,
    updated_at = excluded.updated_at
where public.sd_itinerary_role_permissions.can_view is distinct from excluded.can_view
   or public.sd_itinerary_role_permissions.can_edit is distinct from excluded.can_edit
   or public.sd_itinerary_role_permissions.can_import is distinct from excluded.can_import
   or public.sd_itinerary_role_permissions.can_export is distinct from excluded.can_export
   or public.sd_itinerary_role_permissions.can_calendar is distinct from excluded.can_calendar;

-- Keep the existing RPC signature so an older deployed client can safely toggle
-- either global switch during rollout. The server canonicalizes role permissions,
-- preventing an old Owner-only payload from closing Admin or Operator again.
create or replace function public.sd_itinerary_owner_update_rollout(
  p_workspace_key text,
  p_expected_version bigint,
  p_operation_id uuid,
  p_main_enabled boolean,
  p_ship_portal_enabled boolean,
  p_role_permissions jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace uuid := public.sd_itinerary_workspace_id(p_workspace_key);
  v_actor uuid := auth.uid();
  v_role_permissions jsonb := jsonb_build_object(
    'admin', jsonb_build_object('view', true, 'edit', true, 'import', true, 'export', true, 'calendar', true),
    'operator', jsonb_build_object('view', true, 'edit', true, 'import', true, 'export', true, 'calendar', true),
    'vessel', jsonb_build_object('view', false, 'edit', false, 'import', false, 'export', false, 'calendar', false)
  );
  v_request jsonb;
  v_replay jsonb;
  v_version bigint;
  v_role text;
  v_value jsonb;
  v_result jsonb;
begin
  if v_actor is null
     or public.sd_membership_role(v_workspace) <> 'owner'
     or not exists(
       select 1
       from public.sd_login_options login
       where login.workspace_id = v_workspace
         and login.user_id = v_actor
         and login.is_active
         and not login.must_change_password
     )
     or p_role_permissions is null
     or jsonb_typeof(p_role_permissions) <> 'object'
  then
    raise exception using errcode = 'P0001', message = 'owner-required';
  end if;

  v_request := jsonb_build_object(
    'expectedVersion', p_expected_version,
    'mainEnabled', p_main_enabled,
    'shipPortalEnabled', p_ship_portal_enabled,
    'rolePermissions', v_role_permissions
  );
  v_replay := public.sd_itinerary_operation_replay(
    v_workspace,
    p_operation_id,
    'office',
    v_actor::text,
    'rollout',
    v_request
  );
  if v_replay is not null then
    return v_replay;
  end if;

  update public.sd_itinerary_rollout
  set main_enabled = p_main_enabled,
      ship_portal_enabled = p_ship_portal_enabled,
      version = version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where workspace_id = v_workspace
    and version = p_expected_version
  returning version into v_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  for v_role, v_value in
    select key, value from jsonb_each(v_role_permissions)
  loop
    insert into public.sd_itinerary_role_permissions(
      workspace_id,
      role,
      can_view,
      can_edit,
      can_import,
      can_export,
      can_calendar,
      version,
      updated_at,
      updated_by
    )
    values(
      v_workspace,
      v_role,
      coalesce((v_value ->> 'view')::boolean, false),
      coalesce((v_value ->> 'edit')::boolean, false),
      coalesce((v_value ->> 'import')::boolean, false),
      coalesce((v_value ->> 'export')::boolean, false),
      coalesce((v_value ->> 'calendar')::boolean, false),
      1,
      clock_timestamp(),
      v_actor
    )
    on conflict (workspace_id, role) do update
    set can_view = excluded.can_view,
        can_edit = excluded.can_edit,
        can_import = excluded.can_import,
        can_export = excluded.can_export,
        can_calendar = excluded.can_calendar,
        version = public.sd_itinerary_role_permissions.version + 1,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'version', v_version,
    'mainEnabled', p_main_enabled,
    'shipPortalEnabled', p_ship_portal_enabled,
    'replayed', false
  );
  insert into public.sd_itinerary_operations(
    workspace_id,
    operation_id,
    actor_kind,
    actor_key,
    target_key,
    request_payload,
    request_hash,
    result
  )
  values(
    v_workspace,
    p_operation_id,
    'office',
    v_actor::text,
    'rollout',
    v_request,
    md5(v_request::text),
    v_result
  );
  return v_result;
end;
$$;

revoke all on function public.sd_itinerary_owner_update_rollout(text,bigint,uuid,boolean,boolean,jsonb)
  from public, anon, authenticated;
grant execute on function public.sd_itinerary_owner_update_rollout(text,bigint,uuid,boolean,boolean,jsonb)
  to authenticated;

commit;

begin;

-- Bootstrap follow-up for the already-applied Itinerary subsystem.
-- Exposes the existing rollout CAS version to an authenticated roster identity.
-- No rollout flag, role permission, document, history, lease, operation, or AppData row is changed.

create or replace function public.sd_itinerary_get_rollout(p_workspace_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace uuid;
  v_role text;
  v_rollout public.sd_itinerary_rollout%rowtype;
  v_permission public.sd_itinerary_role_permissions%rowtype;
  v_identity jsonb;
begin
  v_workspace := public.sd_itinerary_workspace_id(p_workspace_key);
  if v_workspace is null then
    return jsonb_build_object(
      'version', 0,
      'main_enabled', false,
      'ship_portal_enabled', false,
      'office_identity', null,
      'role_permissions', '{}'::jsonb
    );
  end if;

  select m.role,
    jsonb_build_object(
      'department', login.department,
      'display_name', login.display_name,
      'username_label', login.username_label,
      'role', m.role
    )
  into v_role, v_identity
  from public.sd_memberships m
  join public.sd_login_options login
    on login.workspace_id = m.workspace_id
   and login.user_id = m.user_id
   and login.is_active
   and not login.must_change_password
  where m.workspace_id = v_workspace
    and m.user_id = auth.uid()
    and m.is_active;

  if v_role is null or v_identity is null then
    return jsonb_build_object(
      'version', 0,
      'main_enabled', false,
      'ship_portal_enabled', false,
      'office_identity', null,
      'role_permissions', '{}'::jsonb
    );
  end if;

  select * into v_rollout
  from public.sd_itinerary_rollout
  where workspace_id = v_workspace;

  select * into v_permission
  from public.sd_itinerary_role_permissions
  where workspace_id = v_workspace and role = v_role;

  return jsonb_build_object(
    'version', coalesce(v_rollout.version, 0),
    'main_enabled', coalesce(v_rollout.main_enabled, false),
    'ship_portal_enabled', coalesce(v_rollout.ship_portal_enabled, false),
    'office_identity', v_identity,
    'role_permissions', jsonb_build_object(
      v_role,
      jsonb_build_object(
        'view', v_role = 'owner' or coalesce(v_permission.can_view, false),
        'edit', v_role = 'owner' or coalesce(v_permission.can_edit, false),
        'import', v_role = 'owner' or coalesce(v_permission.can_import, false),
        'export', v_role = 'owner' or coalesce(v_permission.can_export, false),
        'calendar', v_role = 'owner' or coalesce(v_permission.can_calendar, false)
      )
    )
  );
end;
$$;

revoke all on function public.sd_itinerary_get_rollout(text) from public, anon, authenticated;
grant execute on function public.sd_itinerary_get_rollout(text) to authenticated;

commit;

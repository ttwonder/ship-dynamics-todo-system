-- DEVELOPMENT ONLY: explicit records-v1 identity, existing formal document authority.
-- No replacement/alter of legacy RPCs, no writes, no browser grants or auto-detection.
begin;

create or replace function public.sd_itinerary_record_actor_v1(
  p_workspace_key text, p_actor_user_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_workspace uuid := public.sd_itinerary_workspace_id(p_workspace_key);
  v_candidate_uuid uuid;
  v_actor_uuid uuid;
  v_legacy_user_id text;
  v_department text;
  v_display_name text;
  v_username_label text;
  v_uuid_identity boolean := false;
  v_user jsonb;
  v_role text;
begin
  if v_workspace is null or btrim(coalesce(p_actor_user_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  begin
    v_candidate_uuid := p_actor_user_id::uuid;
  exception when invalid_text_representation then
    v_candidate_uuid := null;
  end;

  -- Preserve the existing UUID identity/metadata mapping, NOT membership authority.
  if v_candidate_uuid is not null then
    select membership.user_id, membership.legacy_user_id, membership.department,
           profile.display_name, profile.username_label
    into v_actor_uuid, v_legacy_user_id, v_department, v_display_name, v_username_label
    from public.sd_memberships membership
    join public.sd_profiles profile on profile.id = membership.user_id
    where membership.workspace_id = v_workspace
      and membership.user_id = v_candidate_uuid and membership.is_active
    limit 1;
    v_uuid_identity := found;
  end if;

  select record.value into v_user
  from public.ship_dynamics_records record
  where record.workspace_key = p_workspace_key and record.collection = 'users'
    and record.entity_id = case when v_uuid_identity then coalesce(v_legacy_user_id, p_actor_user_id) else p_actor_user_id end;
  v_role := lower(btrim(coalesce(v_user ->> 'role', '')));
  if v_user is null or (v_user -> 'isActive') is distinct from 'true'::jsonb
     or v_role not in ('owner', 'admin', 'operator', 'vessel') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  if not v_uuid_identity then
    v_legacy_user_id := p_actor_user_id;
    select membership.user_id into v_actor_uuid
    from public.sd_memberships membership
    where membership.workspace_id = v_workspace and membership.legacy_user_id = p_actor_user_id
    order by membership.is_active desc, membership.user_id limit 1;
    v_department := v_user ->> 'department';
    v_display_name := v_user ->> 'name';
    v_username_label := v_user ->> 'username';
  end if;
  return jsonb_build_object(
    'workspaceId', v_workspace, 'legacyUserId', v_legacy_user_id,
    'actorKey', coalesce(v_actor_uuid::text, 'main:' || p_actor_user_id), 'actorUuid', v_actor_uuid,
    'department', coalesce(v_department, ''), 'displayName', coalesce(v_display_name, ''),
    'usernameLabel', coalesce(v_username_label, ''), 'role', v_role
  );
end;
$$;

create or replace function public.sd_itinerary_record_load_many_v1(
  p_workspace_key text, p_vessel_ids text[], p_actor_user_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace uuid := (v_actor ->> 'workspaceId')::uuid;
  v_result jsonb;
begin
  -- Same four-role read scope and shape as main_load_many. sd_* is still the
  -- formal vessel metadata/document/alternatives authority, never AppData row JSON.
  select coalesce(jsonb_agg(jsonb_build_object(
    'vesselId', vessel.id, 'vesselName', vessel.name,
    'document', public.sd_itinerary_document_for_vessel(v_workspace, p_workspace_key, vessel.id)
  ) order by vessel.name), '[]'::jsonb) into v_result
  from public.sd_vessels vessel
  where vessel.workspace_id = v_workspace and vessel.is_active
    and vessel.id = any(coalesce(p_vessel_ids, '{}'::text[]));
  return v_result;
end;
$$;

revoke all on function public.sd_itinerary_record_actor_v1(text,text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_record_load_many_v1(text,text[],text) from public, anon, authenticated;
commit;

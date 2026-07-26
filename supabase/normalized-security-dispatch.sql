begin;

-- Final cross-aggregate security dispatch. Apply only after core, meeting, and
-- internal-control migrations. Aggregate migrations own their tables/commands;
-- this file is the sole final owner of generic task visibility and lease routing.

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
  v_account_count integer;
  v_account_vessel text;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_role is null then return false; end if;

  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id;
  if not found or v_task.is_deleted then return false; end if;

  if v_role = 'vessel' then
    if v_task.is_internal_control
       or v_task.internal_control_cancelled_at is not null
       or v_task.internal_control_cancelled_by is not null then
      return false;
    end if;

    select count(*), min(a.vessel_id)
      into v_account_count, v_account_vessel
    from public.sd_vessel_assignments a
    where a.workspace_id = p_workspace_id
      and a.user_id = auth.uid()
      and a.assignment_kind = 'vessel_account'
      and a.is_active;
    if v_account_count <> 1 then return false; end if;

    select count(*) into v_scope_count
    from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id
      and tv.task_id = p_task_id
      and tv.is_active_scope;

    if v_task.source_kind = 'ordinary' then
      if v_task.source_meeting_item_id is not null or v_scope_count <> 1 then
        return false;
      end if;
      return exists (
        select 1
        from public.sd_task_vessels tv
        where tv.workspace_id = p_workspace_id
          and tv.task_id = p_task_id
          and tv.vessel_id = v_account_vessel
          and tv.is_active_scope
      );
    end if;

    if v_task.source_kind <> 'meeting'
       or v_task.source_type <> 'temporary'
       or v_task.source_meeting_id is null
       or v_task.source_meeting_item_id is null
       or not v_task.distribute_to_vessels
       or v_scope_count <> 1 then
      return false;
    end if;

    return exists (
      select 1
      from public.sd_meeting_items mi
      join public.sd_meetings m
        on m.workspace_id = mi.workspace_id
       and m.id = mi.meeting_id
       and m.deleted_at is null
       and not m.is_internal_control
      join public.sd_meeting_vessels mv
        on mv.workspace_id = mi.workspace_id
       and mv.meeting_id = mi.meeting_id
       and mv.vessel_id = v_account_vessel
      join public.sd_task_vessels own_progress
        on own_progress.workspace_id = mi.workspace_id
       and own_progress.task_id = v_task.id
       and own_progress.vessel_id = v_account_vessel
       and own_progress.is_active_scope
      where mi.workspace_id = p_workspace_id
        and mi.id = v_task.source_meeting_item_id
        and m.id = v_task.source_meeting_id
        and mi.is_active
        and mi.distribute_to_vessels
        and (
          select count(*)
          from public.sd_meeting_vessels one_scope
          where one_scope.workspace_id = mi.workspace_id
            and one_scope.meeting_id = mi.meeting_id
        ) = 1
        and public.sd_meeting_scope_is_valid(mi.workspace_id, mi.meeting_id)
        and not exists (
          select 1
          from public.sd_task_vessels tv
          where tv.workspace_id = p_workspace_id
            and tv.task_id = p_task_id
            and tv.is_active_scope
            and not exists (
              select 1
              from public.sd_meeting_vessels expected
              where expected.workspace_id = mi.workspace_id
                and expected.meeting_id = mi.meeting_id
                and expected.vessel_id = tv.vessel_id
            )
        )
        and not exists (
          select 1
          from public.sd_meeting_vessels expected
          where expected.workspace_id = mi.workspace_id
            and expected.meeting_id = mi.meeting_id
            and not exists (
              select 1
              from public.sd_task_vessels tv
              where tv.workspace_id = expected.workspace_id
                and tv.task_id = p_task_id
                and tv.vessel_id = expected.vessel_id
                and tv.is_active_scope
            )
        )
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
  elsif p_entity_type = 'meeting' then
    if p_lease_key <> 'meeting:' || p_entity_id
       or not public.sd_can_manage_meetings(p_workspace_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'internal-case' then
    if v_role = 'vessel'
       or p_lease_key <> 'internal-case:' || p_entity_id
       or not public.sd_can_edit_internal_case(p_workspace_id, p_entity_id) then
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
             and (t.source_kind <> 'ordinary' or t.is_deleted)
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

revoke all on function public.sd_can_read_task(uuid, text) from public, anon;
grant execute on function public.sd_can_read_task(uuid, text) to authenticated;
revoke all on function public.claim_ship_dynamics_entity_lease(
  uuid, text, text, text, uuid, integer
) from public, anon;
grant execute on function public.claim_ship_dynamics_entity_lease(
  uuid, text, text, text, uuid, integer
) to authenticated;

commit;

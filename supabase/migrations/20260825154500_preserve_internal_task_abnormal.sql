begin;

-- Keep linked-task abnormal state independent and deploy the dedicated withdrawal RPC idempotently.

create or replace function public.sd_internal_validate_task_payload(
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
    where key not in ('id', 'expectedDate', 'categories', 'ownerUserIds', 'isAbnormal')
  ) or btrim(coalesce(p_task ->> 'id', '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-task-metadata';
  end if;
  if p_task ? 'isAbnormal'
     and jsonb_typeof(p_task -> 'isAbnormal') <> 'boolean' then
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

create or replace function public.command_ship_dynamics_update_internal_case(
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
        is_abnormal = case
          when p_task ? 'isAbnormal' then (p_task ->> 'isAbnormal')::boolean
          else t.is_abnormal
        end,
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

create or replace function public.command_ship_dynamics_withdraw_internal_case_task_sync(
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
  v_scope_count integer;
begin
  perform public.sd_internal_assert_actor(p_workspace_id, 'editBusinessContent');
  if btrim(coalesce(p_case_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid-case';
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
    'withdraw_internal_case_task_sync',
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
  if v_case.is_closed or v_case.origin <> 'internal-control' then
    raise exception using errcode = 'P0001', message = 'withdrawal-not-eligible';
  end if;

  select l.task_id into v_task_id
  from public.sd_internal_case_task_links l
  where l.workspace_id = p_workspace_id and l.case_id = p_case_id;
  if not found or btrim(coalesce(v_task_id, '')) = ''
     or (select count(*) from public.sd_internal_case_task_links l
         where l.workspace_id = p_workspace_id and l.case_id = p_case_id) <> 1
     or (select count(*) from public.sd_internal_case_task_links l
         where l.workspace_id = p_workspace_id and l.task_id = v_task_id) <> 1 then
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
  if not found
     or v_case.version <> p_base_case_version
     or v_case.is_deleted
     or v_case.is_closed
     or v_case.origin <> 'internal-control' then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = v_task_id
  for update;
  if not found
     or v_task.version <> p_base_task_version
     or v_task.is_deleted
     or v_task.is_closed then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  if v_task.source_kind <> 'ordinary'
     or v_task.source_type <> 'morning'
     or v_task.attention_dimension <> 'task'
     or not v_task.is_internal_control
     or v_task.source_meeting_id is not null
     or v_task.source_meeting_item_id is not null then
    raise exception using errcode = 'P0001', message = 'withdrawal-not-eligible';
  end if;
  if not exists (
    select 1 from public.sd_internal_case_task_links l
    where l.workspace_id = p_workspace_id
      and l.case_id = p_case_id
      and l.task_id = v_task_id
  ) then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;
  select count(*)::integer into v_scope_count
  from public.sd_task_vessels tv
  where tv.workspace_id = p_workspace_id
    and tv.task_id = v_task_id
    and tv.is_active_scope;
  if v_scope_count <> 1 or not exists (
    select 1 from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id
      and tv.task_id = v_task_id
      and tv.vessel_id = v_case.vessel_id
      and tv.is_active_scope
  ) then
    raise exception using errcode = 'P0001', message = 'scope-conflict';
  end if;

  update public.sd_internal_cases c
  set version = c.version + 1,
      updated_at = clock_timestamp(),
      updated_by = v_actor
  where c.workspace_id = p_workspace_id
    and c.id = p_case_id
    and c.version = p_base_case_version
    and not c.is_deleted
    and not c.is_closed
  returning c.version into v_case_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;

  delete from public.sd_internal_case_task_links l
  where l.workspace_id = p_workspace_id
    and l.case_id = p_case_id
    and l.task_id = v_task_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'link-conflict';
  end if;
  insert into public.sd_internal_case_status_events(
    workspace_id, id, case_id, event_kind, status, actor_id
  ) values (
    p_workspace_id, p_operation_id, p_case_id, 'unlinked', v_case.status, v_actor
  );

  perform public.sd_core_emit_task_notifications(
    p_workspace_id, v_task_id, v_actor, p_operation_id, 'task_deleted'
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
    and t.id = v_task_id
    and t.version = p_base_task_version
    and not t.is_deleted
  returning t.version into v_task_version;
  if not found then
    raise exception using errcode = '40001', message = 'version-conflict';
  end if;
  update public.sd_task_vessels tv
  set is_active_scope = false,
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
    public.sd_core_event_id(p_operation_id, 'task-status:' || v_task_id),
    v_task_id,
    '已刪除',
    v_actor
  );

  v_result := jsonb_build_object(
    'status', 'committed',
    'replayed', false,
    'caseId', p_case_id,
    'caseVersion', v_case_version,
    'taskId', v_task_id,
    'taskVersion', v_task_version,
    'deleted', true,
    'casePreserved', true
  );
  perform public.sd_internal_record_operation(
    p_workspace_id,
    p_operation_id,
    'withdraw_internal_case_task_sync',
    'internal-case:' || p_case_id,
    v_request,
    jsonb_build_object('case', p_base_case_version, 'task', p_base_task_version),
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
      'taskVersion', v_task_version,
      'taskDeleted', true,
      'casePreserved', true
    )
  );
  insert into public.sd_audit_events(
    workspace_id, id, actor_id, command, entity_type, entity_id, detail
  ) values (
    p_workspace_id,
    public.sd_core_event_id(p_operation_id, 'audit:task:' || v_task_id),
    v_actor,
    'withdraw_internal_case_task_sync',
    'task',
    v_task_id,
    jsonb_build_object(
      'taskVersion', v_task_version,
      'caseId', p_case_id,
      'casePreserved', true
    )
  );
  return v_result;
end;
$$;

revoke all on function public.command_ship_dynamics_withdraw_internal_case_task_sync(
  uuid, uuid, text, bigint, text, uuid, bigint, bigint, text, uuid, bigint
) from public;
grant execute on function public.command_ship_dynamics_withdraw_internal_case_task_sync(
  uuid, uuid, text, bigint, text, uuid, bigint, bigint, text, uuid, bigint
) to authenticated;

commit;

begin;

create or replace function public.sd_build_daily_morning_snapshot(
  p_workspace_id uuid,
  p_captured_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_vessels jsonb;
  v_tasks jsonb;
  v_meetings jsonb;
  v_itinerary_projections jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', v.id,
      'name', v.name,
      'shortName', v.short_name,
      'fullName', v.full_name,
      'shipType', v.ship_type,
      'fleetCategory', v.fleet_category,
      'fleetTags', to_jsonb(v.fleet_tags),
      'assignedUserIds', coalesce((
        select jsonb_agg(a.user_id::text order by a.user_id::text)
        from public.sd_vessel_assignments a
        where a.workspace_id = v.workspace_id and a.vessel_id = v.id
          and a.assignment_kind = 'manager' and a.is_active
      ), '[]'::jsonb),
      'delegateManagers', coalesce((
        select jsonb_agg(jsonb_build_object('userId', a.user_id::text, 'isActive', true) order by a.user_id::text)
        from public.sd_vessel_assignments a
        where a.workspace_id = v.workspace_id and a.vessel_id = v.id
          and a.assignment_kind = 'delegate' and a.is_active
      ), '[]'::jsonb),
      'vesselAccountUserIds', coalesce((
        select jsonb_agg(a.user_id::text order by a.user_id::text)
        from public.sd_vessel_assignments a
        where a.workspace_id = v.workspace_id and a.vessel_id = v.id
          and a.assignment_kind = 'vessel_account' and a.is_active
      ), '[]'::jsonb),
      'isActive', v.is_active,
      'position', jsonb_build_object(
        'source', 'manual', 'location', '', 'speedKnots', 0,
        'navigationStatus', '停泊', 'lastPort', '', 'nextPort', '',
        'eta', '', 'etb', '', 'etd', '', 'updatedAt', v.updated_at,
        'manualRemark', ''
      ) || coalesce(v.position, '{}'::jsonb),
      'cargo', jsonb_build_object(
        'source', 'manual', 'loadStatus', '空載', 'name', '', 'quantity', '',
        'items', '[]'::jsonb, 'updatedAt', v.updated_at
      ) || coalesce(v.cargo, '{}'::jsonb),
      'note', jsonb_build_object(
        'statusList', '[]'::jsonb, 'statusSupplement', '', 'captain', '',
        'chiefOfficer', '', 'chiefEngineer', '', 'firstEngineer', '',
        'recentDynamics', '', 'subsequentDynamics', '', 'updatedAt', v.updated_at
      ) || coalesce(v.note, '{}'::jsonb),
      'weeklyAttention', to_jsonb(v.weekly_attention),
      'manualAttentionLevel', coalesce(v.manual_attention_level, ''),
      'createdAt', v.created_at,
      'updatedAt', v.updated_at
    ) order by v.id
  ), '[]'::jsonb)
  into v_vessels
  from public.sd_vessels v
  where v.workspace_id = p_workspace_id and v.is_active;

  select coalesce(jsonb_object_agg(v.id,
    case when d.vessel_id is null or first_row.value is null then jsonb_build_object('source','legacy')
    else jsonb_build_object(
      'source','itinerary',
      'revision',d.revision,
      'updatedAt',d.updated_at,
      'rowId',coalesce(first_row.value ->> 'rowId',''),
      'values',jsonb_build_object(
        'previousPortName',btrim(coalesce(first_row.value ->> 'previousPortName','')),
        'portDockName',btrim(coalesce(first_row.value ->> 'portDockName','')),
        'etaUtc',nullif(btrim(coalesce(first_row.value ->> 'etaUtc','')),''),
        'etaTimeZone',coalesce(nullif(btrim(coalesce(first_row.value ->> 'etaTimeZone','')),''),nullif(btrim(coalesce(first_row.value ->> 'portTimeZone','')),''),''),
        'etbUtc',nullif(btrim(coalesce(first_row.value ->> 'etbUtc','')),''),
        'etbTimeZone',coalesce(nullif(btrim(coalesce(first_row.value ->> 'etbTimeZone','')),''),nullif(btrim(coalesce(first_row.value ->> 'portTimeZone','')),''),''),
        'etdUtc',nullif(btrim(coalesce(first_row.value ->> 'etdUtc','')),''),
        'etdTimeZone',coalesce(nullif(btrim(coalesce(first_row.value ->> 'etdTimeZone','')),''),nullif(btrim(coalesce(first_row.value ->> 'portTimeZone','')),''),''),
        'cargoQuantityText',btrim(coalesce(first_row.value ->> 'cargoQuantityText',''))
      )
    ) end order by v.id
  ),'{}'::jsonb)
  into v_itinerary_projections
  from public.sd_vessels v
  left join public.sd_itinerary_documents d
    on d.workspace_id=v.workspace_id and d.vessel_id=v.id
  left join lateral (
    select row_item.value
    from jsonb_array_elements(d.rows_payload) with ordinality row_item(value,ordinality)
    order by
      case when coalesce(row_item.value ->> 'sortOrder','') ~ '^[0-9]+$'
        then (row_item.value ->> 'sortOrder')::integer
        else row_item.ordinality::integer - 1 end,
      row_item.ordinality
    limit 1
  ) first_row on d.vessel_id is not null
  where v.workspace_id=p_workspace_id and v.is_active;

  select coalesce(jsonb_agg(task_payload order by task_payload ->> 'id'), '[]'::jsonb)
  into v_tasks
  from (
    select jsonb_build_object(
      'id', t.id,
      'vesselId', coalesce((select min(tv.vessel_id) from public.sd_task_vessels tv where tv.workspace_id=t.workspace_id and tv.task_id=t.id and tv.is_active_scope), ''),
      'vesselIds', coalesce((select jsonb_agg(tv.vessel_id order by tv.vessel_id) from public.sd_task_vessels tv join public.sd_vessels v on v.workspace_id=tv.workspace_id and v.id=tv.vessel_id and v.is_active where tv.workspace_id=t.workspace_id and tv.task_id=t.id and tv.is_active_scope), '[]'::jsonb),
      'vesselScopeMode', t.vessel_scope_mode,
      'vesselTypeScopes', coalesce((select jsonb_agg(ts.type_scope order by ts.ordinal) from public.sd_task_type_scopes ts where ts.workspace_id=t.workspace_id and ts.task_id=t.id), '[]'::jsonb),
      'priority', t.priority,
      'attentionDimension', t.attention_dimension,
      'isAware', t.is_aware,
      'isAbnormal', t.is_abnormal,
      'isInternalControl', false,
      'category', coalesce((select c.category from public.sd_task_categories c where c.workspace_id=t.workspace_id and c.task_id=t.id order by c.ordinal limit 1), '其他'),
      'categories', coalesce((select jsonb_agg(c.category order by c.ordinal) from public.sd_task_categories c where c.workspace_id=t.workspace_id and c.task_id=t.id), jsonb_build_array('其他')),
      'equipmentSubcategory', coalesce(t.equipment_subcategory, ''),
      'description', t.description,
      'status', t.status,
      'expectedDate', coalesce(t.expected_date::text, ''),
      'reportDate', coalesce(t.report_date::text, (p_captured_at at time zone 'Asia/Taipei')::date::text),
      'departments', coalesce((select jsonb_agg(d.department order by d.ordinal) from public.sd_task_departments d where d.workspace_id=t.workspace_id and d.task_id=t.id), '[]'::jsonb),
      'ownerUserIds', coalesce((select jsonb_agg(o.owner_id::text order by o.ordinal) from public.sd_task_owners o where o.workspace_id=t.workspace_id and o.task_id=t.id), '[]'::jsonb),
      'isClosed', false,
      'sourceMeetingId', t.source_meeting_id,
      'sourceMeetingItemId', t.source_meeting_item_id,
      'distributeToVessels', t.distribute_to_vessels,
      'sourceType', t.source_type,
      'createdBy', coalesce(t.created_by::text, ''),
      'updatedBy', coalesce(t.updated_by::text, ''),
      'createdAt', t.created_at,
      'updatedAt', t.updated_at,
      'statusLogs', '[]'::jsonb,
      'vesselProgress', coalesce((
        select jsonb_agg(jsonb_build_object(
          'vesselId', tv.vessel_id, 'status', tv.status, 'isClosed', tv.is_closed,
          'closedDate', tv.closed_date, 'closedBy', tv.closed_by,
          'updatedAt', tv.updated_at, 'updatedBy', tv.updated_by,
          'statusLogs', '[]'::jsonb
        ) order by tv.vessel_id)
        from public.sd_task_vessels tv
        join public.sd_vessels v on v.workspace_id=tv.workspace_id and v.id=tv.vessel_id and v.is_active
        where tv.workspace_id=t.workspace_id and tv.task_id=t.id and tv.is_active_scope
      ), '[]'::jsonb)
    ) as task_payload
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id
      and not t.is_deleted
      and not t.is_internal_control
      and not t.is_closed
      and exists (
        select 1 from public.sd_task_vessels tv
        join public.sd_vessels v on v.workspace_id=tv.workspace_id and v.id=tv.vessel_id and v.is_active
        where tv.workspace_id=t.workspace_id and tv.task_id=t.id
          and tv.is_active_scope and not tv.is_closed
      )
      and (
        t.source_meeting_id is null
        or exists (
          select 1 from public.sd_meetings m
          where m.workspace_id=t.workspace_id and m.id=t.source_meeting_id
            and m.deleted_at is null and m.include_in_morning and not m.is_internal_control
        )
      )
  ) tasks;

  select coalesce(jsonb_agg(meeting_payload order by meeting_payload ->> 'id'), '[]'::jsonb)
  into v_meetings
  from (
    select jsonb_build_object(
      'id', m.id,
      'subject', m.subject,
      'status', m.status,
      'meetingDate', m.meeting_date::text,
      'vesselScopeMode', m.scope_mode,
      'vesselTypeScopes', coalesce((select jsonb_agg(s.ship_type order by s.ship_type) from public.sd_meeting_type_scopes s where s.workspace_id=m.workspace_id and s.meeting_id=m.id), '[]'::jsonb),
      'vessels', coalesce((select jsonb_agg(v.vessel_id order by v.vessel_id) from public.sd_meeting_vessels v where v.workspace_id=m.workspace_id and v.meeting_id=m.id), '[]'::jsonb),
      'reason', m.reason,
      'departments', coalesce((select jsonb_agg(d.department order by d.department) from public.sd_meeting_departments d where d.workspace_id=m.workspace_id and d.meeting_id=m.id), '[]'::jsonb),
      'participantUserIds', coalesce((select jsonb_agg(p.user_id::text order by p.user_id::text) from public.sd_meeting_participants p where p.workspace_id=m.workspace_id and p.meeting_id=m.id and p.participant_kind='participant'), '[]'::jsonb),
      'trackingUserIds', coalesce((select jsonb_agg(p.user_id::text order by p.user_id::text) from public.sd_meeting_participants p where p.workspace_id=m.workspace_id and p.meeting_id=m.id and p.participant_kind='tracking'), '[]'::jsonb),
      'responsibleUserIds', coalesce((select jsonb_agg(p.user_id::text order by p.user_id::text) from public.sd_meeting_participants p where p.workspace_id=m.workspace_id and p.meeting_id=m.id and p.participant_kind='responsible'), '[]'::jsonb),
      'resolution', m.resolution,
      'taskDescription', coalesce((select i.description from public.sd_meeting_items i where i.workspace_id=m.workspace_id and i.meeting_id=m.id and i.is_active order by i.ordinal limit 1), ''),
      'taskItems', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'description', i.description,
        'categories', coalesce((select jsonb_agg(c.category order by c.category) from public.sd_meeting_item_categories c where c.workspace_id=i.workspace_id and c.meeting_item_id=i.id), '[]'::jsonb),
        'distributeToVessels', i.distribute_to_vessels
      ) order by i.ordinal) from public.sd_meeting_items i where i.workspace_id=m.workspace_id and i.meeting_id=m.id and i.is_active), '[]'::jsonb),
      'expectedDate', coalesce(m.expected_date::text, ''),
      'completedDate', m.completed_date,
      'completedBy', m.completed_by,
      'priority', m.priority,
      'isAbnormal', m.is_abnormal,
      'isInternalControl', false,
      'includeInMorning', true,
      'latestStatus', m.latest_status,
      'statusLogs', '[]'::jsonb,
      'createdBy', m.created_by::text,
      'createdAt', m.created_at,
      'updatedAt', m.updated_at
    ) as meeting_payload
    from public.sd_meetings m
    where m.workspace_id=p_workspace_id
      and m.deleted_at is null and m.include_in_morning and not m.is_internal_control
      and exists (
        select 1 from public.sd_tasks t
        where t.workspace_id=m.workspace_id and t.source_meeting_id=m.id
          and not t.is_deleted and not t.is_internal_control and not t.is_closed
      )
  ) meetings;

  return jsonb_build_object(
    'schemaVersion', 2,
    'capturedAt', p_captured_at,
    'projectionCapturedAt', p_captured_at,
    'itineraryProjections', v_itinerary_projections,
    'vessels', v_vessels,
    'tasks', v_tasks,
    'meetings', v_meetings
  );
end;
$$;

revoke all on function public.sd_build_daily_morning_snapshot(uuid,timestamptz) from public,anon,authenticated;

commit;

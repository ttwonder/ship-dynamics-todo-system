begin;

alter table public.sd_saved_reports
  add column if not exists report_kind text not null default 'ad-hoc',
  add column if not exists business_date date,
  add column if not exists source text not null default 'manual',
  add column if not exists snapshot jsonb,
  add column if not exists updated_at timestamptz not null default clock_timestamp(),
  add column if not exists updated_by uuid references auth.users(id);

alter table public.sd_saved_reports
  drop constraint if exists sd_saved_reports_kind_valid,
  add constraint sd_saved_reports_kind_valid check (report_kind in ('ad-hoc', 'daily-morning')),
  drop constraint if exists sd_saved_reports_source_valid,
  add constraint sd_saved_reports_source_valid check (source in ('manual', 'scheduled')),
  drop constraint if exists sd_saved_reports_daily_consistent,
  add constraint sd_saved_reports_daily_consistent check (
    (report_kind = 'daily-morning' and business_date is not null and snapshot is not null)
    or (report_kind = 'ad-hoc' and business_date is null)
  );

create unique index if not exists sd_saved_reports_one_daily_morning
  on public.sd_saved_reports(workspace_id, report_kind, business_date)
  where report_kind = 'daily-morning';

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
    'capturedAt', p_captured_at,
    'vessels', v_vessels,
    'tasks', v_tasks,
    'meetings', v_meetings
  );
end;
$$;

revoke all on function public.sd_build_daily_morning_snapshot(uuid,timestamptz) from public,anon,authenticated;

create or replace function public.sd_publish_daily_morning_to_legacy_read_model(
  p_workspace_id uuid,
  p_report jsonb,
  p_actor uuid,
  p_updated_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_legacy_key text;
  v_payload jsonb;
  v_reports jsonb;
  v_existing jsonb;
  v_remaining jsonb;
  v_report jsonb;
  v_report_id text := p_report ->> 'id';
  v_saved_by text := 'scheduled-daily-morning:' || coalesce(p_actor::text,'system');
  v_revision integer;
begin
  if to_regclass('public.ship_dynamics_app_state') is null then return false; end if;
  select w.legacy_key into v_legacy_key
  from public.sd_workspaces w
  where w.id=p_workspace_id and w.is_active;
  if v_legacy_key is null or btrim(coalesce(v_report_id,''))='' then return false; end if;

  execute 'select payload,revision from public.ship_dynamics_app_state where workspace_key=$1 for update'
    into v_payload,v_revision using v_legacy_key;
  if v_payload is null then return false; end if;
  if jsonb_typeof(v_payload)<>'object' then
    raise exception using errcode='P0001',message='invalid-legacy-read-model';
  end if;
  v_reports := case when jsonb_typeof(v_payload -> 'agendaReports')='array'
    then v_payload -> 'agendaReports' else '[]'::jsonb end;
  select item.value into v_existing
  from jsonb_array_elements(v_reports) item(value)
  where item.value ->> 'id'=v_report_id
  limit 1;
  select coalesce(jsonb_agg(item.value order by item.ordinal),'[]'::jsonb)
    into v_remaining
  from jsonb_array_elements(v_reports) with ordinality item(value,ordinal)
  where item.value ->> 'id' is distinct from v_report_id;

  v_report := p_report || jsonb_build_object(
    'createdBy',coalesce(v_existing ->> 'createdBy',p_report ->> 'createdBy'),
    'createdAt',coalesce(v_existing ->> 'createdAt',p_report ->> 'createdAt'),
    'source',case when v_existing ->> 'source'='manual' then 'manual' else p_report ->> 'source' end
  );
  v_revision := coalesce(v_revision,0)+1;
  v_payload := jsonb_set(v_payload,'{agendaReports}',jsonb_build_array(v_report)||v_remaining,true);
  v_payload := jsonb_set(v_payload,'{revision}',to_jsonb(v_revision),true);
  v_payload := jsonb_set(v_payload,'{updatedAt}',to_jsonb(p_updated_at),true);
  execute 'update public.ship_dynamics_app_state set payload=$1,revision=$2,updated_at=$3,updated_by=$4 where workspace_key=$5'
    using v_payload,v_revision,p_updated_at,v_saved_by,v_legacy_key;
  if to_regclass('public.ship_dynamics_app_revisions') is not null then
    execute 'insert into public.ship_dynamics_app_revisions(workspace_key,revision,payload,saved_by,saved_at) values($1,$2,$3,$4,$5) on conflict do nothing'
      using v_legacy_key,v_revision,v_payload,v_saved_by,p_updated_at;
  end if;
  return true;
end;
$$;

revoke all on function public.sd_publish_daily_morning_to_legacy_read_model(uuid,jsonb,uuid,timestamptz) from public,anon,authenticated;

create or replace function public.command_ship_dynamics_save_report(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_report_id text,
  p_content jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_kind text := coalesce(p_content ->> 'kind', 'ad-hoc');
  v_business_date date;
  v_captured_business_date date;
  v_source text := coalesce(p_content ->> 'source', 'manual');
  v_snapshot jsonb := p_content -> 'snapshot';
  v_vessels text[];
  v_vessel_id text;
  v_request jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_version bigint;
begin
  if v_actor is null
     or not public.sd_has_permission(p_workspace_id, 'exportReports')
     or btrim(coalesce(p_report_id, '')) = '' then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  perform public.sd_core_assert_json_keys(
    p_content,
    array['title','vesselIds','taskCount','kind','businessDate','source','snapshot'],
    'invalid-report-payload'
  );
  if not (p_content ? 'title' and p_content ? 'vesselIds' and p_content ? 'taskCount')
     or jsonb_typeof(p_content -> 'title') <> 'string'
     or jsonb_typeof(p_content -> 'taskCount') <> 'number'
     or btrim(p_content ->> 'title') = ''
     or (p_content ->> 'taskCount')::integer < 0
     or v_kind not in ('ad-hoc','daily-morning')
     or v_source not in ('manual','scheduled') then
    raise exception using errcode='P0001', message='invalid-report-payload';
  end if;
  if v_kind='daily-morning' then
    if public.sd_membership_role(p_workspace_id) not in ('owner','admin')
       or v_source <> 'manual'
       or jsonb_typeof(v_snapshot) <> 'object'
       or jsonb_typeof(v_snapshot -> 'vessels') <> 'array'
       or jsonb_typeof(v_snapshot -> 'tasks') <> 'array'
       or jsonb_typeof(v_snapshot -> 'meetings') <> 'array' then
      raise exception using errcode='P0001', message='not-authorized';
    end if;
    begin
      v_business_date := (p_content ->> 'businessDate')::date;
      if jsonb_typeof(v_snapshot -> 'capturedAt') <> 'string' then
        raise exception 'invalid capturedAt';
      end if;
      v_captured_business_date := ((v_snapshot ->> 'capturedAt')::timestamptz at time zone 'Asia/Taipei')::date;
    exception when others then
      raise exception using errcode='P0001', message='invalid-report-payload';
    end;
    if v_business_date is null
       or v_business_date <> (clock_timestamp() at time zone 'Asia/Taipei')::date
       or extract(isodow from v_business_date) > 5
       or p_report_id <> 'daily-morning-' || v_business_date::text
       or v_captured_business_date <> v_business_date
       or jsonb_path_exists(v_snapshot, '$.tasks[*] ? (@.isInternalControl == true)')
       or jsonb_path_exists(v_snapshot, '$.meetings[*] ? (@.isInternalControl == true)') then
      raise exception using errcode='P0001', message='invalid-report-payload';
    end if;
  elsif p_content -> 'businessDate' <> 'null'::jsonb or v_snapshot <> 'null'::jsonb then
    raise exception using errcode='P0001', message='invalid-report-payload';
  end if;

  v_vessels := public.sd_core_text_array(p_content, 'vesselIds', false);
  foreach v_vessel_id in array v_vessels loop
    if not public.sd_can_read_vessel(p_workspace_id, v_vessel_id) then
      raise exception using errcode='P0001', message='not-authorized';
    end if;
  end loop;
  v_request := jsonb_build_object('reportId', p_report_id, 'content', p_content);
  v_replay := public.sd_core_operation_replay(
    p_operation_id, p_workspace_id, v_actor,
    'save_report', 'report:' || p_report_id, v_request
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':report:' || p_report_id, 0));
  if exists (
    select 1 from public.sd_saved_reports r
    where r.workspace_id=p_workspace_id and r.id=p_report_id and r.report_kind<>v_kind
  ) then
    raise exception using errcode='23505', message='report-kind-conflict';
  end if;
  if v_kind='ad-hoc' and exists (
    select 1 from public.sd_saved_reports r
    where r.workspace_id=p_workspace_id and r.id=p_report_id
  ) then
    raise exception using errcode='23505', message='entity-exists';
  end if;

  insert into public.sd_saved_reports(
    workspace_id,id,title,task_count,report_kind,business_date,source,snapshot,
    version,created_at,created_by,updated_at,updated_by
  ) values (
    p_workspace_id,p_report_id,btrim(p_content ->> 'title'),
    (p_content ->> 'taskCount')::integer,v_kind,v_business_date,v_source,
    case when v_kind='daily-morning' then v_snapshot else null end,
    1,clock_timestamp(),v_actor,clock_timestamp(),v_actor
  )
  on conflict (workspace_id,id) do update set
    title=excluded.title,
    task_count=excluded.task_count,
    business_date=excluded.business_date,
    source=case when public.sd_saved_reports.source='manual' then 'manual' else excluded.source end,
    snapshot=excluded.snapshot,
    version=public.sd_saved_reports.version+1,
    updated_at=clock_timestamp(),
    updated_by=v_actor
  returning version into v_version;

  delete from public.sd_saved_report_vessels
  where workspace_id=p_workspace_id and report_id=p_report_id;
  insert into public.sd_saved_report_vessels(workspace_id,report_id,vessel_id,ordinal)
  select p_workspace_id,p_report_id,value,ordinal-1
  from unnest(v_vessels) with ordinality item(value,ordinal);

  v_result := jsonb_build_object(
    'status','committed','replayed',false,
    'entityType','report','entityId',p_report_id,'version',v_version
  );
  perform public.sd_core_commit_operation(
    p_operation_id,p_workspace_id,v_actor,
    'save_report','report:'||p_report_id,v_request,
    '{}'::jsonb,jsonb_build_object('version',v_version),v_result
  );
  insert into public.sd_audit_events(
    workspace_id,id,actor_id,command,entity_type,entity_id,detail
  ) values (
    p_workspace_id,public.sd_core_event_id(p_operation_id,'audit'),v_actor,
    case when v_kind='daily-morning' then 'save_daily_morning_report' else 'save_report' end,
    'report',p_report_id,
    jsonb_build_object('vesselCount',cardinality(v_vessels),'businessDate',v_business_date)
  );
  return v_result;
end;
$$;

revoke all on function public.command_ship_dynamics_save_report(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.command_ship_dynamics_save_report(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.ship_dynamics_run_daily_morning_snapshots()
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_business_date date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_workspace record;
  v_report_id text;
  v_snapshot jsonb;
  v_vessel_ids text[];
  v_legacy_report jsonb;
  v_count integer := 0;
  v_version bigint;
begin
  if extract(isodow from v_business_date) > 5 then return 0; end if;
  for v_workspace in
    select w.id,
      (select m.user_id from public.sd_memberships m where m.workspace_id=w.id and m.role='owner' and m.is_active limit 1) as owner_id
    from public.sd_workspaces w where w.is_active
  loop
    if v_workspace.owner_id is null then continue; end if;
    v_report_id := 'daily-morning-' || v_business_date::text;
    perform pg_advisory_xact_lock(hashtextextended(v_workspace.id::text || ':report:' || v_report_id,0));
    v_snapshot := public.sd_build_daily_morning_snapshot(v_workspace.id,v_now);
    select coalesce(array_agg(v.id order by v.id),'{}'::text[])
    into v_vessel_ids from public.sd_vessels v
    where v.workspace_id=v_workspace.id and v.is_active;

    insert into public.sd_saved_reports(
      workspace_id,id,title,task_count,report_kind,business_date,source,snapshot,
      version,created_at,created_by,updated_at,updated_by
    ) values (
      v_workspace.id,v_report_id,
      to_char(v_business_date,'YYYY/MM/DD') || ' 早會內容',
      jsonb_array_length(v_snapshot -> 'tasks'),'daily-morning',v_business_date,
      'scheduled',v_snapshot,1,v_now,v_workspace.owner_id,v_now,v_workspace.owner_id
    )
    on conflict (workspace_id,id) do update set
      title=excluded.title,
      task_count=excluded.task_count,
      business_date=excluded.business_date,
      source=case when public.sd_saved_reports.source='manual' then 'manual' else 'scheduled' end,
      snapshot=excluded.snapshot,
      version=public.sd_saved_reports.version+1,
      updated_at=v_now,
      updated_by=v_workspace.owner_id
    returning version into v_version;

    delete from public.sd_saved_report_vessels
    where workspace_id=v_workspace.id and report_id=v_report_id;
    insert into public.sd_saved_report_vessels(workspace_id,report_id,vessel_id,ordinal)
    select v_workspace.id,v_report_id,value,ordinal-1
    from unnest(v_vessel_ids) with ordinality item(value,ordinal);

    v_legacy_report := jsonb_build_object(
      'id',v_report_id,
      'title',to_char(v_business_date,'YYYY/MM/DD') || ' 早會內容',
      'vesselIds',to_jsonb(v_vessel_ids),
      'createdBy',v_workspace.owner_id::text,
      'createdAt',v_now,
      'taskCount',jsonb_array_length(v_snapshot -> 'tasks'),
      'kind','daily-morning',
      'businessDate',v_business_date::text,
      'source','scheduled',
      'updatedAt',v_now,
      'snapshot',v_snapshot
    );
    perform public.sd_publish_daily_morning_to_legacy_read_model(
      v_workspace.id,v_legacy_report,v_workspace.owner_id,v_now
    );

    insert into public.sd_audit_events(
      workspace_id,id,actor_id,command,entity_type,entity_id,detail
    ) values (
      v_workspace.id,gen_random_uuid(),v_workspace.owner_id,
      'scheduled_daily_morning_report','report',v_report_id,
      jsonb_build_object('businessDate',v_business_date,'version',v_version)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ship_dynamics_run_daily_morning_snapshots() from public;
revoke all on function public.ship_dynamics_run_daily_morning_snapshots() from authenticated;
grant execute on function public.ship_dynamics_run_daily_morning_snapshots() to service_role;

create extension if not exists pg_cron with schema extensions;
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='ship-dynamics-daily-morning-0900-taipei';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'ship-dynamics-daily-morning-0900-taipei',
    '0 1 * * 1-5',
    'select public.ship_dynamics_run_daily_morning_snapshots();'
  );
end;
$$;

notify pgrst, 'reload schema';
commit;

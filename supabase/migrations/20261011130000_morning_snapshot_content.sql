-- Owner-run guarded forward repair. Already-installed 10:00 policy is required.
-- ONLY existing builder content and runner total change. No new functions,
-- grants, cron writes, business/history writes, automatic invocation or replay.
-- Existing frozen reports (including an incomplete 10/11 report) stay unchanged.
-- Formal Itinerary projection, pause/authority, receipt and OID/ACL/config persist.
begin;
set local lock_timeout = '5s';
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
do $install$
declare
  builder regprocedure := to_regprocedure('public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz)');
  runner regprocedure := to_regprocedure('public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz)');
  p pg_catalog.pg_proc%rowtype; fn regprocedure; before_meta jsonb; after_meta jsonb;
  dependencies oid[]; dependencies_before jsonb; dependencies_after jsonb;
  raw_source text; source_lf text; next_raw text; definition text; next_definition text; nl text; expected_lf text;
  builder_source constant text := replace($content$
declare
  v_workspace uuid := public.sd_itinerary_workspace_id(p_workspace_key);
  v_vessels jsonb; v_tasks jsonb; v_cases jsonb; v_meetings jsonb; v_projections jsonb;
  v_baseline jsonb; v_baseline_id text; v_report jsonb; v_item jsonb; v_previous jsonb;
  v_eligible_meetings jsonb; v_member_ids jsonb; v_scope_ids jsonb; v_row record; v_key text;
  v_started timestamptz; v_cutoff timestamptz; v_created timestamptz; v_updated timestamptz; v_instant timestamptz;
  v_closed boolean; v_changed boolean;
begin
  if v_workspace is null then raise exception 'formal-workspace-not-found'; end if;
  -- Complete records content follows the existing manual morning scope.
  -- Preserve literal IDs, source-owned metadata and full hydrated histories.
  select coalesce(jsonb_agg(r.value order by ids.ordinal),'[]'::jsonb) into v_vessels
  from public.ship_dynamics_records r
  join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection=r.collection
  cross join lateral jsonb_array_elements_text(c.ids) with ordinality ids(id,ordinal)
  where r.workspace_key=p_workspace_key and r.collection='vessels' and ids.id=r.entity_id
    and r.value -> 'isActive' is distinct from 'false'::jsonb;

  -- record_daily_morning_complete_content_v1
  -- Same scope/window as src/morningHistory.ts; no extra RPCs or helper grants.
  v_tasks := '[]'::jsonb; v_cases := '[]'::jsonb;
  v_baseline := '{}'::jsonb; v_started := null;
  -- Select the latest eligible MANUAL cutoff using compact metadata, then read
  -- only that frozen baseline. Scheduled reports never advance this window.
  for v_report in
    select jsonb_build_object('id',r.entity_id,
      'windowEndedAt',r.value#>'{snapshot,windowEndedAt}',
      'createdAt',r.value->'createdAt','capturedAt',r.value#>'{snapshot,capturedAt}')
    from public.ship_dynamics_records r
    join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection=r.collection
    cross join lateral jsonb_array_elements_text(c.ids) with ordinality ids(id,ordinal)
    where r.workspace_key=p_workspace_key and r.collection='agendaReports' and ids.id=r.entity_id
      and r.value->>'kind'='daily-morning' and r.value->>'source' is distinct from 'scheduled'
    order by ids.ordinal
  loop
    v_cutoff := null;
    foreach v_key in array array['windowEndedAt','createdAt','capturedAt'] loop
      if jsonb_typeof(v_report->v_key)='string' and coalesce(v_report->>v_key,'')<>'' then
        begin
          v_cutoff := (v_report->>v_key)::timestamptz;
          if not isfinite(v_cutoff) then v_cutoff := null; end if;
        exception when invalid_datetime_format or datetime_field_overflow then v_cutoff := null;
        end;
      end if;
      exit when v_cutoff is not null;
    end loop;
    if v_cutoff<=p_captured_at and (v_started is null or v_cutoff>=v_started) then
      v_started := v_cutoff; v_baseline_id := v_report->>'id';
    end if;
  end loop;
  if v_started is not null then
    select coalesce(r.value->'snapshot','{}'::jsonb) into v_baseline
    from public.ship_dynamics_records r
    where r.workspace_key=p_workspace_key and r.collection='agendaReports' and r.entity_id=v_baseline_id;
  end if;
  select coalesce(jsonb_agg(r.value order by ids.ordinal),'[]'::jsonb) into v_eligible_meetings
  from public.ship_dynamics_records r
  join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection=r.collection
  cross join lateral jsonb_array_elements_text(c.ids) with ordinality ids(id,ordinal)
  where r.workspace_key=p_workspace_key and r.collection='meetings' and ids.id=r.entity_id
    and r.value->'includeInMorning'='true'::jsonb and r.value->'isInternalControl' is distinct from 'true'::jsonb;
  for v_row in
    select r.collection,public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) value
    from public.ship_dynamics_records r
    join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection=r.collection
    cross join lateral jsonb_array_elements_text(c.ids) with ordinality ids(id,ordinal)
    where r.workspace_key=p_workspace_key and r.collection in ('tasks','internalControlCases') and ids.id=r.entity_id
    order by r.collection,ids.ordinal
  loop
    v_item := v_row.value;
    if v_row.collection='tasks' then
      if v_item->'isInternalControl'='true'::jsonb then continue; end if;
      if nullif(v_item->>'sourceMeetingId','') is null then
        if v_item->>'sourceType'='temporary' then continue; end if;
      elsif not exists(select 1 from jsonb_array_elements(v_eligible_meetings) m where m->>'id'=v_item->>'sourceMeetingId') then
        continue;
      end if;
      select coalesce(jsonb_agg(distinct member.value),'[]'::jsonb) into v_member_ids
      from jsonb_array_elements(case when jsonb_array_length(coalesce(v_item->'vesselIds','[]'::jsonb))>0
        then v_item->'vesselIds' else jsonb_build_array(v_item->'vesselId') end) member(value)
      where member.value is distinct from 'null'::jsonb and member.value<>'""'::jsonb;
      select coalesce(jsonb_agg(member.value),'[]'::jsonb) into v_scope_ids
      from jsonb_array_elements(v_member_ids) member(value)
      where exists(select 1 from jsonb_array_elements(v_vessels) v where v->'id'=member.value);
      if jsonb_array_length(v_scope_ids)=0 then continue; end if;
      v_closed := coalesce(v_item->'isClosed'='true'::jsonb,false);
      if nullif(v_item->>'sourceMeetingId','') is not null and v_item->'distributeToVessels'='true'::jsonb and jsonb_array_length(v_member_ids)>1 then
        -- Missing per-vessel progress is open, exactly as emptyTaskVesselProgress.
        select not exists(
          select 1 from jsonb_array_elements(v_scope_ids) member(value)
          where not coalesce((select progress.value->'isClosed'='true'::jsonb
            from jsonb_array_elements(coalesce(v_item->'vesselProgress','[]'::jsonb)) with ordinality progress(value,ordinal)
            where progress.value->'vesselId'=member.value order by progress.ordinal limit 1),false)
        ) into v_closed;
      end if;
    else
      if not exists(select 1 from jsonb_array_elements(v_vessels) v where v->'id'=v_item->'vesselId') then continue; end if;
      v_closed := coalesce(v_item->'isClosed'='true'::jsonb,false);
    end if;
    v_created := null; v_updated := null;
    foreach v_key in array array['createdAt','updatedAt'] loop
      v_instant := null;
      if jsonb_typeof(v_item->v_key)='string' and coalesce(v_item->>v_key,'')<>'' then
        begin
          v_instant := (v_item->>v_key)::timestamptz;
          if not isfinite(v_instant) then v_instant := null; end if;
        exception when invalid_datetime_format or datetime_field_overflow then v_instant := null;
        end;
      end if;
      if v_key='createdAt' then v_created := v_instant; else v_updated := v_instant; end if;
    end loop;
    if v_created>p_captured_at then continue; end if;
    if v_closed then
      if v_item->'isClosed'='true'::jsonb and v_started is null then continue; end if;
      v_changed := coalesce(v_created<=p_captured_at and (v_started is null or v_created>v_started),false);
      if not v_changed and v_updated<=p_captured_at and (v_started is null or v_updated>v_started) then
        select previous.value into v_previous
        from jsonb_array_elements(coalesce(v_baseline->v_row.collection,'[]'::jsonb)) with ordinality previous(value,ordinal)
        where previous.value->>'id'=v_item->>'id' order by previous.ordinal desc limit 1;
        if v_previous is null then v_changed := true;
        else
          -- Canonical tree comparison ignores ONLY the TS helper's technical
          -- keys and status-log id/at, recursively; retain every business leaf,
          -- array position, explicit null and opaque nested field.
          with recursive nodes(side,route,value) as (
            values (0,array[]::text[],v_item),(1,array[]::text[],v_previous)
            union all
            select n.side,n.route||child.segment,child.value
            from nodes n cross join lateral (
              select 'k:'||e.key segment,e.value
              from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end) e
              where e.key<>all(array['createdAt','updatedAt','updatedBy','_v7Id','_v7Revision'])
                and not (jsonb_typeof(n.value->'text')='string' and n.value?'at' and e.key in ('id','at'))
              union all
              select 'i:'||e.ordinal::text,e.value
              from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end) with ordinality e(value,ordinal)
            ) child
          ), signatures as (
            select side,jsonb_agg(jsonb_build_array(route,jsonb_typeof(value),
              case when jsonb_typeof(value) in ('object','array') then null else value end) order by route) signature
            from nodes group by side
          ) select a.signature is distinct from b.signature into v_changed
          from signatures a cross join signatures b where a.side=0 and b.side=1;
        end if;
      end if;
      if not v_changed then continue; end if;
    end if;
    if v_row.collection='tasks' then v_tasks := v_tasks||jsonb_build_array(v_item);
    else v_cases := v_cases||jsonb_build_array(v_item); end if;
  end loop;
  select coalesce(jsonb_agg(m.value order by m.ordinal),'[]'::jsonb) into v_meetings
  from jsonb_array_elements(v_eligible_meetings) with ordinality m(value,ordinal)
  where exists(select 1 from jsonb_array_elements(v_tasks) t where t->>'sourceMeetingId'=m.value->>'id');

  -- Same final formal six-group projection as 20260903230000. Vessel membership
  -- comes from records; ONLY shared formal documents supply operational values.
  select coalesce(jsonb_object_agg(v.value ->> 'id',
    case when d.vessel_id is null or first_row.value is null then jsonb_build_object('source','legacy')
    else jsonb_build_object(
      'source','itinerary','revision',d.revision,'updatedAt',d.updated_at,
      'rowId',coalesce(first_row.value ->> 'rowId',''),
      'values',public.sd_itinerary_operational_values_v1(d.rows_payload,p_captured_at)
    ) end order by v.value ->> 'id'),'{}'::jsonb) into v_projections
  from jsonb_array_elements(v_vessels) v(value)
  left join public.sd_itinerary_documents d on d.workspace_id=v_workspace and d.vessel_id=v.value ->> 'id'
  left join lateral (
    select row_item.value from jsonb_array_elements(d.rows_payload) with ordinality row_item(value,ordinality)
    order by case when coalesce(row_item.value ->> 'sortOrder','') ~ '^[0-9]+$'
      then (row_item.value ->> 'sortOrder')::integer else row_item.ordinality::integer-1 end,row_item.ordinality limit 1
  ) first_row on d.vessel_id is not null;
  return jsonb_build_object('schemaVersion',2,'capturedAt',p_captured_at,'projectionCapturedAt',p_captured_at,
    'itineraryProjections',v_projections,'vessels',v_vessels,'tasks',v_tasks,'internalControlCases',v_cases,'meetings',v_meetings)
    || case when v_started is null then '{}'::jsonb else jsonb_build_object('windowStartedAt',
      to_char(v_started at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end;
end;
$content$,chr(13)||chr(10),chr(10));
  old_count constant text := $old_count$'taskCount',jsonb_array_length(snapshot -> 'tasks')$old_count$;
  new_count constant text := $new_count$'taskCount',jsonb_array_length(snapshot -> 'tasks')+jsonb_array_length(snapshot -> 'internalControlCases')$new_count$;
begin
  if builder is null or runner is null then raise exception 'morning-content-existing-functions-required'; end if;
  dependencies := array[
    to_regprocedure('public.ship_dynamics_record_writer_gate_v1(text,boolean)')::oid,
    to_regprocedure('public.ship_dynamics_record_commit_validated_v1(text,jsonb,jsonb,jsonb,text,text,jsonb)')::oid,
    to_regprocedure('public.sd_itinerary_operational_values_v1(jsonb,timestamptz)')::oid];
  if array_position(dependencies,null::oid) is not null then raise exception 'morning-content-current-dependencies-required'; end if;
  select jsonb_agg(to_jsonb(d) order by d.oid) into dependencies_before from pg_catalog.pg_proc d where d.oid=any(dependencies);
  foreach fn in array array[builder,runner] loop
    select * into strict p from pg_catalog.pg_proc where oid=fn;
    if p.proowner<>(select oid from pg_catalog.pg_roles where rolname=current_user) or p.prosecdef
      or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
      or p.proconfig is distinct from array['search_path=pg_catalog, public']::text[] then
      raise exception 'morning-content-existing-owner-invoker-config-required' using errcode='42501';
    end if;
    foreach nl in array array['anon','authenticated'] loop
      if not exists(select 1 from pg_catalog.pg_roles where rolname=nl) or has_function_privilege(nl,fn::oid,'EXECUTE') then
        raise exception 'morning-content-browser-execute-denied-required' using errcode='42501';
      end if;
    end loop;
    if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
        and a.grantee<>(select oid from pg_catalog.pg_roles where rolname='service_role')) then
      raise exception 'morning-content-unapproved-existing-grant';
    end if;
    raw_source := p.prosrc; source_lf := replace(raw_source,chr(13)||chr(10),chr(10));
    if fn=builder then
      if source_lf=builder_source then continue; end if;
      if md5(source_lf)<>'0bff3f76e76b4015d901ba17b6f9fb55' then raise exception 'morning-content-unknown-builder-predecessor'; end if;
      expected_lf := builder_source;
    else
      if md5(source_lf) in ('4b20d5d01591725aab95ef23d42333b0','6de9249ad24b80ed36e37b0b80e7405e') then continue; end if;
      if md5(source_lf) not in ('1ae3124cbf78d0aa0528c1911156a254','fb2b887dfad04606fab02a3dc285d9c6') then
        raise exception 'morning-content-exact-installed-freeze-once-runner-required';
      end if;
      if length(source_lf)-length(replace(source_lf,old_count,''))<>length(old_count) then
        raise exception 'morning-content-count-anchor-mismatch';
      end if;
      expected_lf := replace(source_lf,old_count,new_count);
    end if;
    before_meta := to_jsonb(p)-'prosrc';
    nl := case when position(chr(13)||chr(10) in raw_source)>0 then chr(13)||chr(10) else chr(10) end;
    next_raw := replace(expected_lf,chr(10),nl); definition := pg_get_functiondef(fn);
    if length(definition)-length(replace(definition,raw_source,''))<>length(raw_source) then
      raise exception 'morning-content-definition-source-anchor-mismatch';
    end if;
    next_definition := replace(definition,raw_source,next_raw); execute next_definition;
    select * into strict p from pg_catalog.pg_proc where oid=fn;
    after_meta := to_jsonb(p)-'prosrc';
    if after_meta is distinct from before_meta or p.prosrc is distinct from next_raw then
      raise exception 'morning-content-function-identity-ACL-config-readback-mismatch';
    end if;
  end loop;
  select jsonb_agg(to_jsonb(d) order by d.oid) into dependencies_after from pg_catalog.pg_proc d where d.oid=any(dependencies);
  if dependencies_after is distinct from dependencies_before then raise exception 'morning-content-dependency-changed'; end if;
  raise notice 'morning-content-installed; existing rows, ACLs and schedules unchanged';
end;
$install$;
commit;

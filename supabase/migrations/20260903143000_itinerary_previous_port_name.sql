begin;

-- Keep legacy documents readable while allowing one document-level value to
-- travel through the existing first-row JSONB/revision/lease/CAS pipeline.
create or replace function public.sd_itinerary_rows_valid(p_rows jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row jsonb;
  v_ordinal bigint;
  v_zone text;
  v_zone_key text;
  v_specific_zone text;
  v_start_zone text;
  v_distance numeric;
  v_speed numeric;
  v_sailing numeric;
  v_quantity numeric;
  v_rate numeric;
  v_operation numeric;
  v_value numeric;
  v_is_v2 boolean;
  v_notes_count integer;
  v_previous_port_count integer;
  v_base_allowed constant text[] := array[
    'rowId','sortOrder','voyageNumber','portDockName','operation','cargoQuantityText',
    'etaUtc','etbUtc','ldRateText','etcUtc','etdUtc','arrivalDraftText','departureDraftText',
    'arrivalRobText','departureRobText','portTimeZone','oceanDistanceNm','speedKnots','sailingHours',
    'berthWaitHours','tanksText','operationQuantityMt','operationRateMtPerHour','operationHours',
    'departureBufferDays','etaMode','etbMode','etcMode','etdMode'
  ];
  v_v2_allowed constant text[] := array[
    'etaTimeZone','etbTimeZone','etcTimeZone','etdTimeZone','channelSailingHours',
    'preCompletionDelayHours','postCompletionDelayHours','calculationStartUtc','calculationStartTimeZone'
  ];
  v_allowed constant text[] := array[
    'rowId','sortOrder','previousPortName','voyageNumber','portDockName','operation','cargoQuantityText',
    'etaUtc','etbUtc','ldRateText','etcUtc','etdUtc','arrivalDraftText','departureDraftText',
    'arrivalRobText','departureRobText','notesText','portTimeZone','oceanDistanceNm','speedKnots','sailingHours',
    'berthWaitHours','tanksText','operationQuantityMt','operationRateMtPerHour','operationHours',
    'departureBufferDays','etaMode','etbMode','etcMode','etdMode',
    'etaTimeZone','etbTimeZone','etcTimeZone','etdTimeZone','channelSailingHours',
    'preCompletionDelayHours','postCompletionDelayHours','calculationStartUtc','calculationStartTimeZone'
  ];
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100 then return false; end if;
  for v_row, v_ordinal in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    if jsonb_typeof(v_row) <> 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(v_row) key where not (key = any(v_allowed))) then return false; end if;
    if not (v_row ?& v_base_allowed) then return false; end if;
    v_is_v2 := v_row ?| v_v2_allowed;
    if v_is_v2 and not (v_row ?& v_v2_allowed) then return false; end if;
    v_notes_count := case when v_row ? 'notesText' then 1 else 0 end;
    v_previous_port_count := case when v_row ? 'previousPortName' then 1 else 0 end;
    if (not v_is_v2 and (select count(*) from jsonb_object_keys(v_row)) <> cardinality(v_base_allowed) + v_notes_count + v_previous_port_count)
       or (v_is_v2 and (select count(*) from jsonb_object_keys(v_row)) <> cardinality(v_base_allowed) + cardinality(v_v2_allowed) + v_notes_count + v_previous_port_count) then return false; end if;

    if jsonb_typeof(v_row->'rowId') <> 'string' or length(v_row->>'rowId') not between 1 and 100 then return false; end if;
    if jsonb_typeof(v_row->'sortOrder') <> 'number' or (v_row->>'sortOrder') !~ '^\d+$' or (v_row->>'sortOrder')::bigint <> v_ordinal - 1 then return false; end if;
    if v_row ? 'previousPortName' then
      if jsonb_typeof(v_row->'previousPortName') <> 'string' or length(v_row->>'previousPortName') > 240 then return false; end if;
      if v_ordinal > 1 and (v_row->>'previousPortName') ~ '[^[:space:]]' then return false; end if;
    end if;
    if jsonb_typeof(v_row->'voyageNumber') <> 'string' or length(v_row->>'voyageNumber') > 120 then return false; end if;
    if jsonb_typeof(v_row->'portDockName') <> 'string' or length(v_row->>'portDockName') > 300 then return false; end if;
    if jsonb_typeof(v_row->'operation') <> 'string' or not public.sd_itinerary_purpose_valid(v_row->>'operation') then return false; end if;
    if jsonb_typeof(v_row->'cargoQuantityText') <> 'string' or length(v_row->>'cargoQuantityText') > 500 then return false; end if;
    if jsonb_typeof(v_row->'ldRateText') <> 'string' or length(v_row->>'ldRateText') > 160 then return false; end if;
    if jsonb_typeof(v_row->'arrivalDraftText') <> 'string' or length(v_row->>'arrivalDraftText') > 120 then return false; end if;
    if jsonb_typeof(v_row->'departureDraftText') <> 'string' or length(v_row->>'departureDraftText') > 120 then return false; end if;
    if jsonb_typeof(v_row->'arrivalRobText') <> 'string' or length(v_row->>'arrivalRobText') > 300 then return false; end if;
    if jsonb_typeof(v_row->'departureRobText') <> 'string' or length(v_row->>'departureRobText') > 300 then return false; end if;
    if v_row ? 'notesText' and (jsonb_typeof(v_row->'notesText') <> 'string' or length(v_row->>'notesText') > 1000) then return false; end if;
    if jsonb_typeof(v_row->'tanksText') <> 'string' or length(v_row->>'tanksText') > 300 then return false; end if;
    if not public.sd_itinerary_json_instant_valid(v_row->'etaUtc')
       or not public.sd_itinerary_json_instant_valid(v_row->'etbUtc')
       or not public.sd_itinerary_json_instant_valid(v_row->'etcUtc')
       or not public.sd_itinerary_json_instant_valid(v_row->'etdUtc') then return false; end if;

    if jsonb_typeof(v_row->'portTimeZone') <> 'string' then return false; end if;
    v_zone := v_row->>'portTimeZone';
    if v_zone <> '' and not public.sd_itinerary_utc_offset_valid(v_zone)
       and not exists(select 1 from pg_catalog.pg_timezone_names where name = v_zone) then return false; end if;

    if v_is_v2 then
      foreach v_zone_key in array array['etaTimeZone','etbTimeZone','etcTimeZone','etdTimeZone'] loop
        if jsonb_typeof(v_row->v_zone_key) <> 'string' then return false; end if;
        v_specific_zone := v_row->>v_zone_key;
        if v_specific_zone <> '' and not public.sd_itinerary_utc_offset_valid(v_specific_zone)
           and not exists(select 1 from pg_catalog.pg_timezone_names where name = v_specific_zone) then return false; end if;
      end loop;
      if v_row->'etaUtc' <> 'null'::jsonb and coalesce(nullif(v_row->>'etaTimeZone',''), v_zone) = '' then return false; end if;
      if v_row->'etbUtc' <> 'null'::jsonb and coalesce(nullif(v_row->>'etbTimeZone',''), v_zone) = '' then return false; end if;
      if v_row->'etcUtc' <> 'null'::jsonb and coalesce(nullif(v_row->>'etcTimeZone',''), v_zone) = '' then return false; end if;
      if v_row->'etdUtc' <> 'null'::jsonb and coalesce(nullif(v_row->>'etdTimeZone',''), v_zone) = '' then return false; end if;
      if not public.sd_itinerary_json_instant_valid(v_row->'calculationStartUtc') or jsonb_typeof(v_row->'calculationStartTimeZone') <> 'string' then return false; end if;
      v_start_zone := v_row->>'calculationStartTimeZone';
      if v_start_zone <> '' and not public.sd_itinerary_utc_offset_valid(v_start_zone)
         and not exists(select 1 from pg_catalog.pg_timezone_names where name = v_start_zone) then return false; end if;
      if v_row->'calculationStartUtc' <> 'null'::jsonb and v_start_zone = '' then return false; end if;
      if v_ordinal > 1 and (v_row->'calculationStartUtc' <> 'null'::jsonb or v_start_zone <> '') then return false; end if;
    elsif (v_row->'etaUtc' <> 'null'::jsonb or v_row->'etbUtc' <> 'null'::jsonb or v_row->'etcUtc' <> 'null'::jsonb or v_row->'etdUtc' <> 'null'::jsonb) and v_zone = '' then
      return false;
    end if;

    foreach v_zone_key in array array['etaMode','etbMode','etcMode','etdMode'] loop
      if jsonb_typeof(v_row->v_zone_key) <> 'string' or (v_row->>v_zone_key) not in ('auto','manual') then return false; end if;
    end loop;

    if exists(select 1 from unnest(array['oceanDistanceNm','speedKnots','sailingHours','berthWaitHours','operationQuantityMt','operationRateMtPerHour','operationHours','departureBufferDays']) key
      where v_row->key <> 'null'::jsonb and jsonb_typeof(v_row->key) <> 'number') then return false; end if;
    if v_is_v2 and exists(select 1 from unnest(array['channelSailingHours','preCompletionDelayHours','postCompletionDelayHours']) key
      where v_row->key <> 'null'::jsonb and jsonb_typeof(v_row->key) <> 'number') then return false; end if;

    v_distance := nullif(v_row->>'oceanDistanceNm','')::numeric;
    v_speed := nullif(v_row->>'speedKnots','')::numeric;
    v_sailing := nullif(v_row->>'sailingHours','')::numeric;
    v_quantity := nullif(v_row->>'operationQuantityMt','')::numeric;
    v_rate := nullif(v_row->>'operationRateMtPerHour','')::numeric;
    v_operation := nullif(v_row->>'operationHours','')::numeric;
    if v_distance is not null and (v_distance < 0 or v_distance > 50000) then return false; end if;
    if v_speed is not null and (v_speed <= 0 or v_speed > 100) then return false; end if;
    if nullif(v_row->>'berthWaitHours','')::numeric not between 0 and 720 and v_row->'berthWaitHours' <> 'null'::jsonb then return false; end if;
    if v_quantity is not null and (v_quantity < 0 or v_quantity > 1000000000) then return false; end if;
    if v_rate is not null and (v_rate <= 0 or v_rate > 10000000) then return false; end if;
    if nullif(v_row->>'departureBufferDays','')::numeric not between 0 and 365 and v_row->'departureBufferDays' <> 'null'::jsonb then return false; end if;
    if v_is_v2 then
      v_value := nullif(v_row->>'channelSailingHours','')::numeric;
      if v_value is not null and (v_value < 0 or v_value > 720) then return false; end if;
      v_value := nullif(v_row->>'preCompletionDelayHours','')::numeric;
      if v_value is not null and (v_value < 0 or v_value > 8760) then return false; end if;
      v_value := nullif(v_row->>'postCompletionDelayHours','')::numeric;
      if v_value is not null and (v_value < 0 or v_value > 8760) then return false; end if;
    end if;

    if v_distance is not null and v_speed is not null then
      if v_sailing is null or abs(v_sailing - (v_distance / v_speed)) > 0.000001 then return false; end if;
    elsif v_sailing is not null then return false;
    end if;
    if v_quantity is not null and v_rate is not null then
      if v_operation is null or abs(v_operation - (v_quantity / v_rate)) > 0.000001 then return false; end if;
    elsif v_operation is not null then return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

revoke all on function public.sd_itinerary_rows_valid(jsonb) from public, anon, authenticated;
comment on function public.sd_itinerary_rows_valid(jsonb) is 'Validates legacy v1, calculation-v2, optional notesText, and first-row previousPortName itinerary payloads.';

create or replace function public.sd_itinerary_save_public(
  p_workspace_key text,
  p_vessel_id text,
  p_expected_revision bigint,
  p_operation_id uuid,
  p_rows jsonb,
  p_lease_id uuid,
  p_actor_key text,
  p_holder_session text,
  p_fencing_token bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace uuid := public.sd_itinerary_workspace_id(p_workspace_key);
begin
  if not coalesce((select ship_portal_enabled from public.sd_itinerary_rollout where workspace_id = v_workspace), false) then
    raise exception using errcode = 'P0001', message = 'portal-disabled';
  end if;
  if coalesce(p_rows->0->>'previousPortName', '') !~ '[^[:space:]]' then
    raise exception using errcode = 'P0001', message = 'previous-port-required';
  end if;
  return public.sd_itinerary_save_internal(
    p_workspace_key, p_vessel_id, p_expected_revision, p_operation_id, p_rows,
    'public', p_actor_key, null, '船端使用者', p_lease_id, p_holder_session, p_fencing_token
  );
end;
$$;

comment on function public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint) is 'Ship save boundary; requires a nonblank first-row previousPortName before revision/CAS persistence.';

commit;

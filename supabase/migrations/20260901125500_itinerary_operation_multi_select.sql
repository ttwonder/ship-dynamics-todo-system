begin;

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
  v_distance numeric;
  v_speed numeric;
  v_sailing numeric;
  v_quantity numeric;
  v_rate numeric;
  v_operation numeric;
  v_allowed constant text[] := array[
    'rowId','sortOrder','voyageNumber','portDockName','operation','cargoQuantityText',
    'etaUtc','etbUtc','ldRateText','etcUtc','etdUtc','arrivalDraftText','departureDraftText',
    'arrivalRobText','departureRobText','portTimeZone','oceanDistanceNm','speedKnots','sailingHours',
    'berthWaitHours','tanksText','operationQuantityMt','operationRateMtPerHour','operationHours',
    'departureBufferDays','etaMode','etbMode','etcMode','etdMode'
  ];
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100 then return false; end if;
  for v_row, v_ordinal in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    if jsonb_typeof(v_row) <> 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(v_row) key where not (key = any(v_allowed))) then return false; end if;
    if (select count(*) from jsonb_object_keys(v_row)) <> cardinality(v_allowed) then return false; end if;
    if jsonb_typeof(v_row->'rowId') <> 'string' or length(v_row->>'rowId') not between 1 and 100 then return false; end if;
    if jsonb_typeof(v_row->'sortOrder') <> 'number' or (v_row->>'sortOrder') !~ '^\d+$' or (v_row->>'sortOrder')::bigint <> v_ordinal - 1 then return false; end if;
    if jsonb_typeof(v_row->'voyageNumber') <> 'string' or length(v_row->>'voyageNumber') > 120 then return false; end if;
    if jsonb_typeof(v_row->'portDockName') <> 'string' or length(v_row->>'portDockName') > 300 then return false; end if;
    if jsonb_typeof(v_row->'operation') <> 'string' or (v_row->>'operation') not in ('','Loading','Unloading','To Load','To Unload','To Load / To Unload') then return false; end if;
    if jsonb_typeof(v_row->'cargoQuantityText') <> 'string' or length(v_row->>'cargoQuantityText') > 500 then return false; end if;
    if jsonb_typeof(v_row->'ldRateText') <> 'string' or length(v_row->>'ldRateText') > 160 then return false; end if;
    if jsonb_typeof(v_row->'arrivalDraftText') <> 'string' or length(v_row->>'arrivalDraftText') > 120 then return false; end if;
    if jsonb_typeof(v_row->'departureDraftText') <> 'string' or length(v_row->>'departureDraftText') > 120 then return false; end if;
    if jsonb_typeof(v_row->'arrivalRobText') <> 'string' or length(v_row->>'arrivalRobText') > 300 then return false; end if;
    if jsonb_typeof(v_row->'departureRobText') <> 'string' or length(v_row->>'departureRobText') > 300 then return false; end if;
    if jsonb_typeof(v_row->'tanksText') <> 'string' or length(v_row->>'tanksText') > 300 then return false; end if;
    if not public.sd_itinerary_json_instant_valid(v_row->'etaUtc')
       or not public.sd_itinerary_json_instant_valid(v_row->'etbUtc')
       or not public.sd_itinerary_json_instant_valid(v_row->'etcUtc')
       or not public.sd_itinerary_json_instant_valid(v_row->'etdUtc') then return false; end if;
    if jsonb_typeof(v_row->'portTimeZone') <> 'string' then return false; end if;
    v_zone := v_row->>'portTimeZone';
    if v_zone <> ''
       and not public.sd_itinerary_utc_offset_valid(v_zone)
       and not exists(select 1 from pg_catalog.pg_timezone_names where name = v_zone)
    then return false; end if;
    if (v_row->'etaUtc' <> 'null'::jsonb or v_row->'etbUtc' <> 'null'::jsonb or v_row->'etcUtc' <> 'null'::jsonb or v_row->'etdUtc' <> 'null'::jsonb) and v_zone = '' then return false; end if;
    if (v_row->>'etaMode') not in ('auto','manual') or (v_row->>'etbMode') not in ('auto','manual')
       or (v_row->>'etcMode') not in ('auto','manual') or (v_row->>'etdMode') not in ('auto','manual') then return false; end if;

    if exists(select 1 from unnest(array['oceanDistanceNm','speedKnots','sailingHours','berthWaitHours','operationQuantityMt','operationRateMtPerHour','operationHours','departureBufferDays']) key
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
    if v_distance is not null and v_speed is not null then
      if v_sailing is null or v_sailing <> ceil(v_distance / v_speed) then return false; end if;
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
comment on function public.sd_itinerary_rows_valid(jsonb) is 'Validates v1 itinerary rows, fixed UTC offsets, and backward-compatible multi-select To Load / To Unload cargo intent.';

commit;

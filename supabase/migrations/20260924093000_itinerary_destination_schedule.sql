-- Keep NEXT PORT and ETA/ETB/ETD on the same selected formal row.
-- Forward function-only delta: no document/history writes, no new grants,
-- no scheduler changes. Existing snapshots keep their saved values.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- Refuse an unknown installed definition; rerunning this exact delta is safe.
do $guard$
declare installed_hash text;
begin
  select md5(replace(p.prosrc,chr(13),'')) into installed_hash
  from pg_proc p where p.oid=to_regprocedure('public.sd_itinerary_operational_values_v1(jsonb,timestamptz)');
  if installed_hash is null or installed_hash not in (
    '102c8490bae86ec70a11e55e9c07d575',
    '6b9fc89b733809b691f5569db5d6455f'
  ) then
    raise exception 'DESTINATION_SCHEDULE_PRECONDITION_FAILED: stop; do not rerun older migrations';
  end if;
end $guard$;

create or replace function public.sd_itinerary_operational_values_v1(p_rows jsonb,p_captured_at timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
-- destination_schedule_v2
 declare rows jsonb; first_row jsonb; destination_row jsonb; next_port text; etd timestamptz;
begin
  select jsonb_agg(r.value order by
    case when coalesce(r.value->>'sortOrder','') ~ '^[0-9]+$' then (r.value->>'sortOrder')::integer else r.ordinality::integer-1 end,
    r.value->>'rowId') into rows
  from jsonb_array_elements(p_rows) with ordinality r(value,ordinality);
  first_row := rows->0;
  if first_row is null then return null; end if;
  destination_row := first_row;
  next_port := btrim(coalesce(first_row->>'portDockName',''));
  begin
    if coalesce(first_row->>'etdUtc','') ~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
      etd := (first_row->>'etdUtc')::timestamptz;
    end if;
  exception when others then etd := null;
  end;
  if isfinite(etd) and etd < p_captured_at then
    destination_row := rows->1;
    next_port := coalesce(nullif(btrim(destination_row->>'portDockName'),''),'TBA');
  end if;
  return jsonb_build_object(
    'previousPortName',btrim(coalesce(first_row->>'previousPortName','')),
    'portDockName',next_port,
    'etaUtc',nullif(btrim(coalesce(destination_row->>'etaUtc','')),''),
    'etaTimeZone',coalesce(nullif(btrim(destination_row->>'etaTimeZone'),''),nullif(btrim(destination_row->>'portTimeZone'),''),''),
    'etbUtc',nullif(btrim(coalesce(destination_row->>'etbUtc','')),''),
    'etbTimeZone',coalesce(nullif(btrim(destination_row->>'etbTimeZone'),''),nullif(btrim(destination_row->>'portTimeZone'),''),''),
    'etdUtc',nullif(btrim(coalesce(destination_row->>'etdUtc','')),''),
    'etdTimeZone',coalesce(nullif(btrim(destination_row->>'etdTimeZone'),''),nullif(btrim(destination_row->>'portTimeZone'),''),''),
    'cargoQuantityText',btrim(coalesce(first_row->>'cargoQuantityText',''))
  ) || case when first_row ? 'currentVesselState' then jsonb_build_object('currentVesselState',first_row->'currentVesselState') else '{}'::jsonb end;
end $$;

commit;

begin;

-- Forward-only delta. Keep the installed legacy validator, ACLs, documents,
-- history, leases, request signatures and CAS/save protocol unchanged.
do $install$
declare definition text;
begin
  if to_regprocedure('public.sd_itinerary_rows_pre_current_state_v1(jsonb)') is null then
    definition := pg_get_functiondef('public.sd_itinerary_rows_valid(jsonb)'::regprocedure);
    if position('sd_itinerary_rows_pre_current_state_v1' in definition) > 0 then
      raise exception 'current-state-validator-predecessor-missing';
    end if;
    execute replace(definition, 'public.sd_itinerary_rows_valid(', 'public.sd_itinerary_rows_pre_current_state_v1(');
  end if;
end $install$;
revoke all on function public.sd_itinerary_rows_pre_current_state_v1(jsonb) from public,anon,authenticated;

create or replace function public.sd_itinerary_rows_valid(p_rows jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r jsonb; state jsonb; ordinal bigint; legacy_rows jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then return false; end if;
  for r,ordinal in select value,ordinality from jsonb_array_elements(p_rows) with ordinality loop
    if r ? 'currentVesselState' then
      state := r->'currentVesselState';
      if ordinal <> 1 or jsonb_typeof(state) is distinct from 'object' then return false; end if;
      if exists(select 1 from jsonb_object_keys(state) k where k not in ('location','navigationStatus','loadStatus','statusList')) then return false; end if;
      if state ? 'location' and (jsonb_typeof(state->'location') is distinct from 'string' or length(state->>'location') > 240) then return false; end if;
      if state ? 'navigationStatus' and (jsonb_typeof(state->'navigationStatus') is distinct from 'string' or state->>'navigationStatus' not in ('航行','拋錨','進港中','出港中','停泊','漂航')) then return false; end if;
      if state ? 'loadStatus' and (jsonb_typeof(state->'loadStatus') is distinct from 'string' or state->>'loadStatus' not in ('空載','非空載','滿載')) then return false; end if;
      if state ? 'statusList' then
        if jsonb_typeof(state->'statusList') is distinct from 'array' then return false; end if;
        if exists(select 1 from jsonb_array_elements(state->'statusList') s where jsonb_typeof(s) is distinct from 'string' or s #>> '{}' not in ('loading','unloading','to load','to unload','waiting order','drydock/repiar')) then return false; end if;
        if (select count(distinct s) from jsonb_array_elements(state->'statusList') s) <> jsonb_array_length(state->'statusList') then return false; end if;
      end if;
    end if;
    legacy_rows := legacy_rows || jsonb_build_array(r - 'currentVesselState');
  end loop;
  return public.sd_itinerary_rows_pre_current_state_v1(legacy_rows) is true;
exception when others then return false;
end $$;

-- Preserve the installed alternative validator body/privileges. Even an empty
-- metadata object is forbidden on every alternative row.
do $alternatives$
declare definition text; needle text := '    v_alt_rows := v_plan -> ''rows'';';
begin
  definition := pg_get_functiondef('public.sd_itinerary_alternative_plans_valid(jsonb,jsonb)'::regprocedure);
  if position('-- current_vessel_state_alternative_v1' in definition)=0 then
    if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'current-state-alternative-predecessor-mismatch'; end if;
    execute replace(definition,needle,needle || E'\n    -- current_vessel_state_alternative_v1\n    if exists(select 1 from jsonb_array_elements(v_alt_rows) r where r ? ''currentVesselState'') then return false; end if;');
  end if;
end $alternatives$;

-- Pure captured-time projection shared by both installed scheduler builders.
-- Only NEXT PORT advances, and only to sorted formal row two. Never scan later
-- rows or alternatives; everything else stays tied to formal row one.
create or replace function public.sd_itinerary_operational_values_v1(p_rows jsonb,p_captured_at timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare rows jsonb; first_row jsonb; next_port text; etd timestamptz;
begin
  select jsonb_agg(r.value order by
    case when coalesce(r.value->>'sortOrder','') ~ '^[0-9]+$' then (r.value->>'sortOrder')::integer else r.ordinality::integer-1 end,
    r.value->>'rowId') into rows
  from jsonb_array_elements(p_rows) with ordinality r(value,ordinality);
  first_row := rows->0;
  if first_row is null then return null; end if;
  next_port := btrim(coalesce(first_row->>'portDockName',''));
  begin
    if coalesce(first_row->>'etdUtc','') ~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
      etd := (first_row->>'etdUtc')::timestamptz;
    end if;
  exception when others then etd := null;
  end;
  if isfinite(etd) and etd < p_captured_at then next_port := coalesce(nullif(btrim(rows->1->>'portDockName'),''),'TBA'); end if;
  return jsonb_build_object(
    'previousPortName',btrim(coalesce(first_row->>'previousPortName','')),
    'portDockName',next_port,
    'etaUtc',nullif(btrim(coalesce(first_row->>'etaUtc','')),''),
    'etaTimeZone',coalesce(nullif(btrim(first_row->>'etaTimeZone'),''),nullif(btrim(first_row->>'portTimeZone'),''),''),
    'etbUtc',nullif(btrim(coalesce(first_row->>'etbUtc','')),''),
    'etbTimeZone',coalesce(nullif(btrim(first_row->>'etbTimeZone'),''),nullif(btrim(first_row->>'portTimeZone'),''),''),
    'etdUtc',nullif(btrim(coalesce(first_row->>'etdUtc','')),''),
    'etdTimeZone',coalesce(nullif(btrim(first_row->>'etdTimeZone'),''),nullif(btrim(first_row->>'portTimeZone'),''),''),
    'cargoQuantityText',btrim(coalesce(first_row->>'cargoQuantityText',''))
  ) || case when first_row ? 'currentVesselState' then jsonb_build_object('currentVesselState',first_row->'currentVesselState') else '{}'::jsonb end;
end $$;
revoke all on function public.sd_itinerary_operational_values_v1(jsonb,timestamptz) from public,anon,authenticated;

-- Optional builders: do not install a scheduler that the deployment never had.
-- Replace only the values expression; retain membership, report/receipt and
-- source-authority logic, function identity/settings and existing ACLs.
do $builders$
declare signature text; fn regprocedure; definition text; start_at integer; end_at integer; suffix text; tail text;
begin
  foreach signature in array array['public.sd_build_daily_morning_snapshot(uuid,timestamptz)','public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz)'] loop
    fn := to_regprocedure(signature);
    if fn is null then continue; end if;
    definition := pg_get_functiondef(fn);
    if position('public.sd_itinerary_operational_values_v1(d.rows_payload,p_captured_at)' in definition)>0 then continue; end if;
    start_at := position('''values'',jsonb_build_object(' in definition);
    suffix := '''cargoQuantityText'',btrim(coalesce(first_row.value ->> ''cargoQuantityText'',''''))';
    end_at := position(suffix in definition);
    if start_at=0 or end_at<=start_at then raise exception 'current-state-projection-predecessor-mismatch'; end if;
    tail := substring(definition from end_at+length(suffix));
    if tail !~ '^\s*\)' then raise exception 'current-state-projection-end-mismatch'; end if;
    tail := regexp_replace(tail,'^\s*\)','','');
    execute substring(definition from 1 for start_at-1) || '''values'',public.sd_itinerary_operational_values_v1(d.rows_payload,p_captured_at)' || tail;
  end loop;
end $builders$;

-- The same server-side field boundary applies to installed authority-route
-- copies. Insert AFTER replay/lease/CAS and BEFORE writing history; the original
-- request remains the replay signature even when an old client omits metadata.
do $save_boundary$
declare signature text; fn regprocedure; definition text;
  needle text := '  v_saved_alternatives:=case when p_alternative_plans is null then v_existing_alternatives else p_alternative_plans end;';
  guard text := $guard$
  -- current_vessel_state_ship_only_v1
  if (p_rows->0) ? 'currentVesselState' then
    if p_actor_kind <> 'public' and p_rows->0->'currentVesselState' is distinct from
      (select rows_payload->0->'currentVesselState' from public.sd_itinerary_documents where workspace_id=v_workspace and vessel_id=p_vessel_id) then
      raise exception using errcode='P0001',message='current-vessel-state-ship-only';
    end if;
  elsif exists(select 1 from public.sd_itinerary_documents where workspace_id=v_workspace and vessel_id=p_vessel_id and (rows_payload->0) ? 'currentVesselState') then
    p_rows := jsonb_set(p_rows,'{0,currentVesselState}',
      (select rows_payload->0->'currentVesselState' from public.sd_itinerary_documents where workspace_id=v_workspace and vessel_id=p_vessel_id),true);
  end if;
$guard$;
begin
  foreach signature in array array[
    'public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)',
    'ship_dynamics_authority_private.itinerary_record_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)',
    'ship_dynamics_authority_private.itinerary_legacy_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)',
    'ship_dynamics_authority_private.itinerary_public_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)'
  ] loop
    fn := to_regprocedure(signature);
    if fn is null then continue; end if;
    definition := pg_get_functiondef(fn);
    if position('-- current_vessel_state_ship_only_v1' in definition)>0 then continue; end if;
    if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'current-state-save-predecessor-mismatch'; end if;
    execute replace(definition,needle,guard||needle);
  end loop;
end $save_boundary$;

commit;

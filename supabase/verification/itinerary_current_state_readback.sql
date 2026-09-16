-- Independent deployment readback: NO business data is read or changed.
-- Target: the same Supabase project used for the additive migration.
-- Migration source: 4471e32ff65d1256f0c0a086deb223a6b6e56f63
-- Stop on any error or FAIL. Do not rerun the installation automatically.
-- v2: normalize CR on BOTH sides of the multiline guard comparison.
begin transaction read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

with
fixture as (
  select $fixture$[{"rowId":"READBACK-R1","sortOrder":0,"previousPortName":"READBACK-PREVIOUS","voyageNumber":"","portDockName":"READBACK-FIRST","operation":"To Unload","cargoQuantityText":"1 MT","etaUtc":"2026-01-01T00:00:00Z","etbUtc":null,"ldRateText":"","etcUtc":null,"etdUtc":"2026-01-01T01:00:00Z","arrivalDraftText":"A:\nF:","departureDraftText":"A:\nF:","arrivalRobText":"","departureRobText":"","notesText":"","portTimeZone":"UTC+8","etaTimeZone":"","etbTimeZone":"","etcTimeZone":"","etdTimeZone":"","calculationStartUtc":"2026-01-01T00:00:00Z","calculationStartTimeZone":"UTC+8","oceanDistanceNm":null,"speedKnots":null,"sailingHours":null,"berthWaitHours":null,"channelSailingHours":null,"preCompletionDelayHours":null,"postCompletionDelayHours":null,"tanksText":"","operationQuantityMt":null,"operationRateMtPerHour":null,"operationHours":null,"departureBufferDays":null,"etaMode":"auto","etbMode":"auto","etcMode":"auto","etdMode":"auto","currentVesselState":{"location":"READBACK-AREA","navigationStatus":"航行","loadStatus":"滿載","statusList":["loading","drydock/repiar"]}},{"rowId":"READBACK-R2","sortOrder":1,"previousPortName":"","voyageNumber":"","portDockName":"READBACK-SECOND","operation":"","cargoQuantityText":"","etaUtc":null,"etbUtc":null,"ldRateText":"","etcUtc":null,"etdUtc":null,"arrivalDraftText":"A:\nF:","departureDraftText":"A:\nF:","arrivalRobText":"","departureRobText":"","notesText":"","portTimeZone":"UTC+8","etaTimeZone":"","etbTimeZone":"","etcTimeZone":"","etdTimeZone":"","calculationStartUtc":null,"calculationStartTimeZone":"","oceanDistanceNm":null,"speedKnots":null,"sailingHours":null,"berthWaitHours":null,"channelSailingHours":null,"preCompletionDelayHours":null,"postCompletionDelayHours":null,"tanksText":"","operationQuantityMt":null,"operationRateMtPerHour":null,"operationHours":null,"departureBufferDays":null,"etaMode":"auto","etbMode":"auto","etcMode":"auto","etdMode":"auto"}]$fixture$::jsonb as rows
),
expected_bodies(signature, expected_md5) as (values
  ('public.sd_itinerary_rows_valid(jsonb)', '029a21874ef2b4b2f5444a64d0ab5340'),
  ('public.sd_itinerary_operational_values_v1(jsonb,timestamptz)', '102c8490bae86ec70a11e55e9c07d575')
),
private_helpers(signature) as (values
  ('public.sd_itinerary_rows_pre_current_state_v1(jsonb)'),
  ('public.sd_itinerary_operational_values_v1(jsonb,timestamptz)')
),
save_routes(signature, required) as (values
  ('public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)', true),
  ('ship_dynamics_authority_private.itinerary_record_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)', true),
  ('ship_dynamics_authority_private.itinerary_legacy_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)', false),
  ('ship_dynamics_authority_private.itinerary_public_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)', true)
),
builders(signature) as (values
  ('public.sd_build_daily_morning_snapshot(uuid,timestamptz)'),
  ('public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz)')
),
facts(check_name, ok) as (
  select 'transaction_is_read_only', current_setting('transaction_read_only')='on'
  union all
  select 'exact_installed_body: ' || e.signature,
    p.oid is not null and md5(replace(p.prosrc,chr(13),''))=e.expected_md5
  from expected_bodies e left join pg_proc p on p.oid=to_regprocedure(e.signature)
  union all
  select 'private_helper_acl: ' || e.signature,
    p.oid is not null
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE')
  from private_helpers e left join pg_proc p on p.oid=to_regprocedure(e.signature)
  union all
  select 'alternatives_reject_current_state',
    position('-- current_vessel_state_alternative_v1' in p.prosrc)>0
    and position($needle$if exists(select 1 from jsonb_array_elements(v_alt_rows) r where r ? 'currentVesselState') then return false; end if;$needle$ in p.prosrc)>0
  from (select 1) anchor left join pg_proc p
    on p.oid=to_regprocedure('public.sd_itinerary_alternative_plans_valid(jsonb,jsonb)')
  union all
  select 'ship_only_guard: ' || e.signature,
    case when p.oid is null then not e.required else
      position(replace($expected_guard$
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
$expected_guard$,chr(13),'') in replace(p.prosrc,chr(13),''))>0 end
  from save_routes e left join pg_proc p on p.oid=to_regprocedure(e.signature)
  union all
  select 'installed_builder_projection: ' || e.signature,
    p.oid is null or position('public.sd_itinerary_operational_values_v1(d.rows_payload,p_captured_at)' in p.prosrc)>0
  from builders e left join pg_proc p on p.oid=to_regprocedure(e.signature)
  union all
  select 'valid_new_fields_accepted', public.sd_itinerary_rows_valid(f.rows) from fixture f
  union all
  select 'legacy_rows_still_accepted', public.sd_itinerary_rows_valid(f.rows #- '{0,currentVesselState}') from fixture f
  union all
  select 'explicit_clear_accepted', public.sd_itinerary_rows_valid(jsonb_set(f.rows,'{0,currentVesselState}','{"location":"","statusList":[]}'::jsonb)) from fixture f
  union all
  select 'invalid_new_enum_rejected', not public.sd_itinerary_rows_valid(jsonb_set(f.rows,'{0,currentVesselState,navigationStatus}','"INVALID-ENUM"'::jsonb)) from fixture f
  union all
  select 'nonfirst_metadata_rejected', not public.sd_itinerary_rows_valid(jsonb_set(f.rows,'{1,currentVesselState}','{}'::jsonb)) from fixture f
  union all
  select 'strict_past_uses_second', public.sd_itinerary_operational_values_v1(f.rows,'2026-01-01T09:00:00.001+08:00'::timestamptz)->>'portDockName'='READBACK-SECOND' from fixture f
  union all
  select 'equal_etd_keeps_first', public.sd_itinerary_operational_values_v1(f.rows,'2026-01-01T09:00:00+08:00'::timestamptz)->>'portDockName'='READBACK-FIRST' from fixture f
  union all
  select 'future_etd_keeps_first', public.sd_itinerary_operational_values_v1(f.rows,'2026-01-01T08:59:59+08:00'::timestamptz)->>'portDockName'='READBACK-FIRST' from fixture f
  union all
  select 'absent_second_is_TBA', public.sd_itinerary_operational_values_v1(jsonb_build_array(f.rows->0),'2026-01-01T09:00:01+08:00'::timestamptz)->>'portDockName'='TBA' from fixture f
  union all
  select 'blank_second_never_skips_to_third', public.sd_itinerary_operational_values_v1(jsonb_set(f.rows,'{1,portDockName}','" "'::jsonb)||jsonb_build_array(jsonb_build_object('rowId','READBACK-R3','sortOrder',2,'portDockName','NEVER-THIRD')),'2026-01-01T09:00:01+08:00'::timestamptz)->>'portDockName'='TBA' from fixture f
  union all
  select 'invalid_etd_keeps_first', public.sd_itinerary_operational_values_v1(jsonb_set(f.rows,'{0,etdUtc}','"INVALID-DATE"'::jsonb),'2026-01-01T09:00:01+08:00'::timestamptz)->>'portDockName'='READBACK-FIRST' from fixture f
  union all
  select 'other_fields_and_state_stay_first',
    p.value->>'previousPortName'='READBACK-PREVIOUS'
    and p.value->>'cargoQuantityText'='1 MT'
    and p.value->>'etdUtc'='2026-01-01T01:00:00Z'
    and p.value->'currentVesselState'=f.rows->0->'currentVesselState'
  from fixture f cross join lateral (select public.sd_itinerary_operational_values_v1(f.rows,'2026-01-01T09:00:01+08:00'::timestamptz) as value) p
)
select case when bool_and(coalesce(ok,false)) then 'PASS' else 'FAIL' end as overall,
  count(*) as check_count,
  count(*) filter (where ok is not true) as failed_count,
  coalesce(jsonb_agg(check_name order by check_name) filter (where ok is not true),'[]'::jsonb) as failed_checks,
  'current-state-readback-v2' as readback_id,
  position(chr(13) in $copy_format$
$copy_format$)>0 as copied_sql_contains_cr,
  to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as checked_at_utc
from facts;
commit;

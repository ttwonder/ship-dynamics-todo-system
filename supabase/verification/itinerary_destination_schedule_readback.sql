-- Read-only verification: no business rows, secrets or source payload returned.
begin read only;
set local statement_timeout = '15s';
with helper as (
  select p.* from pg_proc p
  where p.oid=to_regprocedure('public.sd_itinerary_operational_values_v1(jsonb,timestamptz)')
), checks as (
  select 'helper_installed' as name, exists(select 1 from helper) as ok
  union all select 'exact_helper_body', coalesce((select md5(replace(prosrc,chr(13),''))='6b9fc89b733809b691f5569db5d6455f' from helper),false)
  union all select 'stable_invoker', coalesce((select provolatile='s' and not prosecdef from helper),false)
  union all select 'fixed_search_path', coalesce((select 'search_path=pg_catalog, public'=any(proconfig) from helper),false)
  union all select 'anon_cannot_execute', coalesce((select not has_function_privilege('anon',oid,'EXECUTE') from helper),false)
  union all select 'authenticated_cannot_execute', coalesce((select not has_function_privilege('authenticated',oid,'EXECUTE') from helper),false)
  union all select 'record_builder_uses_helper', exists(select 1 from pg_proc where oid=to_regprocedure('public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz)') and position('sd_itinerary_operational_values_v1' in prosrc)>0)
  union all select 'legacy_builder_uses_helper', exists(select 1 from pg_proc where oid=to_regprocedure('public.sd_build_daily_morning_snapshot(uuid,timestamptz)') and position('sd_itinerary_operational_values_v1' in prosrc)>0)
)
select case when bool_and(coalesce(ok,false)) then 'PASS' else 'FAIL' end as overall,
  count(*) as checks,
  coalesce(jsonb_agg(name order by name) filter(where not coalesce(ok,false)),'[]'::jsonb) as failed
from checks;
commit;

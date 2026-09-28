-- Read-only catalog verification AFTER 20260928140000_tracking_annual_types.sql.
-- No business rows, credentials, leases, or writes are read or changed.
begin read only;
with expected(signature,body_hash) as (values
 ('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)','a5bb55bcad314a7a049997e8957ef303'),
 ('public.read_ship_dynamics_tracking_statistics_public_v2(text,jsonb,jsonb)','5899b3d72fac5f013cefca5acf3c6563'),
 ('public.read_ship_dynamics_tracking_statistics_public_v1(text,jsonb,jsonb)','132373bc016ed5b5502f746220fc9d04')
), checks as (
 select 'exact-installed-functions-and-preserved-v1' name,not exists(
  select 1 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
  where p.oid is null or md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))<>e.body_hash) ok
 union all select 'v2-security-and-signature',coalesce((select prosecdef and provolatile='v'
  and prorettype='jsonb'::regtype and proargnames=array['p_workspace_key','p_scope','p_query']::text[]
  and prolang=(select oid from pg_language where lanname='plpgsql')
  and proconfig=array['search_path=pg_catalog, public']::text[] from pg_proc
  where oid=to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v2(text,jsonb,jsonb)')),false)
 union all select 'v2-browser-execute-only',coalesce((select
  has_function_privilege('anon',oid,'EXECUTE') and has_function_privilege('authenticated',oid,'EXECUTE')
  and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) x
   where x.privilege_type='EXECUTE' and x.grantee not in (proowner,'anon'::regrole,'authenticated'::regrole))
  from pg_proc where oid=to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v2(text,jsonb,jsonb)')),false)
 union all select 'validator-private-stable-invoker',coalesce((select not prosecdef and provolatile='s'
  and proconfig=array['search_path=pg_catalog, public']::text[]
  and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE')
  from pg_proc where oid=to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)')),false)
 union all select 'raw-authority-tables-remain-private',not exists(
  select 1 from (values('public.ship_dynamics_records'),('public.ship_dynamics_record_collections'),('public.ship_dynamics_record_workspaces')) t(table_name)
  cross join (values('anon'),('authenticated')) r(role_name)
  where to_regclass(t.table_name) is null or has_table_privilege(r.role_name,to_regclass(t.table_name),'SELECT,INSERT,UPDATE,DELETE'))
 union all select 'existing-prerequisites-present',
  to_regprocedure('ship_dynamics_internal_control_private.admit_v1(text)') is not null
  and to_regprocedure('public.ship_dynamics_tracking_date_v1(text)') is not null
  and to_regprocedure('public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb)') is not null
)
select case when bool_and(coalesce(ok,false)) then 'PASS' else 'FAIL' end status,
 count(*) checks,coalesce(jsonb_agg(name order by name) filter(where not coalesce(ok,false)),'[]'::jsonb) failures
from checks;
commit;

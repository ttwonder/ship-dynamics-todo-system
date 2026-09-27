-- Catalog-only verification; no business data, credentials, locks or writes.
-- Run separately AFTER 20260927130000_tracking_fleet_statistics.sql.
begin read only;
with rpc as (
 select p.* from pg_proc p
 where p.oid=to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v1(text,jsonb,jsonb)')
), checks as (
 select 'exact-signature-and-language' name,coalesce((select
  prorettype='jsonb'::regtype and provolatile='v'
  and proargnames=array['p_workspace_key','p_scope','p_query']::text[]
  and prolang=(select oid from pg_language where lanname='plpgsql') from rpc),false) ok
 union all select 'exact-installed-function-body',coalesce((select
  md5(replace(prosrc,chr(13)||chr(10),chr(10)))='132373bc016ed5b5502f746220fc9d04' from rpc),false)
 union all select 'security-definer-search-path',coalesce((select
  prosecdef and proconfig=array['search_path=pg_catalog, public']::text[] from rpc),false)
 union all select 'explicit-browser-execute-only',exists(select 1 from rpc) and not exists(
  select 1 from rpc p where not has_function_privilege('anon',p.oid,'EXECUTE')
  or not has_function_privilege('authenticated',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE'))
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
 count(*) checks,
 coalesce(jsonb_agg(name order by name) filter(where not coalesce(ok,false)),'[]'::jsonb) failures
from checks;
commit;

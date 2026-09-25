-- Catalog-only verification of the dedicated ship tracking portal.
-- No business writes, lock claims, credentials or business payloads.
-- Run separately AFTER 20260925160000_tracking_field_revision.sql.
begin read only;
with public_rpc as (
 select p.* from pg_proc p
 where p.oid=to_regprocedure('public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb)')
), private_functions as (
 select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='ship_dynamics_tracking_private'
), definitions as (
 select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' identity,
        -- Preserve all definition content/settings except Windows CRLF pairs.
        replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)) definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.oid in (select oid from public_rpc union all select oid from private_functions union all select to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)'))
), checks as (
 select 'public-rpc-security' name,coalesce((select prosecdef and 'search_path=pg_catalog, public'=any(proconfig) from public_rpc),false) ok
 union all select 'exact-installed-definitions',
  (select md5(string_agg(identity||E'\n'||definition,E'\n' order by identity)) from definitions)='20d59c0b92e3045be6d3122d3bca6e4e'
 union all select 'public-rpc-only-explicit-browser-roles',
  exists(select 1 from public_rpc) and not exists(select 1 from public_rpc p where
   not has_function_privilege('anon',p.oid,'EXECUTE') or not has_function_privilege('authenticated',p.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE'))
 union all select 'private-schema-inaccessible',
  exists(select 1 from pg_namespace where nspname='ship_dynamics_tracking_private') and not exists(
   select 1 from pg_namespace n cross join (values('anon'),('authenticated'),('service_role')) r(role_name)
   where n.nspname='ship_dynamics_tracking_private' and has_schema_privilege(r.role_name,n.oid,'USAGE,CREATE'))
 union all select 'private-functions-inaccessible',
  exists(select 1 from private_functions) and not exists(
   select 1 from private_functions p cross join (values('anon'),('authenticated'),('service_role')) r(role_name)
   where has_function_privilege(r.role_name,p.oid,'EXECUTE'))
 union all select 'private-bundles-inaccessible',
  to_regclass('ship_dynamics_tracking_private.bundles') is not null and not exists(
   select 1 from (values('anon'),('authenticated'),('service_role')) r(role_name)
   where has_table_privilege(r.role_name,to_regclass('ship_dynamics_tracking_private.bundles'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 union all select 'shared-authority-tables-remain-private',
  to_regclass('public.ship_dynamics_records') is not null and not exists(
   select 1 from (values('anon'),('authenticated')) r(role_name)
   where has_table_privilege(r.role_name,to_regclass('public.ship_dynamics_records'),'SELECT,INSERT,UPDATE,DELETE'))
 union all select 'shared-validators-remain-private',
  to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)') is not null and not exists(
   select 1 from (values('anon'),('authenticated')) r(role_name)
   where has_function_privilege(r.role_name,to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)'),'EXECUTE'))
)
select case when bool_and(coalesce(ok,false)) then 'PASS' else 'FAIL' end status,
 count(*) checks,
 coalesce(jsonb_agg(name order by name) filter(where not coalesce(ok,false)),'[]'::jsonb) failures
from checks;
commit;

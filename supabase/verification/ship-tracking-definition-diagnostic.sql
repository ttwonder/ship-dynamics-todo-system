-- Diagnostic only: catalog metadata/hashes, never business rows or function bodies.
-- Baseline: 55a1a00c0c08e76f2122d951998e2d621b5bdf0e.
-- Does not replace the release readback or authorize Push.
-- Run in a NEW SQL Editor query; do not rerun the installation.
begin isolation level repeatable read read only;
set local statement_timeout='8s';
set local lock_timeout='2s';
with public_rpc as (
 select p.* from pg_proc p
 where p.oid=to_regprocedure('public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb)')
), private_functions as (
 select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='ship_dynamics_tracking_private'
), definitions as (
 select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' identity,
        pg_get_functiondef(p.oid) definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.oid in (select oid from public_rpc union all select oid from private_functions)
), checks as (
 select 'public-rpc-security' name,coalesce((select prosecdef and 'search_path=pg_catalog, public'=any(proconfig) from public_rpc),false) ok
 union all select 'exact-installed-definitions',
  (select md5(string_agg(identity||E'\n'||definition,E'\n' order by identity)) from definitions)='faf1ff0690a342d88ddcda0e45d67aab'
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
), facts as (
 select count(*) definition_count,
  coalesce(sum(length(definition)-length(replace(definition,chr(13),''))),0) carriage_returns,
  coalesce(sum(length(definition)-length(replace(definition,chr(10),''))),0) line_feeds,
  md5(string_agg(identity||chr(10)||definition,chr(10) order by identity)) raw_fingerprint,
  md5(string_agg(replace(identity||chr(10)||definition,chr(13)||chr(10),chr(10)),chr(10) order by identity)) crlf_normalized_fingerprint,
  coalesce(jsonb_agg(jsonb_build_object('function',identity,'raw_md5',md5(definition),
   'crlf_normalized_md5',md5(replace(definition,chr(13)||chr(10),chr(10)))) order by identity),'[]'::jsonb) function_hashes
 from definitions
), summary as (
 select count(*) checks,
  bool_and(coalesce(ok,false)) filter(where name<>'exact-installed-definitions') other_checks_ok,
  coalesce(jsonb_agg(name order by name) filter(where not coalesce(ok,false)),'[]'::jsonb) failures
 from checks
)
select 'DIAGNOSTIC_ONLY' status,
 case when not coalesce(s.other_checks_ok,false) then 'PREREQUISITE_OR_ACL_DIFF'
      when f.raw_fingerprint='faf1ff0690a342d88ddcda0e45d67aab' then 'EXACT_MATCH'
      when f.crlf_normalized_fingerprint='faf1ff0690a342d88ddcda0e45d67aab' then 'CRLF_ONLY_DIFFERENCE'
      else 'DEFINITION_DIFFERENCE' end diagnosis,
 s.checks,s.failures,f.definition_count,f.carriage_returns,
 current_setting('server_version') server_version,
 jsonb_build_object('expected_fingerprint','faf1ff0690a342d88ddcda0e45d67aab','raw_fingerprint',f.raw_fingerprint,
  'crlf_normalized_fingerprint',f.crlf_normalized_fingerprint,'line_feeds',f.line_feeds,
  'function_hashes',f.function_hashes) details
from facts f cross join summary s;
commit;

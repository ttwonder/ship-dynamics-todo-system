-- Read-only deployment check for the single-vessel history query.
-- Run separately AFTER 20260923160000_itinerary_vessel_history.sql.
-- Metadata only: no business payload, credentials, writes, or save operations.
begin transaction read only;
set local statement_timeout='15s';
with target as (
 select p.oid,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl,p.proowner
 from (values('public.sd_itinerary_record_report_vessel_history_v1(text,text,text,integer,date,bigint)')) v(signature)
 left join pg_catalog.pg_proc p on p.oid=to_regprocedure(v.signature)
), checks as (
 select 'function-exists' id,oid is not null ok from target
 union all select 'single-overload',count(*)=1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sd_itinerary_record_report_vessel_history_v1'
 union all select 'exact-function-body',coalesce(md5(regexp_replace(prosrc,'\s','','g'))='185bb3c0782a65d2274a3da5bda98c07',false) from target
 union all select 'security-definer',coalesce(prosecdef,false) from target
 union all select 'stable-read-only',coalesce(provolatile='s',false) from target
 union all select 'pinned-search-path',coalesce(proconfig @> array['search_path=pg_catalog, public, pg_temp'],false) from target
 union all select 'execute-'||r.role,coalesce(has_function_privilege(r.role,t.oid,'EXECUTE'),false) from target t cross join (values('anon'),('authenticated')) r(role)
 union all select 'no-public-execute',oid is not null and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') from target
 union all select 'record-actor-helper',to_regprocedure('public.sd_itinerary_record_actor_v1(text,text)') is not null
 union all select 'existing-fleet-list',to_regprocedure('public.sd_itinerary_record_report_list_v1(text,text,integer,integer)') is not null
 union all select 'existing-fleet-load',to_regprocedure('public.sd_itinerary_record_report_load_v1(text,bigint,text)') is not null
)
select case when bool_and(ok) then 'PASS' else 'FAIL' end result,count(*) checks,
 coalesce(jsonb_agg(id order by id) filter(where not ok),'[]'::jsonb) failed_checks,
 jsonb_object_agg(id,case when ok then 'PASS' else 'FAIL' end order by id) details
from checks;
commit;

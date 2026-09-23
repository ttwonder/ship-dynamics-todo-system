-- Read-only deployment check: optional ship DL. No business payload or credentials.
-- Execute separately AFTER the due-date migration. PASS does not prove a browser deployment.
begin transaction read only;
set local statement_timeout='15s';
with functions as (
 select v.id,v.signature,v.expected_md5,p.oid,p.prosrc,p.prosecdef,p.proconfig
 from (values
 ('request','ship_dynamics_internal_control_private.request_v1(text,text,uuid,uuid,jsonb)','4ebf73b41420b6b8ae471ef4db69bca9'),
 ('submit','public.submit_ship_dynamics_internal_control_public_v1(text,text,uuid,uuid,jsonb)','417d9779236d4deeb7db8cbafd1388d2')
 ) v(id,signature,expected_md5)
 left join pg_catalog.pg_proc p on p.oid=to_regprocedure(v.signature)
), checks as (
 select id||'-exists' id,oid is not null ok from functions
 union all select id||'-body',coalesce(md5(regexp_replace(prosrc,'\s','','g'))=expected_md5,false) from functions
 union all select id||'-security',coalesce(prosecdef=(id='submit'),false) from functions
 union all select id||'-search-path',coalesce(proconfig @> array[case when id='submit' then 'search_path=pg_catalog, public' else 'search_path=pg_catalog' end],false) from functions
 union all select 'private-execute-'||r.role,coalesce(not has_function_privilege(r.role,f.oid,'EXECUTE'),false) from functions f cross join (values('anon'),('authenticated'),('service_role')) r(role) where f.id='request'
 union all select 'public-submit-'||r.role,coalesce(has_function_privilege(r.role,f.oid,'EXECUTE'),false) from functions f cross join (values('anon'),('authenticated')) r(role) where f.id='submit'
 union all select 'receipt-endpoint',to_regprocedure('public.get_ship_dynamics_internal_control_public_receipt_v1(text,text,uuid,uuid,jsonb)') is not null
)
select case when bool_and(ok) then 'PASS' else 'FAIL' end result,count(*) checks,
 coalesce(jsonb_agg(id order by id) filter(where not ok),'[]'::jsonb) failed_checks,
 jsonb_object_agg(id,case when ok then 'PASS' else 'FAIL' end order by id) details
from checks;
commit;

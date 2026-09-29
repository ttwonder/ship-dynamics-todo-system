-- Read-only verification. No business data, credential values or mutations.
with checks as (
 select 'private-delivery-close-body' name, exists(select 1 from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.delivery_close_v1(jsonb,jsonb,text)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='58ad17bc8975696fd9c4a69cdde1186f' and not prosecdef and proconfig=array['search_path=pg_catalog, public']) ok
 union all select 'private-plan-with-notes-and-close', exists(select 1 from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='2fe7afd74cfca4db61d0862c85913b00' and not prosecdef and proconfig=array['search_path=pg_catalog, public'])
 union all select 'canonical-source-and-linked-validator', exists(select 1 from pg_proc where oid=to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='113ddde1e9a055357fcb055222660de2' and not prosecdef and proconfig=array['search_path=pg_catalog, public'])
 union all select 'private-schema-not-anonymous', not has_schema_privilege('anon','ship_dynamics_tracking_private','usage')
 union all select 'private-schema-not-authenticated', not has_schema_privilege('authenticated','ship_dynamics_tracking_private','usage')
 union all select 'original-public-endpoint', has_function_privilege('anon','public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb)','execute')
)
select case when bool_and(ok) then 'PASS' else 'FAIL' end status,count(*) checks,
 coalesce(jsonb_agg(name order by name) filter(where not coalesce(ok,false)),'[]') failures from checks;

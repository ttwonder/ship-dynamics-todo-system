-- Read-only verification. No business data, credential values or mutations.
with checks as (
 select 'private-completion-close-body' name, exists(select 1 from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.completion_close_v1(jsonb,jsonb,text)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='9fca66c78f3afa6f67ea2c04fa85f840' and not prosecdef and proconfig=array['search_path=pg_catalog, public']) ok
 union all select 'private-plan-completion-and-delivery-close', exists(select 1 from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='c376d67a691c42284730748a18e3a0eb' and not prosecdef and proconfig=array['search_path=pg_catalog, public'])
 union all select 'canonical-source-and-linked-validator', exists(select 1 from pg_proc where oid=to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='d9b9d62989b03359d2092562807ed3b0' and not prosecdef and proconfig=array['search_path=pg_catalog, public'])
 union all select 'completion-helper-not-public', not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=to_regprocedure('ship_dynamics_tracking_private.completion_close_v1(jsonb,jsonb,text)') and a.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated')) and a.privilege_type='EXECUTE')
 union all select 'private-schema-not-anonymous', not has_schema_privilege('anon','ship_dynamics_tracking_private','usage')
 union all select 'private-schema-not-authenticated', not has_schema_privilege('authenticated','ship_dynamics_tracking_private','usage')
 union all select 'original-public-endpoint', has_function_privilege('anon','public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb)','execute')
)
select case when bool_and(ok) then 'PASS' else 'FAIL' end status,count(*) checks,
 coalesce(jsonb_agg(name order by name) filter(where not coalesce(ok,false)),'[]') failures from checks;

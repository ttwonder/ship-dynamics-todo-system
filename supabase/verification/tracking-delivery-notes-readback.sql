-- Read-only verification; contains no business rows or credentials.
with checks as (
 select 'private-plan-body' name, exists(select 1 from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='edecbd070391e7f435c1b6a9c0561d55' and not prosecdef and proconfig=array['search_path=pg_catalog, public']) ok
 union all select 'private-plan-not-anonymous', not has_schema_privilege('anon','ship_dynamics_tracking_private','usage')
 union all select 'private-plan-not-authenticated', not has_schema_privilege('authenticated','ship_dynamics_tracking_private','usage')
 union all select 'original-public-endpoint', has_function_privilege('anon','public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb)','execute')
)
select case when bool_and(ok) then 'PASS' else 'FAIL' end status,count(*) checks,
 coalesce(jsonb_agg(name order by name) filter(where not coalesce(ok,false)),'[]') failures from checks;

-- Independent catalog-only readback. No writes, lock claims or business payloads.
WITH rpc AS (
 SELECT p.prosecdef,p.proconfig,lower(pg_get_functiondef(p.oid)) AS definition
 FROM pg_proc p
 WHERE p.oid=to_regprocedure('public.claim_ship_dynamics_edit_lock(text,text,text,text,integer)')
), checks AS (
 SELECT 'rpc-present' AS name,EXISTS(SELECT 1 FROM rpc) AS ok
 UNION ALL SELECT 'version-marker',coalesce((SELECT definition LIKE '%edit-lock-holder-v1%' FROM rpc),false)
 UNION ALL SELECT 'parent-child-name',coalesce((SELECT definition LIKE '%''parent-child-lock-conflict''%''locked_by_name'',e.locked_by_name%' FROM rpc),false)
 UNION ALL SELECT 'same-key-name',coalesce((SELECT definition LIKE '%''lock-conflict''%''locked_by_name'',e.locked_by_name%' FROM rpc),false)
 UNION ALL SELECT 'hierarchy-and-fencing',coalesce((SELECT definition LIKE '%ship_dynamics_task_lease_gate_v1%' AND definition LIKE '%ship_dynamics_member_fence_seq%' FROM rpc),false)
 UNION ALL SELECT 'ttl-and-security',coalesce((SELECT definition LIKE '%least(greatest(p_ttl_seconds,30),120)%' AND prosecdef AND 'search_path=pg_catalog, public'=ANY(proconfig) FROM rpc),false)
)
SELECT CASE WHEN bool_and(ok) THEN 'PASS' ELSE 'FAIL' END AS status,
 count(*) AS checks,
 coalesce(jsonb_agg(name ORDER BY name) FILTER(WHERE NOT ok),'[]'::jsonb) AS failures
FROM checks;

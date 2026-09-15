-- Independent READ ONLY check; never invokes watermark or sorts history.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SELECT jsonb_build_object(
 'kind','ship-watermark-repair-readback-v1',
 'function_present',p.oid IS NOT NULL,
 'body_matches',coalesce(encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='ceca3c40bef08143552d168b3df5cdd947903eabee75841f1458dbfb692f95a7',false),
 'body_sha256',encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex'),
 'security_definer',p.prosecdef,
 'argument_names_match',p.proargnames=ARRAY['p_workspace','p_id']::text[],
 'search_path',ARRAY(SELECT s FROM unnest(coalesce(p.proconfig,'{}'::text[])) s WHERE s LIKE 'search_path=%'),
 'browser_execute',has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'),
 'service_role_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
 'controls_empty',(NOT EXISTS(SELECT FROM ship_dynamics_authority_private.current_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_authority_private.forward_row_context_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_authority_private.forward_stages_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_authority_private.receipts_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_quiescence_private.stage_context_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_quiescence_private.stages_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_quiescence_private.transitions) AND
 NOT EXISTS(SELECT FROM ship_dynamics_quiescence_private.workspaces)),
 'legacy_frozen',(SELECT writes_frozen FROM public.sd_legacy_write_controls WHERE workspace_key='ship-dynamics-main'),
 'legacy',(SELECT jsonb_build_object('revision',revision,'hash',public.sd_legacy_jsonb_sha256(payload)) FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main'),
 'production_write',false,
 'next','VERIFY_RESULT_BEFORE_RETRY_08'
) AS watermark_readback
FROM (SELECT to_regprocedure('ship_dynamics_quiescence_private.watermark_v1(text,uuid)') oid) wanted
LEFT JOIN pg_proc p ON p.oid=wanted.oid;
ROLLBACK;

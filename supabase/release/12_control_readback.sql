-- Independent READ ONLY operator state. No payload, credential or backup data.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT jsonb_build_object(
 'kind','ship-release-control-readback-v1','workspace','ship-dynamics-main',
 'authority',(SELECT to_jsonb(c) FROM ship_dynamics_authority_private.current_v1 c WHERE workspace_key='ship-dynamics-main'),
 'pause',(SELECT jsonb_build_object('transition_id',x.transition_id,'state',t.state) FROM ship_dynamics_quiescence_private.workspaces x JOIN ship_dynamics_quiescence_private.transitions t USING(workspace_key,transition_id) WHERE workspace_key='ship-dynamics-main'),
 'freeze',(SELECT to_jsonb(f) FROM public.sd_legacy_write_controls f WHERE workspace_key='ship-dynamics-main'),
 'legacy',(SELECT jsonb_build_object('revision',revision,'hash',public.sd_legacy_jsonb_sha256(payload)) FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main'),
 'records',(SELECT jsonb_build_object('revision',revision,'hash',public.sd_legacy_jsonb_sha256(public.read_ship_dynamics_records_v1(workspace_key)->'payload')) FROM public.ship_dynamics_record_workspaces WHERE workspace_key='ship-dynamics-main'),
 'forward_stage',(SELECT jsonb_build_object('request_id',s.request_id,'result',s.result) FROM ship_dynamics_authority_private.forward_stages_v1 s JOIN ship_dynamics_quiescence_private.workspaces x USING(workspace_key,transition_id) WHERE s.workspace_key='ship-dynamics-main'),
 'reverse_stage',(SELECT jsonb_build_object('request_id',s.request_id,'result',s.result) FROM ship_dynamics_quiescence_private.stages_v1 s JOIN ship_dynamics_quiescence_private.workspaces x USING(workspace_key,transition_id) WHERE s.workspace_key='ship-dynamics-main'),
 'browser',public.read_ship_dynamics_browser_authority_v1('ship-dynamics-main'),
 'production_write',false
) AS control_readback;
ROLLBACK;

-- MANUAL OPERATOR STEP. Target ship-dynamics-main. NOT A BACKUP RESTORE.
-- Run only this step when requested. ERROR/unknown result: STOP, then 12 readback.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE release_step_result(result jsonb) ON COMMIT DROP;
DO $release_step$
DECLARE w constant text:='ship-dynamics-main';wid uuid; q record; f record; l record;
 r jsonb; h text; source_hash text; sid uuid; proof jsonb; op uuid:=gen_random_uuid(); actor name:=current_user;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolbypassrls) THEN RAISE EXCEPTION 'release-admin-required';END IF;
 SELECT id INTO STRICT wid FROM public.sd_workspaces WHERE legacy_key=w;

 SELECT * INTO STRICT f FROM public.sd_legacy_write_controls WHERE workspace_key=w;
 IF NOT f.writes_frozen OR f.restore_in_progress THEN RAISE EXCEPTION 'release-frozen-source-required';END IF;
 SELECT * INTO STRICT l FROM public.ship_dynamics_app_state WHERE workspace_key=w;

 IF EXISTS(SELECT FROM ship_dynamics_quiescence_private.workspaces x JOIN ship_dynamics_quiescence_private.transitions t USING(workspace_key,transition_id) WHERE x.workspace_key=w AND t.state='paused') THEN RAISE EXCEPTION 'release-already-paused-use-readback';END IF;
 SET LOCAL ROLE service_role;
 r:=public.pause_ship_dynamics_business_v1(w,op);

 EXECUTE format('SET LOCAL ROLE %I',actor);
 INSERT INTO pg_temp.release_step_result VALUES(r);
END $release_step$;
SELECT result AS control_receipt FROM pg_temp.release_step_result;
COMMIT;

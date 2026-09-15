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

 SELECT x.transition_id,t.watermark,t.state INTO STRICT q FROM ship_dynamics_quiescence_private.workspaces x
 JOIN ship_dynamics_quiescence_private.transitions t USING(workspace_key,transition_id)
 WHERE x.workspace_key=w AND x.workspace_id=wid;
 IF q.state<>'paused' THEN RAISE EXCEPTION 'release-exact-pause-required';END IF;

 IF NOT EXISTS(SELECT FROM ship_dynamics_authority_private.current_v1 WHERE workspace_key=w AND source='records-v1' AND phase='resumed') THEN RAISE EXCEPTION 'release-record-authority-required';END IF;
 IF EXISTS(SELECT FROM ship_dynamics_quiescence_private.stages_v1 WHERE workspace_key=w AND transition_id=q.transition_id) THEN RAISE EXCEPTION 'release-reverse-already-staged-use-readback';END IF;
 proof:=public.read_ship_dynamics_records_v1(w);
 IF proof->>'status' IS DISTINCT FROM 'snapshot' THEN RAISE EXCEPTION 'release-current-records-required';END IF;
 h:=public.sd_legacy_jsonb_sha256(l.payload);
 source_hash:=public.sd_legacy_jsonb_sha256(proof->'payload');
 SET LOCAL ROLE service_role;
 r:=public.stage_ship_dynamics_paused_records_to_legacy_v1(w,wid,q.transition_id,q.watermark,(proof->>'revision')::integer,source_hash,l.revision,h,f.frozen_at,op);

 EXECUTE format('SET LOCAL ROLE %I',actor);
 INSERT INTO pg_temp.release_step_result VALUES(r);
END $release_step$;
SELECT result AS control_receipt FROM pg_temp.release_step_result;
COMMIT;

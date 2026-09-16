-- MANUAL OPERATOR STEP. Target ship-dynamics-main. NOT A BACKUP RESTORE.
-- Run only this step when requested. ERROR/unknown result: STOP, then 12 readback.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='8min';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE release_step_result(result jsonb) ON COMMIT DROP;
DO $release_step$
DECLARE w constant text:='ship-dynamics-main';wid uuid; q record; f record; l record;
 r jsonb; h text; source_hash text; sid uuid; proof jsonb; op uuid:=gen_random_uuid(); actor name:=current_user;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolbypassrls) THEN RAISE EXCEPTION 'release-admin-required';END IF;
 SELECT id INTO STRICT wid FROM public.sd_workspaces WHERE legacy_key=w;

 SELECT x.transition_id,t.watermark,t.state INTO STRICT q FROM ship_dynamics_quiescence_private.workspaces x
 JOIN ship_dynamics_quiescence_private.transitions t USING(workspace_key,transition_id)
 WHERE x.workspace_key=w AND x.workspace_id=wid;
 IF q.state<>'paused' THEN RAISE EXCEPTION 'release-exact-pause-required';END IF;

 SELECT publication_id INTO STRICT sid FROM ship_dynamics_authority_private.current_v1
 WHERE workspace_key=w AND workspace_id=wid AND transition_id=q.transition_id AND phase='published-paused';
 SELECT s.result INTO STRICT proof FROM ship_dynamics_authority_private.receipts_v1 s WHERE s.request_id=sid AND s.action='publish-v2' AND s.actor=session_user;
 SET LOCAL ROLE service_role;
 r:=public.resume_ship_dynamics_source_authority_v2(w,wid,q.transition_id,sid,proof,op);

 EXECUTE format('SET LOCAL ROLE %I',actor);
 INSERT INTO pg_temp.release_step_result VALUES(r);
END $release_step$;
SELECT result AS control_receipt FROM pg_temp.release_step_result;
COMMIT;

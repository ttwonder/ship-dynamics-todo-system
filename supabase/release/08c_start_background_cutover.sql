-- MANUAL START: Supabase project cyzpcvvhmoiihsqvjspp / ship-dynamics-main.
-- One launch chains 08 pause -> 09 stage -> 10 publish PAUSED. Does NOT resume writes.
-- Preserves existing data/hash checks. No backup restore, no Push, no credential changes.
-- Each cloud job claims once; a failed/interrupted phase never reruns business work.
-- After queue acknowledgement, closing SQL Editor or losing browser network does not cancel the cloud worker.
-- Do not run 08/09/10 manually while these jobs are active.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
DO $preflight$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolbypassrls) THEN RAISE EXCEPTION 'release-admin-required';END IF;
 IF current_database()<>'postgres' THEN RAISE EXCEPTION 'release-postgres-database-required';END IF;
 IF to_regprocedure('cron.schedule(text,text,text)') IS NULL OR to_regprocedure('cron.unschedule(text)') IS NULL THEN RAISE EXCEPTION 'release-existing-pg-cron-required';END IF;
 IF NOT EXISTS(SELECT FROM public.sd_legacy_write_controls WHERE workspace_key='ship-dynamics-main' AND writes_frozen AND NOT restore_in_progress) THEN RAISE EXCEPTION 'release-frozen-source-required';END IF;
 IF EXISTS(SELECT FROM cron.job WHERE jobname IN ('ship-record-cutover-20260916-08','ship-record-cutover-20260916-09','ship-record-cutover-20260916-10')) THEN RAISE EXCEPTION 'release-job-already-exists-use-readback';END IF;
END $preflight$;
CREATE SCHEMA IF NOT EXISTS ship_dynamics_release_private;
REVOKE ALL ON SCHEMA ship_dynamics_release_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS ship_dynamics_release_private.jobs_v1(
 release_id text NOT NULL,phase text NOT NULL CHECK(phase IN ('08','09','10')),
 job_name text NOT NULL UNIQUE,command text NOT NULL,job_id bigint,
 state text NOT NULL CHECK(state IN ('waiting','scheduled','running','succeeded','failed','interrupted')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),started_at timestamptz,finished_at timestamptz,
 result jsonb,error_code text,worker_pid integer,worker_started timestamptz,PRIMARY KEY(release_id,phase)
);
ALTER TABLE ship_dynamics_release_private.jobs_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ship_dynamics_release_private.jobs_v1 FROM PUBLIC,anon,authenticated,service_role;
-- Duplicate launch raises unique_violation and rolls back; it never creates another business run.
INSERT INTO ship_dynamics_release_private.jobs_v1(release_id,phase,job_name,command,state) VALUES('records-initial-20260916','08','ship-record-cutover-20260916-08',$job08$-- CLOUD WORKER ONLY; never paste this job body into SQL Editor.
-- Durable claim commits before business work. Each phase has its own transaction.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE release_claim(claimed boolean) ON COMMIT PRESERVE ROWS;
INSERT INTO release_claim VALUES(false);
WITH take AS (
 UPDATE ship_dynamics_release_private.jobs_v1 SET state='running',started_at=clock_timestamp(),worker_pid=pg_backend_pid(),worker_started=(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())
 WHERE release_id='records-initial-20260916' AND phase='08' AND state='scheduled'
 RETURNING phase
) UPDATE release_claim SET claimed=EXISTS(SELECT FROM take);
UPDATE ship_dynamics_release_private.jobs_v1 j SET state='interrupted',finished_at=clock_timestamp()
 WHERE release_id='records-initial-20260916' AND phase='08' AND state='running'
 AND NOT (SELECT claimed FROM release_claim)
 AND NOT EXISTS(SELECT FROM pg_stat_activity a WHERE a.pid=j.worker_pid AND a.backend_start=j.worker_started);
COMMIT;
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='8min';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE release_step_result(result jsonb) ON COMMIT DROP;
DO $release_worker$
DECLARE w constant text:='ship-dynamics-main';wid uuid; q record; f record; l record;
 r jsonb; h text; source_hash text; sid uuid; proof jsonb; op uuid:=gen_random_uuid(); actor name:=current_user;
 next_job bigint;
BEGIN
 IF NOT (SELECT claimed FROM pg_temp.release_claim) THEN RETURN; END IF;
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
  UPDATE ship_dynamics_release_private.jobs_v1 SET state='succeeded',result=r,finished_at=clock_timestamp()
    WHERE release_id='records-initial-20260916' AND phase='08' AND state='running';

  SELECT cron.schedule(job_name,'* * * * *',command) INTO next_job
    FROM ship_dynamics_release_private.jobs_v1 WHERE release_id='records-initial-20260916' AND phase='09' AND state='waiting';
  IF next_job IS NULL THEN RAISE EXCEPTION 'release-next-phase-not-waiting'; END IF;
  UPDATE ship_dynamics_release_private.jobs_v1 SET state='scheduled',job_id=next_job
    WHERE release_id='records-initial-20260916' AND phase='09' AND state='waiting';

 EXCEPTION WHEN query_canceled OR OTHERS THEN
  EXECUTE format('SET LOCAL ROLE %I',actor);
  UPDATE ship_dynamics_release_private.jobs_v1 SET state='failed',error_code=SQLSTATE,finished_at=clock_timestamp()
    WHERE release_id='records-initial-20260916' AND phase='08' AND state='running';
 END;
END $release_worker$;
COMMIT;
-- Cancellation now cannot undo the already committed business/result transaction.
SELECT cron.unschedule('ship-record-cutover-20260916-08') WHERE EXISTS(SELECT FROM ship_dynamics_release_private.jobs_v1 WHERE release_id='records-initial-20260916' AND phase='08' AND state IN ('succeeded','failed','interrupted'));
$job08$,'waiting');
INSERT INTO ship_dynamics_release_private.jobs_v1(release_id,phase,job_name,command,state) VALUES('records-initial-20260916','09','ship-record-cutover-20260916-09',$job09$-- CLOUD WORKER ONLY; never paste this job body into SQL Editor.
-- Durable claim commits before business work. Each phase has its own transaction.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE release_claim(claimed boolean) ON COMMIT PRESERVE ROWS;
INSERT INTO release_claim VALUES(false);
WITH take AS (
 UPDATE ship_dynamics_release_private.jobs_v1 SET state='running',started_at=clock_timestamp(),worker_pid=pg_backend_pid(),worker_started=(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())
 WHERE release_id='records-initial-20260916' AND phase='09' AND state='scheduled'
 RETURNING phase
) UPDATE release_claim SET claimed=EXISTS(SELECT FROM take);
UPDATE ship_dynamics_release_private.jobs_v1 j SET state='interrupted',finished_at=clock_timestamp()
 WHERE release_id='records-initial-20260916' AND phase='09' AND state='running'
 AND NOT (SELECT claimed FROM release_claim)
 AND NOT EXISTS(SELECT FROM pg_stat_activity a WHERE a.pid=j.worker_pid AND a.backend_start=j.worker_started);
COMMIT;
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='8min';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE release_step_result(result jsonb) ON COMMIT DROP;
DO $release_worker$
DECLARE w constant text:='ship-dynamics-main';wid uuid; q record; f record; l record;
 r jsonb; h text; source_hash text; sid uuid; proof jsonb; op uuid:=gen_random_uuid(); actor name:=current_user;
 next_job bigint;
BEGIN
 IF NOT (SELECT claimed FROM pg_temp.release_claim) THEN RETURN; END IF;
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

 IF EXISTS(SELECT FROM public.ship_dynamics_record_workspaces WHERE workspace_key=w) THEN RAISE EXCEPTION 'release-first-target-already-exists-use-readback';END IF;
 h:=public.sd_legacy_jsonb_sha256(l.payload);
 SET LOCAL ROLE service_role;
 r:=public.stage_ship_dynamics_paused_legacy_to_records_v1(w,wid,q.transition_id,q.watermark,l.revision,h,NULL,NULL,f.frozen_at,op);

 EXECUTE format('SET LOCAL ROLE %I',actor);
 INSERT INTO pg_temp.release_step_result VALUES(r);
  UPDATE ship_dynamics_release_private.jobs_v1 SET state='succeeded',result=r,finished_at=clock_timestamp()
    WHERE release_id='records-initial-20260916' AND phase='09' AND state='running';

  SELECT cron.schedule(job_name,'* * * * *',command) INTO next_job
    FROM ship_dynamics_release_private.jobs_v1 WHERE release_id='records-initial-20260916' AND phase='10' AND state='waiting';
  IF next_job IS NULL THEN RAISE EXCEPTION 'release-next-phase-not-waiting'; END IF;
  UPDATE ship_dynamics_release_private.jobs_v1 SET state='scheduled',job_id=next_job
    WHERE release_id='records-initial-20260916' AND phase='10' AND state='waiting';

 EXCEPTION WHEN query_canceled OR OTHERS THEN
  EXECUTE format('SET LOCAL ROLE %I',actor);
  UPDATE ship_dynamics_release_private.jobs_v1 SET state='failed',error_code=SQLSTATE,finished_at=clock_timestamp()
    WHERE release_id='records-initial-20260916' AND phase='09' AND state='running';
 END;
END $release_worker$;
COMMIT;
-- Cancellation now cannot undo the already committed business/result transaction.
SELECT cron.unschedule('ship-record-cutover-20260916-09') WHERE EXISTS(SELECT FROM ship_dynamics_release_private.jobs_v1 WHERE release_id='records-initial-20260916' AND phase='09' AND state IN ('succeeded','failed','interrupted'));
$job09$,'waiting');
INSERT INTO ship_dynamics_release_private.jobs_v1(release_id,phase,job_name,command,state) VALUES('records-initial-20260916','10','ship-record-cutover-20260916-10',$job10$-- CLOUD WORKER ONLY; never paste this job body into SQL Editor.
-- Durable claim commits before business work. Each phase has its own transaction.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE release_claim(claimed boolean) ON COMMIT PRESERVE ROWS;
INSERT INTO release_claim VALUES(false);
WITH take AS (
 UPDATE ship_dynamics_release_private.jobs_v1 SET state='running',started_at=clock_timestamp(),worker_pid=pg_backend_pid(),worker_started=(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())
 WHERE release_id='records-initial-20260916' AND phase='10' AND state='scheduled'
 RETURNING phase
) UPDATE release_claim SET claimed=EXISTS(SELECT FROM take);
UPDATE ship_dynamics_release_private.jobs_v1 j SET state='interrupted',finished_at=clock_timestamp()
 WHERE release_id='records-initial-20260916' AND phase='10' AND state='running'
 AND NOT (SELECT claimed FROM release_claim)
 AND NOT EXISTS(SELECT FROM pg_stat_activity a WHERE a.pid=j.worker_pid AND a.backend_start=j.worker_started);
COMMIT;
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='8min';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE release_step_result(result jsonb) ON COMMIT DROP;
DO $release_worker$
DECLARE w constant text:='ship-dynamics-main';wid uuid; q record; f record; l record;
 r jsonb; h text; source_hash text; sid uuid; proof jsonb; op uuid:=gen_random_uuid(); actor name:=current_user;
 next_job bigint;
BEGIN
 IF NOT (SELECT claimed FROM pg_temp.release_claim) THEN RETURN; END IF;
 BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolbypassrls) THEN RAISE EXCEPTION 'release-admin-required';END IF;
 SELECT id INTO STRICT wid FROM public.sd_workspaces WHERE legacy_key=w;

 SELECT x.transition_id,t.watermark,t.state INTO STRICT q FROM ship_dynamics_quiescence_private.workspaces x
 JOIN ship_dynamics_quiescence_private.transitions t USING(workspace_key,transition_id)
 WHERE x.workspace_key=w AND x.workspace_id=wid;
 IF q.state<>'paused' THEN RAISE EXCEPTION 'release-exact-pause-required';END IF;

 IF EXISTS(SELECT FROM ship_dynamics_authority_private.current_v1 WHERE workspace_key=w AND transition_id=q.transition_id AND phase='published-paused') THEN RAISE EXCEPTION 'release-already-published-use-readback';END IF;
 SELECT request_id,result INTO STRICT sid,proof FROM ship_dynamics_authority_private.forward_stages_v1 WHERE workspace_key=w AND transition_id=q.transition_id;
 SET LOCAL ROLE service_role;
 r:=public.publish_ship_dynamics_source_authority_v2(w,wid,q.transition_id,sid,proof,'records-v1',op);

 EXECUTE format('SET LOCAL ROLE %I',actor);
 INSERT INTO pg_temp.release_step_result VALUES(r);
  UPDATE ship_dynamics_release_private.jobs_v1 SET state='succeeded',result=r,finished_at=clock_timestamp()
    WHERE release_id='records-initial-20260916' AND phase='10' AND state='running';

 EXCEPTION WHEN query_canceled OR OTHERS THEN
  EXECUTE format('SET LOCAL ROLE %I',actor);
  UPDATE ship_dynamics_release_private.jobs_v1 SET state='failed',error_code=SQLSTATE,finished_at=clock_timestamp()
    WHERE release_id='records-initial-20260916' AND phase='10' AND state='running';
 END;
END $release_worker$;
COMMIT;
-- Cancellation now cannot undo the already committed business/result transaction.
SELECT cron.unschedule('ship-record-cutover-20260916-10') WHERE EXISTS(SELECT FROM ship_dynamics_release_private.jobs_v1 WHERE release_id='records-initial-20260916' AND phase='10' AND state IN ('succeeded','failed','interrupted'));
$job10$,'waiting');
DO $schedule$
DECLARE j bigint;
BEGIN
 SELECT cron.schedule(job_name,'* * * * *',command) INTO j FROM ship_dynamics_release_private.jobs_v1 WHERE release_id='records-initial-20260916' AND phase='08' AND state='waiting';
 IF j IS NULL THEN RAISE EXCEPTION 'release-first-phase-not-waiting';END IF;
 UPDATE ship_dynamics_release_private.jobs_v1 SET state='scheduled',job_id=j WHERE release_id='records-initial-20260916' AND phase='08';
END $schedule$;
COMMIT;
SELECT jsonb_build_object('release','records-initial-20260916','status','queued-not-completed','steps',jsonb_agg(jsonb_build_object('phase',phase,'state',state,'jobId',job_id) ORDER BY phase)) AS background_cutover_queue FROM ship_dynamics_release_private.jobs_v1 WHERE release_id='records-initial-20260916';

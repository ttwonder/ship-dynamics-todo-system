-- READ ONLY. This reports queue/job outcome; it does not retry, resume, or requeue.
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SELECT jsonb_build_object('release','records-initial-20260916','checkedAt',clock_timestamp(),'steps',jsonb_agg(jsonb_build_object('phase',j.phase,'state',j.state,'jobId',j.job_id,'startedAt',j.started_at,'finishedAt',j.finished_at,'errorCode',j.error_code,'result',j.result,'cronStillScheduled',EXISTS(SELECT FROM cron.job c WHERE c.jobid=j.job_id)) ORDER BY j.phase)) AS background_cutover_readback FROM ship_dynamics_release_private.jobs_v1 j WHERE j.release_id='records-initial-20260916';
COMMIT;

-- Metadata-only observation after an upstream timeout; NOT a pause retry.
-- One SELECT; no business/history reads, watermark calls, setting changes,
-- cancellation, termination, advisory/row locks, or transaction control.
-- Run once as a fresh SQL-editor request. Classification is a TEXT HEURISTIC:
-- top-level SQL can be truncated, wrapped, hidden, stale (idle), or already gone.
-- An absent match NEVER proves rollback, successful commit, or no prior backend.
-- Limits: 64 same-database sessions; 8 direct blocker details per selected PID.
-- Counts cover the full observed same-database set, NOT only displayed rows.
-- pg_blocking_pids observes live locks separately; this is not an atomic trace.
WITH
bounds AS MATERIALIZED (
  SELECT 64::integer AS session_limit, 8::integer AS blocker_detail_limit
),
reader AS MATERIALIZED (
  SELECT statement_timestamp() AS snapshot_started_at,
         clock_timestamp() AS metadata_sample_started_at,
         pg_backend_pid() AS reader_pid,
         (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AS database_oid,
         COALESCE((SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user),false) AS reader_is_superuser,
         pg_catalog.pg_has_role(current_user,'pg_read_all_stats','USAGE') AS reader_has_read_all_stats
),
activity AS MATERIALIZED (
  SELECT a.pid, a.leader_pid, a.datid,
         a.backend_type, a.backend_start, a.xact_start, a.query_start, a.state_change,
         a.state, a.wait_event_type, a.wait_event,
         CASE
           WHEN a.state IS NULL OR a.query IS NULL OR a.query='<insufficient privilege>'
             THEN 'text_unavailable'
           WHEN position('ship-release-upstream-timeout-diagnostic-v1' in lower(a.query))>0
             THEN 'this_diagnostic_text'
           WHEN position('pause_ship_dynamics_business_v1' in lower(a.query))>0
             OR position('release-already-paused-use-readback' in lower(a.query))>0
             THEN 'pause_call_text'
           WHEN position('read_ship_dynamics_business_pause_v1' in lower(a.query))>0
             THEN 'pause_readback_text'
           WHEN position('resume_ship_dynamics_business_v1' in lower(a.query))>0
             THEN 'resume_call_text'
           WHEN position('ship-release-control-readback-v1' in lower(a.query))>0
             THEN 'control_readback_text'
           WHEN position('watermark_v1' in lower(a.query))>0
             THEN 'watermark_related_text'
           WHEN position('$release_step$' in lower(a.query))>0
             OR position('release_step_result' in lower(a.query))>0
             THEN 'release_envelope_text'
           ELSE 'other_text'
         END AS query_class
  FROM pg_catalog.pg_stat_activity a
  WHERE a.pid<>(SELECT reader_pid FROM reader)
),
eligible AS MATERIALIZED (
  SELECT a.*,
         query_class IN ('pause_call_text','watermark_related_text','release_envelope_text') AS pause_or_release_candidate
  FROM activity a WHERE a.datid=(SELECT database_oid FROM reader)
),
chosen AS MATERIALIZED (
  SELECT * FROM eligible
  ORDER BY
    CASE WHEN pause_or_release_candidate AND state IN ('active','idle in transaction','idle in transaction (aborted)') THEN 0
         WHEN state='active' THEN 1
         WHEN state IN ('idle in transaction','idle in transaction (aborted)') THEN 2
         WHEN query_class='text_unavailable' THEN 3
         WHEN pause_or_release_candidate THEN 4 ELSE 5 END,
    COALESCE(xact_start,query_start,backend_start),pid
  LIMIT (SELECT session_limit FROM bounds)
),
with_blockers AS MATERIALIZED (
  SELECT c.*,pg_catalog.pg_blocking_pids(c.pid) AS blocker_pids FROM chosen c
),
session_output AS MATERIALIZED (
  SELECT s.pid,
    jsonb_build_object(
      'pid',s.pid,'leader_pid',s.leader_pid,'backend_type',s.backend_type,
      'backend_start',s.backend_start,'state',s.state,
      'xact_start',s.xact_start,'query_start',s.query_start,'state_change',s.state_change,
      'query_class',s.query_class,'pause_or_release_candidate',s.pause_or_release_candidate,
      'active_query_age_seconds',CASE WHEN s.state='active' THEN EXTRACT(epoch FROM r.snapshot_started_at-s.query_start) END,
      'transaction_age_seconds',EXTRACT(epoch FROM r.snapshot_started_at-s.xact_start),
      'state_age_seconds',EXTRACT(epoch FROM r.snapshot_started_at-s.state_change),
      'wait_event_type',s.wait_event_type,'wait_event',s.wait_event,
      'direct_blocker_count',cardinality(s.blocker_pids),
      'blocker_details_truncated',cardinality(s.blocker_pids)>b.blocker_detail_limit,
      'direct_blockers',COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'pid',p.pid,
          'observation',CASE WHEN p.pid=0 THEN 'prepared_transaction'
                             WHEN a.pid IS NULL THEN 'not_in_activity_sample'
                             ELSE 'activity_sample' END,
          'same_database',a.datid=r.database_oid,
          'state',a.state,'query_class',a.query_class,
          'xact_start',a.xact_start,'state_change',a.state_change,
          'wait_event_type',a.wait_event_type,'wait_event',a.wait_event
        ) ORDER BY p.ordinality)
        FROM unnest(s.blocker_pids) WITH ORDINALITY p(pid,ordinality)
        LEFT JOIN activity a ON a.pid=p.pid
        WHERE p.ordinality<=b.blocker_detail_limit
      ),'[]'::jsonb)
    ) AS item
  FROM with_blockers s CROSS JOIN reader r CROSS JOIN bounds b
)
SELECT jsonb_build_object(
  'kind','ship-release-upstream-timeout-diagnostic-v1',
  'snapshot_started_at',r.snapshot_started_at,
  'metadata_sample_started_at',r.metadata_sample_started_at,
  'observation_finished_at',clock_timestamp(),
  'scope','current_database_other_backends_plus_direct_blocker_metadata',
  'reader',jsonb_build_object(
    'pid',r.reader_pid,'is_superuser',r.reader_is_superuser,
    'has_pg_read_all_stats',r.reader_has_read_all_stats,
    'can_read_all_session_details',r.reader_is_superuser OR r.reader_has_read_all_stats,
    'transaction_read_only',current_setting('transaction_read_only'),
    'effective_settings_this_reader_only',jsonb_build_object(
      'statement_timeout',current_setting('statement_timeout'),
      'lock_timeout',current_setting('lock_timeout'),
      'idle_in_transaction_session_timeout',current_setting('idle_in_transaction_session_timeout'),
      'transaction_timeout',current_setting('transaction_timeout',true),
      'work_mem',current_setting('work_mem'),
      'temp_file_limit',current_setting('temp_file_limit')
    )
  ),
  'counts',(
    SELECT jsonb_build_object(
      'observed_sessions',count(*),
      'active',count(*) FILTER(WHERE state='active'),
      'idle_in_transaction',count(*) FILTER(WHERE state='idle in transaction'),
      'idle_in_transaction_aborted',count(*) FILTER(WHERE state='idle in transaction (aborted)'),
      'idle',count(*) FILTER(WHERE state='idle'),
      'text_unavailable',count(*) FILTER(WHERE query_class='text_unavailable'),
      'pause_or_release_candidates',count(*) FILTER(WHERE pause_or_release_candidate),
      'candidate_active',count(*) FILTER(WHERE pause_or_release_candidate AND state='active'),
      'candidate_idle_in_transaction',count(*) FILTER(WHERE pause_or_release_candidate AND state IN ('idle in transaction','idle in transaction (aborted)')),
      'candidate_idle',count(*) FILTER(WHERE pause_or_release_candidate AND state='idle')
    ) FROM eligible
  ),
  'session_limit',b.session_limit,'blocker_detail_limit',b.blocker_detail_limit,
  'sessions_returned',(SELECT count(*) FROM chosen),
  'sessions_truncated',(SELECT count(*) FROM eligible)>b.session_limit,
  'sessions',COALESCE((SELECT jsonb_agg(item ORDER BY pid) FROM session_output),'[]'::jsonb),
  'evidence_boundary','snapshot_only_text_heuristics_not_transaction_outcome_or_retry_authorization',
  'production_write',false
) AS upstream_timeout_diagnostic
FROM reader r CROSS JOIN bounds b;

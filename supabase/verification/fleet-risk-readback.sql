-- Operator readback only: no RPC writer, HTTP, job mutation, or secret values.
-- Missing installation/prerequisites are NOT permission to install/reinstall.
BEGIN TRANSACTION READ ONLY;

SELECT
  to_regclass('public.ship_fleet_risk_cache_v1') IS NOT NULL AS cache_table_exists,
  to_regprocedure('public.read_ship_fleet_risk_v1()') IS NOT NULL AS read_api_exists,
  to_regprocedure('public.claim_ship_fleet_risk_v1(text,uuid)') IS NOT NULL AS claim_api_exists,
  to_regprocedure('public.progress_ship_fleet_risk_v1(uuid,integer,integer)') IS NOT NULL AS progress_api_exists,
  to_regprocedure('public.finish_ship_fleet_risk_v1(uuid,jsonb,text)') IS NOT NULL AS finish_api_exists;

SELECT c.relrowsecurity AS rls_enabled,
  NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_table_denied,
  NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated_table_denied,
  NOT has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS service_role_table_denied,
  (SELECT count(*) = 1 AND bool_and(company_imo = '0882415') FROM public.ship_fleet_risk_cache_v1) AS singleton_company_ok
FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.ship_fleet_risk_cache_v1');

SELECT p.proname AS function_name, p.prosecdef AS security_definer,
  coalesce('search_path=pg_catalog' = ANY(p.proconfig), false) AS fixed_search_path,
  coalesce('TimeZone=UTC' = ANY(p.proconfig), false) AS utc_output,
  NOT EXISTS (SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_execute_denied,
  has_function_privilege('anon', p.oid, 'EXECUTE') = (p.proname = 'read_ship_fleet_risk_v1') AS anon_acl_ok,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') = (p.proname = 'read_ship_fleet_risk_v1') AS authenticated_acl_ok,
  has_function_privilege('service_role', p.oid, 'EXECUTE') = (p.proname <> 'invoke_ship_fleet_risk_schedule_v1') AS service_role_acl_ok
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('read_ship_fleet_risk_v1','claim_ship_fleet_risk_v1',
  'progress_ship_fleet_risk_v1','finish_ship_fleet_risk_v1','invoke_ship_fleet_risk_schedule_v1')
ORDER BY p.proname;

SELECT EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') AS pg_cron_present,
  EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'pg_net') AS pg_net_present,
  EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'supabase_vault') AS vault_present,
  current_setting('TimeZone') IN ('UTC','Etc/UTC','GMT') AS database_timezone_utc,
  coalesce(current_setting('cron.timezone', true), '') IN ('UTC','Etc/UTC','GMT') AS cron_timezone_utc,
  to_regprocedure('public.invoke_ship_fleet_risk_schedule_v1(boolean)') IS NOT NULL AS scheduler_wrapper_exists;

DO $readback_guard$
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL
    OR to_regprocedure('public.invoke_ship_fleet_risk_schedule_v1(boolean)') IS NULL THEN
    RAISE EXCEPTION 'Fleet risk scheduler readback prerequisites are missing; stop and review installation status';
  END IF;
END;
$readback_guard$;

WITH expected(name) AS (VALUES ('ship_fleet_risk_url'), ('ship_fleet_risk_anon_key'), ('ship_fleet_risk_scheduler_token')),
checks AS (
  SELECT e.name, count(v.name) = 1 AS exactly_one,
    coalesce(bool_and(v.decrypted_secret IS NOT NULL AND v.decrypted_secret <> ''
      AND v.decrypted_secret !~ '[[:space:]]'), false) AS nonempty_no_whitespace,
    CASE WHEN e.name = 'ship_fleet_risk_url' THEN coalesce(bool_and(v.decrypted_secret ~
      '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?[.]supabase[.]co/functions/v1/fleet-risk$'), false)
      ELSE true END AS target_format_ok
  FROM expected e LEFT JOIN vault.decrypted_secrets v ON v.name = e.name GROUP BY e.name
)
SELECT name AS vault_entry, exactly_one, nonempty_no_whitespace, target_format_ok,
  CASE WHEN name = 'ship_fleet_risk_url' THEN 'https://<redacted>.supabase.co/functions/v1/fleet-risk' ELSE NULL END AS redacted_url
FROM checks ORDER BY name;

SELECT count(*) = 1 AS exactly_one_target_job,
  coalesce(bool_and(schedule = '0 23 * * *'), false) AS schedule_ok,
  CASE WHEN count(*) = 1 THEN min(schedule) ELSE NULL END AS target_schedule,
  coalesce(bool_and(command = 'SELECT public.invoke_ship_fleet_risk_schedule_v1();'), false) AS fixed_command_ok,
  coalesce(bool_and(active), false) AS job_active,
  coalesce(bool_and(database = current_database() AND username = current_user), false) AS job_owner_database_ok
FROM cron.job WHERE jobname = 'ship-fleet-risk-taipei-0700-v1';

-- Snapshot contents intentionally omitted. All five envelope/projection checks are booleans.
WITH state AS (SELECT public.read_ship_fleet_risk_v1() AS value)
SELECT value ?& ARRAY['snapshot','attempt','serverTime','nextScheduledAt'] AS envelope_present,
  value->'snapshot' <> 'null'::jsonb AS has_last_good_snapshot,
  value->'attempt' <> 'null'::jsonb AS has_attempt,
  (value->>'nextScheduledAt')::timestamptz > (value->>'serverTime')::timestamptz AS next_schedule_future,
  ((value->>'nextScheduledAt')::timestamptz AT TIME ZONE 'Asia/Taipei')::time = time '07:00' AS next_schedule_taipei_0700
FROM state;
COMMIT;
-- False has_last_good_snapshot/has_attempt is expected before the first run.
-- Other false checks or unexpected function row counts: stop. Do not paste raw cron/net logs or Vault values.
-- Installed catalog state is NOT proof that a hosted job fired or that public-source retrieval succeeded.

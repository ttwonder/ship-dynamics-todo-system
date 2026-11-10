-- OPTIONAL operator-run install, NEVER part of the schema migration.
-- Prerequisites: independently provisioned pg_cron, pg_net, Supabase Vault;
-- working deployed Edge handler; all three named Vault entries (see handoff).
-- Does not create extensions/secrets or send HTTP during installation.
-- UTC cron 23:00 is next-day Asia/Taipei 07:00. Preserve every other job.
BEGIN;

-- BEGIN HOSTED EXTENSION GUARD
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'pg_cron')
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'pg_net')
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'supabase_vault') THEN
    RAISE EXCEPTION 'Fleet risk scheduler requires pg_cron, pg_net and supabase_vault; provision prerequisites separately';
  END IF;
END;
$guard$;
-- END HOSTED EXTENSION GUARD

DO $guard$
BEGIN
  IF current_setting('TimeZone') NOT IN ('UTC','Etc/UTC','GMT')
    OR coalesce(current_setting('cron.timezone', true), '') NOT IN ('UTC','Etc/UTC','GMT') THEN
    RAISE EXCEPTION 'Fleet risk scheduler requires UTC database and cron timezones; do not install this schedule otherwise';
  END IF;
  IF to_regclass('cron.job') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL
    OR to_regprocedure('cron.schedule(text,text,text)') IS NULL
    OR to_regprocedure('cron.unschedule(bigint)') IS NULL
    OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
    OR to_regprocedure('public.read_ship_fleet_risk_v1()') IS NULL
    OR to_regprocedure('public.claim_ship_fleet_risk_v1(text,uuid)') IS NULL
    OR to_regprocedure('public.progress_ship_fleet_risk_v1(uuid,integer,integer)') IS NULL
    OR to_regprocedure('public.finish_ship_fleet_risk_v1(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'Fleet risk scheduler prerequisite API is missing; stop';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.invoke_ship_fleet_risk_schedule_v1(p_validate_only boolean DEFAULT false)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
SET timezone = 'UTC'
AS $function$
DECLARE
  v_url text;
  v_anon text;
  v_token text;
  v_n bigint;
  v_request bigint;
BEGIN
  SELECT count(*), min(decrypted_secret) INTO v_n, v_url
    FROM vault.decrypted_secrets WHERE name = 'ship_fleet_risk_url';
  IF v_n <> 1 OR v_url IS NULL
    OR v_url !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?[.]supabase[.]co/functions/v1/fleet-risk$' THEN
    RAISE EXCEPTION 'Fleet risk scheduler URL configuration is missing, ambiguous or invalid';
  END IF;
  SELECT count(*), min(decrypted_secret) INTO v_n, v_anon
    FROM vault.decrypted_secrets WHERE name = 'ship_fleet_risk_anon_key';
  IF v_n <> 1 OR v_anon IS NULL OR v_anon = '' OR v_anon ~ '[[:space:]]' THEN
    RAISE EXCEPTION 'Fleet risk scheduler anonymous key configuration is missing, ambiguous or invalid';
  END IF;
  SELECT count(*), min(decrypted_secret) INTO v_n, v_token
    FROM vault.decrypted_secrets WHERE name = 'ship_fleet_risk_scheduler_token';
  IF v_n <> 1 OR v_token IS NULL OR v_token = '' OR v_token ~ '[[:space:]]' THEN
    RAISE EXCEPTION 'Fleet risk scheduler token configuration is missing, ambiguous or invalid';
  END IF;
  IF p_validate_only IS NULL THEN RAISE EXCEPTION 'Invalid validation mode'; END IF;
  IF p_validate_only THEN RETURN NULL; END IF;
  IF coalesce(current_setting('cron.timezone', true), '') NOT IN ('UTC','Etc/UTC','GMT') THEN
    RAISE EXCEPTION 'Fleet risk scheduler requires UTC cron timezone';
  END IF;
  v_request := net.http_post(
    url := v_url,
    body := jsonb_build_object('action', 'scheduled'),
    params := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon, 'x-fleet-scheduler-token', v_token),
    timeout_milliseconds := 210000
  );
  IF v_request IS NULL THEN RAISE EXCEPTION 'Fleet risk scheduler enqueue failed'; END IF;
  RETURN v_request;
EXCEPTION WHEN OTHERS THEN
  -- Do not relay decrypted values or low-level HTTP/SQL errors to cron logs.
  RAISE EXCEPTION 'Fleet risk scheduler configuration or enqueue failed; inspect redacted readback'
    USING ERRCODE = 'P0001';
END;
$function$;
REVOKE ALL ON FUNCTION public.invoke_ship_fleet_risk_schedule_v1(boolean) FROM PUBLIC, anon, authenticated, service_role;
-- Owner only. pg_cron runs the following job as the installing database owner.

DO $install$
DECLARE
  v_job bigint;
  v_count integer;
BEGIN
  PERFORM public.invoke_ship_fleet_risk_schedule_v1(true); -- validation only; no HTTP
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'ship-fleet-risk-taipei-0700-v1';
  IF v_count > 1 OR EXISTS (
    SELECT FROM cron.job WHERE jobname = 'ship-fleet-risk-taipei-0700-v1'
      AND (username <> current_user OR database <> current_database())
  ) THEN
    RAISE EXCEPTION 'Fleet risk cron job name is ambiguous or owned elsewhere; stop';
  END IF;
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = 'ship-fleet-risk-taipei-0700-v1' LOOP
    IF NOT cron.unschedule(v_job) THEN RAISE EXCEPTION 'Unable to replace fleet risk cron job'; END IF;
  END LOOP;
  PERFORM cron.schedule('ship-fleet-risk-taipei-0700-v1', '0 23 * * *',
    'SELECT public.invoke_ship_fleet_risk_schedule_v1();');
END;
$install$;
COMMIT;
-- Run the separate readback file. This installer is not hosted execution proof.

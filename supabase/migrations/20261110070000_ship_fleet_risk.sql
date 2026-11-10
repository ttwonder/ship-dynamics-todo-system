-- Isolated public FPMC PSC snapshot. Does not read or lock business tables.
-- Apply separately from the opt-in cron installer. No extensions or secrets here.
BEGIN;

CREATE TABLE public.ship_fleet_risk_cache_v1 (
  company_imo text PRIMARY KEY DEFAULT '0882415' CHECK (company_imo = '0882415'),
  snapshot jsonb CHECK (snapshot IS NULL OR jsonb_typeof(snapshot) = 'object'),
  attempt jsonb CHECK (attempt IS NULL OR jsonb_typeof(attempt) = 'object'),
  lease_expires_at timestamptz,
  last_scheduled_date date,
  -- Durable request->run replay keys, not snapshot history. Retain across runs.
  request_runs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_runs) = 'object'),
  CHECK ((attempt IS NULL) = (lease_expires_at IS NULL))
);
INSERT INTO public.ship_fleet_risk_cache_v1 (company_imo) VALUES ('0882415');
ALTER TABLE public.ship_fleet_risk_cache_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ship_fleet_risk_cache_v1 FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.read_ship_fleet_risk_v1()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
SET timezone = 'UTC'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_due timestamptz;
  v_row public.ship_fleet_risk_cache_v1%ROWTYPE;
  v_attempt jsonb;
BEGIN
  SELECT * INTO STRICT v_row FROM public.ship_fleet_risk_cache_v1 WHERE company_imo = '0882415';
  v_due := ((v_now AT TIME ZONE 'Asia/Taipei')::date + time '07:00') AT TIME ZONE 'Asia/Taipei';
  IF v_due <= v_now THEN v_due := v_due + interval '1 day'; END IF;
  v_attempt := v_row.attempt;
  IF v_attempt->>'status' = 'running' AND v_row.lease_expires_at <= v_now THEN
    -- Projection only: polling must not become a writer.
    v_attempt := v_attempt || jsonb_build_object('status', 'failed',
      'completedAt', to_char(v_row.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'error', 'Fleet risk refresh timed out.');
  END IF;
  RETURN jsonb_build_object('snapshot', v_row.snapshot, 'attempt', v_attempt,
    'serverTime', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'nextScheduledAt', to_char(v_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END;
$function$;
REVOKE ALL ON FUNCTION public.read_ship_fleet_risk_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_ship_fleet_risk_v1() TO anon, authenticated, service_role;

CREATE FUNCTION public.claim_ship_fleet_risk_v1(p_trigger text, p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
SET timezone = 'UTC'
AS $function$
DECLARE
  v_row public.ship_fleet_risk_cache_v1%ROWTYPE;
  v_now timestamptz;
  v_today date;
  v_run uuid;
BEGIN
  IF p_trigger IS NULL OR p_trigger NOT IN ('manual', 'scheduled') THEN
    RAISE EXCEPTION 'Invalid trigger' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request id is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO STRICT v_row FROM public.ship_fleet_risk_cache_v1 WHERE company_imo = '0882415' FOR UPDATE;
  -- Sample after acquiring the only row lock; waiting must not grant a stale lease.
  v_now := pg_catalog.clock_timestamp();
  v_today := (v_now AT TIME ZONE 'Asia/Taipei')::date;
  IF p_trigger = 'scheduled' AND (v_now AT TIME ZONE 'Asia/Taipei')::time < time '07:00' THEN
    RETURN jsonb_build_object('acquired', false, 'runId', NULL, 'state', public.read_ship_fleet_risk_v1());
  END IF;
  IF v_row.attempt->>'status' = 'running' AND v_row.lease_expires_at > v_now THEN
    v_run := (v_row.attempt->>'id')::uuid;
    IF NOT v_row.request_runs ? p_request_id::text THEN
      UPDATE public.ship_fleet_risk_cache_v1
        SET request_runs = request_runs || jsonb_build_object(p_request_id::text, v_run::text)
        WHERE company_imo = '0882415';
    END IF;
    RETURN jsonb_build_object('acquired', false, 'runId', v_run, 'state', public.read_ship_fleet_risk_v1());
  END IF;
  IF v_row.request_runs ? p_request_id::text THEN
    RETURN jsonb_build_object('acquired', false, 'runId', (v_row.request_runs->>p_request_id::text)::uuid,
      'state', public.read_ship_fleet_risk_v1());
  END IF;
  IF p_trigger = 'scheduled' AND v_row.last_scheduled_date >= v_today THEN
    RETURN jsonb_build_object('acquired', false, 'runId', NULL, 'state', public.read_ship_fleet_risk_v1());
  END IF;
  UPDATE public.ship_fleet_risk_cache_v1 SET
    attempt = jsonb_build_object('id', p_request_id::text, 'trigger', p_trigger, 'status', 'running',
      'startedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'completedAt', NULL, 'done', 0, 'total', 0, 'error', NULL),
    lease_expires_at = v_now + interval '4 minutes',
    last_scheduled_date = CASE WHEN p_trigger = 'scheduled' THEN v_today ELSE last_scheduled_date END,
    request_runs = request_runs || jsonb_build_object(p_request_id::text, p_request_id::text)
  WHERE company_imo = '0882415';
  RETURN jsonb_build_object('acquired', true, 'runId', p_request_id, 'state', public.read_ship_fleet_risk_v1());
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_ship_fleet_risk_v1(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_ship_fleet_risk_v1(text, uuid) TO service_role;

CREATE FUNCTION public.progress_ship_fleet_risk_v1(p_run_id uuid, p_done integer, p_total integer)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
SET timezone = 'UTC'
AS $function$
DECLARE
  v_row public.ship_fleet_risk_cache_v1%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_run_id IS NULL OR p_done IS NULL OR p_total IS NULL OR p_done < 0 OR p_total < p_done OR p_total > 100 THEN
    RETURN false;
  END IF;
  SELECT * INTO STRICT v_row FROM public.ship_fleet_risk_cache_v1 WHERE company_imo = '0882415' FOR UPDATE;
  v_now := pg_catalog.clock_timestamp();
  IF v_row.attempt IS NULL OR v_row.attempt->>'id' <> p_run_id::text OR v_row.attempt->>'status' <> 'running'
    OR v_row.lease_expires_at <= v_now
    OR p_done < (v_row.attempt->>'done')::integer OR p_total < (v_row.attempt->>'total')::integer THEN
    RETURN false;
  END IF;
  UPDATE public.ship_fleet_risk_cache_v1 SET attempt = attempt || jsonb_build_object('done', p_done, 'total', p_total)
    WHERE company_imo = '0882415';
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.progress_ship_fleet_risk_v1(uuid, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.progress_ship_fleet_risk_v1(uuid, integer, integer) TO service_role;

CREATE FUNCTION public.finish_ship_fleet_risk_v1(p_run_id uuid, p_snapshot jsonb, p_error text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
SET timezone = 'UTC'
AS $function$
DECLARE
  v_row public.ship_fleet_risk_cache_v1%ROWTYPE;
  v_now timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_time timestamptz;
  v_count integer;
  v_reference integer;
  v_item jsonb;
  v_key text;
  v_imo text;
  v_seen text[] := ARRAY[]::text[];
  v_added text[] := ARRAY[]::text[];
  v_checksum integer;
  v_i integer;
  v_error text;
  v_iso constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
BEGIN
  IF p_run_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO STRICT v_row FROM public.ship_fleet_risk_cache_v1 WHERE company_imo = '0882415' FOR UPDATE;
  v_now := pg_catalog.clock_timestamp();
  IF v_row.attempt IS NULL OR v_row.attempt->>'id' <> p_run_id::text OR v_row.attempt->>'status' <> 'running'
    OR v_row.lease_expires_at <= v_now THEN RETURN false; END IF;
  IF p_snapshot IS NULL THEN
    -- Never publish raw upstream errors, URLs, headers, credentials or stack traces.
    v_error := CASE p_error
      WHEN 'timeout' THEN 'Fleet risk refresh timed out.'
      WHEN 'upstream_unavailable' THEN 'Public PSC source is unavailable.'
      WHEN 'rate_limited' THEN 'Public PSC source rate limit reached.'
      WHEN 'incomplete_snapshot' THEN 'Fleet risk refresh was incomplete.'
      WHEN 'invalid_snapshot' THEN 'Fleet risk refresh returned invalid data.'
      WHEN 'cancelled' THEN 'Fleet risk refresh was cancelled.'
      ELSE 'Fleet risk refresh failed.' END;
    UPDATE public.ship_fleet_risk_cache_v1 SET attempt = attempt || jsonb_build_object('status', 'failed',
      'completedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'error', v_error)
      WHERE company_imo = '0882415';
    RETURN true;
  END IF;
  IF p_error IS NOT NULL THEN RETURN false; END IF;
  -- All validation precedes the single publication UPDATE. Rejection changes nothing.
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT (p_snapshot ?& ARRAY['id','trigger','company','queryStartedAt','queryCompletedAt','rosterRetrievedAt','count','rows','coverage'])
    OR p_snapshot - ARRAY['id','trigger','company','queryStartedAt','queryCompletedAt','rosterRetrievedAt','count','rows','coverage'] <> '{}'::jsonb
    OR p_snapshot->>'id' IS DISTINCT FROM p_run_id::text
    OR p_snapshot->>'trigger' IS DISTINCT FROM v_row.attempt->>'trigger'
    OR p_snapshot->>'queryStartedAt' IS DISTINCT FROM v_row.attempt->>'startedAt'
    OR jsonb_typeof(p_snapshot->'company') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_snapshot->'rows') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_snapshot->'coverage') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_snapshot->'count') IS DISTINCT FROM 'number'
    OR (p_snapshot->>'count') !~ '^[1-9][0-9]{0,2}$' THEN RETURN false; END IF;
  v_count := (p_snapshot->>'count')::integer;
  IF v_count > 100 OR v_count <> jsonb_array_length(p_snapshot->'rows')
    OR ((v_row.attempt->>'total')::integer > 0 AND v_count <> (v_row.attempt->>'total')::integer)
    OR v_count < (v_row.attempt->>'done')::integer THEN RETURN false; END IF;
  v_item := p_snapshot->'company';
  IF NOT (v_item ?& ARRAY['name','imo','performance']) OR v_item - ARRAY['name','imo','performance'] <> '{}'::jsonb
    OR jsonb_typeof(v_item->'imo') IS DISTINCT FROM 'string' OR v_item->>'imo' IS DISTINCT FROM '0882415' THEN RETURN false; END IF;
  FOREACH v_key IN ARRAY ARRAY['name','performance'] LOOP
    IF jsonb_typeof(v_item->v_key) IS DISTINCT FROM 'string' OR (v_item->>v_key) !~ '[^[:space:]]' THEN RETURN false; END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['queryStartedAt','queryCompletedAt','rosterRetrievedAt'] LOOP
    IF jsonb_typeof(p_snapshot->v_key) IS DISTINCT FROM 'string' OR (p_snapshot->>v_key) !~ v_iso THEN RETURN false; END IF;
  END LOOP;
  v_start := (p_snapshot->>'queryStartedAt')::timestamptz;
  v_end := (p_snapshot->>'queryCompletedAt')::timestamptz;
  v_time := (p_snapshot->>'rosterRetrievedAt')::timestamptz;
  IF v_end < v_start OR v_end > v_now OR v_time < v_start OR v_time > v_end THEN RETURN false; END IF;
  v_item := p_snapshot->'coverage';
  IF NOT (v_item ?& ARRAY['referenceCount','missingReferenceImos','addedReferenceImos'])
    OR v_item - ARRAY['referenceCount','missingReferenceImos','addedReferenceImos'] <> '{}'::jsonb
    OR jsonb_typeof(v_item->'referenceCount') IS DISTINCT FROM 'number'
    OR (v_item->>'referenceCount') !~ '^(0|[1-9][0-9]{0,2})$'
    OR v_item->'missingReferenceImos' IS DISTINCT FROM '[]'::jsonb
    OR jsonb_typeof(v_item->'addedReferenceImos') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  v_reference := (v_item->>'referenceCount')::integer;
  IF v_reference > 100 OR v_reference + jsonb_array_length(v_item->'addedReferenceImos') <> v_count THEN RETURN false; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_snapshot->'rows') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF NOT (v_item ?& ARRAY['name','imo','retrievedAt','status','risk','priority','companyName','companyImo','windowFrom','windowTo','sourceUpdatedAt','sourceUrl'])
      OR v_item - ARRAY['name','imo','retrievedAt','status','risk','priority','companyName','companyImo','windowFrom','windowTo','sourceUpdatedAt','sourceUrl'] <> '{}'::jsonb THEN RETURN false; END IF;
    FOREACH v_key IN ARRAY ARRAY['name','imo','retrievedAt','status','risk','priority','companyName','companyImo','sourceUrl'] LOOP
      IF jsonb_typeof(v_item->v_key) IS DISTINCT FROM 'string' OR (v_item->>v_key) !~ '[^[:space:]]' THEN RETURN false; END IF;
    END LOOP;
    IF v_item->>'status' <> 'ok' OR v_item->>'risk' NOT IN ('HRS','SRS','LRS')
      OR v_item->>'priority' NOT IN ('Priority I','Priority II','No Priority')
      OR v_item->>'sourceUrl' <> 'https://apcis.tmou.org/public/'
      OR v_item->'sourceUpdatedAt' IS DISTINCT FROM 'null'::jsonb
      OR (v_item->>'companyImo') !~ '^[0-9]{7}$'
      OR jsonb_typeof(v_item->'windowFrom') NOT IN ('string','null')
      OR jsonb_typeof(v_item->'windowTo') NOT IN ('string','null')
      OR (v_item->>'retrievedAt') !~ v_iso THEN RETURN false; END IF;
    v_time := (v_item->>'retrievedAt')::timestamptz;
    IF v_time < v_start OR v_time > v_end THEN RETURN false; END IF;
    v_imo := v_item->>'imo';
    IF v_imo !~ '^[0-9]{7}$' OR v_imo = ANY(v_seen) THEN RETURN false; END IF;
    v_checksum := 0;
    FOR v_i IN 1..6 LOOP v_checksum := v_checksum + substr(v_imo, v_i, 1)::integer * (8 - v_i); END LOOP;
    IF v_checksum % 10 <> substr(v_imo, 7, 1)::integer THEN RETURN false; END IF;
    v_seen := array_append(v_seen, v_imo);
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_snapshot->'coverage'->'addedReferenceImos') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    v_imo := v_item #>> '{}';
    IF NOT (v_imo = ANY(v_seen)) OR v_imo = ANY(v_added) THEN RETURN false; END IF;
    v_added := array_append(v_added, v_imo);
  END LOOP;
  v_now := pg_catalog.clock_timestamp();
  IF v_row.lease_expires_at <= v_now THEN RETURN false; END IF;
  UPDATE public.ship_fleet_risk_cache_v1 SET snapshot = p_snapshot,
    attempt = attempt || jsonb_build_object('status', 'success', 'done', v_count, 'total', v_count,
      'completedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'error', NULL)
    WHERE company_imo = '0882415';
  RETURN true;
EXCEPTION
  WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION public.finish_ship_fleet_risk_v1(uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finish_ship_fleet_risk_v1(uuid, jsonb, text) TO service_role;

COMMIT;

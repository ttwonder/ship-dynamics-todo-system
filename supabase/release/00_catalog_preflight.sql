-- Ship Dynamics: metadata-only PRE-INSTALL inventory (not a migration).
-- Intended dashboard project: cyzpcvvhmoiihsqvjspp.
-- The project label below is NOT database proof; verify the dashboard separately.
-- Reads PostgreSQL catalogs only: no business rows, passwords, tokens or function bodies.
-- Returns one JSON cell. Export the complete result as CSV for comparison.
-- Do not append installation, cutover, pause or resume statements to this query.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

WITH
app_tables AS (
  SELECT c.*, n.nspname AS schema_name
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (
      (n.nspname = 'public' AND position('ship_dynamics' IN c.relname) > 0)
      OR left(n.nspname, 13) = 'ship_dynamics'
    )
),
app_functions AS (
  SELECT p.*, n.nspname AS schema_name, l.lanname AS language_name
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.prokind IN ('f', 'p')
    AND (
      (n.nspname = 'public' AND position('ship_dynamics' IN p.proname) > 0)
      OR left(n.nspname, 13) = 'ship_dynamics'
    )
),
report AS (
  SELECT jsonb_build_object(
    'report_kind', 'ship-dynamics-catalog-preflight-v1',
    'intended_project_ref', 'cyzpcvvhmoiihsqvjspp',
    'captured_at', transaction_timestamp(),
    'database_name', current_database(),
    'server_version', current_setting('server_version'),
    'transaction_read_only', current_setting('transaction_read_only'),
    'business_rows_read', false,
    'table_count', (SELECT count(*) FROM app_tables),
    'function_count', (SELECT count(*) FROM app_functions),
    'roles_present', (
      SELECT jsonb_object_agg(role_name, pg_catalog.to_regrole(role_name) IS NOT NULL)
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('authenticator')) r(role_name)
    ),
    'extensions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', extname, 'version', extversion) ORDER BY extname)
      FROM pg_catalog.pg_extension
    ), '[]'::jsonb),
    'tables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'schema', t.schema_name, 'name', t.relname, 'kind', t.relkind,
        'rls', t.relrowsecurity, 'force_rls', t.relforcerowsecurity,
        'acl', t.relacl::text,
        'columns', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', a.attname, 'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
            'not_null', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated
          ) ORDER BY a.attnum)
          FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
        ), '[]'::jsonb),
        'constraints', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', k.conname, 'type', k.contype, 'validated', k.convalidated,
            'definition_md5_lf', md5(replace(pg_catalog.pg_get_constraintdef(k.oid), chr(13), ''))
          ) ORDER BY k.conname)
          FROM pg_catalog.pg_constraint k WHERE k.conrelid = t.oid
        ), '[]'::jsonb),
        'policies', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', q.polname, 'command', q.polcmd, 'permissive', q.polpermissive,
            'role_oids', q.polroles::text,
            'using_md5_lf', md5(replace(pg_catalog.pg_get_expr(q.polqual, q.polrelid), chr(13), '')),
            'check_md5_lf', md5(replace(pg_catalog.pg_get_expr(q.polwithcheck, q.polrelid), chr(13), ''))
          ) ORDER BY q.polname)
          FROM pg_catalog.pg_policy q WHERE q.polrelid = t.oid
        ), '[]'::jsonb),
        'triggers', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', g.tgname, 'enabled', g.tgenabled,
            'function', g.tgfoid::regprocedure::text,
            'definition_md5_lf', md5(replace(pg_catalog.pg_get_triggerdef(g.oid), chr(13), ''))
          ) ORDER BY g.tgname)
          FROM pg_catalog.pg_trigger g WHERE g.tgrelid = t.oid AND NOT g.tgisinternal
        ), '[]'::jsonb)
      ) ORDER BY t.schema_name, t.relname) FROM app_tables t
    ), '[]'::jsonb),
    'functions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'schema', f.schema_name, 'name', f.proname,
        'identity_arguments', pg_catalog.pg_get_function_identity_arguments(f.oid),
        'returns', pg_catalog.pg_get_function_result(f.oid),
        'language', f.language_name, 'security_definer', f.prosecdef,
        'volatility', f.provolatile, 'strict', f.proisstrict,
        'acl', f.proacl::text,
        'search_path', (
          SELECT x FROM unnest(f.proconfig) x WHERE left(x, 12) = 'search_path=' LIMIT 1
        ),
        'body_md5_lf', md5(replace(f.prosrc, chr(13), '')),
        'definition_md5_lf', md5(replace(pg_catalog.pg_get_functiondef(f.oid), chr(13), '')),
        'anon_execute', pg_catalog.has_function_privilege(pg_catalog.to_regrole('anon'), f.oid, 'EXECUTE'),
        'authenticated_execute', pg_catalog.has_function_privilege(pg_catalog.to_regrole('authenticated'), f.oid, 'EXECUTE'),
        'service_role_execute', pg_catalog.has_function_privilege(pg_catalog.to_regrole('service_role'), f.oid, 'EXECUTE')
      ) ORDER BY f.schema_name, f.proname, pg_catalog.pg_get_function_identity_arguments(f.oid))
      FROM app_functions f
    ), '[]'::jsonb),
    'publications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'publication', p.pubname, 'schema', p.schemaname, 'table', p.tablename
      ) ORDER BY p.pubname, p.schemaname, p.tablename)
      FROM pg_catalog.pg_publication_tables p
      WHERE EXISTS (SELECT 1 FROM app_tables t WHERE t.schema_name = p.schemaname AND t.relname = p.tablename)
    ), '[]'::jsonb)
  ) AS preflight
)
SELECT preflight FROM report;
ROLLBACK;

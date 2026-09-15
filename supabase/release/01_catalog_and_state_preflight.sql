-- Ship Dynamics: expanded catalog + non-secret PRE-INSTALL state (not a migration).
-- Intended dashboard project: cyzpcvvhmoiihsqvjspp.
-- The project label below is NOT database proof; verify the dashboard separately.
-- Includes sd_ objects and whitelisted state/counts. Never exports business bodies, passwords or tokens.
-- query_to_xml executes only the fixed SELECT strings below; missing tables/columns are reported, not guessed.
-- This is an observed snapshot, NOT a future cutover token or proof that login/save works.
-- Returns one JSON cell. Export the complete result as CSV for comparison.
-- Do not append installation, cutover, pause or resume statements to this query.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

WITH
app_tables AS (
  SELECT c.*, n.nspname AS schema_name
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (
      (n.nspname = 'public' AND (position('ship_dynamics' IN c.relname) > 0 OR left(c.relname, 3) = 'sd_'))
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
      (n.nspname = 'public' AND (position('ship_dynamics' IN p.proname) > 0 OR p.proname ~ '(^|_)sd_'))
      OR left(n.nspname, 13) = 'ship_dynamics'
    )
),
state_specs(name, relation_name, required_columns, read_sql) AS (
  VALUES
    ('legacy_summary','public.ship_dynamics_app_state',ARRAY['workspace_key','payload','revision','updated_at']::text[],'select coalesce(jsonb_agg(jsonb_build_object(
 ''workspace_key'',s.workspace_key,''revision'',s.revision,''updated_at'',s.updated_at,
 ''payload_type'',jsonb_typeof(s.payload),
 ''payload_bytes'',octet_length(s.payload::text),
 ''payload_sha256'',encode(sha256(convert_to(s.payload::text,''UTF8'')),''hex''),
 ''top_level_types'',(select coalesce(jsonb_object_agg(k,jsonb_typeof(v)),''{}''::jsonb) from jsonb_each(case when jsonb_typeof(s.payload)=''object'' then s.payload else ''{}''::jsonb end) e(k,v)),
 ''collection_counts'',(select coalesce(jsonb_object_agg(k,jsonb_array_length(v)),''{}''::jsonb) from jsonb_each(case when jsonb_typeof(s.payload)=''object'' then s.payload else ''{}''::jsonb end) e(k,v) where jsonb_typeof(v)=''array''),
 ''raw_active_owner_count'',(select count(*) from jsonb_array_elements(case when jsonb_typeof(s.payload->''users'')=''array'' then s.payload->''users'' else ''[]''::jsonb end) u where u->>''role''=''owner'' and u->''isActive''=''true''::jsonb),
 ''raw_user_count'',(select count(*) from jsonb_array_elements(case when jsonb_typeof(s.payload->''users'')=''array'' then s.payload->''users'' else ''[]''::jsonb end) u)
) order by s.workspace_key),''[]''::jsonb) as value from public.ship_dynamics_app_state s'),
    ('normalized_workspaces','public.sd_workspaces',ARRAY['id','legacy_key','is_active']::text[],'select coalesce(jsonb_agg(jsonb_build_object(''id'',j->''id'',''legacy_key'',j->''legacy_key'',''is_active'',j->''is_active'') order by j->>''workspace_key'',j->>''workspace_id'',j->>''id'',j->>''transition_id''),''[]''::jsonb) as value from (select to_jsonb(t) j from "public"."sd_workspaces" t) s'),
    ('normalized_memberships','public.sd_memberships',ARRAY['workspace_id','role','is_active']::text[],'select coalesce(jsonb_agg(to_jsonb(q) order by q.workspace_id,q.role,q.is_active),''[]''::jsonb) as value from (select workspace_id,role,is_active,count(*) as row_count from public.sd_memberships group by workspace_id,role,is_active) q'),
    ('legacy_freeze_controls','public.sd_legacy_write_controls',ARRAY['workspace_key','writes_frozen','expected_revision','payload_sha256','restore_in_progress','frozen_at','updated_at']::text[],'select coalesce(jsonb_agg(jsonb_build_object(''workspace_key'',j->''workspace_key'',''writes_frozen'',j->''writes_frozen'',''expected_revision'',j->''expected_revision'',''payload_sha256'',j->''payload_sha256'',''restore_in_progress'',j->''restore_in_progress'',''frozen_at'',j->''frozen_at'',''updated_at'',j->''updated_at'') order by j->>''workspace_key'',j->>''workspace_id'',j->>''id'',j->>''transition_id''),''[]''::jsonb) as value from (select to_jsonb(t) j from "public"."sd_legacy_write_controls" t) s'),
    ('legacy_import_receipts','public.sd_legacy_imports',ARRAY['workspace_id','legacy_revision','payload_sha256','quarantine_count','imported_at']::text[],'select coalesce(jsonb_agg(jsonb_build_object(''workspace_id'',j->''workspace_id'',''legacy_revision'',j->''legacy_revision'',''payload_sha256'',j->''payload_sha256'',''quarantine_count'',j->''quarantine_count'',''imported_at'',j->''imported_at'') order by j->>''workspace_key'',j->>''workspace_id'',j->>''id'',j->>''transition_id''),''[]''::jsonb) as value from (select to_jsonb(t) j from "public"."sd_legacy_imports" t) s'),
    ('record_workspaces','public.ship_dynamics_record_workspaces',ARRAY['workspace_key','revision','updated_at']::text[],'select coalesce(jsonb_agg(jsonb_build_object(''workspace_key'',j->''workspace_key'',''revision'',j->''revision'',''updated_at'',j->''updated_at'') order by j->>''workspace_key'',j->>''workspace_id'',j->>''id'',j->>''transition_id''),''[]''::jsonb) as value from (select to_jsonb(t) j from "public"."ship_dynamics_record_workspaces" t) s'),
    ('source_authority','ship_dynamics_authority_private.current_v1',ARRAY['workspace_key','workspace_id','epoch','source','publication_id','transition_id','phase']::text[],'select coalesce(jsonb_agg(jsonb_build_object(''workspace_key'',j->''workspace_key'',''workspace_id'',j->''workspace_id'',''epoch'',j->''epoch'',''source'',j->''source'',''publication_id'',j->''publication_id'',''transition_id'',j->''transition_id'',''phase'',j->''phase'') order by j->>''workspace_key'',j->>''workspace_id'',j->>''id'',j->>''transition_id''),''[]''::jsonb) as value from (select to_jsonb(t) j from "ship_dynamics_authority_private"."current_v1" t) s'),
    ('quiescence_bindings','ship_dynamics_quiescence_private.workspaces',ARRAY['workspace_key','workspace_id','transition_id']::text[],'select coalesce(jsonb_agg(jsonb_build_object(''workspace_key'',j->''workspace_key'',''workspace_id'',j->''workspace_id'',''transition_id'',j->''transition_id'') order by j->>''workspace_key'',j->>''workspace_id'',j->>''id'',j->>''transition_id''),''[]''::jsonb) as value from (select to_jsonb(t) j from "ship_dynamics_quiescence_private"."workspaces" t) s'),
    ('quiescence_transitions','ship_dynamics_quiescence_private.transitions',ARRAY['workspace_key','transition_id','state']::text[],'select coalesce(jsonb_agg(jsonb_build_object(''workspace_key'',j->''workspace_key'',''transition_id'',j->''transition_id'',''state'',j->''state'') order by j->>''workspace_key'',j->>''workspace_id'',j->>''id'',j->>''transition_id''),''[]''::jsonb) as value from (select to_jsonb(t) j from "ship_dynamics_quiescence_private"."transitions" t) s'),
    ('normalized_operations','public.sd_operations',ARRAY['workspace_id','status']::text[],'select coalesce(jsonb_agg(to_jsonb(q) order by q.workspace_id,q.status),''[]''::jsonb) as value from (select workspace_id,status,count(*) as row_count from "public"."sd_operations" group by workspace_id,status) q'),
    ('normalized_reservations','public.sd_operation_reservations',ARRAY['workspace_id','status']::text[],'select coalesce(jsonb_agg(to_jsonb(q) order by q.workspace_id,q.status),''[]''::jsonb) as value from (select workspace_id,status,count(*) as row_count from "public"."sd_operation_reservations" group by workspace_id,status) q'),
    ('legacy_data_management_operations','public.ship_dynamics_data_management_operations',ARRAY['workspace_key','status']::text[],'select coalesce(jsonb_agg(to_jsonb(q) order by q.workspace_key,q.status),''[]''::jsonb) as value from (select workspace_key,status,count(*) as row_count from "public"."ship_dynamics_data_management_operations" group by workspace_key,status) q'),
    ('migration_quarantine','public.sd_migration_quarantine',ARRAY['workspace_id','resolution']::text[],'select coalesce(jsonb_agg(to_jsonb(q) order by q.workspace_id,q.resolution),''[]''::jsonb) as value from (select workspace_id,resolution,count(*) as row_count from public.sd_migration_quarantine group by workspace_id,resolution) q'),
    ('itinerary_rollout','public.sd_itinerary_rollout',ARRAY['workspace_id','main_enabled','ship_portal_enabled','version']::text[],'select coalesce(jsonb_agg(jsonb_build_object(''workspace_id'',j->''workspace_id'',''main_enabled'',j->''main_enabled'',''ship_portal_enabled'',j->''ship_portal_enabled'',''version'',j->''version'') order by j->>''workspace_key'',j->>''workspace_id'',j->>''id'',j->>''transition_id''),''[]''::jsonb) as value from (select to_jsonb(t) j from "public"."sd_itinerary_rollout" t) s'),
    ('itinerary_documents','public.sd_itinerary_documents',ARRAY['workspace_id','vessel_id','revision','rows_payload','updated_at']::text[],'select coalesce(jsonb_agg(jsonb_build_object(
 ''workspace_id'',j->''workspace_id'',''vessel_id'',j->''vessel_id'',''revision'',j->''revision'',''updated_at'',j->''updated_at'',
 ''formal_rows_type'',jsonb_typeof(j->''rows_payload''),
 ''formal_rows_count'',case when jsonb_typeof(j->''rows_payload'')=''array'' then jsonb_array_length(j->''rows_payload'') else null end,
 ''alternatives_type'',jsonb_typeof(j->''alternative_plans_payload''),
 ''alternatives_count'',case when jsonb_typeof(j->''alternative_plans_payload'')=''array'' then jsonb_array_length(j->''alternative_plans_payload'') else null end
) order by j->>''workspace_id'',j->>''vessel_id''),''[]''::jsonb) as value from (select to_jsonb(t) j from public.sd_itinerary_documents t) s'),
    ('legacy_edit_locks','public.ship_dynamics_edit_locks',ARRAY['workspace_key','expires_at']::text[],'select coalesce(jsonb_agg(to_jsonb(q) order by q.workspace_key),''[]''::jsonb) as value from (select workspace_key,count(*) as stored_count,count(*) filter(where expires_at>transaction_timestamp()) as unexpired_count from "public"."ship_dynamics_edit_locks" group by workspace_key) q'),
    ('normalized_edit_leases','public.sd_edit_leases',ARRAY['workspace_id','expires_at']::text[],'select coalesce(jsonb_agg(to_jsonb(q) order by q.workspace_id),''[]''::jsonb) as value from (select workspace_id,count(*) as stored_count,count(*) filter(where expires_at>transaction_timestamp()) as unexpired_count from "public"."sd_edit_leases" group by workspace_id) q'),
    ('itinerary_leases','public.sd_itinerary_leases',ARRAY['workspace_id','expires_at']::text[],'select coalesce(jsonb_agg(to_jsonb(q) order by q.workspace_id),''[]''::jsonb) as value from (select workspace_id,count(*) as stored_count,count(*) filter(where expires_at>transaction_timestamp()) as unexpired_count from "public"."sd_itinerary_leases" group by workspace_id) q'),
    ('itinerary_scheduler_jobs','cron.job',ARRAY['jobid','jobname','schedule','active','command']::text[],'select coalesce(jsonb_agg(jsonb_build_object(''jobid'',jobid,''jobname'',jobname,''schedule'',schedule,''active'',active,''command_md5_lf'',md5(replace(command,chr(13),''''))) order by jobid),''[]''::jsonb) as value from cron.job where position(''ship_dynamics'' in command)>0 or position(''sd_itinerary'' in command)>0')
),
state_availability AS (
  SELECT s.*, pg_catalog.to_regclass(s.relation_name) AS relation_oid,
    ARRAY(SELECT required_name FROM unnest(s.required_columns) required_name
      WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = pg_catalog.to_regclass(s.relation_name)
          AND a.attname = required_name AND a.attnum > 0 AND NOT a.attisdropped)
      ORDER BY required_name) AS missing_columns
  FROM state_specs s
),
state_results AS (
  SELECT a.name, jsonb_build_object(
    'relation', a.relation_name,
    'status', CASE WHEN a.relation_oid IS NULL THEN 'not_installed'
      WHEN cardinality(a.missing_columns)>0 THEN 'schema_mismatch' ELSE 'read' END,
    'missing_columns', to_jsonb(a.missing_columns),
    'data', CASE WHEN a.relation_oid IS NOT NULL AND cardinality(a.missing_columns)=0 THEN (
      SELECT x.value::jsonb FROM XMLTABLE('/row'
        PASSING pg_catalog.query_to_xml(a.read_sql, false, true, '')
        COLUMNS value text PATH 'value') AS x
    ) ELSE NULL END
  ) AS value FROM state_availability a
),
report AS (
  SELECT jsonb_build_object(
    'report_kind', 'ship-dynamics-catalog-state-preflight-v2',
    'intended_project_ref', 'cyzpcvvhmoiihsqvjspp',
    'captured_at', transaction_timestamp(),
    'database_name', current_database(),
    'server_version', current_setting('server_version'),
    'transaction_read_only', current_setting('transaction_read_only'),
    'transaction_isolation', current_setting('transaction_isolation'),
    'business_payloads_exported', false,
    'state_spec_count', (SELECT count(*) FROM state_specs),
    'state', (SELECT jsonb_object_agg(name,value ORDER BY name) FROM state_results),
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

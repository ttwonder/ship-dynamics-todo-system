-- Ship Dynamics: small PRE-INSTALL backup seed, NOT installation or cutover.
-- This first packet contains CURRENT app_state rows + complete app row inventory
-- and app table/function definitions. History bodies are NOT in this first packet.
-- Confidential download: keep the original CSV local, outside Git and chat.
-- PGP is used ONLY as a ZIP compression envelope with a PUBLIC constant.
-- It provides NO confidentiality. The constant is NOT a database password.
-- No extensions, helpers, tables, snapshots or locks are installed/modified.
-- Later batches and a fresh matching manifest are required for completeness.
-- This is NOT a frozen cutover checkpoint and NOT a whole Supabase backup.
-- Target label: cyzpcvvhmoiihsqvjspp; verify the dashboard project independently.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '1s';
SET LOCAL work_mem = '16MB';
SET LOCAL max_parallel_workers_per_gather = 0;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';

WITH
reader AS MATERIALIZED (
  SELECT current_user::text AS role_name,
    coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user),false) AS bypass_rls
),
crypto AS MATERIALIZED (
  SELECT n.nspname AS schema_name
  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
  JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname='pgp_sym_encrypt'
    AND p.proargtypes='25 25 25'::oidvector
  WHERE e.extname='pgcrypto' AND has_function_privilege(p.oid,'EXECUTE')
),
all_app_relations AS MATERIALIZED (
  SELECT c.oid,c.relkind,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner,c.relacl,
    n.nspname AS schema_name,c.relispartition,
    EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inherited
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','f') AND
    ((n.nspname='public' AND (position('ship_dynamics' IN c.relname)>0 OR left(c.relname,3)='sd_'))
     OR left(n.nspname,13)='ship_dynamics')
),
guard AS MATERIALIZED (
  SELECT r.*,
    (SELECT count(*) FROM public.sd_workspaces WHERE legacy_key='ship-dynamics-main'
      AND id='2ae6e674-21ba-520c-93db-8cea28e84dd0'::uuid)=1 AS workspace_matches,
    (SELECT count(*) FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main')=1 AS source_exists,
    (SELECT count(*) FROM crypto)=1 AS compression_available,
    NOT EXISTS(SELECT 1 FROM all_app_relations WHERE relkind<>'r' OR relispartition OR inherited) AS supported_relations
  FROM reader r
),
allowed AS MATERIALIZED (
  SELECT *,bypass_rls AND workspace_matches AND source_exists AND compression_available AND supported_relations
    AND current_setting('transaction_read_only')='on'
    AND current_setting('transaction_isolation')='repeatable read' AS ok
  FROM guard
),
-- Only tuple locators/version stamps are read here: no history payload columns.
-- The cap prevents an unexpected relation from creating an unbounded inventory.
row_inventories AS MATERIALIZED (
  SELECT t.*,x.content::jsonb AS rows
  FROM all_app_relations t CROSS JOIN allowed a
  CROSS JOIN LATERAL XMLTABLE('/table/row' PASSING
    CASE WHEN a.ok THEN query_to_xml(format(
      'SELECT coalesce(jsonb_agg(jsonb_build_object(''ctid'',q.ctid::text,''xmin'',q.xmin::text) ORDER BY q.ctid),''[]''::jsonb) AS content FROM (SELECT ctid,xmin FROM ONLY %I.%I LIMIT 20001) q',
      t.schema_name,t.relname),false,false,'') ELSE '<empty/>'::xml END
    COLUMNS content text PATH 'content') x
  WHERE a.ok
),
table_manifest AS MATERIALIZED (
  SELECT jsonb_build_object(
    'schema',t.schema_name,'name',t.relname,'oid',t.oid,'relfilenode',pg_relation_filenode(t.oid),
    'owner',pg_get_userbyid(t.relowner),'acl',t.relacl::text,
    'rls',t.relrowsecurity,'force_rls',t.relforcerowsecurity,
    'row_count',jsonb_array_length(t.rows),'rows',t.rows,
    'row_versions_sha256',encode(sha256(convert_to(t.rows::text,'UTF8')),'hex'),
    'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name',c.attname,'position',c.attnum,'type',format_type(c.atttypid,c.atttypmod),
      'not_null',c.attnotnull,'identity',c.attidentity,'generated',c.attgenerated,
      'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.attnum),'[]'::jsonb)
      FROM pg_attribute c LEFT JOIN pg_attrdef d ON d.adrelid=c.attrelid AND d.adnum=c.attnum
      WHERE c.attrelid=t.oid AND c.attnum>0 AND NOT c.attisdropped),
    'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid,true)) ORDER BY c.conname),'[]'::jsonb) FROM pg_constraint c WHERE c.conrelid=t.oid),
    'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',i.indexname,'definition',i.indexdef) ORDER BY i.indexname),'[]'::jsonb) FROM pg_indexes i WHERE i.schemaname=t.schema_name AND i.tablename=t.relname),
    'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',g.tgname,'enabled',g.tgenabled,'definition',pg_get_triggerdef(g.oid,true)) ORDER BY g.tgname),'[]'::jsonb) FROM pg_trigger g WHERE g.tgrelid=t.oid AND NOT g.tgisinternal),
    'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.policyname),'[]'::jsonb) FROM pg_policies p WHERE p.schemaname=t.schema_name AND p.tablename=t.relname)
  ) AS value,t.schema_name,t.relname
  FROM row_inventories t
),
function_manifest AS MATERIALIZED (
  SELECT jsonb_build_object('schema',n.nspname,'name',p.proname,'oid',p.oid,
    'identity_arguments',pg_get_function_identity_arguments(p.oid),
    'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
    'definition',pg_get_functiondef(p.oid),
    'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) AS value,
    n.nspname,p.proname,p.oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN allowed a
  WHERE a.ok AND p.prokind IN ('f','p') AND
    ((n.nspname='public' AND (position('ship_dynamics' IN p.proname)>0 OR p.proname ~ '(^|_)sd_'))
     OR left(n.nspname,13)='ship_dynamics')
),
manifest AS MATERIALIZED (
  SELECT jsonb_build_object(
    'table_count',(SELECT count(*) FROM table_manifest),
    'row_count',(SELECT coalesce(sum(jsonb_array_length(rows)),0) FROM row_inventories),
    'tables',(SELECT coalesce(jsonb_agg(value ORDER BY schema_name,relname),'[]'::jsonb) FROM table_manifest),
    'function_count',(SELECT count(*) FROM function_manifest),
    'functions',(SELECT coalesce(jsonb_agg(value ORDER BY nspname,proname,oid),'[]'::jsonb) FROM function_manifest)
  ) AS value
),
-- Only CURRENT state rows are measured; wide history is never serialized here.
core_sizes AS MATERIALIZED (
  SELECT x.content::jsonb AS sizes
  FROM allowed a CROSS JOIN LATERAL XMLTABLE('/table/row' PASSING
    CASE WHEN a.ok AND (SELECT coalesce(max(jsonb_array_length(rows)),0) FROM row_inventories)<=20000
      AND (SELECT octet_length(value::text) FROM manifest)<=4194304
      AND (SELECT jsonb_array_length(rows) FROM row_inventories WHERE schema_name='public' AND relname='ship_dynamics_app_state')<=2
    THEN query_to_xml('SELECT coalesce(jsonb_agg(jsonb_build_object(''ctid'',ctid::text,''xmin'',xmin::text,''raw_bytes'',octet_length(to_jsonb(t)::text)) ORDER BY ctid),''[]''::jsonb) AS content FROM ONLY public.ship_dynamics_app_state t',false,false,'')
    ELSE '<empty/>'::xml END
    COLUMNS content text PATH 'content') x
),
core_allowed AS MATERIALIZED (
  SELECT a.*,
    a.ok AND (SELECT coalesce(max(jsonb_array_length(rows)),0) FROM row_inventories)<=20000
      AND (SELECT octet_length(value::text) FROM manifest)<=4194304
      AND (SELECT jsonb_array_length(rows) FROM row_inventories WHERE schema_name='public' AND relname='ship_dynamics_app_state')<=2
      AND coalesce((SELECT sum((e->>'raw_bytes')::bigint) FROM core_sizes s CROSS JOIN LATERAL jsonb_array_elements(s.sizes) e),8388609)<=8388608 AS export_ok
  FROM allowed a
),
-- Compression occurs per current row before any aggregate/materialization.
-- Only compact encoded results are collected; never sort full JSON payloads.
core_rows AS MATERIALIZED (
  SELECT x.content::jsonb AS value
  FROM core_allowed a CROSS JOIN LATERAL XMLTABLE('/table/row' PASSING
    CASE WHEN a.export_ok THEN query_to_xml(format(
      'SELECT jsonb_build_object(''schema'',''public'',''name'',''ship_dynamics_app_state'',''ctid'',t.ctid::text,''xmin'',t.xmin::text,''raw_bytes'',octet_length(to_jsonb(t)::text),''row_json_sha256'',encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex''),''encoded'',replace(encode(%I.pgp_sym_encrypt(to_jsonb(t)::text,''SHIP-DYNAMICS-PUBLIC-COMPRESSION-WRAPPER-V1-NOT-A-SECRET'',''compress-algo=1,compress-level=6,cipher-algo=aes128,s2k-mode=0''),''base64''),chr(10),'''')) AS content FROM ONLY public.ship_dynamics_app_state t',
      (SELECT schema_name FROM crypto)),false,false,'') ELSE '<empty/>'::xml END
    COLUMNS content text PATH 'content') x
),
packet AS MATERIALIZED (
  SELECT jsonb_build_object(
    'artifact','SHIP_DYNAMICS_BOUNDED_BACKUP_SEED_V1',
    'status',CASE WHEN a.export_ok THEN 'SEED_EXPORTED' ELSE 'STOP_AUTHORITY_SCHEMA_EXTENSION_OR_SIZE_CHECK' END,
    'intended_project_label','cyzpcvvhmoiihsqvjspp',
    'workspace_key','ship-dynamics-main','workspace_id','2ae6e674-21ba-520c-93db-8cea28e84dd0',
    'captured_at',transaction_timestamp(),'snapshot',txid_current_snapshot()::text,
    'server_version',current_setting('server_version'),
    'transaction_read_only',current_setting('transaction_read_only'),
    'transaction_isolation',current_setting('transaction_isolation'),
    'reader_context',jsonb_build_object('current_role',a.role_name,'bypass_rls',a.bypass_rls),
    'source_revision',CASE WHEN a.export_ok THEN (SELECT revision FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main') END,
    'manifest',CASE WHEN a.export_ok THEN m.value END,
    'manifest_sha256',CASE WHEN a.export_ok THEN encode(sha256(convert_to(m.value::text,'UTF8')),'hex') END,
    'compression_format','PUBLIC_PGP_ZIP_WRAPPER_V1_NOT_CONFIDENTIALITY_ENCRYPTION',
    'core_rows',(SELECT coalesce(jsonb_agg(value ORDER BY value->>'ctid'),'[]'::jsonb) FROM core_rows),
    'complete_application_backup',false,'frozen_cutover_checkpoint',false,
    'history_bodies_exported',false,'one_click_restore',false,
    'excludes',jsonb_build_array('other app table bodies until later verified batches','Supabase Auth','Storage files','provider-managed objects','roles','sequences','cron.job/scheduler state','complete executable DDL restore script'),
    'limits',jsonb_build_object('rows_per_table_inventory',20000,'core_rows',2,'core_raw_bytes',8388608,'manifest_bytes',4194304,'packet_bytes',8388608)
  ) AS value
  FROM core_allowed a CROSS JOIN manifest m
),
bounded AS MATERIALIZED (
  SELECT CASE WHEN octet_length(value::text)<=8388608 THEN value ELSE
    jsonb_build_object('artifact','SHIP_DYNAMICS_BOUNDED_BACKUP_SEED_V1','status','STOP_PACKET_SIZE','manifest',null,'core_rows','[]'::jsonb,'complete_application_backup',false) END AS value
  FROM packet
)
SELECT jsonb_build_object('packet_json',value::text,'packet_bytes',octet_length(value::text),
  'packet_sha256',encode(sha256(convert_to(value::text,'UTF8')),'hex'),
  'end_marker','SHIP_BACKUP_PACKET_END_V1') AS backup_packet
FROM bounded;
ROLLBACK;

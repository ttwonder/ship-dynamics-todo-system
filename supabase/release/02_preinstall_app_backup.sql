-- Ship Dynamics PRE-INSTALL application-data/definition backup; NOT an installer.
-- Contains confidential business data and may contain credential hashes/secrets.
-- Keep the exported CSV private and local; never commit it or paste its contents.
-- Scope: all app-owned public/private tables and app function definitions.
-- Does NOT back up Supabase Auth, Storage, extensions, or the entire database.
-- This snapshot is NOT a future cutover token and NOT a one-click restore script.
-- Intended project: cyzpcvvhmoiihsqvjspp (label, not database identity proof).
-- The project must also be checked in the Supabase dashboard.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

with
reader as materialized (
  select current_user::text as role_name,
         coalesce((select rolsuper or rolbypassrls from pg_roles where rolname=current_user),false) as bypass_rls
),
guard as materialized (
  select r.*,
         (select count(*) from public.sd_workspaces
          where legacy_key='ship-dynamics-main'
            and id='2ae6e674-21ba-520c-93db-8cea28e84dd0'::uuid)=1 as workspace_matches,
         (select count(*) from public.ship_dynamics_app_state
          where workspace_key='ship-dynamics-main')=1 as source_exists
  from reader r
),
allow_export as materialized (
  select *,bypass_rls and workspace_matches and source_exists
         and current_setting('transaction_read_only')='on'
         and current_setting('transaction_isolation')='repeatable read' as allowed
  from guard
),
app_tables as materialized (
  select c.oid,n.nspname as schema_name,c.relname as table_name,
         c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
         pg_get_userbyid(c.relowner) as owner,c.relacl::text as acl
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  cross join allow_export a
  where a.allowed and c.relkind in ('r','p') and
    ((n.nspname='public' and (position('ship_dynamics' in c.relname)>0 or left(c.relname,3)='sd_'))
     or left(n.nspname,13)='ship_dynamics')
),
table_rows as materialized (
  select t.*,x.content::jsonb as data
  from app_tables t
  cross join lateral xmltable('/row'
    passing query_to_xml(format(
      'select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) as content from %I.%I t',
      t.schema_name,t.table_name),false,true,'')
    columns content text path 'content') as x
),
table_backups as materialized (
  select jsonb_build_object(
    'schema',t.schema_name,'name',t.table_name,'owner',t.owner,'acl',t.acl,
    'rls',t.rls,'force_rls',t.force_rls,
    'columns',(select coalesce(jsonb_agg(jsonb_build_object(
      'name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
      'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
      'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum),'[]'::jsonb)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid,true)) order by c.conname),'[]'::jsonb) from pg_constraint c where c.conrelid=t.oid),
    'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',i.indexname,'definition',i.indexdef) order by i.indexname),'[]'::jsonb) from pg_indexes i where i.schemaname=t.schema_name and i.tablename=t.table_name),
    'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',g.tgname,'enabled',g.tgenabled,'definition',pg_get_triggerdef(g.oid,true)) order by g.tgname),'[]'::jsonb) from pg_trigger g where g.tgrelid=t.oid and not g.tgisinternal),
    'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]'::jsonb) from pg_policies p where p.schemaname=t.schema_name and p.tablename=t.table_name),
    'row_count',jsonb_array_length(t.data),
    'data_sha256',encode(sha256(convert_to(t.data::text,'UTF8')),'hex'),
    'data',t.data
  ) as value,t.schema_name,t.table_name
  from table_rows t
),
function_backups as materialized (
  select jsonb_build_object(
    'schema',n.nspname,'name',p.proname,
    'identity_arguments',pg_get_function_identity_arguments(p.oid),
    'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
    'definition',pg_get_functiondef(p.oid),
    'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
    'body_md5_lf',md5(replace(p.prosrc,chr(13),''))
  ) as value,n.nspname,p.proname,p.oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join allow_export a
  where a.allowed and p.prokind in ('f','p') and
    ((n.nspname='public' and (position('ship_dynamics' in p.proname)>0 or p.proname ~ '(^|_)sd_'))
     or left(n.nspname,13)='ship_dynamics')
)
select jsonb_build_object(
  'artifact','SHIP_DYNAMICS_PREINSTALL_APP_BACKUP_V1',
  'status',case when a.allowed then 'BACKUP_EXPORTED' else 'STOP_NOT_AN_AUTHORITATIVE_BACKUP' end,
  'intended_project_label','cyzpcvvhmoiihsqvjspp',
  'workspace_key','ship-dynamics-main',
  'workspace_id','2ae6e674-21ba-520c-93db-8cea28e84dd0',
  'captured_at',transaction_timestamp(),
  'snapshot',txid_current_snapshot()::text,
  'server_version',current_setting('server_version'),
  'transaction_read_only',current_setting('transaction_read_only'),
  'transaction_isolation',current_setting('transaction_isolation'),
  'reader_context',jsonb_build_object('current_role',a.role_name,'bypass_rls',a.bypass_rls),
  'workspace_matches',a.workspace_matches,'source_exists',a.source_exists,
  'scope','ALL_APP_TABLE_ROWS_AND_APP_FUNCTION_DEFINITIONS_NOT_FULL_DATABASE',
  'excludes',jsonb_build_array('Supabase Auth','Supabase Storage','provider extensions','cron.job and scheduler state','database roles and complete DDL restore script'),
  'contains_confidential_data',true,'one_click_restore',false,
  'table_count',(select count(*) from table_backups),
  'function_count',(select count(*) from function_backups),
  'total_table_rows',(select coalesce(sum((value->>'row_count')::bigint),0) from table_backups),
  'tables',(select coalesce(jsonb_agg(value order by schema_name,table_name),'[]'::jsonb) from table_backups),
  'functions',(select coalesce(jsonb_agg(value order by nspname,proname,oid),'[]'::jsonb) from function_backups)
) as backup_json
from allow_export a;
commit;

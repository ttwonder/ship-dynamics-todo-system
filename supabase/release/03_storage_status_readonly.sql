-- Ship Dynamics: lightweight storage/status diagnostic after SQLSTATE 53100.
-- READ ONLY. No business payload export, full-history scan/sort, cleanup, or writes.
-- Intended project label cyzpcvvhmoiihsqvjspp; also verify the dashboard project.
-- File-size/statistics metadata cannot prove filesystem free space or successful saves.
begin transaction read only;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
with app_tables as materialized (
  select n.nspname as schema_name,c.relname as table_name,
    pg_total_relation_size(c.oid) as total_bytes,
    pg_table_size(c.oid) as table_including_toast_bytes,
    pg_indexes_size(c.oid) as indexes_bytes,
    c.reltuples::bigint as estimated_rows,
    s.n_live_tup as stats_estimated_live_rows,s.n_dead_tup as stats_estimated_dead_rows,
    s.last_analyze,s.last_autoanalyze
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  left join pg_stat_user_tables s on s.relid=c.oid
  where c.relkind in ('r','p') and
    ((n.nspname='public' and (position('ship_dynamics' in c.relname)>0 or left(c.relname,3)='sd_'))
      or left(n.nspname,13)='ship_dynamics')
), temp_listing as materialized (
  -- Defer the privileged directory function until AFTER its privilege check.
  -- A CASE around a FROM-function subplan still checks its ACL during plan init.
  select x.content::jsonb as value from xmltable('/row'
    passing query_to_xml(case
      when coalesce(has_function_privilege(current_user,to_regprocedure('pg_catalog.pg_ls_tmpdir(oid)'),'EXECUTE'),false)
      then format('select jsonb_build_object(''status'',''READ'',''file_count'',count(*),''bytes'',coalesce(sum(size),0),''oldest_modified'',min(modification)) as content from pg_catalog.pg_ls_tmpdir(%s::oid)',
        (select dattablespace from pg_database where datname=current_database()))
      else 'select ''{"status":"NOT_AUTHORIZED"}''::jsonb as content'
    end,false,true,'') columns content text path 'content') x
), activity as materialized (
  select pid,state,wait_event_type,wait_event,backend_type,
    extract(epoch from (clock_timestamp()-query_start))::bigint as query_age_seconds,
    extract(epoch from (clock_timestamp()-xact_start))::bigint as transaction_age_seconds,
    position('SHIP_DYNAMICS_PREINSTALL_APP_BACKUP_V1' in query)>0 as references_backup_marker
  from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
    and (state='active' or state like 'idle in transaction%')
)
select jsonb_build_object(
  'artifact','SHIP_DYNAMICS_STORAGE_STATUS_READONLY_V1',
  'captured_at',clock_timestamp(),'intended_project_label','cyzpcvvhmoiihsqvjspp',
  'server_version',current_setting('server_version'),
  'reader_context',jsonb_build_object('current_role',current_user,
    'bypass_rls',(select rolsuper or rolbypassrls from pg_roles where rolname=current_user)),
  'transaction_read_only',current_setting('transaction_read_only'),
  'session_default_transaction_read_only',current_setting('default_transaction_read_only'),
  'read_only_overrides',(select coalesce(jsonb_agg(jsonb_build_object(
    'database',case when s.setdatabase=0 then 'ALL' else d.datname end,
    'role',case when s.setrole=0 then 'ALL' else r.rolname end,'setting',v.setting)),'[]'::jsonb)
    from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase
    left join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig) v(setting)
    where (s.setdatabase=0 or d.datname=current_database()) and split_part(v.setting,'=',1)='default_transaction_read_only'),
  'database_bytes',pg_database_size(current_database()),
  'work_mem',current_setting('work_mem'),'temp_file_limit',current_setting('temp_file_limit'),
  'temp_cumulative_stats',(select jsonb_build_object('temp_files',temp_files,'temp_bytes',temp_bytes,'stats_reset',stats_reset,
    'note','Cumulative since stats reset; NOT current temporary disk usage') from pg_stat_database where datname=current_database()),
  'default_tablespace_temp_listing',(select value from temp_listing),
  'filesystem_free_bytes',null,'successful_business_save_verified',false,
  'limits_note','File listing is only the default tablespace. Disk free capacity requires provider metrics. Dashboard metrics may lag. No business save was attempted.',
  'legacy_head',(select jsonb_build_object('workspace_key',workspace_key,'revision',revision,'updated_at',updated_at)
    from public.ship_dynamics_app_state where workspace_key='ship-dynamics-main' limit 1),
  'app_table_count',(select count(*) from app_tables),
  'app_tables',(select coalesce(jsonb_agg(to_jsonb(t) order by total_bytes desc,schema_name,table_name),'[]'::jsonb) from app_tables t),
  'active_or_open_transaction_count',(select count(*) from activity),
  'activity_sample_limit',20,
  'activity_sample',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from
    (select * from activity order by transaction_age_seconds desc nulls last,query_age_seconds desc nulls last limit 20) t),
  'business_payloads_exported',false
) as storage_status;
commit;

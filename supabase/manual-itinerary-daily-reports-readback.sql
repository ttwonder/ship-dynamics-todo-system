-- Read-only verification for the manual Itinerary snapshot rollout.
-- Expected: exactly one row, exactly 38 columns, every value = true.
with target_functions(function_name) as (
  values
    ('sd_build_daily_itinerary_report_snapshot'),
    ('sd_generate_daily_itinerary_report'),
    ('ship_dynamics_run_daily_itinerary_reports'),
    ('sd_itinerary_daily_report_set_token'),
    ('sd_itinerary_daily_report_list'),
    ('sd_itinerary_daily_report_locate'),
    ('sd_itinerary_daily_report_load'),
    ('delete_sd_itinerary_daily_reports'),
    ('sd_save_manual_itinerary_report'),
    ('sd_itinerary_daily_report_list_v2'),
    ('sd_itinerary_daily_report_locate_v2'),
    ('sd_itinerary_daily_report_load_by_id'),
    ('delete_sd_itinerary_daily_report_records')
), function_catalog as (
  select procedure.*
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid=procedure.pronamespace
  join target_functions target on target.function_name=procedure.proname
  where namespace.nspname='public'
), function_source as (
  select proname, lower(prosrc) as source
  from function_catalog
)
select
  to_regclass('public.sd_itinerary_daily_reports') is not null
    as report_table_exists,
  to_regclass('public.sd_itinerary_daily_report_operations') is not null
    as operation_table_exists,
  coalesce((select attribute.attnotnull from pg_attribute attribute where attribute.attrelid='public.sd_itinerary_daily_reports'::regclass and attribute.attname='report_id' and not attribute.attisdropped),false)
    as report_id_not_null,
  exists(select 1 from pg_constraint constraint_row where constraint_row.conrelid='public.sd_itinerary_daily_reports'::regclass and constraint_row.contype='p' and pg_get_constraintdef(constraint_row.oid)='PRIMARY KEY (report_id)')
    as report_id_primary_key,
  coalesce((select attribute.attnotnull from pg_attribute attribute where attribute.attrelid='public.sd_itinerary_daily_reports'::regclass and attribute.attname='generated_by' and not attribute.attisdropped),false)
    as generated_by_not_null,
  exists(select 1 from pg_constraint constraint_row where constraint_row.conrelid='public.sd_itinerary_daily_reports'::regclass and constraint_row.conname='sd_itinerary_daily_reports_generated_by_check' and lower(pg_get_constraintdef(constraint_row.oid)) like '%scheduled%' and lower(pg_get_constraintdef(constraint_row.oid)) like '%manual%')
    as generated_by_check_present,
  exists(select 1 from pg_constraint constraint_row where constraint_row.conrelid='public.sd_itinerary_daily_reports'::regclass and constraint_row.conname='sd_itinerary_daily_reports_manual_provenance_check' and lower(pg_get_constraintdef(constraint_row.oid)) like '%generated_by_actor_id%' and lower(pg_get_constraintdef(constraint_row.oid)) like '%operation_id%')
    as manual_provenance_check_present,
  exists(select 1 from pg_indexes index_row where index_row.schemaname='public' and index_row.indexname='sd_itinerary_daily_reports_one_scheduled_per_day_idx' and lower(index_row.indexdef) like 'create unique index%' and lower(index_row.indexdef) like '%generated_by = ''scheduled''%')
    as scheduled_daily_unique_index,
  exists(select 1 from pg_indexes index_row where index_row.schemaname='public' and index_row.indexname='sd_itinerary_daily_reports_manual_operation_idx' and lower(index_row.indexdef) like 'create unique index%' and lower(index_row.indexdef) like '%operation_id is not null%')
    as manual_operation_unique_index,
  exists(select 1 from pg_constraint constraint_row where constraint_row.conrelid='public.sd_itinerary_daily_report_operations'::regclass and constraint_row.conname='sd_itinerary_daily_report_operations_command_type_check' and lower(pg_get_constraintdef(constraint_row.oid)) like '%save_manual_itinerary_report%' and lower(pg_get_constraintdef(constraint_row.oid)) like '%delete_daily_itinerary_report_records%' and lower(pg_get_constraintdef(constraint_row.oid)) like '%delete_daily_itinerary_reports%')
    as operation_command_check_complete,
  ((select class.relrowsecurity from pg_class class where class.oid='public.sd_itinerary_daily_reports'::regclass)
    and (select class.relrowsecurity from pg_class class where class.oid='public.sd_itinerary_daily_report_operations'::regclass))
    as report_tables_rls_enabled,
  ((select count(*) from function_catalog)=13 and (select count(distinct proname) from function_catalog)=13)
    as security_function_catalog_complete,
  coalesce((select bool_and(prosecdef) from function_catalog),false)
    as all_report_functions_security_definer,
  coalesce((select bool_and('search_path=""'=any(coalesce(proconfig,array[]::text[]))) from function_catalog),false)
    as all_report_functions_empty_search_path,
  not exists(
    select 1 from function_catalog function_row
    cross join lateral aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) acl
    where acl.grantee=0 and acl.privilege_type='EXECUTE'
  )
    as no_public_execute_on_report_functions,
  coalesce((select position('sd_itinerary_daily_report_operations' in source)>0 and position('save_manual_itinerary_report' in source)>0 and position('status=''committed''' in replace(source,' ',''))>0 from function_source where proname='sd_save_manual_itinerary_report'),false)
    as manual_save_uses_durable_ledger,
  coalesce((select position('select * into operation_row' in source)>0 and position('v_actor := public.sd_itinerary_main_actor' in source)>position('select * into operation_row' in source) from function_source where proname='delete_sd_itinerary_daily_reports'),false)
    as legacy_delete_status_first,
  coalesce((select position('generated_by = ''scheduled''' in source)>0 from function_source where proname='delete_sd_itinerary_daily_reports'),false)
    as legacy_delete_scheduled_only,
  coalesce((select position('generated_by = ''scheduled''' in source)>0 from function_source where proname='sd_itinerary_daily_report_list'),false)
    as legacy_list_scheduled_only,
  coalesce((select position('generated_by = ''scheduled''' in source)>0 from function_source where proname='sd_itinerary_daily_report_locate'),false)
    as legacy_locate_scheduled_only,
  coalesce((select position('generated_by = ''scheduled''' in source)>0 from function_source where proname='sd_itinerary_daily_report_load'),false)
    as legacy_load_scheduled_only,
  coalesce((select position('''scheduled''' in source)>0 and position('on conflict' in source)>0 from function_source where proname='sd_generate_daily_itinerary_report'),false)
    as scheduled_generator_idempotent_marker,
  coalesce((select position('select distinct candidate.business_date' in source)>0 and position('limit v_page_size' in source)>0 from function_source where proname='sd_itinerary_daily_report_list_v2'),false)
    as v2_list_distinct_date_paging,
  coalesce((select position('count(distinct report.business_date)' in source)>0 from function_source where proname='sd_itinerary_daily_report_locate_v2'),false)
    as v2_locate_distinct_date_paging,
  coalesce((select position('report.report_id = p_report_id' in source)>0 from function_source where proname='sd_itinerary_daily_report_load_by_id'),false)
    as v2_load_uses_report_id,
  coalesce((select position('report.report_id in (' in source)>0 and position('jsonb_array_elements_text(normalized_delete)' in source)>0 from function_source where proname='delete_sd_itinerary_daily_report_records'),false)
    as v2_delete_uses_exact_report_ids,
  (has_function_privilege('anon','public.sd_itinerary_daily_report_list_v2(text,text,integer,integer)','EXECUTE') and has_function_privilege('authenticated','public.sd_itinerary_daily_report_list_v2(text,text,integer,integer)','EXECUTE'))
    as v2_list_browser_grant,
  (has_function_privilege('anon','public.sd_itinerary_daily_report_locate_v2(text,date,text,integer)','EXECUTE') and has_function_privilege('authenticated','public.sd_itinerary_daily_report_locate_v2(text,date,text,integer)','EXECUTE'))
    as v2_locate_browser_grant,
  (has_function_privilege('anon','public.sd_itinerary_daily_report_load_by_id(text,bigint,text)','EXECUTE') and has_function_privilege('authenticated','public.sd_itinerary_daily_report_load_by_id(text,bigint,text)','EXECUTE'))
    as v2_load_browser_grant,
  (has_function_privilege('anon','public.sd_save_manual_itinerary_report(text,text,uuid)','EXECUTE') and has_function_privilege('authenticated','public.sd_save_manual_itinerary_report(text,text,uuid)','EXECUTE'))
    as manual_save_browser_grant,
  (has_function_privilege('anon','public.delete_sd_itinerary_daily_report_records(text,text,uuid,text,jsonb)','EXECUTE') and has_function_privilege('authenticated','public.delete_sd_itinerary_daily_report_records(text,text,uuid,text,jsonb)','EXECUTE'))
    as v2_delete_browser_grant,
  (has_function_privilege('anon','public.sd_itinerary_daily_report_list(text,text,integer,integer)','EXECUTE') and has_function_privilege('authenticated','public.sd_itinerary_daily_report_list(text,text,integer,integer)','EXECUTE'))
    as legacy_list_browser_grant,
  (has_function_privilege('anon','public.sd_itinerary_daily_report_locate(text,date,text,integer)','EXECUTE') and has_function_privilege('authenticated','public.sd_itinerary_daily_report_locate(text,date,text,integer)','EXECUTE'))
    as legacy_locate_browser_grant,
  (has_function_privilege('anon','public.sd_itinerary_daily_report_load(text,date,text)','EXECUTE') and has_function_privilege('authenticated','public.sd_itinerary_daily_report_load(text,date,text)','EXECUTE'))
    as legacy_load_browser_grant,
  (has_function_privilege('anon','public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb)','EXECUTE') and has_function_privilege('authenticated','public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb)','EXECUTE'))
    as legacy_delete_browser_grant,
  has_function_privilege('service_role','public.ship_dynamics_run_daily_itinerary_reports()','EXECUTE')
    as scheduler_service_role_grant,
  not (
    has_table_privilege('anon','public.sd_itinerary_daily_reports','SELECT') or has_table_privilege('anon','public.sd_itinerary_daily_reports','INSERT') or has_table_privilege('anon','public.sd_itinerary_daily_reports','UPDATE') or has_table_privilege('anon','public.sd_itinerary_daily_reports','DELETE') or
    has_table_privilege('authenticated','public.sd_itinerary_daily_reports','SELECT') or has_table_privilege('authenticated','public.sd_itinerary_daily_reports','INSERT') or has_table_privilege('authenticated','public.sd_itinerary_daily_reports','UPDATE') or has_table_privilege('authenticated','public.sd_itinerary_daily_reports','DELETE')
  )
    as no_browser_report_table_privileges,
  not (
    has_table_privilege('anon','public.sd_itinerary_daily_report_operations','SELECT') or has_table_privilege('anon','public.sd_itinerary_daily_report_operations','INSERT') or has_table_privilege('anon','public.sd_itinerary_daily_report_operations','UPDATE') or has_table_privilege('anon','public.sd_itinerary_daily_report_operations','DELETE') or
    has_table_privilege('authenticated','public.sd_itinerary_daily_report_operations','SELECT') or has_table_privilege('authenticated','public.sd_itinerary_daily_report_operations','INSERT') or has_table_privilege('authenticated','public.sd_itinerary_daily_report_operations','UPDATE') or has_table_privilege('authenticated','public.sd_itinerary_daily_report_operations','DELETE')
  )
    as no_browser_operation_table_privileges;

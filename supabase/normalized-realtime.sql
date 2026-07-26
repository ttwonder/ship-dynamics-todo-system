begin;

-- Realtime carries invalidation hints only. Browser clients must refetch through
-- RLS-protected reads and must never apply event row payloads directly.
do $$
declare
  v_table text;
  v_tables text[] := array[
    'sd_workspaces',
    'sd_profiles',
    'sd_memberships',
    'sd_vessels',
    'sd_vessel_assignments',
    'sd_tasks',
    'sd_task_vessels',
    'sd_task_categories',
    'sd_task_departments',
    'sd_task_owners',
    'sd_task_type_scopes',
    'sd_task_status_events',
    'sd_task_vessel_status_events',
    'sd_meetings',
    'sd_meeting_vessels',
    'sd_meeting_type_scopes',
    'sd_meeting_departments',
    'sd_meeting_participants',
    'sd_meeting_items',
    'sd_meeting_item_categories',
    'sd_meeting_status_events',
    'sd_meeting_status_event_corrections',
    'sd_internal_cases',
    'sd_internal_case_departments',
    'sd_internal_case_status_events',
    'sd_internal_case_task_links',
    'sd_notifications',
    'sd_saved_reports',
    'sd_saved_report_vessels',
    'sd_departments',
    'sd_category_options',
    'sd_priority_options',
    'sd_equipment_options',
    'sd_role_permissions',
    'sd_settings'
  ];
begin
  if not exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    raise exception using errcode='P0001', message='supabase-realtime-publication-missing';
  end if;
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I',v_table)) is null then
      raise exception using errcode='P0001', message='realtime-table-missing:'||v_table;
    end if;
    if not exists(
      select 1 from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I',v_table);
    end if;
  end loop;
end;
$$;

commit;

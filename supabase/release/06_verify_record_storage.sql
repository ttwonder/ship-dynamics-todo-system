-- INDEPENDENT READBACK. Run in a NEW SQL Editor query after 05.
-- Read-only metadata and the current legacy revision/hash; never returns payload.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
WITH expected(signature,args) AS (VALUES
('public.apply_ship_dynamics_block_patch(text, jsonb, text, text, jsonb, jsonb, jsonb)','p_workspace_key text, p_operations jsonb, p_saved_by text, p_actor_user_id text, p_actor_guard jsonb, p_authorization_guard jsonb, p_lock_guards jsonb'),
('public.apply_ship_dynamics_block_patch_v2(text, text, jsonb, text, text, jsonb, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_operations jsonb, p_saved_by text, p_actor_user_id text, p_actor_guard jsonb, p_authorization_guard jsonb, p_lock_guards jsonb'),
('public.apply_ship_dynamics_record_patch_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_operations jsonb, p_saved_by text, p_actor_user_id text, p_actor_guard jsonb, p_authorization_guard jsonb, p_lock_guards jsonb'),
('public.claim_ship_dynamics_edit_lock(text, text, text, text, integer)','p_workspace_key text, p_section_key text, p_locked_by text, p_locked_by_name text, p_ttl_seconds integer'),
('public.delete_sd_itinerary_daily_report_records(text, text, uuid, text, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_set_token text, p_delete_report_ids jsonb'),
('public.delete_sd_itinerary_daily_reports(text, text, uuid, text, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_set_token text, p_delete_dates jsonb'),
('public.get_ship_dynamics_block_patch_receipt(text, text, jsonb, text, text, jsonb, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_operations jsonb, p_saved_by text, p_actor_user_id text, p_actor_guard jsonb, p_authorization_guard jsonb, p_lock_guards jsonb'),
('public.get_ship_dynamics_record_receipt_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_operations jsonb, p_saved_by text, p_actor_user_id text, p_actor_guard jsonb, p_authorization_guard jsonb, p_lock_guards jsonb'),
('public.get_ship_dynamics_record_storage_stats_v1(text, text)','p_workspace_key text, p_actor_user_id text'),
('public.get_ship_dynamics_storage_stats(text, text)','p_workspace_key text, p_actor_user_id text'),
('public.get_ship_dynamics_task_member_receipt_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_task_id text, p_vessel_id text, p_command jsonb, p_expected jsonb, p_actor_user_id text, p_actor_guard jsonb, p_lock_guards jsonb'),
('public.prune_ship_dynamics_record_revision_history_v1(text, text, uuid, jsonb, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_revisions jsonb, p_delete_revisions jsonb'),
('public.prune_ship_dynamics_revision_history(text, text, uuid, jsonb, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_revisions jsonb, p_delete_revisions jsonb'),
('public.read_ship_dynamics_browser_authority_v1(text)','p_workspace_key text'),
('public.read_ship_dynamics_record_delta_v1(text, integer, text)','p_workspace_key text, p_base_revision integer, p_base_token text'),
('public.read_ship_dynamics_record_scopes_v1(text, text, jsonb, jsonb)','p_workspace_key text, p_scope text, p_versions jsonb, p_targets jsonb'),
('public.read_ship_dynamics_records_v1(text)','p_workspace_key text'),
('public.read_ship_dynamics_task_member_v1(text, text, text, text)','p_workspace_key text, p_task_id text, p_vessel_id text, p_actor_user_id text'),
('public.release_ship_dynamics_edit_lock(text, text, text)','p_workspace_key text, p_section_key text, p_locked_by text'),
('public.release_ship_dynamics_task_member_lock_v1(text, text, text, text)','p_workspace_key text, p_section_key text, p_locked_by text, p_lease_version text'),
('public.renew_ship_dynamics_edit_lock(text, text, text, integer)','p_workspace_key text, p_section_key text, p_locked_by text, p_ttl_seconds integer'),
('public.renew_ship_dynamics_task_member_lock_v1(text, text, text, text, integer)','p_workspace_key text, p_section_key text, p_locked_by text, p_lease_version text, p_ttl_seconds integer'),
('public.save_ship_dynamics_task_member_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_task_id text, p_vessel_id text, p_command jsonb, p_expected jsonb, p_actor_user_id text, p_actor_guard jsonb, p_lock_guards jsonb'),
('public.sd_itinerary_claim_public_lease(text, text, text, text, integer)','p_workspace_key text, p_vessel_id text, p_actor_key text, p_holder_session text, p_ttl_seconds integer'),
('public.sd_itinerary_daily_report_list_v2(text, text, integer, integer)','p_workspace_key text, p_actor_user_id text, p_page integer, p_page_size integer'),
('public.sd_itinerary_daily_report_load_by_id(text, bigint, text)','p_workspace_key text, p_report_id bigint, p_actor_user_id text'),
('public.sd_itinerary_daily_report_locate_v2(text, date, text, integer)','p_workspace_key text, p_business_date date, p_actor_user_id text, p_page_size integer'),
('public.sd_itinerary_main_claim_lease(text, text, text, text, integer, text)','p_workspace_key text, p_vessel_id text, p_holder_session text, p_holder_label text, p_ttl_seconds integer, p_actor_user_id text'),
('public.sd_itinerary_main_load_many(text, text[], text)','p_workspace_key text, p_vessel_ids text[], p_actor_user_id text'),
('public.sd_itinerary_main_operation_status(text, uuid, text)','p_workspace_key text, p_operation_id uuid, p_actor_user_id text'),
('public.sd_itinerary_main_release_lease(text, text, uuid, text, bigint, text)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_actor_user_id text'),
('public.sd_itinerary_main_renew_lease(text, text, uuid, text, bigint, integer, text)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_ttl_seconds integer, p_actor_user_id text'),
('public.sd_itinerary_main_save(text, text, bigint, uuid, jsonb, uuid, text, bigint, text, text, jsonb)','p_workspace_key text, p_vessel_id text, p_expected_revision bigint, p_operation_id uuid, p_rows jsonb, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_actor_label text, p_actor_user_id text, p_alternative_plans jsonb'),
('public.sd_itinerary_operation_status_public(text, uuid, text)','p_workspace_key text, p_operation_id uuid, p_actor_key text'),
('public.sd_itinerary_public_list_vessels(text)','p_workspace_key text'),
('public.sd_itinerary_public_load(text, text)','p_workspace_key text, p_vessel_id text'),
('public.sd_itinerary_record_claim_lease_v1(text, text, text, text, integer, text)','p_workspace_key text, p_vessel_id text, p_holder_session text, p_holder_label text, p_ttl_seconds integer, p_actor_user_id text'),
('public.sd_itinerary_record_load_many_v1(text, text[], text)','p_workspace_key text, p_vessel_ids text[], p_actor_user_id text'),
('public.sd_itinerary_record_operation_status_v1(text, uuid, text)','p_workspace_key text, p_operation_id uuid, p_actor_user_id text'),
('public.sd_itinerary_record_release_lease_v1(text, text, uuid, text, bigint, text)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_actor_user_id text'),
('public.sd_itinerary_record_renew_lease_v1(text, text, uuid, text, bigint, integer, text)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_ttl_seconds integer, p_actor_user_id text'),
('public.sd_itinerary_record_report_delete_dates_v1(text, text, uuid, text, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_set_token text, p_delete_dates jsonb'),
('public.sd_itinerary_record_report_delete_ids_v1(text, text, uuid, text, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_set_token text, p_delete_report_ids jsonb'),
('public.sd_itinerary_record_report_list_v1(text, text, integer, integer)','p_workspace_key text, p_actor_user_id text, p_page integer, p_page_size integer'),
('public.sd_itinerary_record_report_load_v1(text, bigint, text)','p_workspace_key text, p_report_id bigint, p_actor_user_id text'),
('public.sd_itinerary_record_report_locate_v1(text, date, text, integer)','p_workspace_key text, p_business_date date, p_actor_user_id text, p_page_size integer'),
('public.sd_itinerary_record_report_save_manual_v1(text, text, uuid)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid'),
('public.sd_itinerary_record_save_v1(text, text, bigint, uuid, jsonb, uuid, text, bigint, text, text, jsonb)','p_workspace_key text, p_vessel_id text, p_expected_revision bigint, p_operation_id uuid, p_rows jsonb, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_actor_label text, p_actor_user_id text, p_alternative_plans jsonb'),
('public.sd_itinerary_release_public_lease(text, text, uuid, text, text, bigint)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_actor_key text, p_holder_session text, p_fencing_token bigint'),
('public.sd_itinerary_renew_public_lease(text, text, uuid, text, text, bigint, integer)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_actor_key text, p_holder_session text, p_fencing_token bigint, p_ttl_seconds integer'),
('public.sd_itinerary_save_public(text, text, bigint, uuid, jsonb, uuid, text, text, bigint, jsonb)','p_workspace_key text, p_vessel_id text, p_expected_revision bigint, p_operation_id uuid, p_rows jsonb, p_lease_id uuid, p_actor_key text, p_holder_session text, p_fencing_token bigint, p_alternative_plans jsonb'),
('public.sd_save_manual_itinerary_report(text, text, uuid)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid')
), apis AS (
 SELECT e.signature,to_regprocedure(e.signature) IS NOT NULL AS present,
 pg_get_function_identity_arguments(to_regprocedure(e.signature))=e.args AS argument_names_match,
 has_function_privilege('anon',to_regprocedure(e.signature),'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',to_regprocedure(e.signature),'EXECUTE') AS authenticated_execute,
 p.prosecdef AS security_definer,ARRAY(SELECT setting FROM unnest(coalesce(p.proconfig,'{}'::text[])) setting WHERE setting LIKE 'search_path=%') AS search_path
 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
), data_privileges AS (
 SELECT c.relname,c.relrowsecurity AS rls,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') OR
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS browser_direct
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname ~ '^ship_dynamics_record'
)
SELECT jsonb_build_object(
 'kind','ship-record-install-readback-v1',
 'api_count',(SELECT count(*) FROM apis),
 'api_missing_or_invalid',(SELECT coalesce(jsonb_agg(signature),'[]'::jsonb) FROM apis WHERE NOT coalesce(present AND argument_names_match AND anon_execute AND authenticated_execute,true)),
 'api_details',(SELECT jsonb_agg(to_jsonb(a) ORDER BY signature) FROM apis a),
 'record_tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY relname) FROM data_privileges t),
 'record_tables_private',(SELECT count(*)>0 AND bool_and(rls AND NOT browser_direct) FROM data_privileges),
 'legacy_current',(SELECT jsonb_build_object('revision',revision,'payload_sha256',encode(sha256(convert_to(payload::text,'UTF8')),'hex')) FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main'),
 'workspace_binding',(SELECT jsonb_build_object('id',id,'legacy_key',legacy_key) FROM public.sd_workspaces WHERE legacy_key='ship-dynamics-main'),
 'production_write',false,
 'next','INSTALL_READBACK_ONLY_NOT_CUTOVER_APPROVAL'
) AS install_readback;
ROLLBACK;

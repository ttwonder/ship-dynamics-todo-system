-- READ ONLY: inspect state after the failed 05 installer. NOT permission to retry.
-- No function bodies, lock holders, credential values or business payloads returned.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
WITH object_flags AS (
 SELECT
 to_regclass('public.ship_dynamics_record_workspaces') IS NOT NULL AS record_workspaces,
 to_regclass('public.ship_dynamics_member_fences') IS NOT NULL AS member_fences,
 to_regclass('public.ship_dynamics_member_fence_seq') IS NOT NULL AS member_fence_sequence,
 to_regnamespace('ship_dynamics_quiescence_private') IS NOT NULL AS quiescence_schema,
 to_regnamespace('ship_dynamics_authority_private') IS NOT NULL AS authority_schema,
 EXISTS(SELECT FROM pg_attribute WHERE attrelid=to_regclass('public.ship_dynamics_edit_locks')
  AND attname='lease_version' AND attnum>0 AND NOT attisdropped) AS lock_lease_version,
 EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'ship\_dynamics\_record%' ESCAPE '\') AS any_record_table
), flags AS (
 SELECT *,record_workspaces OR member_fences OR member_fence_sequence OR quiescence_schema
  OR authority_schema OR lock_lease_version OR any_record_table AS any_addon_marker FROM object_flags
)
SELECT jsonb_build_object(
 'kind','ship-failed-install-readback-v1',
 'captured_at',transaction_timestamp(),
 'reader',current_user,
 'reader_bypasses_rls',(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user),
 'transaction_read_only',current_setting('transaction_read_only'),
 'classification',CASE WHEN any_addon_marker THEN 'ADDON_PRESENT_OR_PARTIAL_STOP'
  ELSE 'ADDON_MARKERS_ABSENT' END,
 'objects',(SELECT to_jsonb(f) FROM flags f),
 'public_app_table_count',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname ~ '^(ship_dynamics_|sd_)'),
 'legacy_current',(SELECT jsonb_build_object('revision',revision,'updated_at',updated_at,
  'payload_sha256',encode(sha256(convert_to(payload::text,'UTF8')),'hex'),
  'vessels',CASE WHEN jsonb_typeof(payload->'vessels')='array' THEN jsonb_array_length(payload->'vessels') END,
  'tasks',CASE WHEN jsonb_typeof(payload->'tasks')='array' THEN jsonb_array_length(payload->'tasks') END,
  'internal_control_cases',CASE WHEN jsonb_typeof(payload->'internalControlCases')='array' THEN jsonb_array_length(payload->'internalControlCases') END,
  'meetings',CASE WHEN jsonb_typeof(payload->'meetings')='array' THEN jsonb_array_length(payload->'meetings') END)
  FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main'),
 'workspace_binding',(SELECT jsonb_build_object('id',id,'legacy_key',legacy_key)
  FROM public.sd_workspaces WHERE legacy_key='ship-dynamics-main'),
 'edit_locks',(SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE expires_at>transaction_timestamp()))
  FROM public.ship_dynamics_edit_locks WHERE workspace_key='ship-dynamics-main'),
 'legacy_writes_frozen',(SELECT writes_frozen FROM public.sd_legacy_write_controls WHERE workspace_key='ship-dynamics-main'),
 'production_write',false,
 'next','READBACK_ONLY_NOT_RETRY_APPROVAL',
 'limitation','Absent markers are consistent with an uninstalled or rolled-back addon, not proof of every pre-run row or current website save health.'
) AS failed_install_readback FROM flags;
ROLLBACK;

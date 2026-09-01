-- Itinerary migration readback only. This query does not change data.
with expected_tables(name) as (
  values
    ('sd_itinerary_rollout'),
    ('sd_itinerary_role_permissions'),
    ('sd_itinerary_documents'),
    ('sd_itinerary_history'),
    ('sd_itinerary_leases'),
    ('sd_itinerary_operations')
),
expected_functions(signature) as (
  values
    ('sd_itinerary_get_rollout(text)'),
    ('sd_itinerary_get_office_entry(text,text)'),
    ('sd_itinerary_get_public_rollout(text)'),
    ('sd_itinerary_load_many(text,text[])'),
    ('sd_itinerary_public_list_vessels(text)'),
    ('sd_itinerary_public_load(text,text)'),
    ('sd_itinerary_claim_office_lease(text,text,text,text,integer)'),
    ('sd_itinerary_claim_public_lease(text,text,text,text,integer)'),
    ('sd_itinerary_renew_office_lease(text,text,uuid,text,bigint,integer)'),
    ('sd_itinerary_renew_public_lease(text,text,uuid,text,text,bigint,integer)'),
    ('sd_itinerary_release_office_lease(text,text,uuid,text,bigint)'),
    ('sd_itinerary_release_public_lease(text,text,uuid,text,text,bigint)'),
    ('sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)'),
    ('sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint)'),
    ('sd_itinerary_operation_status_office(text,uuid)'),
    ('sd_itinerary_operation_status_public(text,uuid,text)'),
    ('sd_itinerary_history(text,text,integer)'),
    ('sd_itinerary_owner_update_rollout(text,bigint,uuid,boolean,boolean,jsonb)'),
    ('sd_itinerary_utc_offset_valid(text)'),
    ('sd_itinerary_rows_valid(jsonb)')
),
table_receipt as (
  select jsonb_object_agg(name, to_regclass('public.' || name) is not null order by name) value
  from expected_tables
),
function_receipt as (
  select jsonb_object_agg(signature, to_regprocedure('public.' || signature) is not null order by signature) value
  from expected_functions
),
rollout_receipt as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'workspaceId', r.workspace_id,
    'workspaceKey', w.legacy_key,
    'mainEnabled', r.main_enabled,
    'shipPortalEnabled', r.ship_portal_enabled,
    'version', r.version
  ) order by w.legacy_key), '[]'::jsonb) value
  from public.sd_itinerary_rollout r
  join public.sd_workspaces w on w.id = r.workspace_id
),
privilege_receipt as (
  select jsonb_build_object(
    'anonDirectDocumentSelect', has_table_privilege('anon','public.sd_itinerary_documents','SELECT'),
    'authenticatedDirectDocumentSelect', has_table_privilege('authenticated','public.sd_itinerary_documents','SELECT'),
    'anonOfficeEntryExecute', has_function_privilege('anon','public.sd_itinerary_get_office_entry(text,text)','EXECUTE'),
    'anonPublicSaveExecute', has_function_privilege('anon','public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint)','EXECUTE'),
    'anonOfficeSaveExecute', has_function_privilege('anon','public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)','EXECUTE'),
    'authenticatedOfficeSaveExecute', has_function_privilege('authenticated','public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)','EXECUTE'),
    'anonOffsetValidatorExecute', has_function_privilege('anon','public.sd_itinerary_utc_offset_valid(text)','EXECUTE'),
    'authenticatedOffsetValidatorExecute', has_function_privilege('authenticated','public.sd_itinerary_utc_offset_valid(text)','EXECUTE'),
    'anonRowsValidatorExecute', has_function_privilege('anon','public.sd_itinerary_rows_valid(jsonb)','EXECUTE'),
    'authenticatedRowsValidatorExecute', has_function_privilege('authenticated','public.sd_itinerary_rows_valid(jsonb)','EXECUTE')
  ) value
),
offset_receipt as (
  select jsonb_build_object(
    'utcPlus8', public.sd_itinerary_utc_offset_valid('UTC+8'),
    'utcPlus5_30', public.sd_itinerary_utc_offset_valid('UTC+5:30'),
    'utcPlus5_45', public.sd_itinerary_utc_offset_valid('UTC+5:45'),
    'utcMinus6', public.sd_itinerary_utc_offset_valid('UTC-6'),
    'rejectOutOfRange', not public.sd_itinerary_utc_offset_valid('UTC+14:15'),
    'rejectNonQuarterHour', not public.sd_itinerary_utc_offset_valid('UTC+5:20')
  ) value
),
operation_fixture as (
  select jsonb_build_object(
    'rowId','readback-row','sortOrder',0,'voyageNumber','','portDockName','','operation','','cargoQuantityText','',
    'etaUtc',null,'etbUtc',null,'ldRateText','','etcUtc',null,'etdUtc',null,
    'arrivalDraftText','','departureDraftText','','arrivalRobText','','departureRobText','','portTimeZone','',
    'oceanDistanceNm',null,'speedKnots',null,'sailingHours',null,'berthWaitHours',null,'tanksText','',
    'operationQuantityMt',null,'operationRateMtPerHour',null,'operationHours',null,'departureBufferDays',null,
    'etaMode','manual','etbMode','manual','etcMode','manual','etdMode','manual'
  ) value
),
operation_receipt as (
  select jsonb_build_object(
    'toLoad', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','To Load'))),
    'toUnload', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','To Unload'))),
    'toLoadAndUnload', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','To Load / To Unload'))),
    'rejectUnknown', not public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','Unknown')))
  ) value
  from operation_fixture
),
vessel_name_receipt as (
  select jsonb_build_object(
    'activeVesselCount', (select count(*) from public.sd_vessels where is_active),
    'activeMissingFullNameCount', (select count(*) from public.sd_vessels where is_active and btrim(coalesce(full_name, '')) = ''),
    'publicListFullNameComplete', coalesce((
      select bool_and(item ? 'fullName' and btrim(coalesce(item->>'fullName', '')) <> '')
      from public.sd_itinerary_rollout r
      join public.sd_workspaces w on w.id = r.workspace_id
      cross join lateral jsonb_array_elements(public.sd_itinerary_public_list_vessels(w.legacy_key)) item
      where r.ship_portal_enabled
    ), true)
  ) value
)
select jsonb_build_object(
  'tables', (select value from table_receipt),
  'functions', (select value from function_receipt),
  'rollout', (select value from rollout_receipt),
  'privileges', (select value from privilege_receipt),
  'utcOffsets', (select value from offset_receipt),
  'operations', (select value from operation_receipt),
  'vesselNames', (select value from vessel_name_receipt),
  'documentCount', (select count(*) from public.sd_itinerary_documents),
  'historyCount', (select count(*) from public.sd_itinerary_history)
) as itinerary_readback;

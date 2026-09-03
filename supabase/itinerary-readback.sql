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
    ('sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint,jsonb)'),
    ('sd_itinerary_operation_status_office(text,uuid)'),
    ('sd_itinerary_operation_status_public(text,uuid,text)'),
    ('sd_itinerary_history(text,text,integer)'),
    ('sd_itinerary_owner_update_rollout(text,bigint,uuid,boolean,boolean,jsonb)'),
    ('sd_itinerary_main_actor(text,text)'),
    ('sd_itinerary_main_load_many(text,text[],text)'),
    ('sd_itinerary_main_claim_lease(text,text,text,text,integer,text)'),
    ('sd_itinerary_main_renew_lease(text,text,uuid,text,bigint,integer,text)'),
    ('sd_itinerary_main_release_lease(text,text,uuid,text,bigint,text)'),
    ('sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb)'),
    ('sd_itinerary_main_operation_status(text,uuid,text)'),
    ('sd_itinerary_utc_offset_valid(text)'),
    ('sd_itinerary_purpose_valid(text)'),
    ('sd_itinerary_rows_valid(jsonb)'),
    ('sd_itinerary_alternative_plans_valid(jsonb,jsonb)'),
    ('sd_itinerary_document_json(text,text,text,bigint,jsonb,jsonb,timestamptz,text,text)'),
    ('sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)')
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
    'workspaceRef', left(r.workspace_id::text, 8),
    'mainEnabled', r.main_enabled,
    'shipPortalEnabled', r.ship_portal_enabled,
    'permanentlyOpen', r.main_enabled and r.ship_portal_enabled,
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
    'mainRolloutAbsent', to_regprocedure('public.sd_itinerary_main_get_rollout(text,text,jsonb)') is null,
    'mainOwnerUpdateAbsent', to_regprocedure('public.sd_itinerary_main_owner_update_rollout(text,bigint,uuid,boolean,boolean,text,jsonb)') is null,
    'anonMainLoadExecute', has_function_privilege('anon','public.sd_itinerary_main_load_many(text,text[],text)','EXECUTE'),
    'anonMainSaveExecute', has_function_privilege('anon','public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb)','EXECUTE'),
    'anonMainActorHelperExecute', has_function_privilege('anon','public.sd_itinerary_main_actor(text,text)','EXECUTE'),
    'authenticatedMainSaveExecute', has_function_privilege('authenticated','public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb)','EXECUTE'),
    'authenticatedOwnerUpdateExecute', has_function_privilege('authenticated','public.sd_itinerary_owner_update_rollout(text,bigint,uuid,boolean,boolean,jsonb)','EXECUTE'),
    'anonPublicSaveExecute', has_function_privilege('anon','public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint,jsonb)','EXECUTE'),
    'anonOfficeSaveExecute', has_function_privilege('anon','public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)','EXECUTE'),
    'authenticatedOfficeSaveExecute', has_function_privilege('authenticated','public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)','EXECUTE'),
    'anonOffsetValidatorExecute', has_function_privilege('anon','public.sd_itinerary_utc_offset_valid(text)','EXECUTE'),
    'authenticatedOffsetValidatorExecute', has_function_privilege('authenticated','public.sd_itinerary_utc_offset_valid(text)','EXECUTE'),
    'anonPurposeValidatorExecute', has_function_privilege('anon','public.sd_itinerary_purpose_valid(text)','EXECUTE'),
    'authenticatedPurposeValidatorExecute', has_function_privilege('authenticated','public.sd_itinerary_purpose_valid(text)','EXECUTE'),
    'anonRowsValidatorExecute', has_function_privilege('anon','public.sd_itinerary_rows_valid(jsonb)','EXECUTE'),
    'authenticatedRowsValidatorExecute', has_function_privilege('authenticated','public.sd_itinerary_rows_valid(jsonb)','EXECUTE'),
    'anonAlternativeValidatorExecute', has_function_privilege('anon','public.sd_itinerary_alternative_plans_valid(jsonb,jsonb)','EXECUTE'),
    'authenticatedAlternativeValidatorExecute', has_function_privilege('authenticated','public.sd_itinerary_alternative_plans_valid(jsonb,jsonb)','EXECUTE'),
    'anonAlternativeDocumentBuilderExecute', has_function_privilege('anon','public.sd_itinerary_document_json(text,text,text,bigint,jsonb,jsonb,timestamptz,text,text)','EXECUTE'),
    'authenticatedAlternativeDocumentBuilderExecute', has_function_privilege('authenticated','public.sd_itinerary_document_json(text,text,text,bigint,jsonb,jsonb,timestamptz,text,text)','EXECUTE'),
    'anonAlternativeSaveInternalExecute', has_function_privilege('anon','public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)','EXECUTE'),
    'authenticatedAlternativeSaveInternalExecute', has_function_privilege('authenticated','public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)','EXECUTE')
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
purpose_fixture as (
  select jsonb_build_object(
    'rowId','readback-row','sortOrder',0,'voyageNumber','','portDockName','','operation','','cargoQuantityText','',
    'etaUtc',null,'etbUtc',null,'ldRateText','','etcUtc',null,'etdUtc',null,
    'arrivalDraftText','','departureDraftText','','arrivalRobText','','departureRobText','','portTimeZone','',
    'oceanDistanceNm',null,'speedKnots',null,'sailingHours',null,'berthWaitHours',null,'tanksText','',
    'operationQuantityMt',null,'operationRateMtPerHour',null,'operationHours',null,'departureBufferDays',null,
    'etaMode','manual','etbMode','manual','etcMode','manual','etdMode','manual'
  ) value
),
purpose_receipt as (
  select jsonb_build_object(
    'toLoad', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','To Load'))),
    'toUnload', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','To Unload'))),
    'docking', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','docking'))),
    'waitingOrder', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','waiting order'))),
    'repair', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','repair'))),
    'inspection', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','inspection'))),
    'combined', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','To Load / To Unload / docking / inspection'))),
    'rejectUnknown', not public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','Unknown'))),
    'rejectOutOfOrder', not public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','inspection / To Load'))),
    'rejectDuplicate', not public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('operation','repair / repair')))
  ) value
  from purpose_fixture
),
calculation_v2_fixture as (
  select value || jsonb_build_object(
    'operation','To Load / docking / inspection',
    'etaTimeZone','','etbTimeZone','UTC+9','etcTimeZone','UTC+8:45','etdTimeZone','UTC-6',
    'channelSailingHours',1,'preCompletionDelayHours',2,'postCompletionDelayHours',3,
    'calculationStartUtc','2026-08-31T00:00:00Z','calculationStartTimeZone','UTC+8',
    'portTimeZone','UTC+8','oceanDistanceNm',100,'speedKnots',12,'sailingHours',100::numeric / 12
  ) value
  from purpose_fixture
),
calculation_v2_receipt as (
  select jsonb_build_object(
    'acceptsCompleteV2', public.sd_itinerary_rows_valid(jsonb_build_array(value)),
    'acceptsLegacyV1', public.sd_itinerary_rows_valid(jsonb_build_array((select value from purpose_fixture))),
    'acceptsTwoRowsWithSingleAnchor', public.sd_itinerary_rows_valid(jsonb_build_array(
      value,
      value || jsonb_build_object('rowId','readback-row-2','sortOrder',1,'calculationStartUtc',null,'calculationStartTimeZone','')
    )),
    'rejectsLaterAnchor', not public.sd_itinerary_rows_valid(jsonb_build_array(
      value,
      value || jsonb_build_object('rowId','readback-row-2','sortOrder',1)
    )),
    'rejectsPartialV2', not public.sd_itinerary_rows_valid(jsonb_build_array(value - 'etdTimeZone')),
    'rejectsInvalidLtOffset', not public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('etbTimeZone','UTC+14:15'))),
    'rejectsRoundedSailingHours', not public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('sailingHours',9)))
  ) value
  from calculation_v2_fixture
),
notes_receipt as (
  select jsonb_build_object(
    'acceptsMissingNotes', public.sd_itinerary_rows_valid(jsonb_build_array(value)),
    'acceptsTextNotes', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('notesText','靠港前請再次確認'))),
    'rejectsNonTextNotes', not public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('notesText',42))),
    'rejectsOversizedNotes', not public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('notesText',repeat('N',1001))))
  ) value
  from calculation_v2_fixture
),
previous_port_receipt as (
  select jsonb_build_object(
    'acceptsMissingLegacyField', public.sd_itinerary_rows_valid(jsonb_build_array(value)),
    'acceptsFirstRowValue', public.sd_itinerary_rows_valid(jsonb_build_array(value || jsonb_build_object('previousPortName','BUSAN'))),
    'rejectsLaterRowValue', not public.sd_itinerary_rows_valid(jsonb_build_array(
      value || jsonb_build_object('previousPortName','BUSAN'),
      value || jsonb_build_object('rowId','readback-row-2','sortOrder',1,'calculationStartUtc',null,'calculationStartTimeZone','','previousPortName','WRONG ROW')
    )),
    'publicSaveRequiresValue', position('previous-port-required' in pg_get_functiondef('public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint,jsonb)'::regprocedure)) > 0,
    'publicSaveRejectsAllWhitespace', position('[^[:space:]]' in pg_get_functiondef('public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint,jsonb)'::regprocedure)) > 0
  ) value
  from calculation_v2_fixture
),
alternative_plan_receipt as (
  select jsonb_build_object(
    'documentsColumn', exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='sd_itinerary_documents'
        and column_name='alternative_plans_payload' and data_type='jsonb'
    ),
    'historyColumn', exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='sd_itinerary_history'
        and column_name='alternative_plans_payload' and data_type='jsonb'
    ),
    'acceptsEmpty', public.sd_itinerary_alternative_plans_valid(
      '[]'::jsonb,
      jsonb_build_array(value || jsonb_build_object('previousPortName','BUSAN'))
    ),
    'acceptsOne', public.sd_itinerary_alternative_plans_valid(
      jsonb_build_array(jsonb_build_object(
        'planId','readback-alternative-1','sortOrder',0,
        'rows',jsonb_build_array(value || jsonb_build_object('rowId','readback-alternative-row-1','previousPortName',''))
      )),
      jsonb_build_array(value || jsonb_build_object('previousPortName','BUSAN'))
    ),
    'rejectsSix', not public.sd_itinerary_alternative_plans_valid(
      (select jsonb_agg(jsonb_build_object(
        'planId','readback-alternative-' || i,'sortOrder',i,
        'rows',jsonb_build_array(value || jsonb_build_object('rowId','readback-alternative-row-' || i,'previousPortName',''))
      ) order by i) from generate_series(0,5) i),
      jsonb_build_array(value || jsonb_build_object('previousPortName','BUSAN'))
    ),
    'rejectsLongPlanId', not public.sd_itinerary_alternative_plans_valid(
      jsonb_build_array(jsonb_build_object(
        'planId',repeat('p',121),'sortOrder',0,
        'rows',jsonb_build_array(value || jsonb_build_object('rowId','readback-alternative-row-long','previousPortName',''))
      )),
      jsonb_build_array(value || jsonb_build_object('previousPortName','BUSAN'))
    ),
    'documentIncludesAlternatives', position('''alternativePlans''' in pg_get_functiondef(
      'public.sd_itinerary_document_json(text,text,text,bigint,jsonb,jsonb,timestamptz,text,text)'::regprocedure
    )) > 0,
    'currentSaveIncludesAlternatives', position('alternative_plans_payload' in pg_get_functiondef(
      'public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)'::regprocedure
    )) > 0,
    'preservesMissingAlternatives', pg_get_functiondef(
      'public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)'::regprocedure
    ) ~* 'case[[:space:]]+when[[:space:]]+p_alternative_plans[[:space:]]+is[[:space:]]+null',
    'rejectsOmittedAnchorChange', position('alternative-anchor-sync-required' in pg_get_functiondef(
      'public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)'::regprocedure
    )) > 0,
    'operationIdentityIncludesAlternatives', position('''alternativePlans'',p_alternative_plans' in regexp_replace(pg_get_functiondef(
      'public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)'::regprocedure
    ), '[[:space:]]', '', 'g')) > 0,
    'legacyEmptyReplayCompatible', position('v_request_matches' in pg_get_functiondef(
      'public.sd_itinerary_operation_replay(uuid,uuid,text,text,text,jsonb)'::regprocedure
    )) > 0
      and position('''alternativePlans''' in pg_get_functiondef(
        'public.sd_itinerary_operation_replay(uuid,uuid,text,text,text,jsonb)'::regprocedure
      )) > 0
      and position('''[]''' in pg_get_functiondef(
        'public.sd_itinerary_operation_replay(uuid,uuid,text,text,text,jsonb)'::regprocedure
      )) > 0,
    'historyIncludesAlternatives', position('''alternativePlans''' in pg_get_functiondef(
      'public.sd_itinerary_history(text,text,integer)'::regprocedure
    )) > 0
  ) value
  from calculation_v2_fixture
),
role_permission_receipt as (
  select jsonb_build_object(
    'workspaceCount', (select count(*) from public.sd_workspaces),
    'ownerFull', not exists (
      select 1
      from public.sd_workspaces w
      left join public.sd_itinerary_role_permissions p on p.workspace_id = w.id and p.role = 'owner'
      where not coalesce(p.can_view and p.can_edit and p.can_import and p.can_export and p.can_calendar, false)
    ),
    'adminFull', not exists (
      select 1
      from public.sd_workspaces w
      left join public.sd_itinerary_role_permissions p on p.workspace_id = w.id and p.role = 'admin'
      where not coalesce(p.can_view and p.can_edit and p.can_import and p.can_export and p.can_calendar, false)
    ),
    'operatorFull', not exists (
      select 1
      from public.sd_workspaces w
      left join public.sd_itinerary_role_permissions p on p.workspace_id = w.id and p.role = 'operator'
      where not coalesce(p.can_view and p.can_edit and p.can_import and p.can_export and p.can_calendar, false)
    ),
    'vesselFull', not exists (
      select 1
      from public.sd_workspaces w
      left join public.sd_itinerary_role_permissions p on p.workspace_id = w.id and p.role = 'vessel'
      where not coalesce(p.can_view and p.can_edit and p.can_import and p.can_export and p.can_calendar, false)
    )
  ) value
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
  'purposes', (select value from purpose_receipt),
  'calculationV2', (select value from calculation_v2_receipt),
  'notes', (select value from notes_receipt),
  'previousPortName', (select value from previous_port_receipt),
  'alternativePlans', (select value from alternative_plan_receipt),
  'officeRolePermissions', (select value from role_permission_receipt),
  'vesselNames', (select value from vessel_name_receipt),
  'documentCount', (select count(*) from public.sd_itinerary_documents),
  'historyCount', (select count(*) from public.sd_itinerary_history)
) as itinerary_readback;

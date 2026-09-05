import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ root:process.cwd(), server:{ middlewareMode:true }, appType:'custom', logLevel:'silent' });
const config = {
  supabaseUrl:'https://example.supabase.co', supabaseAnonKey:'public-anon-test-key',
  workspaceKey:'workspace-a', tableName:'ship_dynamics_app_state',
};
const token = '11111111111111111111111111111111';
const emptyToken = 'd41d8cd98f00b204e9800998ecf8427e';
const manualOperationId = '11111111-1111-4111-8111-111111111111';
const deleteOperationId = '22222222-2222-4222-8222-222222222222';
const legacyDeleteOperationId = '33333333-3333-4333-8333-333333333333';
const scheduledReports = Array.from({ length:30 }, (_, index) => ({
  reportId:String(index + 10),
  businessDate:new Date(Date.UTC(2026, 8, 4 - index)).toISOString().slice(0, 10),
  timezone:'Asia/Taipei', generatedAt:'2026-09-04T01:00:01Z', generatedBy:'scheduled',
  generatedByActorId:null, vesselCount:39, rowCount:88, sourceMaxRevision:14, logicalBytes:12345,
}));
const manualSummary = {
  reportId:'2', businessDate:'2026-09-04', timezone:'Asia/Taipei', generatedAt:'2026-09-04T02:15:00Z',
  generatedBy:'manual', generatedByActorId:'owner-1', vesselCount:39, rowCount:89,
  sourceMaxRevision:15, logicalBytes:12500,
};

try {
  const daily = await server.ssrLoadModule('/src/itineraryDailyReports.ts');
  const calls = [];
  const responses = {
    sd_itinerary_daily_report_list_v2: {
      ok:true, page:1, pageSize:30, pageCount:2, total:31, dateTotal:31, reportTotal:32,
      setToken:token, reports:[manualSummary, ...scheduledReports],
    },
    sd_itinerary_daily_report_locate_v2: {
      ok:true, found:true, businessDate:'2026-08-05', page:2, pageSize:30, setToken:token,
    },
    sd_itinerary_daily_report_load_by_id: {
      ok:true,
      report:{
        ...manualSummary, vesselCount:2, rowCount:1,
        snapshot:{
          schemaVersion:1, businessDate:'2026-09-04', timezone:'Asia/Taipei', generatedAt:'2026-09-04T02:15:00Z',
          vesselCount:2, rowCount:1, sourceMaxRevision:15,
          vessels:[
            { vesselId:'v1', vesselName:'FPMC ALPHA', revision:15, updatedAt:'2026-09-04T02:00:00Z', rows:[{ rowId:'row-1', sortOrder:0, portDockName:'KAOHSIUNG' }] },
            { vesselId:'v2', vesselName:'FPMC BETA', revision:0, updatedAt:null, rows:[] },
          ],
        },
      },
    },
    sd_save_manual_itinerary_report: {
      ok:true, created:true, operationId:manualOperationId,
      report:{ ...manualSummary, reportId:'42', generatedAt:'2026-09-04T03:30:00Z' },
    },
    delete_sd_itinerary_daily_report_records: {
      ok:true, operationId:deleteOperationId, deletedCount:1, deletedBytes:12500,
      deletedReportIds:['2'], remainingReportCount:31, remainingSetToken:emptyToken,
    },
    delete_sd_itinerary_daily_reports: {
      ok:true, operationId:legacyDeleteOperationId, deletedCount:1, deletedBytes:12345,
      deletedDates:['2026-09-04'], remainingReportCount:30, remainingSetToken:emptyToken,
    },
  };
  const client = {
    rpc(name, params) {
      calls.push({ name, params });
      return { abortSignal:async () => ({ data:responses[name], error:null }) };
    },
  };

  const page = await daily.listItineraryDailyReportPage('owner-1', 1, config, client);
  assert.equal(page.items.length, 31, 'thirty dates may contain more than thirty immutable snapshots');
  assert.equal(new Set(page.items.map(item => item.businessDate)).size, 30);
  assert.equal(page.items[0].reportId, '2');
  assert.equal(page.items[0].generatedBy, 'manual');
  assert.equal(page.dateTotal, 31);
  assert.equal(page.reportTotal, 32);
  assert.equal(Object.hasOwn(page.items[0], 'snapshot'), false);
  assert.deepEqual(calls[0], {
    name:'sd_itinerary_daily_report_list_v2',
    params:{ p_workspace_key:'workspace-a', p_actor_user_id:'owner-1', p_page:1, p_page_size:30 },
  });

  const location = await daily.locateItineraryDailyReport('2026-08-05', 'owner-1', config, client);
  assert.deepEqual({ found:location.found, page:location.page }, { found:true, page:2 });
  assert.equal(calls[1].name, 'sd_itinerary_daily_report_locate_v2');

  const report = await daily.loadItineraryDailyReport('2', 'owner-1', config, client);
  assert.equal(report.reportId, '2');
  assert.equal(report.snapshot.vessels[0].rows[0].portDockName, 'KAOHSIUNG');
  assert.equal(Object.hasOwn(report.snapshot.vessels[0], 'alternativePlans'), false);
  assert.deepEqual(calls[2], {
    name:'sd_itinerary_daily_report_load_by_id',
    params:{ p_workspace_key:'workspace-a', p_report_id:'2', p_actor_user_id:'owner-1' },
  });

  const manualPending = daily.createPendingManualItineraryReportSave({ operationId:manualOperationId, actorUserId:'owner-1' }, config, new Date('2026-09-04T03:00:00Z'));
  const saved = await daily.saveManualItineraryDailyReport(manualPending, config, client);
  assert.equal(saved.created, true);
  assert.equal(saved.report.reportId, '42');
  assert.deepEqual(calls[3], {
    name:'sd_save_manual_itinerary_report',
    params:{ p_workspace_key:'workspace-a', p_actor_user_id:'owner-1', p_operation_id:manualOperationId },
  });

  const memory = new Map();
  const storage = {
    getItem:key => memory.get(key) ?? null,
    setItem:(key,value) => memory.set(key,value),
    removeItem:key => memory.delete(key),
  };
  daily.writePendingManualItineraryReportSave(manualPending, config, storage);
  assert.deepEqual(daily.readPendingManualItineraryReportSave(config, 'owner-1', storage), manualPending);
  assert.equal(daily.readPendingManualItineraryReportSave({ ...config, workspaceKey:'workspace-b' }, 'owner-1', storage), null);
  const callsBeforeManualContextMismatch = calls.length;
  await assert.rejects(
    daily.saveManualItineraryDailyReport(manualPending, { ...config, workspaceKey:'workspace-b' }, client),
    error => error.code === 'MANUAL_SAVE_CONTEXT_CHANGED' && error.definitive === true,
  );
  assert.equal(calls.length, callsBeforeManualContextMismatch);
  daily.clearPendingManualItineraryReportSave(config, 'owner-1', storage);
  assert.equal(daily.readPendingManualItineraryReportSave(config, 'owner-1', storage), null);

  const deleteRequest = {
    operationId:deleteOperationId, actorUserId:'owner-1', expectedSetToken:token, deleteReportIds:['2'],
  };
  const deletePending = daily.createPendingItineraryDailyReportDelete(deleteRequest, config, new Date('2026-09-04T04:00:00Z'));
  const deleted = await daily.deleteItineraryDailyReports(deletePending, config, client);
  assert.deepEqual(deleted.deletedReportIds, ['2']);
  assert.equal(deletePending.version, 3);
  assert.deepEqual(calls[4], {
    name:'delete_sd_itinerary_daily_report_records',
    params:{
      p_workspace_key:'workspace-a', p_actor_user_id:'owner-1', p_operation_id:deleteOperationId,
      p_expected_set_token:token, p_delete_report_ids:['2'],
    },
  });
  daily.writePendingItineraryDailyReportDelete(deletePending, config, storage);
  assert.deepEqual(daily.readPendingItineraryDailyReportDelete(config, 'owner-1', storage), deletePending);
  assert.equal(daily.readPendingItineraryDailyReportDelete({ ...config, workspaceKey:'workspace-b' }, 'owner-1', storage), null);

  for (const tampered of [
    { ...deletePending, deleteReportIds:[...deletePending.deleteReportIds, 'not-an-id'] },
    { ...deletePending, deleteReportIds:[...deletePending.deleteReportIds, deletePending.deleteReportIds[0]] },
    { ...deletePending, expectedSetToken:'not-a-token' },
  ]) {
    const before = calls.length;
    await assert.rejects(
      daily.deleteItineraryDailyReports(tampered, config, client),
      error => error.code === 'INVALID_DELETE_ENVELOPE' && error.definitive === true,
    );
    assert.equal(calls.length, before);
  }

  const validReceipt = responses.delete_sd_itinerary_daily_report_records;
  for (const malformedCase of [
    { label:'invalid report id', receipt:{ ...validReceipt, deletedReportIds:['not-an-id'] } },
    { label:'duplicate report id', receipt:{ ...validReceipt, deletedReportIds:['2','2'], deletedCount:2 } },
    { label:'string deletedCount', receipt:{ ...validReceipt, deletedCount:'1' } },
    { label:'fractional deletedBytes', receipt:{ ...validReceipt, deletedBytes:1.5 } },
    { label:'negative remaining count', receipt:{ ...validReceipt, remainingReportCount:-1 } },
  ]) {
    const malformedClient = { rpc:() => ({ abortSignal:async () => ({ data:malformedCase.receipt, error:null }) }) };
    await assert.rejects(
      daily.deleteItineraryDailyReports(deletePending, config, malformedClient),
      error => error.code === 'INVALID_RESPONSE' && error.definitive === false,
      malformedCase.label,
    );
  }

  const legacyPending = {
    version:2,
    operationId:legacyDeleteOperationId,
    actorUserId:'owner-1',
    workspaceKey:deletePending.workspaceKey,
    configIdentity:deletePending.configIdentity,
    expectedSetToken:token,
    deleteDates:['2026-09-04'],
    createdAt:'2026-09-04T04:00:00.000Z',
  };
  let legacyStorageKey = '';
  const legacyDiscoveryStorage = {
    getItem:key => {
      legacyStorageKey = key;
      return JSON.stringify(legacyPending);
    },
    setItem:() => {},
    removeItem:() => {},
  };
  assert.deepEqual(
    daily.readPendingLegacyItineraryDailyReportDelete(config, 'owner-1', legacyDiscoveryStorage),
    legacyPending,
  );
  assert.match(legacyStorageKey, /daily-itinerary-report-delete:v2/);
  memory.set(legacyStorageKey, JSON.stringify(legacyPending));
  for (const createdAt of ['', 'not-a-timestamp', '2026-09-05 12:00:00']) {
    const malformedTimestamp = { ...legacyPending, createdAt };
    const malformedStorage = { getItem:()=>JSON.stringify(malformedTimestamp) };
    assert.equal(daily.readPendingLegacyItineraryDailyReportDelete(config,'owner-1',malformedStorage), null);
    const callsBeforeInvalidTimestamp = calls.length;
    await assert.rejects(
      daily.reconcileLegacyItineraryDailyReportDelete(malformedTimestamp, config, client),
      error => error.code === 'INVALID_DELETE_ENVELOPE' && error.definitive === true,
    );
    assert.equal(calls.length, callsBeforeInvalidTimestamp);
  }
  const legacyDeleted = await daily.reconcileLegacyItineraryDailyReportDelete(legacyPending, config, client);
  assert.deepEqual(legacyDeleted.deletedDates, ['2026-09-04']);
  assert.deepEqual(calls.at(-1), {
    name:'delete_sd_itinerary_daily_reports',
    params:{
      p_workspace_key:'workspace-a', p_actor_user_id:'owner-1', p_operation_id:legacyDeleteOperationId,
      p_expected_set_token:token, p_delete_dates:['2026-09-04'],
    },
  });
  const callsBeforeLegacyContextMismatch = calls.length;
  await assert.rejects(
    daily.reconcileLegacyItineraryDailyReportDelete(legacyPending, { ...config, workspaceKey:'workspace-b' }, client),
    error => error.code === 'DELETE_CONTEXT_CHANGED' && error.definitive === true,
  );
  assert.equal(calls.length, callsBeforeLegacyContextMismatch);
  daily.clearPendingLegacyItineraryDailyReportDelete(config, 'owner-1', storage);
  assert.equal(memory.has(legacyStorageKey), false);

  const wrongManualReceiptClient = { rpc:() => ({ abortSignal:async () => ({ data:{
    ...responses.sd_save_manual_itinerary_report, operationId:'99999999-9999-4999-8999-999999999999',
  }, error:null }) }) };
  await assert.rejects(
    daily.saveManualItineraryDailyReport(manualPending, config, wrongManualReceiptClient),
    error => error.code === 'INVALID_RESPONSE' && error.definitive === false,
  );

  const unavailableClient = { rpc:() => ({ abortSignal:async () => ({ data:null, error:{ code:'PGRST202', message:'missing function' } }) }) };
  await assert.rejects(
    daily.listItineraryDailyReportPage('owner-1', 1, config, unavailableClient),
    error => error.code === 'DAILY_ITINERARY_REPORTS_SQL_NOT_DEPLOYED',
  );

  const duplicateReportClient = { rpc:() => ({ abortSignal:async () => ({ data:{
    ...responses.sd_itinerary_daily_report_list_v2,
    reports:[manualSummary, manualSummary], dateTotal:1, total:1, reportTotal:2, pageCount:1,
  }, error:null }) }) };
  await assert.rejects(
    daily.listItineraryDailyReportPage('owner-1', 1, config, duplicateReportClient),
    /分頁格式不正確/,
  );

  daily.clearPendingItineraryDailyReportDelete(config, 'owner-1', storage);
  console.log('itinerary_daily_reports_client=PASS');
} finally {
  await server.close();
}

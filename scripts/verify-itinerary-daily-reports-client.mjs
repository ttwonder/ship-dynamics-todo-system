import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const config = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'public-anon-test-key',
  workspaceKey: 'workspace-a',
  tableName: 'ship_dynamics_app_state',
};

try {
  const daily = await server.ssrLoadModule('/src/itineraryDailyReports.ts');
  const calls = [];
  const responses = {
    sd_itinerary_daily_report_list: {
      ok: true,
      page: 1,
      pageSize: 30,
      pageCount: 2,
      total: 31,
      setToken: '11111111111111111111111111111111',
      reports: [{
        businessDate: '2026-09-04', timezone: 'Asia/Taipei', generatedAt: '2026-09-04T01:00:01Z',
        generatedBy: 'scheduled', vesselCount: 39, rowCount: 88, sourceMaxRevision: 14, logicalBytes: 12345,
      }],
    },
    sd_itinerary_daily_report_locate: {
      ok: true,
      found: true,
      businessDate: '2026-08-05',
      page: 2,
      pageSize: 30,
      setToken: '11111111111111111111111111111111',
    },
    sd_itinerary_daily_report_load: {
      ok: true,
      report: {
        businessDate: '2026-09-04', timezone: 'Asia/Taipei', generatedAt: '2026-09-04T01:00:01Z',
        generatedBy: 'scheduled', vesselCount: 2, rowCount: 1, sourceMaxRevision: 7, logicalBytes: 3456,
        snapshot: {
          schemaVersion: 1, businessDate: '2026-09-04', timezone: 'Asia/Taipei', generatedAt: '2026-09-04T01:00:01Z',
          vesselCount: 2, rowCount: 1, sourceMaxRevision: 7,
          vessels: [
            { vesselId: 'v1', vesselName: 'FPMC ALPHA', revision: 7, updatedAt: '2026-09-04T00:30:00Z', rows: [{ rowId: 'row-1', sortOrder: 0, portDockName: 'KAOHSIUNG' }] },
            { vesselId: 'v2', vesselName: 'FPMC BETA', revision: 0, updatedAt: null, rows: [] },
          ],
        },
      },
    },
    delete_sd_itinerary_daily_reports: {
      ok: true, operationId: '11111111-1111-4111-8111-111111111111', deletedCount: 1, deletedBytes: 3456,
      deletedDates: ['2026-09-04'], remainingReportCount: 0,
      remainingSetToken: 'd41d8cd98f00b204e9800998ecf8427e',
    },
  };
  const client = {
    rpc(name, params) {
      calls.push({ name, params });
      return {
        abortSignal: async () => ({ data: responses[name], error: null }),
      };
    },
  };

  const page = await daily.listItineraryDailyReportPage('owner-1', 1, config, client);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].businessDate, '2026-09-04');
  assert.equal(page.items[0].vesselCount, 39);
  assert.equal(page.total, 31);
  assert.equal(page.pageCount, 2);
  assert.equal(page.pageSize, 30);
  assert.equal(Object.hasOwn(page.items[0], 'snapshot'), false);
  assert.deepEqual(calls[0], {
    name: 'sd_itinerary_daily_report_list',
    params: { p_workspace_key: 'workspace-a', p_actor_user_id: 'owner-1', p_page: 1, p_page_size: 30 },
  });

  const location = await daily.locateItineraryDailyReport('2026-08-05', 'owner-1', config, client);
  assert.deepEqual({ found:location.found, page:location.page }, { found:true, page:2 });
  assert.deepEqual(calls[1], {
    name: 'sd_itinerary_daily_report_locate',
    params: { p_workspace_key:'workspace-a', p_business_date:'2026-08-05', p_actor_user_id:'owner-1', p_page_size:30 },
  });

  const report = await daily.loadItineraryDailyReport('2026-09-04', 'owner-1', config, client);
  assert.equal(report.snapshot.vessels.length, 2);
  assert.equal(report.snapshot.vessels[0].rows[0].portDockName, 'KAOHSIUNG');
  assert.equal(report.snapshot.vessels[1].revision, 0);
  assert.equal(Object.hasOwn(report.snapshot.vessels[0], 'alternativePlans'), false);
  assert.deepEqual(calls[2], {
    name: 'sd_itinerary_daily_report_load',
    params: { p_workspace_key: 'workspace-a', p_business_date: '2026-09-04', p_actor_user_id: 'owner-1' },
  });

  const request = {
    operationId: '11111111-1111-4111-8111-111111111111',
    actorUserId: 'owner-1',
    expectedSetToken: '11111111111111111111111111111111',
    deleteDates: ['2026-09-04'],
  };
  const pending = daily.createPendingItineraryDailyReportDelete(request, config, new Date('2026-09-04T02:00:00Z'));
  const deleted = await daily.deleteItineraryDailyReports(pending, config, client);
  assert.equal(deleted.deletedCount, 1);
  assert.deepEqual(calls[3], {
    name: 'delete_sd_itinerary_daily_reports',
    params: {
      p_workspace_key: 'workspace-a', p_actor_user_id: 'owner-1',
      p_operation_id: request.operationId, p_expected_set_token: request.expectedSetToken, p_delete_dates: ['2026-09-04'],
    },
  });

  assert.equal(pending.version, 2);
  assert.equal(pending.workspaceKey, 'workspace-a');
  assert.equal(pending.actorUserId, 'owner-1');
  assert.match(pending.configIdentity, /example\.supabase\.co\|workspace-a\|ship_dynamics_app_state/);

  const memory = new Map();
  const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: key => memory.delete(key),
  };
  daily.writePendingItineraryDailyReportDelete(pending, config, storage);
  assert.deepEqual(daily.readPendingItineraryDailyReportDelete(config, 'owner-1', storage), pending);
  assert.equal(daily.readPendingItineraryDailyReportDelete({ ...config, workspaceKey: 'workspace-b' }, 'owner-1', storage), null);
  assert.equal(daily.readPendingItineraryDailyReportDelete(config, 'admin-1', storage), null);
  const callsBeforeContextMismatch = calls.length;
  await assert.rejects(
    daily.deleteItineraryDailyReports(pending, { ...config, workspaceKey: 'workspace-b' }, client),
    error => error.code === 'DELETE_CONTEXT_CHANGED' && error.definitive === true,
  );
  assert.equal(calls.length, callsBeforeContextMismatch, 'a stale envelope must be rejected before any RPC');
  for (const tampered of [
    { ...pending, deleteDates:[...pending.deleteDates, 'not-a-date'] },
    { ...pending, deleteDates:[...pending.deleteDates, pending.deleteDates[0]] },
    { ...pending, expectedSetToken:'not-a-token' },
  ]) {
    const callsBeforeTamper = calls.length;
    await assert.rejects(
      daily.deleteItineraryDailyReports(tampered, config, client),
      error => error.code === 'INVALID_DELETE_ENVELOPE' && error.definitive === true,
    );
    assert.equal(calls.length, callsBeforeTamper, 'tampered date intent must be rejected before any RPC');
  }
  const mismatchedReceiptClient = {
    rpc() {
      return { abortSignal: async () => ({ data: {
        ok:true, operationId:'22222222-2222-4222-8222-222222222222', deletedCount:0,
        deletedBytes:0, deletedDates:[], remainingReportCount:1,
        remainingSetToken:'11111111111111111111111111111111',
      }, error:null }) };
    },
  };
  await assert.rejects(
    daily.deleteItineraryDailyReports(pending, config, mismatchedReceiptClient),
    error => error.code === 'INVALID_RESPONSE' && error.definitive === false,
  );
  daily.clearPendingItineraryDailyReportDelete(config, 'owner-1', storage);
  assert.equal(daily.readPendingItineraryDailyReportDelete(config, 'owner-1', storage), null);

  const unavailableClient = {
    rpc() {
      return { abortSignal: async () => ({ data: null, error: { code: 'PGRST202', message: 'missing function' } }) };
    },
  };
  await assert.rejects(
    daily.listItineraryDailyReportPage('owner-1', 1, config, unavailableClient),
    error => error.code === 'DAILY_ITINERARY_REPORTS_SQL_NOT_DEPLOYED'
      && /migration/.test(error.message),
  );

  const malformedPageClient = {
    rpc() {
      return { abortSignal: async () => ({ data: {
        ...responses.sd_itinerary_daily_report_list,
        pageSize: 100,
      }, error:null }) };
    },
  };
  await assert.rejects(
    daily.listItineraryDailyReportPage('owner-1', 1, config, malformedPageClient),
    /分頁格式不正確/,
  );

  const invalidSnapshotClient = {
    rpc() {
      return { abortSignal: async () => ({ data: { ok: true, report: { ...responses.sd_itinerary_daily_report_load.report, snapshot: { vessels: 'not-an-array' } } }, error: null }) };
    },
  };
  await assert.rejects(
    daily.loadItineraryDailyReport('2026-09-04', 'owner-1', config, invalidSnapshotClient),
    /快照格式不正確/,
  );

  console.log('itinerary_daily_reports_client=PASS');
} finally {
  await server.close();
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// No hosted database and no outbound network. The real Supabase JS adapter is
// connected to actual PGlite SQL through this closed transport test double.
const db = new PGlite();
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const savedGlobals = { window: globalThis.window, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
const config = { supabaseUrl: 'http://127.0.0.1:54329', supabaseAnonKey: 'local-fixture-only', workspaceKey: 'delta-fixture', tableName: 'ship_dynamics_app_state', readMode: 'delta-v1' };
const requests = [];
let intercept = null;
let passed = 0;
const clone = value => JSON.parse(JSON.stringify(value));
const check = async (name, run) => { await run(); passed += 1; console.log(`PASS ${name}`); };
const response = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const stored = async (workspace = config.workspaceKey) => (await db.query('select payload,revision from public.ship_dynamics_app_state where workspace_key=$1', [workspace])).rows[0];
const readDelta = async (revision = null, token = null, workspace = config.workspaceKey) => (await db.query('select public.read_ship_dynamics_delta_v1($1,$2,$3) as result', [workspace, revision, token])).rows[0].result;
const writeFixture = async (payload, workspace = config.workspaceKey) => {
  const previous = await stored(workspace);
  const next = clone(payload);
  next.revision = previous.revision + 1;
  next.updatedAt = `2026-09-05T00:${String(next.revision).padStart(2, '0')}:00.000Z`;
  await db.query('update public.ship_dynamics_app_state set payload=$1::jsonb,revision=$2,updated_at=now() where workspace_key=$3', [JSON.stringify(next), next.revision, workspace]);
  return next;
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

try {
  await db.exec('create role anon nologin; create role authenticated nologin;');
  await db.exec(fs.readFileSync('supabase/schema.sql', 'utf8'));
  const beforeDDL = (await db.query("select count(*)::integer as count from pg_tables where schemaname='public'")).rows[0].count;
  const sql = fs.readFileSync('supabase/development/20260905_appdata_delta_reads.sql', 'utf8');
  await db.exec(sql);
  await db.exec(sql); // additive candidate rerun must not touch any data or write path
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { consumeCloudDeltaResponse } = await server.ssrLoadModule('/src/cloudDelta.ts');
  let payload = createInitialData();
  payload.revision = 1;
  payload.updatedAt = '2026-09-05T00:01:00.000Z';
  payload.users = [{ id: 'qa-owner', department: 'QA', name: 'TEST OWNER', username: 'qa-owner', role: 'owner', passwordHash: '', isActive: true, managedVesselIds: ['v1'], createdAt: payload.updatedAt, updatedAt: payload.updatedAt }];
  payload.vessels = [{ ...payload.vessels[0], id: 'v1', name: 'QA TEST VESSEL', assignedUserIds: [], delegateManagers: [] }];
  for (const collection of ['tasks', 'internalControlCases', 'meetings', 'agendaReports', 'taskDismissals', 'auditLogs', 'notifications']) payload[collection] = [];
  payload.legacyExtension = { retained: ['原值', null, false] };
  await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision) values ($1,$2::jsonb,1)', [config.workspaceKey, JSON.stringify(payload)]);
  const sourceBeforeRead = await stored();
  const sqlFirst = await readDelta();
  await check('SQL first read is exact and read-only; additive DDL is rerunnable', async () => {
    assert.deepEqual(sqlFirst.payload, payload);
    assert.equal(sqlFirst.status, 'snapshot');
    assert.deepEqual(await stored(), sourceBeforeRead);
    assert.equal((await db.query("select count(*)::integer as count from pg_tables where schemaname='public'")).rows[0].count, beforeDDL);
  });
  await check('SQL is STABLE security-invoker, with explicit routine ACL', async () => {
    const fn = (await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid='public.read_ship_dynamics_delta_v1(text,integer,text)'::regprocedure")).rows[0];
    assert.equal(fn.prosecdef, false);
    assert.equal(fn.provolatile, 's');
    assert.ok(fn.proconfig.some(item => item.startsWith('search_path=')));
    assert.equal((await db.query("select has_function_privilege('anon','public.read_ship_dynamics_delta_v1(text,integer,text)','execute') as allowed")).rows[0].allowed, true);
    await db.exec('set role anon');
    await assert.rejects(readDelta(), /permission denied/);
    await db.exec('reset role');
    // Reproduce Supabase's existing table-read privileges for this local role.
    await db.exec('grant select on public.ship_dynamics_app_state,public.ship_dynamics_app_revisions to anon');
    await db.exec('set role anon');
    assert.equal((await readDelta()).status, 'snapshot');
    await db.exec('reset role');
  });

  globalThis.window = { SHIP_DYNAMICS_SUPABASE_CONFIG: config };
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('Test must not write browser storage'); } };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.ok(['http://127.0.0.1:54329', 'http://127.0.0.1:54330'].includes(url.origin), 'outbound network is forbidden');
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const request = { path: url.pathname, body, origin: url.origin };
    requests.push(request);
    if (intercept) { const handler = intercept; intercept = null; return handler(request); }
    if (url.pathname === '/rest/v1/ship_dynamics_app_state') {
      assert.equal(init.method || 'GET', 'GET');
      const workspace = url.searchParams.get('workspace_key').replace(/^eq\./, '');
      return response(await stored(workspace));
    }
    assert.equal(init.method, 'POST');
    if (url.pathname === '/rest/v1/rpc/read_ship_dynamics_delta_v1') {
      request.result = await readDelta(body.p_base_revision, body.p_base_token, body.p_workspace_key);
      return response(request.result);
    }
    if (url.pathname === '/rest/v1/rpc/apply_ship_dynamics_block_patch_v2') {
      const result = await db.query('select public.apply_ship_dynamics_block_patch_v2($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) as result', [body.p_workspace_key, body.p_operation_id, JSON.stringify(body.p_operations), body.p_saved_by, body.p_actor_user_id, JSON.stringify(body.p_actor_guard), body.p_authorization_guard === null ? null : JSON.stringify(body.p_authorization_guard), JSON.stringify(body.p_lock_guards)]);
      request.result = result.rows[0].result;
      return response(request.result);
    }
    throw new Error(`Unexpected test route: ${url.pathname}`);
  };
  const cloud = await server.ssrLoadModule('/src/cloud.ts');
  const expectAuthoritative = async data => {
    const current = await stored();
    const expected = normalizeAppData(clone(current.payload));
    assert.ok(expected);
    expected.revision = current.revision;
    assert.deepEqual(data, expected, 'same complete AppData as the unchanged legacy read path');
    assert.deepEqual(cloud.cloudStoragePayloadFor(data), { ...current.payload, revision: current.revision }, 'raw server storage baseline survives UI normalization');
  };
  await check('legacy read stays the default, without probing a new RPC', async () => {
    const { readMode, ...legacy } = config;
    await expectAuthoritative(await cloud.fetchCloudData(legacy));
    assert.equal(requests.at(-1).path, '/rest/v1/ship_dynamics_app_state');
  });
  let first;
  await check('opt-in cold read uses the real client and full server baseline', async () => {
    first = await cloud.fetchCloudData(config);
    await expectAuthoritative(first);
    assert.equal(requests.at(-1).body.p_base_revision, null);
    assert.equal(requests.at(-1).result.status, 'snapshot');
  });
  await check('editable returned objects cannot poison the next read baseline', async () => {
    first.settings.systemTitle = 'UNSAVED LOCAL DRAFT';
    first.vessels[0].name = 'UNSAVED LOCAL VESSEL';
    await expectAuthoritative(await cloud.fetchCloudData(config));
    assert.equal(requests.at(-1).result.status, 'delta');
    assert.deepEqual(requests.at(-1).result.collections, []);
  });
  await check('existing v2 save + receipt + new delta readback reaches actual SQL', async () => {
    const current = await stored();
    const actorGuard = (await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2) as value', [JSON.stringify(current.payload), 'qa-owner'])).rows[0].value;
    const vessel = current.payload.vessels[0];
    await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ($1,'vessel:v1','qa-lease','TEST OWNER',now()+interval '75 seconds')", [config.workspaceKey]);
    const ack = await cloud.applyCloudBlockPatchV2('qa-delta-save', [{ kind: 'entity', collection: 'vessels', entityId: 'v1', expected: vessel, value: { ...vessel, note: { ...vessel.note, recentDynamics: 'SAVED IN LOCAL SQL' } } }], 'TEST OWNER', 'qa-owner', actorGuard, null, [{ section_key: 'vessel:v1', locked_by: 'qa-lease' }], config);
    assert.equal(ack.revision, 2);
    const result = await cloud.fetchCloudData(config);
    await expectAuthoritative(result);
    assert.equal(result.vessels[0].note.recentDynamics, 'SAVED IN LOCAL SQL');
    assert.equal(requests.at(-1).result.status, 'delta');
    assert.equal(Object.hasOwn(requests.at(-1).result, 'payload'), false);
    const replay = await cloud.applyCloudBlockPatchV2('qa-delta-save', [{ kind: 'entity', collection: 'vessels', entityId: 'v1', expected: vessel, value: { ...vessel, note: { ...vessel.note, recentDynamics: 'SAVED IN LOCAL SQL' } } }], 'TEST OWNER', 'qa-owner', actorGuard, null, [{ section_key: 'vessel:v1', locked_by: 'qa-lease' }], config);
    assert.equal(replay.replayed, true);
    assert.equal((await stored()).revision, 2);
  });
  await check('complete cross-record changes, unknown fields and server audit metadata', async () => {
    payload = (await stored()).payload;
    const statusLogs = [{ id: 'shared-log-1', at: payload.updatedAt, by: 'TEST OWNER', byUserId: 'qa-owner', text: 'QA follow-up' }];
    const commonTask = { vesselId: 'v1', priority: '低', isAware: false, isAbnormal: false, isInternalControl: false, category: '其他', categories: ['其他'], status: 'QA follow-up', expectedDate: '', reportDate: '2026-09-05', departments: ['QA'], ownerUserIds: [], isClosed: false, sourceType: 'morning', createdBy: 'qa-owner', updatedBy: 'qa-owner', createdAt: payload.updatedAt, updatedAt: payload.updatedAt, statusLogs };
    payload.tasks = [{ ...commonTask, id: 't1', description: 'linked task', internalControlCaseId: 'i1', isInternalControl: true }, { ...commonTask, id: 't2', description: 'meeting task', sourceType: 'temporary', attentionDimension: 'meeting', sourceMeetingId: 'm1', sourceMeetingItemId: 'item1', vesselIds: ['v1'], vesselScopeMode: 'vessels' }];
    payload.internalControlCases = [{ ...commonTask, id: 'i1', linkedTaskId: 't1', description: 'linked task', reportSource: '日常', syncToTask: true, origin: 'internal-control' }];
    payload.meetings = [{ id: 'm1', subject: 'TEST MEETING', vessels: ['v1'], vesselScopeMode: 'vessels', createdAt: payload.updatedAt, updatedAt: payload.updatedAt, taskItems: [{ id: 'item1', description: 'meeting task', categories: ['其他'] }] }];
    payload.auditLogs = [{ id: 'a1', at: payload.updatedAt, actorId: 'qa-owner', actorName: 'TEST OWNER', actorRole: 'owner', action: 'test fixture', entityType: 'task', entityId: 't1', detail: 'local-only fixture', ipCountryCode: 'TW', ipAddress: '192.0.2.1' }];
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-forwarded-for': '192.0.2.1', 'cf-ipcountry': 'TW' })]);
    payload = await writeFixture(payload);
    await db.query("select set_config('request.headers','{}',false)");
    await expectAuthoritative(await cloud.fetchCloudData(config));
    const last = requests.at(-1).result;
    assert.equal(last.status, 'delta');
    assert.deepEqual(new Set(last.collections.map(item => item.collection)), new Set(['tasks','internalControlCases','meetings','auditLogs']));
    assert.equal(last.collections.find(item => item.collection === 'auditLogs').upserts[0].ipCountryCode, 'TW');
  });
  await check('server-side deletion, order and old report payload are preserved exactly', async () => {
    const old = await readDelta();
    const oldBase = consumeCloudDeltaResponse(old, config.workspaceKey);
    const next = clone((await stored()).payload);
    next.tasks = [{ id: 't3', description: 'new fixture' }, next.tasks[1]];
    next.agendaReports = [{ id: 'report1', snapshot: old.payload }];
    next.nextExtension = { keep: true };
    delete next.legacyExtension;
    await writeFixture(next);
    const delta = await readDelta(old.revision, old.payload_token);
    const rebuilt = consumeCloudDeltaResponse(delta, config.workspaceKey, oldBase);
    assert.deepEqual(rebuilt.payload, (await stored()).payload);
    assert.deepEqual(rebuilt.payload.tasks.map(row => row.id), ['t3','t2']);
    assert.deepEqual(rebuilt.payload.agendaReports[0].snapshot, old.payload);
    await expectAuthoritative(await cloud.fetchCloudData(config));
  });
  await check('missing/wrong historical base returns explicit full snapshot', async () => {
    assert.equal((await readDelta(1, 'wrong-token')).status, 'snapshot');
    assert.equal((await readDelta(999999, 'wrong-token')).status, 'snapshot');
    await db.query('delete from public.ship_dynamics_app_revisions where workspace_key=$1 and revision=1', [config.workspaceKey]);
    assert.equal((await readDelta(1, sqlFirst.payload_token)).status, 'snapshot');
    assert.equal((await readDelta(null, null, 'missing-fixture')).status, 'missing');
  });
  await check('malformed legacy IDs remain exact; no silent deduplication', async () => {
    const before = await readDelta();
    const broken = clone(before.payload);
    broken.tasks = [{ id: 'duplicate', a: 1 }, { id: 'duplicate', a: 2 }];
    await writeFixture(broken);
    const result = await readDelta(before.revision, before.payload_token);
    assert.deepEqual(result.root.set.tasks, broken.tasks);
    assert.deepEqual(consumeCloudDeltaResponse(result, config.workspaceKey, consumeCloudDeltaResponse(before, config.workspaceKey)).payload, (await stored()).payload);
    await writeFixture(before.payload);
    await expectAuthoritative(await cloud.fetchCloudData(config));
  });
  await check('delayed older response cannot replace a newer confirmed read', async () => {
    const started = deferred(); const release = deferred();
    intercept = async request => { const captured = await readDelta(request.body.p_base_revision, request.body.p_base_token); started.resolve(); await release.promise; return response(captured); };
    const slow = cloud.fetchCloudData(config);
    await started.promise;
    const next = (await stored()).payload;
    next.settings.systemTitle = 'NEWER COMMIT';
    await writeFixture(next);
    const newer = await cloud.fetchCloudData(config);
    release.resolve();
    const late = await slow;
    assert.equal(late.revision, newer.revision);
    await expectAuthoritative(late);
    await expectAuthoritative(await cloud.fetchCloudData(config));
  });
  await check('late missing response cannot erase a newer existing workspace', async () => {
    const started = deferred(); const release = deferred();
    intercept = async () => { started.resolve(); await release.promise; return response({ protocol: 'ship-dynamics-delta-v1', workspace_key: config.workspaceKey, status: 'missing' }); };
    const slow = cloud.fetchCloudData(config);
    await started.promise;
    await cloud.fetchCloudData(config);
    release.resolve();
    await expectAuthoritative(await slow);
  });
  await check('older existing response cannot revive a now-missing workspace', async () => {
    const started = deferred(); const release = deferred();
    intercept = async request => { const captured = await readDelta(request.body.p_base_revision, request.body.p_base_token); started.resolve(); await release.promise; return response(captured); };
    const slow = cloud.fetchCloudData(config);
    await started.promise;
    const backup = await stored();
    await db.query('delete from public.ship_dynamics_app_state where workspace_key=$1', [config.workspaceKey]);
    assert.equal(await cloud.fetchCloudData(config), null);
    release.resolve();
    assert.equal(await slow, null);
    await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision) values ($1,$2::jsonb,$3)', [config.workspaceKey, JSON.stringify(backup.payload), backup.revision]);
    await expectAuthoritative(await cloud.fetchCloudData(config));
    assert.equal(requests.at(-1).body.p_base_revision, null);
  });
  await check('aborted requests never publish returned data', async () => {
    const started = deferred(); const release = deferred();
    intercept = async request => { const captured = await readDelta(request.body.p_base_revision, request.body.p_base_token); started.resolve(); await release.promise; return response(captured); };
    const controller = new AbortController();
    const pending = cloud.fetchCloudData(config, controller.signal);
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    await started.promise;
    controller.abort(); release.resolve(); await rejected;
    await expectAuthoritative(await cloud.fetchCloudData(config));
  });
  await check('workspace and project switches never reuse another cache token', async () => {
    const other = { ...config, workspaceKey: 'other-fixture' };
    await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision) values ($1,$2::jsonb,1)', [other.workspaceKey, JSON.stringify(sourceBeforeRead.payload)]);
    await cloud.fetchCloudData(other);
    assert.equal(requests.at(-1).body.p_base_revision, null);
    await cloud.fetchCloudData(config);
    assert.equal(requests.at(-1).body.p_base_revision, null);
    await cloud.fetchCloudData({ ...config, supabaseUrl: 'http://127.0.0.1:54330' });
    assert.equal(requests.at(-1).body.p_base_revision, null);
  });
  await check('opt-in missing RPC fails closed without legacy request fallback', async () => {
    const beforeCount = requests.length;
    intercept = () => new Response(JSON.stringify({ code: 'PGRST202', message: 'local test: unavailable capability' }), { status: 404, headers: { 'content-type': 'application/json' } });
    await assert.rejects(cloud.fetchCloudData(config), error => error.code === 'PGRST202');
    assert.equal(requests.length, beforeCount + 1);
    assert.equal(requests.at(-1).path, '/rest/v1/rpc/read_ship_dynamics_delta_v1');
  });
  await check('malformed/wrong-target response is not cached', async () => {
    await cloud.fetchCloudData(config);
    intercept = () => response({ ...sqlFirst, workspace_key: 'WRONG WORKSPACE' });
    await assert.rejects(cloud.fetchCloudData(config));
    await expectAuthoritative(await cloud.fetchCloudData(config));
    await assert.rejects(cloud.fetchCloudData({ ...config, tableName: 'wrong_table' }));
    await assert.rejects(cloud.fetchCloudData({ ...config, readMode: 'unknown' }));
  });
  await check('SQL delta payload is smaller for a single change in a large fixture', async () => {
    const large = clone(sourceBeforeRead.payload);
    large.tasks = Array.from({ length: 2000 }, (_, index) => ({ id: `size-${index}`, description: 'local QA payload '.repeat(30), statusLogs: [] }));
    await writeFixture(large);
    const before = await readDelta();
    const changed = clone(before.payload);
    changed.tasks[100].description = 'one changed record';
    await writeFixture(changed);
    const delta = await readDelta(before.revision, before.payload_token);
    const full = await readDelta();
    const deltaBytes = Buffer.byteLength(JSON.stringify(delta));
    const fullBytes = Buffer.byteLength(JSON.stringify(full));
    assert.equal(delta.collections.find(item => item.collection === 'tasks').upserts.length, 1);
    assert.ok(deltaBytes < fullBytes / 10);
    assert.deepEqual(consumeCloudDeltaResponse(delta, config.workspaceKey, consumeCloudDeltaResponse(before, config.workspaceKey)).payload, full.payload);
    console.log(JSON.stringify({ measurement: 'local SQL response bytes, NOT hosted latency', records: 2000, fullBytes, deltaBytes }));
  });
  console.log(JSON.stringify({ cloud_delta_sql_adapter: 'PASS', cases: passed, outboundNetwork: 0, hostedSupabase: 'NOT_RUN' }));
} finally {
  intercept = null;
  globalThis.window = savedGlobals.window;
  globalThis.localStorage = savedGlobals.localStorage;
  globalThis.fetch = savedGlobals.fetch;
  await server.close();
  await db.close();
}

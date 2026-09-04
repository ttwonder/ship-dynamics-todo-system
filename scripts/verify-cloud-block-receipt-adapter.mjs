import assert from 'node:assert/strict';
import { createServer } from 'vite';

const config = {
  supabaseUrl: 'https://receipt-test.supabase.co',
  supabaseAnonKey: 'test-anon-key',
  workspaceKey: 'receipt-workspace',
  tableName: 'ship_dynamics_app_state',
};
const requests = [];
let mode = 'committed';
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;
globalThis.window = { SHIP_DYNAMICS_SUPABASE_CONFIG: config };
globalThis.localStorage = { getItem: () => null, setItem: () => undefined };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const body = init.body ? JSON.parse(String(init.body)) : null;
  requests.push({ url, body, method: init.method });
  if (mode === 'missing') {
    return new Response(JSON.stringify({ status: 'missing' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (mode === 'mismatch') {
    return new Response(JSON.stringify({ status: 'mismatch', code: 'operation-mismatch' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (mode === 'unavailable') {
    return new Response(JSON.stringify({ code: 'PGRST202', message: 'function not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  if (mode === 'rejected') {
    return new Response(JSON.stringify({ ok: false, code: 'lock-conflict' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (mode === 'null-response') {
    return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    ok: true,
    status: 'committed',
    operation_id: body.p_operation_id,
    revision: 42,
    updated_at: '2026-09-04T08:42:00.000Z',
    replayed: false,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const cloud = await server.ssrLoadModule('/src/cloud.ts');
  const operationId = 'block-op-adapter-1';
  const operations = [{ kind: 'settings', expected: { a: 1 }, value: { a: 2 } }];
  const actorGuard = { actor: { id: 'actor-1' } };
  const authorizationGuard = null;
  const lockGuards = [];
  const ack = await cloud.applyCloudBlockPatchV2(
    operationId,
    operations,
    'Operator',
    'actor-1',
    actorGuard,
    authorizationGuard,
    lockGuards,
    config,
  );
  assert.deepEqual(ack, {
    ok: true,
    status: 'committed',
    operationId,
    revision: 42,
    updatedAt: '2026-09-04T08:42:00.000Z',
    replayed: false,
  });
  assert.match(requests[0].url, /\/rest\/v1\/rpc\/apply_ship_dynamics_block_patch_v2$/);
  assert.equal(requests[0].body.p_operation_id, operationId);
  assert.equal(Object.hasOwn(ack, 'payload'), false);

  mode = 'missing';
  const status = await cloud.getCloudBlockPatchReceipt(
    operationId,
    operations,
    'Operator',
    'actor-1',
    actorGuard,
    authorizationGuard,
    lockGuards,
    config,
  );
  assert.deepEqual(status, { status: 'missing' });
  assert.match(requests[1].url, /\/rest\/v1\/rpc\/get_ship_dynamics_block_patch_receipt$/);
  assert.deepEqual(requests[1].body, {
    p_workspace_key: config.workspaceKey,
    p_operation_id: operationId,
    p_operations: operations,
    p_saved_by: 'Operator',
    p_actor_user_id: 'actor-1',
    p_actor_guard: actorGuard,
    p_authorization_guard: authorizationGuard,
    p_lock_guards: lockGuards,
  });
  const lookupAgain = () => cloud.getCloudBlockPatchReceipt(
    operationId,
    operations,
    'Operator',
    'actor-1',
    actorGuard,
    authorizationGuard,
    lockGuards,
    config,
  );
  mode = 'mismatch';
  await assert.rejects(lookupAgain, error => error instanceof cloud.CloudBlockPatchRejectedError && error.code === 'operation-mismatch');

  const submitAgain = () => cloud.applyCloudBlockPatchV2(
    operationId,
    [{ kind: 'settings', expected: { a: 1 }, value: { a: 2 } }],
    'Operator',
    'actor-1',
    { actor: { id: 'actor-1' } },
    null,
    [],
    config,
  );
  mode = 'unavailable';
  await assert.rejects(submitAgain, error => error instanceof cloud.CloudBlockPatchV2UnavailableError);
  mode = 'rejected';
  await assert.rejects(submitAgain, error => error instanceof cloud.CloudBlockPatchRejectedError && error.code === 'lock-conflict');
  mode = 'null-response';
  await assert.rejects(
    submitAgain,
    error => !(error instanceof cloud.CloudBlockPatchRejectedError) && /receipt 格式無效/.test(String(error?.message || error)),
  );

  console.log('cloud_block_receipt_adapter=PASS');
} finally {
  await server.close();
  globalThis.window = originalWindow;
  globalThis.localStorage = originalLocalStorage;
  globalThis.fetch = originalFetch;
}

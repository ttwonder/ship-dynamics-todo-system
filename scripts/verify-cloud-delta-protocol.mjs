import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
let passed = 0;
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`); };
try {
  const { consumeCloudDeltaResponse } = await server.ssrLoadModule('/src/cloudDelta.ts');
  const payload = {
    revision: 1, updatedAt: 'one', settings: { display: 'original' },
    users: [{ id: 'u1', role: 'owner' }], vessels: [{ id: 'v1', label: 'unchanged' }],
    tasks: [{ id: 't1', title: 'before', internalControlCaseId: 'i1' }, { id: 't2', title: 'other' }],
    internalControlCases: [{ id: 'i1', linkedTaskId: 't1', description: 'before' }],
    meetings: [], notifications: [], auditLogs: [], agendaReports: [], taskDismissals: [],
    legacyExtension: { preserve: ['原值', null, false] },
  };
  const snapshotResponse = { protocol: 'ship-dynamics-delta-v1', workspace_key: 'w1', status: 'snapshot', revision: 1, payload_token: 'opaque-1', payload };
  const base = consumeCloudDeltaResponse(snapshotResponse, 'w1');
  const delta = {
    protocol: 'ship-dynamics-delta-v1', workspace_key: 'w1', status: 'delta',
    base_revision: 1, base_token: 'opaque-1', revision: 2, payload_token: 'opaque-2',
    root: { set: { revision: 2, updatedAt: 'two' }, deleted: [] },
    collections: [
      { collection: 'tasks', upserts: [{ ...payload.tasks[0], title: 'after' }], deleted: [] },
      { collection: 'internalControlCases', upserts: [{ ...payload.internalControlCases[0], description: 'after' }], deleted: [] },
      { collection: 'auditLogs', upserts: [{ id: 'a1', ipCountryCode: 'TW' }], deleted: [], order: ['a1'] },
    ],
  };
  check('initial snapshot is detached from response', () => {
    assert.deepEqual(base.payload, payload);
    assert.notEqual(base.payload, payload);
    assert.notEqual(base.payload.tasks, payload.tasks);
  });
  check('linked records and server audit fields arrive together', () => {
    const next = consumeCloudDeltaResponse(delta, 'w1', base);
    assert.equal(next.payload.tasks[0].title, 'after');
    assert.equal(next.payload.internalControlCases[0].description, 'after');
    assert.equal(next.payload.auditLogs[0].ipCountryCode, 'TW');
    assert.deepEqual(next.payload.legacyExtension, payload.legacyExtension);
    assert.deepEqual(next.payload.vessels, payload.vessels);
    assert.deepEqual(base.payload, payload, 'authoritative base must remain immutable');
  });
  check('deletion, creation and authoritative ordering', () => {
    const next = consumeCloudDeltaResponse({ ...delta, collections: [{ collection: 'tasks', deleted: ['t1'], upserts: [{ id: 't3' }], order: ['t3', 't2'] }] }, 'w1', base);
    assert.deepEqual(next.payload.tasks.map(row => row.id), ['t3', 't2']);
  });
  check('no-op delta and unknown root keys round-trip', () => {
    assert.deepEqual(consumeCloudDeltaResponse({ ...delta, revision: 1, payload_token: 'opaque-1', root: { set: {}, deleted: [] }, collections: [] }, 'w1', base).payload, payload);
    const next = consumeCloudDeltaResponse({ ...delta, root: { set: { nextExtension: { value: 1 } }, deleted: ['legacyExtension'] }, collections: [] }, 'w1', base);
    assert.equal(Object.hasOwn(next.payload, 'legacyExtension'), false);
    assert.deepEqual(next.payload.nextExtension, { value: 1 });
  });
  check('missing workspace is explicit, not an empty payload', () => {
    assert.equal(consumeCloudDeltaResponse({ protocol: 'ship-dynamics-delta-v1', workspace_key: 'w1', status: 'missing' }, 'w1', base), null);
  });
  const reject = (name, response, current = base) => check(name, () => assert.throws(() => consumeCloudDeltaResponse(response, 'w1', current)));
  reject('wrong workspace', { ...delta, workspace_key: 'w2' });
  reject('wrong protocol', { ...delta, protocol: 'other' });
  reject('missing immutable base', delta, null);
  reject('wrong base token', { ...delta, base_token: 'wrong' });
  reject('wrong base revision', { ...delta, base_revision: 0 });
  reject('regressed revision', { ...delta, revision: 0 });
  reject('coerced revision', { ...delta, revision: '2' });
  reject('malformed full snapshot', { ...snapshotResponse, payload: [] });
  reject('unknown status', { ...snapshotResponse, status: 'ok' });
  reject('duplicate collection delta', { ...delta, collections: [delta.collections[0], delta.collections[0]] });
  reject('unknown collection delta', { ...delta, collections: [{ collection: 'unknown', upserts: [], deleted: [] }] });
  reject('duplicate upsert id', { ...delta, collections: [{ collection: 'tasks', upserts: [{ id: 't1' }, { id: 't1' }], deleted: [] }] });
  reject('missing entity identity', { ...delta, collections: [{ collection: 'tasks', upserts: [{ title: 'oops' }], deleted: [] }] });
  reject('conflicting deletion and upsert', { ...delta, collections: [{ collection: 'tasks', upserts: [{ id: 't1' }], deleted: ['t1'], order: ['t1', 't2'] }] });
  reject('unconfirmed membership change', { ...delta, collections: [{ collection: 'tasks', upserts: [{ id: 't3' }], deleted: [] }] });
  reject('incomplete authoritative order', { ...delta, collections: [{ collection: 'tasks', upserts: [], deleted: [], order: ['t1'] }] });
  reject('duplicate authoritative order', { ...delta, collections: [{ collection: 'tasks', upserts: [], deleted: [], order: ['t1', 't1'] }] });
  reject('root and collection overlap', { ...delta, root: { set: { tasks: [] }, deleted: [] } });
  reject('duplicate root operation', { ...delta, root: { set: { revision: 2 }, deleted: ['revision'] } });
  check('JSON special keys are data, not object prototype writes', () => {
    const next = consumeCloudDeltaResponse({ ...delta, collections: [], root: { set: JSON.parse('{"__proto__":{"retained":true}}'), deleted: [] } }, 'w1', base);
    assert.equal(Object.hasOwn(next.payload, '__proto__'), true);
    assert.equal(Object.getPrototypeOf(next.payload), Object.prototype);
    assert.equal({}.retained, undefined);
  });
  console.log(JSON.stringify({ cloud_delta_protocol: 'PASS', cases: passed }));
} finally {
  await server.close();
}

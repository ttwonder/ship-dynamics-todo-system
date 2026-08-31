import assert from 'node:assert/strict';
import { createServer } from 'vite';

class MemoryStorage {
  #map = new Map();
  get length() { return this.#map.size; }
  clear() { this.#map.clear(); }
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  key(index) { return [...this.#map.keys()][index] ?? null; }
  removeItem(key) { this.#map.delete(key); }
  setItem(key, value) { this.#map.set(key, String(value)); }
  keys() { return [...this.#map.keys()]; }
}

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const collaboration = await server.ssrLoadModule('/src/itinerary/itineraryCollaboration.ts');
  let now = Date.parse('2026-08-31T08:00:00Z');
  let id = 0;
  const storage = new MemoryStorage();
  const backend = new collaboration.LocalDemoItineraryBackend({
    storage,
    now: () => now,
    createId: prefix => `${prefix}-${++id}`,
    workspaceKey: 'demo-workspace',
  });

  const vesselA = types.createEmptyItineraryDocument({ workspaceKey: 'demo-workspace', vesselId: 'vessel-a', vesselName: 'A', rowId: 'row-a' });
  const vesselB = types.createEmptyItineraryDocument({ workspaceKey: 'demo-workspace', vesselId: 'vessel-b', vesselName: 'B', rowId: 'row-b' });
  backend.seedDocument(vesselA);
  backend.seedDocument(vesselB);

  const claimA = backend.claimLease('vessel-a', { holderId: 'browser-a', holderLabel: 'Owner A' }, 75);
  assert.equal(claimA.ok, true);
  assert.equal(claimA.lease.fence, 1);
  const blocked = backend.claimLease('vessel-a', { holderId: 'browser-b', holderLabel: 'Owner B' }, 75);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'locked');
  assert.equal(blocked.holderLabel, 'Owner A');

  const claimB = backend.claimLease('vessel-b', { holderId: 'browser-b', holderLabel: 'Owner B' }, 75);
  assert.equal(claimB.ok, true);
  assert.equal(claimB.lease.fence, 1);

  const edited = structuredClone(vesselA);
  edited.rows[0].portDockName = 'KAOHSIUNG';
  const wrongLease = backend.save({ document: edited, expectedRevision: 0, operationId: 'op-wrong', lease: claimB.lease, actorLabel: 'Owner B' });
  assert.equal(wrongLease.ok, false);
  assert.equal(wrongLease.code, 'lease-mismatch');

  const saved = backend.save({ document: edited, expectedRevision: 0, operationId: 'op-1', lease: claimA.lease, actorLabel: 'Owner A' });
  assert.equal(saved.ok, true);
  assert.equal(saved.replayed, false);
  assert.equal(saved.document.revision, 1);
  assert.equal(saved.document.rows[0].portDockName, 'KAOHSIUNG');

  backend.releaseLease(claimA.lease);
  const replay = backend.save({ document: edited, expectedRevision: 0, operationId: 'op-1', lease: claimA.lease, actorLabel: 'Owner A' });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.document.revision, 1);

  const changedRequest = structuredClone(edited);
  changedRequest.rows[0].portDockName = 'YOKOHAMA';
  const mismatch = backend.save({ document: changedRequest, expectedRevision: 0, operationId: 'op-1', lease: claimA.lease, actorLabel: 'Owner A' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, 'operation-mismatch');

  const claimA2 = backend.claimLease('vessel-a', { holderId: 'browser-b', holderLabel: 'Owner B' }, 75);
  assert.equal(claimA2.ok, true);
  assert.equal(claimA2.lease.fence, 2);
  const staleSave = backend.save({ document: changedRequest, expectedRevision: 0, operationId: 'op-2', lease: claimA2.lease, actorLabel: 'Owner B' });
  assert.equal(staleSave.ok, false);
  assert.equal(staleSave.code, 'revision-conflict');
  assert.equal(staleSave.currentRevision, 1);

  now += 76_000;
  const expiredTakeover = backend.claimLease('vessel-a', { holderId: 'browser-c', holderLabel: 'Owner C' }, 75);
  assert.equal(expiredTakeover.ok, true);
  assert.equal(expiredTakeover.lease.fence, 3);
  assert.equal(backend.renewLease(claimA2.lease, 75).ok, false);
  assert.equal(backend.renewLease(expiredTakeover.lease, 75).ok, true);

  const loaded = backend.loadDocument('vessel-a');
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.rows[0].portDockName, 'KAOHSIUNG');
  assert.ok(storage.keys().every(key => key.startsWith('ship-dynamics-itinerary/demo/')));

  console.log('itinerary_local_collaboration=PASS');
} finally {
  await server.close();
}

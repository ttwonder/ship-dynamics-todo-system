import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const actorId = '11111111-1111-4111-8111-111111111111';
const ownerSession = '22222222-2222-4222-8222-222222222222';
const at = '2026-07-26T00:00:00.000Z';
const makeCase = id => ({
  id,
  vesselId: 'v1',
  reportDate: '2026-07-26',
  reportSource: '日常',
  description: `Batch ${id}`,
  priority: '中',
  category: 'Safety',
  isAware: false,
  status: 'Open',
  departments: ['Operations'],
  syncToTask: true,
  origin: 'internal-control',
  isClosed: false,
  createdBy: actorId,
  updatedBy: actorId,
  createdAt: at,
  updatedAt: at,
  statusLogs: [],
});

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { NormalizedUiController } = await server.ssrLoadModule('/src/normalizedUiController.ts');
  const items = [makeCase('case-batch-a'), makeCase('case-batch-b')];
  const projections = Object.fromEntries(items.map((item, index) => [item.id, {
    categories: ['Safety'],
    expectedDate: `2026-08-${String(index + 10).padStart(2, '0')}`,
    ownerUserIds: [actorId],
    isAbnormal: index === 1,
  }]));
  const persistedCaseIds = [];
  let atomicBatchCalls = 0;
  let legacyCreateCalls = 0;
  let claimedLeaseRequests = [];
  const projection = {
    data: { tasks: [], vessels: [], internalControlCases: [] },
    versions: new Map(),
  };
  const runtime = {
    projection,
    refreshEntities: async () => projection,
    loadDraft: () => null,
    removeDraft: () => undefined,
    commands: {
      createOperationId: () => '33333333-3333-4333-8333-333333333333',
      claimLeaseSet: async requests => {
        claimedLeaseRequests = structuredClone(requests);
        return requests.map((request, index) => ({
          leaseKey: request.leaseKey,
          ownerSession,
          fencingToken: index + 1,
        }));
      },
      releaseLeaseSet: async () => true,
      batchCreateInternalCases: async () => {
        atomicBatchCalls += 1;
        throw new Error('injected-atomic-batch-failure');
      },
      createInternalCase: async input => {
        legacyCreateCalls += 1;
        persistedCaseIds.push(input.caseId);
        if (legacyCreateCalls === 2) throw new Error('injected-second-create-failure');
      },
    },
  };

  const missingChoiceProjections = structuredClone(projections);
  delete missingChoiceProjections[items[0].id].isAbnormal;
  await assert.rejects(
    () => new NormalizedUiController(runtime).createInternalCaseBatch(items, missingChoiceProjections),
    /是否.*近期內需要特別關注的異常/,
    'a synchronized normalized batch row must carry an explicit abnormal choice',
  );
  assert.equal(atomicBatchCalls, 0, 'missing choice must reject before any command RPC');
  assert.deepEqual(claimedLeaseRequests, [], 'missing choice must reject before any lease claim');

  await assert.rejects(
    () => new NormalizedUiController(runtime).createInternalCaseBatch(items, projections),
    /injected-atomic-batch-failure/,
    'the submitted modal batch must surface one server-owned transaction failure',
  );
  assert.deepEqual(persistedCaseIds, [],
    'a failed submitted batch must not leave any earlier case committed');
  assert.equal(atomicBatchCalls, 1, 'the batch must use one command RPC');
  assert.equal(legacyCreateCalls, 0, 'the controller must not loop independent create RPCs');
  assert.deepEqual(claimedLeaseRequests, [
    {
      leaseKey: 'internal-case-create:v1',
      entityType: 'internal-case-create',
      entityId: 'v1',
    },
    {
      leaseKey: 'task-create:v1',
      entityType: 'task-create',
      entityId: 'v1',
    },
  ], 'batch creation must lease authorized vessel creation scopes, not guessed case IDs');

  // One offline modal submit remains one durable batch and recovers through one
  // ordered atomic RPC under the operation identity allocated at submission.
  {
    const batchOperationId = '44444444-4444-4444-8444-444444444444';
    const offlineDrafts = [];
    const previousNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: false },
    });
    try {
      const offlineRuntime = {
        projection,
        saveDraft: (entityKey, draft, baseVersions) => {
          offlineDrafts.push({ entityKey, draft, baseVersions });
        },
        commands: {
          createOperationId: () => batchOperationId,
        },
      };
      const outcome = await new NormalizedUiController(offlineRuntime)
        .createInternalCaseBatch(items, projections);
      assert.equal(outcome, 'drafted');
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: previousNavigator,
      });
    }

    assert.equal(offlineDrafts.length, 1,
      'one offline modal submit must persist one durable batch envelope');
    const [offline] = offlineDrafts;
    assert.equal(offline.entityKey, `internal-case-batch:${batchOperationId}`);
    assert.equal(offline.draft.kind, 'internal-case-batch');
    assert.equal(offline.draft.operationId, batchOperationId);
    assert.deepEqual(
      offline.draft.entries.map(entry => entry.candidate.id),
      items.map(item => item.id),
      'the durable batch must retain exact submitted order',
    );
    assert.equal(offline.draft.entries.every(entry => typeof entry.linkedTask?.id === 'string'), true,
      'projected task identities must be fixed before the offline batch is persisted');
    assert.deepEqual(
      offline.draft.entries.map(entry => entry.linkedTask?.isAbnormal),
      [false, true],
      'explicit linked-task abnormal choices must survive the durable offline batch envelope',
    );

    const recoveredBatchCalls = [];
    const recoveredLegacyCalls = [];
    const clearedDrafts = [];
    const recoveryRuntime = {
      projection,
      refreshEntities: async () => projection,
      removeDraft: entityKey => { clearedDrafts.push(entityKey); },
      commands: {
        claimLeaseSet: async requests => requests.map((request, index) => ({
          leaseKey: request.leaseKey,
          ownerSession,
          fencingToken: index + 10,
        })),
        releaseLeaseSet: async () => true,
        batchCreateInternalCases: async (...args) => { recoveredBatchCalls.push(args); },
        createInternalCase: async input => { recoveredLegacyCalls.push(input); },
      },
    };
    await new NormalizedUiController(recoveryRuntime).recoverDraft({
      version: 1,
      workspaceId: 'workspace-a',
      actorId,
      entityKey: offline.entityKey,
      draft: offline.draft,
      baseVersions: offline.baseVersions,
      updatedAt: at,
    });
    assert.equal(recoveredBatchCalls.length, 1,
      'offline batch recovery must invoke the atomic batch RPC once');
    assert.equal(recoveredLegacyCalls.length, 0,
      'offline batch recovery must never decompose into per-case RPCs');
    assert.equal(recoveredBatchCalls[0][1], batchOperationId,
      'offline batch recovery must reuse the original operation identity');
    assert.equal(recoveredBatchCalls[0][2], offline.entityKey,
      'pending replay metadata must merge into the original durable batch envelope');
    assert.deepEqual(
      recoveredBatchCalls[0][0].map(entry => entry.caseId),
      items.map(item => item.id),
      'the atomic recovery request must preserve exact submitted order',
    );
    assert.deepEqual(clearedDrafts, [offline.entityKey]);

    const malformedDraft = structuredClone(offline.draft);
    malformedDraft.entries[0] = {
      candidate: {
        ...malformedDraft.entries[0].candidate,
        syncToTask: false,
        linkedTaskId: undefined,
      },
      linkedTask: 'not-an-envelope-task',
    };
    let malformedLeaseClaims = 0;
    let malformedBatchCalls = 0;
    let malformedDraftClears = 0;
    const malformedRuntime = {
      projection,
      removeDraft: () => { malformedDraftClears += 1; },
      commands: {
        claimLeaseSet: async () => {
          malformedLeaseClaims += 1;
          return [];
        },
        releaseLeaseSet: async () => true,
        batchCreateInternalCases: async () => { malformedBatchCalls += 1; },
      },
    };
    await assert.rejects(
      () => new NormalizedUiController(malformedRuntime).recoverDraft({
        version: 1,
        workspaceId: 'workspace-a',
        actorId,
        entityKey: offline.entityKey,
        draft: malformedDraft,
        baseVersions: {},
        updatedAt: at,
      }),
      error => error?.code === 'offline-internal-case-batch-invalid',
      'a malformed durable batch entry must be rejected as one envelope',
    );
    assert.equal(malformedLeaseClaims, 0,
      'malformed durable batches must fail before leases');
    assert.equal(malformedBatchCalls, 0,
      'malformed durable batches must fail before the atomic RPC');
    assert.equal(malformedDraftClears, 0,
      'malformed durable batches must remain available for inspection');

    let fullRefreshes = 0;
    const invalidBatchRefreshes = [];
    const committedRecoveryRuntime = {
      projection,
      recoverPendingOperation: async () => ({
        status: 'committed', command: 'batch_create_internal_cases',
        targetKey: 'internal-case-batch:target', result: {}, errorCode: null,
        completedAt: at,
      }),
      refreshAll: async () => { fullRefreshes += 1; return projection; },
      refreshEntities: async keys => {
        invalidBatchRefreshes.push(keys);
        throw new Error('batch envelope is not a projection entity');
      },
      removeDraft: entityKey => { clearedDrafts.push(entityKey); },
    };
    await new NormalizedUiController(committedRecoveryRuntime).recoverDraft({
      version: 1,
      workspaceId: 'workspace-a',
      actorId,
      entityKey: offline.entityKey,
      draft: offline.draft,
      baseVersions: offline.baseVersions,
      pendingOperation: {
        operationId: batchOperationId,
        command: 'batch_create_internal_cases',
        targetKey: 'internal-case-batch:target',
        dispatchedAt: at,
      },
      updatedAt: at,
    });
    assert.equal(fullRefreshes, 1,
      'a committed prepared batch must refresh the complete authorized projection');
    assert.deepEqual(invalidBatchRefreshes, [],
      'a durable batch key must never be treated as a refetchable entity key');
  }

  const appSource = await readFile(resolve(root, 'src/NormalizedApp.tsx'), 'utf8');
  assert.match(appSource, /controller\.createInternalCaseBatch\(items,\s*projections\)/,
    'the modal submit boundary must dispatch the complete batch once');
  assert.doesNotMatch(
    appSource,
    /onCreate=\{async \(items,[\s\S]{0,400}for \(const item of items\)/,
    'the app must not relabel a loop of partially committed creates as one successful batch',
  );
} finally {
  await server.close();
}

console.log('normalized_internal_batch_frontend=PASS');

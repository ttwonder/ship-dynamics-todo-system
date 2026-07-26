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
  }]));
  const persistedCaseIds = [];
  let atomicBatchCalls = 0;
  let legacyCreateCalls = 0;
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
      claimLeaseSet: async requests => requests.map((request, index) => ({
        leaseKey: request.leaseKey,
        ownerSession,
        fencingToken: index + 1,
      })),
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

  await assert.rejects(
    () => new NormalizedUiController(runtime).createInternalCaseBatch(items, projections),
    /injected-atomic-batch-failure/,
    'the submitted modal batch must surface one server-owned transaction failure',
  );
  assert.deepEqual(persistedCaseIds, [],
    'a failed submitted batch must not leave any earlier case committed');
  assert.equal(atomicBatchCalls, 1, 'the batch must use one command RPC');
  assert.equal(legacyCreateCalls, 0, 'the controller must not loop independent create RPCs');

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

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const dataLayer = await server.ssrLoadModule('/src/internalControlData.ts');
  const { deleteTaskBatchFromDraft } = await server.ssrLoadModule('/src/App.tsx');
  const pageSource = await readFile(new URL('../src/InternalControlPage.tsx', import.meta.url), 'utf8');
  const modalSource = await readFile(new URL('../src/InternalControlModals.tsx', import.meta.url), 'utf8');
  const data = createInitialData();
  const actor = data.users.find(user => user.role === 'owner') || data.users[0];
  const vessel = data.vessels.find(item => item.isActive) || data.vessels[0];
  assert.ok(actor && vessel, 'seed must provide actor and vessel');
  data.tasks = [];
  data.internalControlCases = [];
  vessel.assignedUserIds = [...new Set([...vessel.assignedUserIds, actor.id])];
  actor.managedVesselIds = [...new Set([...actor.managedVesselIds, vessel.id])];
  const category = data.settings.taskCategories[0] || '一般事項';
  const department = data.settings.departments[0] || '管理層';
  const at = '2026-07-24T02:00:00.000Z';
  const makeCase = (id, syncToTask) => ({
    id, vesselId: vessel.id, reportDate: '2026-07-24', reportSource: '日常', description: `${id} 事項`, priority: '高', category,
    isAware: false, status: `${id} 狀態`, departments: [department], syncToTask, isClosed: false,
    createdBy: actor.id, updatedBy: actor.id, createdAt: at, updatedAt: at, origin: 'internal-control', statusLogs: [],
  });
  const projection = { categories: [category], expectedDate: '2026-08-01', ownerUserIds: [actor.id] };
  const assertAtomicRejection = (draft, action, expected, message) => {
    const before = structuredClone(draft);
    assert.throws(action, expected, message);
    assert.deepEqual(draft, before, `${message} must leave the complete draft unchanged`);
  };
  const invalidOwnerFixtures = [
    { ...structuredClone(actor), id: 'inactive-owner', role: 'operator', isActive: false, managedVesselIds: [vessel.id] },
    { ...structuredClone(actor), id: 'vessel-owner', role: 'vessel', isActive: true, managedVesselIds: [vessel.id] },
    { ...structuredClone(actor), id: 'unauthorized-owner', role: 'operator', isActive: true, managedVesselIds: [] },
  ];
  data.users.push(...invalidOwnerFixtures);
  for (const owner of invalidOwnerFixtures) {
    const id = `reject-owner-${owner.id}`;
    assertAtomicRejection(
      data,
      () => dataLayer.createInternalControlCases(data, [makeCase(id, true)], actor, at, { [id]: { ...projection, ownerUserIds: [owner.id] } }),
      /追蹤窗口.*(停用|船舶|權限|無效)/,
      `projection owners must reject ${owner.id} against the final vessel scope`,
    );
  }

  const scopedOwner = { ...structuredClone(actor), id: 'scoped-owner', role: 'operator', isActive: true, managedVesselIds: [vessel.id] };
  const otherVessel = { ...structuredClone(vessel), id: 'projection-other-vessel', assignedUserIds: [actor.id] };
  data.users.push(scopedOwner);
  data.vessels.push(otherVessel);
  vessel.assignedUserIds = [...new Set([...vessel.assignedUserIds, scopedOwner.id])];
  dataLayer.createInternalControlCases(data, [makeCase('final-vessel-owner-scope', true)], actor, at, {
    'final-vessel-owner-scope': { ...projection, ownerUserIds: [scopedOwner.id] },
  });
  const movedOwnerCase = structuredClone(data.internalControlCases.find(item => item.id === 'final-vessel-owner-scope'));
  movedOwnerCase.vesselId = otherVessel.id;
  assertAtomicRejection(
    data,
    () => dataLayer.updateInternalControlCase(data, movedOwnerCase, movedOwnerCase.updatedAt, actor, '2026-07-24T02:01:00.000Z', { ...projection, ownerUserIds: [scopedOwner.id] }),
    /追蹤窗口.*權限/,
    'explicit projection owners must be authorized for the case final vessel after a vessel move',
  );

  for (const [claimKind, claimTask] of [
    ['ordinary', { id: 'preexisting-case-claim', isInternalControl: true, internalControlCaseId: 'claimed-new-case' }],
    ['meeting-derived', { id: 'preexisting-meeting-case-claim', sourceType: 'temporary', attentionDimension: 'meeting', sourceMeetingId: 'meeting-1', internalControlCaseId: 'claimed-new-case' }],
  ]) {
    const claimedIdDraft = { ...structuredClone(data), tasks: [claimTask], internalControlCases: [] };
    assertAtomicRejection(
      claimedIdDraft,
      () => dataLayer.createInternalControlCases(claimedIdDraft, [makeCase('claimed-new-case', false)], actor, at),
      /唯一雙向關係/,
      `case creation must fail closed when any pre-existing ${claimKind} task already claims the new case id`,
    );
  }

  const delayedLinkDraft = { ...structuredClone(data), tasks: [], internalControlCases: [] };
  dataLayer.createInternalControlCases(delayedLinkDraft, [makeCase('standalone-before-orphan', false)], actor, at);
  delayedLinkDraft.tasks.push(
    { id: 'orphan-claim-a', isInternalControl: true, internalControlCaseId: 'missing-case' },
    { id: 'orphan-claim-b', isInternalControl: true, internalControlCaseId: 'missing-case' },
  );
  const delayedCandidate = structuredClone(delayedLinkDraft.internalControlCases[0]);
  delayedCandidate.syncToTask = true;
  assertAtomicRejection(
    delayedLinkDraft,
    () => dataLayer.updateInternalControlCase(delayedLinkDraft, delayedCandidate, delayedCandidate.updatedAt, actor, '2026-07-24T02:02:00.000Z', projection),
    /唯一雙向關係/,
    'establishing a linked task from a standalone case must reject global orphan or duplicate task claims',
  );
  assertAtomicRejection(
    delayedLinkDraft,
    () => dataLayer.deleteInternalControlCase(delayedLinkDraft, delayedCandidate.id, delayedCandidate.updatedAt),
    /唯一雙向關係/,
    'deleting a standalone case must reject unrelated orphan or duplicate task claims globally',
  );

  data.tasks = [];
  data.internalControlCases = [];
  dataLayer.createInternalControlCases(data, [makeCase('create-linked', true)], actor, at, { 'create-linked': projection });
  assert.equal(data.tasks.length, 1, 'create sync must atomically create the linked task');
  assert.deepEqual(data.tasks[0].categories, projection.categories);
  assert.equal(data.tasks[0].expectedDate, projection.expectedDate);
  assert.deepEqual(data.tasks[0].ownerUserIds, projection.ownerUserIds);

  dataLayer.createInternalControlCases(data, [makeCase('later-link', false)], actor, '2026-07-24T02:05:00.000Z');
  const standalone = structuredClone(data.internalControlCases.find(item => item.id === 'later-link'));
  standalone.syncToTask = true;
  const linkedLater = dataLayer.updateInternalControlCase(data, standalone, standalone.updatedAt, actor, '2026-07-24T02:06:00.000Z', projection);
  assert.ok(linkedLater.linkedTaskId, 'edit sync must atomically establish a reciprocal link');
  const laterTask = data.tasks.find(task => task.id === linkedLater.linkedTaskId);
  assert.equal(laterTask?.internalControlCaseId, linkedLater.id);
  assert.equal(laterTask?.expectedDate, projection.expectedDate);

  const editedProjection = { categories: [category], expectedDate: '2026-08-15', ownerUserIds: [] };
  dataLayer.updateInternalControlCase(data, structuredClone(linkedLater), linkedLater.updatedAt, actor, '2026-07-24T02:07:00.000Z', editedProjection);
  const editedTask = data.tasks.find(task => task.id === linkedLater.linkedTaskId);
  assert.equal(editedTask?.expectedDate, editedProjection.expectedDate, 'edit modal must directly update task-only fields');
  assert.deepEqual(editedTask?.ownerUserIds, []);

  const beforeDeleteCount = data.tasks.length;
  dataLayer.deleteInternalControlCase(data, linkedLater.id, data.internalControlCases.find(item => item.id === linkedLater.id).updatedAt);
  assert.equal(data.internalControlCases.some(item => item.id === linkedLater.id), false);
  assert.equal(data.tasks.length, beforeDeleteCount - 1, 'deleting a linked case must atomically delete its unique reciprocal task');

  const syncFlagUpdateDraft = structuredClone(data);
  const syncFlagUpdateCase = syncFlagUpdateDraft.internalControlCases.find(item => item.id === 'create-linked');
  syncFlagUpdateCase.syncToTask = false;
  assertAtomicRejection(
    syncFlagUpdateDraft,
    () => dataLayer.updateInternalControlCase(syncFlagUpdateDraft, structuredClone(syncFlagUpdateCase), syncFlagUpdateCase.updatedAt, actor, '2026-07-24T02:08:00.000Z'),
    /唯一雙向關係/,
    'linked-case update must reject a stored linkedTaskId whose syncToTask flag is false',
  );
  const syncFlagDeleteDraft = structuredClone(data);
  const syncFlagDeleteCase = syncFlagDeleteDraft.internalControlCases.find(item => item.id === 'create-linked');
  syncFlagDeleteCase.syncToTask = false;
  assertAtomicRejection(
    syncFlagDeleteDraft,
    () => dataLayer.deleteInternalControlCase(syncFlagDeleteDraft, syncFlagDeleteCase.id, syncFlagDeleteCase.updatedAt),
    /唯一雙向關係/,
    'linked-case deletion must reject a stored linkedTaskId whose syncToTask flag is false',
  );

  const globalDuplicateCreateDraft = structuredClone(data);
  const canonicalTask = globalDuplicateCreateDraft.tasks.find(task => task.internalControlCaseId === 'create-linked');
  globalDuplicateCreateDraft.tasks.push({ ...structuredClone(canonicalTask), id: 'global-duplicate-forward-claim' });
  assertAtomicRejection(
    globalDuplicateCreateDraft,
    () => dataLayer.createInternalControlCases(globalDuplicateCreateDraft, [makeCase('unrelated-create-on-corrupt-graph', false)], actor, '2026-07-24T02:09:00.000Z'),
    /唯一雙向關係/,
    'case creation must reject an unrelated duplicate task claim already present anywhere in the graph',
  );

  const newTask = { ...structuredClone(data.tasks[0]), id: 'task-origin-create', internalControlCaseId: undefined };
  const taskOriginCreateDraft = {
    ...structuredClone(data),
    tasks: [newTask, { ...structuredClone(data.tasks[0]), id: 'unrelated-orphan-task', internalControlCaseId: 'missing-case' }],
    internalControlCases: [],
  };
  assertAtomicRejection(
    taskOriginCreateDraft,
    () => dataLayer.reconcileInternalControlAfterTaskSave(taskOriginCreateDraft, undefined, taskOriginCreateDraft.tasks[0], actor, '2026-07-24T02:10:00.000Z'),
    /唯一雙向關係/,
    'task-origin case creation must reject unrelated orphan task claims globally',
  );

  const batchDraft = structuredClone(data);
  dataLayer.createInternalControlCases(batchDraft, [makeCase('batch-linked-two', true)], actor, '2026-07-24T02:11:00.000Z', { 'batch-linked-two': projection });
  const batchTasks = ['create-linked','batch-linked-two'].map(caseId => batchDraft.tasks.find(task => task.internalControlCaseId === caseId));
  assert.ok(batchTasks.every(Boolean), 'batch fixture must contain two valid reciprocal linked tasks');
  deleteTaskBatchFromDraft(batchDraft, batchTasks, actor, '2026-07-24T02:12:00.000Z');
  assert.ok(batchTasks.every(task => !batchDraft.tasks.some(item => item.id === task.id)), 'batch deletion must remove each task before validating the next linkage');
  for (const caseId of ['create-linked','batch-linked-two']) {
    const closedCase = batchDraft.internalControlCases.find(item => item.id === caseId);
    assert.equal(closedCase?.syncToTask, false, 'deleted linked task must disable case synchronization');
    assert.equal(closedCase?.linkedTaskId, undefined, 'deleted linked task must clear the reciprocal case pointer');
    assert.equal(closedCase?.isClosed, true, 'deleted linked task must close its internal-control case');
  }
  const malformedBatchDraft = structuredClone(data);
  const malformedBefore = structuredClone(malformedBatchDraft);
  assert.throws(() => deleteTaskBatchFromDraft(malformedBatchDraft, [malformedBatchDraft.tasks[0], malformedBatchDraft.tasks[0]], actor, at), /空白或重複/);
  assert.deepEqual(malformedBatchDraft, malformedBefore, 'duplicate batch selection must be rejected before any draft mutation');

  const broken = data.internalControlCases.find(item => item.id === 'create-linked');
  const linkedTask = data.tasks.find(task => task.id === broken.linkedTaskId);
  data.tasks.push({ ...structuredClone(linkedTask), id: 'duplicate-forward-claim' });
  const beforeBrokenDelete = structuredClone(data);
  assert.throws(() => dataLayer.deleteInternalControlCase(data, broken.id, broken.updatedAt), /唯一雙向關係/);
  assert.deepEqual(data, beforeBrokenDelete, 'ambiguous linked deletion must be atomic');

  assert.ok(pageSource.includes("from './InternalControlModals'") && pageSource.includes('<BatchCreateModal') && pageSource.includes('<CaseEditModal'), 'internal-control page must mount the extracted create and edit modals');
  assert.ok(modalSource.includes('ic-case-classification-row') && modalSource.includes('ic-case-content-row'), 'create and edit forms need explicit classification and content rows');
  assert.ok(modalSource.includes('同步要事設定') && modalSource.includes('要事分類 *') && modalSource.includes('預計完成日期') && modalSource.includes('追蹤窗口'), 'sync toggle must reveal task-equivalent options');
  assert.ok(modalSource.includes('刪除案件') && modalSource.includes('onDelete'), 'edit modal must expose a permission-gated delete action');
  console.log('Internal-control task projection runtime contracts passed.');
} finally {
  await server.close();
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const batch = await server.ssrLoadModule('/src/batchInternalControlActions.ts');
  const workCenterSource = await readFile(new URL('../src/WorkCenter.tsx', import.meta.url), 'utf8');
  const internalControlPageSource = await readFile(new URL('../src/InternalControlPage.tsx', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const normalizedAppSource = await readFile(new URL('../src/NormalizedApp.tsx', import.meta.url), 'utf8');

  const standalone = { id: 'case-a', vesselId: 'v1', updatedAt: '2026-08-05T01:00:00.000Z', syncToTask: false, isClosed: false };
  const linked = { id: 'case-b', vesselId: 'v1', updatedAt: '2026-08-05T02:00:00.000Z', syncToTask: true, linkedTaskId: 'task-b', isClosed: false };
  const closed = { id: 'case-c', vesselId: 'v1', updatedAt: '2026-08-05T03:00:00.000Z', syncToTask: false, isClosed: true };
  const otherVessel = { id: 'case-other', vesselId: 'v2', updatedAt: '2026-08-05T04:00:00.000Z', syncToTask: false, isClosed: false };
  const linkedTask = { id: 'task-b', internalControlCaseId: 'case-b', isInternalControl: true, sourceType: 'morning' };
  const cases = [standalone, linked, closed, otherVessel];
  const tasks = [linkedTask];

  assert.deepEqual(batch.sanitizeInternalControlSelection(['case-a', 'stale', 'case-c'], [standalone, closed]), ['case-a', 'case-c'], 'filter or tab changes must drop stale selected cases');
  assert.deepEqual(batch.validateBatchInternalControlSelection(cases, ['case-a', 'case-c'], new Set(['v1'])).caseIds, ['case-a', 'case-c'], 'open and closed cases in the authorized vessel scope must both be selectable');
  assert.equal(batch.validateBatchInternalControlSelection(cases, [], new Set(['v1'])).ok, false, 'empty internal-control selection must fail closed');
  assert.equal(batch.validateBatchInternalControlSelection(cases, ['missing'], new Set(['v1'])).ok, false, 'missing internal-control records must fail the whole batch');
  assert.equal(batch.validateBatchInternalControlSelection(cases, ['case-other'], new Set(['v1'])).ok, false, 'out-of-scope vessels must fail the whole batch');
  assert.equal(batch.validateBatchInternalControlSelection([...cases, { ...standalone }], ['case-a'], new Set(['v1'])).ok, false, 'duplicate authoritative case IDs must fail the whole batch');

  assert.deepEqual(
    batch.internalControlBatchLockKeys({ internalControlCases: cases, tasks }, ['case-b', 'case-a']),
    ['internal-control:case-a', 'internal-control:case-b', 'task:task-b'],
    'batch deletion must lock every selected case and reciprocal linked task in deterministic order',
  );
  assert.throws(
    () => batch.internalControlBatchLockKeys({ internalControlCases: [{ ...linked, linkedTaskId: 'missing-task' }], tasks }, ['case-b']),
    /雙向關係/,
    'malformed internal-control/task links must fail before any lock bundle is acquired',
  );

  const draft = { internalControlCases: structuredClone([standalone, linked]), tasks: structuredClone(tasks) };
  const deleted = batch.deleteInternalControlCaseBatchFromDraft(draft, [standalone, linked]);
  assert.deepEqual(deleted, { caseIds: ['case-a', 'case-b'], taskIds: ['task-b'] }, 'batch deletion must report all removed cases and linked tasks');
  assert.deepEqual(draft.internalControlCases, [], 'batch deletion must remove every selected internal-control case');
  assert.deepEqual(draft.tasks, [], 'batch deletion must remove reciprocal linked tasks without orphans');

  const staleDraft = { internalControlCases: structuredClone([standalone, linked]), tasks: structuredClone(tasks) };
  assert.throws(
    () => batch.deleteInternalControlCaseBatchFromDraft(staleDraft, [standalone, { ...linked, updatedAt: 'stale' }]),
    /已由其他人更新/,
    'any stale selected case must reject the whole draft before deletion begins',
  );
  assert.equal(staleDraft.internalControlCases.length, 2, 'stale preflight rejection must not partially mutate the draft');
  assert.equal(staleDraft.tasks.length, 1, 'stale preflight rejection must retain linked tasks');

  const closeFixture = (id, updatedAt) => ({
    id,
    vesselId: 'v1',
    reportDate: '2026-08-05',
    reportSource: '日常',
    description: `待結案 ${id}`,
    priority: '中',
    category: '安全管理',
    isAware: false,
    status: '改善完成',
    departments: ['海務'],
    syncToTask: false,
    origin: 'manual',
    isClosed: false,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: '2026-08-05T01:00:00.000Z',
    updatedAt,
    statusLogs: [],
  });
  const closeA = closeFixture('close-a', '2026-08-05T05:00:00.000Z');
  const closeB = closeFixture('close-b', '2026-08-05T06:00:00.000Z');
  const closeDraft = { users: [], vessels: [], internalControlCases: structuredClone([closeA, closeB]), tasks: [] };
  const closedBatch = batch.closeInternalControlCaseBatchFromDraft(
    closeDraft,
    [closeA, closeB],
    { id: 'operator-1', name: '一般操作員' },
    '2026-08-05T07:00:00.000Z',
  );
  assert.deepEqual(closedBatch, { caseIds: ['close-a', 'close-b'], taskIds: [] }, 'batch closure must report exactly the selected internal-control cases');
  assert.ok(closeDraft.internalControlCases.every(item => item.isClosed), 'batch closure must close every selected open internal-control case');
  assert.ok(closeDraft.internalControlCases.every(item => item.closedDate === '2026-08-05' && item.closedBy === 'operator-1'), 'batch closure must derive trusted closure metadata from the live actor and operation time');
  assert.ok(closeDraft.internalControlCases.every(item => item.updatedAt === '2026-08-05T07:00:00.000Z'), 'batch closure must apply one trusted operation timestamp');

  const staleCloseDraft = { users: [], vessels: [], internalControlCases: structuredClone([closeA, closeB]), tasks: [] };
  assert.throws(
    () => batch.closeInternalControlCaseBatchFromDraft(staleCloseDraft, [closeA, { ...closeB, updatedAt: 'stale' }], { id: 'operator-1', name: '一般操作員' }, '2026-08-05T07:00:00.000Z'),
    /已由其他人更新/,
    'a stale selected case must reject the whole closure before mutation',
  );
  assert.ok(staleCloseDraft.internalControlCases.every(item => !item.isClosed), 'stale closure rejection must not partially close earlier cases');

  assert.ok(workCenterSource.includes('const selectableInternalCases=filteredInternalCases;') && workCenterSource.includes('onDismiss(selectedTasks.map(task=>task.id),selectedInternalCases.map(item=>item.id))'), '我的待辦 must let ordinary operators select visible internal-control rows for personal dismissal, completion, or selected PDF without granting delete permission');
  assert.ok(workCenterSource.includes('aria-label={`選取內控') && workCenterSource.includes('onBatchComplete(completableSelectedTasks.map(task=>task.id),selectedInternalCases.map(item=>item.id))'), '我的待辦 batch completion must submit only completable task IDs while preserving the exact internal-case ID set');
  assert.ok(workCenterSource.includes('onBatchDelete(selectedTasks.map(task=>task.id),selectedInternalCases.map(item=>item.id))'), '我的待辦 mixed deletion must preserve typed task/internal-case ID sets');
  assert.ok(internalControlPageSource.includes('const canSelectCases=subpage!==\'stats\'&&((subpage===\'open\'&&canClose)||canDelete||canExport);'), 'internal-control list selection must be available for close, delete, or selected PDF capabilities rather than delete alone');
  assert.ok(internalControlPageSource.includes('全選目前結果') && internalControlPageSource.includes('已選 {selectedCases.length}') && internalControlPageSource.includes('批量結案（{selectedCases.length}）'), '內控未完 must expose select-all, count, and batch-close controls to close-authorized operators');
  assert.ok(internalControlPageSource.includes('aria-label={`選取內控案件') && internalControlPageSource.includes('onBatchClose(selectedCases.map(item=>item.id))'), 'every selectable internal-control row must reach the explicit batch-close handler');
  assert.ok(appSource.includes('const batchDeleteTasks = async (taskIds: string[], internalControlCaseIds: string[] = [], permanentFromMyWork=false) =>') && appSource.includes('internalControlBatchLockKeys(snapshot,uniqueInternalControlCaseIds)'), 'App must atomically plan mixed task/internal-control lock closure while keeping personal dismissal separate from permanent deletion');
  const preLockAuthorizationStart=appSource.indexOf('const internalControlLockKeysForActor=');
  const preLockAuthorizationEnd=appSource.indexOf('\n    const totalSelected=',preLockAuthorizationStart);
  const preLockAuthorization=appSource.slice(preLockAuthorizationStart,preLockAuthorizationEnd);
  assert.ok(preLockAuthorization.includes("hasPermission(snapshot.settings.rolePermissions,actor,'deleteTasks')")
    && preLockAuthorization.includes("hasPermission(snapshot.settings.rolePermissions,actor,'closeTasks')")
    && preLockAuthorization.includes('item.updatedAt!==expectedInternalUpdatedAtById.get(item.id)')
    && preLockAuthorization.includes('canCancelInternalControl(actor,vessel)')
    && preLockAuthorization.includes('return internalControlBatchLockKeys(snapshot,uniqueInternalControlCaseIds)'), 'identity, permission, scope, and updatedAt must be revalidated on the fresh cloud snapshot before planning any selected internal-control lock');
  assert.ok(appSource.includes("'批量刪除內控異常'") && appSource.includes('onBatchDelete={batchDeleteTasks}'), 'each deleted internal-control case must be audited and both pages must use the centralized handler');
  assert.ok(appSource.includes('const batchCompleteTasks = async (taskIds: string[], internalControlCaseIds: string[] = []) =>')
    && appSource.includes('closeInternalControlCaseBatchFromDraft(draft,liveSelectedInternalCases,liveUser,at)')
    && appSource.includes("'批量結案內控異常'"), 'legacy batch completion must atomically close exact selected internal cases with per-case audits');
  assert.ok(normalizedAppSource.includes('const completeNormalizedSelection = async (taskIds: string[], caseIds: string[]) =>')
    && normalizedAppSource.includes('selectedCases.some(item => !item || item.isClosed)')
    && normalizedAppSource.includes('controller.updateInternalCase({ ...item, isClosed: true, closedDate })'), 'normalized compatibility path must prevalidate every selected open case and reuse the authoritative single-case command');
  assert.ok(normalizedAppSource.includes('onBatchComplete={completeNormalizedSelection}')
    && normalizedAppSource.includes('onBatchClose={caseIds => completeNormalizedSelection([], caseIds)}'), 'normalized work-center and internal list must both pass exact typed selections to the compatibility handler');

  console.log('Batch internal-control selection, deletion, and lock contracts passed.');
} finally {
  await server.close();
}

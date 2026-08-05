import type { InternalControlCase, TaskItem } from './types';
import { deleteInternalControlCase, type InternalControlDataDraft } from './internalControlData';
import { internalControlEditLockKey } from './exclusiveItemEditLock';

export function sanitizeInternalControlSelection(
  selectedIds: string[],
  visibleCases: Pick<InternalControlCase, 'id'>[],
): string[] {
  const visibleIds = new Set(visibleCases.map(item => item.id));
  return selectedIds.filter(id => visibleIds.has(id));
}

export type BatchInternalControlSelection =
  | { ok: true; caseIds: string[]; cases: InternalControlCase[] }
  | { ok: false; caseIds: []; cases: []; reason: 'empty' | 'stale-or-inaccessible' };

export function validateBatchInternalControlSelection(
  cases: InternalControlCase[],
  selectedIds: string[],
  visibleVesselIds: ReadonlySet<string>,
): BatchInternalControlSelection {
  const caseIds = [...new Set(selectedIds)];
  if (!caseIds.length) return { ok: false, caseIds: [], cases: [], reason: 'empty' };
  const selectedCases = caseIds.map(id => {
    const matches = cases.filter(item => item.id === id);
    return matches.length === 1 ? matches[0] : undefined;
  });
  if (selectedCases.some(item => !item || !visibleVesselIds.has(item.vesselId))) {
    return { ok: false, caseIds: [], cases: [], reason: 'stale-or-inaccessible' };
  }
  return { ok: true, caseIds, cases: selectedCases as InternalControlCase[] };
}

type InternalControlLockSnapshot = Pick<InternalControlDataDraft, 'internalControlCases' | 'tasks'>;

export function internalControlBatchLockKeys(
  snapshot: InternalControlLockSnapshot,
  selectedIds: readonly string[],
): string[] {
  const caseIds = [...new Set(selectedIds)];
  const keys = new Set<string>();
  for (const caseId of caseIds) {
    const matches = snapshot.internalControlCases.filter(item => item.id === caseId);
    if (matches.length !== 1) throw new Error(`內控案件不存在或識別碼重複：${caseId}`);
    const item = matches[0];
    keys.add(internalControlEditLockKey(item.id));
    const forwardClaims = snapshot.tasks.filter(task => task.internalControlCaseId === item.id);
    if (!item.linkedTaskId) {
      if (item.syncToTask === true || forwardClaims.length) throw new Error('內控與要事同步關聯不是唯一雙向關係');
      continue;
    }
    const linkedTasks = snapshot.tasks.filter(task => task.id === item.linkedTaskId);
    const reverseClaims = snapshot.internalControlCases.filter(candidate => candidate.linkedTaskId === item.linkedTaskId);
    if (
      item.syncToTask !== true
      || linkedTasks.length !== 1
      || reverseClaims.length !== 1
      || reverseClaims[0].id !== item.id
      || forwardClaims.length !== 1
      || forwardClaims[0].id !== item.linkedTaskId
      || linkedTasks[0].internalControlCaseId !== item.id
      || linkedTasks[0].isInternalControl !== true
    ) throw new Error('內控與要事同步關聯不是唯一雙向關係');
    keys.add(`task:${item.linkedTaskId}`);
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
}

export function deleteInternalControlCaseBatchFromDraft(
  draft: InternalControlDataDraft,
  selectedCases: Pick<InternalControlCase, 'id' | 'updatedAt'>[],
): { caseIds: string[]; taskIds: string[] } {
  const caseIds = selectedCases.map(item => item.id);
  if (caseIds.some(id => !id) || new Set(caseIds).size !== caseIds.length) {
    throw new Error('批量刪除的內控案件識別碼空白或重複');
  }
  for (const selected of selectedCases) {
    const matches = draft.internalControlCases.filter(item => item.id === selected.id);
    if (matches.length !== 1) throw new Error(`內控案件不存在或識別碼重複：${selected.id}`);
    if (matches[0].updatedAt !== selected.updatedAt) throw new Error(`內控案件已由其他人更新：${selected.id}`);
  }
  internalControlBatchLockKeys(draft, caseIds);
  const taskIds: string[] = [];
  for (const selected of selectedCases) {
    const deleted = deleteInternalControlCase(draft, selected.id, selected.updatedAt);
    if (deleted.taskId) taskIds.push(deleted.taskId);
  }
  return { caseIds, taskIds };
}

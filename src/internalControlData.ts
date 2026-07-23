import type { AppData, InternalControlCase, StatusLog, TaskItem, UserAccount } from './types';
import { uid } from './utils';
import {
  internalControlCaseToTask,
  isValidInternalControlDate,
  syncInternalControlCaseToLinkedTask,
  taskToInternalControlCase,
  validateInternalControlCase,
} from './internalControlWorkflow';
import { isMeetingTaskSource } from './taskCategories';
import { taskVesselIds } from './taskVesselScope';

export type InternalControlDataDraft = Pick<AppData, 'users' | 'vessels' | 'tasks' | 'internalControlCases'>;
export type InternalControlActor = Pick<UserAccount, 'id' | 'name'>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const dateAt = (at: string) => at.slice(0, 10);
const withoutClosureTransitionMetadata = ({
  updatedAt: _updatedAt,
  updatedBy: _updatedBy,
  isClosed: _isClosed,
  closedDate: _closedDate,
  closedBy: _closedBy,
  ...item
}: InternalControlCase) => item;

function assertClosedCaseContentUnchanged(previous: InternalControlCase, candidate: InternalControlCase): void {
  if (previous.isClosed && JSON.stringify(withoutClosureTransitionMetadata(candidate)) !== JSON.stringify(withoutClosureTransitionMetadata(previous))) {
    throw new Error('已結案案件須先重新開啟，才能修改內容或歷程');
  }
}

export function internalControlStatusLogsAppendOnly(candidate: StatusLog[] = [], previous: StatusLog[] = []): boolean {
  if (candidate.length < previous.length) return false;
  return JSON.stringify(candidate.slice(candidate.length - previous.length)) === JSON.stringify(previous);
}

export function trustedInternalControlStatusLogs(
  candidate: StatusLog[] = [],
  previous: StatusLog[] = [],
  actor: InternalControlActor,
  at: string,
): StatusLog[] {
  if (!internalControlStatusLogsAppendOnly(candidate, previous)) throw new Error('內控狀態歷程只能附加，不得刪除或改寫既有紀錄');
  const newCount = candidate.length - previous.length;
  return [
    ...candidate.slice(0, newCount).map(log => ({ id: uid('ic-log'), at, by: actor.name, byUserId: actor.id, text: log.text.trim() })).filter(log => log.text),
    ...clone(previous),
  ];
}

function assertStatusHistoryTransition(
  status: string,
  statusLogs: StatusLog[],
  previousStatus: string,
  previousStatusLogs: StatusLog[],
): void {
  const newStatusLogCount = statusLogs.length - previousStatusLogs.length;
  if (status !== previousStatus && newStatusLogCount < 1) throw new Error('狀態變更必須新增歷程');
  if (newStatusLogCount > 0 && statusLogs[0]?.text.trim() !== status.trim()) throw new Error('最新狀態必須與新增歷程一致');
}

function assertValidInternalControlCase(item: InternalControlCase): void {
  const errors = validateInternalControlCase(item);
  if (errors.length) throw new Error(`內控案件缺少必填欄位：${errors.join('、')}`);
}

const uniqueTaskId = (draft: Pick<InternalControlDataDraft, 'tasks'>, caseId: string) => {
  let id = `internal-task-${caseId}`;
  let suffix = 2;
  while (draft.tasks.some(task => task.id === id)) id = `internal-task-${caseId}-${suffix++}`;
  return id;
};

const uniqueCaseId = (draft: Pick<InternalControlDataDraft, 'internalControlCases'>, taskId: string) => {
  let id = `internal-${taskId}`;
  let suffix = 2;
  while (draft.internalControlCases.some(item => item.id === id)) id = `internal-${taskId}-${suffix++}`;
  return id;
};

const assignedTaskOwners = (draft: InternalControlDataDraft, vesselId: string) => {
  const vessel = draft.vessels.find(item => item.id === vesselId && item.isActive);
  if (!vessel) throw new Error('找不到有效船舶');
  return vessel.assignedUserIds.filter(id => draft.users.some(user => user.id === id && user.isActive && user.role !== 'vessel'));
};

function reciprocalLinkedTask(draft: InternalControlDataDraft, item: InternalControlCase, cancellingTaskId?: string): { index: number; task: TaskItem } | undefined {
  if (!item.linkedTaskId) return undefined;
  const linkedCases = draft.internalControlCases.filter(entry => entry.linkedTaskId === item.linkedTaskId);
  const tasksById = draft.tasks.filter(task => task.id === item.linkedTaskId);
  const taskClaims = draft.tasks.filter(task => task.internalControlCaseId === item.id);
  if (
    linkedCases.length !== 1
    || linkedCases[0].id !== item.id
    || tasksById.length !== 1
    || taskClaims.length !== 1
    || taskClaims[0].id !== item.linkedTaskId
    || (!tasksById[0].isInternalControl && tasksById[0].id !== cancellingTaskId)
    || isMeetingTaskSource(tasksById[0])
  ) throw new Error('內控與要事同步關聯不是唯一雙向關係');
  return { index: draft.tasks.indexOf(tasksById[0]), task: tasksById[0] };
};

const prepareNewCase = (candidate: InternalControlCase, actor: InternalControlActor, at: string): InternalControlCase => {
  const item = clone(candidate);
  if (item.category !== '設備故障') delete item.equipmentSubcategory;
  const errors = validateInternalControlCase(item);
  if (errors.length) throw new Error(`內控案件缺少必填欄位：${errors.join('、')}`);
  item.createdBy = actor.id;
  item.updatedBy = actor.id;
  item.createdAt = at;
  item.updatedAt = at;
  item.origin = 'internal-control';
  item.linkedTaskId = undefined;
  item.isClosed = Boolean(item.isClosed);
  if (item.isClosed) {
    item.closedDate = isValidInternalControlDate(item.closedDate) ? item.closedDate : dateAt(at);
    item.closedBy = actor.id;
  } else {
    delete item.closedDate;
    delete item.closedBy;
  }
  const initialLogs = item.statusLogs?.length ? item.statusLogs : [{ id: '', at: '', by: '', text: item.status }];
  item.statusLogs = trustedInternalControlStatusLogs(initialLogs, [], actor, at);
  assertStatusHistoryTransition(item.status, item.statusLogs, '', []);
  assertValidInternalControlCase(item);
  return item;
};

export function createInternalControlCases(
  draft: InternalControlDataDraft,
  candidates: InternalControlCase[],
  actor: InternalControlActor,
  at: string,
): { caseIds: string[]; taskIds: string[] } {
  if (!candidates.length) throw new Error('請至少新增一筆內控案件');
  const candidateIds = candidates.map(item => item.id);
  if (candidateIds.some((id, index) => !id || candidateIds.indexOf(id) !== index || draft.internalControlCases.some(item => item.id === id))) {
    throw new Error('內控案件識別碼缺失或重複');
  }
  const prepared = candidates.map(candidate => prepareNewCase(candidate, actor, at));
  const createdTasks: TaskItem[] = [];
  prepared.forEach(item => {
    assignedTaskOwners(draft, item.vesselId);
    if (!item.syncToTask) return;
    const taskId = uniqueTaskId({ tasks: [...draft.tasks, ...createdTasks] }, item.id);
    const task = internalControlCaseToTask(item, {
      id: taskId,
      ownerUserIds: assignedTaskOwners(draft, item.vesselId),
      actorId: actor.id,
      at,
    });
    item.linkedTaskId = taskId;
    createdTasks.push(task);
  });
  draft.internalControlCases.unshift(...prepared);
  draft.tasks.unshift(...createdTasks);
  return { caseIds: prepared.map(item => item.id), taskIds: createdTasks.map(task => task.id) };
}

export function updateInternalControlCase(
  draft: InternalControlDataDraft,
  candidate: InternalControlCase,
  expectedUpdatedAt: string,
  actor: InternalControlActor,
  at: string,
): InternalControlCase {
  const matches = draft.internalControlCases.filter(item => item.id === candidate.id);
  if (matches.length !== 1) throw new Error('內控案件不存在或識別碼重複');
  const previous = matches[0];
  if (previous.updatedAt !== expectedUpdatedAt) throw new Error('內控案件已由其他人更新，請重新開啟');
  const saved = clone(candidate);
  if (saved.category !== '設備故障') delete saved.equipmentSubcategory;
  const errors = validateInternalControlCase(saved);
  if (errors.length) throw new Error(`內控案件缺少必填欄位：${errors.join('、')}`);
  if (saved.createdAt !== previous.createdAt || saved.createdBy !== previous.createdBy || saved.origin !== previous.origin) {
    throw new Error('內控案件建立來源資料不可改寫');
  }
  if (saved.linkedTaskId !== previous.linkedTaskId || saved.syncToTask !== previous.syncToTask) {
    throw new Error('內控與要事的同步關聯不可由一般編輯改寫');
  }
  assertClosedCaseContentUnchanged(previous, saved);
  saved.statusLogs = trustedInternalControlStatusLogs(saved.statusLogs, previous.statusLogs, actor, at);
  assertStatusHistoryTransition(saved.status, saved.statusLogs, previous.status, previous.statusLogs);
  saved.updatedBy = actor.id;
  saved.updatedAt = at;
  if (saved.isClosed) {
    if (!previous.isClosed) {
      saved.closedDate = isValidInternalControlDate(saved.closedDate) ? saved.closedDate : dateAt(at);
      saved.closedBy = actor.id;
    } else {
      saved.closedDate = previous.closedDate;
      saved.closedBy = previous.closedBy;
    }
  } else {
    delete saved.closedDate;
    delete saved.closedBy;
  }
  assertValidInternalControlCase(saved);
  const index = draft.internalControlCases.findIndex(item => item.id === saved.id);
  let linkedTaskUpdate: { index: number; task: TaskItem } | undefined;
  if (saved.linkedTaskId) {
    const reciprocal = reciprocalLinkedTask(draft, previous);
    if (!reciprocal) throw new Error('關聯要事不存在，已停止保存以避免單邊更新');
    const linkedTask = reciprocal.task;
    const storedLinkedVesselIds = taskVesselIds(linkedTask);
    if (storedLinkedVesselIds.length !== 1 || storedLinkedVesselIds[0] !== previous.vesselId) {
      throw new Error('內控案件與關聯要事的船舶範圍不一致');
    }
    linkedTaskUpdate = {
      index: reciprocal.index,
      task: {
        ...syncInternalControlCaseToLinkedTask(saved, linkedTask, actor.id, at),
        ownerUserIds: assignedTaskOwners(draft, saved.vesselId),
      },
    };
  }
  draft.internalControlCases[index] = saved;
  if (linkedTaskUpdate) draft.tasks[linkedTaskUpdate.index] = linkedTaskUpdate.task;
  return saved;
}

export function reconcileInternalControlAfterTaskSave(
  draft: InternalControlDataDraft,
  previous: TaskItem | undefined,
  saved: TaskItem,
  actor: InternalControlActor,
  at: string,
): InternalControlCase | undefined {
  if (isMeetingTaskSource(saved)) return undefined;
  if (draft.tasks.filter(task => task.id === saved.id).length !== 1) throw new Error('內控與要事同步關聯不是唯一雙向關係');
  const wasInternal = Boolean(previous?.isInternalControl);
  if (saved.isInternalControl) {
    const vesselIds = taskVesselIds(saved);
    if (vesselIds.length !== 1 || vesselIds[0] !== saved.vesselId) throw new Error('內控要事僅能關聯單一船舶');
    if (!isValidInternalControlDate(saved.reportDate)) throw new Error('內控案件缺少必填欄位：報告日期');
    if (saved.isClosed && !isValidInternalControlDate(saved.closedDate)) throw new Error('內控案件缺少必填欄位：結案日期');
    const caseMatches = draft.internalControlCases.filter(entry => entry.id === saved.internalControlCaseId || entry.linkedTaskId === saved.id);
    if (caseMatches.length > 1 || (saved.internalControlCaseId && !caseMatches.length)) throw new Error('內控與要事同步關聯不是唯一雙向關係');
    let item = caseMatches[0];
    if (!item) {
      const id = uniqueCaseId(draft, saved.id);
      const candidateLogs = saved.statusLogs.length ? saved.statusLogs : [{ id: '', at: '', by: '', text: saved.status }];
      const trustedLogs = trustedInternalControlStatusLogs(candidateLogs, [], actor, at);
      assertStatusHistoryTransition(saved.status, trustedLogs, '', []);
      item = taskToInternalControlCase({ ...saved, statusLogs: trustedLogs }, undefined, { actorId: actor.id, at });
      item.id = id;
      item.linkedTaskId = saved.id;
      const errors = validateInternalControlCase(item);
      if (errors.length) throw new Error(`內控案件缺少必填欄位：${errors.join('、')}`);
      saved.statusLogs = trustedLogs;
      saved.internalControlCaseId = id;
      if (item.category === '設備故障') saved.equipmentSubcategory = item.equipmentSubcategory;
      else delete saved.equipmentSubcategory;
      draft.internalControlCases.unshift(item);
    } else {
      const reciprocal = reciprocalLinkedTask(draft, item);
      if (!reciprocal || reciprocal.task.id !== saved.id) throw new Error('內控與要事同步關聯不是唯一雙向關係');
      if (!previous || item.vesselId !== previous.vesselId) throw new Error('內控案件與關聯要事的船舶範圍不一致');
      const trustedLogs = trustedInternalControlStatusLogs(saved.statusLogs, item.statusLogs, actor, at);
      assertStatusHistoryTransition(saved.status, trustedLogs, item.status, item.statusLogs);
      const synced = taskToInternalControlCase({ ...saved, statusLogs: trustedLogs }, item, { actorId: actor.id, at });
      assertClosedCaseContentUnchanged(item, synced);
      const errors = validateInternalControlCase(synced);
      if (errors.length) throw new Error(`內控案件缺少必填欄位：${errors.join('、')}`);
      saved.statusLogs = trustedLogs;
      saved.internalControlCaseId = item.id;
      if (synced.category === '設備故障') saved.equipmentSubcategory = synced.equipmentSubcategory;
      else delete saved.equipmentSubcategory;
      Object.assign(item, synced);
    }
    return item;
  }
  if (!wasInternal) {
    delete saved.internalControlCaseId;
    return undefined;
  }
  const matches = draft.internalControlCases.filter(entry => entry.id === previous?.internalControlCaseId || entry.linkedTaskId === saved.id);
  if (matches.length !== 1) throw new Error('內控與要事同步關聯不是唯一雙向關係');
  const item = matches[0];
  if (!previous || previous.id !== saved.id || previous.internalControlCaseId !== item.id) throw new Error('內控與要事同步關聯不是唯一雙向關係');
  const reciprocal = reciprocalLinkedTask(draft, item, saved.id);
  if (!reciprocal || reciprocal.task.id !== saved.id) throw new Error('內控與要事同步關聯不是唯一雙向關係');
  if (item.isClosed) throw new Error('已結案內控案件必須先單獨重新開啟，才可修改內容或同步關聯');
  delete saved.internalControlCaseId;
  const cancelled = clone(item);
  cancelled.isClosed = true;
  cancelled.closedDate = dateAt(at);
  cancelled.closedBy = actor.id;
  cancelled.updatedBy = actor.id;
  cancelled.updatedAt = at;
  cancelled.syncToTask = false;
  delete cancelled.linkedTaskId;
  cancelled.status = '取消內部管控，結束與要事的雙向同步';
  cancelled.statusLogs = [{ id: uid('ic-log'), at, by: actor.name, byUserId: actor.id, text: cancelled.status }, ...cancelled.statusLogs];
  assertValidInternalControlCase(cancelled);
  delete item.linkedTaskId;
  Object.assign(item, cancelled);
  return item;
}

export function syncLinkedInternalControlCasesFromTasks(
  draft: InternalControlDataDraft,
  taskIds: string[],
  actor: InternalControlActor,
  at: string,
): void {
  const working = clone(draft);
  const ids = new Set(taskIds);
  working.tasks.filter(task => ids.has(task.id) && task.isInternalControl && !isMeetingTaskSource(task)).forEach(task => {
    reconcileInternalControlAfterTaskSave(working, task, task, actor, at);
  });
  draft.tasks = working.tasks;
  draft.internalControlCases = working.internalControlCases;
}

export function closeLinkedInternalControlCaseAfterTaskDelete(
  draft: InternalControlDataDraft,
  task: TaskItem,
  actor: InternalControlActor,
  at: string,
): InternalControlCase | undefined {
  const matches = draft.internalControlCases.filter(entry => entry.id === task.internalControlCaseId || entry.linkedTaskId === task.id);
  if (matches.length > 1) throw new Error('內控與要事同步關聯不是唯一雙向關係');
  const item = matches[0];
  if (!item) {
    if (!isMeetingTaskSource(task) && (task.isInternalControl || task.internalControlCaseId)) throw new Error('內控與要事同步關聯不是唯一雙向關係');
    return undefined;
  }
  const reciprocal = reciprocalLinkedTask(draft, item);
  if (!reciprocal || reciprocal.task.id !== task.id) throw new Error('內控與要事同步關聯不是唯一雙向關係');
  if (item.isClosed) throw new Error('已結案內控案件必須先單獨重新開啟，才可刪除關聯要事');
  const closed = clone(item);
  closed.isClosed = true;
  closed.closedDate = dateAt(at);
  closed.closedBy = actor.id;
  closed.syncToTask = false;
  delete closed.linkedTaskId;
  closed.updatedBy = actor.id;
  closed.updatedAt = at;
  closed.status = '關聯要事已刪除，內控案件保留並結束雙向同步';
  closed.statusLogs = [{ id: uid('ic-log'), at, by: actor.name, byUserId: actor.id, text: closed.status }, ...closed.statusLogs];
  assertValidInternalControlCase(closed);
  delete item.linkedTaskId;
  Object.assign(item, closed);
  return item;
}

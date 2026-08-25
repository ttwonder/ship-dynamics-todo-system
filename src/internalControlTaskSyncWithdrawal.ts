import type { AppData, TaskItem } from './types';

export type InternalControlTaskSyncWithdrawalData = Pick<
  AppData,
  'tasks' | 'internalControlCases'
>;

export type InternalControlTaskSyncWithdrawalEligibility =
  | { eligible: true; taskId: string }
  | { eligible: false; reason: string };

const uniqueVesselIds = (task: TaskItem): string[] => Array.from(new Set(
  (task.vesselIds?.length ? task.vesselIds : [task.vesselId]).filter(Boolean),
));

const isMeetingSource = (task: TaskItem): boolean => Boolean(
  task.sourceMeetingId
  || task.sourceMeetingItemId
  || task.sourceType === 'temporary'
  || task.attentionDimension === 'meeting',
);

export function internalControlTaskSyncWithdrawalEligibility(
  data: InternalControlTaskSyncWithdrawalData,
  caseId: string,
): InternalControlTaskSyncWithdrawalEligibility {
  const matches = data.internalControlCases.filter(item => item.id === caseId);
  if (matches.length !== 1) return { eligible: false, reason: '內控案件不存在或識別碼重複' };
  const item = matches[0];
  if (item.origin !== 'internal-control') {
    return { eligible: false, reason: '只有由內控案件建立的同步要事可以撤回' };
  }
  if (item.isClosed) {
    return { eligible: false, reason: '已結案內控案件必須先重新開啟，才可撤回同步要事' };
  }
  if (item.syncToTask !== true || !item.linkedTaskId) {
    return { eligible: false, reason: '關聯要事不存在，已停止撤回以避免單邊更新' };
  }
  const linkedCases = data.internalControlCases.filter(entry => entry.linkedTaskId === item.linkedTaskId);
  const linkedTasks = data.tasks.filter(task => task.id === item.linkedTaskId);
  const taskClaims = data.tasks.filter(task => task.internalControlCaseId === item.id);
  if (linkedCases.length !== 1
      || linkedCases[0].id !== item.id
      || linkedTasks.length !== 1
      || taskClaims.length !== 1
      || taskClaims[0].id !== item.linkedTaskId) {
    return { eligible: false, reason: '內控與要事同步關聯不是唯一雙向關係' };
  }
  const task = linkedTasks[0];
  if (task.isInternalControl !== true || task.internalControlCaseId !== item.id) {
    return { eligible: false, reason: '內控與要事同步關聯不是唯一雙向關係' };
  }
  const vesselIds = uniqueVesselIds(task);
  if (vesselIds.length !== 1 || vesselIds[0] !== item.vesselId || task.vesselId !== item.vesselId) {
    return { eligible: false, reason: '內控案件與關聯要事的船舶範圍不一致' };
  }
  if (isMeetingSource(task)
      || task.sourceType !== 'morning'
      || task.distributeToVessels === true) {
    return { eligible: false, reason: '臨會／專題或其他來源要事不可由內控案件撤回' };
  }
  return { eligible: true, taskId: task.id };
}

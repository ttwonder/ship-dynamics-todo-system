import type { TaskItem, UserAccount, UserNotification, Vessel } from './types';
import { nowIso, uid } from './utils';

export const FLOW_INTERNAL_CONTROL_REMINDER = '請務必在FLOW系統中申報異常並處理！避免遺漏處理！';

export const taskSourceLabel = (task: Pick<TaskItem, 'sourceType' | 'sourceMeetingId'>) =>
  task.sourceType === 'temporary' || task.sourceMeetingId ? '臨會/專題' : '早會';

type WorkflowUser = Pick<UserAccount, 'id' | 'role' | 'department' | 'managedVesselIds'> & { isActive?: boolean };
type WorkflowVessel = Pick<Vessel, 'id' | 'assignedUserIds'>;

export function canAccessTab(user: Pick<UserAccount, 'role'>, tab: string): boolean {
  if (user.role !== 'vessel') return true;
  return tab === 'dashboard' || tab === 'total';
}

export function canUseVessel(user: Pick<UserAccount, 'role' | 'managedVesselIds'>, vesselId: string): boolean {
  return user.role !== 'vessel' || user.managedVesselIds.length === 1 && user.managedVesselIds[0] === vesselId;
}

export function canDeleteTask(user: Pick<UserAccount, 'role'> | null | undefined): boolean {
  return user?.role === 'owner' || user?.role === 'admin';
}

export function getTaskNotificationRecipientIds(users: WorkflowUser[], vessel: WorkflowVessel, actorId: string): string[] {
  const assigned = new Set(vessel.assignedUserIds);
  return users.filter(user => user.id !== actorId
    && user.isActive !== false
    && user.role !== 'vessel'
    && (assigned.has(user.id) || user.managedVesselIds.includes(vessel.id))
    && /督導|航運處/.test(user.department)
  ).map(user => user.id);
}

export function canCancelInternalControl(user: WorkflowUser | null | undefined, vessel: WorkflowVessel): boolean {
  if (!user || user.role === 'vessel') return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  const assigned = vessel.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(vessel.id);
  return assigned;
}

export function validateInternalControlTransition<T extends Pick<TaskItem, 'isInternalControl' | 'isAbnormal' | 'internalControlCancelledAt' | 'internalControlCancelledBy'>>(previous: T, next: T, user: WorkflowUser, vessel: WorkflowVessel): T {
  const result = { ...next };
  if (result.isInternalControl) result.isAbnormal = true;
  if (previous.isInternalControl && !result.isInternalControl) {
    if (!canCancelInternalControl(user, vessel)) throw new Error('目前帳戶無權取消內部管控');
    result.internalControlCancelledAt = nowIso();
    result.internalControlCancelledBy = user.id;
  }
  return result;
}

export function buildTaskNotifications(users: WorkflowUser[], vessel: WorkflowVessel, actorId: string, task: Pick<TaskItem, 'id' | 'description' | 'isInternalControl'>, kind: UserNotification['kind'], actorName: string): UserNotification[] {
  const at = nowIso();
  const action = kind === 'task_created' ? '新增待辦' : kind === 'task_archived' ? '取消待辦' : kind === 'task_deleted' ? '刪除待辦' : kind === 'internal_control_cancelled' ? '取消內部管控' : '更新待辦';
  return getTaskNotificationRecipientIds(users, vessel, actorId).map(userId => ({
    id: uid('notice'), userId, vesselId: vessel.id, taskId: task.id, kind,
    title: `${action}｜${task.isInternalControl ? '內部管控｜' : ''}${task.description || '未命名事項'}`,
    message: `${actorName} ${action}：${task.description || '未命名事項'}`,
    actorId, createdAt: at,
  }));
}

export function buildTaskNotificationsForVessels(users: WorkflowUser[], vessels: WorkflowVessel[], actorId: string, task: Pick<TaskItem, 'id' | 'description' | 'isInternalControl'>, kind: UserNotification['kind'], actorName: string): UserNotification[] {
  const seen = new Set<string>();
  return vessels.flatMap(vessel => buildTaskNotifications(users, vessel, actorId, task, kind, actorName))
    .filter(notice => {
      if (seen.has(notice.userId)) return false;
      seen.add(notice.userId);
      return true;
    });
}

import type { RolePermissions, TaskItem, UserAccount, UserNotification, Vessel } from './types';
import { hasPermission } from './permissions';
import { nowIso, uid } from './utils';
import { hasActiveVesselDelegation } from './vesselDelegation';

export const FLOW_INTERNAL_CONTROL_REMINDER = '請務必在FLOW系統中申報異常並處理！避免遺漏處理！';

export const taskSourceLabel = (task: Pick<TaskItem, 'sourceType' | 'sourceMeetingId'>) =>
  task.sourceType === 'temporary' || task.sourceMeetingId ? '臨會/專題' : '早會';

type WorkflowUser = Pick<UserAccount, 'id' | 'role' | 'department' | 'managedVesselIds'> & { isActive?: boolean };
type WorkflowVessel = Pick<Vessel, 'id' | 'assignedUserIds' | 'delegateManagers'>;

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
    && (assigned.has(user.id) || user.managedVesselIds.includes(vessel.id) || hasActiveVesselDelegation(vessel, user.id))
    && /督導|航運處/.test(user.department)
  ).map(user => user.id);
}

export function canCancelInternalControl(user: WorkflowUser | null | undefined, vessel: WorkflowVessel): boolean {
  if (!user || user.role === 'vessel') return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  const assigned = vessel.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(vessel.id) || hasActiveVesselDelegation(vessel, user.id);
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

export function buildTaskNotifications(users: WorkflowUser[], vessel: WorkflowVessel, actorId: string, task: Pick<TaskItem, 'id' | 'description' | 'isInternalControl'>, kind: UserNotification['kind'], actorName: string, allowedOwnerUserIds: string[] = []): UserNotification[] {
  const at = nowIso();
  const action = kind === 'task_created' ? '新增待辦' : kind === 'task_archived' ? '取消待辦' : kind === 'task_deleted' ? '刪除待辦' : kind === 'internal_control_cancelled' ? '取消內部管控' : '更新待辦';
  const activeInternalIds = new Set(users.filter(user => user.id !== actorId && user.isActive !== false && user.role !== 'vessel').map(user => user.id));
  const recipientIds = Array.from(new Set([
    ...getTaskNotificationRecipientIds(users, vessel, actorId),
    ...allowedOwnerUserIds.filter(userId => activeInternalIds.has(userId)),
  ]));
  return recipientIds.map(userId => ({
    id: uid('notice'), userId, vesselId: vessel.id, taskId: task.id, kind,
    title: `${action}｜${task.isInternalControl ? '內部管控｜' : ''}${task.description || '未命名事項'}`,
    message: `${actorName} ${action}：${task.description || '未命名事項'}`,
    actorId, createdAt: at,
  }));
}

export function buildTaskNotificationsForVessels(users: WorkflowUser[], vessels: WorkflowVessel[], actorId: string, task: Pick<TaskItem, 'id' | 'description' | 'isInternalControl'> & Partial<Pick<TaskItem, 'ownerUserIds'>>, kind: UserNotification['kind'], actorName: string, rolePermissions: RolePermissions | undefined): UserNotification[] {
  const seen = new Set<string>();
  const ownerUserIds=(task.ownerUserIds||[]).filter(ownerId=>{
    const owner=users.find(user=>user.id===ownerId);
    if(!owner||owner.isActive===false||owner.role==='vessel')return false;
    if(owner.role==='owner'||owner.role==='admin'||hasPermission(rolePermissions,owner,'viewAllVessels'))return true;
    return vessels.every(vessel=>vessel.assignedUserIds.includes(owner.id)||(owner.managedVesselIds||[]).includes(vessel.id)||hasActiveVesselDelegation(vessel, owner.id));
  });
  const safeTask={...task,ownerUserIds};
  return vessels.flatMap(vessel => buildTaskNotifications(users, vessel, actorId, safeTask, kind, actorName, ownerUserIds))
    .filter(notice => {
      const key = `${notice.userId}\u0000${notice.vesselId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildTaskScopeChangeNotifications(
  users: WorkflowUser[],
  previous: { task: Pick<TaskItem, 'id' | 'description' | 'isInternalControl'> & Partial<Pick<TaskItem, 'ownerUserIds'>>; vessels: WorkflowVessel[] } | null,
  next: { task: Pick<TaskItem, 'id' | 'description' | 'isInternalControl'> & Partial<Pick<TaskItem, 'ownerUserIds'>>; vessels: WorkflowVessel[] } | null,
  actorId: string,
  kind: UserNotification['kind'],
  actorName: string,
  rolePermissions: RolePermissions | undefined,
): UserNotification[] {
  const notices = new Map<string, UserNotification>();
  if (previous) buildTaskNotificationsForVessels(users, previous.vessels, actorId, previous.task, kind, actorName, rolePermissions)
    .forEach(notice => notices.set(`${notice.userId}\u0000${notice.vesselId}`, notice));
  if (next) buildTaskNotificationsForVessels(users, next.vessels, actorId, next.task, kind, actorName, rolePermissions)
    .forEach(notice => notices.set(`${notice.userId}\u0000${notice.vesselId}`, notice));
  return [...notices.values()];
}

import type { InternalControlCase, RolePermissions, TaskItem, TemporaryMeeting, UserAccount, UserNotification, Vessel } from './types';
import { canAccessAllVessels, hasPermission } from './permissions';
import { meetingTaskLinkIsValidForMutation } from './meetingTaskWorkflow';
import { taskVesselIds } from './taskVesselScope';
import { usesPerVesselProgress } from './taskVesselProgress';
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

type TaskVisibilityUser = Pick<UserAccount, 'id' | 'role'> | null | undefined;
type InternalControlVisibilityClaim = Pick<TaskItem, 'id' | 'isInternalControl'> & Partial<Pick<TaskItem, 'internalControlCaseId' | 'sourceMeetingId' | 'sourceMeetingItemId' | 'sourceType' | 'attentionDimension' | 'vesselId' | 'vesselIds' | 'vesselScopeMode' | 'vesselTypeScopes' | 'distributeToVessels' | 'ownerUserIds'>>;
type InternalControlCaseClaim = Pick<InternalControlCase, 'id' | 'vesselId' | 'syncToTask' | 'linkedTaskId'>;
type TaskVisibilityRelationships = {
  internalControlCases: InternalControlCaseClaim[];
  internalControlTasks?: InternalControlVisibilityClaim[];
  meetings: Array<Pick<TemporaryMeeting, 'id' | 'vessels' | 'vesselScopeMode' | 'vesselTypeScopes' | 'isInternalControl' | 'taskItems'>>;
  visibleVesselIds: string[];
};

const visibilityTaskVesselIds = (task: InternalControlVisibilityClaim) => task.vesselIds?.length ? task.vesselIds : task.vesselId ? [task.vesselId] : [];
const hasMeetingVisibilitySemantics = (task: InternalControlVisibilityClaim) => task.sourceType === 'temporary' || task.attentionDimension === 'meeting' || Boolean(task.sourceMeetingId) || Boolean(task.sourceMeetingItemId);

function hasValidInternalControlCaseLink(task: InternalControlVisibilityClaim, cases: InternalControlCaseClaim[], tasks: InternalControlVisibilityClaim[], visibleVesselIds: ReadonlySet<string>) {
  if(!task.isInternalControl||!task.internalControlCaseId||hasMeetingVisibilitySemantics(task))return false;
  const taskScope=visibilityTaskVesselIds(task);
  if(taskScope.length!==1||!visibleVesselIds.has(taskScope[0]))return false;
  const declared=cases.filter(item=>item.id===task.internalControlCaseId);
  const reverse=cases.filter(item=>item.linkedTaskId===task.id);
  const taskRecords=tasks.filter(item=>item.id===task.id);
  const forwardClaims=tasks.filter(item=>item.internalControlCaseId===task.internalControlCaseId);
  return declared.length===1&&reverse.length===1&&declared[0]===reverse[0]
    &&taskRecords.length===1&&forwardClaims.length===1&&forwardClaims[0].id===task.id
    &&declared[0].syncToTask&&declared[0].vesselId===taskScope[0];
}

export function canViewTask(user: TaskVisibilityUser, task: InternalControlVisibilityClaim, relationships?: TaskVisibilityRelationships): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  if (!relationships || !Array.isArray(relationships.internalControlCases) || !Array.isArray(relationships.internalControlTasks) || !Array.isArray(relationships.meetings) || !Array.isArray(relationships.visibleVesselIds)) return false;
  const taskScope = visibilityTaskVesselIds(task);
  const visibleVesselIds=new Set(relationships.visibleVesselIds);
  const hasVisibleVessel = taskScope.some(vesselId => visibleVesselIds.has(vesselId));
  const isResponsibleInternalUser = user.role !== 'vessel' && Boolean(task.ownerUserIds?.includes(user.id));
  if (!hasVisibleVessel && !isResponsibleInternalUser) return false;
  const hasMeetingSemantics = hasMeetingVisibilitySemantics(task);
  let parentMeeting: TaskVisibilityRelationships['meetings'][number] | undefined;
  if (hasMeetingSemantics) {
    if (!task.sourceMeetingId || !task.sourceMeetingItemId) return false;
    const parentMeetings = relationships.meetings.filter(meeting => meeting.id === task.sourceMeetingId);
    if (parentMeetings.length !== 1) return false;
    parentMeeting = parentMeetings[0];
    if (parentMeeting.taskItems.filter(item => item.id === task.sourceMeetingItemId).length !== 1) return false;
    if (!meetingTaskLinkIsValidForMutation(task as Parameters<typeof meetingTaskLinkIsValidForMutation>[0], relationships.meetings)) return false;
  }
  const reverseInternalClaims=relationships.internalControlCases.filter(item=>item.linkedTaskId===task.id);
  const hasInternalClaim=task.isInternalControl||Boolean(task.internalControlCaseId)||reverseInternalClaims.length>0;
  if(user.role==='vessel'){
    if(hasInternalClaim)return false;
    if(hasMeetingSemantics&&parentMeeting?.isInternalControl!==false)return false;
    return true;
  }
  if(hasInternalClaim){
    if(!hasVisibleVessel)return false;
    if(hasMeetingSemantics)return task.isInternalControl&&!task.internalControlCaseId&&reverseInternalClaims.length===0;
    return hasValidInternalControlCaseLink(task,relationships.internalControlCases,relationships.internalControlTasks,visibleVesselIds);
  }
  return true;
}

export function selectTasksVisibleToUser<T extends InternalControlVisibilityClaim>(tasks: T[], user: TaskVisibilityUser, relationships?: TaskVisibilityRelationships): T[] {
  const completeRelationships=relationships?{...relationships,internalControlTasks:relationships.internalControlTasks||tasks}:undefined;
  return tasks.filter(task => canViewTask(user, task, completeRelationships));
}

export function selectInternalControlCasesVisibleToUser<T extends InternalControlCaseClaim>(cases: T[], tasks: InternalControlVisibilityClaim[], user: TaskVisibilityUser, visibleVesselIds: string[]): T[] {
  if(!user)return [];
  if(user.role==='owner'||user.role==='admin')return cases;
  if(user.role==='vessel')return [];
  const visibleIds=new Set(visibleVesselIds);
  return cases.filter(item=>{
    if(!visibleIds.has(item.vesselId)||cases.filter(candidate=>candidate.id===item.id).length!==1)return false;
    const forwardClaims=tasks.filter(task=>task.internalControlCaseId===item.id);
    if(!item.syncToTask&&!item.linkedTaskId)return forwardClaims.length===0;
    if(!item.syncToTask||!item.linkedTaskId)return false;
    const linkedTasks=tasks.filter(task=>task.id===item.linkedTaskId);
    if(linkedTasks.length!==1)return false;
    const linkedTask=linkedTasks[0];
    const reverseCases=cases.filter(candidate=>candidate.linkedTaskId===linkedTask.id);
    const taskScope=visibilityTaskVesselIds(linkedTask);
    return linkedTask.isInternalControl&&!hasMeetingVisibilitySemantics(linkedTask)
      &&linkedTask.internalControlCaseId===item.id&&reverseCases.length===1&&reverseCases[0]===item
      &&forwardClaims.length===1&&forwardClaims[0].id===linkedTask.id
      &&taskScope.length===1&&taskScope[0]===item.vesselId;
  });
}

export function canAcquireTaskEditLock(
  task: TaskItem,
  user: Pick<UserAccount,'id'|'role'|'managedVesselIds'>|null|undefined,
  canEditBusinessContent: boolean,
  visibleVessels: Array<Pick<Vessel,'id'|'assignedUserIds'|'delegateManagers'>>,
  permissions: RolePermissions|undefined,
) {
  if(!user||user.role==='vessel'||!canEditBusinessContent)return false;
  const scopeIds=taskVesselIds(task);
  const visibleScope=scopeIds.map(id=>visibleVessels.find(vessel=>vessel.id===id)).filter((vessel):vessel is Pick<Vessel,'id'|'assignedUserIds'|'delegateManagers'>=>Boolean(vessel));
  if(!scopeIds.length||!visibleScope.length)return false;
  if(usesPerVesselProgress(task))return visibleScope.some(vessel=>canAccessAllVessels(permissions,user,[vessel]));
  return visibleScope.length===scopeIds.length&&canAccessAllVessels(permissions,user,visibleScope);
}

export function canUseVessel(user: Pick<UserAccount, 'role' | 'managedVesselIds'>, vesselId: string): boolean {
  return user.role !== 'vessel' || user.managedVesselIds.length === 1 && user.managedVesselIds[0] === vesselId;
}

export function canDeleteTask(user: Pick<UserAccount, 'role'> | null | undefined): boolean {
  return user?.role === 'owner' || user?.role === 'admin';
}

export function trustedClosureDate(candidate: string | undefined, fallback: string): string {
  const value=(candidate||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return fallback;
  const parsed=new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value:fallback;
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

type InternalControlTaskState = Pick<TaskItem, 'isInternalControl' | 'isAbnormal' | 'internalControlCancelledAt' | 'internalControlCancelledBy'> & Partial<Pick<TaskItem, 'vesselId' | 'vesselIds' | 'vesselProgress' | 'isClosed'>>;

const internalControlScopeIds = (task: InternalControlTaskState) => Array.from(new Set((task.vesselIds?.length ? task.vesselIds : task.vesselId ? [task.vesselId] : []).filter(Boolean)));
const internalControlStateClosed = (task: InternalControlTaskState) => {
  const scopeIds=internalControlScopeIds(task);
  if(!scopeIds.length)return Boolean(task.isClosed);
  return scopeIds.every(vesselId=>{
    const progress=task.vesselProgress?.find(item=>item.vesselId===vesselId);
    return progress?progress.isClosed:Boolean(scopeIds.length===1&&task.isClosed);
  });
};

export function internalControlTransitionRequested(previous: InternalControlTaskState, next: InternalControlTaskState): boolean {
  if (!previous.isInternalControl || internalControlStateClosed(previous)) return false;
  if (!next.isInternalControl) return true;
  const nextIds = new Set(internalControlScopeIds(next));
  return internalControlScopeIds(previous).some(vesselId => !nextIds.has(vesselId));
}

export function validateInternalControlTransition<T extends InternalControlTaskState>(previous: T, next: T, user: WorkflowUser, vesselOrVessels: WorkflowVessel | WorkflowVessel[]): T {
  const result = { ...next };
  if (internalControlStateClosed(previous) && previous.isInternalControl) {
    result.isInternalControl = true;
    result.isAbnormal = true;
    if (previous.vesselId) result.vesselId = previous.vesselId;
    if (previous.vesselIds) result.vesselIds = [...previous.vesselIds];
    return result;
  }
  if (result.isInternalControl) result.isAbnormal = true;
  if (internalControlTransitionRequested(previous, result)) {
    const vessels = Array.isArray(vesselOrVessels) ? vesselOrVessels : [vesselOrVessels];
    const previousIds = internalControlScopeIds(previous);
    if (!vessels.length || (previousIds.length && (vessels.length !== previousIds.length || previousIds.some(id => !vessels.some(vessel => vessel.id === id)))) || !vessels.every(vessel => canCancelInternalControl(user, vessel))) {
      throw new Error('目前帳戶無權取消全部原有涉船範圍的內部管控');
    }
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

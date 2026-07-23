import type { AppData, InternalControlCase, TaskItem, TemporaryMeeting, UserAccount, Vessel } from './types';
import { isMeetingAttentionTask, isVesselDelegatedMeetingTask } from './taskAttention';
import { userManagesInternalControlVessel } from './internalControlWorkflow';
import { taskVesselIds } from './taskVesselScope';
import { taskIsClosedForScope } from './taskVesselProgress';
import { hasActiveVesselDelegation } from './vesselDelegation';

const meetingInvolvesUser = (meeting: TemporaryMeeting | undefined, userId: string) => Boolean(
  meeting && ((meeting.trackingUserIds || []).includes(userId) || meeting.responsibleUserIds.includes(userId)),
);

const taskScopeVessels = (task: TaskItem, visibleVessels: Vessel[]) => {
  const visibleById = new Map(visibleVessels.map(vessel => [vessel.id, vessel]));
  return taskVesselIds(task).map(id => visibleById.get(id)).filter((vessel): vessel is Vessel => Boolean(vessel));
};

export function taskBelongsToUserWorkCenter(
  task: TaskItem,
  user: UserAccount,
  visibleVessels: Vessel[],
  meetings: TemporaryMeeting[],
): boolean {
  const meeting = task.sourceMeetingId ? meetings.find(item => item.id === task.sourceMeetingId) : undefined;
  const scopeVessels = taskScopeVessels(task, visibleVessels);
  const assignedToScopedVessel = scopeVessels.some(vessel =>
    vessel.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(vessel.id) || hasActiveVesselDelegation(vessel, user.id),
  );
  const explicitlyResponsible = task.ownerUserIds.includes(user.id);

  if (isMeetingAttentionTask(task)) {
    return explicitlyResponsible || meetingInvolvesUser(meeting, user.id) || (isVesselDelegatedMeetingTask(task) && assignedToScopedVessel);
  }

  return explicitlyResponsible || assignedToScopedVessel;
}

export function selectUserWorkCenterTasks(data: Pick<AppData, 'tasks' | 'meetings'>, user: UserAccount, visibleVessels: Vessel[]): TaskItem[] {
  const visibleVesselIds = new Set(visibleVessels.map(vessel => vessel.id));
  return data.tasks.filter(task => {
    if (!taskBelongsToUserWorkCenter(task, user, visibleVessels, data.meetings)) return false;
    const scopedIds = taskVesselIds(task).filter(id => visibleVesselIds.has(id));
    return scopedIds.length ? !taskIsClosedForScope(task, scopedIds) : !task.isClosed;
  });
}

export function selectUserWorkCenterInternalCases(
  data: Pick<AppData, 'internalControlCases'>,
  user: Pick<UserAccount, 'id' | 'role' | 'managedVesselIds'>,
  visibleVessels: Vessel[],
): InternalControlCase[] {
  if (user.role === 'vessel') return [];
  const vesselMap = new Map(visibleVessels.map(vessel => [vessel.id, vessel]));
  return data.internalControlCases.filter(item => {
    if (item.isClosed || item.linkedTaskId) return false;
    const vessel = vesselMap.get(item.vesselId);
    return Boolean(vessel && userManagesInternalControlVessel(user, vessel));
  });
}

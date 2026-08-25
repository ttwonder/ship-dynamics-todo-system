import type {
  AppData,
  InternalControlCase,
  MeetingTaskItem,
  TaskItem,
  TemporaryMeeting,
  UserAccount,
  Vessel,
} from './types';
import type { MeetingCommandPayload } from './normalizedCommands';

type JsonObject = Record<string, unknown>;

export function taskCommandContent(task: TaskItem): JsonObject {
  return {
    description: task.description,
    status: task.status,
    priority: task.priority,
    expectedDate: task.expectedDate,
    reportDate: task.reportDate,
    equipmentSubcategory: task.equipmentSubcategory || null,
    isAware: task.isAware,
    isAbnormal: task.isAbnormal,
    vesselIds: task.vesselIds?.length ? task.vesselIds : [task.vesselId],
    categories: task.categories?.length ? task.categories : [task.category].filter(Boolean),
    departments: task.departments,
    ownerUserIds: task.ownerUserIds,
    typeScopes: task.vesselTypeScopes || [],
  };
}

export function vesselProfileCommandValue(vessel: Vessel): JsonObject {
  return {
    name: vessel.name,
    shortName: vessel.shortName,
    fullName: vessel.fullName,
    shipType: vessel.shipType,
    fleetCategory: vessel.fleetCategory,
    fleetTags: vessel.fleetTags,
  };
}

export function vesselPositionCommandValue(vessel: Vessel): JsonObject {
  return {
    source: vessel.position.source,
    location: vessel.position.location,
    speedKnots: vessel.position.speedKnots,
    navigationStatus: vessel.position.navigationStatus,
    lastPort: vessel.position.lastPort,
    nextPort: vessel.position.nextPort,
    eta: vessel.position.eta,
    etb: vessel.position.etb,
    etd: vessel.position.etd,
    manualRemark: vessel.position.manualRemark,
  };
}

export function vesselCargoCommandValue(vessel: Vessel): JsonObject {
  return {
    source: vessel.cargo.source,
    loadStatus: vessel.cargo.loadStatus,
    name: vessel.cargo.name,
    quantity: vessel.cargo.quantity,
    items: vessel.cargo.items,
  };
}

export function vesselNoteCommandValue(vessel: Vessel): JsonObject {
  return {
    statusList: vessel.note.statusList,
    statusSupplement: vessel.note.statusSupplement,
    captain: vessel.note.captain,
    chiefOfficer: vessel.note.chiefOfficer,
    chiefEngineer: vessel.note.chiefEngineer,
    firstEngineer: vessel.note.firstEngineer,
    recentDynamics: vessel.note.recentDynamics,
    subsequentDynamics: vessel.note.subsequentDynamics,
  };
}

export function vesselAssignmentCommandValue(vessel: Vessel): JsonObject[] {
  const managerIds = new Set(vessel.assignedUserIds);
  const delegateIds = new Set(
    vessel.delegateManagers
      .filter(delegate => !managerIds.has(delegate.userId))
      .map(delegate => delegate.userId),
  );
  return [
    ...[...managerIds].map(userId => ({
      userId,
      assignmentKind: 'manager',
      isActive: true,
    })),
    ...[...delegateIds].map(userId => ({
      userId,
      assignmentKind: 'delegate',
      isActive: true,
    })),
    ...(vessel.vesselAccountUserIds || [])
      .filter(userId => !managerIds.has(userId) && !delegateIds.has(userId))
      .map(userId => ({
      userId,
      assignmentKind: 'vessel_account',
      isActive: true,
      })),
  ];
}

export function changedVesselSections(before: Vessel, after: Vessel) {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  return {
    profile: !same(vesselProfileCommandValue(before), vesselProfileCommandValue(after)),
    position: !same(vesselPositionCommandValue(before), vesselPositionCommandValue(after)),
    cargo: !same(vesselCargoCommandValue(before), vesselCargoCommandValue(after)),
    note: !same(vesselNoteCommandValue(before), vesselNoteCommandValue(after)),
    weeklyAttention: !same(before.weeklyAttention, after.weeklyAttention),
    manualAttention: (before.manualAttentionLevel || '') !== (after.manualAttentionLevel || ''),
    assignments: !same(
      vesselAssignmentCommandValue(before),
      vesselAssignmentCommandValue(after),
    ),
  };
}

export function meetingCommandPayload(meeting: TemporaryMeeting): MeetingCommandPayload {
  return {
    scopeMode: meeting.vesselScopeMode || 'vessels',
    subject: meeting.subject,
    status: meeting.status || '待召開',
    meetingDate: meeting.meetingDate,
    vesselIds: meeting.vessels,
    vesselTypeScopes: meeting.vesselTypeScopes || [],
    departments: meeting.departments,
    participantUserIds: meeting.participantUserIds,
    trackingUserIds: meeting.trackingUserIds,
    responsibleUserIds: meeting.responsibleUserIds,
    reason: meeting.reason,
    resolution: meeting.resolution,
    expectedDate: meeting.expectedDate || null,
    completedDate: meeting.completedDate || null,
    priority: meeting.priority,
    isAbnormal: meeting.isAbnormal,
    isInternalControl: meeting.isInternalControl,
    includeInMorning: meeting.includeInMorning === true,
    items: meetingTaskItems(meeting),
  };
}

function meetingTaskItems(meeting: TemporaryMeeting): MeetingTaskItem[] {
  const items = meeting.taskItems?.length
    ? meeting.taskItems
    : meeting.taskDescription
      ? [{
          id: `${meeting.id}-item-1`,
          description: meeting.taskDescription,
          categories: [],
          distributeToVessels: false,
        }]
      : [];
  return items.map(item => ({
    id: item.id,
    description: item.description,
    categories: item.categories || [],
    distributeToVessels: item.distributeToVessels === true,
  }));
}

export function meetingTaskGuards(data: AppData, meetingId: string) {
  return data.tasks
    .filter(task => task.sourceMeetingId === meetingId)
    .map(task => ({ taskId: task.id, baseVersion: null }));
}

export function internalCaseCommandPayload(item: InternalControlCase): JsonObject {
  return {
    vesselId: item.vesselId,
    reportDate: item.reportDate,
    reportSource: item.reportSource,
    description: item.description,
    priority: item.priority,
    category: item.category,
    equipmentSubcategory: item.category === '設備故障'
      ? item.equipmentSubcategory || null
      : null,
    isAware: item.isAware,
    status: item.status,
    origin: item.origin,
    isClosed: item.isClosed,
    ...(item.isClosed ? { closedDate: item.closedDate || null } : {}),
    departments: item.departments,
  };
}

export function linkedInternalTaskCommandPayload(
  item: InternalControlCase,
  task: (Pick<TaskItem, 'id' | 'expectedDate' | 'categories' | 'ownerUserIds'> & {
    isAbnormal?: boolean;
  }) | undefined,
): JsonObject | null {
  if (!item.syncToTask) return null;
  return {
    id: item.linkedTaskId || task?.id || crypto.randomUUID(),
    expectedDate: task?.expectedDate || item.reportDate,
    categories: task?.categories?.length ? task.categories : [item.category].filter(Boolean),
    ownerUserIds: task?.ownerUserIds || [],
    ...(typeof task?.isAbnormal === 'boolean' ? { isAbnormal: task.isAbnormal } : {}),
  };
}

export function userCommandPayload(user: UserAccount): JsonObject {
  return {
    department: user.department,
    name: user.name,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
  };
}

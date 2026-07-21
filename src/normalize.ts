import type {
  AgendaReport,
  AppData,
  AuditLog,
  LoadStatus,
  MeetingVesselScopeMode,
  NavigationStatus,
  ShipStatus,
  StatusLog,
  TaskVesselProgress,
  TaskPriority,
  TemporaryMeeting,
  TemporaryMeetingStatus,
  UserNotification,
  UserRole,
  VesselAttentionLevel,
  VesselPosition,
  WeeklyAttentionKey,
} from './types';
import { nowIso } from './utils';
import { normalizeRolePermissions } from './permissions';
import { isMeetingTaskSource, normalizeConfiguredMeetingTaskCategories, normalizeConfiguredTaskCategories, normalizeMeetingTaskCategoryList, normalizeTaskCategoryList, sanitizeEditableMeetingTaskCategories, sanitizeEditableTaskCategories } from './taskCategories';

const roles: UserRole[] = ['owner', 'admin', 'operator', 'vessel'];
const INVALID_PASSWORD_HASH = '0'.repeat(64);
const auditRoles: Array<UserRole | 'system'> = [...roles, 'system'];
const priorities: TaskPriority[] = ['急', '高', '中', '低'];
const vesselAttentionLevels: VesselAttentionLevel[] = [...priorities, '特別關注'];
const shipStatuses: ShipStatus[] = ['loading', 'unloading', 'to load', 'to unload', 'waiting order', 'drydock/repiar'];
const legacyShipStatusMap: Record<string, ShipStatus> = {
  '裝載': 'loading',
  '空載': 'unloading',
  '去裝貨': 'to load',
  '去卸貨': 'to unload',
  '等待order': 'waiting order',
  '塢修/航修': 'drydock/repiar',
};
const normalizeShipStatus = (value: unknown): ShipStatus | undefined => {
  const normalized = text(value);
  return legacyShipStatusMap[normalized] || shipStatuses.find(status => status === normalized);
};
const navigationStatuses: NavigationStatus[] = ['航行', '拋錨', '停泊'];
const loadStatuses: LoadStatus[] = ['空載', '非空載', '滿載'];
const weeklyAttentionKeys: WeeklyAttentionKey[] = ['crew-operation', 'bunkering-water', 'materials-parts', 'maintenance', 'survey', 'audit-inspection', 'psc-window'];
const meetingStatuses: TemporaryMeetingStatus[] = ['待召開', '追蹤中', '已完成'];
const normalizeMeetingStatus = (value: unknown): TemporaryMeetingStatus =>
  value === '待開會' ? '待召開' : value === '進行中' ? '追蹤中' : oneOf(value, meetingStatuses, '待召開');
const scopeModes: MeetingVesselScopeMode[] = ['all', 'types', 'vessels'];
const positionSources: VesselPosition['source'][] = ['mock-smart-ship-api', 'manual', 'smart-ship-api'];

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const objects = (value: unknown): Record<string, unknown>[] => list(value).map(object).filter((item): item is Record<string, unknown> => item !== null);
const strings = (value: unknown): string[] => list(value).filter((item): item is string => typeof item === 'string');
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const bool = (value: unknown, fallback = false) => typeof value === 'boolean' ? value : fallback;
const finite = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;


function normalizeStatusLogs(value: unknown): StatusLog[] {
  return objects(value).map(item => ({
    id: text(item.id),
    at: text(item.at),
    by: text(item.by),
    byUserId: text(item.byUserId) || undefined,
    text: text(item.text),
  })).filter(item => item.id && item.text);
}

function normalizeTaskVesselProgress(value: unknown): TaskVesselProgress[] {
  const seen=new Set<string>();
  return objects(value).map(item=>({
    vesselId:text(item.vesselId),
    status:text(item.status),
    isClosed:bool(item.isClosed),
    closedDate:text(item.closedDate)||undefined,
    closedBy:text(item.closedBy)||undefined,
    updatedAt:text(item.updatedAt)||undefined,
    updatedBy:text(item.updatedBy)||undefined,
    statusLogs:normalizeStatusLogs(item.statusLogs),
  })).filter(item=>{
    if(!item.vesselId||seen.has(item.vesselId))return false;
    seen.add(item.vesselId);
    return true;
  });
}

function normalizeAgendaReports(value: unknown): AgendaReport[] {
  return objects(value).map(item => ({
    id: text(item.id),
    title: text(item.title),
    vesselIds: strings(item.vesselIds),
    createdBy: text(item.createdBy),
    createdAt: text(item.createdAt),
    taskCount: finite(item.taskCount),
  })).filter(item => item.id);
}

function normalizeAuditLogs(value: unknown): AuditLog[] {
  return objects(value).map(item => ({
    id: text(item.id),
    at: text(item.at),
    actorId: text(item.actorId),
    actorName: text(item.actorName),
    actorRole: oneOf(item.actorRole, auditRoles, 'system'),
    action: text(item.action),
    entityType: text(item.entityType),
    entityId: text(item.entityId),
    detail: text(item.detail),
  })).filter(item => item.id);
}

function normalizeNotifications(value: unknown): UserNotification[] {
  const kinds: UserNotification['kind'][] = ['task_created', 'task_updated', 'task_archived', 'internal_control_cancelled', 'task_deleted'];
  return objects(value).map(item => ({
    id: text(item.id), userId: text(item.userId), vesselId: text(item.vesselId), taskId: text(item.taskId),
    kind: oneOf(item.kind, kinds, 'task_updated'), title: text(item.title), message: text(item.message),
    actorId: text(item.actorId), createdAt: text(item.createdAt), readAt: text(item.readAt) || undefined,
  })).filter(item => item.id && item.userId && item.taskId);
}

function normalizeMeetings(value: unknown, timestamp: string, meetingTaskCategories: string[]): TemporaryMeeting[] {
  return objects(value).map(item => {
    const id = text(item.id);
    const taskDescription = text(item.taskDescription);
    const seenTaskItemIds = new Set<string>();
    const taskItems = objects(item.taskItems).map((taskItem, index) => {
      const rawId = text(taskItem.id, `${id}-task-${index + 1}`);
      const cleanDescription = text(taskItem.description).trim();
      const uniqueId = seenTaskItemIds.has(rawId) ? `${rawId}-duplicate-${index + 1}` : rawId;
      seenTaskItemIds.add(uniqueId);
      return { id: uniqueId, description: cleanDescription, categories: normalizeMeetingTaskCategoryList(taskItem.categories, meetingTaskCategories), distributeToVessels: bool(taskItem.distributeToVessels) };
    }).filter(taskItem => taskItem.id && taskItem.description);
    if (!taskItems.length && Object.prototype.hasOwnProperty.call(item, 'taskDescription') && taskDescription.trim()) {
      taskItems.push({ id: `${id}-task-1`, description: taskDescription.trim(), categories: normalizeMeetingTaskCategoryList([], meetingTaskCategories), distributeToVessels: false });
    }
    const participantUserIds = strings(item.participantUserIds);
    const responsibleUserIds = strings(item.responsibleUserIds);
    const trackingUserIds = Object.prototype.hasOwnProperty.call(item, 'trackingUserIds') ? strings(item.trackingUserIds) : [...responsibleUserIds];
    return {
      id,
      subject: text(item.subject),
      status: normalizeMeetingStatus(item.status),
      meetingDate: text(item.meetingDate),
      vesselScopeMode: oneOf(item.vesselScopeMode, scopeModes, 'vessels'),
      vesselTypeScopes: strings(item.vesselTypeScopes),
      vessels: strings(item.vessels),
      reason: text(item.reason),
      departments: strings(item.departments),
      participantUserIds,
      trackingUserIds,
      responsibleUserIds,
      resolution: text(item.resolution),
      taskDescription,
      taskItems,
      expectedDate: text(item.expectedDate),
      completedDate: text(item.completedDate) || undefined,
      completedBy: text(item.completedBy) || undefined,
      priority: oneOf(item.priority, priorities, '中'),
      includeInMorning: bool(item.includeInMorning),
      latestStatus: text(item.latestStatus),
      statusLogs: normalizeStatusLogs(item.statusLogs),
      createdBy: text(item.createdBy),
      createdAt: text(item.createdAt, timestamp),
      updatedAt: text(item.updatedAt, text(item.createdAt, timestamp)),
    };
  }).filter(item => item.id);
}

/** Migrate optional fields while rejecting payloads that do not contain the core collections and settings object. */
export function normalizeAppData(value: unknown): AppData | null {
  const raw = object(value);
  if (!raw || !Array.isArray(raw.users) || !Array.isArray(raw.vessels) || !Array.isArray(raw.tasks)) return null;
  const settings = object(raw.settings);
  if (!settings) return null;
  const timestamp = text(raw.updatedAt, nowIso());
  const meetingTaskDescriptionWasProvided = new Map(objects(raw.meetings).map(item => [text(item.id), Object.prototype.hasOwnProperty.call(item, 'taskDescription')]));
  const meetingTaskItemsWereProvided = new Map(objects(raw.meetings).map(item => [text(item.id), Object.prototype.hasOwnProperty.call(item, 'taskItems')]));
  const normalizedTaskCategories = finite(settings.taskCategorySchemaVersion) === 2
    ? sanitizeEditableTaskCategories(settings.taskCategories)
    : normalizeConfiguredTaskCategories(settings.taskCategories);
  const normalizedMeetingTaskCategories = finite(settings.meetingTaskCategorySchemaVersion) === 2
    ? sanitizeEditableMeetingTaskCategories(settings.meetingTaskCategories)
    : normalizeConfiguredMeetingTaskCategories(settings.meetingTaskCategories);

  const normalized: AppData = {
    revision: finite(raw.revision),
    updatedAt: timestamp,
    settings: {
      sitePasswordHash: text(settings.sitePasswordHash),
      systemTitle: text(settings.systemTitle, '船舶動態與會議管理系統'),
      departments: strings(settings.departments),
      taskCategories: normalizedTaskCategories,
      taskCategorySchemaVersion: 2,
      meetingTaskCategories: normalizedMeetingTaskCategories,
      meetingTaskCategorySchemaVersion: 2,
      vesselStatuses: [...shipStatuses],
      priorities: [...priorities],
      rolePermissions: normalizeRolePermissions(settings.rolePermissions),
      nonOwnerPasswordResetVersion: finite(settings.nonOwnerPasswordResetVersion, 0),
      meetingTaskAggregationVersion: finite(settings.meetingTaskAggregationVersion, 0),
      lastCloudSyncAt: text(settings.lastCloudSyncAt),
    },
    users: objects(raw.users).map(item => {
      const role = oneOf(item.role, roles, 'operator');
      const rawPasswordHash=item.passwordHash;
      const passwordRequired = role === 'owner' || role === 'admin';
      const passwordHashValid=typeof rawPasswordHash==='string'&&(rawPasswordHash===''||/^[a-f0-9]{64}$/i.test(rawPasswordHash));
      return {
        id: text(item.id),
        department: text(item.department),
        name: text(item.name),
        username: text(item.username),
        role,
        passwordHash: passwordRequired ? (passwordHashValid ? rawPasswordHash.toLowerCase() : INVALID_PASSWORD_HASH) : '',
        isActive: (passwordRequired ? passwordHashValid : true) && bool(item.isActive, true),
        managedVesselIds: strings(item.managedVesselIds),
        createdAt: text(item.createdAt, timestamp),
        updatedAt: text(item.updatedAt, timestamp),
      };
    }).filter(item => item.id && item.name),
    vessels: objects(raw.vessels).map(item => {
      const position = object(item.position) || {};
      const cargo = object(item.cargo) || {};
      const note = object(item.note) || {};
      const cargoItems = objects(cargo.items).map(entry => ({
        name: text(entry.name),
        quantity: text(entry.quantity),
      })).filter(entry => entry.name || entry.quantity);
      const legacyCargoName = text(cargo.name);
      const legacyCargoQuantity = text(cargo.quantity);
      const recentDynamics = Array.from(new Set([text(note.recentDynamics), text(note.subsequentDynamics)].filter(Boolean))).join('\n');
      if (!cargoItems.length && (legacyCargoName || legacyCargoQuantity)) cargoItems.push({ name: legacyCargoName, quantity: legacyCargoQuantity });
      return {
        id: text(item.id),
        name: text(item.name),
        shortName: text(item.shortName, text(item.name)),
        fullName: text(item.fullName, text(item.name)),
        shipType: text(item.shipType),
        fleetCategory: text(item.fleetCategory),
        fleetTags: strings(item.fleetTags),
        assignedUserIds: strings(item.assignedUserIds),
        isActive: bool(item.isActive, true),
        position: {
          source: oneOf(position.source, positionSources, 'manual'),
          location: text(position.location),
          speedKnots: finite(position.speedKnots),
          navigationStatus: oneOf(position.navigationStatus, navigationStatuses, '航行'),
          lastPort: text(position.lastPort),
          nextPort: text(position.nextPort),
          eta: text(position.eta),
          etb: text(position.etb),
          etd: text(position.etd),
          updatedAt: text(position.updatedAt, timestamp),
          manualRemark: text(position.manualRemark),
        },
        cargo: {
          source: oneOf(cargo.source, positionSources, 'manual'),
          loadStatus: oneOf(cargo.loadStatus, loadStatuses, legacyCargoName === '空載' ? '空載' : '非空載'),
          name: legacyCargoName || cargoItems[0]?.name || '',
          quantity: legacyCargoQuantity || cargoItems[0]?.quantity || '',
          items: cargoItems,
          updatedAt: text(cargo.updatedAt, timestamp),
        },
        note: {
          statusList: Array.from(new Set(strings(note.statusList).map(normalizeShipStatus).filter((entry): entry is ShipStatus => Boolean(entry)))),
          recentDynamics,
          subsequentDynamics: '',
          updatedAt: text(note.updatedAt, timestamp),
        },
        weeklyAttention: strings(item.weeklyAttention).filter((entry): entry is WeeklyAttentionKey => weeklyAttentionKeys.includes(entry as WeeklyAttentionKey)),
        manualAttentionLevel: oneOf(item.manualAttentionLevel, ['', ...vesselAttentionLevels], ''),
        createdAt: text(item.createdAt, timestamp),
        updatedAt: text(item.updatedAt, timestamp),
      };
    }).filter(item => item.id && item.name),
    tasks: objects(raw.tasks).map(item => {
      const vesselId=text(item.vesselId);
      const vesselIds=strings(item.vesselIds);
      const sourceMeetingId=text(item.sourceMeetingId)||undefined;
      const sourceType=oneOf(item.sourceType, ['morning', 'temporary'] as const, sourceMeetingId ? 'temporary' : 'morning');
      const attentionDimension=oneOf(item.attentionDimension, ['task', 'meeting'] as const, sourceMeetingId || sourceType === 'temporary' ? 'meeting' : 'task');
      const meetingSource=isMeetingTaskSource({ sourceType, sourceMeetingId, attentionDimension });
      const categories = meetingSource ? normalizeMeetingTaskCategoryList(item.categories || item.category, normalizedMeetingTaskCategories) : normalizeTaskCategoryList(item.category, item.categories);
      const status=text(item.status);
      const isClosed=bool(item.isClosed);
      const closedDate=text(item.closedDate)||undefined;
      const closedBy=text(item.closedBy)||undefined;
      const updatedAt=text(item.updatedAt,timestamp);
      const updatedBy=text(item.updatedBy);
      const statusLogs=normalizeStatusLogs(item.statusLogs);
      const taskScopeIds=Array.from(new Set([vesselId,...vesselIds].filter(Boolean)));
      const isLegacyMultiVesselMeeting=Boolean(sourceMeetingId)&&taskScopeIds.length>1&&!Object.prototype.hasOwnProperty.call(item,'vesselProgress');
      const vesselProgress=isLegacyMultiVesselMeeting
        ? taskScopeIds.map(progressVesselId=>({vesselId:progressVesselId,status,isClosed,closedDate,closedBy,updatedAt,updatedBy,statusLogs:statusLogs.map(log=>({...log}))}))
        : normalizeTaskVesselProgress(item.vesselProgress);
      return ({
      id: text(item.id),
      vesselId,
      vesselIds,
      vesselScopeMode: oneOf(item.vesselScopeMode, scopeModes, 'vessels'),
      vesselTypeScopes: strings(item.vesselTypeScopes),
      priority: oneOf(item.priority, priorities, '中'),
      attentionDimension,
      isAware: bool(item.isAware),
      isAbnormal: bool(item.isAbnormal) || bool(item.isInternalControl),
      isInternalControl: bool(item.isInternalControl),
      internalControlCancelledAt: text(item.internalControlCancelledAt) || undefined,
      internalControlCancelledBy: text(item.internalControlCancelledBy) || undefined,
      category: categories[0] || '',
      categories,
      description: text(item.description),
      status,
      expectedDate: text(item.expectedDate),
      departments: strings(item.departments),
      ownerUserIds: strings(item.ownerUserIds),
      isClosed,
      closedDate,
      closedBy,
      sourceMeetingId,
      sourceMeetingItemId: text(item.sourceMeetingItemId) || undefined,
      distributeToVessels: bool(item.distributeToVessels),
      sourceType,
      createdBy: text(item.createdBy),
      updatedBy,
      createdAt: text(item.createdAt, timestamp),
      updatedAt,
      statusLogs,
      vesselProgress,
    });
    }).filter(item => item.id && item.vesselId),
    meetings: normalizeMeetings(raw.meetings, timestamp, normalizedMeetingTaskCategories),
    agendaReports: normalizeAgendaReports(raw.agendaReports),
    auditLogs: normalizeAuditLogs(raw.auditLogs),
    notifications: normalizeNotifications(raw.notifications),
  };
  normalized.meetings.forEach(meeting => {
    const taskItemsProvided = meetingTaskItemsWereProvided.get(meeting.id);
    const taskDescriptionProvided = meetingTaskDescriptionWasProvided.get(meeting.id);
    if (!meeting.taskItems.length && !taskItemsProvided && !taskDescriptionProvided) {
      const linkedTask = normalized.tasks.find(task => task.sourceMeetingId === meeting.id && task.description.trim());
      if (linkedTask) meeting.taskItems.push({ id: `${meeting.id}-task-1`, description: linkedTask.description, categories: normalizeMeetingTaskCategoryList(linkedTask.categories, normalizedMeetingTaskCategories), distributeToVessels: linkedTask.distributeToVessels === true });
    }
    if (meeting.taskItems.length) meeting.taskDescription = meeting.taskItems[0].description;
    const firstItemId = meeting.taskItems[0]?.id;
    if (firstItemId) {
      const itemIds=new Set(meeting.taskItems.map(item=>item.id));
      normalized.tasks
        .filter(task => task.sourceMeetingId === meeting.id && (!task.sourceMeetingItemId || (!itemIds.has(task.sourceMeetingItemId) && meeting.taskItems.length === 1)))
        .forEach(task => { task.sourceMeetingItemId = firstItemId; });
    }
  });
  const activeVesselIds = new Set(normalized.vessels.filter(vessel => vessel.isActive).map(vessel => vessel.id));
  if (!normalized.users.some(user => user.role === 'owner')) {
    const designatedOwner = normalized.users.find(user => user.name === '朱世毅');
    if (designatedOwner) designatedOwner.role = 'owner';
  }

  const vesselUserIds = new Set(normalized.users.filter(user => user.role === 'vessel').map(user => user.id));
  const ownerUserIds = new Set(normalized.users.filter(user => user.role === 'owner').map(user => user.id));
  const personnelDepartments = normalized.settings.departments.map(department => department.trim()).filter(department => department && department !== '船舶帳戶');
  const fallbackPersonnelDepartment = personnelDepartments[0] || '未指定部門';
  if (!personnelDepartments.length && !normalized.settings.departments.includes(fallbackPersonnelDepartment)) normalized.settings.departments.push(fallbackPersonnelDepartment);
  normalized.users.filter(user => user.role !== 'vessel').forEach(user => {
    if (!user.department.trim() || user.department === '船舶帳戶') user.department = fallbackPersonnelDepartment;
    if (!normalized.settings.departments.includes(user.department)) normalized.settings.departments.push(user.department);
  });
  normalized.users.filter(user => ownerUserIds.has(user.id)).forEach(user => { user.managedVesselIds = []; });
  normalized.users.filter(user => user.role === 'vessel').forEach(user => {
    const managed = user.managedVesselIds.filter((id, index, ids) => activeVesselIds.has(id) && ids.indexOf(id) === index);
    const assigned = normalized.vessels.filter(vessel => vessel.isActive && vessel.assignedUserIds.includes(user.id)).map(vessel => vessel.id);
    const binding = [...managed, ...assigned].find((id, index, ids) => activeVesselIds.has(id) && ids.indexOf(id) === index);
    user.department = '船舶帳戶';
    user.managedVesselIds = binding ? [binding] : [];
    if (!binding) user.isActive = false;
  });
  normalized.vessels.forEach(vessel => {
    vessel.assignedUserIds = vessel.assignedUserIds.filter(userId => !vesselUserIds.has(userId) && !ownerUserIds.has(userId));
  });
  normalized.users.filter(user => user.isActive && (user.role === 'admin' || user.role === 'operator')).forEach(user => {
    const explicitManaged = user.managedVesselIds.filter((id, index, ids) => activeVesselIds.has(id) && ids.indexOf(id) === index);
    const assigned = normalized.vessels.filter(vessel => vessel.isActive && vessel.assignedUserIds.includes(user.id)).map(vessel => vessel.id);
    user.managedVesselIds = Array.from(new Set([...explicitManaged, ...assigned]));
  });
  normalized.vessels.forEach(vessel => {
    const explicitManagers = normalized.users.filter(user => user.isActive && (user.role === 'admin' || user.role === 'operator') && user.managedVesselIds.includes(vessel.id)).map(user => user.id);
    vessel.assignedUserIds = Array.from(new Set([...vessel.assignedUserIds, ...explicitManagers])).filter(userId => normalized.users.some(user => user.id === userId && user.isActive && (user.role === 'admin' || user.role === 'operator')));
  });
  return normalized;
}

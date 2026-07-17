import type {
  AgendaReport,
  AppData,
  AuditLog,
  LoadStatus,
  MeetingVesselScopeMode,
  NavigationStatus,
  ShipStatus,
  StatusLog,
  TaskPriority,
  TemporaryMeeting,
  TemporaryMeetingStatus,
  UserNotification,
  UserRole,
  VesselPosition,
  WeeklyAttentionKey,
} from './types';
import { nowIso } from './utils';
import { normalizeRolePermissions } from './permissions';

const roles: UserRole[] = ['owner', 'admin', 'operator', 'vessel'];
const auditRoles: Array<UserRole | 'system'> = [...roles, 'system'];
const priorities: TaskPriority[] = ['急', '高', '中', '低'];
const shipStatuses: ShipStatus[] = ['裝載', '空載', '去卸貨', '去裝貨', '等待order'];
const navigationStatuses: NavigationStatus[] = ['航行', '拋錨', '停泊'];
const loadStatuses: LoadStatus[] = ['空載', '非空載', '滿載'];
const weeklyAttentionKeys: WeeklyAttentionKey[] = ['crew-operation', 'bunkering-water', 'materials-parts', 'maintenance', 'survey', 'audit-inspection', 'psc-window'];
const meetingStatuses: TemporaryMeetingStatus[] = ['待開會', '進行中', '追蹤中', '已完成'];
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
    text: text(item.text),
  })).filter(item => item.id && item.text);
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
  const kinds: UserNotification['kind'][] = ['task_created', 'task_updated', 'internal_control_cancelled', 'task_deleted'];
  return objects(value).map(item => ({
    id: text(item.id), userId: text(item.userId), vesselId: text(item.vesselId), taskId: text(item.taskId),
    kind: oneOf(item.kind, kinds, 'task_updated'), title: text(item.title), message: text(item.message),
    actorId: text(item.actorId), createdAt: text(item.createdAt), readAt: text(item.readAt) || undefined,
  })).filter(item => item.id && item.userId && item.taskId);
}

function normalizeMeetings(value: unknown, timestamp: string): TemporaryMeeting[] {
  return objects(value).map(item => ({
    id: text(item.id),
    subject: text(item.subject),
    status: oneOf(item.status, meetingStatuses, '待開會'),
    meetingDate: text(item.meetingDate),
    vesselScopeMode: oneOf(item.vesselScopeMode, scopeModes, 'vessels'),
    vesselTypeScopes: strings(item.vesselTypeScopes),
    vessels: strings(item.vessels),
    reason: text(item.reason),
    departments: strings(item.departments),
    resolution: text(item.resolution),
    expectedDate: text(item.expectedDate),
    priority: oneOf(item.priority, priorities, '中'),
    createdBy: text(item.createdBy),
    createdAt: text(item.createdAt, timestamp),
    updatedAt: text(item.updatedAt, text(item.createdAt, timestamp)),
  })).filter(item => item.id);
}

/** Migrate optional fields while rejecting payloads that do not contain the core collections and settings object. */
export function normalizeAppData(value: unknown): AppData | null {
  const raw = object(value);
  if (!raw || !Array.isArray(raw.users) || !Array.isArray(raw.vessels) || !Array.isArray(raw.tasks)) return null;
  const settings = object(raw.settings);
  if (!settings) return null;
  const timestamp = text(raw.updatedAt, nowIso());

  const normalized: AppData = {
    revision: finite(raw.revision),
    updatedAt: timestamp,
    settings: {
      sitePasswordHash: text(settings.sitePasswordHash),
      systemTitle: text(settings.systemTitle, '船舶動態與會議管理系統'),
      departments: strings(settings.departments),
      taskCategories: strings(settings.taskCategories),
      vesselStatuses: strings(settings.vesselStatuses).filter((item): item is ShipStatus => shipStatuses.includes(item as ShipStatus)),
      priorities: [...priorities],
      rolePermissions: normalizeRolePermissions(settings.rolePermissions),
      lastCloudSyncAt: text(settings.lastCloudSyncAt),
    },
    users: objects(raw.users).map(item => ({
      id: text(item.id),
      department: text(item.department),
      name: text(item.name),
      username: text(item.username),
      role: oneOf(item.role, roles, 'operator'),
      passwordHash: text(item.passwordHash),
      isActive: bool(item.isActive, true),
      managedVesselIds: strings(item.managedVesselIds),
      createdAt: text(item.createdAt, timestamp),
      updatedAt: text(item.updatedAt, timestamp),
    })).filter(item => item.id && item.name),
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
          statusList: strings(note.statusList).filter((entry): entry is ShipStatus => shipStatuses.includes(entry as ShipStatus)),
          recentDynamics: text(note.recentDynamics),
          subsequentDynamics: text(note.subsequentDynamics),
          updatedAt: text(note.updatedAt, timestamp),
        },
        weeklyAttention: strings(item.weeklyAttention).filter((entry): entry is WeeklyAttentionKey => weeklyAttentionKeys.includes(entry as WeeklyAttentionKey)),
        createdAt: text(item.createdAt, timestamp),
        updatedAt: text(item.updatedAt, timestamp),
      };
    }).filter(item => item.id && item.name),
    tasks: objects(raw.tasks).map(item => ({
      id: text(item.id),
      vesselId: text(item.vesselId),
      priority: oneOf(item.priority, priorities, '中'),
      isAware: bool(item.isAware),
      isAbnormal: bool(item.isAbnormal) || bool(item.isInternalControl),
      isInternalControl: bool(item.isInternalControl),
      internalControlCancelledAt: text(item.internalControlCancelledAt) || undefined,
      internalControlCancelledBy: text(item.internalControlCancelledBy) || undefined,
      category: text(item.category),
      description: text(item.description),
      status: text(item.status),
      expectedDate: text(item.expectedDate),
      departments: strings(item.departments),
      ownerUserIds: strings(item.ownerUserIds),
      isClosed: bool(item.isClosed),
      closedDate: text(item.closedDate) || undefined,
      closedBy: text(item.closedBy) || undefined,
      sourceMeetingId: text(item.sourceMeetingId) || undefined,
      createdBy: text(item.createdBy),
      updatedBy: text(item.updatedBy),
      createdAt: text(item.createdAt, timestamp),
      updatedAt: text(item.updatedAt, timestamp),
      statusLogs: normalizeStatusLogs(item.statusLogs),
    })).filter(item => item.id && item.vesselId),
    meetings: normalizeMeetings(raw.meetings, timestamp),
    agendaReports: normalizeAgendaReports(raw.agendaReports),
    auditLogs: normalizeAuditLogs(raw.auditLogs),
    notifications: normalizeNotifications(raw.notifications),
  };
  const activeVesselIds = new Set(normalized.vessels.filter(vessel => vessel.isActive).map(vessel => vessel.id));
  const vesselUserIds = new Set(normalized.users.filter(user => user.role === 'vessel').map(user => user.id));
  normalized.users.filter(user => user.role === 'vessel').forEach(user => {
    const managed = user.managedVesselIds.filter((id, index, ids) => activeVesselIds.has(id) && ids.indexOf(id) === index);
    const assigned = normalized.vessels.filter(vessel => vessel.isActive && vessel.assignedUserIds.includes(user.id)).map(vessel => vessel.id);
    const binding = [...managed, ...assigned].find((id, index, ids) => activeVesselIds.has(id) && ids.indexOf(id) === index);
    user.department = '船舶帳戶';
    user.managedVesselIds = binding ? [binding] : [];
    if (!binding) user.isActive = false;
  });
  normalized.vessels.forEach(vessel => {
    vessel.assignedUserIds = vessel.assignedUserIds.filter(userId => !vesselUserIds.has(userId));
  });
  return normalized;
}

import type { NormalizedRequestScope } from './normalizedSupabaseClient';
import type {
  AgendaReport,
  AppData,
  AuditLog,
  InternalControlCase,
  RolePermissions,
  StatusLog,
  TaskItem,
  TaskPriority,
  TemporaryMeeting,
  UserAccount,
  UserNotification,
  UserRole,
  Vessel,
} from './types';
import { DEFAULT_ROLE_PERMISSIONS, normalizeRolePermissions } from './permissions';

type JsonObject = Record<string, unknown>;
type Row = Record<string, any>;

interface QueryResult<T> {
  data: T;
  error: unknown;
}

interface QueryBuilder<T = Row> extends PromiseLike<QueryResult<T[]>> {
  select(selection: string): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  limit(maxRows: number): QueryBuilder<T>;
}

export interface NormalizedProjectionClient {
  from<T = Row>(table: string): QueryBuilder<T>;
}

interface TableDefinition {
  selection: string;
  order?: string;
  limit?: number;
}

const TABLES = {
  memberships: {
    table: 'sd_memberships',
    selection: 'workspace_id,user_id,department,role,is_active,version,created_at,updated_at,profile:sd_profiles!inner(display_name,username_label)',
    order: 'department',
  },
  vesselAssignments: { table: 'sd_vessel_assignments', selection: '*', order: 'vessel_id' },
  vessels: { table: 'sd_vessels', selection: '*', order: 'id' },
  tasks: { table: 'sd_tasks', selection: '*', order: 'id' },
  taskVessels: { table: 'sd_task_vessels', selection: '*', order: 'task_id' },
  taskCategories: { table: 'sd_task_categories', selection: '*', order: 'ordinal' },
  taskDepartments: { table: 'sd_task_departments', selection: '*', order: 'ordinal' },
  taskOwners: { table: 'sd_task_owners', selection: '*', order: 'ordinal' },
  taskTypeScopes: { table: 'sd_task_type_scopes', selection: '*', order: 'ordinal' },
  taskStatusEvents: { table: 'sd_task_status_events', selection: '*', order: 'created_at' },
  taskVesselStatusEvents: {
    table: 'sd_task_vessel_status_events',
    selection: '*',
    order: 'created_at',
  },
  meetings: { table: 'sd_meetings', selection: '*', order: 'meeting_date' },
  meetingVessels: { table: 'sd_meeting_vessels', selection: '*', order: 'vessel_id' },
  meetingTypeScopes: { table: 'sd_meeting_type_scopes', selection: '*', order: 'ship_type' },
  meetingDepartments: { table: 'sd_meeting_departments', selection: '*', order: 'department' },
  meetingParticipants: {
    table: 'sd_meeting_participants',
    selection: '*',
    order: 'user_id',
  },
  meetingItems: { table: 'sd_meeting_items', selection: '*', order: 'ordinal' },
  meetingItemCategories: {
    table: 'sd_meeting_item_categories',
    selection: '*',
    order: 'category',
  },
  meetingStatusEvents: {
    table: 'sd_meeting_status_events',
    selection: '*',
    order: 'created_at',
  },
  meetingStatusCorrections: {
    table: 'sd_meeting_status_event_corrections',
    selection: '*',
    order: 'created_at',
  },
  internalCases: { table: 'sd_internal_cases', selection: '*', order: 'id' },
  internalCaseDepartments: {
    table: 'sd_internal_case_departments',
    selection: '*',
    order: 'ordinal',
  },
  internalCaseLinks: { table: 'sd_internal_case_task_links', selection: '*', order: 'case_id' },
  internalCaseStatusEvents: {
    table: 'sd_internal_case_status_events',
    selection: '*',
    order: 'created_at',
  },
  notifications: { table: 'sd_notifications', selection: '*', order: 'created_at', limit: 500 },
  savedReports: { table: 'sd_saved_reports', selection: '*', order: 'created_at', limit: 500 },
  savedReportVessels: {
    table: 'sd_saved_report_vessels',
    selection: '*',
    order: 'ordinal',
  },
  auditEvents: { table: 'sd_audit_events', selection: '*', order: 'created_at', limit: 500 },
  settings: { table: 'sd_settings', selection: '*', order: 'section_key' },
  departments: { table: 'sd_departments', selection: '*', order: 'ordinal' },
  categoryOptions: { table: 'sd_category_options', selection: '*', order: 'ordinal' },
  priorityOptions: { table: 'sd_priority_options', selection: '*', order: 'ordinal' },
  equipmentOptions: { table: 'sd_equipment_options', selection: '*', order: 'ordinal' },
  rolePermissions: { table: 'sd_role_permissions', selection: '*', order: 'permission_key' },
} as const satisfies Record<string, TableDefinition & { table: string }>;

type TableName = keyof typeof TABLES;
type RowCache = Record<TableName, Row[]>;

export interface NormalizedVersionCatalog {
  get(entityKey: string): number;
  has(entityKey: string): boolean;
  entries(): IterableIterator<[string, number]>;
}

class VersionCatalog implements NormalizedVersionCatalog {
  #versions = new Map<string, number>();

  set(key: string, value: unknown) {
    const version = Number(value);
    if (Number.isSafeInteger(version) && version >= 0) this.#versions.set(key, version);
  }

  get(entityKey: string) {
    const version = this.#versions.get(entityKey);
    if (version === undefined) throw new Error(`Missing normalized base version for ${entityKey}.`);
    return version;
  }

  has(entityKey: string) {
    return this.#versions.has(entityKey);
  }

  entries() {
    return this.#versions.entries();
  }
}

export interface NormalizedApplicationProjection {
  data: AppData;
  versions: NormalizedVersionCatalog;
  actor: UserAccount;
  workspaceId: string;
  vesselAccount: boolean;
  allowedEntityKeys: ReadonlySet<string>;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function iso(value: unknown): string {
  return text(value) || new Date(0).toISOString();
}

function date(value: unknown): string {
  return text(value);
}

function priority(value: unknown): TaskPriority {
  return (['急', '高', '中', '低'].includes(text(value)) ? text(value) : '低') as TaskPriority;
}

function statusLog(
  row: Row,
  users: Map<string, UserAccount>,
  suffix = '',
): StatusLog {
  const actorId = text(row.actor_id);
  return {
    id: `${text(row.id)}${suffix}`,
    at: iso(row.created_at),
    by: users.get(actorId)?.name || '系統',
    byUserId: actorId || undefined,
    text: text(row.status),
  };
}

function rowsFor(rows: Row[], column: string, value: string) {
  return rows.filter(row => text(row[column]) === value);
}

function rolePermissions(rows: Row[]): RolePermissions {
  const next = structuredClone(DEFAULT_ROLE_PERMISSIONS);
  for (const row of rows) {
    const role = text(row.role) as UserRole;
    const key = text(row.permission_key) as keyof RolePermissions[UserRole];
    if (role !== 'owner' && next[role] && key in next[role]) {
      next[role][key] = row.enabled === true;
    }
  }
  return normalizeRolePermissions(next);
}

function maximumVersion(rows: Row[][]): number {
  return rows.reduce(
    (maximum, tableRows) => tableRows.reduce(
      (tableMaximum, row) => Math.max(tableMaximum, Number(row.version) || 0),
      maximum,
    ),
    0,
  );
}

function allowedKeys(data: AppData): ReadonlySet<string> {
  return new Set([
    ...data.users.map(user => `user:${user.id}`),
    ...data.vessels.map(vessel => `vessel:${vessel.id}`),
    ...data.tasks.flatMap(task => [
      `task:${task.id}`,
      ...(task.vesselProgress || []).map(progress => `task-progress:${task.id}:${progress.vesselId}`),
    ]),
    ...data.meetings.map(meeting => `meeting:${meeting.id}`),
    ...data.internalControlCases.map(item => `internal-case:${item.id}`),
    ...data.notifications.map(item => `notification:${item.id}`),
    ...data.agendaReports.map(item => `report:${item.id}`),
    'audit',
    'settings:departments',
    'settings:task-categories',
    'settings:meeting-task-categories',
    'settings:priorities',
    'settings:equipment-options',
    'settings:role-permissions',
    'settings:workspace',
    'settings:site-gate',
  ]);
}

export function projectNormalizedRows(
  rows: RowCache,
  workspaceId: string,
  actorId: string,
): NormalizedApplicationProjection {
  const versions = new VersionCatalog();
  const activeMemberships = rows.memberships.filter(row => row.is_active === true);
  let users = activeMemberships.map(row => {
    const profile = jsonObject(row.profile);
    const user: UserAccount = {
      id: text(row.user_id),
      department: text(row.department),
      name: text(profile.display_name),
      username: text(profile.username_label),
      role: text(row.role) as UserRole,
      passwordHash: '',
      isActive: true,
      managedVesselIds: [],
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
    versions.set(`user:${user.id}`, row.version);
    return user;
  });
  const userMap = new Map(users.map(user => [user.id, user]));
  const actor = userMap.get(actorId);
  if (!actor) throw new Error('The authenticated membership is unavailable.');

  const assignments = rows.vesselAssignments.filter(row => row.is_active === true);
  for (const user of users) {
    user.managedVesselIds = assignments
      .filter(row => text(row.user_id) === user.id && row.assignment_kind === 'manager')
      .map(row => text(row.vessel_id));
  }

  let vessels: Vessel[] = rows.vessels.filter(row => row.is_active === true).map(row => {
    const vesselId = text(row.id);
    versions.set(`vessel:${vesselId}`, row.version);
    return {
      id: vesselId,
      name: text(row.name),
      shortName: text(row.short_name),
      fullName: text(row.full_name),
      shipType: text(row.ship_type),
      fleetCategory: text(row.fleet_category),
      fleetTags: stringArray(row.fleet_tags),
      assignedUserIds: assignments
        .filter(item => text(item.vessel_id) === vesselId && item.assignment_kind === 'manager')
        .map(item => text(item.user_id)),
      delegateManagers: assignments
        .filter(item => text(item.vessel_id) === vesselId && item.assignment_kind === 'delegate')
        .map(item => ({ userId: text(item.user_id), isActive: true })),
      vesselAccountUserIds: assignments
        .filter(item => text(item.vessel_id) === vesselId && item.assignment_kind === 'vessel_account')
        .map(item => text(item.user_id)),
      isActive: true,
      position: jsonObject(row.position) as unknown as Vessel['position'],
      cargo: jsonObject(row.cargo) as unknown as Vessel['cargo'],
      note: jsonObject(row.note) as unknown as Vessel['note'],
      weeklyAttention: stringArray(row.weekly_attention) as Vessel['weeklyAttention'],
      manualAttentionLevel: text(row.manual_attention_level) as Vessel['manualAttentionLevel'],
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  });

  const activeTaskRows = rows.tasks.filter(row => row.is_deleted !== true);
  const meetingItemMap = new Map(rows.meetingItems.map(item => [text(item.id), item]));
  const internalLinkByTask = new Map(
    rows.internalCaseLinks.map(link => [text(link.task_id), text(link.case_id)]),
  );
  let tasks: TaskItem[] = activeTaskRows.map(row => {
    const taskId = text(row.id);
    const progressRows = rowsFor(rows.taskVessels, 'task_id', taskId)
      .filter(item => item.is_active_scope === true);
    const vesselIds = progressRows.map(item => text(item.vessel_id));
    const categories = rowsFor(rows.taskCategories, 'task_id', taskId)
      .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
      .map(item => text(item.category));
    const sourceItem = meetingItemMap.get(text(row.source_meeting_item_id));
    const taskStatusLogs = rowsFor(rows.taskStatusEvents, 'task_id', taskId)
      .map(item => statusLog(item, userMap));
    versions.set(`task:${taskId}`, row.version);
    for (const progress of progressRows) {
      versions.set(`task-progress:${taskId}:${text(progress.vessel_id)}`, progress.version);
    }
    return {
      id: taskId,
      vesselId: vesselIds[0] || '',
      vesselIds,
      vesselScopeMode: text(row.vessel_scope_mode, 'vessels') as TaskItem['vesselScopeMode'],
      vesselTypeScopes: rowsFor(rows.taskTypeScopes, 'task_id', taskId)
        .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
        .map(item => text(item.type_scope)),
      priority: priority(row.priority),
      attentionDimension: text(row.attention_dimension, 'task') as TaskItem['attentionDimension'],
      isAware: row.is_aware === true,
      isAbnormal: row.is_abnormal === true,
      isInternalControl: row.is_internal_control === true,
      internalControlCancelledAt: text(row.internal_control_cancelled_at) || undefined,
      internalControlCancelledBy: text(row.internal_control_cancelled_by) || undefined,
      internalControlCaseId: internalLinkByTask.get(taskId),
      category: text(row.category) || categories[0] || '',
      categories,
      equipmentSubcategory: text(row.equipment_subcategory) || undefined,
      description: text(row.description),
      status: text(row.status),
      expectedDate: date(row.expected_date),
      reportDate: date(row.report_date),
      departments: rowsFor(rows.taskDepartments, 'task_id', taskId)
        .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
        .map(item => text(item.department)),
      ownerUserIds: rowsFor(rows.taskOwners, 'task_id', taskId)
        .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
        .map(item => text(item.owner_id)),
      isClosed: row.is_closed === true,
      closedDate: date(row.closed_date) || undefined,
      closedBy: text(row.closed_by) || undefined,
      sourceMeetingId: text(row.source_meeting_id)
        || (sourceItem ? text(sourceItem.meeting_id) : undefined),
      sourceMeetingItemId: text(row.source_meeting_item_id) || undefined,
      distributeToVessels: row.distribute_to_vessels === true,
      sourceType: text(row.source_type, row.source_kind === 'meeting' ? 'temporary' : 'morning') as TaskItem['sourceType'],
      createdBy: text(row.created_by),
      updatedBy: text(row.updated_by),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      statusLogs: taskStatusLogs,
      vesselProgress: progressRows.map(progress => ({
        vesselId: text(progress.vessel_id),
        status: text(progress.status),
        isClosed: progress.is_closed === true,
        closedDate: date(progress.closed_date) || undefined,
        closedBy: text(progress.closed_by) || undefined,
        updatedAt: iso(progress.updated_at),
        updatedBy: text(progress.updated_by) || undefined,
        statusLogs: rows.taskVesselStatusEvents
          .filter(event => text(event.task_id) === taskId
            && text(event.vessel_id) === text(progress.vessel_id))
          .map(event => statusLog(event, userMap)),
      })),
    };
  });

  let meetings: TemporaryMeeting[] = rows.meetings
    .filter(row => !row.deleted_at)
    .map(row => {
      const meetingId = text(row.id);
      const items = rowsFor(rows.meetingItems, 'meeting_id', meetingId)
        .filter(item => item.is_active === true)
        .sort((left, right) => Number(left.ordinal) - Number(right.ordinal));
      const participants = rowsFor(rows.meetingParticipants, 'meeting_id', meetingId);
      const events = rowsFor(rows.meetingStatusEvents, 'meeting_id', meetingId);
      const corrections = rowsFor(rows.meetingStatusCorrections, 'meeting_id', meetingId);
      versions.set(`meeting:${meetingId}`, row.version);
      return {
        id: meetingId,
        subject: text(row.subject),
        status: text(row.status) as TemporaryMeeting['status'],
        meetingDate: date(row.meeting_date),
        vesselScopeMode: text(row.scope_mode) as TemporaryMeeting['vesselScopeMode'],
        vesselTypeScopes: rowsFor(rows.meetingTypeScopes, 'meeting_id', meetingId)
          .map(item => text(item.ship_type)),
        vessels: rowsFor(rows.meetingVessels, 'meeting_id', meetingId)
          .map(item => text(item.vessel_id)),
        reason: text(row.reason),
        departments: rowsFor(rows.meetingDepartments, 'meeting_id', meetingId)
          .map(item => text(item.department)),
        participantUserIds: participants
          .filter(item => item.participant_kind === 'participant')
          .map(item => text(item.user_id)),
        trackingUserIds: participants
          .filter(item => item.participant_kind === 'tracking')
          .map(item => text(item.user_id)),
        responsibleUserIds: participants
          .filter(item => item.participant_kind === 'responsible')
          .map(item => text(item.user_id)),
        resolution: text(row.resolution),
        taskDescription: text(items[0]?.description),
        taskItems: items.map(item => ({
          id: text(item.id),
          description: text(item.description),
          categories: rows.meetingItemCategories
            .filter(category => text(category.meeting_item_id) === text(item.id))
            .map(category => text(category.category)),
          distributeToVessels: item.distribute_to_vessels === true,
        })),
        expectedDate: date(row.expected_date),
        completedDate: date(row.completed_date) || undefined,
        completedBy: text(row.completed_by) || undefined,
        priority: priority(row.priority),
        isAbnormal: row.is_abnormal === true,
        isInternalControl: row.is_internal_control === true,
        includeInMorning: row.include_in_morning === true,
        latestStatus: text(row.latest_status),
        statusLogs: [
          ...events.map(event => statusLog(event, userMap)),
          ...corrections.map(correction => ({
            id: text(correction.id),
            at: iso(correction.created_at),
            by: userMap.get(text(correction.actor_id))?.name || '系統',
            byUserId: text(correction.actor_id) || undefined,
            text: correction.correction_kind === 'void'
              ? `狀態紀錄作廢：${text(correction.reason)}`
              : `狀態更正為 ${text(correction.corrected_status)}：${text(correction.reason)}`,
          })),
        ],
        createdBy: text(row.created_by),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
    });

  let internalControlCases: InternalControlCase[] = rows.internalCases
    .filter(row => row.is_deleted !== true)
    .map(row => {
      const caseId = text(row.id);
      const linkedTask = rows.internalCaseLinks.find(link => text(link.case_id) === caseId);
      versions.set(`internal-case:${caseId}`, row.version);
      if (linkedTask) versions.set(`internal-link:${caseId}`, linkedTask.version);
      return {
        id: caseId,
        vesselId: text(row.vessel_id),
        reportDate: date(row.report_date),
        reportSource: text(row.report_source) as InternalControlCase['reportSource'],
        description: text(row.description),
        priority: priority(row.priority),
        category: text(row.category),
        equipmentSubcategory: text(row.equipment_subcategory) || undefined,
        isAware: row.is_aware === true,
        status: text(row.status),
        departments: rowsFor(rows.internalCaseDepartments, 'case_id', caseId)
          .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
          .map(item => text(item.department)),
        syncToTask: Boolean(linkedTask),
        linkedTaskId: linkedTask ? text(linkedTask.task_id) : undefined,
        origin: text(row.origin) as InternalControlCase['origin'],
        isClosed: row.is_closed === true,
        closedDate: date(row.closed_date) || undefined,
        closedBy: text(row.closed_by) || undefined,
        createdBy: text(row.created_by),
        updatedBy: text(row.updated_by),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        statusLogs: rowsFor(rows.internalCaseStatusEvents, 'case_id', caseId)
          .map(item => statusLog(item, userMap)),
      };
    });

  let agendaReports: AgendaReport[] = rows.savedReports.map(row => {
    const reportId = text(row.id);
    versions.set(`report:${reportId}`, row.version);
    return {
      id: reportId,
      title: text(row.title),
      vesselIds: rowsFor(rows.savedReportVessels, 'report_id', reportId)
        .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
        .map(item => text(item.vessel_id)),
      createdBy: text(row.created_by),
      createdAt: iso(row.created_at),
      taskCount: Number(row.task_count) || 0,
    };
  });

  let notifications: UserNotification[] = rows.notifications.map(row => {
    versions.set(`notification:${text(row.id)}`, row.version);
    return {
      id: text(row.id),
      userId: text(row.recipient_id),
      vesselId: text(row.vessel_id),
      taskId: text(row.task_id),
      kind: text(row.kind) as UserNotification['kind'],
      title: text(row.title),
      message: text(row.message),
      actorId: text(row.actor_id),
      createdAt: iso(row.created_at),
      readAt: text(row.read_at) || undefined,
    };
  });

  let auditLogs: AuditLog[] = rows.auditEvents.map(row => {
    const detail = jsonObject(row.detail);
    return {
      id: text(row.id),
      at: iso(row.created_at),
      actorId: text(row.actor_id),
      actorName: userMap.get(text(row.actor_id))?.name || '系統',
      actorRole: userMap.get(text(row.actor_id))?.role || 'system',
      action: text(row.command),
      entityType: text(row.entity_type),
      entityId: text(row.entity_id),
      detail: JSON.stringify(detail),
    };
  });

  const vesselAccount = actor.role === 'vessel';
  if (vesselAccount) {
    const accountAssignments = assignments.filter(
      row => row.assignment_kind === 'vessel_account' && text(row.user_id) === actorId,
    );
    const allowedVesselId = accountAssignments.length === 1
      ? text(accountAssignments[0].vessel_id)
      : '';
    vessels = allowedVesselId ? vessels.filter(vessel => vessel.id === allowedVesselId) : [];
    const allowedVesselIds = new Set(vessels.map(vessel => vessel.id));
    tasks = tasks
      .filter(task => {
        const scope = task.vesselIds || [task.vesselId];
        return !task.isInternalControl
          && scope.length === 1
          && scope[0] === allowedVesselId
          && allowedVesselIds.has(scope[0]);
      })
      .map(task => ({
        ...task,
        sourceMeetingId: undefined,
        sourceMeetingItemId: undefined,
        sourceType: 'morning',
        attentionDimension: 'task',
        distributeToVessels: undefined,
        vesselScopeMode: 'vessels',
        vesselTypeScopes: [],
      }));
    const allowedTaskIds = new Set(tasks.map(task => task.id));
    users = [actor];
    meetings = [];
    internalControlCases = [];
    agendaReports = [];
    auditLogs = [];
    notifications = notifications.filter(item => item.userId === actorId
      && item.vesselId === allowedVesselId
      && (!item.taskId || allowedTaskIds.has(item.taskId)));
  }

  for (const row of rows.settings) versions.set(`settings:${text(row.section_key)}`, row.version);
  const setting = (key: string) => jsonObject(
    rows.settings.find(row => text(row.section_key) === key)?.value,
  );
  const workspaceSettings = setting('workspace');
  const departments = rows.departments
    .filter(row => row.is_active === true)
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .map(row => text(row.department));
  const categoryOptions = rows.categoryOptions.filter(row => row.is_active === true);
  const taskCategories = categoryOptions
    .filter(row => row.category_scope === 'ordinary')
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .map(row => text(row.category));
  const meetingTaskCategories = categoryOptions
    .filter(row => row.category_scope === 'meeting')
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .map(row => text(row.category));
  const priorities = rows.priorityOptions
    .filter(row => row.is_active === true)
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .map(row => priority(row.priority));
  const equipmentOptions = rows.equipmentOptions
    .filter(row => row.is_active === true)
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    .map(row => text(row.equipment_option));

  const data: AppData = {
    revision: maximumVersion(Object.values(rows)),
    settings: {
      sitePasswordHash: '',
      systemTitle: text(workspaceSettings.systemTitle, '船舶動態與會議管理系統'),
      departments,
      taskCategories,
      taskCategorySchemaVersion: 2,
      meetingTaskCategories,
      meetingTaskCategorySchemaVersion: 2,
      equipmentFailureSubcategories: equipmentOptions,
      equipmentFailureSubcategorySchemaVersion: 1,
      vesselStatuses: stringArray(workspaceSettings.vesselStatuses) as AppData['settings']['vesselStatuses'],
      priorities,
      rolePermissions: rolePermissions(rows.rolePermissions),
      nonOwnerPasswordResetVersion: 2,
      meetingTaskAggregationVersion: 1,
      lastCloudSyncAt: new Date().toISOString(),
    },
    users,
    vessels,
    tasks,
    internalControlCases,
    meetings,
    agendaReports,
    auditLogs,
    notifications,
    updatedAt: new Date().toISOString(),
  };

  return {
    data,
    versions,
    actor,
    workspaceId,
    vesselAccount,
    allowedEntityKeys: allowedKeys(data),
  };
}

function emptyRows(): RowCache {
  return Object.fromEntries(
    Object.keys(TABLES).map(name => [name, []]),
  ) as RowCache;
}

export class NormalizedProjectionReader {
  #client: NormalizedProjectionClient;
  #scope: NormalizedRequestScope;
  #rows: RowCache = emptyRows();

  constructor(client: NormalizedProjectionClient, scope: NormalizedRequestScope) {
    this.#client = client;
    this.#scope = scope;
  }

  async fetchApplicationProjection(): Promise<NormalizedApplicationProjection> {
    const token = this.#scope.capture();
    const entries = await Promise.all(
      (Object.keys(TABLES) as TableName[]).map(async name => {
        const definition = TABLES[name] as TableDefinition & { table: string };
        const rows = await this.#query(
          definition.table,
          definition.selection,
          [['workspace_id', token.workspaceId]],
          definition.order,
          definition.limit,
        );
        return [name, rows] as const;
      }),
    );
    this.#scope.assertCurrent(token);
    this.#rows = Object.fromEntries(entries) as RowCache;
    return projectNormalizedRows(this.#rows, token.workspaceId, token.actorId);
  }

  async refetchInvalidatedProjection(
    entityKeys: string[],
  ): Promise<NormalizedApplicationProjection> {
    const token = this.#scope.capture();
    const keys = [...new Set(entityKeys)];
    for (const key of keys) {
      await this.#refreshKey(key, token.workspaceId);
      this.#scope.assertCurrent(token);
    }
    return projectNormalizedRows(this.#rows, token.workspaceId, token.actorId);
  }

  async #query(
    table: string,
    selection: string,
    filters: Array<[string, string]>,
    order?: string,
    limit?: number,
  ): Promise<Row[]> {
    let query = this.#client.from<Row>(table).select(selection);
    for (const [column, value] of filters) query = query.eq(column, value);
    if (order) query = query.order(order, { ascending: true });
    if (limit) query = query.limit(limit);
    const response = await query;
    if (response.error) {
      const message = response.error instanceof Error
        ? response.error.message
        : String((response.error as { message?: unknown })?.message || response.error);
      throw new Error(message);
    }
    return response.data || [];
  }

  async #replace(
    name: TableName,
    filters: Array<[string, string]>,
    predicate: (row: Row) => boolean,
  ) {
    const definition = TABLES[name] as TableDefinition & { table: string };
    const next = await this.#query(
      definition.table,
      definition.selection,
      filters,
      definition.order,
      definition.limit,
    );
    this.#rows[name] = [...this.#rows[name].filter(row => !predicate(row)), ...next];
  }

  async #refreshKey(entityKey: string, workspaceId: string) {
    const workspaceFilter: [string, string] = ['workspace_id', workspaceId];
    if (entityKey.startsWith('task-progress:')) {
      const [taskId, vesselId] = entityKey.slice('task-progress:'.length).split(':');
      await Promise.all([
        this.#replace(
          'taskVessels',
          [workspaceFilter, ['task_id', taskId], ['vessel_id', vesselId]],
          row => text(row.task_id) === taskId && text(row.vessel_id) === vesselId,
        ),
        this.#replace(
          'taskVesselStatusEvents',
          [workspaceFilter, ['task_id', taskId], ['vessel_id', vesselId]],
          row => text(row.task_id) === taskId && text(row.vessel_id) === vesselId,
        ),
      ]);
      return;
    }
    if (entityKey.startsWith('task:')) {
      const taskId = entityKey.slice('task:'.length);
      const taskTables: Array<[TableName, string]> = [
        ['tasks', 'id'],
        ['taskVessels', 'task_id'],
        ['taskCategories', 'task_id'],
        ['taskDepartments', 'task_id'],
        ['taskOwners', 'task_id'],
        ['taskTypeScopes', 'task_id'],
        ['taskStatusEvents', 'task_id'],
        ['taskVesselStatusEvents', 'task_id'],
      ];
      await Promise.all(taskTables.map(([name, column]) => this.#replace(
        name,
        [workspaceFilter, [column, taskId]],
        row => text(row[column]) === taskId,
      )));
      return;
    }
    if (entityKey.startsWith('vessel:')) {
      const vesselId = entityKey.slice('vessel:'.length);
      await Promise.all([
        this.#replace(
          'vessels',
          [workspaceFilter, ['id', vesselId]],
          row => text(row.id) === vesselId,
        ),
        this.#replace(
          'vesselAssignments',
          [workspaceFilter, ['vessel_id', vesselId]],
          row => text(row.vessel_id) === vesselId,
        ),
      ]);
      return;
    }
    if (entityKey.startsWith('user:')) {
      const userId = entityKey.slice('user:'.length);
      await Promise.all([
        this.#replace(
          'memberships',
          [workspaceFilter, ['user_id', userId]],
          row => text(row.user_id) === userId,
        ),
        this.#replace(
          'vesselAssignments',
          [workspaceFilter, ['user_id', userId]],
          row => text(row.user_id) === userId,
        ),
      ]);
      return;
    }
    if (entityKey.startsWith('meeting:')) {
      const meetingId = entityKey.slice('meeting:'.length);
      const tables: Array<[TableName, string]> = [
        ['meetings', 'id'],
        ['meetingVessels', 'meeting_id'],
        ['meetingTypeScopes', 'meeting_id'],
        ['meetingDepartments', 'meeting_id'],
        ['meetingParticipants', 'meeting_id'],
        ['meetingItems', 'meeting_id'],
        ['meetingStatusEvents', 'meeting_id'],
        ['meetingStatusCorrections', 'meeting_id'],
      ];
      await Promise.all(tables.map(([name, column]) => this.#replace(
        name,
        [workspaceFilter, [column, meetingId]],
        row => text(row[column]) === meetingId,
      )));
      const itemIds = new Set(
        this.#rows.meetingItems
          .filter(item => text(item.meeting_id) === meetingId)
          .map(item => text(item.id)),
      );
      const categories = await this.#query(
        TABLES.meetingItemCategories.table,
        TABLES.meetingItemCategories.selection,
        [workspaceFilter],
        TABLES.meetingItemCategories.order,
      );
      this.#rows.meetingItemCategories = [
        ...this.#rows.meetingItemCategories.filter(
          category => !itemIds.has(text(category.meeting_item_id)),
        ),
        ...categories.filter(category => itemIds.has(text(category.meeting_item_id))),
      ];
      return;
    }
    if (entityKey.startsWith('internal-case:')) {
      const caseId = entityKey.slice('internal-case:'.length);
      const tables: Array<[TableName, string]> = [
        ['internalCases', 'id'],
        ['internalCaseDepartments', 'case_id'],
        ['internalCaseLinks', 'case_id'],
        ['internalCaseStatusEvents', 'case_id'],
      ];
      await Promise.all(tables.map(([name, column]) => this.#replace(
        name,
        [workspaceFilter, [column, caseId]],
        row => text(row[column]) === caseId,
      )));
      return;
    }
    if (entityKey.startsWith('notification:')) {
      const id = entityKey.slice('notification:'.length);
      await this.#replace(
        'notifications',
        [workspaceFilter, ['id', id]],
        row => text(row.id) === id,
      );
      return;
    }
    if (entityKey.startsWith('report:')) {
      const id = entityKey.slice('report:'.length);
      await Promise.all([
        this.#replace(
          'savedReports',
          [workspaceFilter, ['id', id]],
          row => text(row.id) === id,
        ),
        this.#replace(
          'savedReportVessels',
          [workspaceFilter, ['report_id', id]],
          row => text(row.report_id) === id,
        ),
      ]);
      return;
    }
    if (entityKey === 'audit') {
      this.#rows.auditEvents = await this.#query(
        TABLES.auditEvents.table,
        TABLES.auditEvents.selection,
        [workspaceFilter],
        TABLES.auditEvents.order,
        TABLES.auditEvents.limit,
      );
      return;
    }
    if (entityKey.startsWith('settings:')) {
      const section = entityKey.slice('settings:'.length);
      await this.#replace(
        'settings',
        [workspaceFilter, ['section_key', section]],
        row => text(row.section_key) === section,
      );
      const names: TableName[] = section === 'departments'
        ? ['departments']
        : section === 'task-categories' || section === 'meeting-task-categories'
          ? ['categoryOptions']
          : section === 'priorities'
            ? ['priorityOptions']
            : section === 'equipment-options'
              ? ['equipmentOptions']
              : section === 'role-permissions' ? ['rolePermissions'] : [];
      await Promise.all(names.map(async name => {
        const definition = TABLES[name] as TableDefinition & { table: string };
        this.#rows[name] = await this.#query(
          definition.table,
          definition.selection,
          [workspaceFilter],
          definition.order,
          definition.limit,
        );
      }));
    }
  }
}

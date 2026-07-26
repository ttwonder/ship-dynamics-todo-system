import { createHash } from 'node:crypto';

export const LEGACY_IMPORT_COUNT_KEYS = Object.freeze([
  'users',
  'activeUsers',
  'loginOptions',
  'vessels',
  'managerAssignments',
  'delegateAssignments',
  'vesselAccountAssignments',
  'sourceTasks',
  'importedTasks',
  'quarantine',
  'taskVessels',
  'taskCategories',
  'taskDepartments',
  'taskOwners',
  'taskTypeScopes',
  'taskStatusEvents',
  'taskVesselStatusEvents',
  'meetings',
  'meetingVessels',
  'meetingTypeScopes',
  'meetingDepartments',
  'meetingParticipants',
  'meetingTracking',
  'meetingResponsible',
  'meetingItems',
  'meetingItemCategories',
  'internalCases',
  'internalCaseDepartments',
  'internalCaseStatusEvents',
  'internalLinks',
  'notifications',
  'legacyAuditEvents',
  'migrationAuditEvents',
  'savedReports',
  'savedReportVessels',
  'departments',
  'ordinaryCategories',
  'meetingCategories',
  'priorities',
  'equipmentOptions',
  'rolePermissions',
  'settings',
]);

const PERMISSION_KEYS = Object.freeze([
  'viewAllVessels',
  'editBusinessContent',
  'createTasks',
  'closeTasks',
  'deleteTasks',
  'manageMeetings',
  'exportReports',
  'enterManagement',
  'manageUsers',
  'manageVessels',
  'viewAuditLogs',
  'manageRolePermissions',
  'manageSystemSettings',
]);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
const objectArray = value => Array.isArray(value) ? value.filter(item => object(item)) : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const textArray = value => Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean) : [];
const unique = values => [...new Set(values)];
const pair = (left, right) => `${left}\u0000${right}`;

export function isMeetingSemanticTask(task) {
  return Boolean(
    text(task?.sourceMeetingId)
    || text(task?.sourceMeetingItemId)
    || task?.sourceType === 'temporary'
    || task?.attentionDimension === 'meeting'
  );
}

export function isMeetingParentlessQuarantineTask(task) {
  return isMeetingSemanticTask(task)
    && !text(task?.sourceMeetingId)
    && !text(task?.sourceMeetingItemId);
}

export function legacyTaskVesselIds(task) {
  return unique([
    text(task?.vesselId),
    ...textArray(task?.vesselIds),
  ].filter(Boolean));
}

export function legacySavedReports(payload) {
  if (Array.isArray(payload?.agendaReports) && Array.isArray(payload?.savedReports)) return null;
  if (Array.isArray(payload?.agendaReports)) return objectArray(payload.agendaReports);
  return objectArray(payload?.savedReports);
}

export function computeLegacyImportCounts(payload) {
  const users = objectArray(payload?.users);
  const vessels = objectArray(payload?.vessels);
  const sourceTasks = objectArray(payload?.tasks);
  const tasks = sourceTasks.filter(task => !isMeetingParentlessQuarantineTask(task));
  const meetings = objectArray(payload?.meetings);
  const internalCases = objectArray(payload?.internalControlCases);
  const notifications = objectArray(payload?.notifications);
  const auditLogs = objectArray(payload?.auditLogs);
  const reports = legacySavedReports(payload) || [];
  const settings = object(payload?.settings) || {};

  const managers = new Set();
  for (const user of users.filter(item => ['admin', 'operator'].includes(item.role))) {
    for (const vesselId of unique(textArray(user.managedVesselIds))) managers.add(pair(vesselId, text(user.id)));
  }
  for (const vessel of vessels) {
    for (const userId of unique(textArray(vessel.assignedUserIds))) managers.add(pair(text(vessel.id), userId));
  }

  return {
    users: users.length,
    activeUsers: users.filter(user => user.isActive !== false).length,
    loginOptions: users.length,
    vessels: vessels.length,
    managerAssignments: managers.size,
    delegateAssignments: vessels.reduce((sum, vessel) => sum + objectArray(vessel.delegateManagers).length, 0),
    vesselAccountAssignments: users.filter(user => user.role === 'vessel').length,
    sourceTasks: sourceTasks.length,
    importedTasks: tasks.length,
    quarantine: sourceTasks.length - tasks.length,
    taskVessels: tasks.reduce((sum, task) => sum + legacyTaskVesselIds(task).length, 0),
    taskCategories: tasks.reduce((sum, task) => sum + unique(textArray(task.categories).length ? textArray(task.categories) : [text(task.category)].filter(Boolean)).length, 0),
    taskDepartments: tasks.reduce((sum, task) => sum + unique(textArray(task.departments)).length, 0),
    taskOwners: tasks.reduce((sum, task) => sum + unique(textArray(task.ownerUserIds)).length, 0),
    taskTypeScopes: tasks.reduce((sum, task) => sum + unique(textArray(task.vesselTypeScopes)).length, 0),
    taskStatusEvents: tasks.reduce((sum, task) => sum + objectArray(task.statusLogs).length, 0),
    taskVesselStatusEvents: tasks.reduce((sum, task) => sum + objectArray(task.vesselProgress).reduce((progressSum, progress) => progressSum + objectArray(progress.statusLogs).length, 0), 0),
    meetings: meetings.length,
    meetingVessels: meetings.reduce((sum, meeting) => sum + unique(textArray(meeting.vessels)).length, 0),
    meetingTypeScopes: meetings.reduce((sum, meeting) => sum + unique(textArray(meeting.vesselTypeScopes)).length, 0),
    meetingDepartments: meetings.reduce((sum, meeting) => sum + unique(textArray(meeting.departments)).length, 0),
    meetingParticipants: meetings.reduce((sum, meeting) => sum + unique(textArray(meeting.participantUserIds)).length, 0),
    meetingTracking: meetings.reduce((sum, meeting) => sum + unique(textArray(meeting.trackingUserIds)).length, 0),
    meetingResponsible: meetings.reduce((sum, meeting) => sum + unique(textArray(meeting.responsibleUserIds)).length, 0),
    meetingItems: meetings.reduce((sum, meeting) => sum + objectArray(meeting.taskItems).length, 0),
    meetingItemCategories: meetings.reduce((sum, meeting) => sum + objectArray(meeting.taskItems).reduce((itemSum, item) => itemSum + unique(textArray(item.categories)).length, 0), 0),
    internalCases: internalCases.length,
    internalCaseDepartments: internalCases.reduce((sum, item) => sum + unique(textArray(item.departments)).length, 0),
    internalCaseStatusEvents: internalCases.reduce((sum, item) => sum + objectArray(item.statusLogs).length, 0),
    internalLinks: internalCases.filter(item => text(item.linkedTaskId)).length,
    notifications: notifications.length,
    legacyAuditEvents: auditLogs.length,
    migrationAuditEvents: 1,
    savedReports: reports.length,
    savedReportVessels: reports.reduce((sum, report) => sum + unique(textArray(report.vesselIds)).length, 0),
    departments: unique(textArray(settings.departments)).length,
    ordinaryCategories: unique(textArray(settings.taskCategories)).length,
    meetingCategories: unique(textArray(settings.meetingTaskCategories)).length,
    priorities: unique(textArray(settings.priorities)).length,
    equipmentOptions: unique(textArray(settings.equipmentFailureSubcategories)).length,
    rolePermissions: 3 * PERMISSION_KEYS.length,
    settings: 8,
  };
}

export function analyzeLegacyImportPackage(payload, revision, mappings) {
  const issueCounts = new Map();
  const add = (code, count = 1) => issueCounts.set(code, (issueCounts.get(code) || 0) + count);
  const users = objectArray(payload?.users);
  const vessels = objectArray(payload?.vessels);
  const tasks = objectArray(payload?.tasks);
  const meetings = objectArray(payload?.meetings);
  const cases = objectArray(payload?.internalControlCases);
  const duplicateIds = (items, code) => {
    const ids = items.map(item => text(item.id));
    const invalid = ids.filter(id => !id).length;
    const duplicate = ids.filter(Boolean).length - new Set(ids.filter(Boolean)).size;
    if (invalid) add(`blank_${code}_id`, invalid);
    if (duplicate) add(`duplicate_${code}_id`, duplicate);
  };

  if (!object(payload)) add('invalid_payload');
  for (const [key, value] of [
    ['users', payload?.users],
    ['vessels', payload?.vessels],
    ['tasks', payload?.tasks],
    ['meetings', payload?.meetings],
    ['internal_cases', payload?.internalControlCases],
    ['notifications', payload?.notifications],
    ['audit_logs', payload?.auditLogs],
  ]) {
    if (!Array.isArray(value)) add(`invalid_${key}_collection`);
  }
  if (!object(payload?.settings)) add('invalid_settings');
  if (legacySavedReports(payload) === null) add('ambiguous_saved_report_collection');

  duplicateIds(users, 'user');
  duplicateIds(vessels, 'vessel');
  duplicateIds(tasks, 'task');
  duplicateIds(meetings, 'meeting');
  duplicateIds(cases, 'internal_case');
  duplicateIds(objectArray(payload?.notifications), 'notification');
  duplicateIds(objectArray(payload?.auditLogs), 'audit');
  duplicateIds(legacySavedReports(payload) || [], 'saved_report');

  if (users.filter(user => user.isActive !== false && user.role === 'owner').length !== 1) {
    add('invalid_owner_cardinality');
  }

  const mappingRows = objectArray(mappings);
  if (mappingRows.length !== users.length) add('mapping_count_mismatch');
  for (const key of ['legacyUserId', 'authUserId', 'authAlias']) {
    const values = mappingRows.map(row => text(row[key]));
    if (values.some(value => !value)) add(`blank_mapping_${key}`);
    if (new Set(values).size !== values.length) add(`duplicate_mapping_${key}`);
  }
  const mappedLegacy = new Set(mappingRows.map(row => text(row.legacyUserId)));
  for (const user of users) if (!mappedLegacy.has(text(user.id))) add('missing_user_mapping');
  if (mappingRows.some(row => row.activationState !== 'precreated')) add('activation_not_precreated');

  const counts = computeLegacyImportCounts(payload);
  const issues = Object.fromEntries([...issueCounts.entries()].sort(([left], [right]) => left.localeCompare(right)));
  return {
    revision: Number.isSafeInteger(Number(revision)) ? Number(revision) : null,
    counts,
    quarantineCount: counts.quarantine,
    issueCounts: issues,
    ready: Object.keys(issues).length === 0,
  };
}

export function sha256Hex(value) {
  const bytes = typeof value === 'string' || Buffer.isBuffer(value)
    ? value
    : JSON.stringify(value);
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

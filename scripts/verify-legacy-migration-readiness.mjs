import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const asArray = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const uniqueTexts = values => [...new Set(values.map(text).filter(Boolean))];

export function analyzeLegacyMigrationReadiness(payload, revision = 0) {
  const users = asArray(payload?.users);
  const vessels = asArray(payload?.vessels);
  const tasks = asArray(payload?.tasks);
  const meetings = asArray(payload?.meetings);
  const internalCases = asArray(payload?.internalControlCases);
  const issues = new Map();
  const add = (code, count = 1) => issues.set(code, (issues.get(code) || 0) + count);
  const duplicateCheck = (items, kind) => {
    const ids = items.map(item => text(item.id));
    const blank = ids.filter(id => !id).length;
    const duplicate = ids.filter(Boolean).length - new Set(ids.filter(Boolean)).size;
    if (blank) add(`blank_${kind}_id`, blank);
    if (duplicate) add(`duplicate_${kind}_id`, duplicate);
  };

  duplicateCheck(users, 'user');
  duplicateCheck(vessels, 'vessel');
  duplicateCheck(tasks, 'task');
  duplicateCheck(meetings, 'meeting');
  duplicateCheck(internalCases, 'internal_case');

  const activeOwners = users.filter(user => user.isActive !== false && user.role === 'owner');
  if (activeOwners.length !== 1) add('invalid_owner_cardinality', Math.abs(activeOwners.length - 1) || 1);

  const vesselIds = new Set(vessels.map(item => text(item.id)).filter(Boolean));
  const taskById = new Map(tasks.map(item => [text(item.id), item]));
  const caseById = new Map(internalCases.map(item => [text(item.id), item]));
  const meetingById = new Map(meetings.map(item => [text(item.id), item]));

  for (const user of users.filter(item => item.isActive !== false && item.role === 'vessel')) {
    const managed = uniqueTexts(Array.isArray(user.managedVesselIds) ? user.managedVesselIds : []);
    if (managed.length !== 1 || !vesselIds.has(managed[0])) add('invalid_vessel_account_scope');
  }

  for (const vessel of vessels) {
    for (const userId of uniqueTexts(Array.isArray(vessel.assignedUserIds) ? vessel.assignedUserIds : [])) {
      if (!users.some(user => text(user.id) === userId)) add('orphan_vessel_assignment');
    }
    for (const delegate of asArray(vessel.delegateManagers)) {
      if (!users.some(user => text(user.id) === text(delegate.userId))) add('orphan_vessel_delegation');
    }
  }

  const meetingTaskClaims = new Map();
  for (const task of tasks) {
    const scope = uniqueTexts(Array.isArray(task.vesselIds) && task.vesselIds.length ? task.vesselIds : [task.vesselId]);
    if (!scope.length) add('missing_task_scope');
    for (const vesselId of scope) if (!vesselIds.has(vesselId)) add('orphan_task_vessel');

    const meetingSemantics = Boolean(text(task.sourceMeetingId) || text(task.sourceMeetingItemId) || task.sourceType === 'temporary' || task.attentionDimension === 'meeting');
    if (meetingSemantics) {
      const meetingId = text(task.sourceMeetingId);
      const itemId = text(task.sourceMeetingItemId);
      const meeting = meetingById.get(meetingId);
      const itemMatches = meeting ? asArray(meeting.taskItems).filter(item => text(item.id) === itemId).length : 0;
      if (!meetingId || !itemId || !meeting || itemMatches !== 1) {
        add('invalid_meeting_task_link');
        if (!meetingId) add('meeting_task_missing_parent_id');
        else if (!meeting) add('meeting_task_parent_not_found');
        if (!itemId) add('meeting_task_missing_item_id');
        else if (meeting && itemMatches !== 1) add('meeting_task_item_not_unique');
      } else {
        const key = `${meetingId}\u0000${itemId}`;
        meetingTaskClaims.set(key, (meetingTaskClaims.get(key) || 0) + 1);
      }
    }

    const caseId = text(task.internalControlCaseId);
    if (caseId) {
      const item = caseById.get(caseId);
      const scope = uniqueTexts(Array.isArray(task.vesselIds) && task.vesselIds.length ? task.vesselIds : [task.vesselId]);
      if (!item || text(item.linkedTaskId) !== text(task.id) || item.syncToTask !== true || scope.length !== 1 || scope[0] !== text(item.vesselId)) {
        add('invalid_internal_case_task_link');
      }
    }
  }
  for (const count of meetingTaskClaims.values()) if (count !== 1) add('ambiguous_meeting_item_task_link', count);

  for (const item of internalCases) {
    const taskId = text(item.linkedTaskId);
    if (!taskId && item.syncToTask === true) add('invalid_internal_case_task_link');
    if (!taskId) continue;
    const task = taskById.get(taskId);
    const scope = task ? uniqueTexts(Array.isArray(task.vesselIds) && task.vesselIds.length ? task.vesselIds : [task.vesselId]) : [];
    if (!task || text(task.internalControlCaseId) !== text(item.id) || task.isInternalControl !== true || item.syncToTask !== true || scope.length !== 1 || scope[0] !== text(item.vesselId)) {
      add('invalid_internal_case_task_link');
    }
  }

  for (const meeting of meetings) {
    const itemIds = asArray(meeting.taskItems).map(item => text(item.id));
    const blank = itemIds.filter(id => !id).length;
    const duplicate = itemIds.filter(Boolean).length - new Set(itemIds.filter(Boolean)).size;
    if (blank) add('blank_meeting_item_id', blank);
    if (duplicate) add('duplicate_meeting_item_id', duplicate);
    for (const vesselId of uniqueTexts(Array.isArray(meeting.vessels) ? meeting.vessels : [])) {
      if (!vesselIds.has(vesselId)) add('orphan_meeting_vessel');
    }
  }

  const pendingActivationCount = users.filter(user => user.isActive !== false && !text(user.passwordHash)).length;
  const issueCounts = Object.fromEntries([...issues.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const readyForDataImport = Object.keys(issueCounts).length === 0;
  return {
    revision: Number.isFinite(Number(revision)) ? Number(revision) : 0,
    counts: {
      users: users.length,
      vessels: vessels.length,
      tasks: tasks.length,
      meetings: meetings.length,
      internalControlCases: internalCases.length,
      notifications: asArray(payload?.notifications).length,
      auditLogs: asArray(payload?.auditLogs).length,
      savedReports: asArray(payload?.savedReports).length,
    },
    pendingActivationCount,
    issueCounts,
    readyForDataImport,
    readyForAuthCutover: readyForDataImport && pendingActivationCount === 0,
  };
}

async function loadLive(configPath) {
  const source = await readFile(configPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: 'supabase-config.js' });
  const config = sandbox.window.SHIP_DYNAMICS_SUPABASE_CONFIG;
  if (!config?.supabaseUrl || !config?.supabaseAnonKey || !config?.workspaceKey || !config?.tableName) throw new Error('cloud-config-incomplete');
  const endpoint = `${String(config.supabaseUrl).replace(/\/$/, '')}/rest/v1/${encodeURIComponent(config.tableName)}?select=workspace_key,revision,payload&workspace_key=eq.${encodeURIComponent(config.workspaceKey)}&limit=2`;
  const response = await fetch(endpoint, { headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` } });
  if (!response.ok) throw new Error(`cloud-read-failed-${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`cloud-row-count-${Array.isArray(rows) ? rows.length : 'invalid'}`);
  return { payload: rows[0].payload, revision: rows[0].revision };
}

async function runCli() {
  const args = new Set(process.argv.slice(2));
  const inputIndex = process.argv.indexOf('--input');
  let source;
  if (args.has('--live-read')) {
    const configIndex = process.argv.indexOf('--config');
    const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : new URL('../public/supabase-config.js', import.meta.url);
    source = await loadLive(configPath);
  } else if (inputIndex >= 0 && process.argv[inputIndex + 1]) {
    const parsed = JSON.parse(await readFile(process.argv[inputIndex + 1], 'utf8'));
    source = parsed?.payload ? { payload: parsed.payload, revision: parsed.revision } : { payload: parsed, revision: 0 };
  } else {
    throw new Error('use --input <legacy.json> or --live-read');
  }
  const report = analyzeLegacyMigrationReadiness(source.payload, source.revision);
  console.log(JSON.stringify(report));
  if (!report.readyForDataImport) process.exitCode = 1;
  else if (!report.readyForAuthCutover && !args.has('--allow-pending-auth')) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    console.error(error instanceof Error ? error.message : 'migration-readiness-failed');
    process.exitCode = 1;
  });
}

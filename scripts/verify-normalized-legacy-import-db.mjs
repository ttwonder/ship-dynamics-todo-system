import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { computeLegacyImportCounts } from './legacy-migration-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = [
  'supabase/normalized-schema.sql',
  'supabase/normalized-core-domain.sql',
  'supabase/normalized-meeting.sql',
  'supabase/normalized-internal-control.sql',
  'supabase/normalized-security-dispatch.sql',
  'supabase/normalized-auth-orchestration.sql',
  'supabase/normalized-legacy-import.sql',
];

const db = new PGlite();
await db.exec(`
  create schema auth;
  create schema extensions;
  create role anon noinherit;
  create role authenticated noinherit;
  create role service_role noinherit bypassrls;
  create table auth.users(id uuid primary key, email text unique);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function extensions.gen_salt(text,integer) returns text
    language sql immutable as $$ select '$2b$12$00000000000000000000000000000000000000000000000000000' $$;
  create function extensions.crypt(value text, salt text) returns text
    language sql immutable as $$
      select '$2b$12$' || substring(encode(sha256(convert_to(value,'UTF8')),'hex') from 1 for 53)
    $$;
`);

for (const relative of manifest) {
  await db.exec(await readFile(resolve(root, relative), 'utf8'));
}

const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  operator: '33333333-3333-4333-8333-333333333333',
  vessel: '44444444-4444-4444-8444-444444444444',
};

await db.exec(`
  insert into auth.users(id,email) values
    ('${ids.owner}','owner@migration.invalid'),
    ('${ids.admin}','admin@migration.invalid'),
    ('${ids.operator}','operator@migration.invalid'),
    ('${ids.vessel}','vessel@migration.invalid');
`);

const permissions = {
  viewAllVessels: false,
  editBusinessContent: false,
  createTasks: false,
  closeTasks: false,
  deleteTasks: false,
  manageMeetings: false,
  exportReports: false,
  enterManagement: false,
  manageUsers: false,
  manageVessels: false,
  viewAuditLogs: false,
  manageRolePermissions: false,
  manageSystemSettings: false,
};

const fixture = {
  revision: 42,
  updatedAt: '2026-07-26T01:00:00.000Z',
  settings: {
    sitePasswordHash: 'a'.repeat(64),
    systemTitle: 'Migration Fixture',
    departments: ['Management', 'Operations', 'Vessel'],
    taskCategories: ['Safety', 'Operations'],
    taskCategorySchemaVersion: 2,
    meetingTaskCategories: ['Meeting action'],
    meetingTaskCategorySchemaVersion: 2,
    equipmentFailureSubcategories: ['Main engine'],
    equipmentFailureSubcategorySchemaVersion: 1,
    vesselStatuses: ['loading', 'unloading', 'to load', 'to unload', 'waiting order', 'drydock/repiar'],
    priorities: ['急', '高', '中', '低'],
    rolePermissions: {
      owner: Object.fromEntries(Object.keys(permissions).map(key => [key, true])),
      admin: { ...permissions, viewAllVessels: true, editBusinessContent: true, createTasks: true, closeTasks: true, deleteTasks: true, manageMeetings: true, exportReports: true, enterManagement: true, manageUsers: true, manageVessels: true, viewAuditLogs: true },
      operator: { ...permissions, editBusinessContent: true, createTasks: true, closeTasks: true, exportReports: true },
      vessel: { ...permissions, createTasks: true },
    },
    nonOwnerPasswordResetVersion: 2,
    meetingTaskAggregationVersion: 1,
    lastCloudSyncAt: '2026-07-26T01:00:00.000Z',
  },
  users: [
    {
      id: 'legacy-owner',
      department: 'Management',
      name: 'Fixture Owner',
      username: 'owner',
      role: 'owner',
      passwordHash: 'b'.repeat(64),
      isActive: true,
      managedVesselIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-07-26T01:00:00.000Z',
    },
    {
      id: 'legacy-admin',
      department: 'Management',
      name: 'Fixture Admin',
      username: 'admin',
      role: 'admin',
      passwordHash: '',
      isActive: true,
      managedVesselIds: ['vessel-a', 'vessel-b'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-07-26T01:00:00.000Z',
    },
    {
      id: 'legacy-operator',
      department: 'Operations',
      name: 'Fixture Operator',
      username: 'operator',
      role: 'operator',
      passwordHash: '',
      isActive: true,
      managedVesselIds: ['vessel-a'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-07-26T01:00:00.000Z',
    },
    {
      id: 'legacy-vessel',
      department: 'Vessel',
      name: 'Fixture Vessel Account',
      username: 'vessel',
      role: 'vessel',
      passwordHash: '',
      isActive: true,
      managedVesselIds: ['vessel-a'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-07-26T01:00:00.000Z',
    },
  ],
  vessels: [
    {
      id: 'vessel-a',
      name: 'Vessel A',
      shortName: 'A',
      fullName: 'Fixture Vessel A',
      shipType: 'Bulk',
      fleetCategory: 'bulk fleet',
      fleetTags: ['fixture'],
      assignedUserIds: ['legacy-admin', 'legacy-operator'],
      delegateManagers: [],
      isActive: true,
      position: {
        source: 'manual',
        location: 'Fixture Port',
        speedKnots: 0,
        navigationStatus: '停泊',
        lastPort: 'Previous',
        nextPort: 'Next',
        eta: '2026-07-27T00:00:00.000Z',
        etb: '',
        etd: '',
        updatedAt: '2026-07-26T00:00:00.000Z',
        manualRemark: '',
      },
      cargo: {
        source: 'manual',
        loadStatus: '非空載',
        name: 'Fixture cargo',
        quantity: '1',
        items: [{ name: 'Fixture cargo', quantity: '1' }],
        updatedAt: '2026-07-26T00:00:00.000Z',
      },
      note: {
        statusList: ['loading'],
        recentDynamics: 'Fixture dynamics',
        subsequentDynamics: '',
        updatedAt: '2026-07-26T00:00:00.000Z',
      },
      weeklyAttention: ['maintenance'],
      manualAttentionLevel: '高',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    },
    {
      id: 'vessel-b',
      name: 'Vessel B',
      shortName: 'B',
      fullName: 'Fixture Vessel B',
      shipType: 'Tanker',
      fleetCategory: 'tanker fleet',
      fleetTags: [],
      assignedUserIds: ['legacy-admin'],
      delegateManagers: [{ userId: 'legacy-operator', isActive: false }],
      isActive: true,
      position: {
        source: 'smart-ship-api',
        location: 'At sea',
        speedKnots: 10,
        navigationStatus: '航行',
        lastPort: 'Previous',
        nextPort: 'Next',
        eta: '',
        etb: '',
        etd: '',
        updatedAt: '2026-07-26T00:00:00.000Z',
        manualRemark: '',
      },
      cargo: {
        source: 'smart-ship-api',
        loadStatus: '空載',
        name: '',
        quantity: '',
        items: [],
        updatedAt: '2026-07-26T00:00:00.000Z',
      },
      note: {
        statusList: ['waiting order'],
        recentDynamics: '',
        subsequentDynamics: '',
        updatedAt: '2026-07-26T00:00:00.000Z',
      },
      weeklyAttention: [],
      manualAttentionLevel: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    },
  ],
  tasks: [
    {
      id: 'task-ordinary',
      vesselId: 'vessel-a',
      vesselIds: ['vessel-a'],
      vesselScopeMode: 'vessels',
      vesselTypeScopes: [],
      priority: '高',
      attentionDimension: 'task',
      isAware: false,
      isAbnormal: true,
      isInternalControl: false,
      category: 'Safety',
      categories: ['Safety'],
      equipmentSubcategory: '',
      description: 'Ordinary fixture task',
      status: 'Open',
      expectedDate: '2026-08-01',
      reportDate: '2026-07-25',
      departments: ['Operations'],
      ownerUserIds: ['legacy-operator'],
      isClosed: false,
      sourceType: 'morning',
      createdBy: 'legacy-operator',
      updatedBy: 'legacy-operator',
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
      statusLogs: [{ id: 'task-log-1', at: '2026-07-26T00:00:00.000Z', by: 'Fixture Operator', byUserId: 'legacy-operator', text: 'Open' }],
      vesselProgress: [{
        vesselId: 'vessel-a',
        status: 'Open',
        isClosed: false,
        updatedAt: '2026-07-26T00:00:00.000Z',
        updatedBy: 'legacy-operator',
        statusLogs: [{ id: 'progress-log-1', at: '2026-07-26T00:00:00.000Z', by: 'Fixture Operator', byUserId: 'legacy-operator', text: 'Open' }],
      }],
    },
    {
      id: 'task-meeting',
      vesselId: 'vessel-a',
      vesselIds: ['vessel-a', 'vessel-b'],
      vesselScopeMode: 'vessels',
      vesselTypeScopes: [],
      priority: '中',
      attentionDimension: 'meeting',
      isAware: true,
      isAbnormal: false,
      isInternalControl: false,
      category: 'Meeting action',
      categories: ['Meeting action'],
      description: 'Meeting fixture task',
      status: 'Tracking',
      expectedDate: '2026-08-02',
      reportDate: '2026-07-25',
      departments: ['Operations'],
      ownerUserIds: ['legacy-admin'],
      isClosed: false,
      sourceMeetingId: 'meeting-1',
      sourceMeetingItemId: 'meeting-item-1',
      distributeToVessels: true,
      sourceType: 'temporary',
      createdBy: 'legacy-admin',
      updatedBy: 'legacy-admin',
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
      statusLogs: [{ id: 'task-log-2', at: '2026-07-26T00:00:00.000Z', by: 'Fixture Admin', byUserId: 'legacy-admin', text: 'Tracking' }],
      vesselProgress: [
        { vesselId: 'vessel-a', status: 'Tracking', isClosed: false, updatedAt: '2026-07-26T00:00:00.000Z', updatedBy: 'legacy-admin', statusLogs: [] },
        { vesselId: 'vessel-b', status: 'Tracking', isClosed: false, updatedAt: '2026-07-26T00:00:00.000Z', updatedBy: 'legacy-admin', statusLogs: [] },
      ],
    },
    {
      id: 'task-internal',
      vesselId: 'vessel-a',
      vesselIds: ['vessel-a'],
      vesselScopeMode: 'vessels',
      vesselTypeScopes: [],
      priority: '急',
      attentionDimension: 'task',
      isAware: true,
      isAbnormal: true,
      isInternalControl: true,
      internalControlCaseId: 'case-1',
      category: 'Safety',
      categories: ['Safety'],
      description: 'Internal fixture task',
      status: 'Investigating',
      expectedDate: '2026-08-03',
      reportDate: '2026-07-24',
      departments: ['Management'],
      ownerUserIds: ['legacy-admin'],
      isClosed: false,
      sourceType: 'morning',
      createdBy: 'legacy-admin',
      updatedBy: 'legacy-admin',
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
      statusLogs: [{ id: 'task-log-3', at: '2026-07-26T00:00:00.000Z', by: 'Fixture Admin', byUserId: 'legacy-admin', text: 'Investigating' }],
      vesselProgress: [],
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `task-quarantine-${index + 1}`,
      vesselId: 'vessel-a',
      vesselIds: ['vessel-a'],
      vesselScopeMode: 'vessels',
      vesselTypeScopes: [],
      priority: '低',
      attentionDimension: 'meeting',
      isAware: false,
      isAbnormal: false,
      isInternalControl: false,
      category: 'Meeting action',
      categories: ['Meeting action'],
      description: `Parentless meeting semantic ${index + 1}`,
      status: 'Open',
      expectedDate: '',
      reportDate: '2026-07-26',
      departments: ['Operations'],
      ownerUserIds: [],
      isClosed: false,
      sourceType: 'temporary',
      createdBy: 'legacy-operator',
      updatedBy: 'legacy-operator',
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
      statusLogs: [],
      vesselProgress: [],
    })),
  ],
  meetings: [{
    id: 'meeting-1',
    subject: 'Fixture meeting',
    status: '追蹤中',
    meetingDate: '2026-07-25',
    vesselScopeMode: 'vessels',
    vesselTypeScopes: [],
    vessels: ['vessel-a', 'vessel-b'],
    reason: 'Fixture reason',
    departments: ['Operations'],
    participantUserIds: ['legacy-admin', 'legacy-operator'],
    trackingUserIds: ['legacy-admin'],
    responsibleUserIds: ['legacy-operator'],
    resolution: 'Track fixture action',
    taskDescription: 'Meeting fixture task',
    taskItems: [{ id: 'meeting-item-1', description: 'Meeting fixture task', categories: ['Meeting action'], distributeToVessels: true }],
    expectedDate: '2026-08-02',
    priority: '中',
    isAbnormal: false,
    isInternalControl: false,
    includeInMorning: true,
    latestStatus: 'Tracking',
    statusLogs: [{ id: 'meeting-log-1', at: '2026-07-26T00:00:00.000Z', by: 'Fixture Admin', byUserId: 'legacy-admin', text: 'Tracking' }],
    createdBy: 'legacy-admin',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
  }],
  internalControlCases: [{
    id: 'case-1',
    vesselId: 'vessel-a',
    reportDate: '2026-07-24',
    reportSource: '日常',
    description: 'Internal fixture task',
    priority: '急',
    category: 'Safety',
    isAware: true,
    status: 'Investigating',
    departments: ['Management'],
    syncToTask: true,
    linkedTaskId: 'task-internal',
    origin: 'task',
    isClosed: false,
    createdBy: 'legacy-admin',
    updatedBy: 'legacy-admin',
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
    statusLogs: [{ id: 'case-log-1', at: '2026-07-26T00:00:00.000Z', by: 'Fixture Admin', byUserId: 'legacy-admin', text: 'Investigating' }],
  }],
  agendaReports: [{
    id: 'report-1',
    title: 'Fixture report',
    vesselIds: ['vessel-a', 'vessel-b'],
    createdBy: 'legacy-admin',
    createdAt: '2026-07-26T00:00:00.000Z',
    taskCount: 3,
  }],
  auditLogs: [{
    id: 'audit-legacy-1',
    at: '2026-07-26T00:00:00.000Z',
    actorId: 'legacy-admin',
    actorName: 'Fixture Admin',
    actorRole: 'admin',
    action: 'fixture_action',
    entityType: 'task',
    entityId: 'task-ordinary',
    detail: 'Fixture detail',
  }],
  notifications: [{
    id: 'notice-1',
    userId: 'legacy-operator',
    vesselId: 'vessel-a',
    taskId: 'task-ordinary',
    kind: 'task_updated',
    title: 'Fixture notification',
    message: 'Fixture notification body',
    actorId: 'legacy-admin',
    createdAt: '2026-07-26T00:00:00.000Z',
    readAt: '2026-07-26T00:30:00.000Z',
  }],
};

const mappings = [
  { legacyUserId: 'legacy-owner', authUserId: ids.owner, authAlias: 'owner@migration.invalid', activationState: 'precreated' },
  { legacyUserId: 'legacy-admin', authUserId: ids.admin, authAlias: 'admin@migration.invalid', activationState: 'precreated' },
  { legacyUserId: 'legacy-operator', authUserId: ids.operator, authAlias: 'operator@migration.invalid', activationState: 'precreated' },
  { legacyUserId: 'legacy-vessel', authUserId: ids.vessel, authAlias: 'vessel@migration.invalid', activationState: 'precreated' },
];
const expectedCounts = computeLegacyImportCounts(fixture);

const callImport = async ({
  workspaceId = ids.workspace,
  payload = fixture,
  identityMappings = mappings,
  counts = expectedCounts,
  quarantineCount = 3,
} = {}) => db.query(
  `select public.import_ship_dynamics_legacy(
    $1::uuid,$2,$3,$4::bigint,$5::jsonb,$6::jsonb,$7::jsonb,$8::integer
  ) as result`,
  [
    workspaceId,
    `fixture-${workspaceId}`,
    'Migration Fixture',
    42,
    JSON.stringify(payload),
    JSON.stringify(identityMappings),
    JSON.stringify(counts),
    quarantineCount,
  ],
);

async function asRole(role, actorId, action) {
  await db.exec(`set role ${role}`);
  if (actorId) await db.exec(`set request.jwt.claim.sub='${actorId}'`);
  try {
    return await action();
  } finally {
    await db.exec('reset role; reset request.jwt.claim.sub');
  }
}

for (const role of ['anon', 'authenticated']) {
  await assert.rejects(
    () => asRole(role, role === 'authenticated' ? ids.owner : null, () => callImport()),
    /permission denied|not-authorized/i,
  );
}

await asRole('service_role', null, async () => {
  await db.exec('begin');
  try {
    const trial = await callImport();
    assert.equal(trial.rows[0].result.quarantineCount, 3);
    await db.exec('reset role');
    const inside = await db.query(`select count(*)::integer as count from public.sd_tasks where workspace_id='${ids.workspace}'`);
    assert.equal(inside.rows[0].count, expectedCounts.importedTasks);
    await db.exec('set role service_role');
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
  await db.exec('rollback');
});
const rolledBack = await db.query(`select count(*)::integer as count from public.sd_workspaces where id='${ids.workspace}'`);
assert.equal(rolledBack.rows[0].count, 0, 'the complete import participates in the caller transaction');

const badCases = [
  ['missing-user-mapping', fixture, mappings.slice(0, -1), expectedCounts, 3, /mapping/i],
  ['duplicate-user-mapping', fixture, [...mappings.slice(0, -1), { ...mappings[0] }], expectedCounts, 3, /mapping/i],
  ['owner-cardinality', { ...fixture, users: fixture.users.map(user => ({ ...user, role: user.id === 'legacy-admin' ? 'owner' : user.role })) }, mappings, expectedCounts, 3, /owner/i],
  ['duplicate-task-id', { ...fixture, tasks: [...fixture.tasks, { ...fixture.tasks[0] }] }, mappings, expectedCounts, 3, /duplicate/i],
  ['unknown-vessel-relation', { ...fixture, tasks: fixture.tasks.map((task, index) => index ? task : { ...task, vesselId: 'missing-vessel', vesselIds: ['missing-vessel'] }) }, mappings, expectedCounts, 3, /vessel|relation/i],
  ['unknown-enum', { ...fixture, tasks: fixture.tasks.map((task, index) => index ? task : { ...task, priority: 'UNKNOWN' }) }, mappings, expectedCounts, 3, /enum|domain|priority/i],
  ['count-drift', fixture, mappings, { ...expectedCounts, importedTasks: expectedCounts.importedTasks + 1 }, 3, /count/i],
  ['quarantine-drift', fixture, mappings, expectedCounts, 2, /quarantine/i],
  ['ambiguous-internal-link', { ...fixture, internalControlCases: [...fixture.internalControlCases, { ...fixture.internalControlCases[0], id: 'case-2' }] }, mappings, expectedCounts, 3, /internal|link|duplicate/i],
];

let badIndex = 0;
for (const [name, payload, identityMappings, counts, quarantineCount, pattern] of badCases) {
  badIndex += 1;
  const workspaceId = `bbbbbbbb-bbbb-4bbb-8bbb-${String(badIndex).padStart(12, '0')}`;
  await assert.rejects(
    () => asRole('service_role', null, () => callImport({ workspaceId, payload, identityMappings, counts, quarantineCount })),
    pattern,
    name,
  );
  const residue = await db.query('select count(*)::integer as count from public.sd_workspaces where id=$1', [workspaceId]);
  assert.equal(residue.rows[0].count, 0, `${name} must roll back every row`);
}

const applied = await asRole('service_role', null, () => callImport());
assert.equal(applied.rows[0].result.status, 'committed');
assert.equal(applied.rows[0].result.legacyRevision, 42);
assert.deepEqual(applied.rows[0].result.counts, expectedCounts);
assert.equal(applied.rows[0].result.quarantineCount, 3);

const stableIds = await db.query(`select id from public.sd_tasks where workspace_id='${ids.workspace}' order by id`);
assert.deepEqual(stableIds.rows.map(row => row.id), ['task-internal', 'task-meeting', 'task-ordinary']);
const quarantine = await db.query(`
  select entity_id, reason, legacy_revision, payload->>'description' as description
  from public.sd_migration_quarantine
  where workspace_id='${ids.workspace}'
  order by entity_id
`);
assert.deepEqual(quarantine.rows.map(row => row.entity_id), ['task-quarantine-1', 'task-quarantine-2', 'task-quarantine-3']);
assert.ok(quarantine.rows.every(row => row.reason === 'meeting_parent_item_missing' && Number(row.legacy_revision) === 42));
assert.ok(quarantine.rows.every(row => row.description.startsWith('Parentless meeting semantic')));

const actualCountQueries = {
  users: 'sd_memberships',
  loginOptions: 'sd_login_options',
  vessels: 'sd_vessels',
  sourceTasks: null,
  importedTasks: 'sd_tasks',
  quarantine: 'sd_migration_quarantine',
  taskVessels: 'sd_task_vessels',
  taskCategories: 'sd_task_categories',
  taskDepartments: 'sd_task_departments',
  taskOwners: 'sd_task_owners',
  taskTypeScopes: 'sd_task_type_scopes',
  taskStatusEvents: 'sd_task_status_events',
  taskVesselStatusEvents: 'sd_task_vessel_status_events',
  meetings: 'sd_meetings',
  meetingVessels: 'sd_meeting_vessels',
  meetingTypeScopes: 'sd_meeting_type_scopes',
  meetingDepartments: 'sd_meeting_departments',
  meetingItems: 'sd_meeting_items',
  meetingItemCategories: 'sd_meeting_item_categories',
  internalCases: 'sd_internal_cases',
  internalCaseDepartments: 'sd_internal_case_departments',
  internalCaseStatusEvents: 'sd_internal_case_status_events',
  internalLinks: 'sd_internal_case_task_links',
  notifications: 'sd_notifications',
  savedReports: 'sd_saved_reports',
  savedReportVessels: 'sd_saved_report_vessels',
};
for (const [key, table] of Object.entries(actualCountQueries)) {
  if (!table) continue;
  const result = await db.query(`select count(*)::integer as count from public.${table} where workspace_id=$1`, [ids.workspace]);
  assert.equal(result.rows[0].count, expectedCounts[key], `${table} count`);
}

const importedEvidence = await db.query(`
  select legacy_id, legacy_payload->>'text' as text
  from public.sd_task_status_events
  where workspace_id=$1 and task_id='task-ordinary'
`, [ids.workspace]);
assert.deepEqual(importedEvidence.rows, [{ legacy_id: 'task-log-1', text: 'Open' }]);
const gate = await db.query(`select password_hash from public.sd_public_site_gate where workspace_id=$1`, [ids.workspace]);
assert.equal(gate.rows[0].password_hash, 'a'.repeat(64), 'legacy SHA remains a transition hash');

for (const [role, actorId, expected] of [
  ['authenticated', ids.owner, 3],
  ['authenticated', ids.operator, 0],
  ['authenticated', ids.vessel, 0],
]) {
  const visible = await asRole(role, actorId, () => db.query(
    'select count(*)::integer as count from public.sd_migration_quarantine where workspace_id=$1',
    [ids.workspace],
  ));
  assert.equal(visible.rows[0].count, expected);
}

await assert.rejects(
  () => asRole('service_role', null, () => callImport()),
  /already-imported|idempotency/i,
  'a completed workspace/revision cannot be imported twice',
);

console.log(`normalized_legacy_import_manifest_files=${manifest.length}`);
console.log(`normalized_legacy_import_quarantine=${expectedCounts.quarantine}`);
console.log('normalized_legacy_import=PASS');

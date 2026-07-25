import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const baseSchemaPath = resolve(root, 'supabase', 'normalized-schema.sql');
const meetingSchemaPath = resolve(root, 'supabase', 'normalized-meeting.sql');
const db = new PGlite();

const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  operator: '33333333-3333-4333-8333-333333333333',
  vesselA: '44444444-4444-4444-8444-444444444444',
  vesselB: '55555555-5555-4555-8555-555555555555',
  ownerSession: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  foreignSession: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
  adminSession: 'cccccccc-1111-4111-8111-cccccccccccc',
  meeting: 'meeting-aggregate-1',
  createOperation: '10000000-0000-4000-8000-000000000001',
  versionConflictOperation: '10000000-0000-4000-8000-000000000002',
  foreignLeaseOperation: '10000000-0000-4000-8000-000000000003',
  staleLeaseOperation: '10000000-0000-4000-8000-000000000004',
  taskConflictOperation: '10000000-0000-4000-8000-000000000005',
  updateOperation: '10000000-0000-4000-8000-000000000006',
  closedConflictOperation: '10000000-0000-4000-8000-000000000007',
  operatorDeleteOperation: '10000000-0000-4000-8000-000000000008',
  deleteOperation: '10000000-0000-4000-8000-000000000009',
};

const taskIds = {
  first: `meeting-task:${ids.meeting}:item-1`,
  second: `meeting-task:${ids.meeting}:item-2`,
};

const pgArray = values => `{${values.join(',')}}`;
const json = value => JSON.stringify(value);

await db.exec(`
  create schema auth;
  create role anon noinherit;
  create role authenticated noinherit;
  create role service_role noinherit bypassrls;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

await db.exec(await readFile(baseSchemaPath, 'utf8'));
let meetingSchema;
try {
  meetingSchema = await readFile(meetingSchemaPath, 'utf8');
} catch (error) {
  throw new Error(`normalized meeting migration is missing (feature-missing RED): ${error.message}`);
}
await db.exec(meetingSchema);

await db.exec(`
  insert into auth.users(id,email) values
    ('${ids.owner}','owner@internal.invalid'),
    ('${ids.admin}','admin@internal.invalid'),
    ('${ids.operator}','operator@internal.invalid'),
    ('${ids.vesselA}','vessel-a@internal.invalid'),
    ('${ids.vesselB}','vessel-b@internal.invalid');

  insert into public.sd_workspaces(id, legacy_key, name)
  values ('${ids.workspace}', 'default', 'Ship Dynamics');

  insert into public.sd_profiles(id, display_name, username_label) values
    ('${ids.owner}','Owner','owner'),
    ('${ids.admin}','Admin','admin'),
    ('${ids.operator}','Operator','operator'),
    ('${ids.vesselA}','Vessel A account','vessel-a'),
    ('${ids.vesselB}','Vessel B account','vessel-b');

  insert into public.sd_memberships(workspace_id,user_id,department,role,is_active) values
    ('${ids.workspace}','${ids.owner}','Management','owner',true),
    ('${ids.workspace}','${ids.admin}','Management','admin',true),
    ('${ids.workspace}','${ids.operator}','Operations','operator',true),
    ('${ids.workspace}','${ids.vesselA}','Vessels','vessel',true),
    ('${ids.workspace}','${ids.vesselB}','Vessels','vessel',true);

  insert into public.sd_vessels(
    workspace_id,id,name,short_name,full_name,ship_type,fleet_category,
    position,cargo,note,is_active
  ) values
    ('${ids.workspace}','vessel-a','A','A','Vessel A','bulk','bulk fleet','{}','{}','{}',true),
    ('${ids.workspace}','vessel-b','B','B','Vessel B','bulk','bulk fleet','{}','{}','{}',true),
    ('${ids.workspace}','vessel-c','C','C','Vessel C','tanker','tanker fleet','{}','{}','{}',true);

  insert into public.sd_vessel_assignments(
    workspace_id,vessel_id,user_id,assignment_kind,is_active
  ) values
    ('${ids.workspace}','vessel-a','${ids.operator}','manager',true),
    ('${ids.workspace}','vessel-a','${ids.vesselA}','vessel_account',true),
    ('${ids.workspace}','vessel-b','${ids.vesselB}','vessel_account',true);
`);

async function asUser(userId, action) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}';`);
  try {
    return await action();
  } finally {
    await db.exec('reset role; reset request.jwt.claim.sub;');
  }
}

async function claim(userId, leaseKey, entityType, entityId, session) {
  return asUser(userId, async () => {
    const result = await db.query(
      `select public.claim_ship_dynamics_entity_lease(
        $1::uuid,$2,$3,$4,$5::uuid,$6::integer
      ) as result`,
      [ids.workspace, leaseKey, entityType, entityId, session, 75],
    );
    return result.rows[0].result;
  });
}

async function release(userId, leaseKey, session, fencingToken) {
  return asUser(userId, async () => {
    const result = await db.query(
      `select public.release_ship_dynamics_entity_lease(
        $1::uuid,$2,$3::uuid,$4::bigint
      ) as released`,
      [ids.workspace, leaseKey, session, fencingToken],
    );
    return result.rows[0].released;
  });
}

const baseMeeting = {
  scopeMode: 'vessels',
  subject: 'Safety follow-up',
  status: '追蹤中',
  meetingDate: '2026-07-20',
  vesselIds: ['vessel-a', 'vessel-b'],
  vesselTypeScopes: [],
  departments: ['Operations', 'Safety'],
  participantUserIds: [ids.owner, ids.operator],
  trackingUserIds: [ids.owner],
  responsibleUserIds: [ids.admin],
  reason: 'Review safety actions',
  resolution: 'Pending execution',
  expectedDate: '2026-08-01',
  completedDate: null,
  priority: '高',
  isAbnormal: true,
  isInternalControl: false,
  includeInMorning: true,
  items: [
    {
      id: 'item-1',
      description: 'Inspect mooring equipment',
      categories: ['Safety', 'Deck'],
      distributeToVessels: true,
    },
    {
      id: 'item-2',
      description: 'Prepare internal summary',
      categories: ['Administration'],
      distributeToVessels: false,
    },
  ],
};

const createSql = `
  select public.command_ship_dynamics_create_meeting(
    $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7,$8,$9,$10::date,
    $11::text[],$12::text[],$13::text[],$14::uuid[],$15::uuid[],$16::uuid[],
    $17,$18,$19::date,$20::date,$21,$22::boolean,$23::boolean,$24::boolean,$25::jsonb
  ) as result
`;

const updateSql = `
  select public.command_ship_dynamics_update_meeting(
    $1::uuid,$2::uuid,$3,$4::bigint,$5::bigint,$6,$7::uuid,$8,$9,$10,$11::date,
    $12::text[],$13::text[],$14::text[],$15::uuid[],$16::uuid[],$17::uuid[],
    $18,$19,$20::date,$21::date,$22,$23::boolean,$24::boolean,$25::boolean,
    $26::jsonb,$27::jsonb
  ) as result
`;

function meetingValues(operationId, fencingToken, ownerSession, meeting) {
  return [
    operationId,
    ids.workspace,
    ids.meeting,
    fencingToken,
    `meeting:${ids.meeting}`,
    ownerSession,
    meeting.scopeMode,
    meeting.subject,
    meeting.status,
    meeting.meetingDate,
    pgArray(meeting.vesselIds),
    pgArray(meeting.vesselTypeScopes),
    pgArray(meeting.departments),
    pgArray(meeting.participantUserIds),
    pgArray(meeting.trackingUserIds),
    pgArray(meeting.responsibleUserIds),
    meeting.reason,
    meeting.resolution,
    meeting.expectedDate,
    meeting.completedDate,
    meeting.priority,
    meeting.isAbnormal,
    meeting.isInternalControl,
    meeting.includeInMorning,
    json(meeting.items),
  ];
}

async function createMeeting(userId, operationId, fencingToken, ownerSession, meeting = baseMeeting) {
  return asUser(userId, async () => {
    const result = await db.query(
      createSql,
      meetingValues(operationId, fencingToken, ownerSession, meeting),
    );
    return result.rows[0].result;
  });
}

async function updateMeeting(
  userId,
  operationId,
  baseVersion,
  fencingToken,
  ownerSession,
  meeting,
  taskGuards,
) {
  const values = meetingValues(operationId, fencingToken, ownerSession, meeting);
  values.splice(3, 0, baseVersion);
  values.push(json(taskGuards));
  return asUser(userId, async () => {
    const result = await db.query(updateSql, values);
    return result.rows[0].result;
  });
}

async function deleteMeeting(
  userId,
  operationId,
  baseVersion,
  fencingToken,
  ownerSession,
  taskGuards,
) {
  return asUser(userId, async () => {
    const result = await db.query(
      `select public.command_ship_dynamics_delete_meeting(
        $1::uuid,$2::uuid,$3,$4::bigint,$5::bigint,$6,$7::uuid,$8::jsonb
      ) as result`,
      [
        operationId,
        ids.workspace,
        ids.meeting,
        baseVersion,
        fencingToken,
        `meeting:${ids.meeting}`,
        ownerSession,
        json(taskGuards),
      ],
    );
    return result.rows[0].result;
  });
}

const ownerMeetingLease = await claim(
  ids.owner,
  `meeting:${ids.meeting}`,
  'meeting',
  ids.meeting,
  ids.ownerSession,
);
assert.equal(ownerMeetingLease.ok, true);
assert.equal(Number(ownerMeetingLease.fencingToken), 1);

const created = await createMeeting(
  ids.owner,
  ids.createOperation,
  ownerMeetingLease.fencingToken,
  ids.ownerSession,
);
assert.equal(created.status, 'committed');
assert.equal(created.replayed, false);
assert.equal(Number(created.version), 1);
assert.deepEqual(
  Object.fromEntries(Object.entries(created.taskVersions).map(([key, value]) => [key, Number(value)])),
  { [taskIds.first]: 1, [taskIds.second]: 1 },
);

const createState = await db.query(`
  select
    (select count(*)::integer from public.sd_meetings
      where workspace_id='${ids.workspace}' and deleted_at is null) as "meetingCount",
    (select count(*)::integer from public.sd_meeting_items
      where workspace_id='${ids.workspace}' and meeting_id='${ids.meeting}' and is_active) as "itemCount",
    (select count(*)::integer from public.sd_tasks
      where workspace_id='${ids.workspace}' and source_kind='meeting') as "taskCount",
    (select count(*)::integer from public.sd_task_vessels
      where workspace_id='${ids.workspace}' and task_id in ('${taskIds.first}','${taskIds.second}')
        and is_active_scope) as "taskVesselCount",
    (select count(*)::integer from public.sd_meeting_item_categories
      where workspace_id='${ids.workspace}') as "itemCategoryCount",
    (select count(*)::integer from public.sd_meeting_status_events
      where workspace_id='${ids.workspace}' and meeting_id='${ids.meeting}') as "meetingStatusCount",
    (select count(*)::integer from public.sd_task_status_events
      where workspace_id='${ids.workspace}' and task_id in ('${taskIds.first}','${taskIds.second}')) as "taskStatusCount"
`);
assert.deepEqual(createState.rows[0], {
  meetingCount: 1,
  itemCount: 2,
  taskCount: 2,
  taskVesselCount: 4,
  itemCategoryCount: 3,
  meetingStatusCount: 1,
  taskStatusCount: 2,
});

const canonicalLinks = await db.query(`
  select id, source_kind as "sourceKind", source_meeting_item_id as "sourceMeetingItemId"
  from public.sd_tasks
  where workspace_id='${ids.workspace}' and id in ('${taskIds.first}','${taskIds.second}')
  order by id
`);
assert.deepEqual(canonicalLinks.rows, [
  { id: taskIds.first, sourceKind: 'meeting', sourceMeetingItemId: 'item-1' },
  { id: taskIds.second, sourceKind: 'meeting', sourceMeetingItemId: 'item-2' },
]);

const replayedCreate = await createMeeting(
  ids.owner,
  ids.createOperation,
  ownerMeetingLease.fencingToken,
  ids.ownerSession,
);
assert.equal(replayedCreate.status, 'committed');
assert.equal(replayedCreate.replayed, true);
assert.equal(Number(replayedCreate.version), 1);

await assert.rejects(
  () => createMeeting(
    ids.owner,
    ids.createOperation,
    ownerMeetingLease.fencingToken,
    ids.ownerSession,
    { ...baseMeeting, subject: 'Mismatched replay' },
  ),
  /operation-mismatch/i,
);
console.log('normalized_meeting_create_replay=PASS');

await db.exec(`
  insert into public.sd_tasks(
    workspace_id,id,description,status,priority,source_kind,attention_dimension,
    is_internal_control,is_closed
  ) values
    ('${ids.workspace}','ordinary-visible','Visible ordinary','open','中','ordinary','task',false,false),
    ('${ids.workspace}','ordinary-cross-vessel','Cross-vessel aggregate','open','中','ordinary','task',false,false),
    ('${ids.workspace}','ordinary-internal','Internal control','open','高','ordinary','task',true,false);
  insert into public.sd_task_vessels(
    workspace_id,task_id,vessel_id,is_active_scope,status,is_closed
  ) values
    ('${ids.workspace}','ordinary-visible','vessel-a',true,'open',false),
    ('${ids.workspace}','ordinary-cross-vessel','vessel-a',true,'open',false),
    ('${ids.workspace}','ordinary-cross-vessel','vessel-b',true,'open',false),
    ('${ids.workspace}','ordinary-internal','vessel-a',true,'open',false);

  insert into public.sd_meetings(
    workspace_id,id,scope_mode,subject,status,meeting_date,reason,resolution,
    priority,is_internal_control,created_by,updated_by
  ) values
    ('${ids.workspace}','meeting-malformed','vessels','Malformed','追蹤中','2026-07-20',
      'Malformed scope','Pending','中',false,'${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','meeting-internal','vessels','Internal','追蹤中','2026-07-20',
      'Internal meeting','Pending','高',true,'${ids.owner}','${ids.owner}');
  insert into public.sd_meeting_vessels(workspace_id,meeting_id,vessel_id) values
    ('${ids.workspace}','meeting-malformed','vessel-a'),
    ('${ids.workspace}','meeting-internal','vessel-a');
  insert into public.sd_meeting_items(
    workspace_id,id,meeting_id,description,distribute_to_vessels,ordinal,is_active,
    created_by,updated_by
  ) values
    ('${ids.workspace}','item-malformed','meeting-malformed','Malformed distributed item',true,1,true,
      '${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','item-internal','meeting-internal','Hidden internal item',true,1,true,
      '${ids.owner}','${ids.owner}');
  insert into public.sd_tasks(
    workspace_id,id,description,status,priority,source_kind,attention_dimension,
    source_meeting_item_id,is_internal_control,is_closed
  ) values
    ('${ids.workspace}','meeting-malformed-task','Malformed meeting task','open','中','meeting','meeting',
      'item-malformed',false,false),
    ('${ids.workspace}','meeting-internal-task','Internal meeting task','open','高','meeting','meeting',
      'item-internal',false,false);
  insert into public.sd_task_vessels(
    workspace_id,task_id,vessel_id,is_active_scope,status,is_closed
  ) values
    ('${ids.workspace}','meeting-malformed-task','vessel-a',true,'open',false),
    ('${ids.workspace}','meeting-malformed-task','vessel-b',true,'open',false),
    ('${ids.workspace}','meeting-internal-task','vessel-a',true,'open',false);

  alter table public.sd_tasks disable trigger all;
  insert into public.sd_tasks(
    workspace_id,id,description,status,priority,source_kind,attention_dimension,
    source_meeting_item_id,is_internal_control,is_closed
  ) values (
    '${ids.workspace}','meeting-orphan-task','Orphan meeting task','open','中','meeting','meeting',
    'missing-item',false,false
  );
  alter table public.sd_tasks enable trigger all;
  insert into public.sd_task_vessels(
    workspace_id,task_id,vessel_id,is_active_scope,status,is_closed
  ) values ('${ids.workspace}','meeting-orphan-task','vessel-a',true,'open',false);
`);

async function vesselProjection(userId) {
  return asUser(userId, async () => {
    const tasks = await db.query('select id from public.sd_tasks order by id');
    const progress = await db.query(`
      select task_id as "taskId", vessel_id as "vesselId"
      from public.sd_task_vessels
      order by task_id, vessel_id
    `);
    const meetings = await db.query('select id from public.sd_meetings order by id');
    const items = await db.query('select id from public.sd_meeting_items order by id');
    return { tasks: tasks.rows, progress: progress.rows, meetings: meetings.rows, items: items.rows };
  });
}

assert.deepEqual(await vesselProjection(ids.vesselA), {
  tasks: [{ id: taskIds.first }, { id: 'ordinary-visible' }],
  progress: [
    { taskId: taskIds.first, vesselId: 'vessel-a' },
    { taskId: 'ordinary-visible', vesselId: 'vessel-a' },
  ],
  meetings: [],
  items: [],
});
assert.deepEqual(await vesselProjection(ids.vesselB), {
  tasks: [{ id: taskIds.first }],
  progress: [{ taskId: taskIds.first, vesselId: 'vessel-b' }],
  meetings: [],
  items: [],
});

await assert.rejects(
  () => asUser(ids.owner, () => db.query(`
    insert into public.sd_meetings(
      workspace_id,id,scope_mode,subject,status,meeting_date,reason,resolution,
      priority,created_by,updated_by
    ) values (
      '${ids.workspace}','direct-write','vessels','Bypass','追蹤中','2026-07-20',
      'Bypass','Bypass','中','${ids.owner}','${ids.owner}'
    )
  `)),
  /permission denied/i,
);
await assert.rejects(
  () => asUser(ids.owner, () => db.query(`
    update public.sd_tasks set description='bypass' where id='${taskIds.first}'
  `)),
  /permission denied/i,
);
await assert.rejects(
  () => db.query(`
    update public.sd_meeting_status_events set status='tampered'
    where workspace_id='${ids.workspace}' and meeting_id='${ids.meeting}'
  `),
  /immutable-history/i,
);
console.log('normalized_meeting_vessel_rls_direct_dml=PASS');

const ownerTaskLeases = {};
for (const taskId of [taskIds.first, taskIds.second]) {
  ownerTaskLeases[taskId] = await claim(
    ids.owner,
    `task:${taskId}`,
    'task',
    taskId,
    ids.ownerSession,
  );
  assert.equal(ownerTaskLeases[taskId].ok, true);
}
const ownerTaskGuards = [taskIds.first, taskIds.second].map(taskId => ({
  taskId,
  baseVersion: 1,
  leaseKey: `task:${taskId}`,
  ownerSession: ids.ownerSession,
  fencingToken: Number(ownerTaskLeases[taskId].fencingToken),
}));

const versionConflict = await updateMeeting(
  ids.owner,
  ids.versionConflictOperation,
  99,
  ownerMeetingLease.fencingToken,
  ids.ownerSession,
  baseMeeting,
  ownerTaskGuards,
);
assert.equal(versionConflict.status, 'rejected');
assert.equal(versionConflict.errorCode, 'version-conflict');

const foreignLease = await updateMeeting(
  ids.owner,
  ids.foreignLeaseOperation,
  1,
  ownerMeetingLease.fencingToken,
  ids.foreignSession,
  baseMeeting,
  ownerTaskGuards,
);
assert.equal(foreignLease.status, 'rejected');
assert.match(foreignLease.errorCode, /^lease-(owner|fencing|expired)-mismatch$/);

await db.exec(`
  update public.sd_edit_leases
  set expires_at=clock_timestamp()-interval '1 second'
  where workspace_id='${ids.workspace}' and lease_key='meeting:${ids.meeting}'
`);
const adminMeetingLease = await claim(
  ids.admin,
  `meeting:${ids.meeting}`,
  'meeting',
  ids.meeting,
  ids.adminSession,
);
assert.equal(adminMeetingLease.ok, true);
assert.equal(Number(adminMeetingLease.fencingToken), 2);

const staleLease = await updateMeeting(
  ids.owner,
  ids.staleLeaseOperation,
  1,
  ownerMeetingLease.fencingToken,
  ids.ownerSession,
  baseMeeting,
  ownerTaskGuards,
);
assert.equal(staleLease.status, 'rejected');
assert.match(staleLease.errorCode, /^lease-(owner|fencing|expired)-mismatch$/);

for (const taskId of [taskIds.first, taskIds.second]) {
  assert.equal(
    await release(
      ids.owner,
      `task:${taskId}`,
      ids.ownerSession,
      ownerTaskLeases[taskId].fencingToken,
    ),
    true,
  );
}
const adminTaskLeases = {};
for (const taskId of [taskIds.first, taskIds.second]) {
  adminTaskLeases[taskId] = await claim(
    ids.admin,
    `task:${taskId}`,
    'task',
    taskId,
    ids.adminSession,
  );
  assert.equal(adminTaskLeases[taskId].ok, true);
  assert.equal(Number(adminTaskLeases[taskId].fencingToken), 2);
}
const adminTaskGuards = [taskIds.first, taskIds.second].map(taskId => ({
  taskId,
  baseVersion: taskId === taskIds.first ? 999 : 1,
  leaseKey: `task:${taskId}`,
  ownerSession: ids.adminSession,
  fencingToken: Number(adminTaskLeases[taskId].fencingToken),
}));

const nextMeeting = {
  ...baseMeeting,
  subject: 'Safety follow-up revised',
  items: [
    {
      ...baseMeeting.items[0],
      description: 'Inspect and photograph mooring equipment',
      categories: ['Safety'],
    },
  ],
};

const linkedTaskConflict = await updateMeeting(
  ids.admin,
  ids.taskConflictOperation,
  1,
  adminMeetingLease.fencingToken,
  ids.adminSession,
  nextMeeting,
  adminTaskGuards,
);
assert.equal(linkedTaskConflict.status, 'rejected');
assert.equal(linkedTaskConflict.errorCode, 'task-version-conflict');
const replayedLinkedTaskConflict = await updateMeeting(
  ids.admin,
  ids.taskConflictOperation,
  1,
  adminMeetingLease.fencingToken,
  ids.adminSession,
  nextMeeting,
  adminTaskGuards,
);
assert.equal(replayedLinkedTaskConflict.status, 'rejected');
assert.equal(replayedLinkedTaskConflict.replayed, true);
assert.equal(replayedLinkedTaskConflict.errorCode, 'task-version-conflict');

const rollbackState = await db.query(`
  select
    (select subject from public.sd_meetings
      where workspace_id='${ids.workspace}' and id='${ids.meeting}') as subject,
    (select version from public.sd_meetings
      where workspace_id='${ids.workspace}' and id='${ids.meeting}') as "meetingVersion",
    (select description from public.sd_tasks
      where workspace_id='${ids.workspace}' and id='${taskIds.first}') as "taskDescription",
    (select version from public.sd_tasks
      where workspace_id='${ids.workspace}' and id='${taskIds.first}') as "taskVersion"
`);
assert.deepEqual(rollbackState.rows[0], {
  subject: baseMeeting.subject,
  meetingVersion: 1,
  taskDescription: baseMeeting.items[0].description,
  taskVersion: 1,
});
console.log('normalized_meeting_conflicts_atomicity=PASS');

const successfulTaskGuards = adminTaskGuards.map(guard => ({ ...guard, baseVersion: 1 }));
const updated = await updateMeeting(
  ids.admin,
  ids.updateOperation,
  1,
  adminMeetingLease.fencingToken,
  ids.adminSession,
  nextMeeting,
  successfulTaskGuards,
);
assert.equal(updated.status, 'committed');
assert.equal(updated.replayed, false);
assert.equal(Number(updated.version), 2);

const updateState = await db.query(`
  select
    (select subject from public.sd_meetings
      where workspace_id='${ids.workspace}' and id='${ids.meeting}') as subject,
    (select version from public.sd_meetings
      where workspace_id='${ids.workspace}' and id='${ids.meeting}') as "meetingVersion",
    (select description from public.sd_tasks
      where workspace_id='${ids.workspace}' and id='${taskIds.first}') as "firstDescription",
    (select version from public.sd_tasks
      where workspace_id='${ids.workspace}' and id='${taskIds.first}') as "firstVersion",
    (select is_closed from public.sd_tasks
      where workspace_id='${ids.workspace}' and id='${taskIds.second}') as "secondClosed",
    (select version from public.sd_tasks
      where workspace_id='${ids.workspace}' and id='${taskIds.second}') as "secondVersion",
    (select is_active from public.sd_meeting_items
      where workspace_id='${ids.workspace}' and id='item-2') as "secondItemActive",
    (select count(*)::integer from public.sd_task_status_events
      where workspace_id='${ids.workspace}' and task_id='${taskIds.second}') as "secondStatusCount"
`);
assert.deepEqual(updateState.rows[0], {
  subject: nextMeeting.subject,
  meetingVersion: 2,
  firstDescription: nextMeeting.items[0].description,
  firstVersion: 2,
  secondClosed: true,
  secondVersion: 2,
  secondItemActive: false,
  secondStatusCount: 2,
});
console.log('normalized_meeting_item_removal_archive=PASS');

await db.exec(`
  update public.sd_tasks
  set status='Closed independently',
      is_closed=true,
      closed_date=current_date,
      closed_by='${ids.admin}',
      version=version+1,
      updated_at=clock_timestamp(),
      updated_by='${ids.admin}'
  where workspace_id='${ids.workspace}' and id='${taskIds.first}';
  insert into public.sd_task_status_events(workspace_id,id,task_id,status,actor_id)
  values (
    '${ids.workspace}',gen_random_uuid(),'${taskIds.first}',
    'Closed independently','${ids.admin}'
  );
`);
const closedTaskGuards = [
  { ...successfulTaskGuards[0], baseVersion: 3 },
  { ...successfulTaskGuards[1], baseVersion: 2 },
];
const closedConflict = await updateMeeting(
  ids.admin,
  ids.closedConflictOperation,
  2,
  adminMeetingLease.fencingToken,
  ids.adminSession,
  {
    ...nextMeeting,
    items: [{
      ...nextMeeting.items[0],
      description: 'Incompatible overwrite of closed work',
    }],
  },
  closedTaskGuards,
);
assert.equal(closedConflict.status, 'rejected');
assert.equal(closedConflict.errorCode, 'closed-linked-task-conflict');
const preservedClosedTask = await db.query(`
  select description, status, version
  from public.sd_tasks
  where workspace_id='${ids.workspace}' and id='${taskIds.first}'
`);
assert.deepEqual(preservedClosedTask.rows[0], {
  description: nextMeeting.items[0].description,
  status: 'Closed independently',
  version: 3,
});
console.log('normalized_meeting_closed_task_preserved=PASS');

await assert.rejects(
  () => deleteMeeting(
    ids.operator,
    ids.operatorDeleteOperation,
    2,
    adminMeetingLease.fencingToken,
    ids.adminSession,
    closedTaskGuards,
  ),
  /not-authorized/i,
);

const deleteGuards = closedTaskGuards;
const deleted = await deleteMeeting(
  ids.admin,
  ids.deleteOperation,
  2,
  adminMeetingLease.fencingToken,
  ids.adminSession,
  deleteGuards,
);
assert.equal(deleted.status, 'committed');
assert.equal(deleted.replayed, false);
assert.equal(Number(deleted.archivedTaskCount), 2);

const deleteState = await db.query(`
  select
    (select deleted_at is not null from public.sd_meetings
      where workspace_id='${ids.workspace}' and id='${ids.meeting}') as "meetingDeleted",
    (select count(*)::integer from public.sd_meeting_items
      where workspace_id='${ids.workspace}' and meeting_id='${ids.meeting}' and is_active) as "activeItems",
    (select count(*)::integer from public.sd_tasks
      where workspace_id='${ids.workspace}'
        and id in ('${taskIds.first}','${taskIds.second}') and is_closed) as "closedTasks",
    (select count(*)::integer from public.sd_task_vessels
      where workspace_id='${ids.workspace}'
        and task_id in ('${taskIds.first}','${taskIds.second}') and is_active_scope) as "activeTaskScopes",
    (select count(*)::integer from public.sd_audit_events
      where workspace_id='${ids.workspace}' and command='delete_meeting'
        and entity_id='${ids.meeting}') as "deleteAudits"
`);
assert.deepEqual(deleteState.rows[0], {
  meetingDeleted: true,
  activeItems: 0,
  closedTasks: 2,
  activeTaskScopes: 0,
  deleteAudits: 1,
});

const ownerDeletedProjection = await asUser(ids.owner, async () => {
  const meetings = await db.query(
    `select id from public.sd_meetings where id='${ids.meeting}'`,
  );
  return meetings.rows;
});
assert.deepEqual(ownerDeletedProjection, []);

const replayedDelete = await deleteMeeting(
  ids.admin,
  ids.deleteOperation,
  2,
  adminMeetingLease.fencingToken,
  ids.adminSession,
  deleteGuards,
);
assert.equal(replayedDelete.status, 'committed');
assert.equal(replayedDelete.replayed, true);

const operationState = await db.query(`
  select status, error_code as "errorCode"
  from public.sd_operations
  where workspace_id='${ids.workspace}'
    and operation_id in (
      '${ids.versionConflictOperation}',
      '${ids.foreignLeaseOperation}',
      '${ids.staleLeaseOperation}',
      '${ids.taskConflictOperation}',
      '${ids.closedConflictOperation}'
    )
  order by operation_id
`);
assert.deepEqual(operationState.rows, [
  { status: 'rejected', errorCode: 'version-conflict' },
  { status: 'rejected', errorCode: 'lease-owner-mismatch' },
  { status: 'rejected', errorCode: 'lease-owner-mismatch' },
  { status: 'rejected', errorCode: 'task-version-conflict' },
  { status: 'rejected', errorCode: 'closed-linked-task-conflict' },
]);

console.log('normalized_meeting_delete_history_idempotency=PASS');
console.log('normalized_meeting_db=PASS');

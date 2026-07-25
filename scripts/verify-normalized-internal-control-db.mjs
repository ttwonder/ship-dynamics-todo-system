import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const baseSchemaPath = resolve(root, 'supabase', 'normalized-schema.sql');
const migrationPath = resolve(root, 'supabase', 'normalized-internal-control.sql');
const db = new PGlite();

const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  operator: '33333333-3333-4333-8333-333333333333',
  delegate: '44444444-4444-4444-8444-444444444444',
  vessel: '55555555-5555-4555-8555-555555555555',
  outsider: '66666666-6666-4666-8666-666666666666',
};

const sessions = {
  owner: 'a1000000-0000-4000-8000-000000000001',
  ownerSecond: 'a1000000-0000-4000-8000-000000000002',
  operator: 'a1000000-0000-4000-8000-000000000003',
  delegate: 'a1000000-0000-4000-8000-000000000004',
  vessel: 'a1000000-0000-4000-8000-000000000005',
};

const operations = {
  standaloneCreate: 'b1000000-0000-4000-8000-000000000001',
  standaloneConflict: 'b1000000-0000-4000-8000-000000000002',
  standaloneLeaseConflict: 'b1000000-0000-4000-8000-000000000003',
  linkedCreate: 'b1000000-0000-4000-8000-000000000004',
  linkedUpdate: 'b1000000-0000-4000-8000-000000000005',
  linkedRollback: 'b1000000-0000-4000-8000-000000000006',
  linkedCancel: 'b1000000-0000-4000-8000-000000000007',
  linkedReopen: 'b1000000-0000-4000-8000-000000000008',
  uniqueCaseCreate: 'b1000000-0000-4000-8000-000000000009',
  uniqueLink: 'b1000000-0000-4000-8000-000000000010',
  duplicateCaseCreate: 'b1000000-0000-4000-8000-000000000011',
  duplicateLink: 'b1000000-0000-4000-8000-000000000012',
  uniqueUnlink: 'b1000000-0000-4000-8000-000000000013',
  deleteTaskCreate: 'b1000000-0000-4000-8000-000000000014',
  deleteLinkedTask: 'b1000000-0000-4000-8000-000000000015',
  hardDeleteCreate: 'b1000000-0000-4000-8000-000000000016',
  hardDeleteCase: 'b1000000-0000-4000-8000-000000000017',
  delegateCreate: 'b1000000-0000-4000-8000-000000000018',
  deniedOperatorCreate: 'b1000000-0000-4000-8000-000000000019',
  activeHiddenCreate: 'b1000000-0000-4000-8000-000000000020',
  vesselExistingProbe: 'b1000000-0000-4000-8000-000000000021',
  vesselMissingProbe: 'b1000000-0000-4000-8000-000000000022',
  closedCaseUpdate: 'b1000000-0000-4000-8000-000000000023',
};

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
await db.exec(await readFile(migrationPath, 'utf8'));

await db.exec(`
  insert into auth.users(id,email) values
    ('${ids.owner}','owner@internal.invalid'),
    ('${ids.admin}','admin@internal.invalid'),
    ('${ids.operator}','operator@internal.invalid'),
    ('${ids.delegate}','delegate@internal.invalid'),
    ('${ids.vessel}','vessel@internal.invalid'),
    ('${ids.outsider}','outsider@internal.invalid');

  insert into public.sd_workspaces(id, legacy_key, name) values
    ('${ids.workspace}', 'default', 'Ship Dynamics');

  insert into public.sd_profiles(id, display_name, username_label) values
    ('${ids.owner}','Owner','owner'),
    ('${ids.admin}','Admin','admin'),
    ('${ids.operator}','Assigned operator','operator'),
    ('${ids.delegate}','Delegated operator','delegate'),
    ('${ids.vessel}','Vessel account','vessel'),
    ('${ids.outsider}','Outsider','outsider');

  insert into public.sd_memberships(workspace_id,user_id,department,role,is_active) values
    ('${ids.workspace}','${ids.owner}','Management','owner',true),
    ('${ids.workspace}','${ids.admin}','Management','admin',true),
    ('${ids.workspace}','${ids.operator}','Operations','operator',true),
    ('${ids.workspace}','${ids.delegate}','Operations','operator',true),
    ('${ids.workspace}','${ids.vessel}','Vessel','vessel',true);

  insert into public.sd_vessels(
    workspace_id,id,name,short_name,full_name,ship_type,fleet_category,
    position,cargo,note,is_active
  ) values
    ('${ids.workspace}','vessel-a','A','A','Vessel A','bulk','bulk fleet','{}','{}','{}',true),
    ('${ids.workspace}','vessel-b','B','B','Vessel B','bulk','bulk fleet','{}','{}','{}',true);

  insert into public.sd_vessel_assignments(
    workspace_id,vessel_id,user_id,assignment_kind,is_active
  ) values
    ('${ids.workspace}','vessel-a','${ids.operator}','manager',true),
    ('${ids.workspace}','vessel-b','${ids.delegate}','delegate',true),
    ('${ids.workspace}','vessel-a','${ids.vessel}','vessel_account',true);

  insert into public.sd_tasks(
    workspace_id,id,description,status,priority,source_kind,is_internal_control,is_closed,
    created_by,updated_by
  ) values
    ('${ids.workspace}','task-existing','Existing ordinary task','open','中','ordinary',false,false,'${ids.owner}','${ids.owner}');

  insert into public.sd_task_vessels(
    workspace_id,task_id,vessel_id,is_active_scope,status,is_closed,updated_by
  ) values
    ('${ids.workspace}','task-existing','vessel-a',true,'open',false,'${ids.owner}');
`);

async function asUser(userId, action) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}';`);
  try {
    return await action();
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`);
  }
}

async function claim(userId, leaseKey, entityType, entityId, ownerSession) {
  return asUser(userId, async () => {
    const result = await db.query(
      `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,75) as result`,
      [ids.workspace, leaseKey, entityType, entityId, ownerSession],
    );
    assert.equal(result.rows[0].result.ok, true, `lease claim failed for ${leaseKey}`);
    return result.rows[0].result;
  });
}

async function release(userId, leaseKey, ownerSession, token) {
  return asUser(userId, async () => {
    const result = await db.query(
      `select public.release_ship_dynamics_entity_lease($1::uuid,$2,$3::uuid,$4::bigint) as released`,
      [ids.workspace, leaseKey, ownerSession, token],
    );
    return result.rows[0].released;
  });
}

function casePayload({
  vesselId = 'vessel-a',
  description,
  status = 'Open',
  reportDate = '2026-07-26',
  isClosed = false,
  departments = ['Operations'],
} = {}) {
  return {
    vesselId,
    reportDate,
    reportSource: '日常',
    description,
    priority: '中',
    category: 'Safety',
    isAware: false,
    status,
    origin: 'internal-control',
    isClosed,
    departments,
  };
}

function taskPayload(id) {
  return {
    id,
    expectedDate: '2026-08-15',
    categories: ['Safety'],
    ownerUserIds: [ids.operator],
  };
}

async function createInternalCase({
  userId,
  operationId,
  caseId,
  payload,
  caseLease,
  ownerSession,
  task = null,
  taskLease = null,
}) {
  return asUser(userId, async () => {
    const result = await db.query(
      `select public.command_ship_dynamics_create_internal_case(
        $1::uuid,$2::uuid,$3,$4,$5::uuid,$6::bigint,$7::jsonb,
        $8::jsonb,$9,$10::uuid,$11::bigint
      ) as result`,
      [
        operationId,
        ids.workspace,
        caseId,
        `internal-case:${caseId}`,
        ownerSession,
        caseLease.fencingToken,
        JSON.stringify(payload),
        task ? JSON.stringify(task) : null,
        task ? `task:${task.id}` : null,
        task ? ownerSession : null,
        taskLease?.fencingToken ?? null,
      ],
    );
    return result.rows[0].result;
  });
}

async function updateInternalCase({
  userId,
  operationId,
  caseId,
  baseCaseVersion,
  payload,
  caseLease,
  ownerSession,
  taskId = null,
  baseTaskVersion = null,
  taskLease = null,
}) {
  return asUser(userId, async () => {
    const result = await db.query(
      `select public.command_ship_dynamics_update_internal_case(
        $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb,
        $9::bigint,$10,$11::uuid,$12::bigint
      ) as result`,
      [
        operationId,
        ids.workspace,
        caseId,
        baseCaseVersion,
        `internal-case:${caseId}`,
        ownerSession,
        caseLease.fencingToken,
        JSON.stringify(payload),
        baseTaskVersion,
        taskId ? `task:${taskId}` : null,
        taskId ? ownerSession : null,
        taskLease?.fencingToken ?? null,
      ],
    );
    return result.rows[0].result;
  });
}

async function visibleIds(userId, table, idColumn = 'id') {
  return asUser(userId, async () => {
    const result = await db.query(`select ${idColumn} as id from public.${table} order by ${idColumn}`);
    return result.rows.map(row => row.id);
  });
}

const standaloneCaseId = 'case-standalone';
const standaloneLease = await claim(
  ids.owner,
  `internal-case:${standaloneCaseId}`,
  'internal-case',
  standaloneCaseId,
  sessions.owner,
);
const standalonePayload = casePayload({ description: 'Standalone internal evidence' });
const standaloneCreate = await createInternalCase({
  userId: ids.owner,
  operationId: operations.standaloneCreate,
  caseId: standaloneCaseId,
  payload: standalonePayload,
  caseLease: standaloneLease,
  ownerSession: sessions.owner,
});
assert.deepEqual(
  {
    status: standaloneCreate.status,
    replayed: standaloneCreate.replayed,
    caseId: standaloneCreate.caseId,
    caseVersion: Number(standaloneCreate.caseVersion),
    taskId: standaloneCreate.taskId,
  },
  { status: 'committed', replayed: false, caseId: standaloneCaseId, caseVersion: 1, taskId: null },
);

const standaloneRows = await db.query(`
  select c.id, c.version, c.created_by = '${ids.owner}'::uuid as actor_stamped,
    (select array_agg(d.department order by d.department)
       from public.sd_internal_case_departments d
      where d.workspace_id=c.workspace_id and d.case_id=c.id) as departments,
    (select count(*)::integer
       from public.sd_internal_case_status_events e
      where e.workspace_id=c.workspace_id and e.case_id=c.id) as event_count,
    (select count(*)::integer
       from public.sd_internal_case_task_links l
      where l.workspace_id=c.workspace_id and l.case_id=c.id) as link_count
  from public.sd_internal_cases c
  where c.workspace_id='${ids.workspace}' and c.id='${standaloneCaseId}'
`);
assert.deepEqual(standaloneRows.rows[0], {
  id: standaloneCaseId,
  version: 1,
  actor_stamped: true,
  departments: ['Operations'],
  event_count: 1,
  link_count: 0,
});

assert.equal(
  await release(
    ids.owner,
    `internal-case:${standaloneCaseId}`,
    sessions.owner,
    standaloneLease.fencingToken,
  ),
  true,
);
const standaloneReplay = await createInternalCase({
  userId: ids.owner,
  operationId: operations.standaloneCreate,
  caseId: standaloneCaseId,
  payload: standalonePayload,
  caseLease: standaloneLease,
  ownerSession: sessions.owner,
});
assert.equal(standaloneReplay.replayed, true, 'operation replay must not require a still-live lease');
assert.equal(Number(standaloneReplay.caseVersion), 1);
await assert.rejects(
  () => createInternalCase({
    userId: ids.owner,
    operationId: operations.standaloneCreate,
    caseId: standaloneCaseId,
    payload: { ...standalonePayload, description: 'Mismatched operation reuse' },
    caseLease: standaloneLease,
    ownerSession: sessions.owner,
  }),
  /operation-mismatch/i,
  'an operation id cannot be reused with different request semantics',
);

const standaloneSecondLease = await claim(
  ids.owner,
  `internal-case:${standaloneCaseId}`,
  'internal-case',
  standaloneCaseId,
  sessions.ownerSecond,
);
await assert.rejects(
  () => updateInternalCase({
    userId: ids.owner,
    operationId: operations.standaloneConflict,
    caseId: standaloneCaseId,
    baseCaseVersion: 99,
    payload: { ...standalonePayload, description: 'Must not commit' },
    caseLease: standaloneSecondLease,
    ownerSession: sessions.ownerSecond,
  }),
  /version-conflict/i,
  'stale case version must fail',
);
await assert.rejects(
  () => updateInternalCase({
    userId: ids.owner,
    operationId: operations.standaloneLeaseConflict,
    caseId: standaloneCaseId,
    baseCaseVersion: 1,
    payload: { ...standalonePayload, description: 'Must not pass fencing' },
    caseLease: { fencingToken: Number(standaloneSecondLease.fencingToken) - 1 },
    ownerSession: sessions.ownerSecond,
  }),
  /lease-(?:fencing|owner|expired)-mismatch/i,
  'stale case fencing token must fail',
);

const linkedCaseId = 'case-linked';
const linkedTaskId = 'task-linked';
const linkedCaseLease = await claim(
  ids.owner,
  `internal-case:${linkedCaseId}`,
  'internal-case',
  linkedCaseId,
  sessions.owner,
);
const linkedTaskLease = await claim(
  ids.owner,
  `task:${linkedTaskId}`,
  'internal-task',
  linkedTaskId,
  sessions.owner,
);
const linkedCreate = await createInternalCase({
  userId: ids.owner,
  operationId: operations.linkedCreate,
  caseId: linkedCaseId,
  payload: casePayload({ description: 'Atomic linked evidence', status: 'Investigating' }),
  caseLease: linkedCaseLease,
  ownerSession: sessions.owner,
  task: taskPayload(linkedTaskId),
  taskLease: linkedTaskLease,
});
assert.deepEqual(
  {
    status: linkedCreate.status,
    replayed: linkedCreate.replayed,
    caseVersion: Number(linkedCreate.caseVersion),
    taskId: linkedCreate.taskId,
    taskVersion: Number(linkedCreate.taskVersion),
  },
  { status: 'committed', replayed: false, caseVersion: 1, taskId: linkedTaskId, taskVersion: 1 },
);

const linkedRows = await db.query(`
  select c.description as case_description, c.version as case_version,
         t.description as task_description, t.version as task_version,
         t.is_internal_control,
         l.case_id, l.task_id,
         (select count(*)::integer from public.sd_task_vessels tv
           where tv.workspace_id=t.workspace_id and tv.task_id=t.id
             and tv.vessel_id=c.vessel_id and tv.is_active_scope) as exact_scope_count
  from public.sd_internal_cases c
  join public.sd_internal_case_task_links l
    on l.workspace_id=c.workspace_id and l.case_id=c.id
  join public.sd_tasks t
    on t.workspace_id=l.workspace_id and t.id=l.task_id
  where c.workspace_id='${ids.workspace}' and c.id='${linkedCaseId}'
`);
assert.deepEqual(linkedRows.rows[0], {
  case_description: 'Atomic linked evidence',
  case_version: 1,
  task_description: 'Atomic linked evidence',
  task_version: 1,
  is_internal_control: true,
  case_id: linkedCaseId,
  task_id: linkedTaskId,
  exact_scope_count: 1,
});

const linkedUpdatedPayload = casePayload({
  description: 'Atomic linked evidence updated',
  status: 'Mitigation in progress',
});
const linkedUpdate = await updateInternalCase({
  userId: ids.owner,
  operationId: operations.linkedUpdate,
  caseId: linkedCaseId,
  baseCaseVersion: 1,
  payload: linkedUpdatedPayload,
  caseLease: linkedCaseLease,
  ownerSession: sessions.owner,
  taskId: linkedTaskId,
  baseTaskVersion: 1,
  taskLease: linkedTaskLease,
});
assert.equal(Number(linkedUpdate.caseVersion), 2);
assert.equal(Number(linkedUpdate.taskVersion), 2);

const beforeRollback = await db.query(`
  select c.description, c.status, c.version,
         (select count(*)::integer from public.sd_internal_case_status_events e
           where e.workspace_id=c.workspace_id and e.case_id=c.id) as event_count
  from public.sd_internal_cases c
  where c.workspace_id='${ids.workspace}' and c.id='${linkedCaseId}'
`);
await assert.rejects(
  () => updateInternalCase({
    userId: ids.owner,
    operationId: operations.linkedRollback,
    caseId: linkedCaseId,
    baseCaseVersion: 2,
    payload: casePayload({ description: 'Partial write forbidden', status: 'Bad partial status' }),
    caseLease: linkedCaseLease,
    ownerSession: sessions.owner,
    taskId: linkedTaskId,
    baseTaskVersion: 1,
    taskLease: linkedTaskLease,
  }),
  /version-conflict/i,
  'a failed linked task CAS must abort the whole case transaction',
);
const afterRollback = await db.query(`
  select c.description, c.status, c.version,
         (select count(*)::integer from public.sd_internal_case_status_events e
           where e.workspace_id=c.workspace_id and e.case_id=c.id) as event_count
  from public.sd_internal_cases c
  where c.workspace_id='${ids.workspace}' and c.id='${linkedCaseId}'
`);
assert.deepEqual(afterRollback.rows[0], beforeRollback.rows[0]);

const cancelResult = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_cancel_internal_case(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,
      $8::bigint,$9,$10::uuid,$11::bigint
    ) as result`,
    [
      operations.linkedCancel,
      ids.workspace,
      linkedCaseId,
      2,
      `internal-case:${linkedCaseId}`,
      sessions.owner,
      linkedCaseLease.fencingToken,
      2,
      `task:${linkedTaskId}`,
      sessions.owner,
      linkedTaskLease.fencingToken,
    ],
  );
  return result.rows[0].result;
});
assert.equal(Number(cancelResult.caseVersion), 3);
assert.equal(Number(cancelResult.taskVersion), 3);

const cancelledEvidence = await db.query(`
  select c.is_closed, c.closed_by = '${ids.owner}'::uuid as server_actor,
         c.status, c.version,
         (select count(*)::integer from public.sd_internal_case_task_links l
           where l.workspace_id=c.workspace_id and l.case_id=c.id) as link_count,
         (select count(*)::integer from public.sd_internal_case_status_events e
           where e.workspace_id=c.workspace_id and e.case_id=c.id
             and e.status ilike '%FLOW%') as flow_event_count,
         t.is_internal_control, t.internal_control_cancelled_at is not null as task_cancelled,
         t.internal_control_cancelled_by = '${ids.owner}'::uuid as task_server_actor
  from public.sd_internal_cases c
  join public.sd_tasks t on t.workspace_id=c.workspace_id and t.id='${linkedTaskId}'
  where c.workspace_id='${ids.workspace}' and c.id='${linkedCaseId}'
`);
assert.equal(cancelledEvidence.rows[0].is_closed, true);
assert.equal(cancelledEvidence.rows[0].server_actor, true);
assert.match(cancelledEvidence.rows[0].status, /FLOW/i);
assert.equal(cancelledEvidence.rows[0].link_count, 0);
assert.equal(cancelledEvidence.rows[0].flow_event_count, 1);
assert.equal(cancelledEvidence.rows[0].is_internal_control, false);
assert.equal(cancelledEvidence.rows[0].task_cancelled, true);
assert.equal(cancelledEvidence.rows[0].task_server_actor, true);

await assert.rejects(
  () => updateInternalCase({
    userId: ids.owner,
    operationId: operations.closedCaseUpdate,
    caseId: linkedCaseId,
    baseCaseVersion: 3,
    payload: casePayload({ description: 'Closed evidence must be immutable' }),
    caseLease: linkedCaseLease,
    ownerSession: sessions.owner,
  }),
  /case-closed/i,
  'closed case content can only change through the dedicated reopen command',
);

const reopenResult = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_reopen_internal_case(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8,
      $9::bigint,$10,$11::uuid,$12::bigint
    ) as result`,
    [
      operations.linkedReopen,
      ids.workspace,
      linkedCaseId,
      3,
      `internal-case:${linkedCaseId}`,
      sessions.owner,
      linkedCaseLease.fencingToken,
      'Reopened investigation',
      null,
      null,
      null,
      null,
    ],
  );
  return result.rows[0].result;
});
assert.equal(Number(reopenResult.caseVersion), 4);
const reopened = await db.query(`
  select is_closed, closed_date, closed_by, status
  from public.sd_internal_cases
  where workspace_id='${ids.workspace}' and id='${linkedCaseId}'
`);
assert.deepEqual(reopened.rows[0], {
  is_closed: false,
  closed_date: null,
  closed_by: null,
  status: 'Reopened investigation',
});

const uniqueCaseId = 'case-unique';
const uniqueCaseLease = await claim(
  ids.owner,
  `internal-case:${uniqueCaseId}`,
  'internal-case',
  uniqueCaseId,
  sessions.owner,
);
await createInternalCase({
  userId: ids.owner,
  operationId: operations.uniqueCaseCreate,
  caseId: uniqueCaseId,
  payload: casePayload({ description: 'Link target case' }),
  caseLease: uniqueCaseLease,
  ownerSession: sessions.owner,
});
const existingTaskLease = await claim(
  ids.owner,
  'task:task-existing',
  'internal-task',
  'task-existing',
  sessions.owner,
);
const linkResult = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_link_internal_case_task(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,
      $8,$9::bigint,$10,$11::uuid,$12::bigint
    ) as result`,
    [
      operations.uniqueLink,
      ids.workspace,
      uniqueCaseId,
      1,
      `internal-case:${uniqueCaseId}`,
      sessions.owner,
      uniqueCaseLease.fencingToken,
      'task-existing',
      1,
      'task:task-existing',
      sessions.owner,
      existingTaskLease.fencingToken,
    ],
  );
  return result.rows[0].result;
});
assert.equal(Number(linkResult.caseVersion), 2);
assert.equal(Number(linkResult.taskVersion), 2);

const duplicateCaseId = 'case-duplicate-link';
const duplicateCaseLease = await claim(
  ids.owner,
  `internal-case:${duplicateCaseId}`,
  'internal-case',
  duplicateCaseId,
  sessions.owner,
);
await createInternalCase({
  userId: ids.owner,
  operationId: operations.duplicateCaseCreate,
  caseId: duplicateCaseId,
  payload: casePayload({ description: 'Must not steal a linked task' }),
  caseLease: duplicateCaseLease,
  ownerSession: sessions.owner,
});
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `select public.command_ship_dynamics_link_internal_case_task(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,
      $8,$9::bigint,$10,$11::uuid,$12::bigint
    )`,
    [
      operations.duplicateLink,
      ids.workspace,
      duplicateCaseId,
      1,
      `internal-case:${duplicateCaseId}`,
      sessions.owner,
      duplicateCaseLease.fencingToken,
      'task-existing',
      2,
      'task:task-existing',
      sessions.owner,
      existingTaskLease.fencingToken,
    ],
  )),
  /link-conflict/i,
  'one task cannot be linked to two internal cases',
);
const duplicateCase = await db.query(`
  select version, (select count(*)::integer from public.sd_internal_case_task_links l
    where l.workspace_id=c.workspace_id and l.case_id=c.id) as link_count
  from public.sd_internal_cases c
  where c.workspace_id='${ids.workspace}' and c.id='${duplicateCaseId}'
`);
assert.deepEqual(duplicateCase.rows[0], { version: 1, link_count: 0 });

const unlinkResult = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_unlink_internal_case_task(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,
      $8::bigint,$9,$10::uuid,$11::bigint
    ) as result`,
    [
      operations.uniqueUnlink,
      ids.workspace,
      uniqueCaseId,
      2,
      `internal-case:${uniqueCaseId}`,
      sessions.owner,
      uniqueCaseLease.fencingToken,
      2,
      'task:task-existing',
      sessions.owner,
      existingTaskLease.fencingToken,
    ],
  );
  return result.rows[0].result;
});
assert.equal(Number(unlinkResult.caseVersion), 3);
assert.equal(Number(unlinkResult.taskVersion), 3);
const unlinked = await db.query(`
  select c.is_closed, c.version,
         (select count(*)::integer from public.sd_internal_case_task_links l
           where l.workspace_id=c.workspace_id and l.case_id=c.id) as link_count,
         t.is_internal_control, t.internal_control_cancelled_at is not null as evidence_hidden
  from public.sd_internal_cases c
  join public.sd_tasks t on t.workspace_id=c.workspace_id and t.id='task-existing'
  where c.workspace_id='${ids.workspace}' and c.id='${uniqueCaseId}'
`);
assert.deepEqual(unlinked.rows[0], {
  is_closed: false,
  version: 3,
  link_count: 0,
  is_internal_control: false,
  evidence_hidden: true,
});

const deleteTaskCaseId = 'case-delete-linked-task';
const deleteTaskId = 'task-delete-linked';
const deleteTaskCaseLease = await claim(
  ids.owner,
  `internal-case:${deleteTaskCaseId}`,
  'internal-case',
  deleteTaskCaseId,
  sessions.owner,
);
const deleteTaskLease = await claim(
  ids.owner,
  `task:${deleteTaskId}`,
  'internal-task',
  deleteTaskId,
  sessions.owner,
);
await createInternalCase({
  userId: ids.owner,
  operationId: operations.deleteTaskCreate,
  caseId: deleteTaskCaseId,
  payload: casePayload({ description: 'Evidence survives task deletion' }),
  caseLease: deleteTaskCaseLease,
  ownerSession: sessions.owner,
  task: taskPayload(deleteTaskId),
  taskLease: deleteTaskLease,
});
const deleteTaskResult = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_delete_task_preserving_internal_case(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,
      $8,$9::bigint,$10,$11::uuid,$12::bigint
    ) as result`,
    [
      operations.deleteLinkedTask,
      ids.workspace,
      deleteTaskId,
      1,
      `task:${deleteTaskId}`,
      sessions.owner,
      deleteTaskLease.fencingToken,
      deleteTaskCaseId,
      1,
      `internal-case:${deleteTaskCaseId}`,
      sessions.owner,
      deleteTaskCaseLease.fencingToken,
    ],
  );
  return result.rows[0].result;
});
assert.equal(deleteTaskResult.casePreserved, true);
assert.equal(Number(deleteTaskResult.caseVersion), 2);
const preservedAfterTaskDelete = await db.query(`
  select c.is_closed, c.status, c.version,
         (select count(*)::integer from public.sd_tasks t
           where t.workspace_id=c.workspace_id and t.id='${deleteTaskId}') as task_count,
         (select count(*)::integer from public.sd_internal_case_task_links l
           where l.workspace_id=c.workspace_id and l.case_id=c.id) as link_count
  from public.sd_internal_cases c
  where c.workspace_id='${ids.workspace}' and c.id='${deleteTaskCaseId}'
`);
assert.equal(preservedAfterTaskDelete.rows[0].is_closed, true);
assert.match(preservedAfterTaskDelete.rows[0].status, /FLOW/i);
assert.equal(preservedAfterTaskDelete.rows[0].version, 2);
assert.equal(preservedAfterTaskDelete.rows[0].task_count, 0);
assert.equal(preservedAfterTaskDelete.rows[0].link_count, 0);

const hardDeleteCaseId = 'case-hard-delete';
const hardDeleteTaskId = 'task-hard-delete';
const hardDeleteCaseLease = await claim(
  ids.owner,
  `internal-case:${hardDeleteCaseId}`,
  'internal-case',
  hardDeleteCaseId,
  sessions.owner,
);
const hardDeleteTaskLease = await claim(
  ids.owner,
  `task:${hardDeleteTaskId}`,
  'internal-task',
  hardDeleteTaskId,
  sessions.owner,
);
await createInternalCase({
  userId: ids.owner,
  operationId: operations.hardDeleteCreate,
  caseId: hardDeleteCaseId,
  payload: casePayload({ description: 'Explicit delete target' }),
  caseLease: hardDeleteCaseLease,
  ownerSession: sessions.owner,
  task: taskPayload(hardDeleteTaskId),
  taskLease: hardDeleteTaskLease,
});
const hardDeleteResult = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_delete_internal_case(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,
      $8::bigint,$9,$10::uuid,$11::bigint
    ) as result`,
    [
      operations.hardDeleteCase,
      ids.workspace,
      hardDeleteCaseId,
      1,
      `internal-case:${hardDeleteCaseId}`,
      sessions.owner,
      hardDeleteCaseLease.fencingToken,
      1,
      `task:${hardDeleteTaskId}`,
      sessions.owner,
      hardDeleteTaskLease.fencingToken,
    ],
  );
  return result.rows[0].result;
});
assert.equal(hardDeleteResult.deleted, true);
assert.equal(hardDeleteResult.taskId, hardDeleteTaskId);
const hardDeleteCounts = await db.query(`
  select
    (select count(*)::integer from public.sd_internal_cases
      where workspace_id='${ids.workspace}' and id='${hardDeleteCaseId}') as case_count,
    (select count(*)::integer from public.sd_tasks
      where workspace_id='${ids.workspace}' and id='${hardDeleteTaskId}') as task_count,
    (select count(*)::integer from public.sd_internal_case_task_links
      where workspace_id='${ids.workspace}' and case_id='${hardDeleteCaseId}') as link_count
`);
assert.deepEqual(hardDeleteCounts.rows[0], { case_count: 0, task_count: 0, link_count: 0 });
const hardDeleteReplay = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_delete_internal_case(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,
      $8::bigint,$9,$10::uuid,$11::bigint
    ) as result`,
    [
      operations.hardDeleteCase,
      ids.workspace,
      hardDeleteCaseId,
      1,
      `internal-case:${hardDeleteCaseId}`,
      sessions.owner,
      hardDeleteCaseLease.fencingToken,
      1,
      `task:${hardDeleteTaskId}`,
      sessions.owner,
      hardDeleteTaskLease.fencingToken,
    ],
  );
  return result.rows[0].result;
});
assert.equal(hardDeleteReplay.replayed, true);

const delegateCaseId = 'case-delegate-scope';
const delegateCaseLease = await claim(
  ids.delegate,
  `internal-case:${delegateCaseId}`,
  'internal-case',
  delegateCaseId,
  sessions.delegate,
);
await createInternalCase({
  userId: ids.delegate,
  operationId: operations.delegateCreate,
  caseId: delegateCaseId,
  payload: casePayload({ vesselId: 'vessel-b', description: 'Delegated scope case' }),
  caseLease: delegateCaseLease,
  ownerSession: sessions.delegate,
});
assert.ok((await visibleIds(ids.delegate, 'sd_internal_cases')).includes(delegateCaseId));
assert.ok(!(await visibleIds(ids.operator, 'sd_internal_cases')).includes(delegateCaseId));

const deniedCaseId = 'case-operator-out-of-scope';
const deniedCaseLease = await claim(
  ids.operator,
  `internal-case:${deniedCaseId}`,
  'internal-case',
  deniedCaseId,
  sessions.operator,
);
await assert.rejects(
  () => createInternalCase({
    userId: ids.operator,
    operationId: operations.deniedOperatorCreate,
    caseId: deniedCaseId,
    payload: casePayload({ vesselId: 'vessel-b', description: 'Out of scope' }),
    caseLease: deniedCaseLease,
    ownerSession: sessions.operator,
  }),
  /not-authorized/i,
);

const activeHiddenCaseId = 'case-active-hidden';
const activeHiddenTaskId = 'task-active-hidden';
const activeHiddenCaseLease = await claim(
  ids.owner,
  `internal-case:${activeHiddenCaseId}`,
  'internal-case',
  activeHiddenCaseId,
  sessions.owner,
);
const activeHiddenTaskLease = await claim(
  ids.owner,
  `task:${activeHiddenTaskId}`,
  'internal-task',
  activeHiddenTaskId,
  sessions.owner,
);
await createInternalCase({
  userId: ids.owner,
  operationId: operations.activeHiddenCreate,
  caseId: activeHiddenCaseId,
  payload: casePayload({ description: 'Active hidden task evidence' }),
  caseLease: activeHiddenCaseLease,
  ownerSession: sessions.owner,
  task: taskPayload(activeHiddenTaskId),
  taskLease: activeHiddenTaskLease,
});

assert.ok((await visibleIds(ids.owner, 'sd_internal_cases')).includes(activeHiddenCaseId));
assert.ok((await visibleIds(ids.admin, 'sd_internal_cases')).includes(delegateCaseId));
assert.ok((await visibleIds(ids.operator, 'sd_internal_cases')).includes(activeHiddenCaseId));

const vesselVisibility = await asUser(ids.vessel, async () => {
  const result = await db.query(`
    select
      (select count(*)::integer from public.sd_internal_cases) as cases,
      (select count(*)::integer from public.sd_internal_case_departments) as departments,
      (select count(*)::integer from public.sd_internal_case_status_events) as events,
      (select count(*)::integer from public.sd_internal_case_task_links) as links,
      (select count(*)::integer from public.sd_tasks
        where id in ('${activeHiddenTaskId}','${linkedTaskId}','task-existing')) as internal_or_evidence_tasks,
      (select count(*)::integer from public.sd_task_categories
        where task_id in ('${activeHiddenTaskId}','${linkedTaskId}','task-existing')) as task_categories,
      (select count(*)::integer from public.sd_task_departments
        where task_id in ('${activeHiddenTaskId}','${linkedTaskId}','task-existing')) as task_departments,
      (select count(*)::integer from public.sd_task_owners
        where task_id in ('${activeHiddenTaskId}','${linkedTaskId}','task-existing')) as task_owners,
      (select count(*)::integer from public.sd_operations) as operations
  `);
  return result.rows[0];
});
assert.deepEqual(vesselVisibility, {
  cases: 0,
  departments: 0,
  events: 0,
  links: 0,
  internal_or_evidence_tasks: 0,
  task_categories: 0,
  task_departments: 0,
  task_owners: 0,
  operations: 0,
});

for (const [caseId, operationId] of [
  [activeHiddenCaseId, operations.vesselExistingProbe],
  ['case-does-not-exist', operations.vesselMissingProbe],
]) {
  await assert.rejects(
    () => asUser(ids.vessel, () => db.query(
      `select public.command_ship_dynamics_update_internal_case(
        $1::uuid,$2::uuid,$3,1,$4,$5::uuid,1,$6::jsonb,
        null,null,null,null
      )`,
      [
        operationId,
        ids.workspace,
        caseId,
        `internal-case:${caseId}`,
        sessions.vessel,
        JSON.stringify(casePayload({ description: 'Probe' })),
      ],
    )),
    /not-authorized/i,
    'vessel RPC errors must not distinguish existing from missing internal cases',
  );
  await assert.rejects(
    () => asUser(ids.vessel, () => db.query(
      `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,'internal-case',$3,$4::uuid,75)`,
      [ids.workspace, `internal-case:${caseId}`, caseId, sessions.vessel],
    )),
    /not-authorized/i,
    'vessel lease errors must not disclose internal-case existence',
  );
}

await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `update public.sd_internal_cases set description='bypass' where id='${standaloneCaseId}'`,
  )),
  /permission denied/i,
);
await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `delete from public.sd_internal_case_task_links where task_id='${activeHiddenTaskId}'`,
  )),
  /permission denied/i,
);
await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `insert into public.sd_internal_case_status_events(
      workspace_id,id,case_id,event_kind,status,actor_id
    ) values (
      '${ids.workspace}','f1000000-0000-4000-8000-000000000001',
      '${standaloneCaseId}','forged','forged','${ids.operator}'
    )`,
  )),
  /permission denied/i,
);
await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `update public.sd_tasks set is_internal_control=false where id='${activeHiddenTaskId}'`,
  )),
  /permission denied/i,
);

const operationLedger = await db.query(`
  select count(*)::integer as committed_operations,
         count(*) filter (where actor_id='${ids.vessel}'::uuid)::integer as vessel_internal_operations
  from public.sd_operations
  where workspace_id='${ids.workspace}'
    and command like '%internal%'
`);
assert.equal(operationLedger.rows[0].committed_operations > 0, true);
assert.equal(operationLedger.rows[0].vessel_internal_operations, 0);

console.log('normalized_internal_control_db=PASS');
console.log(`committed_internal_operations=${operationLedger.rows[0].committed_operations}`);

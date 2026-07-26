import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();

const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  operator: '33333333-3333-4333-8333-333333333333',
  operator2: '44444444-4444-4444-8444-444444444444',
  vessel: '55555555-5555-4555-8555-555555555555',
  outsider: '66666666-6666-4666-8666-666666666666',
};

const sessions = {
  owner: 'a0000000-0000-4000-8000-000000000001',
  admin: 'a0000000-0000-4000-8000-000000000002',
  operator: 'a0000000-0000-4000-8000-000000000003',
  operator2: 'a0000000-0000-4000-8000-000000000004',
  vessel: 'a0000000-0000-4000-8000-000000000005',
};

let operationSequence = 0;
const operationId = () =>
  `f0000000-0000-4000-8000-${String(++operationSequence).padStart(12, '0')}`;

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
    language sql immutable as $$
      select '$2b$12$00000000000000000000000000000000000000000000000000000'
    $$;
  create function extensions.crypt(value text, salt text) returns text
    language sql immutable as $$
      select '$2b$12$' || substring(
        encode(sha256(convert_to(value,'UTF8')),'hex') from 1 for 53
      )
    $$;
`);

for (const relative of [
  'supabase/normalized-schema.sql',
  'supabase/normalized-core-domain.sql',
  'supabase/normalized-meeting.sql',
  'supabase/normalized-internal-control.sql',
  'supabase/normalized-security-dispatch.sql',
  'supabase/normalized-auth-orchestration.sql',
  'supabase/normalized-app-contract.sql',
]) {
  await db.exec(await readFile(resolve(root, relative), 'utf8'));
}

await db.exec(`
  insert into auth.users(id,email) values
    ('${ids.owner}','owner@internal.invalid'),
    ('${ids.admin}','admin@internal.invalid'),
    ('${ids.operator}','operator@internal.invalid'),
    ('${ids.operator2}','operator2@internal.invalid'),
    ('${ids.vessel}','vessel@internal.invalid'),
    ('${ids.outsider}','outsider@internal.invalid');

  insert into public.sd_workspaces(id,legacy_key,name)
  values('${ids.workspace}','app-contract','App Contract');

  insert into public.sd_profiles(id,display_name,username_label) values
    ('${ids.owner}','Owner','owner'),
    ('${ids.admin}','Admin','admin'),
    ('${ids.operator}','Operator One','operator-one'),
    ('${ids.operator2}','Operator Two','operator-two'),
    ('${ids.vessel}','Vessel Account','vessel-account'),
    ('${ids.outsider}','Outsider','outsider');

  insert into public.sd_memberships(
    workspace_id,user_id,department,role,is_active
  ) values
    ('${ids.workspace}','${ids.owner}','Management','owner',true),
    ('${ids.workspace}','${ids.admin}','Management','admin',true),
    ('${ids.workspace}','${ids.operator}','Operations','operator',true),
    ('${ids.workspace}','${ids.operator2}','Safety','operator',true),
    ('${ids.workspace}','${ids.vessel}','Vessel','vessel',true);

  insert into public.sd_login_options(
    workspace_id,user_id,department,username_label,display_name,auth_alias,is_active
  ) values
    ('${ids.workspace}','${ids.owner}','Management','owner','Owner','owner-alias@internal.invalid',true),
    ('${ids.workspace}','${ids.admin}','Management','admin','Admin','admin-alias@internal.invalid',true),
    ('${ids.workspace}','${ids.operator}','Operations','operator-one','Operator One','operator-one-alias@internal.invalid',true),
    ('${ids.workspace}','${ids.operator2}','Safety','operator-two','Operator Two','operator-two-alias@internal.invalid',true),
    ('${ids.workspace}','${ids.vessel}','Vessel','vessel-account','Vessel Account','vessel-alias@internal.invalid',true);

  insert into public.sd_vessels(
    workspace_id,id,name,short_name,full_name,ship_type,fleet_category,
    position,cargo,note,is_active,created_by,updated_by
  ) values
    ('${ids.workspace}','v1','Vessel One','V1','Vessel One','bulk','bulk fleet',
      '{}','{}','{}',true,'${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','v2','Vessel Two','V2','Vessel Two','tanker','tanker fleet',
      '{}','{}','{}',true,'${ids.owner}','${ids.owner}');

  insert into public.sd_vessel_assignments(
    workspace_id,vessel_id,user_id,assignment_kind,is_active,updated_by
  ) values
    ('${ids.workspace}','v1','${ids.operator}','manager',true,'${ids.owner}'),
    ('${ids.workspace}','v2','${ids.operator2}','manager',true,'${ids.owner}'),
    ('${ids.workspace}','v1','${ids.vessel}','vessel_account',true,'${ids.owner}');

  insert into public.sd_tasks(
    workspace_id,id,description,status,priority,source_kind,source_type,
    attention_dimension,is_internal_control,is_abnormal,is_aware,is_closed,
    expected_date,report_date,category,version,created_by,updated_by
  ) values
    ('${ids.workspace}','task-to-case','Task becomes internal','Open','中',
      'ordinary','morning','task',false,false,false,false,
      '2026-08-15','2026-07-26','Safety',1,'${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','task-conflict','Conflict task','Open','中',
      'ordinary','morning','task',false,false,false,false,
      '2026-08-15','2026-07-26','Safety',1,'${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','task-existing','Existing target','Open','中',
      'ordinary','morning','task',false,false,false,false,
      '2026-08-15','2026-07-26','Safety',1,'${ids.owner}','${ids.owner}');

  insert into public.sd_task_vessels(
    workspace_id,task_id,vessel_id,is_active_scope,status,is_closed,version,updated_by
  ) values
    ('${ids.workspace}','task-to-case','v1',true,'Open',false,1,'${ids.owner}'),
    ('${ids.workspace}','task-conflict','v1',true,'Open',false,1,'${ids.owner}'),
    ('${ids.workspace}','task-existing','v1',true,'Open',false,1,'${ids.owner}');

  insert into public.sd_task_categories(workspace_id,task_id,category,ordinal)
  values
    ('${ids.workspace}','task-to-case','Safety',0),
    ('${ids.workspace}','task-conflict','Safety',0),
    ('${ids.workspace}','task-existing','Safety',0);
  insert into public.sd_task_departments(workspace_id,task_id,department,ordinal)
  values
    ('${ids.workspace}','task-to-case','Operations',0),
    ('${ids.workspace}','task-conflict','Operations',0),
    ('${ids.workspace}','task-existing','Operations',0);
  insert into public.sd_task_owners(workspace_id,task_id,owner_id,ordinal)
  values
    ('${ids.workspace}','task-to-case','${ids.operator}',0),
    ('${ids.workspace}','task-conflict','${ids.operator}',0),
    ('${ids.workspace}','task-existing','${ids.operator}',0);

  insert into public.sd_internal_cases(
    workspace_id,id,vessel_id,report_date,report_source,description,priority,
    category,is_aware,status,origin,is_closed,version,created_by,updated_by
  ) values (
    '${ids.workspace}','case-to-task','v1','2026-07-26','日常',
    'Case becomes linked','中','Safety',false,'Open','internal-control',
    false,1,'${ids.owner}','${ids.owner}'
  );
  insert into public.sd_internal_case_departments(
    workspace_id,case_id,department,ordinal
  ) values ('${ids.workspace}','case-to-task','Operations',0);
  insert into public.sd_internal_case_status_events(
    workspace_id,id,case_id,event_kind,status,actor_id
  ) values (
    '${ids.workspace}','e0000000-0000-4000-8000-000000000001',
    'case-to-task','created','Open','${ids.owner}'
  );
`);

async function asUser(userId, action) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${userId}'`);
  try {
    return await action();
  } finally {
    await db.exec('reset role; reset request.jwt.claim.sub');
  }
}

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function claim(userId, entityType, entityId, session) {
  const leaseKey = entityType === 'internal-task'
    ? `task:${entityId}`
    : `${entityType}:${entityId}`;
  return asUser(userId, () => scalar(
    `select public.claim_ship_dynamics_entity_lease(
      $1::uuid,$2,$3,$4,$5::uuid,75
    )`,
    [ids.workspace, leaseKey, entityType, entityId, session],
  ));
}

async function reserve(userId, operation, command, target, request) {
  return asUser(userId, () => scalar(
    `select public.reserve_ship_dynamics_operation(
      $1::uuid,$2::uuid,$3,$4,$5::jsonb
    )`,
    [ids.workspace, operation, command, target, JSON.stringify(request)],
  ));
}

async function operationStatus(userId, operation) {
  return asUser(userId, () => scalar(
    `select public.get_ship_dynamics_operation_status($1::uuid,$2::uuid)`,
    [ids.workspace, operation],
  ));
}

// Durable reservation semantics and the manual-attention command.
const attentionLease = await claim(
  ids.operator,
  'vessel',
  'v1',
  sessions.operator,
);
const attentionOperation = operationId();
const attentionRequest = {
  vesselId: 'v1',
  baseVersion: 1,
  leaseKey: 'vessel:v1',
  ownerSession: sessions.operator,
  fencingToken: Number(attentionLease.fencingToken),
  manualAttentionLevel: '特別關注',
};
const attentionReserved = await reserve(
  ids.operator,
  attentionOperation,
  'update_vessel_manual_attention',
  'vessel:v1',
  attentionRequest,
);
assert.equal(attentionReserved.status, 'prepared');
assert.equal(attentionReserved.replayed, false);
assert.equal(
  (await operationStatus(ids.operator, attentionOperation)).status,
  'prepared',
);
assert.equal(
  await operationStatus(ids.outsider, attentionOperation),
  null,
  'operation status must not leak another actor or workspace existence',
);
const attentionResult = await asUser(ids.operator, () => scalar(
  `select public.command_ship_dynamics_update_vessel_manual_attention(
    $1::uuid,$2::uuid,'v1',1,'vessel:v1',$3::uuid,$4::bigint,'特別關注'
  )`,
  [
    attentionOperation,
    ids.workspace,
    sessions.operator,
    attentionLease.fencingToken,
  ],
));
assert.equal(attentionResult.status, 'committed');
assert.equal(Number(attentionResult.version), 2);
assert.equal(
  await scalar(`
    select manual_attention_level
    from public.sd_vessels
    where workspace_id=$1::uuid and id='v1'
  `, [ids.workspace]),
  '特別關注',
);
assert.equal(
  (await operationStatus(ids.operator, attentionOperation)).status,
  'committed',
);
const attentionReplay = await asUser(ids.operator, () => scalar(
  `select public.command_ship_dynamics_update_vessel_manual_attention(
    $1::uuid,$2::uuid,'v1',1,'vessel:v1',$3::uuid,$4::bigint,'特別關注'
  )`,
  [
    attentionOperation,
    ids.workspace,
    sessions.operator,
    attentionLease.fencingToken,
  ],
));
assert.equal(attentionReplay.replayed, true);
await assert.rejects(
  () => reserve(
    ids.operator,
    attentionOperation,
    'update_vessel_manual_attention',
    'vessel:v1',
    { ...attentionRequest, manualAttentionLevel: '高' },
  ),
  /operation-mismatch/i,
);

const preparedOnlyOperation = operationId();
const preparedOnlyRequest = {
  ...attentionRequest,
  baseVersion: 2,
  manualAttentionLevel: '',
};
await reserve(
  ids.operator,
  preparedOnlyOperation,
  'update_vessel_manual_attention',
  'vessel:v1',
  preparedOnlyRequest,
);
const preparedRetry = await reserve(
  ids.operator,
  preparedOnlyOperation,
  'update_vessel_manual_attention',
  'vessel:v1',
  preparedOnlyRequest,
);
assert.deepEqual(
  { status: preparedRetry.status, replayed: preparedRetry.replayed },
  { status: 'prepared', replayed: true },
  'a lost reserve response remains prepared and safe to retry',
);

const mismatchedCommandOperation = operationId();
await reserve(
  ids.operator,
  mismatchedCommandOperation,
  'update_vessel_manual_attention',
  'vessel:v1',
  { ...preparedOnlyRequest, manualAttentionLevel: '高' },
);
await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `select public.command_ship_dynamics_update_vessel_manual_attention(
      $1::uuid,$2::uuid,'v1',2,'vessel:v1',$3::uuid,$4::bigint,'低'
    )`,
    [
      mismatchedCommandOperation,
      ids.workspace,
      sessions.operator,
      attentionLease.fencingToken,
    ],
  )),
  /operation-mismatch/i,
);
assert.deepEqual(
  (await db.query(`
    select version,manual_attention_level as "attention"
    from public.sd_vessels
    where workspace_id='${ids.workspace}' and id='v1'
  `)).rows[0],
  { version: 2, attention: '特別關注' },
  'reservation mismatch must roll back the attempted business update',
);

const rejectedOperation = operationId();
const rejectedRequest = {
  ...preparedOnlyRequest,
  manualAttentionLevel: '急',
};
await reserve(
  ids.operator,
  rejectedOperation,
  'update_vessel_manual_attention',
  'vessel:v1',
  rejectedRequest,
);
await asUser(ids.operator, () => scalar(
  `select public.reject_ship_dynamics_operation_reservation(
    $1::uuid,$2::uuid,'definitive-rpc-error'
  )`,
  [ids.workspace, rejectedOperation],
));
assert.equal(
  (await operationStatus(ids.operator, rejectedOperation)).status,
  'rejected',
);
await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `select public.command_ship_dynamics_update_vessel_manual_attention(
      $1::uuid,$2::uuid,'v1',2,'vessel:v1',$3::uuid,$4::bigint,'急'
    )`,
    [
      rejectedOperation,
      ids.workspace,
      sessions.operator,
      attentionLease.fencingToken,
    ],
  )),
  /operation-reservation-rejected/i,
);
assert.equal(
  Number(await scalar(`
    select version from public.sd_vessels
    where workspace_id=$1::uuid and id='v1'
  `, [ids.workspace])),
  2,
);
await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `select * from public.sd_operation_reservations
     where workspace_id=$1::uuid`,
    [ids.workspace],
  )),
  /permission denied/i,
  'reservation rows are never browser-readable',
);

await assert.rejects(
  () => claim(ids.vessel, 'vessel', 'v1', sessions.vessel),
  /not-authorized/i,
  'vessel accounts cannot mutate manual attention',
);

// User lease routing and one transactional non-owner management command.
await assert.rejects(
  () => claim(ids.admin, 'user', ids.owner, sessions.admin),
  /not-authorized/i,
  'Admin cannot inspect or lease the Owner through generic user management',
);
await assert.rejects(
  () => claim(ids.owner, 'user', ids.owner, sessions.owner),
  /not-authorized/i,
  'the Owner record also stays outside the generic non-owner path',
);
await assert.rejects(
  () => claim(ids.operator, 'user', ids.operator2, sessions.operator),
  /not-authorized/i,
);

const userLease = await claim(ids.admin, 'user', ids.operator, sessions.admin);
const userOperation = operationId();
const userPayload = {
  displayName: 'Operator One Updated',
  usernameLabel: 'operator-one-updated',
  department: 'Safety',
  role: 'operator',
  isActive: true,
  vesselAssignments: [
    { vesselId: 'v1', assignmentKind: 'delegate' },
    { vesselId: 'v2', assignmentKind: 'manager' },
  ],
};
const userRequest = {
  userId: ids.operator,
  baseMembershipVersion: 1,
  leaseKey: `user:${ids.operator}`,
  ownerSession: sessions.admin,
  fencingToken: Number(userLease.fencingToken),
  user: userPayload,
};
await reserve(
  ids.admin,
  userOperation,
  'update_user',
  `user:${ids.operator}`,
  userRequest,
);
const userResult = await asUser(ids.admin, () => scalar(
  `select public.command_ship_dynamics_update_user(
    $1::uuid,$2::uuid,$3::uuid,1,$4,$5::uuid,$6::bigint,$7::jsonb
  )`,
  [
    userOperation,
    ids.workspace,
    ids.operator,
    `user:${ids.operator}`,
    sessions.admin,
    userLease.fencingToken,
    JSON.stringify(userPayload),
  ],
));
assert.equal(Number(userResult.membershipVersion), 2);
assert.deepEqual(
  (await db.query(`
    select p.display_name as "displayName",p.username_label as "usernameLabel",
      m.department,m.role,m.is_active as "isActive",m.version,
      l.auth_alias as "authAlias",l.display_name as "loginDisplayName",
      l.username_label as "loginUsernameLabel",l.department as "loginDepartment"
    from public.sd_profiles p
    join public.sd_memberships m on m.user_id=p.id
    join public.sd_login_options l
      on l.workspace_id=m.workspace_id and l.user_id=m.user_id
    where m.workspace_id='${ids.workspace}' and m.user_id='${ids.operator}'
  `)).rows[0],
  {
    displayName: 'Operator One Updated',
    usernameLabel: 'operator-one-updated',
    department: 'Safety',
    role: 'operator',
    isActive: true,
    version: 2,
    authAlias: 'operator-one-alias@internal.invalid',
    loginDisplayName: 'Operator One Updated',
    loginUsernameLabel: 'operator-one-updated',
    loginDepartment: 'Safety',
  },
);
assert.deepEqual(
  (await db.query(`
    select vessel_id as "vesselId",assignment_kind as "kind",is_active as "active"
    from public.sd_vessel_assignments
    where workspace_id='${ids.workspace}' and user_id='${ids.operator}'
      and assignment_kind in ('manager','delegate')
    order by vessel_id,assignment_kind
  `)).rows,
  [
    { vesselId: 'v1', kind: 'delegate', active: true },
    { vesselId: 'v1', kind: 'manager', active: false },
    { vesselId: 'v2', kind: 'manager', active: true },
  ],
);

const ownerRoleOperation = operationId();
const ownerRolePayload = { ...userPayload, role: 'owner' };
await reserve(
  ids.admin,
  ownerRoleOperation,
  'update_user',
  `user:${ids.operator}`,
  { ...userRequest, baseMembershipVersion: 2, user: ownerRolePayload },
);
await assert.rejects(
  () => asUser(ids.admin, () => db.query(
    `select public.command_ship_dynamics_update_user(
      $1::uuid,$2::uuid,$3::uuid,2,$4,$5::uuid,$6::bigint,$7::jsonb
    )`,
    [
      ownerRoleOperation,
      ids.workspace,
      ids.operator,
      `user:${ids.operator}`,
      sessions.admin,
      userLease.fencingToken,
      JSON.stringify(ownerRolePayload),
    ],
  )),
  /invalid-user-role/i,
  'generic user updates can never assign Owner',
);

// Existing ordinary task -> new linked case.
const taskToCaseCaseId = 'case-from-task';
const taskToCaseCaseLease = await claim(
  ids.owner,
  'internal-case',
  taskToCaseCaseId,
  sessions.owner,
);
const taskToCaseTaskLease = await claim(
  ids.owner,
  'internal-task',
  'task-to-case',
  sessions.owner,
);
const taskToCasePayload = {
  vesselId: 'v1',
  reportDate: '2026-07-26',
  reportSource: '日常',
  description: 'Task becomes internal',
  priority: '中',
  category: 'Safety',
  isAware: false,
  status: 'Open',
  origin: 'task',
  isClosed: false,
  departments: ['Operations'],
};
const taskToCaseOperation = operationId();
const taskToCaseRequest = {
  caseId: taskToCaseCaseId,
  taskId: 'task-to-case',
  baseTaskVersion: 1,
  caseLeaseKey: `internal-case:${taskToCaseCaseId}`,
  caseOwnerSession: sessions.owner,
  caseFencingToken: Number(taskToCaseCaseLease.fencingToken),
  taskLeaseKey: 'task:task-to-case',
  taskOwnerSession: sessions.owner,
  taskFencingToken: Number(taskToCaseTaskLease.fencingToken),
  case: taskToCasePayload,
};
await reserve(
  ids.owner,
  taskToCaseOperation,
  'create_internal_case_from_task',
  `internal-case:${taskToCaseCaseId}`,
  taskToCaseRequest,
);
const taskToCaseResult = await asUser(ids.owner, () => scalar(
  `select public.command_ship_dynamics_create_internal_case_from_task(
    $1::uuid,$2::uuid,$3,$4,1,$5,$6::uuid,$7::bigint,
    $8,$9::uuid,$10::bigint,$11::jsonb
  )`,
  [
    taskToCaseOperation,
    ids.workspace,
    taskToCaseCaseId,
    'task-to-case',
    `internal-case:${taskToCaseCaseId}`,
    sessions.owner,
    taskToCaseCaseLease.fencingToken,
    'task:task-to-case',
    sessions.owner,
    taskToCaseTaskLease.fencingToken,
    JSON.stringify(taskToCasePayload),
  ],
));
assert.deepEqual(
  {
    status: taskToCaseResult.status,
    caseVersion: Number(taskToCaseResult.caseVersion),
    taskVersion: Number(taskToCaseResult.taskVersion),
  },
  { status: 'committed', caseVersion: 1, taskVersion: 2 },
);
assert.deepEqual(
  (await db.query(`
    select c.origin,c.version as "caseVersion",t.is_internal_control as "internal",
      t.version as "taskVersion",l.task_id as "taskId"
    from public.sd_internal_cases c
    join public.sd_internal_case_task_links l
      on l.workspace_id=c.workspace_id and l.case_id=c.id
    join public.sd_tasks t
      on t.workspace_id=l.workspace_id and t.id=l.task_id
    where c.workspace_id='${ids.workspace}' and c.id='${taskToCaseCaseId}'
  `)).rows[0],
  {
    origin: 'task',
    caseVersion: 1,
    internal: true,
    taskVersion: 2,
    taskId: 'task-to-case',
  },
);

const secondCaseId = 'case-from-linked-task-conflict';
const secondCaseLease = await claim(
  ids.owner,
  'internal-case',
  secondCaseId,
  sessions.owner,
);
const linkedConflictOperation = operationId();
const linkedConflictRequest = {
  ...taskToCaseRequest,
  caseId: secondCaseId,
  baseTaskVersion: 2,
  caseLeaseKey: `internal-case:${secondCaseId}`,
  caseFencingToken: Number(secondCaseLease.fencingToken),
};
await reserve(
  ids.owner,
  linkedConflictOperation,
  'create_internal_case_from_task',
  `internal-case:${secondCaseId}`,
  linkedConflictRequest,
);
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `select public.command_ship_dynamics_create_internal_case_from_task(
      $1::uuid,$2::uuid,$3,$4,2,$5,$6::uuid,$7::bigint,
      $8,$9::uuid,$10::bigint,$11::jsonb
    )`,
    [
      linkedConflictOperation,
      ids.workspace,
      secondCaseId,
      'task-to-case',
      `internal-case:${secondCaseId}`,
      sessions.owner,
      secondCaseLease.fencingToken,
      'task:task-to-case',
      sessions.owner,
      taskToCaseTaskLease.fencingToken,
      JSON.stringify(taskToCasePayload),
    ],
  )),
  /link-conflict/i,
);
assert.equal(
  Number(await scalar(`
    select count(*) from public.sd_internal_cases
    where workspace_id=$1::uuid and id=$2
  `, [ids.workspace, secondCaseId])),
  0,
  'a link conflict leaves no partial case',
);

// Existing unlinked case -> new linked task.
const caseToTaskCaseLease = await claim(
  ids.owner,
  'internal-case',
  'case-to-task',
  sessions.owner,
);
const caseToTaskTaskLease = await claim(
  ids.owner,
  'internal-task',
  'task-from-case',
  sessions.owner,
);
const caseToTaskMetadata = {
  id: 'task-from-case',
  expectedDate: '2026-08-20',
  categories: ['Safety'],
  ownerUserIds: [ids.operator],
};
const caseToTaskOperation = operationId();
const caseToTaskRequest = {
  caseId: 'case-to-task',
  baseCaseVersion: 1,
  taskId: 'task-from-case',
  caseLeaseKey: 'internal-case:case-to-task',
  caseOwnerSession: sessions.owner,
  caseFencingToken: Number(caseToTaskCaseLease.fencingToken),
  taskLeaseKey: 'task:task-from-case',
  taskOwnerSession: sessions.owner,
  taskFencingToken: Number(caseToTaskTaskLease.fencingToken),
  task: caseToTaskMetadata,
};
await reserve(
  ids.owner,
  caseToTaskOperation,
  'create_task_from_internal_case',
  'internal-case:case-to-task',
  caseToTaskRequest,
);
const caseToTaskResult = await asUser(ids.owner, () => scalar(
  `select public.command_ship_dynamics_create_task_from_internal_case(
    $1::uuid,$2::uuid,'case-to-task',1,'task-from-case',
    'internal-case:case-to-task',$3::uuid,$4::bigint,
    'task:task-from-case',$3::uuid,$5::bigint,$6::jsonb
  )`,
  [
    caseToTaskOperation,
    ids.workspace,
    sessions.owner,
    caseToTaskCaseLease.fencingToken,
    caseToTaskTaskLease.fencingToken,
    JSON.stringify(caseToTaskMetadata),
  ],
));
assert.equal(Number(caseToTaskResult.caseVersion), 2);
assert.equal(Number(caseToTaskResult.taskVersion), 1);
assert.equal(
  Number(await scalar(`
    select count(*) from public.sd_internal_case_task_links
    where workspace_id=$1::uuid and case_id='case-to-task'
      and task_id='task-from-case'
  `, [ids.workspace])),
  1,
);

const conflictTaskLease = await claim(
  ids.owner,
  'internal-task',
  'task-existing',
  sessions.owner,
);
const createTaskConflictOperation = operationId();
const createTaskConflictMetadata = {
  ...caseToTaskMetadata,
  id: 'task-existing',
};
const createTaskConflictRequest = {
  ...caseToTaskRequest,
  baseCaseVersion: 2,
  taskId: 'task-existing',
  taskLeaseKey: 'task:task-existing',
  taskFencingToken: Number(conflictTaskLease.fencingToken),
  task: createTaskConflictMetadata,
};
await reserve(
  ids.owner,
  createTaskConflictOperation,
  'create_task_from_internal_case',
  'internal-case:case-to-task',
  createTaskConflictRequest,
);
const beforeConflict = (await db.query(`
  select c.version,
    (select count(*)::integer from public.sd_internal_case_status_events e
      where e.workspace_id=c.workspace_id and e.case_id=c.id) as "events"
  from public.sd_internal_cases c
  where c.workspace_id='${ids.workspace}' and c.id='case-to-task'
`)).rows[0];
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `select public.command_ship_dynamics_create_task_from_internal_case(
      $1::uuid,$2::uuid,'case-to-task',2,'task-existing',
      'internal-case:case-to-task',$3::uuid,$4::bigint,
      'task:task-existing',$3::uuid,$5::bigint,$6::jsonb
    )`,
    [
      createTaskConflictOperation,
      ids.workspace,
      sessions.owner,
      caseToTaskCaseLease.fencingToken,
      conflictTaskLease.fencingToken,
      JSON.stringify(createTaskConflictMetadata),
    ],
  )),
  /link-conflict|entity-exists/i,
);
assert.deepEqual(
  (await db.query(`
    select c.version,
      (select count(*)::integer from public.sd_internal_case_status_events e
        where e.workspace_id=c.workspace_id and e.case_id=c.id) as "events"
    from public.sd_internal_cases c
    where c.workspace_id='${ids.workspace}' and c.id='case-to-task'
  `)).rows[0],
  beforeConflict,
  'failed case-to-task creation rolls back all case/history changes',
);

// Meeting-generated task notifications and append-only status-event correction.
const meetingId = 'meeting-contract';
const meetingLease = await claim(
  ids.owner,
  'meeting',
  meetingId,
  sessions.owner,
);
const meetingItems = [{
  id: 'meeting-item-1',
  description: 'Meeting linked work',
  categories: ['Safety'],
  distributeToVessels: true,
}];
const meetingCreateOperation = operationId();
const meetingCreateRequest = {
  meetingId,
  leaseKey: `meeting:${meetingId}`,
  ownerSession: sessions.owner,
  fencingToken: Number(meetingLease.fencingToken),
  scopeMode: 'vessels',
  subject: 'Contract meeting',
  status: '追蹤中',
  meetingDate: '2026-07-26',
  vesselIds: ['v1'],
  vesselTypeScopes: [],
  departments: ['Operations'],
  participantUserIds: [ids.owner],
  trackingUserIds: [ids.owner],
  responsibleUserIds: [ids.admin],
  reason: 'Contract verification',
  resolution: 'Pending execution',
  expectedDate: '2026-08-30',
  completedDate: null,
  priority: '中',
  isAbnormal: false,
  isInternalControl: false,
  includeInMorning: true,
  items: meetingItems,
};
await reserve(
  ids.owner,
  meetingCreateOperation,
  'create_meeting',
  `meeting:${meetingId}`,
  meetingCreateRequest,
);
const meetingCreated = await asUser(ids.owner, () => scalar(
  `select public.command_ship_dynamics_create_meeting(
    $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,
    'vessels','Contract meeting','追蹤中','2026-07-26'::date,
    array['v1']::text[],'{}'::text[],array['Operations']::text[],
    array[$7::uuid]::uuid[],array[$7::uuid]::uuid[],array[$8::uuid]::uuid[],
    'Contract verification','Pending execution','2026-08-30'::date,null,
    '中',false,false,true,$9::jsonb
  )`,
  [
    meetingCreateOperation,
    ids.workspace,
    meetingId,
    meetingLease.fencingToken,
    `meeting:${meetingId}`,
    sessions.owner,
    ids.owner,
    ids.admin,
    JSON.stringify(meetingItems),
  ],
));
assert.equal(meetingCreated.status, 'committed');
const meetingTaskId = `meeting-task:${meetingId}:meeting-item-1`;
const createdNotices = await db.query(`
  select recipient_id::text as "recipientId",vessel_id as "vesselId",kind
  from public.sd_notifications
  where workspace_id='${ids.workspace}' and task_id='${meetingTaskId}'
    and kind='task_created'
  order by recipient_id,vessel_id
`);
assert.deepEqual(createdNotices.rows, [
  { recipientId: ids.operator, vesselId: 'v1', kind: 'task_created' },
  { recipientId: ids.vessel, vesselId: 'v1', kind: 'task_created' },
]);

const meetingTaskLease = await claim(
  ids.owner,
  'task',
  meetingTaskId,
  sessions.owner,
);
const updateItems = [{
  ...meetingItems[0],
  description: 'Meeting linked work updated',
}];
const taskGuards = [{
  taskId: meetingTaskId,
  baseVersion: 1,
  leaseKey: `task:${meetingTaskId}`,
  ownerSession: sessions.owner,
  fencingToken: Number(meetingTaskLease.fencingToken),
}];
const meetingUpdateOperation = operationId();
const meetingUpdateRequest = {
  ...meetingCreateRequest,
  baseVersion: 1,
  subject: 'Contract meeting updated',
  vesselIds: ['v1', 'v2'],
  items: updateItems,
  taskGuards,
};
await reserve(
  ids.owner,
  meetingUpdateOperation,
  'update_meeting',
  `meeting:${meetingId}`,
  meetingUpdateRequest,
);
const meetingUpdated = await asUser(ids.owner, () => scalar(
  `select public.command_ship_dynamics_update_meeting(
    $1::uuid,$2::uuid,$3,1,$4::bigint,$5,$6::uuid,
    'vessels','Contract meeting updated','追蹤中','2026-07-26'::date,
    array['v1','v2']::text[],'{}'::text[],array['Operations']::text[],
    array[$7::uuid]::uuid[],array[$7::uuid]::uuid[],array[$8::uuid]::uuid[],
    'Contract verification','Pending execution','2026-08-30'::date,null,
    '中',false,false,true,$9::jsonb,$10::jsonb
  )`,
  [
    meetingUpdateOperation,
    ids.workspace,
    meetingId,
    meetingLease.fencingToken,
    `meeting:${meetingId}`,
    sessions.owner,
    ids.owner,
    ids.admin,
    JSON.stringify(updateItems),
    JSON.stringify(taskGuards),
  ],
));
assert.equal(meetingUpdated.status, 'committed');
assert.deepEqual(
  (await db.query(`
    select recipient_id::text as "recipientId",vessel_id as "vesselId",kind
    from public.sd_notifications
    where workspace_id='${ids.workspace}' and task_id='${meetingTaskId}'
      and kind='task_updated'
    order by recipient_id,vessel_id
  `)).rows,
  [
    { recipientId: ids.operator, vesselId: 'v1', kind: 'task_updated' },
    { recipientId: ids.operator2, vesselId: 'v2', kind: 'task_updated' },
    { recipientId: ids.vessel, vesselId: 'v1', kind: 'task_updated' },
  ],
);
assert.equal(
  Number(await scalar(`
    select count(*) from public.sd_notifications
    where workspace_id=$1::uuid and task_id=$2 and kind='task_updated'
  `, [ids.workspace, meetingTaskId])),
  3,
  'one meeting operation emits at most one notice per authorized task scope recipient',
);

const noOpGuards = [{
  ...taskGuards[0],
  baseVersion: 2,
}];
const meetingNoOpOperation = operationId();
const meetingNoOpRequest = {
  ...meetingUpdateRequest,
  baseVersion: 2,
  taskGuards: noOpGuards,
};
await reserve(
  ids.owner,
  meetingNoOpOperation,
  'update_meeting',
  `meeting:${meetingId}`,
  meetingNoOpRequest,
);
await asUser(ids.owner, () => scalar(
  `select public.command_ship_dynamics_update_meeting(
    $1::uuid,$2::uuid,$3,2,$4::bigint,$5,$6::uuid,
    'vessels','Contract meeting updated','追蹤中','2026-07-26'::date,
    array['v1','v2']::text[],'{}'::text[],array['Operations']::text[],
    array[$7::uuid]::uuid[],array[$7::uuid]::uuid[],array[$8::uuid]::uuid[],
    'Contract verification','Pending execution','2026-08-30'::date,null,
    '中',false,false,true,$9::jsonb,$10::jsonb
  )`,
  [
    meetingNoOpOperation,
    ids.workspace,
    meetingId,
    meetingLease.fencingToken,
    `meeting:${meetingId}`,
    sessions.owner,
    ids.owner,
    ids.admin,
    JSON.stringify(updateItems),
    JSON.stringify(noOpGuards),
  ],
));
assert.equal(
  Number(await scalar(`
    select count(*) from public.sd_notifications
    where workspace_id=$1::uuid and task_id=$2 and kind='task_updated'
  `, [ids.workspace, meetingTaskId])),
  3,
  'a meeting-linked task no-op must not generate duplicate spam',
);

const originalMeetingEvent = await scalar(`
  select id::text
  from public.sd_meeting_status_events
  where workspace_id=$1::uuid and meeting_id=$2
  order by created_at,id
  limit 1
`, [ids.workspace, meetingId]);
const correctionOperation = operationId();
const correctionRequest = {
  meetingId,
  eventId: originalMeetingEvent,
  baseVersion: 3,
  leaseKey: `meeting:${meetingId}`,
  ownerSession: sessions.owner,
  fencingToken: Number(meetingLease.fencingToken),
  correctionKind: 'void',
  correctedStatus: null,
  reason: 'Entered in error',
};
await reserve(
  ids.owner,
  correctionOperation,
  'correct_meeting_status_event',
  `meeting:${meetingId}`,
  correctionRequest,
);
const correction = await asUser(ids.owner, () => scalar(
  `select public.command_ship_dynamics_correct_meeting_status_event(
    $1::uuid,$2::uuid,$3,$4::uuid,3,$5,$6::uuid,$7::bigint,
    'void',null,'Entered in error'
  )`,
  [
    correctionOperation,
    ids.workspace,
    meetingId,
    originalMeetingEvent,
    `meeting:${meetingId}`,
    sessions.owner,
    meetingLease.fencingToken,
  ],
));
assert.equal(correction.correctionKind, 'void');
assert.equal(
  Number(await scalar(`
    select count(*) from public.sd_meeting_status_events
    where workspace_id=$1::uuid and id=$2::uuid
  `, [ids.workspace, originalMeetingEvent])),
  1,
  'voiding history preserves the original append-only event',
);
assert.equal(
  Number(await scalar(`
    select count(*) from public.sd_meeting_status_event_corrections
    where workspace_id=$1::uuid and original_event_id=$2::uuid
      and correction_kind='void'
  `, [ids.workspace, originalMeetingEvent])),
  1,
);
for (const userId of [ids.operator, ids.vessel]) {
  await assert.rejects(
    () => asUser(userId, () => db.query(
      `select public.command_ship_dynamics_correct_meeting_status_event(
        $1::uuid,$2::uuid,$3,$4::uuid,4,$5,$6::uuid,1,
        'void',null,'Unauthorized'
      )`,
      [
        operationId(),
        ids.workspace,
        meetingId,
        originalMeetingEvent,
        `meeting:${meetingId}`,
        sessions.operator,
      ],
    )),
    /not-authorized/i,
  );
}

// Auth orchestration: Admin can create/reset/disable a non-owner, while Owner
// creation/role assignment remains outside generic paths.
const managedUser = '77777777-7777-4777-8777-777777777777';
await db.exec(`
  insert into auth.users(id,email)
  values('${managedUser}','managed@internal.invalid')
`);
const authCreateOperation = operationId();
const authCreateRequest = {
  action: 'create',
  targetUserId: null,
  displayName: 'Managed User',
  usernameLabel: 'managed-user',
  department: 'Operations',
  role: 'operator',
  credentialFingerprint: 'fingerprint-create',
};
const authCreateReservationRequest = {
  action: 'create',
  targetUserId: null,
  displayName: 'Managed User',
  usernameLabel: 'managed-user',
  department: 'Operations',
  role: 'operator',
};
assert.equal(
  (await reserve(
    ids.admin,
    authCreateOperation,
    'manage_user:create',
    'user:new',
    authCreateReservationRequest,
  )).status,
  'prepared',
  'Auth Admin mutations require a durable sanitized reservation first',
);
const authBegun = await asUser(ids.admin, () => scalar(
  `select public.begin_ship_dynamics_user_operation(
    $1::uuid,$2::uuid,'create',null,$3::jsonb
  )`,
  [ids.workspace, authCreateOperation, JSON.stringify(authCreateRequest)],
));
assert.equal(authBegun.status, 'prepared');
await asUser(ids.admin, () => scalar(
  `select public.mark_ship_dynamics_user_operation_effect(
    $1::uuid,$2::uuid,$3::uuid
  )`,
  [ids.workspace, authCreateOperation, managedUser],
));
await asUser(ids.admin, () => scalar(
  `select public.provision_ship_dynamics_user(
    $1::uuid,$2::uuid,'Managed User','managed-user','Operations',
    'operator','managed-alias@internal.invalid',$3::uuid
  )`,
  [ids.workspace, managedUser, authCreateOperation],
));
await asUser(ids.admin, () => scalar(
  `select public.complete_ship_dynamics_user_operation(
    $1::uuid,$2::uuid,$3::jsonb
  )`,
  [
    ids.workspace,
    authCreateOperation,
    JSON.stringify({ userId: managedUser, role: 'operator' }),
  ],
));
assert.equal(
  (await reserve(
    ids.admin,
    authCreateOperation,
    'manage_user:create',
    'user:new',
    authCreateReservationRequest,
  )).status,
  'committed',
  'a committed sensitive operation replays against its exact sanitized request',
);
await assert.rejects(
  () => reserve(
    ids.admin,
    authCreateOperation,
    'manage_user:create',
    'user:new',
    { ...authCreateReservationRequest, displayName: 'Different User' },
  ),
  /operation-mismatch/i,
);

const authResetOperation = operationId();
await asUser(ids.admin, () => scalar(
  `select public.begin_ship_dynamics_user_operation(
    $1::uuid,$2::uuid,'reset-password',$3::uuid,$4::jsonb
  )`,
  [
    ids.workspace,
    authResetOperation,
    managedUser,
    JSON.stringify({ credentialFingerprint: 'fingerprint-reset' }),
  ],
));
await asUser(ids.admin, () => scalar(
  `select public.mark_ship_dynamics_user_operation_effect(
    $1::uuid,$2::uuid,$3::uuid
  )`,
  [ids.workspace, authResetOperation, managedUser],
));
await asUser(ids.admin, () => scalar(
  `select public.complete_ship_dynamics_user_operation(
    $1::uuid,$2::uuid,$3::jsonb
  )`,
  [
    ids.workspace,
    authResetOperation,
    JSON.stringify({ userId: managedUser, credentialReset: true }),
  ],
));

const authDisableOperation = operationId();
await asUser(ids.admin, () => scalar(
  `select public.begin_ship_dynamics_user_operation(
    $1::uuid,$2::uuid,'disable',$3::uuid,$4::jsonb
  )`,
  [
    ids.workspace,
    authDisableOperation,
    managedUser,
    JSON.stringify({ action: 'disable', targetUserId: managedUser }),
  ],
));
await asUser(ids.admin, () => scalar(
  `select public.disable_ship_dynamics_user($1::uuid,$2::uuid,$3::uuid)`,
  [ids.workspace, managedUser, authDisableOperation],
));
assert.equal(
  await scalar(`
    select is_active from public.sd_memberships
    where workspace_id=$1::uuid and user_id=$2::uuid
  `, [ids.workspace, managedUser]),
  false,
);

await assert.rejects(
  () => asUser(ids.admin, () => db.query(
    `select public.begin_ship_dynamics_user_operation(
      $1::uuid,$2::uuid,'reset-password',$3::uuid,'{}'::jsonb
    )`,
    [ids.workspace, operationId(), ids.owner],
  )),
  /not-authorized/i,
  'Admin cannot inspect or mutate Owner through Auth orchestration',
);
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `select public.begin_ship_dynamics_user_operation(
      $1::uuid,$2::uuid,'change-role',$3::uuid,$4::jsonb
    )`,
    [
      ids.workspace,
      operationId(),
      ids.operator2,
      JSON.stringify({ role: 'owner' }),
    ],
  )),
  /invalid-user-role/i,
  'generic Auth role changes cannot assign Owner',
);

const transferOperation = operationId();
const transferRequest = {
  action: 'transfer-owner',
  targetUserId: ids.operator2,
};
await asUser(ids.owner, () => scalar(
  `select public.begin_ship_dynamics_user_operation(
    $1::uuid,$2::uuid,'transfer-owner',$3::uuid,$4::jsonb
  )`,
  [ids.workspace, transferOperation, ids.operator2, JSON.stringify(transferRequest)],
));
const transferredOwner = await asUser(ids.owner, () => scalar(
  `select public.transfer_ship_dynamics_owner($1::uuid,$2::uuid,$3::uuid)`,
  [ids.workspace, ids.operator2, transferOperation],
));
await asUser(ids.owner, () => scalar(
  `select public.mark_ship_dynamics_user_operation_recovery_required(
    $1::uuid,$2::uuid,'response-lost-after-owner-transfer'
  )`,
  [ids.workspace, transferOperation],
));
const resumedTransfer = await asUser(ids.owner, () => scalar(
  `select public.begin_ship_dynamics_user_operation(
    $1::uuid,$2::uuid,'transfer-owner',$3::uuid,$4::jsonb
  )`,
  [ids.workspace, transferOperation, ids.operator2, JSON.stringify(transferRequest)],
));
assert.equal(resumedTransfer.status, 'recovery_required',
  'the demoted original Owner must be able to resume only the exact prior transfer');
assert.deepEqual(
  await asUser(ids.owner, () => scalar(
    `select public.transfer_ship_dynamics_owner($1::uuid,$2::uuid,$3::uuid)`,
    [ids.workspace, ids.operator2, transferOperation],
  )),
  transferredOwner,
  'owner transfer recovery must adopt the already-applied ownership state',
);
await asUser(ids.owner, () => scalar(
  `select public.complete_ship_dynamics_user_operation($1::uuid,$2::uuid,$3::jsonb)`,
  [ids.workspace, transferOperation, JSON.stringify(transferredOwner)],
));
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `select public.begin_ship_dynamics_user_operation(
      $1::uuid,$2::uuid,'transfer-owner',$3::uuid,$4::jsonb
    )`,
    [ids.workspace, operationId(), ids.admin, JSON.stringify({
      action: 'transfer-owner', targetUserId: ids.admin,
    })],
  )),
  /not-authorized/i,
  'a demoted prior Owner cannot start a different owner transfer',
);

const transferArguments = await scalar(`
  select pg_get_function_arguments(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='transfer_ship_dynamics_owner'
`);
assert.match(transferArguments, /p_user_id uuid/);
assert.doesNotMatch(transferArguments, /p_new_owner_id/);

// Final privilege and immutable-evidence catalog assertions.
const publicExecute = await db.query(`
  select routine_name
  from information_schema.routine_privileges
  where routine_schema='public' and grantee='PUBLIC'
    and privilege_type='EXECUTE'
  order by routine_name
`);
assert.deepEqual(publicExecute.rows, []);

const unsafeDefiners = await db.query(`
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and not (
      'search_path=pg_catalog, public'
      = any(coalesce(p.proconfig,'{}'::text[]))
    )
  order by p.proname
`);
assert.deepEqual(unsafeDefiners.rows, []);

const browserDml = await db.query(`
  select grantee,table_name,privilege_type
  from information_schema.role_table_grants
  where table_schema='public' and table_name like 'sd_%'
    and grantee in ('anon','authenticated')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  order by grantee,table_name,privilege_type
`);
assert.deepEqual(browserDml.rows, []);

const sensitiveReads = await db.query(`
  select grantee,table_name
  from information_schema.role_table_grants
  where table_schema='public'
    and table_name in (
      'sd_public_site_gate','sd_login_options','sd_rate_limit_buckets',
      'sd_edit_leases','sd_operation_reservations'
    )
    and grantee in ('anon','authenticated')
    and privilege_type='SELECT'
  order by grantee,table_name
`);
assert.deepEqual(sensitiveReads.rows, []);

await assert.rejects(
  () => db.query(`
    delete from public.sd_meeting_status_event_corrections
    where workspace_id='${ids.workspace}'
  `),
  /append-only/i,
);

const commandSecurity = await db.query(`
  select p.proname,p.prosecdef as "securityDefiner",
    coalesce(array_to_string(p.proconfig,','),'') as config
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and (
      p.proname like 'command_ship_dynamics_%'
      or p.proname in (
        'reserve_ship_dynamics_operation',
        'reject_ship_dynamics_operation_reservation',
        'get_ship_dynamics_operation_status'
      )
    )
  order by p.proname
`);
assert.ok(commandSecurity.rows.length >= 30);
for (const row of commandSecurity.rows) {
  assert.equal(row.securityDefiner, true, `${row.proname} must be SECURITY DEFINER`);
  assert.match(row.config, /search_path=pg_catalog, public/);
}

const parentOperations = await db.query(`
  select command,count(*)::integer as count
  from public.sd_operations
  where workspace_id='${ids.workspace}'
    and command in (
      'create_internal_case_from_task',
      'create_task_from_internal_case'
    )
  group by command
  order by command
`);
assert.deepEqual(parentOperations.rows, [
  { command: 'create_internal_case_from_task', count: 1 },
  { command: 'create_task_from_internal_case', count: 1 },
]);

console.log('normalized_app_contract_db=PASS');

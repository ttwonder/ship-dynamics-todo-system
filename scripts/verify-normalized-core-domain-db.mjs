import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const foundationPath = resolve(root, 'supabase', 'normalized-schema.sql');
const corePath = resolve(root, 'supabase', 'normalized-core-domain.sql');
const db = new PGlite();

const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  operator: '33333333-3333-4333-8333-333333333333',
  operator2: '44444444-4444-4444-8444-444444444444',
  vesselAccount: '55555555-5555-4555-8555-555555555555',
  outsider: '66666666-6666-4666-8666-666666666666',
  ownerSession: '10000000-0000-4000-8000-000000000001',
  adminSession: '10000000-0000-4000-8000-000000000002',
  operatorSession: '10000000-0000-4000-8000-000000000003',
  operatorSession2: '10000000-0000-4000-8000-000000000004',
};

let operationSequence = 0;
const operationId = () => `20000000-0000-4000-8000-${String(++operationSequence).padStart(12, '0')}`;

await db.exec(`
  create schema auth;
  create role anon noinherit;
  create role authenticated noinherit;
  create role service_role noinherit bypassrls;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

await db.exec(await readFile(foundationPath, 'utf8'));

await db.exec(`
  insert into auth.users(id,email) values
    ('${ids.owner}','owner@internal.invalid'),
    ('${ids.admin}','admin@internal.invalid'),
    ('${ids.operator}','operator@internal.invalid'),
    ('${ids.operator2}','operator2@internal.invalid'),
    ('${ids.vesselAccount}','vessel@internal.invalid'),
    ('${ids.outsider}','outsider@internal.invalid');

  insert into public.sd_workspaces(id, legacy_key, name) values
    ('${ids.workspace}', 'default', 'Ship Dynamics');

  insert into public.sd_profiles(id, display_name, username_label) values
    ('${ids.owner}','Owner','owner'),
    ('${ids.admin}','Admin','admin'),
    ('${ids.operator}','Operator A','operator-a'),
    ('${ids.operator2}','Operator B','operator-b'),
    ('${ids.vesselAccount}','Vessel A','vessel-a'),
    ('${ids.outsider}','Outsider','outsider');

  insert into public.sd_memberships(workspace_id,user_id,department,role,is_active) values
    ('${ids.workspace}','${ids.owner}','管理','owner',true),
    ('${ids.workspace}','${ids.admin}','管理','admin',true),
    ('${ids.workspace}','${ids.operator}','航運處','operator',true),
    ('${ids.workspace}','${ids.operator2}','督導','operator',true),
    ('${ids.workspace}','${ids.vesselAccount}','船舶帳戶','vessel',true);

  insert into public.sd_vessels(
    workspace_id,id,name,short_name,full_name,ship_type,fleet_category,fleet_tags,
    position,cargo,note,weekly_attention,is_active
  ) values
    ('${ids.workspace}','v1','V1','V1','Vessel One','bulk','bulk fleet','{north}',
      '{"location":"old-v1"}','{"items":[]}','{"recentDynamics":"old-v1"}','{}',true),
    ('${ids.workspace}','v2','V2','V2','Vessel Two','tanker','tanker fleet','{south}',
      '{"location":"old-v2"}','{"items":[]}','{"recentDynamics":"old-v2"}','{}',true),
    ('${ids.workspace}','v3','V3','V3','Vessel Three','bulk','bulk fleet','{}',
      '{}','{}','{}','{}',true);

  insert into public.sd_vessel_assignments(workspace_id,vessel_id,user_id,assignment_kind,is_active) values
    ('${ids.workspace}','v1','${ids.operator}','manager',true),
    ('${ids.workspace}','v2','${ids.operator}','delegate',true),
    ('${ids.workspace}','v3','${ids.operator2}','manager',true),
    ('${ids.workspace}','v1','${ids.vesselAccount}','vessel_account',true);

  insert into public.sd_tasks(
    workspace_id,id,description,status,priority,source_kind,
    is_internal_control,is_closed
  ) values (
    '${ids.workspace}','legacy-foundation-task','Pre-migration task',
    'open','中','ordinary',false,false
  );
  insert into public.sd_task_vessels(
    workspace_id,task_id,vessel_id,is_active_scope,status,is_closed
  ) values
    ('${ids.workspace}','legacy-foundation-task','v1',true,'open',false),
    ('${ids.workspace}','legacy-foundation-task','v2',true,'open',false);
`);

await db.exec(await readFile(corePath, 'utf8'));
assert.deepEqual(
  (await db.query(`
    select source_type as "sourceType", vessel_scope_mode as "scopeMode",
      is_deleted as "isDeleted", version
    from public.sd_tasks
    where workspace_id='${ids.workspace}' and id='legacy-foundation-task'
  `)).rows[0],
  { sourceType: 'morning', scopeMode: 'vessels', isDeleted: false, version: 1 },
  'the additive migration must preserve representative foundation rows and apply safe defaults',
);

async function asUser(userId, action) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}';`);
  try {
    return await action();
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`);
  }
}

async function asAnon(action) {
  await db.exec('set role anon;');
  try {
    return await action();
  } finally {
    await db.exec('reset role;');
  }
}

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function claim(userId, entityType, entityId, session, ttl = 75) {
  const leaseKey = entityType === 'task-create'
    ? `task-create:${entityId}`
    : entityType === 'task-progress'
      ? `task-progress:${entityId}`
      : entityType === 'settings'
        ? `settings:${entityId}`
        : `${entityType}:${entityId}`;
  return asUser(userId, async () => scalar(
    `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,$6)`,
    [ids.workspace, leaseKey, entityType, entityId, session, ttl],
  ));
}

async function taskVersion(taskId) {
  return Number(await scalar(
    `select version from public.sd_tasks where workspace_id=$1::uuid and id=$2`,
    [ids.workspace, taskId],
  ));
}

async function vesselVersion(vesselId) {
  return Number(await scalar(
    `select version from public.sd_vessels where workspace_id=$1::uuid and id=$2`,
    [ids.workspace, vesselId],
  ));
}

const createTask = async (userId, taskId, session, token, content, op = operationId()) => asUser(userId, async () => scalar(
  `select public.command_ship_dynamics_create_ordinary_task(
    $1::uuid,$2::uuid,$3,$4,$5::uuid,$6::bigint,$7::jsonb
  )`,
  [op, ids.workspace, taskId, `task-create:${content.vesselIds[0]}`, session, token, JSON.stringify(content)],
));

const baseTaskContent = {
  description: 'Ordinary task',
  status: '待處理',
  priority: '中',
  expectedDate: '2026-08-15',
  reportDate: '2026-07-26',
  equipmentSubcategory: '',
  isAware: false,
  isAbnormal: false,
  vesselIds: ['v1'],
  categories: ['維修', 'PSC窗口'],
  departments: ['航運處'],
  ownerUserIds: [ids.operator],
  typeScopes: [],
};

const createLease = await claim(ids.operator, 'task-create', 'v1', ids.operatorSession);
assert.equal(createLease.ok, true);
await assert.rejects(
  () => claim(ids.vesselAccount, 'task-create', 'v1', ids.operatorSession2),
  /not-authorized/i,
  'the mature core keeps vessel accounts read-only',
);
const createOperation = operationId();
const created = await createTask(ids.operator, 'ordinary-1', ids.operatorSession, createLease.fencingToken, baseTaskContent, createOperation);
assert.equal(created.status, 'committed');
assert.equal(created.replayed, false);
assert.equal(Number(created.version), 1);

const replayed = await createTask(ids.operator, 'ordinary-1', ids.operatorSession, createLease.fencingToken, baseTaskContent, createOperation);
assert.equal(replayed.replayed, true);
assert.equal(Number(replayed.version), 1);
await assert.rejects(
  () => createTask(
    ids.operator,
    'ordinary-1',
    ids.operatorSession,
    createLease.fencingToken,
    { ...baseTaskContent, description: 'mismatched replay' },
    createOperation,
  ),
  /operation-mismatch/i,
  'an operation id cannot be reused with different request semantics',
);

const canonicalCreated = await db.query(`
  select source_kind as "sourceKind", source_type as "sourceType",
    is_internal_control as "isInternal", created_by as "createdBy",
    updated_by as "updatedBy", version
  from public.sd_tasks
  where workspace_id='${ids.workspace}' and id='ordinary-1'
`);
assert.deepEqual(canonicalCreated.rows[0], {
  sourceKind: 'ordinary',
  sourceType: 'morning',
  isInternal: false,
  createdBy: ids.operator,
  updatedBy: ids.operator,
  version: 1,
});
assert.deepEqual(
  await asUser(ids.vesselAccount, async () => ({
    tasks: (await db.query(`select id from public.sd_tasks order by id`)).rows,
    owners: (await db.query(`select task_id from public.sd_task_owners order by task_id`)).rows,
  })),
  { tasks: [{ id: 'ordinary-1' }], owners: [] },
  'a vessel account sees the authorized ordinary single-vessel member projection but no owner identities',
);

await assert.rejects(
  () => createTask(
    ids.operator,
    'forged-source',
    ids.operatorSession,
    createLease.fencingToken,
    { ...baseTaskContent, sourceKind: 'meeting' },
  ),
  /invalid-task-payload/i,
  'ordinary create must reject caller-supplied provenance',
);

const deleteCandidate = await createTask(
  ids.operator,
  'delete-me',
  ids.operatorSession,
  createLease.fencingToken,
  { ...baseTaskContent, description: 'Delete through ordinary aggregate command' },
);
assert.equal(Number(deleteCandidate.version), 1);
const deleteLease = await claim(ids.owner, 'task', 'delete-me', ids.ownerSession);
const deleted = await asUser(ids.owner, async () => scalar(
  `select public.command_ship_dynamics_delete_ordinary_task(
    $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint
  )`,
  [
    operationId(), ids.workspace, 'delete-me', 1,
    'task:delete-me', ids.ownerSession, deleteLease.fencingToken,
  ],
));
assert.equal(deleted.deleted, true);
assert.equal(
  await scalar(`select is_deleted from public.sd_tasks where workspace_id=$1::uuid and id='delete-me'`, [ids.workspace]),
  true,
);
assert.equal(
  Number(await scalar(`select count(*) from public.sd_task_status_events where workspace_id=$1::uuid and task_id='delete-me'`, [ids.workspace])),
  2,
);
assert.equal(
  Number(await asUser(ids.vesselAccount, () => scalar(`
    select count(*) from public.sd_notifications
    where task_id='delete-me' and kind='task_deleted'
  `))),
  1,
  'authorized recipients retain their server-created deletion notification after the task is hidden',
);

const taskLease = await claim(ids.operator, 'task', 'ordinary-1', ids.operatorSession);
assert.equal(taskLease.ok, true);
const updateOperation = operationId();
const updatedContent = {
  ...baseTaskContent,
  description: 'Relations replaced atomically',
  status: '跟進中',
  priority: '高',
  vesselIds: ['v1', 'v2'],
  categories: ['事故'],
  departments: ['航運處', '督導'],
  ownerUserIds: [ids.operator, ids.admin],
  typeScopes: ['bulk', 'tanker'],
};
const updated = await asUser(ids.operator, async () => scalar(
  `select public.command_ship_dynamics_update_ordinary_task(
    $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb
  )`,
  [
    updateOperation, ids.workspace, 'ordinary-1', 1, 'task:ordinary-1',
    ids.operatorSession, taskLease.fencingToken, JSON.stringify(updatedContent),
  ],
));
assert.equal(Number(updated.version), 2);

const relations = await db.query(`
  select
    array(select category from public.sd_task_categories where workspace_id='${ids.workspace}' and task_id='ordinary-1' order by ordinal) as categories,
    array(select department from public.sd_task_departments where workspace_id='${ids.workspace}' and task_id='ordinary-1' order by ordinal) as departments,
    array(select owner_id::text from public.sd_task_owners where workspace_id='${ids.workspace}' and task_id='ordinary-1' order by ordinal) as owners,
    array(select vessel_id from public.sd_task_vessels where workspace_id='${ids.workspace}' and task_id='ordinary-1' and is_active_scope order by vessel_id) as vessels,
    array(select type_scope from public.sd_task_type_scopes where workspace_id='${ids.workspace}' and task_id='ordinary-1' order by ordinal) as "typeScopes"
`);
assert.deepEqual(relations.rows[0], {
  categories: ['事故'],
  departments: ['航運處', '督導'],
  owners: [ids.operator, ids.admin],
  vessels: ['v1', 'v2'],
  typeScopes: ['bulk', 'tanker'],
});

await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `select public.command_ship_dynamics_update_ordinary_task(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb
    )`,
    [
      operationId(), ids.workspace, 'ordinary-1', 1, 'task:ordinary-1',
      ids.operatorSession, taskLease.fencingToken, JSON.stringify({ ...updatedContent, description: 'stale' }),
    ],
  )),
  /version-conflict/i,
);

await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `select public.command_ship_dynamics_update_ordinary_task(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb
    )`,
    [
      operationId(), ids.workspace, 'ordinary-1', 2, 'task:ordinary-1',
      ids.operatorSession, taskLease.fencingToken,
      JSON.stringify({ ...updatedContent, categories: ['should-not-stick'], ownerUserIds: [ids.vesselAccount] }),
    ],
  )),
  /invalid-task-owner/i,
);
assert.deepEqual(
  (await db.query(`select category from public.sd_task_categories where workspace_id='${ids.workspace}' and task_id='ordinary-1'`)).rows,
  [{ category: '事故' }],
  'a rejected relation replacement must roll back the whole command',
);

await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `select public.command_ship_dynamics_update_ordinary_task(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb
    )`,
    [
      operationId(), ids.workspace, 'ordinary-1', 2, 'task:ordinary-1',
      ids.operatorSession, 999, JSON.stringify(updatedContent),
    ],
  )),
  /lease-fencing-mismatch/i,
);

const closed = await asUser(ids.operator, async () => scalar(
  `select public.command_ship_dynamics_close_ordinary_task(
    $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint
  )`,
  [operationId(), ids.workspace, 'ordinary-1', 2, 'task:ordinary-1', ids.operatorSession, taskLease.fencingToken],
));
assert.equal(Number(closed.version), 3);
const reopened = await asUser(ids.operator, async () => scalar(
  `select public.command_ship_dynamics_reopen_ordinary_task(
    $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint
  )`,
  [operationId(), ids.workspace, 'ordinary-1', 3, 'task:ordinary-1', ids.operatorSession, taskLease.fencingToken],
));
assert.equal(Number(reopened.version), 4);
assert.deepEqual(
  (await db.query(`
    select status from public.sd_task_status_events
    where workspace_id='${ids.workspace}' and task_id='ordinary-1'
    order by created_at, id
  `)).rows.map(row => row.status),
  ['待處理', '跟進中', '已結案', '跟進中'],
);
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `delete from public.sd_task_status_events where workspace_id=$1::uuid and task_id=$2`,
    [ids.workspace, 'ordinary-1'],
  )),
  /permission denied/i,
  'status history must be append-only to clients',
);
await assert.rejects(
  () => db.query(`
    update public.sd_task_status_events
    set status='tampered'
    where workspace_id='${ids.workspace}' and task_id='ordinary-1'
  `),
  /append-only-relation/i,
  'append-only evidence must also reject privileged direct mutation',
);

const progressLease = await claim(ids.operator, 'task-progress', 'ordinary-1:v1', ids.operatorSession2);
assert.equal(progressLease.ok, true);
const progressResult = await asUser(ids.operator, async () => scalar(
  `select public.command_ship_dynamics_update_task_vessel_progress(
    $1::uuid,$2::uuid,$3,$4,$5::bigint,$6::bigint,$7,$8::uuid,$9::bigint,$10,$11::boolean
  )`,
  [
    operationId(), ids.workspace, 'ordinary-1', 'v1', 4, 1,
    'task-progress:ordinary-1:v1', ids.operatorSession2, progressLease.fencingToken,
    '本船完成', true,
  ],
));
assert.equal(Number(progressResult.progressVersion), 2);
assert.equal(
  Number(await scalar(`select count(*) from public.sd_task_vessel_status_events where workspace_id=$1::uuid and task_id=$2 and vessel_id=$3`, [ids.workspace, 'ordinary-1', 'v1'])),
  1,
);

await db.exec(`
  insert into public.sd_tasks(
    workspace_id,id,description,status,priority,source_kind,source_type,
    is_internal_control,is_closed,source_meeting_id,source_meeting_item_id
  ) values
    ('${ids.workspace}','meeting-task','Meeting task','open','中','meeting','temporary',false,false,'meeting-1','item-1'),
    ('${ids.workspace}','internal-task','Internal task','open','中','ordinary','morning',true,false,null,null);
  insert into public.sd_task_vessels(workspace_id,task_id,vessel_id,is_active_scope,status,is_closed) values
    ('${ids.workspace}','meeting-task','v1',true,'open',false),
    ('${ids.workspace}','internal-task','v1',true,'open',false);
`);
for (const taskId of ['meeting-task', 'internal-task']) {
  const lease = await claim(ids.owner, 'task', taskId, ids.ownerSession);
  await assert.rejects(
    () => asUser(ids.owner, () => db.query(
      `select public.command_ship_dynamics_update_ordinary_task(
        $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb
      )`,
      [
        operationId(), ids.workspace, taskId, 1, `task:${taskId}`,
        ids.ownerSession, lease.fencingToken, JSON.stringify(baseTaskContent),
      ],
    )),
    /ordinary-provenance-required/i,
  );
}
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `select public.command_ship_dynamics_update_task(
      $1::uuid,$2::uuid,$3,$4::bigint,$5::bigint,$6,$7::uuid,$8
    )`,
    [
      operationId(), ids.workspace, 'meeting-task', 1, 1,
      'task:meeting-task', ids.ownerSession, 'legacy bypass',
    ],
  )),
  /permission denied/i,
  'the partial foundation update command must be retired after this migration',
);

const adminProfileLease = await claim(ids.admin, 'vessel', 'v1', ids.adminSession);
const profileResult = await asUser(ids.admin, async () => scalar(
  `select public.command_ship_dynamics_update_vessel_profile(
    $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb
  )`,
  [
    operationId(), ids.workspace, 'v1', 1, 'vessel:v1',
    ids.adminSession, adminProfileLease.fencingToken,
    JSON.stringify({ name: 'Vessel One Updated', shortName: 'V1U', fullName: 'Vessel One Full', shipType: 'bulk', fleetCategory: 'bulk fleet', fleetTags: ['north', 'priority'] }),
  ],
));
assert.equal(Number(profileResult.version), 2);
assert.equal(
  await asUser(ids.admin, () => scalar(
    `select public.release_ship_dynamics_entity_lease($1::uuid,$2,$3::uuid,$4::bigint)`,
    [ids.workspace, 'vessel:v1', ids.adminSession, adminProfileLease.fencingToken],
  )),
  true,
);
const v1Lease = await claim(ids.operator, 'vessel', 'v1', ids.operatorSession);
const v2Lease = await claim(ids.operator, 'vessel', 'v2', ids.operatorSession2);
assert.equal(v1Lease.ok, true);
assert.equal(v2Lease.ok, true, 'disjoint entity leases must remain independently valid');
await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `select public.command_ship_dynamics_update_vessel_profile(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb
    )`,
    [
      operationId(), ids.workspace, 'v1', 2, 'vessel:v1',
      ids.operatorSession, v1Lease.fencingToken,
      JSON.stringify({ name: 'Forged profile', shortName: 'BAD', fullName: '', shipType: 'bulk', fleetCategory: 'bulk fleet', fleetTags: [] }),
    ],
  )),
  /not-authorized/i,
  'operators may update assigned vessel business content but not management profile identity',
);
const expiringLease = await claim(ids.operator2, 'vessel', 'v3', ids.operatorSession2);
await db.exec(`
  update public.sd_edit_leases
  set expires_at=clock_timestamp()-interval '1 second'
  where workspace_id='${ids.workspace}' and lease_key='vessel:v3'
`);
await assert.rejects(
  () => asUser(ids.operator2, () => db.query(
    `select public.command_ship_dynamics_update_vessel_note(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb
    )`,
    [
      operationId(), ids.workspace, 'v3', 1, 'vessel:v3',
      ids.operatorSession2, expiringLease.fencingToken,
      JSON.stringify({ statusList: [], recentDynamics: 'expired', subsequentDynamics: '' }),
    ],
  )),
  /lease-expired-mismatch/i,
);

let v1Version = await vesselVersion('v1');
for (const [functionName, value] of [
  ['position', { source: 'manual', location: 'Shanghai', speedKnots: 12.5, navigationStatus: '航行', lastPort: 'Busan', nextPort: 'Kaohsiung', eta: '2026-07-28T08:00', etb: '', etd: '', manualRemark: '' }],
  ['cargo', { source: 'manual', loadStatus: '滿載', name: 'Ore', quantity: '20,000 MT', items: [{ name: 'Ore', quantity: '20,000 MT' }] }],
  ['note', { statusList: ['loading'], recentDynamics: 'updated', subsequentDynamics: '' }],
  ['weekly_attention', ['maintenance', 'psc-window']],
]) {
  const result = await asUser(ids.operator, async () => scalar(
    `select public.command_ship_dynamics_update_vessel_${functionName}(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb
    )`,
    [
      operationId(), ids.workspace, 'v1', v1Version, 'vessel:v1',
      ids.operatorSession, v1Lease.fencingToken, JSON.stringify(value),
    ],
  ));
  v1Version = Number(result.version);
}
assert.equal(v1Version, 6);
const vesselContent = await db.query(`
  select name, fleet_tags as "fleetTags", position->>'location' as location,
    cargo->>'name' as cargo, note->>'recentDynamics' as note,
    weekly_attention as "weeklyAttention", updated_by as "updatedBy"
  from public.sd_vessels where workspace_id='${ids.workspace}' and id='v1'
`);
assert.deepEqual(vesselContent.rows[0], {
  name: 'Vessel One Updated',
  fleetTags: ['north', 'priority'],
  location: 'Shanghai',
  cargo: 'Ore',
  note: 'updated',
  weeklyAttention: ['maintenance', 'psc-window'],
  updatedBy: ids.operator,
});

const batchStaleItems = [
  {
    vesselId: 'v1', baseVersion: 6, leaseKey: 'vessel:v1',
    ownerSession: ids.operatorSession, fencingToken: Number(v1Lease.fencingToken),
    patch: { note: { statusList: [], recentDynamics: 'batch-v1', subsequentDynamics: '' } },
  },
  {
    vesselId: 'v2', baseVersion: 999, leaseKey: 'vessel:v2',
    ownerSession: ids.operatorSession2, fencingToken: Number(v2Lease.fencingToken),
    patch: { note: { statusList: [], recentDynamics: 'batch-v2', subsequentDynamics: '' } },
  },
];
await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `select public.command_ship_dynamics_batch_update_vessels($1::uuid,$2::uuid,$3::jsonb)`,
    [operationId(), ids.workspace, JSON.stringify(batchStaleItems)],
  )),
  /version-conflict/i,
);
assert.equal(
  await scalar(`select note->>'recentDynamics' from public.sd_vessels where workspace_id=$1::uuid and id='v1'`, [ids.workspace]),
  'updated',
  'one stale batch member must roll back already validated members',
);
batchStaleItems[1].baseVersion = 1;
const batchUpdated = await asUser(ids.operator, async () => scalar(
  `select public.command_ship_dynamics_batch_update_vessels($1::uuid,$2::uuid,$3::jsonb)`,
  [operationId(), ids.workspace, JSON.stringify(batchStaleItems)],
));
assert.equal(batchUpdated.count, 2);
assert.equal(await vesselVersion('v1'), 7);
assert.equal(await vesselVersion('v2'), 2);

const newVesselLease = await claim(ids.admin, 'vessel', 'v-new', ids.adminSession);
assert.equal(newVesselLease.ok, true);
const createdVessel = await asUser(ids.admin, async () => scalar(
  `select public.command_ship_dynamics_create_vessel(
    $1::uuid,$2::uuid,$3,$4,$5::uuid,$6::bigint,$7::jsonb
  )`,
  [
    operationId(), ids.workspace, 'v-new', 'vessel:v-new', ids.adminSession,
    newVesselLease.fencingToken,
    JSON.stringify({ name: 'New Vessel', shortName: 'NEW', fullName: '', shipType: 'bulk', fleetCategory: 'bulk fleet', fleetTags: ['new'] }),
  ],
));
assert.equal(Number(createdVessel.version), 1);
const assignmentResult = await asUser(ids.admin, async () => scalar(
  `select public.command_ship_dynamics_replace_vessel_assignments(
    $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8::jsonb
  )`,
  [
    operationId(), ids.workspace, 'v-new', 1, 'vessel:v-new', ids.adminSession,
    newVesselLease.fencingToken,
    JSON.stringify([
      { userId: ids.operator2, assignmentKind: 'manager', isActive: true },
      { userId: ids.operator, assignmentKind: 'delegate', isActive: false },
    ]),
  ],
));
assert.equal(Number(assignmentResult.version), 2);
assert.equal(
  Number(await scalar(`select count(*) from public.sd_vessel_assignments where workspace_id=$1::uuid and vessel_id='v-new'`, [ids.workspace])),
  2,
);
const disabledVessel = await asUser(ids.admin, async () => scalar(
  `select public.command_ship_dynamics_disable_vessel(
    $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint
  )`,
  [operationId(), ids.workspace, 'v-new', 2, 'vessel:v-new', ids.adminSession, newVesselLease.fencingToken],
));
assert.equal(Number(disabledVessel.version), 3);
assert.equal(
  await scalar(`select is_active from public.sd_vessels where workspace_id=$1::uuid and id='v-new'`, [ids.workspace]),
  false,
);
assert.equal(
  Number(await scalar(`select count(*) from public.sd_vessel_assignments where workspace_id=$1::uuid and vessel_id='v-new' and is_active`, [ids.workspace])),
  0,
);

await db.exec(`
  insert into public.sd_tasks(workspace_id,id,description,status,priority,source_kind,source_type,is_internal_control,is_closed) values
    ('${ids.workspace}','batch-task-1','Batch one','open','中','ordinary','morning',false,false),
    ('${ids.workspace}','batch-task-2','Batch two','open','中','ordinary','morning',false,false);
  insert into public.sd_task_vessels(workspace_id,task_id,vessel_id,is_active_scope,status,is_closed) values
    ('${ids.workspace}','batch-task-1','v1',true,'open',false),
    ('${ids.workspace}','batch-task-2','v2',true,'open',false);
`);
const batchTaskLease1 = await claim(ids.owner, 'task', 'batch-task-1', ids.ownerSession);
const batchTaskLease2 = await claim(ids.owner, 'task', 'batch-task-2', ids.ownerSession);
const batchTaskItems = [
  { taskId: 'batch-task-1', baseVersion: 1, leaseKey: 'task:batch-task-1', ownerSession: ids.ownerSession, fencingToken: Number(batchTaskLease1.fencingToken) },
  { taskId: 'batch-task-2', baseVersion: 99, leaseKey: 'task:batch-task-2', ownerSession: ids.ownerSession, fencingToken: Number(batchTaskLease2.fencingToken) },
];
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `select public.command_ship_dynamics_batch_close_ordinary_tasks($1::uuid,$2::uuid,$3::jsonb)`,
    [operationId(), ids.workspace, JSON.stringify(batchTaskItems)],
  )),
  /version-conflict/i,
);
assert.equal(
  Number(await scalar(`select count(*) from public.sd_tasks where workspace_id=$1::uuid and id in ('batch-task-1','batch-task-2') and is_closed`, [ids.workspace])),
  0,
);
batchTaskItems[1].baseVersion = 1;
const batchClosed = await asUser(ids.owner, async () => scalar(
  `select public.command_ship_dynamics_batch_close_ordinary_tasks($1::uuid,$2::uuid,$3::jsonb)`,
  [operationId(), ids.workspace, JSON.stringify(batchTaskItems)],
));
assert.equal(batchClosed.count, 2);
batchTaskItems[0].baseVersion = 2;
batchTaskItems[1].baseVersion = 2;
const batchDeleted = await asUser(ids.owner, async () => scalar(
  `select public.command_ship_dynamics_batch_delete_ordinary_tasks($1::uuid,$2::uuid,$3::jsonb)`,
  [operationId(), ids.workspace, JSON.stringify(batchTaskItems)],
));
assert.equal(batchDeleted.count, 2);
assert.equal(
  Number(await scalar(`select count(*) from public.sd_tasks where workspace_id=$1::uuid and id in ('batch-task-1','batch-task-2') and is_deleted`, [ids.workspace])),
  2,
);

await db.exec(`
  insert into public.sd_notifications(
    workspace_id,id,recipient_id,vessel_id,task_id,kind,title,message,actor_id,version
  ) values
    ('${ids.workspace}','notice-1','${ids.operator}','v1','ordinary-1','task_updated','Updated','Message','${ids.owner}',1),
    ('${ids.workspace}','notice-2','${ids.operator2}','v3',null,'task_updated','Other','Hidden','${ids.owner}',1);
`);
const marked = await asUser(ids.operator, async () => scalar(
  `select public.command_ship_dynamics_mark_notifications_read($1::uuid,$2::uuid,$3::jsonb)`,
  [operationId(), ids.workspace, JSON.stringify([{ notificationId: 'notice-1', baseVersion: 1 }])],
));
assert.equal(marked.count, 1);
assert.equal(
  Number(await asUser(ids.operator, () => scalar(`select count(*) from public.sd_notifications where read_at is not null`))),
  1,
);
assert.equal(
  Number(await asUser(ids.operator2, () => scalar(`select count(*) from public.sd_notifications where read_at is not null`))),
  0,
);

const categoryLease = await claim(ids.admin, 'settings', 'task-categories', ids.adminSession);
const categoryResult = await asUser(ids.admin, async () => scalar(
  `select public.command_ship_dynamics_update_task_categories(
    $1::uuid,$2::uuid,$3::bigint,$4,$5::uuid,$6::bigint,$7::jsonb
  )`,
  [
    operationId(), ids.workspace, 0, 'settings:task-categories',
    ids.adminSession, categoryLease.fencingToken, JSON.stringify(['維修', '事故', '自訂']),
  ],
));
assert.equal(Number(categoryResult.version), 1);

const roleLease = await claim(ids.owner, 'settings', 'role-permissions', ids.ownerSession);
const roleResult = await asUser(ids.owner, async () => scalar(
  `select public.command_ship_dynamics_update_role_permissions(
    $1::uuid,$2::uuid,$3::bigint,$4,$5::uuid,$6::bigint,$7::jsonb
  )`,
  [
    operationId(), ids.workspace, 0, 'settings:role-permissions',
    ids.ownerSession, roleLease.fencingToken,
    JSON.stringify({
      admin: { deleteTasks: false, manageSystemSettings: true, editBusinessContent: true },
      operator: { editBusinessContent: true, closeTasks: true, manageVessels: true },
      vessel: { createTasks: true, editBusinessContent: true },
    }),
  ],
));
assert.equal(Number(roleResult.version), 1);
assert.equal(
  await scalar(`select enabled from public.sd_role_permissions where workspace_id=$1::uuid and role='admin' and permission_key='deleteTasks'`, [ids.workspace]),
  true,
  'fixed admin permissions must be reapplied',
);
assert.equal(
  await scalar(`select enabled from public.sd_role_permissions where workspace_id=$1::uuid and role='admin' and permission_key='manageSystemSettings'`, [ids.workspace]),
  false,
  'admin cannot elevate itself into Owner security settings',
);
assert.equal(
  await scalar(`select enabled from public.sd_role_permissions where workspace_id=$1::uuid and role='operator' and permission_key='manageVessels'`, [ids.workspace]),
  false,
);
assert.equal(
  await scalar(`select enabled from public.sd_role_permissions where workspace_id=$1::uuid and role='vessel' and permission_key='editBusinessContent'`, [ids.workspace]),
  false,
);

await assert.rejects(
  () => claim(ids.admin, 'settings', 'site-gate', ids.adminSession),
  /not-authorized/i,
);
const gateLease = await claim(ids.owner, 'settings', 'site-gate', ids.ownerSession);
const gateResult = await asUser(ids.owner, async () => scalar(
  `select public.command_ship_dynamics_update_site_gate(
    $1::uuid,$2::uuid,$3::bigint,$4,$5::uuid,$6::bigint,$7
  )`,
  [
    operationId(), ids.workspace, 0, 'settings:site-gate', ids.ownerSession,
    gateLease.fencingToken, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ],
));
assert.equal(Number(gateResult.version), 1);
assert.equal(
  await scalar(`select password_hash from public.sd_public_site_gate where workspace_id=$1::uuid`, [ids.workspace]),
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
);
assert.equal(
  Number(await asAnon(() => scalar(`select count(*) from public.sd_public_site_gate`))),
  1,
  'anon can read only the cosmetic site-gate material',
);

const report = await asUser(ids.owner, async () => scalar(
  `select public.command_ship_dynamics_save_report($1::uuid,$2::uuid,$3,$4::jsonb)`,
  [
    operationId(), ids.workspace, 'report-1',
    JSON.stringify({ title: 'Saved report', vesselIds: ['v1', 'v2'], taskCount: 2 }),
  ],
));
assert.equal(report.entityId, 'report-1');
assert.equal(
  Number(await asUser(ids.owner, () => scalar(`select count(*) from public.sd_saved_reports`))),
  1,
);
assert.equal(
  Number(await asUser(ids.vesselAccount, () => scalar(`select count(*) from public.sd_saved_reports`))),
  0,
);

await db.exec(`
  insert into public.sd_migration_quarantine(
    workspace_id,id,reason,legacy_revision,entity_type,entity_id,payload
  ) values (
    '${ids.workspace}','quarantine-1','ambiguous reciprocal task relationship',42,
    'task','legacy-task','{"description":"legacy"}'
  );
`);
assert.equal(
  Number(await asUser(ids.owner, () => scalar(`select count(*) from public.sd_migration_quarantine`))),
  1,
);
for (const userId of [ids.admin, ids.operator, ids.vesselAccount, ids.outsider]) {
  assert.equal(
    Number(await asUser(userId, () => scalar(`select count(*) from public.sd_migration_quarantine`))),
    0,
    'quarantine rows and counts must be invisible to every non-Owner role',
  );
}
await assert.rejects(
  () => asUser(ids.admin, () => db.query(
    `select public.command_ship_dynamics_resolve_migration_quarantine(
      $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8,$9
    )`,
    [
      operationId(), ids.workspace, 'missing-or-existing', 1,
      'settings:migration-quarantine', ids.adminSession, 1, 'discarded', 'admin probe',
    ],
  )),
  /not-authorized/i,
  'unauthorized resolution must fail before revealing whether a quarantine id exists',
);
const quarantineLease = await claim(ids.owner, 'settings', 'migration-quarantine', ids.ownerSession);
const resolved = await asUser(ids.owner, async () => scalar(
  `select public.command_ship_dynamics_resolve_migration_quarantine(
    $1::uuid,$2::uuid,$3,$4::bigint,$5,$6::uuid,$7::bigint,$8,$9
  )`,
  [
    operationId(), ids.workspace, 'quarantine-1', 1,
    'settings:migration-quarantine', ids.ownerSession, quarantineLease.fencingToken,
    'discarded', 'reviewed by Owner',
  ],
));
assert.equal(Number(resolved.version), 2);

assert.deepEqual(
  await asUser(ids.vesselAccount, async () => {
    const tasks = await db.query(`select id from public.sd_tasks order by id`);
    const owners = await db.query(`select task_id from public.sd_task_owners order by task_id`);
    const assignments = await db.query(`select vessel_id,user_id::text as user_id,assignment_kind from public.sd_vessel_assignments order by vessel_id,user_id`);
    return { tasks: tasks.rows, owners: owners.rows, assignments: assignments.rows };
  }),
  {
    tasks: [],
    owners: [],
    assignments: [{ vessel_id: 'v1', user_id: ids.vesselAccount, assignment_kind: 'vessel_account' }],
  },
  'vessel accounts receive only their own assignment and authorized ordinary single-vessel task projection',
);

await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `update public.sd_vessels set note='{"bypass":true}' where workspace_id=$1::uuid and id='v1'`,
    [ids.workspace],
  )),
  /permission denied/i,
);
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `insert into public.sd_task_categories(workspace_id,task_id,category,ordinal) values($1::uuid,'ordinary-1','bypass',99)`,
    [ids.workspace],
  )),
  /permission denied/i,
);

const functionSecurity = await db.query(`
  select p.proname,
    p.prosecdef as "securityDefiner",
    coalesce(array_to_string(p.proconfig, ','), '') as config
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname like 'command_ship_dynamics_%'
  order by p.proname
`);
assert.ok(functionSecurity.rows.length >= 20);
for (const row of functionSecurity.rows) {
  assert.equal(row.securityDefiner, true, `${row.proname} must be security definer`);
  assert.match(row.config, /search_path=pg_catalog, public/, `${row.proname} must fix search_path`);
}

const operationRows = await db.query(`
  select count(*)::integer as count,
    bool_and(actor_id is not null and completed_at is not null and status='committed') as canonical
  from public.sd_operations
  where workspace_id='${ids.workspace}'
`);
assert.ok(operationRows.rows[0].count >= 20);
assert.equal(operationRows.rows[0].canonical, true);

console.log('normalized_core_domain_db=PASS');

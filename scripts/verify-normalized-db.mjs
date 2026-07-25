import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const schemaPath = resolve(root, 'supabase', 'normalized-schema.sql');
const db = new PGlite();

const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  operator: '22222222-2222-4222-8222-222222222222',
  vesselAccount: '33333333-3333-4333-8333-333333333333',
  outsider: '44444444-4444-4444-8444-444444444444',
  operatorSession: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  ownerSession: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
  taskOperation: '10000000-0000-4000-8000-000000000001',
  vesselOperation: '10000000-0000-4000-8000-000000000002',
  createTaskOperation: '10000000-0000-4000-8000-000000000003',
  vesselAccountSession: 'cccccccc-1111-4111-8111-cccccccccccc',
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

const schema = await readFile(schemaPath, 'utf8');
await db.exec(schema);

await db.exec(`
  insert into auth.users(id,email) values
    ('${ids.owner}','owner@internal.invalid'),
    ('${ids.operator}','operator@internal.invalid'),
    ('${ids.vesselAccount}','vessel@internal.invalid'),
    ('${ids.outsider}','outsider@internal.invalid');

  insert into public.sd_workspaces(id, legacy_key, name) values
    ('${ids.workspace}', 'default', 'Ship Dynamics');

  insert into public.sd_profiles(id, display_name, username_label) values
    ('${ids.owner}','Owner','owner'),
    ('${ids.operator}','Operator A','operator-a'),
    ('${ids.vesselAccount}','Vessel A','vessel-a'),
    ('${ids.outsider}','Outsider','outsider');

  insert into public.sd_memberships(workspace_id,user_id,department,role,is_active) values
    ('${ids.workspace}','${ids.owner}','管理','owner',true),
    ('${ids.workspace}','${ids.operator}','業務','operator',true),
    ('${ids.workspace}','${ids.vesselAccount}','船舶','vessel',true);

  insert into public.sd_vessels(workspace_id,id,name,short_name,full_name,ship_type,fleet_category,position,cargo,note,is_active) values
    ('${ids.workspace}','vessel-a','A','A','Vessel A','bulk','bulk fleet','{}','{}','{"recentDynamics":"old"}',true),
    ('${ids.workspace}','vessel-b','B','B','Vessel B','bulk','bulk fleet','{}','{}','{}',true);

  insert into public.sd_vessel_assignments(workspace_id,vessel_id,user_id,assignment_kind,is_active) values
    ('${ids.workspace}','vessel-a','${ids.operator}','manager',true),
    ('${ids.workspace}','vessel-a','${ids.vesselAccount}','vessel_account',true);

  insert into public.sd_tasks(workspace_id,id,description,status,priority,source_kind,is_internal_control,is_closed) values
    ('${ids.workspace}','task-a','Task A','open','中','ordinary',false,false),
    ('${ids.workspace}','task-b','Task B','open','中','ordinary',false,false),
    ('${ids.workspace}','task-internal-a','Hidden internal','open','高','ordinary',true,false);

  insert into public.sd_task_vessels(workspace_id,task_id,vessel_id,is_active_scope,status,is_closed) values
    ('${ids.workspace}','task-a','vessel-a',true,'open',false),
    ('${ids.workspace}','task-b','vessel-b',true,'open',false),
    ('${ids.workspace}','task-internal-a','vessel-a',true,'open',false);
`);

async function asUser(userId, action) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}';`);
  try { return await action(); }
  finally { await db.exec(`reset role; reset request.jwt.claim.sub;`); }
}

async function visibleTasks(userId) {
  return asUser(userId, async () => {
    const result = await db.query(`select id from public.sd_tasks order by id`);
    return result.rows.map(row => row.id);
  });
}

assert.deepEqual(await visibleTasks(ids.owner), ['task-a', 'task-b', 'task-internal-a']);
assert.deepEqual(await visibleTasks(ids.operator), ['task-a', 'task-internal-a']);
assert.deepEqual(await visibleTasks(ids.vesselAccount), ['task-a']);
assert.deepEqual(await visibleTasks(ids.outsider), []);

await assert.rejects(
  () => asUser(ids.operator, () => db.query(`update public.sd_tasks set description='bypass' where id='task-a'`)),
  /permission denied/i,
  'authenticated clients must not bypass command CAS with direct DML',
);

const operatorClaim = await asUser(ids.operator, async () => {
  const result = await db.query(
    `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,$6) as result`,
    [ids.workspace, 'task:task-a', 'task', 'task-a', ids.operatorSession, 75],
  );
  return result.rows[0].result;
});
assert.equal(operatorClaim.ok, true);
assert.equal(Number(operatorClaim.fencingToken), 1);

const blockedOwnerClaim = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,$6) as result`,
    [ids.workspace, 'task:task-a', 'task', 'task-a', ids.ownerSession, 75],
  );
  return result.rows[0].result;
});
assert.equal(blockedOwnerClaim.ok, false);

await db.exec(`update public.sd_edit_leases set expires_at=clock_timestamp()-interval '1 second' where workspace_id='${ids.workspace}' and lease_key='task:task-a'`);
const ownerClaim = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,$6) as result`,
    [ids.workspace, 'task:task-a', 'task', 'task-a', ids.ownerSession, 75],
  );
  return result.rows[0].result;
});
assert.equal(ownerClaim.ok, true);
assert.equal(Number(ownerClaim.fencingToken), 2);

await assert.rejects(
  () => asUser(ids.operator, () => db.query(
    `select public.command_ship_dynamics_update_task($1::uuid,$2::uuid,$3,$4::bigint,$5::bigint,$6,$7::uuid,$8)`,
    [ids.taskOperation, ids.workspace, 'task-a', 1, 1, 'task:task-a', ids.operatorSession, 'Stale overwrite'],
  )),
  /lease-(?:owner|fencing|expired)-mismatch|not-authorized/i,
  'a stale editor must not write after lease takeover',
);

const taskResult = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_update_task($1::uuid,$2::uuid,$3,$4::bigint,$5::bigint,$6,$7::uuid,$8) as result`,
    [ids.taskOperation, ids.workspace, 'task-a', 1, ownerClaim.fencingToken, 'task:task-a', ids.ownerSession, 'Authoritative task update'],
  );
  return result.rows[0].result;
});
assert.equal(taskResult.status, 'committed');
assert.equal(taskResult.replayed, false);
assert.equal(Number(taskResult.version), 2);

const replay = await asUser(ids.owner, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_update_task($1::uuid,$2::uuid,$3,$4::bigint,$5::bigint,$6,$7::uuid,$8) as result`,
    [ids.taskOperation, ids.workspace, 'task-a', 1, ownerClaim.fencingToken, 'task:task-a', ids.ownerSession, 'Authoritative task update'],
  );
  return result.rows[0].result;
});
assert.equal(replay.status, 'committed');
assert.equal(replay.replayed, true);
assert.equal(Number(replay.version), 2);

await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `select public.command_ship_dynamics_update_task($1::uuid,$2::uuid,$3,$4::bigint,$5::bigint,$6,$7::uuid,$8)`,
    [ids.taskOperation, ids.workspace, 'task-a', 1, ownerClaim.fencingToken, 'task:task-a', ids.ownerSession, 'Different request'],
  )),
  /operation-mismatch/i,
  'an operation id cannot be reused with different semantics',
);

const vesselClaim = await asUser(ids.operator, async () => {
  const result = await db.query(
    `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,$6) as result`,
    [ids.workspace, 'vessel:vessel-a', 'vessel', 'vessel-a', ids.operatorSession, 75],
  );
  return result.rows[0].result;
});
assert.equal(vesselClaim.ok, true);

const vesselResult = await asUser(ids.operator, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_update_vessel_note($1::uuid,$2::uuid,$3,$4::bigint,$5::bigint,$6,$7::uuid,$8::jsonb) as result`,
    [ids.vesselOperation, ids.workspace, 'vessel-a', 1, vesselClaim.fencingToken, 'vessel:vessel-a', ids.operatorSession, JSON.stringify({ recentDynamics: 'updated independently' })],
  );
  return result.rows[0].result;
});
assert.equal(vesselResult.status, 'committed');
assert.equal(Number(vesselResult.version), 2);

await assert.rejects(
  () => asUser(ids.vesselAccount, () => db.query(
    `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,$6)`,
    [ids.workspace, 'task-create:vessel-b', 'task-create', 'vessel-b', ids.vesselAccountSession, 75],
  )),
  /not-authorized/i,
  'a vessel account cannot acquire a creation scope for another vessel',
);

const createClaim = await asUser(ids.vesselAccount, async () => {
  const result = await db.query(
    `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,$6) as result`,
    [ids.workspace, 'task-create:vessel-a', 'task-create', 'vessel-a', ids.vesselAccountSession, 75],
  );
  return result.rows[0].result;
});
assert.equal(createClaim.ok, true);
assert.equal(Number(createClaim.fencingToken), 1);

const createdTask = await asUser(ids.vesselAccount, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_create_task($1::uuid,$2::uuid,$3,$4,$5::bigint,$6,$7::uuid,$8,$9,$10) as result`,
    [ids.createTaskOperation, ids.workspace, 'task-created', 'vessel-a', createClaim.fencingToken, 'task-create:vessel-a', ids.vesselAccountSession, 'Created by vessel account', '中', 'open'],
  );
  return result.rows[0].result;
});
assert.equal(createdTask.status, 'committed');
assert.equal(createdTask.entityId, 'task-created');
assert.equal(Number(createdTask.version), 1);

const releasedCreate = await asUser(ids.vesselAccount, async () => {
  const result = await db.query(
    `select public.release_ship_dynamics_entity_lease($1::uuid,$2,$3::uuid,$4::bigint) as released`,
    [ids.workspace, 'task-create:vessel-a', ids.vesselAccountSession, createClaim.fencingToken],
  );
  return result.rows[0].released;
});
assert.equal(releasedCreate, true);

const createdReplay = await asUser(ids.vesselAccount, async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_create_task($1::uuid,$2::uuid,$3,$4,$5::bigint,$6,$7::uuid,$8,$9,$10) as result`,
    [ids.createTaskOperation, ids.workspace, 'task-created', 'vessel-a', createClaim.fencingToken, 'task-create:vessel-a', ids.vesselAccountSession, 'Created by vessel account', '中', 'open'],
  );
  return result.rows[0].result;
});
assert.equal(createdReplay.replayed, true, 'committed replay remains classifiable after lease release');
assert.deepEqual(await visibleTasks(ids.vesselAccount), ['task-a', 'task-created']);

const createdCanonical = await db.query(`
  select source_kind as "sourceKind", is_internal_control as "isInternalControl", version
  from public.sd_tasks
  where workspace_id='${ids.workspace}' and id='task-created'
`);
assert.deepEqual(createdCanonical.rows[0], { sourceKind: 'ordinary', isInternalControl: false, version: 1 });

const finalRows = await db.query(`
  select
    (select description from public.sd_tasks where workspace_id='${ids.workspace}' and id='task-a') as "taskDescription",
    (select version from public.sd_tasks where workspace_id='${ids.workspace}' and id='task-a') as "taskVersion",
    (select note->>'recentDynamics' from public.sd_vessels where workspace_id='${ids.workspace}' and id='vessel-a') as "vesselNote",
    (select version from public.sd_vessels where workspace_id='${ids.workspace}' and id='vessel-a') as "vesselVersion",
    (select count(*)::integer from public.sd_operations where workspace_id='${ids.workspace}') as "operationCount"
`);
assert.deepEqual(finalRows.rows[0], {
  taskDescription: 'Authoritative task update',
  taskVersion: 2,
  vesselNote: 'updated independently',
  vesselVersion: 2,
  operationCount: 3,
});

console.log('normalized_db_vertical_slice=PASS');

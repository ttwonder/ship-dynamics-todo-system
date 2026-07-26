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
  operator: '33333333-3333-4333-8333-333333333333',
};
const ownerSession = 'a2000000-0000-4000-8000-000000000001';
const rollbackOperation = 'b2000000-0000-4000-8000-000000000001';
const successOperation = 'b2000000-0000-4000-8000-000000000002';
const duplicateCaseOperation = 'b2000000-0000-4000-8000-000000000003';
const duplicateTaskOperation = 'b2000000-0000-4000-8000-000000000004';

await db.exec(`
  create schema auth;
  create role anon noinherit;
  create role authenticated noinherit;
  create role service_role noinherit bypassrls;
  create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);
for (const relative of [
  'supabase/normalized-schema.sql',
  'supabase/normalized-core-domain.sql',
  'supabase/normalized-internal-control.sql',
]) {
  await db.exec(await readFile(resolve(root, relative), 'utf8'));
}
await db.exec(`
  insert into auth.users(id,email) values
    ('${ids.owner}','owner@batch.invalid'),
    ('${ids.operator}','operator@batch.invalid');
  insert into public.sd_workspaces(id,legacy_key,name)
    values('${ids.workspace}','internal-batch','Internal batch');
  insert into public.sd_profiles(id,display_name,username_label) values
    ('${ids.owner}','Owner','owner'),
    ('${ids.operator}','Operator','operator');
  insert into public.sd_memberships(workspace_id,user_id,department,role,is_active) values
    ('${ids.workspace}','${ids.owner}','Management','owner',true),
    ('${ids.workspace}','${ids.operator}','Operations','operator',true);
  insert into public.sd_vessels(
    workspace_id,id,name,short_name,full_name,ship_type,fleet_category,
    position,cargo,note,is_active
  ) values (
    '${ids.workspace}','vessel-a','A','A','Vessel A','bulk','bulk fleet',
    '{}','{}','{}',true
  );
  insert into public.sd_vessel_assignments(
    workspace_id,vessel_id,user_id,assignment_kind,is_active
  ) values ('${ids.workspace}','vessel-a','${ids.operator}','manager',true);
`);

async function asOwner(action) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${ids.owner}'`);
  try { return await action(); }
  finally { await db.exec('reset role; reset request.jwt.claim.sub'); }
}
async function claim(leaseKey, entityType, entityId) {
  return asOwner(async () => {
    const result = await db.query(
      `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,75) as result`,
      [ids.workspace, leaseKey, entityType, entityId, ownerSession],
    );
    assert.equal(result.rows[0].result.ok, true);
    return result.rows[0].result;
  });
}
const casePayload = description => ({
  vesselId: 'vessel-a',
  reportDate: '2026-07-26',
  reportSource: '日常',
  description,
  priority: '中',
  category: 'Safety',
  isAware: false,
  status: 'Open',
  origin: 'internal-control',
  isClosed: false,
  departments: ['Operations'],
});
const caseIds = ['case-batch-b', 'case-batch-a'];
const taskIds = ['task-batch-b', 'task-batch-a'];
const caseCreateLease = await claim(
  'internal-case-create:vessel-a',
  'internal-case-create',
  'vessel-a',
);
const taskCreateLease = await claim('task-create:vessel-a', 'task-create', 'vessel-a');
const items = caseIds.map((caseId, index) => ({
  caseId,
  caseLeaseKey: 'internal-case-create:vessel-a',
  caseOwnerSession: ownerSession,
  caseFencingToken: Number(caseCreateLease.fencingToken),
  case: casePayload(index === 0 ? 'First submitted case' : 'Injected second submitted case'),
  task: {
    id: taskIds[index],
    expectedDate: `2026-08-${index + 10}`,
    categories: ['Safety'],
    ownerUserIds: [ids.operator],
  },
  taskLeaseKey: 'task-create:vessel-a',
  taskOwnerSession: ownerSession,
  taskFencingToken: Number(taskCreateLease.fencingToken),
}));
const invoke = (operationId, submittedItems = items) => asOwner(async () => {
  const result = await db.query(
    `select public.command_ship_dynamics_batch_create_internal_cases(
      $1::uuid,$2::uuid,$3::jsonb
    ) as result`,
    [operationId, ids.workspace, JSON.stringify(submittedItems)],
  );
  return result.rows[0].result;
});

await db.exec(`
  create function public.test_fail_second_batch_case()
  returns trigger language plpgsql as $$
  begin
    if new.description = 'Injected second submitted case' then
      raise exception 'injected-second-batch-case';
    end if;
    return new;
  end;
  $$;
  create trigger test_fail_second_batch_case
    before insert on public.sd_internal_cases
    for each row execute function public.test_fail_second_batch_case();
`);
await assert.rejects(
  () => invoke(rollbackOperation),
  /injected-second-batch-case/i,
  'a late submitted-item failure must roll the whole server batch back',
);
const rollbackCounts = await db.query(`
  select
    (select count(*)::integer from public.sd_internal_cases where workspace_id='${ids.workspace}') as cases,
    (select count(*)::integer from public.sd_tasks where workspace_id='${ids.workspace}') as tasks,
    (select count(*)::integer from public.sd_internal_case_task_links where workspace_id='${ids.workspace}') as links,
    (select count(*)::integer from public.sd_audit_events where workspace_id='${ids.workspace}') as audits,
    (select count(*)::integer from public.sd_notifications where workspace_id='${ids.workspace}') as notices
`);
assert.deepEqual(rollbackCounts.rows[0], { cases: 0, tasks: 0, links: 0, audits: 0, notices: 0 });
await assert.rejects(
  () => invoke(duplicateCaseOperation, [
    items[0],
    { ...items[1], caseId: items[0].caseId },
  ]),
  /duplicate-case-identity/i,
  'duplicate case IDs must reject before any submitted item commits',
);
await assert.rejects(
  () => invoke(duplicateTaskOperation, [
    items[0],
    { ...items[1], task: { ...items[1].task, id: items[0].task.id } },
  ]),
  /duplicate-task-identity/i,
  'duplicate task IDs must reject before any submitted item commits',
);
const duplicateCounts = await db.query(`
  select
    (select count(*)::integer from public.sd_internal_cases where workspace_id='${ids.workspace}') as cases,
    (select count(*)::integer from public.sd_tasks where workspace_id='${ids.workspace}') as tasks,
    (select count(*)::integer from public.sd_internal_case_task_links where workspace_id='${ids.workspace}') as links,
    (select count(*)::integer from public.sd_operations where workspace_id='${ids.workspace}') as operations
`);
assert.deepEqual(duplicateCounts.rows[0], { cases: 0, tasks: 0, links: 0, operations: 0 },
  'duplicate rejection must leave the entire batch and operation ledger untouched');
await db.exec(`
  drop trigger test_fail_second_batch_case on public.sd_internal_cases;
  drop function public.test_fail_second_batch_case();
`);

const result = await invoke(successOperation);
assert.deepEqual(
  {
    status: result.status,
    replayed: result.replayed,
    count: Number(result.count),
    caseIds: result.caseIds,
    taskIds: result.taskIds,
  },
  {
    status: 'committed', replayed: false, count: 2,
    caseIds, taskIds,
  },
  'the outer result must preserve deterministic submitted item order',
);
const committedCounts = await db.query(`
  select
    (select count(*)::integer from public.sd_internal_cases where workspace_id='${ids.workspace}') as cases,
    (select count(*)::integer from public.sd_tasks where workspace_id='${ids.workspace}') as tasks,
    (select count(*)::integer from public.sd_internal_case_task_links where workspace_id='${ids.workspace}') as links,
    (select count(*)::integer from public.sd_internal_case_status_events where workspace_id='${ids.workspace}') as case_events,
    (select count(*)::integer from public.sd_task_status_events where workspace_id='${ids.workspace}') as task_events,
    (select count(*)::integer from public.sd_audit_events where workspace_id='${ids.workspace}' and command='batch_create_internal_cases') as audits,
    (select count(*)::integer from public.sd_notifications where workspace_id='${ids.workspace}') as notices,
    (select count(*)::integer from public.sd_operations where workspace_id='${ids.workspace}' and operation_id='${successOperation}') as operations
`);
assert.deepEqual(committedCounts.rows[0], {
  cases: 2, tasks: 2, links: 2, case_events: 2, task_events: 2,
  audits: 4, notices: 2, operations: 1,
});
const replay = await invoke(successOperation);
assert.equal(replay.replayed, true);
assert.deepEqual(replay.caseIds, caseIds);
const replayCounts = await db.query(`
  select
    (select count(*)::integer from public.sd_internal_cases where workspace_id='${ids.workspace}') as cases,
    (select count(*)::integer from public.sd_tasks where workspace_id='${ids.workspace}') as tasks,
    (select count(*)::integer from public.sd_audit_events where workspace_id='${ids.workspace}' and command='batch_create_internal_cases') as audits,
    (select count(*)::integer from public.sd_notifications where workspace_id='${ids.workspace}') as notices
`);
assert.deepEqual(replayCounts.rows[0], { cases: 2, tasks: 2, audits: 4, notices: 2 });

console.log('normalized_internal_batch_db=PASS');

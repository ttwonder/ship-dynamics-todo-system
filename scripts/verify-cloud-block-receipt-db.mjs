import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const DEPLOYED_BASELINE_REF = 'c942853ef108f81c0052946fd36241314d6e0b33';
const db = new PGlite();
const callV2 = async ({ operationId, operations, actorGuard, actorUserId = 'actor-1' }) => {
  const result = await db.query(
    'select public.apply_ship_dynamics_block_patch_v2($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) as value',
    [
      'receipt-workspace',
      operationId,
      JSON.stringify(operations),
      'Operator',
      actorUserId,
      JSON.stringify(actorGuard),
      null,
      JSON.stringify([{ section_key: 'vessel:v1', locked_by: 'lease-v1' }]),
    ],
  );
  return result.rows[0].value;
};
const getReceipt = async ({ operationId, operations, actorGuard, actorUserId = 'actor-1' }) => {
  const result = await db.query(
    'select public.get_ship_dynamics_block_patch_receipt($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) as value',
    [
      'receipt-workspace',
      operationId,
      JSON.stringify(operations),
      'Operator',
      actorUserId,
      JSON.stringify(actorGuard),
      null,
      JSON.stringify([{ section_key: 'vessel:v1', locked_by: 'lease-v1' }]),
    ],
  );
  return result.rows[0].value;
};

try {
  await db.exec('create role anon nologin; create role authenticated nologin; create role untrusted_probe nologin;');
  const baselineRef = process.env.CLOUD_BLOCK_BASELINE_REF?.trim();
  if (baselineRef) {
    await db.exec(execFileSync('git', ['show', `${baselineRef}:supabase/schema.sql`], { encoding: 'utf8' }));
    const migrationSql = fs.readFileSync('supabase/migrations/20260904161000_appdata_compact_ack_receipts.sql', 'utf8');
    const aclMarker = 'revoke all on function public.apply_ship_dynamics_block_patch_v2';
    const aclOffset = migrationSql.indexOf(aclMarker);
    assert.ok(aclOffset > 0, 'migration ACL marker must exist');
    await db.exec(migrationSql.slice(0, aclOffset));
    await db.exec('grant select on table public.ship_dynamics_block_operations to public;');
    await db.exec(migrationSql.slice(aclOffset));
  } else {
    await db.exec(fs.readFileSync('supabase/schema.sql', 'utf8'));
  }

  const permissions = {
    viewAllVessels: false,
    editBusinessContent: true,
    createTasks: true,
    closeTasks: true,
    deleteTasks: false,
    manageMeetings: false,
    exportReports: true,
    enterManagement: false,
    manageUsers: false,
    manageVessels: false,
    viewAuditLogs: false,
    manageRolePermissions: false,
    manageSystemSettings: false,
  };
  const actor = { id: 'actor-1', name: 'Operator', role: 'operator', isActive: true, managedVesselIds: ['v1'] };
  const vessel = { id: 'v1', name: 'V1', isActive: true, assignedUserIds: [], delegateManagers: [], position: 'A' };
  const payload = {
    revision: 1,
    updatedAt: '2026-09-04T00:00:00.000Z',
    settings: { rolePermissions: { operator: permissions }, nonOwnerPasswordResetVersion: 2, sitePasswordHash: '' },
    users: [actor],
    vessels: [vessel],
    tasks: [],
    internalControlCases: [],
    meetings: [],
    agendaReports: [],
    taskDismissals: [],
    notifications: [],
    auditLogs: [],
  };
  await db.query(
    'insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values ($1,$2::jsonb,$3,$4)',
    ['receipt-workspace', JSON.stringify(payload), 1, 'seed'],
  );
  await db.query(
    "insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('receipt-workspace','vessel:v1','lease-v1','Operator',now()+interval '60 seconds')",
  );
  const actorGuard = (await db.query(
    'select public.ship_dynamics_actor_guard($1::jsonb,$2) as value',
    [JSON.stringify(payload), actor.id],
  )).rows[0].value;
  const operations = [{
    kind: 'entity',
    collection: 'vessels',
    entityId: vessel.id,
    expected: vessel,
    value: { ...vessel, position: 'B' },
  }];

  const first = await callV2({ operationId: 'block-op-1', operations, actorGuard });
  assert.equal(first.ok, true);
  assert.equal(first.operation_id, 'block-op-1');
  assert.equal(first.revision, 2);
  assert.equal(first.replayed, false);
  assert.equal(Object.hasOwn(first, 'payload'), false, 'v2 response must stay compact and must not return the AppData payload');

  const stored = (await db.query("select payload,revision from public.ship_dynamics_app_state where workspace_key='receipt-workspace'")).rows[0];
  assert.equal(stored.revision, 2);
  assert.equal(stored.payload.vessels[0].position, 'B', 'compact RPC must still commit the exact block mutation');
  assert.equal(Number((await db.query("select count(*) as count from public.ship_dynamics_app_revisions where workspace_key='receipt-workspace' and revision=2")).rows[0].count), 1);

  const receipt = (await db.query("select actor_user_id,request_payload,result from public.ship_dynamics_block_operations where workspace_key='receipt-workspace' and operation_id='block-op-1'")).rows[0];
  assert.equal(receipt.actor_user_id, actor.id);
  assert.deepEqual(receipt.request_payload.operations, operations);
  assert.equal(Object.hasOwn(receipt.request_payload, 'payload'), false, 'receipt may retain the exact patch request but never a full AppData snapshot');
  assert.equal(receipt.result.revision, 2);

  const replay = await callV2({ operationId: 'block-op-1', operations, actorGuard });
  assert.equal(replay.ok, true);
  assert.equal(replay.revision, 2);
  assert.equal(replay.replayed, true, 'exact operation replay must return the committed compact receipt');
  assert.equal(Number((await db.query("select count(*) as count from public.ship_dynamics_app_revisions where workspace_key='receipt-workspace'")).rows[0].count), 2, 'replay must not create another revision');

  const mismatchedOperations = [{ ...operations[0], value: { ...vessel, position: 'C' } }];
  const mismatched = await callV2({
    operationId: 'block-op-1',
    operations: mismatchedOperations,
    actorGuard,
  });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.code, 'operation-mismatch', 'same operation id with different request bytes must fail closed');
  assert.equal((await db.query("select payload from public.ship_dynamics_app_state where workspace_key='receipt-workspace'")).rows[0].payload.vessels[0].position, 'B');

  const status = await getReceipt({ operationId: 'block-op-1', operations, actorGuard });
  assert.equal(status.status, 'committed');
  assert.equal(status.revision, 2);
  assert.equal(Object.hasOwn(status, 'payload'), false);

  const mismatchedStatus = await getReceipt({ operationId: 'block-op-1', operations: mismatchedOperations, actorGuard });
  assert.equal(mismatchedStatus.status, 'mismatch');
  assert.equal(mismatchedStatus.code, 'operation-mismatch', 'receipt lookup must bind the same canonical request as the write RPC');

  const wrongActor = await getReceipt({ operationId: 'block-op-1', operations, actorGuard, actorUserId: 'other-actor' });
  assert.equal(wrongActor.status, 'missing', 'receipt status must not disclose another actor operation');

  const functionConfigs = await db.query(`
    select proname,proconfig
    from pg_proc
    where pronamespace='public'::regnamespace
      and proname in ('apply_ship_dynamics_block_patch','apply_ship_dynamics_block_patch_v2')
    order by proname
  `);
  assert.equal(functionConfigs.rows.length, 2);
  for (const row of functionConfigs.rows) {
    assert.ok(row.proconfig?.some(value => value === 'statement_timeout=8s'), `${row.proname} must have an isolated 8 second statement timeout`);
  }
  const statusConfig = (await db.query(`
    select proconfig
    from pg_proc
    where oid='public.get_ship_dynamics_block_patch_receipt(text,text,jsonb,text,text,jsonb,jsonb,jsonb)'::regprocedure
  `)).rows[0]?.proconfig;
  assert.equal(
    statusConfig?.some(value => value.startsWith('statement_timeout=')) ?? false,
    false,
    'receipt status lookup must retain the platform default timeout; only write RPCs get the isolated 8 second override',
  );

  const privileges = (await db.query(`
    select
      (select relrowsecurity from pg_class where oid='public.ship_dynamics_block_operations'::regclass) as rls_enabled,
      has_table_privilege('anon','public.ship_dynamics_block_operations','select') as anon_table_select,
      has_table_privilege('authenticated','public.ship_dynamics_block_operations','select') as authenticated_table_select,
      has_table_privilege('untrusted_probe','public.ship_dynamics_block_operations','select') as untrusted_table_select,
      has_function_privilege('anon','public.apply_ship_dynamics_block_patch_v2(text,text,jsonb,text,text,jsonb,jsonb,jsonb)','execute') as anon_write_execute,
      has_function_privilege('anon','public.get_ship_dynamics_block_patch_receipt(text,text,jsonb,text,text,jsonb,jsonb,jsonb)','execute') as anon_status_execute,
      has_function_privilege('authenticated','public.apply_ship_dynamics_block_patch_v2(text,text,jsonb,text,text,jsonb,jsonb,jsonb)','execute') as authenticated_write_execute,
      has_function_privilege('authenticated','public.get_ship_dynamics_block_patch_receipt(text,text,jsonb,text,text,jsonb,jsonb,jsonb)','execute') as authenticated_status_execute,
      has_function_privilege('untrusted_probe','public.apply_ship_dynamics_block_patch_v2(text,text,jsonb,text,text,jsonb,jsonb,jsonb)','execute') as untrusted_write_execute,
      has_function_privilege('untrusted_probe','public.get_ship_dynamics_block_patch_receipt(text,text,jsonb,text,text,jsonb,jsonb,jsonb)','execute') as untrusted_status_execute
  `)).rows[0];
  assert.deepEqual(privileges, {
    rls_enabled: true,
    anon_table_select: false,
    authenticated_table_select: false,
    untrusted_table_select: false,
    anon_write_execute: true,
    anon_status_execute: true,
    authenticated_write_execute: true,
    authenticated_status_execute: true,
    untrusted_write_execute: false,
    untrusted_status_execute: false,
  });

  console.log('cloud_block_receipt_db=PASS');
} finally {
  await db.close();
}

if (!process.env.CLOUD_BLOCK_BASELINE_REF) {
  execFileSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(),
    env: { ...process.env, CLOUD_BLOCK_BASELINE_REF: DEPLOYED_BASELINE_REF },
    stdio: 'inherit',
  });
}

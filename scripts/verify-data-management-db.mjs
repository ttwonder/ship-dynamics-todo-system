import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const resultOf = async (sql, params = []) => (await db.query(sql, params)).rows[0].result;

try {
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create schema storage;
    create table storage.objects (
      id uuid primary key,
      bucket_id text not null,
      name text not null,
      metadata jsonb
    );
  `);
  await db.exec(fs.readFileSync('supabase/schema.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20260817143000_data_management_storage.sql', 'utf8'));

  const payload = {
    revision: 1,
    updatedAt: '2026-08-17T05:00:00.000Z',
    settings: { sitePasswordHash: 'hash', rolePermissions: {} },
    users: [
      { id: 'owner-1', name: 'Owner', username: 'owner', role: 'owner', isActive: true, managedVesselIds: [] },
      { id: 'admin-1', name: 'Admin', username: 'admin', role: 'admin', isActive: true, managedVesselIds: [] },
      { id: 'operator-1', name: 'Operator', username: 'operator', role: 'operator', isActive: true, managedVesselIds: [] },
    ],
    vessels: [{ id: 'vessel-1', shortName: '測試輪', name: '測試輪', isActive: true }],
    tasks: [{ id: 'task-1', description: '測試待辦內容', status: '處理中' }],
    internalControlCases: [{ id: 'ic-1', description: '內控測試' }],
    meetings: [{ id: 'meeting-1', subject: '臨時會議' }],
    agendaReports: [{ id: 'report-1', title: '早會報告' }],
    taskDismissals: [{ id: 'dismiss-1', itemKind: 'task', itemId: 'task-1' }],
    auditLogs: [{ id: 'audit-1', action: '建立待辦', detail: '測試' }],
    notifications: [{ id: 'notice-1', title: '新待辦', message: '測試通知' }],
  };

  await db.query(`
    insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_at,updated_by)
    values($1,$2::jsonb,1,$3,'Owner')
  `, ['workspace', JSON.stringify(payload), payload.updatedAt]);
  for (const revision of [2, 3]) {
    payload.revision = revision;
    payload.updatedAt = `2026-08-17T05:0${revision}:00.000Z`;
    payload.tasks[0].status = `版本 ${revision}`;
    await db.query(`
      update public.ship_dynamics_app_state
      set payload=$1::jsonb,revision=$2,updated_at=$3,updated_by=$4
      where workspace_key='workspace'
    `, [JSON.stringify(payload), revision, payload.updatedAt, revision === 2 ? 'Admin' : 'Owner']);
  }
  await db.query(`insert into storage.objects(id,bucket_id,name,metadata) values($1,'assets','one.bin',$2::jsonb)`, [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    JSON.stringify({ size: 2048 }),
  ]);

  const ownerStats = await resultOf(
    'select public.get_ship_dynamics_storage_stats($1,$2) as result',
    ['workspace', 'owner-1'],
  );
  assert.equal(ownerStats.ok, true);
  assert.equal(ownerStats.currentRevision, 3);
  assert.equal(Number(ownerStats.revisionHistoryCount), 3);
  assert.equal(Number(ownerStats.storageObjectCount), 1);
  assert.equal(Number(ownerStats.storageObjectBytes), 2048);
  assert.ok(Number(ownerStats.databaseTotalBytes) > 0);
  assert.ok(Number(ownerStats.appDatabasePhysicalBytes) > 0);
  assert.ok(Number(ownerStats.currentStateBytes) > 0);
  assert.ok(Number(ownerStats.revisionHistoryBytes) > Number(ownerStats.currentStateBytes));
  assert.deepEqual(ownerStats.revisions.map(row => row.revision), [3, 2, 1]);
  assert.equal(ownerStats.revisions.find(row => row.revision === 3).current, true);
  assert.ok(ownerStats.collections.some(row => row.key === 'tasks' && Number(row.itemCount) === 1));
  assert.ok(ownerStats.items.some(row => row.collectionKey === 'tasks' && row.id === 'task-1' && Number(row.logicalBytes) > 0));

  const adminStats = await resultOf(
    'select public.get_ship_dynamics_storage_stats($1,$2) as result',
    ['workspace', 'admin-1'],
  );
  assert.equal(adminStats.ok, true, 'Admin may read storage statistics');
  const operatorStats = await resultOf(
    'select public.get_ship_dynamics_storage_stats($1,$2) as result',
    ['workspace', 'operator-1'],
  );
  assert.deepEqual(operatorStats, { ok: false, error: 'FORBIDDEN' });

  const adminPrune = await resultOf(
    'select public.prune_ship_dynamics_revision_history($1,$2,$3,$4::jsonb,$5::jsonb) as result',
    ['workspace', 'admin-1', '00000000-0000-4000-8000-000000000001', '[1,2,3]', '[1]'],
  );
  assert.equal(adminPrune.error, 'OWNER_REQUIRED');

  const oversizedRevision = await resultOf(
    'select public.prune_ship_dynamics_revision_history($1,$2,$3,$4::jsonb,$5::jsonb) as result',
    ['workspace', 'owner-1', '00000000-0000-4000-8000-000000000009', '[1,2,999999999999999999999999]', '[1]'],
  );
  assert.equal(oversizedRevision.error, 'INVALID_PAYLOAD', 'hostile numeric input must be rejected without a cast exception');

  const stale = await resultOf(
    'select public.prune_ship_dynamics_revision_history($1,$2,$3,$4::jsonb,$5::jsonb) as result',
    ['workspace', 'owner-1', '00000000-0000-4000-8000-000000000002', '[1,2]', '[1]'],
  );
  assert.equal(stale.error, 'REVISION_SET_CHANGED');
  assert.equal(Number((await db.query("select count(*)::int as count from public.ship_dynamics_app_revisions where workspace_key='workspace'")).rows[0].count), 3);

  const protectedCurrent = await resultOf(
    'select public.prune_ship_dynamics_revision_history($1,$2,$3,$4::jsonb,$5::jsonb) as result',
    ['workspace', 'owner-1', '00000000-0000-4000-8000-000000000003', '[1,2,3]', '[3]'],
  );
  assert.equal(protectedCurrent.error, 'CURRENT_REVISION_PROTECTED');

  const operationId = '00000000-0000-4000-8000-000000000004';
  const pruned = await resultOf(
    'select public.prune_ship_dynamics_revision_history($1,$2,$3,$4::jsonb,$5::jsonb) as result',
    ['workspace', 'owner-1', operationId, '[3,1,2]', '[1]'],
  );
  assert.equal(pruned.ok, true);
  assert.equal(Number(pruned.deletedCount), 1);
  assert.ok(Number(pruned.deletedBytes) > 0);
  assert.deepEqual(pruned.deletedRevisions, [1]);
  assert.equal(Number(pruned.remainingRevisionCount), 2);
  assert.equal(Number(pruned.currentRevision), 3);

  const remaining = (await db.query("select revision from public.ship_dynamics_app_revisions where workspace_key='workspace' order by revision")).rows.map(row => row.revision);
  assert.deepEqual(remaining, [2, 3]);
  const current = (await db.query("select revision,payload from public.ship_dynamics_app_state where workspace_key='workspace'")).rows[0];
  assert.equal(current.revision, 3);
  assert.equal(current.payload.tasks[0].id, 'task-1', 'pruning must not change current business content');

  const replay = await resultOf(
    'select public.prune_ship_dynamics_revision_history($1,$2,$3,$4::jsonb,$5::jsonb) as result',
    ['workspace', 'owner-1', operationId, '[1,2,3]', '[1]'],
  );
  assert.deepEqual(replay, pruned, 'lost-ACK replay must return the committed result');
  assert.equal(Number((await db.query("select count(*)::int as count from public.ship_dynamics_app_revisions where workspace_key='workspace'")).rows[0].count), 2);

  const mismatch = await resultOf(
    'select public.prune_ship_dynamics_revision_history($1,$2,$3,$4::jsonb,$5::jsonb) as result',
    ['workspace', 'owner-1', operationId, '[2,3]', '[2]'],
  );
  assert.equal(mismatch.error, 'IDEMPOTENCY_MISMATCH');

  const afterStats = await resultOf(
    'select public.get_ship_dynamics_storage_stats($1,$2) as result',
    ['workspace', 'owner-1'],
  );
  assert.equal(Number(afterStats.revisionHistoryCount), 2);
  assert.ok(Number(afterStats.revisionHistoryBytes) < Number(ownerStats.revisionHistoryBytes));
  assert.equal(afterStats.revisions.find(row => row.revision === 3).current, true);

  const privileges = (await db.query(`
    select
      has_function_privilege('anon','public.get_ship_dynamics_storage_stats(text,text)','EXECUTE') as stats_anon,
      has_function_privilege('anon','public.prune_ship_dynamics_revision_history(text,text,uuid,jsonb,jsonb)','EXECUTE') as prune_anon,
      has_table_privilege('anon','public.ship_dynamics_data_management_operations','SELECT') as operations_select,
      has_table_privilege('anon','public.ship_dynamics_data_management_operations','DELETE') as operations_delete
  `)).rows[0];
  assert.equal(privileges.stats_anon, true);
  assert.equal(privileges.prune_anon, true);
  assert.equal(privileges.operations_select, false);
  assert.equal(privileges.operations_delete, false);

  console.log('Data management PostgreSQL runtime contract passed.');
} finally {
  await db.close();
}

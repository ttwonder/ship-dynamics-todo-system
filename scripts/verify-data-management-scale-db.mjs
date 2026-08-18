import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';

const REVISION_COUNT = 2437;
const PAYLOAD_BYTES_FLOOR = 1_150_000;
const migrationPath = 'supabase/migrations/20260817143000_data_management_storage.sql';
const patchPath = 'supabase/migrations/20260818003000_data_management_storage_timeout_fix.sql';
const batchLimitPatchPath = 'supabase/migrations/20260818154500_data_management_prune_batch_limit.sql';
const migration = fs.readFileSync(migrationPath, 'utf8');
const patchMigration = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '';

for (const [label, source] of [['fresh-install migration', migration], ['deployed-project patch', patchMigration]]) {
  assert.ok(source, `${label} must exist`);
  assert.doesNotMatch(source, /pg_column_size\(r\)(?!\.)/, `${label} must not size a composite revision row`);
  assert.doesNotMatch(source, /pg_column_size\(s\)(?!\.)/, `${label} must not size the composite current-state row`);
  assert.match(source, /pg_column_size\(r\.payload\)/, `${label} must read scalar payload size metadata`);
  assert.match(source, /pg_column_size\(s\.payload\)/, `${label} must read scalar current payload size metadata`);
}

const db = new PGlite();
try {
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create schema storage;
    create table storage.objects(id uuid primary key, bucket_id text, name text, metadata jsonb);
  `);
  await db.exec(fs.readFileSync('supabase/schema.sql', 'utf8'));
  await db.exec(migration);
  await db.exec(patchMigration);
  await db.exec(fs.readFileSync(batchLimitPatchPath, 'utf8'));

  const payload = {
    revision: REVISION_COUNT,
    updatedAt: '2026-08-18T00:00:00.000Z',
    settings: { sitePasswordHash: 'hash', rolePermissions: {} },
    users: [{ id: 'owner-1', name: 'Owner', username: 'owner', role: 'owner', isActive: true, managedVesselIds: [] }],
    vessels: [], tasks: [], internalControlCases: [], meetings: [], agendaReports: [], taskDismissals: [], auditLogs: [], notifications: [],
    productionScaleBlob: 'x'.repeat(1_200_000),
  };
  const serialized = JSON.stringify(payload);
  assert.ok(Buffer.byteLength(serialized) >= PAYLOAD_BYTES_FLOOR);

  await db.query(`
    insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by)
    values('workspace',$1::jsonb,$2,'Owner')
  `, [serialized, REVISION_COUNT]);
  await db.query(`
    insert into public.ship_dynamics_app_revisions(workspace_key,revision,payload,saved_by,saved_at)
    select 'workspace',value,$1::jsonb,'Owner',clock_timestamp()
    from generate_series(1,$2) value
  `, [serialized, REVISION_COUNT - 1]);

  const start = performance.now();
  const stats = (await db.query(`select public.get_ship_dynamics_storage_stats('workspace','owner-1') as result`)).rows[0].result;
  const elapsedMs = Math.round(performance.now() - start);
  assert.equal(stats.ok, true);
  assert.equal(Number(stats.revisionHistoryCount), REVISION_COUNT);
  assert.equal(stats.revisions.length, REVISION_COUNT);
  assert.equal(stats.revisions[0].revision, REVISION_COUNT);
  assert.equal(stats.revisions.at(-1).revision, 1);
  assert.ok(Number(stats.revisionHistoryBytes) > 0);
  assert.ok(Number(stats.currentStateBytes) > 0);
  assert.ok(elapsedMs < 1500, `production-shaped stats took ${elapsedMs}ms`);

  const expectedBytes = Number((await db.query(`
    select sum(
      pg_column_size(r.payload)
      + pg_column_size(r.workspace_key)
      + pg_column_size(r.revision)
      + coalesce(pg_column_size(r.saved_by),0)
      + pg_column_size(r.saved_at)
    )::bigint as bytes
    from public.ship_dynamics_app_revisions r
    where workspace_key='workspace'
  `)).rows[0].bytes);
  assert.equal(Number(stats.revisionHistoryBytes), expectedBytes);

  const expectedRevisions = Array.from({ length: REVISION_COUNT }, (_, index) => index + 1);
  const oversized = (await db.query(`
    select public.prune_ship_dynamics_revision_history($1,$2,$3,$4::jsonb,$5::jsonb) as result
  `, ['workspace', 'owner-1', '00000000-0000-4000-8000-000000009998', JSON.stringify(expectedRevisions), JSON.stringify(expectedRevisions.slice(0, 101))])).rows[0].result;
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error, 'BATCH_LIMIT_EXCEEDED');
  assert.equal(Number((await db.query(`select count(*)::int as count from public.ship_dynamics_app_revisions where workspace_key='workspace'`)).rows[0].count), REVISION_COUNT);

  const prune = (await db.query(`
    select public.prune_ship_dynamics_revision_history($1,$2,$3,$4::jsonb,$5::jsonb) as result
  `, ['workspace', 'owner-1', '00000000-0000-4000-8000-000000009999', JSON.stringify(expectedRevisions), '[1]'])).rows[0].result;
  assert.equal(prune.ok, true);
  assert.equal(Number(prune.deletedCount), 1);
  assert.ok(Number(prune.deletedBytes) > 0);
  assert.equal(Number(prune.remainingRevisionCount), REVISION_COUNT - 1);
  assert.equal(Number((await db.query(`select count(*)::int as count from public.ship_dynamics_app_revisions where workspace_key='workspace'`)).rows[0].count), REVISION_COUNT - 1);

  console.log(`Data management production-scale contract passed: revisions=${REVISION_COUNT} elapsed_ms=${elapsedMs}.`);
} finally {
  await db.close();
}

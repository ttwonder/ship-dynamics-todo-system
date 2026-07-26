import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  assertStagingTarget,
  buildNormalizedDeploymentBundle,
  migrationBody,
  postgresEnvironment,
  runApplyManifestCli,
} from './apply-normalized-manifest.mjs';

assert.equal(migrationBody('begin;\nselect 1;\ncommit;\n', 'fixture').trim(), '-- manifest:fixture\nselect 1;');
assert.throws(() => migrationBody('select 1;', 'bad'), /migration-transaction-invalid/);
const first = await buildNormalizedDeploymentBundle();
const second = await buildNormalizedDeploymentBundle();
assert.equal(first.files, 10);
assert.equal(first.version, 1);
assert.equal(first.sha256, second.sha256);
assert.match(first.sha256, /^[0-9a-f]{64}$/);
assert.equal((first.sql.match(/^begin;$/gim) || []).length, 1);
assert.equal((first.sql.match(/^commit;$/gim) || []).length, 1);
assert.equal((first.sql.match(/^-- manifest:/gm) || []).length, 10);

const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../public/supabase-config.js', import.meta.url), 'utf8'), sandbox);
const productionRef = new URL(sandbox.window.SHIP_DYNAMICS_SUPABASE_CONFIG.supabaseUrl).hostname.split('.')[0];
assert.throws(
  () => assertStagingTarget(`postgresql://postgres:secret@db.${productionRef}.supabase.co:5432/postgres`, 'staging', `staging:db.${productionRef}.supabase.co:1`, 1, productionRef),
  /production-target-refused/,
);
assert.throws(
  () => assertStagingTarget('postgresql://postgres:secret@db.staging-ref.supabase.co:5432/postgres', 'production', 'staging:db.staging-ref.supabase.co:1', 1, productionRef),
  /staging-target-required/,
);
assert.equal(
  assertStagingTarget('postgresql://postgres:secret@db.staging-ref.supabase.co:5432/postgres', 'staging', 'staging:db.staging-ref.supabase.co:1', 1, productionRef),
  'db.staging-ref.supabase.co',
);
const connectionEnvironment = postgresEnvironment(
  'postgresql://db-user:p%40ss@127.0.0.1:55432/ship_test?sslmode=disable',
  { SAFE_BASE: 'yes' },
);
assert.deepEqual({
  host: connectionEnvironment.PGHOST,
  port: connectionEnvironment.PGPORT,
  user: connectionEnvironment.PGUSER,
  password: connectionEnvironment.PGPASSWORD,
  database: connectionEnvironment.PGDATABASE,
  sslmode: connectionEnvironment.PGSSLMODE,
  base: connectionEnvironment.SAFE_BASE,
}, {
  host: '127.0.0.1', port: '55432', user: 'db-user', password: 'p@ss',
  database: 'ship_test', sslmode: 'disable', base: 'yes',
});
const logs = [];
const originalLog = console.log;
console.log = message => logs.push(String(message));
try {
  assert.equal(await runApplyManifestCli([], {}), 0);
} finally {
  console.log = originalLog;
}
const dryRun = JSON.parse(logs.at(-1));
assert.deepEqual(dryRun, { status: 'ready', version: 1, files: 10, sha256: first.sha256 });
console.log('normalized_manifest_apply=PASS');

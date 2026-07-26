import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  assertStagingTarget,
  buildNormalizedDeploymentBundle,
  migrationBody,
  runApplyManifestCli,
} from './apply-normalized-manifest.mjs';

assert.equal(migrationBody('begin;\nselect 1;\ncommit;\n', 'fixture').trim(), '-- manifest:fixture\nselect 1;');
assert.throws(() => migrationBody('select 1;', 'bad'), /migration-transaction-invalid/);
const first = await buildNormalizedDeploymentBundle();
const second = await buildNormalizedDeploymentBundle();
assert.equal(first.files, 9);
assert.equal(first.version, 1);
assert.equal(first.sha256, second.sha256);
assert.match(first.sha256, /^[0-9a-f]{64}$/);
assert.equal((first.sql.match(/^begin;$/gim) || []).length, 1);
assert.equal((first.sql.match(/^commit;$/gim) || []).length, 1);
assert.equal((first.sql.match(/^-- manifest:/gm) || []).length, 9);

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
const logs = [];
const originalLog = console.log;
console.log = message => logs.push(String(message));
try {
  assert.equal(await runApplyManifestCli([], {}), 0);
} finally {
  console.log = originalLog;
}
const dryRun = JSON.parse(logs.at(-1));
assert.deepEqual(dryRun, { status: 'ready', version: 1, files: 9, sha256: first.sha256 });
console.log('normalized_manifest_apply=PASS');

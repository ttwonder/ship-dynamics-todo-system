import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertCutoverTarget,
  decryptAndVerifyLegacyBackup,
  encryptLegacyBackup,
  runLegacyCutoverCli,
} from './legacy-cutover-operations.mjs';

const productionRef = 'production-ref';
assert.throws(
  () => assertCutoverTarget(
    'https://production-ref.supabase.co', 'staging',
    'staging:backup:fixture:7', 'backup', 'fixture', 7, productionRef,
  ),
  /production-target-refused/,
);
assert.throws(
  () => assertCutoverTarget(
    'https://staging-ref.supabase.co', 'production',
    'staging:backup:fixture:7', 'backup', 'fixture', 7, productionRef,
  ),
  /staging-target-required/,
);
assert.equal(
  assertCutoverTarget(
    'https://staging-ref.supabase.co', 'staging',
    'staging:backup:fixture:7', 'backup', 'fixture', 7, productionRef,
  ),
  'staging-ref.supabase.co',
);

const payloadText = '{"b": 1, "aa": 2}';
const payloadSha256 = createHash('sha256').update(payloadText).digest('hex');
const serverBackup = {
  workspaceKey: 'fixture',
  revision: 7,
  payloadText,
  payloadSha256,
  updatedAt: '2026-07-25T23:59:59.000Z',
  updatedBy: 'legacy-owner',
  exportedAt: '2026-07-26T00:00:00.000Z',
};
const encrypted = encryptLegacyBackup(serverBackup, 'correct horse battery staple', {
  salt: Buffer.alloc(16, 1),
  iv: Buffer.alloc(12, 2),
});
assert.deepEqual(decryptAndVerifyLegacyBackup(encrypted, 'correct horse battery staple'), serverBackup);
const tampered = structuredClone(encrypted);
tampered.ciphertext = `${tampered.ciphertext.slice(0, -2)}AA`;
assert.throws(() => decryptAndVerifyLegacyBackup(tampered, 'correct horse battery staple'), /backup|authenticate|integrity/i);

const directory = await mkdtemp(join(tmpdir(), 'ship-cutover-'));
try {
  const backupPath = join(directory, 'legacy-backup.enc.json');
  const rpcCalls = [];
  const clientFactory = () => ({
    rpc: async (name, args) => {
      rpcCalls.push([name, args]);
      if (name === 'export_ship_dynamics_legacy_backup') return { data: serverBackup, error: null };
      const status = name.includes('reenable') ? 'write-enabled' : name.includes('restore') ? 'restored' : 'frozen';
      return { data: { status, payloadSha256: args.p_payload_sha256 || payloadSha256 }, error: null };
    },
  });
  const baseEnvironment = {
    MIGRATION_TARGET: 'staging',
    MIGRATION_SUPABASE_URL: 'https://staging-ref.supabase.co',
    MIGRATION_SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-placeholder',
    MIGRATION_PACKAGE_PASSPHRASE: 'correct horse battery staple',
  };
  assert.equal(await runLegacyCutoverCli([
    'backup', '--workspace-key', 'fixture', '--revision', '7', '--output', backupPath,
    '--confirm', 'staging:backup:fixture:7',
  ], baseEnvironment, { clientFactory, productionRef }), 0);
  const stored = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.deepEqual(decryptAndVerifyLegacyBackup(stored, baseEnvironment.MIGRATION_PACKAGE_PASSPHRASE), serverBackup);

  assert.equal(await runLegacyCutoverCli([
    'verify', '--input', backupPath,
  ], { MIGRATION_PACKAGE_PASSPHRASE: baseEnvironment.MIGRATION_PACKAGE_PASSPHRASE }, { productionRef }), 0);
  assert.equal(await runLegacyCutoverCli([
    'freeze', '--workspace-key', 'fixture', '--revision', '7',
    '--confirm', 'staging:freeze:fixture:7',
  ], baseEnvironment, { clientFactory, productionRef }), 0);
  assert.equal(await runLegacyCutoverCli([
    'restore', '--input', backupPath,
    '--confirm', `staging:restore:fixture:7:${payloadSha256}`,
  ], baseEnvironment, { clientFactory, productionRef }), 0);
  assert.equal(await runLegacyCutoverCli([
    'reenable', '--input', backupPath,
    '--confirm', `staging:reenable:fixture:7:${payloadSha256}`,
  ], baseEnvironment, { clientFactory, productionRef }), 0);

  assert.deepEqual(rpcCalls.map(([name]) => name), [
    'export_ship_dynamics_legacy_backup',
    'freeze_ship_dynamics_legacy_writes',
    'restore_ship_dynamics_legacy_backup',
    'reenable_ship_dynamics_legacy_writes',
  ]);
  const restoreArgs = rpcCalls.at(-2)[1];
  assert.equal(restoreArgs.p_payload_sha256, payloadSha256);
  assert.deepEqual(restoreArgs.p_legacy_payload, { b: 1, aa: 2 });
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('legacy_cutover_operations=PASS');

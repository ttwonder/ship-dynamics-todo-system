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
const productionHost = 'production-ref.supabase.co';
const confirmedPayloadSha256 = 'a'.repeat(64);
const productionApproval = action => `APPROVE-PRODUCTION-ROLLBACK:${action}:fixture:7:${confirmedPayloadSha256}`;
const productionConfirmation = action => `production:${action}:fixture:7:${confirmedPayloadSha256}`;
const exactProductionTarget = action => ({
  targetUrl: `https://${productionHost}`,
  target: 'production',
  confirmation: productionConfirmation(action),
  action,
  workspaceKey: 'fixture',
  revision: 7,
  payloadSha256: confirmedPayloadSha256,
  productionRef,
  productionHost,
  suppliedProductionRef: productionRef,
  suppliedProductionHost: productionHost,
  allowProductionRollback: 'I_UNDERSTAND_THIS_CHANGES_PRODUCTION',
  productionApproval: productionApproval(action),
});

assert.throws(
  () => assertCutoverTarget({
    ...exactProductionTarget('backup'),
    allowProductionRollback: undefined,
  }),
  /production-rollback-default-deny/,
);
assert.throws(
  () => assertCutoverTarget({
    ...exactProductionTarget('backup'),
    targetUrl: 'https://wrong.supabase.co',
  }),
  /production-host-mismatch/,
);
assert.throws(
  () => assertCutoverTarget({
    ...exactProductionTarget('backup'),
    suppliedProductionRef: 'wrong-ref',
  }),
  /production-project-ref-mismatch/,
);
assert.throws(
  () => assertCutoverTarget({
    ...exactProductionTarget('backup'),
    confirmation: `staging:backup:fixture:7:${confirmedPayloadSha256}`,
  }),
  /confirmation-mismatch/,
  'staging confirmation must never authorize a production operation',
);
assert.throws(
  () => assertCutoverTarget({
    ...exactProductionTarget('backup'),
    confirmation: productionConfirmation('restore'),
  }),
  /confirmation-mismatch/,
);
assert.throws(
  () => assertCutoverTarget({
    ...exactProductionTarget('backup'),
    confirmation: `production:backup:fixture:7:${'b'.repeat(64)}`,
  }),
  /confirmation-mismatch/,
);
assert.throws(
  () => assertCutoverTarget({
    ...exactProductionTarget('backup'),
    productionApproval: productionApproval('restore'),
  }),
  /production-approval-mismatch/,
);
assert.equal(assertCutoverTarget(exactProductionTarget('backup')), productionHost);
assert.equal(assertCutoverTarget({
  targetUrl: 'https://staging-ref.supabase.co',
  target: 'staging',
  confirmation: `staging:backup:fixture:7:${confirmedPayloadSha256}`,
  action: 'backup',
  workspaceKey: 'fixture',
  revision: 7,
  payloadSha256: confirmedPayloadSha256,
  productionRef,
  productionHost,
}), 'staging-ref.supabase.co');

const payloadText = '{"b": 1, "aa": 2}';
const payloadSha256 = createHash('sha256').update(payloadText).digest('hex');
const serverBackup = {
  workspaceKey: 'fixture',
  revision: 7,
  payloadText,
  payloadSha256,
  updatedAt: '2026-07-25T23:59:59.000Z',
  updatedBy: 'legacy-owner',
  frozenAt: '2026-07-26T00:00:00.000Z',
  exportedAt: '2026-07-26T00:00:01.000Z',
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
  let frozen = false;
  const clientFactory = () => ({
    rpc: async (name, args) => {
      rpcCalls.push([name, args]);
      if (name === 'freeze_ship_dynamics_legacy_writes') {
        if (args.p_expected_revision !== 7 || args.p_expected_payload_sha256 !== payloadSha256) {
          return { data: null, error: { code: 'snapshot-mismatch' } };
        }
        frozen = true;
        return { data: { status: 'frozen', revision: 7, payloadSha256 }, error: null };
      }
      if (name === 'export_ship_dynamics_legacy_backup') {
        if (!frozen || args.p_expected_revision !== 7
          || args.p_expected_payload_sha256 !== payloadSha256) {
          return { data: null, error: { code: 'freeze-snapshot-mismatch' } };
        }
        return { data: serverBackup, error: null };
      }
      if (name === 'restore_ship_dynamics_legacy_backup') {
        return { data: { status: 'restored', revision: 7, payloadSha256 }, error: null };
      }
      if (name === 'reenable_ship_dynamics_legacy_writes') {
        frozen = false;
        return { data: { status: 'write-enabled', revision: 7, payloadSha256 }, error: null };
      }
      return { data: null, error: { code: 'unexpected-rpc' } };
    },
  });
  const passphrase = 'correct horse battery staple';
  const serviceRole = 'test-only-service-role-placeholder';
  const productionEnvironment = action => ({
    MIGRATION_TARGET: 'production',
    MIGRATION_SUPABASE_URL: `https://${productionHost}`,
    MIGRATION_SUPABASE_SERVICE_ROLE_KEY: serviceRole,
    MIGRATION_PACKAGE_PASSPHRASE: passphrase,
    MIGRATION_ALLOW_PRODUCTION_ROLLBACK: 'I_UNDERSTAND_THIS_CHANGES_PRODUCTION',
    MIGRATION_PRODUCTION_PROJECT_REF: productionRef,
    MIGRATION_PRODUCTION_HOST: productionHost,
    MIGRATION_PRODUCTION_APPROVAL: `APPROVE-PRODUCTION-ROLLBACK:${action}:fixture:7:${payloadSha256}`,
  });
  const dependencies = { clientFactory, productionRef, productionHost };

  await assert.rejects(
    () => runLegacyCutoverCli([
      'freeze', '--workspace-key', 'fixture', '--revision', '7',
      '--payload-sha256', payloadSha256,
      '--confirm', `production:freeze:fixture:7:${payloadSha256}`,
    ], {
      ...productionEnvironment('freeze'),
      MIGRATION_ALLOW_PRODUCTION_ROLLBACK: undefined,
    }, dependencies),
    /production-rollback-default-deny/,
  );
  assert.equal(rpcCalls.length, 0, 'default-denied production must not create an RPC');

  const messages = [];
  const originalLog = console.log;
  console.log = message => messages.push(String(message));
  try {
    assert.equal(await runLegacyCutoverCli([
      'freeze', '--workspace-key', 'fixture', '--revision', '7',
      '--payload-sha256', payloadSha256,
      '--confirm', `production:freeze:fixture:7:${payloadSha256}`,
    ], productionEnvironment('freeze'), dependencies), 0);
    assert.equal(await runLegacyCutoverCli([
      'backup', '--workspace-key', 'fixture', '--revision', '7', '--output', backupPath,
      '--payload-sha256', payloadSha256,
      '--confirm', `production:backup:fixture:7:${payloadSha256}`,
    ], productionEnvironment('backup'), dependencies), 0);
    assert.equal(await runLegacyCutoverCli([
      'verify', '--input', backupPath,
    ], { MIGRATION_PACKAGE_PASSPHRASE: passphrase }, dependencies), 0);
    assert.equal(await runLegacyCutoverCli([
      'restore', '--input', backupPath,
      '--confirm', `production:restore:fixture:7:${payloadSha256}`,
    ], productionEnvironment('restore'), dependencies), 0);
    assert.equal(await runLegacyCutoverCli([
      'reenable', '--input', backupPath,
      '--confirm', `production:reenable:fixture:7:${payloadSha256}`,
    ], productionEnvironment('reenable'), dependencies), 0);
  } finally {
    console.log = originalLog;
  }

  const stored = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.deepEqual(decryptAndVerifyLegacyBackup(stored, passphrase), serverBackup);
  assert.deepEqual(rpcCalls.map(([name]) => name), [
    'freeze_ship_dynamics_legacy_writes',
    'export_ship_dynamics_legacy_backup',
    'restore_ship_dynamics_legacy_backup',
    'reenable_ship_dynamics_legacy_writes',
  ]);
  assert.equal(rpcCalls[0][1].p_expected_payload_sha256, payloadSha256);
  assert.equal(rpcCalls[1][1].p_expected_payload_sha256, payloadSha256);
  const restoreArgs = rpcCalls.at(-2)[1];
  assert.equal(restoreArgs.p_payload_sha256, payloadSha256);
  assert.deepEqual(restoreArgs.p_legacy_payload, { b: 1, aa: 2 });
  assert.ok(messages.every(message => !message.includes(serviceRole) && !message.includes(passphrase)));
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('legacy_cutover_operations=PASS');

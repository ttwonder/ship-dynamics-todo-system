import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  assertMigrationApplyTarget,
  buildMigrationPlan,
  runMigrationCli,
  validateCommittedImportResult,
} from './migrate-legacy-to-normalized.mjs';
import { encryptLegacyBackup } from './legacy-cutover-operations.mjs';

const payload = {
  users: [{ id: 'owner', role: 'owner', isActive: true }],
  vessels: [], tasks: [], meetings: [], internalControlCases: [],
  notifications: [], auditLogs: [], agendaReports: [],
  settings: {
    departments: [], taskCategories: [], meetingTaskCategories: [], priorities: [],
    equipmentFailureSubcategories: [], rolePermissions: {},
  },
};
const mapping = [{
  legacyUserId: 'owner',
  authUserId: '11111111-1111-4111-8111-111111111111',
  authAlias: 'opaque@internal.invalid',
  activationState: 'precreated',
}];
const plan = buildMigrationPlan(payload, 7, mapping);
assert.equal(plan.ready, true);
assert.equal(plan.revision, 7);
assert.equal(plan.counts.users, 1);
assert.equal(plan.quarantineCount, 0);
assert.equal('payloadSha256' in plan, false, 'preflight must not invent a client-side PostgreSQL jsonb hash');
assert.equal('mappingSha256' in plan, false, 'server-returned hashes are the sole commit hash contract');
const serverCommitted = validateCommittedImportResult(plan, {
  status: 'committed',
  replayed: true,
  workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  legacyRevision: 7,
  payloadSha256: '1'.repeat(64),
  mappingSha256: '2'.repeat(64),
  counts: plan.counts,
  quarantineCount: 0,
});
assert.equal(serverCommitted.replayed, true);
assert.equal(serverCommitted.payloadSha256, '1'.repeat(64));
assert.throws(
  () => validateCommittedImportResult(plan, { ...serverCommitted, counts: { ...plan.counts, users: 2 } }),
  /migration-result-mismatch/,
);

const directory = await mkdtemp(join(tmpdir(), 'ship-migration-cli-'));
try {
  const payloadPath = join(directory, 'payload.json');
  const mappingPath = join(directory, 'mapping.json');
  const backupPath = join(directory, 'legacy-backup.enc.json');
  await writeFile(payloadPath, JSON.stringify(payload));
  await writeFile(mappingPath, JSON.stringify(mapping));
  const payloadText = JSON.stringify(payload);
  const payloadSha256 = createHash('sha256').update(payloadText).digest('hex');
  await writeFile(backupPath, JSON.stringify(encryptLegacyBackup({
    workspaceKey: 'fixture',
    revision: 7,
    payloadText,
    payloadSha256,
    frozenAt: '2026-07-26T00:00:00.000Z',
    exportedAt: '2026-07-26T00:00:01.000Z',
  }, 'correct horse battery staple')));
  const messages = [];
  const originalLog = console.log;
  console.log = message => messages.push(String(message));
  try {
    const code = await runMigrationCli([
      '--payload', payloadPath,
      '--revision', '7',
      '--mapping', mappingPath,
      '--workspace-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '--workspace-key', 'fixture',
      '--workspace-name', 'Fixture',
    ], {});
    assert.equal(code, 0);
  } finally {
    console.log = originalLog;
  }
  const output = JSON.parse(messages.at(-1));
  assert.equal(output.ready, true);
  assert.equal(output.counts.users, 1);
  assert.ok(!JSON.stringify(output).includes('opaque@internal.invalid'));

  messages.length = 0;
  console.log = message => messages.push(String(message));
  try {
    const backupCode = await runMigrationCli([
      '--backup', backupPath,
      '--mapping', mappingPath,
      '--workspace-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '--workspace-name', 'Fixture',
    ], { MIGRATION_PACKAGE_PASSPHRASE: 'correct horse battery staple' });
    assert.equal(backupCode, 0);
  } finally {
    console.log = originalLog;
  }
  const backupOutput = JSON.parse(messages.at(-1));
  assert.equal(backupOutput.revision, 7);
  assert.equal(backupOutput.payloadSha256, payloadSha256);

  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(new URL('../public/supabase-config.js', import.meta.url), 'utf8'), sandbox);
  const productionUrl = sandbox.window.SHIP_DYNAMICS_SUPABASE_CONFIG.supabaseUrl;
  const productionHost = new URL(productionUrl).hostname;
  const productionRef = productionHost.split('.')[0];
  const productionTarget = {
    targetUrl: productionUrl,
    productionUrl,
    target: 'production',
    confirmation: `production:import:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:7:${payloadSha256}`,
    workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    revision: 7,
    payloadSha256,
    productionHost,
    productionRef,
    suppliedProductionHost: productionHost,
    suppliedProductionRef: productionRef,
  };
  assert.throws(
    () => assertMigrationApplyTarget(productionTarget),
    /production-import-default-deny/,
  );
  assert.doesNotThrow(() => assertMigrationApplyTarget({
    ...productionTarget,
    allowProductionImport: 'I_UNDERSTAND_THIS_IMPORTS_PRODUCTION_DATA',
    productionApproval: `APPROVE-PRODUCTION-IMPORT:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:7:${payloadSha256}`,
  }));
  await assert.rejects(
    () => runMigrationCli([
      '--backup', backupPath,
      '--mapping', mappingPath,
      '--workspace-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '--workspace-name', 'Fixture',
      '--apply',
      '--confirm', `staging:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:7:${payloadSha256}`,
    ], {
      MIGRATION_SUPABASE_URL: productionUrl,
      MIGRATION_SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key',
      MIGRATION_PACKAGE_PASSPHRASE: 'correct horse battery staple',
    }),
    /production-target-refused/,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log('legacy_migration_cli=PASS');

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  assertAuthApplyTarget,
  decryptActivationPackage,
  encryptActivationPackage,
  runPrepareAuthCli,
  syntheticAuthAlias,
  temporaryPassword,
} from './prepare-legacy-auth-mapping.mjs';

const aliasA = syntheticAuthAlias('workspace-a', 'user-1', 'x'.repeat(32), 'internal.invalid');
assert.equal(aliasA, syntheticAuthAlias('workspace-a', 'user-1', 'x'.repeat(32), 'internal.invalid'));
assert.notEqual(aliasA, syntheticAuthAlias('workspace-b', 'user-1', 'x'.repeat(32), 'internal.invalid'));
assert.match(aliasA, /^[0-9a-f]{48}@internal\.invalid$/);
const password = temporaryPassword();
assert.ok(password.length >= 32);
assert.match(password, /[A-Z]/);
assert.match(password, /[a-z]/);
assert.match(password, /[0-9]/);
assert.match(password, /[^A-Za-z0-9]/);
const secretPayload = { users: [{ temporaryPassword: password }] };
const encrypted = encryptActivationPackage(secretPayload, 'correct horse battery staple');
assert.deepEqual(decryptActivationPackage(encrypted, 'correct horse battery staple'), secretPayload);
assert.throws(() => decryptActivationPackage(encrypted, 'wrong passphrase is bad'), /authenticate|unsupported|unable/i);
assert.ok(!JSON.stringify(encrypted).includes(password));

const directory = await mkdtemp(join(tmpdir(), 'ship-auth-mapping-'));
try {
  const payloadPath = join(directory, 'payload.json');
  const payload = {
    users: [{ id: 'owner', role: 'owner', isActive: true, department: 'A', name: 'Owner' }],
  };
  await writeFile(payloadPath, JSON.stringify(payload));
  const logs = [];
  const originalLog = console.log;
  console.log = message => logs.push(String(message));
  try {
    const code = await runPrepareAuthCli(['--payload', payloadPath, '--workspace-key', 'fixture'], {});
    assert.equal(code, 0);
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(JSON.parse(logs.at(-1)), { ready: true, users: 1, activeUsers: 1 });
  assert.ok(!logs.join('').includes('Owner'));

  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(new URL('../public/supabase-config.js', import.meta.url), 'utf8'), sandbox);
  const productionUrl = sandbox.window.SHIP_DYNAMICS_SUPABASE_CONFIG.supabaseUrl;
  const productionHost = new URL(productionUrl).hostname;
  const productionRef = productionHost.split('.')[0];
  const productionTarget = {
    targetUrl: productionUrl,
    productionUrl,
    target: 'production',
    confirmation: 'production:auth-provision:fixture:1',
    workspaceKey: 'fixture',
    userCount: 1,
    productionHost,
    productionRef,
    suppliedProductionHost: productionHost,
    suppliedProductionRef: productionRef,
  };
  assert.throws(
    () => assertAuthApplyTarget(productionTarget),
    /production-auth-provision-default-deny/,
  );
  assert.doesNotThrow(() => assertAuthApplyTarget({
    ...productionTarget,
    allowProductionAuthProvision: 'I_UNDERSTAND_THIS_CREATES_PRODUCTION_AUTH_USERS',
    productionApproval: 'APPROVE-PRODUCTION-AUTH-PROVISION:fixture:1',
  }));
  await assert.rejects(
    () => runPrepareAuthCli([
      '--payload', payloadPath,
      '--workspace-key', 'fixture',
      '--apply',
      '--mapping-output', join(directory, 'mapping.json'),
      '--activation-output', join(directory, 'activation.enc.json'),
      '--confirm', 'staging:fixture:1',
    ], {
      MIGRATION_SUPABASE_URL: productionUrl,
      MIGRATION_SUPABASE_SERVICE_ROLE_KEY: 'not-real',
      MIGRATION_ALIAS_HMAC_SECRET: 'x'.repeat(32),
      MIGRATION_PACKAGE_PASSPHRASE: 'correct horse battery staple',
    }),
    /production-target-refused/,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log('legacy_auth_mapping=PASS');

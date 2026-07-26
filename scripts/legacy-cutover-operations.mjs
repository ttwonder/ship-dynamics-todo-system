import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';

const HASH = /^[0-9a-f]{64}$/;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['backup', 'verify', 'freeze', 'restore', 'reenable', 'help'].includes(command)) {
    throw new Error('invalid-cutover-command');
  }
  const args = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith('--')) throw new Error('invalid-argument');
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new Error(`missing-value:${key}`);
    args.set(key, value);
  }
  return { command, args };
}

function validateServerBackup(value) {
  if (!value || typeof value !== 'object'
    || typeof value.workspaceKey !== 'string' || !value.workspaceKey.trim()
    || !Number.isSafeInteger(Number(value.revision)) || Number(value.revision) < 0
    || typeof value.payloadText !== 'string'
    || !HASH.test(value.payloadSha256)
    || typeof value.frozenAt !== 'string' || Number.isNaN(Date.parse(value.frozenAt))
    || createHash('sha256').update(value.payloadText).digest('hex') !== value.payloadSha256) {
    throw new Error('backup-integrity-failed');
  }
  try { JSON.parse(value.payloadText); }
  catch { throw new Error('backup-integrity-failed'); }
  return value;
}

export function encryptLegacyBackup(serverBackup, passphrase, material = {}) {
  const backup = validateServerBackup(serverBackup);
  if (typeof passphrase !== 'string' || passphrase.length < 20) throw new Error('backup-passphrase-too-short');
  const salt = material.salt || randomBytes(16);
  const iv = material.iv || randomBytes(12);
  if (!Buffer.isBuffer(salt) || salt.length !== 16 || !Buffer.isBuffer(iv) || iv.length !== 12) {
    throw new Error('invalid-encryption-material');
  }
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(backup), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: 'ship-dynamics-legacy-backup-v1',
    cipher: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptAndVerifyLegacyBackup(encrypted, passphrase) {
  try {
    if (encrypted?.format !== 'ship-dynamics-legacy-backup-v1'
      || encrypted.cipher !== 'aes-256-gcm' || encrypted.kdf !== 'scrypt'
      || typeof passphrase !== 'string' || passphrase.length < 20) {
      throw new Error('invalid');
    }
    const salt = Buffer.from(encrypted.salt, 'base64');
    const iv = Buffer.from(encrypted.iv, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || authTag.length !== 16 || !ciphertext.length) throw new Error('invalid');
    const key = scryptSync(passphrase, salt, 32);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return validateServerBackup(JSON.parse(plaintext.toString('utf8')));
  } catch {
    throw new Error('backup-integrity-failed');
  }
}

export function assertCutoverTarget({
  targetUrl,
  target,
  confirmation,
  action,
  workspaceKey,
  revision,
  payloadSha256,
  productionRef,
  productionHost,
  suppliedProductionRef,
  suppliedProductionHost,
  allowProductionRollback,
  productionApproval,
}) {
  let parsed;
  try { parsed = new URL(targetUrl); } catch { throw new Error('invalid-target-url'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('invalid-target-url');
  }
  const host = parsed.hostname.toLowerCase();
  const expectedProductionHost = String(productionHost || '').toLowerCase();
  const expectedProductionRef = String(productionRef || '').toLowerCase();
  if (!host || !HASH.test(String(payloadSha256 || ''))) throw new Error('invalid-cutover-identity');
  const expectedConfirmation = `${target}:${action}:${workspaceKey}:${revision}:${payloadSha256}`;

  if (target === 'staging') {
    if (host === expectedProductionHost || host.split('.')[0] === expectedProductionRef) {
      throw new Error('production-target-refused');
    }
    if (confirmation !== expectedConfirmation) throw new Error('confirmation-mismatch');
    return host;
  }
  if (target !== 'production') throw new Error('invalid-cutover-target');
  if (allowProductionRollback !== 'I_UNDERSTAND_THIS_CHANGES_PRODUCTION') {
    throw new Error('production-rollback-default-deny');
  }
  if (host !== expectedProductionHost
    || String(suppliedProductionHost || '').toLowerCase() !== expectedProductionHost) {
    throw new Error('production-host-mismatch');
  }
  if (host.split('.')[0] !== expectedProductionRef
    || String(suppliedProductionRef || '').toLowerCase() !== expectedProductionRef) {
    throw new Error('production-project-ref-mismatch');
  }
  if (confirmation !== expectedConfirmation) throw new Error('confirmation-mismatch');
  const expectedApproval = `APPROVE-PRODUCTION-ROLLBACK:${action}:${workspaceKey}:${revision}:${payloadSha256}`;
  if (productionApproval !== expectedApproval) throw new Error('production-approval-mismatch');
  return host;
}

async function productionTarget() {
  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(new URL('../public/supabase-config.js', import.meta.url), 'utf8'), sandbox);
  const host = new URL(sandbox.window.SHIP_DYNAMICS_SUPABASE_CONFIG.supabaseUrl).hostname.toLowerCase();
  return { projectRef: host.split('.')[0], host };
}

async function callRpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`cutover-rpc-failed:${error.code || 'unknown'}`);
  return data;
}

export async function runLegacyCutoverCli(
  argv = process.argv.slice(2),
  environment = process.env,
  dependencies = {},
) {
  const { command, args } = parseArgs(argv);
  if (command === 'help') {
    console.log('Usage: node scripts/legacy-cutover-operations.mjs backup|verify|freeze|restore|reenable [options]');
    return 0;
  }
  const passphrase = environment.MIGRATION_PACKAGE_PASSPHRASE;
  if (!passphrase || passphrase.length < 20) throw new Error('missing-backup-passphrase');

  if (command === 'verify') {
    const input = args.get('--input');
    if (!input) throw new Error('missing-backup-input');
    const backup = decryptAndVerifyLegacyBackup(JSON.parse(await readFile(input, 'utf8')), passphrase);
    console.log(JSON.stringify({ status: 'verified', revision: backup.revision, payloadSha256: backup.payloadSha256 }));
    return 0;
  }

  let backup;
  if (['restore', 'reenable'].includes(command)) {
    const input = args.get('--input');
    if (!input) throw new Error('missing-backup-input');
    backup = decryptAndVerifyLegacyBackup(JSON.parse(await readFile(input, 'utf8')), passphrase);
  }
  const workspaceKey = backup?.workspaceKey || args.get('--workspace-key');
  const revision = Number(backup?.revision ?? args.get('--revision'));
  const suppliedPayloadSha256 = args.get('--payload-sha256');
  if (backup && suppliedPayloadSha256 && suppliedPayloadSha256 !== backup.payloadSha256) {
    throw new Error('payload-hash-mismatch');
  }
  const payloadSha256 = backup?.payloadSha256 || suppliedPayloadSha256;
  if (!workspaceKey || !Number.isSafeInteger(revision) || revision < 0
    || !HASH.test(String(payloadSha256 || ''))) {
    throw new Error('invalid-cutover-identity');
  }
  const targetUrl = environment.MIGRATION_SUPABASE_URL;
  const serviceRole = environment.MIGRATION_SUPABASE_SERVICE_ROLE_KEY;
  if (!targetUrl || !serviceRole) throw new Error('missing-cutover-environment');
  const production = dependencies.productionRef && dependencies.productionHost
    ? { projectRef: dependencies.productionRef, host: dependencies.productionHost }
    : await productionTarget();
  assertCutoverTarget({
    targetUrl,
    target: environment.MIGRATION_TARGET,
    confirmation: args.get('--confirm'),
    action: command,
    workspaceKey,
    revision,
    payloadSha256,
    productionRef: production.projectRef,
    productionHost: production.host,
    suppliedProductionRef: environment.MIGRATION_PRODUCTION_PROJECT_REF,
    suppliedProductionHost: environment.MIGRATION_PRODUCTION_HOST,
    allowProductionRollback: environment.MIGRATION_ALLOW_PRODUCTION_ROLLBACK,
    productionApproval: environment.MIGRATION_PRODUCTION_APPROVAL,
  });
  const factory = dependencies.clientFactory || createClient;
  const client = factory(targetUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  if (command === 'backup') {
    const output = args.get('--output');
    if (!output) throw new Error('missing-backup-output');
    const data = validateServerBackup(await callRpc(client, 'export_ship_dynamics_legacy_backup', {
      p_workspace_key: workspaceKey,
      p_expected_revision: revision,
      p_expected_payload_sha256: payloadSha256,
    }));
    if (data.workspaceKey !== workspaceKey || Number(data.revision) !== revision
      || data.payloadSha256 !== payloadSha256) {
      throw new Error('cutover-result-mismatch');
    }
    const encrypted = encryptLegacyBackup(data, passphrase);
    await writeFile(output, `${JSON.stringify(encrypted)}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(output, 0o600);
    console.log(JSON.stringify({ status: 'backed-up', revision, payloadSha256: data.payloadSha256 }));
    return 0;
  }

  if (command === 'freeze') {
    const data = await callRpc(client, 'freeze_ship_dynamics_legacy_writes', {
      p_workspace_key: workspaceKey,
      p_expected_revision: revision,
      p_expected_payload_sha256: payloadSha256,
      p_confirmation: `freeze:${workspaceKey}:${revision}:${payloadSha256}`,
    });
    if (data?.status !== 'frozen' || Number(data.revision) !== revision
      || data.payloadSha256 !== payloadSha256) {
      throw new Error('cutover-result-mismatch');
    }
    console.log(JSON.stringify({ status: 'frozen', revision, payloadSha256 }));
    return 0;
  }

  if (command === 'restore') {
    const payload = JSON.parse(backup.payloadText);
    const data = await callRpc(client, 'restore_ship_dynamics_legacy_backup', {
      p_workspace_key: workspaceKey,
      p_legacy_revision: revision,
      p_legacy_payload: payload,
      p_payload_sha256: backup.payloadSha256,
      p_updated_at: backup.updatedAt ?? null,
      p_updated_by: backup.updatedBy ?? null,
      p_confirmation: `restore:${workspaceKey}:${revision}:${backup.payloadSha256}`,
    });
    if (data?.status !== 'restored' || data.payloadSha256 !== backup.payloadSha256) {
      throw new Error('cutover-result-mismatch');
    }
    console.log(JSON.stringify({ status: 'restored', revision, payloadSha256: backup.payloadSha256 }));
    return 0;
  }

  const data = await callRpc(client, 'reenable_ship_dynamics_legacy_writes', {
    p_workspace_key: workspaceKey,
    p_expected_revision: revision,
    p_payload_sha256: backup.payloadSha256,
    p_confirmation: `reenable:${workspaceKey}:${revision}:${backup.payloadSha256}`,
  });
  if (data?.status !== 'write-enabled' || data.payloadSha256 !== backup.payloadSha256) {
    throw new Error('cutover-result-mismatch');
  }
  console.log(JSON.stringify({ status: 'write-enabled', revision, payloadSha256: backup.payloadSha256 }));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runLegacyCutoverCli().then(code => { process.exitCode = code; }).catch(error => {
    console.error(`legacy_cutover=FAILED reason=${String(error?.message || 'unknown').replace(/[^a-zA-Z0-9:_-]/g, '-')}`);
    process.exitCode = 2;
  });
}

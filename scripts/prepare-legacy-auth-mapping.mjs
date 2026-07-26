import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';

const objectArray = value => Array.isArray(value)
  ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item))
  : [];

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error('invalid-argument');
    if (['--apply', '--help'].includes(key)) args.set(key, true);
    else {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing-value:${key}`);
      args.set(key, value);
      index += 1;
    }
  }
  return args;
}

async function productionUrl() {
  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(new URL('../public/supabase-config.js', import.meta.url), 'utf8'), sandbox);
  return String(sandbox.window.SHIP_DYNAMICS_SUPABASE_CONFIG?.supabaseUrl || '').replace(/\/$/, '');
}

export function assertAuthApplyTarget({
  targetUrl,
  productionUrl: configuredProductionUrl,
  target,
  confirmation,
  workspaceKey,
  userCount,
  productionHost,
  productionRef,
  suppliedProductionHost,
  suppliedProductionRef,
  allowProductionAuthProvision,
  productionApproval,
}) {
  const normalizedTargetUrl = String(targetUrl || '').replace(/\/$/, '');
  const normalizedProductionUrl = String(configuredProductionUrl || '').replace(/\/$/, '');
  if (!normalizedTargetUrl || !normalizedProductionUrl) throw new Error('invalid-target-url');
  if (normalizedTargetUrl !== normalizedProductionUrl) {
    if (target && target !== 'staging') throw new Error('invalid-migration-target');
    if (confirmation !== `staging:${workspaceKey}:${userCount}`) throw new Error('confirmation-mismatch');
    return 'staging';
  }
  if (target !== 'production') throw new Error('production-target-refused');
  if (allowProductionAuthProvision !== 'I_UNDERSTAND_THIS_CREATES_PRODUCTION_AUTH_USERS') {
    throw new Error('production-auth-provision-default-deny');
  }
  const host = new URL(normalizedTargetUrl).hostname.toLowerCase();
  if (host !== String(productionHost || '').toLowerCase()
    || host !== String(suppliedProductionHost || '').toLowerCase()) {
    throw new Error('production-host-mismatch');
  }
  if (host.split('.')[0] !== String(productionRef || '').toLowerCase()
    || host.split('.')[0] !== String(suppliedProductionRef || '').toLowerCase()) {
    throw new Error('production-project-ref-mismatch');
  }
  if (confirmation !== `production:auth-provision:${workspaceKey}:${userCount}`) {
    throw new Error('confirmation-mismatch');
  }
  if (productionApproval !== `APPROVE-PRODUCTION-AUTH-PROVISION:${workspaceKey}:${userCount}`) {
    throw new Error('production-approval-mismatch');
  }
  return 'production';
}

export function syntheticAuthAlias(workspaceKey, legacyUserId, hmacSecret, domain) {
  if (![workspaceKey, legacyUserId, hmacSecret, domain].every(value => typeof value === 'string' && value.trim())) {
    throw new Error('invalid-alias-input');
  }
  const local = createHmac('sha256', hmacSecret)
    .update(`${workspaceKey}\u0000${legacyUserId}`)
    .digest('hex').slice(0, 48);
  return `${local}@${domain.toLowerCase()}`;
}

export function temporaryPassword() {
  return `Aa1!${randomBytes(24).toString('base64url')}`;
}

export function encryptActivationPackage(value, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) throw new Error('weak-package-passphrase');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: 'ship-dynamics-activation-v1',
    kdf: 'scrypt',
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptActivationPackage(envelope, passphrase) {
  if (envelope?.format !== 'ship-dynamics-activation-v1') throw new Error('invalid-package-format');
  const key = scryptSync(passphrase, Buffer.from(envelope.salt, 'base64'), 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

async function allAuthUsers(client) {
  const users = [];
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth-list-failed:${error.status || 'unknown'}`);
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
  throw new Error('auth-user-pagination-limit');
}

export async function runPrepareAuthCli(argv = process.argv.slice(2), environment = process.env) {
  const args = parseArgs(argv);
  if (args.has('--help')) {
    console.log('Usage: node scripts/prepare-legacy-auth-mapping.mjs --payload FILE --workspace-key KEY [--apply --mapping-output FILE --activation-output FILE --confirm staging:KEY:COUNT]');
    return 0;
  }
  const payloadPath = args.get('--payload');
  const workspaceKey = args.get('--workspace-key');
  if (!payloadPath || !workspaceKey) throw new Error('missing-required-arguments');
  const raw = JSON.parse(await readFile(payloadPath, 'utf8'));
  const payload = raw?.payload && raw?.revision !== undefined ? raw.payload : raw;
  const users = objectArray(payload?.users);
  if (!users.length) throw new Error('empty-user-roster');
  const legacyIds = users.map(user => String(user.id || '').trim());
  if (legacyIds.some(id => !id) || new Set(legacyIds).size !== legacyIds.length) throw new Error('invalid-user-identities');
  const activeOwnerCount = users.filter(user => user.isActive !== false && user.role === 'owner').length;
  if (activeOwnerCount !== 1) throw new Error('invalid-owner-cardinality');
  console.log(JSON.stringify({ ready: true, users: users.length, activeUsers: users.filter(user => user.isActive !== false).length }));
  if (!args.has('--apply')) return 0;

  const targetUrl = String(environment.MIGRATION_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRole = environment.MIGRATION_SUPABASE_SERVICE_ROLE_KEY;
  const hmacSecret = environment.MIGRATION_ALIAS_HMAC_SECRET;
  const packagePassphrase = environment.MIGRATION_PACKAGE_PASSPHRASE;
  const domain = environment.MIGRATION_AUTH_ALIAS_DOMAIN || 'ship-dynamics.internal.invalid';
  if (!targetUrl || !serviceRole || !hmacSecret || !packagePassphrase) throw new Error('missing-apply-environment');
  const configuredProductionUrl = await productionUrl();
  const productionHost = new URL(configuredProductionUrl).hostname.toLowerCase();
  assertAuthApplyTarget({
    targetUrl,
    productionUrl: configuredProductionUrl,
    target: environment.MIGRATION_TARGET,
    confirmation: args.get('--confirm'),
    workspaceKey,
    userCount: users.length,
    productionHost,
    productionRef: productionHost.split('.')[0],
    suppliedProductionHost: environment.MIGRATION_PRODUCTION_HOST,
    suppliedProductionRef: environment.MIGRATION_PRODUCTION_PROJECT_REF,
    allowProductionAuthProvision: environment.MIGRATION_ALLOW_PRODUCTION_AUTH_PROVISION,
    productionApproval: environment.MIGRATION_PRODUCTION_APPROVAL,
  });
  const mappingOutput = args.get('--mapping-output');
  const activationOutput = args.get('--activation-output');
  if (!mappingOutput || !activationOutput || mappingOutput === activationOutput) throw new Error('invalid-output-paths');

  const client = createClient(targetUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const existing = await allAuthUsers(client);
  const byAlias = new Map(existing.map(user => [String(user.email || '').toLowerCase(), user]));
  const mappings = [];
  const activations = [];
  for (const user of users) {
    const legacyUserId = String(user.id).trim();
    const authAlias = syntheticAuthAlias(workspaceKey, legacyUserId, hmacSecret, domain);
    const password = temporaryPassword();
    let authUser = byAlias.get(authAlias.toLowerCase());
    if (!authUser) {
      const created = await client.auth.admin.createUser({
        email: authAlias,
        password,
        email_confirm: true,
        app_metadata: { shipDynamicsWorkspaceKey: workspaceKey, shipDynamicsLegacyUserId: legacyUserId },
      });
      if (created.error || !created.data.user) throw new Error(`auth-create-failed:${created.error?.status || 'unknown'}`);
      authUser = created.data.user;
      byAlias.set(authAlias.toLowerCase(), authUser);
    } else {
      const updated = await client.auth.admin.updateUserById(authUser.id, { password, ban_duration: 'none' });
      if (updated.error) throw new Error(`auth-reset-failed:${updated.error.status || 'unknown'}`);
    }
    mappings.push({
      legacyUserId,
      authUserId: authUser.id,
      authAlias,
      activationState: 'precreated',
    });
    activations.push({
      legacyUserId,
      department: String(user.department || ''),
      displayName: String(user.name || ''),
      usernameLabel: String(user.username || user.name || ''),
      authAlias,
      temporaryPassword: password,
      mustChangePassword: true,
    });
  }
  const encrypted = encryptActivationPackage({ workspaceKey, createdAt: new Date().toISOString(), users: activations }, packagePassphrase);
  await mkdir(dirname(mappingOutput), { recursive: true });
  await mkdir(dirname(activationOutput), { recursive: true });
  await writeFile(mappingOutput, `${JSON.stringify(mappings, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await writeFile(activationOutput, `${JSON.stringify(encrypted, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ status: 'prepared', users: mappings.length, mappingOutputWritten: true, activationPackageWritten: true }));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runPrepareAuthCli().then(code => { process.exitCode = code; }).catch(error => {
    console.error(`prepare_auth_cli=FAILED reason=${String(error?.message || 'unknown').replace(/[^a-zA-Z0-9:_-]/g, '-')}`);
    process.exitCode = 2;
  });
}

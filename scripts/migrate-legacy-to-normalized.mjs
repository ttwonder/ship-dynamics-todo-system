import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import {
  analyzeLegacyImportPackage,
  sha256Hex,
} from './legacy-migration-contract.mjs';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) throw new Error('invalid-argument');
    if (['--apply', '--live-read', '--help'].includes(value)) args.set(value, true);
    else {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`missing-value:${value}`);
      args.set(value, next);
      index += 1;
    }
  }
  return args;
}

async function runtimeConfig(path = new URL('../public/supabase-config.js', import.meta.url)) {
  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(path, 'utf8'), sandbox);
  const config = sandbox.window.SHIP_DYNAMICS_SUPABASE_CONFIG;
  if (!config?.supabaseUrl || !config?.supabaseAnonKey || !config?.workspaceKey || !config?.tableName) {
    throw new Error('invalid-runtime-config');
  }
  return config;
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(`invalid-${label}-json`);
  }
}

async function readLiveLegacyRow() {
  const config = await runtimeConfig();
  const endpoint = `${String(config.supabaseUrl).replace(/\/$/, '')}/rest/v1/${encodeURIComponent(config.tableName)}`
    + `?select=workspace_key,revision,payload&workspace_key=eq.${encodeURIComponent(config.workspaceKey)}&limit=2`;
  const response = await fetch(endpoint, {
    headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` },
  });
  if (!response.ok) throw new Error(`legacy-read-failed:${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('legacy-row-cardinality');
  return rows[0];
}

export function postgresJsonbText(value) {
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}: ${postgresJsonbText(value[key])}`).join(', ')}}`;
  }
  return JSON.stringify(value);
}

export function buildMigrationPlan(payload, revision, identityMapping) {
  const numericRevision = Number(revision);
  if (!Number.isSafeInteger(numericRevision) || numericRevision < 0) throw new Error('invalid-revision');
  const analysis = analyzeLegacyImportPackage(payload, numericRevision, identityMapping);
  return Object.freeze({
    ...analysis,
    payloadSha256: sha256Hex(postgresJsonbText(payload)),
    mappingSha256: sha256Hex(postgresJsonbText(identityMapping)),
  });
}

function safePlanOutput(plan) {
  return {
    ready: plan.ready,
    revision: plan.revision,
    counts: plan.counts,
    quarantineCount: plan.quarantineCount,
    issueCounts: plan.issueCounts,
    payloadSha256: plan.payloadSha256,
    mappingSha256: plan.mappingSha256,
  };
}

export async function runMigrationCli(argv = process.argv.slice(2), environment = process.env) {
  const args = parseArgs(argv);
  if (args.has('--help')) {
    console.log('Usage: node scripts/migrate-legacy-to-normalized.mjs (--payload FILE --revision N | --live-read) --mapping FILE --workspace-id UUID --workspace-name NAME [--workspace-key KEY] [--apply --confirm staging:UUID:REVISION]');
    return 0;
  }
  const mappingPath = args.get('--mapping');
  const workspaceId = args.get('--workspace-id');
  const workspaceName = args.get('--workspace-name');
  if (!mappingPath || !workspaceId || !workspaceName) throw new Error('missing-required-arguments');
  const identityMapping = await readJson(mappingPath, 'mapping');
  let row;
  if (args.has('--live-read')) {
    if (args.has('--payload') || args.has('--revision')) throw new Error('ambiguous-source');
    row = await readLiveLegacyRow();
  } else {
    const payloadPath = args.get('--payload');
    const revision = args.get('--revision');
    if (!payloadPath || revision === undefined) throw new Error('missing-payload-source');
    const input = await readJson(payloadPath, 'payload');
    row = input?.payload && input?.revision !== undefined
      ? input
      : { payload: input, revision: Number(revision), workspace_key: args.get('--workspace-key') };
    if (Number(row.revision) !== Number(revision)) throw new Error('revision-mismatch');
  }
  const workspaceKey = args.get('--workspace-key') || row.workspace_key;
  if (!workspaceKey) throw new Error('missing-workspace-key');
  const plan = buildMigrationPlan(row.payload, row.revision, identityMapping);
  console.log(JSON.stringify(safePlanOutput(plan)));
  if (!plan.ready) return 1;
  if (!args.has('--apply')) return 0;

  const targetUrl = String(environment.MIGRATION_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRole = environment.MIGRATION_SUPABASE_SERVICE_ROLE_KEY;
  if (!targetUrl || !serviceRole) throw new Error('missing-apply-environment');
  const production = String((await runtimeConfig()).supabaseUrl).replace(/\/$/, '');
  if (targetUrl === production) throw new Error('production-target-refused');
  const confirmation = `staging:${workspaceId}:${plan.revision}`;
  if (args.get('--confirm') !== confirmation) throw new Error('confirmation-mismatch');

  const client = createClient(targetUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.rpc('import_ship_dynamics_legacy', {
    p_workspace_id: workspaceId,
    p_workspace_key: workspaceKey,
    p_workspace_name: workspaceName,
    p_expected_legacy_revision: plan.revision,
    p_legacy_payload: row.payload,
    p_identity_mapping: identityMapping,
    p_expected_counts: plan.counts,
    p_expected_quarantine_count: plan.quarantineCount,
  });
  if (error) throw new Error(`migration-rpc-failed:${error.code || 'unknown'}`);
  if (data?.status !== 'committed'
    || data.payloadSha256 !== plan.payloadSha256
    || data.mappingSha256 !== plan.mappingSha256
    || Number(data.quarantineCount) !== plan.quarantineCount) {
    throw new Error('migration-result-mismatch');
  }
  console.log(JSON.stringify({ status: 'committed', revision: plan.revision, counts: plan.counts, quarantineCount: plan.quarantineCount }));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runMigrationCli().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(`migration_cli=FAILED reason=${String(error?.message || 'unknown').replace(/[^a-zA-Z0-9:_-]/g, '-')}`);
    process.exitCode = 2;
  });
}

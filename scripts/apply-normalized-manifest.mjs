import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import vm from 'node:vm';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error('invalid-argument');
    if (['--apply', '--help'].includes(key)) args.set(key, true);
    else {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`missing-value:${key}`);
      args.set(key, value);
    }
  }
  return args;
}

export function migrationBody(sql, label) {
  const normalized = sql
    .split(String.fromCharCode(13, 10)).join('\n')
    .split(String.fromCharCode(13)).join('\n');
  const withoutBegin = normalized.replace(/^\s*begin\s*;\s*/i, '');
  const withoutCommit = withoutBegin.replace(/\s*commit\s*;\s*$/i, '');
  if (withoutBegin === normalized || withoutCommit === withoutBegin) throw new Error(`migration-transaction-invalid:${label}`);
  return `\n-- manifest:${label}\n${withoutCommit.trim()}\n`;
}

export async function buildNormalizedDeploymentBundle(root = new URL('../', import.meta.url)) {
  const manifest = JSON.parse(await readFile(new URL('supabase/normalized-manifest.json', root), 'utf8'));
  if (manifest?.version !== 1 || !Array.isArray(manifest.migrations) || !manifest.migrations.length) {
    throw new Error('invalid-normalized-manifest');
  }
  let body = '';
  for (const relative of manifest.migrations) {
    const sql = await readFile(new URL(relative, root), 'utf8');
    body += migrationBody(sql, relative);
  }
  const sql = `begin;\n${body}\ncommit;\n`;
  return {
    sql,
    version: manifest.version,
    files: manifest.migrations.length,
    sha256: createHash('sha256').update(sql).digest('hex'),
  };
}

async function productionProjectRef() {
  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(new URL('../public/supabase-config.js', import.meta.url), 'utf8'), sandbox);
  const host = new URL(sandbox.window.SHIP_DYNAMICS_SUPABASE_CONFIG.supabaseUrl).hostname;
  return host.split('.')[0];
}

export function assertStagingTarget(databaseUrl, target, confirmation, version, productionRef) {
  if (target !== 'staging') throw new Error('staging-target-required');
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new Error('invalid-database-url'); }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) throw new Error('invalid-database-url');
  const host = parsed.hostname.toLowerCase();
  if (!host || host.includes(String(productionRef).toLowerCase())) throw new Error('production-target-refused');
  if (confirmation !== `staging:${host}:${version}`) throw new Error('confirmation-mismatch');
  return host;
}

export function postgresEnvironment(databaseUrl, baseEnvironment = process.env) {
  const parsed = new URL(databaseUrl);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  return {
    ...baseEnvironment,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    PGSSLMODE: parsed.searchParams.get('sslmode') || (local ? 'disable' : 'require'),
  };
}

function runPsql(executable, databaseUrl, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--file', file], {
      env: postgresEnvironment(databaseUrl),
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    child.once('error', () => reject(new Error('psql-start-failed')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`psql-failed:${code}`)));
  });
}

export async function runApplyManifestCli(argv = process.argv.slice(2), environment = process.env) {
  const args = parseArgs(argv);
  if (args.has('--help')) {
    console.log('Usage: node scripts/apply-normalized-manifest.mjs [--apply --confirm staging:HOST:VERSION]');
    return 0;
  }
  const bundle = await buildNormalizedDeploymentBundle();
  console.log(JSON.stringify({ status: 'ready', version: bundle.version, files: bundle.files, sha256: bundle.sha256 }));
  if (!args.has('--apply')) return 0;
  const databaseUrl = environment.NORMALIZED_DATABASE_URL;
  if (!databaseUrl) throw new Error('missing-database-url');
  assertStagingTarget(
    databaseUrl,
    environment.NORMALIZED_TARGET,
    args.get('--confirm'),
    bundle.version,
    await productionProjectRef(),
  );
  const directory = await mkdtemp(join(tmpdir(), 'ship-normalized-deploy-'));
  try {
    const file = join(directory, 'normalized-v1.sql');
    await writeFile(file, bundle.sql, { mode: 0o600 });
    await runPsql(environment.PSQL_PATH || 'psql', databaseUrl, file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ status: 'applied', version: bundle.version, files: bundle.files, sha256: bundle.sha256 }));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runApplyManifestCli().then(code => { process.exitCode = code; }).catch(error => {
    console.error(`normalized_manifest_apply=FAILED reason=${String(error?.message || 'unknown').replace(/[^a-zA-Z0-9:_-]/g, '-')}`);
    process.exitCode = 2;
  });
}

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildNormalizedDeploymentBundle } from './apply-normalized-manifest.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const fixtureRoot = resolve(root, 'scripts', 'fixtures');
const pgBin = resolve(
  process.env.SHIP_RUNTIME_PG_BIN
    || 'E:/Projects/.tools/postgresql-17.10/runtime/pgsql/bin',
);
const host = process.env.SHIP_RUNTIME_PG_HOST || '127.0.0.1';
const port = process.env.SHIP_RUNTIME_PG_PORT || '55432';
const user = process.env.SHIP_RUNTIME_PG_USER || 'postgres';
const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`.toLowerCase();
const negativeDatabase = `ship_runtime_negative_${suffix}`;
const runtimeDatabase = `ship_runtime_gate_${suffix}`;
const slotName = `ship_runtime_slot_${suffix}`.slice(0, 63);
const psql = resolve(pgBin, process.platform === 'win32' ? 'psql.exe' : 'psql');
const createdb = resolve(pgBin, process.platform === 'win32' ? 'createdb.exe' : 'createdb');
const dropdb = resolve(pgBin, process.platform === 'win32' ? 'dropdb.exe' : 'dropdb');
const baseEnvironment = {
  ...process.env,
  PGHOST: host,
  PGPORT: port,
  PGUSER: user,
  PGDATABASE: 'postgres',
  PGSSLMODE: process.env.SHIP_RUNTIME_PG_SSLMODE || 'disable',
  PGCLIENTENCODING: 'UTF8',
  ...(process.env.SHIP_RUNTIME_PG_PASSWORD
    ? { PGPASSWORD: process.env.SHIP_RUNTIME_PG_PASSWORD }
    : {}),
};

function execute(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env: { ...baseEnvironment, ...(options.env || {}) },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${options.label || basename(executable)}-start-failed:${result.error.message}`);
  }
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (options.expectFailure) {
    assert.notEqual(result.status, 0, `${options.label} unexpectedly passed`);
    if (!options.expectFailure.test(output)) {
      throw new Error(`${options.label}-wrong-failure:${output.trim()}`);
    }
    return { ...result, output };
  }
  if (result.status !== 0) {
    throw new Error(`${options.label || basename(executable)}-failed:${result.status}\n${output}`);
  }
  return { ...result, output };
}

function createDatabase(database) {
  execute(createdb, ['--encoding=UTF8', '--template=template0', database], {
    label: `create-database:${database}`,
  });
}

function dropDatabase(database) {
  execute(dropdb, ['--if-exists', '--force', database], {
    label: `drop-database:${database}`,
  });
}

function runPsql(database, options = {}) {
  const args = [
    '--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1',
    '--dbname', database,
  ];
  if (options.file) args.push('--file', options.file);
  if (options.sql) args.push('--tuples-only', '--no-align', '--command', options.sql);
  return execute(psql, args, {
    label: options.label || 'psql',
    expectFailure: options.expectFailure,
  });
}

function lines(output) {
  return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function scalar(database, sql, label) {
  const output = runPsql(database, { sql, label }).stdout;
  const values = lines(output);
  assert.ok(values.length, `${label} returned no rows`);
  return values.at(-1);
}

function json(database, sql, label) {
  const value = scalar(database, sql, label);
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label}-invalid-json:${value}:${error.message}`);
  }
}

function actorSql(actorId, applicationName, statement) {
  return `
    set application_name = '${applicationName}';
    set role authenticated;
    set request.jwt.claim.sub = '${actorId}';
    ${statement}
  `;
}

function taskContent(description) {
  return `jsonb_build_object(
    'description','${description}',
    'status','Open',
    'priority',(
      select priority from public.sd_tasks
      where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
        and id='ordinary-a'
    ),
    'expectedDate','',
    'reportDate','',
    'equipmentSubcategory','',
    'isAware',false,
    'isAbnormal',false,
    'vesselIds',jsonb_build_array('vessel-a'),
    'categories','[]'::jsonb,
    'departments','[]'::jsonb,
    'ownerUserIds','[]'::jsonb,
    'typeScopes','[]'::jsonb
  )`;
}

function requestJson({ taskId, baseVersion, leaseKey, ownerSession, fencingToken, description }) {
  return `jsonb_build_object(
    'taskId','${taskId}',
    'baseVersion',${baseVersion},
    'leaseKey','${leaseKey}',
    'ownerSession','${ownerSession}'::uuid,
    'fencingToken',${fencingToken},
    'content',${taskContent(description)}
  )`;
}

function reserveUpdate({ actorId, applicationName, operationId, sessionId, fencingToken, baseVersion, description }) {
  const request = requestJson({
    taskId: 'ordinary-a',
    baseVersion,
    leaseKey: 'task:ordinary-a',
    ownerSession: sessionId,
    fencingToken,
    description,
  });
  return json(runtimeDatabase, actorSql(actorId, applicationName, `
    select public.reserve_ship_dynamics_operation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      '${operationId}'::uuid,
      'update_ordinary_task',
      'task:ordinary-a',
      ${request}
    );
  `), `reserve-operation:${operationId}`);
}

function updateTaskSql({ actorId, applicationName, operationId, sessionId, fencingToken, baseVersion, description }) {
  return actorSql(actorId, applicationName, `
    select public.command_ship_dynamics_update_ordinary_task(
      '${operationId}'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'ordinary-a',
      ${baseVersion}::bigint,
      'task:ordinary-a',
      '${sessionId}'::uuid,
      ${fencingToken}::bigint,
      ${taskContent(description)}
    );
  `);
}

async function proveMissingBootstrap(bundleFile) {
  dropDatabase(negativeDatabase);
  createDatabase(negativeDatabase);
  try {
    const failure = runPsql(negativeDatabase, {
      file: bundleFile,
      label: 'negative-control-without-supabase-bootstrap',
      expectFailure: /schema ["“]?auth["”]? does not exist/i,
    });
    const count = Number(scalar(
      negativeDatabase,
      "select count(*) from pg_catalog.pg_tables where schemaname='public' and tablename like 'sd\\_%' escape '\\'",
      'negative-control-table-count',
    ));
    assert.equal(count, 0, 'outer manifest transaction must leave zero product tables after prerequisite failure');
    const reason = lines(failure.output).find(line => /schema .*auth.*does not exist/i.test(line)) || 'auth-schema-missing';
    console.log(`negative_control=PASS exit=${failure.status} product_tables=${count} reason=${reason.replace(/\s+/g, '-')}`);
  } finally {
    dropDatabase(negativeDatabase);
  }
}

function proveIndependentSessions() {
  const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const operator = '22222222-2222-4222-8222-222222222222';
  const owner = '11111111-1111-4111-8111-111111111111';
  const sessionA = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const sessionB = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
  const appA = 'ship-runtime-session-a';
  const appB = 'ship-runtime-session-b';

  const firstSession = json(runtimeDatabase, actorSql(operator, appA, `
    select jsonb_build_object(
      'backendPid', pg_catalog.pg_backend_pid(),
      'applicationName', current_setting('application_name'),
      'lease', public.claim_ship_dynamics_entity_lease(
        '${workspace}'::uuid, 'task:ordinary-a', 'task', 'ordinary-a', '${sessionA}'::uuid, 75
      )
    );
  `), 'session-a-claim');
  const first = firstSession.lease;
  assert.equal(firstSession.applicationName, appA);
  assert.equal(first.ok, true);
  assert.equal(Number(first.fencingToken), 1);

  const blockedSession = json(runtimeDatabase, actorSql(owner, appB, `
    select jsonb_build_object(
      'backendPid', pg_catalog.pg_backend_pid(),
      'applicationName', current_setting('application_name'),
      'lease', public.claim_ship_dynamics_entity_lease(
        '${workspace}'::uuid, 'task:ordinary-a', 'task', 'ordinary-a', '${sessionB}'::uuid, 75
      )
    );
  `), 'session-b-blocked-claim');
  const blocked = blockedSession.lease;
  assert.equal(blockedSession.applicationName, appB);
  assert.notEqual(firstSession.backendPid, blockedSession.backendPid, 'lease exclusion must use independent PostgreSQL backends');
  assert.equal(blocked.ok, false, 'a second independent session must be excluded');

  assert.equal(
    scalar(runtimeDatabase, actorSql(operator, appA, `
      select public.release_ship_dynamics_entity_lease(
        '${workspace}'::uuid, 'task:ordinary-a', '${sessionA}'::uuid, 1
      );
    `), 'session-a-release'),
    't',
  );

  const takeover = json(runtimeDatabase, actorSql(owner, appB, `
    select public.claim_ship_dynamics_entity_lease(
      '${workspace}'::uuid, 'task:ordinary-a', 'task', 'ordinary-a', '${sessionB}'::uuid, 75
    );
  `), 'session-b-takeover');
  assert.equal(takeover.ok, true);
  assert.ok(Number(takeover.fencingToken) > Number(first.fencingToken));
  const fencingToken = Number(takeover.fencingToken);

  const staleOperation = '10000000-0000-4000-8000-000000000001';
  assert.equal(reserveUpdate({
    actorId: operator, applicationName: appA, operationId: staleOperation,
    sessionId: sessionA, fencingToken: 1, baseVersion: 1, description: 'Stale runtime write',
  }).status, 'prepared');
  runPsql(runtimeDatabase, {
    sql: updateTaskSql({
      actorId: operator, applicationName: appA, operationId: staleOperation,
      sessionId: sessionA, fencingToken: 1, baseVersion: 1, description: 'Stale runtime write',
    }),
    label: 'stale-fencing-rejection',
    expectFailure: /lease-(?:owner|fencing|expired)-mismatch/i,
  });

  const committedOperation = '10000000-0000-4000-8000-000000000002';
  const committedInput = {
    actorId: owner,
    applicationName: appB,
    operationId: committedOperation,
    sessionId: sessionB,
    fencingToken,
    baseVersion: 1,
    description: 'Authoritative runtime update',
  };
  assert.equal(reserveUpdate(committedInput).status, 'prepared');

  // Intentionally discard the command response to simulate a lost HTTP response.
  runPsql(runtimeDatabase, {
    sql: updateTaskSql(committedInput),
    label: 'lost-response-command-commit',
  });
  const status = json(runtimeDatabase, actorSql(owner, appB, `
    select public.get_ship_dynamics_operation_status(
      '${workspace}'::uuid, '${committedOperation}'::uuid
    );
  `), 'lost-response-operation-status');
  assert.equal(status.status, 'committed');
  assert.equal(Number(status.result.version), 2);

  const replay = json(runtimeDatabase, updateTaskSql(committedInput), 'committed-operation-replay');
  assert.equal(replay.status, 'committed');
  assert.equal(replay.replayed, true);
  assert.equal(Number(replay.version), 2);

  const conflictOperation = '10000000-0000-4000-8000-000000000003';
  const conflictInput = {
    actorId: owner,
    applicationName: appB,
    operationId: conflictOperation,
    sessionId: sessionB,
    fencingToken,
    baseVersion: 1,
    description: 'Conflicting runtime update',
  };
  assert.equal(reserveUpdate(conflictInput).status, 'prepared');
  runPsql(runtimeDatabase, {
    sql: updateTaskSql(conflictInput),
    label: 'row-version-cas-conflict',
    expectFailure: /version-conflict/i,
  });

  const final = json(runtimeDatabase, `
    select jsonb_build_object(
      'description', description,
      'version', version,
      'operationCount', (
        select count(*) from public.sd_operations
        where workspace_id = '${workspace}'::uuid
      )
    )
    from public.sd_tasks
    where workspace_id = '${workspace}'::uuid and id = 'ordinary-a';
  `, 'concurrency-final-state');
  assert.deepEqual(final, {
    description: 'Authoritative runtime update',
    version: 2,
    operationCount: 1,
  });
  console.log(`independent_sessions=PASS exclusion=true release_takeover=true fencing=1->${fencingToken} stale_rejected=true cas_conflict=true replay=true`);
}

function proveLogicalPgoutput() {
  const created = scalar(runtimeDatabase, `
    select slot_name from pg_catalog.pg_create_logical_replication_slot('${slotName}', 'pgoutput');
  `, 'logical-slot-create');
  assert.equal(created, slotName);

  runPsql(runtimeDatabase, {
    sql: `
      update public.sd_tasks
      set description = 'Logical pgoutput committed mutation',
          version = version + 1,
          updated_at = clock_timestamp()
      where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
        and id = 'ordinary-a';
    `,
    label: 'logical-published-commit',
  });

  const changes = Number(scalar(runtimeDatabase, `
    select count(*)
    from pg_catalog.pg_logical_slot_get_binary_changes(
      '${slotName}', null, null,
      'proto_version', '1',
      'publication_names', 'supabase_realtime'
    );
  `, 'logical-pgoutput-read'));
  assert.ok(changes > 0, 'pgoutput must emit changes after a separate committed published-table mutation');
  assert.equal(
    scalar(runtimeDatabase, `select pg_catalog.pg_drop_replication_slot('${slotName}'); select 'dropped';`, 'logical-slot-drop'),
    'dropped',
  );
  console.log(`logical_pgoutput=PASS slot=${slotName} messages=${changes} committed_before_read=true cleanup=true`);
}

async function main() {
  const temporary = await mkdtemp(join(tmpdir(), 'ship-normalized-postgres-runtime-'));
  const bundle = await buildNormalizedDeploymentBundle();
  const bundleFile = join(temporary, 'normalized-manifest.sql');
  await writeFile(bundleFile, bundle.sql, 'utf8');
  console.log(`manifest=READY version=${bundle.version} files=${bundle.files} sha256=${bundle.sha256}`);

  try {
    await proveMissingBootstrap(bundleFile);
    dropDatabase(runtimeDatabase);
    createDatabase(runtimeDatabase);
    runPsql(runtimeDatabase, {
      file: resolve(fixtureRoot, 'normalized-postgres-bootstrap.sql'),
      label: 'supabase-bootstrap-preflight',
    }).stdout.split(/\r?\n/).filter(Boolean).forEach(line => console.log(line));
    runPsql(runtimeDatabase, {
      file: bundleFile,
      label: 'normalized-manifest-outer-transaction',
    });
    console.log(`manifest=APPLIED files=${bundle.files} sha256=${bundle.sha256} outer_transaction=true`);
    runPsql(runtimeDatabase, {
      file: resolve(fixtureRoot, 'normalized-postgres-runtime-assertions.sql'),
      label: 'normalized-runtime-assertions',
    }).stdout.split('\n').filter(Boolean).forEach(line => console.log(line));
    runPsql(runtimeDatabase, {
      file: resolve(fixtureRoot, 'normalized-postgres-cutover-rehearsal.sql'),
      label: 'normalized-postgres-cutover-rehearsal',
    }).stdout.split('\n').filter(Boolean).forEach(line => console.log(line));
    runPsql(runtimeDatabase, {
      file: resolve(fixtureRoot, 'normalized-postgres-runtime-fixture.sql'),
      label: 'normalized-runtime-fixture',
    }).stdout.split('\n').filter(Boolean).forEach(line => console.log(line));
    proveIndependentSessions();
    proveLogicalPgoutput();
    console.log('normalized_postgres_runtime=PASS');
  } finally {
    try {
      runPsql(runtimeDatabase, {
        sql: `
          select pg_catalog.pg_drop_replication_slot(slot_name)
          from pg_catalog.pg_replication_slots
          where database = current_database()
            and slot_name like 'ship_runtime_slot_%';
        `,
        label: 'logical-slot-final-cleanup',
      });
    } catch {
      // Database creation or connection may have failed before a slot existed.
    }
    try { dropDatabase(runtimeDatabase); } catch { /* preserve the primary failure */ }
    try { dropDatabase(negativeDatabase); } catch { /* preserve the primary failure */ }
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`normalized_postgres_runtime=FAILED reason=${String(error?.message || error)}`);
  process.exitCode = 1;
});

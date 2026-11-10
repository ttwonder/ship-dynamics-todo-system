import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const dependencyPackage = process.env.FLEET_RISK_DEPENDENCY_PACKAGE || resolve(root, 'package.json');
const require = createRequire(dependencyPackage);
const { PGlite } = require('@electric-sql/pglite');
const migrationPath = resolve(root, 'supabase/migrations/20261110070000_ship_fleet_risk.sql');
const migration = existsSync(migrationPath) ? await readFile(migrationPath, 'utf8') : '';
const cases = [];
const stage = process.env.FLEET_RISK_TEST_STAGE || 'current';
assert.ok(process.env.QA_EVIDENCE_ROOT && isAbsolute(process.env.QA_EVIDENCE_ROOT), 'Absolute external QA_EVIDENCE_ROOT required');
const evidence = resolve(process.env.QA_EVIDENCE_ROOT, 'fleet-risk-database');
assert.ok(!evidence.toLowerCase().startsWith(resolve(root).toLowerCase()), 'Evidence stays outside repository');
await mkdir(evidence, { recursive: true });
const db = new PGlite();
const scalar = async (sql, args = [], target = db) => (await target.query(sql, args)).rows[0].value;
async function asRole(role, fn, target = db) {
  await target.exec(`SET ROLE ${role}`);
  try { return await fn(); } finally { await target.exec('RESET ROLE'); }
}
async function test(name, fn) {
  try { await fn(); cases.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'FAIL', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
}
async function bootstrap(target, sql) {
  await target.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.business_sentinel (id integer PRIMARY KEY, value text NOT NULL);
    INSERT INTO public.business_sentinel VALUES (1, 'unchanged');`);
  if (sql) await target.exec(sql);
}
const read = (target = db) => scalar('SELECT public.read_ship_fleet_risk_v1() AS value', [], target);

const claim = (id, trigger = 'manual', target = db) => asRole('service_role', () => scalar(
  'SELECT public.claim_ship_fleet_risk_v1($1, $2::uuid) AS value', [trigger, id], target), target);
const progress = (id, done, total, target = db) => asRole('service_role', () => scalar(
  'SELECT public.progress_ship_fleet_risk_v1($1::uuid, $2::integer, $3::integer) AS value', [id, done, total], target), target);
const physical = (target = db) => scalar('SELECT to_jsonb(t) AS value FROM public.ship_fleet_risk_cache_v1 t', [], target);
const finish = (id, snapshot, error = null, target = db) => asRole('service_role', () => scalar(
  'SELECT public.finish_ship_fleet_risk_v1($1::uuid, $2::jsonb, $3::text) AS value',
  [id, snapshot === null ? null : JSON.stringify(snapshot), error], target), target);
const checksumImo = base => base + String([...base].reduce((sum, digit, i) => sum + Number(digit) * (7 - i), 0) % 10);
async function fixtureSnapshot(target = db) {
  const state = await read(target);
  const ended = state.serverTime;
  return { id: state.attempt.id, trigger: state.attempt.trigger,
    company: { name: 'Synthetic public fleet fixture', imo: '0882415', performance: 'Medium' },
    queryStartedAt: state.attempt.startedAt, queryCompletedAt: ended, rosterRetrievedAt: ended, count: 2,
    rows: ['123456', '765432'].map((base, i) => ({ name: `Synthetic vessel ${i + 1}`, imo: checksumImo(base),
      retrievedAt: ended, status: 'ok', risk: i ? 'LRS' : 'HRS', priority: i ? 'No Priority' : 'Priority I',
      companyName: 'Synthetic operator', companyImo: i ? '0123456' : '0882415', windowFrom: null, windowTo: null,
      sourceUpdatedAt: null, sourceUrl: 'https://apcis.tmou.org/public/' })),
    coverage: { referenceCount: 2, missingReferenceImos: [], addedReferenceImos: [] } };
}
const firstId = randomUUID();
const joinId = randomUUID();
let failed = false;
try {
  await bootstrap(db, migration);
  await test('anonymous initial read is empty with database-clock next Taipei 07:00', async () => {
    const state = await asRole('anon', () => read());
    assert.equal(state.snapshot, null);
    assert.equal(state.attempt, null);
    assert.deepEqual(Object.keys(state).sort(), ['attempt', 'nextScheduledAt', 'serverTime', 'snapshot']);
    const now = new Date(state.serverTime);
    const due = new Date(state.nextScheduledAt);
    assert.ok(due > now && due - now <= 86400000);
    assert.equal(due.getUTCHours(), 23);
    assert.equal(due.getUTCMinutes(), 0);
  });
  await test('claim atomically starts one four-minute run; duplicates and other callers join', async () => {
    const c = await claim(firstId);
    assert.equal(c.acquired, true);
    assert.equal(c.runId, firstId);
    assert.deepEqual(c.state.attempt, { id: firstId, trigger: 'manual', status: 'running',
      startedAt: c.state.attempt.startedAt, completedAt: null, done: 0, total: 0, error: null });
    const before = await physical();
    assert.equal(new Date(before.lease_expires_at) - new Date(before.attempt.startedAt), 240000);
    for (const id of [firstId, joinId]) {
      const duplicate = await claim(id);
      assert.equal(duplicate.acquired, false);
      assert.equal(duplicate.runId, firstId);
      assert.deepEqual(duplicate.state.attempt, c.state.attempt);
    }
    const after = await physical();
    assert.equal(after.lease_expires_at, before.lease_expires_at);
    assert.equal(after.request_runs[joinId], firstId);
    await assert.rejects(() => claim(randomUUID(), 'invalid'), /invalid trigger/i);
    await assert.rejects(() => claim(null), /request id/i);
  });
  await test('progress is monotone, bounded, ID-fenced and cannot extend the lease', async () => {
    const before = await physical();
    assert.equal(await progress(firstId, 1, 2), true);
    assert.equal(await progress(firstId, 1, 2), true);
    for (const args of [[firstId, 0, 2], [firstId, 1, 1], [firstId, 3, 2],
      [firstId, -1, 2], [firstId, 2, 101], [randomUUID(), 2, 2], [firstId, null, 2]]) {
      assert.equal(await progress(...args), false);
    }
    const after = await physical();
    assert.equal(after.attempt.done, 1);
    assert.equal(after.attempt.total, 2);
    assert.equal(after.lease_expires_at, before.lease_expires_at);
    assert.equal(after.attempt.startedAt, before.attempt.startedAt);
  });
  await test('finish rejects stale IDs and publishes a complete snapshot without timestamp rewriting', async () => {
    const snapshot = await fixtureSnapshot();
    const before = await physical();
    assert.equal(await finish(randomUUID(), snapshot), false);
    assert.deepEqual(await physical(), before);
    assert.equal(await finish(firstId, snapshot), true);
    const state = await asRole('anon', () => read());
    assert.deepEqual(state.snapshot, snapshot);
    assert.equal(state.attempt.status, 'success');
    assert.equal(state.attempt.done, 2);
    assert.equal(state.attempt.total, 2);
    assert.ok(state.attempt.completedAt);
    assert.equal(await finish(firstId, snapshot), false);
    assert.equal(await progress(firstId, 2, 2), false);
    assert.equal((await claim(firstId)).acquired, false);
    assert.equal((await claim(joinId)).acquired, false);
    assert.deepEqual((await read()).snapshot, snapshot);
  });
  await test('failed runs retain last-good snapshot and replay IDs survive later runs', async () => {
    const previous = (await read()).snapshot;
    const id = randomUUID();
    assert.equal((await claim(id)).acquired, true);
    assert.deepEqual((await read()).snapshot, previous);
    assert.equal(await finish(id, null, 'password=never-echo-fixture https://private.invalid/token'), true);
    const failedState = await read();
    assert.equal(failedState.attempt.status, 'failed');
    assert.equal(failedState.attempt.error, 'Fleet risk refresh failed.');
    assert.deepEqual(failedState.snapshot, previous);
    for (const replay of [firstId, joinId, id]) assert.equal((await claim(replay)).acquired, false);
  });
  await test('malformed and partial payloads are rejected atomically, preserving snapshot and running attempt', async () => {
    const id = randomUUID();
    assert.equal((await claim(id)).acquired, true);
    assert.equal(await progress(id, 1, 2), true);
    const good = await fixtureSnapshot();
    const before = await physical();
    const variants = [
      ['count mismatch', s => { s.count = 1; }],
      ['partial despite self-consistent payload', s => { s.rows.pop(); s.count = 1; s.coverage.referenceCount = 1; }],
      ['empty fleet', s => { s.rows = []; s.count = 0; s.coverage.referenceCount = 0; }],
      ['missing coverage', s => { delete s.coverage; }],
      ['missing reference', s => { s.coverage.missingReferenceImos = [s.rows[0].imo]; }],
      ['duplicate IMO', s => { s.rows[1].imo = s.rows[0].imo; }],
      ['bad checksum', s => { s.rows[0].imo = '1234560'; }],
      ['wrong IMO type', s => { s.rows[0].imo = 1234567; }],
      ['bad company', s => { s.company.imo = '882415'; }],
      ['wrong run', s => { s.id = randomUUID(); }],
      ['wrong trigger', s => { s.trigger = 'scheduled'; }],
      ['rewritten start string', s => { s.queryStartedAt = new Date(s.queryStartedAt).toISOString(); }],
      ['ended before run', s => { s.queryCompletedAt = '2000-01-01T00:00:00Z'; }],
      ['future end', s => { s.queryCompletedAt = '2099-01-01T00:00:00Z'; }],
      ['out of run row', s => { s.rows[0].retrievedAt = '2000-01-01T00:00:00Z'; }],
      ['out of run roster', s => { s.rosterRetrievedAt = '2000-01-01T00:00:00Z'; }],
      ['invalid datetime', s => { s.rows[0].retrievedAt = '2026-99-99T00:00:00Z'; }],
      ['infinite datetime', s => { s.queryCompletedAt = 'infinity'; }],
      ['unknown risk', s => { s.rows[0].risk = 'unknown'; }],
      ['non-ok status', s => { s.rows[0].status = 'failed'; }],
      ['blank name', s => { s.rows[0].name = ' \t\n'; }],
      ['missing field', s => { delete s.rows[0].sourceUpdatedAt; }],
      ['invented update time', s => { s.rows[0].sourceUpdatedAt = s.queryCompletedAt; }],
      ['wrong source', s => { s.rows[0].sourceUrl = 'https://example.invalid/'; }],
      ['invalid priority', s => { s.rows[0].priority = 'I'; }],
      ['wrong window type', s => { s.rows[0].windowFrom = {}; }],
      ['blank operator', s => { s.rows[0].companyName = ''; }],
      ['invalid company IMO', s => { s.rows[0].companyImo = '123'; }],
      ['invalid count type', s => { s.count = '2'; }],
      ['extra field', s => { s.privateData = 'must not be public'; }],
      ['bad coverage count', s => { s.coverage.referenceCount = 3; }],
      ['unknown addition', s => { s.coverage.referenceCount = 1; s.coverage.addedReferenceImos = ['1111117']; }],
      ['duplicate additions', s => { s.coverage.referenceCount = 0; s.coverage.addedReferenceImos = [s.rows[0].imo, s.rows[0].imo]; }],
    ];
    for (const [label, change] of variants) {
      const broken = structuredClone(good); change(broken);
      assert.equal(await finish(id, broken), false, label);
      assert.deepEqual(await physical(), before, label);
    }
    for (const malformed of [{}, [], 'bad', 7]) {
      assert.equal(await finish(id, malformed), false);
      assert.deepEqual(await physical(), before);
    }
    assert.equal(await finish(id, good, 'both error and snapshot'), false);
    assert.deepEqual(await physical(), before);
    good.coverage.referenceCount = 1;
    good.coverage.addedReferenceImos = [good.rows[1].imo];
    good.rows[0].risk = 'SRS'; good.rows[0].priority = 'Priority II';
    good.rows[0].windowFrom = '2026-11-01'; good.rows[0].windowTo = '2027-05-01';
    assert.equal(await finish(id, good), true);
    assert.deepEqual((await read()).snapshot, good);
    console.log(`  validated ${variants.length + 5} malformed/partial cases plus complete addition control`);
  });
  await test('expired read is a no-write failure projection; stale workers cannot overwrite a replacement', async () => {
    const old = randomUUID();
    assert.equal((await claim(old)).acquired, true);
    const expiredSnapshot = await fixtureSnapshot();
    await db.exec("UPDATE public.ship_fleet_risk_cache_v1 SET lease_expires_at = clock_timestamp() - interval '1 second'");
    const physicalExpired = await physical();
    await db.exec('BEGIN READ ONLY');
    const projected = await asRole('anon', () => read());
    await db.exec('COMMIT');
    assert.equal(projected.attempt.status, 'failed');
    assert.equal(projected.attempt.error, 'Fleet risk refresh timed out.');
    assert.equal(projected.attempt.completedAt, await scalar(`SELECT to_char(lease_expires_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value FROM public.ship_fleet_risk_cache_v1`));
    assert.deepEqual(await physical(), physicalExpired);
    assert.equal(await progress(old, 1, 2), false);
    assert.equal(await finish(old, expiredSnapshot), false);
    assert.equal(await finish(old, null, 'timeout'), false);
    assert.equal((await claim(old)).acquired, false);
    const next = randomUUID();
    assert.equal((await claim(next)).acquired, true);
    const nextSnapshot = await fixtureSnapshot();
    const replacement = await physical();
    assert.equal(await finish(old, expiredSnapshot), false);
    assert.equal(await progress(old, 2, 2), false);
    assert.deepEqual(await physical(), replacement);
    assert.equal(await finish(next, nextSnapshot), true);
    assert.deepEqual((await read()).snapshot, nextSnapshot);
    assert.equal((await claim(old)).acquired, false);
  });
  await test('real SET ROLE denies all browser writes/table access and permits only public read', async () => {
    const before = await physical();
    for (const role of ['anon', 'authenticated']) {
      await asRole(role, async () => {
        assert.ok((await read()).snapshot);
        for (const sql of [
          "SELECT public.claim_ship_fleet_risk_v1('manual','00000000-0000-4000-8000-000000000001'::uuid)",
          "SELECT public.progress_ship_fleet_risk_v1('00000000-0000-4000-8000-000000000001'::uuid,0,1)",
          "SELECT public.finish_ship_fleet_risk_v1('00000000-0000-4000-8000-000000000001'::uuid,NULL,NULL)",
          'SELECT * FROM public.ship_fleet_risk_cache_v1',
          'UPDATE public.ship_fleet_risk_cache_v1 SET snapshot = NULL',
          'DELETE FROM public.ship_fleet_risk_cache_v1',
          "INSERT INTO public.ship_fleet_risk_cache_v1(company_imo) VALUES ('0882415')",
          'TRUNCATE public.ship_fleet_risk_cache_v1',
          'SELECT * FROM public.business_sentinel',
        ]) await assert.rejects(() => db.exec(sql), e => e.code === '42501');
      });
    }
    await asRole('service_role', async () => {
      await assert.rejects(() => db.exec('SELECT * FROM public.ship_fleet_risk_cache_v1'), e => e.code === '42501');
    });
    assert.deepEqual(await physical(), before);
    await assert.rejects(() => db.exec("INSERT INTO public.ship_fleet_risk_cache_v1(company_imo) VALUES ('1234567')"), e => e.code === '23514');
    assert.equal(await scalar("SELECT relrowsecurity AS value FROM pg_class WHERE oid='public.ship_fleet_risk_cache_v1'::regclass"), true);
    const functions = (await db.query(`SELECT p.proname, p.prosecdef, p.proconfig,
      NOT EXISTS (SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_revoked
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE '%ship_fleet_risk_v1' ORDER BY p.proname`)).rows;
    assert.equal(functions.length, 4);
    for (const f of functions) {
      assert.equal(f.prosecdef, true); assert.equal(f.public_revoked, true);
      assert.ok(f.proconfig.includes('search_path=pg_catalog')); assert.ok(f.proconfig.includes('TimeZone=UTC'));
    }
    assert.equal(await scalar('SELECT value FROM public.business_sentinel WHERE id=1'), 'unchanged');
    assert.deepEqual((await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows,
      [{ tablename: 'business_sentinel' }, { tablename: 'ship_fleet_risk_cache_v1' }]);
  });
  await test('controlled database clock proves Taipei boundary, one scheduled attempt/day, expiry and next-day eligibility', async () => {
    // Only this separate embedded instance substitutes a clock. Production has no caller-controlled clock/GUC.
    const clockDb = new PGlite();
    try {
      await clockDb.exec(`CREATE SCHEMA fleet_risk_test; CREATE TABLE fleet_risk_test.clock(now_at timestamptz NOT NULL);
        INSERT INTO fleet_risk_test.clock VALUES ('2026-11-09T22:59:59.999999Z');
        CREATE FUNCTION fleet_risk_test.clock_now() RETURNS timestamptz LANGUAGE sql VOLATILE
        AS 'SELECT now_at FROM fleet_risk_test.clock';`);
      const clockOccurrences = migration.split('pg_catalog.clock_timestamp()').length - 1;
      assert.equal(clockOccurrences, 5, 'clock substitution must be explicitly reviewed if source changes');
      await bootstrap(clockDb, migration.replaceAll('pg_catalog.clock_timestamp()', 'fleet_risk_test.clock_now()'));
      const setClock = t => clockDb.query('UPDATE fleet_risk_test.clock SET now_at=$1::timestamptz', [t]);
      let state = await read(clockDb);
      assert.equal(state.nextScheduledAt, '2026-11-09T23:00:00.000000Z');
      assert.equal((await claim(randomUUID(), 'scheduled', clockDb)).acquired, false);
      assert.equal((await read(clockDb)).attempt, null);
      await setClock('2026-11-09T23:00:00Z');
      const daily = randomUUID();
      assert.equal((await claim(daily, 'scheduled', clockDb)).acquired, true);
      state = await read(clockDb);
      assert.equal(state.attempt.trigger, 'scheduled');
      assert.equal(state.nextScheduledAt, '2026-11-10T23:00:00.000000Z');
      assert.equal((await physical(clockDb)).last_scheduled_date, '2026-11-10');
      assert.equal((await claim(randomUUID(), 'scheduled', clockDb)).runId, daily);
      await setClock('2026-11-09T23:04:00Z');
      assert.equal((await read(clockDb)).attempt.status, 'failed');
      assert.equal(await progress(daily, 1, 2, clockDb), false);
      assert.equal(await finish(daily, null, 'timeout', clockDb), false);
      assert.equal((await claim(randomUUID(), 'scheduled', clockDb)).acquired, false);
      const manual = randomUUID();
      assert.equal((await claim(manual, 'manual', clockDb)).acquired, true);
      assert.equal(await finish(manual, null, 'upstream_unavailable', clockDb), true);
      assert.equal((await read(clockDb)).attempt.error, 'Public PSC source is unavailable.');
      assert.equal((await claim(daily, 'scheduled', clockDb)).acquired, false);
      await setClock('2026-11-10T22:59:59Z');
      assert.equal((await claim(randomUUID(), 'scheduled', clockDb)).acquired, false);
      await setClock('2026-11-10T23:00:00Z');
      const tomorrow = randomUUID();
      assert.equal((await claim(tomorrow, 'scheduled', clockDb)).acquired, true);
      assert.equal(await finish(tomorrow, await fixtureSnapshot(clockDb), null, clockDb), true);
      assert.equal((await claim(randomUUID(), 'scheduled', clockDb)).acquired, false);
      assert.equal((await claim(randomUUID(), 'manual', clockDb)).acquired, true);
      // Scheduler callers cannot move the fixed Taipei calculation by changing their session zone.
      await clockDb.exec("SET timezone='America/New_York'");
      assert.equal((await read(clockDb)).nextScheduledAt, '2026-11-11T23:00:00.000000Z');
    } finally { await clockDb.close(); }
  });
  await test('separate cron installer fails closed without hosted prerequisites and creates nothing', async () => {
    const path = resolve(root, 'supabase/deployment/fleet-risk-0700-cron-install.sql');
    assert.ok(existsSync(path), 'separate cron install artifact must exist');
    const install = await readFile(path, 'utf8');
    await assert.rejects(() => db.exec(install), /requires pg_cron, pg_net and supabase_vault/i);
    await db.exec('ROLLBACK');
    assert.equal(await scalar("SELECT to_regprocedure('public.invoke_ship_fleet_risk_schedule_v1(boolean)') IS NULL AS value"), true);
  });
  await test('explicit cron/net/Vault SHIMS rehearse named-job-only install, guards, payload and redacted readback (not hosted scheduling)', async () => {
    const cronDb = new PGlite();
    try {
      await bootstrap(cronDb, migration);
      await cronDb.exec(`SET timezone='UTC'; SET cron.timezone='GMT';
        CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA vault;
        CREATE TABLE vault.decrypted_secrets(name text NOT NULL, decrypted_secret text);
        CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text NOT NULL, schedule text NOT NULL,
          command text NOT NULL, database text DEFAULT current_database(), username text DEFAULT current_user,
          active boolean DEFAULT true);
        CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE plpgsql AS $shim$
          DECLARE id bigint; BEGIN INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3)
          RETURNING jobid INTO id; RETURN id; END $shim$;
        CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE plpgsql AS $shim$
          BEGIN DELETE FROM cron.job WHERE jobid=$1; RETURN FOUND; END $shim$;
        CREATE TABLE net.calls(id bigserial PRIMARY KEY, url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer);
        CREATE FUNCTION net.http_post(url text,body jsonb,params jsonb,headers jsonb,timeout_milliseconds integer)
          RETURNS bigint LANGUAGE plpgsql AS $shim$ DECLARE id bigint; BEGIN
          INSERT INTO net.calls(url,body,params,headers,timeout_milliseconds) VALUES($1,$2,$3,$4,$5)
          RETURNING net.calls.id INTO id; RETURN id; END $shim$;
        INSERT INTO cron.job(jobname,schedule,command) VALUES('unrelated-preserved-job','5 9 * * *','SELECT 42');`);
      const install = await readFile(resolve(root, 'supabase/deployment/fleet-risk-0700-cron-install.sql'), 'utf8');
      const guard = /-- BEGIN HOSTED EXTENSION GUARD[\s\S]*?-- END HOSTED EXTENSION GUARD/g;
      assert.equal([...install.matchAll(guard)].length, 1);
      // This single catalog-presence guard cannot pass without real extensions. Replace only for this labelled fixture.
      const shimInstall = install.replace(guard, '-- TEST-ONLY: extension-presence guard replaced; schemas are explicit in-memory SHIMS');
      const q = (sql, args = []) => scalar(sql, args, cronDb);
      const failInstall = async pattern => {
        await assert.rejects(() => cronDb.exec(shimInstall), pattern);
        await cronDb.exec('ROLLBACK');
      };
      await failInstall(/configuration or enqueue failed/);
      assert.equal(await q("SELECT to_regprocedure('public.invoke_ship_fleet_risk_schedule_v1(boolean)') IS NULL AS value"), true);
      const fixtureSecrets = {
        ship_fleet_risk_url: 'https://fixture-project.supabase.co/functions/v1/fleet-risk',
        ship_fleet_risk_anon_key: 'SYNTHETIC-ANON-JWT-NOT-A-CREDENTIAL',
        ship_fleet_risk_scheduler_token: 'SYNTHETIC-SCHEDULER-TOKEN-NOT-A-CREDENTIAL',
      };
      const resetConfig = async () => {
        await cronDb.exec('DELETE FROM vault.decrypted_secrets');
        for (const [name, value] of Object.entries(fixtureSecrets)) {
          await cronDb.query('INSERT INTO vault.decrypted_secrets VALUES($1,$2)', [name, value]);
        }
      };
      await resetConfig();
      const unrelated = await q("SELECT to_jsonb(j) AS value FROM cron.job j WHERE jobname='unrelated-preserved-job'");
      await cronDb.exec("SET timezone='Asia/Taipei'");
      await failInstall(/requires UTC database and cron timezones/);
      await cronDb.exec("SET timezone='UTC'; SET cron.timezone='Asia/Taipei'");
      await failInstall(/requires UTC database and cron timezones/);
      await cronDb.exec("SET cron.timezone='GMT'");
      await cronDb.exec(shimInstall);
      await cronDb.exec(shimInstall); // only this job may be replaced
      const job = await q("SELECT to_jsonb(j) AS value FROM cron.job j WHERE jobname='ship-fleet-risk-taipei-0700-v1'");
      assert.equal(job.schedule, '0 23 * * *');
      assert.equal(job.command, 'SELECT public.invoke_ship_fleet_risk_schedule_v1();');
      assert.equal(job.active, true);
      assert.equal(await q('SELECT count(*)::integer AS value FROM cron.job'), 2);
      assert.deepEqual(await q("SELECT to_jsonb(j) AS value FROM cron.job j WHERE jobname='unrelated-preserved-job'"), unrelated);
      assert.equal(await q('SELECT count(*)::integer AS value FROM net.calls'), 0, 'installation MUST NOT enqueue HTTP');
      for (const role of ['anon','authenticated','service_role']) {
        await asRole(role, async () => {
          await assert.rejects(() => cronDb.exec('SELECT public.invoke_ship_fleet_risk_schedule_v1()'), e => e.code === '42501');
        }, cronDb);
      }
      const snapshotBefore = await physical(cronDb);
      await q('SELECT public.invoke_ship_fleet_risk_schedule_v1() AS value');
      assert.equal(await q('SELECT count(*)::integer AS value FROM net.calls'), 1);
      const payload = await q('SELECT to_jsonb(c) AS value FROM net.calls c');
      assert.equal(payload.url, fixtureSecrets.ship_fleet_risk_url);
      assert.deepEqual(payload.body, { action: 'scheduled' });
      assert.deepEqual(payload.params, {});
      assert.deepEqual(payload.headers, { 'Content-Type': 'application/json',
        Authorization: `Bearer ${fixtureSecrets.ship_fleet_risk_anon_key}`,
        'x-fleet-scheduler-token': fixtureSecrets.ship_fleet_risk_scheduler_token });
      assert.equal(payload.timeout_milliseconds, 210000);
      assert.deepEqual(await physical(cronDb), snapshotBefore, 'enqueue is not a worker success');
      const rejectInvoke = async () => {
        await assert.rejects(() => q('SELECT public.invoke_ship_fleet_risk_schedule_v1() AS value'), /configuration or enqueue failed/);
        assert.equal(await q('SELECT count(*)::integer AS value FROM net.calls'), 1);
      };
      for (const name of Object.keys(fixtureSecrets)) {
        await resetConfig(); await cronDb.query('DELETE FROM vault.decrypted_secrets WHERE name=$1', [name]); await rejectInvoke();
        await resetConfig(); await cronDb.query('INSERT INTO vault.decrypted_secrets VALUES($1,$2)', [name, fixtureSecrets[name]]); await rejectInvoke();
        for (const invalid of ['', null, ' \r\n']) {
          await resetConfig(); await cronDb.query('UPDATE vault.decrypted_secrets SET decrypted_secret=$2 WHERE name=$1', [name, invalid]);
          await rejectInvoke();
        }
      }
      for (const invalidUrl of ['http://fixture-project.supabase.co/functions/v1/fleet-risk',
        'https://supabase.co/functions/v1/fleet-risk', 'https://fixture-project.supabase.co.evil.invalid/functions/v1/fleet-risk',
        'https://fixture-project.supabase.co/functions/v1/other', 'https://fixture-project.supabase.co/functions/v1/fleet-risk?token=bad',
        'https://user@fixture-project.supabase.co/functions/v1/fleet-risk', 'https://fixture-project.supabase.co:443/functions/v1/fleet-risk']) {
        await resetConfig(); await cronDb.query("UPDATE vault.decrypted_secrets SET decrypted_secret=$1 WHERE name='ship_fleet_risk_url'", [invalidUrl]);
        await rejectInvoke();
      }
      // Invalid reinstallation rolls back the replacement and retains the prior named job exactly.
      await failInstall(/configuration or enqueue failed/);
      assert.deepEqual(await q("SELECT to_jsonb(j) AS value FROM cron.job j WHERE jobname='ship-fleet-risk-taipei-0700-v1'"), job);
      await resetConfig();
      await cronDb.exec("UPDATE cron.job SET username='different-owner' WHERE jobname='ship-fleet-risk-taipei-0700-v1'");
      await failInstall(/ambiguous or owned elsewhere/);
      await cronDb.exec("UPDATE cron.job SET username=current_user WHERE jobname='ship-fleet-risk-taipei-0700-v1'");
      const readback = await readFile(resolve(root, 'supabase/verification/fleet-risk-readback.sql'), 'utf8');
      const physicalBefore = await physical(cronDb);
      const readbackResults = await cronDb.exec(readback);
      const resultRows = readbackResults.flatMap(r => r.rows ?? []);
      for (const marker of ['cache_table_exists', 'rls_enabled']) {
        const checks = resultRows.find(r => Object.hasOwn(r, marker));
        assert.ok(checks, marker);
        for (const [key, value] of Object.entries(checks)) assert.equal(value, true, key);
      }
      const envelopeChecks = resultRows.find(r => Object.hasOwn(r, 'envelope_present'));
      assert.deepEqual(envelopeChecks, { envelope_present: true, has_last_good_snapshot: false,
        has_attempt: false, next_schedule_future: true, next_schedule_taipei_0700: true });
      const aclRows = resultRows.filter(r => r.function_name);
      assert.equal(aclRows.length, 5);
      for (const row of aclRows) for (const [key, value] of Object.entries(row)) if (key !== 'function_name') assert.equal(value, true, `${row.function_name}.${key}`);
      const vaultRows = resultRows.filter(r => r.vault_entry);
      assert.equal(vaultRows.length, 3);
      for (const row of vaultRows) {
        assert.equal(row.exactly_one, true); assert.equal(row.nonempty_no_whitespace, true); assert.equal(row.target_format_ok, true);
      }
      const jobCheck = resultRows.find(r => r.target_schedule);
      assert.equal(jobCheck.target_schedule, '0 23 * * *');
      for (const [key,value] of Object.entries(jobCheck)) if (key !== 'target_schedule') assert.equal(value, true, key);
      const serialized = JSON.stringify(resultRows);
      for (const value of Object.values(fixtureSecrets)) assert.equal(serialized.includes(value), false, 'readback must redact all configured values');
      assert.deepEqual(await physical(cronDb), physicalBefore);
      assert.equal(await q('SELECT count(*)::integer AS value FROM net.calls'), 1, 'readback MUST NOT enqueue HTTP');
      assert.deepEqual(await q("SELECT to_jsonb(j) AS value FROM cron.job j WHERE jobname='unrelated-preserved-job'"), unrelated);
      const consolidated = resultRows.find(r => Object.hasOwn(r, 'fleet_risk_readback'))?.fleet_risk_readback;
      assert.ok(consolidated, 'one final exportable verdict must include all catalog/Vault/cron checks, not only the last snapshot grid');
      const expectedChecks = {};
      for (const row of resultRows.filter(r => !Object.hasOwn(r, 'fleet_risk_readback'))) {
        const prefix = row.function_name ? `function.${row.function_name}` : row.vault_entry ? `vault.${row.vault_entry}`
          : Object.hasOwn(row, 'cache_table_exists') ? 'objects' : Object.hasOwn(row, 'rls_enabled') ? 'table'
          : Object.hasOwn(row, 'pg_cron_present') ? 'extension' : Object.hasOwn(row, 'exactly_one_target_job') ? 'job' : 'snapshot';
        for (const [key, value] of Object.entries(row)) if (typeof value === 'boolean') expectedChecks[`${prefix}.${key}`] = value;
      }
      assert.equal(Object.keys(expectedChecks).length, 70);
      assert.equal(consolidated.expected_check_count, 70);
      assert.equal(consolidated.check_count, 70);
      assert.equal(consolidated.unique_check_count, 70);
      assert.deepEqual(consolidated.checks, expectedChecks, 'final export must preserve every earlier boolean, including false');
      assert.equal(consolidated.verdict, 'CHECK_REQUIRED', 'local shims must not pass hosted extension checks');
      assert.deepEqual(consolidated.failed_install_checks, ['extension.pg_cron_present', 'extension.pg_net_present', 'extension.vault_present']);
      // Explicit test-only catalog predicates; never use this modified SQL for the operator handoff.
      let syntheticCatalogReadback = readback;
      for (const extension of ['pg_cron', 'pg_net', 'supabase_vault']) {
        const predicate = `EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = '${extension}')`;
        assert.equal(syntheticCatalogReadback.split(predicate).length - 1, 2);
        syntheticCatalogReadback = syntheticCatalogReadback.replaceAll(predicate, 'true /* TEST-ONLY extension availability */');
      }
      const summaryRead = async () => (await cronDb.exec(syntheticCatalogReadback)).flatMap(r => r.rows ?? [])
        .find(r => Object.hasOwn(r, 'fleet_risk_readback')).fleet_risk_readback;
      assert.equal((await summaryRead()).verdict, 'PASS_INSTALL_ONLY', 'positive logical control is catalog-only, not hosted proof');
      for (const [change, restore, failedKey] of [
        ["UPDATE cron.job SET active=false WHERE jobname='ship-fleet-risk-taipei-0700-v1'", "UPDATE cron.job SET active=true WHERE jobname='ship-fleet-risk-taipei-0700-v1'", 'job.job_active'],
        ["UPDATE vault.decrypted_secrets SET decrypted_secret='' WHERE name='ship_fleet_risk_scheduler_token'", "UPDATE vault.decrypted_secrets SET decrypted_secret='SYNTHETIC-SCHEDULER-TOKEN-NOT-A-CREDENTIAL' WHERE name='ship_fleet_risk_scheduler_token'", 'vault.ship_fleet_risk_scheduler_token.nonempty_no_whitespace'],
        ['GRANT EXECUTE ON FUNCTION public.invoke_ship_fleet_risk_schedule_v1(boolean) TO anon', 'REVOKE EXECUTE ON FUNCTION public.invoke_ship_fleet_risk_schedule_v1(boolean) FROM anon', 'function.invoke_ship_fleet_risk_schedule_v1.anon_acl_ok'],
      ]) {
        await cronDb.exec(change);
        try {
          const failed = await summaryRead();
          assert.equal(failed.verdict, 'CHECK_REQUIRED');
          assert.deepEqual(failed.failed_install_checks, [failedKey]);
          assert.equal(failed.checks[failedKey], false);
        } finally { await cronDb.exec(restore); }
      }
      assert.equal((await summaryRead()).verdict, 'PASS_INSTALL_ONLY');
      assert.deepEqual(await physical(cronDb), physicalBefore);
      assert.equal(await q('SELECT count(*)::integer AS value FROM net.calls'), 1, 'consolidated readbacks must not enqueue HTTP');
      assert.deepEqual(await q("SELECT to_jsonb(j) AS value FROM cron.job j WHERE jobname='unrelated-preserved-job'"), unrelated);
      // Extension flags correctly remain false: a shim MUST NOT masquerade as a real extension.
      const prereq = resultRows.find(r => Object.hasOwn(r, 'pg_cron_present'));
      assert.equal(prereq.pg_cron_present, false); assert.equal(prereq.pg_net_present, false); assert.equal(prereq.vault_present, false);
      await writeFile(resolve(evidence, `${stage}-shim-readback.json`), JSON.stringify({ layer: 'SHIMS ONLY, NOT HOSTED CRON', rows: resultRows }, null, 2) + '\n');
    } finally { await cronDb.close(); }
  });
} catch (error) {
  failed = true;
  if (!cases.some(c => c.status === 'FAIL')) cases.push({ name: 'setup', status: 'FAIL', error: error.message });
} finally {
  await db.close();
  const artifactPaths = ['supabase/migrations/20261110070000_ship_fleet_risk.sql',
    'supabase/deployment/fleet-risk-0700-cron-install.sql', 'supabase/verification/fleet-risk-readback.sql',
    'scripts/verify-fleet-risk-database.mjs', 'docs/fleet-risk-database-handoff.md'];
  const artifacts = [];
  for (const path of artifactPaths) {
    if (!existsSync(resolve(root, path))) continue;
    const bytes = await readFile(resolve(root, path));
    artifacts.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const report = { layer: 'real embedded PostgreSQL via PGlite; NOT hosted cron/net or multi-backend lock proof', stage,
    nodeVersion: process.version, artifacts,
    migrationSha256: createHash('sha256').update(migration).digest('hex'), cases,
    passed: cases.filter(c => c.status === 'PASS').length, failed: cases.filter(c => c.status === 'FAIL').length };
  await writeFile(resolve(evidence, `${stage}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`RESULT ${report.passed} passed; ${report.failed} failed. Embedded PostgreSQL only; no hosted scheduler executed.`);
  if (failed) process.exitCode = 1;
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Reuse an explicitly owned synthetic loopback fixture; never accept a DB URL.
// Set SHIP_QA_OWNED_TRIAL_ROOT, SHIP_QA_PG_MODULE and optional QA_OUTPUT.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.SHIP_QA_OWNED_TRIAL_ROOT;
assert.ok(root && process.env.SHIP_QA_PG_MODULE, 'Provide an owned synthetic trial and the local pg module.');
const owned = JSON.parse(fs.readFileSync(path.join(root, 'database-v2/OWNED-QA.json'), 'utf8'));
assert.equal(owned.kind, 'records-v1-native-synthetic');
assert.equal(path.resolve(owned.data), path.resolve(root, 'database-v2/data'));
const { Client } = createRequire(import.meta.url)(process.env.SHIP_QA_PG_MODULE);
const c = new Client({ host: '127.0.0.1', port: owned.port, user: 'ship_qa', database: 'postgres', password: '', ssl: false, connectionTimeoutMillis: 3000, application_name: 'itinerary_readback_copy_regression' });
const sql = fs.readFileSync(path.join(repo, 'supabase/verification/itinerary_current_state_readback.sql'), 'utf8').replace(/\r\n/g, '\n');
const output = fs.mkdtempSync(path.join(process.env.QA_OUTPUT || os.tmpdir(), 'itinerary-readback-copy-'));
const receipt = { layer: 'native PostgreSQL / read-only queries', productionAccessed: false, querySha256: createHash('sha256').update(sql).digest('hex'), cases: [] };
const formats = [
  ['LF', s => s],
  ['CRLF', s => s.replace(/\n/g, '\r\n')],
  ['mixed', s => s.split('\n').map((line, i) => line + (i % 2 ? '\r' : '')).join('\n')],
];
const run = async text => {
  const results = await c.query(text);
  const rows = results.flatMap(r => r.rows).filter(r => r.readback_id?.startsWith('current-state-readback-v'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].check_count, '24');
  return rows[0];
};
const test = async (name, fn) => {
  try { await fn(); receipt.cases.push({ name, ok: true }); }
  catch (e) { receipt.cases.push({ name, ok: false, error: e.message.slice(0, 1000) }); throw e; }
};
try {
  await c.connect();
  const identity = (await c.query("select current_setting('data_directory') data, host(inet_server_addr()) host, inet_server_port() port, current_user actor")).rows[0];
  assert.equal(path.resolve(identity.data), path.resolve(owned.data));
  assert.equal(identity.host, '127.0.0.1'); assert.equal(identity.port, owned.port); assert.equal(identity.actor, 'ship_qa');
  receipt.identityVerified = true;
  for (const [format, transform] of formats) {
    await test(format + ' valid installed definitions', async () => {
      const r = await run(transform(sql));
      assert.equal(r.overall, 'PASS', JSON.stringify(r));
      assert.equal(r.failed_count, '0'); assert.deepEqual(r.failed_checks, []);
      const copiedProbe = transform(sql).match(/\$copy_format\$([\s\S]*?)\$copy_format\$/)[1];
      assert.equal(r.copied_sql_contains_cr, copiedProbe.includes('\r'));
    });
  }
  for (const [format, transform] of formats) {
    await test(format + ' wrong body fingerprint stays FAIL', async () => {
      const bad = sql.replace('029a21874ef2b4b2f5444a64d0ab5340', '00000000000000000000000000000000');
      assert.notEqual(bad, sql);
      const r = await run(transform(bad));
      assert.equal(r.overall, 'FAIL'); assert.equal(r.failed_count, '1');
      assert.deepEqual(r.failed_checks, ['exact_installed_body: public.sd_itinerary_rows_valid(jsonb)']);
    });
    await test(format + ' wrong guard actor stays FAIL', async () => {
      const bad = sql.replace("p_actor_kind <> 'public'", "p_actor_kind <> 'INCORRECT-ACTOR'");
      assert.notEqual(bad, sql);
      const r = await run(transform(bad));
      assert.equal(r.overall, 'FAIL'); assert.equal(r.failed_count, '4');
      assert.equal(r.failed_checks.length, 4);
      assert.ok(r.failed_checks.every(name => name.startsWith('ship_only_guard: ')));
    });
  }
} catch (e) { receipt.error = e.message.slice(0, 1000); process.exitCode = 1; }
finally {
  await c.end();
  receipt.ok = !receipt.error && receipt.cases.length === 9 && receipt.cases.every(c => c.ok);
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ ...receipt, receipt: path.join(output, 'receipt.json') }));
  if (!receipt.ok) process.exitCode = 1;
}

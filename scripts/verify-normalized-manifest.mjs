import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'supabase/normalized-manifest.json'), 'utf8'));
assert.equal(manifest.version, 1);
assert.ok(Array.isArray(manifest.migrations));
assert.equal(new Set(manifest.migrations).size, manifest.migrations.length);
const expectedOrder = [
  'normalized-schema.sql',
  'normalized-core-domain.sql',
  'normalized-meeting.sql',
  'normalized-internal-control.sql',
  'normalized-security-dispatch.sql',
  'normalized-auth-orchestration.sql',
  'normalized-app-contract.sql',
  'normalized-realtime.sql',
  'normalized-legacy-cutover.sql',
  'normalized-legacy-import.sql',
];
assert.deepEqual(manifest.migrations.map(path => path.split('/').at(-1)), expectedOrder);
const directoryEntries = await readdir(resolve(root, 'supabase'));
const normalizedSql = directoryEntries.filter(name => /^normalized-.*\.sql$/.test(name)).sort();
assert.deepEqual([...expectedOrder].sort(), normalizedSql, 'every normalized migration must appear exactly once');

let schema = '';
for (const relative of manifest.migrations) {
  assert.match(relative, /^supabase\/normalized-[a-z0-9-]+\.sql$/);
  const sql = await readFile(resolve(root, relative), 'utf8');
  assert.match(sql, /^\s*begin\s*;/i, `${relative} must start a transaction`);
  assert.match(sql, /commit\s*;\s*$/i, `${relative} must commit its transaction`);
  if (!relative.endsWith('normalized-realtime.sql')) schema += `\n${sql}`;
}
const realtime = await readFile(resolve(root, 'supabase/normalized-realtime.sql'), 'utf8');
const realtimeList = realtime.match(/v_tables\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/i)?.[1] || '';
const publishedTables = [...new Set(realtimeList.match(/sd_[a-z0-9_]+/g) || [])].sort();
const created = new Set([...schema.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z0-9_]+)/gi)].map(match => match[1]));
const rls = new Set([...schema.matchAll(/alter\s+table\s+public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi)].map(match => match[1]));
for (const table of publishedTables) {
  assert.ok(created.has(table), `Realtime table missing: ${table}`);
  assert.ok(rls.has(table), `Realtime table lacks RLS: ${table}`);
}
for (const sensitive of [
  'sd_login_options', 'sd_public_site_gate', 'sd_rate_limit_buckets',
  'sd_edit_leases', 'sd_operations', 'sd_operation_reservations',
  'sd_audit_events', 'sd_legacy_imports', 'sd_legacy_write_controls',
  'sd_migration_quarantine',
]) {
  assert.ok(!publishedTables.includes(sensitive), `sensitive table published: ${sensitive}`);
}
assert.match(realtime, /supabase_realtime/);
assert.ok(!manifest.migrations.includes('supabase/schema.sql'));
assert.ok(!JSON.stringify(manifest).includes('public/supabase-config.js'));
console.log(`normalized_manifest=PASS files=${manifest.migrations.length} realtime_tables=${publishedTables.length}`);

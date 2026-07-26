import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();
await db.exec(`
  create role anon noinherit;
  create role authenticated noinherit;
  create role service_role noinherit bypassrls;
  create table public.ship_dynamics_app_state (
    workspace_key text primary key,
    payload jsonb not null,
    revision integer not null,
    updated_at timestamptz not null default now(),
    updated_by text
  );
  alter table public.ship_dynamics_app_state enable row level security;
  grant select, insert, update on public.ship_dynamics_app_state to anon, authenticated;
  create policy legacy_read on public.ship_dynamics_app_state for select using (true);
  create policy legacy_insert on public.ship_dynamics_app_state for insert with check (true);
  create policy legacy_update on public.ship_dynamics_app_state for update using (true) with check (true);
`);
await db.exec(await readFile(resolve(root, 'supabase/normalized-legacy-cutover.sql'), 'utf8'));
await db.exec(`insert into public.ship_dynamics_app_state(workspace_key,payload,revision) values ('fixture','{"b":1,"aa":2}'::jsonb,7)`);

async function asRole(role, action) {
  await db.exec(`set role ${role}`);
  try { return await action(); }
  finally { await db.exec('reset role'); }
}

for (const role of ['anon', 'authenticated']) {
  await assert.rejects(
    () => asRole(role, () => db.query(
      `select public.freeze_ship_dynamics_legacy_writes('fixture',7,$1,'freeze:fixture:7:' || $1)`,
      [createHash('sha256').update('{"b": 1, "aa": 2}').digest('hex')],
    )),
    /permission denied|not-authorized/i,
  );
}
const frozenPayloadText = '{"b": 1, "aa": 2}';
const frozenPayloadSha256 = createHash('sha256').update(frozenPayloadText).digest('hex');
await assert.rejects(
  () => asRole('service_role', () => db.query(
    `select public.export_ship_dynamics_legacy_backup('fixture',7,$1)`,
    [frozenPayloadSha256],
  )),
  /frozen/i,
  'an authoritative backup cannot be exported before the source is frozen',
);
await assert.rejects(
  () => asRole('service_role', () => db.query(
    `select public.freeze_ship_dynamics_legacy_writes('fixture',6,$1,'freeze:fixture:6:' || $1)`,
    [frozenPayloadSha256],
  )),
  /revision/i,
);
const frozen = await asRole('service_role', () => db.query(
  `select public.freeze_ship_dynamics_legacy_writes('fixture',7,$1,'freeze:fixture:7:' || $1) as result`,
  [frozenPayloadSha256],
));
assert.equal(frozen.rows[0].result.status, 'frozen');
assert.equal(frozen.rows[0].result.payloadSha256, frozenPayloadSha256);
await assert.rejects(
  () => asRole('service_role', () => db.query(
    `select public.export_ship_dynamics_legacy_backup('fixture',7,$1)`,
    ['f'.repeat(64)],
  )),
  /freeze|snapshot|hash|mismatch/i,
  'backup must match the exact frozen snapshot hash',
);

for (const role of ['anon', 'authenticated', 'service_role']) {
  await assert.rejects(
    () => asRole(role, () => db.exec(`update public.ship_dynamics_app_state set revision=8 where workspace_key='fixture'`)),
    role === 'service_role' ? /legacy-writes-frozen|permission denied/i : /legacy-writes-frozen/i,
    `${role} direct writes must be blocked by the server boundary`,
  );
}

const exported = await asRole('service_role', () => db.query(
  `select public.export_ship_dynamics_legacy_backup('fixture',7,$1) as result`,
  [frozenPayloadSha256],
));
const backup = exported.rows[0].result;
assert.equal(backup.payloadText, '{"b": 1, "aa": 2}', 'PostgreSQL jsonb canonical key order is authoritative');
assert.equal(
  backup.payloadSha256,
  createHash('sha256').update(backup.payloadText).digest('hex'),
  'server hash must cover the exact exported canonical text',
);
await assert.rejects(
  () => asRole('service_role', () => db.query(
    `select public.restore_ship_dynamics_legacy_backup('fixture',7,'{"b":1,"aa":3}'::jsonb,$1,null,null,'restore:fixture:7:' || $1)`,
    [backup.payloadSha256],
  )),
  /hash/i,
);
await assert.rejects(
  () => asRole('service_role', () => db.query(
    `select public.reenable_ship_dynamics_legacy_writes('fixture',7,$1,'wrong')`,
    [backup.payloadSha256],
  )),
  /confirmation/i,
);

const reenabled = await asRole('service_role', () => db.query(
  `select public.reenable_ship_dynamics_legacy_writes('fixture',7,$1,'reenable:fixture:7:' || $1) as result`,
  [backup.payloadSha256],
));
assert.equal(reenabled.rows[0].result.status, 'write-enabled');
await asRole('anon', () => db.exec(`update public.ship_dynamics_app_state set payload='{"damaged":true}'::jsonb, revision=8 where workspace_key='fixture'`));
await asRole('service_role', () => db.query(
  `select public.freeze_ship_dynamics_legacy_writes('fixture',8,$1,'freeze:fixture:8:' || $1)`,
  [createHash('sha256').update('{"damaged": true}').digest('hex')],
));
const restored = await asRole('service_role', () => db.query(
  `select public.restore_ship_dynamics_legacy_backup('fixture',7,$1::jsonb,$2,null,null,'restore:fixture:7:' || $2) as result`,
  [backup.payloadText, backup.payloadSha256],
));
assert.equal(restored.rows[0].result.status, 'restored');
const row = await db.query(`select payload,revision from public.ship_dynamics_app_state where workspace_key='fixture'`);
assert.deepEqual(row.rows, [{ payload: { b: 1, aa: 2 }, revision: 7 }]);

console.log('normalized_legacy_cutover_db=PASS');

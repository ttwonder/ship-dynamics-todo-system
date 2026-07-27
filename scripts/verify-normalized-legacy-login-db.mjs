import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();
await db.exec(`
  create schema auth;
  create schema extensions;
  create role anon noinherit;
  create role authenticated noinherit;
  create role service_role noinherit bypassrls;
  create table auth.users(id uuid primary key, email text unique);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function extensions.gen_salt(text,integer) returns text
    language sql immutable as $$ select '$2b$12$00000000000000000000000000000000000000000000000000000' $$;
  create function extensions.crypt(value text, salt text) returns text
    language sql immutable as $$ select salt $$;
`);
for (const file of [
  'supabase/normalized-schema.sql',
  'supabase/normalized-core-domain.sql',
  'supabase/normalized-auth-orchestration.sql',
]) {
  await db.exec(await readFile(resolve(root, file), 'utf8'));
}
await db.exec(`
  alter table public.sd_memberships add column legacy_user_id text;
  create table public.ship_dynamics_app_state(
    workspace_key text primary key,
    payload jsonb not null,
    revision bigint not null default 0
  );
`);

const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  operator: '33333333-3333-4333-8333-333333333333',
};
const oldAdminPassword = 'old-admin-password';
const ownerHash = createHash('sha256').update('old-owner-password').digest('hex');
const adminHash = createHash('sha256').update(oldAdminPassword).digest('hex');
const legacyPayload = {
  users: [
    { id: 'legacy-owner', passwordHash: ownerHash },
    { id: 'legacy-admin', passwordHash: adminHash },
    { id: 'legacy-operator', passwordHash: '' },
  ],
};
await db.exec(`
  insert into auth.users(id,email) values
    ('${ids.owner}','owner@internal.invalid'),('${ids.admin}','admin@internal.invalid'),('${ids.operator}','operator@internal.invalid');
  insert into public.sd_workspaces(id,legacy_key,name) values ('${ids.workspace}','legacy-auth-test','Legacy Auth Test');
  insert into public.sd_profiles(id,display_name,username_label) values
    ('${ids.owner}','Owner','owner'),('${ids.admin}','Admin','admin'),('${ids.operator}','Operator','operator');
  insert into public.sd_memberships(workspace_id,user_id,department,role,is_active,legacy_user_id) values
    ('${ids.workspace}','${ids.owner}','Management','owner',true,'legacy-owner'),
    ('${ids.workspace}','${ids.admin}','Management','admin',true,'legacy-admin'),
    ('${ids.workspace}','${ids.operator}','Operations','operator',true,'legacy-operator');
  insert into public.sd_login_options(workspace_id,user_id,department,username_label,display_name,auth_alias,is_active) values
    ('${ids.workspace}','${ids.owner}','Management','owner','Owner','owner@internal.invalid',true),
    ('${ids.workspace}','${ids.admin}','Management','admin','Admin','admin@internal.invalid',true),
    ('${ids.workspace}','${ids.operator}','Operations','operator','Operator','operator@internal.invalid',true);
`);
await db.query(
  `insert into public.ship_dynamics_app_state(workspace_key,payload,revision) values ('legacy-auth-test',$1::jsonb,4910)`,
  [JSON.stringify(legacyPayload)],
);

const migration = await readFile(
  resolve(root, 'supabase/migrations/20260727090000_legacy_login_compatibility.sql'),
  'utf8',
);
await db.exec(migration);

const modes = await db.query(`
  select m.role,l.login_mode,l.must_change_password,l.legacy_password_hash
  from public.sd_login_options l
  join public.sd_memberships m using(workspace_id,user_id)
  order by m.role
`);
assert.deepEqual(modes.rows, [
  { role: 'admin', login_mode: 'legacy-password', must_change_password: false, legacy_password_hash: adminHash },
  { role: 'operator', login_mode: 'passwordless', must_change_password: false, legacy_password_hash: null },
  { role: 'owner', login_mode: 'supabase', must_change_password: true, legacy_password_hash: ownerHash },
]);

for (const role of ['anon', 'authenticated']) {
  await assert.rejects(
    () => db.exec(`set role ${role}; select legacy_password_hash from public.sd_login_options; reset role`),
    /permission denied/i,
    `${role} must not read legacy credential hashes`,
  );
  await db.exec('reset role');
}
await db.exec('set role service_role');
const serviceRows = await db.query(`select count(*)::integer as count from public.sd_login_options`);
await db.exec('reset role');
assert.equal(serviceRows.rows[0].count, 3, 'only the service role compatibility endpoint needs direct credential access');

await assert.rejects(
  () => db.exec(`update public.sd_login_options set login_mode='legacy-password',legacy_password_hash=null where user_id='${ids.admin}'`),
  /constraint/i,
);
await assert.rejects(
  () => db.exec(`update public.sd_login_options set login_mode='passwordless',legacy_password_hash='${adminHash}' where user_id='${ids.admin}'`),
  /constraint/i,
);

await db.exec(`
  set role authenticated;
  set request.jwt.claim.sub='${ids.admin}';
  select public.complete_my_ship_dynamics_password_activation('${ids.workspace}');
  reset role;
  reset request.jwt.claim.sub;
`);
const changedCredential = await db.query(`
  select login_mode,must_change_password,legacy_password_hash
  from public.sd_login_options
  where workspace_id='${ids.workspace}' and user_id='${ids.admin}'
`);
assert.deepEqual(changedCredential.rows, [{
  login_mode: 'supabase',
  must_change_password: false,
  legacy_password_hash: null,
}], 'a successful personal password change must permanently remove the old legacy credential');

assert.match(migration, /mark_ship_dynamics_password_reset_required[\s\S]*login_mode\s*=\s*'supabase'/i);
assert.match(migration, /mark_ship_dynamics_password_reset_required[\s\S]*legacy_password_hash\s*=\s*null/i,
  'a manager reset must erase the former legacy credential');
assert.match(migration, /complete_my_ship_dynamics_password_activation[\s\S]*login_mode\s*=\s*'supabase'[\s\S]*legacy_password_hash\s*=\s*null[\s\S]*must_change_password\s*=\s*false/i,
  'a personal password change must erase the former legacy credential and enter native mode');
assert.match(migration, /transfer_ship_dynamics_owner[\s\S]*login_mode\s*=\s*'supabase'/i);
assert.match(migration, /legacy_password_hash[\s\S]*role\s*=\s*'owner'/i);

console.log('normalized_legacy_login_db=PASS');

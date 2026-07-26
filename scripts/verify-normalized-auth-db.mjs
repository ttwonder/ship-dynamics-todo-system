import assert from 'node:assert/strict';
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
    language sql immutable as $$
      select '$2b$12$' || substring(encode(sha256(convert_to(value,'UTF8')),'hex') from 1 for 53)
    $$;
`);
for (const file of [
  'supabase/normalized-schema.sql',
  'supabase/normalized-core-domain.sql',
  'supabase/normalized-auth-orchestration.sql',
]) {
  await db.exec(await readFile(resolve(root, file), 'utf8'));
}

const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  newUser: '33333333-3333-4333-8333-333333333333',
  session: '44444444-4444-4444-8444-444444444444',
  gateOperation: '50000000-0000-4000-8000-000000000001',
  createOperation: '50000000-0000-4000-8000-000000000002',
  recoveryOperation: '50000000-0000-4000-8000-000000000003',
  transferOperation: '50000000-0000-4000-8000-000000000004',
};
await db.exec(`
  insert into auth.users(id,email) values
    ('${ids.owner}','owner@internal.invalid'),
    ('${ids.admin}','admin@internal.invalid'),
    ('${ids.newUser}','new@internal.invalid');
  insert into public.sd_workspaces(id,legacy_key,name) values
    ('${ids.workspace}','auth-test','Auth Test');
  insert into public.sd_profiles(id,display_name,username_label) values
    ('${ids.owner}','Owner','owner'),
    ('${ids.admin}','Admin','admin');
  insert into public.sd_memberships(workspace_id,user_id,department,role,is_active) values
    ('${ids.workspace}','${ids.owner}','Management','owner',true),
    ('${ids.workspace}','${ids.admin}','Management','admin',true);
`);

async function asUser(userId, action) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${userId}'`);
  try { return await action(); }
  finally { await db.exec(`reset role; reset request.jwt.claim.sub`); }
}
async function asService(action) {
  await db.exec('set role service_role');
  try { return await action(); }
  finally { await db.exec('reset role'); }
}

const firstRate = await asService(() => db.query(
  `select public.consume_ship_dynamics_rate_limit('login','key',1,60) as result`,
));
const secondRate = await asService(() => db.query(
  `select public.consume_ship_dynamics_rate_limit('login','key',1,60) as result`,
));
assert.equal(firstRate.rows[0].result.allowed, true);
assert.equal(secondRate.rows[0].result.allowed, false);

const lease = await asUser(ids.owner, () => db.query(
  `select public.claim_ship_dynamics_entity_lease($1::uuid,'settings:site-gate','settings','site-gate',$2::uuid,75) as result`,
  [ids.workspace, ids.session],
));
const gateToken = lease.rows[0].result;
const gateResult = await asUser(ids.owner, () => db.query(
  `select public.command_ship_dynamics_update_site_gate(
    $1::uuid,$2::uuid,0,'settings:site-gate',$3::uuid,$4::bigint,'new-site-password'
  ) as result`,
  [ids.gateOperation, ids.workspace, ids.session, gateToken.fencingToken],
));
assert.equal(gateResult.rows[0].result.status, 'committed');
const gateReplay = await asUser(ids.owner, () => db.query(
  `select public.command_ship_dynamics_update_site_gate(
    $1::uuid,$2::uuid,0,'settings:site-gate',$3::uuid,$4::bigint,'new-site-password'
  ) as result`,
  [ids.gateOperation, ids.workspace, ids.session, gateToken.fencingToken],
));
assert.equal(gateReplay.rows[0].result.replayed, true);
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `select public.command_ship_dynamics_update_site_gate(
      $1::uuid,$2::uuid,0,'settings:site-gate',$3::uuid,$4::bigint,'different-password'
    )`,
    [ids.gateOperation, ids.workspace, ids.session, gateToken.fencingToken],
  )),
  /operation-mismatch/i,
);
const gateVerified = await asService(() => db.query(
  `select public.verify_ship_dynamics_site_password('auth-test','new-site-password') as ok,
          public.verify_ship_dynamics_site_password('auth-test','wrong-password') as bad`,
));
assert.deepEqual(gateVerified.rows[0], { ok: true, bad: false });
await assert.rejects(
  () => db.exec(`set role anon; select * from public.sd_public_site_gate; reset role`),
  /permission denied/i,
);
await db.exec('reset role');

const request = { role: 'operator', credentialFingerprint: 'fingerprint-a' };
const begun = await asUser(ids.owner, () => db.query(
  `select public.begin_ship_dynamics_user_operation($1::uuid,$2::uuid,'create',null,$3::jsonb) as result`,
  [ids.workspace, ids.createOperation, JSON.stringify(request)],
));
assert.equal(begun.rows[0].result.status, 'prepared');
await asUser(ids.owner, () => db.query(
  `select public.mark_ship_dynamics_user_operation_effect($1::uuid,$2::uuid,$3::uuid)`,
  [ids.workspace, ids.createOperation, ids.newUser],
));
await asUser(ids.owner, () => db.query(
  `select public.provision_ship_dynamics_user(
    $1::uuid,$2::uuid,'New User','new-user','Operations','operator','opaque-new@internal.invalid',$3::uuid
  )`,
  [ids.workspace, ids.newUser, ids.createOperation],
));
const completed = await asUser(ids.owner, () => db.query(
  `select public.complete_ship_dynamics_user_operation($1::uuid,$2::uuid,$3::jsonb) as result`,
  [ids.workspace, ids.createOperation, JSON.stringify({ userId: ids.newUser, role: 'operator' })],
));
assert.equal(completed.rows[0].result.userId, ids.newUser);
const replay = await asUser(ids.owner, () => db.query(
  `select public.begin_ship_dynamics_user_operation($1::uuid,$2::uuid,'create',null,$3::jsonb) as result`,
  [ids.workspace, ids.createOperation, JSON.stringify(request)],
));
assert.equal(replay.rows[0].result.status, 'committed');
const loginRow = await db.query(`select auth_alias,is_active from public.sd_login_options where user_id='${ids.newUser}'`);
assert.deepEqual(loginRow.rows, [{ auth_alias: 'opaque-new@internal.invalid', is_active: true }]);

await asUser(ids.owner, () => db.query(
  `select public.begin_ship_dynamics_user_operation($1::uuid,$2::uuid,'reset-password',$3::uuid,$4::jsonb)`,
  [ids.workspace, ids.recoveryOperation, ids.newUser, JSON.stringify({ credentialFingerprint: 'fingerprint-b' })],
));
await asUser(ids.owner, () => db.query(
  `select public.mark_ship_dynamics_user_operation_effect($1::uuid,$2::uuid,$3::uuid)`,
  [ids.workspace, ids.recoveryOperation, ids.newUser],
));
await asUser(ids.owner, () => db.query(
  `select public.mark_ship_dynamics_user_operation_recovery_required($1::uuid,$2::uuid,'lost-response')`,
  [ids.workspace, ids.recoveryOperation],
));
await assert.rejects(
  () => asUser(ids.owner, () => db.query(
    `select public.reject_ship_dynamics_user_operation($1::uuid,$2::uuid,'rejected')`,
    [ids.workspace, ids.recoveryOperation],
  )),
  /cannot-reject/i,
);

await asUser(ids.owner, () => db.query(
  `select public.begin_ship_dynamics_user_operation($1::uuid,$2::uuid,'transfer-owner',$3::uuid,'{}'::jsonb)`,
  [ids.workspace, ids.transferOperation, ids.admin],
));
const transferred = await asUser(ids.owner, () => db.query(
  `select public.transfer_ship_dynamics_owner($1::uuid,$2::uuid,$3::uuid) as result`,
  [ids.workspace, ids.admin, ids.transferOperation],
));
assert.equal(transferred.rows[0].result.ownerId, ids.admin);
const transferReplay = await asUser(ids.owner, () => db.query(
  `select public.transfer_ship_dynamics_owner($1::uuid,$2::uuid,$3::uuid) as result`,
  [ids.workspace, ids.admin, ids.transferOperation],
));
assert.equal(transferReplay.rows[0].result.ownerId, ids.admin);

console.log('normalized_auth_orchestration=PASS');

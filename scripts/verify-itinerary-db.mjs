import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const foundation = await readFile('supabase/normalized-schema.sql', 'utf8');
const migration = await readFile('supabase/migrations/20260831090000_itinerary_subsystem.sql', 'utf8');
const rolloutBootstrapMigration = await readFile('supabase/migrations/20260831110000_itinerary_rollout_bootstrap.sql', 'utf8');
const utcOffsetMigration = await readFile('supabase/migrations/20260901073500_itinerary_utc_offsets.sql', 'utf8');
const publicVesselNamesMigration = await readFile('supabase/migrations/20260901122500_itinerary_public_vessel_full_names.sql', 'utf8');
const operationMultiSelectMigration = await readFile('supabase/migrations/20260901125500_itinerary_operation_multi_select.sql', 'utf8');
const calculationV2Migration = await readFile('supabase/migrations/20260901143000_itinerary_calculation_v2.sql', 'utf8');
const itineraryNotesMigration = await readFile('supabase/migrations/20260902100000_itinerary_notes.sql', 'utf8');
const officeRoleAccessMigrationPath = 'supabase/migrations/20260902105700_itinerary_office_role_access.sql';
assert.equal(existsSync(officeRoleAccessMigrationPath), true, 'an additive migration must promote Admin and Operator without rewriting applied migrations');
const officeRoleAccessMigration = await readFile(officeRoleAccessMigrationPath, 'utf8');
const mainSessionAccessMigrationPath = 'supabase/migrations/20260902134143_itinerary_main_session_access.sql';
assert.equal(existsSync(mainSessionAccessMigrationPath), true, 'an additive migration must replace the second Itinerary login with the main AppData actor');
const mainSessionAccessMigration = await readFile(mainSessionAccessMigrationPath, 'utf8');
const previousPortMigrationPath = 'supabase/migrations/20260903143000_itinerary_previous_port_name.sql';
assert.equal(existsSync(previousPortMigrationPath), true, 'an additive migration must persist and validate the ship-entered previous port');
const previousPortMigration = await readFile(previousPortMigrationPath, 'utf8');
const alternativePlansMigrationPath = 'supabase/migrations/20260903190000_itinerary_alternative_plans.sql';
assert.equal(existsSync(alternativePlansMigrationPath), true, 'an additive migration must persist alternative plans inside the Itinerary document');
const alternativePlansMigration = await readFile(alternativePlansMigrationPath, 'utf8');
assert.match(alternativePlansMigration, /notify\s+pgrst\s*,\s*'reload schema'\s*;/i, 'RPC signature changes must notify PostgREST to reload its schema cache');
assert.doesNotMatch(mainSessionAccessMigration, /p_actor_guard|create or replace function public\.sd_itinerary_main_authorize|create or replace function public\.sd_itinerary_main_owner_update_rollout/, 'universal access migration must not retain a dedicated guard or Owner-only rollout API');
assert.match(mainSessionAccessMigration, /main_enabled\s*=\s*true[\s\S]*ship_portal_enabled\s*=\s*true/, 'both Itinerary entrypoints must be forced open');
assert.match(mainSessionAccessMigration, /revoke execute on function public\.sd_itinerary_owner_update_rollout\(text,bigint,uuid,boolean,boolean,jsonb\)/, 'historical Owner rollout switch must be disabled');
const readbackSql = await readFile('supabase/itinerary-readback.sql', 'utf8');
assert.equal(readbackSql.includes("'workspaceKey'"), false, 'production readback must not expose the full legacy workspace key');
assert.equal(readbackSql.includes("'workspaceRef'"), true, 'production readback must expose only a masked workspace reference');
assert.equal(readbackSql.includes("'notes'"), true, 'production readback must prove the optional notes field contract');
assert.equal(readbackSql.includes("'previousPortName'"), true, 'production readback must prove the previous-port persistence and save-boundary contract');
const rolloutBootstrapReadbackSql = await readFile('supabase/itinerary-rollout-bootstrap-readback.sql', 'utf8');
const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  operator: '44444444-4444-4444-8444-444444444444',
  vessel: '55555555-5555-4555-8555-555555555555',
  outsider: '33333333-3333-4333-8333-333333333333',
};
let operation = 0;
const nextOperation = () => `90000000-0000-4000-8000-${String(++operation).padStart(12, '0')}`;
const rolePermissions = (admin = {}) => ({
  admin: { view: true, edit: true, import: true, export: true, calendar: true, ...admin },
  operator: { view: true, edit: true, import: true, export: true, calendar: true },
  vessel: { view: true, edit: true, import: true, export: true, calendar: true },
});
const appStatePayload = {
  untouched: true,
  users: [
    { id: 'legacy-owner', department: '管理', name: 'Owner', username: 'owner', role: 'owner', isActive: true, managedVesselIds: [] },
    { id: 'legacy-admin', department: '管理', name: 'Admin', username: 'admin', role: 'admin', isActive: true, managedVesselIds: [] },
    { id: 'legacy-operator', department: '營運', name: 'Operator', username: 'operator', role: 'operator', isActive: true, managedVesselIds: [] },
    { id: 'legacy-vessel', department: '船端', name: 'Vessel', username: 'vessel', role: 'vessel', isActive: true, managedVesselIds: ['v1'] },
  ],
  vessels: [
    { id: 'v1', isActive: true, assignedUserIds: [], delegateManagers: [] },
    { id: 'v2', isActive: true, assignedUserIds: [], delegateManagers: [] },
  ],
  settings: {
    rolePermissions: {
      owner: { viewAllVessels: true },
      admin: { viewAllVessels: true },
      operator: { viewAllVessels: true },
      vessel: { viewAllVessels: false },
    },
    nonOwnerPasswordResetVersion: 0,
  },
};
const row = (overrides = {}) => ({
  rowId: 'row-1', sortOrder: 0, voyageNumber: 'V001', portDockName: 'ULSAN', operation: 'To Load / To Unload', cargoQuantityText: '5000 MT',
  etaUtc: '2026-09-01T00:00:00Z', etbUtc: '2026-09-01T02:00:00Z', ldRateText: '400 MT/H', etcUtc: '2026-09-01T14:30:00Z', etdUtc: '2026-09-01T20:30:00Z',
  arrivalDraftText: '10.0', departureDraftText: '9.8', arrivalRobText: 'ROB', departureRobText: 'ROB', portTimeZone: 'UTC+9',
  oceanDistanceNm: 240, speedKnots: 12, sailingHours: 20, berthWaitHours: 2, tanksText: '1P/1S', operationQuantityMt: 5000,
  operationRateMtPerHour: 400, operationHours: 12.5, departureBufferDays: 0.25,
  etaMode: 'manual', etbMode: 'auto', etcMode: 'auto', etdMode: 'auto', ...overrides,
});
const v2Row = (overrides = {}) => ({
  ...row({ departureBufferDays: null }),
  operation: 'To Load / docking / inspection',
  etaTimeZone: '', etbTimeZone: 'UTC+9', etcTimeZone: 'UTC+8:45', etdTimeZone: 'UTC-6',
  channelSailingHours: 1, preCompletionDelayHours: 2, postCompletionDelayHours: 3,
  calculationStartUtc: '2026-08-31T00:00:00Z', calculationStartTimeZone: 'UTC+8',
  ...overrides,
});
const alternativePlan = (index, overrides = {}) => ({
  planId: `alternative-${index + 1}`,
  sortOrder: index,
  rows: [v2Row({ rowId: `alternative-row-${index + 1}`, previousPortName: '', ...overrides })],
});

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}
async function asUser(userId, action) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${userId}';`);
  try { return await action(); } finally { await db.exec('reset role; reset request.jwt.claim.sub;'); }
}
async function asAnon(action) {
  await db.exec('set role anon;');
  try { return await action(); } finally { await db.exec('reset role;'); }
}
const rollout = (userId) => asUser(userId, () => scalar('select public.sd_itinerary_get_rollout($1)', ['default']));

try {
  await db.exec(`
    create schema auth;
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit bypassrls;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  `);
  await db.exec(foundation);
  await db.exec(`
    create table public.sd_login_options(
      workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      department text not null,
      username_label text not null,
      display_name text not null,
      auth_alias text not null,
      is_active boolean not null default true,
      must_change_password boolean not null default true,
      primary key(workspace_id,user_id)
    );
    insert into auth.users(id,email) values
      ('${ids.owner}','owner@invalid'),('${ids.admin}','admin@invalid'),
      ('${ids.operator}','operator@invalid'),('${ids.vessel}','vessel@invalid'),
      ('${ids.outsider}','outsider@invalid');
    insert into public.sd_workspaces(id,legacy_key,name) values('${ids.workspace}','default','Ship Dynamics');
    insert into public.sd_profiles(id,display_name,username_label) values
      ('${ids.owner}','Owner','owner'),('${ids.admin}','Admin','admin'),
      ('${ids.operator}','Operator','operator'),('${ids.vessel}','Vessel','vessel'),
      ('${ids.outsider}','Outsider','outsider');
    insert into public.sd_memberships(workspace_id,user_id,department,role,is_active) values
      ('${ids.workspace}','${ids.owner}','管理','owner',true),
      ('${ids.workspace}','${ids.admin}','管理','admin',true),
      ('${ids.workspace}','${ids.operator}','營運','operator',true),
      ('${ids.workspace}','${ids.vessel}','船端','vessel',true);
    insert into public.sd_login_options(workspace_id,user_id,department,username_label,display_name,auth_alias,is_active,must_change_password) values
      ('${ids.workspace}','${ids.owner}','管理','owner','Owner','owner@invalid',true,false),
      ('${ids.workspace}','${ids.admin}','管理','admin','Admin','admin@invalid',true,false),
      ('${ids.workspace}','${ids.operator}','營運','operator','Operator','operator@invalid',true,false),
      ('${ids.workspace}','${ids.vessel}','船端','vessel','Vessel','vessel@invalid',true,false);
    insert into public.sd_vessels(workspace_id,id,name,short_name,full_name,ship_type,fleet_category) values
      ('${ids.workspace}','v1','Vessel One','V1','Vessel One','bulk','fleet'),
      ('${ids.workspace}','v2','Vessel Two','V2','Vessel Two','tanker','fleet');
    create table public.ship_dynamics_app_state(workspace_key text primary key,revision bigint not null,payload jsonb not null);
    insert into public.ship_dynamics_app_state values('default',77,'{}');
  `);
  await db.query("update public.ship_dynamics_app_state set payload=$1::jsonb where workspace_key='default'", [JSON.stringify(appStatePayload)]);
  await db.exec(migration);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row()])]), false, 'deployed base migration must reproduce the old IANA-only rejection');
  await db.exec(rolloutBootstrapMigration);
  await db.exec(utcOffsetMigration);
  await db.exec(publicVesselNamesMigration);
  await db.exec(operationMultiSelectMigration);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row()])]), false, 'pre-v2 validator must reject additive fields');
  await db.exec(calculationV2Migration);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ notesText: '靠港前請再次確認' })])]), false, 'pre-notes validator must reject the additive field');
  await db.exec(itineraryNotesMigration);
  await db.exec(officeRoleAccessMigration);
  await db.exec(mainSessionAccessMigration);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ previousPortName: 'BUSAN' })])]), false, 'pre-previous-port validator must reject the additive field');
  await db.exec(previousPortMigration);
  await db.exec(alternativePlansMigration);
  assert.deepEqual((await db.query(`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema='public'
      and table_name in ('sd_itinerary_documents','sd_itinerary_history')
      and column_name='alternative_plans_payload'
    order by table_name
  `)).rows, [
    { table_name: 'sd_itinerary_documents', column_name: 'alternative_plans_payload', data_type: 'jsonb' },
    { table_name: 'sd_itinerary_history', column_name: 'alternative_plans_payload', data_type: 'jsonb' },
  ]);
  const mainArgumentRows = (await db.query(`
    select proc.proname, proc.proargnames
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = any($1::text[])
  `, [[
    'sd_itinerary_main_actor',
    'sd_itinerary_main_load_many',
    'sd_itinerary_main_claim_lease',
    'sd_itinerary_main_renew_lease',
    'sd_itinerary_main_release_lease',
    'sd_itinerary_main_save',
    'sd_itinerary_main_operation_status',
  ]])).rows;
  const mainArgumentNames = Object.fromEntries(mainArgumentRows.map(row => [row.proname, row.proargnames]));
  assert.deepEqual(mainArgumentNames, {
    sd_itinerary_main_actor: ['p_workspace_key', 'p_actor_user_id'],
    sd_itinerary_main_load_many: ['p_workspace_key', 'p_vessel_ids', 'p_actor_user_id'],
    sd_itinerary_main_claim_lease: ['p_workspace_key', 'p_vessel_id', 'p_holder_session', 'p_holder_label', 'p_ttl_seconds', 'p_actor_user_id'],
    sd_itinerary_main_renew_lease: ['p_workspace_key', 'p_vessel_id', 'p_lease_id', 'p_holder_session', 'p_fencing_token', 'p_ttl_seconds', 'p_actor_user_id'],
    sd_itinerary_main_release_lease: ['p_workspace_key', 'p_vessel_id', 'p_lease_id', 'p_holder_session', 'p_fencing_token', 'p_actor_user_id'],
    sd_itinerary_main_save: ['p_workspace_key', 'p_vessel_id', 'p_expected_revision', 'p_operation_id', 'p_rows', 'p_lease_id', 'p_holder_session', 'p_fencing_token', 'p_actor_label', 'p_actor_user_id', 'p_alternative_plans'],
    sd_itinerary_main_operation_status: ['p_workspace_key', 'p_operation_id', 'p_actor_user_id'],
  }, 'PostgREST dispatch requires SQL argument names to match every cloud adapter payload');
  assert.deepEqual((await db.query(`
    select proc.proargnames
    from pg_proc proc
    join pg_namespace namespace on namespace.oid=proc.pronamespace
    where namespace.nspname='public' and proc.proname='sd_itinerary_save_public'
  `)).rows, [{ proargnames: ['p_workspace_key', 'p_vessel_id', 'p_expected_revision', 'p_operation_id', 'p_rows', 'p_lease_id', 'p_actor_key', 'p_holder_session', 'p_fencing_token', 'p_alternative_plans'] }]);
  await db.exec(`
    update public.sd_memberships set legacy_user_id = case user_id
      when '${ids.owner}'::uuid then 'legacy-owner'
      when '${ids.admin}'::uuid then 'legacy-admin'
      when '${ids.operator}'::uuid then 'legacy-operator'
      when '${ids.vessel}'::uuid then 'legacy-vessel'
      else legacy_user_id end
    where workspace_id = '${ids.workspace}'::uuid;
  `);

  const emptyOfficeLoad = [{ document: null, vesselId: 'v1', vesselName: 'Vessel One' }];
  const mainLoad = actorUserId => asAnon(() => scalar(
    'select public.sd_itinerary_main_load_many($1,$2::text[],$3)',
    ['default', ['v1'], actorUserId],
  ));

  const ownerInitial = await rollout(ids.owner);
  assert.equal(ownerInitial.version, 2);
  assert.equal(ownerInitial.main_enabled, true);
  assert.equal(ownerInitial.ship_portal_enabled, true);
  assert.equal(ownerInitial.role_permissions.owner.view, true);
  assert.deepEqual(ownerInitial.office_identity, { department: '管理', display_name: 'Owner', username_label: 'owner', role: 'owner' });
  assert.deepEqual((await rollout(ids.admin)).role_permissions.admin, rolePermissions().admin);
  assert.deepEqual((await rollout(ids.operator)).role_permissions.operator, rolePermissions().operator);
  assert.deepEqual((await rollout(ids.vessel)).role_permissions.vessel, rolePermissions().vessel);
  for (const role of ['owner', 'admin', 'operator', 'vessel']) {
    assert.equal(await asAnon(() => scalar('select public.sd_itinerary_get_office_entry($1,$2)', ['default', role])), true);
  }
  assert.deepEqual(await asAnon(() => scalar('select public.sd_itinerary_get_public_rollout($1)', ['default'])), { ship_portal_enabled: true });
  assert.deepEqual(await asAnon(() => scalar('select public.sd_itinerary_public_list_vessels($1)', ['default'])), [
    { id: 'v1', name: 'Vessel One', shortName: 'V1', fullName: 'Vessel One' },
    { id: 'v2', name: 'Vessel Two', shortName: 'V2', fullName: 'Vessel Two' },
  ]);
  for (const actorUserId of ['legacy-owner', 'legacy-admin', 'legacy-operator', 'legacy-vessel', ids.owner, ids.admin, ids.operator, ids.vessel]) {
    assert.deepEqual(await mainLoad(actorUserId), emptyOfficeLoad, `${actorUserId} must use the universal main Itinerary path`);
  }
  await assert.rejects(() => mainLoad('unknown-user'), /not-authorized/i);
  await assert.rejects(
    () => asAnon(() => scalar('select public.sd_itinerary_main_actor($1,$2)', ['default', 'legacy-owner'])),
    /permission denied/i,
  );
  await assert.rejects(() => asAnon(() => db.query('select * from public.sd_itinerary_documents')), /permission denied/i);
  await assert.rejects(() => asUser(ids.admin, () => db.query('select * from public.sd_itinerary_documents')), /permission denied/i);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row()])]), true);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC+5:30' })])]), true);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC+5:45' })])]), true);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC-6' })])]), true);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'Asia/Seoul' })])]), true, 'legacy IANA rows must stay writable during compatibility');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row()])]), true);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ notesText: '靠港前請再次確認' })])]), true, 'notes migration must accept bounded text');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ previousPortName: 'BUSAN' })])]), true, 'first-row previous port must use the existing JSONB payload');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ previousPortName: 7 })])]), false, 'previous port must remain textual');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ previousPortName: 'P'.repeat(241) })])]), false, 'previous port must remain bounded');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ notesText: 7 })])]), false, 'notes must remain textual');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ notesText: 'N'.repeat(1001) })])]), false, 'notes must remain bounded');
  const validTwoRowV2 = [
    v2Row({ rowId: 'v2-row-1', sortOrder: 0 }),
    v2Row({ rowId: 'v2-row-2', sortOrder: 1, calculationStartUtc: null, calculationStartTimeZone: '' }),
  ];
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify(validTwoRowV2)]), true);
  const invalidLaterPreviousPort = structuredClone(validTwoRowV2);
  invalidLaterPreviousPort[1].previousPortName = 'WRONG ROW';
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify(invalidLaterPreviousPort)]), false, 'previous port must remain first-row metadata');
  const invalidLaterAnchor = structuredClone(validTwoRowV2);
  invalidLaterAnchor[1].calculationStartUtc = '2026-09-01T00:00:00Z';
  invalidLaterAnchor[1].calculationStartTimeZone = 'UTC+8';
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify(invalidLaterAnchor)]), false, 'ETA calculation anchor must be first-row only');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ operation: 'To Unload / waiting order / repair' })])]), true);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ operation: 'inspection / To Load' })])]), false, 'Purpose order must be canonical');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ operation: 'docking / docking' })])]), false, 'Purpose choices must not repeat');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ etaTimeZone: 'UTC+14:15' })])]), false);
  const partialV2 = v2Row();
  delete partialV2.etdTimeZone;
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([partialV2])]), false, 'partial v2 shape must fail closed');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row({ oceanDistanceNm: 100, speedKnots: 12, sailingHours: 100 / 12 })])]), true, 'DTG divided by speed must retain fractional hours');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC+14:15' })])]), false);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC-12:15' })])]), false);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC+5:20' })])]), false);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: '9' })])]), false);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ sailingHours: 19 })])]), false);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify(Array.from({ length: 101 }, (_, index) => row({ rowId: `row-${index}`, sortOrder: index })))]), false);
  const formalRowsForAlternatives = [v2Row({ previousPortName: 'BUSAN' })];
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify([]), JSON.stringify(formalRowsForAlternatives)]), true);
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify([alternativePlan(0)]), JSON.stringify(formalRowsForAlternatives)]), true);
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify(Array.from({ length: 5 }, (_, index) => alternativePlan(index))), JSON.stringify(formalRowsForAlternatives)]), true);
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify(Array.from({ length: 6 }, (_, index) => alternativePlan(index))), JSON.stringify(formalRowsForAlternatives)]), false, 'the database must reject a sixth alternative plan');
  const duplicatePlanIds = [alternativePlan(0), { ...alternativePlan(1), planId: 'alternative-1' }];
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify(duplicatePlanIds), JSON.stringify(formalRowsForAlternatives)]), false, 'planId values must be unique');
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify([{ ...alternativePlan(0), sortOrder: 1 }]), JSON.stringify(formalRowsForAlternatives)]), false, 'alternative plans must retain contiguous display order');
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify([{ ...alternativePlan(0), planId: 'p'.repeat(121) }]), JSON.stringify(formalRowsForAlternatives)]), false, 'the database planId limit must match the TypeScript 120-character limit');
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify([{ ...alternativePlan(0), extra: true }]), JSON.stringify(formalRowsForAlternatives)]), false, 'alternative plan objects must reject unknown fields');
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify([alternativePlan(0, { previousPortName: 'MUST NOT CROSS' })]), JSON.stringify(formalRowsForAlternatives)]), false, 'formal previous-port metadata must not cross into an alternative');
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify([alternativePlan(0, { calculationStartUtc: '2026-09-02T00:00:00Z' })]), JSON.stringify(formalRowsForAlternatives)]), false, 'alternative ETA anchors must live-link to the formal anchor');
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify([alternativePlan(0, { calculationStartTimeZone: 'UTC+9' })]), JSON.stringify(formalRowsForAlternatives)]), false, 'alternative ETA anchor offsets must live-link to the formal offset');
  assert.equal(await scalar('select public.sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)', [JSON.stringify([alternativePlan(0, { rowId: 'row-1' })]), JSON.stringify(formalRowsForAlternatives)]), false, 'row identities must remain disjoint across formal and alternative plans');

  await db.query('update public.sd_login_options set must_change_password=true where workspace_id=$1 and user_id=$2', [ids.workspace, ids.owner]);
  assert.equal((await rollout(ids.owner)).office_identity, null);
  assert.deepEqual(await mainLoad('legacy-owner'), emptyOfficeLoad, 'main AppData actor must not depend on the historical Itinerary Auth session');
  await assert.rejects(() => asUser(ids.owner, () => scalar('select public.sd_itinerary_load_many($1,$2::text[])', ['default', ['v1']])), /not-authorized/i);
  await assert.rejects(() => asUser(ids.owner, () => scalar('select public.sd_itinerary_operation_status_office($1,$2::uuid)', ['default', '90000000-0000-4000-8000-999999999999'])), /not-authorized/i);
  await db.query('update public.sd_login_options set must_change_password=false where workspace_id=$1 and user_id=$2', [ids.workspace, ids.owner]);

  for (const userId of [ids.owner, ids.admin]) {
    await assert.rejects(
      () => asUser(userId, () => scalar(
        'select public.sd_itinerary_owner_update_rollout($1,$2::bigint,$3::uuid,$4,$5,$6::jsonb)',
        ['default', 2, nextOperation(), false, false, JSON.stringify(rolePermissions())],
      )),
      /permission denied/i,
    );
  }
  assert.deepEqual(await asUser(ids.admin, () => scalar('select public.sd_itinerary_load_many($1,$2::text[])', ['default', ['v1']])), emptyOfficeLoad);
  assert.deepEqual(await asUser(ids.operator, () => scalar('select public.sd_itinerary_load_many($1,$2::text[])', ['default', ['v1']])), emptyOfficeLoad);
  assert.deepEqual(await asUser(ids.vessel, () => scalar('select public.sd_itinerary_load_many($1,$2::text[])', ['default', ['v1']])), emptyOfficeLoad);

  const mainAdminLease = await asAnon(() => scalar(
    'select public.sd_itinerary_main_claim_lease($1,$2,$3,$4,$5,$6)',
    ['default', 'v2', 'main-admin-tab', 'Forged label', 75, 'legacy-admin'],
  ));
  assert.equal(mainAdminLease.ok, true);
  const mainAdminOperation = nextOperation();
  const mainAdminSaveParams = [
    'default', 'v2', 0, mainAdminOperation, JSON.stringify([row({ voyageNumber: 'MAIN-ADMIN' })]),
    mainAdminLease.leaseId, 'main-admin-tab', mainAdminLease.fencingToken, 'Forged Admin',
    'legacy-admin',
  ];
  const mainAdminSaved = await asAnon(() => scalar(
    'select public.sd_itinerary_main_save($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10)',
    mainAdminSaveParams,
  ));
  assert.equal(mainAdminSaved.document.updatedActorLabel, 'Admin', 'server must use the authoritative main-login display name');
  assert.equal(Number(mainAdminSaved.revision), 1);
  assert.equal((await asAnon(() => scalar(
    'select public.sd_itinerary_main_save($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10)',
    mainAdminSaveParams,
  ))).replayed, true);
  assert.equal((await asAnon(() => scalar(
    'select public.sd_itinerary_main_operation_status($1,$2::uuid,$3)',
    ['default', mainAdminOperation, 'legacy-admin'],
  ))).revision, 1);
  assert.equal((await asAnon(() => scalar(
    'select public.sd_itinerary_main_operation_status($1,$2::uuid,$3)',
    ['default', mainAdminOperation, 'legacy-operator'],
  ))).status, 'missing');
  assert.equal(await scalar("select updated_actor_id::text from public.sd_itinerary_documents where workspace_id=$1::uuid and vessel_id='v2'", [ids.workspace]), ids.admin);
  const mainOperatorLease = await asAnon(() => scalar(
    'select public.sd_itinerary_main_claim_lease($1,$2,$3,$4,$5,$6)',
    ['default', 'v2', 'main-operator-tab', 'Operator', 75, 'legacy-operator'],
  ));
  assert.equal(mainOperatorLease.ok, true);
  assert.equal(await asAnon(() => scalar(
    'select public.sd_itinerary_main_release_lease($1,$2,$3::uuid,$4,$5::bigint,$6)',
    ['default', 'v2', mainOperatorLease.leaseId, 'main-operator-tab', mainOperatorLease.fencingToken, 'legacy-operator'],
  )), true);

  const mainVesselLease = await asAnon(() => scalar(
    'select public.sd_itinerary_main_claim_lease($1,$2,$3,$4,$5,$6)',
    ['default', 'v2', 'main-vessel-tab', 'Vessel', 75, 'legacy-vessel'],
  ));
  assert.equal(mainVesselLease.ok, true);
  const mainVesselSaved = await asAnon(() => scalar(
    'select public.sd_itinerary_main_save($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10)',
    ['default', 'v2', 1, nextOperation(), JSON.stringify([row({ voyageNumber: 'MAIN-VESSEL' })]), mainVesselLease.leaseId, 'main-vessel-tab', mainVesselLease.fencingToken, 'Forged Vessel', 'legacy-vessel'],
  ));
  assert.equal(mainVesselSaved.document.updatedActorLabel, 'Vessel');
  assert.equal(Number(mainVesselSaved.revision), 2);

  const adminLease = await asUser(ids.admin, () => scalar('select public.sd_itinerary_claim_office_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'admin-tab', 'Admin', 75]));
  assert.equal(adminLease.ok, true);
  assert.equal(await asUser(ids.admin, () => scalar('select public.sd_itinerary_release_office_lease($1,$2,$3::uuid,$4,$5::bigint)', ['default', 'v1', adminLease.leaseId, 'admin-tab', adminLease.fencingToken])), true);
  const operatorLease = await asUser(ids.operator, () => scalar('select public.sd_itinerary_claim_office_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'operator-tab', 'Operator', 75]));
  assert.equal(operatorLease.ok, true);
  assert.equal(await asUser(ids.operator, () => scalar('select public.sd_itinerary_release_office_lease($1,$2,$3::uuid,$4,$5::bigint)', ['default', 'v1', operatorLease.leaseId, 'operator-tab', operatorLease.fencingToken])), true);

  const ownerLease = await asUser(ids.owner, () => scalar('select public.sd_itinerary_claim_office_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'owner-tab', 'Owner', 75]));
  assert.equal(ownerLease.ok, true);
  const officeOp = nextOperation();
  const officeSaveParams = ['default', 'v1', 0, officeOp, JSON.stringify([row()]), ownerLease.leaseId, 'owner-tab', ownerLease.fencingToken, 'Owner'];
  const officeSaved = await asUser(ids.owner, () => scalar('select public.sd_itinerary_save_office($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9)', officeSaveParams));
  assert.equal(Number(officeSaved.revision), 1);
  assert.equal(officeSaved.document.rows[0].sailingHours, 20);
  const officeReplay = await asUser(ids.owner, () => scalar('select public.sd_itinerary_save_office($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9)', officeSaveParams));
  assert.equal(officeReplay.replayed, true);
  const replacementLease = await asUser(ids.owner, () => scalar('select public.sd_itinerary_claim_office_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'owner-tab-recovery', 'Owner', 75]));
  const replacementReplayParams = [...officeSaveParams];
  replacementReplayParams[5] = replacementLease.leaseId;
  replacementReplayParams[6] = 'owner-tab-recovery';
  replacementReplayParams[7] = replacementLease.fencingToken;
  assert.equal((await asUser(ids.owner, () => scalar('select public.sd_itinerary_save_office($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9)', replacementReplayParams))).replayed, true);
  assert.equal(await asUser(ids.owner, () => scalar('select public.sd_itinerary_release_office_lease($1,$2,$3::uuid,$4,$5::bigint)', ['default', 'v1', replacementLease.leaseId, 'owner-tab-recovery', replacementLease.fencingToken])), true);
  await assert.rejects(() => asUser(ids.owner, () => scalar('select public.sd_itinerary_save_office($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9)', [...officeSaveParams.slice(0, 4), JSON.stringify([row({ voyageNumber: 'MISMATCH' })]), ...officeSaveParams.slice(5)])), /operation-mismatch/i);

  const invalidLease = await asUser(ids.owner, () => scalar('select public.sd_itinerary_claim_office_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'owner-tab', 'Owner', 75]));
  await assert.rejects(() => asUser(ids.owner, () => scalar('select public.sd_itinerary_save_office($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9)', ['default', 'v1', 1, nextOperation(), JSON.stringify([row({ extra: true })]), invalidLease.leaseId, 'owner-tab', invalidLease.fencingToken, 'Owner'])), /invalid-itinerary-payload/i);
  assert.equal(Number(await scalar("select revision from public.sd_itinerary_documents where workspace_id=$1::uuid and vessel_id='v1'", [ids.workspace])), 1);
  assert.equal(await asUser(ids.owner, () => scalar('select public.sd_itinerary_release_office_lease($1,$2,$3::uuid,$4,$5::bigint)', ['default', 'v1', invalidLease.leaseId, 'owner-tab', invalidLease.fencingToken])), true);

  const publicVessels = await asAnon(() => scalar('select public.sd_itinerary_public_list_vessels($1)', ['default']));
  assert.deepEqual(publicVessels, [
    { id: 'v1', name: 'Vessel One', shortName: 'V1', fullName: 'Vessel One' },
    { id: 'v2', name: 'Vessel Two', shortName: 'V2', fullName: 'Vessel Two' },
  ]);
  assert.equal((await asAnon(() => scalar('select public.sd_itinerary_public_load($1,$2)', ['default', 'v1']))).revision, 1);

  const publicLease = await asAnon(() => scalar('select public.sd_itinerary_claim_public_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'public-browser-a', 'public-tab-a', 75]));
  assert.equal(publicLease.ok, true);
  const locked = await asAnon(() => scalar('select public.sd_itinerary_claim_public_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'public-browser-a', 'public-tab-b', 75]));
  assert.equal(locked.ok, false);
  assert.equal(locked.holderLabel, '另一個使用者');
  await assert.rejects(
    () => asAnon(() => scalar('select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint)', ['default', 'v1', 1, nextOperation(), JSON.stringify([v2Row({ previousPortName: '   ', voyageNumber: 'MISSING-PREVIOUS' })]), publicLease.leaseId, 'public-browser-a', 'public-tab-a', publicLease.fencingToken])),
    /previous-port-required/i,
  );
  await assert.rejects(
    () => asAnon(() => scalar('select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint)', ['default', 'v1', 1, nextOperation(), JSON.stringify([v2Row({ previousPortName: '\t\n', voyageNumber: 'WHITESPACE-PREVIOUS' })]), publicLease.leaseId, 'public-browser-a', 'public-tab-a', publicLease.fencingToken])),
    /previous-port-required/i,
  );
  assert.equal((await asAnon(() => scalar('select public.sd_itinerary_public_load($1,$2)', ['default', 'v1']))).revision, 1, 'rejected whitespace-only previous ports must not consume a revision');
  const publicOp = nextOperation();
  const publicRows = [v2Row({ previousPortName: 'BUSAN', voyageNumber: 'PUBLIC-R2' })];
  const publicParams = ['default', 'v1', 1, publicOp, JSON.stringify(publicRows), publicLease.leaseId, 'public-browser-a', 'public-tab-a', publicLease.fencingToken];
  const publicSaved = await asAnon(() => scalar('select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint)', publicParams));
  assert.equal(Number(publicSaved.revision), 2);
  assert.equal((await asAnon(() => scalar('select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint)', publicParams))).replayed, true);
  const publicReplacementLease = await asAnon(() => scalar('select public.sd_itinerary_claim_public_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'public-browser-a', 'public-tab-reopen', 75]));
  const publicReplacementParams = [...publicParams];
  publicReplacementParams[5] = publicReplacementLease.leaseId;
  publicReplacementParams[7] = 'public-tab-reopen';
  publicReplacementParams[8] = publicReplacementLease.fencingToken;
  assert.equal((await asAnon(() => scalar('select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint)', publicReplacementParams))).replayed, true);
  assert.equal(await asAnon(() => scalar('select public.sd_itinerary_release_public_lease($1,$2,$3::uuid,$4,$5,$6::bigint)', ['default', 'v1', publicReplacementLease.leaseId, 'public-browser-a', 'public-tab-reopen', publicReplacementLease.fencingToken])), true);
  assert.equal((await asAnon(() => scalar('select public.sd_itinerary_operation_status_public($1,$2::uuid,$3)', ['default', publicOp, 'public-browser-a']))).revision, 2);
  assert.equal((await asAnon(() => scalar('select public.sd_itinerary_operation_status_public($1,$2::uuid,$3)', ['default', publicOp, 'another-browser']))).status, 'missing');
  assert.equal((await asAnon(() => scalar('select public.sd_itinerary_public_load($1,$2)', ['default', 'v1']))).revision, 2);
  const history = await asUser(ids.owner, () => scalar('select public.sd_itinerary_history($1,$2,$3)', ['default', 'v1', 30]));
  assert.deepEqual(history.map(item => item.revision), [2, 1]);

  const legacyAlternativeOperation = nextOperation();
  const legacyAlternativeRows = [v2Row({ rowId: 'v2-legacy-empty-alternatives', previousPortName: 'BUSAN', voyageNumber: 'LEGACY-ACK' })];
  const legacyAlternativeRequest = { vesselId: 'v2', expectedRevision: 2, rows: legacyAlternativeRows };
  await db.query(`insert into public.sd_itinerary_operations(
    workspace_id,operation_id,actor_kind,actor_key,target_key,request_payload,request_hash,result,committed_at
  ) values($1,$2::uuid,'public','legacy-public-browser','vessel:v2',$3::jsonb,md5(($3::jsonb)::text),$4::jsonb,clock_timestamp())`, [
    ids.workspace,
    legacyAlternativeOperation,
    JSON.stringify(legacyAlternativeRequest),
    JSON.stringify({ ok: true, revision: 2, replayed: false }),
  ]);
  const legacyAlternativeReplay = await asAnon(() => scalar(
    'select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint,$10::jsonb)',
    ['default', 'v2', 2, legacyAlternativeOperation, JSON.stringify(legacyAlternativeRows), '00000000-0000-4000-8000-000000000099', 'legacy-public-browser', 'legacy-public-tab', 1, JSON.stringify([])],
  ));
  assert.equal(legacyAlternativeReplay.replayed, true, 'an exact legacy committed request must replay across the empty-alternative signature upgrade');
  await assert.rejects(
    () => asAnon(() => scalar(
      'select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint,$10::jsonb)',
      ['default', 'v2', 2, legacyAlternativeOperation, JSON.stringify(legacyAlternativeRows), '00000000-0000-4000-8000-000000000099', 'legacy-public-browser', 'legacy-public-tab', 1, JSON.stringify([alternativePlan(0)])],
    )),
    /operation-mismatch/,
  );

  const alternativeRows = [v2Row({ rowId: 'v2-formal-alternative-save', previousPortName: 'BUSAN', voyageNumber: 'ALT-SAVE' })];
  const alternativePlans = [alternativePlan(0)];
  const alternativeLease = await asAnon(() => scalar('select public.sd_itinerary_claim_public_lease($1,$2,$3,$4,$5)', ['default', 'v2', 'public-alternative-browser', 'public-alternative-tab', 75]));
  const alternativeOperation = nextOperation();
  const alternativeSaveParams = ['default', 'v2', 2, alternativeOperation, JSON.stringify(alternativeRows), alternativeLease.leaseId, 'public-alternative-browser', 'public-alternative-tab', alternativeLease.fencingToken, JSON.stringify(alternativePlans)];
  const alternativeSaved = await asAnon(() => scalar('select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint,$10::jsonb)', alternativeSaveParams));
  assert.equal(Number(alternativeSaved.revision), 3);
  assert.deepEqual(alternativeSaved.document.alternativePlans, alternativePlans, 'ship save responses must return the embedded alternatives');
  assert.deepEqual(await scalar("select alternative_plans_payload from public.sd_itinerary_documents where workspace_id=$1::uuid and vessel_id='v2'", [ids.workspace]), alternativePlans);
  assert.equal((await asAnon(() => scalar('select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint,$10::jsonb)', alternativeSaveParams))).replayed, true);
  const changedAlternativePlans = structuredClone(alternativePlans);
  changedAlternativePlans[0].rows[0].portDockName = 'DIFFERENT OPERATION PAYLOAD';
  await assert.rejects(() => asAnon(() => scalar(
    'select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint,$10::jsonb)',
    [...alternativeSaveParams.slice(0, 9), JSON.stringify(changedAlternativePlans)],
  )), /operation-mismatch/i, 'alternative bytes must participate in idempotency identity');

  const preservingMainLease = await asAnon(() => scalar(
    'select public.sd_itinerary_main_claim_lease($1,$2,$3,$4,$5,$6)',
    ['default', 'v2', 'main-preserve-tab', 'Admin', 75, 'legacy-admin'],
  ));
  await assert.rejects(
    () => asAnon(() => scalar(
      'select public.sd_itinerary_main_save($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10)',
      ['default', 'v2', 3, nextOperation(), JSON.stringify([v2Row({ rowId: 'v2-legacy-anchor-change', previousPortName: 'BUSAN', calculationStartUtc: '2026-09-02T00:00:00Z' })]), preservingMainLease.leaseId, 'main-preserve-tab', preservingMainLease.fencingToken, 'Admin', 'legacy-admin'],
    )),
    /alternative-anchor-sync-required/,
    'legacy/main omission must fail closed instead of committing alternatives with a stale anchor',
  );
  assert.equal(Number(await scalar("select revision from public.sd_itinerary_documents where workspace_id=$1::uuid and vessel_id='v2'", [ids.workspace])), 3);
  assert.equal((await scalar("select alternative_plans_payload from public.sd_itinerary_documents where workspace_id=$1::uuid and vessel_id='v2'", [ids.workspace]))[0].rows[0].calculationStartUtc, alternativePlans[0].rows[0].calculationStartUtc);
  const preservingMainSaved = await asAnon(() => scalar(
    'select public.sd_itinerary_main_save($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10)',
    ['default', 'v2', 3, nextOperation(), JSON.stringify([v2Row({ rowId: 'v2-main-preserve', previousPortName: 'BUSAN', voyageNumber: 'MAIN-PRESERVES-ALT' })]), preservingMainLease.leaseId, 'main-preserve-tab', preservingMainLease.fencingToken, 'Admin', 'legacy-admin'],
  ));
  assert.equal(Number(preservingMainSaved.revision), 4);
  assert.deepEqual(preservingMainSaved.document.alternativePlans, alternativePlans, 'legacy/main omission must preserve existing alternatives');
  assert.deepEqual(await scalar("select alternative_plans_payload from public.sd_itinerary_history where workspace_id=$1::uuid and vessel_id='v2' and revision=4", [ids.workspace]), alternativePlans, 'history must snapshot preserved alternatives with the formal revision');

  const explicitMainLease = await asAnon(() => scalar(
    'select public.sd_itinerary_main_claim_lease($1,$2,$3,$4,$5,$6)',
    ['default', 'v2', 'main-explicit-tab', 'Admin', 75, 'legacy-admin'],
  ));
  const anchorBPlans = structuredClone(alternativePlans);
  anchorBPlans[0].rows[0].calculationStartUtc = '2026-09-02T00:00:00Z';
  anchorBPlans[0].rows[0].calculationStartTimeZone = 'UTC+9';
  const explicitMainSaved = await asAnon(() => scalar(
    'select public.sd_itinerary_main_save($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10,$11::jsonb)',
    ['default', 'v2', 4, nextOperation(), JSON.stringify([v2Row({ rowId: 'v2-main-explicit-anchor', previousPortName: 'BUSAN', calculationStartUtc: '2026-09-02T00:00:00Z', calculationStartTimeZone: 'UTC+9' })]), explicitMainLease.leaseId, 'main-explicit-tab', explicitMainLease.fencingToken, 'Admin', 'legacy-admin', JSON.stringify(anchorBPlans)],
  ));
  assert.equal(Number(explicitMainSaved.revision), 5);
  assert.equal(explicitMainSaved.document.alternativePlans[0].rows[0].calculationStartUtc, '2026-09-02T00:00:00Z', 'current main clients may change the shared anchor by sending synchronized alternatives');
  assert.deepEqual(await scalar("select alternative_plans_payload from public.sd_itinerary_history where workspace_id=$1::uuid and vessel_id='v2' and revision=5", [ids.workspace]), anchorBPlans);

  const deletingAlternativeLease = await asAnon(() => scalar('select public.sd_itinerary_claim_public_lease($1,$2,$3,$4,$5)', ['default', 'v2', 'public-alternative-browser', 'public-alternative-delete', 75]));
  const deletedAlternatives = await asAnon(() => scalar(
    'select public.sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint,$10::jsonb)',
    ['default', 'v2', 5, nextOperation(), JSON.stringify(alternativeRows), deletingAlternativeLease.leaseId, 'public-alternative-browser', 'public-alternative-delete', deletingAlternativeLease.fencingToken, JSON.stringify([])],
  ));
  assert.deepEqual(deletedAlternatives.document.alternativePlans, [], 'an explicit ship [] must delete all alternatives');
  assert.deepEqual(await scalar("select alternative_plans_payload from public.sd_itinerary_documents where workspace_id=$1::uuid and vessel_id='v2'", [ids.workspace]), []);

  for (const userId of [ids.admin, ids.operator, ids.vessel]) {
    const loaded = await asUser(userId, () => scalar('select public.sd_itinerary_load_many($1,$2::text[])', ['default', ['v1']]));
    assert.equal(loaded[0].document.revision, 2);
  }
  assert.deepEqual((await rollout(ids.admin)).role_permissions.admin, rolePermissions().admin);
  assert.deepEqual((await rollout(ids.operator)).role_permissions.operator, rolePermissions().operator);
  assert.deepEqual((await rollout(ids.vessel)).role_permissions.vessel, rolePermissions().vessel);

  assert.deepEqual((await db.query("select revision,payload from public.ship_dynamics_app_state where workspace_key='default'")).rows[0], { revision: 77, payload: appStatePayload });
  assert.equal(Number(await scalar("select count(*)::int from public.sd_itinerary_history where workspace_id=$1::uuid and vessel_id='v1'", [ids.workspace])), 2);

  await db.exec(migration);
  await db.exec(rolloutBootstrapMigration);
  await db.exec(utcOffsetMigration);
  await db.exec(publicVesselNamesMigration);
  await db.exec(operationMultiSelectMigration);
  await db.exec(calculationV2Migration);
  await db.exec(itineraryNotesMigration);
  await db.exec(officeRoleAccessMigration);
  await db.exec(mainSessionAccessMigration);
  await db.exec(previousPortMigration);
  await db.exec(alternativePlansMigration);
  assert.equal(Number(await scalar('select version from public.sd_itinerary_rollout where workspace_id=$1::uuid', [ids.workspace])), 2);
  assert.equal(Number(await scalar("select revision from public.sd_itinerary_documents where workspace_id=$1::uuid and vessel_id='v1'", [ids.workspace])), 2);
  assert.equal(Number(await scalar("select count(*)::int from public.sd_itinerary_history where workspace_id=$1::uuid and vessel_id='v1'", [ids.workspace])), 2);
  assert.deepEqual((await db.query("select revision,payload from public.ship_dynamics_app_state where workspace_key='default'")).rows[0], { revision: 77, payload: appStatePayload });

  const privileges = (await db.query(`select
    has_table_privilege('anon','public.sd_itinerary_documents','SELECT') as anon_table,
    has_table_privilege('authenticated','public.sd_itinerary_documents','SELECT') as auth_table,
    has_function_privilege('anon','public.sd_itinerary_get_office_entry(text,text)','EXECUTE') as anon_office_entry,
    to_regprocedure('public.sd_itinerary_main_get_rollout(text,text,jsonb)') is null as main_rollout_absent,
    to_regprocedure('public.sd_itinerary_main_owner_update_rollout(text,bigint,uuid,boolean,boolean,text,jsonb)') is null as main_owner_update_absent,
    has_function_privilege('anon','public.sd_itinerary_main_load_many(text,text[],text)','EXECUTE') as anon_main_load,
    has_function_privilege('anon','public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb)','EXECUTE') as anon_main_save,
    has_function_privilege('anon','public.sd_itinerary_main_actor(text,text)','EXECUTE') as anon_main_actor_helper,
    has_function_privilege('authenticated','public.sd_itinerary_owner_update_rollout(text,bigint,uuid,boolean,boolean,jsonb)','EXECUTE') as auth_owner_update,
    has_function_privilege('anon','public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint,jsonb)','EXECUTE') as anon_public_save,
    has_function_privilege('anon','public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)','EXECUTE') as anon_office_save,
    has_function_privilege('authenticated','public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)','EXECUTE') as auth_office_save,
    has_function_privilege('anon','public.sd_itinerary_utc_offset_valid(text)','EXECUTE') as anon_offset_validator,
    has_function_privilege('authenticated','public.sd_itinerary_utc_offset_valid(text)','EXECUTE') as auth_offset_validator,
    has_function_privilege('anon','public.sd_itinerary_purpose_valid(text)','EXECUTE') as anon_purpose_validator,
    has_function_privilege('authenticated','public.sd_itinerary_purpose_valid(text)','EXECUTE') as auth_purpose_validator,
    has_function_privilege('anon','public.sd_itinerary_rows_valid(jsonb)','EXECUTE') as anon_rows_validator,
    has_function_privilege('authenticated','public.sd_itinerary_rows_valid(jsonb)','EXECUTE') as auth_rows_validator,
    has_function_privilege('anon','public.sd_itinerary_alternative_plans_valid(jsonb,jsonb)','EXECUTE') as anon_alternative_validator,
    has_function_privilege('authenticated','public.sd_itinerary_alternative_plans_valid(jsonb,jsonb)','EXECUTE') as auth_alternative_validator,
    has_function_privilege('anon','public.sd_itinerary_document_json(text,text,text,bigint,jsonb,jsonb,timestamptz,text,text)','EXECUTE') as anon_alternative_document_builder,
    has_function_privilege('authenticated','public.sd_itinerary_document_json(text,text,text,bigint,jsonb,jsonb,timestamptz,text,text)','EXECUTE') as auth_alternative_document_builder,
    has_function_privilege('anon','public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)','EXECUTE') as anon_alternative_save_internal,
    has_function_privilege('authenticated','public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)','EXECUTE') as auth_alternative_save_internal
  `)).rows[0];
  assert.deepEqual(privileges, {
    anon_table: false,
    auth_table: false,
    anon_office_entry: true,
    main_rollout_absent: true,
    main_owner_update_absent: true,
    anon_main_load: true,
    anon_main_save: true,
    anon_main_actor_helper: false,
    auth_owner_update: false,
    anon_public_save: true,
    anon_office_save: false,
    auth_office_save: true,
    anon_offset_validator: false,
    auth_offset_validator: false,
    anon_purpose_validator: false,
    auth_purpose_validator: false,
    anon_rows_validator: false,
    auth_rows_validator: false,
    anon_alternative_validator: false,
    auth_alternative_validator: false,
    anon_alternative_document_builder: false,
    auth_alternative_document_builder: false,
    anon_alternative_save_internal: false,
    auth_alternative_save_internal: false,
  });
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC+5:45' })])]), true);

  const readback = (await db.query(readbackSql)).rows[0].itinerary_readback;
  assert.ok(Object.values(readback.tables).every(Boolean));
  assert.ok(Object.values(readback.functions).every(Boolean));
  assert.ok(readback.rollout.every(item => item.mainEnabled && item.shipPortalEnabled && item.permanentlyOpen));
  assert.deepEqual(readback.privileges, {
    anonOfficeSaveExecute: false,
    anonOfficeEntryExecute: true,
    mainRolloutAbsent: true,
    mainOwnerUpdateAbsent: true,
    anonMainLoadExecute: true,
    anonMainSaveExecute: true,
    anonMainActorHelperExecute: false,
    authenticatedMainSaveExecute: true,
    authenticatedOwnerUpdateExecute: false,
    anonPublicSaveExecute: true,
    anonDirectDocumentSelect: false,
    anonOffsetValidatorExecute: false,
    anonPurposeValidatorExecute: false,
    anonRowsValidatorExecute: false,
    authenticatedOfficeSaveExecute: true,
    authenticatedDirectDocumentSelect: false,
    authenticatedOffsetValidatorExecute: false,
    authenticatedPurposeValidatorExecute: false,
    authenticatedRowsValidatorExecute: false,
    anonAlternativeValidatorExecute: false,
    authenticatedAlternativeValidatorExecute: false,
    anonAlternativeDocumentBuilderExecute: false,
    authenticatedAlternativeDocumentBuilderExecute: false,
    anonAlternativeSaveInternalExecute: false,
    authenticatedAlternativeSaveInternalExecute: false,
  });
  assert.ok(Object.values(readback.utcOffsets).every(Boolean));
  assert.ok(Object.values(readback.purposes).every(Boolean));
  assert.ok(Object.values(readback.calculationV2).every(Boolean));
  assert.deepEqual(readback.notes, {
    acceptsMissingNotes: true,
    acceptsTextNotes: true,
    rejectsNonTextNotes: true,
    rejectsOversizedNotes: true,
  });
  assert.deepEqual(readback.previousPortName, {
    acceptsMissingLegacyField: true,
    acceptsFirstRowValue: true,
    rejectsLaterRowValue: true,
    publicSaveRequiresValue: true,
    publicSaveRejectsAllWhitespace: true,
  });
  assert.deepEqual(readback.alternativePlans, {
    documentsColumn: true,
    historyColumn: true,
    acceptsEmpty: true,
    acceptsOne: true,
    rejectsSix: true,
    rejectsLongPlanId: true,
    documentIncludesAlternatives: true,
    currentSaveIncludesAlternatives: true,
    preservesMissingAlternatives: true,
    rejectsOmittedAnchorChange: true,
    operationIdentityIncludesAlternatives: true,
    legacyEmptyReplayCompatible: true,
    historyIncludesAlternatives: true,
  });
  assert.deepEqual(readback.officeRolePermissions, {
    workspaceCount: 1,
    ownerFull: true,
    adminFull: true,
    operatorFull: true,
    vesselFull: true,
  });
  assert.deepEqual(readback.vesselNames, { activeVesselCount: 2, activeMissingFullNameCount: 0, publicListFullNameComplete: true });
  const bootstrapReadback = (await db.query(rolloutBootstrapReadbackSql)).rows[0];
  assert.ok(Object.values(bootstrapReadback).every(Boolean));

  const withoutOperationMigration = new PGlite();
  try {
    await withoutOperationMigration.exec(`
      create schema auth;
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role noinherit bypassrls;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    `);
    await withoutOperationMigration.exec(foundation);
    await withoutOperationMigration.exec(migration);
    await withoutOperationMigration.exec(utcOffsetMigration);
    await withoutOperationMigration.exec(calculationV2Migration);
    await withoutOperationMigration.exec(itineraryNotesMigration);
    const directV2 = await withoutOperationMigration.query('select public.sd_itinerary_rows_valid($1::jsonb) as valid', [JSON.stringify([v2Row()])]);
    assert.equal(directV2.rows[0].valid, true, 'v2 migration must work even when the earlier operation migration was not run');
  } finally {
    await withoutOperationMigration.close();
  }

  console.log('itinerary_postgres_contract=PASS');
} finally {
  await db.close();
}

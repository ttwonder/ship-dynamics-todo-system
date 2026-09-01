import assert from 'node:assert/strict';
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
const readbackSql = await readFile('supabase/itinerary-readback.sql', 'utf8');
const rolloutBootstrapReadbackSql = await readFile('supabase/itinerary-rollout-bootstrap-readback.sql', 'utf8');
const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  outsider: '33333333-3333-4333-8333-333333333333',
};
let operation = 0;
const nextOperation = () => `90000000-0000-4000-8000-${String(++operation).padStart(12, '0')}`;
const rolePermissions = (admin = {}) => ({
  admin: { view: false, edit: false, import: false, export: false, calendar: false, ...admin },
  operator: { view: false, edit: false, import: false, export: false, calendar: false },
  vessel: { view: false, edit: false, import: false, export: false, calendar: false },
});
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
const updateRollout = (expected, op, main, portal, permissions) => asUser(ids.owner, () => scalar(
  'select public.sd_itinerary_owner_update_rollout($1,$2::bigint,$3::uuid,$4,$5,$6::jsonb)',
  ['default', expected, op, main, portal, JSON.stringify(permissions)],
));

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
      ('${ids.owner}','owner@invalid'),('${ids.admin}','admin@invalid'),('${ids.outsider}','outsider@invalid');
    insert into public.sd_workspaces(id,legacy_key,name) values('${ids.workspace}','default','Ship Dynamics');
    insert into public.sd_profiles(id,display_name,username_label) values
      ('${ids.owner}','Owner','owner'),('${ids.admin}','Admin','admin'),('${ids.outsider}','Outsider','outsider');
    insert into public.sd_memberships(workspace_id,user_id,department,role,is_active) values
      ('${ids.workspace}','${ids.owner}','管理','owner',true),('${ids.workspace}','${ids.admin}','管理','admin',true);
    insert into public.sd_login_options(workspace_id,user_id,department,username_label,display_name,auth_alias,is_active,must_change_password) values
      ('${ids.workspace}','${ids.owner}','管理','owner','Owner','owner@invalid',true,false),
      ('${ids.workspace}','${ids.admin}','管理','admin','Admin','admin@invalid',true,false);
    insert into public.sd_vessels(workspace_id,id,name,short_name,full_name,ship_type,fleet_category) values
      ('${ids.workspace}','v1','Vessel One','V1','Vessel One','bulk','fleet'),
      ('${ids.workspace}','v2','Vessel Two','V2','Vessel Two','tanker','fleet');
    create table public.ship_dynamics_app_state(workspace_key text primary key,revision bigint not null,payload jsonb not null);
    insert into public.ship_dynamics_app_state values('default',77,'{"untouched":true}');
  `);
  await db.exec(migration);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row()])]), false, 'deployed base migration must reproduce the old IANA-only rejection');
  await db.exec(rolloutBootstrapMigration);
  await db.exec(utcOffsetMigration);
  await db.exec(publicVesselNamesMigration);
  await db.exec(operationMultiSelectMigration);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row()])]), false, 'pre-v2 validator must reject additive fields');
  await db.exec(calculationV2Migration);

  const ownerInitial = await rollout(ids.owner);
  assert.equal(ownerInitial.version, 1);
  assert.equal(ownerInitial.main_enabled, false);
  assert.equal(ownerInitial.ship_portal_enabled, false);
  assert.equal(ownerInitial.role_permissions.owner.view, true);
  assert.deepEqual(ownerInitial.office_identity, { department: '管理', display_name: 'Owner', username_label: 'owner', role: 'owner' });
  assert.equal((await rollout(ids.admin)).role_permissions.admin.view, false);
  assert.equal(await asAnon(() => scalar('select public.sd_itinerary_get_office_entry($1,$2)', ['default', 'owner'])), false);
  assert.deepEqual(await asAnon(() => scalar('select public.sd_itinerary_get_public_rollout($1)', ['default'])), { ship_portal_enabled: false });
  assert.deepEqual(await asAnon(() => scalar('select public.sd_itinerary_public_list_vessels($1)', ['default'])), []);
  await assert.rejects(() => asAnon(() => db.query('select * from public.sd_itinerary_documents')), /permission denied/i);
  await assert.rejects(() => asUser(ids.admin, () => db.query('select * from public.sd_itinerary_documents')), /permission denied/i);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row()])]), true);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC+5:30' })])]), true);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC+5:45' })])]), true);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC-6' })])]), true);
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'Asia/Seoul' })])]), true, 'legacy IANA rows must stay writable during compatibility');
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([v2Row()])]), true);
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

  await db.query('update public.sd_login_options set must_change_password=true where workspace_id=$1 and user_id=$2', [ids.workspace, ids.owner]);
  assert.equal((await rollout(ids.owner)).office_identity, null);
  await assert.rejects(() => updateRollout(1, nextOperation(), true, false, rolePermissions()), /owner-required/i);
  await assert.rejects(() => asUser(ids.owner, () => scalar('select public.sd_itinerary_load_many($1,$2::text[])', ['default', ['v1']])), /not-authorized/i);
  await assert.rejects(() => asUser(ids.owner, () => scalar('select public.sd_itinerary_operation_status_office($1,$2::uuid)', ['default', '90000000-0000-4000-8000-999999999999'])), /not-authorized/i);
  await db.query('update public.sd_login_options set must_change_password=false where workspace_id=$1 and user_id=$2', [ids.workspace, ids.owner]);

  const rolloutOp = nextOperation();
  const enabled = await updateRollout(1, rolloutOp, true, false, rolePermissions());
  assert.equal(enabled.version, 2);
  assert.equal((await updateRollout(1, rolloutOp, true, false, rolePermissions())).replayed, true);
  await assert.rejects(() => updateRollout(1, rolloutOp, true, true, rolePermissions()), /operation-mismatch/i);
  assert.equal((await rollout(ids.owner)).main_enabled, true);
  assert.equal((await rollout(ids.owner)).version, 2);
  assert.equal(await asAnon(() => scalar('select public.sd_itinerary_get_office_entry($1,$2)', ['default', 'owner'])), true);
  assert.equal(await asAnon(() => scalar('select public.sd_itinerary_get_office_entry($1,$2)', ['default', 'admin'])), false);
  assert.equal(await asAnon(() => scalar('select public.sd_itinerary_get_office_entry($1,$2)', ['default', 'vessel'])), false);
  await assert.rejects(
    () => updateRollout(2, nextOperation(), true, false, { ...rolePermissions(), vessel: { view: true, edit: false, import: false, export: false, calendar: false } }),
    /invalid-role-permissions/i,
  );
  await assert.rejects(() => asUser(ids.admin, () => scalar('select public.sd_itinerary_load_many($1,$2::text[])', ['default', ['v1']])), /not-authorized/i);

  const ownerLease = await asUser(ids.owner, () => scalar('select public.sd_itinerary_claim_office_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'owner-tab', 'Owner', 75]));
  assert.equal(ownerLease.ok, true);
  await assert.rejects(() => asUser(ids.admin, () => scalar('select public.sd_itinerary_claim_office_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'admin-tab', 'Admin', 75])), /not-authorized/i);
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

  const portalOp = nextOperation();
  const portalEnabled = await updateRollout(2, portalOp, true, true, rolePermissions());
  assert.equal(portalEnabled.version, 3);
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
  const publicOp = nextOperation();
  const publicRows = [v2Row({ voyageNumber: 'PUBLIC-R2' })];
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

  const adminPermissionsOp = nextOperation();
  await updateRollout(3, adminPermissionsOp, true, true, rolePermissions({ view: true, export: true, calendar: true }));
  assert.equal(await asAnon(() => scalar('select public.sd_itinerary_get_office_entry($1,$2)', ['default', 'admin'])), true);
  const adminLoaded = await asUser(ids.admin, () => scalar('select public.sd_itinerary_load_many($1,$2::text[])', ['default', ['v1']]));
  assert.equal(adminLoaded[0].document.revision, 2);
  await assert.rejects(() => asUser(ids.admin, () => scalar('select public.sd_itinerary_claim_office_lease($1,$2,$3,$4,$5)', ['default', 'v1', 'admin-tab', 'Admin', 75])), /not-authorized/i);

  assert.deepEqual((await db.query("select revision,payload from public.ship_dynamics_app_state where workspace_key='default'")).rows[0], { revision: 77, payload: { untouched: true } });
  assert.equal(Number(await scalar("select count(*)::int from public.sd_itinerary_history where workspace_id=$1::uuid and vessel_id='v1'", [ids.workspace])), 2);

  await db.exec(migration);
  await db.exec(rolloutBootstrapMigration);
  await db.exec(utcOffsetMigration);
  await db.exec(publicVesselNamesMigration);
  await db.exec(operationMultiSelectMigration);
  await db.exec(calculationV2Migration);
  assert.equal(Number(await scalar('select version from public.sd_itinerary_rollout where workspace_id=$1::uuid', [ids.workspace])), 4);
  assert.equal(Number(await scalar("select revision from public.sd_itinerary_documents where workspace_id=$1::uuid and vessel_id='v1'", [ids.workspace])), 2);
  assert.equal(Number(await scalar("select count(*)::int from public.sd_itinerary_history where workspace_id=$1::uuid and vessel_id='v1'", [ids.workspace])), 2);
  assert.deepEqual((await db.query("select revision,payload from public.ship_dynamics_app_state where workspace_key='default'")).rows[0], { revision: 77, payload: { untouched: true } });

  const privileges = (await db.query(`select
    has_table_privilege('anon','public.sd_itinerary_documents','SELECT') as anon_table,
    has_table_privilege('authenticated','public.sd_itinerary_documents','SELECT') as auth_table,
    has_function_privilege('anon','public.sd_itinerary_get_office_entry(text,text)','EXECUTE') as anon_office_entry,
    has_function_privilege('anon','public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint)','EXECUTE') as anon_public_save,
    has_function_privilege('anon','public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)','EXECUTE') as anon_office_save,
    has_function_privilege('authenticated','public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)','EXECUTE') as auth_office_save,
    has_function_privilege('anon','public.sd_itinerary_utc_offset_valid(text)','EXECUTE') as anon_offset_validator,
    has_function_privilege('authenticated','public.sd_itinerary_utc_offset_valid(text)','EXECUTE') as auth_offset_validator,
    has_function_privilege('anon','public.sd_itinerary_purpose_valid(text)','EXECUTE') as anon_purpose_validator,
    has_function_privilege('authenticated','public.sd_itinerary_purpose_valid(text)','EXECUTE') as auth_purpose_validator,
    has_function_privilege('anon','public.sd_itinerary_rows_valid(jsonb)','EXECUTE') as anon_rows_validator,
    has_function_privilege('authenticated','public.sd_itinerary_rows_valid(jsonb)','EXECUTE') as auth_rows_validator
  `)).rows[0];
  assert.deepEqual(privileges, { anon_table: false, auth_table: false, anon_office_entry: true, anon_public_save: true, anon_office_save: false, auth_office_save: true, anon_offset_validator: false, auth_offset_validator: false, anon_purpose_validator: false, auth_purpose_validator: false, anon_rows_validator: false, auth_rows_validator: false });
  assert.equal(await scalar('select public.sd_itinerary_rows_valid($1::jsonb)', [JSON.stringify([row({ portTimeZone: 'UTC+5:45' })])]), true);

  const readback = (await db.query(readbackSql)).rows[0].itinerary_readback;
  assert.ok(Object.values(readback.tables).every(Boolean));
  assert.ok(Object.values(readback.functions).every(Boolean));
  assert.deepEqual(readback.privileges, {
    anonOfficeSaveExecute: false,
    anonOfficeEntryExecute: true,
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
  });
  assert.ok(Object.values(readback.utcOffsets).every(Boolean));
  assert.ok(Object.values(readback.purposes).every(Boolean));
  assert.ok(Object.values(readback.calculationV2).every(Boolean));
  assert.deepEqual(readback.vesselNames, { activeVesselCount: 2, activeMissingFullNameCount: 0, publicListFullNameComplete: true });
  const bootstrapReadback = (await db.query(rolloutBootstrapReadbackSql)).rows[0];
  assert.ok(Object.values(bootstrapReadback).every(Boolean));

  console.log('itinerary_postgres_contract=PASS');
} finally {
  await db.close();
}

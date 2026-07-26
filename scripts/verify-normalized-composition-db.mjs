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

for (const relative of [
  'supabase/normalized-schema.sql',
  'supabase/normalized-core-domain.sql',
  'supabase/normalized-meeting.sql',
  'supabase/normalized-internal-control.sql',
  'supabase/normalized-security-dispatch.sql',
  'supabase/normalized-auth-orchestration.sql',
  'supabase/normalized-app-contract.sql',
]) {
  const sql = await readFile(resolve(root, relative), 'utf8');
  await db.exec(sql);
}

const functions = await db.query(`
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (
      'command_ship_dynamics_create_meeting',
      'command_ship_dynamics_create_internal_case',
      'command_ship_dynamics_create_internal_case_from_task',
      'command_ship_dynamics_create_task_from_internal_case',
      'command_ship_dynamics_update_user',
      'reserve_ship_dynamics_operation',
      'claim_ship_dynamics_entity_lease',
      'sd_can_read_task'
    )
  order by p.proname
`);
assert.equal(functions.rows.filter(row => row.proname === 'command_ship_dynamics_create_meeting').length, 1);
assert.equal(functions.rows.filter(row => row.proname === 'command_ship_dynamics_create_internal_case').length, 1);
assert.equal(functions.rows.filter(row => row.proname === 'command_ship_dynamics_create_internal_case_from_task').length, 1);
assert.equal(functions.rows.filter(row => row.proname === 'command_ship_dynamics_create_task_from_internal_case').length, 1);
assert.equal(functions.rows.filter(row => row.proname === 'command_ship_dynamics_update_user').length, 1);
assert.equal(functions.rows.filter(row => row.proname === 'reserve_ship_dynamics_operation').length, 1);
assert.equal(functions.rows.filter(row => row.proname === 'claim_ship_dynamics_entity_lease').length, 1);
assert.equal(functions.rows.filter(row => row.proname === 'sd_can_read_task').length, 1);

const taskReader = await db.query(`
  select pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='sd_can_read_task'
`);
const definition = taskReader.rows[0]?.definition || '';
assert.match(definition, /sd_meeting_items|source_meeting_item_id/i, 'final task reader must preserve meeting provenance checks');
assert.match(definition, /sd_internal_cases|is_internal_control/i, 'final task reader must preserve internal-control confidentiality checks');

const lease = await db.query(`
  select string_agg(pg_get_functiondef(p.oid), E'\n') as definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (
      'claim_ship_dynamics_entity_lease',
      'sd_app_claim_ship_dynamics_entity_lease_base'
    )
`);
const leaseDefinition = lease.rows[0]?.definition || '';
assert.match(leaseDefinition, /meeting/i, 'final lease dispatcher must preserve meeting authorization');
assert.match(leaseDefinition, /internal-case/i, 'final lease dispatcher must preserve internal-case authorization');
assert.match(leaseDefinition, /user/i, 'final lease dispatcher must preserve non-owner user authorization');

const ids = {
  workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner: '11111111-1111-4111-8111-111111111111',
  operator: '22222222-2222-4222-8222-222222222222',
  vessel: '33333333-3333-4333-8333-333333333333',
  session: '44444444-4444-4444-8444-444444444444',
};

await db.exec(`
  insert into auth.users(id,email) values
    ('${ids.owner}','owner@internal.invalid'),
    ('${ids.operator}','operator@internal.invalid'),
    ('${ids.vessel}','vessel@internal.invalid');
  insert into public.sd_workspaces(id,legacy_key,name)
    values('${ids.workspace}','composition','Composition');
  insert into public.sd_profiles(id,display_name,username_label) values
    ('${ids.owner}','Owner','owner'),
    ('${ids.operator}','Operator','operator'),
    ('${ids.vessel}','Vessel','vessel');
  insert into public.sd_memberships(workspace_id,user_id,department,role,is_active) values
    ('${ids.workspace}','${ids.owner}','Management','owner',true),
    ('${ids.workspace}','${ids.operator}','Operations','operator',true),
    ('${ids.workspace}','${ids.vessel}','Vessel','vessel',true);
  insert into public.sd_vessels(
    workspace_id,id,name,short_name,full_name,ship_type,fleet_category,created_by
  ) values
    ('${ids.workspace}','vessel-a','Vessel A','A','Vessel A','Type A','Fleet','${ids.owner}'),
    ('${ids.workspace}','vessel-b','Vessel B','B','Vessel B','Type B','Fleet','${ids.owner}');
  insert into public.sd_vessel_assignments(
    workspace_id,vessel_id,user_id,assignment_kind,is_active
  ) values
    ('${ids.workspace}','vessel-a','${ids.vessel}','vessel_account',true),
    ('${ids.workspace}','vessel-a','${ids.operator}','manager',true);

  insert into public.sd_meetings(
    workspace_id,id,scope_mode,subject,status,meeting_date,reason,priority,
    is_internal_control,created_by,updated_by
  ) values
    ('${ids.workspace}','meeting-valid','vessels','Valid','追蹤中','2026-07-26','Reason','中',false,'${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','meeting-inactive','vessels','Inactive','追蹤中','2026-07-26','Reason','中',false,'${ids.owner}','${ids.owner}');
  insert into public.sd_meeting_vessels(workspace_id,meeting_id,vessel_id) values
    ('${ids.workspace}','meeting-valid','vessel-a'),
    ('${ids.workspace}','meeting-inactive','vessel-a');
  insert into public.sd_meeting_items(
    workspace_id,id,meeting_id,description,distribute_to_vessels,ordinal,is_active,created_by,updated_by
  ) values
    ('${ids.workspace}','item-valid','meeting-valid','Valid item',true,1,true,'${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','item-inactive','meeting-inactive','Inactive item',true,1,false,'${ids.owner}','${ids.owner}');

  insert into public.sd_tasks(
    workspace_id,id,description,status,priority,source_kind,source_meeting_item_id,
    is_internal_control,internal_control_cancelled_at,internal_control_cancelled_by,
    created_by,updated_by
  ) values
    ('${ids.workspace}','ordinary-a','Ordinary','Open','中','ordinary',null,false,null,null,'${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','internal-a','Internal','Open','中','ordinary',null,true,null,null,'${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','cancelled-a','Cancelled internal','Open','中','ordinary',null,false,clock_timestamp(),'${ids.owner}','${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','meeting-valid-task','Meeting valid','Open','中','meeting','item-valid',false,null,null,'${ids.owner}','${ids.owner}'),
    ('${ids.workspace}','meeting-inactive-task','Meeting inactive','Open','中','meeting','item-inactive',false,null,null,'${ids.owner}','${ids.owner}');
  insert into public.sd_task_vessels(
    workspace_id,task_id,vessel_id,is_active_scope,status,is_closed,updated_by
  )
  select '${ids.workspace}', id, 'vessel-a', true, status, false, '${ids.owner}'
  from public.sd_tasks where workspace_id='${ids.workspace}';

  insert into public.sd_internal_cases(
    workspace_id,id,vessel_id,report_date,report_source,description,priority,
    category,is_aware,status,origin,created_by,updated_by
  ) values (
    '${ids.workspace}','case-a','vessel-a','2026-07-26','日常','Internal case','中',
    'Safety',false,'Open','internal-control','${ids.owner}','${ids.owner}'
  );
`);

async function asUser(userId, action) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${userId}'`);
  try { return await action(); }
  finally { await db.exec(`reset role; reset request.jwt.claim.sub`); }
}

const vesselTasks = await asUser(ids.vessel, () => db.query(`
  select id from public.sd_tasks order by id
`));
assert.deepEqual(vesselTasks.rows.map(row => row.id), ['meeting-valid-task', 'ordinary-a']);
const vesselCases = await asUser(ids.vessel, () => db.query(`
  select id from public.sd_internal_cases order by id
`));
assert.deepEqual(vesselCases.rows, [], 'vessel accounts receive no internal-case existence signal');

const ownerTasks = await asUser(ids.owner, () => db.query(`select id from public.sd_tasks order by id`));
assert.equal(ownerTasks.rows.length, 5);
const ownerCases = await asUser(ids.owner, () => db.query(`select id from public.sd_internal_cases order by id`));
assert.deepEqual(ownerCases.rows, [{ id: 'case-a' }]);

for (const [entityType, entityId, leaseKey] of [
  ['meeting', 'meeting-valid', 'meeting:meeting-valid'],
  ['internal-case', 'case-a', 'internal-case:case-a'],
]) {
  await assert.rejects(
    () => asUser(ids.vessel, () => db.query(
      `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,75)`,
      [ids.workspace, leaseKey, entityType, entityId, ids.session],
    )),
    /not-authorized/i,
  );
  const grant = await asUser(ids.owner, () => db.query(
    `select public.claim_ship_dynamics_entity_lease($1::uuid,$2,$3,$4,$5::uuid,75) as result`,
    [ids.workspace, leaseKey, entityType, entityId, ids.session],
  ));
  assert.equal(grant.rows[0].result.ok, true);
}

const publicExecute = await db.query(`
  select routine_name
  from information_schema.routine_privileges
  where routine_schema='public' and grantee='PUBLIC' and privilege_type='EXECUTE'
  order by routine_name
`);
assert.deepEqual(publicExecute.rows, [], 'normalized public functions must revoke default PUBLIC execute');
const unsafeDefiners = await db.query(`
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.prosecdef
    and not ('search_path=pg_catalog, public'=any(coalesce(p.proconfig,'{}'::text[])))
  order by p.proname
`);
assert.deepEqual(unsafeDefiners.rows, [], 'every SECURITY DEFINER function must pin search_path');
const directDml = await db.query(`
  select grantee,table_name,privilege_type
  from information_schema.role_table_grants
  where table_schema='public'
    and table_name like 'sd_%'
    and grantee in ('anon','authenticated')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  order by grantee,table_name,privilege_type
`);
assert.deepEqual(directDml.rows, [], 'browser roles must have no direct normalized-table DML');
const sensitiveReads = await db.query(`
  select grantee,table_name
  from information_schema.role_table_grants
  where table_schema='public'
    and table_name in (
      'sd_public_site_gate','sd_login_options','sd_rate_limit_buckets',
      'sd_edit_leases','sd_operation_reservations'
    )
    and grantee in ('anon','authenticated')
    and privilege_type='SELECT'
  order by grantee,table_name
`);
assert.deepEqual(sensitiveReads.rows, [], 'browser roles must not read security-sensitive normalized tables');

console.log('normalized_schema_composition=PASS');

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const migrationPath = 'supabase/migrations/20260904230000_itinerary_daily_reports.sql';
const db = new PGlite();

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.sd_workspaces (
      id uuid primary key,
      workspace_key text not null unique,
      is_active boolean not null default true
    );
    create table public.ship_dynamics_app_state (
      workspace_key text primary key,
      payload jsonb not null
    );
    create table public.sd_vessels (
      workspace_id uuid not null,
      id text not null,
      name text not null,
      short_name text not null default '',
      full_name text not null default '',
      is_active boolean not null default true,
      primary key(workspace_id, id)
    );
    create table public.sd_itinerary_documents (
      workspace_id uuid not null,
      vessel_id text not null,
      revision bigint not null default 0,
      rows_payload jsonb not null default '[]'::jsonb,
      alternative_plans_payload jsonb not null default '[]'::jsonb,
      updated_at timestamptz,
      primary key(workspace_id, vessel_id)
    );
    create or replace function public.sd_itinerary_workspace_id(p_workspace_key text)
    returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
      select id from public.sd_workspaces where workspace_key=p_workspace_key and is_active
    $$;
    create or replace function public.sd_itinerary_main_actor(p_workspace_key text,p_actor_user_id text)
    returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
      select jsonb_build_object(
        'workspaceId', workspace.id,
        'actorKey', p_actor_user_id,
        'role', actor.item ->> 'role'
      )
      from public.sd_workspaces workspace
      join public.ship_dynamics_app_state state on state.workspace_key=workspace.workspace_key
      cross join lateral (
        select item from jsonb_array_elements(state.payload -> 'users') item
        where item ->> 'id'=p_actor_user_id and coalesce((item ->> 'isActive')::boolean,false)
        limit 1
      ) actor
      where workspace.workspace_key=p_workspace_key and workspace.is_active
    $$;
  `);

  const migration = await readFile(migrationPath, 'utf8');
  const executable = migration.includes('create extension if not exists pg_cron')
    ? `${migration.slice(0, migration.indexOf('create extension if not exists pg_cron'))}\ncommit;`
    : migration;
  await db.exec(executable);

  await db.exec(`
    insert into public.sd_workspaces(id,workspace_key,is_active)
    values('${workspace}','test-workspace',true);
    insert into public.ship_dynamics_app_state(workspace_key,payload)
    values('test-workspace','{"users":[
      {"id":"owner-1","role":"owner","isActive":true},
      {"id":"admin-1","role":"admin","isActive":true}
    ]}');
    insert into public.sd_vessels(workspace_id,id,name,is_active) values
      ('${workspace}','v1','FPMC ALPHA',true),
      ('${workspace}','v2','FPMC BETA',true),
      ('${workspace}','v3','INACTIVE',false);
    insert into public.sd_itinerary_documents(
      workspace_id,vessel_id,revision,rows_payload,alternative_plans_payload,updated_at
    ) values (
      '${workspace}','v1',7,
      '[{"rowId":"formal-1","sortOrder":0,"voyageNumber":"V001","portDockName":"KAOHSIUNG","operation":"To Load","cargoQuantityText":"12,000 MT"}]',
      '[{"planId":"alt-1","rows":[{"rowId":"forbidden-alt","portDockName":"FORBIDDEN ALT PORT"}]}]',
      '2026-09-04T00:30:00Z'
    );
  `);

  const firstResult = await db.query(`
    select public.sd_generate_daily_itinerary_report(
      '${workspace}'::uuid,'2026-09-04'::date,'2026-09-04T01:00:00Z'::timestamptz
    ) as value
  `);
  const first = firstResult.rows[0].value;
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.report.businessDate, '2026-09-04');
  assert.equal(first.report.vesselCount, 2, 'every active vessel must be frozen even when no formal document exists');
  assert.equal(first.report.rowCount, 1);

  await db.exec(`
    update public.sd_itinerary_documents
    set revision=8, rows_payload='[{"rowId":"later","sortOrder":0,"portDockName":"LATER CHANGE"}]'
    where workspace_id='${workspace}' and vessel_id='v1';
  `);
  const replayResult = await db.query(`
    select public.sd_generate_daily_itinerary_report(
      '${workspace}'::uuid,'2026-09-04'::date,'2026-09-04T02:00:00Z'::timestamptz
    ) as value
  `);
  const replay = replayResult.rows[0].value;
  assert.equal(replay.created, false, 'same Taipei date must be idempotent and preserve the first frozen snapshot');
  assert.equal(replay.report.sourceMaxRevision, 7);

  const listResult = await db.query(`
    select public.sd_itinerary_daily_report_list('test-workspace','owner-1') as value
  `);
  const list = listResult.rows[0].value;
  assert.equal(list.ok, true);
  assert.equal(list.reports.length, 1);
  assert.equal(list.reports[0].businessDate, '2026-09-04');
  assert.equal(Object.hasOwn(list.reports[0], 'snapshot'), false, 'history list must return metadata only');
  assert.doesNotMatch(JSON.stringify(list), /FORMAL|FORBIDDEN|LATER CHANGE/, 'metadata list must not download snapshot payloads');

  const loadResult = await db.query(`
    select public.sd_itinerary_daily_report_load('test-workspace','2026-09-04'::date,'owner-1') as value
  `);
  const loaded = loadResult.rows[0].value;
  assert.equal(loaded.ok, true);
  assert.equal(loaded.report.snapshot.vessels.length, 2);
  assert.equal(loaded.report.snapshot.vessels[0].revision, 7);
  assert.equal(loaded.report.snapshot.vessels[0].rows[0].portDockName, 'KAOHSIUNG');
  assert.equal(loaded.report.snapshot.vessels[1].revision, 0);
  assert.deepEqual(loaded.report.snapshot.vessels[1].rows, []);
  assert.doesNotMatch(JSON.stringify(loaded), /FORBIDDEN ALT PORT|LATER CHANGE/, 'daily snapshot must contain formal rows only and remain immutable');

  const adminDeleteResult = await db.query(`
    select public.delete_sd_itinerary_daily_reports(
      'test-workspace','admin-1','11111111-1111-4111-8111-111111111111'::uuid,
      '["2026-09-04"]'::jsonb,'["2026-09-04"]'::jsonb
    ) as value
  `);
  assert.deepEqual(adminDeleteResult.rows[0].value, { ok: false, error: 'OWNER_REQUIRED' });

  const deleteResult = await db.query(`
    select public.delete_sd_itinerary_daily_reports(
      'test-workspace','owner-1','22222222-2222-4222-8222-222222222222'::uuid,
      '["2026-09-04"]'::jsonb,'["2026-09-04"]'::jsonb
    ) as value
  `);
  const deleted = deleteResult.rows[0].value;
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deletedCount, 1);
  assert.deepEqual(deleted.deletedDates, ['2026-09-04']);

  const replayDeleteResult = await db.query(`
    select public.delete_sd_itinerary_daily_reports(
      'test-workspace','owner-1','22222222-2222-4222-8222-222222222222'::uuid,
      '["2026-09-04"]'::jsonb,'["2026-09-04"]'::jsonb
    ) as value
  `);
  assert.deepEqual(replayDeleteResult.rows[0].value, deleted, 'lost-ACK replay must return the durable operation result');

  const documents = await db.query(`select vessel_id,revision,rows_payload from public.sd_itinerary_documents order by vessel_id`);
  assert.equal(documents.rows.length, 1, 'snapshot deletion must never delete formal Itinerary documents');
  assert.equal(Number(documents.rows[0].revision), 8);
  assert.match(JSON.stringify(documents.rows[0].rows_payload), /LATER CHANGE/);

  await db.query(`select public.sd_generate_daily_itinerary_report('${workspace}'::uuid,'2026-09-03'::date,'2026-09-03T01:00:00Z'::timestamptz)`);
  await db.query(`select public.sd_generate_daily_itinerary_report('${workspace}'::uuid,'2026-09-04'::date,'2026-09-04T01:00:00Z'::timestamptz)`);
  const staleDelete = await db.query(`
    select public.delete_sd_itinerary_daily_reports(
      'test-workspace','owner-1','33333333-3333-4333-8333-333333333333'::uuid,
      '["2026-09-03"]'::jsonb,'["2026-09-03"]'::jsonb
    ) as value
  `);
  assert.equal(staleDelete.rows[0].value.error, 'REPORT_SET_CHANGED', 'a changed preview set must fail closed with zero deletion');
  const remaining = await db.query(`select business_date from public.sd_itinerary_daily_reports order by business_date`);
  const remainingDates = remaining.rows.map(row => row.business_date instanceof Date
    ? row.business_date.toISOString().slice(0, 10)
    : String(row.business_date).slice(0, 10));
  assert.deepEqual(remainingDates, ['2026-09-03', '2026-09-04']);

  assert.match(migration, /'0 1 \* \* \*'/, '09:00 Asia/Taipei scheduler must run every calendar day at 01:00 UTC');
  assert.match(migration, /'Asia\/Taipei'/);
  assert.doesNotMatch(migration, /alternative_plans_payload/, 'scheduled report must not read alternative plans');
  assert.doesNotMatch(migration, /delete\s+from\s+public\.sd_itinerary_documents/i, 'daily-report cleanup must never delete formal documents');
  assert.match(migration, /delete\s+from\s+public\.sd_itinerary_daily_reports/i);
  assert.match(migration, /actor_role is distinct from 'owner'/);
  assert.match(migration, /current_dates is distinct from normalized_expected/);
  assert.match(migration, /revoke all on table public\.sd_itinerary_daily_reports from public, anon, authenticated/);

  console.log('itinerary_daily_reports_db=PASS');
} finally {
  await db.close();
}

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
    create function public.sd_itinerary_daily_report_list(text,text)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.delete_sd_itinerary_daily_reports(text,text,uuid,jsonb,jsonb)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
  `);

  const migration = await readFile(migrationPath, 'utf8');
  const executable = migration.includes('create extension if not exists pg_cron')
    ? `${migration.slice(0, migration.indexOf('create extension if not exists pg_cron'))}\ncommit;`
    : migration;
  await db.exec(executable);
  const legacyOverloads = await db.query(`
    select
      to_regprocedure('public.sd_itinerary_daily_report_list(text,text)') is null as old_list_removed,
      to_regprocedure('public.delete_sd_itinerary_daily_reports(text,text,uuid,jsonb,jsonb)') is null as old_delete_removed
  `);
  assert.equal(legacyOverloads.rows[0].old_list_removed, true);
  assert.equal(legacyOverloads.rows[0].old_delete_removed, true);

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
      '${list.setToken}','["2026-09-04"]'::jsonb
    ) as value
  `);
  assert.deepEqual(adminDeleteResult.rows[0].value, { ok: false, error: 'OWNER_REQUIRED' });

  const deleteResult = await db.query(`
    select public.delete_sd_itinerary_daily_reports(
      'test-workspace','owner-1','22222222-2222-4222-8222-222222222222'::uuid,
      '${list.setToken}','["2026-09-04"]'::jsonb
    ) as value
  `);
  const deleted = deleteResult.rows[0].value;
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deletedCount, 1);
  assert.deepEqual(deleted.deletedDates, ['2026-09-04']);
  assert.match(deleted.remainingSetToken, /^[0-9a-f]{32}$/);

  const replayDeleteResult = await db.query(`
    select public.delete_sd_itinerary_daily_reports(
      'test-workspace','owner-1','22222222-2222-4222-8222-222222222222'::uuid,
      '${list.setToken}','["2026-09-04"]'::jsonb
    ) as value
  `);
  assert.deepEqual(replayDeleteResult.rows[0].value, deleted, 'lost-ACK replay must return the durable operation result');

  const documents = await db.query(`select vessel_id,revision,rows_payload from public.sd_itinerary_documents order by vessel_id`);
  assert.equal(documents.rows.length, 1, 'snapshot deletion must never delete formal Itinerary documents');
  assert.equal(Number(documents.rows[0].revision), 8);
  assert.match(JSON.stringify(documents.rows[0].rows_payload), /LATER CHANGE/);

  await db.query(`select public.sd_generate_daily_itinerary_report('${workspace}'::uuid,'2026-09-03'::date,'2026-09-03T01:00:00Z'::timestamptz)`);
  const stalePreview = (await db.query(`
    select public.sd_itinerary_daily_report_list('test-workspace','owner-1',1,30) as value
  `)).rows[0].value;
  await db.query(`select public.sd_generate_daily_itinerary_report('${workspace}'::uuid,'2026-09-04'::date,'2026-09-04T01:00:00Z'::timestamptz)`);
  const staleDelete = await db.query(`
    select public.delete_sd_itinerary_daily_reports(
      'test-workspace','owner-1','33333333-3333-4333-8333-333333333333'::uuid,
      '${stalePreview.setToken}','["2026-09-03"]'::jsonb
    ) as value
  `);
  assert.equal(staleDelete.rows[0].value.error, 'REPORT_SET_CHANGED', 'a changed preview set must fail closed with zero deletion');
  const remaining = await db.query(`select business_date from public.sd_itinerary_daily_reports order by business_date`);
  const remainingDates = remaining.rows.map(row => row.business_date instanceof Date
    ? row.business_date.toISOString().slice(0, 10)
    : String(row.business_date).slice(0, 10));
  assert.deepEqual(remainingDates, ['2026-09-03', '2026-09-04']);

  await db.exec(`
    delete from public.sd_itinerary_daily_reports where workspace_id='${workspace}';
    insert into public.sd_itinerary_daily_reports(
      workspace_id,business_date,timezone,generated_at,generated_by,
      vessel_count,row_count,source_max_revision,snapshot
    )
    select
      '${workspace}', date '2026-09-04' - day_offset, 'Asia/Taipei',
      '2026-09-04T01:00:00Z'::timestamptz - day_offset * interval '1 day',
      'scheduled', 2, day_offset, 7,
      jsonb_build_object(
        'schemaVersion',1,'businessDate',(date '2026-09-04' - day_offset)::text,
        'timezone','Asia/Taipei','generatedAt','2026-09-04T01:00:00Z',
        'vesselCount',2,'rowCount',day_offset,'sourceMaxRevision',7,'vessels','[]'::jsonb
      )
    from generate_series(0,64) day_offset;
  `);
  const firstPage = (await db.query(`
    select public.sd_itinerary_daily_report_list('test-workspace','owner-1',1,100) as value
  `)).rows[0].value;
  assert.equal(firstPage.page, 1);
  assert.equal(firstPage.pageSize, 30, 'server must cap pages at 30 even when the caller asks for 100');
  assert.equal(firstPage.total, 65);
  assert.equal(firstPage.pageCount, 3);
  assert.equal(firstPage.reports.length, 30);
  assert.equal(firstPage.reports[0].businessDate, '2026-09-04');
  assert.equal(firstPage.reports[29].businessDate, '2026-08-06');
  assert.equal(typeof firstPage.setToken, 'string');
  assert.ok(firstPage.setToken.length > 0);

  const thirdPage = (await db.query(`
    select public.sd_itinerary_daily_report_list('test-workspace','owner-1',3,30) as value
  `)).rows[0].value;
  assert.equal(thirdPage.reports.length, 5);
  assert.equal(thirdPage.reports[0].businessDate, '2026-07-06');
  assert.equal(thirdPage.reports[4].businessDate, '2026-07-02');
  assert.equal(thirdPage.setToken, firstPage.setToken, 'all pages of one report set need the same delete token');

  const located = (await db.query(`
    select public.sd_itinerary_daily_report_locate('test-workspace','2026-08-05'::date,'owner-1',30) as value
  `)).rows[0].value;
  assert.deepEqual({ found:located.found, page:located.page }, { found:true, page:2 });
  const missing = (await db.query(`
    select public.sd_itinerary_daily_report_locate('test-workspace','2025-01-01'::date,'owner-1',30) as value
  `)).rows[0].value;
  assert.equal(missing.found, false, 'a missing date must not jump to a neighbouring report');

  await db.exec(`
    insert into public.sd_workspaces(id,workspace_key,is_active)
    values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','broken-workspace',true);
    insert into public.sd_vessels(workspace_id,id,name,is_active)
    values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','broken-vessel','BROKEN',true);
    create or replace function public.reject_broken_daily_report()
    returns trigger language plpgsql as $$
    begin
      if new.workspace_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid then
        raise exception 'fixture failure';
      end if;
      return new;
    end;
    $$;
    create trigger reject_broken_daily_report
    before insert on public.sd_itinerary_daily_reports
    for each row execute function public.reject_broken_daily_report();
  `);
  const scheduledRun = (await db.query(`
    select public.ship_dynamics_run_daily_itinerary_reports() as value
  `)).rows[0].value;
  assert.equal(scheduledRun.failedCount, 1, 'one broken workspace must be isolated');
  assert.equal(scheduledRun.createdCount + scheduledRun.existingCount, 1, 'the healthy workspace must still complete');
  assert.equal(scheduledRun.failures.length, 1);
  const brokenReports = await db.query(`
    select count(*)::integer as count from public.sd_itinerary_daily_reports
    where workspace_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  `);
  assert.equal(brokenReports.rows[0].count, 0);

  const generateDefinition = migration.slice(
    migration.indexOf('create or replace function public.sd_generate_daily_itinerary_report('),
    migration.indexOf('create or replace function public.ship_dynamics_run_daily_itinerary_reports()'),
  );
  assert.match(generateDefinition, /pg_advisory_xact_lock\(hashtextextended\(p_workspace_id::text \|\| ':daily-itinerary-report'/, 'generation must share the delete set lock');
  assert.match(migration, /'0 1 \* \* \*'/, '09:00 Asia/Taipei scheduler must run every calendar day at 01:00 UTC');
  assert.match(migration, /'Asia\/Taipei'/);
  assert.doesNotMatch(migration, /alternative_plans_payload/, 'scheduled report must not read alternative plans');
  assert.doesNotMatch(migration, /delete\s+from\s+public\.sd_itinerary_documents/i, 'daily-report cleanup must never delete formal documents');
  assert.match(migration, /delete\s+from\s+public\.sd_itinerary_daily_reports/i);
  assert.match(migration, /actor_role is distinct from 'owner'/);
  assert.match(migration, /current_set_token is distinct from p_expected_set_token/);
  assert.match(migration, /revoke all on table public\.sd_itinerary_daily_reports from public, anon, authenticated/);

  console.log('itinerary_daily_reports_db=PASS');
} finally {
  await db.close();
}

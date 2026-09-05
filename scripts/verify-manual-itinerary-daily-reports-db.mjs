import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const repo = process.cwd();
const baselinePath = `${repo}/supabase/migrations/20260904230000_itinerary_daily_reports.sql`;
const migrationPath = `${repo}/supabase/migrations/20260905200000_manual_itinerary_daily_reports.sql`;
const compatibilityPatchPath = `${repo}/supabase/migrations/20260905210000_manual_itinerary_legacy_compatibility.sql`;
const readbackPath = `${repo}/supabase/manual-itinerary-daily-reports-readback.sql`;
const withoutPgCronTail = sql => {
  const marker = 'create extension if not exists pg_cron';
  return sql.includes(marker) ? `${sql.slice(0, sql.indexOf(marker))}\ncommit;` : sql;
};
const value = async (db, sql) => (await db.query(sql)).rows[0].value;

const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema if not exists cron;
    create table public.sd_workspaces(id uuid primary key,workspace_key text unique not null,is_active boolean not null default true);
    create table public.sd_actors(workspace_id uuid not null,user_id text not null,role text not null,primary key(workspace_id,user_id));
    create table public.sd_vessels(id uuid primary key,workspace_id uuid not null,code text,name text,is_active boolean not null default true,sort_order integer not null default 0);
    create table public.sd_itinerary_documents(workspace_id uuid not null,vessel_id uuid not null,revision bigint not null default 0,rows_payload jsonb not null default '[]',alternative_plans_payload jsonb not null default '[]',updated_at timestamptz not null default clock_timestamp(),primary key(workspace_id,vessel_id));
    create or replace function public.sd_itinerary_main_actor(p_workspace_key text,p_actor_user_id text)
    returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
      select jsonb_build_object('workspaceId',workspace.id,'role',actor.role)
      from public.sd_workspaces workspace join public.sd_actors actor on actor.workspace_id=workspace.id
      where workspace.workspace_key=p_workspace_key and actor.user_id=p_actor_user_id and workspace.is_active
    $$;
  `);
  const baseline = withoutPgCronTail(await readFile(baselinePath, 'utf8'));
  await db.exec(baseline);
  const migration = await readFile(migrationPath, 'utf8');
  await db.exec(migration);
  const compatibilityPatch = await readFile(compatibilityPatchPath, 'utf8');
  await db.exec(compatibilityPatch);
  const hardenedSecurityDefiners = [
    'sd_build_daily_itinerary_report_snapshot','sd_generate_daily_itinerary_report',
    'ship_dynamics_run_daily_itinerary_reports','sd_itinerary_daily_report_set_token',
    'sd_itinerary_daily_report_list','sd_itinerary_daily_report_locate','sd_itinerary_daily_report_load',
    'delete_sd_itinerary_daily_reports','sd_save_manual_itinerary_report',
    'sd_itinerary_daily_report_list_v2','sd_itinerary_daily_report_locate_v2',
    'sd_itinerary_daily_report_load_by_id','delete_sd_itinerary_daily_report_records',
  ];
  const hardenedCatalogCount = await value(db, `
    select count(*)::integer as value
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.prosecdef
      and procedure.proname in (${hardenedSecurityDefiners.map(name => `'${name}'`).join(',')})
  `);
  assert.equal(hardenedCatalogCount, hardenedSecurityDefiners.length, 'the complete daily-report security-definer catalog must survive the upgrade');
  const unsafeSearchPathCount = await value(db, `
    select count(*)::integer as value
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname in (${hardenedSecurityDefiners.map(name => `'${name}'`).join(',')})
      and not ('search_path=""' = any(coalesce(procedure.proconfig,array[]::text[])))
  `);
  assert.equal(unsafeSearchPathCount, 0, 'all new/replaced security-definer entry points must pin an empty search_path');

  const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await db.exec(`
    insert into public.sd_workspaces values('${workspace}','ship-dynamics',true);
    insert into public.sd_actors values
      ('${workspace}','owner-1','owner'),('${workspace}','admin-1','admin'),('${workspace}','operator-1','operator');
    insert into public.sd_vessels values
      ('11111111-1111-4111-8111-111111111111','${workspace}','A','FPMC A',true,1),
      ('22222222-2222-4222-8222-222222222222','${workspace}','B','FPMC B',true,2);
    insert into public.sd_itinerary_documents values
      ('${workspace}','11111111-1111-4111-8111-111111111111',7,
       '[{"id":"r-a","sortOrder":0,"port":"KAOHSIUNG","eta":"2026-09-05T01:00:00Z"}]','[{"id":"alt-forbidden"}]','2026-09-05T00:30:00Z'),
      ('${workspace}','22222222-2222-4222-8222-222222222222',3,
       '[{"id":"r-b","sortOrder":0,"port":"MAILIAO"}]','[]','2026-09-05T00:31:00Z');
  `);

  const ownerOp = '11111111-1111-4111-8111-111111111111';
  const first = await value(db, `select public.sd_save_manual_itinerary_report('ship-dynamics','owner-1','${ownerOp}'::uuid) as value`);
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.operationId, ownerOp);
  assert.equal(first.report.generatedBy, 'manual');
  assert.equal(first.report.generatedByActorId, 'owner-1');
  assert.match(first.report.reportId, /^\d+$/);
  assert.doesNotMatch(JSON.stringify(first), /alt-forbidden/);

  const replay = await value(db, `select public.sd_save_manual_itinerary_report('ship-dynamics','owner-1','${ownerOp}'::uuid) as value`);
  assert.equal(replay.created, false);
  assert.equal(replay.report.reportId, first.report.reportId);
  assert.equal(await value(db, `select count(*)::integer as value from public.sd_itinerary_daily_reports where operation_id='${ownerOp}'::uuid`), 1);

  await db.exec(`update public.sd_actors set role='operator' where workspace_id='${workspace}' and user_id='owner-1'`);
  const demotedReplay = await value(db, `select public.sd_save_manual_itinerary_report('ship-dynamics','owner-1','${ownerOp}'::uuid) as value`);
  assert.equal(demotedReplay.ok, true, 'a committed lost-ack operation must reconcile before current-role authorization');
  assert.equal(demotedReplay.created, false);
  assert.equal(demotedReplay.report.reportId, first.report.reportId);
  await db.exec(`update public.sd_actors set role='owner' where workspace_id='${workspace}' and user_id='owner-1'`);

  const reusedByOtherActor = await value(db, `select public.sd_save_manual_itinerary_report('ship-dynamics','admin-1','${ownerOp}'::uuid) as value`);
  assert.equal(reusedByOtherActor.error, 'OPERATION_ID_REUSED');
  const operatorDenied = await value(db, `select public.sd_save_manual_itinerary_report('ship-dynamics','operator-1','33333333-3333-4333-8333-333333333333'::uuid) as value`);
  assert.equal(operatorDenied.error, 'OWNER_OR_ADMIN_REQUIRED');

  const admin = await value(db, `select public.sd_save_manual_itinerary_report('ship-dynamics','admin-1','22222222-2222-4222-8222-222222222222'::uuid) as value`);
  assert.equal(admin.created, true);
  assert.equal(admin.report.businessDate, first.report.businessDate);
  assert.notEqual(admin.report.reportId, first.report.reportId);

  const scheduled = await value(db, `select public.sd_generate_daily_itinerary_report('${workspace}'::uuid,'${first.report.businessDate}'::date,clock_timestamp()) as value`);
  assert.equal(scheduled.ok, true);
  await value(db, `select public.sd_generate_daily_itinerary_report('${workspace}'::uuid,'${first.report.businessDate}'::date,clock_timestamp()) as value`);
  const sameDayCounts = (await db.query(`select generated_by,count(*)::integer as count from public.sd_itinerary_daily_reports where workspace_id='${workspace}' and business_date='${first.report.businessDate}' group by generated_by order by generated_by`)).rows;
  assert.deepEqual(sameDayCounts.map(row => [row.generated_by,row.count]), [['manual',2],['scheduled',1]]);

  const legacyPage = await value(db, `select public.sd_itinerary_daily_report_list('ship-dynamics','owner-1',1,30) as value`);
  assert.equal(legacyPage.total, 1, 'the deployed old client must see only the one scheduled report');
  assert.equal(legacyPage.reports.length, 1);
  assert.equal(legacyPage.reports[0].generatedBy, 'scheduled');
  const legacyLocation = await value(db, `select public.sd_itinerary_daily_report_locate('ship-dynamics','${first.report.businessDate}'::date,'owner-1',30) as value`);
  assert.deepEqual({ found:legacyLocation.found, page:legacyLocation.page }, { found:true, page:1 });

  const legacyDeleteOp = '90909090-9090-4090-8090-909090909090';
  const legacyDeleted = await value(db, `select public.delete_sd_itinerary_daily_reports('ship-dynamics','owner-1','${legacyDeleteOp}'::uuid,'${legacyPage.setToken}','["${first.report.businessDate}"]'::jsonb) as value`);
  assert.equal(legacyDeleted.ok, true);
  assert.deepEqual(legacyDeleted.deletedDates, [first.report.businessDate]);
  assert.equal(await value(db, `select count(*)::integer as value from public.sd_itinerary_daily_reports where workspace_id='${workspace}' and generated_by='manual'`), 2, 'legacy date deletion must not delete manual snapshots');
  assert.equal(await value(db, `select count(*)::integer as value from public.sd_itinerary_daily_reports where workspace_id='${workspace}' and generated_by='scheduled'`), 0);
  const legacyManualOnlyPage = await value(db, `select public.sd_itinerary_daily_report_list('ship-dynamics','owner-1',1,30) as value`);
  assert.equal(legacyManualOnlyPage.total, 0);
  assert.deepEqual(legacyManualOnlyPage.reports, []);
  const legacyManualOnlyLocation = await value(db, `select public.sd_itinerary_daily_report_locate('ship-dynamics','${first.report.businessDate}'::date,'owner-1',30) as value`);
  assert.equal(legacyManualOnlyLocation.found, false);
  await db.exec(`update public.sd_actors set role='operator' where workspace_id='${workspace}' and user_id='owner-1'`);
  const demotedLegacyReplay = await value(db, `select public.delete_sd_itinerary_daily_reports('ship-dynamics','owner-1','${legacyDeleteOp}'::uuid,'${legacyPage.setToken}','["${first.report.businessDate}"]'::jsonb) as value`);
  assert.deepEqual(demotedLegacyReplay, legacyDeleted, 'legacy terminal delete must reconcile before current-role authorization');
  await db.exec(`update public.sd_actors set role='owner' where workspace_id='${workspace}' and user_id='owner-1'`);
  const deniedManualOnlyDelete = await value(db, `select public.delete_sd_itinerary_daily_reports('ship-dynamics','owner-1','91919191-9191-4191-8191-919191919191'::uuid,'${legacyManualOnlyPage.setToken}','["${first.report.businessDate}"]'::jsonb) as value`);
  assert.equal(deniedManualOnlyDelete.error, 'INVALID_PAYLOAD');
  assert.equal(await value(db, `select count(*)::integer as value from public.sd_itinerary_daily_reports where workspace_id='${workspace}' and generated_by='manual'`), 2);
  await value(db, `select public.sd_generate_daily_itinerary_report('${workspace}'::uuid,'${first.report.businessDate}'::date,clock_timestamp()) as value`);

  const beforeDelete = await value(db, `select public.sd_itinerary_daily_report_list_v2('ship-dynamics','owner-1',1,30) as value`);
  const deleteOp = '44444444-4444-4444-8444-444444444444';
  const deleted = await value(db, `select public.delete_sd_itinerary_daily_report_records('ship-dynamics','owner-1','${deleteOp}'::uuid,'${beforeDelete.setToken}','["${first.report.reportId}"]'::jsonb) as value`);
  assert.deepEqual(deleted.deletedReportIds, [first.report.reportId]);
  assert.equal(await value(db, `select count(*)::integer as value from public.sd_itinerary_daily_reports where workspace_id='${workspace}' and business_date='${first.report.businessDate}'`), 2);
  const deleteReplay = await value(db, `select public.delete_sd_itinerary_daily_report_records('ship-dynamics','owner-1','${deleteOp}'::uuid,'${beforeDelete.setToken}','["${first.report.reportId}"]'::jsonb) as value`);
  assert.deepEqual(deleteReplay, deleted);
  await db.exec(`update public.sd_actors set role='operator' where workspace_id='${workspace}' and user_id='owner-1'`);
  const demotedDeleteReplay = await value(db, `select public.delete_sd_itinerary_daily_report_records('ship-dynamics','owner-1','${deleteOp}'::uuid,'${beforeDelete.setToken}','["${first.report.reportId}"]'::jsonb) as value`);
  assert.deepEqual(demotedDeleteReplay, deleted, 'a committed delete receipt must reconcile before current-role authorization');
  const deletedSaveReplayAfterDemotion = await value(db, `select public.sd_save_manual_itinerary_report('ship-dynamics','owner-1','${ownerOp}'::uuid) as value`);
  assert.equal(deletedSaveReplayAfterDemotion.ok, true, 'a deleted snapshot must retain its terminal save receipt');
  assert.equal(deletedSaveReplayAfterDemotion.created, false);
  assert.equal(deletedSaveReplayAfterDemotion.report.reportId, first.report.reportId);
  const demotedNewDelete = await value(db, `select public.delete_sd_itinerary_daily_report_records('ship-dynamics','owner-1','99999999-9999-4999-8999-999999999999'::uuid,'${deleted.remainingSetToken}','["${admin.report.reportId}"]'::jsonb) as value`);
  assert.equal(demotedNewDelete.error, 'OWNER_REQUIRED', 'a demoted actor must not start a new delete');
  await db.exec(`update public.sd_actors set role='owner' where workspace_id='${workspace}' and user_id='owner-1'`);
  const deletedSaveReplayAsOwner = await value(db, `select public.sd_save_manual_itinerary_report('ship-dynamics','owner-1','${ownerOp}'::uuid) as value`);
  assert.equal(deletedSaveReplayAsOwner.created, false);
  assert.equal(deletedSaveReplayAsOwner.report.reportId, first.report.reportId);
  assert.equal(await value(db, `select count(*)::integer as value from public.sd_itinerary_daily_reports where operation_id='${ownerOp}'::uuid`), 0);
  assert.equal(await value(db, `select count(*)::integer as value from public.sd_itinerary_daily_report_operations where operation_id='${ownerOp}'::uuid and command_type='save_manual_itinerary_report' and status='COMMITTED'`), 1);

  const stale = await value(db, `select public.sd_itinerary_daily_report_list_v2('ship-dynamics','owner-1',1,30) as value`);
  await value(db, `select public.sd_save_manual_itinerary_report('ship-dynamics','owner-1','55555555-5555-4555-8555-555555555555'::uuid) as value`);
  const staleDelete = await value(db, `select public.delete_sd_itinerary_daily_report_records('ship-dynamics','owner-1','66666666-6666-4666-8666-666666666666'::uuid,'${stale.setToken}','["${admin.report.reportId}"]'::jsonb) as value`);
  assert.equal(staleDelete.error, 'REPORT_SET_CHANGED');

  await db.exec(`
    delete from public.sd_itinerary_daily_report_operations where workspace_id='${workspace}';
    delete from public.sd_itinerary_daily_reports where workspace_id='${workspace}';
    insert into public.sd_itinerary_daily_reports(
      workspace_id,business_date,timezone,generated_at,generated_by,generated_by_actor_id,operation_id,
      vessel_count,row_count,source_max_revision,snapshot
    )
    select '${workspace}'::uuid,date '2026-09-05'-day_offset,'Asia/Taipei',
      '2026-09-05T01:00:00Z'::timestamptz-day_offset*interval '1 day','scheduled',null,null,2,2,7,
      jsonb_build_object('schemaVersion',1,'businessDate',(date '2026-09-05'-day_offset)::text,'timezone','Asia/Taipei','generatedAt',('2026-09-05T01:00:00Z'::timestamptz-day_offset*interval '1 day'),'vesselCount',2,'rowCount',2,'sourceMaxRevision',7,'vessels','[]'::jsonb)
    from generate_series(0,30) day_offset;
    insert into public.sd_itinerary_daily_reports(
      workspace_id,business_date,timezone,generated_at,generated_by,generated_by_actor_id,operation_id,
      vessel_count,row_count,source_max_revision,snapshot
    ) values
      ('${workspace}','2026-09-05','Asia/Taipei','2026-09-05T02:00:00Z','manual','owner-1','77777777-7777-4777-8777-777777777777',2,2,7,'{"schemaVersion":1,"businessDate":"2026-09-05","timezone":"Asia/Taipei","generatedAt":"2026-09-05T02:00:00Z","vesselCount":2,"rowCount":2,"sourceMaxRevision":7,"vessels":[]}'),
      ('${workspace}','2026-09-05','Asia/Taipei','2026-09-05T03:00:00Z','manual','admin-1','88888888-8888-4888-8888-888888888888',2,2,7,'{"schemaVersion":1,"businessDate":"2026-09-05","timezone":"Asia/Taipei","generatedAt":"2026-09-05T03:00:00Z","vesselCount":2,"rowCount":2,"sourceMaxRevision":7,"vessels":[]}');
  `);
  const page1 = await value(db, `select public.sd_itinerary_daily_report_list_v2('ship-dynamics','owner-1',1,30) as value`);
  assert.equal(page1.pageSize, 30);
  assert.equal(page1.dateTotal, 31);
  assert.equal(page1.reportTotal, 33);
  assert.equal(page1.reports.length, 32, 'thirty dates may contain more than thirty snapshots');
  assert.equal(new Set(page1.reports.map(report => report.businessDate)).size, 30);
  assert.deepEqual(page1.reports.slice(0,3).map(report => report.generatedBy), ['manual','manual','scheduled']);
  const page2 = await value(db, `select public.sd_itinerary_daily_report_list_v2('ship-dynamics','owner-1',2,30) as value`);
  assert.equal(page2.reports.length, 1);
  assert.equal(page2.reports[0].businessDate, '2026-08-06');
  const located = await value(db, `select public.sd_itinerary_daily_report_locate_v2('ship-dynamics','2026-08-06','owner-1',30) as value`);
  assert.equal(located.page, 2);

  const manualSummary = page1.reports.find(report => report.generatedBy === 'manual');
  const loaded = await value(db, `select public.sd_itinerary_daily_report_load_by_id('ship-dynamics','${manualSummary.reportId}'::bigint,'owner-1') as value`);
  assert.equal(loaded.report.reportId, manualSummary.reportId);
  assert.equal(loaded.report.generatedBy, 'manual');

  assert.equal(await value(db, `select to_regprocedure('public.sd_itinerary_daily_report_load(text,date,text)') is not null as value`), true);
  const legacyLoad = await value(db, `select public.sd_itinerary_daily_report_load('ship-dynamics','2026-09-05','owner-1') as value`);
  assert.equal(legacyLoad.ok, true);
  assert.equal(legacyLoad.report.generatedBy, 'scheduled');

  const reportIdsBeforeCompositeReplay = (await db.query(`
    select report_id::text as report_id
    from public.sd_itinerary_daily_reports
    where workspace_id='${workspace}'
    order by report_id
  `)).rows.map(row => row.report_id);
  await db.exec(migration);
  await db.exec(compatibilityPatch);
  const reportIdsAfterCompositeReplay = (await db.query(`
    select report_id::text as report_id
    from public.sd_itinerary_daily_reports
    where workspace_id='${workspace}'
    order by report_id
  `)).rows.map(row => row.report_id);
  assert.deepEqual(reportIdsAfterCompositeReplay, reportIdsBeforeCompositeReplay, 'the composite rollout must be replay-safe on nonempty data');
  const replayedLegacyList = await value(db, `select public.sd_itinerary_daily_report_list('ship-dynamics','owner-1',1,30) as value`);
  assert.equal(replayedLegacyList.total, 31);
  assert.equal(replayedLegacyList.reports.length, 30);
  assert.equal(replayedLegacyList.reports.every(report => report.generatedBy === 'scheduled'), true);
  const unsafeAfterCompositeReplay = await value(db, `
    select count(*)::integer as value
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.prosecdef
      and procedure.proname in (${hardenedSecurityDefiners.map(name => `'${name}'`).join(',')})
      and not ('search_path=""' = any(coalesce(procedure.proconfig,array[]::text[])))
  `);
  assert.equal(unsafeAfterCompositeReplay, 0, 'the compatibility patch must restore empty search paths after a safe composite replay');
  const readback = await readFile(readbackPath, 'utf8');
  const readbackResult = await db.query(readback);
  assert.equal(readbackResult.rows.length, 1);
  assert.equal(Object.keys(readbackResult.rows[0]).length, 38);
  const failedReadbackChecks = Object.entries(readbackResult.rows[0]).filter(([,passed]) => passed !== true);
  assert.deepEqual(failedReadbackChecks, [], `readback checks failed: ${JSON.stringify(failedReadbackChecks)}`);
  assert.match(migration, /generated_by in \('scheduled', 'manual'\)/);
  assert.match(migration, /generated_by = 'scheduled'/);
  assert.doesNotMatch(migration, /alternative_plans_payload[\s\S]*sd_save_manual_itinerary_report/);
  console.log('manual_itinerary_daily_reports_db=PASS');
} finally {
  await db.close();
}

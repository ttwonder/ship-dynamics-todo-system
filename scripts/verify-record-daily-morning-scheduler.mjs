import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {createClient} from '@supabase/supabase-js';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {itineraryWorkspaceId} from './record-itinerary-local-fixture.mjs';
import {schedulerSql as sqlFile,capturedAt,legacyOwner} from './record-daily-morning-local-fixture.mjs';
let qa,vite,failure;const tests=[];
const check=async(name,fn)=>{await fn();tests.push(name);console.log('PASS '+name);};
try{
 qa=await createRecordStorageLocalQa({dailyMorning:true});const db=qa.db,key='isolated-record-ui-qa';
 vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const {upsertDailyMorningReport}=await vite.ssrLoadModule('/src/morningHistory.ts');
 const {buildCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudBlockPatch.ts');
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const run=(op,at=capturedAt,workspace=key)=>scalar('select run_ship_dynamics_record_daily_morning_v1($1,$2,$3::timestamptz)',[workspace,op,at]);
 const read=async()=> (await qa.read()).payload;
 const history=n=>scalar('select read_ship_dynamics_record_history_v1($1,$2)',[key,n]);
 const all=async()=>{const names=(await db.query("select tablename from pg_tables where schemaname='public' and (tablename like 'ship_dynamics_record%' or tablename like 'ship_dynamics_app_%' or tablename like 'sd_%') order by tablename")).rows;return Object.fromEntries(await Promise.all(names.map(async({tablename:t})=>[t,(await db.query(`select to_jsonb(x) value,xmin::text,ctid::text from ${t} x order by to_jsonb(x)::text`)).rows])));};
 const isolated=async fn=>{await db.exec('begin');try{return await fn();}finally{await db.exec('rollback');}};
 const versions=new Map(),remember=async()=>{const p=await read();versions.set(p.revision,p);return p;};
 const start=await remember(),before=await all();
 const schema=(await db.query("select table_name,column_name,data_type from information_schema.columns where table_schema='public' and ((table_name='sd_vessels' and column_name='id') or (table_name='sd_itinerary_documents' and column_name in ('vessel_id','revision'))) order by table_name,column_name")).rows;
 console.log('EFFECTIVE_SCHEMA',JSON.stringify(schema));
 assert.deepEqual(schema.map(x=>x.data_type),['bigint','text','text']);
 const legacy=await scalar('select sd_build_daily_morning_snapshot($1::uuid,$2::timestamptz)',[itineraryWorkspaceId,capturedAt]);
 assert.equal(legacy.itineraryProjections['qa-v1'].revision,7);
 assert.equal(legacy.itineraryProjections['qa-v1'].values.previousPortName,'QA FORMAL BUSAN');
 if(fs.existsSync(sqlFile))await db.exec(fs.readFileSync(sqlFile,'utf8'));
 let first;
 await check('explicit server entry uses record vessel/user and writes system audit, not legacy Owner/session',async()=>{
  first=await run('first');assert.equal(first.ok,true);const p=await remember(),report=p.agendaReports[0];
  assert.equal(report.snapshot.vessels[0].name,'QA VESSEL 1');assert.equal(report.createdBy,'qa-owner');
  assert.equal(p.auditLogs[0].actorRole,'system');assert.equal(p.auditLogs[0].actorName,'QA OWNER');assert.equal(p.auditLogs[0].entityId,report.id);
  assert.equal(p.revision,start.revision+1);assert.equal(p.agendaReports.length,1);assert.equal(p.auditLogs.length,1);
 });
 await check('effective legacy scheduler differential preserves schedule membership and all six formal pins',async()=>{
  const report=(await read()).agendaReports[0],snapshot=report.snapshot;
  for(const name of ['vessels','tasks','meetings'])assert.deepEqual(snapshot[name].map(x=>x.id),legacy[name].map(x=>x.id));
  assert.deepEqual(snapshot.tasks.map(x=>x.id),['future','linked','open','orphan-temporary']);
  assert.deepEqual(snapshot.meetings.map(x=>x.id),['meeting-inactive','meeting-on']);
  assert.deepEqual(snapshot.itineraryProjections,legacy.itineraryProjections);
  assert.deepEqual(snapshot.itineraryProjections['qa-v1'].values,{previousPortName:'QA FORMAL BUSAN',portDockName:'QA FORMAL KAOHSIUNG',etaUtc:'2026-09-07T00:00:00Z',etaTimeZone:'UTC+8',etbUtc:'2026-09-07T01:00:00Z',etbTimeZone:'UTC+9',etdUtc:'2026-09-07T10:00:00Z',etdTimeZone:'UTC-6',cargoQuantityText:'QA FORMAL CARGO 123 MT'});
  assert.deepEqual(snapshot.itineraryProjections['qa-v2'],{source:'legacy'});assert.equal(snapshot.itineraryProjections.inactive,undefined);
  assert.equal(snapshot.itineraryProjections['qa-v1'].rowId,'formal-row');assert.doesNotMatch(JSON.stringify(snapshot),/WRONG LATER|ALTERNATIVE MUST NOT PROJECT|INTERNAL CASE MUST NOT PROJECT/);
  // Invoke the actual final scheduler body; ONLY name and clock source are isolated.
  const definition=await scalar("select pg_get_functiondef('ship_dynamics_run_daily_morning_snapshots()'::regprocedure)");
  const clocked=definition.replace('ship_dynamics_run_daily_morning_snapshots()','qa_legacy_morning_clock()').replaceAll('clock_timestamp()',`'${capturedAt}'::timestamptz`);
  await isolated(async()=>{
   await db.exec(clocked);assert.equal(await scalar('select qa_legacy_morning_clock()'),1);
   const old=(await scalar('select payload from ship_dynamics_app_state where workspace_key=$1',[key])).agendaReports[0];
   assert.deepEqual(old.snapshot,legacy);assert.equal(old.taskCount,report.taskCount);assert.deepEqual(old.vesselIds,report.vesselIds);assert.equal(old.title,report.title);
   assert.equal(await scalar('select qa_legacy_morning_clock()'),1);assert.equal(await scalar('select version from sd_saved_reports where id=$1',[report.id]),2);
   await scalar('select sd_publish_daily_morning_to_legacy_read_model($1::uuid,$2::jsonb,$3::uuid,$4::timestamptz)',[itineraryWorkspaceId,JSON.stringify({...old,source:'manual',createdAt:'2026-09-07T00:30:00Z'}),legacyOwner,capturedAt]);
   assert.equal(await scalar('select qa_legacy_morning_clock()'),1);
   const overwritten=(await scalar('select payload from ship_dynamics_app_state where workspace_key=$1',[key])).agendaReports[0];
   assert.equal(overwritten.source,'manual');assert.deepEqual(overwritten.snapshot,legacy);
  });
 });
 await check('only report/audit rows and necessary root/orders/history/delta/receipt change',async()=>{
  const after=await all();for(const t of Object.keys(before).filter(t=>!t.startsWith('ship_dynamics_record')))assert.deepEqual(after[t],before[t],t);
  const untouched=rows=>rows.filter(r=>!['agendaReports','auditLogs'].includes(r.value.collection));
  assert.deepEqual(untouched(after.ship_dynamics_records),untouched(before.ship_dynamics_records));
  assert.deepEqual(untouched(after.ship_dynamics_record_collections),untouched(before.ship_dynamics_record_collections));
  for(const name of ['users','vessels','tasks','meetings','internalControlCases','notifications','taskDismissals','settings'])assert.deepEqual((await read())[name],start[name]);
 });
 await check('contradictory normalized task/meeting/active vessel cannot override new records on rerun',async()=>{
  await isolated(async()=>{
   await db.exec("update sd_tasks set description='LEGACY STALE',is_internal_control=true;update sd_meetings set include_in_morning=false;update sd_vessels set is_active=false;");
   const frozen=await qa.itinerarySnapshot();await run('contradictory');const snapshot=(await read()).agendaReports[0].snapshot;
   assert.deepEqual(snapshot.tasks,start.tasks.filter(t=>['future','linked','open','orphan-temporary'].includes(t.id)).sort((a,b)=>a.id.localeCompare(b.id)));
   assert.deepEqual(snapshot.meetings,start.meetings.filter(m=>['meeting-inactive','meeting-on'].includes(m.id)).sort((a,b)=>a.id.localeCompare(b.id)));
   assert.deepEqual(snapshot.itineraryProjections,legacy.itineraryProjections);assert.deepEqual(await qa.itinerarySnapshot(),frozen);
  });
 });
 await check('different operation reruns update one daily report and append one audit; exact lost ACK replay stays immutable',async()=>{
  const prior=await read();await run('rerun','2026-09-07T02:00:00Z');const p=await remember();
  assert.equal(p.agendaReports.length,1);assert.equal(p.auditLogs.length,prior.auditLogs.length+1);assert.equal(p.agendaReports[0].createdAt,prior.agendaReports[0].createdAt);
  const frozen=await all();assert.deepEqual(await run('first'),{...first,replayed:true});assert.deepEqual(await all(),frozen);
  await assert.rejects(()=>run('first','2026-09-07T02:00:00Z'),/operation-id-mismatch/);assert.deepEqual(await all(),frozen);
 });
 await check('manual cutoff/cases/frozen content stay distinct; schedule overwrites snapshot but preserves manual attribution',async()=>{
  const p=await read();const manual=upsertDailyMorningReport(p,{at:'2026-09-07T02:30:00Z',actorUserId:'qa-owner',source:'manual'});
  assert.equal(manual.status,'saved');assert.ok(manual.report.snapshot.internalControlCases.length);assert.ok(manual.report.snapshot.windowEndedAt);
  assert.ok(!manual.report.snapshot.tasks.some(t=>['future','orphan-temporary'].includes(t.id)));
  const patch=buildCloudBlockPatch(p,manual.data);
  const saved=await scalar("select apply_ship_dynamics_record_patch_v1($1,'manual-fixture',$2::jsonb,'QA OWNER','qa-owner',ship_dynamics_actor_guard($3::jsonb,'qa-owner'),null,'[]')",[key,JSON.stringify(patch),JSON.stringify(p)]);assert.equal(saved.ok,true);await remember();
  const refreshed=upsertDailyMorningReport({...manual.data,tasks:[]},{at:'2026-09-07T03:00:00Z',actorUserId:'qa-owner',source:'manual'});
  assert.deepEqual(refreshed.report.snapshot.tasks,manual.report.snapshot.tasks);assert.equal(refreshed.report.snapshot.windowEndedAt,manual.report.snapshot.windowEndedAt);
  await run('after-manual','2026-09-07T03:00:00Z');const next=await remember(),scheduled=next.agendaReports[0];
  assert.equal(scheduled.source,'manual');assert.equal(scheduled.createdAt,manual.report.createdAt);assert.equal(scheduled.createdBy,manual.report.createdBy);
  assert.equal(scheduled.snapshot.windowEndedAt,undefined);assert.equal(scheduled.snapshot.internalControlCases,undefined);
  assert.deepEqual(scheduled.snapshot.tasks.map(t=>t.id),['future','linked','open','orphan-temporary']);
 });
 await check('Taipei Sunday/Monday and Friday/Saturday boundaries plus weekday 09:00 preserve original date gate',async()=>{
  for(const [at,status,date] of [['2026-09-06T15:59:59Z','not-business-day',null],['2026-09-06T16:00:00Z','committed','2026-09-07'],['2026-09-07T01:00:00Z','committed','2026-09-07'],['2026-09-11T15:59:59Z','committed','2026-09-11'],['2026-09-11T16:00:00Z','not-business-day',null]])await isolated(async()=>{const frozen=await all();const result=await run('boundary',at);assert.equal(result.status,status);if(date)assert.equal((await read()).agendaReports[0].businessDate,date);else assert.deepEqual(await all(),frozen);});
 });
 await check('missing/inactive record owner never borrows legacy membership Owner and skipped jobs write nothing',async()=>{
  for(const kind of ['inactive','missing'])await isolated(async()=>{
   await db.exec(kind==='inactive'?"update ship_dynamics_records set value=jsonb_set(value,'{isActive}','false') where collection='users'":"delete from ship_dynamics_records where collection='users'");
   const frozen=await all();assert.equal((await run('owner-'+kind)).status,'no-active-owner');assert.deepEqual(await all(),frozen);
   assert.deepEqual(await run('first'),{...first,replayed:true});
  });
 });
 await check('unknown workspace/invalid clock/mismatched operation fail with no implicit enrolment or fallback',async()=>{
  const frozen=await all();await assert.rejects(()=>run('first',capturedAt,'missing'),/record-workspace-not-found/);
  await assert.rejects(()=>run('',capturedAt),/invalid-scheduler-request/);await assert.rejects(()=>run('bad',null),/invalid-scheduler-request/);await assert.rejects(()=>run('bad','infinity'),/invalid-scheduler-request/);
  assert.deepEqual(await all(),frozen);
 });
 await check('receipt-last injected failure observes new history/delta/audit then rolls back EVERY table',async()=>{
  await db.exec(`create function qa_fail_scheduler_receipt() returns trigger language plpgsql as $$begin
    if new.operation_id='record-daily-morning-scheduler:fail-last' then
      if not exists(select 1 from ship_dynamics_record_versions where workspace_key=new.workspace_key and revision=(new.result->>'revision')::int)
        or not exists(select 1 from ship_dynamics_record_history where workspace_key=new.workspace_key and valid_to_revision=(new.result->>'revision')::int)
        or not exists(select 1 from ship_dynamics_record_read_bases where workspace_key=new.workspace_key and revision=(new.result->>'revision')::int-1)
        or not exists(select 1 from ship_dynamics_records where workspace_key=new.workspace_key and collection='auditLogs' and revision=(new.result->>'revision')::int)
      then raise exception 'injection-preconditions-missing';end if;raise exception 'qa-fail-after-history-delta-audit';end if;return new;end;$$;
    create trigger qa_fail_scheduler_receipt before insert on ship_dynamics_record_receipts for each row execute function qa_fail_scheduler_receipt();`);
  const frozen=await all();await assert.rejects(()=>run('fail-last'),/qa-fail-after-history-delta-audit/);assert.deepEqual(await all(),frozen);
  await db.exec('drop trigger qa_fail_scheduler_receipt on ship_dynamics_record_receipts;drop function qa_fail_scheduler_receipt();');
 });
 await check('all committed history versions reconstruct exact bytes; delta returns only report/audit changes',async()=>{
  for(const [revision,payload] of versions)assert.deepEqual((await history(revision)).payload,payload);
  assert.equal(await scalar('select count(*)::integer from ship_dynamics_record_versions where workspace_key=$1',[key]),versions.size);
  const base=await scalar('select token from ship_dynamics_record_read_bases where workspace_key=$1 and revision=$2',[key,start.revision]);
  const delta=await scalar('select read_ship_dynamics_record_delta_v1($1,$2,$3)',[key,start.revision,base]);
  assert.equal(delta.status,'delta');assert.deepEqual(delta.collections.map(c=>c.collection).sort(),['agendaReports','auditLogs']);
  assert.deepEqual(delta.collections.find(c=>c.collection==='agendaReports').upserts,(await read()).agendaReports);
 });
 await check('private invoker functions/ACL role denial and additive DDL rerun leave data unchanged',async()=>{
  const names=['run_ship_dynamics_record_daily_morning_v1','build_ship_dynamics_record_daily_morning_v1','ship_dynamics_record_commit_validated_v1'];
  const procs=(await db.query('select proname,prosecdef,proconfig,proacl::text from pg_proc where proname=any($1::text[])',[names])).rows;
  assert.equal(procs.length,3);for(const p of procs){assert.equal(p.prosecdef,false);assert.deepEqual(p.proconfig,['search_path=pg_catalog, public']);assert.ok(!/(^|,)=(X|[^,]*X)/.test(p.proacl));}
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);try{await assert.rejects(()=>run('acl'),/permission denied/);await assert.rejects(()=>scalar('select build_ship_dynamics_record_daily_morning_v1($1,$2::timestamptz)',[key,capturedAt]),/permission denied/);await assert.rejects(()=>scalar("select ship_dynamics_record_commit_validated_v1($1,'[]','{}','{}','system','acl','[]')",[key]),/permission denied/);}finally{await db.exec('reset role');}}
  const frozen=await all();await db.exec(fs.readFileSync(sqlFile,'utf8'));await db.exec(fs.readFileSync('supabase/development/20260906_appdata_record_store.sql','utf8'));assert.deepEqual(await all(),frozen);
 });
 await check('real Supabase JS over loopback reads SQL snapshot/delta; server job is not an HTTP browser RPC',async()=>{
  const client=createClient(qa.origin,'isolated-test',{auth:{persistSession:false}});
  const result=await client.rpc('read_ship_dynamics_record_delta_v1',{p_workspace_key:key,p_base_revision:null,p_base_token:null});assert.equal(result.error,null);assert.deepEqual(result.data.payload,await read());
  const frozen=await all();const denied=await client.rpc('run_ship_dynamics_record_daily_morning_v1',{p_workspace_key:key,p_operation_id:'not-browser',p_captured_at:capturedAt});assert.equal(denied.error.code,'PGRST202');assert.deepEqual(await all(),frozen);
 });
 if(process.argv.includes('--probe-failure-exit'))throw new Error('deliberate failure-exit sentinel');
 const receipt={scheduler:'PASS',count:tests.length,tests,historyVersions:[...versions.keys()],schema,limitations:['owner PGlite; not hosted ACL/PostgREST/cron/multiconnection/Realtime','fixed-clock legacy oracle changes only function name and clock source','raw records preserve fields omitted by old normalized projection; manual and schedule differ intentionally']};
 if(process.env.QA_EVIDENCE_ROOT)fs.writeFileSync(path.join(process.env.QA_EVIDENCE_ROOT,'scheduler-results.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt));
}catch(error){failure=error;console.error({message:error.message,code:error.code,stack:error.stack});}
finally{if(vite)await vite.close();if(qa)await qa.close();if(failure)process.exitCode=1;}

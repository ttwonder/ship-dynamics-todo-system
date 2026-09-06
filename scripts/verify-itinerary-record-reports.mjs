import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'vite';
import {createClient} from '@supabase/supabase-js';
import {installItineraryFixture,seedItineraryFixture,recordItinerarySql,itineraryWorkspaceId,snapshotItineraryAuthority} from './record-itinerary-local-fixture.mjs';
const reportSql='supabase/development/20260906_itinerary_record_reports.sql';
const db=new PGlite(),tests=[];let vite,failure;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const check=async(layer,name,fn)=>{await fn();tests.push({layer,name});console.log(`PASS ${layer}: ${name}`);};
const key='record-report-qa',user='report-owner';
try {
 await db.exec('create role anon;create role authenticated;');
 for(const path of ['supabase/schema.sql','supabase/development/20260906_appdata_record_store.sql'])await db.exec(fs.readFileSync(path,'utf8'));
 await installItineraryFixture(db);
 vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');const data=createInitialData();
 data.users=[{id:user,name:'Record author',username:'record',department:'QA',role:'owner',isActive:true}];
 data.vessels=[{id:'v1',name:'Record One',isActive:true},{id:'v2',name:'Record Two',isActive:true}];
 await scalar('select import_ship_dynamics_records_v1($1,$2::jsonb)',[key,JSON.stringify(data)]);
 await db.query('insert into ship_dynamics_app_state(workspace_key,revision,payload) values($1,99,$2::jsonb)',[key,JSON.stringify({...data,users:[{...data.users[0],role:'vessel'}]})]);
 const formal=await seedItineraryFixture(db,vite,key,data.vessels);
 console.log('MOUNTED TYPES',JSON.stringify((await db.query("select table_name,column_name,data_type from information_schema.columns where table_name in ('sd_itinerary_documents','sd_vessels') and column_name in ('vessel_id','id') order by table_name,column_name")).rows));
 const legacySnapshot=await scalar('select sd_build_daily_itinerary_report_snapshot($1,current_date,now())',[itineraryWorkspaceId]);
 assert.deepEqual(legacySnapshot.vessels.find(v=>v.vesselId==='v1').rows,formal.rows);console.log('TRACER existing mounted builder resolves exact text document ID');
 for(const path of ['supabase/migrations/20260905200000_manual_itinerary_daily_reports.sql','supabase/migrations/20260905210000_manual_itinerary_legacy_compatibility.sql',recordItinerarySql])await db.exec(fs.readFileSync(path,'utf8'));
 if(fs.existsSync(reportSql))await db.exec(fs.readFileSync(reportSql,'utf8'));
 await check('SQL','record Owner manual save pins formal revision and load-by-ID returns same immutable main rows',async()=>{
  const result=await scalar('select sd_itinerary_record_report_save_manual_v1($1,$2,$3::uuid)',[key,user,randomUUID()]);
  assert.equal(result.ok,true);assert.equal(result.report.generatedByActorId,user);assert.equal(result.report.sourceMaxRevision,7);
  const loaded=await scalar('select sd_itinerary_record_report_load_v1($1,$2::bigint,$3)',[key,result.report.reportId,user]);
  assert.equal(loaded.ok,true);assert.deepEqual(loaded.report.snapshot.vessels.find(v=>v.vesselId==='v1').rows,formal.rows);
  assert.equal(JSON.stringify(loaded).includes('QA ALTERNATIVE MUST NOT PROJECT'),false);
 });

 const save=async(actor=user,operation=randomUUID())=>scalar('select sd_itinerary_record_report_save_manual_v1($1,$2,$3::uuid)',[key,actor,operation]);
 const list=async(page=1,actor=user)=>scalar('select sd_itinerary_record_report_list_v1($1,$2,$3::integer,30)',[key,actor,page]);
 const locate=async(date,actor=user)=>scalar('select sd_itinerary_record_report_locate_v1($1,$2::date,$3,30)',[key,date,actor]);
 const load=async(id,actor=user)=>scalar('select sd_itinerary_record_report_load_v1($1,$2::bigint,$3)',[key,id,actor]);
 const del=async(ids,token,operation=randomUUID(),actor=user)=>scalar('select sd_itinerary_record_report_delete_ids_v1($1,$2,$3::uuid,$4,$5::jsonb)',[key,actor,operation,token,JSON.stringify(ids)]);
 const dates=async(ds,token,operation=randomUUID(),actor=user)=>scalar('select sd_itinerary_record_report_delete_dates_v1($1,$2,$3::uuid,$4,$5::jsonb)',[key,actor,operation,token,JSON.stringify(ds)]);
 await check('SQL','same-day manuals coexist with scheduled; list locate load and exact-ID/delete-date use shared store',async()=>{
  const saved=await save(),date=saved.report.businessDate;
  const scheduled=await scalar('select sd_generate_daily_itinerary_report($1,$2::date,now())',[itineraryWorkspaceId,date]);
  const page=await list();assert.equal(page.ok,true);assert.equal(page.reports.filter(r=>r.businessDate===date).length,3);
  const scheduledId=page.reports.find(r=>r.businessDate===date&&r.generatedBy==='scheduled')?.reportId;
  assert.equal(typeof scheduledId,'string');assert.equal(scheduled.ok,true);
  assert.equal((await locate(date)).page,1);assert.equal((await load(saved.report.reportId)).report.reportId,saved.report.reportId);
  assert.equal((await del([saved.report.reportId],page.setToken)).deletedCount,1);
  const before=await list();assert.equal((await dates([date],before.setToken)).deletedCount,1);
  const after=await list();assert.ok(after.reports.some(r=>r.businessDate===date&&r.generatedBy==='manual'));assert.ok(!after.reports.some(r=>r.reportId===scheduledId));
 });

 const adapter=await vite.ssrLoadModule('/src/itineraryDailyReports.ts');
 const config={supabaseUrl:'http://127.0.0.1:1',supabaseAnonKey:'local-key',workspaceKey:key,tableName:'ship_dynamics_app_state',storageMode:'records-v1'};
 const argsByName={
  sd_itinerary_record_report_save_manual_v1:['p_workspace_key','p_actor_user_id','p_operation_id:uuid'],
  sd_itinerary_record_report_list_v1:['p_workspace_key','p_actor_user_id','p_page:integer','p_page_size:integer'],
  sd_itinerary_record_report_locate_v1:['p_workspace_key','p_business_date:date','p_actor_user_id','p_page_size:integer'],
  sd_itinerary_record_report_load_v1:['p_workspace_key','p_report_id:bigint','p_actor_user_id'],
  sd_itinerary_record_report_delete_ids_v1:['p_workspace_key','p_actor_user_id','p_operation_id:uuid','p_expected_set_token','p_delete_report_ids:jsonb'],
  sd_itinerary_record_report_delete_dates_v1:['p_workspace_key','p_actor_user_id','p_operation_id:uuid','p_expected_set_token','p_delete_dates:jsonb'],
 };
 const calls=[];let dropAck=false,missing=false;
 const client=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,init)=>{
  const name=new URL(url).pathname.split('/').pop(),params=JSON.parse(init.body);calls.push({name,params});const args=argsByName[name];
  if(missing||!args)return new Response(JSON.stringify({code:'PGRST202',message:'No such local RPC'}),{status:404});
  try{const value=await scalar(`select ${name}(${args.map((a,i)=>`$${i+1}::${a.split(':')[1]||'text'}`).join(',')})`,args.map(a=>{const[k,t]=a.split(':');return t==='jsonb'?JSON.stringify(params[k]):params[k];}));
   if(dropAck){dropAck=false;return new Response(JSON.stringify({code:'QA_LOST_ACK',message:'actual SQL committed; ACK discarded'}),{status:503});}
   return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
  }catch(e){return new Response(JSON.stringify({code:e.code,message:e.message}),{status:400});}
 }}});
 await check('SupabaseJS→SQL','original public adapter selects records manual/list/locate/load/ID-delete/date-reconcile explicitly',async()=>{
  const pending=adapter.createPendingManualItineraryReportSave({actorUserId:user,operationId:randomUUID()},config);
  const saved=await adapter.saveManualItineraryDailyReport(pending,config,client);
  assert.equal(saved.created,true);const page=await adapter.listItineraryDailyReportPage(user,1,config,client);
  assert.ok(page.items.some(r=>r.reportId===saved.report.reportId));
  assert.equal((await adapter.locateItineraryDailyReport(saved.report.businessDate,user,config,client)).page,1);
  assert.deepEqual((await adapter.loadItineraryDailyReport(saved.report.reportId,user,config,client)).snapshot.vessels.find(v=>v.vesselId==='v1').rows,formal.rows);
  const deletion=adapter.createPendingItineraryDailyReportDelete({actorUserId:user,operationId:randomUUID(),expectedSetToken:page.setToken,deleteReportIds:[saved.report.reportId]},config);
  assert.equal((await adapter.deleteItineraryDailyReports(deletion,config,client)).deletedCount,1);
  const before=await list(),scheduled=before.reports.find(r=>r.generatedBy==='scheduled');assert.ok(scheduled);
  const old={...pending,version:2,operationId:randomUUID(),expectedSetToken:before.setToken,deleteDates:[scheduled.businessDate]};
  assert.equal((await adapter.reconcileLegacyItineraryDailyReportDelete(old,config,client)).deletedCount,1);
  assert.deepEqual([...new Set(calls.map(c=>c.name))].sort(),Object.keys(argsByName).sort());
 });
 await check('adapter','durable pending separates record authority while preserving pre-record legacy recovery',async()=>{
  const mem=new Map(),storage={getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k)};
  const legacy={...config,storageMode:'legacy'},p=adapter.createPendingManualItineraryReportSave({actorUserId:user,operationId:randomUUID()},legacy);
  adapter.writePendingManualItineraryReportSave(p,legacy,storage);
  assert.equal(p.configIdentity,`${new URL(config.supabaseUrl).origin}|${key}|${config.tableName}`,'pre-record identity stays compatible only in legacy mode');
  assert.equal(adapter.readPendingManualItineraryReportSave(config,user,storage),null,'legacy intent must not become a record-authorized command');
  const before=calls.length;await assert.rejects(()=>adapter.saveManualItineraryDailyReport(p,config,client),e=>e.code==='MANUAL_SAVE_CONTEXT_CHANGED');assert.equal(calls.length,before);
  const record=adapter.createPendingManualItineraryReportSave({actorUserId:user,operationId:randomUUID()},config);adapter.writePendingManualItineraryReportSave(record,config,storage);
  assert.equal(adapter.readPendingManualItineraryReportSave(config,user,storage).operationId,record.operationId);
  assert.equal(adapter.readPendingManualItineraryReportSave(legacy,user,storage).operationId,p.operationId);
  assert.equal(adapter.readPendingManualItineraryReportSave(config,'other-actor',storage),null);
  const rotated={...config,supabaseAnonKey:'rotated-key'};
  assert.notEqual(adapter.getItineraryDailyReportCloudIdentity(config),adapter.getItineraryDailyReportCloudIdentity(rotated));
  assert.equal(adapter.readPendingManualItineraryReportSave(rotated,user,storage).operationId,record.operationId,'same-authority key rotation preserves explicit durable recovery');
  const deletion=adapter.createPendingItineraryDailyReportDelete({actorUserId:user,operationId:randomUUID(),expectedSetToken:'a'.repeat(32),deleteReportIds:['9007199254740993']},legacy);
  adapter.writePendingItineraryDailyReportDelete(deletion,legacy,storage);assert.equal(adapter.readPendingItineraryDailyReportDelete(config,user,storage),null);
  const dateEnvelope={...deletion,version:2,deleteDates:['2026-09-06']};storage.setItem(`ship-dynamics-daily-itinerary-report-delete:v2:${encodeURIComponent(deletion.configIdentity)}:${encodeURIComponent(user)}`,JSON.stringify(dateEnvelope));
  assert.equal(adapter.readPendingLegacyItineraryDailyReportDelete(legacy,user,storage).operationId,dateEnvelope.operationId);assert.equal(adapter.readPendingLegacyItineraryDailyReportDelete(config,user,storage),null);
  const requests=calls.length;for(const [fn,env] of [[adapter.deleteItineraryDailyReports,deletion],[adapter.reconcileLegacyItineraryDailyReportDelete,dateEnvelope]])await assert.rejects(()=>fn(env,config,client),e=>e.code==='DELETE_CONTEXT_CHANGED');assert.equal(calls.length,requests);
  for(const invalid of ['01',' 1','+1','1.0','9223372036854775808',9007199254740992])await assert.rejects(()=>adapter.loadItineraryDailyReport(invalid,user,config,client));assert.equal(calls.length,requests,'invalid IDs never normalize into a real network lookup');
 });
 await check('adapter','six legacy routes stay unchanged; each missing record capability fails closed with exactly one request',async()=>{
  const exercise=async(c,transport)=>{
   const p=adapter.createPendingManualItineraryReportSave({actorUserId:user,operationId:randomUUID()},c);
   const d=adapter.createPendingItineraryDailyReportDelete({actorUserId:user,operationId:randomUUID(),expectedSetToken:'a'.repeat(32),deleteReportIds:['9007199254740993']},c);
   for(const fn of [()=>adapter.saveManualItineraryDailyReport(p,c,transport),()=>adapter.listItineraryDailyReportPage(user,1,c,transport),()=>adapter.locateItineraryDailyReport('2026-09-06',user,c,transport),()=>adapter.loadItineraryDailyReport('9007199254740993',user,c,transport),()=>adapter.deleteItineraryDailyReports(d,c,transport),()=>adapter.reconcileLegacyItineraryDailyReportDelete({...p,version:2,deleteDates:['2026-09-06'],expectedSetToken:'a'.repeat(32)},c,transport)])await assert.rejects(fn,e=>e.code==='DAILY_ITINERARY_REPORTS_SQL_NOT_DEPLOYED');
  };
  const legacyCalls=[];await exercise({...config,storageMode:'legacy'},{rpc:async name=>{legacyCalls.push(name);return {data:null,error:{code:'PGRST202'}};}});
  assert.deepEqual(legacyCalls,['sd_save_manual_itinerary_report','sd_itinerary_daily_report_list_v2','sd_itinerary_daily_report_locate_v2','sd_itinerary_daily_report_load_by_id','delete_sd_itinerary_daily_report_records','delete_sd_itinerary_daily_reports']);
  const at=calls.length;missing=true;try{await exercise(config,client);}finally{missing=false;}
  assert.deepEqual(calls.slice(at).map(c=>c.name),Object.keys(argsByName));
 });
 await check('SupabaseJS→SQL','lost ACK on manual and both deletions replays identical operations without another snapshot or ledger row',async()=>{
  const mem=new Map(),storage={getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k)};
  const p=adapter.createPendingManualItineraryReportSave({actorUserId:user,operationId:randomUUID()},config);adapter.writePendingManualItineraryReportSave(p,config,storage);
  dropAck=true;await assert.rejects(()=>adapter.saveManualItineraryDailyReport(p,config,client),e=>e.code==='QA_LOST_ACK'&&!e.definitive);
  const before=await scalar('select count(*)::int from sd_itinerary_daily_reports');const replay=await adapter.saveManualItineraryDailyReport(adapter.readPendingManualItineraryReportSave(config,user,storage),config,client);assert.equal(replay.created,false);assert.equal(await scalar('select count(*)::int from sd_itinerary_daily_reports'),before);
  for(const byDate of [false,true]){
   const s=await save();await scalar('select sd_generate_daily_itinerary_report($1,$2::date,now())',[itineraryWorkspaceId,s.report.businessDate]);
   const d=adapter.createPendingItineraryDailyReportDelete({actorUserId:user,operationId:randomUUID(),expectedSetToken:(await list()).setToken,deleteReportIds:[s.report.reportId]},config);
   const envelope=byDate?{...d,version:2,deleteDates:[s.report.businessDate]}:d,fn=byDate?adapter.reconcileLegacyItineraryDailyReportDelete:adapter.deleteItineraryDailyReports;
   const at=calls.length;dropAck=true;await assert.rejects(()=>fn(envelope,config,client),e=>e.code==='QA_LOST_ACK'&&!e.definitive);
   const count=await scalar('select count(*)::int from sd_itinerary_daily_reports');assert.equal((await fn(envelope,config,client)).deletedCount,1);assert.equal(await scalar('select count(*)::int from sd_itinerary_daily_reports'),count);
   assert.deepEqual(calls[at],calls[at+1]);assert.equal(await scalar('select count(*)::int from sd_itinerary_daily_report_operations where operation_id=$1::uuid',[envelope.operationId]),1);
  }
 });
 const recordRole=async(role,active=true)=>db.query("update ship_dynamics_records set value=jsonb_set(jsonb_set(value,'{role}',to_jsonb($3::text)),'{isActive}',to_jsonb($4::boolean)) where workspace_key=$1 and collection='users' and entity_id=$2",[key,user,role,active]);
 const reportState=async()=>({reports:(await db.query('select to_jsonb(t) v from sd_itinerary_daily_reports t order by report_id')).rows,ops:(await db.query('select to_jsonb(t) v from sd_itinerary_daily_report_operations t order by operation_id')).rows});
 const preserved=async()=>{const snap=await snapshotItineraryAuthority(db);delete snap.sd_itinerary_daily_reports;delete snap.sd_itinerary_daily_report_operations;return snap;};
 const untouched=await preserved();
 await check('SQL','all four record roles read; only Owner/Admin save and only Owner deletes despite contradictory legacy role',async()=>{
  const keep=(await save()).report;
  for(const role of ['owner','admin','operator','vessel']){
   await recordRole(role);assert.equal((await list()).ok,true);assert.equal((await locate(keep.businessDate)).found,true);assert.equal((await load(keep.reportId)).ok,true);
   const s=await save();assert.equal(s.ok,['owner','admin'].includes(role));if(!s.ok)assert.equal(s.error,'OWNER_OR_ADMIN_REQUIRED');
   if(role!=='owner'){
    const token=(await list()).setToken;
    assert.equal((await del([keep.reportId],token)).error,'OWNER_REQUIRED');assert.equal((await dates([keep.businessDate],token)).error,'OWNER_REQUIRED');
   }
  }
  await recordRole('owner');
  assert.equal((await scalar('select sd_itinerary_main_actor($1,$2)',[key,user])).role,'vessel');
  assert.equal((await save()).ok,true);
 });
 await check('SQL','missing/inactive/invalid record actor cannot use legacy Owner or committed receipts across six RPCs',async()=>{
  const op=randomUUID(),saved=await save(user,op),token=(await list()).setToken;
  await db.query("update ship_dynamics_app_state set payload=jsonb_set(payload,'{users,0,role}','\"owner\"'::jsonb) where workspace_key=$1",[key]);
  for(const [role,active,actor] of [['owner',false,user],['invalid',true,user],['owner',true,'missing-user']]){
   await recordRole(role,active);
   for(const fn of [()=>save(actor,op),()=>list(1,actor),()=>locate(saved.report.businessDate,actor),()=>load(saved.report.reportId,actor),()=>del([saved.report.reportId],token,randomUUID(),actor),()=>dates([saved.report.businessDate],token,randomUUID(),actor)])await assert.rejects(fn,e=>e.code==='P0001'&&e.message==='not-authorized');
  }
  await recordRole('owner');await db.query("update ship_dynamics_app_state set payload=jsonb_set(payload,'{users,0,role}','\"vessel\"'::jsonb) where workspace_key=$1",[key]);
 });
 await check('SQL','manual receipt replay precedes active role check and rejects command/actor mismatch without duplicate capture',async()=>{
  const op=randomUUID(),first=await save(user,op),before=await reportState();await recordRole('vessel');
  assert.deepEqual(await save(user,op),{...first,created:false});assert.deepEqual(await reportState(),before);assert.equal((await save()).error,'OWNER_OR_ADMIN_REQUIRED');await recordRole('owner');
  assert.equal((await del([first.report.reportId],(await list()).setToken,op)).error,'IDEMPOTENCY_MISMATCH');
  await db.query("update sd_itinerary_daily_report_operations set actor_user_id='different-actor' where operation_id=$1::uuid",[op]);assert.equal((await save(user,op)).error,'OPERATION_ID_REUSED');
 });
 await check('SQL','exact ID and scheduled-date delete replay, payload mismatch and durable CAS rejection leave other snapshots intact',async()=>{
  for(const byDate of [false,true]){
   const s=await save(),date=s.report.businessDate;
   await scalar('select sd_generate_daily_itinerary_report($1,$2::date,now())',[itineraryWorkspaceId,date]);
   const token=(await list()).setToken,op=randomUUID(),values=byDate?[date]:[s.report.reportId],fn=byDate?dates:del;
   const first=await fn(values,token,op);assert.equal(first.ok,true);const before=await reportState();
   await recordRole('vessel');assert.deepEqual(await fn(values,token,op),first);assert.deepEqual(await reportState(),before);await recordRole('owner');
   assert.equal((await fn(values,'0'.repeat(32),op)).error,'IDEMPOTENCY_MISMATCH');
   const newer=await save(),staleOp=randomUUID(),staleToken=(await list()).setToken;await save();
   const target=byDate?[newer.report.businessDate]:[newer.report.reportId];const rejected=await fn(target,staleToken,staleOp);assert.equal(rejected.error,'REPORT_SET_CHANGED');assert.deepEqual(await fn(target,staleToken,staleOp),rejected);
   assert.equal((await load(newer.report.reportId)).ok,true);
  }
 });
 await check('SQL','distinct-date pagination keeps same-day captures together and locates page two and absent dates',async()=>{
  for(let i=0;i<35;i++)await scalar("select sd_generate_daily_itinerary_report($1,date '2025-01-01'+$2::integer,now())",[itineraryWorkspaceId,i]);
  const first=await list(1),second=await list(2);assert.equal(first.pageCount,2);assert.equal(new Set(first.reports.map(r=>r.businessDate)).size,30);assert.ok(second.reports.length);
  const all=[...first.reports,...second.reports];assert.equal(all.length,first.reportTotal);assert.equal(new Set(all.map(r=>r.reportId)).size,all.length);assert.equal(new Set(all.map(r=>r.businessDate)).size,first.dateTotal);
  assert.equal((await locate(second.reports[0].businessDate)).page,2);assert.equal((await locate('1900-01-01')).found,false);
 });
 await check('SQL','strict bigint strings, illegal IDs/dates and 100 versus 101 batch boundary preserve exact targets',async()=>{
  const token=(await list()).setToken;
  for(const ids of [[1],['01'],[' 1'],['+1'],['1.0'],['9223372036854775808'],['1','1'],[]])assert.equal((await del(ids,token)).error,'INVALID_PAYLOAD');
  for(const ds of [['2026-02-30'],['2026-9-01'],['2026-09-01','2026-09-01'],[]])assert.equal((await dates(ds,token)).error,'INVALID_PAYLOAD');
  await scalar("select setval(pg_get_serial_sequence('sd_itinerary_daily_reports','report_id'),9007199254740992,true)");
  const huge=await save();assert.equal(huge.report.reportId,'9007199254740993');assert.equal((await load(huge.report.reportId)).report.reportId,huge.report.reportId);
  const all=[];for(let i=0;i<101;i++){const date=new Date(Date.UTC(2024,0,i+1)).toISOString().slice(0,10);all.push(date);await scalar('select sd_generate_daily_itinerary_report($1,$2::date,now())',[itineraryWorkspaceId,date]);}
  const ids=(await db.query("select report_id::text id from sd_itinerary_daily_reports where business_date between '2024-01-01' and '2024-04-10' order by business_date")).rows.map(r=>r.id);assert.equal(ids.length,101);
  const before=await reportState(),current=(await list()).setToken;assert.equal((await del(ids,current)).error,'BATCH_LIMIT_EXCEEDED');assert.equal((await dates(all,current)).error,'BATCH_LIMIT_EXCEEDED');assert.deepEqual(await reportState(),before);
  assert.equal((await del(ids.slice(0,100),current)).deletedCount,100);assert.equal((await load(ids[100])).ok,true);assert.equal((await load(huge.report.reportId)).ok,true);
  for(const date of all.slice(0,100))await scalar('select sd_generate_daily_itinerary_report($1,$2::date,now())',[itineraryWorkspaceId,date]);
  assert.equal((await dates(all.slice(0,100),(await list()).setToken)).deletedCount,100);assert.equal((await load(ids[100])).ok,true);
 });
 await check('SQL','manual and both deletes roll back report plus ledger when the final receipt update raises',async()=>{
  const s=await save(),date=s.report.businessDate;await scalar('select sd_generate_daily_itinerary_report($1,$2::date,now())',[itineraryWorkspaceId,date]);
  await db.exec("create function qa_report_fail() returns trigger language plpgsql as $$begin if new.status='COMMITTED' then raise exception 'QA_FINAL_REPORT_RECEIPT';end if;return new;end;$$;create trigger qa_report_fail before update on sd_itinerary_daily_report_operations for each row execute function qa_report_fail();");
  try{for(const fn of [()=>save(),async()=>del([s.report.reportId],(await list()).setToken),async()=>dates([date],(await list()).setToken)]){const before=await reportState();await assert.rejects(fn,/QA_FINAL_REPORT_RECEIPT/);assert.deepEqual(await reportState(),before);}}finally{await db.exec('drop trigger qa_report_fail on sd_itinerary_daily_report_operations;drop function qa_report_fail();');}
 });
 await check('SQL','read/save/delete do not alter formal documents, alternative rows, formal history, leases or legacy payload',async()=>{
  const after=await preserved();
  // Earlier actor-conflict fixture updated the legacy role then restored it; compare value there, raw MVCC elsewhere.
  after.ship_dynamics_app_state=after.ship_dynamics_app_state.map(r=>r.value);const expected=structuredClone(untouched);expected.ship_dynamics_app_state=expected.ship_dynamics_app_state.map(r=>r.value);
  assert.deepEqual(after,expected);
  const s=await save(),before=(await load(s.report.reportId)).report;
  await db.exec("begin;update sd_itinerary_documents set revision=8,rows_payload=jsonb_set(rows_payload,'{0,portDockName}','\"NEW FORMAL\"'::jsonb) where vessel_id='v1';");
  try{assert.deepEqual((await load(s.report.reportId)).report,before);const fresh=await save();assert.equal(fresh.report.sourceMaxRevision,8);assert.equal((await load(fresh.report.reportId)).report.snapshot.vessels.find(v=>v.vesselId==='v1').rows[0].portDockName,'NEW FORMAL');}finally{await db.exec('rollback;');}
 });
 await check('SQL','UUID membership Owner cannot rescue an inactive or missing mapped record actor',async()=>{
  const uuid='dddddddd-dddd-4ddd-8ddd-dddddddddddd';await db.exec('begin;');
  try{
   await db.query('insert into auth.users(id) values($1)',[uuid]);await db.query("insert into sd_profiles(id,display_name,username_label) values($1,'Mapped Owner','mapped')",[uuid]);await db.query("insert into sd_memberships(workspace_id,user_id,legacy_user_id,department,role,is_active) values($1,$2,$3,'QA','owner',true)",[itineraryWorkspaceId,uuid,user]);
   const saved=await save(uuid);assert.equal(saved.ok,true);assert.equal(saved.report.generatedByActorId,uuid);
   for(const absent of [false,true]){
    if(absent)await db.query("delete from ship_dynamics_records where workspace_key=$1 and collection='users' and entity_id=$2",[key,user]);else await recordRole('owner',false);
    for(const fn of [()=>save(uuid,saved.operationId),()=>list(1,uuid),()=>locate(saved.report.businessDate,uuid),()=>load(saved.report.reportId,uuid),()=>del([saved.report.reportId],'a'.repeat(32),randomUUID(),uuid),()=>dates([saved.report.businessDate],'a'.repeat(32),randomUUID(),uuid)]){
    // Each expected SQL exception aborts the current transaction until rollback.
    // Preserve the inactive/missing fixture while resetting only this failed probe.
    await db.exec('savepoint qa_invalid_record_actor;');
    try{await assert.rejects(fn,e=>e.code==='P0001'&&e.message==='not-authorized');}
    finally{await db.exec('rollback to savepoint qa_invalid_record_actor;release savepoint qa_invalid_record_actor;');}
   }
   }
  }finally{await db.exec('rollback;');}
 });
 await check('SQL','all six development RPCs are invoker, private to owner and DDL rerun does not mutate report state',async()=>{
  const catalog=(await db.query("select oid::text,proname,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated from pg_proc where proname like 'sd_itinerary_record_report_%' order by proname")).rows;assert.equal(catalog.length,6);
  for(const row of catalog){assert.equal(row.prosecdef,false);assert.equal(row.anon,false);assert.equal(row.authenticated,false);assert.ok(row.proconfig.includes('search_path=pg_catalog, public'));}
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);try{for(const name of Object.keys(argsByName)){const args=argsByName[name];await assert.rejects(()=>scalar(`select ${name}(${args.map(a=>`null::${a.split(':')[1]||'text'}`).join(',')})`),e=>e.code==='42501');}}finally{await db.exec('reset role');}}
  const before=await reportState();await db.exec(fs.readFileSync(reportSql,'utf8'));assert.deepEqual(await reportState(),before);
 });

 if(process.argv.includes('--probe-failure-exit'))throw new Error('intentional-failure-sentinel');
 console.log(JSON.stringify({status:'PASS',tests},null,2));
}catch(error){failure=error;console.error(error);}finally{if(vite)await vite.close();await db.close();}if(failure)process.exitCode=1;

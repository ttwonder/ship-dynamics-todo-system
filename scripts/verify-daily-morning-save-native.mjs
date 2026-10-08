import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations,installTrackingFieldRevision} from './tracking-browser-fixture.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'morning-save-native-'));
const migration='supabase/migrations/20261008090000_tracking_unrelated_patch_fast_path.sql';
const signature='public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)';
const applyUpgrade=!process.argv.includes('--before-upgrade');
const evidence={label:'真實 PostgreSQL＋測試資料；非正式 Supabase',beforeUpgrade:!applyUpgrade,cases:[],measurements:[],productionContacted:false};
let native,qa,failure;
const check=async(caseId,fn)=>{try{await fn();evidence.cases.push({caseId,status:'PASS'});}catch(error){failure??=error;evidence.cases.push({caseId,status:'FAIL',code:error.code,message:error.message});}};
const timed=async(name,fn)=>{const start=performance.now();try{const result=await fn();evidence.measurements.push({name,ms:Math.round(performance.now()-start),status:'OK'});return result;}catch(error){evidence.measurements.push({name,ms:Math.round(performance.now()-start),status:'ERROR',code:error.code,message:error.message});throw error;}};
try{
 native=await createNativeRecordQa(output,evidence,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,tracking:true,taskMember:true,hmr:false,databaseFactory:async()=>native.adapter});
 await installTrackingBrowserMigrations(qa.db);await installTrackingFieldRevision(qa.db);
 for(const f of ['20260929120000_tracking_delivery_close.sql','20260929180000_tracking_completion_close.sql'])await qa.db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const q=async(sql,args=[])=>(await qa.db.query(sql,args)).rows[0];
 const catalog=async()=>q('select oid::text,proacl::text,prosecdef,proconfig,pg_get_functiondef(oid) definition,prosrc body from pg_proc where oid=$1::regprocedure',[signature]);
 const beforeCatalog=await catalog();
 const readback=()=>q(fs.readFileSync('supabase/verification/tracking-unrelated-patch-readback.sql','utf8'));
 assert.equal((await readback()).status,'REQUIRES_INSTALL');
 if(applyUpgrade){
   const state=await qa.read(),sql=fs.readFileSync(migration,'utf8');evidence.migrationSha256=createHash('sha256').update(sql).digest('hex');
   await qa.db.exec(sql);await qa.db.exec(sql.replaceAll('\n','\r\n'));const after=await catalog();
   for(const k of ['oid','proacl','prosecdef','proconfig'])assert.deepEqual(after[k],beforeCatalog[k]);assert.deepEqual(await qa.read(),state);
   evidence.install={dataUnchanged:true,signatureOidAclSecurityAndConfigUnchanged:true,rerun:true};
   evidence.readback=await readback();assert.equal(evidence.readback.status,'PASS',JSON.stringify(evidence.readback));
 }
 const rpc=async(action,payload={})=>qa.db.transaction(async tx=>{await tx.exec('set local role anon');return(await tx.query('select public.ship_dynamics_tracking_public_v1($1,$2,$3::uuid,$4::uuid,$5,$6::jsonb) r',[qa.workspace,'qa-v1','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',action,JSON.stringify(payload)])).rows[0].r;});
 const submit=async(ids,command,creation=false)=>{const bundleId=randomUUID();const claim=await rpc('claim',{bundleId,ids,creation});assert.equal(claim.ok,true,JSON.stringify(claim));try{return await rpc('submit',{bundleId,operationId:randomUUID(),command:typeof command==='function'?command(claim.data.trackingItems):command});}finally{await rpc('release',{bundleId});}};
 const template={kind:'engineering',requestType:'repair',vesselId:'qa-v1',description:'隔離效能測試工程',applicationDate:'2026-09-01',urgency:'normal',progress:'原進度',expectedDate:'',deliveryStatus:'not-delivered'};
 const created=await submit(['linked','unlinked'],{type:'create',items:['linked','unlinked'].map(id=>({...template,id,referenceNo:'QA-'+id}))},true);assert.equal(created.status,'committed',JSON.stringify(created));
 const synced=await submit(['linked'],rows=>({type:'sync',reporterNameAndRole:'測試大副',items:[{id:'linked',expectedUpdatedAt:rows.find(r=>r.id==='linked').updatedAt,item:{id:'linked-case',reportDate:'2026-09-01',reportSource:'日常',description:'QA LINK',priority:'低',category:'維修',isAware:false,status:'原進度',departments:['督導'],expectedDate:''}}]}));assert.equal(synced.status,'committed',JSON.stringify(synced));
 // Synthetic scale seed copied from a source admitted through the real command.
 // No production payload or credentials are accepted.
 await qa.db.query("insert into public.ship_dynamics_records(workspace_key,collection,entity_id,value,revision) select workspace_key,collection,'bulk-'||i,jsonb_set(jsonb_set(value,'{id}',to_jsonb('bulk-'||i)),'{referenceNo}',to_jsonb('QA-'||i)),revision from public.ship_dynamics_records cross join generate_series(1,1100) i where workspace_key=$1 and collection='trackingItems' and entity_id='unlinked'",[qa.workspace]);
 await qa.db.query("update public.ship_dynamics_record_collections set ids=ids||(select jsonb_agg('bulk-'||i order by i) from generate_series(1,1100) i) where workspace_key=$1 and collection='trackingItems'",[qa.workspace]);
 evidence.scale=(await q("select count(*)::int trackingCount from public.ship_dynamics_records where workspace_key=$1 and collection='trackingItems'",[qa.workspace]));
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const {upsertDailyMorningReport}=await qa.loadModule('/src/morningHistory.ts');
 const {withAudit}=await qa.loadModule('/src/utils.ts');
 const {updateInternalControlCase}=await qa.loadModule('/src/internalControlData.ts');
 // Establish the linked task through the unchanged real office helper/writer.
 const linkBase=(await qa.read()).payload,linkActor=linkBase.users.find(r=>r.role==='owner'),linkNext=structuredClone(linkBase),linkCase=linkNext.internalControlCases.find(r=>r.id==='linked-case');
 updateInternalControlCase(linkNext,{...linkCase,syncToTask:true},linkCase.updatedAt,linkActor,new Date().toISOString(),{categories:['維修'],expectedDate:'2026-11-01',ownerUserIds:[linkActor.id],isAbnormal:false});
 const linkOps=buildCloudBlockPatch(linkBase,linkNext),linkLocks=[];
 try{
   const keys=[...new Set(linkOps.filter(o=>o.kind==='entity'&&['trackingItems','internalControlCases','tasks'].includes(o.collection)).map(o=>({trackingItems:'tracking:',internalControlCases:'internal-control:',tasks:'task:'})[o.collection]+o.entityId))].sort();
   for(const key of keys){const l=(await q("select claim_ship_dynamics_edit_lock($1,$2,'qa-morning-link','QA OWNER',75) r",[qa.workspace,key])).r;assert.equal(l.ok,true);linkLocks.push({section_key:key,locked_by:l.locked_by,lease_version:l.lease_version});}
   const g=(await q('select ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(linkBase),linkActor.id])).r;
   const result=(await q('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',[qa.workspace,randomUUID(),JSON.stringify(linkOps),'QA OWNER',linkActor.id,JSON.stringify(g),null,JSON.stringify(linkLocks)])).r;assert.equal(result.ok,true,JSON.stringify(result));
 }finally{await qa.db.query("delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by='qa-morning-link'",[qa.workspace]);}
 const prepare=async(at='2026-10-08T01:00:00Z')=>{
   const base=(await qa.read()).payload,actor=base.users.find(r=>r.role==='owner'),seed=structuredClone(base);
   seed.vessels[0].note.recentDynamics=Array.from({length:8000},(_,i)=>createHash('sha256').update('synthetic-note-'+i).digest('hex').slice(0,32)).join('');
   const saved=upsertDailyMorningReport(seed,{at,actorUserId:actor.id,source:'manual'});assert.equal(saved.status,'saved');
   const next=withAudit({...base,agendaReports:saved.data.agendaReports},actor,'保存每日早會快照','agenda',saved.report.id,'隔離測試');
   const ops=buildCloudBlockPatch(base,next),guard=(await q('select ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(base),actor.id])).r;
   return {base,actor,ops,guard,report:saved.report};
 };
 const input=await prepare();evidence.reportBytes=Buffer.byteLength(JSON.stringify(input.report));evidence.operationBytes=Buffer.byteLength(JSON.stringify(input.ops));
 const validate=ops=>q('select public.ship_dynamics_tracking_validate_v1($1,$2::jsonb,$3,$4::jsonb,$5::jsonb) r',[qa.workspace,JSON.stringify(ops),input.actor.id,JSON.stringify(input.guard),'[]']);
 // Count real prospective lookups, retaining the original SQL expression.
 // This instrumentation belongs only to the owned fixture, never the migration.
 const originalLookup=await q("select pg_get_functiondef(oid) definition,prosrc body from pg_proc where oid='public.ship_dynamics_tracking_after_v1(text,text,text,jsonb)'::regprocedure");
 await qa.db.exec('create sequence public.qa_morning_lookup_counter');
 await qa.db.exec(`create or replace function public.ship_dynamics_tracking_after_v1(w text,c text,i text,ops jsonb) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $qa$ begin perform nextval('public.qa_morning_lookup_counter');return (${originalLookup.body.trim().replace(/;$/,'')});end $qa$;`);
 await check('MSN01-report-only-zero-unrelated-tracking-lookups',async()=>{
   assert.equal((await timed('instrumented-report-validator',()=>validate(input.ops))).r,null);
   const row=await q('select last_value::int n,is_called from public.qa_morning_lookup_counter');const count=row.is_called?row.n:0;evidence.unrelatedLookupCount=count;assert.equal(count,0,'pure report + audit must not inspect unrelated tracking rows');
 });
 await qa.db.exec(originalLookup.definition);
 await check('MSN02-report-validator-uninstrumented-result',async()=>assert.equal((await timed('report-validator',()=>validate(input.ops))).r,null));
 const request=i=>[qa.workspace,randomUUID(),JSON.stringify(i.ops),'QA OWNER',i.actor.id,JSON.stringify(i.guard),null,'[]'];
 const write=args=>q('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',args);
 await check('MSN03-report-save-exact-readback-and-replay',async()=>{
   const args=request(input),result=(await timed('report-insert-writer',()=>write(args))).r;assert.equal(result.ok,true,JSON.stringify(result));
   const after=await qa.read(),actual=after.payload.agendaReports.find(r=>r.id===input.report.id);assert.deepEqual(actual,input.report);assert.equal(after.revision,input.base.revision+1);assert.deepEqual(after.payload.trackingItems,input.base.trackingItems);
   const replay=(await write(args)).r;assert.equal(replay.replayed,true);assert.deepEqual({...replay,replayed:false},result);assert.deepEqual(await qa.read(),after);
   const bad=[...args];bad[3]='different-actor-label';assert.equal((await write(bad)).r.ok,false);assert.deepEqual(await qa.read(),after);
 });
 await check('MSN04-report-refresh-one-revision-history-and-stale-CAS',async()=>{
   const i=await prepare('2026-10-08T01:01:00Z');assert.ok(i.ops.find(o=>o.collection==='agendaReports'&&o.kind==='entity'));
   const args=request(i),result=(await timed('report-update-writer',()=>write(args))).r;assert.equal(result.ok,true,JSON.stringify(result));
   const after=await qa.read();assert.equal(after.revision,i.base.revision+1);
   const history=(await q("select count(*)::int n from public.ship_dynamics_record_history where workspace_key=$1 and collection='agendaReports' and entity_id=$2",[qa.workspace,input.report.id])).n;assert.ok(history>=1);
   const stale=[...args];stale[1]=randomUUID();assert.equal((await write(stale)).r.code,'block-conflict');assert.deepEqual(await qa.read(),after);
 });
 await check('MSN05-linked-case-only-validation-not-skipped',async()=>{
   const base=(await qa.read()).payload,b=base.internalControlCases.find(r=>r.id==='linked-case'),n={...b,isClosed:true,closedDate:'2026-10-08'};
   assert.equal((await validate([{kind:'entity',collection:'internalControlCases',entityId:b.id,expected:b,value:n}])).r,'tracking-lifecycle-inconsistent');
 });
 await check('MSN06-tracking-only-validation-not-skipped',async()=>{
   const base=(await qa.read()).payload,b=base.trackingItems.find(r=>r.id==='unlinked');
   assert.equal((await validate([{kind:'entity',collection:'trackingItems',entityId:b.id,expected:b,value:{...b,description:'QA CHANGE'}}])).r,'tracking-lock-required');
 });
 await check('MSN08-linked-task-only-validation-not-skipped',async()=>{
   const base=(await qa.read()).payload,c=base.internalControlCases.find(r=>r.id==='linked-case'),b=base.tasks.find(r=>r.id===c.linkedTaskId);assert.ok(b);
   assert.equal((await validate([{kind:'entity',collection:'tasks',entityId:b.id,expected:b,value:{...b,isClosed:true,closedDate:'2026-10-08'}}])).r,'tracking-lifecycle-inconsistent');
 });
 if(applyUpgrade)await check('MSN07-unknown-predecessor-fails-with-no-change',async()=>{
   const original=await catalog();await qa.db.exec(original.definition.replace('begin','begin -- unknown fixture predecessor'));
   const state=await qa.read(),unknown=await catalog();await assert.rejects(qa.db.exec(fs.readFileSync(migration,'utf8')),/unrelated-patch-predecessor-mismatch/);await qa.db.exec('rollback');assert.deepEqual(await catalog(),unknown);assert.deepEqual(await qa.read(),state);await qa.db.exec(original.definition);
 });
}catch(error){failure??=error;evidence.error=error.stack;}
finally{
 try{await qa?.close();await native?.close();}catch(error){failure??=error;evidence.cleanupError=error.message;}
 evidence.status=failure?'FAIL':'PASS';fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({status:evidence.status,output,cases:evidence.cases,measurements:evidence.measurements,scale:evidence.scale,reportBytes:evidence.reportBytes,unrelatedLookupCount:evidence.unrelatedLookupCount,error:evidence.error,cleanup:{stopped:evidence.stopped,portClosed:evidence.portClosed}}));if(failure)process.exitCode=1;
}

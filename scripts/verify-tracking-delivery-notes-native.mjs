import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations,installTrackingFieldRevision} from './tracking-browser-fixture.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'delivery-notes-native-'));
const evidence={label:'真實 PostgreSQL＋測試資料，非正式 Supabase',cases:[],productionContacted:false};
let native,qa,failure;
const check=async(name,run)=>{await run();evidence.cases.push(name);console.log('PASS',name);};
try{
 native=await createNativeRecordQa(output,evidence,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,tracking:true,taskMember:true,hmr:false,databaseFactory:async()=>native.adapter});
 await installTrackingBrowserMigrations(qa.db);await installTrackingFieldRevision(qa.db);
 const rpc=async(action,payload={},vessel='qa-v1')=>qa.db.transaction(async tx=>{await tx.exec('set local role anon');return (await tx.query('select public.ship_dynamics_tracking_public_v1($1,$2,$3::uuid,$4::uuid,$5,$6::jsonb) result',[qa.workspace,vessel,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',action,JSON.stringify(payload)])).rows[0].result;});
 const submit=async(name,ids,make,creation=false)=>{const bundleId=randomUUID(),claim=await rpc('claim',{bundleId,ids,creation});assert.equal(claim.ok,true,JSON.stringify(claim));const request={operationId:name,bundleId,command:make(claim.data.trackingItems)};try{return {request,result:await rpc('submit',request)};}finally{await rpc('release',{bundleId});}};
 const base={kind:'supply',requestType:'spares',vesselId:'qa-v1',description:'送船備註原生測試',applicationDate:'2026-09-01',urgency:'normal',progress:'原進度',supplementalNotes:'保留补充',expectedDate:'',deliveryStatus:'not-delivered'};
 const items=['first','second','unselected'].map(id=>({...base,id,referenceNo:'NOTE-'+id}));
 assert.equal((await submit('note-create',items.map(r=>r.id),()=>({type:'create',items}),true)).result.status,'committed');
 assert.equal((await submit('note-sync',['first'],rows=>({type:'sync',reporterNameAndRole:'測試大副',items:[{id:'first',expectedUpdatedAt:rows.find(r=>r.id==='first').updatedAt,item:{id:'note-case',reportDate:'2026-09-01',reportSource:'日常',description:'保留內控內容',priority:'低',category:'維修',isAware:false,status:'原進度',departments:['督導'],expectedDate:''}}]}))).result.status,'committed');
 const delivery=(rows,notes={})=>({type:'delivery',items:rows.filter(r=>r.id!=='unselected').map(r=>({id:r.id,expectedUpdatedAt:r.updatedAt,status:'partially-delivered',date:'',...(Object.hasOwn(notes,r.id)?{note:notes[r.id]}:{})}))});
 const legacy=await submit('note-legacy',['first','second'],rows=>delivery(rows));assert.equal(legacy.result.status,'committed');
 const migration='supabase/migrations/20260929090000_tracking_delivery_notes.sql';
 if(fs.existsSync(migration)&&!process.argv.includes('--before-upgrade'))await check('forward-repeat-LF-CRLF-upgrade-preserves-data-ACL-and-old-exact-receipt',async()=>{
  const before=await qa.read();const acl=async()=>(await qa.db.query("select oid::text,proacl::text,prosecdef,proconfig from pg_proc where oid='ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)'::regprocedure")).rows;
  const originalAcl=await acl(),sql=fs.readFileSync(migration,'utf8');evidence.migrationSha256=createHash('sha256').update(sql).digest('hex');
  const original=(await qa.db.query("select pg_get_functiondef('ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)'::regprocedure) d")).rows[0].d;
  await qa.db.exec(original.replace(/begin\r?\n/,'begin\n -- unknown predecessor QA\n'));
  await assert.rejects(qa.db.exec(sql),/tracking-delivery-notes-predecessor-mismatch/);await qa.db.exec('rollback');await qa.db.exec(original);
  await qa.db.exec(sql);await qa.db.exec(sql.replace(/\r?\n/g,'\r\n'));assert.deepEqual(await qa.read(),before);assert.deepEqual(await acl(),originalAcl);
  assert.equal((await rpc('submit',legacy.request)).replayed,true);assert.deepEqual(await qa.read(),before);
 });
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const {runTrackingCommand}=await qa.loadModule('/src/tracking/trackingWorkflow.ts');
 const {updateInternalControlCase}=await qa.loadModule('/src/internalControlData.ts');
 const office=async(name,mutate)=>{
  const base=(await qa.read()).payload,user=base.users.find(u=>u.role==='owner');
  const next=await mutate(structuredClone(base),user,new Date().toISOString()),operations=buildCloudBlockPatch(base,next),guards=[];
  const keys=[...new Set(operations.filter(o=>o.kind==='entity'&&['trackingItems','internalControlCases','tasks'].includes(o.collection)).map(o=>(o.collection==='trackingItems'?'tracking:':o.collection==='tasks'?'task:':o.expected?'internal-control:':'internal-control-create:')+o.entityId))].sort();
  try{
   for(const key of keys){const lease=(await qa.db.query("select claim_ship_dynamics_edit_lock($1,$2,'qa-delivery-office','QA OFFICE',75) result",[qa.workspace,key])).rows[0].result;assert.equal(lease.ok,true);guards.push({section_key:key,locked_by:lease.locked_by,lease_version:lease.lease_version});}
   const guard=(await qa.db.query('select ship_dynamics_actor_guard($1::jsonb,$2) result',[JSON.stringify(base),user.id])).rows[0].result;
   return (await qa.db.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) result',[qa.workspace,name,JSON.stringify(operations),'QA OFFICE',user.id,JSON.stringify(guard),null,JSON.stringify(guards)])).rows[0].result;
  }finally{await qa.db.query("delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by='qa-delivery-office'",[qa.workspace]);}
 };
 await check('shore-note-one-transaction-converges-existing-linked-triple',async()=>{
  const linked=await office('note-task-link',(d,u,at)=>{const c=d.internalControlCases.find(r=>r.id==='note-case');updateInternalControlCase(d,{...c,syncToTask:true},c.updatedAt,u,at,{categories:['維修'],expectedDate:'2026-11-01',ownerUserIds:[u.id],isAbnormal:false});return d;});assert.equal(linked.ok,true,JSON.stringify(linked));
  const before=await qa.read(),old=before.payload.trackingItems.find(r=>r.id==='first');
  const result=await office('note-office-save',(d,u,at)=>runTrackingCommand(d,{type:'delivery',items:[{id:'first',expectedUpdatedAt:old.updatedAt,status:'partially-delivered',date:'',note:'岸端已送甲；乙未送'}]},{actorId:u.id,at,operationId:'note-office-save'}));assert.equal(result.ok,true,JSON.stringify(result));
  const after=await qa.read(),row=after.payload.trackingItems.find(r=>r.id==='first'),c=after.payload.internalControlCases.find(r=>r.id==='note-case'),t=after.payload.tasks.find(r=>r.id===c.linkedTaskId);assert.equal(after.revision,before.revision+1);assert.equal(row.progress,'原進度\n送船備註：岸端已送甲；乙未送');assert.equal(c.status,row.progress);assert.equal(t.status,row.progress);assert.deepEqual(t.statusLogs,c.statusLogs);
 });
 await check('ship-atomic-partial-delivery-note-linked-progress-history-and-exact-replay',async()=>{
  const before=await qa.read(),notes={first:'已送濾芯 2 個\n未送墊片 3 個',second:'已送乙；丙未送'};
  const {result,request}=await submit('note-batch',['first','second'],rows=>delivery(rows,notes));assert.equal(result.status,'committed',JSON.stringify(result));
  const after=await qa.read();assert.equal(after.revision,before.revision+1);
  for(const id of ['first','second']){const old=before.payload.trackingItems.find(r=>r.id===id),row=after.payload.trackingItems.find(r=>r.id===id);assert.equal(row.progress,old.progress+'\n送船備註：'+notes[id]);assert.equal(row.deliveryStatus,'partially-delivered');assert.equal(row.actualDeliveryDate,undefined);assert.equal(row.isClosed,false);assert.equal(row.statusLogs[0].text,row.progress);assert.deepEqual(row.statusLogs.slice(1),old.statusLogs);assert.equal(row.supplementalNotes,old.supplementalNotes);}
  const row=after.payload.trackingItems.find(r=>r.id==='first'),linked=after.payload.internalControlCases.find(r=>r.id==='note-case');assert.equal(linked.status,row.progress);assert.equal(linked.description,before.payload.internalControlCases.find(r=>r.id==='note-case').description);
  const task=after.payload.tasks.find(r=>r.id===linked.linkedTaskId);assert.equal(task.status,row.progress);assert.deepEqual(task.statusLogs,linked.statusLogs);
  assert.deepEqual(after.payload.trackingItems.find(r=>r.id==='unselected'),before.payload.trackingItems.find(r=>r.id==='unselected'));
  assert.equal((await rpc('submit',request)).replayed,true);assert.deepEqual(await qa.read(),after);
 });
 await check('blank-note-no-progress-history-append-and-TS-SQL-unicode-parity',async()=>{
  const {trackingDeliveryProgress}=await qa.loadModule('/src/tracking/trackingWorkflow.ts');
  for(const [index,note] of ['', ' \n\t ', '\u3000已送🚢；未送甲\u00a0', '字'.repeat(2000)].entries()){
   const before=await qa.read(),old=before.payload.trackingItems.find(r=>r.id==='first');const {result}=await submit('note-parity-'+index,['first'],rows=>({type:'delivery',items:[{id:'first',expectedUpdatedAt:rows.find(r=>r.id==='first').updatedAt,status:'partially-delivered',date:'',note}]}));assert.equal(result.status,'committed',JSON.stringify(result));
   const row=(await qa.read()).payload.trackingItems.find(r=>r.id==='first');assert.equal(row.progress,trackingDeliveryProgress(old.progress,note));assert.equal(row.statusLogs.length,old.statusLogs.length+(note.trim()?1:0));
  }
 });
 await check('invalid-note-stale-and-cross-vessel-negative-entire-batch-unchanged',async()=>{
  for(const [index,note] of [null,23,'字'.repeat(2001)].entries()){
   const before=await qa.read(),{result}=await submit('note-reject-'+index,['first','second'],rows=>delivery(rows,{first:'不可部分寫入',second:note}));assert.equal(result.status,'rejected',JSON.stringify(result));assert.deepEqual(await qa.read(),before);
  }
  const before=await qa.read(),{result}=await submit('note-stale',['first','second'],rows=>{const command=delivery(rows,{first:'不可部分寫入',second:'新備註'});command.items[1].expectedUpdatedAt='stale';return command;});assert.equal(result.status,'rejected');assert.deepEqual(await qa.read(),before);
  await assert.rejects(rpc('claim',{bundleId:randomUUID(),ids:['first'],creation:false},'qa-v2'),/ship-tracking-source-unavailable/);assert.deepEqual(await qa.read(),before);
 });
 await check('closed-group-note-rejected-and-legacy-date-correction-remains-valid',async()=>{
  const close=await submit('note-close',['first'],rows=>({type:'lifecycle',action:'close',date:'2026-09-29',targets:[{id:'first',expectedUpdatedAt:rows.find(r=>r.id==='first').updatedAt,entry:'tracking'}]}));assert.equal(close.result.status,'committed');
  const before=await qa.read(),bad=await submit('note-closed',['first'],rows=>({type:'delivery',items:[{id:'first',expectedUpdatedAt:rows.find(r=>r.id==='first').updatedAt,status:'delivered',date:'2026-09-29',note:'不可修改結案進度'}]}));assert.equal(bad.result.status,'rejected');assert.deepEqual(await qa.read(),before);
  const good=await submit('note-closed-date',['first'],rows=>({type:'delivery',items:[{id:'first',expectedUpdatedAt:rows.find(r=>r.id==='first').updatedAt,status:'delivered',date:'2026-09-29'}]}));assert.equal(good.result.status,'committed');assert.equal((await qa.read()).payload.trackingItems.find(r=>r.id==='first').progress,before.payload.trackingItems.find(r=>r.id==='first').progress);
 });
 const readback='supabase/verification/tracking-delivery-notes-readback.sql';if(fs.existsSync(readback)){const r=await qa.db.query(fs.readFileSync(readback,'utf8'));const row=r.rows.find(v=>v.status);assert.equal(row?.status,'PASS',JSON.stringify(row));evidence.readback=row;}
}catch(error){failure=error;evidence.error=error.stack;console.error(error.stack);}
finally{try{await qa?.close();await native?.close();}catch(error){failure??=error;evidence.cleanupError=error.message;}evidence.status=failure?'FAIL':'PASS';fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,output,caseCount:evidence.cases.length}));if(failure)process.exitCode=1;}

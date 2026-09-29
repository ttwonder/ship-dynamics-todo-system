import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations,installTrackingFieldRevision} from './tracking-browser-fixture.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'delivery-close-native-'));
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

 const oldNotes='supabase/migrations/20260929090000_tracking_delivery_notes.sql';
 if(!process.argv.includes('--without-notes'))await qa.db.exec(fs.readFileSync(oldNotes,'utf8'));
 const old=await submit('close-legacy',['first'],rows=>({type:'delivery',items:[{id:'first',expectedUpdatedAt:rows.find(r=>r.id==='first').updatedAt,status:'partially-delivered',date:'',...(!process.argv.includes('--without-notes')?{note:'舊版已送甲'}:{})}]}));assert.equal(old.result.status,'committed');
 const signatures=['ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)','public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)'];
 const acl=async()=>(await qa.db.query('select oid::text,proacl::text,prosecdef,proconfig from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows;
 for(const [i,sig] of signatures.entries()){const r=(await qa.db.query('select pg_get_functiondef($1::regprocedure) d,md5(replace(prosrc,chr(13)||chr(10),chr(10))) h from pg_proc where oid=$1::regprocedure',[sig])).rows[0];fs.writeFileSync(path.join(output,'baseline-'+i+'.sql'),r.d);(evidence.predecessors??=[]).push({sig,hash:r.h});}
 const migration='supabase/migrations/20260929120000_tracking_delivery_close.sql';
 if(fs.existsSync(migration)&&!process.argv.includes('--before-upgrade'))await check('forward-repeat-LF-CRLF-migration-preserves-data-ACL-old-exact-receipt',async()=>{
  const before=await qa.read(),originalAcl=await acl(),sql=fs.readFileSync(migration,'utf8');evidence.migrationSha256=createHash('sha256').update(sql).digest('hex');
  const original=fs.readFileSync(path.join(output,'baseline-0.sql'),'utf8');await qa.db.exec(original.replace(/begin\r?\n/,'begin\n -- unknown predecessor QA\n'));
  await assert.rejects(qa.db.exec(sql),/tracking-delivery-close-predecessor-mismatch/);await qa.db.exec('rollback');await qa.db.exec(original);
  await qa.db.exec(sql);await qa.db.exec(sql.replace(/\r?\n/g,'\r\n'));assert.deepEqual(await qa.read(),before);assert.deepEqual(await acl(),originalAcl);assert.equal((await rpc('submit',old.request)).replayed,true);assert.deepEqual(await qa.read(),before);
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

 const delivery=(rows,ids=['first','second'],patch={})=>({type:'delivery',items:ids.map(id=>({id,expectedUpdatedAt:rows.find(r=>r.id===id).updatedAt,status:'delivered',date:'2026-09-29',closeOnDelivery:true,note:'全數收到 '+id,...patch}))});
 const prove=(before,after,ids)=>{assert.equal(after.revision,before.revision+1);for(const id of ids){const row=after.payload.trackingItems.find(r=>r.id===id),old=before.payload.trackingItems.find(r=>r.id===id);assert.equal(row.isClosed,true);assert.equal(row.closedDate,'2026-09-29');assert.equal(row.actualDeliveryDate,row.closedDate);assert.deepEqual(row.events.slice(-2).map(e=>e.action),['delivery','close']);assert.equal(row.events.at(-1).operationId,row.events.at(-2).operationId);assert.equal(row.progress,old.progress+'\n送船備註：全數收到 '+id);assert.equal(row.supplementalNotes,old.supplementalNotes);}
  const c=after.payload.internalControlCases.find(r=>r.id==='note-case'),t=after.payload.tasks.find(r=>r.id===c.linkedTaskId);for(const end of [c,t].filter(Boolean)){assert.equal(end.isClosed,true);assert.equal(end.closedDate,'2026-09-29');assert.equal(end.status,after.payload.trackingItems.find(r=>r.id==='first').progress);assert.equal(end.trackingLifecycle.at(-1).action,'close');}assert.deepEqual(after.payload.trackingItems.find(r=>r.id==='unselected'),before.payload.trackingItems.find(r=>r.id==='unselected'));};
 const reopen=async(name)=>{const result=await submit(name,['first','second'],rows=>({type:'lifecycle',action:'reopen',targets:['first','second'].map(id=>({entry:'tracking',id,expectedUpdatedAt:rows.find(r=>r.id===id).updatedAt}))}));assert.equal(result.result.status,'committed');};
 await check('shore-native-deliver-note-and-close-linked-triple-one-revision',async()=>{
  const result=await office('close-task-link',(d,u,at)=>{const c=d.internalControlCases.find(r=>r.id==='note-case');updateInternalControlCase(d,{...c,syncToTask:true},c.updatedAt,u,at,{categories:['維修'],expectedDate:'2026-11-01',ownerUserIds:[u.id],isAbnormal:false});return d;});assert.equal(result.ok,true,JSON.stringify(result));
  const before=await qa.read();const saved=await office('close-office',(d,u,at)=>runTrackingCommand(d,delivery(d.trackingItems),{actorId:u.id,at,operationId:'close-office'}));assert.equal(saved.ok,true,JSON.stringify(saved));prove(before,await qa.read(),['first','second']);
 });
 await reopen('close-reopen-office');
 await check('ship-native-deliver-note-and-close-linked-triple-exact-replay',async()=>{const before=await qa.read(),{result,request}=await submit('close-ship',['first','second'],rows=>delivery(rows));assert.equal(result.status,'committed',JSON.stringify(result));const after=await qa.read();prove(before,after,['first','second']);assert.equal((await rpc('submit',request)).replayed,true);assert.deepEqual(await qa.read(),after);});
 await check('closed-date-correction-remains-no-reclose-and-explicit-close-rejected',async()=>{
  const before=await qa.read(),bad=await submit('close-already',['first','second'],rows=>delivery(rows,undefined,{note:''}));assert.equal(bad.result.status,'rejected');assert.deepEqual(await qa.read(),before);
  const corrected=await submit('close-correct',['first'],rows=>({type:'delivery',items:[{id:'first',expectedUpdatedAt:rows.find(r=>r.id==='first').updatedAt,status:'delivered',date:'2026-09-28'}]}));assert.equal(corrected.result.status,'committed');const row=(await qa.read()).payload.trackingItems.find(r=>r.id==='first');assert.equal(row.closedDate,'2026-09-29');assert.equal(row.events.filter(e=>e.action==='close').length,before.payload.trackingItems.find(r=>r.id==='first').events.filter(e=>e.action==='close').length);
 });
 await reopen('close-reopen-negatives');
 await check('invalid-second-item-rolls-back-entire-delivery-note-closure',async()=>{
  for(const [i,p] of [{closeOnDelivery:'true'},{closeOnDelivery:null},{status:'partially-delivered',date:''},{date:'2026-08-31'},{date:''},{expectedUpdatedAt:'stale'}].entries()){
   const before=await qa.read(),{result}=await submit('close-negative-'+i,['first','second'],rows=>{const cmd=delivery(rows);Object.assign(cmd.items[1],p);return cmd;});assert.equal(result.status,'rejected',JSON.stringify(result));assert.deepEqual(await qa.read(),before);
  }
  const before=await qa.read();await assert.rejects(rpc('claim',{bundleId:randomUUID(),ids:['first'],creation:false},'qa-v2'),/ship-tracking-source-unavailable/);assert.deepEqual(await qa.read(),before);
 });
 await check('shore-canonical-closure-rejects-unrelated-source-or-linked-basic-edits',async()=>{
  for(const [i,tamper] of [d=>{d.trackingItems.find(r=>r.id==='first').description='不能藉由結案改基本內容';},d=>{d.internalControlCases.find(r=>r.id==='note-case').description='不能藉由結案改關聯內容';}].entries()){
   const before=await qa.read();const rejected=await office('close-canonical-negative-'+i,(d,u,at)=>{const n=runTrackingCommand(d,delivery(d.trackingItems),{actorId:u.id,at,operationId:'close-canonical-negative-'+i});tamper(n);return n;});assert.equal(rejected.ok,false,JSON.stringify(rejected));assert.match(JSON.stringify(rejected),/tracking-closed-progress|tracking-delivery-close-link-not-converged/);assert.deepEqual(await qa.read(),before);
  }
 });
 await check('legacy-no-checkbox-delivery-never-closes',async()=>{const before=await qa.read();const {result}=await submit('close-default',['first'],rows=>delivery(rows,['first'],{closeOnDelivery:false,note:''}));assert.equal(result.status,'committed');const row=(await qa.read()).payload.trackingItems.find(r=>r.id==='first');assert.equal(row.isClosed,false);assert.equal(row.progress,before.payload.trackingItems.find(r=>r.id==='first').progress);});
 const readback='supabase/verification/tracking-delivery-close-readback.sql';if(fs.existsSync(readback)){const rows=(await qa.db.query(fs.readFileSync(readback,'utf8'))).rows;assert.equal(rows[0].status,'PASS',JSON.stringify(rows));evidence.readback=rows[0];}
}catch(error){failure=error;evidence.error=error.stack;console.error(error.stack);}
finally{try{await qa?.close();await native?.close();}catch(error){failure??=error;evidence.cleanupError=error.message;}evidence.status=failure?'FAIL':'PASS';fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,output,caseCount:evidence.cases.length}));if(failure)process.exitCode=1;}
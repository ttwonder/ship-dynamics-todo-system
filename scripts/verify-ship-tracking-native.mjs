import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations} from './tracking-browser-fixture.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));
const output=fs.mkdtempSync(path.join(root,'ship-tracking-native-'));
const evidence={label:'Native PostgreSQL＋合成資料，非正式環境',cases:[],productionContacted:false};let native,qa,failure;
const check=async(name,fn)=>{await fn();evidence.cases.push({name,status:'PASS'});console.log('PASS',name);};
try {
 native=await createNativeRecordQa(output,evidence,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,tracking:true,taskMember:true,databaseFactory:async()=>native.adapter});
 await installTrackingBrowserMigrations(qa.db);
 await qa.db.exec(fs.readFileSync('supabase/migrations/20260925020000_edit_lock_holder.sql','utf8'));
 const originalPublicCatalog=async()=>(await qa.db.query("select md5(string_agg(oid::text||pg_get_functiondef(oid)||coalesce(proacl::text,''),E'\\n' order by oid)) r from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname<>'ship_dynamics_tracking_public_v1'")).rows[0].r;
 const baselineCatalog=await originalPublicCatalog(),baselineBusiness=await qa.read();
 const file='supabase/migrations/20260925080000_ship_tracking_public.sql';
 const migrationText=fs.readFileSync(file,'utf8');
 const installation=process.argv.includes('--crlf-install')?migrationText.replace(/\r?\n/g,'\r\n'):migrationText;
 evidence.installationLineEndings=process.argv.includes('--crlf-install')?'CRLF':'SOURCE';
 await qa.db.exec(installation);
 await check('additive-idempotent-install-preserves-existing-RPCs-ACL-and-business-data',async()=>{
  assert.equal(await originalPublicCatalog(),baselineCatalog);assert.deepEqual(await qa.read(),baselineBusiness);
  await qa.db.exec(installation);assert.equal(await originalPublicCatalog(),baselineCatalog);assert.deepEqual(await qa.read(),baselineBusiness);
 });
 await check('independent-catalog-readback-matches-installed-function-bytes',async()=>{
  const sql=fs.readFileSync('supabase/verification/ship-tracking-public-readback.sql','utf8');
  const prefix=sql.slice(sql.indexOf('with public_rpc'),sql.indexOf('), checks as ('))+')';
  const fingerprint=(await qa.db.query(prefix+" select md5(string_agg(identity||E'\\n'||definition,E'\\n' order by identity)) fingerprint from definitions")).rows[0].fingerprint;
  evidence.installedDefinitionFingerprint=fingerprint;console.log('Installed definition fingerprint',fingerprint);
  const results=await qa.db.exec(sql),row=results.flatMap(r=>r.rows||[]).find(r=>r.status);assert.ok(row);assert.equal(row.status,'PASS',JSON.stringify(row));assert.equal(Number(row.checks),8);assert.deepEqual(row.failures,[]);
 });
 await qa.db.exec(fs.readFileSync('supabase/migrations/20260925160000_tracking_field_revision.sql','utf8'));
 const rpc=async(action,vessel=null,payload={},actor='11111111-1111-4111-8111-111111111111',holder='22222222-2222-4222-8222-222222222222')=>qa.db.transaction(async tx=>{
  await tx.exec('set local role anon');return (await tx.query('select public.ship_dynamics_tracking_public_v1($1,$2,$3::uuid,$4::uuid,$5,$6::jsonb) result',['isolated-record-ui-qa',vessel,actor,holder,action,JSON.stringify(payload)])).rows[0].result;
 });
 await check('anonymous-active-vessel-catalog-is-positive-projection',async()=>{
  let result;try{result=await rpc('read');}catch(error){assert.fail('Dedicated single-vessel public tracking read must exist: '+error.message);}
  assert.ok(result.vessels.length>=1);assert.deepEqual(Object.keys(result).sort(),['catalog','cases','protocol','revision','trackingItems','updatedAt','vessel','vessels','workspace'].sort());
  for(const vessel of result.vessels)assert.deepEqual(Object.keys(vessel).sort(),['id','name','shortName','fullName'].sort());
  assert.deepEqual(result.trackingItems,[]);assert.deepEqual(result.cases,[]);assert.equal(result.vessel,null);
 });
 const item={id:'ship-source-1',kind:'supply',vesselId:'qa-v1',referenceNo:'SHIP-001',description:'船端新增測試',applicationDate:'2026-09-25',urgency:'normal',progress:'初次回報',supplementalNotes:'',expectedDate:'',deliveryStatus:'not-delivered'};
 const bundleId='33333333-3333-4333-8333-333333333333';
 const request={operationId:'ship-create-1',bundleId,command:{type:'create',items:[item]}};
 await check('anonymous-create-uses-shared-record-authority-and-exact-receipt',async()=>{
  const before=await qa.read();const claimed=await rpc('claim','qa-v1',{bundleId,ids:[item.id],creation:true});assert.equal(claimed.ok,true);
  const result=await rpc('submit','qa-v1',request);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.status,'committed');assert.equal(result.operationId,request.operationId);
  const after=await qa.read();const saved=after.payload.trackingItems.find(x=>x.id===item.id);assert.ok(saved);assert.equal(saved.vesselId,'qa-v1');assert.equal(saved.progress,'初次回報');assert.equal(saved.statusLogs.length,1);assert.equal(saved.createdBy,'public-tracking-vessel:qa-v1');
  assert.equal(after.revision,before.revision+1);assert.deepEqual(after.payload.users,before.payload.users);assert.deepEqual(after.payload.tasks,before.payload.tasks);
  assert.equal((await rpc('receipt','qa-v1',request)).status,'committed');assert.equal((await rpc('submit','qa-v1',request)).replayed,true);assert.equal((await qa.read()).revision,after.revision);
  assert.equal((await rpc('read','qa-v2')).trackingItems.some(x=>x.id===item.id),false);
  assert.equal((await rpc('release','qa-v1',{bundleId})).ok,true);
 });
 await check('source-edit-and-progress-history-use-frozen-bundle-CAS',async()=>{
  const bid='44444444-4444-4444-8444-444444444444';
  const claimed=await rpc('claim','qa-v1',{bundleId:bid,ids:[item.id],creation:false});assert.equal(claimed.ok,true);
  const source=claimed.data.trackingItems.find(x=>x.id===item.id);
  const edited=await rpc('submit','qa-v1',{operationId:'ship-edit-1',bundleId:bid,command:{type:'edit',items:[{id:item.id,expectedUpdatedAt:source.updatedAt,changes:{description:'船端修正',expectedDate:'2026-10-01'}}]}});
  assert.equal(edited.ok,true,JSON.stringify(edited));await rpc('release','qa-v1',{bundleId:bid});
  const nextBid='55555555-5555-4555-8555-555555555555';
  const fresh=await rpc('claim','qa-v1',{bundleId:nextBid,ids:[item.id],creation:false});const original=fresh.data.trackingItems.find(x=>x.id===item.id);
  const changed=await rpc('submit','qa-v1',{operationId:'ship-progress-1',bundleId:nextBid,command:{type:'progress',items:[{id:item.id,expectedUpdatedAt:original.updatedAt,text:'第二次回報'}]}});
  assert.equal(changed.ok,true,JSON.stringify(changed));await rpc('release','qa-v1',{bundleId:nextBid});
  const saved=(await rpc('read','qa-v1')).trackingItems.find(x=>x.id===item.id);assert.equal(saved.description,'船端修正');assert.equal(saved.expectedDate,'2026-10-01');assert.deepEqual(saved.statusLogs.map(x=>x.text),['第二次回報','初次回報']);
 });
 const change=async(name,build)=>{const bid=crypto.randomUUID();const claim=await rpc('claim','qa-v1',{bundleId:bid,ids:[item.id],creation:false});assert.equal(claim.ok,true);const src=claim.data.trackingItems.find(x=>x.id===item.id);const result=await rpc('submit','qa-v1',{operationId:name,bundleId:bid,command:build(src)});await rpc('release','qa-v1',{bundleId:bid});assert.equal(result.ok,true,JSON.stringify(result));return (await rpc('read','qa-v1'));};
 await check('ship-sync-reporter-delivery-close-correction-reopen-are-atomic',async()=>{
  let snap=await change('ship-sync',s=>({type:'sync',reporterNameAndRole:'王測試／大副',items:[{id:s.id,expectedUpdatedAt:s.updatedAt,item:{id:'ship-case-1',reportDate:s.applicationDate,reportSource:'日常',description:'需岸端協助',priority:'低',category:'維修',equipmentSubcategory:'',isAware:false,status:s.progress,departments:['督導'],expectedDate:s.expectedDate}}]}));
  assert.equal(snap.cases[0].description,'需岸端協助\n\n報告人姓名＋職務：王測試／大副');assert.equal(snap.cases[0].syncToTask,false);assert.equal(snap.trackingItems[0].linkedCaseId,'ship-case-1');
  snap=await change('ship-delivery',s=>({type:'delivery',items:[{id:s.id,expectedUpdatedAt:s.updatedAt,status:'delivered',date:'2026-09-26'}]}));assert.equal(snap.trackingItems[0].isClosed,false);assert.equal(snap.cases[0].isClosed,false);
  for(const [action,date] of [['close','2026-09-26'],['correct-close-date','2026-09-27'],['reopen','']]) {
   snap=await change('ship-'+action,s=>({type:'lifecycle',action,date,outcome:'completed',targets:[{entry:'tracking',id:s.id,expectedUpdatedAt:s.updatedAt}]}));
   assert.equal(snap.trackingItems[0].isClosed,action!=='reopen');assert.equal(snap.cases[0].isClosed,action!=='reopen');assert.equal(snap.trackingItems[0].closedDate,snap.cases[0].closedDate);assert.equal(snap.trackingItems[0].actualDeliveryDate,'2026-09-26');
  }
  snap=await change('ship-linked-progress',s=>({type:'progress',items:[{id:s.id,expectedUpdatedAt:s.updatedAt,text:'第三次回報'}]}));assert.equal(snap.cases[0].status,'第三次回報');assert.equal(snap.cases[0].description,'需岸端協助\n\n報告人姓名＋職務：王測試／大副');
 });
 await check('excel-import-closed-engineering-is-one-atomic-command',async()=>{
  const imported={...item,id:'import-closed',kind:'engineering',referenceNo:'IMPORT-001',source:{fileName:'test.xlsx',sheetName:'已完成工程',row:2,originalValues:{工程內容:'測試'}}};const bid=crypto.randomUUID();
  assert.equal((await rpc('claim','qa-v1',{bundleId:bid,ids:[imported.id],creation:true})).ok,true);
  const result=await rpc('submit','qa-v1',{operationId:'import-closed-1',bundleId:bid,command:{type:'create',items:[imported],importClosures:[{id:imported.id,date:'2026-09-26',outcome:'completed'}]}});
  assert.equal(result.ok,true,JSON.stringify(result));const saved=(await qa.read()).payload.trackingItems.find(x=>x.id===imported.id);assert.equal(saved.isClosed,true);assert.equal(saved.closedDate,'2026-09-26');assert.equal(saved.closureOutcome,'completed');assert.deepEqual(saved.source,imported.source);assert.equal(saved.events.at(-1).action,'close');await rpc('release','qa-v1',{bundleId:bid});
 });
 const q=async(sql,args=[])=>(await qa.db.query(sql,args)).rows[0]?.r;
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts'),ic=await qa.loadModule('/src/internalControlData.ts');
 const office=async(name,mutate)=>{
  const base=(await qa.read()).payload,next=structuredClone(base),actor=base.users.find(u=>u.role==='owner');await mutate(next,actor,new Date().toISOString());
  const ops=buildCloudBlockPatch(base,next),keys=new Set(['tracking:'+item.id]);
  for(const o of ops)if(o.kind==='entity'&&['trackingItems','internalControlCases','tasks'].includes(o.collection))keys.add((o.collection==='trackingItems'?'tracking:':o.collection==='tasks'?'task:':o.expected?'internal-control:':'internal-control-create:')+o.entityId);
  const guards=[];try{
   for(const key of [...keys].sort()){const lease=await q("select claim_ship_dynamics_edit_lock($1,$2,'qa-office-native','QA OFFICE',75) r",[qa.workspace,key]);assert.equal(lease.ok,true,key);guards.push({section_key:key,locked_by:lease.locked_by,lease_version:lease.lease_version});}
   const guard=await q('select ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(base),actor.id]);
   const result=await qa.db.transaction(async tx=>{return (await tx.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',[qa.workspace,name,JSON.stringify(ops),'QA OFFICE',actor.id,JSON.stringify(guard),null,JSON.stringify(guards)])).rows[0].r;});assert.equal(result.ok,true,JSON.stringify(result));return (await qa.read()).payload;
  }finally{await qa.db.query("delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by='qa-office-native'",[qa.workspace]);}
 };
 await check('shore-task-link-and-bidirectional-lifecycle-share-one-authority',async()=>{
  let saved=await office('office-link-existing-case',(d,u,at)=>{const c=d.internalControlCases.find(c=>c.id==='ship-case-1');ic.updateInternalControlCase(d,{...c,syncToTask:true},c.updatedAt,u,at,{categories:['維修'],expectedDate:'2026-10-01',ownerUserIds:[u.id],isAbnormal:false});});
  const taskId=saved.internalControlCases.find(c=>c.id==='ship-case-1').linkedTaskId;assert.ok(taskId);
  await change('ship-close-linked-task',s=>({type:'lifecycle',action:'close',date:'2026-09-26',targets:[{entry:'tracking',id:s.id,expectedUpdatedAt:s.updatedAt}]}));
  saved=(await qa.read()).payload;for(const value of [saved.trackingItems.find(x=>x.id===item.id),saved.internalControlCases.find(x=>x.id==='ship-case-1'),saved.tasks.find(x=>x.id===taskId)])assert.equal(value.isClosed,true);
  saved=await office('office-reopen-linked-case',(d,u,at)=>{const c=d.internalControlCases.find(c=>c.id==='ship-case-1'),n={...c,isClosed:false};delete n.closedDate;delete n.closedBy;ic.updateInternalControlCase(d,n,c.updatedAt,u,at);});
  assert.equal((await rpc('read','qa-v1')).trackingItems.find(x=>x.id===item.id).isClosed,false);
  const before=structuredClone(saved.tasks.find(x=>x.id===taskId));await change('ship-progress-existing-task',s=>({type:'progress',items:[{id:s.id,expectedUpdatedAt:s.updatedAt,text:'既有有效關聯同步'}]}));
  saved=(await qa.read()).payload;const task=saved.tasks.find(x=>x.id===taskId);assert.equal(task.status,'既有有效關聯同步');assert.deepEqual(task.ownerUserIds,before.ownerUserIds);assert.equal(task.expectedDate,before.expectedDate);
  const publicRead=await rpc('read','qa-v1');assert.equal(publicRead.tasks,undefined);assert.equal(publicRead.cases.find(x=>x.id==='ship-case-1').syncToTask,false);assert.equal(publicRead.cases.find(x=>x.id==='ship-case-1').linkedTaskId,undefined);
  await office('office-delete-linked-task',(d,u,at)=>{const t=d.tasks.find(t=>t.id===taskId);ic.closeLinkedInternalControlCaseAfterTaskDelete(d,t,u,at);d.tasks=d.tasks.filter(t=>t.id!==taskId);});
  await change('ship-after-task-delete',s=>({type:'progress',items:[{id:s.id,expectedUpdatedAt:s.updatedAt,text:'刪除關聯後僅來源更新'}]}));saved=(await qa.read()).payload;
  assert.equal(saved.tasks.some(x=>x.id===taskId),false);assert.equal(saved.trackingItems.find(x=>x.id===item.id).linkState,'invalid');assert.notEqual(saved.internalControlCases.find(x=>x.id==='ship-case-1').status,'刪除關聯後僅來源更新');
 });
 await check('native-negative-command-field-and-CAS-matrix-is-zero-business-write',async()=>{
  const invalid=[s=>({type:'edit',items:[{id:s.id,expectedUpdatedAt:s.updatedAt,changes:{vesselId:'qa-v2'}}]}),s=>({type:'edit',items:[{id:s.id,expectedUpdatedAt:s.updatedAt,changes:{passwordHash:'not-allowed'}}]}),s=>({type:'progress',items:[{id:s.id,expectedUpdatedAt:'stale',text:'no'}]}),s=>({type:'progress',items:[{id:s.id,expectedUpdatedAt:s.updatedAt,text:' '}]}),s=>({type:'lifecycle',action:'close',date:'2026-09-26',targets:[{entry:'task',id:s.id,expectedUpdatedAt:s.updatedAt}]}),s=>({type:'sync',reporterNameAndRole:'測試／大副',items:[{id:s.id,expectedUpdatedAt:s.updatedAt,item:{id:'forged-case',syncToTask:true}}]}),s=>({type:'general-patch',items:[{id:s.id}]})];
  for(let i=0;i<invalid.length;i++){const bid=crypto.randomUUID(),claim=await rpc('claim','qa-v1',{bundleId:bid,ids:[item.id],creation:false});assert.equal(claim.ok,true);const before=await qa.read();const req={operationId:'negative-'+i,bundleId:bid,command:invalid[i](claim.data.trackingItems.find(x=>x.id===item.id))};const result=await rpc('submit','qa-v1',req);assert.equal(result.status,'rejected',JSON.stringify(result));assert.deepEqual(await qa.read(),before);assert.equal((await rpc('receipt','qa-v1',req)).status,'rejected');await rpc('release','qa-v1',{bundleId:bid});}
  await assert.rejects(()=>rpc('claim','qa-v2',{bundleId:crypto.randomUUID(),ids:[item.id],creation:false}),/source-unavailable/);
  const before=await qa.read();await qa.db.query("update ship_dynamics_records set value=jsonb_set(value,'{isActive}','false') where workspace_key=$1 and collection='vessels' and entity_id='qa-v2'",[qa.workspace]);await assert.rejects(()=>rpc('read','qa-v2'),/vessel/);assert.equal((await rpc('read')).vessels.some(v=>v.id==='qa-v2'),false);await qa.db.query("update ship_dynamics_records set value=jsonb_set(value,'{isActive}','true') where workspace_key=$1 and collection='vessels' and entity_id='qa-v2'",[qa.workspace]);assert.deepEqual(await qa.read(),before);
  await assert.rejects(()=>qa.db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select * from ship_dynamics_tracking_private.bundles');}),/permission denied/);
 });
 await check('batch-all-or-none-and-fenced-expired-holder-release',async()=>{
  const ids=[item.id,'import-closed'],other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',bid=crypto.randomUUID();
  await q("select claim_ship_dynamics_edit_lock($1,$2,'qa-office-blocker','QA OFFICE',75) r",[qa.workspace,'tracking:'+item.id]);
  assert.equal((await rpc('claim','qa-v1',{bundleId:bid,ids,creation:false},other)).ok,false);
  assert.equal(await q("select count(*)::int r from ship_dynamics_edit_locks where workspace_key=$1 and locked_by like $2",[qa.workspace,'ship-tracking:'+other+':%']),0);
  await qa.db.query("delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by='qa-office-blocker'",[qa.workspace]);
  assert.equal((await rpc('claim','qa-v1',{bundleId:bid,ids,creation:false},other)).ok,true);assert.equal((await rpc('renew','qa-v1',{bundleId:bid},other)).ok,true);
  await assert.rejects(()=>rpc('release','qa-v1',{bundleId:bid},other,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),/bundle-owner/);
  await qa.db.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and locked_by like $2",[qa.workspace,'ship-tracking:'+other+':%']);
  const freshId=crypto.randomUUID(),holder='cccccccc-cccc-4ccc-8ccc-cccccccccccc';assert.equal((await rpc('claim','qa-v1',{bundleId:freshId,ids,creation:false},other,holder)).ok,true);
  assert.equal((await rpc('renew','qa-v1',{bundleId:bid},other)).ok,false);assert.equal((await rpc('release','qa-v1',{bundleId:bid},other)).ok,true);assert.equal((await rpc('renew','qa-v1',{bundleId:freshId},other,holder)).ok,true);await rpc('release','qa-v1',{bundleId:freshId},other,holder);
  const before=await qa.read();await assert.rejects(()=>rpc('receipt','qa-v1',{...request,command:{...request.command,items:[{...item,description:'changed'}]}}),/operation-mismatch/);assert.equal((await rpc('receipt','qa-v1',request)).status,'committed');assert.deepEqual(await qa.read(),before);
 });
 await check('two-item-submit-failure-is-atomic-and-selection-overflow-denied',async()=>{
  const first={...item,id:'batch-atomic-1'},second={...item,id:'batch-atomic-2',applicationDate:'invalid'},bid=crypto.randomUUID(),before=await qa.read();
  assert.equal((await rpc('claim','qa-v1',{bundleId:bid,ids:[first.id,second.id],creation:true})).ok,true);
  const rejected=await rpc('submit','qa-v1',{operationId:'batch-atomic-reject',bundleId:bid,command:{type:'create',items:[first,second]}});assert.equal(rejected.status,'rejected');assert.deepEqual(await qa.read(),before);await rpc('release','qa-v1',{bundleId:bid});
  await assert.rejects(()=>rpc('claim','qa-v1',{bundleId:crypto.randomUUID(),ids:Array.from({length:101},(_,i)=>'over-limit-'+i),creation:true}),/selection-invalid/);assert.deepEqual(await qa.read(),before);
 });
 console.log(JSON.stringify({status:'PASS',output,caseCount:evidence.cases.length}));
}catch(error){failure=error;evidence.error=error.stack;console.error(error.stack);}
finally{try{await qa?.close();await native?.close();}catch(error){failure??=error;evidence.cleanupError=error.message;}evidence.status=failure?'FAIL':'PASS';fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({output,status:evidence.status}));if(failure)process.exitCode=1;}

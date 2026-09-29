import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations,installTrackingFieldRevision} from './tracking-browser-fixture.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'completion-close-native-'));
const evidence={label:'真實 PostgreSQL＋測試資料，非正式 Supabase',cases:[],productionContacted:false};
let native,qa,failure;
const check=async(name,run)=>{await run();evidence.cases.push(name);console.log('PASS',name);};
try{
 native=await createNativeRecordQa(output,evidence,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,tracking:true,taskMember:true,hmr:false,databaseFactory:async()=>native.adapter});
 await installTrackingBrowserMigrations(qa.db);await installTrackingFieldRevision(qa.db);
 const rpc=async(action,payload={},vessel='qa-v1')=>qa.db.transaction(async tx=>{await tx.exec('set local role anon');return (await tx.query('select public.ship_dynamics_tracking_public_v1($1,$2,$3::uuid,$4::uuid,$5,$6::jsonb) result',[qa.workspace,vessel,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',action,JSON.stringify(payload)])).rows[0].result;});
 const submit=async(name,ids,make,creation=false)=>{const bundleId=randomUUID(),claim=await rpc('claim',{bundleId,ids,creation});assert.equal(claim.ok,true,JSON.stringify(claim));const request={operationId:name,bundleId,command:make(claim.data.trackingItems)};try{return {request,result:await rpc('submit',request)};}finally{await rpc('release',{bundleId});}};
 const base={kind:'engineering',requestType:'repair',vesselId:'qa-v1',description:'工程完工原生測試',applicationDate:'2026-09-01',urgency:'normal',progress:'原進度',supplementalNotes:'保留补充',expectedDate:'',deliveryStatus:'not-delivered'};
 const items=['first','second','unselected'].map(id=>({...base,id,referenceNo:'NOTE-'+id}));
 assert.equal((await submit('note-create',items.map(r=>r.id),()=>({type:'create',items}),true)).result.status,'committed');
 assert.equal((await submit('note-sync',['first'],rows=>({type:'sync',reporterNameAndRole:'測試大副',items:[{id:'first',expectedUpdatedAt:rows.find(r=>r.id==='first').updatedAt,item:{id:'note-case',reportDate:'2026-09-01',reportSource:'日常',description:'保留內控內容',priority:'低',category:'維修',isAware:false,status:'原進度',departments:['督導'],expectedDate:''}}]}))).result.status,'committed');


 const prior='supabase/migrations/20260929120000_tracking_delivery_close.sql';await qa.db.exec(fs.readFileSync(prior,'utf8'));
 const plain=(rows,ids=['first'],date='2026-09-29',flag)=>({type:'edit',items:ids.map(id=>({id,expectedUpdatedAt:rows.find(r=>r.id===id).updatedAt,changes:{completionDate:date},...(flag===undefined?{}:{closeOnCompletion:flag})}))});
 const command=(rows,ids=['first','second'])=>plain(rows,ids,'2026-09-29',true);
 const old=await submit('completion-legacy',['first'],rows=>plain(rows));assert.equal(old.result.status,'committed');
 const signatures=['ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)','public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)','public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb)'];
 const acl=async()=>(await qa.db.query('select oid::text,proacl::text,prosecdef,proconfig from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows;
 const migration='supabase/migrations/20260929180000_tracking_completion_close.sql';
 if(!process.argv.includes('--before-upgrade'))await check('CC-N01-forward-known-predecessor-rerun-CRLF-ACL-data-old-receipt',async()=>{
  const before=await qa.read(),originalAcl=await acl(),sql=fs.readFileSync(migration,'utf8');evidence.migrationSha256=createHash('sha256').update(sql).digest('hex');
  const original=(await qa.db.query('select pg_get_functiondef($1::regprocedure) d',[signatures[0]])).rows[0].d;
  await qa.db.exec(original.replace('begin','begin -- unknown predecessor QA'));
  await assert.rejects(qa.db.exec(sql),/tracking-completion-close-predecessor-mismatch/);await qa.db.exec('rollback');await qa.db.exec(original);
  await qa.db.exec(sql);await qa.db.exec(sql.split(String.fromCharCode(10)).join(String.fromCharCode(13,10)));assert.deepEqual(await qa.read(),before);assert.deepEqual(await acl(),originalAcl);assert.equal((await rpc('submit',old.request)).replayed,true);assert.deepEqual(await qa.read(),before);
 });
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const {runTrackingCommand}=await qa.loadModule('/src/tracking/trackingWorkflow.ts');
 const {updateInternalControlCase}=await qa.loadModule('/src/internalControlData.ts');
 const office=async(name,mutate,options={})=>{
  const base=(await qa.read()).payload,user=base.users.find(u=>u.role==='owner');
  const next=await mutate(structuredClone(base),user,new Date().toISOString()),operations=buildCloudBlockPatch(base,next),guards=[];
  const keys=[...new Set(operations.filter(o=>o.kind==='entity'&&['trackingItems','internalControlCases','tasks'].includes(o.collection)).map(o=>(o.collection==='trackingItems'?'tracking:':o.collection==='tasks'?'task:':o.expected?'internal-control:':'internal-control-create:')+o.entityId))].sort();
  try{
   for(const key of keys){const lease=(await qa.db.query("select claim_ship_dynamics_edit_lock($1,$2,'qa-delivery-office','QA OFFICE',75) result",[qa.workspace,key])).rows[0].result;assert.equal(lease.ok,true);guards.push({section_key:key,locked_by:lease.locked_by,lease_version:lease.lease_version});}
   let guard=(await qa.db.query('select ship_dynamics_actor_guard($1::jsonb,$2) result',[JSON.stringify(base),user.id])).rows[0].result;
   if(options.guard)guard=options.guard(guard);
   if(options.operations)options.operations(operations);
   return (await qa.db.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) result',[qa.workspace,name,JSON.stringify(operations),'QA OFFICE',user.id,JSON.stringify(guard),null,JSON.stringify(options.noLocks?[]:guards)])).rows[0].result;
  }finally{await qa.db.query("delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by='qa-delivery-office'",[qa.workspace]);}
 };


 const complete=async(name)=>office(name,(d,u,at)=>runTrackingCommand(d,command(d.trackingItems),{actorId:u.id,at,operationId:name}));
 const reopen=async(name)=>{const r=await submit(name,['first','second'],rows=>({type:'lifecycle',action:'reopen',targets:['first','second'].map(id=>({entry:'tracking',id,expectedUpdatedAt:rows.find(r=>r.id===id).updatedAt}))}));assert.equal(r.result.status,'committed');};
 const prove=(before,after)=>{assert.equal(after.revision,before.revision+1);for(const id of ['first','second']){const row=after.payload.trackingItems.find(r=>r.id===id),old=before.payload.trackingItems.find(r=>r.id===id);assert.equal(row.isClosed,true);assert.equal(row.completionDate,'2026-09-29');assert.equal(row.closedDate,row.completionDate);assert.equal(row.closureOutcome,'completed');assert.deepEqual(row.events.slice(-2).map(e=>e.action),['completion','close']);assert.equal(row.events.at(-1).operationId,row.events.at(-2).operationId);assert.equal(row.events.at(-1).at,row.events.at(-2).at);for(const k of ['progress','statusLogs','supplementalNotes','expectedDate','deliveryStatus'])assert.deepEqual(row[k],old[k]);}
  const c=after.payload.internalControlCases.find(r=>r.id==='note-case'),t=after.payload.tasks.find(r=>r.id===c.linkedTaskId);for(const end of [c,t].filter(Boolean)){assert.equal(end.isClosed,true);assert.equal(end.closedDate,'2026-09-29');assert.equal(end.trackingLifecycle.at(-1).action,'close');const old=before.payload[end===c?'internalControlCases':'tasks'].find(r=>r.id===end.id);for(const k of ['description','status','statusLogs','expectedDate'])assert.deepEqual(end[k],old[k]);}assert.deepEqual(after.payload.trackingItems.filter(r=>!['first','second'].includes(r.id)),before.payload.trackingItems.filter(r=>!['first','second'].includes(r.id)));};
 const link=await office('completion-task-link',(d,u,at)=>{const c=d.internalControlCases.find(r=>r.id==='note-case');updateInternalControlCase(d,{...c,syncToTask:true},c.updatedAt,u,at,{categories:['維修'],expectedDate:'2026-11-01',ownerUserIds:[u.id],isAbnormal:false});return d;});assert.equal(link.ok,true,JSON.stringify(link));
 await check('CC-N02-ship-linked-triple-one-revision-same-date-exact-replay',async()=>{const before=await qa.read(),{request,result}=await submit('completion-ship',['first','second'],command);assert.equal(result.status,'committed',JSON.stringify(result));const after=await qa.read();prove(before,after);assert.equal((await rpc('submit',request)).replayed,true);assert.deepEqual(await qa.read(),after);const bad=structuredClone(request);bad.command.items[0].changes.completionDate='2026-09-28';await assert.rejects(rpc('submit',bad),/reuse|mismatch/);assert.deepEqual(await qa.read(),after);});
 await check('CC-N03-already-closed-reject-nochange',async()=>{const before=await qa.read(),{result}=await submit('completion-closed',['first','second'],command);assert.equal(result.status,'rejected');assert.deepEqual(await qa.read(),before);});
 await reopen('completion-reopen-ship');
 await check('CC-N04-shore-linked-triple-one-revision',async()=>{const before=await qa.read(),r=await complete('completion-shore');assert.equal(r.ok,true,JSON.stringify(r));prove(before,await qa.read());});
 await reopen('completion-reopen-shore');
 await check('CC-N05-invalid-later-item-strict-boolean-extra-change-dates-CAS',async()=>{
  for(const [i,patch] of [{closeOnCompletion:'true'},{closeOnCompletion:null},{changes:{completionDate:''}},{changes:{completionDate:'2026-02-30'}},{changes:{completionDate:'2026-08-31'}},{changes:{completionDate:9}},{changes:{completionDate:'2026-09-29',description:'extra'}},{expectedUpdatedAt:'stale'},{fakeFlag:true},{changes:{completionDate:'2026-09-29',closeOnCompletion:true}}].entries()){const before=await qa.read(),r=await submit('completion-negative-'+i,['first','second'],rows=>{const c=command(rows);Object.assign(c.items[1],patch);return c;});assert.equal(r.result.status,'rejected',JSON.stringify(r.result));assert.deepEqual(await qa.read(),before);}
 });
 await check('CC-N06-missing-lease-and-wrong-vessel-nochange',async()=>{const before=await qa.read();const r=await rpc('submit',{operationId:'completion-no-lease',bundleId:randomUUID(),command:command(before.payload.trackingItems)});assert.equal(r.status,'rejected',JSON.stringify(r));await assert.rejects(rpc('claim',{bundleId:randomUUID(),ids:['first'],creation:false},'qa-v2'),/ship-tracking-source-unavailable/);assert.deepEqual(await qa.read(),before);});
 await check('CC-N07-shore-canonical-source-case-task-history-fake-flag-rejected',async()=>{
  const tampers=[d=>{d.trackingItems[0].description='extra';},d=>{d.internalControlCases.find(r=>r.id==='note-case').description='extra';},d=>{d.tasks.find(r=>r.internalControlCaseId==='note-case').status='extra';},d=>{d.trackingItems[0].events.at(-2).operationId='fake';},d=>{d.trackingItems[0].events.splice(-2,1);d.trackingItems[0].completionDate='2026-09-28';},d=>{d.trackingItems[0].closeOnCompletion=true;},d=>{d.trackingItems[0].progress='extra';}];
  for(const [i,tamper] of tampers.entries()){const before=await qa.read(),r=await office('completion-tamper-'+i,(d,u,at)=>{const n=runTrackingCommand(d,command(d.trackingItems),{actorId:u.id,at,operationId:'completion-tamper-'+i});tamper(n);return n;});assert.equal(r.ok,false,JSON.stringify(r));assert.deepEqual(await qa.read(),before);}
 });
 await check('CC-N08-dual-permission-validator-and-linked-date-rule',async()=>{
  const before=(await qa.read()).payload,u=before.users.find(r=>r.role==='owner'),at=new Date().toISOString(),n=runTrackingCommand(before,command(before.trackingItems),{actorId:u.id,at,operationId:'permission-probe'}),ops=buildCloudBlockPatch(before,n);
  const guard=(await qa.db.query('select ship_dynamics_actor_guard($1::jsonb,$2) result',[JSON.stringify(before),u.id])).rows[0].result;
  const locks=ops.filter(o=>['trackingItems','internalControlCases','tasks'].includes(o.collection)).map(o=>({section_key:({trackingItems:'tracking:',internalControlCases:'internal-control:',tasks:'task:'})[o.collection]+o.entityId}));
  for(const permission of ['editBusinessContent','closeTasks']){const g=structuredClone(guard);g.actor.role='operator';g.effectivePermissions={...g.effectivePermissions,editBusinessContent:true,closeTasks:true,[permission]:false};const r=await qa.db.query('select ship_dynamics_tracking_validate_v1($1,$2::jsonb,$3,$4::jsonb,$5::jsonb) result',[qa.workspace,JSON.stringify(ops),u.id,JSON.stringify(g),JSON.stringify(locks)]);assert.equal(r.rows[0].result,'tracking-permission-denied');}
  // Same valid operations, no locks: validator must still reject. No forged write authority is used.
  const noLocks=await qa.db.query('select ship_dynamics_tracking_validate_v1($1,$2::jsonb,$3,$4::jsonb,$5::jsonb) result',[qa.workspace,JSON.stringify(ops),u.id,JSON.stringify(guard),'[]']);assert.equal(noLocks.rows[0].result,'tracking-lock-required');
  const moved=await office('completion-case-date',(d,u,at)=>{const c=d.internalControlCases.find(r=>r.id==='note-case');updateInternalControlCase(d,{...c,reportDate:'2026-09-30'},c.updatedAt,u,at,{categories:['維修'],expectedDate:'2026-11-01',ownerUserIds:[u.id],isAbnormal:false});return d;});assert.equal(moved.ok,true,JSON.stringify(moved));
  const state=await qa.read(),r=await submit('completion-case-date-reject',['first','second'],command);assert.equal(r.result.status,'rejected');assert.deepEqual(await qa.read(),state);
 });
 await check('CC-N09-default-and-false-plain-completion-preserve-old-date-policy',async()=>{for(const flag of [undefined,false]){const before=await qa.read(),r=await submit('completion-default-'+String(flag),['first'],rows=>plain(rows,['first'],'2026-08-01',flag));assert.equal(r.result.status,'committed',JSON.stringify(r.result));const after=await qa.read(),row=after.payload.trackingItems.find(r=>r.id==='first');assert.equal(row.isClosed,false);assert.equal(row.completionDate,'2026-08-01');assert.deepEqual(after.payload.internalControlCases,before.payload.internalControlCases);}});
 await check('CC-N10-nonengineering-reject',async()=>{const supply={...base,id:'supply-only',referenceNo:'SUPPLY',kind:'supply',requestType:'spares'};assert.equal((await submit('completion-create-supply',['supply-only'],()=>({type:'create',items:[supply]}),true)).result.status,'committed');const before=await qa.read(),r=await submit('completion-nonengineering',['supply-only'],rows=>command(rows,['supply-only']));assert.equal(r.result.status,'rejected');assert.deepEqual(await qa.read(),before);});
 const readback='supabase/verification/tracking-completion-close-readback.sql';if(!process.argv.includes('--before-upgrade')){const rows=(await qa.db.query(fs.readFileSync(readback,'utf8'))).rows;assert.equal(rows[0].status,'PASS',JSON.stringify(rows));evidence.readback=rows[0];}
}catch(error){failure=error;evidence.error=error.stack;console.error(error.stack);}
finally{try{await qa?.close();await native?.close();}catch(error){failure??=error;evidence.cleanupError=error.message;}evidence.status=failure?'FAIL':'PASS';fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,output,caseCount:evidence.cases.length}));if(failure)process.exitCode=1;}
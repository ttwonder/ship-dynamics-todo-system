// Synthetic only; owned native cluster. No production connection accepted.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {seedItineraryFixture} from './record-itinerary-local-fixture.mjs';
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'external QA_EVIDENCE_ROOT required');
const predecessor=process.env.QA_PREDECESSOR_MODULE;
assert.ok(predecessor&&path.isAbsolute(predecessor),'verified predecessor fixture path required');
// The verified installer only admits a cluster under its own marked cache.
const run=fs.mkdtempSync(path.join(path.dirname(predecessor),'tracking-native-'));
const receipt={kind:'tracking-records-native',cases:[],productionContacted:false};
const migration='supabase/migrations/20260924160000_tracking_records.sql';
let native,vite;
const check=async(id,fn)=>{await fn();receipt.cases.push({id,status:'PASS'});};
try {
 native=await createNativeRecordQa(run,receipt);
 const db=native.adapter;
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.r;
 const predecessor=process.env.QA_PREDECESSOR_MODULE;
 assert.ok(predecessor&&path.isAbsolute(predecessor),'verified predecessor fixture path required');
 const installed=await(await import(pathToFileURL(predecessor))).installPredecessor(db);
 assert.equal(installed.status,'PASS');

 vite=await createServer({cacheDir:path.join(run,'vite-cache'),server:{middlewareMode:true,hmr:false,watch:null},appType:'custom',logLevel:'silent'});
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {buildCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudBlockPatch.ts');
 const data=createInitialData(),at='2026-09-24T00:00:00.000Z',key='ship-dynamics-main';
 data.revision=1;data.updatedAt=at;
 data.users=[{...data.users[0],id:'qa-owner',name:'QA OWNER',username:'qa-owner',role:'owner',isActive:true,managedVesselIds:[],passwordHash:'',createdAt:at,updatedAt:at}];
 data.users.push({...data.users[0],id:'qa-progress',name:'QA PROGRESS',username:'qa-progress',role:'operator',managedVesselIds:['v1']});
 data.users.push({...data.users[0],id:'qa-creator',name:'QA CREATOR',username:'qa-creator',role:'admin',managedVesselIds:['v1']});
 data.settings.rolePermissions.admin={...data.settings.rolePermissions.admin,createTasks:true,closeTasks:false};
 data.settings.rolePermissions.operator={...data.settings.rolePermissions.operator,editBusinessContent:true,closeTasks:false,createTasks:false};
 data.vessels=[{...data.vessels[0],id:'v1',isActive:true,assignedUserIds:[],delegateManagers:[]}];
 for(const name of ['tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs','trackingItems'])data[name]=[];
 await db.query('insert into ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values($1,$2::jsonb,1,$3)',[key,JSON.stringify(data),'QA OWNER']);
 await seedItineraryFixture(db,vite,key,data.vessels);
 await db.exec(fs.readFileSync('supabase/release/05_install_record_storage.sql','utf8'));
 // Exercise the installed published records authority, not its bootstrap bypass.
 for(const file of ['07_freeze_latest_legacy.sql','08_pause_business.sql','09_stage_first_records.sql','10_publish_records_paused.sql','11_resume_published_source.sql'])await db.exec(fs.readFileSync('supabase/release/'+file,'utf8'));
 if(fs.existsSync(migration)){await db.exec(fs.readFileSync(migration,'utf8'));receipt.migrationSha256=createHash('sha256').update(fs.readFileSync(migration)).digest('hex');}
 assert.equal((await q('select read_ship_dynamics_browser_authority_v1($1) r',[key])).source,'records-v1');
 const current=async()=> (await q('select read_ship_dynamics_records_v1($1) r',[key])).payload;
 const source={id:'qa-source',kind:'supply',vesselId:'v1',referenceNo:'QA-001',description:'合成測試',applicationDate:'2026-09-24',urgency:'normal',progress:'',supplementalNotes:'',expectedDate:'',deliveryStatus:'not-delivered',isClosed:false,createdBy:'qa-owner',updatedBy:'qa-owner',createdAt:at,updatedAt:at,statusLogs:[],events:[]};
 const before=await current(),next=structuredClone(before);next.trackingItems=[source];
 const make=async(base,next,id,actor='qa-owner')=>{
  const operations=buildCloudBlockPatch(base,next);
  const actorGuard=await q('select ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(base),actor]);
  const guards=[];
  for(const op of operations.filter(o=>o.kind==='entity'&&['trackingItems','internalControlCases','tasks'].includes(o.collection))){
   const section_key=op.collection==='trackingItems'?`tracking:${op.entityId}`:op.collection==='internalControlCases'?`${op.expected?'internal-control':'internal-control-create'}:${op.entityId}`:`task:${op.entityId}`;
   const lease=await q("select claim_ship_dynamics_edit_lock($1,$2,'tracking-qa','QA',300) r",[key,section_key]);
   assert.equal(lease.ok,true,section_key);guards.push({section_key,locked_by:lease.locked_by,lease_version:lease.lease_version});
  }
  return [key,id,JSON.stringify(operations),'QA',actor,JSON.stringify(actorGuard),null,JSON.stringify(guards)];
 };
 const apply=async args=>{
  await db.exec('begin;set local role anon');
  try{const r=await q('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',args);await db.exec('commit');return r;}
  catch(e){await db.exec('rollback');throw e;}
 };
 const request=await make(before,next,'tracking-create');
 await check('source-write-requires-exact-live-lease',async()=>{
  const missing=[...request];missing[1]='missing-source-lease';missing[7]='[]';
  const result=await apply(missing);assert.equal(result.ok,false,'source without lease must be rejected');assert.equal(result.code,'tracking-lock-required');
  assert.deepEqual((await current()).trackingItems || [],[]);
 });
 await check('native-independent-source-create',async()=>{
  const result=await apply(request);assert.equal(result.ok,true,'tracking source must be accepted by installed records writer: '+result.code);
  assert.deepEqual((await current()).trackingItems,[source]);
  assert.equal((await current()).internalControlCases.length,0);assert.equal((await current()).tasks.length,0);
 });
 await check('exact-retry-receipt',async()=>{const rev=(await current()).revision;assert.equal((await apply(request)).replayed,true);assert.equal((await current()).revision,rev);});
 await check('v1-read-remains-nine-collections',async()=>{const r=await q("select read_ship_dynamics_record_scopes_v1($1,'full','{}','[]') r",[key]);assert.equal(Object.keys(r.collections).length,9);assert.equal(r.collections.trackingItems,undefined);});
 await check('v2-vessel-scope-and-real-consumer',async()=>{
  const {consumeRecordScopes,recordScopePayload}=await vite.ssrLoadModule('/src/cloudRecordScopes.ts');
  const scope={targets:[],trackingVesselIds:['v1']};
  const r=await q("select read_ship_dynamics_record_scopes_v2($1,'targets','{}','[]','[\"v1\"]') r",[key]);
  assert.deepEqual(recordScopePayload(consumeRecordScopes(r,key,scope,null)).trackingItems,[source]);
  const empty=await q("select read_ship_dynamics_record_scopes_v2($1,'targets','{}','[]','[\"other\"]') r",[key]);
  assert.deepEqual(empty.collections.trackingItems.ids,[]);
 });
 const {runTrackingCommand,prefillTrackingCase}=await vite.ssrLoadModule('/src/tracking/trackingWorkflow.ts');
 const context=(operationId)=>({actorId:'qa-owner',at:'2026-09-25T00:00:00.000Z',operationId});
 await check('native-explicit-sync-one-source-one-case-task',async()=>{
  const b=await current(),draft=prefillTrackingCase(b,b.trackingItems[0],'c1').item;
  draft.departments=[b.settings.departments[0]];draft.syncToTask=true;
  const n=runTrackingCommand(b,{type:'sync',items:[{id:source.id,expectedUpdatedAt:source.updatedAt,item:draft,projection:{categories:['其他'],expectedDate:'',ownerUserIds:[],isAbnormal:false}}]},context('sync'));
  assert.equal((await apply(await make(b,n,'sync'))).ok,true);
  const read=await current();assert.equal(read.internalControlCases.length,1);assert.equal(read.tasks.length,1);assert.equal(read.internalControlCases[0].trackingItemId,source.id);
 });
 await check('partial-linked-close-is-rejected',async()=>{
  const b=await current(),n=structuredClone(b);
  for(const m of [n.internalControlCases[0],n.tasks[0]]){m.isClosed=true;m.closedDate='2026-09-25';m.closedBy='qa-owner';}
  const r=await apply(await make(b,n,'partial-close'));
  assert.equal(r.ok,false,'linked source cannot remain open after case/task closure');assert.equal(r.code,'tracking-lifecycle-inconsistent');
  assert.deepEqual(await current(),b);
 });
 const commit=async(b,n,id,actor='qa-owner')=>{const r=await apply(await make(b,n,id,actor));assert.equal(r.ok,true,id+': '+r.code);return current();};
 await check('native-progress-only-permission-preserves-prefill',async()=>{
  const b=await current(),c={...context('progress'),actorId:'qa-progress'};
  const n=runTrackingCommand(b,{type:'progress',items:[{id:source.id,expectedUpdatedAt:b.trackingItems[0].updatedAt,text:'only append, never overwrite DL'}]},c);
  const r=await commit(b,n,'progress','qa-progress');
  assert.equal(r.trackingItems[0].progress,r.internalControlCases[0].status);assert.equal(r.tasks[0].status,r.trackingItems[0].progress);
  for(const f of ['description','expectedDate','category','departments'])assert.deepEqual(r.internalControlCases[0][f],b.internalControlCases[0][f]);
 });
 await check('valid-wrong-source-lease-does-not-alias',async()=>{
  const b=await current(),n=runTrackingCommand(b,{type:'delivery',items:[{id:source.id,expectedUpdatedAt:b.trackingItems[0].updatedAt,status:'delivered',date:'2026-09-26'}]},context('alias'));
  const req=await make(b,n,'alias');const other=await q("select claim_ship_dynamics_edit_lock($1,'tracking:other','other-lease','QA',300) r",[key]);
  req[7]=JSON.stringify([{section_key:'tracking:other',locked_by:other.locked_by,lease_version:other.lease_version}]);
  assert.equal((await apply(req)).code,'tracking-lock-required');assert.deepEqual(await current(),b);
 });
 await check('progress-permission-cannot-close-or-forge-delivery',async()=>{
  const b=await current(),n=runTrackingCommand(b,{type:'lifecycle',action:'close',date:'2026-09-26',targets:[{entry:'tracking',id:source.id,expectedUpdatedAt:b.trackingItems[0].updatedAt}]},context('forged-close'));
  const r=await apply(await make(b,n,'forged-close','qa-progress'));assert.equal(r.code,'tracking-permission-denied');assert.deepEqual(await current(),b);
 });
 await check('late-receipt-fault-rolls-back-entire-linked-group',async()=>{
  const b=await current(),n=runTrackingCommand(b,{type:'lifecycle',action:'close',date:'2026-09-26',targets:[{entry:'tracking',id:source.id,expectedUpdatedAt:b.trackingItems[0].updatedAt}]},context('fault'));
  await db.exec("create function qa_tracking_late_fault() returns trigger language plpgsql as $$begin if new.operation_id='fault' then raise exception 'qa-late-receipt';end if;return new;end$$;create trigger qa_tracking_late_fault before insert on ship_dynamics_record_receipts for each row execute function qa_tracking_late_fault()");
  await assert.rejects(()=>make(b,n,'fault').then(apply),e=>e.message==='qa-late-receipt');
  assert.deepEqual(await current(),b);assert.equal(await q("select count(*)::int r from ship_dynamics_record_receipts where operation_id='fault'"),0);
  await db.exec('drop trigger qa_tracking_late_fault on ship_dynamics_record_receipts;drop function qa_tracking_late_fault()');
 });
 await check('stale-source-CAS-and-exact-replay',async()=>{
  const b=await current(),n=runTrackingCommand(b,{type:'delivery',items:[{id:source.id,expectedUpdatedAt:b.trackingItems[0].updatedAt,status:'delivered',date:'2026-09-26'}]},context('delivered'));
  const req=await make(b,n,'delivered');assert.equal((await apply(req)).ok,true);const r=await current();
  const stale=[...req];stale[1]='different-operation';assert.equal((await apply(stale)).ok,false);assert.deepEqual(await current(),r);
  assert.equal((await apply(req)).replayed,true);assert.deepEqual(await current(),r);
  assert.equal(r.trackingItems[0].actualDeliveryDate,'2026-09-26');assert.equal(r.internalControlCases[0].isClosed,false);
 });
 await check('v1-client-edit-preserves-new-collection',async()=>{
  const b=await current();const v1=await q("select read_ship_dynamics_record_scopes_v1($1,'full','{}','[]') r",[key]);
  const {consumeRecordScopes,recordScopePayload}=await vite.ssrLoadModule('/src/cloudRecordScopes.ts');
  const old=recordScopePayload(consumeRecordScopes(v1,key,'full',null)),n=structuredClone(old);
  const standalone=prefillTrackingCase(b,source,'old-client-unlinked').item;delete standalone.trackingItemId;standalone.departments=[b.settings.departments[0]];
  const {createInternalControlCases}=await vite.ssrLoadModule('/src/internalControlData.ts');createInternalControlCases(n,[standalone],b.users[0],context('old-client').at);
  n.internalControlCases.push(n.internalControlCases.shift());
  assert.equal((await apply(await make(old,n,'old-client'))).ok,true);assert.deepEqual((await current()).trackingItems,b.trackingItems);
 });
 const ic=await vite.ssrLoadModule('/src/internalControlData.ts');
 await check('native-source-close-case-correction-task-reopen',async()=>{
  let b=await current(),n=runTrackingCommand(b,{type:'lifecycle',action:'close',date:'2026-09-26',targets:[{entry:'tracking',id:source.id,expectedUpdatedAt:b.trackingItems[0].updatedAt}]},context('close'));
  b=await commit(b,n,'close');assert.ok([b.trackingItems[0],b.internalControlCases[0],b.tasks[0]].every(m=>m.isClosed&&m.closedDate==='2026-09-26'));
  n=structuredClone(b);ic.updateInternalControlCase(n,{...n.internalControlCases[0],closedDate:'2026-09-27'},n.internalControlCases[0].updatedAt,n.users[0],'2026-09-27T00:00:00.000Z');
  b=await commit(b,n,'correct');assert.ok([b.trackingItems[0],b.internalControlCases[0],b.tasks[0]].every(m=>m.closedDate==='2026-09-27'));
  n=structuredClone(b);const prior=structuredClone(n.tasks[0]);n.tasks[0].isClosed=false;delete n.tasks[0].closedDate;delete n.tasks[0].closedBy;
  ic.reconcileInternalControlAfterTaskSave(n,prior,n.tasks[0],n.users[0],'2026-09-28T00:00:00.000Z');
  b=await commit(b,n,'reopen');assert.ok([b.trackingItems[0],b.internalControlCases[0],b.tasks[0]].every(m=>!m.isClosed&&!m.closedDate));
  assert.equal(b.trackingItems[0].deliveryStatus,'delivered');assert.equal(b.trackingItems[0].actualDeliveryDate,'2026-09-26');assert.equal(b.trackingItems[0].events.filter(e=>e.action==='close').length,1);
 });
 await check('native-task-delete-preserves-source-invalid-history',async()=>{
  const b=await current(),n=structuredClone(b);ic.closeLinkedInternalControlCaseAfterTaskDelete(n,n.tasks[0],n.users[0],'2026-09-29T00:00:00.000Z');n.tasks=[];
  const r=await commit(b,n,'delete-task');assert.equal(r.trackingItems[0].linkState,'invalid');assert.equal(r.internalControlCases[0].trackingLinkState,'invalid');assert.equal(r.trackingItems[0].isClosed,false);
 });
 await check('engineering-siblings-cancellation-is-not-completion',async()=>{
  let b=await current();let n=runTrackingCommand(b,{type:'create',items:[{...source,id:'e1',kind:'engineering',completionDate:'2026-09-25'},{...source,id:'e2',kind:'engineering'}]},context('engineering-create'));
  b=await commit(b,n,'engineering-create');n=runTrackingCommand(b,{type:'lifecycle',action:'close',date:'2026-09-29',outcome:'cancelled',targets:[{entry:'tracking',id:'e1',expectedUpdatedAt:b.trackingItems.find(s=>s.id==='e1').updatedAt}]},context('engineering-cancel'));
  b=await commit(b,n,'engineering-cancel');assert.equal(b.trackingItems.find(s=>s.id==='e1').closureOutcome,'cancelled');assert.equal(b.trackingItems.find(s=>s.id==='e2').isClosed,false);assert.equal(b.trackingItems.find(s=>s.id==='e1').completionDate,'2026-09-25');
  n=structuredClone(b);n.trackingItems.find(s=>s.id==='e1').closureOutcome='completed';n.trackingItems.find(s=>s.id==='e1').updatedBy='qa-progress';
  assert.equal((await apply(await make(b,n,'forged-outcome','qa-progress'))).code,'tracking-permission-denied','classification of closed engineering cannot be granted by update-only permission');assert.deepEqual(await current(),b);
 });
 await check('create-permission-is-not-closure-permission',async()=>{
  // A separate existing shore role can create, but has no closure permission.
  const b=await current(),n=structuredClone(b);n.trackingItems.push({...source,id:'forged-new-closed',isClosed:true,closedDate:'2026-09-29',closedBy:'qa-creator',createdBy:'qa-creator',updatedBy:'qa-creator'});
  assert.equal((await apply(await make(b,n,'forged-new-closed','qa-creator'))).code,'tracking-permission-denied');assert.deepEqual(await current(),b);
 });
 await check('morning-and-tracking-scope-union-retains-standalone-sources',async()=>{
  const globals={window:globalThis.window,localStorage:globalThis.localStorage,fetch:globalThis.fetch};
  const config={supabaseUrl:'http://127.0.0.1:54329',supabaseAnonKey:'local-fixture-only',workspaceKey:key,tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'scoped-v1'};
  const requests=[];
  try {
   globalThis.window={SHIP_DYNAMICS_SUPABASE_CONFIG:config,setInterval,clearInterval};
   globalThis.localStorage={getItem:()=>null,setItem:()=>{throw new Error('No browser storage writes in this fixture');}};
   globalThis.fetch=async(input,init={})=>{
    const url=new URL(String(input));assert.equal(url.origin,config.supabaseUrl,'outbound network forbidden');
    assert.equal(url.pathname,'/rest/v1/rpc/read_ship_dynamics_record_scopes_v2');assert.equal(init.method,'POST');
    const args=JSON.parse(String(init.body));requests.push(args);
    const r=await q('select read_ship_dynamics_record_scopes_v2($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) r',[args.p_workspace_key,args.p_scope,JSON.stringify(args.p_versions),JSON.stringify(args.p_targets),JSON.stringify(args.p_vessel_ids)]);
    return new Response(JSON.stringify(r),{status:200,headers:{'content-type':'application/json'}});
   };
   const {fetchCloudData}=await vite.ssrLoadModule('/src/cloud.ts');
   const {unionRecordScopes}=await vite.ssrLoadModule('/src/cloudRecordScopes.ts');
   const expected=(await current()).trackingItems.map(s=>s.id).sort();
   const combined=unionRecordScopes('morning',{targets:[],trackingVesselIds:['v1']});
   const result=await fetchCloudData(config,undefined,undefined,combined);
   assert.deepEqual(result.trackingItems.map(s=>s.id).sort(),expected,'visiting morning before tracking must not lose standalone vessel sources');
   assert.deepEqual(requests.at(-1).p_vessel_ids,['v1'],'the coherent detail read retains explicitly requested vessel coverage');
   const ordinary=await fetchCloudData(config,undefined,undefined,'morning');
   assert.equal(ordinary.trackingItems.length,0,'ordinary morning does not load unrequested standalone sources');
  } finally {globalThis.window=globals.window;globalThis.localStorage=globals.localStorage;globalThis.fetch=globals.fetch;}
 });
 await check('forward-migration-rerun-and-private-readback',async()=>{
  const b=await current();await db.exec(fs.readFileSync(migration,'utf8'));assert.deepEqual(await current(),b);
  const readback=await native.observer.query(fs.readFileSync('supabase/verification/tracking-records-readback.sql','utf8'));
  const result=readback.flatMap(r=>r.rows || []).find(r=>r.tracking_readback)?.tracking_readback;
  assert.ok(result);for(const [name,value] of Object.entries(result))if(name!=='kind')assert.equal(value,true,name);receipt.readback=result;
 });
 receipt.ok=true;
} catch(e){receipt.ok=false;receipt.error={code:e.code||'ASSERT',message:e.message,where:e.where};process.exitCode=1;}
finally {
 await vite?.close();await native?.close();
 fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({receipt:path.join(run,'receipt.json'),ok:receipt.ok,cases:receipt.cases,error:receipt.error}));
}

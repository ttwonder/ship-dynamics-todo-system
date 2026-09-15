import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash,randomUUID} from 'node:crypto';

// Actual original-App action bodies and authority reader; controlled I/O only.
const source=fs.readFileSync('src/App.tsx','utf8');
const authoritySource=fs.readFileSync('src/cloudSourceAuthority.ts','utf8');
function reader(text,name,kind=ts.ScriptKind.TSX){
 const ast=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,kind);
 const find=test=>{const found=[];const walk=n=>{if(test(n))found.push(n);ts.forEachChild(n,walk);};walk(ast);assert.equal(found.length,1);return found[0];};
 return {local:name=>find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name).initializer.getText(ast),decl:name=>find(n=>(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&n.name?.text===name).getText(ast).replace(/^export /,'')};
}
const app=reader(source,'App.tsx'),authority=reader(authoritySource,'cloudSourceAuthority.ts',ts.ScriptKind.TS);
const compile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const common=`${authority.decl('BrowserAuthorityError')}\n${authority.decl('authorityConfig')}\nconst sameAuthority=${authority.local('sameAuthority')};\nconst authorityFloorIdentity=${authority.local('authorityFloorIdentity')};\nglobalThis.readBoundCloudData=(()=>{const fetchCloudData=(...args)=>fetchCloudDataRpc(...args);return ${authority.decl('readBoundCloudData')};})();\nglobalThis.fetchCloudData=${app.local('fetchCloudData')};`;
const code=compile(`${common}\nglobalThis.assertRemoteExtendsDurableHistory=${app.local('assertRemoteExtendsDurableHistory')};\nglobalThis.runBundle=${app.local('runTaskMutationWithLockBundle')};`);
const ref=current=>({current}),copy=v=>JSON.parse(JSON.stringify(v));
function setup(options={}){
 const config={supabaseUrl:'http://127.0.0.1:1',supabaseAnonKey:randomUUID(),workspaceKey:'managed-routing',tableName:'ship_dynamics_app_state',...options.raw};
 const binding={workspace:config.workspaceKey,managed:true,source:options.source||'records-v1',epoch:2,pauseState:'resumed',admitted:true};
 const actor={id:'actor-a',name:'Actor',isActive:true};
 const base={revision:100,users:[actor],tasks:[{id:'task-a'}],internalControlCases:[],meetings:[],body:'base'};
 const state={config,binding,reads:[],alerts:[],mutations:0,acquisitions:0,releases:0,publications:[],queued:0};
 const env={console,currentUser:actor,authorizationEpoch:'epoch-a',tab:'dashboard',listBatchContext:null,
  originalAuthority:ref(options.unresolved?null:binding),recordReadScope:ref('home'),liveCurrentUserId:ref(actor.id),liveAuthorizationEpoch:ref('epoch-a'),identitySessionGeneration:ref(1),
  getSupabaseConfig:()=>state.config,sameCloudConfig:(a,b)=>JSON.stringify(a)===JSON.stringify(b),cloudIdentity:()=> 'raw-identity',
  confirmedCloudData:ref(base),liveData:ref(options.dirty?{...base,body:'draft'}:base),appDataContentEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  enqueueCloudSave:async()=>{state.queued++;if(options.queue)await options.queue(env,state);env.confirmedCloudData.current=env.liveData.current;},
  readBrowserAuthority:async()=>state.binding,
  fetchCloudDataRpc:async(c,signal,confirmed,scope)=>{state.reads.push({storageMode:c.storageMode??'legacy',readMode:c.readMode,scope});if(options.read)await options.read(env,state);return {...base,revision:(c.storageMode??'legacy')===binding.source?100:1};},
  durableCloudRevisionFloors:ref(new Map([[`raw-identity|authority:${binding.source}:2`,100]])),durableRevisionFloorRegistryIsValid:()=>true,
  CloudRebaseConflictError:class extends Error{constructor(v){super(v.join(';'));}},StaleAsyncConfigError:class extends Error{},
  selectTasksVisibleToUser:t=>t,batchVisibleVesselIds:()=>new Set(['v1']),taskRelationLockKeys:()=>['task:task-a'],uid:()=> 'lease-a',
  acquireEditLockBundle:async(requests,claim,release,current)=>{state.acquisitions++;return current()?{status:'owned',leases:requests}:{status:'stale'};},
  runCloudSaveQueueRpc:async(label,fn)=>fn(),claimEditLock:async()=>({ok:true}),releaseEditLock:async()=>{state.releases++;},renewEditLock:async()=>({ok:true}),
  transientCloudBlockLockGuards:ref(new Map()),lastCloudRevision:ref(100),confirmCloudSnapshot:()=>{},flushSync:fn=>fn(),setData:v=>state.publications.push(v),setCloudStatus:()=>{},setSensitiveCloudStatus:()=>{},alert:s=>state.alerts.push(s),
  window:{setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1},
 };
 vm.createContext(env);vm.runInContext(code,env);
 return {env,state,base,run:()=>env.runBundle(['task-a'],'batch',()=>{state.mutations++;return false;})};
}
const cases=[];
async function check(caseId,fn){try{await fn();cases.push({caseId,status:'PASS'});}catch(e){cases.push({caseId,status:'FAIL',error:e.message});}}
await check('MR-B01-raw-absent-managed-records-both-prereads',async()=>{
 const x=setup();await x.run();assert.equal(x.state.mutations,1);assert.equal(x.state.reads.length,2);assert.ok(x.state.reads.every(r=>r.storageMode==='records-v1'&&r.readMode==='snapshot'));assert.equal(x.state.releases,1);
});
await check('MR-B02-raw-records-managed-legacy-reverse',async()=>{
 const x=setup({source:'legacy',raw:{storageMode:'records-v1',readMode:'scoped-v1'}});await x.run();assert.equal(x.state.mutations,1);assert.equal(x.state.reads.length,2);assert.ok(x.state.reads.every(r=>r.storageMode==='legacy'&&r.readMode==='snapshot'));assert.equal(x.env.recordReadScope.current,'home');
});
await check('MR-B03-unresolved-authority-no-read-or-lock',async()=>{
 const x=setup({unresolved:true});await x.run();assert.equal(x.state.reads.length,0);assert.equal(x.state.acquisitions,0);assert.equal(x.state.mutations,0);
});
for(const phase of [1,2])for(const drift of ['server-epoch','local-binding','actor'])await check(`MR-B04-${drift}-during-read-${phase}`,async()=>{
 const x=setup({read:(env,state)=>{if(state.reads.length!==phase)return;if(drift==='server-epoch')state.binding={...state.binding,epoch:3};if(drift==='local-binding')env.originalAuthority.current={...state.binding,epoch:3};if(drift==='actor')env.liveCurrentUserId.current='successor';}});
 await x.run();assert.equal(x.state.mutations,0);assert.equal(x.state.publications.length,0);assert.equal(x.state.acquisitions,phase===1?0:1);if(phase===2)assert.equal(x.state.releases,1);
});
await check('MR-B05-failed-dirty-drain-preserves-draft',async()=>{
 const x=setup({dirty:true,queue:()=>{throw new Error('controlled no ACK');}}),draft=x.env.liveData.current;await x.run();assert.equal(x.state.reads.length,0);assert.equal(x.state.acquisitions,0);assert.equal(x.env.liveData.current,draft);
});
await check('MR-B06-capture-source-after-dirty-drain',async()=>{
 const x=setup({dirty:true,queue:(env,state)=>{state.binding={...state.binding,epoch:3};env.originalAuthority.current=state.binding;env.liveData.current={...env.confirmedCloudData.current};}});await x.run();assert.equal(x.state.queued,1);assert.equal(x.state.mutations,1);
});
function management(options={}){
 const x=setup(options),e=x.env;e.actionScopeGeneration=ref(0);e.activeEditLockRef=ref(null);e.batchManagedOpenRef=ref(false);e.saveTimer=ref(null);
 Object.assign(e,{clone:copy,managementSaveTail:ref(Promise.resolve()),managementSaveState:ref({cloudBootstrapped:true,cloudWriteBlocked:false,cloudSyncing:false}),cloudSyncInFlight:ref(false),
  cloudSaveInFlight:ref(null),pendingCloudData:ref({size:()=>0}),activeCloudIdentity:ref('raw-identity'),recordScopeKey:v=>JSON.stringify(v),
  captureManagementContext:()=>()=>true,changedVesselTeams:()=>['v1'],handoverReadTargets:()=>[],applyVesselManagerHandover:()=>['v1'],primaryVesselTeam:()=>[],
  withAudit:d=>d,mergeConfirmedCloudSnapshot:({confirmed})=>confirmed,nowIso:()=> 'fixture-time',reportCloudSaveFailure:err=>x.state.alerts.push(err.message),
  confirmCloudSnapshot:(identity,v)=>{e.confirmedCloudData.current=v;},enqueueCloudSave:async(...args)=>{x.state.queued++;x.state.saveArgs=args;e.confirmedCloudData.current=args[0];},
 });
 vm.runInContext(compile(`${app.decl('createAsyncConfigCoordinator')}\nglobalThis.configIoCoordinator={current:createAsyncConfigCoordinator()};\nglobalThis.loadRecordActionScope=${app.local('loadRecordActionScope')};\nglobalThis.commitManagement=${app.local('commitManagement').replaceAll('import.meta.env.DEV','false')};`),e);
 return {...x,run:()=>e.commitManagement(d=>{d.body='handover';},'update','vessel','v1','handover')};
}
await check('MR-H01-raw-absent-record-handover-fresh-read-and-guard',async()=>{
 const x=management();assert.equal(await x.run(),true);assert.equal(x.state.reads.length,2,'forced discovery and exact scope must not be skipped in snapshot mode');assert.ok(x.state.reads.every(r=>r.storageMode==='records-v1'));assert.equal(x.state.saveArgs[4],100);
});
await check('MR-H02-managed-legacy-does-not-send-record-handover-guard',async()=>{
 const x=management({source:'legacy',raw:{storageMode:'records-v1'}});assert.equal(await x.run(),true);assert.equal(x.state.reads.length,0);assert.equal(x.state.saveArgs[4],undefined);
});
await check('MR-H03-paused-authority-no-new-save',async()=>{
 const x=management();x.state.binding={...x.state.binding,admitted:false,pauseState:'paused'};assert.equal(await x.run(),false);assert.equal(x.state.queued,0);
});
function member(options={}){
 const x=setup(options),e=x.env;
 Object.assign(e,{taskOpenRequests:ref({isCurrent:()=>true}),clearBlockedTaskLock:()=>{},setTaskReadOnlyData:()=>{},setTaskReadOnlyReason:()=>{},taskLockIsAuthorized:()=>true,
  activeEditLock:null,activeEditLockRef:ref(null),authorizedEditLockKeys:new Set(['task:task-a']),usesPerVesselProgress:()=>true,richTextToPlainText:()=> 'Task',
  ensureMemberGlobalDurable:async()=>{if(options.drain)options.drain(e,x.state);},releaseExclusiveItemLease:async()=>true,activeVessels:[{id:'v1'}],taskVesselIds:()=>['v1'],memberEditor:ref(null),
  setMemberEditorVersion:()=>{},setTaskProgressVesselId:()=>{},setTaskEditorRequestGeneration:()=>{},setTaskEditorAuthorizationEpoch:()=>{},setEditingTaskId:()=>{},
  claimEditingLock:async()=>{x.state.legacyClaims=(x.state.legacyClaims||0)+1;return 'blocked';},openTaskReadOnly:async()=> 'readonly',
  TaskMemberEditor:class{constructor(...args){this.args=args;x.state.member=this;}async select(){x.state.selected=(x.state.selected||0)+1;return {id:'task-a'};}async close(){}},
 });
 vm.runInContext(compile(`${authority.decl('assertAuthorityAdmission')}\nglobalThis.openTaskEditor=${app.local('openTaskEditor')};`),e);
 return {...x,run:()=>e.openTaskEditor({id:'task-a'},'v1',1)};
}
await check('MR-M01-raw-absent-records-selects-member-and-pins-binding',async()=>{
 const x=member();assert.equal(await x.run(),'opened');assert.equal(x.state.selected,1);assert.equal(x.state.member.args[0],x.state.config,'retain raw identity for drafts');
 assert.equal(x.state.member.args[4](),true);x.env.originalAuthority.current={...x.state.binding,epoch:3};assert.equal(x.state.member.args[4](),false);assert.equal(x.state.member.args[6](),true,'draft retention is identity, not new-write permission');
});
await check('MR-M02-managed-legacy-does-not-open-record-member',async()=>{
 const x=member({source:'legacy',raw:{storageMode:'records-v1'}});assert.equal(await x.run(),'readonly');assert.equal(x.state.selected,undefined);assert.equal(x.state.legacyClaims,1);
});
await check('MR-M03-server-paused-no-new-member-claim',async()=>{
 const x=member();x.state.binding={...x.state.binding,pauseState:'paused',admitted:false};assert.equal(await x.run(),'failed');assert.equal(x.state.selected,undefined);assert.equal(x.state.legacyClaims,undefined);
});
await check('MR-M04-source-changes-during-drain-no-selector',async()=>{
 const x=member({drain:(e,s)=>{e.originalAuthority.current={...s.binding,epoch:3};}});await x.run();assert.equal(x.state.selected,undefined);assert.equal(x.state.legacyClaims,undefined);
});
const appAst=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),realtimeCalls=[];
const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(appAst)==='useEffect'&&n.arguments[0]?.getText(appAst).includes('subscribeToCloudRevision(queueRevision'))realtimeCalls.push(n);ts.forEachChild(n,visit);};visit(appAst);assert.equal(realtimeCalls.length,1);
const effect=realtimeCalls[0].arguments[0].getText(appAst),dependencies=realtimeCalls[0].arguments[1].getText(appAst);
function realtime(options={}){
 const x=setup(options),e=x.env;
 Object.assign(e,{cloudBootstrapped:true,currentUserId:'actor-a',subscribeToCloudRevision:(cb,status,config)=>{x.state.subscription={cb,config};return ()=>{x.state.stopped=(x.state.stopped||0)+1;};},setCloudWakeupRevision:fn=>{x.state.wakeup=fn(-1);}});
 e.window.addEventListener=()=>{};e.window.removeEventListener=()=>{};
 vm.runInContext(compile(`globalThis.makeRealtime=(realtimeAuthority)=>({run:${effect},dependencies:${dependencies}});`),e);
 return x;
}
await check('MR-R01-effective-records-feed-and-stale-callback',async()=>{
 const x=realtime(),hook=x.env.makeRealtime(x.env.originalAuthority.current),cleanup=hook.run();
 assert.equal(x.state.subscription.config.storageMode,'records-v1');assert.ok(hook.dependencies.includes(x.env.originalAuthority.current),'authority change must re-subscribe');
 const old=x.state.subscription.cb;old(101);assert.equal(x.state.wakeup,101);x.env.originalAuthority.current={...x.state.binding,epoch:3,source:'legacy'};old(102);assert.equal(x.state.wakeup,101);cleanup();assert.equal(x.state.stopped,1);
 x.env.makeRealtime(x.env.originalAuthority.current).run();assert.equal(x.state.subscription.config.storageMode,'legacy');
});
await check('MR-R02-unresolved-authority-no-wrong-source-feed',async()=>{
 const x=realtime({unresolved:true});x.env.makeRealtime(null).run();assert.equal(Boolean(x.state.subscription),false);
});
function leaseRefresh(options={}){
 const x=setup(options),e=x.env,owned={sectionKey:'task:task-a',status:'owned',leaseOwnerId:'lease-a',generation:1};
 Object.assign(e,{activeEditLockRef:ref(owned),lockCoordinator:ref({isCurrent:()=>true}),saveTimer:ref(null),cloudWorkspaceIdentity:()=> 'raw-identity',
  recordScopeKey:v=>JSON.stringify(v),unionRecordScopes:(a,b)=>({targets:b.targets}),isTaskCreationLockKey:()=>false,isInternalControlCreationLockKey:()=>false,isMeetingCreationLockKey:()=>false,
  itemLeaseIsAuthorizedInSnapshot:()=>true,itemLeaseExistsInSnapshot:()=>true,resolveItemEditSession:()=>({status:'ready'}),
  setCloudWriteBlocked:()=>{},releaseCurrentEditLock:async()=>{x.state.releases++;},
 });
 vm.runInContext(compile(`${app.decl('createAsyncConfigCoordinator')}\nglobalThis.configIoCoordinator={current:createAsyncConfigCoordinator()};\nglobalThis.refresh=${app.local('refreshAfterItemLease')};`),e);
 if(options.afterOuter){const run=e.configIoCoordinator.current.run.bind(e.configIoCoordinator.current);e.configIoCoordinator.current.run=async(...args)=>{const value=await run(...args);options.afterOuter(e,x.state);return value;};}
 return {...x,run:()=>e.refresh('task:task-a')};
}
for(const target of ['records-v1','legacy'])await check(`MR-L01-lease-read-effective-${target}`,async()=>{
 const x=leaseRefresh({source:target,raw:{storageMode:target==='records-v1'?'legacy':'records-v1',readMode:'scoped-v1'}});
 assert.ok(await x.run());assert.equal(x.state.reads.length,1);assert.equal(x.state.reads[0].storageMode,target);assert.equal(x.state.reads[0].readMode,'snapshot');assert.equal(x.env.recordReadScope.current,'home');
});
await check('MR-L02-lease-unresolved-no-raw-read',async()=>{const x=leaseRefresh({unresolved:true,raw:{readMode:'scoped-v1'}});assert.equal(await x.run(),null);assert.equal(x.state.reads.length,0);assert.equal(x.state.publications.length,0);});
await check('MR-L03-lease-outer-return-binding-drift-no-publication',async()=>{
 const x=leaseRefresh({afterOuter:(e,s)=>{e.originalAuthority.current={...s.binding,epoch:3};}});assert.equal(await x.run(),null);assert.equal(x.state.publications.length,0);
});
const lockPlan=reader(fs.readFileSync('src/collaborationLockPlan.ts','utf8'),'collaborationLockPlan.ts',ts.ScriptKind.TS);
const exclusiveLocks=reader(fs.readFileSync('src/exclusiveItemEditLock.ts','utf8'),'exclusiveItemEditLock.ts',ts.ScriptKind.TS);
const creationCalls=[];const visitCreation=n=>{if(ts.isCallExpression(n)&&n.expression.getText(appAst)==='taskInternalControlCreationLockKeys')creationCalls.push(n.getText(appAst));ts.forEachChild(n,visitCreation);};visitCreation(appAst);assert.equal(creationCalls.length,1);
for(const target of ['records-v1','legacy'])await check(`MR-C01-projected-case-effective-${target}`,async()=>{
 const x=setup({source:target,raw:{storageMode:target==='records-v1'?'legacy':'records-v1'}}),e=x.env;
 Object.assign(e,{snapshot:{tasks:[{id:'task-a',internalControlCaseId:'internal-task-a'}],internalControlCases:[{id:'internal-task-a',linkedTaskId:'task-a'}]},candidate:{id:'task-a',isInternalControl:true},isMeetingTaskSource:()=>false});
 vm.runInContext(compile(`const key=${exclusiveLocks.local('key')};const INTERNAL_CONTROL_CREATION_PREFIX=${exclusiveLocks.local('INTERNAL_CONTROL_CREATION_PREFIX')};const internalControlCreationLockKey=${exclusiveLocks.local('internalControlCreationLockKey')};\n${lockPlan.decl('taskInternalControlCreationLockKeys')}\nglobalThis.result=${creationCalls[0]};`),e);
 assert.deepEqual(Array.from(e.result),target==='records-v1'?['internal-control-create:task-a']:[]);
});
assert.equal(new Set(cases.map(c=>c.caseId)).size,cases.length);
console.log(JSON.stringify({status:cases.every(c=>c.status==='PASS')?'PASS':'FAIL',layer:'actual-App-actions-controlled-IO',sourceSha256:createHash('sha256').update(source).digest('hex'),caseCount:cases.length,cases,nativeOrMountedClaim:false}));
if(cases.some(c=>c.status!=='PASS'))process.exitCode=1;

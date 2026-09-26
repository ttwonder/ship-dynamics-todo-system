import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';

// Executes the actual App admission + refresh closures with controlled I/O.
// Original mounted UI/native SQL acceptance is a separate gate.
const source=fs.readFileSync('src/App.tsx','utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function local(name){const found=[];const walk=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)found.push(n.initializer.getText(ast));ts.forEachChild(n,walk);};walk(ast);assert.equal(found.length,1,name);return found[0];}
const code=ts.transpileModule(['claimEditingLock','refreshAfterItemLease'].map(name=>`globalThis.${name}=${local(name)};`).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const ref=current=>({current}),clone=v=>JSON.parse(JSON.stringify(v));
function setup(){
 const cfg={workspaceKey:'test',supabaseUrl:'http://127.0.0.1:1',supabaseAnonKey:'synthetic',readMode:'scoped-v1',storageMode:'records-v1'},actor={id:'actor',name:'Actor'},base={revision:1,tasks:[{id:'task-a'}],internalControlCases:[],meetings:[],users:[actor]};
 const state={reads:0,saves:0,releases:0,alerts:[],authorizes:true,now:1000};let generation=0;
 const env={console,crypto:{randomUUID},Date:{now:()=>state.now,parse:Date.parse},currentUser:actor,authorizationEpoch:'epoch-a',
  activeEditLockRef:ref(null),originalAuthority:ref({source:'records-v1'}),identitySessionGeneration:ref(1),liveCurrentUserId:ref('actor'),liveAuthorizationEpoch:ref('epoch-a'),
  itemLeaseReadHandoff:ref(null),backgroundReadController:ref(null),recordReadScope:ref('home'),liveData:ref(base),confirmedCloudData:ref(base),pendingClaimConfig:ref(null),leaseCloudConfigs:ref(new Map()),
  liveAuthorizedEditLockKeys:ref(new Set(['task:task-a'])),lastCloudRevision:ref(1),saveTimer:ref(null),hasUnsavedWork:ref(false),cloudSaveInFlight:ref(null),pendingCloudData:ref({size:()=>0}),
  getSupabaseConfig:()=>cfg,sameCloudConfig:(a,b)=>JSON.stringify(a)===JSON.stringify(b),cloudIdentity:()=> 'test',cloudWorkspaceIdentity:()=> 'test',
  ensureCloudDurableBeforeLeaseRelease:async()=>true,releaseCurrentEditLock:async()=>{state.releases++;env.activeEditLockRef.current=null;return true;},
  lockCoordinator:ref({beginGeneration:()=>++generation,isCurrent:g=>g===generation,invalidate:()=>generation++,run:fn=>fn()}),
  configIoCoordinator:ref({begin:()=>({}),run:async(t,get,fn)=>fn(cfg),isCurrent:()=>true}),
  runCloudSaveQueueRpc:async(label,fn)=>fn(),releaseEditLock:async()=>{},claimEditLock:async()=>({ok:true}),
  acquireEditLockBundle:async requests=>({status:'owned',leases:requests.map(r=>({...r,expiresAt:'2030-01-01T00:00:00.000Z'}))}),
  relatedEntityLockKeysForSection:(d,key)=>[key],itemLeaseExistsInSnapshot:()=>true,itemLeaseIsAuthorizedInSnapshot:()=>state.authorizes,
  unionRecordScopes:(a,b)=>a==='home'?b:a,recordScopeKey:scope=>typeof scope==='string'?scope:JSON.stringify(scope),authorityConfig:(c)=>c,
  fetchCloudData:async()=>{state.reads++;return clone(base);},assertRemoteExtendsDurableHistory:()=>{},conservativeLeaseDeadline:()=>9000,
  confirmCloudSnapshot:(id,v)=>{env.confirmedCloudData.current=v;},setData:()=>{},setActiveEditLock:v=>{env.activeEditLockRef.current=v;},clearVesselLeaseIncident:()=>{},setSensitiveCloudStatus:()=>{},setCloudStatus:()=>{},setCloudWriteBlocked:()=>{},
  appDataContentEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),enqueueCloudSave:async()=>{state.saves++;throw new Error('unconfirmed save remains pending');},
  resolveItemEditSession:({live,confirmed,remote,authorize})=>JSON.stringify(live)!==JSON.stringify(confirmed)?{status:'local-dirty'}:authorize(remote)?{status:'ready'}:{status:'unauthorized'},
  isTaskCreationLockKey:()=>false,isInternalControlCreationLockKey:()=>false,isMeetingCreationLockKey:()=>false,
  alert:s=>state.alerts.push(s),window:{clearTimeout:()=>{}},
 };
 // Keep real timestamp conversion used by the closure.
 env.Date=class extends Date{static now(){return state.now;}};
 vm.createContext(env);vm.runInContext(code,env);
 return {env,state,claim:()=>env.claimEditingLock('task:task-a','task'),refresh:()=>env.refreshAfterItemLease('task:task-a')};
}
const cases=[];
async function check(id,fn){try{await fn();cases.push({id,status:'PASS'});}catch(e){cases.push({id,status:'FAIL',message:e.message});}}
await check('one-claim-two-required-reads-no-third-read',async()=>{const x=setup();assert.equal(await x.claim(),'owned');assert.equal(x.state.reads,2);assert.ok(await x.refresh());assert.equal(x.state.reads,2,'reuse exact post-lock read, not a third RPC');assert.ok(await x.refresh());assert.equal(x.state.reads,3,'handoff is single-use');});
for(const drift of ['config','authority','session','actor','epoch','snapshot-mutation','snapshot-replaced','pending','save-in-flight','dirty-flag','deadline','time-window','scope'])await check('reject-handoff-'+drift,async()=>{
 const x=setup(),e=x.env;assert.equal(await x.claim(),'owned');
 if(drift==='config')e.getSupabaseConfig=()=>({workspaceKey:'other'});
 if(drift==='authority')e.originalAuthority.current={source:'records-v1',epoch:2};
 if(drift==='session')e.identitySessionGeneration.current++;
 if(drift==='actor')e.liveCurrentUserId.current='successor';
 if(drift==='epoch')e.liveAuthorizationEpoch.current='epoch-b';
 if(drift==='snapshot-mutation')e.liveData.current.injected='mutated in place';
 if(drift==='snapshot-replaced')e.liveData.current=e.confirmedCloudData.current=clone(e.liveData.current);
 if(drift==='pending')e.pendingCloudData.current={size:()=>1};
 if(drift==='save-in-flight')e.cloudSaveInFlight.current=Promise.resolve();
 if(drift==='dirty-flag')e.hasUnsavedWork.current=true;
 if(drift==='deadline')e.activeEditLockRef.current.validatedUntilMs=999;
 if(drift==='time-window')x.state.now=5000;
 if(drift==='scope')e.recordReadScope.current='full';
 await x.refresh();assert.equal(x.state.reads,3,'must use existing refresh on invalidated handoff');
});
await check('dirty-draft-not-published-or-discarded',async()=>{const x=setup();await x.claim();const draft={...x.env.liveData.current,unsaved:'must survive'};x.env.liveData.current=draft;assert.equal(await x.refresh(),null);assert.equal(x.env.liveData.current,draft);assert.equal(x.state.reads,2);assert.equal(x.state.saves,1);});
await check('latest-permission-still-checked',async()=>{const x=setup();await x.claim();x.state.authorizes=false;assert.equal(await x.refresh(),null);assert.equal(x.state.releases,1);});
console.log(JSON.stringify({kind:'actual-App-closures-controlled-IO',cases},null,2));
assert.ok(cases.every(c=>c.status==='PASS'),'edit-entry read handoff gate failed');

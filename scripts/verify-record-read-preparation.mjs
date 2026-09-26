import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/App.tsx','utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function local(name){const out=[];const scan=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)out.push(n.initializer.getText(ast));ts.forEachChild(n,scan);};scan(ast);assert.equal(out.length,1,name);return out[0];}
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,ref=current=>({current});
const cases=[];
async function check(id,fn){try{await fn();cases.push({id,status:'PASS'});}catch(e){cases.push({id,status:'FAIL',message:e.message});}}
function setup(){
 const cfg={workspaceKey:'synthetic',readMode:'scoped-v1'},binding={source:'records-v1'},base={revision:3,tasks:[],internalControlCases:[]};
 const state={reads:0,published:0,saves:0,timers:[],alerts:[],now:10000};
 const e={console,AbortController,cloudBootstrapped:true,siteUnlocked:true,currentUserId:'actor',authorizationEpoch:'epoch',currentUser:{id:'actor'},
  originalAuthority:ref(binding),identitySessionGeneration:ref(1),liveCurrentUserId:ref('actor'),liveAuthorizationEpoch:ref('epoch'),
  actionScopeReadInFlight:ref(0),actionScopeGeneration:ref(0),activeEditLockRef:ref(null),memberEditor:ref(null),pendingClaimConfig:ref(null),batchManagedOpenRef:ref(false),
  backgroundReadController:ref(null),homeReadCache:ref({config:cfg,binding,actor:'actor',session:1,snapshot:base,json:JSON.stringify(base),at:10000}),
  liveData:ref(base),confirmedCloudData:ref(base),hasUnsavedWork:ref(false),pendingCloudData:ref({size:()=>0}),cloudSaveInFlight:ref(null),cloudSyncInFlight:ref(false),
  saveTimer:ref(null),recordReadScope:ref({targets:[{collection:'tasks',id:'task-a'}]}),lastCloudRevision:ref(3),
  roleVisibleTasks:[{id:'task-a',isClosed:false},{id:'task-b',isClosed:false}],roleVisibleInternalControlCases:[{id:'case-a',isClosed:false},{id:'case-b',isClosed:false}],
  sortRecordsNewestCreated:rows=>rows,getSupabaseConfig:()=>cfg,sameCloudConfig:(a,b)=>JSON.stringify(a)===JSON.stringify(b),authorityConfig:c=>c,cloudIdentity:()=> 'synthetic',
  appDataContentEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),recordScopeKey:s=>JSON.stringify(s),
  configIoCoordinator:ref({begin:()=>({}),isCurrent:()=>true,run:async(t,get,fn)=>fn(cfg)}),
  fetchCloudData:async(c,signal,confirmed,scope)=>{state.reads++;state.scopes??=[];state.scopes.push(scope);return base;},
  enqueueCloudSave:async()=>{state.saves++;throw new Error('pending save');},releaseCurrentEditLock:async()=>{throw new Error('preload must not acquire/release locks');},
  confirmCloudSnapshot:(id,s)=>{e.confirmedCloudData.current=s;},setData:()=>state.published++,assertRemoteExtendsDurableHistory:()=>{},setCloudWakeupRevision:()=>{state.wakeup=true;},
  alert:s=>state.alerts.push(s),window:{setTimeout:fn=>{state.timers.push(fn);return state.timers.length;},clearTimeout:()=>{}},Date:class extends Date{static now(){return state.now;}},
 };
 vm.createContext(e);vm.runInContext(compile(`globalThis.loadRecordActionScope=${local('loadRecordActionScope')};`),e);
 return {e,state,load:()=>e.loadRecordActionScope('home',()=>true,false,true)};
}
await check('navigation-uses-verified-home-with-background-wakeup',async()=>{const x=setup();assert.equal(await x.load(),true);assert.equal(x.state.reads,0,'recent home should render without waiting for another read');assert.equal(x.state.published,1);assert.equal(x.state.wakeup,true);});
for(const drift of ['actor','session','authority','config','expired','rollback','mutation'])await check('home-cache-rejects-'+drift,async()=>{const x=setup(),c=x.e.homeReadCache.current;
 if(drift==='actor')c.actor='other';if(drift==='session')c.session=0;if(drift==='authority')c.binding={source:'records-v1'};if(drift==='config')c.config={workspaceKey:'different'};
 if(drift==='expired')x.state.now=30000;if(drift==='rollback')c.snapshot={...c.snapshot,revision:2};if(drift==='mutation')c.json='not-the-snapshot';
 assert.equal(await x.load(),true);assert.equal(x.state.reads,1);
});
await check('action-default-does-not-use-view-cache',async()=>{const x=setup();assert.equal(await x.e.loadRecordActionScope('home'),true);assert.equal(x.state.reads,1);});
await check('navigation-does-not-overwrite-draft',async()=>{const x=setup(),draft={revision:3,unsaved:'keep'};x.e.liveData.current=draft;assert.equal(await x.load(),false);assert.equal(x.e.liveData.current,draft);assert.equal(x.state.published,0);});
await check('bounded-idle-prefetch-read-only',async()=>{const x=setup();vm.runInContext(compile(`globalThis.scheduleRecordPreload=${local('scheduleRecordPreload')};`),x.e);const cleanup=x.e.scheduleRecordPreload();assert.equal(x.state.reads,0);assert.equal(x.state.timers.length,1);await x.state.timers[0]();assert.equal(x.state.reads,3);assert.equal(x.state.scopes[0],'home');assert.equal(x.state.scopes.filter(s=>typeof s==='object').length,2);assert.equal(x.state.published,0);assert.equal(x.state.saves,0);cleanup();});
for(const change of ['lock','draft','pending','actor','session','authority','save','scope-action','cleanup'])await check('prefetch-cancel-'+change,async()=>{const x=setup(),e=x.e;vm.runInContext(compile(`globalThis.scheduleRecordPreload=${local('scheduleRecordPreload')};`),e);const cleanup=e.scheduleRecordPreload();
 if(change==='lock')e.activeEditLockRef.current={status:'owned'};if(change==='draft')e.hasUnsavedWork.current=true;if(change==='pending')e.pendingCloudData.current={size:()=>1};if(change==='actor')e.liveCurrentUserId.current='other';if(change==='session')e.identitySessionGeneration.current++;if(change==='authority')e.originalAuthority.current={source:'records-v1'};if(change==='save')e.cloudSaveInFlight.current=Promise.resolve();if(change==='scope-action')e.actionScopeReadInFlight.current=1;if(change==='cleanup')cleanup();
 await x.state.timers[0]();assert.equal(x.state.reads,0);assert.equal(x.state.published,0);cleanup();
});
for(const mode of ['tracking-force','ordinary','already-covered','stale-owner'])await check('active-prefetch-yields-to-'+mode,async()=>{
 const x=setup(),e=x.e;let release,backgroundSignal;const held=new Promise(resolve=>{release=resolve;});let backgroundReads=0;
 e.fetchCloudData=async(c,signal)=>{if(signal){backgroundReads++;backgroundSignal=signal;if(backgroundReads===1)await held;}return e.confirmedCloudData.current;};
 vm.runInContext(compile(`globalThis.scheduleRecordPreload=${local('scheduleRecordPreload')};`),e);
 const cleanup=e.scheduleRecordPreload(),preload=x.state.timers[0]();assert.ok(backgroundSignal,'background home read must already be in flight');
 const scope=mode==='already-covered'?e.recordReadScope.current:'full';
 const accepted=await e.loadRecordActionScope(scope,()=>mode!=='stale-owner',mode==='tracking-force');
 const abortedAtForegroundReturn=backgroundSignal.aborted;release();await preload;cleanup();
 assert.equal(accepted,mode!=='stale-owner');assert.equal(abortedAtForegroundReturn,mode!=='stale-owner','every current foreground entry must abort in-flight preload');
 assert.equal(backgroundReads,mode==='stale-owner'?3:1,'cancelled preload must not continue its remaining target reads');
 assert.equal(x.state.saves,0);
});
console.log(JSON.stringify({kind:'actual-App-read-preparation-closures-controlled-IO',cases},null,2));assert.ok(cases.every(c=>c.status==='PASS'));

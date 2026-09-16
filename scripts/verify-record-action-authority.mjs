import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual App scope-loader, bound reader and durable-floor guard.
// I/O, refs and publication sinks are controlled: this is not mounted/native QA.
const source=readFileSync('src/App.tsx','utf8');
const authoritySource=readFileSync('src/cloudSourceAuthority.ts','utf8');
function reader(text,name,kind=ts.ScriptKind.TSX){
 const ast=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,kind);
 const find=test=>{const found=[];const walk=n=>{if(test(n))found.push(n);ts.forEachChild(n,walk);};walk(ast);assert.equal(found.length,1);return found[0];};
 return {local:name=>find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name).initializer.getText(ast),decl:name=>find(n=>(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&n.name?.text===name).getText(ast).replace(/^export /,'')};
}
const app=reader(source,'App.tsx'),authority=reader(authoritySource,'cloudSourceAuthority.ts',ts.ScriptKind.TS);
const compiled=ts.transpileModule(`
${app.decl('StaleAsyncConfigError')}
${app.decl('createAsyncConfigCoordinator')}
${authority.decl('BrowserAuthorityError')}
${authority.decl('authorityConfig')}
const sameAuthority=${authority.local('sameAuthority')};
const authorityFloorIdentity=${authority.local('authorityFloorIdentity')};
globalThis.makeCoordinator=createAsyncConfigCoordinator;
globalThis.readBoundCloudData=(()=>{const fetchCloudData=(...args)=>fetchCloudDataRpc(...args);return ${authority.decl('readBoundCloudData')};})();
globalThis.fetchCloudData=${app.local('fetchCloudData')};
globalThis.assertRemoteExtendsDurableHistory=${app.local('assertRemoteExtendsDurableHistory')};
globalThis.loadRecordActionScope=${app.local('loadRecordActionScope')};
`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const config={supabaseUrl:'http://127.0.0.1:1',supabaseAnonKey:randomUUID(),workspaceKey:'action-scope-fixture',tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'scoped-v1'};
const managed=Object.freeze({workspace:config.workspaceKey,managed:true,source:'legacy',epoch:1,pauseState:'resumed',admitted:true});
const unmanaged=Object.freeze({...managed,managed:false,source:'records-v1',epoch:0,pauseState:'unmanaged'});
const identity='fixture-raw-identity',floorIdentity=b=>b?.managed?`${identity}|authority:${b.source}:${b.epoch}`:identity;
function setup(options={}){
 const binding=Object.hasOwn(options,'binding')?options.binding:managed;
 const base={revision:binding?.managed?100:1,body:'confirmed'},remote={...base,body:'expanded'};
 const state={config:{...config},authority:binding,reads:[],authorityReads:0,publications:[],confirmations:[],alerts:[],queueCalls:0};
 const context={console,originalAuthority:{current:binding},recordReadScope:{current:'home'},actionScopeGeneration:{current:0},
  liveCurrentUserId:{current:'fixture-owner'},identitySessionGeneration:{current:1},liveData:{current:base},confirmedCloudData:{current:base},lastCloudRevision:{current:base.revision},
  activeEditLockRef:{current:null},batchManagedOpenRef:{current:false},saveTimer:{current:null},window:{clearTimeout:()=>{}},
  getSupabaseConfig:()=>state.config,sameCloudConfig:(a,b)=>JSON.stringify(a)===JSON.stringify(b),recordScopeKey:scope=>JSON.stringify(scope),
  cloudIdentity:()=>identity,appDataContentEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  durableCloudRevisionFloors:{current:new Map([[identity,1],[floorIdentity(managed),100]])},durableRevisionFloorRegistryIsValid:()=>true,
  CloudRebaseConflictError:class extends Error{constructor(messages){super(messages.join(';'));}},
  enqueueCloudSave:async data=>{state.queueCalls++;if(options.queue)await options.queue(data,context,state);context.confirmedCloudData.current=context.liveData.current;},
  readBrowserAuthority:async()=>{state.authorityReads++;return state.authority;},
  fetchCloudDataRpc:async(c,signal,confirmed,scope)=>{state.reads.push({storageMode:c.storageMode,readMode:c.readMode,scope});if(options.read)return options.read(c,scope,context,state);return c.storageMode==='legacy'?remote:{revision:1,body:'record-source'};},
  confirmCloudSnapshot:(id,data)=>{state.confirmations.push({identity:floorIdentity(context.originalAuthority.current),data});context.confirmedCloudData.current=data;},
  setData:data=>state.publications.push(data),alert:message=>state.alerts.push(String(message)),
 };
 vm.createContext(context);vm.runInContext(compiled,context);context.configIoCoordinator={current:context.makeCoordinator()};
 // Force freshness for authority/floor/race probes: managed legacy is already
 // complete and now correctly skips ordinary coverage-only expansion.
 return {context,state,base,remote,run:(scope='full',owner=()=>true,force=true)=>context.loadRecordActionScope(scope,owner,force)};
}
const cases=[];
async function check(caseId,fn){try{await fn();cases.push({caseId,status:'PASS'});}catch(error){cases.push({caseId,status:'FAIL',error:error.message});}}
const unpublished=x=>{assert.equal(x.state.publications.length,0);assert.equal(x.state.confirmations.length,0);assert.equal(x.context.recordReadScope.current,'home');assert.equal(x.context.liveData.current,x.base);};
await check('AS-01-managed-full-read-before-morning-save',async()=>{
 const x=setup();assert.equal(await x.run(),true,'managed full prerequisite must not read retired record revision below the durable floor');
 assert.deepEqual(x.state.reads,[{storageMode:'legacy',readMode:'snapshot',scope:'full'}]);
 assert.equal(x.state.authorityReads,2);assert.equal(x.state.queueCalls,0);assert.equal(x.state.alerts.length,0);
 assert.equal(x.context.recordReadScope.current,'full');assert.equal(x.context.liveData.current,x.remote);
 assert.equal(x.state.confirmations[0].identity,floorIdentity(managed));assert.equal(x.state.publications.length,1);
});
await check('AS-02-unmanaged-record-scope-positive',async()=>{
 const x=setup({binding:unmanaged});const scope={targets:[{collection:'meetings',id:'fixture-meeting'}]};
 assert.equal(await x.run(scope),true);assert.deepEqual(x.state.reads,[{storageMode:'records-v1',readMode:'scoped-v1',scope}]);assert.equal(x.context.recordReadScope.current,scope);assert.equal(x.state.publications.length,1);
});
await check('AS-03-unresolved-source-does-not-fall-back',async()=>{
 const x=setup({binding:null});assert.equal(await x.run(),false);assert.equal(x.state.reads.length,0);assert.match(x.state.alerts[0],/browser-authority-unavailable/);unpublished(x);
});
await check('AS-04-authority-changes-during-business-read',async()=>{
 const entered=deferred(),held=deferred(),x=setup({binding:unmanaged,read:()=>{entered.resolve();return held.promise;}});
 const work=x.run();await entered.promise;x.state.authority=managed;held.resolve(x.remote);
 assert.equal(await work,false);assert.match(x.state.alerts[0],/browser-authority-changed/);unpublished(x);
});
await check('AS-05-authority-changes-after-coordinator-read',async()=>{
 const entered=deferred(),held=deferred(),x=setup(),coordinator=x.context.configIoCoordinator.current,run=coordinator.run.bind(coordinator);
 coordinator.run=async(...args)=>{const value=await run(...args);entered.resolve();await held.promise;return value;};
 const work=x.run();await entered.promise;x.context.originalAuthority.current=unmanaged;held.resolve();
 assert.equal(await work,false);unpublished(x);
});
await check('AS-06-target-rollback-still-rejected',async()=>{
 const x=setup({read:()=>({revision:99,body:'rollback'})});assert.equal(await x.run(),false);assert.match(x.state.alerts[0],/durable floor 100/);unpublished(x);assert.equal(x.context.durableCloudRevisionFloors.current.get(floorIdentity(managed)),100);
});
await check('AS-07-business-read-error-preserves-confirmed-data',async()=>{
 const x=setup({read:()=>{throw new Error('controlled read unavailable');}});assert.equal(await x.run(),false);unpublished(x);assert.match(x.state.alerts[0],/controlled read unavailable/);
});
for(const [name,change] of [
 ['actor',x=>{x.context.liveCurrentUserId.current='successor';}],
 ['session',x=>{x.context.identitySessionGeneration.current++;}],
 ['config',x=>{x.state.config={...x.state.config,workspaceKey:'successor-workspace'};}],
 ['scope-generation',x=>{x.context.actionScopeGeneration.current++;}],
 ['new-draft',x=>{x.context.liveData.current={...x.base,body:'new unsent draft'};}],
 ['editor-lock',x=>{x.context.activeEditLockRef.current={owned:true};}],
 ['batch-editor',x=>{x.context.batchManagedOpenRef.current=true;}],
])await check('AS-08-stale-'+name,async()=>{
 const entered=deferred(),held=deferred(),x=setup({read:()=>{entered.resolve();return held.promise;}});
 const work=x.run();await entered.promise;change(x);const retained=x.context.liveData.current;held.resolve(x.remote);
 assert.equal(await work,false);assert.equal(x.state.confirmations.length,0);assert.equal(x.state.publications.length,0);assert.equal(x.context.recordReadScope.current,'home');assert.equal(x.context.liveData.current,retained);assert.equal(x.context.confirmedCloudData.current,x.base);
});
await check('AS-09-dirty-queue-finishes-before-source-capture',async()=>{
 const remote={revision:100,body:'current expanded target'};
 const x=setup({binding:unmanaged,queue:async(data,context,state)=>{context.originalAuthority.current=managed;state.authority=managed;context.liveData.current={revision:100,body:'saved target base'};},read:()=>remote});
 x.context.liveData.current={...x.base,body:'dirty queued intent'};
 assert.equal(await x.run(),true);assert.equal(x.state.queueCalls,1);assert.equal(x.state.reads[0].storageMode,'legacy');assert.equal(x.context.liveData.current,remote);
});
await check('AS-10-failed-queue-does-not-read-over-draft',async()=>{
 const x=setup({queue:async()=>{throw new Error('controlled queue not confirmed');}}),draft={...x.base,body:'retained draft'};x.context.liveData.current=draft;
 assert.equal(await x.run(),false);assert.equal(x.state.queueCalls,1);assert.equal(x.state.reads.length,0);assert.equal(x.context.liveData.current,draft);assert.equal(x.state.publications.length,0);
});
await check('AS-11-existing-early-return-and-explicit-scope',async()=>{
 const x=setup();assert.equal(await x.run('full',()=>false),false);assert.equal(x.state.reads.length,0);
 assert.equal(await x.run('home',()=>true,false),true);assert.equal(x.state.reads.length,0);
 assert.equal(await x.run('home',()=>true,true),true);assert.equal(x.state.reads[0].scope,'home');
});
assert.equal(new Set(cases.map(x=>x.caseId)).size,cases.length);
console.log(JSON.stringify({status:cases.every(x=>x.status==='PASS')?'PASS':'FAIL',layer:'actual-App-scope-loader-controlled-IO',sourceSha256:createHash('sha256').update(source).digest('hex'),cases,caseCount:cases.length,nativeOrMountedClaim:false}));
if(cases.some(x=>x.status!=='PASS'))process.exitCode=1;

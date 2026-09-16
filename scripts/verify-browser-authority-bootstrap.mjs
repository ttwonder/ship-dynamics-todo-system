import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
import {createServer} from 'vite';

// Execute the current App's bootstrap effect and coordinator, not a copied
// model of their branches. Reads are controlled here; native UI runs are separate.
const text=readFileSync('src/App.tsx','utf8');
const ast=ts.createSourceFile('App.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const find=(test)=>{const found=[];const visit=n=>{if(test(n))found.push(n);ts.forEachChild(n,visit);};visit(ast);assert.equal(found.length,1);return found[0];};
const effect=find(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('const unknownDirtyCache = !cachedIdentity && hasLocalCache;')).arguments[0].getText(ast);
const coordinator=find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createAsyncConfigCoordinator').getText(ast).replace(/^export /,'');
const stale=find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StaleAsyncConfigError').getText(ast).replace(/^export /,'');
const confirm=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='confirmCloudSnapshot').initializer.getText(ast);
const localFunction=name=>find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name).initializer.getText(ast);
const compiled=ts.transpileModule(`${stale}\n${coordinator}\nglobalThis.makeCoordinator=createAsyncConfigCoordinator;globalThis.effect=${effect.replaceAll('import.meta.env.DEV','false')};globalThis.confirmCloudSnapshot=${confirm};globalThis.syncLatest=${localFunction('syncLatest')};globalThis.fetchCloudData=${localFunction('fetchCloudData')};globalThis.assertRemoteExtendsDurableHistory=${localFunction('assertRemoteExtendsDurableHistory')};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const recovery=await server.ssrLoadModule('/src/cloudRecovery.ts');
 const {appDataContentEqual,prepareCloudSyncSnapshot,CloudRebaseConflictError}=await server.ssrLoadModule('/src/cloudRebase.ts');
 const scopes=await server.ssrLoadModule('/src/cloudRecordScopes.ts');
 const {trustedMatchingCloudIdentity}=await server.ssrLoadModule('/src/cloudBootstrapSafety.ts');
 const authority=await server.ssrLoadModule('/src/cloudSourceAuthority.ts');
 const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
 const config={supabaseUrl:'http://127.0.0.1:1',supabaseAnonKey:randomUUID(),workspaceKey:'bootstrap-only',tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'scoped-v1'};
 const binding=authority.parseBrowserAuthority({workspace:config.workspaceKey,managed:true,source:'legacy',epoch:1,pauseState:'resumed',admitted:true},config);
 const identity=recovery.cloudWorkspaceIdentity(config),historyIdentity=authority.authorityFloorIdentity(identity,binding);
 const seed=createInitialData();seed.revision=10;seed.updatedAt='2026-09-13T00:00:00.000Z';
 // Fixture enters through the same storage normalization as a real bootstrap.
 const base=recovery.parseConfirmedCloudBase(recovery.serializeConfirmedCloudBase(historyIdentity,seed),historyIdentity);
 assert.ok(base);assert.ok(appDataContentEqual(base,recovery.parseConfirmedCloudBase(recovery.serializeConfirmedCloudBase(historyIdentity,base),historyIdentity)));
 const ids=[],deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
 async function setup(options={}){
  const selectedBinding=options.binding??binding,selectedConfig=options.config??config;
  const selectedIdentity=recovery.cloudWorkspaceIdentity(selectedConfig),selectedHistory=authority.authorityFloorIdentity(selectedIdentity,selectedBinding);
  const settled=deferred(),local=structuredClone(options.local??base),remote=structuredClone(options.remote??base);
  const floors=new Map([[selectedIdentity,900],[selectedHistory,options.floor??10]]);
  const store=new Map([['cache',JSON.stringify(local)],['owner',selectedIdentity],['base',recovery.serializeConfirmedCloudBase(options.oldSource?selectedIdentity:selectedHistory,options.confirmedBase??base)],['floors',recovery.serializeDurableRevisionFloors(floors)]]),initial=new Map(store);
  const state={config:{...selectedConfig},reads:[],businessReads:[],writes:[],publications:[],submissions:[],fallbackReads:0,phase:null,blocked:null,bootstrapped:false,status:''};
  const context={console,Math,...recovery,...authority,appDataContentEqual,trustedMatchingCloudIdentity,data:local,
   STORAGE_KEY:'cache',CLOUD_CONFIRMED_BASE_KEY:'base',CLOUD_REVISION_FLOORS_KEY:'floors',CLOUD_CACHE_IDENTITY_KEY:'owner',
   localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>{state.writes.push(k);store.set(k,v);}},
   getSupabaseConfig:()=>state.config,cloudIdentity:recovery.cloudWorkspaceIdentity,
   sameCloudConfig:(a,b)=>recovery.cloudConfigIdentity(a)===recovery.cloudConfigIdentity(b),
   cachedCloudIdentityFor:()=>store.get('owner'),durableRevisionFloorRegistryIsValid:()=>recovery.parseDurableRevisionFloors(store.get('floors')).valid,
   durableCloudRevisionFloors:{current:floors},confirmedCloudData:{current:null},originalAuthority:{current:null},activeCloudIdentity:{current:''},lastCloudRevision:{current:-1},hasUnsavedWork:{current:false},recordReadScope:{current:'home'},
   recordRecoveryReadScope:()=> 'full',cleanRecordHomeCacheMatches:()=>false,
   setCloudInitializationAllowed:()=>{},setCloudWriteBlocked:v=>{state.blocked=v;},setSavePhase:v=>{state.phase=v;},setCloudStatus:v=>{state.status=v;},
   setCloudBootstrapped:v=>{state.bootstrapped=v;settled.resolve();},setData:v=>state.publications.push(v),savedStatus:()=> 'confirmed',rememberCloudIdentity:()=>{},
   readBrowserAuthority:async()=>{state.reads.push('authority');if(options.authority) return options.authority();return selectedBinding;},
   readBoundCloudData:async(c,b,signal,confirmed,scope)=>{state.reads.push('bound-business');assert.equal(b,selectedBinding);const effective=authority.authorityConfig(c,b);assert.equal(effective.storageMode,selectedBinding.source);state.businessReads.push({readMode:effective.readMode,scope});if(options.business)return options.business(scope,state);return remote;},
   ...scopes,prepareCloudSyncSnapshot,CloudRebaseConflictError,confirm:()=>true,window:{clearTimeout:()=>{}},
   liveCurrentUserId:{current:'fixture-actor'},identitySessionGeneration:{current:1},liveAuthorizationEpoch:{current:'fixture-authorization'},currentUser:{id:'fixture-actor'},liveData:{current:local},cloudSyncInFlight:{current:false},cloudSaveInFlight:{current:null},saveTimer:{current:null},pendingCloudData:{current:{rejectAll:()=>{}}},
   setCloudSyncing:()=>{},nowIso:()=> '2026-09-13T00:01:00.000Z',enqueueCloudSave:async data=>state.submissions.push(data),retainPageDraftFeedback:()=>false,setStaleBrowserRecoveryOffered:()=>{},showSaveToast:()=>{},classifyCloudSyncFailure:e=>({kind:'controlled',message:e.message}),shouldOfferStaleBrowserRecovery:()=>false,
   fetchCloudDataRpc:async()=>{state.fallbackReads++;return remote;},
  };
  vm.createContext(context);vm.runInContext(compiled,context);context.configIoCoordinator={current:context.makeCoordinator()};
  const cleanup=context.effect();
  return {state,context,store,initial,cleanup,settled:settled.promise,finish:async()=>{await Promise.race([settled.promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('effect did not settle')),2000);timer.unref();})]);}};
 }
 const untouched=x=>{assert.deepEqual(x.store,x.initial);assert.equal(x.state.writes.length,0);assert.equal(x.state.publications.length,0);};
 const pass=id=>ids.push(id);
 let x=await setup();await x.finish();assert.equal(x.state.blocked,false);assert.equal(x.state.phase,'saved');assert.equal(x.context.originalAuthority.current,binding);assert.equal(x.context.confirmedCloudData.current.revision,10);assert.equal(recovery.parseDurableRevisionFloors(x.store.get('floors')).floors.get(identity),900);pass('BOOT-E01-source-specific-floor-not-raw-config-floor');
 const dirty=structuredClone(base);dirty.revision=11;dirty.vessels[0].fullName+=' local draft';
 x=await setup({local:dirty});await x.finish();assert.equal(x.state.blocked,true);assert.ok(appDataContentEqual(x.context.confirmedCloudData.current,base));assert.match(x.state.status,/可信共同基線/);untouched(x);pass('BOOT-E02-same-authority-dirty-cache-preserved-with-base');
 x=await setup({local:dirty,oldSource:true});await x.finish();assert.equal(x.state.blocked,true);assert.equal(x.context.confirmedCloudData.current,null);untouched(x);pass('BOOT-E03-old-source-base-not-relabelled');
 x=await setup({authority:async()=>{throw new Error('controlled-authority-read-failure');}});await x.finish();assert.deepEqual(x.state.reads,['authority']);assert.equal(x.state.phase,'error');untouched(x);pass('BOOT-E04-authority-error-no-business-read-or-cache-write');
 let wait=deferred();x=await setup({authority:()=>wait.promise});x.state.config={...config,workspaceKey:'changed'};wait.resolve(binding);await x.finish();assert.deepEqual(x.state.reads,['authority']);untouched(x);pass('BOOT-E05-config-change-during-authority-read');
 x=await setup({business:async()=>{throw new authority.BrowserAuthorityError('browser-authority-changed');}});await x.finish();assert.equal(x.state.phase,'error');assert.equal(x.context.originalAuthority.current,null);untouched(x);pass('BOOT-E06-source-change-during-business-read');
 wait=deferred();x=await setup({business:()=>wait.promise});await new Promise(resolve=>setImmediate(resolve));assert.ok(x.state.reads.includes('bound-business'));x.state.config={...config,workspaceKey:'changed'};wait.resolve(base);await x.finish();untouched(x);pass('BOOT-E07-config-change-after-business-dispatch');
 x=await setup({floor:20});await x.finish();assert.equal(x.state.blocked,true);assert.match(x.state.status,/durable floor 20/);untouched(x);pass('BOOT-E08-target-floor-rejects-rollback');
 wait=deferred();x=await setup({authority:()=>wait.promise});x.cleanup();wait.resolve(binding);await new Promise(resolve=>setImmediate(resolve));assert.equal(x.state.bootstrapped,false);assert.deepEqual(x.state.reads,['authority']);untouched(x);pass('BOOT-E09-cancelled-effect-does-not-publish');
 x=await setup({local:dirty});await x.finish();await x.context.syncLatest();assert.equal(x.state.submissions.length,1,'same-authority manual sync must use target floor, not retired source floor');assert.equal(x.state.blocked,false);pass('BOOT-E10-manual-sync-target-history-floor');
 x=await setup({local:dirty,floor:20});await x.finish();await x.context.syncLatest();assert.equal(x.state.submissions.length,0);assert.equal(x.state.blocked,true);untouched(x);pass('BOOT-E11-manual-sync-still-rejects-target-rollback');
 x=await setup({authority:async()=>{throw new Error('controlled-authority-read-failure');}});await x.finish();await assert.rejects(()=>x.context.fetchCloudData(config),e=>e instanceof authority.BrowserAuthorityError);assert.equal(x.state.fallbackReads,0);untouched(x);pass('BOOT-E12-unresolved-authority-cannot-fall-back-on-sync');
 const higherBase={...structuredClone(base),revision:20},rolledBack={...structuredClone(base),revision:15};
 x=await setup({local:higherBase,confirmedBase:higherBase,remote:rolledBack,floor:10});await x.finish();assert.equal(x.state.blocked,true);assert.equal(x.context.confirmedCloudData.current,null);await x.context.syncLatest();assert.equal(x.state.blocked,true,'C-01: manual sync must keep the higher base-derived floor');assert.equal(x.state.submissions.length,0);untouched(x);pass('BOOT-E13-base-derived-floor-survives-safe-sync');
 wait=deferred();x=await setup({local:higherBase,confirmedBase:higherBase,floor:10,business:()=>wait.promise});await new Promise(resolve=>setImmediate(resolve));assert.ok(x.state.reads.includes('bound-business'));assert.equal(x.context.durableCloudRevisionFloors.current.get(historyIdentity),10);x.state.config={...config,workspaceKey:'changed'};wait.resolve(rolledBack);await x.finish();assert.equal(x.context.durableCloudRevisionFloors.current.get(historyIdentity),10);untouched(x);pass('BOOT-E14-no-floor-promotion-before-final-config-fence');
 const rawConfig={supabaseUrl:config.supabaseUrl,supabaseAnonKey:config.supabaseAnonKey,workspaceKey:config.workspaceKey,tableName:config.tableName};
 const records={...binding,source:'records-v1',epoch:2};
 const full=structuredClone(base);assert.ok(full.tasks.length);full.tasks[0].statusLogs=Array.from({length:4},(_,i)=>({...full.tasks[0].statusLogs[0],id:`scope-log-${i}`,text:`fixture history ${i}`}));
 const home=structuredClone(full);home.tasks[0].statusLogs=home.tasks[0].statusLogs.slice(0,2);
 x=await setup({binding:records,config:rawConfig,local:full,confirmedBase:full,remote:home});await x.finish();
 assert.equal(x.state.blocked,false);assert.equal(x.state.businessReads[0].readMode,'scoped-v1');assert.equal(x.state.businessReads[0].scope,'home');assert.ok(appDataContentEqual(x.state.publications[0],home));assert.deepEqual(x.state.config,rawConfig);pass('BOOT-R01-managed-records-clean-full-cache-to-home');
 const recordDirty=structuredClone(full);recordDirty.vessels[0].fullName+=' retained draft';
 x=await setup({binding:records,config:rawConfig,local:recordDirty,confirmedBase:full,remote:full});await x.finish();
 assert.equal(x.state.blocked,true);assert.ok(x.state.businessReads[0].scope.targets.some(t=>t.collection==='tasks'&&t.id===full.tasks[0].id));assert.ok(appDataContentEqual(x.context.confirmedCloudData.current,full));untouched(x);pass('BOOT-R02-managed-records-dirty-detail-cache-retained');
 x=await setup({binding:records,config:rawConfig,local:full,confirmedBase:full,remote:home,floor:20});await x.finish();assert.equal(x.state.blocked,true);untouched(x);pass('BOOT-R03-managed-records-clean-transition-keeps-floor');
 const sliding=structuredClone(home);sliding.revision=11;sliding.tasks[0].statusLogs=[{...full.tasks[0].statusLogs[0],id:'new-scope-log',text:'new remote history'},full.tasks[0].statusLogs[0]];
 const expanded=structuredClone(full);expanded.revision=11;expanded.tasks[0].statusLogs=[sliding.tasks[0].statusLogs[0],...full.tasks[0].statusLogs];
 let syncing=false;
 x=await setup({binding:records,config:rawConfig,local:home,confirmedBase:home,remote:home,business:scope=>syncing?(scope==='home'?sliding:expanded):home});await x.finish();
 x.context.liveData.current=structuredClone(home);x.context.liveData.current.vessels[0].fullName+=' local sync draft';syncing=true;await x.context.syncLatest();
 assert.equal(x.state.businessReads.length,3,'managed manual sync must hydrate sliding previews before merging');assert.ok(x.state.businessReads[2].scope.targets.some(t=>t.id===full.tasks[0].id));assert.equal(x.state.submissions.length,1);assert.equal(x.state.blocked,false);pass('BOOT-R04-managed-records-dirty-sync-expands-effective-scope');
 const raw=structuredClone(home);raw.vessels[0].opaqueFixture={kept:['unknown raw field']};const edited=structuredClone(home);edited.vessels[0].fullName+=' updated';
 const edits=scopes.buildRecordScopePatch(home,edited,raw,'home'),vesselEdit=edits.find(op=>op.kind==='entity'&&op.collection==='vessels'&&op.entityId===home.vessels[0].id);
 assert.ok(vesselEdit);assert.deepEqual(vesselEdit.value.opaqueFixture,raw.vessels[0].opaqueFixture);
 const unloaded=structuredClone(home);unloaded.tasks[0].description+=' forbidden summary edit';assert.throws(()=>scopes.buildRecordScopePatch(home,unloaded,raw,'home'),/record-detail-not-loaded/);pass('BOOT-R05-scoped-patch-retains-raw-and-rejects-unloaded-summary');
 const {CLOUD_BLOCK_COLLECTIONS}=await server.ssrLoadModule('/src/cloudBlockPatch.ts');
 const root=Object.fromEntries(Object.entries(full).filter(([key])=>!CLOUD_BLOCK_COLLECTIONS.includes(key)));
 const collections=Object.fromEntries(CLOUD_BLOCK_COLLECTIONS.map(key=>[key,{ids:full[key].map(row=>row.id),rows:full[key].map(row=>({id:row.id,version:full.revision,detail:true,value:row}))}]));
 const complete=scopes.consumeRecordScopes({protocol:'ship-dynamics-record-scopes-v1',workspace_key:rawConfig.workspaceKey,scope:'full',status:'scopes',revision:full.revision,root,collections},rawConfig.workspaceKey,'full',null);
 assert.ok(isDeepStrictEqual(scopes.recordScopePayload(complete),JSON.parse(JSON.stringify(full))),'full read must retain every JSON field (undefined is not transported)');assert.equal(scopes.recordScopePayload(complete).tasks[0].statusLogs.length,4);pass('BOOT-R06-full-protocol-retains-complete-history');
 assert.equal(new Set(ids).size,ids.length);
 console.log(JSON.stringify({status:'PASS',layer:'current-App-effect-controlled-reads',caseIds:ids,caseCount:ids.length,appSourceSha256:createHash('sha256').update(text).digest('hex'),nativeOrHostedClaim:false}));
}finally{await server.close();}

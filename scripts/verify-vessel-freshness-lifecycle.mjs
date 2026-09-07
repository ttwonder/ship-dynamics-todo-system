import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/App.tsx','utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),declarations=new Map();
const visit=n=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name))declarations.set(n.name.text,n.getText(file));ts.forEachChild(n,visit);};visit(file);
const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const coordinator=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createAsyncConfigCoordinator').getText(file).replace('export ','');
const session=fs.readFileSync('src/itemEditSession.ts','utf8').replace('export function','function');
const script=transpile(coordinator+'\n'+session+'\n'+['refreshAfterItemLease','openVesselEditor'].map(n=>'const '+declarations.get(n)+';').join('\n')+'\nglobalThis.open=openVesselEditor;globalThis.refresh=refreshAfterItemLease;');
const rows=[];
for(const scenario of ['current','optout','drain-dirty','dirty-inflight','actor-generation','lease-owner','lease-generation','config','config-ABA','unauthorized','deleted','rollback','history-floor','missing-response','abort']){
 const ref=current=>({current}),base={revision:7,users:[{id:'a',isActive:true}],vessels:[{id:'v1'}]},config={workspaceKey:'a'};
 let current=config,generation=1,confirmed=0,published=0,opened=0,drained=0,floor=0,auth=0,seenBase;
 const lock=ref({sectionKey:'vessel:v1',leaseOwnerId:'lease-a',status:'owned',generation:1});
 const env={exports:{},console,Error,Promise,AbortController,StaleAsyncConfigError:class extends Error{},sameCloudConfig:(a,b)=>JSON.stringify(a)===JSON.stringify(b),getSupabaseConfig:()=>current,activeEditLockRef:lock,lockCoordinator:ref({isCurrent:g=>g===generation}),saveTimer:ref(null),confirmedCloudData:ref(base),liveData:ref(scenario==='drain-dirty'?{...base,revision:8}:base),appDataContentEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
 enqueueCloudSave:async()=>{drained++;env.liveData.current=base;},
 fetchCloudData:async(cfg,signal,provided)=>{seenBase=provided;assert.equal(opened,0,'must not open before freshness resolves');
  if(scenario==='actor-generation'||scenario==='lease-generation')generation++;
  if(scenario==='lease-owner')lock.current={...lock.current,leaseOwnerId:'new-owner'};
  if(scenario==='config')current={workspaceKey:'b'};
  if(scenario==='config-ABA')env.configIoCoordinator.current.invalidate();
  if(scenario==='dirty-inflight')env.liveData.current={...base,revision:9,draft:'retained'};
  if(scenario==='abort')throw new DOMException('aborted','AbortError');
  return scenario==='missing-response'?null:scenario==='rollback'?{...base,revision:6}:scenario==='deleted'?{...base,vessels:[]}:base;},
 cloudWorkspaceIdentity:()=>'',cloudIdentity:()=>'',assertRemoteExtendsDurableHistory:()=>{floor++;if(scenario==='history-floor')throw new Error('floor');},itemLeaseExistsInSnapshot:(key,s)=>s.vessels.some(v=>'vessel:'+v.id===key),itemLeaseIsAuthorizedInSnapshot:()=>{auth++;return scenario!=='unauthorized';},lastCloudRevision:ref(7),confirmCloudSnapshot:()=>{confirmed++;},setData:()=>{published++;},setCloudWriteBlocked:()=>{},setSensitiveCloudStatus:()=>{},releaseCurrentEditLock:async()=>{},alert:()=>{},window:{clearTimeout:()=>{}},invalidatePendingTaskOpen:()=>{},data:base,canEditBusinessContent:true,activeVessels:base.vessels,vesselDisplayName:()=>'',claimEditingLock:async()=> 'owned',setEditingVesselId:()=>{opened++;}};
 env.configIoCoordinator=ref(vm.runInNewContext(transpile(coordinator+';globalThis.result=createAsyncConfigCoordinator();')+';result',{sameCloudConfig:env.sameCloudConfig,StaleAsyncConfigError:env.StaleAsyncConfigError}));
 vm.runInNewContext(script,env);
 if(scenario==='optout')await env.refresh('vessel:v1');else await env.open('v1');
 const ready=['current','optout','drain-dirty'].includes(scenario);assert.equal(published,ready?1:0,scenario);assert.equal(confirmed,published);assert.equal(opened,ready&&scenario!=='optout'?1:0,scenario);assert.equal(seenBase,scenario==='optout'?undefined:base);if(ready){assert.equal(floor,1);assert.equal(auth,1);}if(scenario==='drain-dirty')assert.equal(drained,1);if(scenario==='dirty-inflight')assert.equal(env.liveData.current.draft,'retained');
 rows.push({scenario,confirmed,published,opened,drained,floor,auth});
}
console.log(JSON.stringify({layer:'original App declarations + real session/coordinator; controlled IO',cases:rows.length,rows}));

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/App.tsx','utf8');
const file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declarations=new Map();
const visit=n=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name))declarations.set(n.name.text,n.getText(file));ts.forEachChild(n,visit);};visit(file);
const coordinator=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createAsyncConfigCoordinator').getText(file).replace('export ','');
const names=['listBatchConfig','listBatchConfigToken','listBatchActorId','listBatchSession','listBatchViewVersion','listBatchContext','runTaskMutationWithLockBundle'];
const js=ts.transpileModule(coordinator+'\n'+names.map(n=>'const '+declarations.get(n)+';').join('\n')+'\nglobalThis.runBundle=runTaskMutationWithLockBundle;globalThis.context=listBatchContext;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const cases=[],failures=[];
for(const phase of [1,2])for(const scenario of ['current','actor-same-name','epoch','actor-ABA','config','config-ABA','view','view-ABA']){
 const actor={id:'actor-a',name:'SAME NAME',isActive:true},snapshot={revision:1,users:[actor],tasks:[{id:'task-a'}],internalControlCases:[],meetings:[],settings:{rolePermissions:{}}};
 const config={supabaseUrl:'http://127.0.0.1',workspaceKey:'local-a'},initialConfig={...config};let latest=config,fetches=0,acquisitions=0,mutations=0,releases=0;
 const ref=current=>({current});const liveActor=ref(actor.id),epoch=ref('auth-a'),session=ref(1),view=ref('total'),viewGeneration=ref(0);
 const sameCloudConfig=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const coordinatorRef=ref(vm.runInNewContext(ts.transpileModule(coordinator+';globalThis.result=createAsyncConfigCoordinator();',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+';result',{sameCloudConfig}));
 const switchContext=()=>{if(scenario==='actor-same-name')liveActor.current='actor-b';if(scenario==='epoch')epoch.current='auth-b';if(scenario==='actor-ABA')session.current+=2;if(scenario==='config')latest={...config,workspaceKey:'local-b'};if(scenario==='config-ABA'){coordinatorRef.current.invalidate();latest={...initialConfig};}if(scenario==='view')view.current='closed';if(scenario==='view-ABA')viewGeneration.current+=2;};
 const env={console,currentUser:actor,authorizationEpoch:'auth-a',tab:'total',data:snapshot,liveCurrentUserId:liveActor,liveAuthorizationEpoch:epoch,identitySessionGeneration:session,liveListBatchView:view,listBatchViewGeneration:viewGeneration,configIoCoordinator:coordinatorRef,
 getSupabaseConfig:()=>latest,cloudConfigIdentity:c=>JSON.stringify(c),sameCloudConfig:(a,b)=>JSON.stringify(a)===JSON.stringify(b),cloudIdentity:()=>'',confirmedCloudData:ref(snapshot),liveData:ref(snapshot),appDataContentEqual:()=>true,
 enqueueCloudSave:async()=>{throw new Error('unexpected save before validated mutation');},fetchCloudData:async()=>{fetches++;if(fetches===phase)switchContext();await Promise.resolve();return snapshot;},assertRemoteExtendsDurableHistory:()=>{},selectTasksVisibleToUser:t=>t,batchVisibleVesselIds:()=>new Set(['v1']),taskRelationLockKeys:()=>['task:task-a'],uid:()=> 'lease-a',
 acquireEditLockBundle:async(requests,claim,release,current)=>{acquisitions++;return current()?{status:'owned',leases:requests}:{status:'stale'};},runCloudSaveQueueRpc:async(label,fn)=>fn(),claimEditLock:async()=>({ok:true}),releaseEditLock:async()=>{releases++;},renewEditLock:async()=>({ok:true}),transientCloudBlockLockGuards:ref(new Map()),lastCloudRevision:ref(1),confirmCloudSnapshot:()=>{},flushSync:fn=>fn(),setData:()=>{},setCloudStatus:()=>{},setSensitiveCloudStatus:()=>{},alert:()=>{},window:{setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1},StaleAsyncConfigError:class extends Error {}};
 vm.runInNewContext(js,env);await env.runBundle(['task-a'],'batch',()=>{mutations++;return false;});
 const expected=scenario==='current';const result={phase,scenario,contextCurrent:env.context.isCurrent(),acquisitions,mutations,releases};cases.push(result);
 try{assert.equal(result.contextCurrent,expected);assert.equal(mutations,expected?1:0,'stale operation reached mutation');assert.equal(acquisitions,expected||phase===2?1:0,'stale planning acquired locks');if(phase===2||expected)assert.equal(releases,1,'acquired bundle rollback');}catch(e){failures.push({...result,error:e.message});}
}
console.log(JSON.stringify({layer:'direct original App declarations; controlled IO, not SQL',cases,count:cases.length,failures},null,2));assert.deepEqual(failures,[]);

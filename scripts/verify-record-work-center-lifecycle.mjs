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
 const ref=current=>({current});const liveActor=ref(actor.id),epoch=ref('auth-a'),session=ref(1),view=ref('work'),viewGeneration=ref(0);
 const sameCloudConfig=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const coordinatorRef=ref(vm.runInNewContext(ts.transpileModule(coordinator+';globalThis.result=createAsyncConfigCoordinator();',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+';result',{sameCloudConfig}));
 const switchContext=()=>{if(scenario==='actor-same-name')liveActor.current='actor-b';if(scenario==='epoch')epoch.current='auth-b';if(scenario==='actor-ABA')session.current+=2;if(scenario==='config')latest={...config,workspaceKey:'local-b'};if(scenario==='config-ABA'){coordinatorRef.current.invalidate();latest={...initialConfig};}if(scenario==='view')view.current='closed';if(scenario==='view-ABA')viewGeneration.current+=2;};
 const env={console,currentUser:actor,authorizationEpoch:'auth-a',tab:'work',data:snapshot,liveCurrentUserId:liveActor,liveAuthorizationEpoch:epoch,identitySessionGeneration:session,liveListBatchView:view,listBatchViewGeneration:viewGeneration,configIoCoordinator:coordinatorRef,
 getSupabaseConfig:()=>latest,cloudConfigIdentity:c=>JSON.stringify(c),sameCloudConfig:(a,b)=>JSON.stringify(a)===JSON.stringify(b),cloudIdentity:()=>'',confirmedCloudData:ref(snapshot),liveData:ref(snapshot),appDataContentEqual:()=>true,
 enqueueCloudSave:async()=>{throw new Error('unexpected save before validated mutation');},fetchCloudData:async()=>{fetches++;if(fetches===phase)switchContext();await Promise.resolve();return snapshot;},assertRemoteExtendsDurableHistory:()=>{},selectTasksVisibleToUser:t=>t,batchVisibleVesselIds:()=>new Set(['v1']),taskRelationLockKeys:()=>['task:task-a'],uid:()=> 'lease-a',
 acquireEditLockBundle:async(requests,claim,release,current)=>{acquisitions++;return current()?{status:'owned',leases:requests}:{status:'stale'};},runCloudSaveQueueRpc:async(label,fn)=>fn(),claimEditLock:async()=>({ok:true}),releaseEditLock:async()=>{releases++;},renewEditLock:async()=>({ok:true}),transientCloudBlockLockGuards:ref(new Map()),lastCloudRevision:ref(1),confirmCloudSnapshot:()=>{},flushSync:fn=>fn(),setData:()=>{},setCloudStatus:()=>{},setSensitiveCloudStatus:()=>{},alert:()=>{},window:{setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1},StaleAsyncConfigError:class extends Error {}};
 vm.runInNewContext(js,env);await env.runBundle(['task-a'],'batch',()=>{mutations++;return false;});
 const expected=scenario==='current';const result={phase,scenario,contextCurrent:env.context.isCurrent(),acquisitions,mutations,releases};cases.push(result);
 try{assert.equal(result.contextCurrent,expected);assert.equal(mutations,expected?1:0,'stale operation reached mutation');assert.equal(acquisitions,expected||phase===2?1:0,'stale planning acquired locks');if(phase===2||expected)assert.equal(releases,1,'acquired bundle rollback');}catch(e){failures.push({...result,error:e.message});}
}
console.log(JSON.stringify({layer:'direct original App declarations; controlled IO, not SQL',cases,count:cases.length,failures},null,2));

const dismissJs=ts.transpileModule(names.slice(0,-1).map(n=>'const '+declarations.get(n)+';').join('\n')+'\nconst '+declarations.get('dismissFromMyWorkCenter').replaceAll('import.meta.env.DEV','false')+';globalThis.dismiss=dismissFromMyWorkCenter;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
for(const scenario of ['current','epoch','actor-ABA','config-ABA','view-ABA','foreign','empty','revoked']){
 const actor={id:'actor-a',name:'SAME NAME',isActive:scenario!=='revoked'},snapshot={users:[actor],vessels:[{id:'v1'}],tasks:[{id:'task-a'}],internalControlCases:[],meetings:[],taskDismissals:[],settings:{rolePermissions:{}}};
 const ref=current=>({current});let publications=0,saves=0;const epoch=ref('auth-a'),session=ref(1),viewGeneration=ref(0),config={workspaceKey:'local'};
 const coord=vm.runInNewContext(ts.transpileModule(coordinator+';globalThis.result=createAsyncConfigCoordinator();',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+';result',{sameCloudConfig:(a,b)=>JSON.stringify(a)===JSON.stringify(b)});
 const env={currentUser:actor,authorizationEpoch:'auth-a',tab:'work',data:snapshot,liveData:ref(snapshot),liveCurrentUserId:ref(actor.id),liveAuthorizationEpoch:epoch,identitySessionGeneration:session,liveListBatchView:ref('work'),listBatchViewGeneration:viewGeneration,configIoCoordinator:ref(coord),getSupabaseConfig:()=>config,cloudConfigIdentity:JSON.stringify,sameCloudConfig:()=>true,clone:structuredClone,nowIso:()=> '2026-09-06T00:00:00Z',batchVisibleVesselIds:()=>new Set(['v1']),selectUserWorkCenterTasks:d=>d.tasks,selectUserWorkCenterInternalCases:()=>[],dismissWorkCenterItems:d=>({...d,taskDismissals:[{id:'dismissed'}]}),workCenterDismissalId:()=> 'dismissed',withAudit:d=>d,saveTimer:ref(null),confirmedCloudData:ref({...snapshot,taskDismissals:[{id:'dismissed'}]}),enqueueCloudSave:async()=>{saves++;if(scenario==='epoch')epoch.current='new';if(scenario==='actor-ABA')session.current+=2;if(scenario==='config-ABA')coord.invalidate();if(scenario==='view-ABA')viewGeneration.current+=2;},mergeConfirmedCloudSnapshot:({confirmed})=>confirmed,flushSync:fn=>fn(),setData:()=>{publications++;},saveLocal:()=>{},showSaveToast:()=>{},alert:()=>{},window:{clearTimeout:()=>{}}};
 vm.runInNewContext(dismissJs.replaceAll('import.meta.env.DEV','false'),env);const result=await env.dismiss(scenario==='empty'?[]:[scenario==='foreign'?'other':'task-a']);const expected=scenario==='current';
 cases.push({command:'dismiss',scenario,result,publications,saves});try{assert.equal(result,expected);assert.equal(publications,expected?1:0);assert.equal(saves,['foreign','empty','revoked'].includes(scenario)?0:1);}catch(e){failures.push({command:'dismiss',scenario,error:e.message});}
}
console.log(JSON.stringify({layer:'original App work bundle + dismissal declarations; controlled IO',cases,count:cases.length,failures},null,2));assert.deepEqual(failures,[]);

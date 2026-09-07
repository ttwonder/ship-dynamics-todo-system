import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const app=fs.readFileSync('src/App.tsx','utf8');
const source=ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function arrow(name){let found;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(source)===name)found=n.initializer.getText(source);ts.forEachChild(n,visit);}visit(source);assert.ok(found,name);return ts.transpile('const fn='+found+';', {target:ts.ScriptTarget.ES2022});}
function bind(name,env){return new Function('env','with(env){'+arrow(name)+';return fn;}')(env);}
function exported(name){let found;for(const node of source.statements)if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node.getText(source);assert.ok(found);return new Function(ts.transpile(found.replace('export ',''),{target:ts.ScriptTarget.ES2022})+';return '+name)();}
const coordinator=exported('createTaskOpenRequestCoordinator');
const consume=new Function(ts.transpile(fs.readFileSync('src/taskEditorSession.ts','utf8').replace('export function','function').replace('export type','type'),{target:ts.ScriptTarget.ES2022})+';return consumeCurrentTaskEditorSession;')();
const cases=[];
for(const variation of ['current','actor','identity-ABA','epoch','config','batch-session','old-callback','release-successor','missing-target','foreign-scope','release-rejected']){
 let cleared=0,opened=0,claims=0,release=0;const c=coordinator();
 const context=Object.freeze({vesselIds:Object.freeze(['v1','v2']),userId:'owner',identityGeneration:1,authorizationEpoch:'epoch',cloudIdentity:'cloud',batchSession:4});
 let token=c.begin({vesselId:'',batchManaged:true,batchContext:context});
 const env={taskOpenRequests:{current:c},taskEditorRequestGeneration:token,activeEditLockRef:{current:{sectionKey:'task-create:v2:v1:t',leaseOwnerId:'own'}},editingTaskId:'',creatingTask:{id:'t'},quarantinedCreationDraft:null,
  liveCurrentUserId:{current:'owner'},identitySessionGeneration:{current:1},liveAuthorizationEpoch:{current:'epoch'},batchManagedSession:{current:4},getSupabaseConfig:()=>env.cloud,cloudConfigIdentity:x=>x,cloud:'cloud',
  currentUser:{id:'owner',role:'owner'},authorizationEpoch:'epoch',liveData:{current:{vessels:[{id:'v1',isActive:true},{id:'v2',isActive:true},{id:'v3',isActive:true}]}},batchTargetVessels:[],batchManagedRequested:{current:false},batchManagedOpenRef:{current:false},canEditBusinessContent:true,
  batchTargetVesselsFor:(v,u,ids)=>v.filter(x=>ids.includes(x.id)&&!(variation==='foreign-scope'&&x.id==='v2')),
  pendingTrackedLeases:()=>[],batchLeaseReleaseState:{current:{}},invalidatePendingTaskOpen:()=>{},releaseCurrentEditLock:async()=>{claims++;return false;},ensureCloudDurableBeforeLeaseRelease:async()=>true,alert:()=>{},
  isTaskCreationLockKey:k=>k.startsWith('task-create:'),consumeCurrentTaskEditorSession:consume,clearCreationAttempt:()=>{},activeVessels:[],openVesselEditor:()=>{throw Error('wrong destination');},
  releaseExclusiveItemLease:async()=>{release++;if(variation==='release-successor')c.begin({vesselId:'successor',batchManaged:false});return variation!=='release-rejected';}
 };
 for(const n of ['setEditingTaskId','setTaskEditorRequestGeneration','setTaskEditorAuthorizationEpoch','setTaskProgressVesselId','setTaskReadOnlyData','setTaskReadOnlyReason','setQuarantinedCreationDrafts','setCreatingTask'])env[n]=()=>{cleared++;};
 env.batchTaskReturnIsCurrent=bind('batchTaskReturnIsCurrent',env);
 const originalOpen=bind('openBatchManagedVessels',env);let settled;
 env.openBatchManagedVessels=x=>{opened++;assert.deepEqual(x,context);return settled=originalOpen(x);};
 if(variation==='actor')env.liveCurrentUserId.current='other';if(variation==='identity-ABA')env.identitySessionGeneration.current++;
 if(variation==='epoch')env.liveAuthorizationEpoch.current='new';if(variation==='config')env.cloud='other';if(variation==='batch-session')env.batchManagedSession.current++;
 if(variation==='old-callback')c.begin({vesselId:'new',batchManaged:false});if(variation==='missing-target')env.liveData.current.vessels.pop(),env.liveData.current.vessels.pop();
 await bind('closeTaskEditor',env)(token);if(settled)await settled;
 if(['old-callback','release-successor','release-rejected'].includes(variation)){assert.equal(opened,0);assert.equal(cleared,0);}else{assert.equal(opened,1);assert.equal(claims,variation==='current'?1:0);}
 // Repeated original close cannot consume/open any successor.
 await bind('closeTaskEditor',env)(token);if(settled)await settled;assert.equal(claims,variation==='current'?1:0);
 cases.push('composed-close-return-'+variation);
}
for(const variation of ['current','actor','ABA','epoch','config','batch-session','wrong-vessel','missing-context']){
 let reached=0;const context={vesselIds:['v1','v2'],userId:'owner',identityGeneration:1,authorizationEpoch:'e',cloudIdentity:'c',batchSession:2};
 const env={liveCurrentUserId:{current:'owner'},identitySessionGeneration:{current:1},liveAuthorizationEpoch:{current:'e'},batchManagedSession:{current:2},getSupabaseConfig:()=>env.config,config:'c',cloudConfigIdentity:x=>x,requireLogin:()=>{reached++;return false;}};
 env.batchTaskReturnIsCurrent=bind('batchTaskReturnIsCurrent',env);
 if(variation==='actor')env.liveCurrentUserId.current='other';if(variation==='ABA')env.identitySessionGeneration.current++;
 if(variation==='epoch')env.liveAuthorizationEpoch.current='other';if(variation==='config')env.config='other';if(variation==='batch-session')env.batchManagedSession.current++;
 assert.equal(await bind('addTaskForVessel',env)(variation==='wrong-vessel'?'v3':'v1',false,true,variation==='missing-context'?undefined:context),false);
 assert.equal(reached,variation==='current'?1:0);cases.push('source-add-entrance-'+variation);
}
console.log(JSON.stringify({layer:'source-composed original close/coordinator/open with controlled lease I/O; NOT UI/SQL E2E',scenarios:cases}));

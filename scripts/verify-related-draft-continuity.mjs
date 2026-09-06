import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createHash} from 'node:crypto';

// Execute production closures and their upstream renewal/expiry decisions.
// Controlled time/I/O/state, NOT mounted React, real network or SQL evidence.
const source=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const app=source('src/App.tsx'),page=source('src/InternalControlPage.tsx');
const parse=s=>ts.createSourceFile('source.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function initializer(text,name){const file=parse(text),found=[];function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)===name&&n.initializer)found.push(n.initializer.getText(file));ts.forEachChild(n,visit);}visit(file);assert.equal(found.length,1,name);return found[0];}
const evaluate=(s,ctx)=>new Function('ctx',`with(ctx){${transpile('return ('+s+');')}}`)(ctx);
const effects=[];{const f=parse(app);function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(f)==='useEffect')effects.push(n.arguments[0].getText(f));ts.forEachChild(n,visit);}visit(f);}
const expiry=effects.find(s=>s.includes('scheduleValidatedLeaseExpiry'));
const renewal=initializer(app,'renewSingleItemLease');
const run=initializer(app,'runDurableRelatedMutation');
const observations=[];
for(const entity of ['task','internal-control'])for(const settled of [false,true])for(const event of ['renewal-error','renewal-loss','deadline','late-renewal']){
 let now=100000,expiryCallback,releases=0,closed=0,readonlyFetches=0,completeRenewal;
 const renewalGate=new Promise(resolve=>{completeRenewal=resolve;});
 const locks={},durable={};new Function('exports','Date',transpile(source('src/editLockCoordinator.ts')))(locks,{now:()=>now,parse:Date.parse});new Function('exports',transpile(source('src/durableRelatedMutation.ts')))(durable);
 const coordinator=locks.createEditLockCoordinator(),config={qa:true},generation=coordinator.beginGeneration();
 const task={id:'t1',vesselId:'v1',description:'baseline'},item={id:'c1',vesselId:'v1',description:'baseline'};
 const lease={sectionKey:entity==='task'?'task:t1':'internal-control:c1',leaseOwnerId:'opaque-owner',ownerUserId:'actor',authorizationEpoch:'epoch',generation,status:'owned',validatedUntilMs:now+60000};
 const baseline={tasks:[task],internalControlCases:[item]};
 const ctx={...locks,...durable,relatedMutationHandoffVersion:0,internalControlEditLockKey:id=>'internal-control:'+id,label:'delete',actorId:'actor',currentUser:{id:'actor',role:'owner'},authorizationEpoch:'epoch',expectedAuthorizationEpoch:'epoch',identitySessionGeneration:{current:5},expectedIdentityGeneration:5,liveCurrentUserId:{current:'actor'},liveAuthorizationEpoch:{current:'epoch'},config,expectedLease:lease,sectionKey:lease.sectionKey,activeEditLock:lease,activeEditLockRef:{current:lease},lockCoordinator:{current:coordinator},leaseCloudConfigs:{current:new Map([[lease.leaseOwnerId,{sectionKey:lease.sectionKey,config}]])},getSupabaseConfig:()=>config,sameCloudConfig:(a,b)=>a===b,confirmedCloudData:{current:baseline},liveData:{current:baseline},data:{...baseline,tasks:[],internalControlCases:[]},relatedMutationHandoffInFlight:{current:null},liveAuthorizedEditLockKeys:{current:new Set([lease.sectionKey])},editingTaskId:'t1',taskEditorAuthorizationEpoch:'epoch',readOnlyTask:undefined,creatingTask:null,canCreateTasks:true,roleVisibleTasks:[],taskReadOnlyData:null,preservedCreationDraft:false,creatingVisibleTask:false,editingTaskCanMutate:true,activeVessels:[{id:'v1'}],useMemo:fn=>fn(),selectInternalControlCasesVisibleToUser:items=>items,lock:lease,renewalInFlight:false,renewalStillCurrent:()=>coordinator.isCurrent(generation),creationHandoffInFlight:{current:null},creationHandoffMatches:()=>false,isTaskCreationLockKey:()=>false,liveCreatingTaskId:{current:''},vesselSaveLeaseOwners:{current:new Set()},runCloudSaveQueueRpc:async(_label,fn)=>fn(),renewEditLock:async()=>{if(event==='late-renewal')return renewalGate;if(event==='renewal-error')throw new Error('controlled renewal transport failure');return {ok:false};},releaseEditLock:async()=>{releases++;},setSensitiveCloudStatus:()=>{},clearRetryTimer:()=>{},clearVesselLeaseIncident:()=>{},setActiveEditLock:update=>{ctx.activeEditLock=typeof update==='function'?update(ctx.activeEditLock):update;ctx.activeEditLockRef.current=ctx.activeEditLock;},scheduleValidatedLeaseExpiry:(_deadline,fn)=>{expiryCallback=fn;},taskProgressVesselId:'',closeEditorForLock:()=>{closed++;ctx.editingTaskId='';},taskOpenRequests:{current:{peek:()=>null,invalidate:()=>{closed++;},begin:()=>1,isCurrent:()=>true}},setEditingTaskId:id=>{ctx.editingTaskId=id;closed++;},setTaskEditorRequestGeneration:()=>{},setTaskEditorAuthorizationEpoch:()=>{},setTaskProgressVesselId:()=>{},setTaskReadOnlyData:()=>{},setTaskReadOnlyReason:()=>{},setCreatingTask:()=>{},openTaskReadOnly:async()=>{readonlyFetches++;return 'opened';},closeTaskEditor:()=>{},transitionExpiredTaskLease:async o=>{o.invalidateLease();const g=o.closeWritableAndBeginReadOnly();await o.openLatestReadOnly(g);},alert:()=>{},freezeVesselEditorForLock:()=>false};

 ctx.mutationLeaseIsOwned=evaluate(initializer(app,'mutationLeaseIsOwned'),ctx);
 if(run.includes('const identityIsCurrent='))ctx.identityIsCurrent=evaluate(initializer(run,'identityIsCurrent'),ctx);
 ctx.sessionIsCurrent=evaluate(initializer(run,'sessionIsCurrent'),ctx);
 // Use the actual handoff factory call from App: never substitute isCurrent=true.
 const handoff=evaluate(initializer(run,'mutationHandoff'),ctx);ctx.relatedMutationHandoffInFlight.current=handoff;
 ctx.relatedMutationHandoffMatchesCurrent=evaluate(initializer(app,'relatedMutationHandoffMatchesCurrent'),ctx);
 if(app.includes('const freezeRelatedMutationDraft='))ctx.freezeRelatedMutationDraft=evaluate(initializer(app,'freezeRelatedMutationDraft'),ctx);
 if(settled)handoff.finish(false,false);
 assert.equal(ctx.relatedMutationHandoffMatchesCurrent(lease),true,'initial exact identity');
 if(event==='late-renewal'){evaluate(renewal,ctx)();for(let n=0;n<5;n++)await Promise.resolve();evaluate(expiry,ctx)();now=lease.validatedUntilMs;expiryCallback();completeRenewal({ok:true,expiresAt:new Date(now+75000).toISOString()});await coordinator.run(async()=>{});await Promise.resolve();}
 else if(event==='deadline'){evaluate(expiry,ctx)();now=lease.validatedUntilMs;expiryCallback();}
 else {evaluate(renewal,ctx)();await coordinator.run(async()=>{});await Promise.resolve();}
 ctx.retainedRelatedTask=evaluate(initializer(app,'retainedRelatedTask'),ctx);
 ctx.editingTask=evaluate(initializer(app,'editingTask'),ctx);
 const readOnly=evaluate(initializer(app,'taskEditorReadOnly'),ctx);ctx.taskEditorReadOnly=readOnly;
 const taskRendered=Boolean(ctx.editingTask&&evaluate(initializer(app,'taskEditorLeaseAuthorized'),ctx));
 const projected=evaluate(initializer(app,'roleVisibleInternalControlCases'),ctx);
 const pageCtx={editing:item,editorAuthorizationEpoch:'epoch',authorizationEpoch:'epoch',scopedCases:projected,activeItemLeaseKey:ctx.mutationLeaseIsOwned(lease.sectionKey)?lease.sectionKey:'',internalControlEditLockKey:id=>'internal-control:'+id,canMutateItem:true,itemLeaseEnforced:true};
 const rendered=entity==='task'?taskRendered:evaluate(initializer(page,'visibleEditing'),pageCtx);
 assert.equal(rendered,true,`${entity}/${settled}/${event}: exact same-identity original draft must remain rendered`);
 assert.equal(entity==='task'?readOnly:!evaluate(initializer(page,'editorWritable'),pageCtx),true,'retention is read-only');
 assert.equal(ctx.mutationLeaseIsOwned(lease.sectionKey),false,'zero write capability');
 assert.equal(ctx.sessionIsCurrent(),false,'planning/dispatch still requires owned lease');
 assert.equal(closed,0,'no destructive close');assert.equal(readonlyFetches,0,'no replacement editor from latest cloud');assert.equal(releases,0,'no premature expiry release');
 assert.ok(ctx.leaseCloudConfigs.current.has(lease.leaseOwnerId),'captured lease record retained');
 for(const field of ['sectionKey','leaseOwnerId','ownerUserId','authorizationEpoch','generation'])assert.equal(ctx.relatedMutationHandoffMatchesCurrent({...lease,[field]:field==='generation'?999:'wrong'}),false,'wrong '+field);
 for(const [target,field,bad] of [[ctx.liveCurrentUserId,'current','wrong'],[ctx.liveAuthorizationEpoch,'current','wrong'],[ctx.identitySessionGeneration,'current',6]]){const before=target[field];target[field]=bad;assert.equal(ctx.relatedMutationHandoffMatchesCurrent(ctx.activeEditLock),false,'current authority mismatch');target[field]=before;}
 const originalConfig=ctx.getSupabaseConfig;ctx.getSupabaseConfig=()=>({wrong:true});assert.equal(ctx.relatedMutationHandoffMatchesCurrent(ctx.activeEditLock),false,'config mismatch');ctx.getSupabaseConfig=originalConfig;
 const record=ctx.leaseCloudConfigs.current.get(lease.leaseOwnerId);record.config={wrong:true};assert.equal(ctx.relatedMutationHandoffMatchesCurrent(ctx.activeEditLock),false,'captured record config mismatch');record.config=config;
 // Execute the actual unsafe primitive callers, not just the render predicates.
 ctx.StaleAsyncConfigError=class extends Error{};
 await assert.rejects(evaluate(initializer(app,'enqueueCloudSave'),ctx)(baseline),ctx.StaleAsyncConfigError,'global retry cannot submit a new operation after loss');
 assert.equal(evaluate(initializer(app,'requireMutationLease'),ctx)(lease.sectionKey),false);
 assert.equal(closed,0);assert.equal(releases,0);
 ctx.waitForDurableCreationHandoff=async()=>{};ctx.setCloudStatus=()=>{};
 const release=evaluate(initializer(app,'releaseCurrentEditLock'),ctx);
 let completed=false;const pendingRelease=release().then(value=>{completed=true;return value;});
 for(let n=0;n<5;n++)await Promise.resolve();
 if(!settled)assert.equal(completed,false,'pending release awaits original operation');
 handoff.finish(false,false);assert.equal(await pendingRelease,false,'settled rejection still defers release');assert.equal(releases,0);
 coordinator.invalidate();assert.equal(ctx.relatedMutationHandoffMatchesCurrent(ctx.activeEditLock),false,'coordinator generation mismatch');
 observations.push({entity,settled,event,rendered,readonly:true,writes:0,releases,closed,readonlyFetches});
}
console.log(JSON.stringify({layer:'actual source-composed controlled renewal/expiry and renderer matrix',cases:observations.length,sourceHashes:Object.fromEntries(['src/App.tsx','src/InternalControlPage.tsx','src/editLockCoordinator.ts','src/durableRelatedMutation.ts'].map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),observations},null,2));

// Only trusted local source is compiled above; no external strings enter code generation.
const queue=initializer(app,'enqueueCloudSave');
// The old notice can finish releasing before the component's explicit Close runs.
const closeReleased=evaluate(initializer(app,'releaseExclusiveItemLease'),{activeEditLockRef:{current:null}});
assert.equal(await closeReleased('internal-control:c1'),true,'explicit Case close after completed lease cleanup must remain possible');
const closeWrong=evaluate(initializer(app,'releaseExclusiveItemLease'),{activeEditLockRef:{current:{sectionKey:'internal-control:other'}}});
assert.equal(await closeWrong('internal-control:c1'),false,'wrong entity still cannot release');
function property(text,name){const f=parse(text),found=[];function visit(n){if(ts.isPropertyAssignment(n)&&n.name.getText(f)===name)found.push(n.initializer.getText(f));ts.forEachChild(n,visit);}visit(f);assert.equal(found.length,1,name);return found[0];}
const receipts={};new Function('exports',transpile(source('src/cloudBlockReceipt.ts')))(receipts);
for(const status of ['committed','missing']){
 let writable=true,submits=0,lookups=0,clock=0;
 const context={canSubmit:()=>writable,StaleAsyncConfigError:class extends Error{},token:{},getSupabaseConfig:()=>({qa:true}),configIoCoordinator:{current:{run:async(_t,_g,fn)=>fn({qa:true})}},runCloudSaveQueueRpc:async(_label,fn)=>fn(),operations:[{id:'same-envelope'}],savedBy:'actor',actorUserId:'actor',actorGuard:{id:'actor'},strictAuthorizationGuard:null,guards:[{section_key:'task:t1',locked_by:'opaque'}],applyCloudBlockPatchV2:async id=>{assert.equal(id,'original-operation');submits++;writable=false;throw new Error('lost ACK');},getCloudBlockPatchReceipt:async id=>{assert.equal(id,'original-operation');lookups++;return status==='missing'?{status}:{ok:true,status,operationId:id,revision:2,updatedAt:'2026-09-06',replayed:true};}};
 const invoke=()=>receipts.runCloudBlockPatchWithReceipt({operationId:'original-operation',submit:evaluate(property(queue,'submit'),context),lookup:evaluate(property(queue,'lookup'),context),assertCurrent:()=>{},shouldReconcile:error=>!(error instanceof context.StaleAsyncConfigError),now:()=>clock,sleep:async ms=>{clock+=ms;}});
 if(status==='committed')assert.equal((await invoke()).operationId,'original-operation');else await assert.rejects(invoke(),context.StaleAsyncConfigError);
 assert.equal(submits,1,'no second mutation after lease loss');assert.equal(lookups,1,'same-operation readonly recovery');
}
console.log('Actual App submit/lookup + production receipt: committed recovery and missing-status no-resubmit PASS (2 controlled cases)');

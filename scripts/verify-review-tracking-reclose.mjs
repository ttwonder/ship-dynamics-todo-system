import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {createServer} from 'vite';
const report={id:'R5-F01',layer:'production tracking/IC/task planners + statistics; synthetic data; no UI or SQL',cases:[],inputs:{}};
for(const f of ['src/tracking/trackingLifecycle.ts','src/tracking/trackingWorkflow.ts','src/internalControlData.ts','src/tracking/trackingStatistics.ts'])report.inputs[f]=createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const vite=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');const wf=await vite.ssrLoadModule('/src/tracking/trackingWorkflow.ts');const ic=await vite.ssrLoadModule('/src/internalControlData.ts');const {trackingStatisticsFacts}=await vite.ssrLoadModule('/src/tracking/trackingStatistics.ts');
 const base=createInitialData();base.tasks=[];base.internalControlCases=[];base.trackingItems=[];
 const actor={...base.users[0],id:'qa-owner',name:'QA OWNER',username:'qa-owner',role:'owner',isActive:true,managedVesselIds:[]};base.users=[actor];base.settings.departments=['資材組','督導','船工處'];
 let seq=0;const at='2026-09-25T10:00:00.000Z';const ctx=()=>({actorId:actor.id,at,operationId:'qa-repro-'+(++seq)});
 const source={id:'qa-engineering',kind:'engineering',vesselId:base.vessels[0].id,referenceNo:'QA-ONLY-1',description:'Synthetic repair',applicationDate:'2026-09-24',urgency:'normal',progress:'待處理',supplementalNotes:'',expectedDate:'2026-09-26',deliveryStatus:'not-delivered',isClosed:false,statusLogs:[]};
 let state=wf.runTrackingCommand(base,{type:'create',items:[source]},ctx());
 const pref=wf.prefillTrackingCase(state,state.trackingItems[0],'qa-case');pref.item.syncToTask=true;
 state=wf.runTrackingCommand(state,{type:'sync',items:[{id:source.id,expectedUpdatedAt:at,item:pref.item,projection:{categories:['其他'],expectedDate:'2026-09-26',ownerUserIds:[],isAbnormal:false}}]},ctx());
 assert.equal(state.tasks.length,1);assert.equal(state.internalControlCases.length,1);assert.equal(state.trackingItems[0].linkState,'active');
 const linked=structuredClone(state);
const cancelled=wf.runTrackingCommand(linked,{type:'lifecycle',action:'close',date:'2026-09-25',outcome:'cancelled',targets:[{entry:'tracking',id:source.id,expectedUpdatedAt:at}]},ctx());
assert.equal(trackingStatisticsFacts(cancelled.trackingItems[0],'2026-09-25').cancelled,true);
const fromRelated=(d,entry,closed,date='2026-09-25')=>{
 if(entry==='internal-control'){const c=d.internalControlCases[0];ic.updateInternalControlCase(d,{...c,isClosed:closed,closedDate:closed?date:undefined},c.updatedAt,actor,at);}
 else {const t=d.tasks[0],old=structuredClone(t);Object.assign(t,{isClosed:closed,closedDate:closed?date:undefined,closedBy:closed?actor.id:undefined});ic.reconcileInternalControlAfterTaskSave(d,old,t,actor,at);}
 return d;
};
for(const reopen of ['internal-control','task','tracking']){
 let opened=reopen==='tracking'?wf.runTrackingCommand(cancelled,{type:'lifecycle',action:'reopen',targets:[{entry:'tracking',id:source.id,expectedUpdatedAt:at}]},ctx()):fromRelated(structuredClone(cancelled),reopen,false);
 assert.equal(opened.trackingItems[0].isClosed,false);assert.equal(trackingStatisticsFacts(opened.trackingItems[0],'2026-09-25').cancelled,false);
 opened=wf.runTrackingCommand(opened,{type:'edit',items:[{id:source.id,expectedUpdatedAt:at,changes:{completionDate:'2026-09-25'}}]},ctx());
 for(const entry of ['internal-control','task','tracking']){
  const d=entry==='tracking'?wf.runTrackingCommand(opened,{type:'lifecycle',action:'close',date:'2026-09-25',targets:[{entry:'tracking',id:source.id,expectedUpdatedAt:at}]},ctx()):fromRelated(structuredClone(opened),entry,true);
  const s=d.trackingItems[0],facts=trackingStatisticsFacts(s,'2026-09-25');assert.equal(s.closureOutcome,'completed','R5-F01 ordinary related close must supersede previous cancellation');assert.equal(s.completionDate,'2026-09-25');assert.equal(s.deliveryStatus,opened.trackingItems[0].deliveryStatus);assert.equal(facts.completed,true);assert.equal(facts.cancelled,false);
  assert.deepEqual(s.events.slice(0,opened.trackingItems[0].events.length),opened.trackingItems[0].events,'immutable prior events');assert.equal(s.events.at(-1).action,'close');assert.ok(d.tasks[0].isClosed&&d.internalControlCases[0].isClosed);
  report.cases.push({reopen,entry,outcome:s.closureOutcome,completionDate:s.completionDate,eventActions:s.events.map(e=>e.action)});
 }
}
for(const entry of ['internal-control','task']){const corrected=fromRelated(structuredClone(cancelled),entry,true,'2026-09-26');assert.equal(corrected.trackingItems[0].closureOutcome,'cancelled','correcting cancelled close date is not a new completion');}
report.status='PASS';console.log('PASS R5-F01',report.cases.length,'reopen/close pairs; dates and history retained; cancellation correction preserved');
}catch(error){report.status='FAIL';report.error=error.stack;throw error;}finally{await vite.close();if(process.env.QA_EVIDENCE_ROOT)fs.writeFileSync(path.join(process.env.QA_EVIDENCE_ROOT,'R5-F01-'+report.status+'-'+Date.now()+'.json'),JSON.stringify(report,null,2));}

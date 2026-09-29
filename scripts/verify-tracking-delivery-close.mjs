import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';import React from 'react';
const baseline=process.argv.includes('--baseline')?execFileSync('git',['show','216fb7eb17a3504b311f43fd6b4ec6831c39fc07:src/tracking/trackingWorkflow.ts'],{encoding:'utf8'}):null;
const vite=await createServer({plugins:baseline?[{name:'immutable-pre-fix-domain',enforce:'pre',load(id){if(id.replaceAll('\\','/').endsWith('/src/tracking/trackingWorkflow.ts'))return baseline;}}]:[],server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
try{
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {runTrackingCommand,prefillTrackingCase}=await vite.ssrLoadModule('/src/tracking/trackingWorkflow.ts');
 const {makeTrackingDraft,commandForTrackingDraft,TrackingBusinessModal}=await vite.ssrLoadModule('/src/tracking/TrackingModals.tsx');
 const {shipTrackingCommand}=await vite.ssrLoadModule('/src/tracking/shipTracking.ts');
 let data=createInitialData();data.trackingItems=[];data.internalControlCases=[];data.tasks=[];
 const user=data.users.find(u=>u.role==='owner')||data.users[0];user.role='owner';user.isActive=true;const vessel=data.vessels.find(v=>v.isActive);
 const ctx=n=>({actorId:user.id,operationId:'deliver-close-'+n,at:`2026-09-29T10:00:${String(n).padStart(2,'0')}.000Z`});
 const base={vesselId:vessel.id,kind:'supply',requestType:'spares',referenceNo:'SAME',description:'物料',applicationDate:'2026-09-01',urgency:'normal',expectedDate:'2026-10-01',progress:'原進度',deliveryStatus:'not-delivered',supplementalNotes:'補充不变'};
 data=runTrackingCommand(data,{type:'create',items:['a','b','untouched'].map(id=>({...base,id,description:id+'物料'}))},ctx(1));
 const source=data.trackingItems[0],{item}=prefillTrackingCase(data,source,'linked-case');
 data=runTrackingCommand(data,{type:'sync',items:[{id:source.id,expectedUpdatedAt:source.updatedAt,item}]},ctx(2));
 const rows=data.trackingItems.slice(0,2),command={type:'delivery',items:rows.map(r=>({id:r.id,expectedUpdatedAt:r.updatedAt,status:'delivered',date:'2026-09-29',note:r.id+' 全數已到',closeOnDelivery:true}))};
 const before=structuredClone(data),after=runTrackingCommand(data,command,ctx(3));
 for(const old of rows){const row=after.trackingItems.find(r=>r.id===old.id);assert.equal(row.isClosed,true,'delivery with explicit opt-in must close in same result');assert.equal(row.actualDeliveryDate,'2026-09-29');assert.equal(row.closedDate,row.actualDeliveryDate);assert.equal(row.expectedDate,old.expectedDate);assert.equal(row.supplementalNotes,old.supplementalNotes);assert.deepEqual(row.events.slice(-2).map(e=>e.action),['delivery','close']);assert.equal(row.events.at(-1).operationId,row.events.at(-2).operationId);assert.equal(row.progress,old.progress+'\n送船備註：'+old.id+' 全數已到');}
 assert.equal(after.internalControlCases[0].isClosed,true);assert.equal(after.internalControlCases[0].closedDate,'2026-09-29');assert.equal(after.internalControlCases[0].status,after.trackingItems[0].progress);assert.deepEqual(after.trackingItems[2],before.trackingItems[2]);assert.deepEqual(data,before);cases.push('explicit-delivery-close-atomic-same-date-linked-case-note-and-unselected');
 for(const flag of [undefined,false]){const plain={type:'delivery',items:command.items.map(r=>({...r,closeOnDelivery:flag}))};assert.ok(runTrackingCommand(data,plain,ctx(4)).trackingItems.every(r=>!r.isClosed));}cases.push('default-and-explicit-false-never-close');
 for(const itemPatch of [{status:'partially-delivered',date:''},{status:'not-delivered',date:''},{date:'2026-08-31'},{closeOnDelivery:'true'},{closeOnDelivery:null},{expectedUpdatedAt:'stale'}]){const invalid={...command,items:[command.items[0],{...command.items[1],...itemPatch}]};assert.throws(()=>runTrackingCommand(data,invalid,ctx(5)));assert.deepEqual(data,before);}cases.push('partial-missing-invalid-date-stale-and-nonboolean-reject-whole-plan');
 const closed=structuredClone(data);closed.trackingItems[1].isClosed=true;closed.trackingItems[1].closedDate='2026-09-20';assert.throws(()=>runTrackingCommand(closed,command,ctx(6)),/lifecycle|closed/);cases.push('already-closed-selection-cannot-reclose');
 const restricted=structuredClone(data),operator=restricted.users.find(u=>u.id===user.id);operator.role='operator';operator.managedVesselIds=[vessel.id];restricted.settings.rolePermissions.operator.closeTasks=false;
 assert.throws(()=>runTrackingCommand(restricted,command,ctx(7)),/tracking-permission/);assert.ok(!runTrackingCommand(restricted,{type:'delivery',items:command.items.map(i=>({...i,closeOnDelivery:false}))},ctx(8)).trackingItems[0].isClosed);cases.push('existing-edit-without-close-permission-remains-edit-only');
 for(const audience of ['shore','ship']){
  let draft=makeTrackingDraft('delivery',rows,data),changed;const nodes=node=>Array.isArray(node)?node.flatMap(nodes):React.isValidElement(node)?[node,...nodes(node.props.children)]:[];
  const props=()=>({draft,audience,canClose:true,busy:false,pending:false,message:'',affected:[],vesselName:'測試船',onChange:value=>{changed=value;},onSave:()=>{},onReconcile:()=>{},onClose:()=>{}});
  const checkbox=()=>nodes(TrackingBusinessModal(props())).find(n=>n.type==='input'&&n.props['aria-label']==='同時結案');
  assert.ok(checkbox());assert.equal(checkbox().props.checked,false);assert.ok(!Object.hasOwn(commandForTrackingDraft(draft).items[0],'closeOnDelivery'),'old default serialization preserved');
  checkbox().props.onChange({target:{checked:true}});draft=changed;draft.date='2026-09-29';const payload=commandForTrackingDraft(draft);assert.ok(payload.items.every(i=>i.closeOnDelivery===true));assert.deepEqual(shipTrackingCommand({command:payload},vessel.id),payload);
  nodes(TrackingBusinessModal(props())).find(n=>n.type==='select'&&n.props['aria-label']==='送船狀態').props.onChange({target:{value:'partially-delivered'}});draft=changed;assert.equal(checkbox().props.checked,false);assert.equal(checkbox().props.disabled,true);assert.ok(commandForTrackingDraft(draft).items.every(i=>!Object.hasOwn(i,'closeOnDelivery')));
  draft.closeOnDelivery=true;assert.throws(()=>commandForTrackingDraft(draft),/全部|已送船|結案/);
  draft=makeTrackingDraft('delivery',rows,data);const denied=nodes(TrackingBusinessModal({...props(),canClose:false})).find(n=>n.type==='input'&&n.props['aria-label']==='同時結案');assert.equal(denied.props.disabled,true);
  cases.push(audience+'-checkbox-default-explicit-input-reset-permission-and-legacy-payload');
 }
 console.log(JSON.stringify({gate:'tracking-delivery-close',status:'PASS',caseCount:cases.length,cases}));
}finally{await vite.close();}

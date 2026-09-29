import assert from 'node:assert/strict';
import {createServer} from 'vite';import React from 'react';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'}),cases=[];
try{
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {runTrackingCommand,prefillTrackingCase}=await vite.ssrLoadModule('/src/tracking/trackingWorkflow.ts');
 const {makeTrackingDraft,commandForTrackingDraft,TrackingBusinessModal}=await vite.ssrLoadModule('/src/tracking/TrackingModals.tsx');
 const {shipTrackingCommand}=await vite.ssrLoadModule('/src/tracking/shipTracking.ts');
 let data=createInitialData();data.trackingItems=[];data.internalControlCases=[];data.tasks=[];
 const user=data.users.find(u=>u.role==='owner')||data.users[0];user.role='owner';user.isActive=true;const vessel=data.vessels.find(v=>v.isActive);
 const ctx=n=>({actorId:user.id,operationId:'completion-close-'+n,at:`2026-09-29T10:00:${String(n).padStart(2,'0')}.000Z`});
 const base={vesselId:vessel.id,kind:'engineering',requestType:'repair',referenceNo:'SAME',description:'工程',applicationDate:'2026-09-01',urgency:'normal',expectedDate:'2026-10-01',progress:'原進度',deliveryStatus:'not-delivered',supplementalNotes:'補充不變'};
 data=runTrackingCommand(data,{type:'create',items:['a','b','untouched'].map(id=>({...base,id,description:id+'工程'}))},ctx(1));
 const source=data.trackingItems[0],{item}=prefillTrackingCase(data,source,'linked-case');
 data=runTrackingCommand(data,{type:'sync',items:[{id:source.id,expectedUpdatedAt:source.updatedAt,item}]},ctx(2));
 const rows=data.trackingItems.slice(0,2),command={type:'edit',items:rows.map(r=>({id:r.id,expectedUpdatedAt:r.updatedAt,changes:{completionDate:'2026-09-29'},closeOnCompletion:true}))};
 const before=structuredClone(data),after=runTrackingCommand(data,command,ctx(3));
 for(const old of rows){const row=after.trackingItems.find(r=>r.id===old.id);assert.equal(row.isClosed,true,'explicit completion opt-in must close atomically');assert.equal(row.closedDate,row.completionDate);assert.equal(row.closureOutcome,'completed');for(const field of ['progress','statusLogs','expectedDate','supplementalNotes','deliveryStatus'])assert.deepEqual(row[field],old[field]);assert.deepEqual(row.events.slice(-2).map(e=>e.action),['completion','close']);assert.equal(row.events.at(-1).operationId,row.events.at(-2).operationId);assert.equal(row.events.at(-1).at,row.events.at(-2).at);}
 assert.equal(after.internalControlCases[0].isClosed,true);assert.equal(after.internalControlCases[0].closedDate,'2026-09-29');assert.deepEqual(after.trackingItems[2],before.trackingItems[2]);assert.deepEqual(data,before);cases.push('CC-D01-atomic-completion-close-linked-case-unchanged-unselected');
 for(const flag of [undefined,false]){const cmd={type:'edit',items:command.items.map(({closeOnCompletion,...r})=>({...r,...(flag===undefined?{}:{closeOnCompletion:flag})}))};const plain=runTrackingCommand(data,cmd,ctx(4));assert.ok(plain.trackingItems.every(r=>!r.isClosed));assert.equal(plain.trackingItems[0].completionDate,'2026-09-29');const again={...command,items:command.items.map(r=>({...r,expectedUpdatedAt:plain.trackingItems.find(i=>i.id===r.id).updatedAt}))};const closed=runTrackingCommand(plain,again,ctx(5));assert.deepEqual(closed.trackingItems[0].events.slice(-2).map(e=>e.action),['completion','close']);assert.equal(closed.trackingItems[0].events.at(-2).before.completionDate,'2026-09-29');}cases.push('CC-D02-default-false-and-same-date-then-close');
 for(const itemPatch of [{changes:{completionDate:''}},{changes:{completionDate:'2026-02-30'}},{changes:{completionDate:'2026-08-31'}},{changes:{completionDate:4}},{changes:{completionDate:'2026-09-29',description:'extra'}},{closeOnCompletion:'true'},{closeOnCompletion:null},{expectedUpdatedAt:'stale'}]){assert.throws(()=>runTrackingCommand(data,{...command,items:[command.items[0],{...command.items[1],...itemPatch}]},ctx(6)));assert.deepEqual(data,before);}cases.push('CC-D03-invalid-later-item-nochange-strict-flag-extra-fields');
 for(const mutate of [d=>{d.trackingItems[1].kind='supply';d.trackingItems[1].requestType='spares';},d=>{d.trackingItems[1].isClosed=true;d.trackingItems[1].closedDate='2026-09-20';},d=>{d.internalControlCases[0].reportDate='2026-09-30';}]){const d=structuredClone(data);mutate(d);assert.throws(()=>runTrackingCommand(d,command,ctx(7)));}cases.push('CC-D04-nonengineering-closed-linked-date-rejected');
 const restricted=structuredClone(data),operator=restricted.users.find(u=>u.id===user.id);operator.role='operator';operator.managedVesselIds=[vessel.id];restricted.settings.rolePermissions.operator.closeTasks=false;
 assert.throws(()=>runTrackingCommand(restricted,command,ctx(8)),/tracking-permission/);assert.equal(runTrackingCommand(restricted,{type:'edit',items:command.items.map(i=>({...i,closeOnCompletion:false,changes:{completionDate:'2026-08-01'}}))},ctx(9)).trackingItems[0].isClosed,false);restricted.settings.rolePermissions.operator.closeTasks=true;restricted.settings.rolePermissions.operator.editBusinessContent=false;assert.throws(()=>runTrackingCommand(restricted,command,ctx(8)),/tracking-permission/);cases.push('CC-D05-both-permissions-and-plain-date-rule-unchanged');
 if(!process.argv.includes('--domain-only'))for(const audience of ['shore','ship']){
  let draft=makeTrackingDraft('completion',rows,data),changed;const nodes=node=>Array.isArray(node)?node.flatMap(nodes):React.isValidElement(node)?[node,...nodes(node.props.children)]:[];
  const props=()=>({draft,audience,canClose:true,busy:false,pending:false,message:'',affected:[],vesselName:'測試船',onChange:value=>{changed=value;},onSave:()=>{},onReconcile:()=>{},onClose:()=>{}});
  const checkbox=(overrides={})=>nodes(TrackingBusinessModal({...props(),...overrides})).find(n=>n.type==='input'&&n.props['aria-label']==='同時結案');
  assert.ok(nodes(TrackingBusinessModal(props())).some(n=>n.type==='p'&&typeof n.props.children==='string'&&n.props.children.includes('預設不結案')),'completion help must explain opt-in');
  assert.ok(checkbox(),'completion checkbox present');assert.equal(checkbox().props.checked,false);assert.ok(commandForTrackingDraft(draft).items.every(i=>!Object.hasOwn(i,'closeOnCompletion')));
  checkbox().props.onChange({target:{checked:true}});draft=changed;draft.date='2026-09-29';const payload=commandForTrackingDraft(draft);assert.ok(payload.items.every(i=>i.closeOnCompletion===true));assert.deepEqual(shipTrackingCommand({command:payload},vessel.id),payload);
  assert.ok(nodes(TrackingBusinessModal(props())).some(n=>n.type==='button'&&n.props.children==='確認完工並結案 2 項'));
  for(const overrides of [{canClose:false},{readOnly:true},{busy:true},{pending:true}]){changed=null;const box=checkbox(overrides);assert.equal(box.props.disabled,true);box.props.onChange({target:{checked:false}});assert.equal(changed,null,'disabled handler must not mutate draft');}
  draft=makeTrackingDraft('completion',rows,data);assert.equal(checkbox().props.checked,false);draft.closeOnCompletion=false;assert.ok(commandForTrackingDraft(draft).items.every(i=>!Object.hasOwn(i,'closeOnCompletion')));
  draft.originals[1].isClosed=true;draft.closeOnCompletion=true;assert.throws(()=>commandForTrackingDraft(draft),/工程|結案/);assert.equal(checkbox().props.disabled,true);
  cases.push('CC-C-'+audience+'-unchecked-wire-reset-readonly-permission-and-confirmation');
 }
 console.log(JSON.stringify({gate:'tracking-completion-close',status:'PASS',caseCount:cases.length,cases}));
}finally{await vite.close();}

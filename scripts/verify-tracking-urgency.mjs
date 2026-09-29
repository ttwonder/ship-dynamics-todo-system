import assert from 'node:assert/strict';
import React from 'react';
import {createServer} from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
const walk=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(walk)]:[];
try{
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {TrackingBusinessModal,makeTrackingDraft,commandForTrackingDraft,newTrackingItem}=await vite.ssrLoadModule('/src/tracking/TrackingModals.tsx');
 const {TrackingItemFields}=await vite.ssrLoadModule('/src/tracking/TrackingItemFields.tsx');
 const {TRACKING_REQUEST_TYPES}=await vite.ssrLoadModule('/src/tracking/trackingRequestTypes.ts');
 const {importRowErrors,selectImportBatch}=await vite.ssrLoadModule('/src/tracking/trackingImport.ts');
 const data=createInitialData(),vessel=data.vessels.find(v=>v.isActive);
 for(const action of ['create','edit'])for(const type of TRACKING_REQUEST_TYPES){
  const row={...newTrackingItem(vessel.id,type.kind),requestType:type.value,referenceNo:'QA-URGENT',description:'有效欄位',updatedAt:'2026-09-29T00:00:00Z',urgency:'urgent'};
  const fields=walk(TrackingItemFields({row,prefix:'第 1 筆 ',creating:action==='create',onChange:()=>{}}));
  const notes=fields.find(n=>n.type==='textarea'&&n.props['aria-label']==='第 1 筆 補充說明');
  assert.equal(notes.props.required,true,action+' '+type.value+' urgent notes marked required');
  for(const blank of ['', ' \t\n　 ']){row.supplementalNotes=blank;assert.throws(()=>commandForTrackingDraft(makeTrackingDraft(action,[row],data)),/補充說明/,'blank urgent notes rejected before submission');}
  row.supplementalNotes='急迫原因';assert.ok(commandForTrackingDraft(makeTrackingDraft(action,[row],data)));
  row.urgency='normal';row.supplementalNotes='';assert.ok(commandForTrackingDraft(makeTrackingDraft(action,[row],data)));
  const normal=walk(TrackingItemFields({row,prefix:'第 1 筆 ',creating:action==='create',onChange:()=>{}})).find(n=>n.type==='textarea'&&n.props['aria-label']==='第 1 筆 補充說明');assert.ok(!normal.props.required);
  cases.push(action+'-'+type.value+'-conditional-required-and-command-validation');
 }
 const legacy={...newTrackingItem(vessel.id,'supply'),referenceNo:'QA-OLD',description:'舊緊急資料',urgency:'urgent',progress:'原進度'};
 const progress=makeTrackingDraft('progress',[legacy],data);progress.rows[0].progress='新進度';assert.equal(commandForTrackingDraft(progress).type,'progress');cases.push('legacy-urgent-progress-not-retroactively-blocked');
 const imp={key:'i1',sourceRow:2,item:legacy,issues:[],acknowledgements:[],selected:true};assert.ok(importRowErrors(imp).some(s=>s.includes('補充說明')));assert.throws(()=>selectImportBatch([imp],[],[]));imp.item={...legacy,supplementalNotes:'急件新增說明'};assert.deepEqual(importRowErrors(imp),[]);assert.equal(selectImportBatch([imp],[],[]).length,1);cases.push('shared-import-preview-required-matches-save-validation');
 for(const audience of ['shore','ship'])for(const action of ['create','edit']){
  const draft=makeTrackingDraft(action,[{...legacy,supplementalNotes:''}],data);
  const props={draft,audience,busy:false,pending:true,message:'',affected:[],vesselName:'QA',onChange:()=>{},onSave:()=>{},onReconcile:()=>{},onClose:()=>{}};
  const tree=TrackingBusinessModal(props);assert.equal(walk(tree).find(n=>n.type==='form').props.noValidate,true,'exact pending receipt retry must not be blocked by newly invalid unsent form');
  assert.match(renderToStaticMarkup(React.createElement(TrackingBusinessModal,{...props,pending:false})),/補充說明 \*/);cases.push(audience+'-'+action+'-required-render-and-exact-pending-retry');
 }
 if(!process.argv.includes('--required-only')){
  const rows=[{...legacy,id:'u1',urgency:'normal',supplementalNotes:'第一項原說明'}, {...legacy,id:'u2',supplementalNotes:'第二項原說明'}];
  const fresh=()=>makeTrackingDraft('urgency',rows,data);
  const initial=fresh();assert.ok(initial.urgencyChange,'batch urgency draft exists');assert.equal(initial.urgencyChange.urgency,'');assert.equal(initial.urgencyChange.notes,'');
  assert.throws(()=>commandForTrackingDraft(initial),/急迫度/);
  for(const urgency of ['normal','urgent']){
   const draft=fresh();draft.urgencyChange={urgency,notes:' \n　'};assert.throws(()=>commandForTrackingDraft(draft),/補充說明/);
   draft.urgencyChange.notes='  核對供應時間後調整  ';const before=structuredClone(draft),cmd=commandForTrackingDraft(draft);
   assert.equal(cmd.type,'edit');assert.deepEqual(cmd.items,rows.map(row=>({id:row.id,expectedUpdatedAt:row.updatedAt,changes:{urgency,supplementalNotes:row.supplementalNotes+'\n急迫度改為'+(urgency==='urgent'?'緊急':'普通')+'：核對供應時間後調整'}})));assert.deepEqual(draft,before);
   const reordered=structuredClone(draft);reordered.rows.reverse();assert.deepEqual(commandForTrackingDraft(reordered),cmd,'notes bound to original ID, not row position');
   cases.push('batch-'+urgency+'-requires-new-note-and-appends-only-own-source-fields');
  }
  for(const mutate of [d=>{d.rows=[];},d=>{d.rows[1]=d.rows[0];},d=>{d.rows[1].id='other';},d=>{d.originals[1].isClosed=true;},d=>{d.originals[1].vesselId='other';},d=>{d.urgencyChange.urgency='invalid';},d=>{d.urgencyChange.notes='長'.repeat(2001);},d=>{d.originals[1].supplementalNotes='舊'.repeat(10000);}]){
   const draft=fresh();draft.urgencyChange={urgency:'normal',notes:'新的說明'};mutate(draft);assert.throws(()=>commandForTrackingDraft(draft));
  }
  for(const n of [0,100,101]){const draft=fresh();draft.originals=Array.from({length:n},(_,i)=>({...rows[0],id:'limit-'+i}));draft.rows=structuredClone(draft.originals);draft.urgencyChange={urgency:'urgent',notes:'明確批量調整'};if(n===100)assert.equal(commandForTrackingDraft(draft).items.length,n);else assert.throws(()=>commandForTrackingDraft(draft));}cases.push('batch-exact-selection-closed-scope-and-length-guards');
  for(const audience of ['shore','ship']){
   let next=null;const draft=fresh();const props={draft,audience,busy:false,pending:false,message:'',affected:[],vesselName:'QA',onChange:v=>{next=v;},onSave:()=>{},onReconcile:()=>{},onClose:()=>{}};
   const tree=TrackingBusinessModal(props),nodes=walk(tree),choice=nodes.find(n=>n.type==='input'&&n.props['aria-label']==='改為緊急');
   assert.ok(choice);choice.props.onChange();assert.equal(next.urgencyChange.urgency,'urgent');assert.equal(next.dirty,true);
   const input=nodes.find(n=>n.type==='textarea'&&n.props['aria-label']==='本次急迫度補充說明');assert.equal(input.props.required,true);assert.equal(nodes.filter(n=>n.type==='input'&&n.props.type==='date').length,0);
   for(const guard of [{busy:true},{pending:true},{readOnly:true}]){next=null;const guarded=walk(TrackingBusinessModal({...props,...guard}));guarded.find(n=>n.type==='input'&&n.props['aria-label']==='改為緊急').props.onChange();assert.equal(next,null);assert.ok(guarded.some(n=>n.type==='fieldset'&&n.props.disabled));}
   cases.push(audience+'-batch-dialog-required-choice-and-frozen-pending');
  }
 }
 console.log(JSON.stringify({gate:'tracking-urgency',status:'PASS',layer:'Production component/command with synthetic data; not browser/native SQL',caseCount:cases.length,cases}));
}finally{await vite.close();}

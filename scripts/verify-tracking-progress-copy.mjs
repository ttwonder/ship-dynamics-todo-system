import assert from 'node:assert/strict';
import React from 'react';
import {createServer} from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[],label='複製第一項更新至全部',priorConfirm=globalThis.confirm;
const walk=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(walk)]:[];
const caption=node=>React.Children.toArray(node.props.children).filter(child=>typeof child==='string').join('');
try{
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {TrackingBusinessModal,makeTrackingDraft,commandForTrackingDraft}=await vite.ssrLoadModule('/src/tracking/TrackingModals.tsx');
 const data=createInitialData(),vessel=data.vessels.find(v=>v.isActive),at='2026-09-29T00:00:00Z';
 const rows=Array.from({length:3},(_,i)=>({id:'progress-copy-'+i,vesselId:vessel.id,kind:'supply',requestType:'spares',referenceNo:'SAME-REF',description:'獨立內容 '+i,applicationDate:'2026-09-01',expectedDate:'',urgency:'normal',progress:'各項原有進度 '+i,supplementalNotes:'備註 '+i,deliveryStatus:'not-delivered',isClosed:false,createdBy:'qa',updatedBy:'qa',createdAt:at,updatedAt:at,statusLogs:[{id:'own-log-'+i,by:'qa',at,text:'本項歷史 '+i}]}));
 const fresh=()=>makeTrackingDraft('progress',rows,data);
 const text='高雄交船／施工\n同一地點，分別核對完成情形';
 for(const audience of ['shore','ship']){
  let next=null,saves=0,prompts=0,answer=true;
  globalThis.confirm=message=>{assert.match(message,/覆蓋/);prompts++;return answer;};
  const render=(draft,overrides={})=>TrackingBusinessModal({draft,audience,busy:false,pending:false,message:'',affected:[],vesselName:'測試船 QA',onChange:value=>{next=value;},onSave:()=>{saves++;},onReconcile:()=>{},onClose:()=>{},...overrides});
  const button=tree=>walk(tree).find(node=>node.type==='button'&&caption(node)===label);
  const initial=render(fresh());
  const histories=walk(initial).filter(node=>node.type==='details'&&node.props['aria-label']==='進度更新記錄');
  assert.equal(histories.length,3);assert.ok(histories.every(node=>!node.props.open),'each progress history must start collapsed');
  assert.ok(renderToStaticMarkup(initial).includes('本項歷史 2'),'history retained, not removed');
  cases.push(audience+'-all-progress-histories-initially-collapsed-and-retained');
  const draft=fresh();draft.rows[0].progress=text;
  const before=structuredClone(draft),control=button(render(draft));assert.ok(control,'copy button exists');assert.equal(control.props.type,'button');assert.equal(control.props.disabled,false);control.props.onClick();
  assert.equal(prompts,0,'unchanged saved prefill needs no overwrite prompt');assert.equal(saves,0);assert.equal(next.dirty,true);assert.deepEqual(draft,before);
  assert.deepEqual(next.originals,draft.originals);
  assert.deepEqual(next.rows,draft.rows.map(row=>({...row,progress:text})),'only progress is copied, not source identity/history/metadata');
  assert.deepEqual(commandForTrackingDraft(next).items,draft.originals.map(row=>({id:row.id,expectedUpdatedAt:row.updatedAt,text})));
  cases.push(audience+'-copy-exact-first-draft-text-only-no-auto-save');
  for(const variant of [{busy:true},{pending:true},{readOnly:true},{blank:''},{blank:' \n '},{one:true}]){
   const guarded=structuredClone(draft);if('blank' in variant)guarded.rows[0].progress=variant.blank;if(variant.one){guarded.rows=guarded.rows.slice(0,1);guarded.originals=guarded.originals.slice(0,1);}
   next=null;const n=button(render(guarded,variant));assert.equal(n.props.disabled,true);n.props.onClick();assert.equal(next,null);assert.equal(saves,0);
  }
  cases.push(audience+'-busy-pending-readonly-empty-single-guards');
  const edited=structuredClone(draft);edited.rows[1].progress='已另外輸入的獨立內容';const editedBefore=structuredClone(edited);answer=false;next=null;button(render(edited)).props.onClick();assert.equal(prompts,1);assert.equal(next,null);assert.deepEqual(edited,editedBefore);
  answer=true;button(render(edited)).props.onClick();assert.equal(prompts,2);assert.ok(next.rows.every(row=>row.progress===text));assert.equal(saves,0);
  cases.push(audience+'-overwrite-manual-edit-cancel-and-confirm');
  const removed=fresh();removed.rows.shift();removed.originals.shift();removed.rows[0].progress='移除後的目前首項';next=null;button(render(removed)).props.onClick();assert.ok(next.rows.every(row=>row.progress===removed.rows[0].progress));assert.equal(next.rows.length,2);
  const largeRows=Array.from({length:100},(_,i)=>({...rows[i%3],id:'large-'+i}));const large=makeTrackingDraft('progress',largeRows,data);large.rows[0].progress=text;next=null;button(render(large)).props.onClick();assert.equal(next.rows.length,100);assert.ok(next.rows.every(row=>row.progress===text));
  cases.push(audience+'-current-first-after-removal-and-100-row-batch');
  assert.equal(button(render(makeTrackingDraft('edit',rows,data))),undefined);assert.equal(button(render(makeTrackingDraft('delivery',rows,data))),undefined);
  cases.push(audience+'-copy-control-limited-to-progress-dialog');
 }
 console.log(JSON.stringify({gate:'tracking-progress-copy',status:'PASS',layer:'Production component render/callbacks + synthetic data; not browser or database acceptance',caseCount:cases.length,cases}));
}finally{if(priorConfirm===undefined)delete globalThis.confirm;else globalThis.confirm=priorConfirm;await vite.close();}

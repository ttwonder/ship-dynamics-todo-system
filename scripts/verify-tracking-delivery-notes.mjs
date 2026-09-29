import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
try {
 const React=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {runTrackingCommand,prefillTrackingCase}=await vite.ssrLoadModule('/src/tracking/trackingWorkflow.ts');
 const {TrackingBusinessModal,makeTrackingDraft,commandForTrackingDraft}=await vite.ssrLoadModule('/src/tracking/TrackingModals.tsx');
 const {shipTrackingCommand}=await vite.ssrLoadModule('/src/tracking/shipTracking.ts');
 let data=createInitialData();data.trackingItems=[];data.tasks=[];data.internalControlCases=[];
 const actor=data.users.find(u=>u.role==='owner')||data.users[0];actor.role='owner';actor.isActive=true;
 const vessel=data.vessels.find(v=>v.isActive);
 const context=n=>({actorId:actor.id,at:`2026-09-29T08:00:${String(n).padStart(2,'0')}.000Z`,operationId:'delivery-note-'+n});
 const input=id=>({id,kind:'supply',requestType:'spares',vesselId:vessel.id,referenceNo:'REQ-'+id,description:'備件 '+id,applicationDate:'2026-09-01',urgency:'normal',expectedDate:'',progress:'原進度',supplementalNotes:'保留補充',deliveryStatus:'not-delivered',isClosed:false,createdBy:'',updatedBy:'',createdAt:'',updatedAt:'',statusLogs:[]});
 data=runTrackingCommand(data,{type:'create',items:['first','second','unselected'].map(input)},context(1));
 const first=data.trackingItems[0],{item}=prefillTrackingCase(data,first,'note-case');
 data=runTrackingCommand(data,{type:'sync',items:[{id:first.id,expectedUpdatedAt:first.updatedAt,item}]},context(2));
 const before=structuredClone(data),selected=data.trackingItems.slice(0,2);
 const cmd={type:'delivery',items:selected.map((r,i)=>({id:r.id,expectedUpdatedAt:r.updatedAt,status:'partially-delivered',date:'',note:i?'已送乙；丙未送':'已送濾芯 2 個\n未送墊片 3 個'}))};
 const result=runTrackingCommand(data,cmd,context(3));
 assert.equal(result.trackingItems[0].progress,'原進度\n送船備註：已送濾芯 2 個\n未送墊片 3 個','delivery notes append to latest progress atomically');
 assert.equal(result.trackingItems[1].progress,'原進度\n送船備註：已送乙；丙未送');
 for(const old of selected){const row=result.trackingItems.find(r=>r.id===old.id);assert.equal(row.deliveryStatus,'partially-delivered');assert.equal(row.actualDeliveryDate,undefined);assert.equal(row.isClosed,false);assert.equal(row.supplementalNotes,old.supplementalNotes);assert.equal(row.statusLogs[0].text,row.progress);assert.deepEqual(row.statusLogs.slice(1),old.statusLogs);assert.equal(row.events.at(-1).action,'delivery');}
 assert.equal(result.internalControlCases[0].status,result.trackingItems[0].progress);assert.equal(result.internalControlCases[0].description,before.internalControlCases[0].description);
 assert.deepEqual(result.trackingItems[2],before.trackingItems[2]);assert.deepEqual(data,before);
 cases.push('atomic-partial-delivery-appends-each-note-preserves-history-linked-status-and-unselected');
 for(const note of [undefined,'','   \n\t']){const command={type:'delivery',items:[{...cmd.items[0],note}]};const row=runTrackingCommand(data,command,context(4)).trackingItems[0];assert.equal(row.progress,first.progress);assert.deepEqual(row.statusLogs,data.trackingItems[0].statusLogs);}
 cases.push('blank-note-preserves-existing-progress-and-history');
 for(const patch of [{isClosed:true},{}]){const d=structuredClone(data);if(patch.isClosed)d.trackingItems[0].isClosed=true;else d.internalControlCases[0].isClosed=true;assert.throws(()=>runTrackingCommand(d,cmd,context(5)),/closed/);assert.deepEqual(data,before);}
 assert.throws(()=>runTrackingCommand(data,{...cmd,items:[cmd.items[0],{...cmd.items[1],expectedUpdatedAt:'stale'}]},context(6)),/stale/);assert.deepEqual(data,before);
 for(const note of [23,'字'.repeat(2001)])assert.throws(()=>runTrackingCommand(data,{type:'delivery',items:[{...cmd.items[0],note}]},context(7)),/note|備註/);
 const long=structuredClone(data);long.trackingItems[0].progress='字'.repeat(9998);assert.throws(()=>runTrackingCommand(long,{type:'delivery',items:[cmd.items[0]]},context(7)),/progress|進度/);
 cases.push('closed-stale-invalid-and-overlong-batches-reject-without-source-mutation');
 for(const audience of ['shore','ship']){
  let draft=makeTrackingDraft('delivery',selected,data);draft.delivery='partially-delivered';
  const nodes=node=>Array.isArray(node)?node.flatMap(nodes):React.isValidElement(node)?[node,...nodes(node.props.children)]:[];
  let changed;
  const props=()=>({draft,audience,busy:false,pending:false,message:'',affected:[],vesselName:'測試輪',onChange:value=>{changed=value;},onSave:()=>{},onReconcile:()=>{},onClose:()=>{}});
  const tree=TrackingBusinessModal(props());
  const fields=nodes(tree).filter(n=>n.type==='textarea');assert.equal(fields.length,2,'one note field per exact source');
  fields[0].props.onChange({target:{value:'甲已送；乙未送'}});draft=changed;assert.equal(draft.dirty,true);
  nodes(TrackingBusinessModal(props())).filter(n=>n.type==='textarea')[1].props.onChange({target:{value:'丙已送；丁未送'}});draft=changed;
  draft.rows.reverse();const payload=commandForTrackingDraft(draft);
  assert.equal(payload.items[0].note,'甲已送；乙未送');assert.equal(payload.items[1].note,'丙已送；丁未送');
  assert.deepEqual(shipTrackingCommand({command:payload},vessel.id),payload);
  const html=renderToStaticMarkup(React.createElement(TrackingBusinessModal,props()));assert.ok(html.includes('追加至最新進度'));assert.ok(!html.includes('type="date"'),'partial delivery does not create an actual-delivery fact');
  if(audience==='ship')assert.ok(!html.includes('要事'));
  const blank=commandForTrackingDraft(makeTrackingDraft('delivery',selected,data));assert.ok(blank.items.every(row=>!Object.hasOwn(row,'note')),'legacy no-note payload bytes remain unchanged');
  cases.push(audience+'-per-source-input-dirty-id-mapping-command-serialization-and-blank-compatibility');
 }
 console.log(JSON.stringify({gate:'tracking-delivery-notes',label:'真實domain／共用元件＋測試資料，非正式環境',status:'PASS',caseCount:cases.length,cases}));
}finally{await vite.close();}

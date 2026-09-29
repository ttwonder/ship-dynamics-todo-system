import assert from 'node:assert/strict';
// Original shore/ship UI, native local SQL and synthetic records only.
export async function trackingDeliveryNoteChecks({qa,evaluate,call,click,nodeClick,fill,until,screen,check,audience,finish}){
 const refs=['NOTE-UI-A','NOTE-UI-B'];
 const noteFor=ref=>`[aria-label="${ref} 送船備註"]`;
 const set=async(label,value)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')});if(!n||n.disabled)throw new Error('field unavailable');Object.getOwnPropertyDescriptor(n.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
 const choose=async references=>{await click('清除選取');for(const ref of references)await nodeClick(`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.querySelector('.tracking-reference')?.innerText.includes(${JSON.stringify(ref)})).querySelector('input[type=checkbox]')`);};
 const open=async references=>{await choose(references);await click('批量送達／更正');await until(()=>evaluate('Boolean(document.querySelector(".tracking-delivery-notes textarea"))'),'note editor ready');await set('送船狀態','partially-delivered');};
 const savedDraft=()=>evaluate("Object.values(localStorage).map(v=>{try{return JSON.parse(v)}catch{return null}}).find(v=>v?.pending?.command?.type==='delivery')");
 await check(audience+'-delivery-note-original-UI-batch-fixtures',async()=>{
  await click('＋ 新增／批量新增');
  for(let i=0;i<refs.length;i++){if(i)await click('＋ 新增一列');const p=`第 ${i+1} 筆 `;await fill(`[aria-label="${p}申請單號(材料或工程)"]`,refs[i]);await fill(`[aria-label="${p}內容摘要/工程內容"]`,'送船備註測試 '+refs[i]);await fill(`[aria-label="${p}最新進度"]`,'原進度');await set(p+'申請/開單日期','2026-09-01');}
  await click('確認保存 2 項');await finish();
 });
 await check(audience+'-delivery-notes-distinct-batch-pending-ACK-and-mobile-layout',async()=>{
  await open(refs);assert.equal(await evaluate('document.querySelectorAll(".tracking-delivery-notes textarea").length'),2);assert.equal(await evaluate('document.querySelectorAll(".tracking-modal input[type=date]").length'),0);
  await fill(noteFor(refs[0]),'已送濾芯 2 個\n未送墊片 3 個');await fill(noteFor(refs[1]),'乙已送；丙未送');
  await evaluate('document.querySelector(".tracking-delivery-notes").scrollIntoView({block:"center"})');assert.ok(await evaluate('[...document.querySelectorAll(".tracking-delivery-notes textarea")].every(n=>n.getBoundingClientRect().width>=n.parentElement.getBoundingClientRect().width-2)'), 'note input should use the label row width, not a tiny inline box');await screen(audience+'-delivery-notes-desktop');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate('document.querySelector(".tracking-delivery-notes").scrollIntoView({block:"center"})');assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));assert.ok(await evaluate('[...document.querySelectorAll(".tracking-delivery-notes textarea")].every(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1})'));await screen(audience+'-delivery-notes-mobile');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  if(audience==='ship')assert.ok(!await evaluate('document.body.innerText.includes("要事")'));
  const before=await qa.read();let entered=false,release;const hold=new Promise(resolve=>{release=resolve;});
  qa.setRecordFault({after:async({name,body})=>{if(name===(audience==='ship'?'ship_dynamics_tracking_public_v1':'apply_ship_dynamics_record_patch_v1')&&(audience==='shore'||body.p_action==='submit')){entered=true;await hold;}return false;}});
  try{
   await click('確認保存 2 項');await until(()=>entered,'native SQL before held ACK');const pending=await savedDraft();assert.equal(pending.pending.command.items.length,2);assert.equal(pending.draft.deliveryNotes[pending.draft.originals[0].id],pending.pending.command.items[0].note);assert.ok(await evaluate('Boolean(document.querySelector(".tracking-delivery-notes"))'));
   const after=await qa.read();assert.equal(after.revision,before.revision+1);
   for(const [i,ref] of refs.entries()){const row=after.payload.trackingItems.find(r=>r.referenceNo===ref),old=before.payload.trackingItems.find(r=>r.id===row.id);assert.equal(row.progress,'原進度\n送船備註：'+(i?'乙已送；丙未送':'已送濾芯 2 個\n未送墊片 3 個'));assert.equal(row.deliveryStatus,'partially-delivered');assert.equal(row.actualDeliveryDate,undefined);assert.equal(row.isClosed,false);assert.deepEqual(row.statusLogs.slice(1),old.statusLogs);}
   assert.deepEqual(after.payload.trackingItems.filter(r=>!refs.includes(r.referenceNo)),before.payload.trackingItems.filter(r=>!refs.includes(r.referenceNo)));
   release();await finish();
  }finally{release();qa.setRecordFault(null);}
 });
 await check(audience+'-delivery-note-lost-ACK-retry-appends-once-and-blank-leaves-progress',async()=>{
  await open([refs[0]]);await fill(noteFor(refs[0]),'補送墊片，仍缺螺帽');const before=await qa.read();let committed=false;
  const matches=(name,body)=>audience==='ship'?name==='ship_dynamics_tracking_public_v1'&&['submit','receipt'].includes(body.p_action):['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1'].includes(name);
  qa.setRecordFault({after:async({name,body,value})=>{if(!matches(name,body))return false;if(audience==='shore'||body.p_action==='submit'&&value.ok)committed=true;return committed;}});
  try{
   await click('確認保存 1 項');await until(()=>evaluate('document.body.innerText.includes("尚未保存；輸入及精確提交已保留")'),'unknown outcome retained',90_000);assert.ok(committed);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(noteFor(refs[0]))}).value`),'補送墊片，仍缺螺帽');const pending=await savedDraft();assert.equal(pending.pending.command.items[0].note,'補送墊片，仍缺螺帽');
   const after=await qa.read();assert.equal(after.revision,before.revision+1);const row=after.payload.trackingItems.find(r=>r.referenceNo===refs[0]);assert.equal(row.progress.split('補送墊片，仍缺螺帽').length,2);
   qa.setRecordFault(null);await click('確認結果／重試相同提交');await finish();assert.deepEqual(await qa.read(),after);
   await open([refs[0]]);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(noteFor(refs[0]))}).value`),'');await click('確認保存 1 項');await finish();const blank=(await qa.read()).payload.trackingItems.find(r=>r.id===row.id);assert.equal(blank.progress,row.progress);assert.deepEqual(blank.statusLogs,row.statusLogs);
   await choose([refs[0]]);await click('批量更新進度');await until(()=>evaluate(`Boolean(document.querySelector('[aria-label="${refs[0]} 最新進度"]'))`),'progress text');assert.equal(await evaluate(`document.querySelector('[aria-label="${refs[0]} 最新進度"]').value`),row.progress);await screen(audience+'-delivery-note-latest-progress');await click('取消');await until(()=>evaluate('!document.querySelector(".modal-backdrop")'),'clean progress editor closed');
  }finally{qa.setRecordFault(null);}
 });
}

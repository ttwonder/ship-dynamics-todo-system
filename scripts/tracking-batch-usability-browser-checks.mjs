import assert from 'node:assert/strict';
// Original production entry, private native PostgreSQL and synthetic data only.
export async function trackingBatchUsabilityChecks({qa,evaluate,call,click,nodeClick,fill,until,screen,check,audience,finish}){
 const descriptions=['批量濾芯 2 個；其餘未送','批量墊片 3 個；與濾芯同申請單'];
 const refs=['BATCH-SAME','BATCH-SAME','BATCH-UNSELECTED'];
 const set=async(label,value)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')});if(!n||n.disabled)throw new Error('field unavailable');Object.getOwnPropertyDescriptor(n.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
 const choose=async()=>{await click('清除選取');for(const description of descriptions)await nodeClick(`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.innerText.includes(${JSON.stringify(description)})).querySelector('input[type=checkbox]')`);};
 const tab=async label=>{await nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'list ready');};
 const close=async()=>{await nodeClick(`[...document.querySelectorAll('.modal button')].find(n=>['取消','關閉'].includes(n.innerText.trim()))`);if(await evaluate('Boolean(document.querySelector(".tracking-navigation"))'))await click('捨棄草稿並關閉');await until(()=>evaluate('!document.querySelector(".modal-backdrop")'),'dialog closed');};
 const labels=async()=>{const rows=(await qa.read()).payload.trackingItems.filter(r=>r.referenceNo==='BATCH-SAME');const text=await evaluate('document.querySelector(".modal").innerText');for(const row of rows){assert.ok(text.includes(row.referenceNo)&&text.includes(row.description),'full business identity');assert.ok(!text.includes(row.id),'no visible internal ID');}if(audience==='ship')assert.ok(!text.includes('要事'));};
 const open=async(label)=>{await choose();await click(label);await until(()=>evaluate('Boolean(document.querySelector(".modal"))'),'opened '+label);await labels();};
 await check(audience+'-same-reference-three-item-original-UI-fixture',async()=>{
  await click('＋ 新增／批量新增');
  for(let i=0;i<3;i++){if(i)await click('＋ 新增一列');const p=`第 ${i+1} 筆 `;await fill(`[aria-label="${p}申請單號(材料或工程)"]`,refs[i]);await fill(`[aria-label="${p}內容摘要/工程內容"]`,descriptions[i]||'未選項目不應變更');await fill(`[aria-label="${p}最新進度"]`,'原有已保存進度');await set(p+'申請/開單日期','2026-09-01');}
  await click('確認保存 3 項');await finish();
 });
 await check(audience+'-every-available-open-batch-dialog-has-business-content',async()=>{
  const before=await qa.read();
  for(const action of ['批量修正','修正分類','批量更新進度','批量送達／更正','批量結案','同步到內控',audience==='shore'?'刪除所選':'申請刪除']){
   await open(action);if(action==='批量更新進度'){await screen(audience+'-batch-labels-desktop');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await screen(audience+'-batch-labels-mobile');assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});}await close();
  }
  assert.deepEqual(await qa.read(),before,'opening/cancelling dialogs cannot mutate data');
 });
 await check(audience+'-prominent-checkbox-partial-reset-desktop-mobile-and-atomic-held-ACK',async()=>{
  await open('批量送達／更正');const checkbox='document.querySelector("[aria-label=同時結案]")';assert.equal(await evaluate(checkbox+'.checked'),false);assert.equal(await evaluate(checkbox+'.disabled'),false);
  await nodeClick(checkbox);await set('送船狀態','partially-delivered');assert.equal(await evaluate(checkbox+'.checked'),false);assert.equal(await evaluate(checkbox+'.disabled'),true);await set('送船狀態','delivered');assert.equal(await evaluate(checkbox+'.checked'),false);await set('實際送達/完工日期','2026-09-29');
  await fill('.tracking-delivery-notes label:nth-of-type(1) textarea','全部實際收到，沒有未送項目');await fill('.tracking-delivery-notes label:nth-of-type(2) textarea','墊片已全數收到');await nodeClick(checkbox);await screen(audience+'-delivery-close-desktop');
  assert.ok(await evaluate(checkbox+'.getBoundingClientRect().width>=20'));await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate('document.querySelector(".tracking-delivery-close").scrollIntoView({block:"center"})');await screen(audience+'-delivery-close-mobile');assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));assert.ok(await evaluate('(()=>{const n=document.querySelector(".tracking-delivery-close"),r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&n.scrollWidth<=n.clientWidth+1})()'));await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const before=await qa.read();let entered=false,release;const hold=new Promise(r=>{release=r;});
  qa.setRecordFault({after:async({name,body})=>{if(name===(audience==='ship'?'ship_dynamics_tracking_public_v1':'apply_ship_dynamics_record_patch_v1')&&(audience==='shore'||body.p_action==='submit')){entered=true;await hold;}return false;}});
  try{await click('確認送達並結案 2 項');await until(()=>entered,'native COMMIT before ACK');assert.ok(await evaluate('Boolean(document.querySelector(".tracking-modal"))'),'modal retained before ACK');const after=await qa.read();assert.equal(after.revision,before.revision+1);for(const row of after.payload.trackingItems.filter(r=>r.referenceNo==='BATCH-SAME')){assert.equal(row.isClosed,true);assert.equal(row.closedDate,'2026-09-29');assert.equal(row.actualDeliveryDate,row.closedDate);assert.deepEqual(row.events.slice(-2).map(e=>e.action),['delivery','close']);assert.ok(row.progress.includes('送船備註：'));}assert.deepEqual(after.payload.trackingItems.filter(r=>r.referenceNo!=='BATCH-SAME'),before.payload.trackingItems.filter(r=>r.referenceNo!=='BATCH-SAME'));release();await finish();}finally{release();qa.setRecordFault(null);}
 });
 await tab('已送船清單');
 await check(audience+'-closed-batch-labels-readonly-status-history-no-write',async()=>{
  const before=await qa.read(),start=qa.metrics.length;
  await open('查看歷史記錄');assert.equal(await evaluate('document.querySelectorAll(".tracking-history-item[open]").length'),2);const text=await evaluate('document.querySelector(".tracking-history-modal").innerText');for(const value of ['送船狀態／日期更正','結案','送船備註：','2026-09-29'])assert.ok(text.includes(value),value);assert.ok(!await evaluate('document.querySelector(".tracking-other-history").open'));await screen(audience+'-status-history');await click('關閉紀錄');
  assert.deepEqual(qa.metrics.slice(start).filter(m=>/acquire|claim|renew|apply|save/.test(m.rpc)||['claim','submit','renew'].includes(m.action)),[]);assert.deepEqual(await qa.read(),before);
  await open('批量送達／更正');assert.equal(await evaluate('document.querySelector("[aria-label=同時結案]").disabled'),true);await close();
  for(const action of ['修改結案日期','重開所選']){await open(action);await close();}assert.deepEqual(await qa.read(),before);
 });
 await check(audience+'-same-exact-submission-lost-ACK-close-replay-once',async()=>{
  await open('重開所選');await click('確認保存 2 項');await finish();await open('批量送達／更正');await set('實際送達/完工日期','2026-09-29');await nodeClick('document.querySelector("[aria-label=同時結案]")');
  let committed=false;const before=await qa.read();const matches=(name,body)=>audience==='ship'?name==='ship_dynamics_tracking_public_v1'&&['submit','receipt'].includes(body.p_action):['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1'].includes(name);
  qa.setRecordFault({after:async({name,body,value})=>{if(!matches(name,body))return false;if(audience==='shore'||body.p_action==='submit'&&value.ok)committed=true;return committed;}});
  try{await click('確認送達並結案 2 項');await until(()=>evaluate('document.body.innerText.includes("尚未保存；輸入及精確提交已保留")'),'unknown result draft retained',90_000);assert.ok(committed);const after=await qa.read();assert.equal(after.revision,before.revision+1);assert.equal(await evaluate('document.querySelector("[aria-label=同時結案]").checked'),true);const pending=await evaluate('Object.values(localStorage).map(s=>{try{return JSON.parse(s)}catch{return null}}).find(s=>s?.pending?.command?.type==="delivery")');assert.ok(pending.pending.command.items.every(i=>i.closeOnDelivery===true));qa.setRecordFault(null);await click('確認結果／重試相同提交');await finish();assert.deepEqual(await qa.read(),after);}finally{qa.setRecordFault(null);}
 });
}

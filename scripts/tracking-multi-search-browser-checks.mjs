import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// Original shore/ship entry, synthetic records and private native PostgreSQL only.
export async function trackingMultiSearchChecks({qa,call,evaluate,click,nodeClick,fill,until,screen,check,output,audience,finish}){
 const selector='[aria-label="搜尋跟蹤"]',hint='可以使用","來隔開不同關鍵詞，實現多詞多筆同時搜索。';
 const rowIds=()=>evaluate("[...document.querySelectorAll('.tracking-table tbody tr[data-tracking-id]')].map(n=>n.dataset.trackingId).sort()");
 const expectRows=async ids=>{await until(async()=>JSON.stringify(await rowIds())===JSON.stringify([...ids].sort()),'exact multi-search row set');assert.deepEqual(await rowIds(),[...ids].sort());};
 const search=async(value,ids)=>{await fill(selector,value);await expectRows(ids);assert.equal(await evaluate("document.querySelector('.tracking-toolbar>b').innerText"),'已選 0 項','typing does not auto-select and clears prior selection');};
 const set=async(label,value)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')});Object.getOwnPropertyDescriptor(n.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
 const size=width=>call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
 await check(audience+'-exact-grey-placeholder-and-unchanged-responsive-search',async()=>{
  const measurements=[];
  for(const width of [1440,390]){await size(width);await evaluate("document.querySelector('[aria-label=搜尋跟蹤]').scrollIntoView({block:'center'})");await evaluate('document.fonts.ready');measurements.push(await evaluate(`(()=>{const n=document.querySelector('[aria-label=搜尋跟蹤]'),s=getComputedStyle(n),r=n.getBoundingClientRect(),c=document.createElement('canvas').getContext('2d');c.font=s.font;return{width:innerWidth,document:document.documentElement.scrollWidth,placeholder:n.placeholder,placeholderColor:getComputedStyle(n,'::placeholder').color,inputColor:s.color,hintWidth:c.measureText(n.placeholder).width,space:n.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),geometry:{width:r.width,height:r.height,font:s.font,padding:s.padding},left:r.left,right:r.right};})()`));await screen(audience+'-multi-search-placeholder-'+width);}
  fs.writeFileSync(path.join(output,'multi-search-geometry.json'),JSON.stringify(measurements,null,2));
  const baseline=process.env.QA_SEARCH_HINT_BASELINE?JSON.parse(fs.readFileSync(process.env.QA_SEARCH_HINT_BASELINE,'utf8')):null;
  for(const m of measurements){
   assert.equal(m.placeholder,hint);assert.notEqual(m.placeholderColor,m.inputColor);
   // A long native placeholder may clip on mobile; never widen/shrink the control or font to fit it.
   if(m.width===1440)assert.ok(m.hintWidth<=m.space+1,'complete hint fits desktop input');
   assert.ok(m.document<=m.width+1&&m.left>=0&&m.right<=m.width+1);
   if(baseline){const old=baseline.find(b=>b.width===m.width);assert.ok(old);assert.deepEqual(m.geometry,old.geometry,'copy-only change preserves input geometry and typography');assert.equal(m.placeholderColor,old.placeholderColor);assert.equal(m.left,old.left);assert.equal(m.right,old.right);}
  }
  await size(1440);
 });
 const refs=['MULTI-A','MULTI-B','MULTI-C','MULTI-SLASH'],purchase=['QA-RED','QA-BLUE','QA-GREEN','QA/PART'],descriptions=['甲濾芯','乙泵件','丙閥件','斜線備件'];let created,before;
 await check(audience+'-multi-search-fixtures-created-through-original-batch-form',async()=>{
  await click('＋ 新增／批量新增');
  for(let i=0;i<refs.length;i++){if(i)await click('＋ 新增一列');const p=`第 ${i+1} 筆 `;await fill(`[aria-label="${p}申請單號(材料或工程)"]`,refs[i]);await fill(`[aria-label="${p}請購案號(非必填)"]`,purchase[i]);await fill(`[aria-label="${p}內容摘要/工程內容"]`,descriptions[i]);await set(p+'申請/開單日期','2026-09-01');if(!i){await nodeClick('document.querySelector(\'[aria-label="第 1 筆 緊急"]\')');await fill('[aria-label="第 1 筆 補充說明"]','搜尋篩選急件測試');}}
  await click('確認保存 4 項');await finish();before=await qa.read();created=refs.map(ref=>before.payload.trackingItems.find(r=>r.referenceNo===ref));assert.ok(created.every(Boolean));
 });
 await check(audience+'-ascii-chinese-mixed-OR-dedup-and-cross-field-results',async()=>{
  const pair=created.slice(0,2).map(r=>r.id);
  for(const value of ['QA-RED,QA-BLUE','QA-RED，QA-BLUE',' ， qa-red, QA-BLUE，QA-RED,,　','甲濾芯,QA-BLUE'])await search(value,pair);
  await search('QA-RED,MULTI-A,甲濾芯',[created[0].id]);await search('QA-RED,QA-BLUE',pair);
  for(const width of [1440,390]){await size(width);await evaluate("document.querySelector('[aria-label=搜尋跟蹤]').scrollIntoView({block:'center'})");assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await expectRows(pair);await screen(audience+'-multi-search-results-'+width);}await size(1440);
 });
 await check(audience+'-urgent-AND-clear-and-selection-reset-no-auto-selection',async()=>{
  await click('緊急');await expectRows([created[0].id]);await click('緊急');await expectRows(created.slice(0,2).map(r=>r.id));
  await click('選取全部');await until(()=>evaluate("document.querySelector('.tracking-toolbar>b').innerText==='已選 2 項'"),'manual select all matching');await search('QA-GREEN',[created[2].id]);
  await click('清除條件');await expectRows(before.payload.trackingItems.filter(r=>r.vesselId===created[0].vesselId&&r.kind==='supply'&&!r.isClosed&&r.deliveryStatus!=='delivered'&&!r.deletion).map(r=>r.id));assert.equal(await evaluate('document.querySelector(\'[aria-label="搜尋跟蹤"]\').placeholder'),hint);
 });
 await check(audience+'-literal-slash-no-match-and-separator-only-zero-writes',async()=>{
  await search('QA/PART',[created[3].id]);await search('QA-RED/QA-BLUE',[]);await search('no-match,still-no-match',[]);
  await search(', ， ,',before.payload.trackingItems.filter(r=>r.vesselId===created[0].vesselId&&r.kind==='supply'&&!r.isClosed&&r.deliveryStatus!=='delivered'&&!r.deletion).map(r=>r.id));assert.deepEqual(await qa.read(),before,'searching and selecting never mutate business records');
 });
 await check(audience+'-manual-select-union-batch-delivery-only-exact-two-records',async()=>{
  const ids=created.slice(0,2).map(r=>r.id);await search('QA-RED，QA-BLUE',ids);await click('選取全部');await until(()=>evaluate("document.querySelector('.tracking-toolbar>b').innerText==='已選 2 項'"),'exact selection');await click('批量送達／更正');await until(()=>evaluate('Boolean(document.querySelector(".tracking-modal input[type=date]"))'),'original delivery editor');
  const body=await evaluate('document.querySelector(".tracking-modal").innerText');for(const ref of refs.slice(0,2))assert.ok(body.includes(ref));for(const ref of refs.slice(2))assert.ok(!body.includes(ref));
  await evaluate(`(()=>{const n=document.querySelector('.tracking-modal input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'2026-09-29');n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('確認保存 2 項');await finish();const after=await qa.read();assert.equal(after.revision,before.revision+1);
  for(const id of ids){const saved=after.payload.trackingItems.find(r=>r.id===id);assert.equal(saved.deliveryStatus,'delivered');assert.equal(saved.actualDeliveryDate,'2026-09-29');assert.equal(saved.isClosed,false);}
  assert.deepEqual(after.payload.trackingItems.filter(r=>!ids.includes(r.id)),before.payload.trackingItems.filter(r=>!ids.includes(r.id)),'all unselected rows unchanged');assert.deepEqual(after.payload.tasks,before.payload.tasks);assert.deepEqual(after.payload.internalControlCases,before.payload.internalControlCases);await expectRows([]);
 });
}

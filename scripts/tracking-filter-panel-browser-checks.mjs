import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Screenshot-derived controls, original UI + native local SQL; not production data.
export async function filterPanelChecks({qa,call,evaluate,click,nodeClick,fill,select,until,screen,check,output,audience}) {
 const tab=label=>nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);
 const expectedBase=['申請單號(材料或工程)','請購案號(非必填)','申請/開單日期','類型','期望完成日期/DL','實際送達/完工日期','普通','緊急'];
 const expected=kind=>[...expectedBase,...(kind==='supply'?['送船狀態']:[]),'結案狀態','結案日期','內控同步'];
 const geometry=[];
 const measure=()=>evaluate(`(()=>{
  const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,fields:[...document.querySelectorAll('.tracking-filter-grid fieldset')].map(n=>({label:n.querySelector('legend').textContent.replace('（隱藏欄）',''),...rect(n),controls:[n.querySelector('select'),n.querySelector('.tracking-value-filter')].map(rect),styles:[n.querySelector('legend'),n.querySelector('select'),n.querySelector('summary')].map(x=>({color:getComputedStyle(x).color,weight:Number(getComputedStyle(x).fontWeight)}))}))};
 })()`);
 // Capture both kinds before asserting so a RED keeps the complete current visual baseline.
 for(const [kind,label] of [['supply','配件物料總清單'],['engineering','未完成工程單']]) {
  await tab(label);await until(()=>evaluate("Boolean(document.querySelector('.tracking-filter-grid'))"),'filter panel mounted');
  if(!await evaluate("document.querySelector('.tracking-all-filters').open"))await nodeClick("document.querySelector('.tracking-all-filters>summary')");
  for(const width of [2880,1440,390]) {
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
   await evaluate("document.querySelector('.tracking-all-filters>.tracking-option-panel').scrollIntoView({block:'start'})");
   const result={kind,width,...await measure()};geometry.push(result);await screen(`filters-${kind}-${width}`);
  }
 }
 fs.writeFileSync(path.join(output,'filter-panel-geometry.json'),JSON.stringify(geometry,null,2));
 await check(`${audience}-screenshot-filter-inventory-and-aligned-responsive-grid`,async()=>{
  for(const g of geometry) {
   assert.deepEqual(g.fields.map(f=>f.label),expected(g.kind),`${g.kind} must match only the screenshot's unmarked filters`);
   assert.ok(g.scroll<=g.viewport+1,'no document overflow');
   assert.ok(Math.max(...g.fields.map(f=>f.width))-Math.min(...g.fields.map(f=>f.width))<1,'equal field widths');
   const columns=new Set(g.fields.map(f=>Math.round(f.x))).size;assert.equal(columns,g.width===2880?6:g.width===1440?4:1);
   for(const field of g.fields){assert.ok(field.x>=0&&field.right<=g.viewport+1);assert.ok(Math.abs(field.controls[0].y-field.controls[1].y)<1,'blank/content controls align');assert.ok(Math.abs(field.controls[0].height-field.controls[1].height)<1,'control heights match');}
   const urgent=g.fields.find(f=>f.label==='緊急'),normal=g.fields.find(f=>f.label==='普通');
   for(const style of urgent.styles){const [r,g,b]=style.color.match(/\d+/g).map(Number);assert.ok(r>g*1.5&&r>b*1.5,'urgent must visibly be red');assert.ok(style.weight>=700,'urgent must be bold');}
   assert.notEqual(urgent.styles[0].color,normal.styles[0].color,'ordinary filter is not recolored');
  }
 });
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await check(`${audience}-removed-filters-remain-real-table-settings-and-search-fields`,async()=>{
  await nodeClick("document.querySelector('.tracking-preferences>summary')");
  const settings=await evaluate("[...document.querySelectorAll('.tracking-preferences label')].map(n=>n.textContent.trim())");
  for(const label of ['原項次','內容摘要/工程內容','補充說明','最新進度','工程狀態','工程結案結果','系統 ID','來源追溯','進度歷程','更正／結案歷程'])assert.ok(settings.includes(label),`retain original column ${label}`);
  await nodeClick("document.querySelector('.tracking-preferences>summary')");
 });
 const fixtures=[['supply','normal'],['supply','urgent'],['engineering','normal'],['engineering','urgent']];
 await check(`${audience}-filter-fixture-original-form-exact-ACK`,async()=>{
  await click('＋ 新增／批量新增');
  for(let i=0;i<fixtures.length;i++){
   if(i)await click('＋ 新增一列');const [kind,urgency]=fixtures[i],prefix=`第 ${i+1} 筆 `;
   await fill(`[aria-label="${prefix}申請單號(材料或工程)"]`,`FILTER-${kind}-${urgency}`);
   await fill(`[aria-label="${prefix}內容摘要/工程內容"]`,`SEARCH-CONTENT-${kind}-${urgency}`);
   await select(`document.querySelector('[aria-label="${prefix}類型"]')`,kind==='supply'?'spares':'repair');
   if(urgency==='urgent')await nodeClick(`document.querySelector('[aria-label="${prefix}緊急"]')`);
  }
  await click('確認保存 4 項');await until(async()=>!await evaluate("Boolean(document.querySelector('.modal-backdrop'))")&&(await evaluate('document.body.innerText')).includes('已收到伺服器確認並讀回'),'fixture authoritative ACK');
  const data=await qa.read();for(const [kind,urgency] of fixtures){const item=data.payload.trackingItems.find(r=>r.referenceNo===`FILTER-${kind}-${urgency}`);assert.equal(item?.kind,kind);assert.equal(item?.urgency,urgency);}
 });
 const before=await qa.read();
 for(const [kind,label] of [['supply','配件物料總清單'],['engineering','未完成工程單']])await check(`${audience}-${kind}-urgent-select-clear-global-search-no-business-write`,async()=>{
  await tab(label);if(!await evaluate("document.querySelector('.tracking-all-filters').open"))await nodeClick("document.querySelector('.tracking-all-filters>summary')");
  const wasOpen=await evaluate("document.querySelector('[aria-label=\"緊急篩選內容\"]').parentElement.open");
  fs.appendFileSync(path.join(output,'filter-interaction-state.jsonl'),JSON.stringify({kind,wasOpen})+'\n');
  if(!wasOpen)await nodeClick("document.querySelector('[aria-label=\"緊急篩選內容\"]')");
  assert.ok(await evaluate("document.querySelector('[aria-label=\"緊急篩選內容\"]').parentElement.open"),'open the real dropdown before selecting');
  await nodeClick("[...document.querySelectorAll('[aria-label=\"緊急多選\"] label')].find(n=>n.textContent==='是').querySelector('input')");
  assert.ok(await evaluate("[...document.querySelectorAll('[aria-label=\"緊急多選\"] label')].find(n=>n.textContent==='是').querySelector('input').checked"),'checkbox selection reached the real control');
  await until(()=>evaluate("document.querySelectorAll('.tracking-table tbody .tracking-reference').length===1"),'urgent-only row');
  assert.ok(await evaluate(`document.querySelector('.tracking-table').innerText.includes('FILTER-${kind}-urgent')`));
  assert.ok(!await evaluate(`document.querySelector('.tracking-table').innerText.includes('FILTER-${kind}-normal')`));
  await screen(`filters-${kind}-urgent-selected`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate("document.querySelector('.tracking-filter-urgent').scrollIntoView({block:'center'})");
  assert.ok(await evaluate("(()=>{const r=document.querySelector('[aria-label=\"緊急多選\"]').getBoundingClientRect();return r.width>0&&r.x>=0&&r.right<=innerWidth+1;})()"),'open mobile dropdown fits');
  await screen(`filters-${kind}-urgent-selected-390`);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await click('清除條件');
  assert.ok(await evaluate(`document.querySelector('.tracking-table').innerText.includes('FILTER-${kind}-normal')`));
  await fill('[aria-label="搜尋跟蹤"]',`SEARCH-CONTENT-${kind}-normal`);
  await until(()=>evaluate("document.querySelectorAll('.tracking-table tbody .tracking-reference').length===1"),'removed description filter remains searchable');
  assert.ok(await evaluate(`document.querySelector('.tracking-table').innerText.includes('FILTER-${kind}-normal')`));
  await click('清除條件');assert.deepEqual(await qa.read(),before,'filtering/search never mutates business data');
 });
}

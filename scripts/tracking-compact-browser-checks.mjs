import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {trackingBatchAction} from './tracking-batch-browser-actions.mjs';

// Both production entries + real local PostgreSQL. Synthetic data only.
export async function compactChecks(c){
 const {qa,call,evaluate,click,nodeClick,fill,until,screen,check,output,audience,finish}=c;
 const tab=async label=>{await nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);await until(()=>evaluate("Boolean(document.querySelector('.tracking-table'))"),'list mounted');};
 const row=ref=>`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.querySelector('.tracking-reference')?.innerText.includes(${JSON.stringify(ref)}))`;
 const choose=async refs=>{await click('清除選取');for(const ref of refs)await nodeClick(`(${row(ref)}).querySelector('.tracking-check input')`);};
 const action=(ref,label)=>trackingBatchAction(c,ref,label);
 const date=async(label,value)=>evaluate(`(()=>{const n=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');if(!n||n.disabled)throw Error('date field missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const select=async(label,value)=>evaluate(`(()=>{const n=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');if(!n||n.disabled)throw Error('select missing');n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const key=async value=>{const windowsVirtualKeyCode={ArrowRight:39,Escape:27,Tab:9}[value];await call('Input.dispatchKeyEvent',{type:'keyDown',key:value,code:value,windowsVirtualKeyCode});await call('Input.dispatchKeyEvent',{type:'keyUp',key:value,code:value,windowsVirtualKeyCode});};
 const save=async n=>{await click(`確認保存 ${n} 項`);await finish();};
 const expected={'申請單號(材料或工程)':120,'請購案號(非必填)':120,'原項次':64,'申請/開單日期':112,'類型':88,'內容摘要/工程內容':300,'期望完成日/DL/到期日':112,'實際送達/完工日期':112,'普通':52,'緊急':52,'補充說明':160,'最新進度':170,'送船狀態':88,'結案狀態':80,'結案日期':112,'內控同步':96};
 const geometry=[];
 await check(`${audience}-explicit-export-labels-desktop-mobile-and-unchanged-entry`,async()=>{
  const before=await qa.read(),metricStart=qa.metrics.length;
  for(const width of [1440,390]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
   await until(()=>evaluate("document.querySelectorAll('.tracking-export-actions button:not(:disabled)').length===4"),'export entries ready');
   assert.deepEqual(await evaluate("[...document.querySelectorAll('.tracking-export-actions button')].map(n=>n.innerText)"),['導出excel','導出pdf','配件物料模板','工程模板']);
   assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'longer labels must not cause page overflow');
   await screen(`export-entry-labels-${width}`);
   for(const label of ['導出excel','導出pdf']){
    await click(label);await until(()=>evaluate("Boolean(document.querySelector('[aria-label=跟蹤匯出]'))"),'same export dialog');
    assert.ok(await evaluate("Boolean([...document.querySelectorAll('button')].find(n=>n.innerText==='建立共用快照'))"),'original confirmed-snapshot workflow retained');
    await click('關閉匯出');await until(()=>evaluate("!document.querySelector('[aria-label=跟蹤匯出]')"),'export dialog closed');
   }
  }
  assert.deepEqual(await qa.read(),before,'renamed entries never mutate business data');
  assert.deepEqual(qa.metrics.slice(metricStart).filter(m=>/acquire|claim|renew|apply|save/.test(m.rpc)||['claim','submit','renew'].includes(m.action)),[]);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 });
 await check(`${audience}-notice-shares-options-row-and-wraps-without-hiding-panels`,async()=>{
  const before=await qa.read(),metricStart=qa.metrics.length;
  const message='船舶、標籤或條件已切換；已清除原選取。';
  await choose([audience==='ship'?'BROWSER-001':'UI-001']);
  await until(()=>evaluate("document.querySelector('.tracking-toolbar>b').innerText==='已選 1 項'"),'notice selection precondition');
  await click('緊急');
  await until(()=>evaluate(`document.querySelector('.tracking-page .tracking-notice')?.textContent===${JSON.stringify(message)}`),'original selection-cleared notice');
  assert.equal(await evaluate("document.querySelector('.tracking-toolbar>b').innerText"),'已選 0 項');
  await click('緊急');
  const layout=()=>evaluate(`(()=>{const box=n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:n.clientWidth,scroll:n.scrollWidth}};const notice=document.querySelector('.tracking-page .tracking-notice');return{viewport:innerWidth,document:document.documentElement.scrollWidth,notice:{...box(notice),text:notice.textContent,role:notice.getAttribute('role')},noticeCount:document.querySelectorAll('.tracking-page .tracking-notice').length,summaries:[...document.querySelectorAll('.tracking-options>details>summary')].map(box),panels:[...document.querySelectorAll('.tracking-options>details[open]>.tracking-option-panel')].map(box)};})()`);
  for(const width of [1440,390]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
   await evaluate("document.querySelector('.tracking-options').scrollIntoView({block:'center'})");
   const g=await layout();fs.writeFileSync(path.join(output,`notice-layout-${width}.json`),JSON.stringify(g,null,2));await screen(`notice-inline-${width}`);
   assert.equal(g.noticeCount,1,'the original live status must not be duplicated');assert.equal(g.notice.role,'status');assert.equal(g.notice.text,message);
   assert.ok(g.document<=width+1&&g.notice.scroll<=g.notice.width+1,'full notice wraps without page overflow');
   assert.equal(g.summaries.length,2);
   if(width>700){
    for(const summary of g.summaries)assert.ok(g.notice.top<summary.bottom&&g.notice.bottom>summary.top,'desktop notice shares the filters/settings row');
    assert.ok(g.notice.left>=g.summaries[1].right,'notice stays to the right of both controls');
   }else assert.ok(g.notice.top>=Math.max(...g.summaries.map(r=>r.bottom)),'mobile notice wraps below the controls');
   for(const selector of ['.tracking-all-filters','.tracking-preferences'])await nodeClick(`document.querySelector('${selector}>summary')`);
   const opened=await layout();assert.equal(opened.panels.length,2);
   assert.ok(opened.panels[0].top>=Math.max(opened.notice.bottom,...opened.summaries.map(r=>r.bottom)),'filter panel does not overlap notice');
   assert.ok(opened.panels[1].top>=opened.panels[0].bottom,'settings follow the filter panel');
   assert.ok(opened.panels.every(r=>r.scroll<=r.width+1),'expanded panels stay readable');await screen(`notice-panels-open-${width}`);
   for(const selector of ['.tracking-preferences','.tracking-all-filters'])await nodeClick(`document.querySelector('${selector}>summary')`);
  }
  await click('統計資訊');await until(()=>evaluate("Boolean(document.querySelector('.tracking-statistics'))"),'statistics retains status without list controls');
  assert.equal(await evaluate("document.querySelectorAll('.tracking-page>.tracking-notice').length"),1,'statistics fallback status remains visible');
  assert.equal(await evaluate("document.querySelector('.tracking-page>.tracking-notice').textContent"),message);
  await tab('未送船清單');
  assert.deepEqual(await qa.read(),before,'moving and displaying notices must not change business data');
  assert.deepEqual(qa.metrics.slice(metricStart).filter(m=>/acquire|claim|renew|apply|save/.test(m.rpc)||['claim','submit','renew'].includes(m.action)),[],'view-only actions never obtain edit rights or submit');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 });
 await check(`${audience}-search-half-width-and-original-search-clear-behavior`,async()=>{
  const before=await qa.read(),metricStart=qa.metrics.length,layouts=[];
  const measureSearch=()=>evaluate(`(()=>{const box=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,font:s.font}};return{input:box(document.querySelector('[aria-label="搜尋跟蹤"]')),clear:box(document.querySelector('.tracking-search>.btn')),urgent:box(document.querySelector('.tracking-urgent-shortcut')),document:document.documentElement.scrollWidth};})()`);
  for(const width of [1440,390]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
   await evaluate(`(()=>{const s=document.createElement('style');s.id='qa-original-search-width';s.textContent='.tracking-search{display:flex;flex:0 1 330px;align-items:center;gap:5px;min-width:210px}.tracking-search>input{width:240px;flex:1;min-width:0}@media(max-width:700px){.tracking-search{flex:1 1 0;min-width:0}}';document.head.append(s);})()`);
   const original=await measureSearch();await screen(`search-original-${width}`);
   await evaluate("document.getElementById('qa-original-search-width').remove()");
   const current=await measureSearch();layouts.push({width,original,current});await screen(`search-half-${width}`);
  }
  fs.writeFileSync(path.join(output,'search-widths.json'),JSON.stringify(layouts,null,2));
  for(const {width,original,current} of layouts){
   if(width>700)assert.ok(Math.abs(current.input.width-original.input.width/2)<=1,'desktop input must really halve, not be stretched back by flex: '+JSON.stringify({audience,width,original,current}));
   else assert.ok(current.input.width<original.input.width&&current.input.width>=80,'mobile input is compact but still usable');
   assert.equal(current.input.height,original.input.height);assert.equal(current.input.font,original.input.font);
   assert.equal(current.clear.width,original.clear.width);assert.equal(current.urgent.width,original.urgent.width);
   assert.ok(current.input.right<=current.clear.left&&current.clear.right<=current.urgent.left,'search and adjacent buttons cannot overlap');
   assert.ok(current.document<=width+1,'shorter input cannot cause document overflow');
  }
  const ids=()=>evaluate("[...document.querySelectorAll('.tracking-table tbody tr[data-tracking-id]')].map(n=>n.dataset.trackingId)");
  const originalIds=await ids(),reference=audience==='ship'?'BROWSER-001':'UI-001';
  await fill('[aria-label="搜尋跟蹤"]',reference);await until(async()=>(await ids()).length===1,'original search still filters');
  assert.ok(await evaluate(`document.querySelector('.tracking-table tbody .tracking-reference').textContent.includes(${JSON.stringify(reference)})`));
  const long='找不到的長搜尋字串，輸入內容完整保留，不改搜尋邏輯。'.repeat(4);
  await fill('[aria-label="搜尋跟蹤"]',long);await until(async()=>(await ids()).length===0,'unmatched search stays empty');assert.equal(await evaluate("document.querySelector('[aria-label=\"搜尋跟蹤\"]').value"),long);
  await click('清除條件');await until(async()=>JSON.stringify(await ids())===JSON.stringify(originalIds),'clear restores original rows');
  assert.equal(await evaluate("document.querySelector('[aria-label=\"搜尋跟蹤\"]').value"),'');
  assert.deepEqual(await qa.read(),before);assert.deepEqual(qa.metrics.slice(metricStart).filter(m=>/acquire|claim|renew|apply|save/.test(m.rpc)||['claim','submit','renew'].includes(m.action)),[],'search and clear never write business data');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 });
 await check(`${audience}-compact-fixture-and-toolbar-real-saves`,async()=>{
  await click('＋ 新增／批量新增');
  for(let i=1;i<=4;i++){
   if(i>1)await click('＋ 新增一列');const prefix=`第 ${i} 筆 `;
   await fill(`[aria-label="${prefix}申請單號(材料或工程)"]`,`COMPACT-${i}`);
   await fill(`[aria-label="${prefix}原項次"]`,String(i));
   await fill(`[aria-label="${prefix}內容摘要/工程內容"]`,'測試用完整摘要，不截內容；'+(i===1?'LONG-'.repeat(35):'記錄分組'));
   if(i>2)await select(prefix+'類型','repair');
   await date(prefix+'申請/開單日期','2026-09-21');await date(prefix+'期望完成日/DL/到期日','2026-10-01');
   await fill(`[aria-label="${prefix}最新進度"]`,`COMPACT-${i} 已保存進度`);
  }
  await save(4);await tab('配件物料總清單');await choose(['COMPACT-1','COMPACT-2']);await click('批量修正');
  await until(()=>evaluate("Boolean(document.querySelector('[aria-label=\"第 1 筆 緊急\"]'))"),'bulk editor');
  await nodeClick("document.querySelector('[aria-label=\"第 1 筆 緊急\"]')");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"第 1 筆 普通\"]').checked"),false);
  await save(2);const first=(await qa.read()).payload.trackingItems.find(r=>r.referenceNo==='COMPACT-1');assert.equal(first.urgency,'urgent');
  await action('COMPACT-2','送達／更正');await date('實際送達/完工日期','2026-09-26');await save(1);
  await action('COMPACT-2','結案');await date('結案日期','2026-09-27');await save(1);
  await tab('未完成工程單');await action('COMPACT-4','完工／更正');await date('實際送達/完工日期','2026-09-26');await save(1);
  const data=await qa.read();assert.ok(data.payload.trackingItems.find(r=>r.referenceNo==='COMPACT-2').isClosed);assert.equal(data.payload.trackingItems.find(r=>r.referenceNo==='COMPACT-4').completionDate,'2026-09-26');
 });
 const synced=()=>evaluate("Math.abs(document.querySelector('.tracking-table-scroll-top').scrollLeft-document.querySelector('.tracking-table-scroll').scrollLeft)<1");
 const measure=()=>evaluate(`(()=>{const s=document.querySelector('.tracking-table-scroll'),t=document.querySelector('.tracking-table-scroll-top');return{viewport:innerWidth,document:document.documentElement.scrollWidth,body:{width:s.clientWidth,scroll:s.scrollWidth,left:s.scrollLeft},top:{width:t.clientWidth,scroll:t.scrollWidth,left:t.scrollLeft},headers:[...document.querySelectorAll('.tracking-table th:not(.tracking-check)')].map(n=>({label:n.querySelector('.tracking-resize').getAttribute('aria-label').slice(2,-2),width:n.getBoundingClientRect().width})),dates:[...document.querySelectorAll('.tracking-date-cell>.tracking-cell-text')].map(n=>({value:n.textContent,wrap:getComputedStyle(n).whiteSpace,width:n.clientWidth,scroll:n.scrollWidth}))};})()`);
 for(const label of ['未送船清單','已送船清單','配件物料總清單','未完成工程單','已完成工程單']){
  await tab(label);
  await check(`${audience}-${label}-desktop-mobile-widths-scroll-and-history`,async()=>{
   for(const width of [1440,390]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await until(async()=>{const g=await measure();return g.top.width===g.body.width&&g.top.scroll===g.body.scroll;},'bar geometry settles');
    const g=await measure();geometry.push({label,width,...g});assert.ok(g.document<=width+1,'document does not overflow');
    assert.deepEqual(g.headers.slice(0,2).map(h=>h.label),['申請單號(材料或工程)','類型'],'type follows application number on every tab and viewport');
    assert.ok(g.body.scroll>g.body.width);for(const h of g.headers)if(expected[h.label])assert.ok(Math.abs(h.width-expected[h.label])<2,`${h.label} actual width ${h.width}`);
    assert.ok(!await evaluate("Boolean(document.querySelector('.tracking-actions'))"));for(const d of g.dates){assert.equal(d.wrap,'nowrap');assert.ok(d.scroll<=d.width+1,'date fully visible');}
    await evaluate("document.querySelector('.tracking-table-scroll-top').scrollLeft=0");await until(synced,'reset scroll');
    await evaluate("document.querySelector('.tracking-table-scroll-top').focus()");for(let i=0;i<5;i++)await key('ArrowRight');
    await until(()=>evaluate("document.querySelector('.tracking-table-scroll-top').scrollLeft>0"),'native top scrollbar input');await until(synced,'top to bottom');
    await evaluate("document.querySelector('.tracking-table-scroll').scrollLeft=650");await until(synced,'bottom to top');
    await evaluate("document.querySelector('.tracking-table-scroll-top').scrollIntoView({block:'center'})");await screen(`compact-${label}-${width}`);
    const before=await qa.read(),metricStart=qa.metrics.length;
    const reference=await evaluate("document.querySelector('.tracking-table tbody tr[data-tracking-id] .tracking-reference .tracking-cell-text')?.childNodes[0]?.textContent");assert.ok(reference,'populated list');
    await choose([reference]);await until(()=>evaluate("[...document.querySelectorAll('button')].some(n=>n.innerText==='查看歷史記錄'&&!n.disabled)"),'readonly ready');await click('查看歷史記錄');
    await until(()=>evaluate("Boolean(document.querySelector('.tracking-history-modal'))"),'readonly modal');
    assert.equal(await evaluate("document.querySelectorAll('.tracking-history-item').length"),1);assert.ok(await evaluate("document.querySelector('.tracking-history-item').open"));
    const h=await evaluate("(()=>{const n=document.querySelector('.tracking-history-modal'),r=n.getBoundingClientRect();return{left:r.left,right:r.right,width:n.clientWidth,scroll:n.scrollWidth,inputs:n.querySelectorAll('input,textarea,select').length,text:n.textContent};})()");
    assert.ok(h.left>=0&&h.right<=width+1&&h.scroll<=h.width+1);assert.equal(h.inputs,0);if(audience==='ship')assert.ok(!h.text.includes('要事'));
    await screen(`history-${label}-${width}`);await key('Escape');await until(()=>evaluate("!document.querySelector('.tracking-history-modal')"),'Escape closes');
    assert.deepEqual(await qa.read(),before,'view must not write data or history');
    const writes=qa.metrics.slice(metricStart).filter(m=>/acquire|claim|renew|apply|save/.test(m.rpc)||['claim','submit','renew'].includes(m.action));assert.deepEqual(writes,[],'view must not obtain a lease or submit');
   }
  });
 }
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await tab('配件物料總清單');
 await check(`${audience}-multi-history-grouped-open-closed-zero-writes`,async()=>{
  await choose(['COMPACT-1','COMPACT-2']);const before=await qa.read(),start=qa.metrics.length;await click('查看歷史記錄');
  await until(()=>evaluate("document.querySelectorAll('.tracking-history-item').length===2"),'two exact groups');
  assert.equal(await evaluate("document.querySelectorAll('.tracking-history-item[open]').length"),2,'selected status records start expanded');
  const text=await evaluate("document.querySelector('.tracking-history-modal').textContent");for(const value of ['COMPACT-1 已保存進度','COMPACT-2 已保存進度','送船狀態／日期更正','結案','2026-09-27'])assert.ok(text.includes(value),value);
  await screen('history-multi-open-closed');await click('關閉紀錄');assert.deepEqual(await qa.read(),before);assert.deepEqual(qa.metrics.slice(start).filter(m=>/acquire|claim|renew|apply|save/.test(m.rpc)||['claim','submit','renew'].includes(m.action)),[]);
 });
 await check(`${audience}-width-drag-keeps-selection-sort-preferences-reset`,async()=>{
  await evaluate("document.querySelector('.tracking-table-scroll-top').scrollLeft=0");await until(synced,'scroll reset');
  await evaluate("document.querySelector('[aria-label=\"調整申請單號(材料或工程)欄寬\"]').scrollIntoView({block:'center'})");
  const before=await evaluate("(()=>{const n=document.querySelector('[aria-label=\"調整申請單號(材料或工程)欄寬\"]'),r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:n.closest('th').getBoundingClientRect().width,selected:[...document.querySelectorAll('.tracking-check input:checked')].map(n=>n.getAttribute('aria-label')),sort:document.querySelector('th[aria-sort=ascending],th[aria-sort=descending]')?.textContent};})()");
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:before.x,y:before.y,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:before.x+90,y:before.y,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:before.x+90,y:before.y,button:'left',buttons:0,clickCount:1});
  const after=await measure();assert.ok(after.headers[0].width>=before.width+85);assert.deepEqual(await evaluate("[...document.querySelectorAll('.tracking-check input:checked')].map(n=>n.getAttribute('aria-label'))"),before.selected);assert.equal(await evaluate("document.querySelector('th[aria-sort=ascending],th[aria-sort=descending]')?.textContent"),before.sort);
  await tab('未送船清單');await tab('配件物料總清單');assert.equal((await measure()).headers[0].width,after.headers[0].width,'personal width retained');
  await nodeClick("document.querySelector('.tracking-preferences>summary')");await click('重設欄位配置');assert.equal((await measure()).headers[0].width,120);await nodeClick("document.querySelector('.tracking-preferences>summary')");
 });
 await check(`${audience}-legacy-tail-type-repair-preserves-personal-layout`,async()=>{
  const before=await qa.read(),metricStart=qa.metrics.length;
  const saved=await evaluate(`(()=>{const key=Object.keys(localStorage).find(k=>{try{const p=JSON.parse(k);return p[0]==='tracking-columns'&&p[3]==='supply-all';}catch{return false;}});if(!key)throw Error('saved layout missing');const value=JSON.parse(localStorage.getItem(key));delete value.requestTypeOrderVersion;value.order=[...value.order.filter(k=>k!=='requestType'),'requestType'];value.widths={referenceNo:198,requestType:107};value.hidden=[...new Set([...value.hidden,'purchaseNos'])];localStorage.setItem(key,JSON.stringify(value));return {key,value};})()`);
  await tab('未送船清單');await tab('配件物料總清單');
  await until(async()=>{const g=await measure();return g.headers[0].width===198&&g.headers[1].label==='類型'&&g.headers[1].width===107;},'legacy layout repaired without width reset');
  const g=await measure();assert.ok(!g.headers.some(h=>h.label==='請購案號(非必填)'),'hidden column stays hidden');
  geometry.push({label:'legacy-type-repaired',width:1440,...g});
  await evaluate("document.querySelector('.tracking-table-scroll-top').scrollLeft=0");await until(synced,'legacy repair scroll reset');
  await screen('type-order-legacy-desktop');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});
  const mobile=await measure();assert.deepEqual(mobile.headers.slice(0,2).map(h=>h.label),['申請單號(材料或工程)','類型']);assert.ok(mobile.document<=391);await screen('type-order-legacy-mobile');
  assert.deepEqual(await qa.read(),before,'layout repair never modifies business records');
  assert.deepEqual(qa.metrics.slice(metricStart).filter(m=>/acquire|claim|renew|apply|save/.test(m.rpc)||['claim','submit','renew'].includes(m.action)),[],'layout repair never acquires edit rights or submits');
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(saved.key)}))`),saved.value,'reading preferences does not rewrite stored settings');
 });
 fs.writeFileSync(path.join(output,'compact-geometry.json'),JSON.stringify(geometry,null,2));
}

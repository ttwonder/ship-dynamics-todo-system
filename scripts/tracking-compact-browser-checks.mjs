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
 const expected={'申請單號(材料或工程)':120,'請購案號(非必填)':120,'原項次':64,'申請/開單日期':112,'類型':88,'內容摘要/工程內容':300,'期望完成日期/DL':112,'實際送達/完工日期':112,'普通':52,'緊急':52,'補充說明':160,'最新進度':170,'送船狀態':88,'結案狀態':80,'結案日期':112,'內控同步':96};
 const geometry=[];
 await check(`${audience}-compact-fixture-and-toolbar-real-saves`,async()=>{
  await click('＋ 新增／批量新增');
  for(let i=1;i<=4;i++){
   if(i>1)await click('＋ 新增一列');const prefix=`第 ${i} 筆 `;
   await fill(`[aria-label="${prefix}申請單號(材料或工程)"]`,`COMPACT-${i}`);
   await fill(`[aria-label="${prefix}原項次"]`,String(i));
   await fill(`[aria-label="${prefix}內容摘要/工程內容"]`,'測試用完整摘要，不截內容；'+(i===1?'LONG-'.repeat(35):'記錄分組'));
   if(i>2)await select(prefix+'類型','repair');
   await date(prefix+'申請/開單日期','2026-09-21');await date(prefix+'期望完成日期/DL','2026-10-01');
   await fill(`[aria-label="${prefix}最新進度"]`,`COMPACT-${i} 已保存進度`);
  }
  await save(4);await tab('配件物料總清單');await choose(['COMPACT-1','COMPACT-2']);await click('批量更新');
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
    await choose([reference]);await until(()=>evaluate("[...document.querySelectorAll('button')].some(n=>n.innerText==='查看所選紀錄'&&!n.disabled)"),'readonly ready');await click('查看所選紀錄');
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
  await choose(['COMPACT-1','COMPACT-2']);const before=await qa.read(),start=qa.metrics.length;await click('查看所選紀錄');
  await until(()=>evaluate("document.querySelectorAll('.tracking-history-item').length===2"),'two exact groups');
  for(let i=0;i<2;i++)await nodeClick(`document.querySelectorAll('.tracking-history-item>summary')[${i}]`);
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

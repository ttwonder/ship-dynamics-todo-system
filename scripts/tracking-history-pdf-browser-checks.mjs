import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function trackingHistoryPdfChecks({qa,call,evaluate,click,nodeClick,fill,until,screen,check,output,audience,finish}) {
 const descriptions=['FIRSTITEM 項目一：濾芯與墊片 <核對> & 完整保留',Array.from({length:150},(_,i)=>`LONG${String(i).padStart(3,'0')} 工程內容與核對說明，完整文字不截斷、不縮成截圖。`).join('\n'),'LASTITEM 項目三：同一申請單的另一項目'];
 const set=async(label,value)=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')});Object.getOwnPropertyDescriptor(n.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await check(audience+'-history-pdf-original-UI-saved-same-reference-fixture',async()=>{
  await click('＋ 新增／批量新增');
  for(let i=0;i<3;i++){if(i)await click('＋ 新增一列');const p=`第 ${i+1} 筆 `;await fill(`[aria-label="${p}申請單號(材料或工程)"]`,'HIST-SAME');await fill(`[aria-label="${p}內容摘要/工程內容"]`,descriptions[i]);await fill(`[aria-label="${p}最新進度"]`,'已保存進度 INITIAL-'+i);await fill(`[aria-label="${p}補充說明"]`,'補充文字 NOTES-'+i);await set(p+'申請/開單日期','2026-09-01');}
  await click('確認保存 3 項');await finish();
  await click('清除選取');for(const marker of ['FIRSTITEM','LONG000','LASTITEM'])await nodeClick(`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.innerText.includes('${marker}')).querySelector('input[type=checkbox]')`);
  await click('修正分類');await until(()=>evaluate("Boolean(document.querySelector('[aria-label=本批目標類型]'))"),'reclassification fixture');await set('本批目標類型','temporary-materials');await click('確認保存 3 項');await finish();
 });
 await check(audience+'-renamed-toolbar-filtered-select-all-and-original-sync',async()=>{
  const saved=await qa.read();await fill('[aria-label="搜尋跟蹤"]','HIST-SAME');await click('清除選取');
  await until(()=>evaluate("document.querySelectorAll('.tracking-table tbody .tracking-check input').length===3"),'filtered three-item scope');
  for(const width of [1440,390]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
   const buttons=await evaluate("[...document.querySelectorAll('.tracking-toolbar button')].map(n=>{const r=n.getBoundingClientRect();return {text:n.innerText.trim(),left:r.left,right:r.right}})");
   for(const label of ['選取全部','同步到內控','查看歷史記錄']){const button=buttons.find(n=>n.text===label);assert.ok(button,label);assert.ok(button.left>=0&&button.right<=width+1,label+' inside viewport');}
   assert.ok(!buttons.some(n=>/查看所選狀態更新|選取全部符合條件|同步所選到/.test(n.text)));await screen(audience+'-renamed-toolbar-'+width);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await click('選取全部');await until(()=>evaluate("document.querySelector('.tracking-toolbar>b').innerText==='已選 3 項'"),'filtered select all');assert.equal(await evaluate("document.querySelectorAll('.tracking-table tbody .tracking-check input:checked').length"),3);
  await click('同步到內控');await until(()=>evaluate("Boolean(document.querySelector('.ic-batch-modal'))"),'unchanged sync dialog');
  await nodeClick("[...document.querySelectorAll('.modal button')].find(n=>['取消','關閉'].includes(n.innerText.trim()))");
  if(await evaluate('Boolean(document.querySelector(".tracking-navigation"))'))await click('捨棄草稿並關閉');
  await until(()=>evaluate('!document.querySelector(".modal-backdrop")'),'sync cancel');assert.deepEqual(await qa.read(),saved,'renaming and canceling do not alter business records');
 });
 // Re-select exact sources after ACK; no data creation/mutation belongs to export.
 await click('清除選取');for(const marker of ['FIRSTITEM','LONG000','LASTITEM'])await nodeClick(`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.innerText.includes('${marker}')).querySelector('input[type=checkbox]')`);
 const before=await qa.read(),metricsStart=qa.metrics.length;
 const ids=before.payload.trackingItems.filter(r=>r.referenceNo==='HIST-SAME').map(r=>r.id);
 const oldTitle=await evaluate('document.title');
 await click('查看歷史記錄');await until(()=>evaluate('Boolean(document.querySelector(".tracking-history-modal"))'),'history modal');
 const order=await evaluate("[...document.querySelectorAll('.tracking-history-item')].map(n=>n.dataset.historyId)");assert.deepEqual(new Set(order),new Set(ids));
 fs.writeFileSync(path.join(output,'history-pdf-order.json'),JSON.stringify(order.map(id=>before.payload.trackingItems.find(r=>r.id===id).description.split('\n')[0])));
 await check(audience+'-history-pdf-button-desktop-mobile-and-collapsed-source',async()=>{
  for(const width of [1440,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});const geometry=await evaluate("(()=>{const n=[...document.querySelectorAll('.tracking-history-modal button')].find(n=>n.innerText==='導出 PDF'),r=n.getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,left:r.left,right:r.right,disabled:n.disabled}})()");assert.ok(geometry.scroll<=width+1&&geometry.left>=0&&geometry.right<=width+1&&!geometry.disabled);await screen(audience+'-history-pdf-'+width);}
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate("document.querySelectorAll('.tracking-history-modal details').forEach(n=>n.open=false)");
  assert.equal(await evaluate("document.querySelectorAll('.tracking-history-modal details[open]').length"),0);
 });
 await check(audience+'-history-pdf-real-print-DOM-and-paginated-bytes-no-lease-or-write',async()=>{
  await evaluate("window.__historyPrintCount=0;window.__nativePrint=window.print;window.print=()=>{window.__historyPrintCount++}");
  await click('導出 PDF');await until(()=>evaluate('window.__historyPrintCount===1'),'product print invocation');
  const dom=await evaluate("document.querySelector('.tracking-history-print-document').textContent");
  for(const value of ['FIRSTITEM','LONG149','LASTITEM','INITIAL-0','INITIAL-1','INITIAL-2','NOTES-0','NOTES-1','NOTES-2','修正分類'])assert.ok(dom.includes(value),value+' present despite collapsed view');
  for(const id of ids)assert.ok(!dom.includes(id));assert.ok(!dom.includes('BROWSER-001')&&!dom.includes('UI-001'));
  if(audience==='ship')assert.ok(!dom.includes('要事'));
  assert.equal(await evaluate("document.querySelectorAll('.tracking-history-print-item').length"),3);
  fs.writeFileSync(path.join(output,'history-print-dom.txt'),dom);
  const pdf=await call('Page.printToPDF',{preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
  const bytes=Buffer.from(pdf.data,'base64');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>10_000);fs.writeFileSync(path.join(output,audience+'-history.pdf'),bytes);
  await evaluate("window.dispatchEvent(new Event('afterprint'))");await until(()=>evaluate("!document.querySelector('.tracking-history-print-root')&&!document.body.classList.contains('printing-tracking-history')"),'print cleanup');
  assert.equal(await evaluate('document.title'),oldTitle);assert.equal(await evaluate("document.querySelectorAll('style[data-tracking-history-print]').length"),0);
  assert.ok(await evaluate('Boolean(document.querySelector(".tracking-history-modal"))'));
  assert.deepEqual(qa.metrics.slice(metricsStart).filter(m=>/acquire|claim|renew|apply|save/.test(m.rpc)||['claim','submit','renew'].includes(m.action)),[]);
  assert.deepEqual(await qa.read(),before,'history export is read-only');
 });
 await check(audience+'-history-pdf-close-cancels-held-font-preparation',async()=>{
  await evaluate("window.__fontDescriptor=Object.getOwnPropertyDescriptor(document.fonts,'ready');Object.defineProperty(document.fonts,'ready',{configurable:true,value:new Promise(resolve=>window.__releaseFonts=resolve)})");
  await click('導出 PDF');await until(()=>evaluate('Boolean(document.querySelector(".tracking-history-print-root"))'),'pending print snapshot');
  await click('關閉紀錄');await until(()=>evaluate('!document.querySelector(".tracking-history-modal")'),'history closed');
  await evaluate("window.__releaseFonts();if(window.__fontDescriptor)Object.defineProperty(document.fonts,'ready',window.__fontDescriptor);else delete document.fonts.ready");
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate('window.__historyPrintCount'),1);assert.ok(await evaluate("!document.querySelector('.tracking-history-print-root')&&!document.body.classList.contains('printing-tracking-history')"));
  assert.deepEqual(await qa.read(),before);
 });
}

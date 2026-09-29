import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// Explicit component-only fault injection; not native DB/hosted identity proof.
export async function historyPdfComponentChecks({qa,call,evaluate,click,nodeClick,until,screen,check,output}) {
 await call('Page.navigate',{url:qa.origin+'/scripts/fixtures/tracking-ui.html'});
 await until(()=>evaluate('Boolean(window.__trackingQA&&document.querySelector(".tracking-page"))'),'history component fixture');
 await evaluate("window.__trackingQA.change({canExport:true,canWrite:false})");
 await nodeClick("[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith('未送船清單'))");
 await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'component list');
 await click('清除選取');await nodeClick("document.querySelector('[data-tracking-id=r0] .tracking-check input')");
 const open=async()=>{await click('查看歷史記錄');await until(()=>evaluate('Boolean(document.querySelector(".tracking-history-modal"))'),'history open');};
 const hold=async()=>{await evaluate("Object.defineProperty(document.fonts,'ready',{configurable:true,value:new Promise(resolve=>window.__releaseFonts=resolve)})");};
 const release=async()=>{await evaluate("window.__releaseFonts();delete document.fonts.ready");await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');};
 const noPrint=async(count)=>{assert.equal(await evaluate('window.__historyPrintCount'),count);await until(()=>evaluate("!document.querySelector('.tracking-history-print-root')&&!document.body.classList.contains('printing-tracking-history')&&!document.querySelector('style[data-tracking-history-print]')"),'stale preparation clean');};
 await evaluate("window.__historyPrintCount=0;window.print=()=>window.__historyPrintCount++");
 const before=await evaluate("({data:JSON.stringify(window.__trackingQA.data),claims:window.__trackingQA.claims,writes:window.__trackingQA.submissions.length,title:document.title})");
 await open();
 await check('component-history-pdf-readonly-allowed-double-click-single-print-afterprint-cleanup',async()=>{
  await hold();await click('導出 PDF');await until(()=>evaluate("Boolean(document.querySelector('.tracking-history-print-root'))"),'first captured');
  await evaluate("[...document.querySelectorAll('.tracking-history-modal button')].find(n=>n.innerText==='導出 PDF').click()");assert.equal(await evaluate('window.__historyPrintCount'),0);
  await release();await until(()=>evaluate('window.__historyPrintCount===1'),'single print');
  await evaluate("window.dispatchEvent(new Event('afterprint'))");await noPrint(1);assert.equal(await evaluate('document.title'),before.title);
 });
 await check('component-history-pdf-print-error-cleanup-and-explicit-retry',async()=>{
  await evaluate("window.print=()=>{throw new Error('synthetic print rejection')}");await click('導出 PDF');await until(()=>evaluate("document.querySelector('.tracking-history-modal').innerText.includes('未能啟動 PDF')"),'visible error');await noPrint(1);assert.equal(await evaluate('document.title'),before.title);
  await evaluate('window.print=()=>window.__historyPrintCount++');await click('導出 PDF');await until(()=>evaluate('window.__historyPrintCount===2'),'explicit retry');await evaluate("window.dispatchEvent(new Event('afterprint'))");await noPrint(2);
 });
 await check('component-history-pdf-held-font-permission-loss-and-ABA-no-print',async()=>{
  await hold();await click('導出 PDF');await until(()=>evaluate('Boolean(document.querySelector(".tracking-history-print-root"))'),'permission held');
  await evaluate('window.__trackingQA.change({canExport:false})');await until(()=>evaluate("![...document.querySelectorAll('.tracking-history-modal button')].some(n=>n.innerText==='導出 PDF')"),'permission removed');
  await evaluate('window.__trackingQA.change({canExport:true})');await until(()=>evaluate("[...document.querySelectorAll('.tracking-history-modal button')].some(n=>n.innerText==='導出 PDF')"),'permission ABA return');await release();await noPrint(2);
 });
 await check('component-history-pdf-held-font-current-row-change-no-stale-print',async()=>{
  await hold();await click('導出 PDF');await until(()=>evaluate('Boolean(document.querySelector(".tracking-history-print-root"))'),'data held');
  await evaluate("(()=>{const data=structuredClone(window.__trackingQA.data);data.trackingItems.find(r=>r.id==='r0').progress='後到的已保存進度';window.__trackingQA.change({data})})()");
  await until(()=>evaluate("document.querySelector('.tracking-retained-details').textContent.includes('後到的已保存進度')"),'new saved source render');await release();await noPrint(2);
 });
 await check('component-history-pdf-held-font-identity-unmount-no-print',async()=>{
  await hold();await click('導出 PDF');await until(()=>evaluate('Boolean(document.querySelector(".tracking-history-print-root"))'),'identity held');
  await evaluate("window.__trackingQA.change({identity:'new-pdf-session'})");await until(()=>evaluate('!document.querySelector(".tracking-history-modal")'),'old viewer unmounted');await release();await noPrint(2);
  await evaluate("window.__trackingQA.change({identity:'session-a'})");await until(()=>evaluate("document.querySelector('[data-qa-identity]')?.dataset.qaIdentity==='session-a'"),'identity returned');assert.ok(!await evaluate('Boolean(document.querySelector(".tracking-history-modal"))'));
 });
 await check('component-history-pdf-persisted-unknown-pending-blocks-new-export',async()=>{
  await open();await evaluate("(()=>{const q=window.__trackingQA,key=JSON.stringify(['tracking-unsent-v1','component-fixture',q.actorId,'v1']);window.__pdfPendingKey=key;localStorage.setItem(key,JSON.stringify({pending:{command:{type:'progress'}}}));q.change({})})()");
  await until(()=>evaluate("[...document.querySelectorAll('.tracking-history-modal button')].find(n=>n.innerText==='導出 PDF')?.disabled"),'unknown pending disabled');await noPrint(2);
  await evaluate('localStorage.removeItem(window.__pdfPendingKey);window.__trackingQA.change({})');await until(()=>evaluate("![...document.querySelectorAll('.tracking-history-modal button')].find(n=>n.innerText==='導出 PDF').disabled"),'pending cleared in synthetic fixture');
  await click('關閉紀錄');
 });
 await check('component-history-pdf-long-history-real-paginated-bytes',async()=>{
  await evaluate("(()=>{const data=structuredClone(window.__trackingQA.data),row=data.trackingItems.find(r=>r.id==='r0');row.description='HISTORYITEM 完整狀態歷程測試';row.progress='目前獨立進度，不由歷史補造';row.statusLogs=[{id:'long-history-private-id',at:'2026-09-27T08:00:00Z',by:'測試操作員',text:Array.from({length:120},(_,i)=>'HISTORY'+String(i).padStart(3,'0')+' 歷史更新內容逐行保留，跨頁不截斷。').join('\\n')},{id:'new-history-private-id',at:'2026-09-28T08:00:00Z',by:'測試操作員',text:'NEWESTHISTORY 最新一筆先列出'}];window.__trackingQA.change({data})})()");
  await open();await evaluate("document.querySelectorAll('.tracking-history-modal details').forEach(n=>n.open=false)");await click('導出 PDF');await until(()=>evaluate('window.__historyPrintCount===3'),'long history real print');
  const dom=await evaluate("document.querySelector('.tracking-history-print-document').textContent");assert.ok(dom.indexOf('NEWESTHISTORY')<dom.indexOf('HISTORY000'));assert.ok(dom.includes('HISTORY119'));assert.ok(!dom.includes('long-history-private-id'));
  const pdf=await call('Page.printToPDF',{preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});const bytes=Buffer.from(pdf.data,'base64');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');fs.writeFileSync(path.join(output,'long-history.pdf'),bytes);
  await evaluate("window.dispatchEvent(new Event('afterprint'))");await noPrint(3);await click('關閉紀錄');
 });
 await check('component-history-pdf-all-deleted-no-export-and-no-writes-or-leases',async()=>{
  await evaluate("(()=>{const data=structuredClone(window.__trackingQA.data);data.trackingItems.find(r=>r.id==='r0').deletion={at:'2026-09-29T00:00:00Z',byUserId:'component-a',reason:'已刪除測試'};window.__trackingQA.change({data})})()");
  await nodeClick("[...document.querySelectorAll('.tracking-review-tabs button')].find(n=>n.innerText.startsWith('已刪除清單'))");await until(()=>evaluate("Boolean(document.querySelector('[data-tracking-id=r0]'))"),'deleted source list');await nodeClick("document.querySelector('[data-tracking-id=r0] .tracking-check input')");await open();assert.ok(await evaluate("[...document.querySelectorAll('.tracking-history-modal button')].find(n=>n.innerText==='導出 PDF').disabled"));await screen('component-history-pdf-deleted-disabled');await click('關閉紀錄');
  assert.equal(await evaluate('window.__trackingQA.claims'),before.claims);assert.equal(await evaluate('window.__trackingQA.submissions.length'),before.writes);assert.equal(await evaluate('document.title'),before.title);
 });
}

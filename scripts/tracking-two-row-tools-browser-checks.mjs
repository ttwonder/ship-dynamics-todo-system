import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// Original UI + synthetic records + private native PostgreSQL; no hosted writes.
export async function trackingTwoRowToolsChecks({qa,call,evaluate,click,fill,until,screen,check,output,audience}){
 const before=await qa.read(),start=qa.metrics.length,measurements=[];
 const size=width=>call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
 const measure=()=>evaluate(`(()=>{
  const box=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,font:s.font,color:s.color,background:s.backgroundColor}};
  const button=t=>[...document.querySelectorAll('.tracking-page button')].find(n=>n.textContent.trim()===t),toolbar=document.querySelector('[aria-label="跟蹤選取與批量操作"]');
  return {viewport:innerWidth,document:document.documentElement.scrollWidth,clear:box(button('清除條件')),urgent:box(button('緊急')),search:box(document.querySelector('[aria-label="搜尋跟蹤"]')),group:box(document.querySelector('.tracking-search-actions')),toolbar:box(toolbar),selected:toolbar.querySelector('b').textContent,actions:[...toolbar.querySelectorAll('button')].filter(n=>n.classList.contains('btn')).map(n=>({text:n.textContent.trim(),disabled:n.disabled,...box(n)})),placeholder:document.querySelector('[aria-label="搜尋跟蹤"]').placeholder};
 })()`);
 await check(audience+'-two-row-tools-order-width-wrap-and-selection',async()=>{
  for(const selected of [false,true]){
   await size(1440);await click(selected?'選取全部':'清除選取');
   for(const width of [2880,1440,390]){
    await size(width);await evaluate('document.fonts.ready');await evaluate("document.querySelector('.tracking-search-actions').scrollIntoView({block:'start'})");
    measurements.push({...await measure(),hasSelection:selected});await screen(`${audience}-tool-rows-${selected?'selected':'empty'}-${width}`);
   }
  }
  fs.writeFileSync(path.join(output,'two-row-tools.json'),JSON.stringify(measurements,null,2));
  for(const m of measurements){
   assert.ok(m.clear.right<=m.urgent.left&&m.urgent.right<=m.search.left,'first row order: clear, urgent, long search');
   assert.ok(Math.abs(m.clear.top-m.urgent.top)<3&&Math.abs(m.search.top-m.clear.top)<4,'first-row controls remain aligned');
   assert.ok(m.toolbar.top>=Math.max(m.search.bottom,m.clear.bottom,m.urgent.bottom)+3,'batch toolbar is a separate second row');
   assert.ok(Math.abs(m.search.right-m.group.right)<=2&&m.search.width>=m.group.width-m.clear.width-m.urgent.width-14,'search fills remaining first-row width');
   assert.ok(m.document<=m.viewport+1,'page must not overflow');
   assert.ok(m.actions.every(n=>n.left>=m.toolbar.left&&n.right<=m.toolbar.right+1&&n.top>=m.toolbar.top&&n.bottom<=m.toolbar.bottom+1),'all original actions wrap inside second row');
   assert.equal(m.placeholder,'可以使用","來隔開不同關鍵詞，實現多詞多筆同時搜索。');
   assert.ok(m.hasSelection?!m.selected.includes('已選 0 項'):m.selected==='已選 0 項');
  }
  await size(1440);await click('清除選取');
 });
 await check(audience+'-relocated-search-clear-urgent-and-select-stay-read-only',async()=>{
  const ids=()=>evaluate("[...document.querySelectorAll('.tracking-table tbody tr[data-tracking-id]')].map(n=>n.dataset.trackingId).sort()");
  const initial=await ids(),ref=audience==='ship'?'BROWSER-001':'UI-001';
  await click('選取全部');await fill('[aria-label="搜尋跟蹤"]',ref+','+ref);
  await until(()=>evaluate("document.querySelector('.tracking-toolbar>b').textContent==='已選 0 項'"),'search clears prior selection');assert.equal((await ids()).length,1);
  await click('緊急');await until(()=>evaluate("document.querySelector('.tracking-urgent-shortcut').getAttribute('aria-pressed')==='true'"),'urgent pressed');
  await click('清除條件');await until(async()=>JSON.stringify(await ids())===JSON.stringify(initial),'clear restores exact scope');
  assert.equal(await evaluate("document.querySelector('[aria-label=搜尋跟蹤]').value"),'');assert.equal(await evaluate("document.querySelector('.tracking-urgent-shortcut').getAttribute('aria-pressed')"),'false');
  await click('選取全部');assert.equal(await evaluate("document.querySelector('.tracking-toolbar>b').textContent"),`已選 ${initial.length} 項`);await click('清除選取');
  assert.deepEqual(await qa.read(),before,'moving controls and filtering do not change business records');
  assert.deepEqual(qa.metrics.slice(start).filter(m=>/acquire|claim|renew|apply|save/.test(m.rpc)||['claim','submit','renew'].includes(m.action)),[],'no edit leases or writes from layout/filter actions');
 });
}

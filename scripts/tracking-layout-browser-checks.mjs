import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Original App, native local PostgreSQL, synthetic records only.
export async function layoutChecks(c) {
  const {call,evaluate,nodeClick,click,fill,until,screen,check,rowAction,finishEditor,qa,output}=c;
  const geometry={};
  const summary=name=>`[...document.querySelectorAll('.tracking-page summary')].find(n=>n.textContent.trim()===${JSON.stringify(name)})`;
  const toggle=async name=>nodeClick(summary(name));
  const measure=()=>evaluate(`(()=>{
    const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const button=t=>[...document.querySelectorAll('.tracking-page button')].find(n=>n.textContent.trim()===t);
    const sum=t=>[...document.querySelectorAll('.tracking-page summary')].find(n=>n.textContent.trim()===t);
    const search=document.querySelector('[aria-label="搜尋跟蹤"]'),batch=button('批量更新進度')?.closest('.tracking-toolbar');
    return {viewport:innerWidth,document:document.documentElement.scrollWidth,search:rect(search),batch:rect(batch),import:rect(button('導入 Excel')),exports:rect(document.querySelector('[aria-label="跟蹤匯出與模板"]')),filter:rect(sum('全部欄位篩選')),preferences:rect(sum('欄位設定')),fields:[...document.querySelectorAll('.tracking-filter-grid fieldset')].map(rect),inputs:[...document.querySelectorAll('.tracking-filter-grid input,.tracking-filter-grid select:not([multiple])')].map(rect)};
  })()`);
  const size=async(width,height=1100)=>{await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await evaluate('window.scrollTo(0,0)');};
  await size(2880,1300);
  geometry.wide=await measure();await screen('tracking-layout-wide');
  await toggle('全部欄位篩選');await toggle('欄位設定');
  geometry.expanded=await measure();await screen('tracking-layout-expanded');
  await toggle('全部欄位篩選');await toggle('欄位設定');
  await rowAction('UI-001','進度');
  geometry.progress=await evaluate(`(()=>{const n=document.querySelector('[aria-label="UI-001 最新進度"]'),m=n.closest('[role=dialog]');return{input:n.getBoundingClientRect().width,modal:m.getBoundingClientRect().width,viewport:innerWidth};})()`);
  await screen('tracking-layout-progress-wide');await click('取消');await finishEditor();
  await size(1440);geometry.desktop=await measure();await screen('tracking-layout-desktop');
  await size(390,844);await toggle('全部欄位篩選');await toggle('欄位設定');
  geometry.mobile=await measure();await screen('tracking-layout-mobile-expanded');
  await toggle('全部欄位篩選');await toggle('欄位設定');
  await rowAction('UI-001','進度');
  geometry.mobileProgress=await evaluate(`(()=>{const n=document.querySelector('[aria-label="UI-001 最新進度"]');return{input:n.getBoundingClientRect().width,document:document.documentElement.scrollWidth,viewport:innerWidth};})()`);
  await screen('tracking-layout-progress-mobile');await click('取消');await finishEditor();
  await click('Excel');await until(()=>evaluate("Boolean(document.querySelector('[aria-label=跟蹤匯出]'))"),'mobile moved export');
  geometry.mobileExport=await evaluate(`(()=>{const modal=document.querySelector('[aria-label=跟蹤匯出]');return{viewport:innerWidth,document:document.documentElement.scrollWidth,controls:[...modal.querySelectorAll('select')].map(n=>({label:n.getAttribute('aria-label'),width:n.getBoundingClientRect().width,computedWidth:getComputedStyle(n).width,right:n.getBoundingClientRect().right}))};})()`);
  await screen('tracking-layout-export-mobile');await click('關閉匯出');
  fs.writeFileSync(path.join(output,'layout-geometry.json'),JSON.stringify(geometry,null,2));
  await check('layout-compact-controls-and-responsive-progress',async()=>{
    const g=geometry.wide,opened=geometry.expanded;
    const failures=[];
    if(!(g.exports.x>=g.import.right && Math.abs(g.exports.y-g.import.y)<8))failures.push('Exports/templates must follow import on the heading row');
    if(!(g.batch.x>=g.search.right && g.search.width<=360 && g.search.y>=g.batch.y-2 && g.search.bottom<=g.batch.bottom+2))failures.push('Compact search must share the batch-action row');
    if(!(Math.abs(g.filter.y-g.preferences.y)<3 && g.preferences.x>=g.filter.right))failures.push('Filter and column-settings summaries must share a row');
    if(!(Math.abs(opened.filter.y-opened.preferences.y)<3))failures.push('Expanded panels must not displace their summary controls');
    if(!(new Set(opened.fields.map(r=>Math.round(r.x))).size>=6 && opened.inputs.every(r=>r.height<=30)))failures.push('Expanded filters must use compact cells and short controls');
    if(!(geometry.progress.input>=2100 && geometry.progress.modal<=geometry.progress.viewport))failures.push('Progress input must be about twice its original desktop width, bounded by viewport');
    if(!(geometry.mobile.document<=390 && geometry.mobileProgress.document<=390))failures.push('Mobile document must not overflow');
    if(!(geometry.mobileExport.document<=390 && geometry.mobileExport.controls.every(n=>n.width>=140&&n.right<=390)))failures.push('Moving export tools must not collapse the mobile export selectors');
    assert.deepEqual(failures,[],JSON.stringify({failures,geometry}));
  });
  await size(1440);
  await check('layout-moved-controls-still-filter-select-export-and-show-history',async()=>{
    await fill('[aria-label="搜尋跟蹤"]','no-such-reference');
    await until(()=>evaluate("document.querySelector('.tracking-table').innerText.includes('沒有符合條件')"),'search result');
    await click('清除條件');
    await until(()=>evaluate("document.querySelector('.tracking-table').innerText.includes('UI-001')"),'clear search');
    await click('選取全部符合條件 1 項');
    assert.ok(await evaluate("document.querySelector('.tracking-page').innerText.includes('已選 1 項')"));
    await click('清除選取');
    await toggle('全部欄位篩選');await fill('[aria-label="項目編號包含"]','UI-001');
    assert.ok(await evaluate("document.querySelector('[aria-label=有效篩選]').innerText.includes('項目編號')"));
    await click('清除條件');await toggle('全部欄位篩選');
    await click('Excel');await until(()=>evaluate("Boolean(document.querySelector('[aria-label=跟蹤匯出]'))"),'moved export');
    await click('建立共用快照');await until(()=>evaluate("Boolean([...document.querySelectorAll('button')].find(n=>n.innerText==='下載 XLSX'))"),'confirmed export capture');
    await click('關閉匯出');
    const updates=['零件訂購已確認','供應商已完成備貨，等待安排交船'];
    const before=(await qa.read()).payload.trackingItems.find(r=>r.referenceNo==='UI-001');
    for(const update of updates){
      await rowAction('UI-001','進度');await fill('[aria-label="UI-001 最新進度"]',update);await click('確認保存 1 項');await finishEditor();
    }
    const saved=(await qa.read()).payload.trackingItems.find(r=>r.id===before.id);
    assert.equal(saved.progress,updates.at(-1));
    const added=saved.statusLogs.slice(0,saved.statusLogs.length-before.statusLogs.length).reverse();
    assert.deepEqual(added.map(l=>l.text),updates);
    assert.ok(added.every(l=>Number.isFinite(Date.parse(l.at))),'each confirmed update has a timestamp');
    assert.ok(Date.parse(added[0].at)<=Date.parse(added[1].at),'history timestamp order');
    await rowAction('UI-001','進度');
    const history=await evaluate("document.querySelector('[aria-label=進度更新記錄]')?.innerText||''");
    assert.ok(updates.every(t=>history.includes(t)),'all prior updates visible in progress editor');
    const times=await evaluate("[...document.querySelectorAll('[aria-label=進度更新記錄] time')].map(n=>({at:n.dateTime,text:n.textContent}))");
    assert.ok(added.every(l=>times.some(t=>t.at===l.at&&t.text.trim())),'stored time is displayed with its exact timestamp');
    await screen('tracking-layout-progress-history');await click('取消');await finishEditor();
    await call('Page.reload');await until(()=>evaluate("document.body.innerText.includes('QA OWNER')"),'fresh document');
    await click('配件/物料/工程跟蹤');await until(()=>evaluate("document.querySelector('.tracking-table')?.innerText.includes('UI-001')"),'record reread');
    assert.deepEqual((await qa.read()).payload.trackingItems.find(r=>r.id===before.id).statusLogs,saved.statusLogs,'history survives authoritative reread');
  });
}

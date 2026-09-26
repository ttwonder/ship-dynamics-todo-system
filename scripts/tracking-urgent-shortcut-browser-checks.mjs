import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Original mounted UI + isolated native SQL fixtures; never production data.
export async function urgentShortcutChecks({qa,call,evaluate,click,nodeClick,fill,until,screen,check,output,audience}) {
 const tab=label=>nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);
 // The separate urgency badge is not part of the stored reference number.
 const refs=()=>evaluate("[...document.querySelectorAll('.tracking-table tbody .tracking-reference .tracking-cell-text')].map(n=>[...n.childNodes].filter(c=>c.nodeType===Node.TEXT_NODE).map(c=>c.textContent).join('').trim()).sort()");
 const pressed=()=>evaluate("document.querySelector('.tracking-search-actions button[aria-pressed]')?.getAttribute('aria-pressed')");
 const choose=async value=>{await evaluate(`(()=>{const n=document.querySelector('[aria-label="跟蹤船舶"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(()=>evaluate(`document.querySelector('[aria-label="跟蹤船舶"]').value===${JSON.stringify(value)}`),'vessel selection');};
 const geometry=[];
 const measure=()=>evaluate(`(()=>{const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};const row=document.querySelector('.tracking-search-actions'),urgent=row.querySelector('button[aria-pressed]');return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,search:rect(row.querySelector('.tracking-search')),clear:rect(row.querySelector('.tracking-search>.btn')),urgent:rect(urgent),toolbar:rect(row.querySelector('.tracking-toolbar')),buttons:[...row.querySelectorAll('button')].map(n=>n.textContent.trim()),style:urgent?{color:getComputedStyle(urgent).color,background:getComputedStyle(urgent).backgroundColor,weight:Number(getComputedStyle(urgent).fontWeight)}:null};})()`);
 await check(`${audience}-urgent-shortcut-visible-order-and-initial-state`,async()=>{
  for(const width of [1440,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await evaluate('window.scrollTo(0,0)');geometry.push({phase:'initial',...await measure()});await screen(`urgent-initial-${width}`);}
  fs.writeFileSync(path.join(output,'urgent-geometry.json'),JSON.stringify(geometry,null,2));
  assert.equal(await evaluate("document.querySelectorAll('.tracking-search-actions button[aria-pressed]').length"),1,'one urgent toggle in the list toolbar');assert.equal(await pressed(),'false');
  const buttons=geometry[0].buttons,urgent=buttons.indexOf('緊急');assert.equal(urgent,buttons.indexOf('清除條件')+1);assert.ok(buttons[urgent+1].startsWith('選取全部符合條件'));
 });
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const now='2026-09-26T00:00:00.000Z';
 const row=(key,patch={})=>({id:'quick-'+key,vesselId:'qa-v1',kind:'supply',requestType:'spares',referenceNo:'QUICK-'+key,description:'緊急快捷篩選測試 '+key,applicationDate:'2026-09-15',urgency:'normal',deliveryStatus:'not-delivered',isClosed:false,expectedDate:'',supplementalNotes:'',progress:'',createdBy:'qa-owner',updatedBy:'qa-owner',createdAt:now,updatedAt:now,statusLogs:[],events:[],...patch});
 const fixture=[];
 for(const urgency of ['normal','urgent']){
  fixture.push(row('supply-open-'+urgency,{urgency}),row('supply-delivered-'+urgency,{urgency,deliveryStatus:'delivered',actualDeliveryDate:'2026-09-25'}),row('engineering-open-'+urgency,{urgency,kind:'engineering',requestType:'repair'}),row('engineering-completed-'+urgency,{urgency,kind:'engineering',requestType:'repair',completionDate:'2026-09-25'}));
 }
 fixture.push(...Array.from({length:31},(_,i)=>row('bulk-'+String(i).padStart(2,'0'))),row('foreign-urgent',{vesselId:'qa-v2',urgency:'urgent'}));
 const beforeSetup=await qa.read();
 await qa.db.transaction(async tx=>{for(const item of fixture)await tx.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,'trackingItems',$2,$3::jsonb,$4)",[qa.workspace,item.id,JSON.stringify(item),beforeSetup.revision]);await tx.query("update ship_dynamics_record_collections set ids=$2::jsonb where workspace_key=$1 and collection='trackingItems'",[qa.workspace,JSON.stringify([...(beforeSetup.payload.trackingItems||[]).map(r=>r.id),...fixture.map(r=>r.id)])]);});
 const business=await qa.read(),writeCount=()=>qa.metrics.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'||m.rpc==='ship_dynamics_tracking_public_v1'&&m.action==='submit').length,writesBefore=writeCount();
 await choose('qa-v2');await until(()=>evaluate("document.querySelector('.tracking-table')?.innerText.includes('QUICK-foreign-urgent')"),'foreign fixture loaded');await choose('qa-v1');await until(()=>evaluate("document.querySelector('.tracking-table')?.innerText.includes('QUICK-')&&!document.querySelector('.tracking-table')?.innerText.includes('QUICK-foreign-urgent')"),'current vessel fixture loaded');
 const cases=[['未送船清單',r=>r.kind==='supply'&&r.deliveryStatus!=='delivered'],['已送船清單',r=>r.kind==='supply'&&r.deliveryStatus==='delivered'],['配件物料總清單',r=>r.kind==='supply'],['未完成工程單',r=>r.kind==='engineering'&&!r.completionDate],['已完成工程單',r=>r.kind==='engineering'&&Boolean(r.completionDate)]];
 for(const [label,accept] of cases)await check(`${audience}-${label}-urgent-toggle-clear-and-selection`,async()=>{
  await tab(label);await click('清除條件');await fill('[aria-label="搜尋跟蹤"]','QUICK-');
  const all=fixture.filter(r=>r.vesselId==='qa-v1'&&accept(r)),expected=all.filter(r=>r.urgency==='urgent').map(r=>r.referenceNo).sort();
  await until(()=>evaluate(`document.querySelector('.tracking-toolbar').innerText.includes('選取全部符合條件 ${all.length} 項')`),'complete unfiltered count');const baseline=await refs();
  await click(`選取全部符合條件 ${all.length} 項`);await click('緊急');await until(async()=>await pressed()==='true'&&JSON.stringify(await refs())===JSON.stringify(expected),'urgent-only exact rows');
  assert.equal(await evaluate("document.querySelector('.tracking-toolbar>b').textContent"),'已選 0 項');assert.equal(await evaluate("document.querySelector('[aria-label=搜尋跟蹤]').value"),'QUICK-');
  assert.ok(await evaluate("[...document.querySelectorAll('[aria-label=\"緊急多選\"] label')].find(n=>n.textContent==='是').querySelector('input').checked"),'quick toggle updates the existing field filter');
  await click('緊急');await until(async()=>await pressed()==='false'&&JSON.stringify(await refs())===JSON.stringify(baseline),'second click restores prior rows');
  await click('緊急');await click('清除條件');assert.equal(await pressed(),'false');assert.equal(await evaluate("document.querySelector('[aria-label=搜尋跟蹤]').value"),'');assert.equal(await evaluate("document.querySelector('.tracking-toolbar>b').textContent"),'已選 0 項');
 });
 await check(`${audience}-urgent-shortcut-resets-page-and-keeps-other-filters`,async()=>{
  await tab('未送船清單');await fill('[aria-label="搜尋跟蹤"]','QUICK-');await click('下一頁');await until(()=>evaluate("document.querySelector('.tracking-pagination input').value==='2'"),'page two precondition');
  await click('緊急');await until(()=>evaluate("document.querySelector('.tracking-pagination input').value==='1'"),'urgent returns to page one');assert.deepEqual(await refs(),['QUICK-supply-open-urgent']);
  await fill('[aria-label="搜尋跟蹤"]','QUICK-supply-open-normal');assert.deepEqual(await refs(),[]);assert.equal(await pressed(),'true');assert.ok(await evaluate("document.querySelector('.tracking-table').innerText.includes('沒有符合條件的項目')"));
  await click('緊急');await until(async()=>JSON.stringify(await refs())===JSON.stringify(['QUICK-supply-open-normal']),'nonurgent search restored');await click('清除條件');
 });
 await check(`${audience}-advanced-urgent-and-shortcut-share-one-state`,async()=>{
  if(!await evaluate("document.querySelector('.tracking-all-filters').open"))await nodeClick("document.querySelector('.tracking-all-filters>summary')");
  if(!await evaluate("document.querySelector('[aria-label=\"緊急篩選內容\"]').parentElement.open"))await nodeClick("document.querySelector('[aria-label=\"緊急篩選內容\"]')");
  await nodeClick("[...document.querySelectorAll('[aria-label=\"緊急多選\"] label')].find(n=>n.textContent==='是').querySelector('input')");await until(async()=>await pressed()==='true','advanced selection activates shortcut');
  await nodeClick("document.querySelector('[aria-label=\"緊急多選\"] button')");await until(async()=>await pressed()==='false','cleared field deactivates shortcut');
  const referenceSummary="document.querySelector('[aria-label=\"申請單號(材料或工程)篩選內容\"]')";
  if(!await evaluate(`(${referenceSummary}).parentElement.open`))await nodeClick(referenceSummary);
  const field="[...document.querySelectorAll('[aria-label=\"申請單號(材料或工程)多選\"] label')].find(n=>n.textContent==='QUICK-supply-open-normal').querySelector('input')";
  await nodeClick(field);await until(async()=>JSON.stringify(await refs())===JSON.stringify(['QUICK-supply-open-normal']),'reference field precondition');
  await click('緊急');assert.deepEqual(await refs(),[]);assert.equal(await evaluate(`(${field}).checked`),true);await click('緊急');await until(async()=>JSON.stringify(await refs())===JSON.stringify(['QUICK-supply-open-normal']),'other field retained');await click('清除條件');
  await nodeClick("document.querySelector('.tracking-all-filters>summary')");
 });
 await check(`${audience}-urgent-toggle-desktop-mobile-placement-and-visible-state`,async()=>{
  await fill('[aria-label="搜尋跟蹤"]','QUICK-');
  for(const width of [2880,1440,390]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
   for(const active of [false,true]){
    if((await pressed()==='true')!==active)await click('緊急');await evaluate('window.scrollTo(0,0)');await evaluate('document.fonts.ready');const g={phase:active?'active':'inactive',...await measure()};geometry.push(g);fs.writeFileSync(path.join(output,'urgent-geometry.json'),JSON.stringify(geometry,null,2));
    assert.ok(g.scroll<=g.viewport+1,'no page overflow');assert.ok(g.urgent.x>=g.search.right&&g.urgent.right<=g.viewport,'button follows search/clear');assert.ok(g.urgent.width>0&&g.urgent.height>0);assert.ok(Math.abs(g.urgent.height-g.clear.height)<1,'reuse the entry-specific compact button height');assert.ok(g.style.weight>=700);
    if(width>700){assert.ok(g.toolbar.x>=g.urgent.right,'selected toolbar is shifted right');assert.ok(g.urgent.y<g.search.bottom&&g.urgent.bottom>g.search.y,'same compact action row');}else assert.ok(g.toolbar.y>=g.urgent.bottom,'mobile toolbar wraps below without overlapping');
    if(active){assert.equal(g.style.color,'rgb(255, 255, 255)');assert.equal(g.style.background,'rgb(180, 35, 24)');}else assert.equal(g.style.color,'rgb(180, 35, 24)');
    await screen(`urgent-${active?'active':'inactive'}-${width}`);
   }
  }
  fs.writeFileSync(path.join(output,'urgent-geometry.json'),JSON.stringify(geometry,null,2));
 });
 await check(`${audience}-urgent-filter-not-on-statistics-and-no-business-writes`,async()=>{
  await click('統計資訊');assert.equal(await evaluate("document.querySelectorAll('.tracking-search-actions').length"),0);await tab('未送船清單');assert.equal(await pressed(),'false','returning through a list tab keeps the existing clear-filter rule');
  assert.deepEqual(await qa.read(),business,'filtering leaves all authoritative business data unchanged');assert.equal(writeCount(),writesBefore,'no business submit RPC');
 });
}

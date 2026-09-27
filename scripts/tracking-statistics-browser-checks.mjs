import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';

// Real mounted App/public entry, actual native SQL; fixtures are isolated setup.
export async function statisticsChecks(c) {
 const {qa,evaluate,call,click,nodeClick,fill,until,screen,check,output,audience}=c;
 const tab=label=>nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);
 const input=async(label,value)=>{await evaluate(`(()=>{const n=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
 const choose=async(label,value)=>{await evaluate(`(()=>{const n=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(()=>evaluate(`document.querySelector('[aria-label="${label}"]').value===${JSON.stringify(value)}`),'select '+label);};
 const keys={'申請數':'total','有效項目':'effective','已完成':'completed','未完成':'incomplete','取消':'cancelled','急件總數':'urgent','急件取消':'urgentCancelled','延遲數':'delayed','延遲可判定':'delayEligible'};
 const metric=key=>evaluate(`(()=>{const n=document.querySelector('[aria-label="統計摘要"] [data-stat="${keys[key]||key}"]');return n?Number(n.textContent):null;})()`);
 const ready=()=>until(async()=>await metric('申請數')!==null,'confirmed statistics ready');
 const scope=async(kind,value='')=>{await choose('統計範圍',JSON.stringify({kind,value}));await ready();};
 const noDetails=()=>evaluate("document.querySelectorAll('.tracking-stat-details,[data-stat-id],.tracking-stat-number,.tracking-stat-detail-heading').length===0");
 const isRead=({name})=>audience==='ship'?name==='read_ship_dynamics_tracking_statistics_public_v1':name==='read_ship_dynamics_record_scopes_v2';
 await check('statistics-confirmed-empty-vessel-is-zero-not-unavailable',async()=>{
  const baseline=await qa.read();assert.equal((baseline.payload.trackingItems||[]).filter(r=>r.vesselId==='qa-v2').length,0);
  await click('統計資訊');await choose('跟蹤船舶','qa-v2');await ready();assert.equal(await metric('申請數'),0);assert.ok(await noDetails());assert.equal(await evaluate("document.querySelectorAll('.tracking-stat-chart').length"),3);
  if(audience==='ship'){await click('讀取最新資料');await until(()=>evaluate("[...document.querySelectorAll('.ship-portal-header button')].some(n=>n.innerText==='讀取最新資料'&&!n.disabled)"),'manual read completed');await ready();assert.equal(await metric('申請數'),0);}
  assert.deepEqual(await qa.read(),baseline);await screen('statistics-confirmed-empty');await choose('跟蹤船舶','qa-v1');await ready();await tab('未送船清單');
 });
 const now='2026-09-25T00:00:00.000Z';
 const row=(id,patch={})=>({id:'stat-'+id,vesselId:'qa-v1',kind:'supply',requestType:'spares',referenceNo:'STAT-'+id,description:'完整統計來源 '+id,applicationDate:'2026-09-15',urgency:'normal',deliveryStatus:'not-delivered',isClosed:false,expectedDate:'2099-01-01',supplementalNotes:'',progress:'',createdBy:'qa-owner',updatedBy:'qa-owner',createdAt:now,updatedAt:now,statusLogs:[],events:[],...patch});
 const fixture=[row('a',{referenceNo:'STAT-SAME',applicationDate:'2026-09-01',urgency:'urgent',deliveryStatus:'delivered',actualDeliveryDate:'2026-09-21',expectedDate:'2026-09-20',description:'LONG-BEGIN '+('完整內容不得遺失，保留每一段。\n'.repeat(100))+' LONG-END',progress:'@NOT-FORMULA',supplementalNotes:'NOTES-END'}),row('b',{referenceNo:'STAT-SAME',applicationDate:'2026-09-30',urgency:'urgent',deliveryStatus:'partially-delivered',expectedDate:'2020-01-01'}),row('c',{urgency:'urgent',isClosed:true,closureOutcome:'cancelled'}),row('d',{requestType:'semiannual-materials',deliveryStatus:'delivered',actualDeliveryDate:'2026-09-20',expectedDate:'2026-09-20'}),row('e',{requestType:'temporary-materials',isClosed:true,closureOutcome:'completed'}),row('f',{kind:'engineering',requestType:'repair',completionDate:'2026-09-20',expectedDate:'2026-09-19'}),row('g',{kind:'engineering',requestType:'drydock',completionDate:''}),row('legacy',{requestType:undefined,expectedDate:''}),row('foreign',{vesselId:'qa-v2',urgency:'urgent'}),row('outside',{applicationDate:'2026-08-31',urgency:'urgent'}),...Array.from({length:34},(_,i)=>row('bulk-'+String(i).padStart(2,'0'),{applicationDate:'2026-01-15',requestType:'temporary-materials'}))];

 const beforeSetup=await qa.read();
 await qa.db.transaction(async tx=>{
  // Fixture writes must advance record versions, like the real writer. Otherwise
  // the unchanged-version delta reader correctly retains the old vessel catalog.
  const revision=beforeSetup.revision+1;
  await tx.query("update ship_dynamics_record_workspaces set revision=$2,root=jsonb_set(root,'{revision}',to_jsonb($2::integer)) where workspace_key=$1",[qa.workspace,revision]);
  await tx.query("update ship_dynamics_records set revision=$2,value=value||jsonb_build_object('shipType',case when entity_id='qa-v1' then '巴拿馬散' else '成品油' end,'fleetCategory',case when entity_id='qa-v1' then 'bulk fleet' else 'tanker fleet' end) where workspace_key=$1 and collection='vessels'",[qa.workspace,revision]);
  for(const item of fixture)await tx.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,'trackingItems',$2,$3::jsonb,$4)",[qa.workspace,item.id,JSON.stringify(item),revision]);
  await tx.query("update ship_dynamics_record_collections set ids=$2::jsonb where workspace_key=$1 and collection='trackingItems'",[qa.workspace,JSON.stringify([...(beforeSetup.payload.trackingItems||[]).map(r=>r.id),...fixture.map(r=>r.id)])]);
 });
 const business=await qa.read(),v1Total=business.payload.trackingItems.filter(r=>r.vesselId==='qa-v1').length,writesBefore=qa.metrics.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'||m.rpc==='ship_dynamics_tracking_public_v1'&&m.action==='submit').length;
 await check('statistics-role-order-full-vessel-not-list-page-or-selection',async()=>{
  const tabs=await evaluate("[...document.querySelectorAll('.tracking-tabs [role=tab]')].map(n=>n.textContent.trim())");assert.equal(tabs.length,6);assert.equal(tabs[audience==='ship'?5:0],'統計資訊');
  await fill('[aria-label="搜尋跟蹤"]','NO-MATCH');await click('統計資訊');
  // A changed catalog correctly invalidates a pre-read shore cohort; explicit reread uses its fresh metadata.
  await until(()=>evaluate("Boolean(document.querySelector('[data-stat=total]'))||document.querySelector('.tracking-statistics').innerText.includes('未能讀取已確認')"),'first capture settled');
  if(await metric('申請數')===null)await click('重讀統計');await ready();assert.equal(await metric('申請數'),v1Total);assert.ok(v1Total>30);assert.ok(await noDetails());
  const reads=qa.metrics.length;await new Promise(r=>setTimeout(r,450));assert.equal(qa.metrics.length,reads,'no capture/publication loop');
 });
 await check('statistics-all-bulker-tanker-type-and-single-scopes',async()=>{
  await scope('all');assert.equal(await metric('申請數'),v1Total+1);
  await scope('fleet','bulk fleet');assert.equal(await metric('申請數'),v1Total);
  await scope('fleet','tanker fleet');assert.equal(await metric('申請數'),1);
  await scope('type','成品油');assert.equal(await metric('申請數'),1);
  await scope('type','巴拿馬散');assert.equal(await metric('申請數'),v1Total);
  await scope('vessel','qa-v2');assert.equal(await metric('申請數'),1);
  await scope('vessel','qa-v1');assert.equal(await evaluate("document.querySelector('[aria-label=跟蹤船舶]').value"),'qa-v1','statistics scopes must not switch the editing vessel');
 });
 if(audience==='ship')await check('statistics-manual-and-automatic-refresh-preserve-query-and-scope',async()=>{
  await scope('all');await choose('統計類型','spares');await choose('統計急件','urgent');await ready();const total=await metric('申請數');
  await click('讀取最新資料');await until(()=>evaluate("[...document.querySelectorAll('.ship-portal-header button')].some(n=>n.innerText==='讀取最新資料'&&!n.disabled)"),'manual refresh settled');await ready();assert.equal(await metric('申請數'),total);
  const count=()=>qa.metrics.filter(m=>m.rpc==='ship_dynamics_tracking_public_v1'&&m.action==='read').length,reads=count();await until(()=>count()>reads,'actual 30-second automatic read',35000);await ready();assert.equal(await metric('申請數'),total);
  assert.equal(await evaluate("document.querySelector('[aria-label=統計範圍]').value"),JSON.stringify({kind:'all',value:''}));assert.equal(await evaluate("document.querySelector('[aria-label=統計急件]').value"),'urgent');assert.ok(count()-reads<=2);await click('重設統計條件');await ready();
 });
 await check('statistics-period-type-urgency-weighted-rates-no-details',async()=>{
  await scope('all');await input('統計開始日期','2026-09-01');await input('統計結束日期','2026-09-30');await choose('統計類型','spares');await choose('統計急件','urgent');await ready();
  assert.equal(await metric('申請數'),4);assert.equal(await metric('有效項目'),3);assert.equal(await metric('已完成'),1);assert.equal(await metric('未完成'),2);assert.equal(await metric('取消'),1);assert.equal(await metric('延遲數'),2);assert.equal(await metric('延遲可判定'),2);assert.equal(await evaluate("document.querySelector('[data-stat=completionRate]').innerText"),'33.3%');assert.ok(await noDetails());
  await scope('vessel','qa-v1');assert.equal(await metric('申請數'),3);assert.equal(await evaluate("document.querySelector('[data-stat=completionRate]').innerText"),'50.0%');
 });
 await check('statistics-empty-reset-shortcuts-and-six-classification-rows',async()=>{
  await input('統計開始日期','2098-01-01');await input('統計結束日期','2098-12-31');await ready();assert.equal(await metric('申請數'),0);assert.equal(await evaluate("document.querySelector('[data-stat=completionRate]').innerText"),'—');await click('重設統計條件');await ready();assert.equal(await metric('申請數'),v1Total);assert.equal(await evaluate("document.querySelectorAll('[aria-label=統計分類表] tbody tr').length"),6);
  await click('本月');await ready();assert.match(await evaluate("document.querySelector('[aria-label=統計開始日期]').value"),/^\d{4}-\d{2}-01$/);await click('今年');await ready();assert.match(await evaluate("document.querySelector('[aria-label=統計開始日期]').value"),/^\d{4}-01-01$/);await click('全部期間');await ready();
  await input('統計開始日期','2026-10-01');await input('統計結束日期','2026-09-01');await until(()=>evaluate("document.querySelector('.tracking-statistics').innerText.includes('開始日期不能晚於結束日期')"),'invalid date range');assert.equal(await metric('申請數'),null);await click('重設統計條件');await ready();
 });
 await check('statistics-desktop-mobile-charts-visible-without-page-overflow',async()=>{
  await scope('all');await evaluate('window.scrollTo(0,0)');await screen('statistics-desktop');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  const geometry=await evaluate("({viewport:innerWidth,width:document.documentElement.scrollWidth,charts:[...document.querySelectorAll('.tracking-stat-chart')].map(n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})),scroll:document.querySelector('.tracking-stat-scroll').scrollWidth>document.querySelector('.tracking-stat-scroll').clientWidth})");assert.ok(geometry.width<=geometry.viewport+1);assert.equal(geometry.charts.length,3);assert.ok(geometry.charts.every(r=>r.width>200&&r.height>80&&r.x+r.width<=391));assert.ok(geometry.scroll);fs.writeFileSync(path.join(output,'statistics-mobile-geometry.json'),JSON.stringify(geometry,null,2));await screen('statistics-mobile-top');await evaluate("document.querySelector('.tracking-stat-charts').scrollIntoView({block:'start'})");await screen('statistics-mobile-charts');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 });
 await check('statistics-real-xlsx-pdf-nondefault-fleet-summary-only',async()=>{
  await input('統計開始日期','2026-09-01');await input('統計結束日期','2026-09-30');await choose('統計類型','spares');await choose('統計急件','urgent');await ready();assert.equal(await metric('申請數'),4);
  const downloads=path.join(output,'statistics-downloads');fs.mkdirSync(downloads);await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads},null);await click('統計 Excel');let file;await until(()=>{file=fs.readdirSync(downloads).find(n=>n.endsWith('.xlsx'));return Boolean(file);},'real statistics XLSX');const book=new ExcelJS.Workbook();await book.xlsx.readFile(path.join(downloads,file));assert.deepEqual(book.worksheets.map(s=>s.name),['統計摘要','分類統計']);const summary=book.getWorksheet('統計摘要'),content=JSON.stringify(book.worksheets.map(s=>s.getSheetValues()));assert.ok(content.includes('全船隊')&&content.includes('2026-09-01')&&content.includes('急件'));assert.ok(!content.includes('LONG-BEGIN')&&!content.includes('stat-a'));const entries=Object.fromEntries(summary.getRows(5,summary.rowCount-4).map(r=>[r.getCell(1).text,r.getCell(2).text]));assert.equal(entries['申請數'],'4');assert.equal(entries['完成率'],'33.3%');
  await click('統計 PDF');await until(()=>evaluate("Boolean(document.querySelector('.tracking-stat-report'))"),'statistics PDF preview');assert.equal(await evaluate("document.querySelectorAll('.tracking-stat-report .tracking-stat-chart').length"),3);assert.ok(!await evaluate("document.querySelector('.tracking-stat-report').innerText.includes('LONG-BEGIN')"));
  await evaluate("window.__statPrint=window.print;window.__statPrinted=false;window.print=()=>{window.__statPrinted=true}");await click('列印統計 PDF');await until(()=>evaluate('window.__statPrinted'),'production print handler');await call('Emulation.setEmulatedMedia',{media:'print'});await evaluate('document.fonts.ready');
  const geometry=await evaluate("(()=>{const paper=document.querySelector('.tracking-stat-report .tracking-report-paper'),p=paper.getBoundingClientRect();return [...paper.querySelectorAll('table,.tracking-stat-charts')].map(n=>{const r=n.getBoundingClientRect();return {right:r.right,parentRight:p.right,client:n.clientWidth,scroll:n.scrollWidth}})})()");assert.ok(geometry.every(g=>g.right<=g.parentRight+1&&g.scroll<=g.client+1));
  const rendered=await call('Page.printToPDF',{preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false}),pdf=path.join(output,'statistics-fleet.pdf');fs.writeFileSync(pdf,Buffer.from(rendered.data,'base64'));
  const parsed=spawnSync('python3',['-c',"import sys,json,unicodedata,pathlib;from pypdf import PdfReader;import pypdfium2 as pdfium;p=pathlib.Path(sys.argv[1]);r=PdfReader(p);t=unicodedata.normalize('NFKC',''.join(x.extract_text() for x in r.pages));assert all(x in t for x in ['全船隊','完成狀態','類型件數','延遲狀態','2026-09-01','2026-09-30','33.3%']);assert all(x not in t for x in ['stat-a','LONG-BEGIN','LONG-END','STAT-SAME']);d=pdfium.PdfDocument(str(p));[d[i].render(scale=1.2).to_pil().save(str(p.with_name('statistics-pdf-page-'+str(i+1)+'.png'))) for i in range(len(d))];print(json.dumps({'pages':len(r.pages),'summaryOnly':True,'allPagesRasterized':True}))",pdf],{encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);fs.writeFileSync(path.join(output,'statistics-export-verification.json'),JSON.stringify({xlsx:path.join(downloads,file),pdf,pdfCheck:JSON.parse(parsed.stdout),geometry,cohort:4,completionRate:'33.3%'},null,2));
  await evaluate("window.dispatchEvent(new Event('afterprint'));window.print=window.__statPrint;delete window.__statPrint");await call('Emulation.setEmulatedMedia',{media:''});await click('關閉統計 PDF');
 });
 await check('statistics-return-list-draft-navigation-retention-and-no-writes',async()=>{
  await tab('未送船清單');await click('清除條件');assert.ok(await evaluate("Boolean(document.querySelector('.tracking-table'))"));
  await click('＋ 新增／批量新增');await fill('[aria-label="第 1 筆 內容摘要/工程內容"]','統計切換保留的未送出草稿');await click('統計資訊');await until(()=>evaluate("Boolean(document.querySelector('.tracking-navigation'))"),'original navigation guard');await click('取消切換');assert.equal(await evaluate("document.querySelector('[aria-label=\"第 1 筆 內容摘要/工程內容\"]').value"),'統計切換保留的未送出草稿');await click('統計資訊');await click('保留草稿並繼續');await ready();assert.equal(await metric('申請數'),v1Total);await click('恢復本船未送出草稿');assert.equal(await evaluate("document.querySelector('[aria-label=\"第 1 筆 內容摘要/工程內容\"]').value"),'統計切換保留的未送出草稿');assert.equal(await evaluate("document.querySelectorAll('[aria-label=統計摘要],.tracking-stat-exports').length"),0);await click('取消');await click('捨棄草稿並關閉');await ready();assert.deepEqual(await qa.read(),business);assert.equal(qa.metrics.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'||m.rpc==='ship_dynamics_tracking_public_v1'&&m.action==='submit').length,writesBefore);if(audience==='ship')assert.ok(!await evaluate("document.querySelector('.tracking-page').innerText.includes('要事')"));
 });
 await check('statistics-held-read-old-scope-response-cannot-publish',async()=>{
  await scope('all');let held=false,release;const barrier=new Promise(resolve=>{release=resolve;});qa.setRecordFault({after:async event=>{if(isRead(event)&&!held){held=true;await barrier;}return false;}});
  try{await click('重讀統計');await until(()=>held,'actual SQL read held');assert.equal(await metric('申請數'),null);assert.equal(await evaluate("document.querySelectorAll('.tracking-stat-exports').length"),0);await choose('跟蹤船舶','qa-v2');await ready();assert.equal(await metric('申請數'),1);release();await new Promise(r=>setTimeout(r,150));assert.equal(await metric('申請數'),1);}finally{release();qa.setRecordFault(null);}await choose('跟蹤船舶','qa-v1');await ready();
 });
 await check('statistics-read-failure-not-zero-retry-recovers',async()=>{
  let dropped=0;c.expectReadFailure?.(true);qa.setRecordFault({after:async event=>{if(isRead(event)){dropped++;return true;}return false;}});
  try{await click('重讀統計');await until(()=>evaluate("/未能讀取已確認|統計讀取失敗/.test(document.querySelector('.tracking-statistics').innerText)"),'read failure visible');assert.ok(dropped>0);assert.equal(await metric('申請數'),null);assert.equal(await evaluate("document.querySelectorAll('.tracking-stat-exports').length"),0);}finally{qa.setRecordFault(null);c.expectReadFailure?.(false);}await click('重讀統計');await ready();assert.equal(await metric('申請數'),v1Total);
 });
 await check('statistics-pending-print-scope-fence-blocks-stale-export',async()=>{
  await click('統計 PDF');await until(()=>evaluate("Boolean(document.querySelector('.tracking-stat-report'))"),'preview');await evaluate("window.__savedStatPrint=window.print;window.__stalePrinted=false;window.print=()=>{window.__stalePrinted=true};window.__fontReadyDescriptor=Object.getOwnPropertyDescriptor(document.fonts,'ready');Object.defineProperty(document.fonts,'ready',{configurable:true,value:new Promise(r=>{window.__finishFonts=r})})");
  try{await click('列印統計 PDF');await scope('fleet','tanker fleet');await evaluate('window.__finishFonts()');await new Promise(r=>setTimeout(r,100));assert.equal(await evaluate('window.__stalePrinted'),false);assert.equal(await evaluate("document.body.classList.contains('printing-tracking-report')"),false);}finally{await evaluate("window.print=window.__savedStatPrint;if(window.__fontReadyDescriptor)Object.defineProperty(document.fonts,'ready',window.__fontReadyDescriptor);else delete document.fonts.ready;delete window.__finishFonts");}
  await scope('vessel','qa-v1');assert.deepEqual(await qa.read(),business);await tab('未送船清單');await choose('跟蹤船舶','qa-v2');await until(()=>evaluate("Boolean(document.querySelector('.tracking-table'))"),'list remains selected');assert.equal(await evaluate("document.querySelector('[role=tab][aria-selected=true]').innerText.startsWith('未送船清單')"),true);await choose('跟蹤船舶','qa-v1');
 });
}

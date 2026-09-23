import assert from 'node:assert/strict';
import fs from 'node:fs';

import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installVesselHistory,seedVesselHistory,vesselHistoryRpc} from './itinerary-vessel-history-fixture.mjs';
import {fillNativeDate} from './browser-native-date-input.mjs';

const evidenceRoot=process.env.QA_EVIDENCE_ROOT;
assert.ok(evidenceRoot&&path.isAbsolute(evidenceRoot),'Explicit external QA_EVIDENCE_ROOT required');
fs.mkdirSync(evidenceRoot,{recursive:true});
const output=fs.mkdtempSync(path.join(evidenceRoot,'ship-vessel-history-'));
const profile=path.join(output,'chrome-profile');
const evidence={label:'真實原始 App UI＋測試資料＋本機 PGlite；非正式 Supabase',status:'RUNNING',cases:[],errors:[],externalRequests:[],geometry:[],head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};
const files=['src/ReportDailyHistories.tsx','src/ItineraryDailyReportPreview.tsx','src/itineraryDailyReports.ts','src/itineraryDailyReportPdf.ts','src/styles.css','scripts/record-storage-local-qa.mjs','scripts/itinerary-vessel-history-fixture.mjs','scripts/verify-itinerary-vessel-history-browser.mjs','supabase/migrations/20260923160000_itinerary_vessel_history.sql','supabase/migrations/20260923170000_itinerary_vessel_history_summary.sql','src/itineraryVesselHistorySummary.ts'];
evidence.inputs=Object.fromEntries(files.map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const save=()=>fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(40);}throw new Error('QA timeout: '+label);};
let qa,browser,ws,sessionId,id=0,failure,holdPredicate,held;
const pending=new Map();
const call=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method));},15000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const text=()=>evaluate("document.body?.innerText||''");
const button=(label,scope='document')=>`[...${scope}.querySelectorAll('button')].find(n=>n.innerText.trim()===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled)`;
const clickNode=async expr=>{const pos=await evaluate(`(()=>{const n=${expr};if(!n||n.disabled||!n.getClientRects().length)throw Error('visible enabled target missing');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...pos});};
const click=async(label,scope)=>{const expr=button(label,scope);await until(()=>evaluate(`Boolean(${expr})`),'button '+label);await clickNode(expr);};
const press=async key=>{const code={Home:36,ArrowDown:40,Enter:13,Escape:27,Tab:9}[key];for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code,...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{})});};
const fill=async(selector,value)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)throw Error('input missing');n.focus();n.select();})()`);await call('Input.insertText',{text:value});};
const selectVessel=async value=>{const n="document.querySelector('[aria-label=單船歷程船舶]')";await until(()=>evaluate(`Boolean(${n})&&!${n}.disabled`),'ready vessel selector');const index=await evaluate(`(()=>{const n=${n};n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(index>=0);await press('Home');for(let i=0;i<index;i++)await press('ArrowDown');await press('Enter');await press('Escape');await press('Tab');assert.equal(await evaluate(`${n}.value`),value);};
const panel="document.querySelector('.itinerary-daily-history-panel')";
const count=()=>evaluate(`${panel}?.querySelectorAll('.saved-report').length`);
const ready=async(n)=>until(async()=>await count()===n&&await evaluate(`!${panel}.querySelector('.daily-report-history-error')&&!${panel}.querySelector('[aria-busy=true]')`),'history rows '+n);
const screen=async name=>{await evaluate("document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))");fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
const summaryGeometry=async()=>{
 const g=await evaluate(`(()=>{const card=${panel}.querySelector('.saved-report');const summary=card.querySelector('.itinerary-vessel-history-summary');const cells=[...summary.children];return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,cardHeight:card.getBoundingClientRect().height,summaryTop:summary.getBoundingClientRect().top,headerBottom:Math.max(...[card.firstElementChild,card.querySelector('button')].map(n=>n.getBoundingClientRect().bottom)),fields:cells.map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height,overflow:n.scrollWidth>n.clientWidth+1,visible:getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden'};})};})()`);
 evidence.geometry.push(g);assert.ok(g.scrollWidth<=g.width);assert.ok(g.summaryTop>=g.headerBottom);assert.equal(g.fields.length,11);assert.ok(g.fields.every(f=>f.visible&&f.width>0&&f.height>0&&!f.overflow));
};
const check=async(name,fn)=>{await fn();evidence.cases.push({name,status:'PASS'});save();};
const release=async()=>{assert.ok(held);const target=held;held=null;await call('Fetch.continueResponse',{requestId:target.requestId});await wait(180);};
try{
 qa=await createRecordStorageLocalQa({browserAuthority:true});
 const {installMorningOracle,schedulerSql}=await import('./record-daily-morning-local-fixture.mjs');
 await installMorningOracle(qa.db);await qa.db.exec(fs.readFileSync(schedulerSql,'utf8'));
 for(const file of ['supabase/migrations/20260904161000_appdata_compact_ack_receipts.sql','supabase/migrations/20260817143000_data_management_storage.sql','supabase/migrations/20260818154500_data_management_prune_batch_limit.sql','supabase/normalized-legacy-cutover.sql','supabase/development/20260911_legacy_report_workspace_binding.sql','supabase/development/20260911_business_quiescence.sql','supabase/development/20260911_paused_record_legacy_transfer.sql','supabase/development/20260911_source_authority_publication.sql','supabase/development/20260912_browser_source_authority.sql'])await qa.db.exec(fs.readFileSync(file,'utf8'));
 await installVesselHistory(qa.db);await seedVesselHistory(qa,{overview:true});
 assert.equal((await fetch(qa.origin+'/__qa/health')).status,200);
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--explicitly-allowed-ports=${new URL(qa.origin).port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')),'Chrome ready');
 const [port,socket]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);ws=new WebSocket(`ws://127.0.0.1:${port}${socket}`);
 await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  void(async()=>{
   if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){const allowed=m.params.type==='confirm'&&m.params.message.startsWith('同步最新會保留本機修改');if(!allowed)evidence.errors.push('Unexpected dialog: '+m.params.message);await call('Page.handleJavaScriptDialog',{accept:allowed},m.sessionId);}
   if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url)&&new URL(m.params.request.url).origin!==qa.origin)evidence.externalRequests.push(new URL(m.params.request.url).origin);
   if(m.method==='Fetch.requestPaused'){const body=JSON.parse(m.params.request.postData||'{}');if(holdPredicate?.(body,m.params.request.url)){holdPredicate=null;held=m.params;return;}await call('Fetch.continueResponse',{requestId:m.params.requestId},m.sessionId);}
  })().catch(e=>evidence.errors.push(e.message));
 });
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 for(const method of ['Page.enable','Runtime.enable','Network.enable'])await call(method);
 await call('Network.setBlockedURLs',{urls:['https://*','http://*.supabase.co/*']});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Fetch.enable',{patterns:[{urlPattern:`${qa.origin}/rest/v1/rpc/${vesselHistoryRpc}`,requestStage:'Response'},{urlPattern:`${qa.origin}/rest/v1/rpc/sd_itinerary_record_report_load_v1`,requestStage:'Response'}]});
 await call('Page.navigate',{url:qa.origin});
 await until(async()=>(await text()).includes('請輸入管理者設定的進站密碼。'),'site gate');await fill('input[type=password]',qa.password);await click('進入系統');
 await until(async()=>(await text()).includes('人員登入／切換'),'identity gate');await fill('input[type=password]',qa.password);await click('登入');
 await until(async()=>(await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'logged in');await click('同步最新（安全合併）');
 await until(async()=>!(await text()).includes('身份、權限或船舶範圍已變更，請同步最新資料'),'authority ready');
 await until(()=>evaluate("Boolean(document.querySelector('[aria-label=關閉保存提醒]'))"),'sync notification');await clickNode("document.querySelector('[aria-label=關閉保存提醒]')");
 const before=await qa.itinerarySnapshot(),recordsBefore=await qa.read(),start=qa.metrics.length;
 await check('original-report-center-entry-and-neighbor-retention',async()=>{
  await click('報告中心');await until(()=>evaluate(`Boolean(${button('單船歷程')})`),'real fleet entry');
  await evaluate("void(window.__qaMorning=document.querySelector('.morning-daily-history-panel'))");await click('單船歷程');
  await until(()=>evaluate("document.querySelector('[aria-label=單船歷程船舶]')?.options.length===3"),'SQL catalogue');assert.equal(await evaluate("window.__qaMorning===document.querySelector('.morning-daily-history-panel')"),true);
  assert.match(await text(),/請選擇船舶，查看每天的保存歷史/);await selectVessel('qa-v1');await ready(32);
  assert.equal(await evaluate(`${panel}.querySelectorAll('.itinerary-report-date-group').length`),30);
  assert.equal(await evaluate(`${panel}.querySelector('.itinerary-report-date-group').querySelectorAll('.saved-report').length`),3);
  const rowText=await evaluate(`${panel}.querySelector('.daily-report-history-list').innerText`);
  assert.doesNotMatch(rowText,/09:00 自動快照/,'single-vessel entries must omit the redundant scheduled heading');
  assert.match(rowText,/2026\/09\/04 09:00/,'the actual saved timestamp must remain');
  assert.match(rowText,/手動保存快照/,'manual record labels remain unchanged');
 });
 await check('frozen-card-first-row-and-separate-second-row-without-detail-download',async()=>{
  const cards=await evaluate(`[...${panel}.querySelectorAll('.saved-report')].slice(0,3).map(card=>[...card.querySelectorAll('.itinerary-vessel-history-summary>div')].map(field=>({label:field.querySelector('dt').textContent,value:field.querySelector('dd').textContent})))`);
  assert.equal(cards[0].length,11,'each daily card must render the requested frozen summary fields');
  assert.deepEqual(cards[0].map(f=>f.label),['上一港','目前位置','目前航行狀態','目前船舶狀態','Voy No.','Next Port & Dock Name','ETA','ETB','ETD','後續港','後續港 ETA']);
  assert.deepEqual(cards[0].slice(0,9).map(f=>f.value),['QA FORMAL BUSAN','QA SAVED ANCHORAGE','拋錨','drydock/repair、bunker','HIST-001','QA FORMAL KAOHSIUNG','2026-08-30 08:00 LT (UTC+8)','2026-08-30 10:00 LT (UTC+9)','2026-08-30 20:30 LT (UTC-3:30)']);
  assert.match(cards[0][9].value,/^QA SUBSEQUENT PORT/);assert.equal(cards[0][10].value,'2026-09-15 05:30 LT (UTC+5:30)');
  assert.deepEqual(cards[1].slice(-2).map(f=>f.value),['TBA','TBA']);
  assert.deepEqual(cards[1].slice(1,4).map(f=>f.value),['—','—','—']);
  assert.doesNotMatch(await evaluate(`${panel}.querySelector('.daily-report-history-list').innerText`),/WRONG SECOND|QA THIRD|LIVE PORT|ALTERNATIVE/);
  assert.equal(qa.metrics.slice(start).filter(m=>m.rpc===vesselHistoryRpc&&m.vesselId==='qa-v1').length,1,'one compact page for the selected vessel, no per-card detail requests');
 });
 await check('pagination-and-native-date-location',async()=>{
  await click('下一頁 →',panel);await ready(5);assert.match(await evaluate(`${panel}.innerText`),/第 2／2 頁/);
  await click('← 上一頁',panel);await ready(32);
  await fillNativeDate(evaluate,call,'[aria-label=單船歷程日期]','2026-08-01');await click('定位日期',panel);await ready(5);await until(()=>evaluate(`${panel}.innerText.includes('已定位 2026-08-01')`),'located old date');
  await fillNativeDate(evaluate,call,'[aria-label=單船歷程日期]','1900-01-01');await click('定位日期',panel);await until(()=>evaluate(`${panel}.innerText.includes('所選日期沒有這艘船')`),'missing date notice');
 });
 await check('sparse-vessel-and-empty-formal-document',async()=>{
  await selectVessel('qa-v2');await ready(5);assert.match(await evaluate(`${panel}.innerText`),/共 3 天/);assert.doesNotMatch(await evaluate(`${panel}.querySelector('.daily-report-history-list').innerText`),/QA RENAMED ONE/);
  assert.deepEqual(await evaluate(`[...${panel}.querySelector('.itinerary-vessel-history-summary').querySelectorAll('dd')].map(n=>n.textContent)`),[...Array(9).fill('—'),'TBA','TBA']);
  await click('檢視行程',panel);await until(()=>evaluate("Boolean(document.querySelector('.itinerary-daily-report-modal'))"),'empty vessel preview');assert.doesNotMatch(await evaluate("document.querySelector('.itinerary-daily-report-modal').innerText"),/QA FORMAL KAOHSIUNG|QA RENAMED ONE/);await click('關閉');
 });
 await check('desktop-scoped-frozen-preview-and-real-pdf',async()=>{
  await selectVessel('qa-v1');await ready(32);await evaluate(`${panel}.scrollIntoView({block:'start'});window.scrollBy(0,-100)`);await screen('desktop-history');await summaryGeometry();await click('檢視行程',panel);
  await until(()=>evaluate("document.querySelector('.itinerary-daily-report-modal')?.innerText.includes('QA FORMAL KAOHSIUNG')"),'frozen scoped detail');
  const rendered=await evaluate("document.querySelector('.itinerary-daily-report-modal').innerText");assert.match(rendered,/QA RENAMED ONE｜單船歷程快照/);assert.doesNotMatch(rendered,/qa-v2|LIVE PORT|ALTERNATIVE/);await screen('desktop-preview');
  await evaluate("window.__qaOldTitle=document.title;window.print=()=>{window.__qaPrintTitle=document.title;}");await click('導出／列印 PDF');await until(()=>evaluate("typeof window.__qaPrintTitle==='string'"),'print callback after layout delay');
  evidence.pdfTitle=await evaluate('window.__qaPrintTitle');assert.match(evidence.pdfTitle,/單船歷程_QA RENAMED ONE_2026-09-04_130000_手動_R/);
  const pdf=await call('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});fs.writeFileSync(path.join(output,'single-vessel.pdf'),Buffer.from(pdf.data,'base64'));
  await evaluate("window.dispatchEvent(new Event('afterprint'))");assert.equal(await evaluate('document.title===window.__qaOldTitle'),true);await click('關閉');
 });
 await check('mobile-390px-history-and-preview-no-document-overflow',async()=>{
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});await evaluate(`${panel}.scrollIntoView({block:'start'});window.scrollBy(0,-100)`);await screen('mobile-history');await summaryGeometry();
  const g=await evaluate(`(()=>{const p=${panel}.getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,panel:{x:p.x,right:p.right}}})()`);evidence.geometry.push(g);assert.equal(g.width,390);assert.ok(g.scrollWidth<=390);assert.ok(g.panel.x>=0&&g.panel.right<=390);
  await click('檢視行程',panel);await until(()=>evaluate("Boolean(document.querySelector('.itinerary-daily-report-modal'))"),'mobile preview');await screen('mobile-preview');assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));await click('關閉');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 });
 await check('late-vessel-list-cannot-replace-successor-or-ABA-page',async()=>{
  await selectVessel('qa-v2');await ready(5);holdPredicate=b=>b.p_vessel_id==='qa-v1'&&!b.p_report_id;await selectVessel('qa-v1');await until(()=>held,'held real SQL list');await selectVessel('qa-v2');await ready(5);await release();assert.match(await evaluate(`${panel}.innerText`),/共 3 天/);
  holdPredicate=b=>b.p_vessel_id==='qa-v1'&&!b.p_report_id;await selectVessel('qa-v1');await until(()=>held,'held ABA A');await selectVessel('qa-v2');await ready(5);await selectVessel('qa-v1');await ready(32);await click('下一頁 →',panel);await ready(5);await release();assert.match(await evaluate(`${panel}.innerText`),/第 2／2 頁/);
 });
 await check('late-detail-after-switch-or-return-cannot-open-wrong-preview',async()=>{
  holdPredicate=b=>!!b.p_report_id;await click('檢視行程',panel);await until(()=>held,'held old detail');await selectVessel('qa-v2');await ready(5);await release();assert.equal(await evaluate("Boolean(document.querySelector('.itinerary-daily-report-modal'))"),false);
  holdPredicate=b=>!!b.p_report_id;await click('檢視行程',panel);await until(()=>held,'held detail on return');await click('返回全船記錄');await release();assert.equal(await evaluate("Boolean(document.querySelector('.itinerary-daily-report-modal'))"),false);
  assert.equal(await evaluate("window.__qaMorning===document.querySelector('.morning-daily-history-panel')"),true);
  holdPredicate=(b,url)=>url.endsWith('/sd_itinerary_record_report_load_v1');await click('檢視橫版 PDF',panel);await until(()=>held,'held fleet detail');await click('單船歷程');await release();assert.equal(await evaluate("Boolean(document.querySelector('.itinerary-daily-report-modal'))"),false);
 });
 await check('missing-migration-is-explicit-error-not-empty-or-legacy-fallback',async()=>{
  await click('返回全船記錄');await qa.db.exec('drop function public.sd_itinerary_record_report_vessel_history_v1(text,text,text,integer,date,bigint)');await click('單船歷程');
  await until(()=>evaluate(`${panel}.querySelector('[role=alert]')?.innerText.includes('尚未部署')`),'missing SQL message');assert.doesNotMatch(await evaluate(`${panel}.innerText`),/尚無每日 Itinerary 記錄/);await click('返回全船記錄');assert.ok(await count());await installVesselHistory(qa.db);
 });
 await check('read-only-ledgers-existing-documents-and-snapshot-save-untouched',async()=>{
  assert.deepEqual(await qa.itinerarySnapshot(),before);assert.deepEqual(await qa.read(),recordsBefore);
  assert.ok(qa.metrics.slice(start).some(m=>m.rpc===vesselHistoryRpc&&m.status==='SQL_OK'));assert.equal(qa.metrics.slice(start).some(m=>/^apply_|save_|delete_|sd_itinerary_record_report_save|sd_itinerary_record_report_delete/.test(m.rpc)),false);
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.externalRequests,[]);assert.equal(qa.metrics.some(m=>m.status==='UNSUPPORTED'),false);
 });
 evidence.status='PASS';
}catch(error){failure=error;evidence.status='FAIL';evidence.error=error.message;try{evidence.failureText=(await text()).slice(0,9000);await screen('failure');}catch{}}
finally{
 if(held){try{await release();}catch{}}
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null,'owned Chrome stopped',5000);}catch{browser.kill();}}
 try{if(qa)await qa.close();}catch(e){failure??=e;}
 try{if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));assert.ok(!browser||browser.exitCode!==null);evidence.cleanup={httpStopped:true,chromeStopped:true};}catch(e){failure??=e;evidence.cleanup={error:e.message};}
 evidence.metrics=qa?.metrics||[];if(!failure){try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
 if(failure)evidence.status='FAIL';save();console.log(JSON.stringify({status:evidence.status,output,cases:evidence.cases,error:evidence.error,cleanup:evidence.cleanup}));if(failure)process.exitCode=1;
}

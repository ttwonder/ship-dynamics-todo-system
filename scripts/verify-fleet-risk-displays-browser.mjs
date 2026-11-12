import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(process.cwd().toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'fleet-risk-displays-')),profile=path.join(output,'chrome');
const evidence={layer:'真實原始App UI＋合成PSC資料＋本機PGlite；非正式環境／官網查詢',cases:[],errors:[],riskReads:[],blockedExternal:[],output};
const at='2026-11-12T04:50:26.000Z',names=['FPMC S AMBER','FPMC B 105','FPMC 25','FPMC 26','FPMC B 201'];
const rows=[['FPMC S AMBER','9913743','HRS'],['FPMC B 105','9487677','SRS'],['FPMC 25','9433834','LRS']].map(([name,imo,risk])=>({name,imo,risk,status:'ok',retrievedAt:at,priority:'No Priority',companyName:'QA ONLY',companyImo:'0882415',windowFrom:null,windowTo:null,sourceUpdatedAt:null,sourceUrl:'https://apcis.tmou.org/public/'}));
const snapshot={id:'00000000-0000-4000-8000-000000000001',trigger:'manual',company:{name:'QA ONLY',imo:'0882415',performance:'Medium'},queryStartedAt:'2026-11-12T04:49:00.000Z',queryCompletedAt:at,rosterRetrievedAt:at,count:3,rows,coverage:{referenceCount:3,missingReferenceImos:[],addedReferenceImos:[]}};
const first={snapshot,attempt:null,serverTime:at,nextScheduledAt:'2026-11-12T23:00:00.000Z'};
const second=structuredClone(first);second.snapshot.id='00000000-0000-4000-8000-000000000002';second.snapshot.rows[0].risk='LRS';
let state=structuredClone(first),readFailure=false,holdRead=false,qa,browser,ws,sessionId,id=0,failure,forceCount=0;
const held=[],pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(60);}throw new Error('Timeout '+label);}
function call(method,params={},session=sessionId){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method));},20000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function activate(expression){await evaluate(`(()=>{const n=${expression};if(!n||n.disabled||!n.getClientRects().length)throw new Error('Missing enabled control');n.scrollIntoView({block:'center'});n.focus();})()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
const click=label=>activate(`[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(label)}&&n.getClientRects().length)`);
async function fill(selector,value){await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.focus();n.select();})()`);await call('Input.insertText',{text:value});}
const screen=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
const grades=selector=>evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(n=>n.dataset.risk)`);
const tick=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const fulfill=async(req)=>{
 const item={snapshotId:readFailure?null:state.snapshot?.id,status:readFailure?503:200};evidence.riskReads.push(item);
 await call('Fetch.fulfillRequest',{requestId:req.requestId,responseCode:item.status,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from(JSON.stringify(readFailure?{}:state)).toString('base64')},req.sessionId);item.replied=true;
};
async function printPdf(name){
 const before=await evaluate('window.__qaPrints||0');await click('導出／列印 PDF');
 await until(()=>evaluate(`(window.__qaPrints||0)===${before+1}&&document.body.classList.contains('printing-report')`),'original print action');
 await evaluate('document.fonts.ready');
 const pdf=await call('Page.printToPDF',{printBackground:false,preferCSSPageSize:true,landscape:true});
 fs.writeFileSync(path.join(output,name+'.pdf'),Buffer.from(pdf.data,'base64'));
 await evaluate("window.dispatchEvent(new Event('afterprint'))");
}
try{
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,shipInternalControlDownload:true,tracking:true,taskMember:true,scopedRead:true,hmr:false,performanceTrace:true,preparePerformanceFixture:async(initial,vite)=>{
   const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');const catalog=createInitialData().vessels;
   initial.vessels=names.map((name,index)=>{const v=structuredClone(catalog.find(v=>v.fullName===name));assert.ok(v);return {...v,id:'qa-v'+(index+1),assignedUserIds:[],delegateManagers:[],weeklyAttention:[],manualAttentionLevel:'',note:{...v.note,captain:'測試船長',chiefOfficer:'測試大副',chiefEngineer:'測試輪機長',firstEngineer:'測試大管輪',maintenanceOverview:'QA maintenance complete',statusList:[],recentDynamics:'QA current dynamics'},createdAt:'2026-01-01T00:00:00Z'};});
   const task={id:'qa-task-1',description:'QA morning task ONE',vesselId:'qa-v1',vesselIds:['qa-v1'],vesselScopeMode:'vessels',vesselTypeScopes:[],priority:'低',attentionDimension:'task',isAware:false,isAbnormal:false,isInternalControl:false,category:'其他',categories:['其他'],equipmentSubcategory:'',status:'處理中',expectedDate:'',reportDate:'2026-11-10',departments:[],ownerUserIds:[],isClosed:false,distributeToVessels:false,sourceType:'morning',createdBy:'qa-owner',updatedBy:'qa-owner',createdAt:'2026-11-10T00:00:00Z',updatedAt:'2026-11-10T00:00:00Z',statusLogs:[],vesselProgress:[]};
   initial.tasks=[task,{...structuredClone(task),id:'qa-task-2',description:'QA morning task TWO'}];
   initial.internalControlCases=[];initial.meetings=[];initial.agendaReports=[];
   const {upsertDailyMorningReport}=await vite.ssrLoadModule('/src/morningHistory.ts');
   const history=upsertDailyMorningReport(initial,{at:'2026-11-10T02:05:00Z',actorUserId:'qa-owner',source:'manual'});assert.equal(history.status,'saved');initial.agendaReports=history.data.agendaReports;
   initial.agendaReports[0].snapshot.vessels[0].note.recentDynamics='QA HISTORICAL FROZEN DYNAMICS';
 }});
 await (await import('./tracking-browser-fixture.mjs')).installTrackingBrowserMigrations(qa.db);
 await qa.db.exec(fs.readFileSync('supabase/migrations/20261006090000_ship_internal_control_download.sql','utf8'));
 assert.equal((await fetch(qa.origin+'/__qa/health')).status,200);
 browser=spawn(process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 let port,socketPath;await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch{return false;}},'owned Chrome');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return;}
   if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){evidence.errors.push('Unexpected dialog: '+m.params.message);void call('Page.handleJavaScriptDialog',{accept:false},m.sessionId);}
   if(m.method==='Fetch.requestPaused')void(async()=>{
     const request=m.params,url=new URL(request.request.url),req={requestId:request.requestId,sessionId:m.sessionId};
     if(url.origin!==qa.origin){evidence.blockedExternal.push(url.origin);await call('Fetch.failRequest',{requestId:req.requestId,errorReason:'BlockedByClient'},m.sessionId);return;}
     if(url.pathname==='/rest/v1/rpc/read_ship_fleet_risk_v1'){assert.equal(request.request.method,'POST');assert.equal(request.request.postData,'{}');if(holdRead)held.push(req);else await fulfill(req);return;}
     if(url.pathname==='/functions/v1/fleet-risk'){forceCount++;await call('Fetch.failRequest',{requestId:req.requestId,errorReason:'BlockedByClient'},m.sessionId);return;}
     await call('Fetch.continueRequest',{requestId:req.requestId},m.sessionId);
   })().catch(e=>evidence.errors.push(e.message));
 });
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 for(const method of ['Runtime.enable','Page.enable','Network.enable'])await call(method);
 await call('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
 await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.print=()=>{window.__qaPrints=(window.__qaPrints||0)+1;};'});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:qa.origin});
 await until(()=>evaluate("document.body?.innerText.includes('請輸入管理者設定的進站密碼。')"),'original site gate');assert.equal(evidence.riskReads.length,0);
 await fill('input[type=password]',qa.password);await click('進入系統');
 await until(()=>evaluate("document.body?.innerText.includes('人員登入／切換')"),'original personnel gate');assert.equal(evidence.riskReads.length,0);
 await fill('input[type=password]',qa.password);await click('登入');
 await until(()=>evaluate("document.querySelectorAll('.ship-card .fleet-risk-card-badge').length===5&&Boolean(document.querySelector('[data-dashboard-vessel-id=qa-v1] [data-risk=HRS]'))"),'original dashboard grades');
 assert.equal(evidence.riskReads.length,1,'One authenticated shared read, no per-card requests');
 const businessBefore=await qa.read(),metricsStart=qa.metrics.length;
 await activate("document.querySelector('[data-dashboard-vessel-id=qa-v1] .ship-name-link')");
 await until(()=>evaluate("document.querySelector('.vessel-detail-heading [data-risk=HRS]')!==null"),'detail grade');assert.equal(evidence.riskReads.length,1,'Detail consumes the same App reader');
 const geometry=()=>evaluate("(()=>{const b=document.querySelector('.vessel-detail-heading .fleet-risk-code-badge').getBoundingClientRect(),a=document.querySelector('.vessel-detail-heading .priority-pill').getBoundingClientRect();return{badge:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},attention:{left:a.left,right:a.right,top:a.top,bottom:a.bottom},overflow:document.documentElement.scrollWidth>innerWidth+1};})()");
 evidence.desktop=await geometry();assert.ok(evidence.desktop.badge.right<=evidence.desktop.attention.left);assert.ok(evidence.desktop.badge.top<evidence.desktop.attention.bottom);assert.equal(evidence.desktop.overflow,false);await screen('detail-desktop');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await tick();evidence.mobile=await geometry();assert.equal(evidence.mobile.overflow,false);assert.ok(evidence.mobile.badge.right<=evidence.mobile.attention.left);await screen('detail-mobile');
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
 evidence.cases.push('original login gates → one shared dashboard read → detail grade before independent attention light; desktop/mobile containment');
 state=structuredClone(second);await activate("document.querySelector('.vessel-detail-heading .fleet-risk-code-badge')");
 await until(()=>evaluate("document.querySelector('dialog .fr-report')?.dataset.snapshotId==='00000000-0000-4000-8000-000000000002'"),'detail opens original risk report');
 await click('關閉風險清單');await until(()=>evaluate("document.querySelector('.vessel-detail-heading [data-risk=LRS]')!==null"),'detail adopts shared replacement');await click('← 回到船隊看板');
 await until(()=>evaluate("document.querySelector('[data-dashboard-vessel-id=qa-v1] [data-risk=LRS]')!==null"),'dashboard keeps same shared replacement');assert.equal(evidence.riskReads.length,2);
 evidence.cases.push('detail badge opens existing risk report; read replacement is shared on return without a second detail reader');
 state=structuredClone(first);state.attempt={id:'00000000-0000-4000-8000-000000000003',trigger:'scheduled',status:'running',startedAt:at,completedAt:null,done:1,total:3,error:null};
 await click('建立 PDF 報告');await until(()=>evaluate("document.querySelector('.report-paper [data-risk=HRS]')!==null"),'live report capture');
 assert.deepEqual((await grades('.report-paper .fleet-risk-code-badge')).sort(),['HRS','LRS','SRS','unknown','unknown']);
 const paper=await evaluate("document.querySelector('.report-paper').innerHTML");
 assert.match(paper,/12:50:26/);assert.match(paper,/QA morning task ONE/);assert.match(paper,/QA morning task TWO/);
 evidence.reportGeometry=await evaluate("[...document.querySelectorAll('.report-vessel-name-cell')].map(n=>{const a=n.querySelector('.report-vessel-officers').getBoundingClientRect(),b=n.querySelector('.report-vessel-risk').getBoundingClientRect(),c=n.closest('td').getBoundingClientRect();return{officersBottom:a.bottom,riskTop:b.top,riskRight:b.right,cellRight:c.right};})");
 for(const r of evidence.reportGeometry){assert.ok(r.riskTop>=r.officersBottom);assert.ok(r.riskRight<=r.cellRight+1);}
 await screen('morning-report-desktop');state=structuredClone(second);
 await until(()=>evaluate("document.querySelector('[data-dashboard-vessel-id=qa-v1] .fleet-risk-card-badge')?.dataset.snapshotId==='00000000-0000-4000-8000-000000000002'"),'background poll replaces dashboard only');
 assert.equal(await evaluate("document.querySelector('.report-paper').innerHTML"),paper,'Open report freezes exact shown risk version across shared replacement');
 await printPdf('morning-risk-preview');assert.equal(await evaluate("document.querySelector('.report-paper').innerHTML"),paper);
 evidence.cases.push('live report: all grades and gray unknown under officers, rowSpan tasks and taskless rows; preview/PDF frozen while shared snapshot advances');
 await click('關閉');await click('報告中心');
 await until(()=>evaluate("Boolean(document.querySelector('.daily-report-history-panel:not(.itinerary-daily-history-panel) .saved-report button'))"),'original morning history entry');
 await activate("document.querySelector('.daily-report-history-panel:not(.itinerary-daily-history-panel) .saved-report button')");
 await until(()=>evaluate("document.querySelector('.report-fleet-risk-source')?.innerText.includes('非歷史報告當日風險')"),'historical current-reference disclosure');
 assert.equal(await evaluate("document.querySelector('.report-paper [data-risk-vessel-id=qa-v1] [data-risk]')?.dataset.risk"),'LRS');assert.match(await evaluate("document.querySelector('.report-paper').innerText"),/QA HISTORICAL FROZEN DYNAMICS/);
 await screen('historical-report-desktop');await printPdf('historical-current-risk');await click('關閉');
 evidence.cases.push('original historical report uses latest risk by stable vessel ID, explicitly not daily historical grade; frozen historical dynamics retained; actual PDF');
 await click('船隊看板');await until(()=>evaluate("Boolean(document.querySelector('.dashboard-view'))"),'return to dashboard');
 readFailure=true;await click('建立 PDF 報告');await until(()=>evaluate("document.querySelector('.report-fleet-risk-source')?.innerText.includes('讀取失敗')"),'risk read failure notice');
 assert.equal(await evaluate("document.querySelector('.report-paper [data-risk-vessel-id=qa-v1] [data-risk]')?.dataset.risk"),'LRS');await screen('report-last-good-warning');await click('關閉');
 evidence.cases.push('risk-only read failure keeps last-good grade with visible warning, without blocking or rewriting business report');
 readFailure=false;holdRead=true;await click('建立 PDF 報告');await until(()=>held.length===1,'held report risk read');await click('取消準備');holdRead=false;await fulfill(held.shift());await tick();
 assert.equal(await evaluate("Boolean(document.querySelector('.report-paper'))"),false,'Cancelled report does not reopen after late risk response');
 evidence.cases.push('cancelled report preparation ignores late read without retrying or crawling');
 assert.deepEqual(await qa.read(),businessBefore,'Display and PDF leave stored vessels, tasks and historical report bytes unchanged');
 assert.ok(!qa.metrics.slice(metricsStart).some(m=>/apply_|save_|import_|delete_/.test(m.rpc||'')),'No business writer from display/export');
 readFailure=true;await call('Page.reload');await until(async()=>(await grades('.ship-card .fleet-risk-card-badge')).join(',')==='unknown,unknown,unknown,unknown,unknown','cold read failure stays unknown');
 await click('建立 PDF 報告');await until(()=>evaluate("document.querySelector('.report-fleet-risk-source')?.innerText.includes('未取得可用清單')"),'cold report unknown');
 assert.deepEqual(await grades('.report-paper .fleet-risk-code-badge'),Array(5).fill('unknown'));await screen('report-cold-unknown');
 evidence.cases.push('cold unavailable snapshot produces gray unknown in dashboard/report, never LRS; no persistent risk cache');
 assert.equal(forceCount,0);assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>m.status==='UNSUPPORTED'));
 evidence.status='PASS';
}catch(error){failure=error;evidence.status='FAIL';evidence.error=error.message;try{evidence.body=await evaluate('document.body.innerText');await screen('failure');}catch{}console.error(error.stack);}
finally{
 evidence.metrics=qa?.metrics||[];evidence.forceCount=forceCount;
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>(browser.exitCode!==null||browser.signalCode!==null),'owned Chrome stopped',5000);}catch{browser.kill();}}
 if(qa)await qa.close();
 evidence.cleanup={browserStopped:!browser||(browser.exitCode!==null||browser.signalCode!==null),qaClosed:true};
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({status:evidence.status,layer:evidence.layer,caseCount:evidence.cases.length,cases:evidence.cases,output,error:evidence.error,errors:evidence.errors,cleanup:evidence.cleanup},null,2));
 if(failure)process.exitCode=1;
}

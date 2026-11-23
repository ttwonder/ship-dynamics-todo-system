import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(process.cwd().toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'fleet-brief-board-')),profile=path.join(output,'chrome');
const evidence={layer:'真實原始App UI＋合成PSC資料＋本機PGlite；非正式環境／官網查詢',cases:[],errors:[],riskReads:[],blockedExternal:[],output};
const at='2026-11-12T04:50:26.000Z',names=['FPMC DEMO ONE','FPMC DEMO TWO','FPMC DEMO THREE','FPMC DEMO FOUR','FPMC DEMO FIVE'];
const rows=[[names[0],'9913743','HRS'],[names[1],'9487677','SRS'],[names[2],'9433834','LRS']].map(([name,imo,risk])=>({name,imo,risk,status:'ok',retrievedAt:at,priority:'No Priority',companyName:'QA ONLY',companyImo:'0882415',windowFrom:null,windowTo:null,sourceUpdatedAt:null,sourceUrl:'https://apcis.tmou.org/public/'}));
const snapshot={id:'00000000-0000-4000-8000-000000000001',trigger:'manual',company:{name:'QA ONLY',imo:'0882415',performance:'Medium'},queryStartedAt:'2026-11-12T04:49:00.000Z',queryCompletedAt:at,rosterRetrievedAt:at,count:3,rows,coverage:{referenceCount:3,missingReferenceImos:[],addedReferenceImos:[]}};
const first={snapshot,attempt:null,serverTime:at,nextScheduledAt:'2026-11-12T23:00:00.000Z'};
const state=first;
let holdRead=false,qa,browser,ws,sessionId,id=0,failure,forceCount=0;
const held=[],pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
const blockedFonts=[]; let checkingBrief=false;
async function until(test,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(60);}throw new Error('Timeout '+label);}
function call(method,params={},session=sessionId){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method));},20000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function activate(expression){await evaluate(`(()=>{const n=${expression};if(!n||n.disabled||!n.getClientRects().length)throw new Error('Missing enabled control');n.scrollIntoView({block:'center'});n.focus();})()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
const click=label=>activate(`[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(label)}&&n.getClientRects().length)`);
async function fill(selector,value){await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.focus();n.select();})()`);await call('Input.insertText',{text:value});}
const screen=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
const tick=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const fulfill=async(req)=>{
 const item={snapshotId:state.snapshot.id,status:200};evidence.riskReads.push(item);
 await call('Fetch.fulfillRequest',{requestId:req.requestId,responseCode:item.status,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from(JSON.stringify(state)).toString('base64')},req.sessionId);item.replied=true;
};
try{
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,shipInternalControlDownload:true,tracking:true,taskMember:true,scopedRead:true,hmr:false,performanceTrace:true,preparePerformanceFixture:async(initial,vite)=>{
   const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');const catalog=createInitialData().vessels;
   initial.vessels=names.map((name,i)=>{const v=structuredClone(catalog[0]);return {...v,id:'qa-v'+(i+1),fullName:name,name:'測試船'+['甲','乙','丙','丁','戊'][i],shortName:'DEMO '+(i+1),position:{...v.position,navigationStatus:i===0?'航行中':'停泊',location:['Jebel Ali','Port Hedland','Shanghai','船塢','At Sea'][i],nextPort:['Shanghai','Port Hedland','Qingdao','Singapore','Rotterdam'][i],manualRemark:'示範資料，非實際船舶動態。',etb:'2026-11-13T09:00',eta:'2026-11-14T08:00'},note:{...v.note,captain:'示範船長',chiefOfficer:'示範大副',chiefEngineer:'示範輪機長',firstEngineer:'示範大管輪',statusSupplement:'',subsequentDynamics:'',recentDynamics:i===0?'代理已確認文件收訖；下一次會議請回報完成情況。':'待代理確認作業窗口。',statusList:i===3?['drydock/repiar']:[]},assignedUserIds:[],delegateManagers:[],weeklyAttention:[]}});
   const c={...structuredClone(initial.internalControlCases[0]),id:'demo-c',vesselId:'qa-v2',linkedTaskId:undefined,syncToTask:false,priority:'高',description:'核對塢修工程清單與備件到貨日期。',status:'已向廠商索取更新交期。'};
   const t={...structuredClone(initial.tasks[0]),id:'demo-t',vesselId:'qa-v3',vesselIds:['qa-v3'],internalControlCaseId:undefined,isInternalControl:false,sourceType:'morning',priority:'中',description:'確認下一港靠泊窗口，收到代理回覆後更新行程。',status:'待代理回覆。'};
   c.createdAt='2026-09-17T18:34:00Z';
   t.createdAt='2026-09-20T16:47:00Z';
   initial.internalControlCases=[c];initial.tasks=[t];initial.meetings=[];initial.agendaReports=[];
 }});
 // Replace the inherited QA-prefixed port label with an unambiguous synthetic route.
 await qa.db.query("update sd_itinerary_documents set rows_payload=jsonb_set(rows_payload,'{0,portDockName}',to_jsonb('Kaohsiung'::text)) where vessel_id=$1",['qa-v1']);
 await (await import('./tracking-browser-fixture.mjs')).installTrackingBrowserMigrations(qa.db);
 await qa.db.exec(fs.readFileSync('supabase/migrations/20261006090000_ship_internal_control_download.sql','utf8'));
 assert.equal((await fetch(qa.origin+'/__qa/health')).status,200);
 browser=spawn(process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 let port,socketPath;await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch{return false;}},'owned Chrome');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return;}
   if(m.method==='Browser.downloadWillBegin')evidence.downloads=(evidence.downloads||[]).concat(m.params.suggestedFilename);
   if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){evidence.errors.push('Unexpected dialog: '+m.params.message);void call('Page.handleJavaScriptDialog',{accept:false},m.sessionId);}
   if(m.method==='Fetch.requestPaused')void(async()=>{
     const request=m.params,url=new URL(request.request.url),req={requestId:request.requestId,sessionId:m.sessionId};
     if(checkingBrief && (request.resourceType==='Font'||/fleet-brief-pdf|fleetBriefPdf-|\.(?:woff2?|ttf|otf)(?:\.|$)/i.test(url.pathname))){blockedFonts.push(url.pathname);await call('Fetch.failRequest',{requestId:req.requestId,errorReason:'BlockedByClient'},m.sessionId);return;}
     if(url.origin!==qa.origin){evidence.blockedExternal.push(url.origin);await call('Fetch.failRequest',{requestId:req.requestId,errorReason:'BlockedByClient'},m.sessionId);return;}
     if(url.pathname==='/rest/v1/rpc/read_ship_fleet_risk_v1'){assert.equal(request.request.method,'POST');assert.equal(request.request.postData,'{}');if(holdRead)held.push(req);else await fulfill(req);return;}
     // Exercise the production bundle (npm run build), not Vite's dev websocket.
     // Keep config and RPCs on the isolated SQL fixture. Permit only local assets
     // and in-memory blob reads in the fixture-specific document policy.
     if(url.pathname==='/'||/^\/(assets|fleet-brief-pdf)\/[\w.-]+$/.test(url.pathname)){
       const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
       const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.gz':'application/gzip'}[path.extname(name)];
       const headers=[{name:'Content-Type',value:mime||'application/octet-stream'}];
       if(name==='index.html')headers.push({name:'Content-Security-Policy',value:"default-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; object-src blob:; frame-src blob:; form-action 'self'"});
       await call('Fetch.fulfillRequest',{requestId:req.requestId,responseCode:200,responseHeaders:headers,body:fs.readFileSync(path.join('dist',name)).toString('base64')},m.sessionId);return;
     }
     if(url.pathname==='/functions/v1/fleet-risk'){forceCount++;await call('Fetch.failRequest',{requestId:req.requestId,errorReason:'BlockedByClient'},m.sessionId);return;}
     await call('Fetch.continueRequest',{requestId:req.requestId},m.sessionId);
   })().catch(e=>evidence.errors.push(e.message));
 });
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 for(const method of ['Runtime.enable','Page.enable','Network.enable'])await call(method);
 await call('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
 await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.print=()=>{window.__qaPrints=(window.__qaPrints||0)+1;};'});
 await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output,eventsEnabled:true},null);
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:qa.origin});
 await until(()=>evaluate("document.body?.innerText.includes('請輸入管理者設定的進站密碼。')"),'original site gate');assert.equal(evidence.riskReads.length,0);
 await fill('input[type=password]',qa.password);await click('進入系統');
 await until(()=>evaluate("document.body?.innerText.includes('人員登入／切換')"),'original personnel gate');assert.equal(evidence.riskReads.length,0);
 await fill('input[type=password]',qa.password);await click('登入');
 await until(()=>evaluate("document.querySelectorAll('.ship-card .fleet-risk-card-badge').length===5&&Boolean(document.querySelector('[data-dashboard-vessel-id=qa-v1] [data-risk=HRS]'))"),'original dashboard grades');
 assert.equal(evidence.riskReads.length,1,'One authenticated shared read, no per-card requests');
 const businessBefore=await qa.read(),metricsStart=qa.metrics.length;
 checkingBrief=true;
 const titleBefore=await evaluate('document.title'), clickedAt=performance.now();await click('重點摘要');
 await until(()=>evaluate("document.querySelector('dialog .fleet-brief-paper')?.innerText.includes('核對塢修工程清單與備件到貨日期。')"),'read authorized report with fonts blocked',5000);
 evidence.clickToObservedReadableMs=Math.round(performance.now()-clickedAt);
 evidence.shares=await evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('.fleet-brief-paper section'),s=>{const cells=[...s.querySelectorAll('th[scope=col]')],w=cells.reduce((n,c)=>n+c.getBoundingClientRect().width,0);return [s.dataset.theme,cells.map(c=>+(100*c.getBoundingClientRect().width/w).toFixed(2))]}))`);
 assert.deepEqual(evidence.shares.gulf,evidence.shares.australia,'all seven Gulf columns follow the unchanged Australian table');
 assert.equal(evidence.shares.gulf.length,7);
 const before={australia:[2.35,14.93,11.75,13.63,14.63,4.7,38],china:[2.35,16.25,11.77,12.25,14.66,4.71,38],dock:[2.52,16.7,12.6,12.54,8.82,8.82,38]}; // measured on 94350da, same original UI and fixture
 for(const [theme,old] of Object.entries(before)){
   const now=evidence.shares[theme];assert.ok(Math.abs(now[2]/old[2]-2)<.02,theme+': double crew');
   for(const j of [1,3,5])assert.ok(now[j]<old[j]&&now[j]>.75*old[j],theme+': moderately narrower');
   assert.ok(now[6]>=Math.max(...now)-.05,theme+': retain wide remarks');
 }
 assert.ok(Math.abs(evidence.shares.control[0]*3-24.4)<.1);assert.equal(evidence.shares.control.length,4);
 assert.deepEqual(evidence.shares.task,evidence.shares.control,'all task columns follow the control table');
 assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.fleet-brief-paper .brief-section-name'),n=>n.textContent).slice(0,3)"),['涉及波斯灣及周邊船舶','涉及澳洲船舶','涉及中國船舶']);
 assert.equal(await evaluate("document.querySelector('.fleet-brief-paper [data-theme=task] tbody tr td:nth-child(3)').innerText.trim()"),'2026/09/21 00:47');
 console.log('Measured column shares (%)',JSON.stringify(evidence.shares));
 assert.ok(await evaluate("document.querySelector('.fleet-brief-paper [data-theme=control]').innerText.includes('2026/09/18 02:34')"),'report must show original publication time');
 assert.equal(await evaluate('window.__qaPrints||0'),0);assert.deepEqual(evidence.downloads||[],[]);assert.equal(evidence.riskReads.length,2);
 assert.deepEqual(blockedFonts,[]);assert.equal(await evaluate("document.querySelectorAll('dialog .fleet-brief-paper table').length"),7);
 assert.equal(await evaluate("document.querySelector('dialog [download], dialog object')===null"),true);
 const lamps=await evaluate("Array.from(document.querySelectorAll('dialog [data-lamp]'),n=>n.dataset.lamp)");
 for(const grade of ['HRS','SRS','LRS','unknown','high','medium'])assert.ok(lamps.includes(grade),grade);
 await screen('preview');await click('列印／另存 PDF');assert.equal(await evaluate('window.__qaPrints'),1);
 assert.match(await evaluate('document.title'),/^船隊重點摘要_/);
 await call('Emulation.setEmulatedMedia',{media:'print'});
 const edges=theme=>evaluate(`Array.from(document.querySelectorAll('.fleet-brief-paper [data-theme=${theme}] th[scope=col]'),n=>n.getBoundingClientRect().right)`);
 const gulfEdges=await edges('gulf');assert.equal(gulfEdges.length,7);assert.deepEqual(gulfEdges,await edges('australia'),'printed column boundaries must align');
 const controlEdges=await edges('control');assert.equal(controlEdges.length,4);assert.deepEqual(await edges('task'),controlEdges,'printed task and control boundaries must align');
 const {data:pdf}=await call('Page.printToPDF',{preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
 await call('Emulation.setEmulatedMedia',{media:''});
 fs.writeFileSync(path.join(output,'native-brief.pdf'),Buffer.from(pdf,'base64'));
 await evaluate("window.dispatchEvent(new Event('afterprint'))");assert.equal(await evaluate('document.title'),titleBefore);
 await click('關閉');assert.equal(await evaluate("!!document.querySelector('.fleet-brief-paper')"),false);
 holdRead=true;await click('重點摘要');await until(()=>held.length===1,'held new capture');await click('關閉');holdRead=false;await fulfill(held.shift());await tick();assert.equal(await evaluate("!!document.querySelector('.fleet-brief-dialog')"),false);
 assert.deepEqual(await qa.read(),businessBefore);assert.ok(!qa.metrics.slice(metricsStart).some(x=>/apply_|save_|delete_|import_/.test(x.rpc)));assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.equal(forceCount,0);
 evidence.fontOrPdfEngineRequests=blockedFonts;assert.deepEqual(blockedFonts,[]);assert.deepEqual(evidence.downloads||[],[]);evidence.cases.push('original board -> colored system-font report, no PDF engine/font requests, one explicit print, CDP native PDF, cancellation, no business mutation');evidence.status='PASS';
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

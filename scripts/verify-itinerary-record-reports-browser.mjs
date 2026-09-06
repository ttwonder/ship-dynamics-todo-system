import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'ship-record-ui-evidence-'));
const profile=path.join(output,'chrome-profile');
let qa,browser,ws,failure=null,sessionId;
const pending=new Map(),evidence={label:'真實 UI＋測試資料；本機 PGlite，非 hosted Supabase',scenarios:[],errors:[],blockedExternal:[],metrics:[]};
let id=0;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(test,label,timeout=25_000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(100);}throw new Error(`QA timeout: ${label}`);};
const call=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{
 const number=++id;const timer=setTimeout(()=>{pending.delete(number);reject(new Error(`CDP timeout ${method}`));},15_000);
 pending.set(number,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
 ws.send(JSON.stringify({id:number,method,params,...(session?{sessionId:session}:{})}));
});
const evaluate=async(expression)=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
const click=async(text,index=0,expected=1)=>{
 const pos=await evaluate(`(()=>{const nodes=[...document.querySelectorAll('button')].filter(n=>n.innerText.trim()===${JSON.stringify(text)}&&n.getClientRects().length&&!n.disabled);if(nodes.length!==${expected})throw new Error('button cardinality: '+nodes.length);nodes[${index}].scrollIntoView({block:'center'});const r=nodes[${index}].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});
};
const fill=async(selector,text)=>{
 await evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(n=>n.getClientRects().length);if(nodes.length!==1)throw new Error('input cardinality: '+nodes.length);nodes[0].focus();nodes[0].select();})()`);
 await call('Input.insertText',{text});
};
const text=()=>evaluate("document.body?.innerText||''");
try{
 qa=await createRecordStorageLocalQa();
 assert.equal((await fetch(`${qa.origin}/__qa/health`)).status,200);
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(chrome));
 browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')),'Chrome readiness');
 const [port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);
 ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);return;}
  if(message.method==='Runtime.exceptionThrown')evidence.errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  if(message.method==='Page.javascriptDialogOpening'){
   (evidence.dialogs??=[]).push({type:message.params.type,message:message.params.message});
   const expected=message.params.type==='confirm'&&['同步最新會保留本機修改並嘗試與雲端安全合併；只有本機沒有修改時才直接採用雲端資料。確定繼續？','請盡量以船端修改為主，確定要修改嗎？'].includes(message.params.message);
   const reportDialog=(message.params.type==='alert'&&/^(目前正式 Itinerary 已新增一份手動快照|上次手動保存已完成對帳|Synthetic report ACK loss)/.test(message.params.message))||(message.params.type==='confirm'&&/^確定刪除 1 份每日 Itinerary 日快照？/.test(message.params.message));
   if(!expected&&!reportDialog)evidence.errors.push('Unexpected QA dialog: '+message.params.message);
   void call('Page.handleJavaScriptDialog',{accept:expected||reportDialog},message.sessionId).catch(error=>evidence.errors.push(error.message));
  }
  if(message.method==='Network.requestWillBeSent'){const url=message.params.request.url;if(/^https?:/.test(url)&&!url.startsWith(qa.origin+'/'))evidence.blockedExternal.push(new URL(url).origin);}
 });
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);
 ({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
 await call('Network.setBlockedURLs',{urls:['https://*','http://*.supabase.co/*','http://*.supabase.in/*']});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 if(!process.argv.includes('--lifecycle-only')){
 await call('Page.navigate',{url:qa.origin});
 await until(async()=> (await text()).includes('請輸入管理者設定的進站密碼。'),'authoritative site gate');
 await fill('input[type="password"]',qa.password);await click('進入系統');
 await until(async()=> (await text()).includes('人員登入／切換'),'existing personnel login');
 await fill('input[type="password"]',qa.password);await click('登入');
 await until(async()=> (await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'existing Owner homepage');
 await click('同步最新（安全合併）');await until(async()=>!(await text()).includes('身份、權限或船舶範圍已變更，請同步最新資料'),'fresh authority');
 const appBefore=await qa.read(),formalBefore=await qa.itinerarySnapshot();
 const reports=async()=> (await qa.db.query('select report_id::text id,operation_id::text operation,generated_by,source_max_revision::int revision,snapshot from sd_itinerary_daily_reports order by report_id')).rows;
 await click('報告中心');await until(async()=> (await text()).includes('手動保存目前 Itinerary')&&qa.metrics.some(m=>m.rpc==='sd_itinerary_record_report_list_v1'&&m.status==='SQL_OK'),'original report center list uses record SQL');
 const old=await reports();await click('手動保存目前 Itinerary');
 await until(async()=> (await reports()).length===old.length+1&&evidence.dialogs?.some(d=>d.message.startsWith('目前正式 Itinerary 已新增一份手動快照')),'manual SQL ACK and visible success');
 await until(async()=> (await text()).includes('手動保存快照'),'saved manual listed on original report history');
 const saved=(await reports()).find(r=>!old.some(o=>o.id===r.id));assert.equal(saved.revision,7);assert.equal(saved.snapshot.vessels.find(v=>v.vesselId==='qa-v1').rows[0].portDockName,'QA FORMAL KAOHSIUNG');
 const pos=await evaluate("(()=>{const n=[...document.querySelectorAll('.itinerary-daily-history-panel .saved-report')].find(n=>n.innerText.includes('手動保存快照')).querySelector('button');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});
 await until(()=>evaluate("document.querySelector('.itinerary-daily-report-modal')?.innerText.includes('QA FORMAL KAOHSIUNG')"),'original saved report preview contains formal main');
 assert.doesNotMatch(await evaluate("document.querySelector('.itinerary-daily-report-modal').innerText"),/QA ALTERNATIVE MUST NOT PROJECT/);
 fs.writeFileSync(path.join(output,'report-saved-preview.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));await click('關閉');
 evidence.scenarios.push('original App login → report center manual save → real SQL ACK → history list → saved formal-main preview');
 qa.loseNextReportAck();const count=(await reports()).length,at=qa.metrics.length;
 await click('手動保存目前 Itinerary');await until(async()=> (await text()).includes('對帳上次 Itinerary 保存'),'unknown-result recovery button');
 const dropped=qa.metrics.slice(at).find(m=>m.status==='ACK_DROPPED_AFTER_SQL');assert.ok(dropped);
 assert.equal((await reports()).length,count+1);assert.equal(evidence.dialogs.filter(d=>d.message.startsWith('目前正式 Itinerary 已新增一份手動快照')).length,1,'lost ACK must not claim saved');
 const pending=await evaluate("import('/src/itineraryDailyReports.ts').then(async m=>m.readPendingManualItineraryReportSave((await import('/src/cloud.ts')).getSupabaseConfig(),'qa-owner'))");assert.equal(pending.operationId,dropped.operationId);
 await call('Page.reload');await until(async()=> (await text()).includes('QA OWNER'),'reload after unknown commit');
 if(!(await text()).includes('對帳上次 Itinerary 保存'))await click('報告中心');
 await until(async()=> (await text()).includes('對帳上次 Itinerary 保存'),'durable original pending survives reload');await click('對帳上次 Itinerary 保存');
 await until(()=>evidence.dialogs.some(d=>d.message.startsWith('上次手動保存已完成對帳')),'explicit replay success');
 assert.equal((await reports()).length,count+1);const saves=qa.metrics.slice(at).filter(m=>m.rpc==='sd_itinerary_record_report_save_manual_v1'&&m.status==='SQL_OK');assert.equal(saves.length,2);assert.ok(saves.every(m=>m.operationId===dropped.operationId));
 assert.equal((await qa.db.query('select count(*)::int n from sd_itinerary_daily_report_operations where operation_id=$1::uuid',[dropped.operationId])).rows[0].n,1);
 fs.writeFileSync(path.join(output,'report-recovered-history.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 evidence.scenarios.push('original App lost manual ACK preserves durable operation across reload; explicit replay confirms once without duplicate snapshot');
 // DataManagementPanel is separately legacy-stats gated (out of this slice). Mount its
 // original child, unchanged JSX, using the same real SQL transport, not invented stats.
 await call('Page.navigate',{url:qa.origin+'/__qa/blank'});await until(()=>evaluate("document.readyState==='complete'&&location.pathname==='/__qa/blank'"),'isolated original DataView mount');
 const cfg={supabaseUrl:qa.origin,supabaseAnonKey:'isolated-qa-not-a-service-key',workspaceKey:'isolated-record-ui-qa',tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'delta-v1'};
 await evaluate(`window.SHIP_DYNAMICS_SUPABASE_CONFIG=${JSON.stringify(cfg)};import('/@react-refresh').then(({default:r})=>{r.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;})`);
 await evaluate("Promise.all([import('/node_modules/.vite/deps/react.js'),import('/node_modules/.vite/deps/react-dom_client.js'),import('/src/ItineraryReportDataView.tsx')]).then(([r,d,v])=>{const h=document.createElement('div');document.body.append(h);window.__reportRoot=(d.default||d).createRoot(h);window.__reportRoot.render((r.default||r).createElement(v.default,{currentUser:{id:'qa-owner',role:'owner',isActive:true}}));})");
 await until(()=>evaluate("Boolean(document.querySelector('input[type=checkbox]'))"),'original DataView real SQL list');
 for(const lostAck of [false,true]){
  const before=await reports(),target=lostAck?before.find(r=>r.operation===dropped.operationId):saved;assert.ok(target);
  const selected=await evaluate(`(()=>{const n=document.querySelector('input[aria-label="選擇刪除快照 ${target.id}"]');if(!n)throw new Error('exact target missing');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...selected});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...selected});
  const metricStart=qa.metrics.length;if(lostAck)qa.loseNextReportAck();await click('刪除所選 1 份');
  await until(async()=>!(await reports()).some(r=>r.id===target.id),'actual exact report deletion');
  if(lostAck){await until(async()=> (await text()).includes('上次 Itinerary 快照刪除結果尚未確認'),'unknown delete retains pending');await click('對帳上次操作');await until(async()=> (await text()).includes('上次刪除已對帳'),'same delete operation receipt reconciliation');const writes=qa.metrics.slice(metricStart).filter(m=>m.rpc==='sd_itinerary_record_report_delete_ids_v1'&&m.status==='SQL_OK');assert.equal(writes.length,2);assert.equal(writes[0].operationId,writes[1].operationId);}else await until(async()=> (await text()).includes('每日 Itinerary 日快照已刪除：1 份'),'normal exact delete ACK');
  assert.deepEqual(await reports(),before.filter(r=>r.id!==target.id));
  evidence.scenarios.push(lostAck?'original DataView mounted separately: lost delete ACK → same operation reconciliation, no other report removed':'original DataView mounted separately: original confirmation → Owner exact-ID delete → list refresh, siblings intact');
 }
 const after=await qa.itinerarySnapshot();for(const name of Object.keys(formalBefore))if(!['sd_itinerary_daily_reports','sd_itinerary_daily_report_operations'].includes(name))assert.deepEqual(after[name],formalBefore[name],`reports changed ${name}`);
 assert.deepEqual(await qa.read(),appBefore);assert.equal((await qa.db.query('select count(*)::int n from ship_dynamics_app_state')).rows[0].n,0);
 assert.equal(evidence.dialogs.filter(d=>d.type==='confirm'&&d.message.startsWith('確定刪除 1 份')).length,2,'source has one confirmation per delete; two separate deletion scenarios');
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>m.status==='UNSUPPORTED'));
 await evaluate('window.__reportRoot.unmount()');
 console.log(JSON.stringify({qa:'REPORT_BROWSER_PASS',output,scenarios:evidence.scenarios}));
 }

 await call('Page.navigate',{url:qa.origin+'/__qa/blank'});
 await until(()=>evaluate("location.pathname==='/__qa/blank'&&document.readyState==='complete'"),'isolated lifecycle page');
 await evaluate("import('/@react-refresh').then(({default:r})=>{r.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;})");
 evidence.lifecycle=await evaluate("import('/scripts/itinerary-record-reports-lifecycle-probe.mjs').then(m=>m.run())");
 console.log(JSON.stringify({qa:'REPORT_LIFECYCLE_PASS',output,...evidence.lifecycle}));
}catch(error){failure=error;try{evidence.failureText=await text();}catch{};evidence.error=error.message;console.error(JSON.stringify({qa:'FAILED',error:error.message,output,body:evidence.failureText?.slice(0,9000)}));}
finally{
 evidence.metrics=qa?.metrics||[];
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null,'owned Chrome closed',5000);}catch{browser.kill();}}
 try{if(qa)await qa.close();}catch(error){failure??=error;}
 if(!failure){try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
 try{if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));assert.ok(!browser||browser.exitCode!==null);evidence.cleanup={httpStopped:true,chromeStopped:true};}catch(error){failure??=error;evidence.cleanup={error:error.message};}
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(failure)process.exitCode=1;
}

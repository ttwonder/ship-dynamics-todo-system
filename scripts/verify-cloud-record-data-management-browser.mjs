import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-data-management-browser-'));
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
 qa=await createRecordStorageLocalQa({dataManagement:true});
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
   const expected=message.params.type==='confirm'&&(/^確定刪除 1 份 Ship Dynamics 歷史版本？/.test(message.params.message)||['同步最新會保留本機修改並嘗試與雲端安全合併；只有本機沒有修改時才直接採用雲端資料。確定繼續？','請盡量以船端修改為主，確定要修改嗎？'].includes(message.params.message));
   if(!expected)evidence.errors.push('Unexpected QA dialog: '+message.params.message);
   void call('Page.handleJavaScriptDialog',{accept:expected},message.sessionId).catch(error=>evidence.errors.push(error.message));
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
 await until(async()=> (await text()).includes('請輸入管理者設定的進站密碼。'),'site gate');await fill('input[type="password"]',qa.password);await click('進入系統');
 await until(async()=> (await text()).includes('人員登入／切換'),'personnel login');await fill('input[type="password"]',qa.password);await click('登入');
 await until(async()=> (await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'Owner homepage');
 const clickContaining=async(selector,label)=>{const pos=await evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(n=>n.innerText.includes(${JSON.stringify(label)})&&n.getClientRects().length&&!n.disabled);if(nodes.length!==1)throw new Error('nav cardinality '+nodes.length+' '+${JSON.stringify(label)});const n=nodes[0];n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});};
 const enter=async()=>{if(!(await text()).includes('管理中心'))await click('管理');await until(async()=> (await text()).includes('管理中心'),'Management navigation');await clickContaining('.management-sidebar button','數據管理');await until(()=>evaluate("Boolean(document.querySelector('.data-management-secondary-metrics'))"),'real stats');await clickContaining('.data-management-master .management-list-item','歷史版本清理');await until(()=>evaluate("Boolean(document.querySelector('input[aria-label=\"選擇刪除 revision 2\"]'))"),'real history');};
 await enter();
 const appBefore=await qa.read(),formalBefore=await qa.itinerarySnapshot();
 const history=async n=>(await qa.db.query('select read_ship_dynamics_record_history_v1($1,$2) result',['isolated-record-ui-qa',n])).rows[0].result;
 const snapshots=new Map();for(let n=1;n<=7;n++)snapshots.set(n,await history(n));
 const frozenTables=['ship_dynamics_record_workspaces','ship_dynamics_record_collections','ship_dynamics_records','ship_dynamics_record_history','ship_dynamics_record_read_bases','ship_dynamics_record_receipts','ship_dynamics_app_state','ship_dynamics_app_revisions'];
 const frozen=async()=>Object.fromEntries(await Promise.all(frozenTables.map(async table=>[table,(await qa.db.query(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`)).rows])));
 const before=await frozen();assert.match(await text(),/只會清理所勾選的歷史版本；不會改動目前版本、未勾選的歷史版本或正式業務資料。/);
 assert.equal(await evaluate("document.querySelectorAll('input[aria-label=\"選擇刪除 revision 7\"]').length"),0);
 evidence.scenarios.push('original main.tsx App site/personnel login -> Management navigation -> DataManagement stats/head7/selectable history');
 for(const [revision,lost] of [[1,false],[3,true]]){
  if(lost)qa.loseNextPruneAck();
  const pos=await evaluate(`(()=>{const n=document.querySelector('input[aria-label="選擇刪除 revision ${revision}"]');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});
  await click('刪除所選 1 份');
  if(lost){
   await until(async()=> (await text()).includes('對帳上次操作'),'unknown ACK pending');assert.equal((await history(revision)).status,'missing');
   const dropped=qa.metrics.find(m=>m.status==='ACK_DROPPED_AFTER_SQL');assert.ok(dropped);
   const readPending=()=>evaluate("import('/src/dataManagement.ts').then(async m=>m.readPendingRevisionPrune((await import('/src/cloud.ts')).getSupabaseConfig(),'qa-owner'))");
   assert.equal((await readPending()).operationId,dropped.operationId);
   await call('Page.reload');await until(async()=> (await text()).includes('QA OWNER'),'reload Owner');await enter();
   await until(async()=> (await text()).includes('對帳上次操作'),'durable pending recovered');await click('對帳上次操作');
   await until(async()=> (await text()).includes('上次操作已對帳：1 份'),'exact replay ACK');assert.equal(await readPending(),null);
   const writes=qa.metrics.filter(m=>m.rpc==='prune_ship_dynamics_record_revision_history_v1'&&m.status==='SQL_OK'&&m.operationId===dropped.operationId);assert.equal(writes.length,2);
   evidence.scenarios.push('original Panel lost ACK -> reload -> same operation explicit reconciliation -> pending cleared after SQL replay');
  }else{await until(async()=> (await text()).includes('歷史版本已刪除：1 份'),'normal prune ACK');evidence.scenarios.push('original Panel manual checkbox/original confirm -> SQL prune ACK -> stats refresh/readback');}
  await until(()=>evaluate(`!document.querySelector('input[aria-label="選擇刪除 revision ${revision}"]')`),'deleted row absent');snapshots.delete(revision);
  for(const [n,payload] of snapshots)assert.deepEqual(await history(n),payload);
  assert.deepEqual(await qa.read(),appBefore);assert.deepEqual(await qa.itinerarySnapshot(),formalBefore);assert.deepEqual(await frozen(),before);
 }
 fs.writeFileSync(path.join(output,'original-panel-history.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 evidence.scenarios.push('ALL retained history/current/formal Itinerary/legacy/read-bases/body tables unchanged after each prune');
 }
 await call('Page.navigate',{url:qa.origin+'/__qa/blank'});await until(()=>evaluate("location.pathname==='/__qa/blank'&&document.readyState==='complete'"),'component probe blank');
 await evaluate("import('/@react-refresh').then(({default:r})=>{r.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;})");
 evidence.lifecycle=await evaluate("import('/scripts/record-data-management-lifecycle-probe.mjs').then(m=>m.run())");
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);
 console.log(JSON.stringify({qa:'PASS',output,scenarios:evidence.scenarios,lifecycle:evidence.lifecycle},null,2));
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

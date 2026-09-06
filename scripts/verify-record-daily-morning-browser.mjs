import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-daily-morning-browser-'));
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
 qa=await createRecordStorageLocalQa({dailyMorning:'browser'});
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

 await call('Page.navigate',{url:qa.origin});
 await until(async()=> (await text()).includes('請輸入管理者設定的進站密碼。'),'site gate');await fill('input[type="password"]',qa.password);await click('進入系統');
 await until(async()=> (await text()).includes('人員登入／切換'),'personnel login');await fill('input[type="password"]',qa.password);await click('登入');
 await until(async()=> (await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'Owner homepage');
 await click('報告中心');await until(async()=> (await text()).includes('尚無每日早會歷史'),'initial original history empty');
 const before=await qa.read(),formal=await qa.itinerarySnapshot();
 // Draft bytes are browser-only and cannot feed a server-side snapshot.
 const draftRead="import('/src/itinerary/itineraryDraftStore.ts').then(m=>m.readItineraryDraft(m.itineraryDraftKey('isolated-record-ui-qa','qa-v1','qa-owner')))";
 await evaluate("Promise.all([import('/src/itinerary/itineraryDraftStore.ts'),import('/src/itinerary/itineraryTypes.ts')]).then(async([m,t])=>{const document=t.createEmptyItineraryDocument({workspaceKey:'isolated-record-ui-qa',vesselId:'qa-v1',vesselName:'QA VESSEL 1',rowId:'draft-row'});document.revision=7;document.rows[0].previousPortName='DRAFT MUST NOT PROJECT';await m.saveItineraryDraft({key:m.itineraryDraftKey('isolated-record-ui-qa','qa-v1','qa-owner'),workspaceKey:'isolated-record-ui-qa',vesselId:'qa-v1',actorId:'qa-owner',baseRevision:7,savedAt:'2026-09-07T00:30:00Z',document});})");
 const draftBefore=await evaluate(draftRead);assert.equal(draftBefore.document.rows[0].previousPortName,'DRAFT MUST NOT PROJECT');
 const result=(await qa.db.query("select run_ship_dynamics_record_daily_morning_v1($1,'ui-schedule','2026-09-07T01:00:00Z') result",['isolated-record-ui-qa'])).rows[0].result;
 assert.equal(result.ok,true);const committed=await qa.read();
 const metricStart=qa.metrics.length;await click('同步最新（安全合併）');
 await until(()=>evaluate("document.querySelector('.morning-daily-history-panel')?.innerText.includes('2026-09-07')"),'original UI authoritative history readback');
 assert.match(await evaluate("document.querySelector('.morning-daily-history-panel').innerText"),/09:00自動/);
 assert.ok(qa.metrics.slice(metricStart).some(m=>m.rpc==='read_ship_dynamics_record_delta_v1'&&m.status==='SQL_OK'));
 fs.writeFileSync(path.join(output,'morning-history.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 evidence.scenarios.push('original main.tsx/App login -> report center empty -> owner-side SQL scheduler -> UI sync through SupabaseJS/delta -> scheduled history row');
 await click('檢視當日快照');await until(()=>evaluate("document.querySelector('.report-preview-modal')?.innerText.includes('RECORD TASK open')"),'original historical preview renders saved task');
 const preview=await evaluate("document.querySelector('.report-preview-modal').innerText");
 for(const label of ['QA VESSEL 1','QA FORMAL BUSAN','QA FORMAL KAOHSIUNG','QA FORMAL CARGO 123 MT','RECORD TASK open'])assert.ok(preview.includes(label),label);
 assert.doesNotMatch(preview,/DRAFT MUST NOT PROJECT|QA ALTERNATIVE MUST NOT PROJECT|LEGACY STALE/);
 fs.writeFileSync(path.join(output,'morning-preview.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await click('關閉');await call('Page.reload');await until(async()=> (await text()).includes('QA OWNER'),'reload Owner');
 if(!(await evaluate("Boolean(document.querySelector('.morning-daily-history-panel'))")))await click('報告中心');
 await until(()=>evaluate("document.querySelector('.morning-daily-history-panel')?.innerText.includes('2026-09-07')"),'reload saved history');
 assert.deepEqual(await qa.read(),committed);assert.deepEqual(await qa.itinerarySnapshot(),formal);
 assert.deepEqual(await evaluate(draftRead),draftBefore);
 assert.doesNotMatch(await text(),/Itinerary 營運資訊同步異常|雲端文件未通過驗證/);
 const historic=(await qa.db.query('select read_ship_dynamics_record_history_v1($1,$2) result',['isolated-record-ui-qa',before.revision])).rows[0].result;
 assert.deepEqual(historic.payload,before.payload);
 evidence.scenarios.push('original history open -> saved records/formal projection preview -> reload retains SQL report; no PDF/export or UI mutation');
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>m.status==='UNSUPPORTED'));
 evidence.readback={beforeRevision:before.revision,committedRevision:committed.revision,reportId:committed.payload.agendaReports[0].id,formalUnchanged:true,legacyUnchanged:true};
 console.log(JSON.stringify({qa:'MORNING_BROWSER_PASS',output,scenarios:evidence.scenarios,readback:evidence.readback},null,2));
}catch(error){failure=error;try{evidence.failureText=await text();}catch{};evidence.error=error.message;console.error(JSON.stringify({qa:'FAILED',error:error.message,output,body:evidence.failureText?.slice(0,9000)}));}
finally{
 evidence.metrics=qa?.metrics||[];
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome closed',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome tree stopped',5000);}}
 try{if(qa)await qa.close();}catch(error){failure??=error;}
 if(!failure){try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
 try{if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);evidence.cleanup={httpStopped:true,chromeStopped:true,ownedChromePid:browser?.pid};}catch(error){failure??=error;evidence.cleanup={error:error.message};}
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(failure)process.exitCode=1;
}

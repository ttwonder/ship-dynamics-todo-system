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
 if(!process.argv.includes('--hook-only')) {
 await call('Page.navigate',{url:qa.origin});
 await until(async()=> (await text()).includes('請輸入管理者設定的進站密碼。'),'authoritative site gate');
 await fill('input[type="password"]',qa.password);await click('進入系統');
 await until(async()=> (await text()).includes('人員登入／切換'),'existing personnel login');
 await fill('input[type="password"]',qa.password);await click('登入');
 await until(async()=> (await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'existing owner homepage');
 evidence.scenarios.push('existing gate and password login use the real App with record authority');
 await until(()=>qa.metrics.some(m=>m.rpc==='sd_itinerary_record_load_many_v1'),'mounted Itinerary read request');
 assert.ok(qa.metrics.some(m=>m.rpc==='sd_itinerary_record_load_many_v1'&&m.status==='SQL_OK'),'mounted Itinerary loadMany must execute real SQL, not UNSUPPORTED');
 await until(async()=> (await text()).includes('QA FORMAL BUSAN')&&(await text()).includes('QA FORMAL KAOHSIUNG'),'real formal Itinerary projection visible on original homepage');
 assert.doesNotMatch(await text(),/QA ALTERNATIVE MUST NOT PROJECT|Itinerary 營運資訊同步異常|行程讀取失敗|Itinerary 雲端讀取失敗|Internal QA does not implement|sd_itinerary_main_load_many|sd_itinerary_record_load_many_v1/);
 evidence.scenarios.push('mounted operational read shows actual formal SQL ports, excludes alternative, and has no loadMany error');
 await click('同步最新（安全合併）');
 await until(async()=>!(await text()).includes('身份、權限或船舶範圍已變更，請同步最新資料'),'post-login fresh authority');
 await click('快速更新',0,2);
 await until(()=>evaluate("Boolean(document.querySelector('[role=dialog]'))"),'existing vessel editor and real lease');
 const baseline=await qa.read(),marker='QA durable vessel update';
 await evaluate(`(()=>{const fields=[...document.querySelectorAll('[role=dialog] .field')].filter(n=>n.querySelector('label')?.innerText==='近期／後續動態');if(fields.length!==1)throw new Error('recent dynamics field cardinality');const input=fields[0].querySelector('textarea');input.focus();input.select();})()`);
 await call('Input.insertText',{text:marker});await click('保存並關閉');
 await until(async()=> (await qa.read()).payload.vessels.find(v=>v.id==='qa-v1').note.recentDynamics===marker,'real SQL vessel save');
 await until(()=>evaluate("!document.querySelector('[role=dialog]')"),'editor closed after requested save');
 await until(async()=>Number((await qa.db.query("select count(*)::int as n from ship_dynamics_edit_locks where expires_at>now()")).rows[0].n)===0,'durable close releases all owned leases');
 const confirmed=await qa.read();assert.equal(confirmed.revision,baseline.revision+1);
 assert.deepEqual(confirmed.payload.vessels.find(v=>v.id==='qa-v2'),baseline.payload.vessels.find(v=>v.id==='qa-v2'));
 assert.equal(confirmed.payload.auditLogs.length,baseline.payload.auditLogs.length+1);
 assert.ok(qa.metrics.some(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status==='SQL_OK'));
 evidence.scenarios.push('real UI note save commits matching audit once, retains the other vessel, and releases lease after durability');
 const readsBefore=qa.metrics.filter(m=>m.rpc==='read_ship_dynamics_record_delta_v1').length;
 await call('Page.reload');
 await until(async()=>qa.metrics.filter(m=>m.rpc==='read_ship_dynamics_record_delta_v1').length>readsBefore&&(await text()).includes('QA OWNER'),'reload from authoritative SQL');
 await until(async()=> (await text()).includes('QA FORMAL BUSAN'),'reload restores formal operational projection');
 assert.doesNotMatch(await text(),/Itinerary 營運資訊同步異常|行程讀取失敗|Internal QA does not implement/);
 await click('快速更新',0,2);await until(()=>evaluate("Boolean(document.querySelector('[role=dialog]'))"),'reopened persisted editor');
 assert.equal(await evaluate(`(()=>{const field=[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態');return field?.querySelector('textarea')?.value;})()`),marker);
 evidence.scenarios.push('browser reload and reopened real editor display the saved authoritative value');
 evidence.editorFields=await evaluate("[...document.querySelectorAll('[role=dialog] input,[role=dialog] textarea,[role=dialog] [contenteditable=true]')].map(n=>({tag:n.tagName,type:n.type,name:n.name,placeholder:n.getAttribute('placeholder'),aria:n.getAttribute('aria-label'),field:n.closest('.field')?.innerText?.slice(0,180)}))");
 evidence.homeText=(await text()).slice(0,9000);
 evidence.buttons=await evaluate("[...document.querySelectorAll('button')].filter(n=>n.getClientRects().length).map(n=>({text:n.innerText.trim(),title:n.title,aria:n.getAttribute('aria-label')}))");
 const image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'home.png'),Buffer.from(image.data,'base64'));
 await click('取消並關閉');
 await until(()=>evaluate("!document.querySelector('[role=dialog]')"),'unchanged cancel');
 assert.equal((await qa.read()).revision,confirmed.revision);
 evidence.scenarios.push('unchanged cancel closes without another revision');
 await until(async()=>Number((await qa.db.query("select count(*)::int as n from ship_dynamics_edit_locks where expires_at>now()")).rows[0].n)===0,'cancelled editor releases its lease');
 assert.equal((await qa.db.query('select count(*)::int as n from ship_dynamics_app_state')).rows[0].n,0,'no legacy authority mirror');
 assert.deepEqual(await qa.itinerarySnapshot(),qa.itineraryBaseline,'vessel save/reload must not change formal sd_* documents, leases, histories or legacy app state');
 assert.ok(qa.metrics.filter(m=>m.rpc==='sd_itinerary_record_load_many_v1').length>=2,'initial and reload must perform real record Itinerary reads');
 assert.ok(qa.metrics.filter(m=>m.rpc==='sd_itinerary_record_load_many_v1').every(m=>m.status==='SQL_OK'));
 assert.ok(!qa.metrics.some(m=>m.rpc==='sd_itinerary_main_load_many'));
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);
 // Original Itinerary editor: all interactions below use visible controls, never props/helpers.
 await qa.db.exec("update sd_itinerary_leases set expires_at=now()-interval '1 second' where vessel_id='qa-v1'");
 const itineraryBefore=await qa.itinerarySnapshot(),appBefore=await qa.read();
 await click('切換顯示Itinerary信息');await until(async()=> (await text()).includes('Itinerary 看板'),'original Itinerary dashboard');
 const formalRead=async()=> (await qa.db.query("select sd_itinerary_document_for_vessel(workspace_id,$1,vessel_id) as doc from sd_itinerary_documents where vessel_id='qa-v1'",['isolated-record-ui-qa'])).rows[0].doc;
 for(const lostAck of [false,true]){
  const before=await formalRead(),at=qa.metrics.length,marker=lostAck?'QA ITINERARY RECOVERED':'QA ITINERARY SAVED';
  await click('手動修改',0,2);await until(()=>evaluate("Boolean(document.querySelector('.itinerary-editor-modal'))"),'original Office claim and document load');
  await fill('.itinerary-editor-modal input[placeholder="Next Port / Dock"]',marker);
  if(!lostAck)await until(()=>qa.metrics.slice(at).some(m=>m.rpc==='sd_itinerary_record_renew_lease_v1'&&m.status==='SQL_OK'),'original Editor heartbeat reaches record SQL despite background feed polling',40_000);
  if(lostAck)qa.loseNextItineraryAck();
  await click('保存並同步');
  await until(async()=> (await formalRead()).rows[0].portDockName===marker,'Itinerary actual SQL commit');
  await until(()=>evaluate("!document.querySelector('.itinerary-editor-modal')"),'original Itinerary save acknowledgement closes editor');
  await until(()=>qa.metrics.slice(at).some(m=>m.rpc==='sd_itinerary_record_release_lease_v1'&&m.status==='SQL_OK'),'original explicit release request');
  const saved=await formalRead();assert.equal(saved.revision,before.revision+1);assert.deepEqual(saved.alternativePlans,before.alternativePlans);
  assert.equal((await qa.db.query("select count(*)::int n from sd_itinerary_leases where vessel_id='qa-v1' and expires_at>now()")).rows[0].n,0);
  const writes=qa.metrics.slice(at).filter(m=>m.rpc==='sd_itinerary_record_save_v1'&&m.status==='SQL_OK');assert.equal(writes.length,1);
  assert.equal((await qa.db.query('select count(*)::int n from sd_itinerary_history where operation_id=$1',[writes[0].operationId])).rows[0].n,1);
  if(lostAck){const status=qa.metrics.slice(at).filter(m=>m.rpc==='sd_itinerary_record_operation_status_v1');assert.equal(status.length,1);assert.equal(status[0].operationId,writes[0].operationId);assert.equal(status[0].status,'SQL_OK');}
  await click('手動修改',0,2);await until(()=>evaluate("Boolean(document.querySelector('.itinerary-editor-modal'))"),'authoritative Itinerary reopen');
  assert.equal(await evaluate("document.querySelector('.itinerary-editor-modal input[placeholder=\"Next Port / Dock\"]').value"),marker);
  fs.writeFileSync(path.join(output,lostAck?'itinerary-recovered.png':'itinerary-saved.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('取消編輯');await until(()=>evaluate("!document.querySelector('.itinerary-editor-modal')"),'unchanged Itinerary close');
  evidence.scenarios.push(lostAck?'original Itinerary lost-ACK save recovers same operation via real SQL status, reopens authoritative value and releases':'original Itinerary claim/edit/save/readback/reopen/close/release commits formal and preserves alternatives');
 }
 await click('手動修改',0,2);await until(()=>evaluate("Boolean(document.querySelector('.itinerary-editor-modal'))"),'open for lease-loss negative');
 await fill('.itinerary-editor-modal input[placeholder="Next Port / Dock"]','QA UNSAVED LEASE LOSS');
 await qa.db.exec("update sd_itinerary_leases set expires_at=now()-interval '1 second' where vessel_id='qa-v1'");
 const successor=(await qa.db.query("select sd_itinerary_record_claim_lease_v1($1,'qa-v1','successor-tab','ignored',75,'qa-owner') as lease",['isolated-record-ui-qa'])).rows[0].lease;assert.equal(successor.ok,true);
 const beforeFailure=await qa.itinerarySnapshot();
 await click('保存並同步');await until(async()=> (await text()).includes('編輯鎖已失效，本次未保存；草稿已保留。'),'visible failure preserves original editor');
 assert.equal(await evaluate("document.querySelector('.itinerary-editor-modal input[placeholder=\"Next Port / Dock\"]').value"),'QA UNSAVED LEASE LOSS');
 const draft=await evaluate("import('/src/itinerary/itineraryDraftStore.ts').then(async m=>m.readItineraryDraft(m.itineraryDraftKey('isolated-record-ui-qa','qa-v1','qa-owner')))");assert.equal(draft.document.rows[0].portDockName,'QA UNSAVED LEASE LOSS');
 assert.deepEqual(await qa.itinerarySnapshot(),beforeFailure,'failed original UI save must not write document/history/ledger or successor lease');
 await click('關閉（保留草稿）');await until(()=>evaluate("!document.querySelector('.itinerary-editor-modal')"),'explicit preserve-draft close');
 assert.deepEqual(await qa.itinerarySnapshot(),beforeFailure,'stale close must not release successor lease');
 evidence.scenarios.push('original UI lost lease rejects save, preserves visible/durable draft, and stale close cannot release successor');
 const itineraryAfter=await qa.itinerarySnapshot();for(const table of Object.keys(itineraryBefore))if(!['sd_itinerary_documents','sd_itinerary_history','sd_itinerary_operations','sd_itinerary_leases'].includes(table))assert.deepEqual(itineraryAfter[table],itineraryBefore[table],`Itinerary must not mutate ${table}`);
 assert.deepEqual(await qa.read(),appBefore,'Itinerary must not dual-write record AppData');
 assert.equal(itineraryAfter.sd_itinerary_history.length,itineraryBefore.sd_itinerary_history.length+2);
 assert.equal(itineraryAfter.sd_itinerary_operations.length,itineraryBefore.sd_itinerary_operations.length+2);
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);
 console.log(JSON.stringify({qa:'ITINERARY_WRITE_PASS',output,scenarios:evidence.scenarios}));
 console.log(JSON.stringify({qa:'CORE_FLOW_PASS',output,scenarios:evidence.scenarios,unsupportedRpc:[...new Set(qa.metrics.filter(m=>m.status==='UNSUPPORTED').map(m=>m.rpc))]}));
 }
 await call('Page.navigate',{url:qa.origin+'/__qa/blank'});
 await until(()=>evaluate("location.pathname==='/__qa/blank'&&document.readyState==='complete'"),'isolated hook page');
 evidence.hook=await evaluate("import('/scripts/itinerary-record-hook-probe.mjs').then(m=>m.run())");
 console.log(JSON.stringify({qa:'HOOK_PASS',output,...evidence.hook}));
 await evaluate("import('/@react-refresh').then(({default:r})=>{r.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;})");
 evidence.lifecycle=await evaluate("import('/scripts/itinerary-record-lifecycle-probe.mjs').then(m=>m.run())");
 console.log(JSON.stringify({qa:'LIFECYCLE_PASS',output,...evidence.lifecycle}));
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

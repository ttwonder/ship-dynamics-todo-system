import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const output=fs.mkdtempSync(path.join(os.tmpdir(),'ship-record-ui-evidence-'));
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
   const expected=message.params.type==='confirm'&&message.params.message==='同步最新會保留本機修改並嘗試與雲端安全合併；只有本機沒有修改時才直接採用雲端資料。確定繼續？';
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
 await until(async()=> (await text()).includes('請輸入管理者設定的進站密碼。'),'authoritative site gate');
 await fill('input[type="password"]',qa.password);await click('進入系統');
 await until(async()=> (await text()).includes('人員登入／切換'),'existing personnel login');
 await fill('input[type="password"]',qa.password);await click('登入');
 await until(async()=> (await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'existing owner homepage');
 evidence.scenarios.push('existing gate and password login use the real App with record authority');
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
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);
 console.log(JSON.stringify({qa:'CORE_FLOW_PASS',output,scenarios:evidence.scenarios,unsupportedRpc:[...new Set(qa.metrics.filter(m=>m.status==='UNSUPPORTED').map(m=>m.rpc))]}));
}catch(error){failure=error;try{evidence.failureText=await text();}catch{};evidence.error=error.message;console.error(JSON.stringify({qa:'FAILED',error:error.message,output,body:evidence.failureText?.slice(0,9000)}));}
finally{
 evidence.metrics=qa?.metrics||[];
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null,'owned Chrome closed',5000);}catch{browser.kill();}}
 try{if(qa)await qa.close();}catch(error){failure??=error;}
 if(!failure){try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
 if(failure)process.exitCode=1;
}

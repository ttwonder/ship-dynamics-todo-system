import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'morning-pdf-'));
const profile=path.join(output,'chrome-profile');
let native,qa,browser,ws,failure=null,sessionId,releaseHeldReceipt;
let currentCase="setup",holdNext=false,held=false,failNext=false;
const pending=new Map(),evidence={label:'真實 UI＋測試資料；原生 PostgreSQL，非 hosted Supabase',scenarios:[],errors:[],blockedExternal:[],metrics:[],dialogs:[]};
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
 // Native keyboard activation avoids scroll-driven coordinate drift. No handler calls.
 await evaluate(`(()=>{const nodes=[...document.querySelectorAll('button')].filter(n=>n.innerText.trim()===${JSON.stringify(text)}&&n.getClientRects().length&&!n.disabled);if(nodes.length!==${expected})throw new Error('button cardinality '+${JSON.stringify(text)}+': '+nodes.length);nodes[${index}].focus();if(document.activeElement!==nodes[${index}])throw new Error('button focus precondition');})()`);
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
};
const fill=async(selector,text)=>{
 await evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(n=>n.getClientRects().length);if(nodes.length!==1)throw new Error('input cardinality: '+nodes.length);nodes[0].focus();nodes[0].select();})()`);
 await call('Input.insertText',{text});
};
const text=()=>evaluate("document.body?.innerText||''");

const nodeClick=async(expression)=>{
 const pos=await evaluate(`(()=>{const n=${expression};if(!n||!n.getClientRects().length||n.disabled)throw new Error('UI target unavailable: '+${JSON.stringify(expression)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});
};
const field=(label,tag,scope='.modal')=>`[...document.querySelectorAll(${JSON.stringify(scope+' .field')})].find(n=>n.querySelector('label')?.innerText.trim()===${JSON.stringify(label)})?.querySelector(${JSON.stringify(tag)})`;
const key=async(key,code=key)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code});};
const select=async(expression,value)=>{
 const index=await evaluate(`(()=>{const n=${expression};if(!n||n.disabled)throw new Error('select unavailable');n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(index>=0,'option '+value);
 await key('Home');for(let i=0;i<index;i++)await key('ArrowDown');await key('Enter');
 await until(async()=>await evaluate(`(${expression}).value`)===value,'selected '+value);
};
const labelInput=(label,scope='.modal')=>`[...document.querySelectorAll(${JSON.stringify(scope+' label')})].find(n=>n.innerText.trim()===${JSON.stringify(label)})?.querySelector('input')`;
const fillNode=async(expression,value)=>{
 await evaluate(`(()=>{const n=${expression};if(!n||n.disabled)throw new Error('field unavailable');n.focus();n.select();})()`);await call('Input.insertText',{text:value});
};
const snapshot=async(name)=>{const data=await qa.read();fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(data,null,2));return data;};
const screen=async(name)=>{const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(image.data,'base64'));};
const check=async(name,run)=>{await run();assert.ok(!evidence.scenarios.includes(name));evidence.scenarios.push(name);console.log('PASS',name);};

try{
 native=await createNativeRecordQa(output,evidence,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,tracking:true,taskMember:true,hmr:false,performanceTrace:true,preparePerformanceFixture:async(initial,vite)=>{await (await import('./morning-scoped-fixture.mjs')).morningFixture(initial,vite);},databaseFactory:async()=>native.adapter});
 await (await import('./tracking-browser-fixture.mjs')).installTrackingBrowserMigrations(native.adapter);
 await (await import('./tracking-browser-fixture.mjs')).installTrackingFieldRevision(qa.db);
 evidence.reads=[];
 qa.setRecordFault({beforeRead:async({body})=>{
   if(holdNext){holdNext=false;held=true;await new Promise(r=>releaseHeldReceipt=r);}
   if(failNext){failNext=false;try{await qa.db.transaction(async tx=>{await tx.exec("set local statement_timeout='1ms'");await tx.query('select read_ship_dynamics_record_scopes_v2($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)',[qa.workspace,'full','{}','[]','[]']);});}catch(e){evidence.nativeTimeout={code:e.code,message:e.message};throw e;}throw new Error('Expected actual PostgreSQL statement timeout');}
 },after:async({name,body,value})=>{if(name==='read_ship_dynamics_record_scopes_v2')evidence.reads.push({caseId:currentCase,scope:body.p_scope,targetCount:body.p_targets.length,bytes:Buffer.byteLength(JSON.stringify(value)),unrelatedHistory:JSON.stringify(value).includes('QA_UNLOADED_DETAIL_SENTINEL'),revision:value.revision});return false;}});
 assert.equal((await fetch(`${qa.origin}/__qa/health`)).status,200);
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(chrome));
 browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let port,socketPath;
 await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch(error){if(['ENOENT','EBUSY','EPERM'].includes(error.code))return false;throw error;}},'Chrome readable handshake');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);return;}
  if(message.method==='Network.responseReceived'&&message.params.response.status>=400)(evidence.httpErrors??=[]).push({status:message.params.response.status,path:new URL(message.params.response.url).pathname});
  if(message.method==='Network.loadingFailed')(evidence.loadErrors??=[]).push({type:message.params.type,error:message.params.errorText});
  if(message.method==='Runtime.exceptionThrown')evidence.errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  if(message.method==='Page.javascriptDialogOpening'){
   (evidence.dialogs??=[]).push({type:message.params.type,message:message.params.message});
   const expected=message.params.type==='alert'&&message.params.message.startsWith('讀取最新早會資料逾時')||message.params.type==='confirm'&&message.params.message.startsWith('同步最新會保留本機修改');
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

 // Exercise the native CDP keyboard precondition away from the App.
 await evaluate("document.body.innerHTML='<button id=probe>QA native activation</button>';document.querySelector('#probe').onclick=()=>document.body.dataset.qaClicked='yes'");
 await click('QA native activation');assert.equal(await evaluate('document.body.dataset.qaClicked'),'yes');
 await call('Page.navigate',{url:qa.origin});
 try{await until(async()=> (await text()).includes('請輸入管理者設定的進站密碼。'),'site gate');}catch(error){if((await text()).trim()!=='真實 UI＋測試資料｜本機 SQL；非正式環境')throw error;evidence.initialAssetRetry=true;await call('Page.reload');await until(async()=> (await text()).includes('請輸入管理者設定的進站密碼。'),'site gate after one blank-asset retry',40_000);}await fill('input[type="password"]',qa.password);await click('進入系統');
 await until(async()=> (await text()).includes('人員登入／切換'),'personnel login');await fill('input[type="password"]',qa.password);await click('登入');
 await until(async()=> (await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'Owner homepage');


 const baseline=await snapshot('fixture-baseline');
 const beforePhysical=(await qa.db.query("select collection,entity_id,to_jsonb(t) value,xmin::text,ctid::text from ship_dynamics_records t order by collection,entity_id")).rows;
 const fullStart=performance.now(),full=(await qa.db.query('select read_ship_dynamics_record_scopes_v2($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) r',[qa.workspace,'full','{}','[]','[]'])).rows[0].r;
 evidence.fullControl={ms:performance.now()-fullStart,bytes:Buffer.byteLength(JSON.stringify(full)),unrelatedHistory:JSON.stringify(full).includes('QA_UNLOADED_DETAIL_SENTINEL')};assert.equal(evidence.fullControl.unrelatedHistory,true);
 await evaluate("window.__qaPrints=[];window.print=()=>window.__qaPrints.push({title:document.title,text:document.querySelector('.report-paper')?.innerText,printing:document.body.classList.contains('printing-report')})");
 const paper=()=>evaluate("document.querySelector('.report-paper')?.innerText||''"),prints=()=>evaluate('window.__qaPrints.length');
 const finishPrint=()=>evaluate("window.dispatchEvent(new Event('afterprint'))");
 const pdf=async name=>{await call('Emulation.setEmulatedMedia',{media:'print'});const result=await call('Page.printToPDF',{landscape:true,printBackground:true,preferCSSPageSize:true});fs.writeFileSync(path.join(output,name+'.pdf'),Buffer.from(result.data,'base64'));await call('Emulation.setEmulatedMedia',{media:''});};
 let homeText;
 await check('PDF-home-native-current-v2-read-and-real-Chromium-PDF',async()=>{
   currentCase='home';await click('建立 PDF 報告');await until(async()=>await prints()===1,'homepage actually dispatches print');
   homeText=await paper();assert.match(homeText,/船舶早會動態暨待辦報告/);assert.match(homeText,/QA VESSEL 1/);assert.match(homeText,/QA VESSEL 2/);assert.match(homeText,/MW HISTORY TASK 03/);assert.doesNotMatch(homeText,/MW HISTORY TASK 05|QA_UNLOADED_DETAIL_SENTINEL/);
   assert.equal(await evaluate('window.__qaPrints[0].printing'),true);assert.ok(evidence.reads.some(r=>r.caseId==='home'&&r.scope==='targets'));assert.ok(evidence.reads.filter(r=>r.caseId==='home').every(r=>r.scope!=='full'&&!r.unrelatedHistory));
   await screen('homepage-pdf-preview');await pdf('homepage-morning');await finishPrint();assert.equal(await evaluate("document.body.classList.contains('printing-report')"),false);await click('關閉');
 });
 await check('PDF-center-same-report-content-no-automatic-print',async()=>{
   currentCase='center';await click('報告中心');await until(async()=>(await text()).includes('開啟 PDF 預覽'),'report center');await click('開啟 PDF 預覽');await until(async()=>(await paper()).includes('船舶早會動態暨待辦報告'),'center preview');assert.equal(await prints(),1);assert.equal(await paper(),homeText,'identical renderer and current content');
   await click('導出／列印 PDF');await until(async()=>await prints()===2,'center print');await pdf('center-morning');await finishPrint();await screen('center-pdf-preview');await click('關閉');
 });
 await check('PDF-cancel-pending-native-read-no-late-preview',async()=>{
   currentCase='cancel';holdNext=true;await click('開啟 PDF 預覽');await until(()=>held,'native read held');assert.ok((await text()).includes('正在讀取最新資料並準備 PDF'));await screen('pdf-preparing');await click('取消準備');releaseHeldReceipt();releaseHeldReceipt=null;await until(()=>evidence.reads.some(r=>r.caseId==='cancel'),'cancelled request completed');await wait(150);assert.equal(await paper(),'');assert.equal(await prints(),2);
 });
 await check('PDF-native-statement-timeout-fail-closed-and-explicit-retry',async()=>{
   currentCase='timeout';failNext=true;await click('開啟 PDF 預覽');await until(()=>Boolean(evidence.nativeTimeout),'native PostgreSQL timeout');await until(()=>evidence.dialogs.some(d=>d.message.includes('本次未建立 PDF')),'visible explanatory error');assert.equal(evidence.nativeTimeout.code,'57014');assert.equal(await paper(),'');assert.equal(await prints(),2);
   currentCase='retry';await click('開啟 PDF 預覽');await until(async()=>(await paper()).includes('MW HISTORY TASK 03'),'explicit healthy retry');assert.equal(await paper(),homeText);await click('關閉');
 });
 assert.deepEqual(await qa.read(),baseline,'preview/print never save or replace daily history');
 assert.deepEqual((await qa.db.query("select collection,entity_id,to_jsonb(t) value,xmin::text,ctid::text from ship_dynamics_records t order by collection,entity_id")).rows,beforePhysical,'pure reports do not write physical business rows');
 assert.ok(evidence.reads.every(r=>r.scope!=='full'&&!r.unrelatedHistory));
 await check('PDF-explicit-sync-invalidates-preview-next-capture-gets-current-data',async()=>{
   currentCase='freeze';await click('開啟 PDF 預覽');await until(async()=>Boolean(await paper()),'frozen baseline preview');const frozen=await paper();
   // Isolated SQL fixture mutation models a peer commit; NOT a product writer test.
   await qa.db.transaction(async tx=>{
     await tx.query("update ship_dynamics_records set value=jsonb_set(value,'{status}',to_jsonb($1::text)),revision=revision+1 where workspace_key=$2 and collection='tasks' and entity_id='mw-history-3'",['PDF PEER CONFIRMED PROGRESS',qa.workspace]);
     await tx.query("update ship_dynamics_record_workspaces set root=jsonb_set(root,'{revision}',to_jsonb(revision+1)),revision=revision+1 where workspace_key=$1",[qa.workspace]);
   });
   assert.equal(await paper(),frozen,'peer change cannot silently replace already accepted preview');
   const start=qa.metrics.length;await click('同步最新（安全合併）');await until(()=>qa.metrics.slice(start).some(r=>r.rpc==='read_ship_dynamics_record_scopes_v2'&&r.revision===2),'new peer revision returned by real SQL');await until(async()=>await evaluate("[...document.querySelectorAll('button')].some(n=>n.innerText==='同步最新（安全合併）'&&!n.disabled)&&!document.querySelector('.save-status-strip.saving')"),'original sync idle');
   assert.equal(await paper(),'','explicit sync invalidates capture through the original config-I/O epoch; do not weaken it');await click('開啟 PDF 預覽');await until(async()=>(await paper()).includes('PDF PEER CONFIRMED PROGRESS'),'next capture reads current confirmed content');assert.match(await paper(),/rev\.2/);await click('關閉');
 });
 assert.deepEqual(evidence.errors,[]);
 evidence.status='PASS';console.log(JSON.stringify({status:'PASS',output,scenarios:evidence.scenarios,fullControl:evidence.fullControl,reads:evidence.reads}));
}catch(error){failure=error;try{evidence.failureText=await text();await snapshot('failure-readback');await screen('failure');}catch{};evidence.error=error.message;console.error(JSON.stringify({qa:'FAILED',error:error.message.slice(0,700),output,body:evidence.failureText?.slice(0,3500)}));}
finally{
 releaseHeldReceipt?.();
 evidence.metrics=qa?.metrics||[];
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome closed',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome tree stopped',5000);}}
 try{if(qa)await qa.close();if(native)await native.close();}catch(error){failure??=error;}
 if(!failure){try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
 try{if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);evidence.cleanup={httpStopped:true,chromeStopped:true,ownedChromePid:browser?.pid};}catch(error){failure??=error;evidence.cleanup={error:error.message};}
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(failure)process.exitCode=1;
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {prepareRecordPerformanceFixture,fixtureCounts} from './record-performance-fixture.mjs';

const tracer=process.argv.includes('--tracer-only');
const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'vessel-freshness-ui-'));
const evidence={label:'真實 UI＋測試資料＋本機 PGlite owner SQL；非 hosted / Realtime / 多連線',base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tracer,pollMs:25,samples:[],fixtures:[],errors:[],blockedExternal:[],network:[],metrics:[],cleanup:[]};
const save=()=>fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=30_000)=>{const end=performance.now()+timeout;while(performance.now()<end){const result=await fn();if(result)return result;await wait(25);}throw new Error('timeout: '+label);};
const epoch=()=>performance.timeOrigin+performance.now();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scrub=value=>JSON.parse(JSON.stringify(value,(k,v)=>/password|token|anonkey/i.test(k)?'[omitted]':v));
const workspace='isolated-record-ui-qa';
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const observer=`(()=>{
 const now=()=>performance.timeOrigin+performance.now();window.__perf={gateReady:null,action:null};
 const inspect=()=>{const s=window.__perf;const text=document.body?.innerText||'';if(!s.gateReady&&text.includes('請輸入管理者設定的進站密碼。'))s.gateReady=now();
  const a=s.action;if(!a?.start)return;const stamp=k=>{a[k]??=now();};
  if(a.kind==='open'){const n=${field};if(n&&n.getClientRects().length&&!n.matches(':disabled'))stamp('editable');}
  if(a.kind==='save'){const strip=document.querySelector('.save-status-strip');if(strip&&!strip.classList.contains('saved'))a.sawBusy=true;if(a.sawBusy&&strip?.classList.contains('saved'))stamp('ackVisible');if(!document.querySelector('[role=dialog]'))stamp('closed');}
  if(a.kind==='sync'&&text.includes(a.marker)&&document.querySelector('.save-status-strip.saved'))stamp('visible');
 };
 document.addEventListener('click',e=>{const a=window.__perf.action;if(a&&!a.start&&e.target.closest('button')?.innerText.trim()===a.button){a.start=now();queueMicrotask(inspect);}},true);
 new MutationObserver(inspect).observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
})()`;
let failure;
for(const size of ['small']){
 let qa,browser,ws,sessionId,helpers;const profile=path.join(output,'chrome-'+size);const pending=new Map();let nextId=0;
 const call=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20_000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
 const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const text=()=>evaluate("document.body?.innerText||''");
 const click=async(label,index=0,expected=1)=>{await evaluate(`(()=>{const n=[...document.querySelectorAll('button')].filter(n=>n.innerText.trim()===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled);if(n.length!==${expected})throw new Error('button cardinality ${label}: '+n.length);n[${index}].focus();if(document.activeElement!==n[${index}])throw new Error('focus failed');})()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});};
 const fill=async(expression,value)=>{await evaluate(`(()=>{const n=${expression};if(!n||n.matches(':disabled'))throw new Error('input unavailable');n.focus();n.select();})()`);await call('Input.insertText',{text:value});};
 const arm=(kind,button,marker='')=>evaluate(`void(window.__perf.action=${JSON.stringify({kind,button,marker})})`);
 const action=()=>evaluate('window.__perf.action');
 const leases=async()=> (await qa.db.query("select section_key,locked_by,expires_at::text from ship_dynamics_edit_locks where workspace_key=$1 and expires_at>now() order by section_key",[workspace])).rows;
 const tuple=async()=> (await qa.db.query("select collection,entity_id,revision,xmin::text,ctid::text from ship_dynamics_records where workspace_key=$1 and not(collection='vessels' and entity_id='qa-v1') and collection<>'auditLogs' order by collection,entity_id",[workspace])).rows;
 const capture=async(name)=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
 const readback=async(name)=>{const data=await qa.read();fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify({revision:data.revision,payloadHash:hash(data.payload),payload:scrub(data.payload)},null,2));return data;};
 const client=new Map();
 const phase=(name,start,end)=>{assert.ok(Number.isFinite(start)&&Number.isFinite(end)&&end>=start,`${name} timestamps`);const rpc=qa.metrics.filter(m=>m.trace&&m.trace.requestStartedMs>=start&&m.trace.requestStartedMs<=end);return {name,startMs:start,endMs:end,wallMs:end-start,rpcCount:rpc.length,sqlMs:rpc.reduce((n,m)=>n+m.trace.sqlMs,0),requestBytes:rpc.reduce((n,m)=>n+m.trace.requestBytes,0),responseBytes:rpc.reduce((n,m)=>n+m.trace.responseBytes,0),rpc:rpc.map(m=>({rpc:m.rpc,operationId:m.operationId,revision:m.revision,...m.trace}))};};
 try{
  qa=await createRecordStorageLocalQa({performanceTrace:true,preparePerformanceFixture:async(initial,vite)=>{helpers=await prepareRecordPerformanceFixture(initial,vite,size);}});
  const baseline=await readback(size+'-baseline');const untouched=await tuple();
  const counts=fixtureCounts(baseline.payload);evidence.fixtures.push({size,counts,baselineRevision:baseline.revision});save();
  const api=createClient(qa.origin,'isolated-qa-not-a-service-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,options)=>{assert.ok(String(url).startsWith(qa.origin+'/rest/v1/rpc/'),'closed second-client RPC transport');return fetch(url,options);}}});
  const rpc=async(name,args)=>{const {data,error}=await api.rpc(name,{p_workspace_key:workspace,...args});assert.equal(error,null);assert.notEqual(data?.ok,false,`${name}: ${data?.code}`);return data;};
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(chrome));
  browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let port,socketPath;await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
  ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{
   const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
   if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){
    const expected=m.params.type==='confirm'&&['同步最新會保留本機修改並嘗試與雲端安全合併；只有本機沒有修改時才直接採用雲端資料。確定繼續？','請盡量以船端修改為主，確定要修改嗎？'].includes(m.params.message);
    if(!expected)evidence.errors.push('unexpected dialog: '+m.params.message);
    void call('Page.handleJavaScriptDialog',{accept:expected},m.sessionId).catch(e=>evidence.errors.push(e.message));
   }
   if(m.method==='Fetch.requestPaused'){
    const u=new URL(m.params.request.url);const allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);
    if(!allowed)evidence.blockedExternal.push({size,origin:u.origin,blocked:true});
    void call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId).catch(e=>evidence.errors.push(e.message));
   }
   if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(qa.origin+'/rest/v1/rpc/')){
    const b=JSON.parse(m.params.request.postData||'{}');const n={size,id:m.params.requestId,rpc:new URL(m.params.request.url).pathname.split('/').pop(),operationId:b.p_operation_id,requestMs:m.params.wallTime*1000,monotonic:m.params.timestamp};client.set(n.id,n);evidence.network.push(n);
   }
   if(m.method==='Network.responseReceived'&&client.has(m.params.requestId)){const n=client.get(m.params.requestId);n.httpStatus=m.params.response.status;n.responseMs=n.requestMs+(m.params.timestamp-n.monotonic)*1000;}
   if(m.method==='Network.loadingFinished'&&client.has(m.params.requestId)){const n=client.get(m.params.requestId);n.finishedMs=n.requestMs+(m.params.timestamp-n.monotonic)*1000;n.finishedObservedMs=epoch();}
  });
  const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:observer});
  const nav=epoch();await call('Page.navigate',{url:qa.origin});await until(()=>evaluate('Boolean(window.__perf?.gateReady)'),'cold authoritative gate');
  const gate=await evaluate('window.__perf.gateReady');const cold=phase('cold-bootstrap',nav,gate);assert.ok(cold.rpc.some(r=>r.rpc==='read_ship_dynamics_record_delta_v1'&&r.responseKind==='snapshot'));evidence.samples.push({size,iteration:0,phases:[cold]});save();
  await fill("document.querySelector('input[type=password]')",qa.password);await click('進入系統');await until(async()=>(await text()).includes('人員登入／切換'),'personnel login');await fill("document.querySelector('input[type=password]')",qa.password);await click('登入');
  await until(async()=>(await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'Owner homepage');
  await click('同步最新（安全合併）');await until(async()=>!(await text()).includes('身份、權限或船舶範圍已變更，請同步最新資料')&&await evaluate("Boolean(document.querySelector('.save-status-strip.saved'))"),'fresh authority');
  evidence.scenarios=[];
  await evaluate(`(()=>{
   window.__fresh={active:false,materializations:0,integrity:0,hold:false,held:false};
   const parse=JSON.parse,stringify=JSON.stringify,fetch=window.fetch.bind(window);
   JSON.parse=function(...args){const value=parse(...args);if(window.__fresh.active&&value?.vessels&&value?.tasks&&value?.settings&&/consumeCloudDeltaResponse|normalizedCloudRead/.test(new Error().stack))window.__fresh.materializations++;return value;};
   JSON.stringify=function(value,...args){if(window.__fresh.active&&value?.vessels&&value?.tasks&&value?.settings&&/fetchCloudDeltaData/.test(new Error().stack))window.__fresh.integrity++;return stringify(value,...args);};
   window.fetch=async(...args)=>{const shouldHold=window.__fresh.hold&&String(args[0]).includes('/rpc/read_ship_dynamics_record_delta_v1');if(shouldHold)window.__fresh.hold=false;const response=await fetch(...args);if(shouldHold){const data=await response.clone().json();window.__fresh.heldKind=data.status;window.__fresh.heldEmpty=data.status==='delta'&&data.collections.length===0&&Object.keys(data.root.set).length===0&&data.root.deleted.length===0;window.__fresh.held=true;await new Promise(resolve=>window.__fresh.release=resolve);}return response;};
  })()`);
  const begin=()=>evaluate('Object.assign(window.__fresh,{active:true,materializations:0,integrity:0,held:false,hold:false});true');
  const stop=()=>evaluate('window.__fresh.active=false;({materializations:window.__fresh.materializations,integrity:window.__fresh.integrity})');
  const close=async()=>{await click('取消並關閉');await until(()=>evaluate("!document.querySelector('[role=dialog]')"),'cancel closes');await until(async()=>(await leases()).length===0,'lease released');};
  const open=async()=>{await click('快速更新',0,counts.collections.vessels.count);await until(()=>evaluate(`Boolean(${field})`),'original editor');};
  const peer=async(vesselId,marker)=>{
   const owner='freshness-peer-'+randomUUID();await rpc('claim_ship_dynamics_edit_lock',{p_section_key:'vessel:'+vesselId,p_locked_by:owner,p_locked_by_name:'QA OWNER',p_ttl_seconds:60});
   const before=await rpc('read_ship_dynamics_records_v1',{}),next=structuredClone(before.payload);next.vessels.find(v=>v.id===vesselId).note.recentDynamics=marker;
   const audited=helpers.withAudit(next,next.users[0],'快速更新船舶','vessel',vesselId,'QA legal peer update');
   const guard=(await qa.db.query("select ship_dynamics_actor_guard($1::jsonb,'qa-owner') guard",[JSON.stringify(before.payload)])).rows[0].guard;
   const saved=await rpc('apply_ship_dynamics_record_patch_v1',{p_operation_id:randomUUID(),p_operations:helpers.buildCloudBlockPatch(before.payload,audited),p_saved_by:'QA OWNER',p_actor_user_id:'qa-owner',p_actor_guard:guard,p_authorization_guard:null,p_lock_guards:[{section_key:'vessel:'+vesselId,locked_by:owner}]});
   await rpc('release_ship_dynamics_edit_lock',{p_section_key:'vessel:'+vesselId,p_locked_by:owner});assert.equal((await qa.read()).revision,saved.revision);return saved;
  };
  await begin();const at=qa.metrics.length;await open();const nochange=await stop();
  evidence.nochange=nochange;save();assert.equal(nochange.materializations,0,'original editor actually avoids full cloud materialization');assert.ok(nochange.integrity>0,'full caller integrity check actually executed');
  assert.ok(qa.metrics.slice(at).some(m=>m.rpc==='read_ship_dynamics_record_delta_v1'&&m.trace.responseKind==='delta'));await capture('nochange-editor');await close();
  evidence.scenarios.push({id:'original-nochange',...nochange,layer:'real-ui-sql'});save();
  await peer('qa-v1','QA FRESH CHANGED');await begin();await open();const changed=await stop();assert.ok(changed.materializations>0);assert.equal(await evaluate(`(${field}).value`),'QA FRESH CHANGED');await capture('changed-editor');await close();
  evidence.scenarios.push({id:'original-changed',...changed,layer:'real-ui-sql'});save();
  await begin();await evaluate('window.__fresh.hold=true');await click('快速更新',0,counts.collections.vessels.count);await until(()=>evaluate('window.__fresh.held'),'held real SQL nochange');
  assert.equal(await evaluate('window.__fresh.heldEmpty'),true);assert.equal(await evaluate("Boolean(document.querySelector('[role=dialog]'))"),false,'no early open');
  await peer('qa-v2','QA FRESH NEWER PEER');
  const latest=await evaluate("import('/src/cloud.ts').then(m=>m.fetchCloudData())");
  assert.deepEqual(latest,JSON.parse(JSON.stringify(helpers.normalizeAppData((await qa.read()).payload))));
  await evaluate('window.__fresh.release();true');await until(()=>evaluate(`Boolean(${field})`),'race completes original editor');const race=await stop();assert.ok(race.materializations>0);
  assert.ok((await text()).includes('QA FRESH NEWER PEER'),'newer full model retained');await capture('race-editor');await close();
  evidence.scenarios.push({id:'original-held-old-newer',...race,layer:'real-ui-sql',noEarlyOpen:true});
  const verified=await evaluate("import('/src/cloud.ts').then(m=>m.fetchCloudData())");assert.deepEqual(verified,JSON.parse(JSON.stringify(helpers.normalizeAppData((await qa.read()).payload))));
  assert.deepEqual(await qa.itinerarySnapshot(),qa.itineraryBaseline);assert.equal((await leases()).length,0);assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(qa.metrics.every(m=>m.status==='SQL_OK'));
 }catch(e){failure=e;const message=String(e.message).split('\n')[0];evidence.errors.push(message);try{evidence.failureText=(await text()).slice(0,5000);}catch{}console.error(JSON.stringify({failed:true,size,error:message,output}));}
 finally{
  evidence.metrics.push(...(qa?.metrics||[]).map(m=>({size,...m})));save();
  if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
  if(browser){try{await until(()=>browser.exitCode!==null,'Chrome stopped',5000);}catch{browser.kill();}}
  try{if(qa)await qa.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));assert.ok(!browser||browser.exitCode!==null);evidence.cleanup.push({size,httpStopped:true,chromeStopped:true,ownedProcesses:0});}catch(e){failure??=e;evidence.cleanup.push({size,error:e.message});}
  // Remove only our isolated profile (contains synthetic login storage); never user Chrome.
  try{fs.rmSync(profile,{recursive:true,force:true});}catch(e){failure??=e;}
  save();
 }
 if(failure)break;
}
if(failure)process.exitCode=1;else console.log(JSON.stringify({pass:true,output,scenarios:evidence.scenarios,cleanup:evidence.cleanup}));

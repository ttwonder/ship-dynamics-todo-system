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
const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-performance-'));
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
for(const size of tracer?['small']:['small','medium']){
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
  for(let iteration=1;iteration<=(tracer?1:3);iteration++){
   const pre=await qa.read(),marker=`QA PERF ${size} SAVE ${iteration}`,remoteMarker=`QA PERF ${size} SYNC ${iteration}`;
   const metricAt=qa.metrics.length;
   await arm('open','快速更新');await click('快速更新',0,counts.collections.vessels.count);await until(async()=>(await action())?.editable,'original editor writable');const opened=await action();
   assert.equal((await leases()).length,1);
   await fill(field,marker);assert.equal(await evaluate(`(${field}).value`),marker);
   await arm('save','保存並關閉');await click('保存並關閉');await until(async()=>(await action())?.ackVisible&&(await action())?.closed,'same save ACK visible and closed');const savedAction=await action();
   const leaseStart=epoch();const released=await until(async()=>{const rows=await leases();return rows.length===0?{at:epoch(),rows}:false;},'released SQL lease');
   const saved=await readback(`${size}-${iteration}-saved`);assert.equal(saved.revision,pre.revision+1);assert.equal(saved.payload.vessels[0].note.recentDynamics,marker);
   const writes=qa.metrics.slice(metricAt).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1');assert.equal(writes.length,1);assert.equal(writes[0].status,'SQL_OK');assert.equal(writes[0].revision,saved.revision);
   assert.ok(evidence.network.some(n=>n.operationId===writes[0].operationId&&n.httpStatus===200),'same operation HTTP ACK');
   assert.ok(writes[0].trace.transactionEndedMs<=savedAction.ackVisible,'actual SQL commit precedes visible ACK');
   const releaseRpc=qa.metrics.slice(metricAt).find(m=>m.rpc==='release_ship_dynamics_edit_lock');assert.ok(releaseRpc&&releaseRpc.trace.requestStartedMs>=writes[0].trace.transactionEndedMs,'release only after committed operation');
   assert.deepEqual(await tuple(),untouched,'unselected record physical tuples');assert.deepEqual(saved.payload.vessels.slice(1),baseline.payload.vessels.slice(1));assert.deepEqual(saved.payload.tasks,baseline.payload.tasks);
   const ackNetwork=evidence.network.find(n=>n.operationId===writes[0].operationId);assert.ok(Number.isFinite(ackNetwork.finishedMs));
   const releaseNetwork=evidence.network.find(n=>n.rpc==='release_ship_dynamics_edit_lock'&&n.requestMs>=ackNetwork.finishedMs&&n.requestMs<=released.at);assert.ok(releaseNetwork&&Number.isFinite(releaseNetwork.finishedMs));
   // The original UI publishes "saved" after starting release. These are semantic,
   // overlapping windows, not additive slices. Keep the release RPC independently visible.
   const sample={size,iteration,operationId:writes[0].operationId,beforeRevision:pre.revision,savedRevision:saved.revision,phases:[phase('editor-open',opened.start,opened.editable),phase('save-ack-visible',savedAction.start,savedAction.ackVisible),phase('committed-ack-to-release-readback',ackNetwork.finishedMs,released.at)],ackVisibleMs:savedAction.ackVisible,commitAckMs:ackNetwork.finishedMs,closeObservedMs:savedAction.closed,releaseRpc:{...releaseRpc.trace,httpWallMs:releaseNetwork.finishedMs-releaseNetwork.requestMs},leaseReadback:{rows:released.rows,startedMs:leaseStart,endedMs:released.at},saveToReleaseMs:released.at-savedAction.start};
   // A distinct, authorized SupabaseJS client. Same real SQL actor/lease/CAS/audit rules.
   const peerStart=epoch(),owner='performance-peer-'+randomUUID();await rpc('claim_ship_dynamics_edit_lock',{p_section_key:'vessel:qa-v1',p_locked_by:owner,p_locked_by_name:'QA OWNER',p_ttl_seconds:60});
   const peerBase=await rpc('read_ship_dynamics_records_v1',{});const next=structuredClone(peerBase.payload);next.vessels[0].note.recentDynamics=remoteMarker;
   const audited=helpers.withAudit(next,next.users[0],'快速更新船舶','vessel','qa-v1','QA legal peer update');
   const guard=(await qa.db.query('select ship_dynamics_actor_guard($1::jsonb,\'qa-owner\') guard',[JSON.stringify(peerBase.payload)])).rows[0].guard;
   const peerId=randomUUID();const peer=await rpc('apply_ship_dynamics_record_patch_v1',{p_operation_id:peerId,p_operations:helpers.buildCloudBlockPatch(peerBase.payload,audited),p_saved_by:'QA OWNER',p_actor_user_id:'qa-owner',p_actor_guard:guard,p_authorization_guard:null,p_lock_guards:[{section_key:'vessel:qa-v1',locked_by:owner}]});
   assert.equal(peer.revision,saved.revision+1);await rpc('release_ship_dynamics_edit_lock',{p_section_key:'vessel:qa-v1',p_locked_by:owner});
   const peerRead=await qa.read();assert.equal(peerRead.revision,peer.revision);assert.equal(peerRead.payload.vessels[0].note.recentDynamics,remoteMarker);sample.peerPreparation={startMs:peerStart,endMs:epoch(),operationId:peerId,revision:peer.revision,excludedFromUiPhases:true};
   await arm('sync','同步最新（安全合併）',remoteMarker);await click('同步最新（安全合併）');await until(async()=>(await action())?.visible,'original sync new value visible');const synced=await action();sample.phases.push(phase('sync-visible',synced.start,synced.visible));
   // Verification traffic is outside the business timing windows. Complete adapter readback,
   // not a partial UI projection and not a simulated response.
   const verificationStart=epoch();const verified=await evaluate("import('/src/cloud.ts').then(m=>m.fetchCloudData())");sample.completeReadbackWindow=phase('verification-only-full-adapter-readback',verificationStart,epoch());assert.deepEqual(verified,JSON.parse(JSON.stringify(helpers.normalizeAppData(peerRead.payload))),'complete authoritative adapter readback');
   assert.deepEqual(await tuple(),untouched);assert.deepEqual(await qa.itinerarySnapshot(),qa.itineraryBaseline);
   await capture(`${size}-${iteration}-synced`);
   const beforeQuiet=qa.metrics.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length;await wait(1200);assert.equal(qa.metrics.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,beforeQuiet,'no trailing debounce save');assert.equal((await qa.read()).revision,peer.revision);assert.equal((await leases()).length,0);
   sample.completeReadbackHash=hash(verified);sample.noTrailingObservationMs=1200;sample.unselectedUnchanged=true;sample.completeReadback=true;
   await readback(`${size}-${iteration}-synced`);evidence.samples.push(sample);save();console.log(JSON.stringify({pass:true,size,iteration,phases:sample.phases.map(({name,wallMs,sqlMs,requestBytes,responseBytes,rpcCount})=>({name,wallMs,sqlMs,requestBytes,responseBytes,rpcCount}))}));
  }
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(qa.metrics.every(m=>m.status==='SQL_OK'));
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
if(!failure){
 const rows=evidence.samples.flatMap(s=>s.phases.map(p=>({size:s.size,iteration:s.iteration,name:p.name,wallMs:p.wallMs,sqlMs:p.sqlMs,rpcCount:p.rpcCount,requestBytes:p.requestBytes,responseBytes:p.responseBytes})));
 const groups=Map.groupBy(rows,r=>r.size+'/'+r.name);const stats=values=>{const v=values.toSorted((a,b)=>a-b);return {count:v.length,min:v[0],median:v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2,max:v.at(-1)};};
 const summary=[...groups].map(([scenario,items])=>({scenario,samples:items.length,...Object.fromEntries(['wallMs','sqlMs','rpcCount','requestBytes','responseBytes'].map(k=>[k,stats(items.map(i=>i[k]))]))}));
 assert.equal(rows.length,tracer?5:26);assert.equal(new Set(evidence.samples.filter(s=>s.iteration).map(s=>s.size+'/'+s.iteration)).size,tracer?1:6);
 fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({label:evidence.label,workflowCount:tracer?1:6,coldSamples:tracer?1:2,rows:rows.length,summary},null,2));
 fs.writeFileSync(path.join(output,'samples.csv'),Object.keys(rows[0]).join(',')+'\n'+rows.map(r=>Object.values(r).join(',')).join('\n')+'\n');
 console.log(JSON.stringify({pass:true,output,workflowCount:tracer?1:6,phaseRows:rows.length}));
}else process.exitCode=1;

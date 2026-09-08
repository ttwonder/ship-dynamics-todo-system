import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

// QA-only: original main.tsx -> App, native input, synthetic identities.
// No setters, write helpers, fabricated responses, external hosts or user profile.
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'ui-')),profile=path.join(run,'chrome');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-record-concurrency-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['scripts/verify-record-concurrency-browser.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const patchRpc='apply_ship_dynamics_record_patch_v1';
let native,qa,browser,ws,failure,chromePort,releaseCommit,barrier=null,currentCase='setup',next=0;
const pending=new Map(),actors=[],netRows=new Map(),paused=[];
let rendezvous=false;
const call=(method,params={},session)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
const portClosed=port=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));s.setTimeout(1000,()=>{s.destroy();resolve(false);});});
const scrub=v=>JSON.parse(JSON.stringify(v,(k,x)=>/password|token|guard|anonkey/i.test(k)?'[omitted]':x));
async function makePage(actor,context){
 const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId:context});
 const {sessionId:s}=await call('Target.attachToTarget',{targetId,flatten:true});
 const p={actor,s,targetId,context};
 p.eval=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},s);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 p.text=()=>p.eval("document.body?.innerText||''");
 p.key=async(key,code=key)=>{const extra=key==='Enter'?{windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'}:{};await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,...extra},s);await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,...(key==='Enter'?{windowsVirtualKeyCode:13}:{})},s);};
 p.activate=async expr=>{await p.eval(`(()=>{const n=${expr};if(!n||!n.getClientRects().length||n.disabled)throw new Error('visible enabled button required');n.focus();if(document.activeElement!==n)throw new Error('focus failed');})()`);await p.key('Enter');};
 p.click=label=>p.activate(`[...document.querySelectorAll('button')].find(n=>n.innerText.trim()===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled)`);
 p.fill=async(expr,value)=>{await p.eval(`(()=>{const n=${expr};if(!n||n.disabled||n.readOnly)throw new Error('editable input required');n.focus();n.select();})()`);await call('Input.insertText',{text:value},s);};
 p.screen=async name=>{fs.writeFileSync(path.join(run,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},s)).data,'base64'));};
 p.saved=()=>p.eval("Boolean(document.querySelector('.save-status-strip.saved'))&&!document.querySelector('[role=dialog]')");
 p.sync=async()=>{await p.click('同步最新（安全合併）');await until(()=>p.eval("Boolean(document.querySelector('.save-status-strip.saved'))"),'sync '+actor);};
 p.open=async id=>{await p.activate(`[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes(${JSON.stringify('QA VESSEL '+id.slice(-1))}))?.querySelector('button')&&[...([...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes(${JSON.stringify('QA VESSEL '+id.slice(-1))}))).querySelectorAll('button')].find(n=>n.innerText.trim()==='快速更新')`);await until(()=>p.eval(`Boolean(${field})&&!(${field}).disabled`),'original editor '+actor);};
 p.submit=async()=>{const labels=await p.eval("[...document.querySelectorAll('[role=dialog] button')].filter(n=>n.getClientRects().length&&!n.disabled&&n.innerText.includes('保存')).map(n=>n.innerText.trim())");assert.equal(labels.length,1,'one original editor Save');receipt.saveLabel=labels[0];await p.click(labels[0]);};
 for(const method of ['Page.enable','Runtime.enable','Network.enable'])await call(method,{},s);
 await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},s);
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},s);
 actors.push(p);return p;
}
async function login(p){
 await call('Page.navigate',{url:qa.origin},p.s);
 await until(async()=>(await p.text()).includes('請輸入管理者設定的進站密碼。'),'original site gate');
 await p.fill("document.querySelector('input[type=password]')",qa.password);await p.click('進入系統');
 await until(async()=>(await p.text()).includes('人員登入／切換'),'original personnel gate');
 const selector="document.querySelector('select[aria-label=登入人員]')";
 const index=await p.eval(`(()=>{const n=${selector};n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(p.actor)});})()`);assert.ok(index>=0);
 await p.key('Home');for(let i=0;i<index;i++)await p.key('ArrowDown');await p.key('Enter');
 await until(()=>p.eval(`(${selector}).value===${JSON.stringify(p.actor)}`),'native identity select');
 await p.fill("document.querySelector('input[type=password]')",qa.password);await p.click('登入');
 await until(async()=>!(await p.text()).includes('人員登入／切換')&&(await p.text()).includes(p.actor==='qa-owner'?'QA OWNER':'QA OPERATOR'),'original logged-in homepage');await p.sync();
}
const locks=async()=> (await native.observer.query("select section_key,locked_by from ship_dynamics_edit_locks where expires_at>now() order by section_key")).rows;
const read=async()=> (await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;
const untouched=async()=> (await native.observer.query("select to_jsonb(t) value,xmin::text,ctid::text from ship_dynamics_records t where collection<>'auditLogs' and not(collection='vessels' and entity_id in ('qa-v1','qa-v2')) order by collection,entity_id")).rows;
async function freshReadback(name,expected){
 const c=await native.connect('fresh_'+name),actual=(await c.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;await c.end();
 assert.deepEqual(actual,expected,'complete new SQL connection readback');
 const {normalizeAppData}=await qa.loadModule('/src/normalize.ts');
 for(const p of actors.filter(p=>!p.reader)){
  const fresh=await makePage(p.actor,p.context);fresh.reader=true;
  await call('Page.navigate',{url:qa.origin+'/__qa/blank'},fresh.s);
  await until(()=>fresh.eval("document.readyState==='complete'"),'fresh blank');
  const model=await fresh.eval(`import('/src/cloud.ts').then(m=>{return m.fetchCloudData(${JSON.stringify({supabaseUrl:qa.origin,supabaseAnonKey:'isolated-qa-not-a-service-key',workspaceKey:qa.workspace,tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'delta-v1'})});})`);
  assert.deepEqual(model,JSON.parse(JSON.stringify(normalizeAppData(actual.payload))),'new document complete original cloud read');
  await call('Target.closeTarget',{targetId:fresh.targetId});
 }
 fs.writeFileSync(path.join(run,name+'-readback.json'),JSON.stringify({hash:hash(actual),readback:scrub(actual)},null,2));
}
function verifyBusiness(before,after,markers){
 assert.equal(after.revision,before.revision+2,'exactly two successful original saves');
 const expected=structuredClone(before.payload);expected.revision=after.payload.revision;expected.updatedAt=after.payload.updatedAt;
 for(const [id,marker] of Object.entries(markers)){
  const v=after.payload.vessels.find(v=>v.id===id),old=expected.vessels.find(v=>v.id===id);
  assert.equal(v.note.recentDynamics,marker);assert.equal(v.note.subsequentDynamics,'');
  old.note.recentDynamics=marker;old.note.subsequentDynamics='';old.note.updatedAt=v.note.updatedAt;old.updatedAt=v.updatedAt;
  assert.deepEqual(v,old,'exact original operational edit mask');
 }
 const audits=after.payload.auditLogs.filter(a=>!before.payload.auditLogs.some(b=>b.id===a.id));assert.equal(audits.length,2);
 assert.equal(new Set(after.payload.auditLogs.map(a=>a.id)).size,after.payload.auditLogs.length);
 assert.deepEqual(audits.map(a=>[a.entityId,a.actorId]).sort(),[['qa-v1','qa-operator'],['qa-v2','qa-owner']]);
 for(const a of audits)assert.equal(a.action,'快速更新船舶');expected.auditLogs=after.payload.auditLogs;
 assert.deepEqual(after.payload,expected,'complete payload: no unrelated changes');
}
try{
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true,beforeCommit:async({context,pid,value})=>{
  if(barrier&&context.operationId===barrier.operationId){assert.equal(value.ok,true,'A real SQL executed successfully');barrier.pid=pid;barrier.entered=true;save();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('private commit barrier budget exceeded')),6000);releaseCommit=()=>{clearTimeout(timer);resolve();};});}
 }});
 qa=await createRecordStorageLocalQa({internalControl:true,databaseFactory:async()=>native.adapter});
 receipt.origin=qa.origin;assert.equal((await (await fetch(qa.origin+'/__qa/health')).json()).kind,'REAL_UI_SYNTHETIC_DATA_NATIVE_POSTGRES');
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socketPath;await until(()=>{try{[chromePort,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
 receipt.chrome={pid:browser.pid,port:Number(chromePort)};
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){
    const {type,message}=m.params,accept=type==='beforeunload'||type==='confirm'&&['同步最新會保留本機修改','請盡量以船端修改為主'].some(t=>message.startsWith(t));
    if(!accept)receipt.errors.push('unexpected dialog: '+message);await call('Page.handleJavaScriptDialog',{accept},m.sessionId);
   }
   if(m.method==='Fetch.requestPaused'){
    const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);
    if(!allowed)receipt.blockedExternal.push(u.origin);
    if(allowed&&rendezvous&&u.pathname.endsWith('/rpc/'+patchRpc)){
     const body=JSON.parse(m.params.request.postData);paused.push({session:m.sessionId,requestId:m.params.requestId,operationId:body.p_operation_id,actor:body.p_actor_user_id,payloadHash:hash(body),auditExpected:body.p_operations.find(o=>o.kind==='order'&&o.collection==='auditLogs')?.expectedIds});save();return;
    }
    await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);
   }
   if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(qa.origin+'/rest/v1/rpc/')){
    const b=JSON.parse(m.params.request.postData||'{}'),row={caseId:currentCase,actor:actors.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:b.p_operation_id,payloadHash:hash(b),started:m.params.wallTime*1000};
    netRows.set(m.sessionId+':'+m.params.requestId,row);receipt.network.push(row);
   }
   const row=netRows.get(m.sessionId+':'+m.params.requestId);
   if(m.method==='Network.responseReceived'&&row)row.httpStatus=m.params.response.status;
   if(m.method==='Network.loadingFinished'&&row){const response=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId);const v=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body);Object.assign(row,{finished:Date.now(),result:v?.ok===false?v.code:'SQL_OK',conflictKey:v?.conflict_key,revision:v?.revision});save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });
 const contextA=(await call('Target.createBrowserContext')).browserContextId,contextB=(await call('Target.createBrowserContext')).browserContextId;
 const a=await makePage('qa-owner',contextA),b=await makePage('qa-operator',contextB);await login(a);await login(b);
 const formal=await qa.itinerarySnapshot(),other=await untouched();
 currentCase='U1';const before=await read();await a.open('qa-v2');await b.open('qa-v1');
 assert.equal((await locks()).length,2);assert.equal(new Set((await locks()).map(l=>l.locked_by)).size,2);
 await b.fill(field,'U1 B UNSAVED THEN SAVED');await b.eval(`void(window.__draftNode=${field})`);
 await a.fill(field,'U1 A SAVED');await a.submit();await until(()=>a.saved(),'U1 A visible ACK + close');
 assert.equal((await read()).payload.vessels.find(v=>v.id==='qa-v1').note.recentDynamics,before.payload.vessels.find(v=>v.id==='qa-v1').note.recentDynamics,'B draft not submitted');
 await b.sync();await until(async()=>(await b.text()).includes('雲端已有較新資料；目前編輯或保存完成後會自動安全刷新'),'B original newer-cloud notice defers publication while editing');
 assert.ok(receipt.network.some(r=>r.caseId==='U1'&&r.actor==='qa-operator'&&/^read_ship_dynamics_record/.test(r.rpc)&&r.revision===before.revision+1),'B actual HTTP read observes peer revision');
 assert.equal(await b.eval(`window.__draftNode===${field}&&window.__draftNode.value==='U1 B UNSAVED THEN SAVED'`),true,'same editor DOM and draft survive peer publication');
 assert.deepEqual((await locks()).map(l=>l.section_key),['vessel:qa-v1']);await b.screen('U1-peer-ACK-draft-retained');
 await b.submit();await until(()=>b.saved(),'U1 B visible ACK + close');await until(async()=>(await locks()).length===0,'U1 released');
 const after=await read();verifyBusiness(before,after,{'qa-v1':'U1 B UNSAVED THEN SAVED','qa-v2':'U1 A SAVED'});await freshReadback('U1',after);
 receipt.cases.push({caseId:'U1',layer:'real-ui-native-sql',status:'PASS',sameDraftNode:true,uniqueAudits:2,completeFreshReads:3});save();console.log('PASS U1',run);
 currentCase='U2';await a.sync();await b.sync();const base=await read();await a.open('qa-v2');await b.open('qa-v1');
 await a.fill(field,'U2 A SAVED');await b.fill(field,'U2 B RETRIED SAVED');await b.eval(`void(window.__draftNode=${field})`);
 rendezvous=true;await Promise.all([a.submit(),b.submit()]);await until(()=>paused.length===2,'two real outgoing original saves');rendezvous=false;
 const pa=paused.find(p=>p.actor==='qa-owner'),pb=paused.find(p=>p.actor==='qa-operator');assert.ok(pa&&pb);assert.deepEqual(pa.auditExpected,pb.auditExpected,'same base audit order');assert.ok(Array.isArray(pa.auditExpected));
 receipt.rendezvous=paused.map(({requestId,session,...safe})=>safe);barrier={operationId:pa.operationId};
 await call('Fetch.continueRequest',{requestId:pa.requestId},pa.session);await until(()=>barrier.entered,'A SQL before COMMIT',4000);
 await call('Fetch.continueRequest',{requestId:pb.requestId},pb.session);
 const blocking=await until(async()=>{const rows=(await native.observer.query("select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where application_name like 'record_native_http_%' and wait_event_type='Lock'")).rows;return rows.find(r=>r.blockers.includes(barrier.pid));},'actual PG B waits for A',4000);
 const btx=receipt.httpTransactions.find(r=>r.operationId===pb.operationId);assert.equal(blocking.pid,btx.pid);assert.notEqual(blocking.pid,barrier.pid);
 assert.equal((await read()).revision,base.revision,'A uncommitted not published');assert.equal((await locks()).length,2,'no premature lease release');
 assert.equal(await b.eval(`window.__draftNode===${field}&&window.__draftNode.value==='U2 B RETRIED SAVED'`),true);
 receipt.blocking={aPid:barrier.pid,bPid:blocking.pid,...blocking};save();await b.screen('U2-native-wait-draft');releaseCommit();barrier=null;
 await until(()=>a.saved(),'U2 A ACK');await until(()=>b.saved(),'U2 B original automatic retry ACK');await until(async()=>(await locks()).length===0,'U2 release');
 await until(()=>receipt.network.some(r=>r.operationId!==pb.operationId&&r.actor==='qa-operator'&&r.caseId==='U2'&&r.rpc===patchRpc&&r.result==='SQL_OK'),'actual HTTP retry response');
 const chain=receipt.network.filter(r=>r.caseId==='U2'&&r.actor==='qa-operator'&&r.rpc===patchRpc);assert.equal(chain.length,2);assert.equal(chain[0].result,'block-conflict');assert.equal(chain[0].conflictKey,'order:auditLogs');assert.equal(chain[1].result,'SQL_OK');assert.notEqual(chain[0].operationId,chain[1].operationId);assert.notEqual(chain[0].payloadHash,chain[1].payloadHash);assert.ok(chain.every(r=>r.httpStatus===200));
 assert.ok(receipt.network.some(r=>r.actor==='qa-operator'&&r.started>=chain[0].started&&r.started<chain[1].started&&/^read_ship_dynamics_record/.test(r.rpc)),'App fetch between conflict and retry');
 const final=await read();verifyBusiness(base,final,{'qa-v1':'U2 B RETRIED SAVED','qa-v2':'U2 A SAVED'});await freshReadback('U2',final);await b.screen('U2-ACK');
 assert.deepEqual(await qa.itinerarySnapshot(),formal);assert.deepEqual(await untouched(),other);assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.blockedExternal,[]);
 receipt.cases.push({caseId:'U2',layer:'real-ui-native-sql-controlled-schedule',status:'PASS',automaticRetry:true,retryChain:chain,blocking:receipt.blocking,uniqueAudits:2,completeFreshReads:3});receipt.status='PASS';save();console.log('PASS U2',run);
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseCommit?.();rendezvous=false;receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});}}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)assert.equal(await portClosed(Number(chromePort)),true);assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

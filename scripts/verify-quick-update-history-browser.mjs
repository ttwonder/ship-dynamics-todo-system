import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installShipInternalControlFixture} from './ship-internal-control-local-fixture.mjs';
import {createServer as createViteServer} from 'vite';

const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));
fs.mkdirSync(root,{recursive:true});const run=fs.mkdtempSync(path.join(root,'quick-history-')),profile=path.join(run,'chrome');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const receipt={kind:'original-App-native-PG-synthetic',status:'RUNNING',cases:[],network:[],errors:[],dialogs:[],blockedExternal:[],productionContacted:false};
receipt.inputs=Object.fromEntries(['src/App.tsx','src/cloudRebase.ts','src/cloudRecordScopes.ts','scripts/verify-quick-update-history-browser.mjs'].map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));

const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const patchRpc='apply_ship_dynamics_record_patch_v1';
let native,qa,baselineVite,browser,ws,failure,chromePort,currentCase='setup',next=0;
const pending=new Map(),actors=[],netRows=new Map();
const outgoing=[];
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
 p.click=async label=>{const expr=`[...document.querySelectorAll('button')].find(n=>n.innerText.trim()===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled)`;await until(()=>p.eval(`Boolean(${expr})`),'ready button '+label);await p.activate(expr);};
 p.fill=async(expr,value)=>{await p.eval(`(()=>{const n=${expr};if(!n||n.disabled||n.readOnly)throw new Error('editable input required');n.focus();n.select();})()`);await call('Input.insertText',{text:value},s);};
 p.screen=async name=>{fs.writeFileSync(path.join(run,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},s)).data,'base64'));};
 p.saved=()=>p.eval("Boolean(document.querySelector('.save-status-strip.saved'))&&!document.querySelector('[role=dialog]')");
 p.sync=async()=>{const start=receipt.network.length;await p.click('同步最新（安全合併）');await until(()=>receipt.network.slice(start).some(r=>r.actor===actor&&/^read_ship_dynamics_record/.test(r.rpc)&&r.finished),'sync HTTP '+actor);await until(()=>p.eval("[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='同步最新（安全合併）'&&!n.disabled)&&!document.querySelector('.save-status-strip.saving')"),'sync idle '+actor);};
 p.open=async id=>{await p.activate(`[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes(${JSON.stringify('QA VESSEL '+id.slice(-1))}))?.querySelector('button')&&[...([...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes(${JSON.stringify('QA VESSEL '+id.slice(-1))}))).querySelectorAll('button')].find(n=>n.innerText.trim()==='快速更新')`);await until(()=>p.eval(`Boolean(${field})&&!(${field}).disabled`),'original editor '+actor);};
 p.submit=async()=>{const labels=await p.eval("[...document.querySelectorAll('[role=dialog] button')].filter(n=>n.getClientRects().length&&!n.disabled&&n.innerText.includes('保存')).map(n=>n.innerText.trim())");assert.equal(labels.length,1,'one original editor Save');receipt.saveLabel=labels[0];await p.click(labels[0]);};
 for(const method of ['Page.enable','Runtime.enable','Network.enable','Debugger.enable'])await call(method,{},s);
 await call('Debugger.setPauseOnExceptions',{state:'all'},s);
 await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},s);
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},s);
 actors.push(p);return p;
}
async function login(p){
 await call('Page.navigate',{url:qa.origin},p.s);
 await until(async()=>(await p.text()).includes('請輸入管理者設定的進站密碼。'),'original site gate');
 await p.fill("document.querySelector('input[type=password]')",qa.password);await p.click('進入系統');
 await until(async()=>(await p.text()).includes('人員登入／切換'),'original personnel gate');
 if(p.actor==='qa-vessel'){await p.eval("document.querySelector('select[aria-label=登入部門]').focus()");await p.key('End');await p.key('Enter');await until(()=>p.eval("[...document.querySelector('select[aria-label=登入人員]').options].some(o=>o.value==='qa-vessel')"),'vessel roster');}
 const selector="document.querySelector('select[aria-label=登入人員]')";
 const index=await p.eval(`(()=>{const n=${selector};n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(p.actor)});})()`);assert.ok(index>=0);
 await p.key('Home');for(let i=0;i<index;i++)await p.key('ArrowDown');await p.key('Enter');
 await until(()=>p.eval(`(${selector}).value===${JSON.stringify(p.actor)}`),'native identity select');
 if(await p.eval("Boolean(document.querySelector('input[type=password]'))"))await p.fill("document.querySelector('input[type=password]')",qa.password);await p.click('登入');
 await until(async()=>!(await p.text()).includes('人員登入／切換')&&(await p.text()).includes(p.actor==='qa-owner'?'QA OWNER':p.actor==='qa-vessel'?'QA VESSEL ACCOUNT':'QA OPERATOR'),'original logged-in homepage');await p.sync();
}
const locks=async()=> (await native.observer.query("select section_key,locked_by from ship_dynamics_edit_locks where expires_at>now() order by section_key")).rows;
const read=async()=> (await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;

try{
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,taskMember:true,performanceTrace:true,hmr:false,databaseFactory:async()=>native.adapter,preparePerformanceFixture:async initial=>{
  const c=structuredClone(initial.internalControlCases[0]);c.id='qa-preview-case';c.description='QA PREVIEW CASE';c.vesselId='qa-v2';delete c.linkedTaskId;c.syncToTask=false;c.isClosed=false;
  c.status='original history 0';c.statusLogs=Array.from({length:4},(_,i)=>({id:'ship-internal-log-qa-'+i,at:initial.updatedAt,by:'QA OWNER',text:'original history '+i}));
  initial.tasks=[];initial.internalControlCases=[c];initial.meetings=[];initial.notifications=[];initial.auditLogs=[];
 }});
 await installShipInternalControlFixture(qa.db,qa.workspace);
 if(process.env.QA_QUICK_BASELINE==='1'){
  const baseline=execFileSync('git',['show','084fc6bd1fbb0fd4f307528a8d0e6460b41b9d5b:src/App.tsx'],{encoding:'utf8',maxBuffer:2_000_000});
  receipt.baseline={commit:'084fc6bd1fbb0fd4f307528a8d0e6460b41b9d5b',appSha256:createHash('sha256').update(baseline).digest('hex'),inMemoryOnly:true};
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  baselineVite=await createViteServer({cacheDir:path.join(run,'vite'),server:{middlewareMode:true,hmr:false,ws:{host:'127.0.0.1',port,clientPort:port}},logLevel:'silent',plugins:[{name:'immutable-original-App-baseline',enforce:'pre',transform(_code,id){if(id.replaceAll('\\','/').endsWith('/src/App.tsx'))return baseline;}}]});
  qa.setUiMiddleware(baselineVite.middlewares);
 }
 receipt.origin=qa.origin;assert.equal((await (await fetch(qa.origin+'/__qa/health')).json()).kind,'REAL_UI_SYNTHETIC_DATA_NATIVE_POSTGRES');

 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socketPath;await until(()=>{try{[chromePort,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
 receipt.chrome={pid:browser.pid,port:Number(chromePort)};
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.text);
   if(m.method==='Debugger.paused'){
    receipt.exceptions??=[];receipt.exceptions.push({caseId:currentCase,reason:m.params.reason,description:m.params.data?.description,frames:m.params.callFrames.slice(0,3).map(f=>f.functionName)});
    await call('Debugger.resume',{},m.sessionId);
   }
   if(m.method==='Page.javascriptDialogOpening'){
    const {type,message}=m.params,accept=type==='beforeunload'||type==='confirm'&&['同步最新會保留本機修改','請盡量以船端修改為主','確定批量完成所選','確定結案會議','確定重新開啟會議','確定重新開啟此待辦'].some(t=>message.startsWith(t));
    receipt.dialogs.push({caseId:currentCase,type,message});await call('Page.handleJavaScriptDialog',{accept},m.sessionId);
   }
   if(m.method==='Fetch.requestPaused'){
    const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);
    if(!allowed)receipt.blockedExternal.push(u.origin);
    if(allowed&&[patchRpc,'save_ship_dynamics_task_member_v1'].some(name=>u.pathname.endsWith('/rpc/'+name))){outgoing.push({caseId:currentCase,body:JSON.parse(m.params.request.postData),captured:Date.now()});fs.writeFileSync(path.join(run,'outgoing-before-sql.json'),JSON.stringify(outgoing.map(r=>({...r,body:scrub(r.body)})),null,2));}

    await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);
   }
   if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(qa.origin+'/rest/v1/rpc/')){
    const b=JSON.parse(m.params.request.postData||'{}'),row={caseId:currentCase,actor:actors.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:b.p_operation_id,readScope:b.p_scope,targets:b.p_targets,payloadHash:hash(b),started:m.params.wallTime*1000};
    netRows.set(m.sessionId+':'+m.params.requestId,row);receipt.network.push(row);
   }
   const row=netRows.get(m.sessionId+':'+m.params.requestId);
   if(m.method==='Network.responseReceived'&&row)row.httpStatus=m.params.response.status;
   if(m.method==='Network.loadingFinished'&&row){const response=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId);const v=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body);if(/^read_ship_dynamics_record/.test(row.rpc))fs.writeFileSync(path.join(run,'response-'+receipt.network.indexOf(row)+'.json'),JSON.stringify(scrub(v),null,2));Object.assign(row,{containsUnloadedDetail:JSON.stringify(v).includes('QA_UNLOADED_DETAIL_SENTINEL'),containsOtherMeetingHistory:JSON.stringify(v).includes('QA_OTHER_MEETING_HISTORY'),finished:Date.now(),result:v?.ok===false?v.code:'SQL_OK',conflictKey:v?.conflict_key,revision:v?.revision});save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });

 const a=await makePage('qa-owner',(await call('Target.createBrowserContext')).browserContextId);await login(a);
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const peerAppend=async()=>{
  const before=await read(),nextData=structuredClone(before.payload),c=nextData.internalControlCases[0],at=new Date().toISOString();
  c.status='peer appended 1';c.updatedAt=at;c.statusLogs.unshift(...[1,2].map(n=>({id:'peer-log-'+n,at,by:'QA OWNER',text:'peer appended '+n})));
  const ops=buildCloudBlockPatch(before.payload,nextData),section='internal-control:'+c.id,owner='qa-history-peer';
  const claimed=(await native.observer.query('select claim_ship_dynamics_edit_lock($1,$2,$3,$4,75) r',[qa.workspace,section,owner,'QA PEER'])).rows[0].r;assert.equal(claimed.ok,true);
  try{
   const result=(await native.observer.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,ship_dynamics_actor_guard($6::jsonb,$5),null,$7::jsonb) r',[qa.workspace,'qa-peer-'+Date.now(),JSON.stringify(ops),'QA OWNER','qa-owner',JSON.stringify(before.payload),JSON.stringify([{section_key:section,locked_by:owner}])])).rows[0].r;assert.equal(result.ok,true,JSON.stringify(result));
  }finally{await native.observer.query('select release_ship_dynamics_edit_lock($1,$2,$3)',[qa.workspace,section,owner]);}
  return (await read()).payload.internalControlCases;
 };
 currentCase='QH01-healthy-open-readonly';let before=await read(),start=receipt.network.length,opened=performance.now();
 await a.open('qa-v1');receipt.healthyOpenMs=Math.round(performance.now()-opened);assert.deepEqual(await read(),before);assert.equal(receipt.network.slice(start).some(r=>r.rpc===patchRpc),false);await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('#vessel-edit-title')"),'cancel');
 receipt.cases.push({caseId:currentCase,status:'PASS',openMs:receipt.healthyOpenMs,zeroBusinessWrites:true});
 currentCase='QH02-unrelated-history-slides-during-edit';await a.open('qa-v1');
 const expectedCases=await peerAppend();await a.fill(field,'QUICK HISTORY PRESERVED');start=receipt.network.length;
 await a.submit();await until(async()=>await a.saved()||receipt.dialogs.some(d=>d.caseId===currentCase)||await a.eval("Boolean(document.querySelector('.save-status-strip.error'))"),'save settles');
 assert.equal(await a.saved(),true,'unrelated append-only history must not block quick save: '+JSON.stringify(receipt.dialogs));
 const after=await read();assert.equal(after.payload.vessels[0].note.recentDynamics,'QUICK HISTORY PRESERVED');assert.deepEqual(after.payload.internalControlCases,expectedCases);assert.equal(receipt.network.slice(start).filter(r=>r.rpc===patchRpc).length,1);assert.deepEqual(await locks(),[]);await a.screen('history-preserved');
 receipt.cases.push({caseId:currentCase,status:'PASS',writerCount:1,allSixHistoryEntriesRetained:true});
 currentCase='QH03-reopen-after-merged-save';opened=performance.now();start=receipt.network.length;await a.open('qa-v1');assert.equal(receipt.network.slice(start).some(r=>r.rpc===patchRpc),false,'opening a confirmed save must not write');await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('#vessel-edit-title')"),'second cancel');assert.deepEqual(await read(),after);receipt.cases.push({caseId:currentCase,status:'PASS',openMs:Math.round(performance.now()-opened)});
 currentCase='QH04-committed-lost-ACK';await a.open('qa-v1');await a.fill(field,'QUICK LOST ACK CONFIRMED');let dropped=false;
 qa.setRecordFault({after:async({name})=>{if(name===patchRpc&&!dropped){dropped=true;return true;}return false;}});start=receipt.network.length;await a.submit();await until(()=>a.saved(),'receipt reconciled committed ACK',30000);
 const ack=await read();assert.equal(ack.payload.vessels[0].note.recentDynamics,'QUICK LOST ACK CONFIRMED');assert.deepEqual(ack.payload.internalControlCases,expectedCases);assert.equal(receipt.network.slice(start).filter(r=>r.rpc===patchRpc).length,1);assert.ok(receipt.network.slice(start).some(r=>r.rpc==='get_ship_dynamics_record_receipt_v1'));qa.setRecordFault(null);
 receipt.cases.push({caseId:currentCase,status:'PASS',writerCount:1,receiptReadback:true});
 currentCase='QH05-client-deadline-after-native-commit';await a.open('qa-v1');await a.fill(field,'QUICK DEADLINE CONFIRMED');let delayed=false;
 qa.setRecordFault({after:async({name})=>{if(name===patchRpc&&!delayed){delayed=true;await wait(13000);}return false;}});start=receipt.network.length;await a.submit();await until(()=>a.saved(),'client deadline reconciled from exact receipt',30000);
 const timed=await read();assert.equal(timed.payload.vessels[0].note.recentDynamics,'QUICK DEADLINE CONFIRMED');assert.deepEqual(timed.payload.internalControlCases,expectedCases);assert.equal(receipt.network.slice(start).filter(r=>r.rpc===patchRpc).length,1);assert.ok(receipt.network.slice(start).some(r=>r.rpc==='get_ship_dynamics_record_receipt_v1'));assert.ok(receipt.exceptions.some(e=>e.caseId===currentCase&&e.description?.includes('compact 原子區塊保存逾時')),'actual client deadline must fire');qa.setRecordFault(null);
 receipt.cases.push({caseId:currentCase,status:'PASS',writerCount:1,realClientDeadline:true,exactReceiptReadback:true});
 currentCase='QH06-native-rollback-keeps-draft';await a.open('qa-v1');await a.fill(field,'QUICK RETRY RETAINED');before=await read();
 // Owned fixture only: force a native statement failure inside the real writer
 // transaction. This injected SQLSTATE is not a production root-cause claim.
 await native.observer.query(`create function public.qa_quick_fail_write() returns trigger language plpgsql as $$begin raise exception 'QA injected statement cancellation' using errcode='57014';end$$;
 create trigger qa_quick_fail_write before update on public.ship_dynamics_records for each row when (new.collection='vessels' and new.entity_id='qa-v1') execute function public.qa_quick_fail_write();`);
 start=receipt.network.length;await a.submit();await until(()=>a.eval("Boolean(document.querySelector('.save-status-strip.error'))"),'native rollback feedback',35000);
 assert.deepEqual(await read(),before,'SQL rollback must leave the complete snapshot unchanged');assert.equal(await a.eval(`(${field}).value`),'QUICK RETRY RETAINED');assert.equal(await a.saved(),false);assert.ok(qa.metrics.some(m=>m.rpc===patchRpc&&m.status==='SQL_ERROR'&&m.code==='57014'));await a.screen('rollback-draft-retained');
 const rejectedOps=[...new Set(receipt.network.slice(start).filter(r=>r.rpc===patchRpc).map(r=>r.operationId))];assert.equal(rejectedOps.length,1,'transport reconciliation retains the same immutable operation');
 receipt.cases.push({caseId:currentCase,status:'PASS',nativeSqlstate:'57014-injected',fullRollback:true,draftRetained:true});
 await native.observer.query('drop trigger qa_quick_fail_write on public.ship_dynamics_records;drop function public.qa_quick_fail_write();');
 currentCase='QH07-visible-save-after-recovered-failure';start=receipt.network.length;await a.submit();await until(()=>a.saved(),'manual retry succeeds',30000);
 const retried=await read();assert.equal(retried.payload.vessels[0].note.recentDynamics,'QUICK RETRY RETAINED');assert.deepEqual(retried.payload.internalControlCases,expectedCases);assert.equal(receipt.network.slice(start).filter(r=>r.rpc===patchRpc).length,1);assert.deepEqual(await locks(),[]);
 receipt.cases.push({caseId:currentCase,status:'PASS',originalSaveControl:true,writerCount:1,allHistoryRetained:true});
 currentCase='QH08-real-old-history-rewrite-rejected';await a.open('qa-v1');await a.fill(field,'MUST NOT SAVE OVER REWRITTEN HISTORY');
 // Deliberately corrupt one previously trusted old log in the private fixture,
 // rather than weakening the production writer's immutable-history rules.
 const corrupt=structuredClone(retried.payload.internalControlCases[0]);corrupt.statusLogs.find(l=>l.id==='peer-log-2').text='QA real rewrite of an old log';
 await native.observer.query(`with bumped as (update public.ship_dynamics_record_workspaces set revision=revision+1,root=jsonb_set(root,'{revision}',to_jsonb(revision+1)) where workspace_key=$1 returning revision)
 update public.ship_dynamics_records set value=$2::jsonb,revision=(select revision from bumped) where workspace_key=$1 and collection='internalControlCases' and entity_id=$3`,[qa.workspace,JSON.stringify(corrupt),corrupt.id]);
 before=await read();start=receipt.network.length;await a.submit();await until(()=>a.eval("Boolean(document.querySelector('.save-status-strip.error'))"),'true immutable-history conflict');
 assert.deepEqual(await read(),before);assert.equal(receipt.network.slice(start).filter(r=>r.rpc===patchRpc).length,0);assert.equal(await a.eval(`(${field}).value`),'MUST NOT SAVE OVER REWRITTEN HISTORY');assert.equal(await a.saved(),false);assert.ok(receipt.exceptions.some(e=>e.caseId===currentCase&&e.description?.includes('internalControlCases:qa-preview-case.statusLogs:peer-log-2')));await a.screen('real-history-conflict-retained');
 receipt.cases.push({caseId:currentCase,status:'PASS',zeroBusinessWrites:true,originalHistoryGuard:true,draftRetained:true});
 assert.equal(receipt.cases.length,8);assert.equal(new Set(receipt.cases.map(c=>c.caseId)).size,8);
 assert.deepEqual(receipt.errors,[]);receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,6)};for(const p of actors){try{receipt.failureText=(await p.text()).slice(0,8000);await p.screen('failure');}catch{}}}
finally{
 receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});}}
 try{await baselineVite?.close();await qa?.close();await native?.close();receipt.cleanup={pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,chromeStopped:!browser||browser.exitCode!==null||browser.signalCode!==null,chromePortClosed:!chromePort||await portClosed(Number(chromePort))};assert.ok(Object.values(receipt.cleanup).every(Boolean),'owned runtimes must be stopped');}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases,failure:receipt.failure,cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

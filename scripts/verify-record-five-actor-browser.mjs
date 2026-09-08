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
const run=fs.mkdtempSync(path.join(root,'five-')),profile=path.join(run,'chrome');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-record-five-actor-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['scripts/verify-record-five-actor-browser.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','src/App.tsx'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const patchRpc='apply_ship_dynamics_record_patch_v1';
let native,qa,browser,ws,failure,chromePort,releaseCommit,barrier=null,currentCase='setup',next=0;
const pending=new Map(),actors=[],netRows=new Map(),paused=[];
const targets=[['qa-owner','qa-v2'],['qa-operator','qa-v1'],['qa-operator-3','qa-v3'],['qa-operator-4','qa-v4'],['qa-operator-5','qa-v5']];
receipt.rounds=[];receipt.actorResults=[];receipt.dialogs=[];receipt.contract={roundLimit:4,actors:5,preCommitBudgetMs:6000,productRpcTimeoutMs:12000};
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
 p.sync=async()=>{const start=receipt.network.length;await p.click('同步最新（安全合併）');await until(()=>receipt.network.slice(start).some(r=>r.actor===actor&&/^read_ship_dynamics_record/.test(r.rpc)&&r.finished),'sync HTTP '+actor);await until(()=>p.eval("[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='同步最新（安全合併）'&&!n.disabled)&&!document.querySelector('.save-status-strip.saving')"),'sync idle '+actor);};
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
const untouched=async()=> (await native.observer.query("select to_jsonb(t) value,xmin::text,ctid::text from ship_dynamics_records t where collection<>'auditLogs' and not(collection='vessels' and entity_id in ('qa-v1','qa-v2','qa-v3','qa-v4','qa-v5')) order by collection,entity_id")).rows;
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
// The existing opt-in preparation hook runs before import / HTTP listen.
async function fiveActorFixture(initial,vite){
 const operator=initial.users.find(u=>u.id==='qa-operator'),template=initial.vessels[1];
 for(let n=3;n<=6;n++){
  const id='qa-v'+n,actor='qa-operator-'+n;
  initial.vessels.push({...structuredClone(template),id,name:'QA VESSEL '+n,fullName:'QA VESSEL '+n,shortName:'QA VESSEL '+n,assignedUserIds:n<=5?[actor]:[]});
  if(n<=5)initial.users.push({...structuredClone(operator),id:actor,username:actor,name:'QA OPERATOR '+n,managedVesselIds:[id]});
 }
 const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');Object.assign(initial,normalizeAppData(initial));
 assert.equal(initial.users.filter(u=>u.role==='owner').length,1);assert.equal(initial.users.length,5);assert.equal(initial.vessels.length,6);
}
function verifyBusiness(before,after,succeeded){
 const expected=structuredClone(before.payload);expected.revision=after.payload.revision;expected.updatedAt=after.payload.updatedAt;
 assert.equal(after.revision,before.revision+succeeded.length,'revision follows authoritative successful operations only');
 for(const p of succeeded){
  const v=after.payload.vessels.find(v=>v.id===p.vessel),old=expected.vessels.find(v=>v.id===p.vessel);
  assert.equal(v.note.recentDynamics,p.marker);assert.equal(v.note.subsequentDynamics,'');
  old.note.recentDynamics=p.marker;old.note.subsequentDynamics='';old.note.updatedAt=v.note.updatedAt;old.updatedAt=v.updatedAt;
  assert.deepEqual(v,old,'exact original operational mask '+p.actor);
 }
 const audits=after.payload.auditLogs.filter(a=>!before.payload.auditLogs.some(b=>b.id===a.id));
 assert.equal(audits.length,succeeded.length,'one business audit per changed original editor');
 assert.equal(new Set(after.payload.auditLogs.map(a=>a.id)).size,after.payload.auditLogs.length);
 assert.deepEqual(audits.map(a=>[a.entityId,a.actorId,a.action]).sort(),succeeded.map(p=>[p.vessel,p.actor,'快速更新船舶']).sort());
 expected.auditLogs=after.payload.auditLogs;assert.deepEqual(after.payload,expected,'complete business payload including all bystanders');
 return audits;
}
async function receiptLedger(){return (await native.observer.query('select operation_id,result from ship_dynamics_record_receipts where workspace_key=$1 order by operation_id',[qa.workspace])).rows;}
async function sameDraft(p){return p.eval(`window.__draftNode===${field}&&window.__draftNode.value===${JSON.stringify(p.marker)}`);}

try{
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true,beforeCommit:async({context,pid,value})=>{
  if(barrier&&context.operationId===barrier.operationId){assert.equal(value.ok,true,'A real SQL executed successfully');barrier.pid=pid;barrier.entered=true;barrier.enteredAt=Date.now();save();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('private commit barrier budget exceeded')),6000);releaseCommit=()=>{clearTimeout(timer);resolve();};});}
 }});
 qa=await createRecordStorageLocalQa({internalControl:true,performanceTrace:true,preparePerformanceFixture:fiveActorFixture,databaseFactory:async()=>native.adapter});
 receipt.origin=qa.origin;assert.equal((await (await fetch(qa.origin+'/__qa/health')).json()).kind,'REAL_UI_SYNTHETIC_DATA_NATIVE_POSTGRES');
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socketPath;await until(()=>{try{[chromePort,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
 receipt.chrome={pid:browser.pid,port:Number(chromePort)};
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){
    const {type,message}=m.params,actor=actors.find(p=>p.s===m.sessionId)?.actor;
    const exhaustion=type==='alert'&&currentCase==='U3a'&&message==='最新修改尚未在雲端確認；協作鎖仍保留，請先處理保存狀態。';
    const accept=exhaustion||type==='beforeunload'||type==='confirm'&&['同步最新會保留本機修改','請盡量以船端修改為主'].some(t=>message.startsWith(t));
    receipt.dialogs.push({type,message,actor,caseId:currentCase,classification:exhaustion?'controlled-exhaustion-alert':accept?'expected-confirm':'unexpected'});
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
    const b=JSON.parse(m.params.request.postData||'{}'),row={caseId:currentCase,actor:actors.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:b.p_operation_id,payloadHash:hash(b),auditExpected:b.p_operations?.find(o=>o.kind==='order'&&o.collection==='auditLogs')?.expectedIds,auditIds:b.p_operations?.filter(o=>o.collection==='auditLogs'&&o.kind!=='order').map(o=>o.id||o.entityId||o.value?.id),started:m.params.wallTime*1000};
    netRows.set(m.sessionId+':'+m.params.requestId,row);receipt.network.push(row);
   }
   const row=netRows.get(m.sessionId+':'+m.params.requestId);
   if(m.method==='Network.responseReceived'&&row)row.httpStatus=m.params.response.status;
   if(m.method==='Network.loadingFinished'&&row){const response=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId);const v=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body);Object.assign(row,{finished:Date.now(),result:v?.ok===false?v.code:'SQL_OK',conflictKey:v?.conflict_key,revision:v?.revision});save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });
 currentCase='U3-setup';
 for(const [actor,vessel] of targets){const context=(await call('Target.createBrowserContext')).browserContextId;const p=await makePage(actor,context);p.vessel=vessel;p.marker='U3 '+actor+' VERIFIED DRAFT';await login(p);}
 assert.equal(new Set(actors.map(p=>p.context)).size,5);
 const people=[...actors],formal=await qa.itinerarySnapshot(),other=await untouched(),base=await read(),initialReceipts=await receiptLedger();
 assert.equal(initialReceipts.length,0,'no setup/login business writes');
 receipt.fixture={users:base.payload.users.map(u=>({id:u.id,role:u.role,managedVesselIds:u.managedVesselIds})),vessels:base.payload.vessels.length,tasks:base.payload.tasks.length,cases:base.payload.internalControlCases.length,notifications:base.payload.notifications.length,formalTables:Object.keys(formal).length};
 for(const k of ['tasks','cases','notifications'])assert.ok(receipt.fixture[k]>0);
 for(const p of people){await p.open(p.vessel);await p.fill(field,p.marker);await p.eval(`void(window.__draftNode=${field})`);}
 const initialLocks=await locks();assert.equal(initialLocks.length,5);assert.equal(new Set(initialLocks.map(l=>l.locked_by)).size,5);receipt.initialLocks=initialLocks;
 assert.deepEqual(await read(),base,'all five drafts are not yet in SQL');
 currentCase='U3a';rendezvous=true;await Promise.all(people.map(p=>p.submit()));
 let remaining=[...people];const succeeded=[];
 for(let round=1;round<=4;round++){
  const batch=await until(()=>{const rows=paused.filter(p=>!p.released);return rows.length===remaining.length?rows:false;},'round '+round+' actual outgoing saves',6000);
  assert.deepEqual(batch.map(p=>p.actor).sort(),remaining.map(p=>p.actor).sort());
  assert.ok(Array.isArray(batch[0].auditExpected));for(const p of batch)assert.deepEqual(p.auditExpected,batch[0].auditExpected,'round same base audit expectedIds');
  const leader=remaining[0],first=batch.find(p=>p.actor===leader.actor),followers=batch.filter(p=>p!==first),roundBase=await read();
  const row={round,requests:batch.map(({session,requestId,released,...safe})=>safe),leader:leader.actor,baseRevision:roundBase.revision};receipt.rounds.push(row);save();
  barrier={operationId:first.operationId};first.released=true;await call('Fetch.continueRequest',{requestId:first.requestId},first.session);await until(()=>barrier.entered,'leader pre-COMMIT',4000);
  for(const p of followers){p.released=true;await call('Fetch.continueRequest',{requestId:p.requestId},p.session);}
  const blocking=await until(async()=>{const rows=(await native.observer.query("select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where application_name like 'record_native_http_%' and wait_event_type='Lock'")).rows;return rows.find(r=>r.blockers.includes(barrier.pid));},'independent PG blocker',4000);
  const peer=followers.find(p=>receipt.httpTransactions.some(t=>t.operationId===p.operationId&&t.pid===blocking.pid));assert.ok(peer,'blocked backend maps to actual follower request');assert.notEqual(blocking.pid,barrier.pid);
  row.blocking={leaderPid:barrier.pid,peerActor:peer.actor,peerOperationId:peer.operationId,...blocking};
  assert.equal((await read()).revision,roundBase.revision,'uncommitted leader not published');
  assert.equal((await locks()).length,remaining.length);for(const p of remaining)assert.ok(await sameDraft(p));
  if(round===1)await remaining.at(-1).screen('U3a-five-pending');row.preCommitHoldMs=Date.now()-barrier.enteredAt;assert.ok(row.preCommitHoldMs<6000);save();releaseCommit();barrier=null;
  await until(()=>batch.every(p=>receipt.network.some(n=>n.operationId===p.operationId&&n.finished)),'round actual HTTP results',5000);
  for(const p of batch){const n=receipt.network.find(n=>n.operationId===p.operationId&&n.finished);assert.equal(n.httpStatus,200);assert.equal(n.result,p===first?'SQL_OK':'block-conflict');if(p!==first)assert.equal(n.conflictKey,'order:auditLogs');}
  await until(()=>leader.saved(),'leader original ACK/close',5000);succeeded.push(leader);remaining=remaining.slice(1);
  verifyBusiness(base,await read(),succeeded);save();
 }
 rendezvous=false;
 for(const p of remaining)await until(()=>p.eval("Boolean(document.querySelector('.save-status-strip.error'))"),'bounded retry terminal UI',6000);
 for(const p of people){
  const chain=receipt.network.filter(n=>n.actor===p.actor&&n.caseId==='U3a'&&n.rpc===patchRpc);
  assert.equal(new Set(chain.map(n=>n.operationId)).size,chain.length,'new operation on each retry');
  assert.equal(new Set(chain.map(n=>n.payloadHash)).size,chain.length,'changed retry payload');
  for(let i=1;i<chain.length;i++)assert.ok(receipt.network.some(n=>n.actor===p.actor&&/^read_ship_dynamics_record/.test(n.rpc)&&n.started>=chain[i-1].started&&n.started<chain[i].started&&n.finished),'original fetch between attempts');
  receipt.actorResults.push({actor:p.actor,vessel:p.vessel,attempts:chain.length,conflicts:chain.filter(n=>n.result==='block-conflict').length,automaticSuccess:chain.some(n=>n.result==='SQL_OK'),manualRequired:remaining.includes(p),chain});
 }
 receipt.cases.push({caseId:'U3a',status:'PASS',layer:'original-ui-native-sql-controlled-schedule',rounds:receipt.rounds.length,actors:people.length});save();
 currentCase='U3b';
 for(const p of remaining){
  const text=await p.text();assert.ok(text.includes('尚未保存到雲端')&&text.includes('同步最新（安全合併）')&&text.includes('重新保存'));
  assert.equal(/可以安全關閉|沒有未保存修改|沒有尚未保存的修改/.test(text),false);assert.ok(await sameDraft(p));assert.equal(await p.saved(),false);
  assert.equal((await read()).payload.vessels.find(v=>v.id===p.vessel).note.recentDynamics,base.payload.vessels.find(v=>v.id===p.vessel).note.recentDynamics);
  receipt['exhaustionText-'+p.actor]=text;await p.screen('U3b-exhausted-'+p.actor);
 }
 verifyBusiness(base,await read(),succeeded);assert.deepEqual(await qa.itinerarySnapshot(),formal);assert.deepEqual(await untouched(),other);
 for(const d of receipt.dialogs.filter(d=>d.classification==='controlled-exhaustion-alert'))assert.ok(receipt.actorResults.some(p=>p.actor===d.actor&&p.manualRequired&&p.conflicts===4),'expected alert belongs only to real exhausted actor');
 receipt.cases.push({caseId:'U3b',status:remaining.length?'PASS':'NOT_TRIGGERED',layer:'original-ui-native-sql',retained:remaining.map(p=>p.actor),classification:'controlled-expected-exhaustion-not-data-loss'});save();
 currentCase='U3c';
 for(const p of remaining){
  const start=receipt.network.length;await p.sync();
  let recoveryAction='original-sync';
  let commits=receipt.network.slice(start).filter(n=>n.actor===p.actor&&n.rpc===patchRpc&&n.result==='SQL_OK');
  if(!commits.length){recoveryAction='original-sync-then-prompted-resave';await p.click('重新保存');await until(()=>receipt.network.slice(start).some(n=>n.actor===p.actor&&n.rpc===patchRpc&&n.result==='SQL_OK'),'manual authoritative ACK');commits=receipt.network.slice(start).filter(n=>n.actor===p.actor&&n.rpc===patchRpc&&n.result==='SQL_OK');}
  assert.equal(commits.length,1);assert.ok(await sameDraft(p),'recovery keeps original child draft until explicit close');
  const result=receipt.actorResults.find(r=>r.actor===p.actor);Object.assign(result,{recovered:true,recoveryAction,recoveryOperationId:commits[0].operationId,recoveryRevision:commits[0].revision});
  // Unlike U3b, this exact draft now has a real committed ACK. An open
  // editor alone does not make this already-confirmed content unsaved.
  verifyBusiness(base,await read(),[...succeeded,p]);
  result.recoveryFeedback={sameEditor:true,exactDraftCommitted:true,text:await p.text()};
  await p.screen('U3c-ACK-editor-retained');const closeStart=receipt.network.length;
  // The model was ACKed by Sync: original editor button now only closes.
  await p.submit();await until(()=>p.saved(),'recovered editor close');
  assert.equal(receipt.network.slice(closeStart).filter(n=>n.rpc===patchRpc).length,0,'close does not manufacture another business save');
  succeeded.push(p);
 }
 await until(async()=>(await locks()).length===0,'all original leases released');
 const final=await read(),audits=verifyBusiness(base,final,succeeded),ledger=await receiptLedger();
 const successful=receipt.network.filter(n=>n.rpc===patchRpc&&n.result==='SQL_OK');
 assert.equal(ledger.length,successful.length);assert.equal(ledger.length,people.length);
 assert.deepEqual(ledger.map(r=>r.operation_id).sort(),successful.map(r=>r.operationId).sort());
 for(const row of ledger){const n=successful.find(n=>n.operationId===row.operation_id);assert.equal(row.result.revision,n.revision);const t=receipt.httpTransactions.find(t=>t.operationId===row.operation_id);assert.equal(t.status,'SQL_OK');assert.equal(t.committed,true);const audit=audits.find(a=>a.actorId===n.actor);assert.ok(audit);assert.ok(n.auditIds.includes(audit.id),'successful outgoing audit exactly matches SQL business row');}
 receipt.ledger=ledger;receipt.audits=audits;
 await freshReadback('U3-final',final);assert.deepEqual(await qa.itinerarySnapshot(),formal);assert.deepEqual(await untouched(),other);
 assert.deepEqual(await read(),final,'no trailing business change during all fresh readers');assert.deepEqual(await receiptLedger(),ledger,'no trailing extra operation');
 receipt.bystanders={completePayload:true,recordValueRevisionXminCtid:true,formalAndLegacyUnchanged:true,completeFreshSqlReads:1,completeFreshDocuments:people.length};
 assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.blockedExternal,[]);
 receipt.cases.push({caseId:'U3c',status:'PASS',layer:'original-ui-native-sql-plus-fresh-read-only-reader',manualRecovered:remaining.length});
 receipt.totals={actors:receipt.actorResults.length,automaticSuccess:receipt.actorResults.filter(p=>p.automaticSuccess).length,manualRequired:receipt.actorResults.filter(p=>p.manualRequired).length,recovered:receipt.actorResults.filter(p=>p.recovered).length,uniqueCommittedOperations:ledger.length,uniqueBusinessAudits:audits.length};
 receipt.status='PASS';save();console.log('PASS U3',JSON.stringify(receipt.totals),run);

}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseCommit?.();rendezvous=false;receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});}}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)assert.equal(await portClosed(Number(chromePort)),true);assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

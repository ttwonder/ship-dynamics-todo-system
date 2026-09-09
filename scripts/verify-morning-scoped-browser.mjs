import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
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
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-morning-scoped-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['scripts/verify-morning-scoped-browser.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','scripts/record-internal-control-local-fixture.mjs','src/main.tsx','src/App.tsx','src/ReportDailyHistories.tsx','src/morningHistory.ts','src/normalize.ts','src/types.ts','src/DataAnalysis.tsx','src/dataAnalysisVesselAttention.ts','src/taskVesselProgress.ts','src/taskVesselScope.ts','src/taskCategories.ts','src/taskAttention.ts','src/vesselAttention.ts','src/meetingVesselAttention.ts','src/taipeiTime.ts','src/cloud.ts','src/cloudRecordScopes.ts','src/cloudBlockPatch.ts','scripts/report-history-save-oracle.mjs','scripts/report-history-model-probes.mjs','supabase/development/20260908_appdata_record_scoped_read.sql'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const patchRpc='apply_ship_dynamics_record_patch_v1';
let native,qa,browser,ws,failure,chromePort,releaseCommit,barrier=null,currentCase='setup',next=0;
const pending=new Map(),actors=[],netRows=new Map(),paused=[];
let rendezvous=false,releaseHeldRead;
const outgoing=[];let expectedSave=null,saveBefore=null,saveStarted=0;
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
  await until(()=>[...netRows.entries()].filter(([key])=>key.startsWith(fresh.s+':')).every(([,r])=>r.finished),'fresh document actual full response body');
  await call('Target.closeTarget',{targetId:fresh.targetId});
 }
 fs.writeFileSync(path.join(run,name+'-readback.json'),JSON.stringify({hash:hash(actual),readback:scrub(actual)},null,2));
}

try{
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,taskMember:true,scopedRead:true,performanceTrace:true,preparePerformanceFixture:async (initial,vite)=>{
  const {morningFixture}=await import('./morning-scoped-fixture.mjs');await morningFixture(initial,vite);
 },databaseFactory:async()=>native.adapter});
 receipt.origin=qa.origin;assert.equal((await (await fetch(qa.origin+'/__qa/health')).json()).kind,'REAL_UI_SYNTHETIC_DATA_NATIVE_POSTGRES');
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socketPath;await until(()=>{try{[chromePort,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
 receipt.chrome={pid:browser.pid,port:Number(chromePort)};
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){
    const {type,message}=m.params,accept=type==='alert'&&message==='今日早會快照已完成保存。'||type==='beforeunload'||type==='confirm'&&['同步最新會保留本機修改','請盡量以船端修改為主','確定批量完成所選','確定結案會議','確定重新開啟會議','確定重新開啟此待辦'].some(t=>message.startsWith(t));
    if(!accept)receipt.errors.push('unexpected dialog: '+message);await call('Page.handleJavaScriptDialog',{accept},m.sessionId);
   }
   if(m.method==='Fetch.requestPaused'){
    const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);
    if(!allowed)receipt.blockedExternal.push(u.origin);
    if(allowed&&[patchRpc,'save_ship_dynamics_task_member_v1'].some(name=>u.pathname.endsWith('/rpc/'+name))){outgoing.push({caseId:currentCase,body:JSON.parse(m.params.request.postData),captured:Date.now()});fs.writeFileSync(path.join(run,'outgoing-before-sql.json'),JSON.stringify(outgoing.map(r=>({...r,body:scrub(r.body)})),null,2));}
    if(allowed&&rendezvous&&u.pathname.endsWith('/rpc/'+patchRpc)){
     const body=JSON.parse(m.params.request.postData);paused.push({session:m.sessionId,requestId:m.params.requestId,operationId:body.p_operation_id,actor:body.p_actor_user_id,payloadHash:hash(body),auditExpected:body.p_operations.find(o=>o.kind==='order'&&o.collection==='auditLogs')?.expectedIds});save();return;
    }
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



 const contextA=(await call('Target.createBrowserContext')).browserContextId,a=await makePage('qa-owner',contextA);await login(a);
 const original=await read();fs.writeFileSync(path.join(run,'sql-before.json'),JSON.stringify(scrub(original),null,2));
 currentCase='MW1';await a.click('早會工作台');await until(()=>a.eval("Boolean(document.querySelector('.morning-workspace'))"),'original morning workspace');await a.screen('morning');
 await until(()=>receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc)).every(r=>r.finished),'morning response bodies');
 assert.deepEqual(await read(),original,'pure reads leave exact SQL unchanged');
 receipt.wire=receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc));save();
 assert.equal(receipt.wire.filter(r=>r.containsUnloadedDetail).length,0,'MW1 unrelated historical snapshot crosses original morning wire');
 receipt.cases.push({caseId:'MW1',layer:'original-UI-native-PG',status:'PASS'});
 const {normalizeAppData}=await qa.loadModule('/src/normalize.ts');const fullModel=normalizeAppData(original.payload);
 const scopedModel=await a.eval(`import('/src/cloud.ts').then(m=>m.fetchCloudData(${JSON.stringify({supabaseUrl:qa.origin,supabaseAnonKey:'isolated-qa-not-a-service-key',workspaceKey:qa.workspace,tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'scoped-v1'})},undefined,undefined,'morning'))`);
 const {morningModelProbes}=await import('./morning-scoped-model-probes.mjs');receipt.cases.push(...await morningModelProbes(qa,native,run,fullModel,scopedModel));
 currentCase='MW2';const summary=()=>a.eval("document.querySelector('.meeting-vessel-summary').innerText");const allSummary=await summary();
 await a.activate("document.querySelector('.mini-ship-card')");assert.ok((await summary()).includes('1 艘船'));await a.activate("document.querySelector('.mini-ship-card')");assert.equal(await summary(),allSummary);
 await a.click('MW TYPE A');assert.ok((await summary()).includes('1 艘船'));await a.click('清空（顯示全部）');assert.equal(await summary(),allSummary);
 await a.click('自管船舶');assert.ok((await summary()).includes('0 艘船'),'active empty filter is not all vessels');await a.click('清空（顯示全部）');await a.click('高');await a.click('以時間序排列');await a.click('時間新→舊');await a.click('時間舊→新');await a.click('高');assert.equal(await summary(),allSummary);receipt.cases.push({caseId:'MW2',layer:'original-UI-native-PG',status:'PASS'});
 currentCase='MW3';await a.click('歷史未結');const pager=()=>a.eval("[...document.querySelectorAll('.morning-history-pagination')].map(n=>n.innerText)");assert.equal(await a.eval("document.querySelectorAll('.agenda-split-section .meeting-agenda-card').length"),30);await a.activate("document.querySelector('[aria-label=歷史未結上方下一頁]')");const second=await pager();assert.ok(second.every(t=>t.includes('第 2／')));assert.equal(await a.eval("document.querySelector('.agenda-number').innerText"),'31');assert.ok(await a.eval("Boolean(document.querySelector('.internal-control-agenda-card'))"),'mixed task/case page');
 await a.activate("[...document.querySelectorAll('.meeting-agenda-card:not(.internal-control-agenda-card) button')].find(n=>n.innerText==='更新狀態／決議')");await until(()=>a.eval("Boolean(document.querySelector('#task-edit-title'))"),'original task');await a.click('取消');await until(()=>a.eval("!document.querySelector('#task-edit-title')"),'return task');assert.deepEqual(await pager(),second);await a.activate("document.querySelector('[aria-label=歷史未結下方上一頁]')");assert.equal(await a.eval("document.querySelector('.agenda-number').innerText"),'01');receipt.cases.push({caseId:'MW3',layer:'original-UI-native-PG',status:'PASS'});
 currentCase='MW4-NAV';await a.click('船隊看板');let entered=false;qa.setRecordFault({after:async({name,body})=>{if(name==='read_ship_dynamics_record_scopes_v1'&&body.p_scope==='targets'&&!entered){entered=true;await new Promise(r=>releaseHeldRead=r);}return false;}});await a.click('早會工作台');await until(()=>entered,'actual native morning response held');await a.click('待辦總表');releaseHeldRead();await wait(180);assert.equal(await a.eval("Boolean(document.querySelector('.morning-workspace'))"),false);qa.setRecordFault(null);receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});
 assert.deepEqual(await read(),original,'complete pure-read journey');
 currentCase='MW4-ACTOR';const c=await makePage('qa-owner',(await call('Target.createBrowserContext')).browserContextId);await login(c);entered=false;qa.setRecordFault({after:async({name,body})=>{if(name==='read_ship_dynamics_record_scopes_v1'&&body.p_scope==='targets'&&!entered){entered=true;await new Promise(r=>releaseHeldRead=r);}return false;}});await c.click('早會工作台');await until(()=>entered,'native actor response held');await c.click('切換/退出');await until(async()=>(await c.text()).includes('人員登入／切換'),'original identity exit');releaseHeldRead();await wait(150);assert.equal(await c.eval("Boolean(document.querySelector('.morning-workspace'))"),false);qa.setRecordFault(null);await call('Target.closeTarget',{targetId:c.targetId});c.reader=true;receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});
 currentCase='MW5-CASE';await a.click('早會工作台');await until(()=>a.eval("Boolean(document.querySelector('.morning-workspace'))"),'morning case');await a.click('歷史未結');await a.activate("[...document.querySelectorAll('.internal-control-agenda-card')].find(n=>n.innerText.includes('QA withdraw'))?.querySelector('button')");await until(()=>a.eval("Boolean(document.querySelector('.ic-status-add textarea'))"),'original case update');const caseBefore=await read();await a.fill("document.querySelector('.ic-status-add textarea')",'MW LINKED CASE SAVE');await a.click('加入狀態記錄');await a.click('保存更新');await until(()=>a.eval("!document.querySelector('.ic-edit-modal')"),'case confirmed return');const caseAfter=await read(),linked=caseAfter.payload.internalControlCases.find(c=>c.id==='qa-withdraw');assert.equal(linked.status,'MW LINKED CASE SAVE');assert.equal(caseAfter.payload.tasks.find(t=>t.id===linked.linkedTaskId).status,linked.status);assert.deepEqual(caseAfter.payload.tasks.find(t=>t.id===linked.linkedTaskId).statusLogs,linked.statusLogs);fs.writeFileSync(path.join(run,'case-before-after.json'),JSON.stringify(scrub({before:caseBefore,after:caseAfter,capture:outgoing.find(o=>o.caseId===currentCase)}),null,2));await a.click('早會工作台');await until(()=>a.eval("Boolean(document.querySelector('.morning-workspace'))"),'case return morning');receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});
 currentCase='MW5-TASK';await a.click('早會工作台');await until(()=>a.eval("Boolean(document.querySelector('.morning-workspace'))"),'morning for save');await a.activate("[...document.querySelectorAll('.meeting-agenda-card')].find(n=>n.innerText.includes('MW HISTORY TASK 03'))?.querySelector('button')");await until(()=>a.eval("Boolean(document.querySelector('.quick-status-bar textarea'))"),'original task editable');await a.fill("document.querySelector('.quick-status-bar textarea')",'MW SAVED ORIGINAL TASK');await a.click('加入狀態紀錄');await a.click('保存變更');await until(()=>a.eval("!document.querySelector('#task-edit-title')"),'task confirmed return');assert.equal((await read()).payload.tasks.find(t=>t.id==='mw-history-3').status,'MW SAVED ORIGINAL TASK');receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});
 currentCase='MW5-SAVE';const watcher=await makePage('qa-owner',(await call('Target.createBrowserContext')).browserContextId);await login(watcher);await watcher.click('早會工作台');await until(()=>watcher.eval("Boolean(document.querySelector('.morning-workspace'))"),'watcher prior baseline');assert.ok(await watcher.eval("document.querySelector('.agenda-split-section').innerText.includes('MW HISTORY TASK 03')"));await a.click('船隊看板');await a.click('早會工作台');saveBefore=await read();saveStarted=Date.now();const physical=async()=> (await native.observer.query("select collection,entity_id,to_jsonb(t) value,xmin::text,ctid::text from ship_dynamics_records t order by collection,entity_id")).rows;const physicalBefore=await physical();
 qa.setRecordFault({before:async({name,body})=>{if(name!==patchRpc)return;const {reportSaveExpected}=await import('./report-history-save-oracle.mjs');expectedSave=await reportSaveExpected(saveBefore,body,qa,saveStarted);fs.writeFileSync(path.join(run,'expected-before-sql.json'),JSON.stringify(scrub(expectedSave),null,2));}});
 await a.click('保存今日早會');await until(()=>receipt.network.some(r=>r.caseId===currentCase&&r.rpc===patchRpc&&r.finished),'morning save ACK');await until(()=>a.eval("[...document.querySelectorAll('button')].some(n=>n.innerText==='保存今日早會'&&!n.disabled)"),'save idle');qa.setRecordFault(null);const saved=await read();const {assertReportSaveResult}=await import('./report-history-save-oracle.mjs');assertReportSaveResult(saveBefore,saved,expectedSave,saveStarted);const physicalAfter=await physical();assert.deepEqual(physicalAfter.filter(r=>physicalBefore.some(b=>b.collection===r.collection&&b.entity_id===r.entity_id)),physicalBefore);fs.writeFileSync(path.join(run,'physical-save.json'),JSON.stringify(scrub({before:physicalBefore,after:physicalAfter}),null,2));assert.ok(receipt.network.some(r=>r.caseId===currentCase&&r.readScope==='full'));receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});
 currentCase='MW4-NEW-BASELINE';await watcher.sync();assert.equal(await watcher.eval("document.querySelector('.agenda-split-section').innerText.includes('MW HISTORY TASK 03')"),false,'new date manual baseline replaces September baseline');receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});await until(()=>[...netRows.entries()].filter(([key])=>key.startsWith(watcher.s+':')).every(([,r])=>r.finished),'watcher bodies complete');
 currentCase='MW4-SYNC-BASELINE';const b=await makePage('qa-owner',(await call('Target.createBrowserContext')).browserContextId);await login(b);await b.click('早會工作台');await until(()=>b.eval("Boolean(document.querySelector('.morning-workspace'))"),'second context morning');await a.click('船隊看板');await a.click('早會工作台');await b.activate("[...document.querySelectorAll('.meeting-agenda-card')].find(n=>n.innerText.includes('MW HISTORY TASK 03'))?.querySelector('button')");await until(()=>b.eval("Boolean(document.querySelector('.quick-status-bar textarea'))"),'peer task');await b.fill("document.querySelector('.quick-status-bar textarea')",'MW SECOND MANUAL CONTENT');await b.click('加入狀態紀錄');await b.click('保存變更');await until(()=>b.eval("!document.querySelector('#task-edit-title')"),'peer task save');currentCase='MW4-PEER-SAVE';const peerSaveStart=receipt.network.length;await b.click('保存今日早會');await until(()=>receipt.network.slice(peerSaveStart).some(r=>r.caseId===currentCase&&r.rpc===patchRpc&&r.finished),'another legal manual snapshot');currentCase='MW4-SYNC-BASELINE';await a.sync();assert.ok((await a.text()).includes('下一場累積中'));assert.equal(await a.eval("document.querySelector('.agenda-split-section').innerText.includes('MW HISTORY TASK 03')"),true,'same-day repeated manual preserves first cutoff and accumulates next meeting');assert.ok((await a.text()).includes('MW SECOND MANUAL CONTENT'));const latest=(await read()).payload.agendaReports[0];assert.equal(latest.snapshot.windowEndedAt,saved.payload.agendaReports[0].snapshot.windowEndedAt);assert.deepEqual(latest.snapshot.tasks,saved.payload.agendaReports[0].snapshot.tasks);const newTargets=receipt.network.filter(r=>r.caseId===currentCase&&r.readScope==='targets');assert.ok(newTargets.some(r=>r.targets.some(t=>t.collection==='agendaReports'&&t.id===latest.id)));receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});
 currentCase='MW5-LIVE';await a.click('船隊看板');await a.click('早會工作台');await a.click('預覽 PDF');await until(()=>a.eval("Boolean(document.querySelector('#report-preview-title'))"),'full live preview');assert.ok(receipt.network.some(r=>r.caseId===currentCase&&r.readScope==='full'));await a.screen('live-preview');await a.click('關閉');receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});
 await until(()=>receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc)).every(r=>r.finished),'all wire bodies');assert.deepEqual(receipt.errors,[]);receipt.wire=receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc));const fullAllowed=new Set(['MW5-SAVE','MW4-PEER-SAVE','MW5-LIVE']);for(const row of receipt.wire)if(!fullAllowed.has(row.caseId)){assert.notEqual(row.readScope,'full');assert.equal(row.containsUnloadedDetail,false);}fs.writeFileSync(path.join(run,'sql-final.json'),JSON.stringify(scrub(await read()),null,2));
 receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseHeldRead?.();releaseCommit?.();rendezvous=false;receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(()=>browser.exitCode!==null||browser.signalCode!==null,'forced owned Chrome exit event',5000);}}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)assert.equal(await portClosed(Number(chromePort)),true);assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

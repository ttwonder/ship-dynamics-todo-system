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
import {scopedTaskExpected,assertScopedSqlResult,proveOracleRejectsTampering} from './record-scoped-business-oracle.mjs';
import {prepareMemberGraph} from './task-member-shared-oracle.mjs';

// QA-only: original main.tsx -> App, native input, synthetic identities.
// No setters, write helpers, fabricated responses, external hosts or user profile.
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'ui-')),profile=path.join(run,'chrome');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-batch-create-scoped-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['scripts/record-batch-create-oracle.mjs','src/BatchManagedVesselModal.tsx','src/taskCreationLock.ts','src/VesselDetailPage.tsx','src/vesselDetail.ts','src/taskMemberEditor.ts','src/EditModals.tsx','scripts/task-member-shared-oracle.mjs','scripts/verify-batch-create-scoped-browser.mjs','scripts/record-scoped-business-oracle.mjs','scripts/record-scoped-lifecycle-oracle.mjs','src/InternalControlPage.tsx','src/TemporaryMeetings.tsx','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','src/App.tsx','src/cloud.ts','src/cloudRecordScopes.ts','supabase/development/20260908_appdata_record_scoped_read.sql'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const patchRpc='apply_ship_dynamics_record_patch_v1';
let native,qa,browser,ws,failure,chromePort,releaseCommit,barrier=null,currentCase='setup',next=0;
const pending=new Map(),actors=[],netRows=new Map(),paused=[];
let rendezvous=false,releaseHeldRead;
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
  await call('Target.closeTarget',{targetId:fresh.targetId});
 }
 fs.writeFileSync(path.join(run,name+'-readback.json'),JSON.stringify({hash:hash(actual),readback:scrub(actual)},null,2));
}

try{
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,taskMember:true,scopedRead:true,performanceTrace:true,preparePerformanceFixture:async initial=>{
  initial.vessels[0].qaUnknown={ordered:['a',{b:2}]};initial.vessels.push({...structuredClone(initial.vessels[1]),id:'qa-v3',name:'QA VESSEL 3',fullName:'QA VESSEL 3',shortName:'QA VESSEL 3'});
  initial.users.push({...structuredClone(initial.users[0]),id:'qa-vessel',name:'QA VESSEL ACCOUNT',username:'qa-vessel',role:'vessel',managedVesselIds:['qa-v1']});
  for(const col of ['tasks','internalControlCases','meetings'])for(const t of initial[col])t.statusLogs=[...(t.statusLogs||[]),...[1,2,3].map(n=>({id:t.id+'-deep-'+n,at:initial.updatedAt,by:'QA OWNER',text:n===3?'QA_UNLOADED_DETAIL_SENTINEL':n===1?(t.status||'preview'):'preview '+n,qaUnknown:[2,1]}))];
  for(const c of initial.internalControlCases){const t=initial.tasks.find(t=>t.id===c.linkedTaskId);if(t)c.statusLogs=structuredClone(t.statusLogs);}
  initial.agendaReports=[{id:'qa-report',title:'QA report',vesselIds:['qa-v1'],createdBy:'qa-owner',createdAt:initial.updatedAt,taskCount:initial.tasks.length,kind:'ad-hoc',snapshot:{vessels:structuredClone(initial.vessels),tasks:structuredClone(initial.tasks),meetings:structuredClone(initial.meetings),qaUnknown:'QA_UNLOADED_DETAIL_SENTINEL'}}];
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
    const {type,message}=m.params,accept=type==='beforeunload'||type==='confirm'&&['同步最新會保留本機修改','請盡量以船端修改為主','確定批量完成所選','確定結案會議','確定重新開啟會議','確定重新開啟此待辦'].some(t=>message.startsWith(t));
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
 const check=async(caseId,fn)=>{currentCase=caseId;await fn();receipt.cases.push({caseId,status:'PASS'});save();};
 const noFull=async()=>{await until(()=>receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc)).every(r=>r.finished),'all product reads finished');const rows=receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc));assert.ok(rows.length);assert.equal(rows.some(r=>r.readScope==='full'||r.rpc!=='read_ship_dynamics_record_scopes_v1'),false,'batch/create must not expand to full');assert.equal(rows.some(r=>r.containsUnloadedDetail),false,'unrelated histories/snapshots deferred');};
 const modal=()=>a.eval("Boolean(document.querySelector('.batch-managed-modal'))"),task=()=>a.eval("Boolean(document.querySelector('#task-edit-title'))");
 const bfield=(i,label)=>`[...document.querySelectorAll('.batch-managed-card')[${i}].querySelectorAll('label')].find(n=>n.firstChild.textContent===${JSON.stringify(label)})?.querySelector('input,textarea,select')`;
 const batchOpen=async()=>{const start=receipt.network.length;for(const name of ['QA VESSEL 1','QA VESSEL 2'])await a.activate(`[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes(${JSON.stringify(name)}))&&[...[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes(${JSON.stringify(name)})).querySelectorAll('button')].find(n=>n.innerText==='批量選取')`);await a.click('批量更新船舶（已選 2）');await until(modal,'original exact batch');await assertBatch(start);};
 const assertBatch=async(start)=>{assert.equal(await a.eval("document.querySelectorAll('.batch-managed-card').length"),2);assert.equal(await a.eval("document.querySelector('.batch-managed-modal').innerText.includes('QA VESSEL 3')"),false);assert.deepEqual((await locks()).map(l=>l.section_key),['vessel:qa-v1','vessel:qa-v2']);const n=receipt.network.slice(start),last=n.findLastIndex(r=>r.rpc==='claim_ship_dynamics_edit_lock');assert.ok(last>=0&&n.some((r,i)=>i>last&&/^read_ship_dynamics_record/.test(r.rpc)),'post whole bundle refresh');};
 const ledger=async()=>{const out={};for(const {tablename:t} of (await native.observer.query("select tablename from pg_tables where schemaname='public' and tablename like 'ship_dynamics_record%' order by tablename")).rows)out[t]=(await native.observer.query('select to_jsonb(t) value,xmin::text,ctid::text from public."'+t+'" t order by to_jsonb(t)::text')).rows;return out;};
 const baseline=await read(),ledgerBefore=await ledger(),formal=await qa.itinerarySnapshot();
 if(process.argv.includes('--create-red')){await a.activate("[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1'))&&[...[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1')).querySelectorAll('button')].find(n=>n.innerText.includes('新增要事'))");await until(task,'cold home creation');await a.screen('cold-create');await noFull();}else{
 await check('BC-COLD-BATCH-OPEN',async()=>{await batchOpen();await a.screen('cold-batch');await noFull();});
 await check('BC-BATCH-CANCEL-SYNC-DRAFT',async()=>{await a.fill(bfield(0,'近期動態'),'BC UNSAVED CANCEL');await a.eval(`void(window.__batchDraft=${bfield(0,'近期動態')})`);await a.sync();assert.equal(await a.eval(`window.__batchDraft===${bfield(0,'近期動態')}&&(${bfield(0,'近期動態')}).value==='BC UNSAVED CANCEL'`),true);await a.click('取消並關閉');await until(async()=>!await modal()&&(await locks()).length===0,'cancel release');assert.deepEqual(await read(),baseline);assert.deepEqual(await ledger(),ledgerBefore);});
 await batchOpen();for(let i=0;i<2;i++){await a.fill(bfield(i,'近期動態'),'BC SAVED '+(i+1));await a.fill(bfield(i,'人工備註'),'BC REMARK '+(i+1));}
 let plan,submitted,lookup=false,drop=false,heldResolve;
 const beforeBatch=await read(),windowB={started:Date.now()};
 const installHeld=(before,intent)=>{lookup=false;drop=false;submitted=null;const held=new Promise(r=>{heldResolve=r;releaseHeldRead=r;});qa.setRecordFault({before:async({name,body})=>{if(name===patchRpc){submitted??=structuredClone(body);plan=await (await import('./record-batch-create-oracle.mjs')).expectedGraph(qa,before,body,intent,{started:windowB.started,captured:Date.now()});fs.writeFileSync(path.join(run,intent+'-expected-before-sql.json'),JSON.stringify(scrub({before,request:body,expected:plan}),null,2));}if(name==='get_ship_dynamics_record_receipt_v1'&&drop){assert.deepEqual(body,submitted,'immutable exact operation');lookup=true;await held;}},after:async({name,value})=>{if(name===patchRpc&&!drop){assert.equal(value.ok,true);drop=true;return true;}return false;}});};
 installHeld(beforeBatch,'batch');const startBatch=receipt.network.length;await a.eval("void(window.__batchNode=document.querySelector('.batch-managed-modal'))");await a.activate("document.querySelector('.batch-managed-card button')");await until(()=>lookup,'batch committed held exact receipt');
 await check('BC-BATCH-HELD-ACK',async()=>{assertScopedSqlResult(beforeBatch,await read(),plan,windowB);assert.equal(await a.eval("window.__batchNode===document.querySelector('.batch-managed-modal')"),true);assert.equal(await task(),false);assert.deepEqual((await locks()).map(l=>l.section_key),['vessel:qa-v1','vessel:qa-v2']);assert.equal(receipt.network.slice(startBatch).some(r=>r.rpc==='release_ship_dynamics_edit_lock'),false);await a.screen('batch-held');});heldResolve();releaseHeldRead=null;
 await until(task,'child only after batch ACK');qa.setRecordFault(null);const batchSaved=await read();
 await check('BC-CHILD-CANCEL-EXACT-RETURN',async()=>{assert.equal(await modal(),false);assert.ok((await locks()).some(l=>l.section_key.startsWith('task-create:v2:qa-v1:')));const st=receipt.network.length;await a.click('取消並關閉');await until(modal,'exact return after child cancel');await assertBatch(st);assert.deepEqual(await read(),batchSaved);await noFull();await a.screen('cancel-return');});
 await a.activate("document.querySelectorAll('.batch-managed-card')[1].querySelector('button')");await until(task,'v2 child');await a.eval("document.querySelector('[contenteditable=true][aria-label=事項內容]').focus()");await call('Input.insertText',{text:'QA ROUNDTRIP ORDINARY TASK'},a.s);
 for(const label of ['維修','管理組']){await a.eval(`[...document.querySelectorAll('.modal label')].find(n=>n.innerText.trim()===${JSON.stringify(label)}).querySelector('input').focus()`);await a.key(' ','Space');}
 installHeld(batchSaved,'create');await a.eval("void(window.__taskNode=document.querySelector('[aria-labelledby=task-edit-title]'))");await a.click('保存並關閉');await until(()=>lookup,'task committed held receipt');let created=await read();
 await check('BC-TASK-HELD-ACK',async()=>{assertScopedSqlResult(batchSaved,created,plan,windowB);assert.equal(await a.eval("window.__taskNode===document.querySelector('[aria-labelledby=task-edit-title]')"),true);assert.equal(await modal(),false);assert.ok((await locks()).some(l=>l.section_key.startsWith('task-create:v2:qa-v2:')));assert.equal(await a.eval("document.querySelector('[aria-label=事項內容]').contentEditable"),'false','original creation freezes its submitted draft while ACK held');await a.screen('task-held');});const stReturn=receipt.network.length;heldResolve();releaseHeldRead=null;await until(modal,'saved task return');qa.setRecordFault(null);
 await check('BC-TASK-SAVE-EXACT-RETURN',async()=>{await assertBatch(stReturn);assert.deepEqual(await read(),created);await a.click('取消並關閉');await until(async()=>!await modal()&&(await locks()).length===0,'batch close');await noFull();});
 await check('BC-HOME-DETAIL-CREATE-CANCEL',async()=>{await a.activate("[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1'))&&[...[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1')).querySelectorAll('button')].find(n=>n.innerText.includes('新增要事'))");await until(task,'home create');await a.click('取消並關閉');await until(async()=>!await task(),'home cancel');await a.activate("[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1'))?.querySelector('.ship-name-link')");await until(()=>a.eval("Boolean(document.querySelector('.vessel-detail-page'))"),'detail');await a.click('＋ 新增待辦');await until(task,'detail create');await a.click('取消並關閉');await until(async()=>!await task(),'detail cancel');assert.equal(await a.eval("Boolean(document.querySelector('.vessel-detail-page'))"),true);assert.deepEqual(await read(),created);await noFull();});
 const saveEntry=async(p,actorId,vesselId,description)=>{const before=await read(),window={started:Date.now()};let expected;await p.eval("document.querySelector('[contenteditable=true][aria-label=事項內容]').focus()");await call('Input.insertText',{text:description},p.s);for(const label of ['維修','管理組']){await p.eval(`[...document.querySelectorAll('.modal label')].find(n=>n.innerText.trim()===${JSON.stringify(label)}).querySelector('input').focus()`);await p.key(' ','Space');}qa.setRecordFault({before:async({name,body})=>{if(name===patchRpc){expected=await (await import('./record-batch-create-oracle.mjs')).expectedGraph(qa,before,body,{type:'create',actorId,vesselId,description},{...window,captured:Date.now()});fs.writeFileSync(path.join(run,description+'-expected-before-sql.json'),JSON.stringify(scrub({before,expected,request:body}),null,2));}}});await p.click('保存並關閉');await until(()=>p.eval("!document.querySelector('#task-edit-title')"),'entry save ACK and original return');qa.setRecordFault(null);const after=await read();assertScopedSqlResult(before,after,expected,window);created=after;await noFull();return after;};
 await check('BC-HOME-DETAIL-CREATE-SAVE-RETURN',async()=>{await a.click('＋ 新增待辦');await until(task,'detail create save');await saveEntry(a,'qa-owner','qa-v1','BC DETAIL SAVED');assert.equal(await a.eval("Boolean(document.querySelector('.vessel-detail-page'))"),true);await a.click('← 回到船隊看板');await a.activate("[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1'))&&[...[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1')).querySelectorAll('button')].find(n=>n.innerText==='新增要事')");await until(task,'home create save');await saveEntry(a,'qa-owner','qa-v1','BC HOME SAVED');assert.equal(await a.eval("Boolean(document.querySelector('article.ship-card'))"),true);await a.activate("[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1'))?.querySelector('.ship-name-link')");await until(()=>a.eval("Boolean(document.querySelector('.vessel-detail-page'))"),'detail restored');});
 await check('BC-NATIVE-LATE-CREATE-NAV',async()=>{await a.click('← 回到船隊看板');let entered=false;qa.setRecordFault({after:async({name})=>{if(name==='read_ship_dynamics_record_scopes_v1'&&!entered){entered=true;await new Promise(r=>releaseHeldRead=r);}return false;}});await a.activate("[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1'))&&[...[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1')).querySelectorAll('button')].find(n=>n.innerText==='新增要事')");await until(()=>entered,'native creation freshness after SQL held');assert.equal(await task(),false);await a.click('待辦總表');releaseHeldRead();releaseHeldRead=null;qa.setRecordFault(null);await until(()=>a.eval("[...document.querySelectorAll('nav button')].some(n=>n.innerText==='待辦總表'&&n.classList.contains('active'))"),'navigation completes');await wait(300);assert.equal(await task(),false);assert.deepEqual(await read(),created);await a.click('船隊看板');await until(()=>a.eval("Boolean(document.querySelector('article.ship-card'))"),'home restored');await noFull();await a.activate("[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1'))?.querySelector('.ship-name-link')");await until(()=>a.eval("Boolean(document.querySelector('.vessel-detail-page'))"),'return detail');});
 await check('BC-VESSEL-ORIGINAL-OWN-CREATE',async()=>{const context=(await call('Target.createBrowserContext')).browserContextId,c=await makePage('qa-vessel',context);await login(c);assert.equal(await c.eval("document.querySelectorAll('article.ship-card').length"),1);await c.activate("[...document.querySelectorAll('article.ship-card button')].find(n=>n.innerText.includes('新增要事'))");await until(()=>c.eval("Boolean(document.querySelector('#task-edit-title'))"),'vessel own create permitted');assert.ok((await locks()).some(l=>l.section_key.startsWith('task-create:v2:qa-v1:')));await c.click('取消並關閉');await until(()=>c.eval("!document.querySelector('#task-edit-title')"),'vessel cancel');assert.deepEqual(await read(),created);await c.activate("[...document.querySelectorAll('article.ship-card button')].find(n=>n.innerText==='新增要事')");await until(()=>c.eval("Boolean(document.querySelector('#task-edit-title'))"),'vessel own save');await saveEntry(c,'qa-vessel','qa-v1','BC VESSEL SAVED');assert.equal(await c.eval("Boolean(document.querySelector('article.ship-card'))"),true);await noFull();});
 await check('BC-FRESH-DOCUMENT-NO-TRAILING',async()=>{await a.click('← 回到船隊看板');await a.eval('void(window.__oldDoc=true)');await call('Page.reload',{},a.s);await until(()=>a.eval("!window.__oldDoc&&Boolean(document.querySelector('article.ship-card'))"),'fresh document');await a.sync();assert.ok((await a.text()).includes('QA ROUNDTRIP ORDINARY TASK'));await batchOpen();for(let i=0;i<2;i++)assert.equal(await a.eval(`(${bfield(i,'近期動態')}).value`),'BC SAVED '+(i+1));await a.click('取消並關閉');await until(async()=>!await modal()&&(await locks()).length===0,'fresh cancel');await wait(1200);assert.deepEqual(await read(),created);await noFull();await a.screen('fresh-final');});
 currentCase='BC-INDEPENDENT-COMPLETE-READBACK';await freshReadback('batch-create',created);const afterLedger=await ledger();for(const table of ['ship_dynamics_records','ship_dynamics_record_history']){const untouched=rows=>rows.filter(r=>!['auditLogs','notifications'].includes(r.value.collection)&&!(r.value.collection==='vessels'&&['qa-v1','qa-v2'].includes(r.value.entity_id))&&!(r.value.collection==='tasks'&&!baseline.payload.tasks.some(t=>t.id===r.value.entity_id)));assert.deepEqual(untouched(afterLedger[table]),untouched(ledgerBefore[table]),'untouched value/revision/xmin/ctid/history '+table);}assert.deepEqual(await qa.itinerarySnapshot(),formal);fs.writeFileSync(path.join(run,'raw-ledgers.json'),JSON.stringify(scrub({before:ledgerBefore,after:afterLedger}),null,2));fs.writeFileSync(path.join(run,'complete-graphs.json'),JSON.stringify(scrub({before:baseline,batchSaved,created}),null,2));receipt.cases.push({caseId:currentCase,layer:'independent-QA-readback',status:'PASS'});
 }
 assert.deepEqual(receipt.errors,[]);receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseHeldRead?.();releaseCommit?.();rendezvous=false;receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});}}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)assert.equal(await portClosed(Number(chromePort)),true);assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

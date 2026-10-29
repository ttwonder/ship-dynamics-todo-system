import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations,installTrackingFieldRevision} from './tracking-browser-fixture.mjs';

// QA-only: original main.tsx -> App, native input, synthetic identities.
// No setters, write helpers, fabricated responses, external hosts or user profile.
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'ui-')),profile=path.join(run,'chrome');
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const inputPaths=['src/App.tsx','src/EditModals.tsx','src/cloud.ts','src/cloudSyncError.ts','src/cloudBlockReceipt.ts','src/durableRelatedMutation.ts','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','scripts/tracking-browser-fixture.mjs','scripts/verify-task-update-recovery-browser.mjs'];
const fingerprints=()=>Object.fromEntries(inputPaths.map(p=>[p,hash(fs.readFileSync(p))]));
const receipt={kind:'existing-task-update-recovery-original-UI-native-PG',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-task-update-recovery-browser.mjs',exit:null}],productionContacted:false};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const patchRpc='apply_ship_dynamics_record_patch_v1';
const saveRepair=true;
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
 p.click=async label=>{const expr=`[...document.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.innerText.trim())===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled)`;await until(()=>p.eval(`Boolean(${expr})`),'ready button '+label);await p.activate(expr);};
 p.fill=async(expr,value)=>{await p.eval(`(()=>{const n=${expr};if(!n||n.disabled||n.readOnly)throw new Error('editable input required');n.focus();if(n.select)n.select();})()`);await call('Input.insertText',{text:value},s);};
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

const read=async()=> (await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;
const locks=async()=> (await native.observer.query('select section_key from ship_dynamics_edit_locks where expires_at>now()')).rows;
const taskDialog="document.querySelector('#task-edit-title')";
const taskField=label=>`[...document.querySelectorAll('.edit-modal .field')].find(n=>n.querySelector('label')?.textContent.startsWith(${JSON.stringify(label)}))?.querySelector('select')`;
let a;
async function select(p,expr,value){const index=await p.eval(`(()=>{const n=${expr};if(!n||n.disabled)throw new Error('enabled select required');n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(index>=0,'option exists '+value);await p.key('Home');for(let i=0;i<index;i++)await p.key('ArrowDown');await p.key('Enter');await until(()=>p.eval(`(${expr}).value===${JSON.stringify(value)}`),'select '+value);}
async function create(p,id){await p.click('新增要事');await until(()=>p.eval("Boolean(document.querySelector('.task-create-picker')?.open)"),'picker');await select(p,"document.querySelector('[aria-label=新增要事船舶]')",id);await p.click('下一步：填寫要事');await until(()=>p.eval(`Boolean(${taskDialog})&&!document.querySelector('.task-create-picker')?.open`),'original creation editor');assert.equal(await p.eval(`(${taskField('船舶')}).value`),id);assert.equal(await p.eval(`(${taskField('船舶')}).disabled`),true);}
async function content(p,description,category='維修'){await p.fill("document.querySelector('[contenteditable=true][aria-label=事項內容]')",description);await p.eval(`(()=>{for(const label of ${JSON.stringify([category,'海務'])}){const n=[...document.querySelectorAll('.edit-modal .checkbox-multi-picker label')].find(n=>n.querySelector('b')?.textContent===label)?.querySelector('input');if(!n)throw new Error('missing checkbox '+label);if(!n.checked)n.click();}})()`);}
async function check(id,fn){currentCase=id;try{await fn();receipt.cases.push({caseId:id,status:'PASS'});}catch(error){receipt.cases.push({caseId:id,status:'FAIL',message:error.message});throw error;}finally{save();}}
try {
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true,initTimeoutMs:120000});
 qa=await createRecordStorageLocalQa({browserAuthority:true,internalControl:true,taskMember:true,scopedRead:true,performanceTrace:true,databaseFactory:async()=>native.adapter,preparePerformanceFixture:async initial=>{
   for(const name of ['tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'])initial[name]=[];
   initial.settings.departments=['督導','海務','船工'];
   const owner=initial.users.find(u=>u.id==='qa-owner');
   initial.users=[owner,...[['qa-operator','QA OPERATOR','督導'],['qa-marine','QA MARINE','海務'],['qa-engineer','QA ENGINEER','船工']].map(([id,name,department])=>({...owner,id,name,username:id,department,role:'operator',managedVesselIds:['qa-v2']})),{...owner,id:'qa-other',name:'QA OTHER MARINE',username:'qa-other',department:'海務',role:'operator',managedVesselIds:[]}];
   initial.vessels.forEach((v,i)=>{delete v.nameEn;v.name=v.fullName=v.shortName=`QA VESSEL ${i+1}`;v.assignedUserIds=i===1?['qa-operator','qa-marine','qa-engineer']:[];v.weeklyAttention=i===1?['materials-parts']:[];v.manualAttentionLevel=i===1?'特別關注':'';});
   initial.vessels.push({...structuredClone(initial.vessels[0]),id:'qa-inactive',name:'QA INACTIVE',fullName:'QA INACTIVE',shortName:'QA INACTIVE',isActive:false});
   if(false){
     initial.notifications=Array.from({length:1000},(_,i)=>({id:`qa-retained-notice-${i}`,userId:'qa-other',vesselId:'qa-v1',taskId:'qa-old-task',kind:'task_created',title:'QA retained notice',message:'Neutral retained notification',actorId:'qa-owner',createdAt:initial.updatedAt}));
     initial.auditLogs=Array.from({length:500},(_,i)=>({id:`qa-retained-audit-${i}`,at:initial.updatedAt,actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action:'update-vessel',entityType:'vessel',entityId:'qa-v1',detail:'Neutral retained audit'}));
     receipt.fixtureRetentionCounts={notifications:1000,auditLogs:500};
   }
 }});
 await installTrackingBrowserMigrations(native.adapter);
 if(saveRepair){
   await installTrackingFieldRevision(native.adapter);
   for(const f of ['20260929120000_tracking_delivery_close.sql','20260929180000_tracking_completion_close.sql','20261008090000_tracking_unrelated_patch_fast_path.sql','20261013110000_task_unrelated_tracking_fast_path.sql'])await native.adapter.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
   receipt.repairSqlSha256=hash(fs.readFileSync('supabase/migrations/20261013110000_task_unrelated_tracking_fast_path.sql','utf8'));
 }
 receipt.origin=qa.origin;receipt.layer='真實原始 App UI＋測試資料＋本機 PostgreSQL；非正式 Supabase';
 receipt.inputs=fingerprints();receipt.inputHashAlgorithm='SHA256 raw file bytes';
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socketPath;await until(()=>{try{[chromePort,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
 receipt.chrome={pid:browser.pid,port:Number(chromePort)};
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){const {type,message}=m.params;receipt.dialogs??=[];receipt.dialogs.push({caseId:currentCase,type,message});await call('Page.handleJavaScriptDialog',{accept:type==='confirm'||type==='beforeunload'},m.sessionId);}
   if(m.method==='Fetch.requestPaused'){
    const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);
    if(!allowed)receipt.blockedExternal.push(u.origin);
    try{await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}
    catch(error){
     // Chromium can invalidate a paused request at document replacement/abort.
     // Keep that CDP notice separately; never suppress page exceptions or an
     // external-origin interception failure. SQL/DOM assertions remain required.
     if(u.origin!==qa.origin||error.message!=='Invalid InterceptionId.')throw error;
     receipt.staleCdpInterceptions??=[];receipt.staleCdpInterceptions.push({caseId:currentCase,networkId:m.params.networkId,code:error.message});
    }
   }
   if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(qa.origin+'/rest/v1/rpc/')){const b=JSON.parse(m.params.request.postData||'{}'),row={caseId:currentCase,actor:actors.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:b.p_operation_id,readScope:b.p_scope,started:m.params.wallTime*1000};netRows.set(m.sessionId+':'+m.params.requestId,row);receipt.network.push(row);}
   const row=netRows.get(m.sessionId+':'+m.params.requestId);
   if(m.method==='Network.responseReceived'&&row)row.httpStatus=m.params.response.status;
   if(m.method==='Network.loadingFailed'&&row){row.finished=Date.now();row.failure=m.params.errorText;save();}
   if(m.method==='Network.loadingFinished'&&row){row.finished=Date.now();try{const raw=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId);const v=JSON.parse(raw.base64Encoded?Buffer.from(raw.body,'base64').toString():raw.body);row.response=scrub(v);}catch(error){row.responseReadError=error.message;}save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });
 const context=(await call('Target.createBrowserContext')).browserContextId;a=await makePage('qa-owner',context);await login(a);
 await a.click('待辦總表');await until(()=>a.eval("Boolean(document.querySelector('.selected-task-list-panel'))"),'total list');await a.click('清除篩選');

 const fixtureLabel='QA existing ordinary task recovery';
 const receiptRpc='get_ship_dynamics_record_receipt_v1';
 const originalBody=await read();
 let taskId;
 const task=async()=> (await read()).payload.tasks.find(t=>t.id===taskId);
 const openExisting=async(p=a)=>{
   const row=`[...document.querySelectorAll('.selected-task-list-panel tbody tr')].find(n=>n.textContent.includes(${JSON.stringify(fixtureLabel)}))`;
   await until(()=>p.eval(`Boolean(${row})`),'existing ordinary task row');
   receipt.rowButtons=await p.eval(`[...(${row}).querySelectorAll('button')].map(n=>n.innerText.trim())`);
   await p.activate(`[...(${row}).querySelectorAll('button')].find(n=>/^(更新|編輯|更新狀態.*)$/.test(n.innerText.trim()))`);
   await until(()=>p.eval("document.querySelector('#task-edit-title')?.textContent==='更新要事'"),'original existing task editor');
 };
 const addStatus=async(text,p=a)=>{await p.fill("document.querySelector('.quick-status-bar textarea')",text);await p.click('加入狀態紀錄');await until(()=>p.eval(`document.querySelector('.status-history')?.textContent.includes(${JSON.stringify(text)})`),'staged status');};
 const saved=async(p=a)=>{await until(()=>p.eval(`!${taskDialog}`),'update ACK closes original editor');await until(()=>p.eval("Boolean(document.querySelector('.save-status-strip.saved'))"),'saved strip');};
 await check('healthy-existing-ordinary-task-update-exact-native-readback',async()=>{
   await create(a,'qa-v1');await content(a,fixtureLabel);await a.click('保存並關閉');await saved();
   const created=(await read()).payload.tasks.filter(t=>t.description.includes(fixtureLabel));assert.equal(created.length,1);taskId=created[0].id;
   assert.equal(created[0].sourceType,'morning');assert.equal(created[0].isInternalControl,false);
   await openExisting();const before=await task(),start=receipt.network.length;
   await addStatus('QA healthy existing task update');await a.click('保存變更');await saved();
   const after=await task();assert.equal(after.id,before.id);assert.equal(after.statusLogs.length,before.statusLogs.length+1);
   assert.equal(after.statusLogs.filter(l=>l.text==='QA healthy existing task update').length,1);
   assert.equal(after.description,before.description);assert.equal(after.vesselId,before.vesselId);
   assert.deepEqual(after.statusLogs.filter(l=>l.text!=='QA healthy existing task update'),before.statusLogs,'all prior exact status records preserved');
   assert.equal(receipt.network.slice(start).filter(r=>r.rpc===patchRpc).length,1);
   receipt.healthy={before,after};await a.screen('healthy-existing-update');
 });
 await check('committed-lost-ack-receipt-only-no-repeat-writer',async()=>{
   await openExisting();const before=await task(),start=receipt.network.length;let op='',dropped=0;
   qa.setRecordFault({after:async({name,body})=>{if(name===patchRpc&&body.p_operations.some(o=>o.collection==='tasks')){op=body.p_operation_id;dropped++;return true;}return false;}});
   await addStatus('QA committed lost ACK');await a.click('保存變更');await saved();qa.setRecordFault(null);
   const after=await task(),requests=receipt.network.slice(start);assert.equal(dropped,1);
   assert.equal(requests.filter(r=>r.rpc===patchRpc).length,1,'COMMIT+lost ACK must not resend a writer');
   assert.ok(requests.some(r=>r.rpc===receiptRpc&&r.operationId===op),'exact original operation receipt must be queried');
   assert.ok(receipt.httpTransactions.some(r=>r.rpc===patchRpc&&r.operationId===op&&r.committed),'native commit existed before dropped ACK');
   assert.equal(after.statusLogs.length,before.statusLogs.length+1);assert.equal(after.statusLogs.filter(l=>l.text==='QA committed lost ACK').length,1);
   assert.deepEqual(after.statusLogs.filter(l=>l.text!=='QA committed lost ACK'),before.statusLogs,'lost ACK neither duplicates nor rewrites prior history');
   receipt.lostAck={operationId:op,before,after,requests};await a.screen('commit-lost-ack-recovered');
 });
 for(const mode of ['rollback','late-commit','peer-conflict'])await check(mode==='rollback'?'sql57014-plus-unavailable-receipt-expired-exact-lease-ui-recovery':mode==='late-commit'?'late-committed-receipt-after-lease-expiry-zero-writer-recovery':'peer-lock-and-stale-cas-no-overwrite-explicit-close-reopen',async()=>{
   const statusText=`QA ${mode} pending recovery`;
   await openExisting();await addStatus(statusText);
   const before=await read(),start=receipt.network.length,metricStart=qa.metrics.length;
   const signature='public.get_ship_dynamics_record_receipt_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)';
   const originalReceipt=(await native.adapter.query('select pg_get_functiondef($1::regprocedure) d',[signature])).rows[0].d;
   assert.ok(originalReceipt.includes('begin\n'));
   // Owned fixture only. Explicit injected SQLSTATE, not a reproduction of production SQL performance.
   if(mode!=='late-commit')await native.adapter.exec(`create function public.qa_task_update_timeout() returns trigger language plpgsql as $qa$ begin if new.collection='tasks' and new.value::text like '%${statusText}%' then raise exception 'QA controlled task update statement timeout' using errcode='57014';end if;return new;end $qa$;create trigger qa_task_update_timeout before update on public.ship_dynamics_records for each row execute function public.qa_task_update_timeout();`);
   await native.adapter.exec(originalReceipt.replace('begin\n',"begin\n if strpos(current_query(),'apply_ship_dynamics_record_patch_v1')=0 then raise exception 'QA receipt SQL unavailable' using errcode='57014';end if;\n"));
   let attempt;
   qa.setRecordFault({before:async({name,body})=>{if(name===patchRpc&&body.p_operations.some(o=>o.collection==='tasks')){attempt=structuredClone(body);}},after:async({name})=>mode==='late-commit'&&name===patchRpc});
   await a.click('保存變更');
   if(mode!=='late-commit')await until(()=>qa.metrics.slice(metricStart).some(r=>r.rpc===patchRpc&&r.status==='SQL_ERROR'&&r.code==='57014'),'actual native writer SQLSTATE 57014');
   await until(()=>qa.metrics.slice(metricStart).some(r=>r.rpc===receiptRpc&&r.status==='SQL_ERROR'&&r.code==='57014'),'actual native receipt SQLSTATE 57014');
   await until(()=>a.eval("Boolean(document.querySelector('#task-edit-title'))&&!document.querySelector('.edit-modal').textContent.includes('正在確認雲端')"),'failed existing update settles');
   assert.ok(attempt?.p_operation_id);
   if(mode!=='late-commit')assert.deepEqual(await read(),before,'native 57014 must roll back all business changes');
   else assert.ok(receipt.httpTransactions.some(r=>r.rpc===patchRpc&&r.operationId===attempt.p_operation_id&&r.committed),'late receipt belongs to actual COMMIT');
   assert.equal(receipt.network.slice(start).filter(r=>r.rpc===patchRpc).length,1);
   assert.ok((await a.eval("document.querySelector('.status-history').textContent")).includes(statusText),'same original draft preserved');
   receipt.failureStage={controlledFault:true,notClaimedProductionRootCause:true,operationId:attempt.p_operation_id,taskId,before:scrub(before),ui:await a.text()};
   await a.screen('unknown-result-before-expiry');
   await native.adapter.exec(originalReceipt);if(mode!=='late-commit')await native.adapter.exec('drop trigger qa_task_update_timeout on public.ship_dynamics_records;drop function public.qa_task_update_timeout();');qa.setRecordFault(null);
   const taskGuard=attempt.p_lock_guards.find(g=>g.section_key===`task:${taskId}`);assert.ok(taskGuard,'capture exact admitted task lease, not every fixture lease');
   const expired=(await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key=$2 and locked_by=$3 returning section_key,locked_by,expires_at",[qa.workspace,taskGuard.section_key,taskGuard.locked_by])).rows;
   assert.equal(expired.length,1);receipt.expiredExactLease=expired;
   // Let the unchanged native heartbeat observe the server lease loss. No React state or clock mutation.
   await until(()=>a.eval("document.querySelector('#task-edit-title')?.textContent==='查看要事'&&Boolean(document.querySelector('.read-only-body'))"),'native renewal loss makes retained original task read-only',45000);
   assert.ok((await a.eval("document.querySelector('.status-history').textContent")).includes(statusText));
   receipt.readonlyUi=await a.text();await a.screen('readonly-after-real-lease-expiry');save();
   let peer;
   if(mode==='peer-conflict'){
     for(const g of attempt.p_lock_guards)await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key=$2 and locked_by=$3",[qa.workspace,g.section_key,g.locked_by]);
     peer=await makePage('qa-owner',(await call('Target.createBrowserContext')).browserContextId);await login(peer);
     await peer.click('待辦總表');await peer.click('清除篩選');await openExisting(peer);
     await addStatus('QA peer authoritative update',peer);
     const prior=await task(),blockedStart=receipt.network.length;
     await a.click('同步最新（安全合併）');
     await until(()=>receipt.network.slice(blockedStart).some(r=>r.rpc==='claim_ship_dynamics_edit_lock'&&r.response?.ok===false),'native peer lock denial');
     await until(async()=>(await a.text()).includes('正在由')&&await a.eval("Boolean(document.querySelector('.save-status-strip.error'))&&!document.querySelector('.save-status-strip.saving')"),'peer lock blocks recovery');
     assert.equal(receipt.network.slice(blockedStart).filter(r=>r.rpc===patchRpc).length,0,'no writer while peer owns exact task');
     assert.deepEqual(await task(),prior,'blocked recovery has no business mutation');
     assert.match(await a.text(),/正在由/);
     await peer.click('保存變更');await saved(peer);
     assert.equal((await task()).statusLogs.filter(l=>l.text==='QA peer authoritative update').length,1);
   }
   const recoveryStart=receipt.network.length,dialogStart=receipt.dialogs?.length||0;
   // Existing user-visible recovery entry, native keyboard activation (no App setters/helpers).
   await a.click('同步最新（安全合併）');
   await until(()=>a.eval("[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='同步最新（安全合併）'&&!n.disabled)&&!document.querySelector('.save-status-strip.saving')"),'original sync attempt settles');
   await wait(800);
   receipt.recovery={ui:await a.text(),dialogs:(receipt.dialogs||[]).slice(dialogStart),requests:receipt.network.slice(recoveryStart),sql:scrub(await read())};
   await a.screen('recovery-result');save();
   // Contract: once fault is gone the original UI must reconcile the retained exact
   // submission, without discarding input, and offer an editable retry or finish it.
   // A generic timeout/undefined helper is NOT accepted as behavioral RED.
   const editable=await a.eval("document.querySelector('#task-edit-title')?.textContent==='更新要事'&&[...document.querySelectorAll('.edit-modal button')].some(n=>n.textContent==='保存變更'&&!n.disabled)");
   const persisted=(await task()).statusLogs.filter(l=>l.text===statusText).length;
   const stale=/StaleAsyncConfigError|非同步作業的雲端設定或 generation 已失效/.test(JSON.stringify(receipt.recovery.dialogs)+'\n'+receipt.recovery.ui);
   receipt.recoveryObservation={editable,persisted,stale,writerCount:receipt.recovery.requests.filter(r=>r.rpc===patchRpc).length,receiptCount:receipt.recovery.requests.filter(r=>r.rpc===receiptRpc).length};save();
   const recoverRequests=receipt.recovery.requests;
   assert.equal(stale,false,'no stale-generation dead end');
   assert.ok(recoverRequests.some(r=>r.rpc===receiptRpc&&r.operationId===attempt.p_operation_id),'lookup exact original receipt before any replay');
   assert.ok(recoverRequests.filter(r=>r.rpc===patchRpc).every(r=>r.operationId===attempt.p_operation_id),'never create a successor operation for recovery');
   if(mode==='peer-conflict'){
     assert.equal(persisted,0,'stale original submission cannot overwrite peer');
     assert.equal(await a.eval("Boolean(document.querySelector('.save-status-strip.saved'))"),false,'no false saved feedback');
     assert.equal((await task()).statusLogs.filter(l=>l.text==='QA peer authoritative update').length,1);
   }else{
     assert.ok(editable||persisted===1,`Original UI cannot recover retained existing-task update after exact lease expiry; observed ${JSON.stringify(receipt.recoveryObservation)}`);
     if(editable){await a.click('保存變更');await saved();}
     assert.equal((await task()).statusLogs.filter(l=>l.text===statusText).length,1);
     assert.equal(recoverRequests.filter(r=>r.rpc===patchRpc).length,mode==='late-commit'?0:1,'committed recovery is receipt-only, rolled-back retry is exactly once');
     assert.equal(await a.eval("Boolean(document.querySelector('.save-status-strip.saved'))"),true,'success only after native receipt plus readback');
   }
   if(await a.eval(`Boolean(${taskDialog})`))await a.click('關閉');
   await until(()=>a.eval(`!${taskDialog}`),'explicit close is reachable after recovery');
   await openExisting();await addStatus(`QA subsequent legitimate save ${mode}`);await a.click('保存變更');await saved();
   assert.equal((await task()).statusLogs.filter(l=>l.text===`QA subsequent legitimate save ${mode}`).length,1,'fresh original editor can save again');
   receipt.recoveries??=[];receipt.recoveries.push({mode,observation:receipt.recoveryObservation,readback:await task()});
 });
 assert.equal(receipt.errors.length,0,JSON.stringify(receipt.errors));assert.equal(receipt.blockedExternal.length,0);receipt.status='PASS';
} catch(error){failure=error;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:error.message,stack:error.stack};if(a)try{await a.screen('failure');fs.writeFileSync(path.join(run,'failure-ui.txt'),await a.text());fs.writeFileSync(path.join(run,'failure-sql.json'),JSON.stringify(scrub(await read()),null,2));}catch(captureError){receipt.captureError=captureError.message;}}
finally {
 if(releaseCommit)releaseCommit();if(qa)qa.setRecordFault(null);receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser)await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome exit',7000).catch(()=>{if(process.platform==='win32')spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F']);else browser.kill('SIGKILL');});
 if(qa)await qa.close();if(native)await native.close();
 receipt.chromeStopped=chromePort?await portClosed(Number(chromePort)):true;
 receipt.finalInputs=fingerprints();receipt.productBytesStable=JSON.stringify(receipt.finalInputs)===JSON.stringify(receipt.inputs);
 receipt.inputHeadAfter=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(!receipt.productBytesStable||receipt.inputHeadAfter!==receipt.inputHead){failure??=new Error('Execution inputs changed during the run');receipt.status='FAIL';receipt.provenanceFailure=true;}
 receipt.commands[0].exit=failure?1:0;save();
}
console.log(JSON.stringify({status:receipt.status,cases:receipt.cases,errors:receipt.errors,failure:receipt.failure,evidence:run,stopped:receipt.stopped,chromeStopped:receipt.chromeStopped,portClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved,recoveryObservation:receipt.recoveryObservation},null,2));
if(failure)process.exitCode=1;

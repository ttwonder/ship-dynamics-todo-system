import assert from 'node:assert/strict';
import {prepareMemberGraph,prepareDeleteGraph} from './task-member-shared-oracle.mjs';
import {assertMemberPair} from './task-member-business-oracle.mjs';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {scopedTaskExpected,assertScopedSqlResult,proveOracleRejectsTampering} from './record-scoped-business-oracle.mjs';
import {assertLifecycleReadback} from './record-scoped-lifecycle-oracle.mjs';

// QA-only: original main.tsx -> App, native input, synthetic identities.
// No setters, write helpers, fabricated responses, external hosts or user profile.
const focus=process.env.QA_MEMBER_UI_FOCUS||'original';
assert.ok(['original','pair','b01','scope','recovery','lifecycle','feedback','shared','concurrent','concurrent-reopen','delete','stale','parent','delete-wrong-task','delete-wrong-source','delete-blocked','permission','closed-source','close-policy'].includes(focus),'known isolated member QA mode');
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'member-ui-')),profile=path.join(run,'chrome');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',focus,cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-review-member-draft-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['scripts/verify-task-member-browser.mjs','scripts/record-scoped-business-oracle.mjs','scripts/record-scoped-lifecycle-oracle.mjs','src/InternalControlPage.tsx','src/TemporaryMeetings.tsx','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','src/App.tsx','src/EditModals.tsx','src/taskMemberEditor.ts','src/normalizedRepository.ts','src/taskVesselProgress.ts','scripts/task-member-business-oracle.mjs','scripts/task-member-shared-oracle.mjs','src/taskWorkflow.ts','src/meetingTaskWorkflow.ts','src/richText.ts','src/vesselDisplay.ts','src/permissions.ts','src/normalize.ts','supabase/development/20260909_task_member_protocol.sql','src/cloud.ts','src/cloudRecordScopes.ts','supabase/development/20260908_appdata_record_scoped_read.sql'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const patchRpc='save_ship_dynamics_task_member_v1';
let native,qa,browser,ws,failure,chromePort,releaseCommit,barrier=null,currentCase='setup',next=0;
const pending=new Map(),actors=[],netRows=new Map(),paused=[];
let rendezvous=false;
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
 p.saved=()=>p.eval("Boolean(document.querySelector('.save-status-strip.saved'))&&!document.querySelector('#task-edit-title')");
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
const noUnsafeAssurance=async(p,label)=>{await wait(80);assert.equal(await p.eval("Boolean(document.querySelector('.save-status-strip.saved'))||Boolean(document.querySelector('.save-toast.success'))||document.body.innerText.includes('本頁沒有未保存修改，現在可以安全關閉或重新整理。')"),false,label+' must not claim no unsaved work / safe to leave');};
const locks=async()=> (await native.observer.query("select section_key,locked_by from ship_dynamics_edit_locks where expires_at>now() order by section_key")).rows;
const businessLedger=async()=>{
 const tables=(await native.observer.query("select tablename from pg_tables where schemaname='public' and (tablename like 'ship_dynamics_record%' or tablename like 'ship_dynamics_task_member%') order by tablename")).rows.map(r=>r.tablename);
 const result={};for(const t of tables)result[t]=(await native.observer.query('select to_jsonb(t) value,xmin::text,ctid::text from public."'+t.replaceAll('"','""')+'" t order by to_jsonb(t)::text')).rows;return result;
};
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
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,taskMember:true,scopedRead:true,performanceTrace:true,preparePerformanceFixture:async(initial,vite)=>{
 const at=initial.updatedAt;initial.vessels.push({...structuredClone(initial.vessels[1]),id:'qa-v3',name:'QA VESSEL 3',nameEn:'QA VESSEL 3',fullName:'QA VESSEL 3',shortName:'QA VESSEL 3'});initial.users.find(u=>u.id==='qa-operator').managedVesselIds=['qa-v1','qa-v2'];for(const v of initial.vessels)v.assignedUserIds=['qa-operator'];initial.tasks=[];initial.internalControlCases=[];initial.meetings=[];
 const meeting={id:'qa-member-meeting',subject:'QA MEMBER MEETING',meetingDate:'2026-09-09',isInternalControl:false,isAbnormal:false,priority:'中',status:'追蹤中',vessels:['qa-v1','qa-v2','qa-v3'],vesselScopeMode:'vessels',participantUserIds:['qa-owner'],trackingUserIds:['qa-operator'],responsibleUserIds:['qa-operator'],taskItems:[{id:'qa-member-decision',description:'QA MEMBER TASK',categories:['船舶維護管理'],distributeToVessels:true}],statusLogs:[],createdAt:at,updatedAt:at,qaUnknown:{meeting:[3,2,1]}};
 initial.meetings=[meeting];
 const {reconcileMeetingTasks}=await vite.ssrLoadModule('/src/meetingTaskWorkflow.ts');
 reconcileMeetingTasks({tasks:initial.tasks,meetingId:meeting.id,vesselIds:meeting.vessels,vesselScopeMode:'vessels',followUps:meeting.taskItems,priority:meeting.priority,isAbnormal:false,isInternalControl:false,expectedDate:'',departments:['督導'],ownerUserIds:['qa-owner','qa-operator'],meetingTaskCategories:initial.settings.meetingTaskCategories,initialStatus:'QA initial',actorId:'qa-owner',actorName:'QA OWNER',at,createTaskId:()=> 'qa-member-task'});
 const t=initial.tasks[0];t.qaUnknown={task:[2,1]};t.vesselProgress=['qa-v1','qa-v2','qa-v3'].map(vesselId=>({vesselId,status:'QA original '+vesselId,isClosed:false,updatedAt:at,updatedBy:'qa-owner',statusLogs:[{id:'preview-1-'+vesselId,at,by:'QA OWNER',text:'preview 1'},{id:'preview-2-'+vesselId,at,by:'QA OWNER',text:'preview 2'},{id:'raw-'+vesselId,at,by:'QA OWNER',byUserId:'qa-owner',text:'QA_PRIVATE_HISTORY_'+vesselId,qaUnknown:{preserved:[2,1]}}],qaUnknown:{member:[1,2]}}));
 if(['shared','concurrent','concurrent-reopen','permission','closed-source'].includes(focus)){
   initial.users.find(u=>u.id==='qa-operator').role='admin';
   for(const p of t.vesselProgress.filter(p=>['closed-source','concurrent-reopen'].includes(focus)||(['shared','permission'].includes(focus)?p.vesselId!=='qa-v1':p.vesselId==='qa-v3')))Object.assign(p,{isClosed:true,closedDate:'2026-09-09',closedBy:'qa-owner'});
 }
 if(focus==='permission')initial.users.find(u=>u.id==='qa-operator').role='operator';
 if(focus==='close-policy')initial.settings.rolePermissions.operator.closeTasks=false;
 if(['closed-source','concurrent-reopen'].includes(focus)){if(focus==='closed-source')meeting.status='已完成';Object.assign(meeting.taskItems[0],{isClosed:true,closedDate:'2026-09-09',closedBy:'qa-owner'});}
 if(focus.startsWith('delete-wrong')){const other=structuredClone(meeting);other.id='qa-other-meeting';other.taskItems[0].id='qa-other-decision';initial.meetings.push(other);const otherTask=structuredClone(t);otherTask.id='qa-other-task';otherTask.sourceMeetingId=other.id;otherTask.sourceMeetingItemId=other.taskItems[0].id;otherTask.description='QA OTHER CANARY';initial.tasks.push(otherTask);}
 initial.notifications=[];initial.auditLogs=[];
 },databaseFactory:async()=>native.adapter});
 await (await import('./tracking-browser-fixture.mjs')).installTrackingBrowserMigrations(native.adapter);receipt.origin=qa.origin;assert.equal((await (await fetch(qa.origin+'/__qa/health')).json()).kind,'REAL_UI_SYNTHETIC_DATA_NATIVE_POSTGRES');
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socketPath;await until(()=>{try{[chromePort,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
 receipt.chrome={pid:browser.pid,port:Number(chromePort)};
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){
    const {type,message}=m.params,deleteConfirm=currentCase.startsWith('MEMBER-UI-DELETE')&&type==='confirm'&&message.startsWith('確定刪除待辦'),accept=deleteConfirm?currentCase!=='MEMBER-UI-DELETE-CANCEL':type==='beforeunload'||type==='prompt'&&message.includes('完成日期')||type==='confirm'&&['同步最新會保留本機修改','請盡量以船端修改為主','確定批量完成所選','確定結案會議','確定重新開啟會議','確定重新開啟此待辦'].some(t=>message.startsWith(t));
    if(!accept&&!deleteConfirm)receipt.errors.push('unexpected dialog: '+message);await call('Page.handleJavaScriptDialog',{accept,...(type==='prompt'?{promptText:'2026-09-09'}:{})},m.sessionId);
   }
   if(m.method==='Fetch.requestPaused'){
    const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);
    if(!allowed)receipt.blockedExternal.push(u.origin);
    if(allowed&&u.pathname.endsWith('/rpc/'+patchRpc)){outgoing.push({caseId:currentCase,body:JSON.parse(m.params.request.postData),captured:Date.now()});fs.writeFileSync(path.join(run,'outgoing-before-sql.json'),JSON.stringify(outgoing.map(r=>({...r,body:scrub(r.body)})),null,2));}
    if(allowed&&rendezvous&&u.pathname.endsWith('/rpc/'+patchRpc)){
     const body=JSON.parse(m.params.request.postData);paused.push({session:m.sessionId,requestId:m.params.requestId,operationId:body.p_operation_id,actor:body.p_actor_user_id,payloadHash:hash(body),expected:body.p_expected});save();return;
    }
    await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);
   }
   if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(qa.origin+'/rest/v1/rpc/')){
    const b=JSON.parse(m.params.request.postData||'{}'),row={caseId:currentCase,actor:actors.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:b.p_operation_id,readScope:b.p_scope,targets:b.p_targets,payloadHash:hash(b),started:m.params.wallTime*1000};
    netRows.set(m.sessionId+':'+m.params.requestId,row);receipt.network.push(row);
   }
   const row=netRows.get(m.sessionId+':'+m.params.requestId);
   if(m.method==='Network.responseReceived'&&row)row.httpStatus=m.params.response.status;
   if(m.method==='Network.loadingFinished'&&row){const response=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId);const v=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body);Object.assign(row,{ok:v?.ok,memberHistory1:JSON.stringify(v).includes('QA_PRIVATE_HISTORY_qa-v1'),memberHistory2:JSON.stringify(v).includes('QA_PRIVATE_HISTORY_qa-v2'),containsUnloadedDetail:JSON.stringify(v).includes('QA_UNLOADED_DETAIL_SENTINEL'),containsOtherMeetingHistory:JSON.stringify(v).includes('QA_OTHER_MEETING_HISTORY'),finished:Date.now(),result:v?.ok===false?v.code:'SQL_OK',conflictKey:v?.conflict_key,revision:v?.revision});save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });

 const a=await makePage('qa-owner',(await call('Target.createBrowserContext')).browserContextId);await login(a);
 const b=null;
 const open=async(p,id)=>{await p.open(id);const n=receipt.network.length;await p.activate(`[...document.querySelectorAll('.modal-task-row')].find(n=>n.innerText.includes('QA MEMBER TASK'))`);await until(()=>receipt.network.slice(n).some(r=>r.actor===p.actor&&r.rpc==='claim_ship_dynamics_edit_lock'&&r.finished),'original claim response');const claim=receipt.network.slice(n).filter(r=>r.actor===p.actor&&r.rpc==='claim_ship_dynamics_edit_lock').at(-1);assert.equal(claim.result,'SQL_OK','MEMBER-UI-PAIR different selected members must both acquire original editor leases');await until(()=>p.eval("Boolean(document.querySelector('#task-edit-title'))"),'original task modal');};
 const selectScope=async(p,index)=>{await p.eval("document.querySelector('select[aria-label=待辦進度範圍]').focus()");if(index===3){await p.key('End');return;}await p.key('Home');for(let i=0;i<index;i++)await p.key('ArrowDown');};

 currentCase='R2-F1-SIBLING-UNSENT-A-AFTER-B-SAVE';
 await open(a,'qa-v1');
 const before=await read();
 await a.fill("document.querySelector('.quick-status-bar textarea')",'PARENT REPRO A UNSENT');
 await a.click('加入狀態紀錄');
 await selectScope(a,1);
 await until(()=>a.eval("document.querySelector('select[aria-label=待辦進度範圍]').value==='qa-v2'&&document.querySelector('[aria-label=單船目前狀態]').contentEditable==='true'"),'B acquired');
 const priorDraft=await a.eval("Object.entries(localStorage).filter(([k,v])=>k.startsWith('ship-dynamics.normalized.local:')&&v.includes('PARENT REPRO A UNSENT'))");
 assert.ok(priorDraft.length,'A durable private draft exists before B save');
 await a.fill("document.querySelector('.quick-status-bar textarea')",'PARENT REPRO B SAVED');await a.click('加入狀態紀錄');
 await a.click('保存變更');await until(()=>a.saved(),'B durable save and auto-close');
 const after=await read();
 assert.equal(after.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v2').status,'PARENT REPRO B SAVED');
 assert.deepEqual(after.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v1'),before.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v1'),'single vessel save correctly leaves A cloud unchanged');
 const afterDraft=await a.eval("Object.entries(localStorage).filter(([k,v])=>k.startsWith('ship-dynamics.normalized.local:')&&v.includes('PARENT REPRO A UNSENT'))");
 await until(()=>a.eval(`Boolean(${field})`),'parent ship source');await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('[role=dialog]')"),'parent source closed');
 await open(a,'qa-v1');
 const reopened=await a.eval("document.querySelector('[aria-label=單船目前狀態]').innerText");
 receipt.reproduction={id:'R2-F1',scope:'Original mounted App + synthetic data + native local PostgreSQL',beforePrivateDraftCount:priorDraft.length,afterPrivateDraftCount:afterDraft.length,expectedA:'PARENT REPRO A UNSENT',actualA:reopened,cloudAUnchanged:true,cloudBConfirmed:true};
 fs.writeFileSync(path.join(run,'r2-f1-evidence.json'),JSON.stringify(receipt.reproduction,null,2));
 await a.screen('r2-f1-reopened-A');
 assert.equal(reopened,'PARENT REPRO A UNSENT','R2-F1 desired behavior: successful save of B must not discard A private draft');
 receipt.cases.push({caseId:currentCase,status:'PASS'});
 assert.deepEqual(receipt.errors,[]);receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}save();console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseCommit?.();rendezvous=false;receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 const processGone=()=>!browser||!spawnSync('tasklist',['/FI',`PID eq ${browser.pid}`,'/FO','CSV','/NH'],{encoding:'utf8'}).stdout.includes(`","${browser.pid}",`);
 try{if(browser&&!processGone()){spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(processGone,'owned Chrome gone',5000);}}catch(e){receipt.chromeCleanupRetry=e.message;}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)await until(()=>portClosed(Number(chromePort)),'owned Chrome port closes after service cleanup',5000);assert.ok(processGone());fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

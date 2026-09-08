import assert from 'node:assert/strict';
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
assert.ok(['original','pair','scope','recovery','lifecycle'].includes(focus),'known isolated member QA mode');
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'member-ui-')),profile=path.join(run,'chrome');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-task-member-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['scripts/verify-task-member-browser.mjs','scripts/record-scoped-business-oracle.mjs','scripts/record-scoped-lifecycle-oracle.mjs','src/InternalControlPage.tsx','src/TemporaryMeetings.tsx','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','src/App.tsx','src/EditModals.tsx','src/taskMemberEditor.ts','src/normalizedRepository.ts','src/taskVesselProgress.ts','scripts/task-member-business-oracle.mjs','supabase/development/20260909_task_member_protocol.sql','src/cloud.ts','src/cloudRecordScopes.ts','supabase/development/20260908_appdata_record_scoped_read.sql'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
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
 qa=await createRecordStorageLocalQa({internalControl:true,taskMember:true,scopedRead:true,performanceTrace:true,preparePerformanceFixture:async(initial,vite)=>{
 const at=initial.updatedAt;initial.vessels.push({...structuredClone(initial.vessels[1]),id:'qa-v3',name:'QA VESSEL 3',nameEn:'QA VESSEL 3',fullName:'QA VESSEL 3',shortName:'QA VESSEL 3'});initial.users.find(u=>u.id==='qa-operator').managedVesselIds=['qa-v1','qa-v2'];for(const v of initial.vessels)v.assignedUserIds=['qa-operator'];initial.tasks=[];initial.internalControlCases=[];initial.meetings=[];
 const meeting={id:'qa-member-meeting',subject:'QA MEMBER MEETING',meetingDate:'2026-09-09',isInternalControl:false,isAbnormal:false,priority:'中',status:'追蹤中',vessels:['qa-v1','qa-v2','qa-v3'],vesselScopeMode:'vessels',participantUserIds:['qa-owner'],trackingUserIds:['qa-operator'],responsibleUserIds:['qa-operator'],taskItems:[{id:'qa-member-decision',description:'QA MEMBER TASK',categories:['船舶維護管理'],distributeToVessels:true}],statusLogs:[],createdAt:at,updatedAt:at,qaUnknown:{meeting:[3,2,1]}};
 initial.meetings=[meeting];
 const {reconcileMeetingTasks}=await vite.ssrLoadModule('/src/meetingTaskWorkflow.ts');
 reconcileMeetingTasks({tasks:initial.tasks,meetingId:meeting.id,vesselIds:meeting.vessels,vesselScopeMode:'vessels',followUps:meeting.taskItems,priority:meeting.priority,isAbnormal:false,isInternalControl:false,expectedDate:'',departments:['督導'],ownerUserIds:['qa-owner','qa-operator'],meetingTaskCategories:initial.settings.meetingTaskCategories,initialStatus:'QA initial',actorId:'qa-owner',actorName:'QA OWNER',at,createTaskId:()=> 'qa-member-task'});
 const t=initial.tasks[0];t.qaUnknown={task:[2,1]};t.vesselProgress=['qa-v1','qa-v2','qa-v3'].map(vesselId=>({vesselId,status:'QA original '+vesselId,isClosed:false,updatedAt:at,updatedBy:'qa-owner',statusLogs:[{id:'preview-1-'+vesselId,at,by:'QA OWNER',text:'preview 1'},{id:'preview-2-'+vesselId,at,by:'QA OWNER',text:'preview 2'},{id:'raw-'+vesselId,at,by:'QA OWNER',byUserId:'qa-owner',text:'QA_PRIVATE_HISTORY_'+vesselId,qaUnknown:{preserved:[2,1]}}],qaUnknown:{member:[1,2]}}));
 initial.notifications=[];initial.auditLogs=[];
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
    const {type,message}=m.params,accept=type==='beforeunload'||type==='prompt'&&message.includes('完成日期')||type==='confirm'&&['同步最新會保留本機修改','請盡量以船端修改為主','確定批量完成所選','確定結案會議','確定重新開啟會議','確定重新開啟此待辦'].some(t=>message.startsWith(t));
    if(!accept)receipt.errors.push('unexpected dialog: '+message);await call('Page.handleJavaScriptDialog',{accept,...(type==='prompt'?{promptText:'2026-09-09'}:{})},m.sessionId);
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
 const b=await makePage('qa-operator',(await call('Target.createBrowserContext')).browserContextId);await login(b);
 const open=async(p,id)=>{await p.open(id);const n=receipt.network.length;await p.activate(`[...document.querySelectorAll('.modal-task-row')].find(n=>n.innerText.includes('QA MEMBER TASK'))`);await until(()=>receipt.network.slice(n).some(r=>r.actor===p.actor&&r.rpc==='claim_ship_dynamics_edit_lock'&&r.finished),'original claim response');const claim=receipt.network.slice(n).filter(r=>r.actor===p.actor&&r.rpc==='claim_ship_dynamics_edit_lock').at(-1);assert.equal(claim.result,'SQL_OK','MEMBER-UI-PAIR different selected members must both acquire original editor leases');await until(()=>p.eval("Boolean(document.querySelector('#task-edit-title'))"),'original task modal');};
 const selectScope=async(p,index)=>{await p.eval("document.querySelector('select[aria-label=待辦進度範圍]').focus()");await p.key('Home');for(let i=0;i<index;i++)await p.key('ArrowDown');await p.key('Enter');};
 if(['scope','recovery'].includes(focus)){
  currentCase='MEMBER-UI-SCOPE-GENERATION';
  await open(a,'qa-v1');const original=await read();
  await a.fill("document.querySelector('.quick-status-bar textarea')",'SCOPE A UNSENT');await a.click('加入狀態紀錄');
  await a.eval("void(window.__scopeFenceNode=document.querySelector('[aria-label=單船目前狀態]'))");
  let held=false,release;
  qa.setRecordFault({before:async({name,body})=>{if(name==='read_ship_dynamics_record_scopes_v1'&&body.p_scope==='targets'&&!held){held=true;await new Promise(r=>{release=r;});}}});
  await selectScope(a,3);await until(()=>held,'overall native read barrier');
  await selectScope(a,1);await until(()=>a.eval("document.querySelector('select[aria-label=待辦進度範圍]').value==='qa-v2'&&document.querySelector('[aria-label=單船目前狀態]').contentEditable==='true'"),'successor B acquired');
  await a.eval("void(window.__scopeFenceNode=document.querySelector('[aria-label=單船目前狀態]'))");
  const lateStart=receipt.network.length;release();await wait(700);
  assert.equal(receipt.network.slice(lateStart).filter(r=>r.rpc==='claim_ship_dynamics_edit_lock').length,0,'stale overall read must not dispatch parent claim after successor B');
  assert.equal(await a.eval("window.__scopeFenceNode===document.querySelector('[aria-label=單船目前狀態]')&&window.__scopeFenceNode.contentEditable==='true'"),true);
  qa.setRecordFault(null);await selectScope(a,0);await until(()=>a.eval("document.querySelector('.status-history')?.innerText.includes('SCOPE A UNSENT')"),'A ABA draft retained');
  assert.deepEqual(await read(),original);receipt.cases.push({caseId:currentCase,status:'PASS',nativeHeldRead:true,noStaleClaim:true,sameNode:true,noAutoSave:true});
  currentCase='MEMBER-UI-LATE-CLAIM-ABA';
  let claimHeld=false,releaseClaim,oldLease;
  qa.setRecordFault({after:async({name,body,value})=>{if(name==='claim_ship_dynamics_edit_lock'&&body.p_section_key.includes('qa-v2')&&!claimHeld){claimHeld=true;oldLease=value;await new Promise(r=>{releaseClaim=r;});}return false;}});
  await selectScope(a,1);await until(()=>claimHeld,'B native claim committed, response held');
  await selectScope(a,0);await until(()=>a.eval("document.querySelector('select[aria-label=待辦進度範圍]').value==='qa-v1'&&document.querySelector('[aria-label=單船目前狀態]').contentEditable==='true'"),'A successor while B response held');
  await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where section_key=$1",[oldLease.section_key]);
  await selectScope(a,1);await until(()=>a.eval("document.querySelector('select[aria-label=待辦進度範圍]').value==='qa-v2'&&document.querySelector('[aria-label=單船目前狀態]').contentEditable==='true'"),'new B generation acquired');
  const newLease=(await native.observer.query('select section_key,locked_by,lease_version from ship_dynamics_edit_locks where section_key=$1',[oldLease.section_key])).rows[0];assert.notEqual(newLease.lease_version,oldLease.lease_version);
  await a.eval("void(window.__lateClaimNode=document.querySelector('[aria-label=單船目前狀態]'))");releaseClaim();await wait(450);
  assert.deepEqual((await native.observer.query('select section_key,locked_by,lease_version from ship_dynamics_edit_locks where section_key=$1',[oldLease.section_key])).rows,[newLease],'late exact old release cannot affect new same-member lease');
  assert.equal(await a.eval("window.__lateClaimNode===document.querySelector('[aria-label=單船目前狀態]')&&window.__lateClaimNode.contentEditable==='true'"),true);assert.deepEqual(await read(),original);qa.setRecordFault(null);
  receipt.cases.push({caseId:currentCase,status:'PASS',nativeHeldClaim:true,actualNewLeaseVersion:true,lateReleaseFenced:true});
  await a.click('取消');await until(()=>a.saved(),'scope close');await until(()=>a.eval(`Boolean(${field})`),'scope source');await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('[role=dialog]')"),'scope source close');
 }
 if(focus==='recovery'){
  currentCase='MEMBER-UI-FRESH-PENDING';await open(a,'qa-v1');const before=await read();
  await a.fill("document.querySelector('.quick-status-bar textarea')",'FRESH SUBMITTED');await a.click('加入狀態紀錄');
  let committed=false,lookup=false,releaseLookup;
  qa.setRecordFault({after:async({name})=>{if(name===patchRpc){committed=true;return true;}if(name==='get_ship_dynamics_task_member_receipt_v1'){lookup=true;await new Promise(r=>{releaseLookup=r;});return true;}return false;}});
  await a.click('保存變更');await until(()=>committed&&lookup,'native commit ACK lost and receipt barrier');
  await a.eval("document.querySelector('[aria-label=單船目前狀態]').focus()");await call('Input.insertText',{text:' NEWER UNSENT FRESH'},a.s);
  const visible=await a.eval("document.querySelector('[aria-label=單船目前狀態]').innerHTML");
  const persisted=await a.eval("Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('ship-dynamics-member-pending-v1:')))");
  const pendingKey=Object.keys(persisted).find(k=>{try{return JSON.parse(persisted[k]).params?.p_operation_id;}catch{return false;}});assert.ok(pendingKey,'original immutable submitted request persisted');
  const envelope=JSON.parse(persisted[pendingKey]);releaseLookup();await until(()=>receipt.errors.some(s=>s.startsWith('unexpected dialog:')),'unknown outcome surfaced');receipt.errors=receipt.errors.filter(s=>!s.startsWith('unexpected dialog:'));
  qa.setRecordFault(null);await a.eval('void(window.__oldRecoveryDocument=true)');await call('Page.reload',{},a.s);
  await until(()=>a.eval('window.__oldRecoveryDocument!==true&&Boolean(document.querySelector("article.ship-card"))'),'real new original document');
  await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where section_key like 'task-member-v1:%'");
  await open(a,'qa-v1');
  assert.equal(await a.eval("document.querySelector('[aria-label=單船目前狀態]').innerHTML"),visible,'new browser document restores newer unsent text, not only committed authority');
  assert.equal(await a.eval(`localStorage.getItem(${JSON.stringify(pendingKey)})`),persisted[pendingKey],'opening never rewrites original pending envelope');
  const wireStart=receipt.network.length;await a.click('保存變更');
  await until(()=>receipt.network.slice(wireStart).some(r=>r.rpc==='get_ship_dynamics_task_member_receipt_v1'&&r.finished),'fresh document original receipt lookup');await wait(300);
  assert.equal(await a.eval("Boolean(document.querySelector('#task-edit-title'))"),true,'prior ACK must not close newer draft');
  assert.equal(await a.eval("document.querySelector('[aria-label=單船目前狀態]').innerHTML"),visible);
  const lookupWire=receipt.network.slice(wireStart).find(r=>r.rpc==='get_ship_dynamics_task_member_receipt_v1');assert.equal(lookupWire.operationId,envelope.params.p_operation_id);assert.equal(lookupWire.payloadHash,hash(envelope.params));
  assert.equal((await read()).revision,before.revision+1,'receipt adoption never creates replacement operation');
  await a.click('保存變更');await until(()=>a.saved(),'durable newer draft distinct save');const after=await read();assert.equal(after.revision,before.revision+2);assert.equal(after.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v1').status,visible);
  for(const id of ['qa-v2','qa-v3'])assert.deepEqual(after.payload.tasks[0].vesselProgress.find(p=>p.vesselId===id),before.payload.tasks[0].vesselProgress.find(p=>p.vesselId===id));
  assert.deepEqual(after.payload.tasks[0].qaUnknown,before.payload.tasks[0].qaUnknown);
  assert.deepEqual(after.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v1').statusLogs.slice(-3),before.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v1').statusLogs.slice(-3));
  receipt.cases.push({caseId:currentCase,status:'PASS',freshDocument:true,immutableOriginalReceipt:true,newerUnsentDurable:true,unselectedCanary:true,rawHistory:true});
  await until(()=>a.eval(`Boolean(${field})`),'fresh source');await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('[role=dialog]')"),'fresh source close');
 }
 if(focus==='recovery'){
  currentCase='MEMBER-UI-FRESH-UNSENT-PRIVATE';await open(a,'qa-v1');const before=await read();
  await a.fill("document.querySelector('.quick-status-bar textarea')",'PRIVATE UNSENT PROGRESS');await a.click('加入狀態紀錄');
  await a.fill("document.querySelector('.quick-status-bar textarea')",'PRIVATE QUICK NOT ADDED');
  await a.eval('void(window.__oldUnsentDocument=true)');await call('Page.reload',{},a.s);await until(()=>a.eval('window.__oldUnsentDocument!==true&&Boolean(document.querySelector("article.ship-card"))'),'new unsent document');
  await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where section_key like 'task-member-v1:%'");
  await open(b,'qa-v1');assert.equal((await b.text()).includes('PRIVATE UNSENT PROGRESS'),false,'other actor never adopts predecessor private draft');assert.equal(await b.eval("document.querySelector('.quick-status-bar textarea').value"),'');await b.click('取消');await until(()=>b.saved(),'private B close');await until(()=>b.eval(`Boolean(${field})`),'private B source');await b.click('取消並關閉');await until(()=>b.eval("!document.querySelector('[role=dialog]')"),'private B source closed');
  await open(a,'qa-v1');assert.equal(await a.eval("document.querySelector('[aria-label=單船目前狀態]').innerText"),'PRIVATE UNSENT PROGRESS');assert.equal(await a.eval("document.querySelector('.quick-status-bar textarea').value"),'PRIVATE QUICK NOT ADDED');assert.deepEqual(await read(),before,'recovery and actor read never auto-save');
  await a.click('取消');await until(()=>a.saved(),'private A discard');await until(()=>a.eval(`Boolean(${field})`),'private A source');await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('[role=dialog]')"),'private A source closed');
  receipt.cases.push({caseId:currentCase,status:'PASS',freshDocument:true,unsentOnly:true,quickInput:true,actorPrivate:true,zeroBusinessWrites:true});
 }
 if(focus==='lifecycle'){
  currentCase='MEMBER-UI-NAV-CONTINUITY';await open(a,'qa-v1');const navBefore=await read();
  await a.fill("document.querySelector('.quick-status-bar textarea')",'NAV DRAFT RETAIN');await a.click('加入狀態紀錄');
  await a.eval("void(window.__navNode=document.querySelector('[aria-label=單船目前狀態]'))");const navWire=receipt.network.length;
  await a.click('待辦總表');await wait(1200);
  assert.equal(await a.eval("window.__navNode===document.querySelector('[aria-label=單船目前狀態]')&&window.__navNode.contentEditable==='true'&&window.__navNode.innerText.includes('NAV DRAFT RETAIN')"),true,'navigation must not orphan active member draft/request generation');
  assert.equal(receipt.network.slice(navWire).filter(r=>r.rpc==='read_ship_dynamics_record_scopes_v1').length,0,'blocked navigation does not change authority coverage');assert.deepEqual(await read(),navBefore);
  receipt.cases.push({caseId:currentCase,status:'PASS',nativeNavigation:true,sameNode:true,noOrphan:true});
  currentCase='MEMBER-UI-CONFIG-ABA';const before=await read();
  await a.fill("document.querySelector('.quick-status-bar textarea')",'CONFIG DRAFT RETAIN');await a.click('加入狀態紀錄');
  await a.eval("void(window.__configNode=document.querySelector('[aria-label=單船目前狀態]'))");
  await a.eval("(()=>{window.__originalQaConfig=window.SHIP_DYNAMICS_SUPABASE_CONFIG;window.SHIP_DYNAMICS_SUPABASE_CONFIG=undefined;window.dispatchEvent(new StorageEvent('storage',{key:'ship-dynamics-supabase-config'}));})()");await wait(1250);
  assert.equal(await a.eval("window.__configNode===document.querySelector('[aria-label=單船目前狀態]')&&window.__configNode.contentEditable==='false'&&window.__configNode.innerText.includes('CONFIG DRAFT RETAIN')"),true,'configuration removal must freeze same original draft node');
  await a.eval("(()=>{window.SHIP_DYNAMICS_SUPABASE_CONFIG=window.__originalQaConfig;window.dispatchEvent(new StorageEvent('storage',{key:'ship-dynamics-supabase-config'}));})()");await wait(100);
  assert.equal(await a.eval("window.__configNode.contentEditable"),'false','config A/B/A cannot reauthorize predecessor');assert.deepEqual(await read(),before);
  await a.screen('config-aba-same-draft');await a.click('關閉');await until(()=>a.saved(),'explicit config draft close');await until(()=>a.eval(`Boolean(${field})`),'config source return');await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('[role=dialog]')"),'config source close');
  receipt.cases.push({caseId:currentCase,status:'PASS',realConfigurationObserver:true,sameNode:true,stickyFreeze:true});
  currentCase='MEMBER-UI-ACK-LEASE-EXPIRY';const start=receipt.network.length;await open(a,'qa-v1');const ackBefore=await read();
  await a.fill("document.querySelector('.quick-status-bar textarea')",'LEGAL ACK AFTER EXPIRY');await a.click('加入狀態紀錄');
  const claim=receipt.network.slice(start).filter(r=>r.rpc==='claim_ship_dynamics_edit_lock').at(-1);
  await until(()=>Date.now()>claim.started+22000,'real heartbeat window before legal dispatch',25000);
  let ackHeld=false,releaseAck;qa.setRecordFault({after:async({name})=>{if(name===patchRpc&&!ackHeld){ackHeld=true;await new Promise(r=>{releaseAck=r;});}return false;}});
  await a.click('保存變更');await until(()=>ackHeld,'legal command committed ACK held');
  await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where section_key like 'task-member-v1:%'");
  await until(()=>a.eval("document.querySelector('[aria-label=單船目前狀態]')?.contentEditable==='false'"),'actual client heartbeat expiry during committed command',6500);
  releaseAck();await until(()=>a.saved(),'known legal committed ACK remains successful after lease loss');qa.setRecordFault(null);
  assert.equal((await read()).revision,ackBefore.revision+1);assert.equal(receipt.network.filter(r=>r.caseId===currentCase&&r.rpc===patchRpc).length,1);
  receipt.cases.push({caseId:currentCase,status:'PASS',legalCommittedAck:true,actualHeartbeatExpiry:true,noReplay:true});
  await until(()=>a.eval(`Boolean(${field})`),'ACK source');await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('[role=dialog]')"),'ACK source closed');

 }
 if(!['scope','recovery','lifecycle'].includes(process.env.QA_MEMBER_UI_FOCUS)){
 currentCase='MEMBER-UI-PAIR';const before=await read();fs.writeFileSync(path.join(run,'pair-before.json'),JSON.stringify(scrub(before),null,2));
 await open(a,'qa-v1');await open(b,'qa-v2');
 await a.screen('pair-a-open');await b.screen('pair-b-open');
 await until(async()=>(await locks()).filter(l=>l.section_key.startsWith('task-member-v1:')).length===2,'MEMBER-UI-PAIR two compatible actual member leases',5000);
 for(const [p,marker] of [[a,'MEMBER A FIRST ACK'],[b,'MEMBER B FIRST ACK']]){await p.fill("document.querySelector('.quick-status-bar textarea')",marker);await p.click('加入狀態紀錄');}
 const saveWindow={started:Date.now()};rendezvous=true;await a.click('保存變更');await b.click('保存變更');await until(()=>paused.length===2,'two original member requests');rendezvous=false;
 for(const q of paused)await call('Fetch.continueRequest',{requestId:q.requestId},q.session);
 await until(()=>a.saved(),'A first ACK');await until(()=>b.saved(),'B first ACK');
 const after=await read();assert.equal(after.revision,before.revision+2);const requests=outgoing.filter(x=>x.caseId===currentCase);assert.equal(requests.length,2,'both first ACK without retry/rebase');assert.ok(requests.every(x=>x.body.p_expected.member));
 fs.writeFileSync(path.join(run,'pair-after.json'),JSON.stringify(scrub(after),null,2));
 saveWindow.ended=Date.now();for(const r of requests)r.revision=receipt.network.find(n=>n.operationId===r.body.p_operation_id&&n.rpc===patchRpc).revision;const expected=await assertMemberPair(qa,before,after,requests,saveWindow);fs.writeFileSync(path.join(run,'pair-complete-graph.json'),JSON.stringify({before:scrub(before),after:scrub(after),expected:scrub(expected),requests:scrub(requests),window:saveWindow},null,2));
 const fresh=await native.connect('member_pair_fresh');assert.deepEqual((await fresh.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r,after);await fresh.end();
 for(const row of receipt.network.filter(r=>r.rpc==='read_ship_dynamics_task_member_v1'))assert.equal(row.actor==='qa-owner'?row.memberHistory2:row.memberHistory1,false,'no sibling history in member read');
 assert.equal(receipt.network.some(r=>r.readScope==='full'||['read_ship_dynamics_records_v1','read_ship_dynamics_record_delta_v1'].includes(r.rpc)),false,'no UI full read fallback');
 for(const p of [a,b]){await until(()=>p.eval(`Boolean(${field})`),'original source-return vessel dialog');await p.click('取消並關閉');await until(()=>p.eval("!document.querySelector('[role=dialog]')"),'source vessel released');await p.eval('void(window.__oldDocument=true)');await call('Page.reload',{},p.s);await until(()=>p.eval('window.__oldDocument!==true&&Boolean(document.querySelector("article.ship-card"))'),'fresh original browser');await open(p,p===a?'qa-v1':'qa-v2');assert.ok((await p.text()).includes(p===a?'MEMBER A FIRST ACK':'MEMBER B FIRST ACK'));await p.click('取消');await until(()=>p.saved(),'fresh close');}

 await a.screen('pair-a-saved');await b.screen('pair-b-saved');
 receipt.cases.push({caseId:currentCase,status:'PASS',firstAck:true});
 if(process.env.QA_MEMBER_UI_FOCUS!=='pair'){
 currentCase='MEMBER-UI-SWITCH';
 for(const p of [a,b]){await until(()=>p.eval(`Boolean(${field})`),'source return');await p.click('取消並關閉');await until(()=>p.eval("!document.querySelector('[role=dialog]')"),'source closed');}
 await open(a,'qa-v1');const switchBefore=await read();
 await a.fill("document.querySelector('.quick-status-bar textarea')",'A UNSAVED SCOPE');await a.click('加入狀態紀錄');
 await a.eval("void(window.__scopeNode=document.querySelector('[aria-label=單船目前狀態]'))");
 const select=async(p,index)=>{await p.eval("document.querySelector('select[aria-label=待辦進度範圍]').focus()");await p.key('Home');for(let i=0;i<index;i++)await p.key('ArrowDown');await p.key('Enter');};
 const n=receipt.network.length;await select(a,1);
 await until(()=>receipt.network.slice(n).some(r=>r.rpc==='read_ship_dynamics_task_member_v1'&&r.finished),'selector must read actual B member authority',5000);
 await until(()=>a.eval("document.querySelector('.status-history')?.innerText.includes('QA_PRIVATE_HISTORY_qa-v2')"),'selected B full raw history');
 await a.fill("document.querySelector('.quick-status-bar textarea')",'B UNSAVED SCOPE');await a.click('加入狀態紀錄');await select(a,0);
 await until(()=>a.eval("document.querySelector('.status-history')?.innerText.includes('A UNSAVED SCOPE')"),'A draft retained');
 assert.equal(await a.eval("window.__scopeNode===document.querySelector('[aria-label=單船目前狀態]')"),true,'same original editor DOM');
 assert.deepEqual(await read(),switchBefore,'switch never auto-saves another member');
 await select(a,1);await until(()=>a.eval("document.querySelector('.status-history')?.innerText.includes('B UNSAVED SCOPE')"),'B draft retained');
 await a.click('保存變更');await until(()=>a.saved(),'selected B save');
 const switched=await read();assert.equal(switched.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v1').status,'MEMBER A FIRST ACK');assert.equal(switched.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v2').status,'B UNSAVED SCOPE');
 await a.screen('switch-saved');receipt.cases.push({caseId:currentCase,status:'PASS',sameNode:true,noAutoSave:true});
 currentCase='MEMBER-UI-OUTCOME';
 await until(()=>a.eval(`Boolean(${field})`),'source return');await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('[role=dialog]')"),'source closed');
 await open(a,'qa-v1');const outcomeBefore=await read();
 await a.fill("document.querySelector('.quick-status-bar textarea')",'LOST ACK COMMITTED');await a.click('加入狀態紀錄');
 let dropped=0,receiptEntered=false,releaseReceipt;
 qa.setRecordFault({after:async({name})=>{if(name===patchRpc&&dropped++===0)return true;if(name==='get_ship_dynamics_task_member_receipt_v1'){receiptEntered=true;await new Promise(resolve=>{releaseReceipt=resolve;});}return false;}});
 await a.click('保存變更');await until(()=>receiptEntered,'real SQL committed, receipt held');
 await a.eval("void(window.__lateDraftNode=document.querySelector('[aria-label=單船目前狀態]'))");
 await a.eval("document.querySelector('[aria-label=單船目前狀態]').focus()");await call('Input.insertText',{text:' NEWER VISIBLE DRAFT'},a.s);
 const visibleNew=await a.eval("document.querySelector('[aria-label=單船目前狀態]').innerHTML");
 releaseReceipt();await until(()=>receipt.network.some(r=>r.caseId===currentCase&&r.rpc==='get_ship_dynamics_task_member_receipt_v1'&&r.finished),'authoritative held receipt');
 await wait(300);
 assert.equal(await a.eval("window.__lateDraftNode===document.querySelector('[aria-label=單船目前狀態]')"),true,'late ACK must not close newer visible draft');
 assert.equal(await a.eval("document.querySelector('[aria-label=單船目前狀態]').innerHTML"),visibleNew);
 assert.equal((await read()).revision,outcomeBefore.revision+1,'lost ACK commits once');
 qa.setRecordFault(null);
 await a.click('保存變更');await until(()=>a.saved(),'newer draft save after original receipt');
 assert.equal((await read()).revision,outcomeBefore.revision+2,'newer draft is a distinct operation');
 const outcomeWire=receipt.network.filter(r=>r.caseId===currentCase);const original=outcomeWire.find(r=>r.rpc===patchRpc);const lookup=outcomeWire.find(r=>r.rpc==='get_ship_dynamics_task_member_receipt_v1');assert.equal(lookup.operationId,original.operationId);assert.equal(lookup.payloadHash,original.payloadHash);receipt.cases.push({caseId:currentCase,status:'PASS',immutableLostAck:true,newerDraftRetained:true});
 currentCase='MEMBER-UI-OVERALL';
 await until(()=>a.eval(`Boolean(${field})`),'source return');await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('[role=dialog]')"),'source closed');
 await open(a,'qa-v1');const overallBefore=await read();await select(a,3);
 await until(()=>a.eval("Boolean(document.querySelector('.quick-status-bar textarea'))&&!document.querySelector('.task-global-fields').disabled"),'original overall scope authority');
 await a.fill("document.querySelector('.quick-status-bar textarea')",'SHARED OVERALL ONLY');await a.click('加入狀態紀錄');await a.click('保存變更');await until(()=>a.saved(),'original overall save');
 const overallAfter=await read();assert.equal(overallAfter.payload.tasks[0].status,'SHARED OVERALL ONLY');assert.deepEqual(overallAfter.payload.tasks[0].vesselProgress,overallBefore.payload.tasks[0].vesselProgress,'overall never saves member drafts/stubs');receipt.cases.push({caseId:currentCase,status:'PASS'});
 currentCase='MEMBER-UI-SAME';
 await until(()=>a.eval(`Boolean(${field})`),'A source return');await a.click('取消並關閉');await until(()=>a.eval("!document.querySelector('[role=dialog]')"),'A source closed');
 await open(a,'qa-v1');await open(b,'qa-v2');
 const identityErrorStart=receipt.errors.length;await a.click('切換/退出');await until(()=>receipt.errors.length>identityErrorStart,'original active-editor identity guard');assert.ok(receipt.errors.splice(identityErrorStart).every(s=>s.includes('目前仍有編輯中的項目')));assert.equal(await a.eval("Boolean(document.querySelector('#task-edit-title'))"),true);
 await a.fill("document.querySelector('.quick-status-bar textarea')",'REJECTED DRAFT MUST STAY');await a.click('加入狀態紀錄');
 await a.eval("void(window.__negativeNode=document.querySelector('[aria-label=單船目前狀態]'))");
 const negativeBefore=await read(),negativeStart=receipt.network.length;
 await select(b,0);await until(()=>receipt.network.slice(negativeStart).some(r=>r.actor==='qa-operator'&&r.rpc==='claim_ship_dynamics_edit_lock'&&r.ok===false),'same member excluded');
 assert.equal(await b.eval("document.querySelector('[aria-label=單船目前狀態]').contentEditable"),'false');
 await select(b,1);await until(()=>b.eval("document.querySelector('[aria-label=單船目前狀態]').contentEditable==='true'"),'B ownership restored');
 let aliasInjected=false;
 qa.setRecordFault({before:async({name,body})=>{if(name===patchRpc&&!aliasInjected){
   const valid=(await native.observer.query("select section_key,locked_by,lease_version from ship_dynamics_edit_locks where section_key like 'task-member-v1:%' and section_key like '%qa-v2%' and expires_at>now() ")).rows;assert.equal(valid.length,1);
   receipt.validWrongMember={guardHash:hash(valid[0]),actualSelected:'qa-v1',wrongMember:'qa-v2',actor:body.p_actor_user_id};body.p_lock_guards=valid;aliasInjected=true;
 }}});
 const errorStart=receipt.errors.length;await a.click('保存變更');await until(()=>receipt.errors.length>errorStart,'native wrong member rejection surfaced');
 const rejected=receipt.errors.splice(errorStart);assert.ok(rejected.every(s=>s.includes('lock-conflict')),JSON.stringify(rejected));
 assert.equal(aliasInjected,true);assert.deepEqual(await read(),negativeBefore,'same/valid wrong member zero business writes');
 assert.equal(await a.eval("window.__negativeNode===document.querySelector('[aria-label=單船目前狀態]')&&window.__negativeNode.innerText.includes('REJECTED DRAFT MUST STAY')"),true);
 qa.setRecordFault(null);await a.screen('same-wrong-draft-retained');receipt.cases.push({caseId:currentCase,status:'PASS',sameExclusion:true,validWrongMember:true,sameDraftNode:true});
 currentCase='MEMBER-UI-LEASE-LOSS';
 await a.eval("(()=>{const n=window.__negativeNode;n.focus();const r=document.createRange();r.selectNodeContents(n);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);window.__lossCaret=getSelection().anchorOffset;})()");
 await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where section_key like 'task-member-v1:%' and section_key like '%qa-v1%'");
 await until(()=>a.eval("window.__negativeNode===document.querySelector('[aria-label=單船目前狀態]')&&window.__negativeNode.contentEditable==='false'"),'actual client renewal revokes writes',35000);
 assert.equal(await a.eval("window.__negativeNode.innerText.includes('REJECTED DRAFT MUST STAY')&&getSelection().anchorOffset===window.__lossCaret"),true);
 assert.deepEqual(await read(),negativeBefore);await a.screen('lease-loss-same-draft-caret');receipt.cases.push({caseId:currentCase,status:'PASS',liveTimer:true,sameNode:true,caret:true});
 currentCase='MEMBER-UI-SWITCH-LATE';
 let readHeld=false,releaseRead;
 qa.setRecordFault({before:async({name,body})=>{if(name==='read_ship_dynamics_task_member_v1'&&body.p_actor_user_id==='qa-operator'&&body.p_vessel_id==='qa-v1'&&!readHeld){readHeld=true;await new Promise(resolve=>{releaseRead=resolve;});}}});
 await select(b,0);await until(()=>readHeld,'old A read held before native SQL');await select(b,1);
 await until(()=>b.eval("document.querySelector('select[aria-label=待辦進度範圍]').value==='qa-v2'&&document.querySelector('[aria-label=單船目前狀態]').contentEditable==='true'"),'new B authority');
 const lateIndex=receipt.network.length;releaseRead();await wait(250);
 assert.equal(await b.eval("document.querySelector('select[aria-label=待辦進度範圍]').value==='qa-v2'&&document.querySelector('[aria-label=單船目前狀態]').contentEditable==='true'"),true);
 assert.deepEqual(await read(),negativeBefore);qa.setRecordFault(null);receipt.cases.push({caseId:currentCase,status:'PASS',nativeLateRead:true});
 await a.click('關閉');await until(()=>a.saved(),'A draft explicit cancel');await b.click('取消');await until(()=>b.saved(),'B explicit cancel');

 await until(()=>b.eval(`Boolean(${field})`),'B source return');await b.click('取消並關閉');await until(()=>b.eval("!document.querySelector('[role=dialog]')"),'B source closed');
 currentCase='MEMBER-UI-TRANSITION';
 const closeSource=async(p)=>{await until(()=>p.eval(`Boolean(${field})`),'source return');await p.click('取消並關閉');await until(()=>p.eval("!document.querySelector('[role=dialog]')"),'source closed');};
 await closeSource(a);
 const closeMember=async(id)=>{await open(a,id);await a.click('標記結案');await until(()=>a.eval("[...document.querySelectorAll('#task-edit-title~* button,.modal-header button')].some(n=>n.innerText==='重新開啟')"),'closure draft toggled');await a.click('保存變更');await until(()=>a.saved(),'member closure '+id);await closeSource(a);};
 await closeMember('qa-v1');await closeMember('qa-v2');const preTransition=await read();
 await closeMember('qa-v3');const completed=await read();
 assert.equal(completed.payload.meetings[0].taskItems[0].isClosed,true,'last member closure synchronizes original source');assert.equal(completed.revision,preTransition.revision+1);
 const transitionRequests=outgoing.filter(r=>r.caseId===currentCase&&r.body.p_vessel_id==='qa-v3');assert.equal(transitionRequests.length,2);assert.equal(transitionRequests[0].body.p_command.mode,'leaf');assert.equal(transitionRequests[1].body.p_command.mode,'shared');assert.deepEqual(transitionRequests[1].body.p_expected,transitionRequests[0].body.p_expected);
 assert.ok(receipt.network.some(r=>r.caseId===currentCase&&r.result==='transition-required'));
 const added=completed.payload.auditLogs.slice(0,2);assert.deepEqual(added.map(a=>[a.actorId,a.action,a.entityType]),[['qa-owner','同步完成臨會/專題待辦','meeting'],['qa-owner','更新單船進度','task']]);
 assert.deepEqual(completed.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v1'),preTransition.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v1'));
 fs.writeFileSync(path.join(run,'transition-graph.json'),JSON.stringify({before:scrub(preTransition),after:scrub(completed),requests:scrub(transitionRequests)},null,2));
 receipt.cases.push({caseId:currentCase,status:'PASS',zeroWriteLeafThenShared:true});


 }

 }
 assert.deepEqual(receipt.errors,[]);receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}save();console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseCommit?.();rendezvous=false;receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 const processGone=()=>!browser||!spawnSync('tasklist',['/FI',`PID eq ${browser.pid}`,'/FO','CSV','/NH'],{encoding:'utf8'}).stdout.includes(`","${browser.pid}",`);
 try{if(browser&&!processGone()){spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(processGone,'owned Chrome gone',5000);}}catch(e){receipt.chromeCleanupRetry=e.message;}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)assert.equal(await portClosed(Number(chromePort)),true);assert.ok(processGone());fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

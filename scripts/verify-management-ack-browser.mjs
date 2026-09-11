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
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-management-ack-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['src/TemporaryMeetings.tsx','src/internalControlData.ts','src/internalControlWorkflow.ts','src/cloudAuthorization.ts','scripts/vessel-manager-handover-native.mjs','src/vesselManagerHandover.ts','src/normalize.ts','src/types.ts','src/workCenterScope.ts','supabase/development/20260911_vessel_manager_handover.sql','scripts/management-private-draft-native.mjs','scripts/verify-management-ack-browser.mjs','scripts/global-save-feedback-native.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','scripts/management-scoped-save-oracle.mjs','scripts/management-ack-native-forms.mjs','src/managementDraft.ts','scripts/record-internal-control-local-fixture.mjs','src/main.tsx','src/App.tsx','src/Management.tsx','src/DataManagementPanel.tsx','src/dataAnalysisVesselAttention.ts','src/taskVesselProgress.ts','src/taskVesselScope.ts','src/taskCategories.ts','src/taskAttention.ts','src/vesselAttention.ts','src/meetingVesselAttention.ts','src/taipeiTime.ts','src/cloud.ts','src/cloudRecordScopes.ts','supabase/development/20260908_appdata_record_scoped_read.sql'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const patchRpc='apply_ship_dynamics_record_patch_v1';
let native,qa,browser,ws,failure,chromePort,releaseCommit,barrier=null,currentCase='setup',next=0;
const stoppingSessions=new Set();
const pending=new Map(),actors=[],netRows=new Map(),paused=[],canceledRequests=new Set();
let rendezvous=false,releaseHeldRead,privateDialogAccept=true;
const outgoing=[];
const call=(method,params={},session)=>new Promise((resolve,reject)=>{
 const id=++next,started=Date.now(),startCase=currentCase;
 const timer=setTimeout(()=>{receipt.timeoutDiagnostics??=[];receipt.timeoutDiagnostics.push({method,startCase,endCase:currentCase,elapsedMs:Date.now()-started,reader:Boolean(actors.find(a=>a.s===session)?.reader),stoppingSession:stoppingSessions.has(session)});pending.delete(id);reject(new Error('CDP timeout '+method));},15000);
 pending.set(id,{method,session,resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));
});
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
 p.sync=async()=>{const start=receipt.network.length,metricStart=qa.metrics.length;await p.click('同步最新（安全合併）');await until(()=>process.env.QA_MGACK_MODE==='handover-legacy'?qa.metrics.slice(metricStart).some(r=>r.rpc==='legacy-snapshot-read'):receipt.network.slice(start).some(r=>r.actor===actor&&/^read_ship_dynamics_record/.test(r.rpc)&&r.finished),'sync HTTP '+actor);await until(()=>p.eval("[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='同步最新（安全合併）'&&!n.disabled)&&!document.querySelector('.save-status-strip.saving')"),'sync idle '+actor);};
 p.open=async id=>{await p.activate(`[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes(${JSON.stringify('QA VESSEL '+id.slice(-1))}))?.querySelector('button')&&[...([...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes(${JSON.stringify('QA VESSEL '+id.slice(-1))}))).querySelectorAll('button')].find(n=>n.innerText.trim()==='快速更新')`);await until(()=>p.eval(`Boolean(${field})&&!(${field}).disabled`),'original editor '+actor);};
 p.submit=async()=>{const labels=await p.eval("[...document.querySelectorAll('[role=dialog] button')].filter(n=>n.getClientRects().length&&!n.disabled&&n.innerText.includes('保存')).map(n=>n.innerText.trim())");assert.equal(labels.length,1,'one original editor Save');receipt.saveLabel=labels[0];await p.click(labels[0]);};
 for(const method of ['Page.enable','Runtime.enable','Network.enable'])await call(method,{},s);
 await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},s);
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},s);
 actors.push(p);return p;
}
async function login(p,navigate=true){
 if(navigate){await call('Page.navigate',{url:qa.origin},p.s);
 await until(async()=>(await p.text()).includes('請輸入管理者設定的進站密碼。'),'original site gate');
 await p.fill("document.querySelector('input[type=password]')",qa.password);await p.click('進入系統');}
 await until(async()=>(await p.text()).includes('人員登入／切換'),'original personnel gate');
 if(p.actor==='qa-vessel'){await p.eval("document.querySelector('select[aria-label=登入部門]').focus()");await p.key('End');await p.key('Enter');await until(()=>p.eval("[...document.querySelector('select[aria-label=登入人員]').options].some(o=>o.value==='qa-vessel')"),'vessel roster');}
 if(p.actor==='qa-operator'){const selector="document.querySelector('select[aria-label=登入部門]')";const i=await p.eval(`(()=>{const n=${selector};n.focus();return [...n.options].findIndex(o=>o.value==='機務');})()`);assert.ok(i>=0);await p.key('Home');for(let n=0;n<i;n++)await p.key('ArrowDown');await p.key('Enter');}
 const selector="document.querySelector('select[aria-label=登入人員]')";
 const index=await p.eval(`(()=>{const n=${selector};n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(p.actor)});})()`);assert.ok(index>=0);
 await p.key('Home');for(let i=0;i<index;i++)await p.key('ArrowDown');await p.key('Enter');
 await until(()=>p.eval(`(${selector}).value===${JSON.stringify(p.actor)}`),'native identity select');
 if(await p.eval("Boolean(document.querySelector('input[type=password]'))"))await p.fill("document.querySelector('input[type=password]')",qa.password);await p.click('登入');
 await until(async()=>!(await p.text()).includes('人員登入／切換')&&(await p.text()).includes(p.actor==='qa-owner'?'QA OWNER':p.actor==='qa-vessel'?'QA VESSEL ACCOUNT':p.actor==='qa-admin'?'QA ADMIN':p.actor==='qa-spare'?'QA SPARE':'QA OPERATOR'),'original logged-in homepage');await p.sync();
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
  stoppingSessions.add(fresh.s);await call('Fetch.disable',{},fresh.s);await call('Target.closeTarget',{targetId:fresh.targetId});
 }
 fs.writeFileSync(path.join(run,name+'-readback.json'),JSON.stringify({hash:hash(actual),readback:scrub(actual)},null,2));
}

try{
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,taskMember:true,scopedRead:true,performanceTrace:true,legacySnapshot:process.env.QA_MGACK_MODE==='handover-legacy',handoverMigrationFixture:process.env.QA_HANDOVER_UPGRADE==='1'?async(db,phase)=>(await import('./vessel-manager-handover-native.mjs')).rehearseHandoverMigration({db,phase,receipt}):null,preparePerformanceFixture:async initial=>{
  const at=initial.updatedAt,now=new Date(at),previous=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,15,12)).toISOString();
  initial.users.find(u=>u.id==='qa-operator').department='機務';
  for(const [id,name,role] of [['qa-admin','QA ADMIN','admin'],['qa-spare','QA SPARE','operator']])initial.users.push({...structuredClone(initial.users[0]),id,name,username:id,role,managedVesselIds:[]});
  initial.users.push({...structuredClone(initial.users[0]),id:'qa-vessel',name:'QA VESSEL ACCOUNT',username:'qa-vessel',role:'vessel',managedVesselIds:['qa-v1']});
  initial.settings.departments=['督導','機務'];
  initial.vessels.forEach((v,i)=>{v.assignedUserIds=i===0?['qa-owner']:[];v.weeklyAttention=[];v.manualAttentionLevel='';});
  initial.vessels[1].delegateManagers=[{userId:'qa-operator',isActive:true}];
  const template=structuredClone(initial.tasks[0]),meeting=structuredClone(initial.meetings[0]),standalone=structuredClone(initial.internalControlCases[0]);
  const specifications=[
   {id:'stats-a',description:'STATS A',vesselIds:['qa-v1'],ownerUserIds:['qa-owner'],departments:['督導'],createdBy:'qa-owner',priority:'高',isClosed:true,isAware:true,categories:['維修'],createdAt:previous},
   {id:'stats-b',description:'STATS B',vesselIds:['qa-v1'],ownerUserIds:['qa-operator'],departments:['機務'],createdBy:'qa-operator',priority:'急',isAbnormal:true,expectedDate:'2000-01-01',categories:['事故']},
   {id:'stats-c',description:'STATS C',vesselIds:['qa-v2'],ownerUserIds:[],departments:['機務'],createdBy:'qa-owner',priority:'中',isInternalControl:true,categories:['維修']},
   {id:'stats-d',description:'STATS D',vesselIds:['qa-v1','qa-v2'],ownerUserIds:['qa-operator'],departments:['機務'],createdBy:'qa-operator',priority:'低',isClosed:true,isAbnormal:true,sourceType:'temporary',sourceMeetingId:'stats-meeting',sourceMeetingTaskItemId:'stats-decision',attentionDimension:'meeting',distributeToVessels:true,categories:['船員管理']},
  ];
  const logs=id=>[1,2,3,4].map(n=>({id:id+'-'+n,at,by:'QA OWNER',text:n===4?'QA_UNLOADED_DETAIL_SENTINEL':'preview '+n}));
  initial.tasks=specifications.map(spec=>({...structuredClone(template),isClosed:false,isAware:false,isInternalControl:false,isAbnormal:false,expectedDate:'',sourceType:'manual',sourceMeetingId:undefined,sourceMeetingTaskItemId:undefined,sourceInternalControlCaseId:undefined,attentionDimension:'task',distributeToVessels:false,createdAt:at,vesselProgress:[],...spec,vesselId:spec.vesselIds[0],category:spec.categories[0],status:'current status',statusLogs:logs(spec.id)}));
  initial.tasks[3].vesselProgress=['qa-v1','qa-v2'].map((vesselId,i)=>({vesselId,status:'current member',isClosed:i===0,updatedAt:at,updatedBy:'qa-owner',statusLogs:logs(vesselId)}));
  initial.meetings=[{...meeting,id:'stats-meeting',subject:'STATS MEETING',status:'追蹤中',isAbnormal:true,isInternalControl:false,vessels:['qa-v1','qa-v2'],vesselScopeMode:'vessels',statusLogs:logs('meeting'),taskItems:[{id:'stats-decision',description:'STATS D',categories:['船員管理'],distributeToVessels:true}]},{...meeting,id:'stats-unrepresented',subject:'STATS UNREPRESENTED',status:'追蹤中',isAbnormal:true,isInternalControl:false,vessels:['qa-v2'],vesselScopeMode:'vessels',taskItems:[],statusLogs:logs('unrepresented')}];
  initial.internalControlCases=[{...standalone,id:'stats-standalone',vesselId:'qa-v2',description:'STATS STANDALONE',linkedTaskId:undefined,isClosed:false,priority:'高',createdAt:at,statusLogs:logs('standalone')}];
  initial.agendaReports=[{id:'qa-report',title:'QA report',vesselIds:['qa-v1'],createdBy:'qa-owner',createdAt:at,taskCount:4,kind:'ad-hoc',snapshot:{vessels:structuredClone(initial.vessels),tasks:structuredClone(initial.tasks),meetings:structuredClone(initial.meetings),qaUnknown:'QA_UNLOADED_DETAIL_SENTINEL'.repeat(25000)}}];
  if((process.env.QA_MGACK_MODE||'').startsWith('handover'))(await import('./vessel-manager-handover-native.mjs')).prepareHandover(initial);
  if((process.env.QA_MGACK_MODE||'').startsWith('lifecycle'))(await import('./vessel-lifecycle-native.mjs')).prepareVesselLifecycle(initial);
 },databaseFactory:async()=>native.adapter});
 receipt.origin=qa.origin;assert.equal((await (await fetch(qa.origin+'/__qa/health')).json()).kind,'REAL_UI_SYNTHETIC_DATA_NATIVE_POSTGRES');
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socketPath;await until(()=>{try{[chromePort,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
 receipt.chrome={pid:browser.pid,port:Number(chromePort)};
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Network.loadingFailed'&&m.params.canceled)canceledRequests.add(m.sessionId+':'+m.params.requestId);
   if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){
    const {type,message}=m.params;receipt.dialogs??=[];receipt.dialogs.push(message);const privatePrompt=message==='尚有未提交的管理表單修改。確定放棄這些修改並繼續？';const accept=privatePrompt||type==='beforeunload'?privateDialogAccept:type==='confirm'&&['清除「','確定停用「','同步最新會保留本機修改','請盡量以船端修改為主','確定批量完成所選','確定結案會議','確定重新開啟會議','確定重新開啟此待辦'].some(t=>message.startsWith(t));
    if(!accept&&!privatePrompt&&type!=='beforeunload'&&message!=='進站密碼已更新'&&!(currentCase==='MG-PRIVATE-GENERIC-ACK'&&message==='個人密碼已更新；下次登入需使用新密碼。'))receipt.errors.push('unexpected dialog: '+message);await call('Page.handleJavaScriptDialog',{accept},m.sessionId);
   }
   if(m.method==='Fetch.requestPaused'){
    const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);
    if(!allowed)receipt.blockedExternal.push(u.origin);
    if(allowed&&[patchRpc,'save_ship_dynamics_task_member_v1'].some(name=>u.pathname.endsWith('/rpc/'+name))){outgoing.push({caseId:currentCase,body:JSON.parse(m.params.request.postData),captured:Date.now()});fs.writeFileSync(path.join(run,'outgoing-before-sql.json'),JSON.stringify(outgoing.map(r=>({...r,body:scrub(r.body)})),null,2));}
    if(allowed&&rendezvous&&u.pathname.endsWith('/rpc/'+patchRpc)){
     const body=JSON.parse(m.params.request.postData);paused.push({session:m.sessionId,requestId:m.params.requestId,operationId:body.p_operation_id,actor:body.p_actor_user_id,payloadHash:hash(body),auditExpected:body.p_operations.find(o=>o.kind==='order'&&o.collection==='auditLogs')?.expectedIds});save();return;
    }
    try{await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}
    catch(e){
     if(stoppingSessions.has(m.sessionId)&&e.message==='Fetch domain is not enabled'){receipt.shutdownInterceptions??=[];receipt.shutdownInterceptions.push({caseId:currentCase,ownedDisabledSession:true});return;}
     if(!allowed||e.message!=='Invalid InterceptionId.'||!m.params.networkId)throw e;
     await until(()=>canceledRequests.has(m.sessionId+':'+m.params.networkId),'authoritative Network cancellation for stale interception',1500);
     receipt.canceledInterceptions??=[];receipt.canceledInterceptions.push({path:u.pathname,networkCanceled:true,caseId:currentCase});
    }
   }
   if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(qa.origin+'/rest/v1/rpc/')){
    const b=JSON.parse(m.params.request.postData||'{}'),row={caseId:currentCase,actor:actors.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:b.p_operation_id,readScope:b.p_scope,targets:b.p_targets,handoverReadRevisionPresent:Boolean(b.p_authorization_guard&&Object.hasOwn(b.p_authorization_guard,'handoverReadRevision')),request:scrub(b),payloadHash:hash(b),started:m.params.wallTime*1000};
    netRows.set(m.sessionId+':'+m.params.requestId,row);receipt.network.push(row);
   }
   const row=netRows.get(m.sessionId+':'+m.params.requestId);
   if(m.method==='Network.loadingFailed'&&row)row.failure={canceled:Boolean(m.params.canceled),errorText:m.params.errorText};
   if(m.method==='Network.responseReceived'&&row)row.httpStatus=m.params.response.status;
   if(m.method==='Network.loadingFinished'&&row){const response=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId);const v=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body);fs.writeFileSync(path.join(run,'response-'+receipt.network.indexOf(row)+'.json'),JSON.stringify(scrub(v),null,2));Object.assign(row,{containsUnloadedDetail:JSON.stringify(v).includes('QA_UNLOADED_DETAIL_SENTINEL'),containsOtherMeetingHistory:JSON.stringify(v).includes('QA_OTHER_MEETING_HISTORY'),finished:Date.now(),result:v?.ok===false?v.code:'SQL_OK',conflictKey:v?.conflict_key,revision:v?.revision});save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });



 const contextA=(await call('Target.createBrowserContext')).browserContextId,a=await makePage('qa-owner',contextA);
 if((process.env.QA_MGACK_MODE||'').includes('config-local'))await call('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(window,'SHIP_DYNAMICS_SUPABASE_CONFIG',{configurable:true,get:()=>undefined,set:value=>{if(!localStorage.getItem('ship-dynamics-supabase-config'))localStorage.setItem('ship-dynamics-supabase-config',JSON.stringify(value));}});`},a.s);
 await login(a);
 const write=(name,v)=>fs.writeFileSync(path.join(run,name+'.json'),JSON.stringify(scrub(v),null,2));
 const sub=async label=>a.activate(`[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith(${JSON.stringify(label)}))`);
 const choose=async name=>a.activate(`[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText===${JSON.stringify(name)})`);
 const nameField="[...document.querySelectorAll('.management-form label')].find(n=>n.textContent==='姓名')?.querySelector('input')";
 const mode=process.env.QA_MGACK_MODE||'held';receipt.mode=mode;
 if(mode==='handover-legacy'){await (await import('./vessel-manager-handover-native.mjs')).runLegacyHandover({a,qa,native,call,until,receipt,setCase:value=>currentCase=value});receipt.status='PASS';}else if(mode.startsWith('handover')){await (await import('./vessel-manager-handover-native.mjs')).runHandover({a,qa,read,call,until,wait,write,receipt,setCase:value=>currentCase=value,setRelease:value=>releaseCommit=value,freshReadback,mode,native,makePage,login});receipt.status='PASS';}else if(['private-config','private-config-other','private-config-local','private-config-local-other','private-config-local-navigation','private-disable','private-disable-newer','private-aba','private-generic'].includes(mode)){await (await import('./management-private-draft-native.mjs')).runManagementPrivateClosing({a,qa,read,call,until,wait,write,receipt,setCase:value=>currentCase=value,setDialogAccept:value=>privateDialogAccept=value,setRelease:value=>releaseCommit=value,loginCurrent:()=>login(a,false),mode});receipt.status='PASS';}else if(mode==='private-draft'){await (await import('./management-private-draft-native.mjs')).runManagementPrivateDraft({a,qa,read,call,until,wait,write,receipt,setCase:value=>currentCase=value,setDialogAccept:value=>privateDialogAccept=value});receipt.status='PASS';}else if(mode==='global-feedback'){await (await import('./global-save-feedback-native.mjs')).runGlobalSaveFeedback({a,qa,read,call,until,wait,write,receipt,setCase:value=>currentCase=value,setRelease:value=>releaseCommit=value,freshReadback});receipt.status='PASS';}else if(mode.startsWith('lifecycle')){await (await import('./vessel-lifecycle-native.mjs')).runVesselLifecycle({a,qa,read,call,until,wait,write,receipt,setCase:value=>currentCase=value,setRelease:value=>releaseCommit=value,freshReadback,mode});receipt.status='PASS';}else if(mode.startsWith('forms')){await (await import('./management-ack-native-forms.mjs')).runManagementAckForms({a,qa,read,call,until,wait,write,receipt,setCase:value=>currentCase=value,setRelease:value=>releaseCommit=value,mode});receipt.status='PASS';}else{
 const pass=id=>{receipt.cases.push({caseId:id,layer:'original-UI-native-PG',status:'PASS'});save();};
 await a.click('管理');await until(()=>a.eval("Boolean(document.querySelector('.management-view'))"),'management');await sub('人員');await choose('QA SPARE');
 const before=await read(),started=Date.now();let expected,held=false,readHeld=false,patches=0;
 const expectedByPatch=[];
 await a.fill(nameField,'MGACK SAVED SPARE');
 await a.eval("void(window.__mgNotices=[]);void(new MutationObserver(()=>{const text=document.querySelector('.management-save-toast')?.textContent;if(text)window.__mgNotices.push({text,at:Date.now()});}).observe(document.body,{childList:true,subtree:true,characterData:true}))");
 currentCase='MGACK-'+mode;
 let rejectGuard=mode==='rejected';
 let lossDropped=false;
 qa.setRecordFault({before:async({name,body})=>{
   if(mode==='unknown'&&name==='get_ship_dynamics_record_receipt_v1')throw new Error('QA receipt unavailable');
   if(name!==patchRpc)return;
   const {managementExpected}=await import('./management-scoped-save-oracle.mjs');
   const base=await read(),nameIntent=mode==='per-intent'&&patches>0?'MGACK SECOND SPARE':'MGACK SAVED SPARE';
   expected=await managementExpected(base,body,qa,{kind:'person',id:'qa-spare',name:nameIntent},started);expectedByPatch.push({before:base,expected});write('expected-before-sql-'+patches,expected);patches++;
   // Negative wire fault only: execute the real SQL lock-conflict return (no fabricated response).
   if(rejectGuard){body.p_lock_guards=[...body.p_lock_guards,{section_key:'vessel:qa-v1',locked_by:'qa-expired-management-probe'}];write('deterministic-rejection-effective-request',body);}
 },after:async({name})=>{
   if(name===patchRpc){held=true;if(mode==='lost'||mode==='unknown'){lossDropped=true;return true;}if(mode!=='rejected')await new Promise(r=>releaseCommit=r);}
   if(mode==='readback'&&held&&name==='read_ship_dynamics_record_scopes_v1'){readHeld=true;await new Promise(r=>releaseHeldRead=r);}
   if(mode==='readback-fail'&&held&&name==='read_ship_dynamics_record_scopes_v1')throw new Error('QA committed readback unavailable');
   return false;
 }});
 await a.click('保存變更');
 if(mode==='rejected'){
   await until(()=>receipt.network.some(r=>r.rpc===patchRpc&&r.finished),'native rejected result');
   await until(()=>a.eval("Boolean(document.querySelector('.save-status-strip.error'))"),'rejected feedback');
   assert.deepEqual(await read(),before,'rejected full graph and audit rollback');assert.deepEqual(await a.eval('window.__mgNotices'),[]);assert.equal(await a.eval(`(${nameField}).value`),'MGACK SAVED SPARE');pass('MGACK-2-rejected-retains-draft');
   const rejected=receipt.network.find(r=>r.rpc===patchRpc);assert.equal(rejected.httpStatus,200);assert.equal(rejected.result,'lock-conflict');assert.equal(receipt.network.some(r=>r.rpc==='get_ship_dynamics_record_receipt_v1'),false,'deterministic rejection must not receipt-replay');
   rejectGuard=false;
   await a.click('保存變更');await until(()=>a.eval("Boolean(document.querySelector('.management-save-toast'))"),'same original retry success');
 }else if(mode==='unknown'||mode==='readback-fail'){
   if(mode==='readback-fail'){await until(()=>held,'SQL committed');releaseCommit();}
   await until(()=>a.eval("Boolean(document.querySelector('.save-status-strip.error'))"),'blocked uncertain result',40000);
   assert.deepEqual(await a.eval('window.__mgNotices'),[]);assert.equal(await a.eval(`(${nameField}).value`),'MGACK SAVED SPARE');
   const count=patches;await a.click('保存變更');await wait(1200);assert.equal(patches,count,'blocked must not dispatch another operation');pass('MGACK-6-'+mode+'-blocked-draft');
 }else if(mode==='lost'){
   await until(()=>a.eval("Boolean(document.querySelector('.management-save-toast'))"),'receipt recovered original success',40000);
   assert.ok(lossDropped);const row=receipt.network.find(r=>r.rpc===patchRpc),lookup=receipt.network.find(r=>r.rpc==='get_ship_dynamics_record_receipt_v1');assert.ok(lookup);assert.equal(row.operationId,lookup.operationId);pass('MGACK-6-lost-ACK-same-operation');
 }else{
   await until(()=>held,'real SQL committed, HTTP ACK held');write('sql-held',await read());await a.screen('held-ACK');
   const early=await a.eval('window.__mgNotices');write('notice-held',early);assert.deepEqual(early,[],'MGACK-1 no original success before request ACK/readback');
   if(mode==='newer'||mode==='clear'||mode==='per-intent'){
     await a.eval(`void(window.__mgNode=${nameField})`);
     if(mode==='clear'){await a.eval(`(${nameField}).focus();(${nameField}).select()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8},a.s);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8},a.s);assert.equal(await a.eval(`(${nameField}).value`),'');}
     else await a.fill(nameField,mode==='per-intent'?'MGACK SECOND SPARE':'MGACK NEW DRAFT');
     if(mode==='per-intent')await a.click('保存變更');
   }
   if(mode==='selection'){await choose('QA ADMIN');await a.fill(nameField,'MGACK NEW EDITOR');}
   if(mode==='navigation'){await a.click('船隊看板');}
   if(mode==='per-intent')held=false;releaseCommit();
   if(mode==='readback'){await until(()=>readHeld,'COMMITTED authoritative readback held');assert.deepEqual(await a.eval('window.__mgNotices'),[]);await a.screen('held-readback');releaseHeldRead();}
   if(['newer','clear','selection','navigation'].includes(mode)){
     await until(()=>receipt.network.some(r=>r.rpc===patchRpc&&r.finished),'ACK response');await wait(700);assert.deepEqual(await a.eval('window.__mgNotices'),[],'old ACK cannot announce newer editor saved');
     if(mode!=='navigation')assert.equal(await a.eval(`(${nameField}).value`),mode==='clear'?'':mode==='selection'?'MGACK NEW EDITOR':'MGACK NEW DRAFT');
     if(mode==='newer'||mode==='clear')assert.equal(await a.eval(`window.__mgNode===(${nameField})`),true,'same original input node');
     pass('MGACK-'+(['selection','navigation'].includes(mode)?'4':'3')+'-'+mode);
   }else if(mode==='per-intent'){
     await until(()=>patches===2&&held,'B own SQL ACK held');assert.deepEqual(await a.eval('window.__mgNotices'),[],'A does not release B continuation');releaseCommit();await until(()=>a.eval("Boolean(document.querySelector('.management-save-toast'))"),'B own confirmation');pass('MGACK-5-independent-A-B');
   }else{await until(()=>a.eval("Boolean(document.querySelector('.management-save-toast'))"),'matching ACK original success');pass(mode==='readback'?'MGACK-6-committed-readback-held':'MGACK-1-person-update-held-ACK');}
 }
 const after=await read();const {assertManagementAfter}=await import('./management-scoped-save-oracle.mjs');const last=expectedByPatch.at(-1);assertManagementAfter(last.before,after,last.expected,started);write('sql-after',after);
 await wait(1300);const operations=new Set(receipt.network.filter(r=>r.rpc===patchRpc).map(r=>r.operationId));assert.equal(operations.size,mode==='per-intent'||mode==='rejected'?2:1,'no duplicate autosave intent');
 const fresh=await native.connect('mgack_fresh');const readback=(await fresh.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;await fresh.end();assert.deepEqual(readback,after);write('fresh-sql-readback',readback);
 receipt.status='PASS';
 }
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseHeldRead?.();releaseCommit?.();rendezvous=false;receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){for(const p of actors.filter(p=>!p.reader)){try{stoppingSessions.add(p.s);await call('Fetch.disable',{},p.s);}catch{}}try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(()=>browser.exitCode!==null||browser.signalCode!==null,'forced owned Chrome exit event',5000);}}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)assert.equal(await portClosed(Number(chromePort)),true);assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 if(!failure&&(receipt.errors.length||receipt.blockedExternal.length)){failure=new Error('browser error/egress envelope not clean');receipt.status='FAIL';}receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

import assert from 'node:assert/strict';
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
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'ui-')),profile=path.join(run,'chrome');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-record-scoped-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['scripts/verify-record-scoped-browser.mjs','scripts/record-scoped-business-oracle.mjs','scripts/record-scoped-lifecycle-oracle.mjs','src/InternalControlPage.tsx','src/TemporaryMeetings.tsx','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','src/App.tsx','src/cloud.ts','src/cloudRecordScopes.ts','supabase/development/20260908_appdata_record_scoped_read.sql'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const patchRpc='apply_ship_dynamics_record_patch_v1';
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
 qa=await createRecordStorageLocalQa({internalControl:true,scopedRead:true,performanceTrace:true,preparePerformanceFixture:async (initial,vite)=>{initial.vessels[0].qaUnknown={ordered:['a',{b:2}]};initial.users.push({...structuredClone(initial.users[0]),id:'qa-vessel',name:'QA VESSEL ACCOUNT',username:'qa-vessel',role:'vessel',managedVesselIds:['qa-v1']});const readonly=structuredClone(initial.tasks.find(t=>!t.isInternalControl));readonly.id='qa-readonly-task';readonly.vesselId='qa-v1';readonly.vesselIds=['qa-v1'];readonly.description='QA READONLY TASK';readonly.statusLogs.push({id:'qa-readonly-old',at:initial.updatedAt,by:'QA OWNER',text:'QA readonly old'},{id:'qa-readonly-deep',at:initial.updatedAt,by:'QA OWNER',text:'QA_READONLY_HISTORY'});initial.tasks.push(readonly);const targetCase=initial.internalControlCases.find(c=>c.id==='qa-withdraw'),targetTask=initial.tasks.find(t=>t.id===targetCase.linkedTaskId);for(const row of [targetCase,targetTask]){row.qaUnknown={ordered:['kept',{n:2}]};row.statusLogs.splice(1,0,{id:'qa-malformed',text:'',qaOpaque:'preserve-malformed'});row.statusLogs.push({id:'qa-target-older',at:initial.updatedAt,by:'QA OWNER',text:'QA target older'},{id:'qa-target-deep',at:initial.updatedAt,by:'QA OWNER',text:'QA_TARGET_HISTORY',qaUnknown:'keep-log'});}for(const id of ['qa-case-delete','qa-task-delete']){const c=initial.internalControlCases.find(c=>c.id===id),t=initial.tasks.find(t=>t.id===c.linkedTaskId);for(const row of [c,t])row.statusLogs.push(...[1,2,3].map(n=>({id:id+'-deep-'+n,at:initial.updatedAt,by:'QA OWNER',text:id+' history '+n,qaRaw:[n,{kept:true}]})));}initial.agendaReports=[{id:'qa-report',title:'QA report',vesselIds:['qa-v1'],createdBy:'qa-owner',createdAt:initial.updatedAt,taskCount:initial.tasks.length,kind:'ad-hoc',snapshot:{vessels:structuredClone(initial.vessels),tasks:structuredClone(initial.tasks),meetings:structuredClone(initial.meetings),qaUnknown:'QA_UNLOADED_DETAIL_SENTINEL'}}];for(const t of initial.tasks.filter(t=>t.id==='qa-unrelated-task')){t.statusLogs.push({id:'qa-recent-log',at:new Date().toISOString(),by:'QA OWNER',text:'QA recent history'},{id:'qa-heavy-log',at:new Date().toISOString(),by:'QA OWNER',text:'QA_UNLOADED_DETAIL_SENTINEL'});}
 const at=initial.updatedAt,meeting={...structuredClone(initial.meetings[0]),id:'qa-selected-meeting',subject:'QA SELECTED MEETING',createdAt:new Date(Date.parse(at)+1).toISOString(),status:'追蹤中',vessels:['qa-v1'],vesselScopeMode:'vessels',participantUserIds:['qa-owner'],trackingUserIds:['qa-operator'],responsibleUserIds:['qa-operator'],taskItems:[{id:'qa-decision',description:'QA SELECTED DECISION',categories:['船舶維護管理'],distributeToVessels:false}],statusLogs:[1,2,3].map(n=>({id:'qa-meeting-log-'+n,at,by:'QA OWNER',text:n===3?'QA_SELECTED_MEETING_HISTORY':'QA meeting '+n,qaRaw:[n,{kept:true}]})),qaUnknown:{keep:true}};
 initial.meetings[0].statusLogs=[1,2,3].map(n=>({id:'qa-other-log-'+n,at,by:'QA OWNER',text:n===3?'QA_OTHER_MEETING_HISTORY':'QA other '+n}));
 initial.meetings.unshift(meeting);
 const {reconcileMeetingTasks}=await vite.ssrLoadModule('/src/meetingTaskWorkflow.ts');
 reconcileMeetingTasks({tasks:initial.tasks,meetingId:meeting.id,vesselIds:meeting.vessels,vesselScopeMode:'vessels',followUps:meeting.taskItems,priority:meeting.priority,isAbnormal:false,isInternalControl:false,expectedDate:'',departments:['督導'],ownerUserIds:['qa-operator'],meetingTaskCategories:initial.settings.meetingTaskCategories,initialStatus:'QA meeting pending',actorId:'qa-owner',actorName:'QA OWNER',at,createTaskId:()=> 'qa-selected-decision'});
 const decision=initial.tasks.find(t=>t.id==='qa-selected-decision');decision.statusLogs.push(...[1,2,3].map(n=>({id:'qa-decision-log-'+n,at,by:'QA OWNER',text:n===3?'QA_SELECTED_DECISION_HISTORY':'QA decision '+n,qaRaw:[n]})));
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
    if(allowed&&u.pathname.endsWith('/rpc/'+patchRpc)){outgoing.push({caseId:currentCase,body:JSON.parse(m.params.request.postData),captured:Date.now()});fs.writeFileSync(path.join(run,'outgoing-before-sql.json'),JSON.stringify(outgoing.map(r=>({...r,body:scrub(r.body)})),null,2));}
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
   if(m.method==='Network.loadingFinished'&&row){const response=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId);const v=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body);Object.assign(row,{containsUnloadedDetail:JSON.stringify(v).includes('QA_UNLOADED_DETAIL_SENTINEL'),containsOtherMeetingHistory:JSON.stringify(v).includes('QA_OTHER_MEETING_HISTORY'),finished:Date.now(),result:v?.ok===false?v.code:'SQL_OK',conflictKey:v?.conflict_key,revision:v?.revision});save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });
 const contextA=(await call('Target.createBrowserContext')).browserContextId;
 const a=await makePage('qa-owner',contextA);await login(a);
 await a.screen('cold-original-home');
 assert.equal(receipt.network.some(r=>r.containsUnloadedDetail),false,'cold original App must not download task histories or report snapshots');
 receipt.cases.push({caseId:'COLD',status:'PASS'});
 const baseline=await read(),other=await untouched(),formal=await qa.itinerarySnapshot();
 const scopes=await qa.loadModule('/src/cloudRecordScopes.ts');
 const scopeRead=async versions=>(await native.observer.query('select read_ship_dynamics_record_scopes_v1($1,$2,$3::jsonb) r',[qa.workspace,'home',JSON.stringify(versions)])).rows[0].r;
 const response=await scopeRead({}),state=scopes.consumeRecordScopes(response,qa.workspace,'home',null);
 const empty=await scopeRead(scopes.recordScopeVersions(state));
 assert.equal(Object.values(empty.collections).flatMap(c=>c.rows).length,0,'unchanged scopes transmit zero record bodies');
 assert.deepEqual(scopes.recordScopePayload(scopes.consumeRecordScopes(empty,qa.workspace,'home',state)),scopes.recordScopePayload(state));
 assert.throws(()=>scopes.consumeRecordScopes(empty,qa.workspace,'home',null),/unloaded/);
 assert.throws(()=>scopes.consumeRecordScopes(response,'wrong-workspace','home',null),/mismatch/);
 assert.throws(()=>scopes.consumeRecordScopes(response,qa.workspace,'full',null),/mismatch/);
 assert.throws(()=>scopes.assertRecordScopePatch('home',[{kind:'entity',collection:'tasks'}]),/not-loaded/);
 const detached=scopes.recordScopePayload(state);detached.vessels[0].name='caller mutation';assert.notEqual(scopes.recordScopePayload(state).vessels[0].name,'caller mutation');
 const {normalizeAppData}=await qa.loadModule('/src/normalize.ts'),fullModel=normalizeAppData(baseline.payload),homeModel=normalizeAppData(scopes.recordScopePayload(state));
 assert.deepEqual(homeModel.tasks.find(t=>t.description==='QA withdraw').statusLogs.slice(0,2),fullModel.tasks.find(t=>t.description==='QA withdraw').statusLogs.slice(0,2),'summary preview equals original normalized full preview despite malformed raw logs');
 assert.equal(scopes.cleanRecordHomeCacheMatches(fullModel,fullModel,homeModel),true);
 const dirty=structuredClone(fullModel);dirty.vessels[0].note.recentDynamics='UNSAVED';assert.equal(scopes.cleanRecordHomeCacheMatches(dirty,fullModel,homeModel),false);
 const missingCollection=structuredClone(response);delete missingCollection.collections.tasks;
 assert.throws(()=>scopes.consumeRecordScopes(missingCollection,qa.workspace,'home',null),/collection/,'incomplete summary collections reject atomically');
 const wrongCoverage=structuredClone(response);wrongCoverage.collections.tasks.rows[0].detail=true;
 assert.throws(()=>scopes.consumeRecordScopes(wrongCoverage,qa.workspace,'home',null),/coverage/);
 const ghost=structuredClone(response);ghost.collections.tasks.rows.push({id:'ghost',version:0,detail:false,value:{id:'ghost'}});assert.throws(()=>scopes.consumeRecordScopes(ghost,qa.workspace,'home',null),/row/);
 for(const id of ['constructor','__proto__']){const special=structuredClone(response);special.collections.tasks={ids:[id],rows:[{id,version:0,detail:false,value:{id}}]};const accepted=scopes.consumeRecordScopes(special,qa.workspace,'home',null);assert.equal(scopes.recordScopePayload(accepted).tasks[0].id,id);special.collections.tasks.rows=[];assert.throws(()=>scopes.consumeRecordScopes(special,qa.workspace,'home',null),/unloaded/);}
 const wrongBase={...state,scopeKey:'full'};assert.throws(()=>scopes.consumeRecordScopes(empty,qa.workspace,'home',wrongBase),/base/);
 receipt.cases.push({caseId:'SCOPE-PROTOCOL',status:'PASS',coverageNegatives:true,specialIds:true});

 const contextB=(await call('Target.createBrowserContext')).browserContextId;
 const b=await makePage('qa-operator',contextB);await login(b);
 currentCase='VESSEL-SCOPE';await a.open('qa-v2');await b.open('qa-v1');
 await b.fill(field,'SCOPED B DRAFT');await b.eval(`void(window.__draftNode=${field})`);
 let drop=true;qa.setRecordFault({after:({name})=>{if(name===patchRpc&&drop){drop=false;return true;}return false;}});
 await a.fill(field,'SCOPED A SAVED');await a.submit();await until(()=>a.saved(),'A scoped ACK');
 await b.sync();assert.equal(await b.eval(`window.__draftNode===${field}&&window.__draftNode.value==='SCOPED B DRAFT'`),true);
 await b.submit();await until(()=>b.saved(),'B scoped ACK');
 const after=await read();verifyBusiness(baseline,after,{'qa-v1':'SCOPED B DRAFT','qa-v2':'SCOPED A SAVED'});
 assert.deepEqual(await untouched(),other);assert.deepEqual(await qa.itinerarySnapshot(),formal);
 assert.equal(receipt.network.some(r=>r.containsUnloadedDetail),false,'vessel open/save/sync never fetch unrelated full history');
 assert.equal(qa.metrics.some(r=>r.rpc==='read_ship_dynamics_record_delta_v1'||r.rpc==='read_ship_dynamics_records_v1'),false);
 await a.sync();await a.screen('scoped-save-sync');
 assert.ok(qa.metrics.some(r=>r.status==='ACK_DROPPED_AFTER_SQL'));assert.ok(qa.metrics.some(r=>r.rpc==='get_ship_dynamics_record_receipt_v1'&&r.status==='SQL_OK'));
 receipt.measurement={fullCompatibilityBytes:Buffer.byteLength(JSON.stringify(baseline)),scopedReads:qa.metrics.filter(r=>r.trace?.scope==='home').map(r=>({bytes:r.bytes,changedRecords:r.trace.changedRecords,elapsedMs:r.elapsedMs}))};
 receipt.cases.push({caseId:'VESSEL-SCOPE',status:'PASS',completeSqlEquality:true,peerDraftRetained:true,lostAckExactRecovery:true});
 currentCase='ACTION-DETAIL';
 await a.eval(`void(window.__actionStart=${receipt.network.length})`);
 await a.click('待辦總表');await a.sync();
 await until(()=>a.eval("document.body.innerText.includes('QA withdraw')"),'original task list');
 await until(()=>receipt.network.some(r=>r.caseId==='ACTION-DETAIL'&&r.finished),'list read finished');
 assert.equal(receipt.network.some(r=>r.caseId==='ACTION-DETAIL'&&r.containsUnloadedDetail),false,'task list must keep unrelated histories and report snapshots deferred');
 receipt.cases.push({caseId:'ACTION-DETAIL',status:'PASS'});
 currentCase='TARGET-TASK';
 await a.activate(`[...document.querySelectorAll('tbody tr')].find(n=>n.innerText.includes('QA withdraw'))?.querySelector('button')`);
 await until(()=>a.eval("Boolean(document.querySelector('#task-edit-title'))"),'original target task editor');
 await until(()=>a.eval("document.querySelector('.status-history')?.innerText.includes('QA_TARGET_HISTORY')"),'complete target history');await a.screen('target-task-history');
 assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.containsUnloadedDetail),false,'exact task action must not read unrelated history/snapshot');
 const taskWindow={started:Date.now()},taskBefore=await read(),caseBefore=taskBefore.payload.internalControlCases.find(c=>c.id==='qa-withdraw'),targetId=caseBefore.linkedTaskId;
 await a.fill("document.querySelector('.quick-status-bar textarea')",'SCOPED TARGET SAVED');await a.click('加入狀態紀錄');await a.click('保存變更');
 await until(async()=>{const x=await read();return x.payload.tasks.find(t=>t.id===targetId)?.status==='SCOPED TARGET SAVED';},'target task actual SQL save');
 const taskAfter=await read();
 const taskRequest=outgoing.find(r=>r.caseId==='TARGET-TASK');assert.ok(taskRequest);taskWindow.captured=taskRequest.captured;
 const taskExpected=scopedTaskExpected(taskBefore,taskRequest.body,'task',taskWindow);
 const expected=assertScopedSqlResult(taskBefore,taskAfter,taskExpected,taskWindow);
 receipt.oracleMutations=proveOracleRejectsTampering(taskBefore,taskAfter,taskExpected,taskWindow);
 fs.writeFileSync(path.join(run,'target-complete-sql-readback.json'),JSON.stringify({before:scrub(taskBefore),after:scrub(taskAfter),expected:scrub(expected),request:scrub(taskRequest),window:taskWindow},null,2));
 assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.containsUnloadedDetail),false,'target save and ACK remain scoped');
 await until(()=>a.saved(),'target UI ACK');await a.sync();await a.screen('target-task-saved');
 await until(()=>a.saved(),'target saved and released');
 assert.deepEqual(await locks(),[]);
 receipt.cases.push({caseId:'TARGET-TASK',status:'PASS',completeSqlGraphEquality:true,orderedRawHistory:true});
 currentCase='RELOAD-TARGET-TO-HOME';await a.eval('void(window.__oldDocument=true)');await call('Page.reload',{},a.s);
 await until(()=>a.eval('window.__oldDocument!==true&&Boolean(document.querySelector("article.ship-card"))'),'new original document');
 await until(()=>receipt.network.some(r=>r.caseId===currentCase&&r.finished),'new cold response');
 await until(()=>a.saved(),'clean persisted target action can cold-reload as home summary');
 assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.containsUnloadedDetail),false);
 await a.open('qa-v2');assert.equal(await a.eval(`(${field}).value`),'SCOPED A SAVED');await a.click('取消並關閉');
 receipt.cases.push({caseId:'RELOAD-TARGET-TO-HOME',status:'PASS'});
 currentCase='BULK-TARGET-UNION';await a.click('待辦總表');await until(()=>a.eval("Boolean(document.querySelector('tbody .task-link'))"),'bulk list mounted');
 for(const label of ['QA case-delete','QA task-delete']){await a.eval(`document.querySelectorAll('tbody tr').forEach(n=>{if(n.innerText.includes(${JSON.stringify(label)}))n.querySelector('input[type=checkbox]').focus();})`);await a.key(' ','Space');}
 await until(()=>a.eval("[...document.querySelectorAll('button')].some(n=>n.innerText==='批量完成（2）'&&!n.disabled)"),'exact selected pair');
 const bulkWindow={started:Date.now()},bulkBefore=await read();await a.click('批量完成（2）');
 await until(async()=>{const x=await read();return ['qa-case-delete','qa-task-delete'].every(id=>x.payload.internalControlCases.find(c=>c.id===id)?.isClosed);},'both selected linked graphs completed in SQL');
 await until(()=>a.saved(),'bulk authoritative ACK');const bulkAfter=await read();assert.equal(bulkAfter.revision,bulkBefore.revision+1);
 const bulkRequest=outgoing.find(r=>r.caseId==='BULK-TARGET-UNION');assert.ok(bulkRequest);bulkWindow.captured=bulkRequest.captured;
 const bulkExpected=scopedTaskExpected(bulkBefore,bulkRequest.body,'bulk',bulkWindow);
 const bulkResult=assertScopedSqlResult(bulkBefore,bulkAfter,bulkExpected,bulkWindow);
 receipt.bulkOracleMutations=proveOracleRejectsTampering(bulkBefore,bulkAfter,bulkExpected,bulkWindow);
 assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.containsUnloadedDetail),false,'bulk never loads unselected detail');await until(async()=>(await locks()).length===0,'bulk complete release');assert.deepEqual(await locks(),[]);
 fs.writeFileSync(path.join(run,'bulk-complete-sql-readback.json'),JSON.stringify({before:scrub(bulkBefore),after:scrub(bulkAfter),expected:scrub(bulkResult),request:scrub(bulkRequest),window:bulkWindow},null,2));
 receipt.cases.push({caseId:'BULK-TARGET-UNION',status:'PASS',selectedGraphs:2});
 currentCase='READONLY-TARGET';const contextC=(await call('Target.createBrowserContext')).browserContextId;const c=await makePage('qa-vessel',contextC);await login(c);
 await c.click('本船待辦');await until(()=>c.eval("[...document.querySelectorAll('tbody tr')].some(n=>n.innerText.includes('QA READONLY TASK'))"),'readonly list mounted');
 await c.activate(`[...document.querySelectorAll('tbody tr')].find(n=>n.innerText.includes('QA READONLY TASK'))?.querySelector('button')`);
 await until(()=>c.eval("Boolean(document.querySelector('#task-edit-title'))"),'original read-only task');
 assert.equal(await c.eval("document.querySelector('.status-history')?.innerText.includes('QA_READONLY_HISTORY')"),true,'read-only viewer receives the requested full history instead of a stale summary render');
 assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.containsUnloadedDetail),false);assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.rpc===patchRpc),false);
 await c.screen('readonly-target-history');receipt.cases.push({caseId:'READONLY-TARGET',status:'PASS'});
 currentCase='CASE-LIST';await a.click('內控異常');await until(()=>a.eval("Boolean(document.querySelector('.internal-control-page'))"),'case page mounted');await a.sync();
 assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.containsUnloadedDetail),false,'case list must not download unrelated history or report snapshots');
 receipt.cases.push({caseId:'CASE-LIST',status:'PASS'});
 const openCase=async()=>{await a.activate(`[...document.querySelectorAll('.internal-control-page tbody tr')].find(n=>n.innerText.includes('QA withdraw'))?.querySelector('.table-actions button')`);await until(()=>a.eval("Boolean(document.querySelector('.ic-edit-modal'))"),'original case editor');};
 currentCase='CASE-LIFECYCLE';await openCase();
 assert.equal(await a.eval("document.querySelector('.status-history')?.innerText.includes('QA_TARGET_HISTORY')"),true,'case editor receives complete fresh target history');
 const caseStart=await read();
 await a.fill("document.querySelector('.ic-status-add textarea')",'SCOPED CASE CLOSED');await a.click('加入狀態記錄');
 await a.eval("document.querySelector('.ic-close-toggle input').focus()");await a.key(' ','Space');await a.click('保存更新');await until(()=>a.saved(),'case close authoritative ACK');
 const caseClosed=await read();assert.equal(caseClosed.payload.internalControlCases.find(c=>c.id==='qa-withdraw').isClosed,true);assert.equal(caseClosed.payload.tasks.find(t=>t.id===targetId).isClosed,true);
 await a.activate(`[...document.querySelectorAll('.ic-tabs button')].find(n=>n.innerText.startsWith('內控結案清單'))`);await openCase();
 await a.eval("document.querySelector('.ic-close-toggle input').focus()");await a.key(' ','Space');await a.click('保存更新');await until(()=>a.saved(),'case reopen authoritative ACK');
 const caseReopened=await read();assert.equal(caseReopened.payload.internalControlCases.find(c=>c.id==='qa-withdraw').isClosed,false);assert.equal(caseReopened.payload.tasks.find(t=>t.id===targetId).isClosed,false);
 for(const col of ['tasks','internalControlCases']){const key=col==='tasks'?targetId:'qa-withdraw',old=caseStart.payload[col].find(x=>x.id===key),now=caseReopened.payload[col].find(x=>x.id===key);assert.deepEqual(now.statusLogs.slice(-old.statusLogs.length),old.statusLogs,'complete raw case lifecycle history preserved');}
 assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.containsUnloadedDetail),false,'case lifecycle stays exact');
 const caseRequests=outgoing.filter(r=>r.caseId==='CASE-LIFECYCLE');assert.equal(caseRequests.length,2);
 const caseEntities=['tasks:'+targetId,'internalControlCases:qa-withdraw'];
 assertLifecycleReadback(caseStart,caseClosed,caseRequests[0],{entities:caseEntities,audits:[['結案內控異常','internal-control','qa-withdraw']]});
 assertLifecycleReadback(caseClosed,caseReopened,caseRequests[1],{entities:caseEntities,audits:[['重新開啟內控異常','internal-control','qa-withdraw']]});
 const freshCase=await native.connect('fresh_case_lifecycle');assert.deepEqual((await freshCase.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r,caseReopened);await freshCase.end();
 fs.writeFileSync(path.join(run,'case-lifecycle-sql-readback.json'),JSON.stringify({before:scrub(caseStart),closed:scrub(caseClosed),reopened:scrub(caseReopened)},null,2));
 await a.sync();await a.screen('case-lifecycle');assert.deepEqual(await locks(),[]);receipt.cases.push({caseId:'CASE-LIFECYCLE',status:'PASS'});
 currentCase='MEETING-LIST';await a.click('臨會/專題');await until(()=>a.eval("Boolean(document.querySelector('.temporary-meeting-page'))"),'meeting page mounted');await a.sync();
 assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.containsUnloadedDetail),false,'meeting overview must not download unrelated history or report snapshots');
 receipt.cases.push({caseId:'MEETING-LIST',status:'PASS'});
 currentCase='MEETING-LIFECYCLE';
 await until(()=>a.eval("document.querySelector('.meeting-status-history')?.innerText.includes('QA_SELECTED_MEETING_HISTORY')"),'fresh auto-selected meeting history');
 await a.screen('meeting-fresh-history');const meetingStart=await read();
 await a.click('取得編輯權');await until(()=>a.eval("Boolean(document.querySelector('textarea[aria-label=會議最新狀態]'))&&!document.querySelector('textarea[aria-label=會議最新狀態]').closest('fieldset').disabled"),'meeting original editor writable');
 await a.fill("document.querySelector('textarea[aria-label=會議最新狀態]')",'SCOPED MEETING SAVED');await a.click('加入狀態紀錄');await a.click('保存並退出編輯');
 await until(async()=>{const x=await read();return x.payload.meetings.find(m=>m.id==='qa-selected-meeting').latestStatus==='SCOPED MEETING SAVED';},'meeting SQL save');
 await until(()=>a.eval("[...document.querySelectorAll('button')].some(n=>n.innerText==='取得編輯權')"),'meeting edit release');const meetingSaved=await read();
 await a.activate("document.querySelector('.meeting-linked-tasks button.meeting-decision-transition')");
 await until(()=>a.eval("Boolean(document.querySelector('#meeting-decision-closure-status'))"),'original decision closure dialog');await a.fill("document.querySelector('#meeting-decision-closure-status')",'SCOPED DECISION CLOSED');
 await a.activate("[...document.querySelectorAll('[role=dialog] button')].find(n=>n.innerText.includes('確認結案'))");
 await until(async()=>{const x=await read();return x.payload.tasks.find(t=>t.id==='qa-selected-decision').isClosed;},'linked decision SQL completion');await until(()=>a.saved(),'decision ACK');
 const decisionClosed=await read();await a.click('結案會議');
 await until(async()=>{const x=await read();return x.payload.meetings.find(m=>m.id==='qa-selected-meeting').status==='已完成';},'meeting SQL closed');await until(async()=>(await locks()).length===0,'meeting close release');
 const meetingClosed=await read();await a.click('重新開啟會議');
 await until(async()=>{const x=await read();return x.payload.meetings.find(m=>m.id==='qa-selected-meeting').status==='追蹤中';},'meeting SQL reopened');await until(async()=>(await locks()).length===0,'meeting reopen release');
 const meetingReopened=await read();
 for(const col of ['tasks','meetings']){const id=col==='tasks'?'qa-selected-decision':'qa-selected-meeting',old=meetingStart.payload[col].find(x=>x.id===id),now=meetingReopened.payload[col].find(x=>x.id===id);assert.deepEqual(now.statusLogs.slice(-old.statusLogs.length),old.statusLogs,'original complete meeting graph history retained');}
 assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.containsUnloadedDetail),false,'meeting save/decision/lifecycle never loads unrelated history or snapshots');
 const meetingRequests=outgoing.filter(r=>r.caseId==='MEETING-LIFECYCLE');assert.equal(meetingRequests.length,4);
 const meetingEntities=['meetings:qa-selected-meeting','tasks:qa-selected-decision'];
 assertLifecycleReadback(meetingStart,meetingSaved,meetingRequests[0],{entities:meetingEntities,audits:[['更新臨會/專題','meeting','qa-selected-meeting']]});
 assertLifecycleReadback(meetingSaved,decisionClosed,meetingRequests[1],{entities:meetingEntities,audits:[['同步完成會議決議待辦','meeting','qa-selected-meeting'],['完成臨會/專題待辦','task','qa-selected-decision']],noticeTaskId:'qa-selected-decision'});
 assertLifecycleReadback(decisionClosed,meetingClosed,meetingRequests[2],{entities:meetingEntities,audits:[['結案臨會/專題','meeting','qa-selected-meeting']]});
 assertLifecycleReadback(meetingClosed,meetingReopened,meetingRequests[3],{entities:meetingEntities,audits:[['重新開啟臨會/專題','meeting','qa-selected-meeting']]});
 const freshMeeting=await native.connect('fresh_meeting_lifecycle');assert.deepEqual((await freshMeeting.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r,meetingReopened);await freshMeeting.end();
 fs.writeFileSync(path.join(run,'meeting-lifecycle-sql-readback.json'),JSON.stringify({before:scrub(meetingStart),saved:scrub(meetingSaved),decisionClosed:scrub(decisionClosed),closed:scrub(meetingClosed),reopened:scrub(meetingReopened)},null,2));
 await a.sync();await a.screen('meeting-lifecycle');receipt.cases.push({caseId:'MEETING-LIFECYCLE',status:'PASS'});
 assert.equal(receipt.network.some(r=>r.containsOtherMeetingHistory),false,'unselected meeting facet remains deferred');
 currentCase='MEETING-SELECTED-READ';await a.click('未完成清單');
 await a.activate(`[...document.querySelectorAll('.meeting-register-table tbody tr')].find(n=>n.innerText.includes('QA UNRELATED MEETING'))?.querySelector('button')`);
 await until(()=>a.eval("document.querySelector('.meeting-status-history')?.innerText.includes('QA_OTHER_MEETING_HISTORY')"),'explicit selected meeting renders fresh target history');await a.sync();
 assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.rpc===patchRpc),false);assert.equal(receipt.network.some(r=>r.caseId===currentCase&&r.containsUnloadedDetail),false);
 assert.ok(receipt.network.some(r=>r.caseId===currentCase&&r.targets?.some(t=>t.collection==='meetings'&&t.id==='qa-unrelated-meeting')));
 await a.screen('meeting-explicit-selected-history');receipt.cases.push({caseId:'MEETING-SELECTED-READ',status:'PASS'});
 for(const name of ['CASE-LIST','CASE-LIFECYCLE','MEETING-LIST','MEETING-LIFECYCLE']){
  const reads=receipt.network.filter(r=>r.caseId===name&&/^read_ship_dynamics_record/.test(r.rpc));assert.ok(reads.length);
  assert.equal(reads.some(r=>r.readScope==='full'||r.rpc!=='read_ship_dynamics_record_scopes_v1'),false,name+' has no full fallback');
  const allowed=name.startsWith('CASE')?new Set(['internalControlCases:qa-withdraw']):new Set(['meetings:qa-selected-meeting','tasks:qa-selected-decision']);
  for(const row of reads)for(const target of row.targets||[])assert.ok(allowed.has(target.collection+':'+target.id),name+' exact requested key');
 }
 assert.deepEqual(receipt.errors,[],'no unexpected original UI dialogs or runtime errors');
 assert.equal(await a.eval("[...document.querySelectorAll('*')].some(n=>n.hasAttribute('loadcase')||n.hasAttribute('loadmeetings')||n.hasAttribute('authorizationepoch'))"),false,'internal scope props do not leak to DOM');
 receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseCommit?.();rendezvous=false;receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});}}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)assert.equal(await portClosed(Number(chromePort)),true);assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

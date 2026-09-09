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
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-management-scoped-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['scripts/verify-management-scoped-browser.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','scripts/management-scoped-save-oracle.mjs','scripts/record-internal-control-local-fixture.mjs','src/main.tsx','src/App.tsx','src/Management.tsx','src/DataManagementPanel.tsx','src/dataAnalysisVesselAttention.ts','src/taskVesselProgress.ts','src/taskVesselScope.ts','src/taskCategories.ts','src/taskAttention.ts','src/vesselAttention.ts','src/meetingVesselAttention.ts','src/taipeiTime.ts','src/cloud.ts','src/cloudRecordScopes.ts','supabase/development/20260908_appdata_record_scoped_read.sql'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
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
  await call('Target.closeTarget',{targetId:fresh.targetId});
 }
 fs.writeFileSync(path.join(run,name+'-readback.json'),JSON.stringify({hash:hash(actual),readback:scrub(actual)},null,2));
}

try{
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,taskMember:true,scopedRead:true,performanceTrace:true,preparePerformanceFixture:async initial=>{
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
    const b=JSON.parse(m.params.request.postData||'{}'),row={caseId:currentCase,actor:actors.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:b.p_operation_id,readScope:b.p_scope,targets:b.p_targets,request:scrub(b),payloadHash:hash(b),started:m.params.wallTime*1000};
    netRows.set(m.sessionId+':'+m.params.requestId,row);receipt.network.push(row);
   }
   const row=netRows.get(m.sessionId+':'+m.params.requestId);
   if(m.method==='Network.responseReceived'&&row)row.httpStatus=m.params.response.status;
   if(m.method==='Network.loadingFinished'&&row){const response=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId);const v=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body);fs.writeFileSync(path.join(run,'response-'+receipt.network.indexOf(row)+'.json'),JSON.stringify(scrub(v),null,2));Object.assign(row,{containsUnloadedDetail:JSON.stringify(v).includes('QA_UNLOADED_DETAIL_SENTINEL'),containsOtherMeetingHistory:JSON.stringify(v).includes('QA_OTHER_MEETING_HISTORY'),finished:Date.now(),result:v?.ok===false?v.code:'SQL_OK',conflictKey:v?.conflict_key,revision:v?.revision});save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });



 const contextA=(await call('Target.createBrowserContext')).browserContextId,a=await makePage('qa-owner',contextA);await login(a);
 const write=(name,v)=>fs.writeFileSync(path.join(run,name+'.json'),JSON.stringify(scrub(v),null,2));
 const original=await read();write('sql-before',original);
 const {normalizeAppData}=await qa.loadModule('/src/normalize.ts'),scopes=await qa.loadModule('/src/cloudRecordScopes.ts'),{default:Management}=await qa.loadModule('/src/Management.tsx');
 const model=normalizeAppData(original.payload),homeResponse=(await native.observer.query('select read_ship_dynamics_record_scopes_v1($1,$2,$3::jsonb) r',[qa.workspace,'home','{}'])).rows[0].r;
 const home=normalizeAppData(scopes.recordScopePayload(scopes.consumeRecordScopes(homeResponse,qa.workspace,'home',null)));
 globalThis.window={localStorage:{getItem:()=>null}};globalThis.localStorage=globalThis.window.localStorage;
 const render=(data,id='qa-owner')=>renderToStaticMarkup(React.createElement(Management,{data,currentUser:data.users.find(u=>u.id===id),commit:()=>{},onSaveSupabaseConfig:async()=>false}));
 for(const id of ['qa-owner','qa-admin','qa-operator','qa-vessel']){assert.equal(render(home,id),render(model,id),'unchanged directory/nav/counts full/home '+id);receipt.cases.push({caseId:'MG1-MODEL-'+id,layer:'native-model-original-component',status:'PASS'});}
 for(const key of ['users','vessels','settings','auditLogs'])assert.deepEqual(home[key],model[key],'complete management '+key);
 assert.ok(JSON.stringify(original).includes('QA_UNLOADED_DETAIL_SENTINEL'));assert.equal(JSON.stringify(homeResponse).includes('QA_UNLOADED_DETAIL_SENTINEL'),false);
 write('native-model-parity',{fullMarkup:render(model),homeMarkup:render(home),fullHash:hash(original),homeHash:hash(homeResponse)});

 currentCase='MG1';await a.click('管理');await until(()=>a.eval("Boolean(document.querySelector('.management-view'))"),'original management');await a.screen('management-directory');
 await until(()=>receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc)).every(r=>r.finished),'actual response bodies');
 write('sql-after-cold',await read());assert.deepEqual(await read(),original,'cold read exact SQL unchanged');
 receipt.productReads=receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc));save();
 assert.equal(receipt.productReads.filter(r=>r.readScope==='full'||r.rpc!=='read_ship_dynamics_record_scopes_v1').length,0,'MG1 original management must not fetch full graph');
 assert.equal(receipt.productReads.some(r=>r.containsUnloadedDetail),false,'MG1 unrelated history/report snapshot crosses product wire');
 receipt.cases.push({caseId:'MG1',layer:'original-UI-native-PG',status:'PASS'});
 const pass=id=>{receipt.cases.push({caseId:id,layer:'original-UI-native-PG',status:'PASS'});save();};
 const sub=async(p,label)=>p.activate(`[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith(${JSON.stringify(label)}))`);
 const choose=async(p,name)=>p.activate(`[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText===${JSON.stringify(name)})`);
 const physical=async()=> (await native.observer.query('select collection,entity_id,to_jsonb(t) value,xmin::text,ctid::text from ship_dynamics_records t order by collection,entity_id')).rows;
 const formalBefore=await qa.itinerarySnapshot(),physicalBefore=await physical();write('physical-before',physicalBefore);
 const directoryRows=()=>a.eval("[...document.querySelectorAll('.management-master .management-list button b')].map(n=>n.innerText)");
 assert.equal(await a.eval("document.querySelector('.management-kpis').innerText"),`人員\n${model.users.filter(u=>u.isActive).length}\n船舶\n${model.vessels.filter(v=>v.isActive).length}\n管理員\n${model.users.filter(u=>u.isActive&&['owner','admin'].includes(u.role)).length}`);
 const initialRows=await directoryRows();assert.equal(initialRows.length,model.users.filter(u=>u.isActive).length+model.vessels.filter(v=>v.isActive).length);
 await a.fill("document.querySelector('.management-master input')",'QA SPARE');assert.deepEqual(await directoryRows(),['QA SPARE']);await a.fill("document.querySelector('.management-master input')",'');assert.deepEqual(await directoryRows(),initialRows);pass('MG1-QUERY-COUNTS');
 currentCase='MG2-OWNER';const ownerLabels=['總清單','人員','船舶','分類管理','關注度說明','角色權限','Owner 與雲端','操作紀錄','數據管理'];
 assert.deepEqual(await a.eval("[...document.querySelectorAll('.management-sidebar button')].map(n=>n.textContent.slice(n.querySelector('i').textContent.length))"),ownerLabels);
 for(const label of ownerLabels){await sub(a,label);assert.ok(await a.eval("Boolean(document.querySelector('.management-master'))"));if(label==='數據管理')await until(()=>receipt.network.some(r=>r.rpc==='get_ship_dynamics_record_storage_stats_v1'&&r.finished),'authoritative storage stats');}
 assert.equal(await a.eval("Boolean(document.querySelector('.data-management-message.error'))"),false);await a.screen('management-data');
 const statsNative=(await native.observer.query('select get_ship_dynamics_record_storage_stats_v1($1,$2) r',[qa.workspace,'qa-owner'])).rows[0].r;
 const statsIndex=receipt.network.findIndex(row=>row.rpc==='get_ship_dynamics_record_storage_stats_v1'&&row.finished),statsWire=JSON.parse(fs.readFileSync(path.join(run,'response-'+statsIndex+'.json'),'utf8'));
 for(const key of ['items','collections','revisions','currentRevision','currentStateBytes','revisionHistoryBytes','revisionHistoryCount','storageObjectBytes','storageObjectCount'])assert.deepEqual(statsWire[key],scrub(statsNative[key]),'specialized authoritative stats '+key);
 write('specialized-stats-readback',{wire:statsWire,native:statsNative});
 for(const label of ['單項資料用量','歷史版本清理','Itinerary 日快照']){await a.activate(`[...document.querySelectorAll('.data-management-master button')].find(n=>n.querySelector('b')?.innerText===${JSON.stringify(label)})`);if(label==='Itinerary 日快照')await until(()=>receipt.network.some(r=>r.rpc==='sd_itinerary_record_report_list_v1'&&r.finished),'authoritative formal report list');}
 assert.deepEqual(await read(),original,'all Owner management subpages read only');assert.deepEqual(await physical(),physicalBefore);pass('MG2-OWNER');
 for(const actor of ['qa-admin','qa-operator','qa-vessel']){
  currentCase='MG2-'+actor;const p=await makePage(actor,(await call('Target.createBrowserContext')).browserContextId);await login(p);
  const {hasPermission}=await qa.loadModule('/src/permissions.ts');const user=model.users.find(u=>u.id===actor),allowed=hasPermission(model.settings.rolePermissions,user,'enterManagement');
  const present=await p.eval("[...document.querySelectorAll('nav button')].some(n=>n.innerText==='管理')");assert.equal(present,allowed);receipt.roleMatrix??={};receipt.roleMatrix[actor]={entryVisible:present,entryPermitted:allowed};
  if(allowed){await p.click('管理');await until(()=>p.eval("Boolean(document.querySelector('.management-view'))"),'role management');
   const labels=['總清單',hasPermission(model.settings.rolePermissions,user,'manageUsers')?'人員':'我的帳號',...(hasPermission(model.settings.rolePermissions,user,'manageVessels')?['船舶']:[]),...(actor==='qa-admin'?['分類管理']:[]),'關注度說明','角色權限',...(hasPermission(model.settings.rolePermissions,user,'manageSystemSettings')?['Owner 與雲端']:[]),...(hasPermission(model.settings.rolePermissions,user,'viewAuditLogs')?['操作紀錄']:[]),...(actor==='qa-admin'?['數據管理']:[])];
   assert.deepEqual(await p.eval("[...document.querySelectorAll('.management-sidebar button')].map(n=>n.textContent.slice(n.querySelector('i').textContent.length))"),labels);
   receipt.roleMatrix[actor].labels=labels;for(const label of labels)await sub(p,label);
  }pass(currentCase);await until(()=>[...netRows.entries()].filter(([key])=>key.startsWith(p.s+':')).every(([,v])=>v.finished),'role bodies');await call('Target.closeTarget',{targetId:p.targetId});p.reader=true;
 }
 await sub(a,'人員');await choose(a,'QA SPARE');
 async function saveIntent(intent){
  const id=currentCase,before=await read(),rows=await physical(),started=Date.now();let expected;
  write(id+'-sql-before',before);write(id+'-intent-before-save',intent);
  qa.setRecordFault({before:async({name,body})=>{if(name!==patchRpc)return;const {managementExpected}=await import('./management-scoped-save-oracle.mjs');expected=await managementExpected(before,body,qa,intent,started);write(id+'-expected-before-sql',expected);}});
  await a.click('保存變更');await until(()=>receipt.network.some(r=>r.caseId===id&&r.rpc===patchRpc&&r.finished),'real original autosave SQL ACK '+id);qa.setRecordFault(null);
  const after=await read();write(id+'-sql-after',after);assert.ok(expected,'expected frozen before SQL');
  const {assertManagementAfter,managementNegativeProbes}=await import('./management-scoped-save-oracle.mjs');assertManagementAfter(before,after,expected,started);receipt.cases.push(...managementNegativeProbes(before,after,expected,started,intent));
  const afterRows=await physical(),changed=intent.kind==='person'?new Set(['users:'+intent.id]):new Set(['users:'+intent.userId,'vessels:'+intent.id]);
  assert.deepEqual(afterRows.filter(v=>v.collection!=='auditLogs'&&!changed.has(v.collection+':'+v.entity_id)),rows.filter(v=>v.collection!=='auditLogs'&&!changed.has(v.collection+':'+v.entity_id)),'untouched entity full physical identity');
  write(id+'-physical',{before:rows,after:afterRows});const c=await native.connect('management_'+id),fresh=(await c.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;await c.end();assert.deepEqual(fresh,after);write(id+'-fresh-readback',fresh);pass(id);await a.sync();return after;
 }
 currentCase='MG3';await a.fill("[...document.querySelectorAll('.management-form label')].find(n=>n.textContent==='姓名')?.querySelector('input')",'MG SAVED SPARE');await saveIntent({kind:'person',id:'qa-spare',name:'MG SAVED SPARE'});
 currentCase='MG4';await sub(a,'船舶');await choose(a,'QA VESSEL 2');
 const checked=await a.eval("(()=>{const label=[...document.querySelectorAll('.management-assignment-grid label')].find(n=>n.querySelector('b')?.innerText==='QA OPERATOR');const n=label?.querySelector('input');if(!n||n.checked)throw new Error('initial unassigned operator required');n.scrollIntoView({block:'center'});const b=n.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()");
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...checked},a.s);await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...checked},a.s);
 assert.ok(await a.eval("[...document.querySelectorAll('.management-assignment-grid label')].find(n=>n.querySelector('b')?.innerText==='QA OPERATOR').querySelector('input').checked"));
 const assigned=await saveIntent({kind:'vessel',id:'qa-v2',userId:'qa-operator'});assert.deepEqual(assigned.payload.vessels.find(v=>v.id==='qa-v2').assignedUserIds,['qa-operator']);assert.deepEqual(assigned.payload.vessels.find(v=>v.id==='qa-v2').delegateManagers,[]);assert.deepEqual(assigned.payload.users.find(u=>u.id==='qa-operator').managedVesselIds,['qa-v1','qa-v2']);
 currentCase='MG5-NATIVE-NAV';await a.click('船隊看板');await a.activate("[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1'))?.querySelector('.ship-name-link')");await until(()=>a.eval("Boolean(document.querySelector('.vessel-detail-page'))"),'detail');await a.activate("[...document.querySelectorAll('.vessel-detail-task-table tbody tr')].find(n=>n.innerText.includes('STATS A'))?.querySelector('button')");await until(()=>a.eval("Boolean(document.querySelector('#task-edit-title'))"),'target expansion');await a.click('取消');await until(()=>a.eval("!document.querySelector('#task-edit-title')"),'cancel complete');
 let entered=false;qa.setRecordFault({after:async({name,body})=>{if(name==='read_ship_dynamics_record_scopes_v1'&&body.p_scope==='home'&&!entered){entered=true;await new Promise(r=>releaseHeldRead=r);}return false;}});await a.click('管理');await until(()=>entered,'native home response held');await a.click('待辦總表');await until(()=>a.eval("[...document.querySelectorAll('nav button')].some(n=>n.innerText==='待辦總表'&&n.classList.contains('active'))"),'successor navigation');releaseHeldRead();await wait(200);assert.equal(await a.eval("Boolean(document.querySelector('.management-view'))"),false);qa.setRecordFault(null);pass(currentCase);
 await a.click('管理');await until(()=>a.eval("Boolean(document.querySelector('.management-view'))"),'reentry');await sub(a,'人員');await choose(a,'MG SAVED SPARE');assert.equal(await a.eval("[...document.querySelectorAll('.management-form label')].find(n=>n.textContent==='姓名').querySelector('input').value"),'MG SAVED SPARE');
 currentCase='MG3-MG4-FRESH-DOCUMENT';await a.eval('void(window.__oldManagementDocument=true)');await call('Page.reload',{},a.s);await until(()=>a.eval("window.__oldManagementDocument!==true&&Boolean(document.querySelector('article.ship-card'))"),'fresh actual original document');await a.click('管理');await until(()=>a.eval("Boolean(document.querySelector('.management-view'))"),'fresh management');await sub(a,'人員');await choose(a,'MG SAVED SPARE');assert.equal(await a.eval("[...document.querySelectorAll('.management-form label')].find(n=>n.textContent==='姓名').querySelector('input').value"),'MG SAVED SPARE');await sub(a,'船舶');await choose(a,'QA VESSEL 2');assert.ok(await a.eval("[...document.querySelectorAll('.management-assignment-grid label')].find(n=>n.querySelector('b')?.innerText==='QA OPERATOR').querySelector('input').checked"));pass(currentCase);
 currentCase='MG-FINAL-PRODUCT';await until(()=>receipt.network.every(r=>r.finished),'all final bodies');receipt.productReads=receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc));
 for(const row of receipt.productReads){assert.equal(row.rpc,'read_ship_dynamics_record_scopes_v1');assert.notEqual(row.readScope,'full');if(row.containsUnloadedDetail)assert.ok(row.caseId==='MG5-NATIVE-NAV'&&row.readScope==='targets'&&JSON.stringify(row.targets)===JSON.stringify([{collection:'tasks',id:'stats-a'}]),'only explicitly opened child history permitted');}
 assert.deepEqual(await qa.itinerarySnapshot(),formalBefore);assert.deepEqual(await read(),assigned);assert.deepEqual(receipt.errors,[]);
 write('sql-final',await read());
 receipt.readScopeCounts=Object.fromEntries(['home','targets','full'].map(scope=>[scope,receipt.productReads.filter(row=>row.readScope===scope).length]));
 receipt.readCoverage=receipt.network.flatMap((row,index)=>{if(row.rpc!=='read_ship_dynamics_record_scopes_v1')return [];const response=JSON.parse(fs.readFileSync(path.join(run,'response-'+index+'.json'),'utf8'));return [{caseId:row.caseId,phase:'product',readScope:row.readScope,requestedTargets:row.targets||[],responsePath:'response-'+index+'.json',rootHeaderPresent:Boolean(response.root),collections:Object.fromEntries(Object.entries(response.collections||{}).map(([key,c])=>[key,{ids:c.ids?.length||0,rows:c.rows?.length||0}]))}];});
 receipt.status='PASS';

}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseHeldRead?.();releaseCommit?.();rendezvous=false;receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(()=>browser.exitCode!==null||browser.signalCode!==null,'forced owned Chrome exit event',5000);}}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)assert.equal(await portClosed(Number(chromePort)),true);assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

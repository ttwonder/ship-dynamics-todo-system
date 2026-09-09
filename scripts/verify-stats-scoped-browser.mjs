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
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-stats-scoped-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['scripts/verify-stats-scoped-browser.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','scripts/record-internal-control-local-fixture.mjs','src/main.tsx','src/App.tsx','src/DataAnalysis.tsx','src/dataAnalysisVesselAttention.ts','src/taskVesselProgress.ts','src/taskVesselScope.ts','src/taskCategories.ts','src/taskAttention.ts','src/vesselAttention.ts','src/meetingVesselAttention.ts','src/taipeiTime.ts','src/cloud.ts','src/cloudRecordScopes.ts','supabase/development/20260908_appdata_record_scoped_read.sql'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
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
  const at=initial.updatedAt,now=new Date(at),previous=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,15,12)).toISOString();
  initial.users.find(u=>u.id==='qa-operator').department='機務';
  initial.users.push({...structuredClone(initial.users[0]),id:'qa-vessel',name:'QA VESSEL ACCOUNT',username:'qa-vessel',role:'vessel',managedVesselIds:['qa-v1']});
  initial.settings.departments=['督導','機務'];
  initial.vessels.forEach((v,i)=>{v.assignedUserIds=i===0?['qa-owner']:[];v.weeklyAttention=[];v.manualAttentionLevel='';});
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
  initial.agendaReports=[{id:'qa-report',title:'QA report',vesselIds:['qa-v1'],createdBy:'qa-owner',createdAt:at,taskCount:4,kind:'ad-hoc',snapshot:{vessels:structuredClone(initial.vessels),tasks:structuredClone(initial.tasks),meetings:structuredClone(initial.meetings),qaUnknown:'QA_UNLOADED_DETAIL_SENTINEL'}}];
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
 const readRows=()=>receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc)&&r.caseId!=='ST-INDEPENDENT-QA-FULL');
 const noFull=async()=>{await until(()=>readRows().every(r=>r.finished),'all product read bodies complete');assert.equal(readRows().some(r=>r.readScope==='full'||r.rpc!=='read_ship_dynamics_record_scopes_v1'),false,'stats must not read unrelated full graph');assert.equal(readRows().some(r=>r.containsUnloadedDetail&&!(r.caseId==='ST-LATE-NATIVE-NAV'&&JSON.stringify(r.targets)===JSON.stringify([{collection:'tasks',id:'stats-a'}]))),false,'stats must not load unrelated history or snapshots (explicit stats-a child probe excepted)');};
 const ledger=async()=>{const tables=(await native.observer.query("select tablename from pg_tables where schemaname='public' and tablename like 'ship_dynamics_record%' order by tablename")).rows,out={};for(const {tablename:t} of tables)out[t]=(await native.observer.query('select to_jsonb(t) value,xmin::text,ctid::text from public."'+t+'" t order by to_jsonb(t)::text')).rows;return out;};
 const original=await read(),beforeLedger=await ledger(),formalBefore=await qa.itinerarySnapshot();
 const {normalizeAppData}=await qa.loadModule('/src/normalize.ts'),scopes=await qa.loadModule('/src/cloudRecordScopes.ts'),{default:Analysis}=await qa.loadModule('/src/DataAnalysis.tsx');
 const model=normalizeAppData(original.payload),homeResponse=(await native.observer.query('select read_ship_dynamics_record_scopes_v1($1,$2,$3::jsonb) r',[qa.workspace,'home','{}'])).rows[0].r;
 const home=normalizeAppData(scopes.recordScopePayload(scopes.consumeRecordScopes(homeResponse,qa.workspace,'home',null)));
 const render=data=>renderToStaticMarkup(React.createElement(Analysis,{data,vessels:data.vessels}));
 assert.ok(JSON.stringify(original).includes('QA_UNLOADED_DETAIL_SENTINEL'));assert.ok(!JSON.stringify(homeResponse).includes('QA_UNLOADED_DETAIL_SENTINEL'));
 assert.equal(render(home),render(model),'entire unchanged stats component native home/full output equality');
 fs.writeFileSync(path.join(run,'native-model-parity.json'),JSON.stringify({fullMarkup:render(model),homeMarkup:render(home),fullHash:hash(original),homeHash:hash(homeResponse)},null,2));
 receipt.cases.push({caseId:'ST-NATIVE-MODEL-PARITY',layer:'native-model-original-component',status:'PASS',sentinelPresentOnlyInFull:true});
 const select=async(selector,value)=>{const i=await a.eval(`(()=>{const n=${selector};n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(i>=0);await a.key('Home');for(let n=0;n<i;n++)await a.key('ArrowDown');await a.key('Enter');await until(()=>a.eval(`(${selector}).value===${JSON.stringify(value)}`),'native stats filter');};
 const metrics=()=>a.eval("[...document.querySelectorAll('.analysis-metric-grid .metric-card')].map(n=>[n.querySelector('small').innerText,n.querySelector('b').innerText,n.querySelector('span').innerText])");
 const expectCards=(total,closed,overdue,proposed,high,highClosed,aware,internal,abnormal)=>{const pct=(a,b)=>b?Math.round(a/b*100):0;return [['責任事項',String(total),'件'],['完成率',String(pct(closed,total)),`%｜${closed} 件`],['逾期率',String(pct(overdue,total)),`%｜${overdue} 件`],['提出率／件數',String(pct(proposed,4)),`%｜${proposed} 件`],['高風險',String(high),`件｜完成 ${pct(highClosed,high)}%`],['需知曉',String(aware),`件｜完成 ${aware?100:0}%`],['內控',String(internal),'件｜完成 0%'],['異常',String(abnormal),'件｜完成 0%']];};
 // Explicit fixture intent, fixed before candidate SQL readbacks; no AFTER-derived oracle.
 // normalize removes Owner assignments and projects the operator managed vessel binding.
 assert.deepEqual(model.vessels.map(v=>v.assignedUserIds),[['qa-operator'],[]]);
 const responsibility=(department,ids)=>model.tasks.filter(t=>t.ownerUserIds.some(id=>ids.includes(id))||(t.vesselIds?.length?t.vesselIds:[t.vesselId]).some(id=>model.vessels.find(v=>v.id===id)?.assignedUserIds.some(u=>ids.includes(u)))||Boolean(department&&t.departments.includes(department))).map(t=>t.id);
 assert.deepEqual(responsibility('', ['qa-owner']),['stats-a']);assert.deepEqual(responsibility('', ['qa-operator']),['stats-a','stats-b','stats-d']);assert.deepEqual(responsibility('機務',['qa-operator']),['stats-a','stats-b','stats-c','stats-d']);
 fs.writeFileSync(path.join(run,'normalized-before-responsibility.json'),JSON.stringify(scrub({users:model.users,vessels:model.vessels,tasks:model.tasks}),null,2));
 const expected={overall:expectCards(4,1,1,4,2,1,1,1,2),department:expectCards(4,1,1,2,2,1,1,1,2),person:expectCards(3,1,1,2,2,1,1,0,2)};
 fs.writeFileSync(path.join(run,'expected-before-ui.json'),JSON.stringify(expected,null,2));
 currentCase='ST-OVERALL';await a.click('數據分析');await until(()=>a.eval("Boolean(document.querySelector('.data-analysis-view'))"),'original stats');await a.sync();assert.deepEqual(await metrics(),expected.overall);await a.screen('stats-overall');await noFull();
 const ranks=await a.eval("[...document.querySelectorAll('.analysis-panel')].filter(p=>/橫向比較與排名/.test(p.querySelector('h3')?.innerText||'')).map(p=>[...p.querySelectorAll('.analysis-compare-row')].map(r=>[r.querySelector('.analysis-name').innerText,...[...r.querySelectorAll('.analysis-value')].map(n=>n.innerText)]))");
 assert.deepEqual(ranks,[[['督導','完成 100%','逾期 0%','責任 1','提出 2'],['機務','完成 25%','逾期 25%','責任 4','提出 2']],[['QA OWNER｜督導','完成 100%','逾期 0%','責任 1','提出 2'],['QA OPERATOR｜機務','完成 33%','逾期 33%','責任 3','提出 2']]]);
 const categories=()=>a.eval("[...document.querySelectorAll('.category-ratio-panel')].map(p=>[...p.querySelectorAll('.analysis-compare-row')].map(r=>[r.querySelector('.analysis-name').innerText,...[...r.querySelectorAll('.analysis-value')].map(n=>n.innerText)]))");
 assert.deepEqual(await categories(),[[['維修','2 件','67%'],['事故','1 件','33%']],[['船員管理','1 件','100%']]]);
 const vessels=await a.eval("[...document.querySelectorAll('.analysis-vessel-table tbody tr')].map(r=>({cells:[...r.cells].slice(1,5).map(n=>n.innerText),trend:r.querySelector('.analysis-trend').title}))");
 assert.deepEqual(vessels.map(v=>v.cells),[['急 1\n高 1\n中 0\n低 0','1','急（自動）','0／7'],['急 0\n高 1\n中 1\n低 0','2','高（自動）','0／7']]);assert.deepEqual(vessels.map(v=>v.trend),['0、0、0、0、1、1','0、0、0、0、0、2']);
 await noFull();receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS',metrics:true,ranks:true,categories:true,abnormalDedup:true,memberClosure:true,monthTrend:true});
 currentCase='ST-DEPARTMENT';await select("document.querySelector('.analysis-filters select')",'department');await select("document.querySelectorAll('.analysis-filters select')[1]",'機務');assert.deepEqual(await metrics(),expected.department);await a.screen('stats-department');receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});
 currentCase='ST-PERSON-SYNC';await select("document.querySelector('.analysis-filters select')",'person');await select("document.querySelectorAll('.analysis-filters select')[1]",'qa-operator');assert.deepEqual(await metrics(),expected.person);assert.deepEqual(await categories(),[[['事故','1 件','50%'],['維修','1 件','50%']],[['船員管理','1 件','100%']]]);await a.sync();assert.deepEqual(await metrics(),expected.person);await a.screen('stats-person');receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS',filterRetainedOnSync:true});
 currentCase='ST-BACK-FRESH';await a.click('船隊看板');await until(()=>a.eval("Boolean(document.querySelector('article.ship-card'))"),'back dashboard');await a.click('數據分析');await until(()=>a.eval("Boolean(document.querySelector('.data-analysis-view'))"),'reenter');assert.deepEqual(await metrics(),expected.overall);await a.eval('void(window.__oldStatsDocument=true)');await call('Page.reload',{},a.s);await until(()=>a.eval("window.__oldStatsDocument!==true&&Boolean(document.querySelector('article.ship-card'))"),'fresh original document');await a.click('數據分析');await until(()=>a.eval("Boolean(document.querySelector('.data-analysis-view'))"),'fresh stats');await a.sync();assert.deepEqual(await metrics(),expected.overall);receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});
 currentCase='ST-LATE-NATIVE-NAV';await a.click('船隊看板');await a.activate("[...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1'))?.querySelector('.ship-name-link')");await until(()=>a.eval("Boolean(document.querySelector('.vessel-detail-page'))"),'detail');await a.activate("[...document.querySelectorAll('.vessel-detail-task-table tbody tr')].find(n=>n.innerText.includes('STATS A'))?.querySelector('button')");await until(()=>a.eval("Boolean(document.querySelector('#task-edit-title'))"),'target expansion');await a.click('取消');await until(()=>a.eval("!document.querySelector('#task-edit-title')"),'cancel complete');
 let entered=false;qa.setRecordFault({after:async({name,body})=>{if(name==='read_ship_dynamics_record_scopes_v1'&&body.p_scope==='home'&&!entered){entered=true;await new Promise(r=>releaseHeldRead=r);}return false;}});await a.click('數據分析');await until(()=>entered,'native home response held');await a.click('待辦總表');await until(()=>a.eval("[...document.querySelectorAll('nav button')].some(n=>n.innerText==='待辦總表'&&n.classList.contains('active'))"),'successor navigation');releaseHeldRead();await wait(200);assert.equal(await a.eval("Boolean(document.querySelector('.data-analysis-view'))"),false);qa.setRecordFault(null);receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS',heldActualSqlResponse:true});
 currentCase='ST-ROLE-NEGATIVE';const c=await makePage('qa-vessel',(await call('Target.createBrowserContext')).browserContextId);await login(c);assert.equal(await c.eval("[...document.querySelectorAll('nav button')].some(n=>n.innerText==='數據分析')"),false,'original vessel role has no stats entry');receipt.cases.push({caseId:currentCase,layer:'original-UI-native-PG',status:'PASS'});
 await noFull();assert.deepEqual(await read(),original,'no business writes');assert.deepEqual(await ledger(),beforeLedger,'raw records/revision/history physical ledger unchanged');assert.deepEqual(await qa.itinerarySnapshot(),formalBefore);
 receipt.productReadCount=readRows().length;receipt.productReadComplete=readRows().every(r=>r.finished);currentCase='ST-INDEPENDENT-QA-FULL';await freshReadback('stats-final',original);await until(()=>receipt.network.filter(r=>/^read_ship_dynamics_record/.test(r.rpc)).every(r=>r.finished),'QA readback body complete');receipt.cases.push({caseId:currentCase,layer:'independent-QA-full-readback-not-product',status:'PASS'});
 fs.writeFileSync(path.join(run,'raw-ledgers.json'),JSON.stringify(scrub({before:beforeLedger,after:await ledger()}),null,2));assert.deepEqual(receipt.errors,[]);receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseHeldRead?.();releaseCommit?.();rendezvous=false;receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(()=>browser.exitCode!==null||browser.signalCode!==null,'forced owned Chrome exit event',5000);}}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)assert.equal(await portClosed(Number(chromePort)),true);assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

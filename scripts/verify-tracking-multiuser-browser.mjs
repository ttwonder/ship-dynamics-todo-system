import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations,installTrackingFieldRevision} from './tracking-browser-fixture.mjs';
import {multiuserChecks} from './tracking-multiuser-browser-checks.mjs';
import {editEntryChecks} from './edit-entry-browser-checks.mjs';
const editEntry=process.argv.includes('--edit-entry'),shipTracking=process.argv.includes('--ship-tracking');

// Original App and ship portal, independent browser identities and real SQL.
// Synthetic data, random credentials, loopback-only; no production business writes.
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root)&&!path.resolve(root).toLowerCase().startsWith(path.resolve('.') .toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'tracking-multiuser-')),profile=path.join(run,'chrome');
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const inputs=['scripts/verify-tracking-multiuser-browser.mjs','scripts/tracking-multiuser-browser-checks.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','scripts/tracking-browser-fixture.mjs','src/App.tsx','src/ShipInternalControlPortal.tsx','src/tracking/TrackingPage.tsx','src/tracking/TrackingModals.tsx','src/tracking/TrackingImportModal.tsx','src/EditModals.tsx','src/InternalControlModals.tsx','src/taskMemberEditor.ts','supabase/migrations/20260924160000_tracking_records.sql','supabase/migrations/20260925020000_edit_lock_holder.sql'];
if(shipTracking)inputs.push('scripts/ship-tracking-multiuser-checks.mjs','src/tracking/ShipTrackingPortal.tsx','src/tracking/shipTracking.ts','packageorwork-tracking.html','supabase/migrations/20260925080000_ship_tracking_public.sql');
const fingerprints=()=>Object.fromEntries(inputs.map(p=>[p,sha(fs.readFileSync(p,'utf8'))]));
if(editEntry)inputs.push('scripts/edit-entry-browser-checks.mjs','src/editLockBundle.ts','src/collaborationLockPlan.ts','src/InternalControlPage.tsx','src/tracking/trackingUiTypes.ts');
const evidence={kind:'tracking-multiuser-original-UI-native-PG',label:'真實主站／船端 UI＋測試資料＋本機 PostgreSQL；非正式環境',status:'RUNNING',head:git('rev-parse','HEAD'),inputs:fingerprints(),cases:[],errors:[],external:[],network:[],blocking:[],productionContacted:false};
let native,qa,browser,ws,failure,next=0,currentCase='setup',barrier;
const pending=new Map(),pages=[],network=new Map();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await wait(70);}throw Error('QA timeout: '+label);};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(evidence,null,2));
const call=(method,params={},session)=>new Promise((resolve,reject)=>{const id=++next,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
const read=async()=> (await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;
const source=async ref=>(await read()).payload.trackingItems.find(r=>r.referenceNo===ref);
async function page(actor,ship=false){
 const {browserContextId:context}=await call('Target.createBrowserContext');
 const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId:context});
 const {sessionId:s}=await call('Target.attachToTarget',{targetId,flatten:true});
 const p={actor,s,context,targetId,ship};pages.push(p);
 p.eval=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},s);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 p.text=()=>p.eval("document.body?.innerText||''");
 p.key=async key=>{const extra=key==='Enter'?{windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'}:{};await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,...extra},s);await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,...(key==='Enter'?{windowsVirtualKeyCode:13}:{})},s);};
 p.activate=async expr=>{await until(()=>p.eval(`Boolean(${expr})&&!(${expr}).disabled`),'enabled target '+expr);await p.eval(`(()=>{const n=${expr};if(!n.getClientRects().length)throw Error('visible target required');n.focus();})()`);await p.key('Enter');};
 p.click=(label,scope='button')=>p.activate(`[...document.querySelectorAll(${JSON.stringify(scope)})].find(n=>n.innerText.trim()===${JSON.stringify(label)}&&n.getClientRects().length)`);
 p.tap=async expr=>{const pos=await p.eval(`(()=>{const n=${expr};if(!n||n.disabled)throw Error('target unavailable');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...pos},s);};
 p.fill=async(selector,value)=>{await until(()=>p.eval(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return !!n&&!!n.getClientRects().length&&!n.disabled&&!n.readOnly;})()`),'editable field '+selector);await p.eval(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled||n.readOnly)throw Error('editable input required: '+${JSON.stringify(selector)});n.focus();n.select();})()`);await call('Input.insertText',{text:value},s);};
 p.choose=async(selector,value)=>{const i=await p.eval(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(i>=0,'option '+value);await p.key('Home');for(let n=0;n<i;n++)await p.key('ArrowDown');await p.key('Enter');await until(()=>p.eval(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`),'selected '+value);};
 p.date=async(selector,value)=>{await p.eval(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)throw Error('date field missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
 p.screen=async name=>fs.writeFileSync(path.join(run,name+'-'+actor+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'},s)).data,'base64'));
 p.done=()=>until(async()=>await p.eval("!document.querySelector('.modal-backdrop')")&&(await p.text()).includes(ship==='tracking'?'已收到伺服器確認並讀回':'已安全保存'),'ACK and original editor close '+actor);
 p.sync=async()=>{const start=evidence.network.length;await p.click('同步最新（安全合併）');await until(()=>evidence.network.slice(start).some(n=>n.actor===actor&&/^read_ship_dynamics_record/.test(n.rpc)&&n.finished),'real sync read '+actor);await until(()=>p.eval("[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='同步最新（安全合併）'&&!n.disabled)&&!document.querySelector('.save-status-strip.saving')"),'sync idle '+actor);};
 p.tracking=async()=>{if(!await p.eval("!!document.querySelector('.tracking-page')"))await p.click('配件/物料/工程跟蹤');await until(()=>p.eval("!!document.querySelector('.tracking-page')"),'tracking mounted');await p.choose('[aria-label=跟蹤船舶]','qa-v1');await p.activate("[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith('配件物料總清單'))");await until(()=>p.eval("!!document.querySelector('.tracking-heading button:not(:disabled)')"),'tracking ready');};
 p.row=ref=>`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.querySelector('.tracking-reference')?.innerText.includes(${JSON.stringify(ref)}))`;
 p.action=async(ref,label)=>{await p.activate(`[...(${p.row(ref)})?.querySelectorAll('button')||[]].find(n=>n.innerText.trim()===${JSON.stringify(label)})`);await until(()=>p.eval("!!document.querySelector('.modal-backdrop')"),'tracking action '+label);};
 p.progress=async(ref,value)=>{await p.action(ref,'進度');await p.fill(`[aria-label="${ref} 最新進度"]`,value);};
 p.submit=async(n=1)=>p.click(`確認保存 ${n} 項`);
 p.reconcile=async()=>{await p.click('核對最新資料／解除已拒絕提交');await until(async()=>(await p.text()).includes('已核對最新版本；原輸入保留'),'explicit rejected reconciliation');};
 p.pending=()=>until(async()=>(await p.text()).includes('確認結果／重試相同提交'),'pending draft '+actor,60000);
 p.openTask=async(ref,closed=false)=>{await p.click('內控異常');await until(()=>p.eval("!!document.querySelector('.ic-tabs')"),'case list');if(closed)await p.activate("[...document.querySelectorAll('.ic-tabs button')].find(n=>n.innerText.startsWith('內控結案清單'))");const row=`[...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.innerText.includes(${JSON.stringify(ref)}))`;await p.activate(`[...(${row})?.querySelectorAll('button')||[]].find(n=>n.innerText.trim()==='要事')`);await until(()=>p.eval("!!document.querySelector('#task-edit-title')"),'task editor');};
 for(const name of ['Page.enable','Runtime.enable','Network.enable'])await call(name,{},s);
 await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},s);
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},s);
 await call('Page.navigate',{url:qa.origin+(ship==='tracking'?'/packageorwork-tracking.html':ship?'/ship-internal-control.html':'')},s);
 if(ship==='tracking'){await until(()=>p.eval("!!document.querySelector('.tracking-page')&&!document.body.innerText.includes('讀取此船最新資料')"),'ship tracking ready');}
 else if(ship){await until(()=>p.eval("document.querySelector('#ship-internal-vessel')?.options.length===3"),'ship roster');await p.choose('#ship-internal-vessel','qa-v1');await until(()=>p.eval("!![...document.querySelectorAll('button')].find(n=>n.innerText.includes('增加內控/訴求')&&!n.disabled)"),'ship ready');}
 else{await until(async()=>(await p.text()).includes('請輸入管理者設定的進站密碼。'),'site gate');await p.fill('input[type=password]',qa.password);await p.click('進入系統');await until(()=>p.eval("!!document.querySelector('[aria-label=登入人員]')"),'personnel login');await p.choose('[aria-label=登入人員]',actor);await p.fill('input[type=password]',qa.password);await p.click('登入');await until(()=>p.eval("!!document.querySelector('nav')&&!document.body.innerText.includes('人員登入／切換')"),'logged in');await p.tracking();}
 return p;
}
const check=async(id,fn)=>{currentCase=id;await fn();assert.ok(!evidence.cases.some(c=>c.id===id));evidence.cases.push({id,status:'PASS',layer:'original-ui-native-postgresql'});save();console.log('PASS',id);};
const blockNext=rpc=>{assert.ok(!barrier);let release;const ready=new Promise(r=>release=r);barrier={rpc,release,ready,entered:false};return barrier;};
const release=()=>{barrier?.release();barrier=null;};
const observeBlocking=async b=>{const row=await until(async()=>{const rows=(await native.observer.query("select pid,pg_blocking_pids(pid) blockers from pg_stat_activity where wait_event_type='Lock'")).rows;return rows.find(r=>r.blockers.includes(b.pid));},'independent native transaction actually waits',6500);assert.notEqual(row.pid,b.pid);evidence.blocking.push({caseId:currentCase,ownerPid:b.pid,peerPid:row.pid});};
try{
 native=await createNativeRecordQa(run,evidence,{httpTransactions:true,beforeCommit:async({context,pid,value})=>{if(barrier&&!barrier.entered&&context.rpc===barrier.rpc&&value?.ok!==false){const b=barrier;b.entered=true;b.pid=pid;b.operationId=context.operationId;await b.ready;}}});
 qa=await createRecordStorageLocalQa({browserAuthority:true,internalControl:true,scopedRead:true,shipInternalControl:true,shipTracking,tracking:true,taskMember:true,performanceTrace:true,databaseFactory:async()=>native.adapter,preparePerformanceFixture:initial=>{for(const key of ['tasks','internalControlCases','taskDismissals','notifications','auditLogs'])initial[key]=[];}});
 await installTrackingBrowserMigrations(native.adapter);
 await native.adapter.exec(fs.readFileSync('supabase/migrations/20260925020000_edit_lock_holder.sql','utf8'));
 await installTrackingFieldRevision(native.adapter);
 assert.equal((await (await fetch(qa.origin+'/__qa/health')).json()).kind,'REAL_UI_SYNTHETIC_DATA_NATIVE_POSTGRES');
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let port,socket;await until(()=>{try{[port,socket]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socket?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome readiness');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socket}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
  void(async()=>{
   if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Fetch.requestPaused'){const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);if(!allowed)evidence.external.push(u.origin);await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}
   if(m.method==='Page.javascriptDialogOpening'){
    const {type,message}=m.params,abnormal=type==='confirm'&&message.startsWith('是否將這筆關聯要事');
    const expected=abnormal||type==='beforeunload'||(type==='prompt'&&message==='請選擇完成日期（YYYY-MM-DD）')||(type==='confirm'&&/^(重新核對|確認保存本次結案|確定將此內控案件改為未結案|確定刪除此內控案件|確定刪除待辦|同步最新會保留本機修改)/.test(message))||(type==='alert'&&/^(tracking-stale-source|跟蹤保存結果尚未確認|跟蹤保存｜internal-control:|此項目正在由|請務必在FLOW系統中申報)/.test(message));
    (evidence.dialogs??=[]).push({caseId:currentCase,actor:pages.find(p=>p.s===m.sessionId)?.actor,type,message});if(!expected)evidence.errors.push('Unexpected dialog: '+message);
    await call('Page.handleJavaScriptDialog',{accept:expected&&!abnormal,...(type==='prompt'?{promptText:'2026-09-26'}:{})},m.sessionId);
   }
   if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(qa.origin+'/rest/v1/rpc/')){const body=JSON.parse(m.params.request.postData||'{}'),row={caseId:currentCase,actor:pages.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:body.p_operation_id,payloadHash:sha(m.params.request.postData||''),actorId:body.p_actor_user_id,started:Date.now()};network.set(m.sessionId+':'+m.params.requestId,row);evidence.network.push(row);}
   const row=network.get(m.sessionId+':'+m.params?.requestId);
   if(m.method==='Network.responseReceived'&&row)row.httpStatus=m.params.response.status;
   if(m.method==='Network.loadingFinished'&&row){const raw=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId);const v=JSON.parse(raw.base64Encoded?Buffer.from(raw.body,'base64').toString():raw.body);Object.assign(row,{finished:Date.now(),result:v?.ok===false?v.code:v?.code||'SQL_OK',ok:v?.ok,revision:v?.revision,conflictKey:v?.conflict_key});}
  })().catch(e=>evidence.errors.push(e.message));
 });
 const baseline=await read(),legacy=(await native.observer.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows,formal=await qa.itinerarySnapshot();
 const a=await page('qa-owner'),b=await page('qa-operator');
 assert.notEqual(a.context,b.context);
 const checks=shipTracking?(await import('./ship-tracking-multiuser-checks.mjs')).shipTrackingChecks:editEntry?editEntryChecks:multiuserChecks;
 await checks({a,b,page,qa,native,read,source,until,check,blockNext,release,observeBlocking,evidence,sha,run});
 assert.deepEqual((await native.observer.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows,legacy,'legacy authority unchanged');assert.deepEqual(await qa.itinerarySnapshot(),formal,'formal itinerary unchanged');
 const end=await read();for(const key of ['users','vessels','settings','meetings','agendaReports'])assert.deepEqual(end.payload[key],baseline.payload[key],'unrelated '+key);
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.external,[]);assert.equal(git('rev-parse','HEAD'),evidence.head);assert.deepEqual(fingerprints(),evidence.inputs);evidence.status='PASS';
}catch(e){failure=e;evidence.status='FAIL';evidence.failure={caseId:currentCase,message:e.message,stack:e.stack};for(const p of pages){try{evidence['failureText-'+p.actor]=(await p.text()).slice(0,14000);await p.screen('failure');}catch{}}}
finally{
 release();qa?.setRecordFault(null);evidence.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});}}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);if(!failure)fs.rmSync(profile,{recursive:true,force:true});evidence.cleanup={httpStopped:true,chromeStopped:true,pgStopped:evidence.stopped,pgPortClosed:evidence.portClosed,ownedDataRemoved:evidence.ownedDataRemoved};}catch(e){failure??=e;evidence.cleanupError=e.message;evidence.status='FAIL';}
 save();console.log(JSON.stringify({status:evidence.status,run,cases:evidence.cases.map(c=>c.id),blocking:evidence.blocking,cleanup:evidence.cleanup,failure:evidence.failure},null,2));if(failure)process.exitCode=1;
}

import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations,installTrackingFieldRevision} from './tracking-browser-fixture.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'morning-save-browser-')),profile=path.join(run,'chrome');
const migration='supabase/migrations/20261008090000_tracking_unrelated_patch_fast_path.sql';
const evidence={label:'真實 UI＋測試資料；原 App＋本機原生 PostgreSQL，非正式環境',status:'RUNNING',cases:[],dialogs:[],errors:[],blockedExternal:[],productionContacted:false};
evidence.inputHashes=Object.fromEntries(['src/App.tsx','src/morningHistory.ts','src/cloud.ts',migration,'scripts/verify-daily-morning-save-browser.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs'].map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
let native,qa,browser,ws,sessionId,chromePort,failure,number=0,currentCase='setup',timeoutEnabled=false,injected=0;const pending=new Map();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(50);}throw Error('QA timeout: '+label);};
const call=(method,params={},s=sessionId)=>new Promise((resolve,reject)=>{const id=++number,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,...(s?{sessionId:s}:{})}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const text=()=>evaluate("document.body?.innerText||''");
const click=async label=>{const expr=`[...document.querySelectorAll('button')].find(n=>n.innerText.trim()===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled)`;await until(()=>evaluate(`Boolean(${expr})`),'enabled '+label);await evaluate(`(${expr}).focus()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});};
// Generated credentials belong ONLY to this owned synthetic fixture.
const fillPassword=async()=>{await evaluate("document.querySelector('input[type=password]').focus();document.querySelector('input[type=password]').select()");await call('Input.insertText',{text:qa.password});};
const screen=async name=>fs.writeFileSync(path.join(run,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
const check=async(caseId,fn)=>{currentCase=caseId;await fn();evidence.cases.push({caseId,layer:'original-UI-native-PG',status:'PASS'});};
const read=()=>qa.read();
const withoutReports=x=>{const n=structuredClone(x.payload);delete n.agendaReports;delete n.auditLogs;delete n.revision;delete n.updatedAt;return n;};
try{
 native=await createNativeRecordQa(run,evidence,{httpTransactions:true,beforeCommit:async({context})=>{
  if(!timeoutEnabled||context.rpc!=='apply_ship_dynamics_record_patch_v1')return;
  // Actual SQLSTATE 57014, propagated inside the bridge's SQL error channel.
  // The original writer has run, but its transaction must fully roll back.
  injected++;try{await native.a.query("set statement_timeout='50ms'");await native.a.query('select pg_sleep(0.15)');}finally{await native.a.query("set statement_timeout='8s'");}
 }});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,tracking:true,taskMember:true,hmr:false,databaseFactory:async()=>native.adapter});
 await installTrackingBrowserMigrations(qa.db);await installTrackingFieldRevision(qa.db);
 for(const f of ['supabase/migrations/20260929120000_tracking_delivery_close.sql','supabase/migrations/20260929180000_tracking_completion_close.sql',migration])await qa.db.exec(fs.readFileSync(f,'utf8'));
 assert.equal((await qa.db.query(fs.readFileSync('supabase/verification/tracking-unrelated-patch-readback.sql','utf8'))).rows[0].status,'PASS');
 // Nonempty tracking source admitted through the real existing shore workflow.
 const {runTrackingCommand}=await qa.loadModule('/src/tracking/trackingWorkflow.ts'),{buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const base=(await read()).payload,actor=base.users.find(r=>r.role==='owner'),next=runTrackingCommand(base,{type:'create',items:[{id:'ui-track',referenceNo:'QA-UI',kind:'engineering',requestType:'repair',vesselId:'qa-v1',description:'QA 原 UI 保存控制',applicationDate:'2026-09-01',urgency:'normal',progress:'保留原進度',expectedDate:'',deliveryStatus:'not-delivered'}]},{actorId:actor.id,at:new Date().toISOString(),operationId:'ui-fixture-create'});
 const lease=(await qa.db.query("select claim_ship_dynamics_edit_lock($1,'tracking:ui-track','qa-ui-seed','QA OWNER',75) r",[qa.workspace])).rows[0].r;assert.equal(lease.ok,true);
 const guard=(await qa.db.query('select ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(base),actor.id])).rows[0].r;
 const seeded=(await qa.db.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',[qa.workspace,randomUUID(),JSON.stringify(buildCloudBlockPatch(base,next)),'QA OWNER',actor.id,JSON.stringify(guard),null,JSON.stringify([{section_key:'tracking:ui-track',locked_by:lease.locked_by,lease_version:lease.lease_version}])])).rows[0].r;assert.equal(seeded.ok,true,JSON.stringify(seeded));
 await qa.db.query("delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by='qa-ui-seed'",[qa.workspace]);
 assert.equal((await fetch(qa.origin+'/__qa/health')).status,200);
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(chrome));
 browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socket;await until(()=>{try{[chromePort,socket]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socket?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'owned Chrome readiness');
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socket}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){
    const {type,message}=m.params;evidence.dialogs.push({caseId:currentCase,type,message});
    const expected=type==='beforeunload'||type==='alert'&&(message==='今日早會快照已完成保存。'||currentCase==='MSB02-controlled-57014-no-false-success'&&message.startsWith('每日早會快照未保存：')&&message.includes('57014'))||type==='confirm'&&message.startsWith('同步最新會保留本機修改');
    if(!expected)evidence.errors.push('Unexpected dialog: '+message);await call('Page.handleJavaScriptDialog',{accept:expected},m.sessionId);
   }
   if(m.method==='Fetch.requestPaused'){
    const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);if(!allowed)evidence.blockedExternal.push(u.origin);
    await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);
   }
  };void handle().catch(e=>evidence.errors.push(e.message));
 });
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 for(const m of ['Page.enable','Runtime.enable','Network.enable'])await call(m);
 await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:qa.origin});
 await until(async()=>(await text()).includes('請輸入管理者設定的進站密碼。'),'site gate');await fillPassword();await click('進入系統');
 await until(async()=>(await text()).includes('人員登入／切換'),'personnel login');await fillPassword();await click('登入');
 await until(async()=>(await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'original Owner');await click('報告中心');
 await until(()=>evaluate("Boolean(document.querySelector('.morning-daily-history-panel'))"),'original report center');
 const before=await read();let saved,failedIntent;let captured=null;
 qa.setRecordFault({before:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1')captured=structuredClone(body.p_operations.find(o=>o.kind==='entity'&&o.collection==='agendaReports')?.value);}});
 await check('MSB01-original-manual-save-exact-SQL-readback',async()=>{
  await click('手動保存今日早會');await until(()=>evidence.dialogs.some(d=>d.caseId===currentCase&&d.message==='今日早會快照已完成保存。'),'original save completion');assert.ok(captured);
  saved=await read();assert.equal(saved.revision,before.revision+1);assert.deepEqual(saved.payload.agendaReports.find(r=>r.id===captured.id),captured);assert.deepEqual(withoutReports(saved),withoutReports(before));assert.equal(saved.payload.trackingItems.length,1);await screen('manual-save-confirmed');
 });
 timeoutEnabled=true;qa.setRecordFault({before:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1')failedIntent=structuredClone(body.p_operations.find(o=>o.kind==='entity'&&o.collection==='agendaReports')?.value);}});
 await check('MSB02-controlled-57014-no-false-success',async()=>{
  await click('手動保存今日早會');await until(()=>evidence.dialogs.some(d=>d.caseId===currentCase&&d.message.startsWith('每日早會快照未保存：')),'structured timeout alert');
  const dialogs=evidence.dialogs.filter(d=>d.caseId===currentCase);assert.ok(injected>0);assert.ok(failedIntent);assert.ok(dialogs.some(d=>/57014/.test(d.message)&&/statement timeout/.test(d.message)));assert.ok(dialogs.every(d=>!d.message.includes('[object Object]')&&d.message!=='今日早會快照已完成保存。'));assert.deepEqual(await read(),saved);await screen('timeout-retained');
 });
 timeoutEnabled=false;qa.setRecordFault(null);
 await check('MSB03-original-manual-retry-exact-intent-one-revision',async()=>{
  await click('重新保存');await until(async()=>{const x=await read();return x.revision===saved.revision+1;},'retry committed');await until(()=>evaluate("Boolean(document.querySelector('.save-status-strip.saved'))"),'retry visible saved');
  const after=await read();assert.deepEqual(after.payload.agendaReports.find(r=>r.id===failedIntent.id),failedIntent);assert.equal(after.payload.agendaReports.length,1);assert.deepEqual(withoutReports(after),withoutReports(saved));saved=after;await screen('retry-confirmed');
 });
 await check('MSB04-new-document-history-retains-authoritative-report',async()=>{
  await call('Page.reload');await until(async()=>(await text()).includes('QA OWNER'),'reload identity');if(!await evaluate("Boolean(document.querySelector('.morning-daily-history-panel'))"))await click('報告中心');
  await until(async()=>(await text()).includes(failedIntent.businessDate),'reload history date');await click('檢視當日快照');await until(()=>evaluate("Boolean(document.querySelector('#report-preview-title'))"),'saved preview');assert.ok((await text()).includes('QA VESSEL 1'));await screen('reloaded-history');await click('關閉');assert.deepEqual(await read(),saved);
 });
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);evidence.status='PASS';
}catch(e){failure=e;evidence.status='FAIL';evidence.failure={caseId:currentCase,message:e.message,stack:e.stack};try{evidence.failureText=(await text()).slice(0,8000);await screen('failure');}catch{}}
finally{
 timeoutEnabled=false;qa?.setRecordFault(null);
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome closed',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome stopped',5000);}}
 try{await qa?.close();await native?.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort){const closed=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:Number(chromePort)});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});assert.equal(closed,true);}evidence.cleanup={httpStopped:true,chromeStopped:!browser||browser.exitCode!==null||browser.signalCode!==null,chromePortClosed:true,pgStopped:evidence.stopped,pgPortClosed:evidence.portClosed};}catch(e){failure??=e;evidence.cleanupError=e.message;evidence.status='FAIL';}
 fs.writeFileSync(path.join(run,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,run,cases:evidence.cases,cleanup:evidence.cleanup,failure:evidence.failure}));if(failure)process.exitCode=1;
}

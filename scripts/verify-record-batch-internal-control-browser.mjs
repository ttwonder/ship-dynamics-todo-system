import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-batch-internal-control-browser-'));
const profile=path.join(output,'chrome-profile');
const tracer=process.argv.includes('--tracer-only');
let declineConfirmation=false;
let expectBatchRejection=false;
let qa,browser,ws,failure=null,sessionId,releaseHeldReceipt,expectDeleteRejection=false;
const pending=new Map(),evidence={label:'真實 UI＋測試資料；本機 PGlite，非 hosted Supabase',scenarios:[],errors:[],blockedExternal:[],metrics:[]};
let id=0;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(test,label,timeout=25_000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(100);}throw new Error(`QA timeout: ${label}`);};
const call=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{
 const number=++id;const timer=setTimeout(()=>{pending.delete(number);reject(new Error(`CDP timeout ${method}`));},15_000);
 pending.set(number,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
 ws.send(JSON.stringify({id:number,method,params,...(session?{sessionId:session}:{})}));
});
const evaluate=async(expression)=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
const click=async(text,index=0,expected=1)=>{
 // Native keyboard activation avoids scroll-driven coordinate drift. No handler calls.
 await evaluate(`(()=>{const nodes=[...document.querySelectorAll('button')].filter(n=>n.innerText.trim()===${JSON.stringify(text)}&&n.getClientRects().length&&!n.disabled);if(nodes.length!==${expected})throw new Error('button cardinality: '+nodes.length);nodes[${index}].focus();if(document.activeElement!==nodes[${index}])throw new Error('button focus precondition');})()`);
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
};
const fill=async(selector,text)=>{
 await evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(n=>n.getClientRects().length);if(nodes.length!==1)throw new Error('input cardinality: '+nodes.length);nodes[0].focus();nodes[0].select();})()`);
 await call('Input.insertText',{text});
};
const text=()=>evaluate("document.body?.innerText||''");

const nodeClick=async(expression)=>{
 const pos=await evaluate(`(()=>{const n=${expression};if(!n||!n.getClientRects().length||n.disabled)throw new Error('UI target unavailable: '+${JSON.stringify(expression)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});
};
const field=(label,tag,scope='.modal')=>`[...document.querySelectorAll(${JSON.stringify(scope+' .field')})].find(n=>n.querySelector('label')?.innerText.trim()===${JSON.stringify(label)})?.querySelector(${JSON.stringify(tag)})`;
const key=async(key,code=key)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code});};
const select=async(expression,value)=>{
 const index=await evaluate(`(()=>{const n=${expression};if(!n||n.disabled)throw new Error('select unavailable');n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(index>=0,'option '+value);
 await key('Home');for(let i=0;i<index;i++)await key('ArrowDown');await key('Enter');
 await until(async()=>await evaluate(`(${expression}).value`)===value,'selected '+value);
};
const labelInput=(label,scope='.modal')=>`[...document.querySelectorAll(${JSON.stringify(scope+' label')})].find(n=>n.innerText.trim()===${JSON.stringify(label)})?.querySelector('input')`;
const fillNode=async(expression,value)=>{
 await evaluate(`(()=>{const n=${expression};if(!n||n.disabled)throw new Error('field unavailable');n.focus();n.select();})()`);await call('Input.insertText',{text:value});
};
const snapshot=async(name)=>{const data=await qa.read();fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(data,null,2));return data;};
const screen=async(name)=>{const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(image.data,'base64'));};
const finishEditor=async()=>until(async()=>!await evaluate("Boolean(document.querySelector('.modal-backdrop'))")&&!(await text()).includes('你正在編輯：')&&(await text()).includes('已安全保存')&&(await leases()).length===0,'editor closed and lease handoff finished after ACK');
const check=async(name,run)=>{await run();assert.ok(!evidence.scenarios.includes(name));evidence.scenarios.push(name);console.log('PASS',name);};
const caseRow=label=>`[...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.querySelector('.ic-description-column')?.innerText.trim()===${JSON.stringify(label)})`;
const openCase=async(label,action='更新')=>{await nodeClick(`[...(${caseRow(label)}).querySelectorAll('button')].find(n=>n.innerText.trim()===${JSON.stringify(action)})`);await until(async()=>await evaluate("Boolean(document.querySelector('.modal-backdrop'))"),'original '+action+' editor');};
const tab=async(prefix)=>{await nodeClick(`[...document.querySelectorAll('.ic-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(prefix)}))`);};
const fillRich=async(label,value)=>{await nodeClick(`document.querySelector('[contenteditable="true"][aria-label="${label}"]')`);await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await call('Input.insertText',{text:value});assert.equal(await evaluate(`document.querySelector('[contenteditable="true"][aria-label="${label}"]').innerText`),value,'native rich text replacement precondition');};
const leases=async()=> (await qa.db.query("select section_key,locked_by from ship_dynamics_edit_locks where workspace_key='isolated-record-ui-qa' and expires_at>now() order by section_key")).rows;

try{
 qa=await createRecordStorageLocalQa({internalControl:true});
 assert.equal((await fetch(`${qa.origin}/__qa/health`)).status,200);
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(chrome));
 browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let port,socketPath;
 await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch(error){if(['ENOENT','EBUSY','EPERM'].includes(error.code))return false;throw error;}},'Chrome readable handshake');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.method==='Debugger.paused'){(evidence.caughtExceptions??=[]).push(message.params.data?.description||message.params.reason);void call('Debugger.resume',{},message.sessionId);}
  if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);return;}
  if(message.method==='Runtime.exceptionThrown')evidence.errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  if(message.method==='Page.javascriptDialogOpening'){
   (evidence.dialogs??=[]).push({type:message.params.type,message:message.params.message});
   const abnormal=message.params.type==='confirm'&&message.params.message.startsWith('是否將這筆關聯要事');
   const rejected=expectBatchRejection&&message.params.type==='alert'&&message.params.message.startsWith('批量刪除未完成：');
   if(rejected)evidence.batchRejection=message.params.message;
   const expected=rejected||(message.params.type==='beforeunload'&&evidence.rejectedBatch?.selectionRetained===true)||abnormal||(message.params.type==='confirm'&&/^(確定批量完成所選|確定批量刪除所選|同步最新會保留本機修改)/.test(message.params.message));
   if(!expected)evidence.errors.push('Unexpected QA dialog: '+message.params.message);
   void call('Page.handleJavaScriptDialog',{accept:expected&&!abnormal&&!declineConfirmation},message.sessionId).catch(error=>evidence.errors.push(error.message));
  }
  if(message.method==='Network.requestWillBeSent'){const url=message.params.request.url;if(/^https?:/.test(url)&&!url.startsWith(qa.origin+'/'))evidence.blockedExternal.push(new URL(url).origin);}
 });
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);
 ({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
 if(process.env.QA_BATCH_DEBUG==='1'){await call('Debugger.enable');await call('Debugger.setPauseOnExceptions',{state:'all'});}
 await call('Network.setBlockedURLs',{urls:['https://*','http://*.supabase.co/*','http://*.supabase.in/*']});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

 // Exercise the native CDP keyboard precondition away from the App.
 await evaluate("document.body.innerHTML='<button id=probe>QA native activation</button>';document.querySelector('#probe').onclick=()=>document.body.dataset.qaClicked='yes'");
 await click('QA native activation');assert.equal(await evaluate('document.body.dataset.qaClicked'),'yes');
 await call('Page.navigate',{url:qa.origin});
 await until(async()=> (await text()).includes('請輸入管理者設定的進站密碼。'),'site gate');await fill('input[type="password"]',qa.password);await click('進入系統');
 await until(async()=> (await text()).includes('人員登入／切換'),'personnel login');await fill('input[type="password"]',qa.password);await click('登入');
 await until(async()=> (await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'Owner homepage');

 const baseline=await snapshot('fixture-baseline');
 const legacyBefore=(await qa.db.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows;
 await click('內控異常');await until(async()=>(await text()).includes('QA withdraw'),'record internal control list');

 const createBatch=async(vessel,tag)=>{
  await click('＋ 批量新增');await until(async()=>(await text()).includes('批量新增內控異常'),'original batch modal');
  await select(field('船舶 *','select'),vessel);await click('＋ 新增一筆');
  for(let i=1;i<=2;i++){
   const scope='.ic-batch-row:nth-child('+i+')';
   await select(field('事件分類 *','select',scope),'維修');
   await fillNode(field('事項內容 *','textarea',scope),tag+' '+i);
   await fillNode(field('解決計劃／最新狀態 *','textarea',scope),'PLAN '+tag+' '+i);
   await nodeClick(labelInput('督導',scope+' > .ic-choice-picker'));
   if(i===1)await nodeClick(labelInput('同步到要事',scope));
  }
 };
 await check('original login and two-row batch tracer: synced and independent cases in one SQL operation',async()=>{
  const before=await qa.read();await createBatch('qa-v1','QA BATCH A');await screen('batch-create-draft');await click('保存 2 筆案件');await finishEditor();
  const saved=await snapshot('batch-tracer-saved'),created=saved.payload.internalControlCases.filter(c=>c.description.startsWith('QA BATCH A '));
  assert.equal(created.length,2);assert.equal(saved.revision,before.revision+1);assert.equal(saved.payload.auditLogs.length,before.payload.auditLogs.length+1);
  for(const c of created){const tasks=saved.payload.tasks.filter(t=>t.internalControlCaseId===c.id);assert.equal(tasks.length,c.syncToTask?1:0);if(c.syncToTask){assert.equal(tasks[0].id,c.linkedTaskId);assert.equal(tasks[0].isInternalControl,true);assert.equal(tasks[0].isAbnormal,false);assert.equal(tasks[0].status,c.status);}}
  assert.deepEqual(saved.payload.notifications,before.payload.notifications);assert.deepEqual(await leases(),[]);await screen('batch-tracer-confirmed');
 });
 if(!tracer){
 const selectCases=async(labels)=>{for(const label of labels)await nodeClick(`(${caseRow(label)}).querySelector('input[type="checkbox"]')`);await until(async()=>await evaluate("document.querySelector('.batch-selection-count')?.innerText")==='已選 '+labels.length,'selection cardinality');};
 const selectedCount=()=>evaluate("document.querySelector('.batch-selection-count')?.innerText");
 const finishBatch=async()=>until(async()=>(await text()).includes('已安全保存')&&(await leases()).length===0&&!await evaluate("[...document.querySelectorAll('button')].some(n=>['結案中…','刪除中…'].includes(n.innerText.trim()))"),'batch ACK and complete release');
 await check('second vessel two-row batch lost ACK retains exact draft until same-envelope committed status',async()=>{
  await createBatch('qa-v2','QA BATCH B');
  await evaluate(`void(window.__qaBatchNode=(${field('事項內容 *','textarea','.ic-batch-row:nth-child(1)')}))`);
  let dropped=false,lookup=false,submitted;const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});const start=qa.metrics.length,before=await qa.read();
  qa.setRecordFault({before:async({name,body})=>{if(name==='get_ship_dynamics_record_receipt_v1'&&dropped){lookup=true;assert.deepEqual(body,submitted);await held;}},after:async({name,body,value})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!dropped){assert.equal(value.ok,true);dropped=true;submitted=structuredClone(body);return true;}return false;}});
  await click('保存 2 筆案件');await until(()=>lookup,'batch create same operation status');
  assert.equal(await evaluate(`window.__qaBatchNode===(${field('事項內容 *','textarea','.ic-batch-row:nth-child(1)')})`),true);assert.equal(await evaluate('window.__qaBatchNode.value'),'QA BATCH B 1');
  assert.equal((await qa.read()).revision,before.revision+1);assert.ok((await leases()).length>0);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);await screen('batch-create-lost-ack');
  releaseHeldReceipt();releaseHeldReceipt=null;await finishEditor();qa.setRecordFault(null);
  const events=qa.metrics.slice(start);assert.equal(events.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status==='SQL_OK').length,1);assert.equal(new Set(events.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').map(m=>m.operationId)).size,1);const status=events.findIndex(m=>m.rpc==='get_ship_dynamics_record_receipt_v1'&&m.status==='SQL_OK');assert.ok(status>=0);assert.ok(events.findIndex(m=>m.rpc==='release_ship_dynamics_edit_lock')>status);await snapshot('batch-create-recovered');
 });
 const labels=['QA BATCH A 1','QA BATCH A 2','QA BATCH B 1','QA withdraw'];
 await check('original create cancel and declined close/delete preserve selection with zero patch or lease',async()=>{
  const before=await qa.read(),start=qa.metrics.length;await createBatch('qa-v1','QA CANCEL');await click('取消');await until(async()=>!await evaluate("Boolean(document.querySelector('.modal-backdrop'))"),'batch cancelled');
  await selectCases(labels);declineConfirmation=true;await click('批量結案（4）');await until(async()=>(await text()).includes('批量結案（4）'),'declined close settles');await click('批量刪除（4）');await until(async()=>(await text()).includes('批量刪除（4）'),'declined delete settles');declineConfirmation=false;
  assert.equal(await selectedCount(),'已選 4');assert.deepEqual(await qa.read(),before);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,0);assert.deepEqual(await leases(),[]);
 });
 await check('multi-vessel batch close lost ACK retains selection then closes both ends only after confirmation',async()=>{
  let dropped=false,lookup=false,submitted;const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});const start=qa.metrics.length,before=await qa.read();
  qa.setRecordFault({before:async({name,body})=>{if(name==='get_ship_dynamics_record_receipt_v1'&&dropped){lookup=true;assert.deepEqual(body,submitted);await held;}},after:async({name,body,value})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!dropped){assert.equal(value.ok,true);dropped=true;submitted=structuredClone(body);return true;}return false;}});
  await click('批量結案（4）');await until(()=>lookup,'batch close same operation status');
  assert.equal(await selectedCount(),'已選 4','unconfirmed batch must not clear the original selection');
  assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);await screen('batch-close-lost-ack');
  const committed=await snapshot('batch-close-committed-before-status');assert.equal(committed.revision,before.revision+1);
  releaseHeldReceipt();releaseHeldReceipt=null;await finishBatch();qa.setRecordFault(null);
  assert.equal(await selectedCount(),'已選 0');const saved=await snapshot('batch-close-confirmed');
  for(const c of saved.payload.internalControlCases.filter(c=>labels.includes(c.description))){assert.equal(c.isClosed,true);assert.equal(c.closedBy,'qa-owner');assert.ok(c.closedDate);const previous=before.payload.internalControlCases.find(i=>i.id===c.id);assert.deepEqual(c.statusLogs,previous.statusLogs);assert.equal(c.status,previous.status);if(c.linkedTaskId){const t=saved.payload.tasks.find(t=>t.id===c.linkedTaskId);assert.equal(t.isClosed,true);assert.equal(t.closedDate,c.closedDate);assert.equal(t.closedBy,c.closedBy);}}
  assert.equal(saved.payload.auditLogs.length,before.payload.auditLogs.length+labels.length);assert.deepEqual(saved.payload.notifications,before.payload.notifications);
 });
 await check('closed-list batch deletion removes selected roots and links while preserving original notice/dismissal semantics',async()=>{
  await tab('內控結案清單');await until(async()=>await evaluate(`Boolean(${caseRow('QA BATCH A 1')})`),'confirmed closed rows');await selectCases(labels);
  let submitted=false;const held=new Promise(resolve=>{releaseHeldReceipt=resolve;}),before=await snapshot('before-batch-delete'),start=qa.metrics.length;
  const targets=before.payload.internalControlCases.filter(c=>labels.includes(c.description)),taskIds=targets.map(c=>c.linkedTaskId).filter(Boolean);
  qa.setRecordFault({before:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){submitted=true;await held;}}});
  await click('批量刪除（4）');await until(()=>submitted,'batch delete held before real SQL');assert.equal(await selectedCount(),'已選 4');assert.deepEqual(await qa.read(),before);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);await screen('batch-delete-pending');
  releaseHeldReceipt();releaseHeldReceipt=null;await finishBatch();qa.setRecordFault(null);assert.equal(await selectedCount(),'已選 0');
  const saved=await snapshot('batch-deleted');assert.equal(saved.revision,before.revision+1);assert.deepEqual(saved.payload.internalControlCases,before.payload.internalControlCases.filter(c=>!targets.some(t=>t.id===c.id)));assert.deepEqual(saved.payload.tasks,before.payload.tasks.filter(t=>!taskIds.includes(t.id)));assert.deepEqual(saved.payload.notifications,before.payload.notifications,'original delete helper retains historical notices, unlike withdrawal');assert.deepEqual(saved.payload.taskDismissals,before.payload.taskDismissals,'original case deletion retains dismissals, unlike withdrawal');assert.equal(saved.payload.auditLogs.length,before.payload.auditLogs.length+4);
  assert.ok(before.payload.taskDismissals.some(d=>taskIds.includes(d.itemId)),'non-vacuous retained dismissal');assert.ok(before.payload.notifications.some(n=>taskIds.includes(n.taskId)),'non-vacuous retained notification');
 });
 await check('record operator can batch create and close assigned cases; foreign scope and batch delete remain unavailable',async()=>{
  await click('切換/退出');await until(async()=>(await text()).includes('人員登入／切換'),'operator login');await select(`document.querySelector('[aria-label="登入人員"]')`,'qa-operator');await fill('input[type="password"]',qa.password);await click('登入');await until(async()=>(await text()).includes('QA OPERATOR｜操作員'),'operator identity');await click('內控異常');await until(async()=>(await text()).includes('QA case-delete'),'assigned list');await wait(1600);await until(async()=>(await text()).includes('已安全保存'),'operator read receipts settled');
  const before=await qa.read(),start=qa.metrics.length;assert.ok(!(await text()).includes('QA restricted'));assert.ok(!(await text()).includes('QA VESSEL 2'));assert.equal(await evaluate("[...document.querySelectorAll('.ic-batch-toolbar button')].filter(n=>n.innerText.includes('批量刪除')).length"),0);
  await createBatch('qa-v1','QA OPERATOR BATCH');assert.deepEqual(await evaluate(`[...(${field('船舶 *','select')}).options].map(o=>o.value)`),['qa-v1']);await click('取消');await until(async()=>!await evaluate("Boolean(document.querySelector('.modal-backdrop'))"),'operator cancel');assert.deepEqual(await qa.read(),before);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,0);
  await createBatch('qa-v1','QA OPERATOR BATCH');await click('保存 2 筆案件');await finishEditor();await selectCases(['QA OPERATOR BATCH 1','QA OPERATOR BATCH 2']);await click('批量結案（2）');await finishBatch();
  const saved=await snapshot('operator-batch-closed'),created=saved.payload.internalControlCases.filter(c=>c.description.startsWith('QA OPERATOR BATCH'));assert.equal(created.length,2);for(const c of created){assert.equal(c.createdBy,'qa-operator');assert.equal(c.closedBy,'qa-operator');assert.equal(c.isClosed,true);if(c.linkedTaskId)assert.equal(saved.payload.tasks.find(t=>t.id===c.linkedTaskId).isClosed,true);}await screen('operator-batch');
 });
 await check('fresh document reload and debounce readback preserve unselected records and formal/history/legacy authority',async()=>{
  const saved=await snapshot('before-reload'),start=qa.metrics.length;await wait(1800);assert.equal((await qa.read()).revision,saved.revision);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,0);
  await evaluate('window.__qaOldDocument=true');await call('Page.reload');await until(async()=>await evaluate('!window.__qaOldDocument&&document.readyState==="complete"')&&(await text()).includes('QA OPERATOR｜操作員'),'new document identity');await click('內控異常');await until(async()=>(await text()).includes('QA case-delete'),'reloaded list');await tab('內控結案清單');await until(async()=>await evaluate(`Boolean(${caseRow('QA OPERATOR BATCH 1')})`),'reloaded closed batch');
  assert.deepEqual(await qa.read(),saved);for(const collection of ['users','vessels','meetings','agendaReports'])assert.deepEqual(saved.payload[collection],baseline.payload[collection]);for(const id of ['qa-case-delete','qa-task-delete','qa-restricted'])assert.deepEqual(saved.payload.internalControlCases.find(c=>c.id===id),baseline.payload.internalControlCases.find(c=>c.id===id));for(const task of baseline.payload.tasks.filter(t=>t.internalControlCaseId!=='qa-withdraw'))assert.deepEqual(saved.payload.tasks.find(t=>t.id===task.id),task);assert.deepEqual(await qa.itinerarySnapshot(),qa.itineraryBaseline);assert.deepEqual((await qa.db.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows,legacyBefore);
  evidence.readback={unselectedRecordsUnchanged:true,formalAndHistoryUnchanged:true,legacyUnchanged:true,noTrailingPatch:true};
 });
 await check('one exact linked lease expiry rejects the whole original batch delete and retains selection after callback',async()=>{
  await click('切換/退出');await until(async()=>(await text()).includes('人員登入／切換'),'Owner terminal branch login');await select(`document.querySelector('[aria-label="登入人員"]')`,'qa-owner');await fill('input[type="password"]',qa.password);await click('登入');await until(async()=>(await text()).includes('QA OWNER｜Owner'),'Owner terminal identity');await click('內控異常');await until(async()=>await evaluate(`Boolean(${caseRow('QA BATCH B 2')})`),'terminal open list');await until(async()=>(await text()).includes('已安全保存'),'settled Owner');
  await selectCases(['QA case-delete','QA BATCH B 2']);const before=await snapshot('before-rejected-batch'),start=qa.metrics.length;
  const storage=async()=>{const result={};for(const {tablename} of (await qa.db.query("select tablename from pg_tables where schemaname='public' and tablename like 'ship_dynamics_record_%' order by tablename")).rows){assert.match(tablename,/^(ship_dynamics_records|ship_dynamics_record_[a-z_]+)$/);result[tablename]=(await qa.db.query(`select to_jsonb(t) value from ${tablename} t order by to_jsonb(t)::text`)).rows;}assert.ok(Object.keys(result).length>=5);return result;};const storageBefore=await storage();let injected=false;
  qa.setRecordFault({before:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!injected){injected=true;const linked=before.payload.internalControlCases.find(c=>c.id==='qa-case-delete').linkedTaskId;const guard=body.p_lock_guards.find(g=>g.section_key==='task:'+linked);assert.ok(guard);await qa.db.query("update ship_dynamics_edit_locks set expires_at=now()-interval '1 second' where workspace_key='isolated-record-ui-qa' and section_key=$1 and locked_by=$2",[guard.section_key,guard.locked_by]);}}});
  expectBatchRejection=true;await click('批量刪除（2）');await until(()=>evidence.batchRejection,'actual SQL rejection reaches original alert');await until(async()=>(await text()).includes('批量刪除（2）'),'rejected callback settled');await wait(1100);assert.equal(await selectedCount(),'已選 2');assert.deepEqual(await qa.read(),before);assert.deepEqual(await storage(),storageBefore,'no partial record/order/history/revision/receipt commit');assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);assert.ok(qa.metrics.slice(start).some(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status==='lock-conflict'));assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,1);
  evidence.rejectedBatch={selectionRetained:true,storageUnchanged:true,releaseBeforeDisposition:0};await snapshot('rejected-batch');await screen('rejected-batch-selection');qa.setRecordFault(null);expectBatchRejection=false;
 });
 await call('Page.navigate',{url:qa.origin+'/__qa/blank'});await until(()=>evaluate("location.pathname==='/__qa/blank'&&document.readyState==='complete'"),'isolated mounted page');
 await evaluate("import('/@react-refresh').then(({default:r})=>{r.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;})");
 evidence.mounted=await evaluate(`import('/scripts/record-batch-internal-control-lifecycle-probe.mjs').then(m=>m.run(${JSON.stringify(baseline.payload)}))`);
 }
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>m.status==='UNSUPPORTED'));
 console.log(JSON.stringify({qa:tracer?'RECORD_BATCH_TRACER_PASS':'RECORD_BATCH_BROWSER_PASS',output,scenarios:evidence.scenarios}));
}catch(error){failure=error;try{evidence.failureText=await text();await snapshot('failure-readback');await screen('failure');}catch{};evidence.error=error.message;console.error(JSON.stringify({qa:'FAILED',error:error.message,output,body:evidence.failureText?.slice(0,9000)}));}
finally{
 releaseHeldReceipt?.();
 evidence.metrics=qa?.metrics||[];
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome closed',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome tree stopped',5000);}}
 try{if(qa)await qa.close();}catch(error){failure??=error;}
 if(!failure){try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
 try{if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);evidence.cleanup={httpStopped:true,chromeStopped:true,ownedChromePid:browser?.pid};}catch(error){failure??=error;evidence.cleanup={error:error.message};}
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(failure)process.exitCode=1;
}

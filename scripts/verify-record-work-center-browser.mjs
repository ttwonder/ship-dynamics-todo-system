import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {seedWorkCenter} from './record-work-center-local-fixture.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-work-center-browser-'));
const profile=path.join(output,'chrome-profile');
const tracer=process.argv.includes('--tracer-only');
const deleteProbe=process.argv.includes('--reject-delete');
const rejectProbe=deleteProbe||process.argv.includes('--reject-complete');
let declineConfirmation=false;
let expectClosedCaseGuard=false;
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
 await seedWorkCenter(qa);
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
   const rejected=expectBatchRejection&&message.params.type==='alert'&&/^批量(完成|刪除)未完成：/.test(message.params.message);
   if(rejected)evidence.batchRejection=message.params.message;
   const closedCaseGuard=expectClosedCaseGuard&&message.params.type==='alert'&&message.params.message==='已結案內控案件必須先單獨重新開啟，才可刪除關聯要事';
   if(closedCaseGuard)evidence.closedCaseGuardObserved=true;
   const expected=closedCaseGuard||rejected||(message.params.type==='beforeunload'&&evidence.rejectedBatch?.selectionRetained===true)||abnormal||(message.params.type==='confirm'&&/^(確定從你的|確定永久刪除共用待辦|確定批量完成所選|確定批量刪除所選|確定放棄本次|同步最新會保留本機修改)/.test(message.params.message));
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
 const row=label=>`[...document.querySelectorAll('.work-task-row')].find(n=>n.querySelector('.task-link')?.innerText.trim()===${JSON.stringify(label)})`;
 const count=()=>evaluate("document.querySelector('.work-center .batch-selection-count')?.innerText");
 const selectRows=async labels=>{for(const label of labels)await nodeClick(`(${row(label)}).querySelector('input[type=checkbox]')`);await until(async()=>await count()==='已選 '+labels.length,'WorkCenter selected count');};
 const settled=async()=>until(async()=>(await text()).includes('已安全保存')&&(await leases()).length===0,'WorkCenter ACK and release');
 await nodeClick("[...document.querySelectorAll('nav button')].find(n=>n.innerText.startsWith('我的待辦'))");await until(()=>evaluate(`Boolean(${row('QA PERSONAL TASK')})`),'original WorkCenter');
 await check('personal dismissal native UI held receipt retains shared rows and own selection until ACK',async()=>{
  await selectRows(['QA PERSONAL TASK','QA PERSONAL CASE']);const before=await qa.read(),start=qa.metrics.length;
  declineConfirmation=true;await click('從我的待辦移除（2）');await until(()=>(evidence.dialogs||[]).some(d=>d.message.startsWith('確定從你的')),'declined confirmation');await wait(100);declineConfirmation=false;assert.equal(await count(),'已選 2');assert.deepEqual(await qa.read(),before);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,0);
  let dropped=false,lookup=false,submitted;const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});
  qa.setRecordFault({before:async({name,body})=>{if(name==='get_ship_dynamics_record_receipt_v1'&&dropped){lookup=true;assert.deepEqual(body,submitted);await held;}},after:async({name,body,value})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!dropped){assert.equal(value.ok,true);dropped=true;submitted=structuredClone(body);return true;}return false;}});
  await click('從我的待辦移除（2）');await until(()=>lookup,'personal same operation receipt');
  const committed=await snapshot('personal-committed-held');assert.equal(committed.revision,before.revision+1);assert.equal(await count(),'已選 2');assert.ok(await evaluate(`Boolean(${row('QA PERSONAL TASK')})&&Boolean(${row('QA PERSONAL CASE')})`));
  for(const c of ['tasks','internalControlCases','meetings','vessels','users','notifications'])assert.deepEqual(committed.payload[c],before.payload[c],c+' preserved');
  assert.equal(committed.payload.taskDismissals.length,before.payload.taskDismissals.length+2);for(const d of before.payload.taskDismissals)assert.deepEqual(committed.payload.taskDismissals.find(n=>n.id===d.id),d);
  assert.equal(qa.metrics.slice(start).filter(m=>m.rpc.includes('edit_lock')).length,0,'personal hide requires no shared lease');
  await screen('personal-held');releaseHeldReceipt();releaseHeldReceipt=null;await settled();qa.setRecordFault(null);await until(async()=>await count()==='已選 0'&&!await evaluate(`Boolean(${row('QA PERSONAL TASK')})`),'personal ACK projection');await wait(1500);assert.deepEqual(await qa.read(),committed);
  await evaluate('window.__qaOldDocument=true');await call('Page.reload');await until(async()=>await evaluate('!window.__qaOldDocument&&document.readyState==="complete"')&&(await text()).includes('QA OWNER｜Owner'),'fresh owner');await nodeClick("[...document.querySelectorAll('nav button')].find(n=>n.innerText.startsWith('我的待辦'))");await until(()=>evaluate('Boolean(document.querySelector(".work-center"))'),'fresh work center');assert.ok(!await evaluate(`Boolean(${row('QA PERSONAL TASK')})||Boolean(${row('QA PERSONAL CASE')})`));
 });
 if(!tracer){

 await check('other responsible original login still sees personal-dismissed shared items and foreign scope stays excluded',async()=>{
  const before=await qa.read(),start=qa.metrics.length;
  await click('切換/退出');await until(async()=>(await text()).includes('人員登入／切換'),'operator switch');await select(`document.querySelector('[aria-label="登入人員"]')`,'qa-operator');await fill('input[type="password"]',qa.password);await click('登入');await until(async()=>(await text()).includes('QA OPERATOR｜操作員'),'operator identity');
  await nodeClick("[...document.querySelectorAll('nav button')].find(n=>n.innerText.startsWith('我的待辦'))");await until(()=>evaluate(`Boolean(${row('QA PERSONAL TASK')})&&Boolean(${row('QA PERSONAL CASE')})`),'other responsible list');
  assert.ok(!await evaluate(`Boolean(${row('QA UNRELATED TASK')})`));assert.equal(await evaluate("[...document.querySelectorAll('.work-center button')].filter(n=>n.innerText.startsWith('永久刪除共用待辦')).length"),0);await wait(1100);assert.deepEqual(await qa.read(),before);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,0);
  await click('切換/退出');await until(async()=>(await text()).includes('人員登入／切換'),'owner return');await select(`document.querySelector('[aria-label="登入人員"]')`,'qa-owner');await fill('input[type="password"]',qa.password);await click('登入');await until(async()=>(await text()).includes('QA OWNER｜Owner'),'owner return identity');
 });
 await click('臨會/專題');await until(async()=>(await text()).includes('QA UNRELATED MEETING'),'original meeting route');
 const meetingIdle=async()=>until(async()=>await evaluate("document.querySelector('.temporary-form')?.getAttribute('aria-readonly')==='true'&&!document.querySelector('.modal-backdrop')&&[...document.querySelectorAll('.temporary-editor-column button')].some(n=>n.innerText==='取得編輯權'&&!n.disabled)")&&(await text()).includes('已安全保存')&&(await leases()).length===0,'meeting ACK and lease handoff');
 const editMeeting=async()=>{await click('取得編輯權');await until(()=>evaluate("document.querySelector('.temporary-form')?.getAttribute('aria-readonly')==='false'"),'meeting writable');};
 const choosePerson=async(label)=>{
  const summary=`document.querySelector('[aria-label="${label}下拉多選"]')`;
  await nodeClick(summary);await nodeClick(`[...(${summary}).closest('details').querySelectorAll('.meeting-people-options label')].find(n=>n.querySelector('b')?.innerText==='QA OWNER')?.querySelector('input')`);await nodeClick(summary);
 };
 let meetingId,commonId,distributedId;
 const current=async()=>{const s=await qa.read();return {s,m:s.payload.meetings.find(m=>m.id===meetingId),common:s.payload.tasks.find(t=>t.id===commonId),distributed:s.payload.tasks.find(t=>t.id===distributedId)};};
 await check('original meeting creation: two decisions over two vessels are exactly two tasks, SQL ACK/readback/reopen',async()=>{
  await click('＋ 新增臨會/專題');await until(()=>evaluate("document.querySelector('.temporary-form')?.getAttribute('aria-readonly')==='false'"),'creation lease writable');
  await fillNode(field('會議主題 *','input','.temporary-form'),'QA UI MEETING');
  await fillRich('召開緣由','QA UI REASON');await fillRich('決議／會議結論','QA INITIAL RESOLUTION');
  await fillRich('待辦事項 1','QA COMMON DECISION');await click('＋ 增加待辦事項');await fillRich('待辦事項 2','QA DISTRIBUTED DECISION');
  await nodeClick("document.querySelectorAll('.meeting-vessel-distribution-toggle input')[1]");
  await nodeClick("[...document.querySelectorAll('.scope-mode-card')].find(n=>n.querySelector('b').innerText==='逐船選擇')");
  await click('QA VESSEL 1');await click('QA VESSEL 2');
  await nodeClick("[...document.querySelectorAll('.departments button')].find(n=>n.innerText==='督導')");
  await choosePerson('與會人員');await choosePerson('追蹤窗口');
  assert.equal(await evaluate(`(${field('會議主題 *','input','.temporary-form')}).value`),'QA UI MEETING');
  await screen('create-ready');const start=qa.metrics.length;
  await click('建立並退出編輯');await meetingIdle();
  const saved=await snapshot('created'),m=saved.payload.meetings.find(m=>m.subject==='QA UI MEETING');assert.ok(m);meetingId=m.id;
  const tasks=saved.payload.tasks.filter(t=>t.sourceMeetingId===meetingId);assert.equal(tasks.length,2);assert.equal(m.taskItems.length,2);
  const common=tasks.find(t=>!t.distributeToVessels),distributed=tasks.find(t=>t.distributeToVessels);assert.ok(common&&distributed);commonId=common.id;distributedId=distributed.id;
  assert.deepEqual(common.vesselIds,['qa-v1','qa-v2']);assert.deepEqual(distributed.vesselIds,['qa-v1','qa-v2']);assert.deepEqual(distributed.vesselProgress,[]); // Existing helper projects absent member entries as open, not precreated rows.
  assert.ok((await text()).includes('分船完成 0/2'));
  for(const t of tasks){assert.equal(t.attentionDimension,'meeting');assert.equal(t.sourceType,'temporary');assert.equal(t.description,m.taskItems.find(i=>i.id===t.sourceMeetingItemId).description);assert.deepEqual(t.ownerUserIds,['qa-owner']);}
  assert.ok(qa.metrics.slice(start).some(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status==='SQL_OK'));
  await editMeeting();assert.equal(await evaluate("document.querySelector('[aria-label=\"待辦事項 1\"]').innerText"),'QA COMMON DECISION');await click('取消修改退出編輯');await meetingIdle();await screen('created-readback');
 });



 await nodeClick("[...document.querySelectorAll('nav button')].find(n=>n.innerText.startsWith('我的待辦'))");await until(()=>evaluate(`Boolean(${row('QA COMPLETE TASK')})`),'WorkCenter return');
  if(!rejectProbe){
  await check('shared complete held ACK keeps selected original task and unsynced case',async()=>{
   await selectRows(['QA COMPLETE TASK','QA COMPLETE CASE','QA COMMON DECISION']);const before=await qa.read(),start=qa.metrics.length;
   declineConfirmation=true;const prior=evidence.dialogs.length;await click('批量完成（3）');await until(()=>evidence.dialogs.length>prior,'complete confirmation decline');await wait(100);declineConfirmation=false;assert.equal(await count(),'已選 3');assert.deepEqual(await qa.read(),before);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'||m.rpc==='claim_ship_dynamics_edit_lock').length,0);
   let dropped=false,lookup=false,submitted;const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});
   qa.setRecordFault({before:async({name,body})=>{if(name==='get_ship_dynamics_record_receipt_v1'&&dropped){lookup=true;assert.deepEqual(body,submitted);await held;}},after:async({name,body,value})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!dropped){assert.equal(value.ok,true);dropped=true;submitted=structuredClone(body);return true;}return false;}});
   await click('批量完成（3）');await until(()=>lookup,'complete same operation receipt');await snapshot('complete-committed-held');await screen('complete-held');assert.equal(await count(),'已選 3','WorkCenter complete selection before ACK');assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);
   releaseHeldReceipt();releaseHeldReceipt=null;await settled();qa.setRecordFault(null);await wait(1500);const saved=await snapshot('complete-ack');assert.equal(saved.revision,before.revision+1);assert.equal(saved.payload.tasks.find(t=>t.id==='qa-complete-task').isClosed,true);assert.equal(saved.payload.internalControlCases.find(t=>t.id==='qa-complete-case').isClosed,true);assert.equal(await count(),'已選 0');assert.equal(saved.payload.tasks.find(t=>t.id===commonId).isClosed,true);assert.equal(saved.payload.meetings.find(m=>m.id===meetingId).taskItems.find(i=>i.id===saved.payload.tasks.find(t=>t.id===commonId).sourceMeetingItemId).isClosed,true);assert.equal(saved.payload.meetings.find(m=>m.id===meetingId).status,before.payload.meetings.find(m=>m.id===meetingId).status);
  });

  await check('original full-result selection, empty/filter and distributed complete exclusion without writes',async()=>{
   const before=await qa.read(),start=qa.metrics.length;
   await click('全選目前結果');assert.equal(await count(),'已選 3');await click('取消全選');assert.equal(await count(),'已選 0');
   await fill('[aria-label="我的待辦關鍵字"]','NO MATCH');await until(async()=>await evaluate("document.querySelectorAll('.work-task-row').length")===0,'empty filter');assert.ok(await evaluate("[...document.querySelectorAll('.work-center button')].filter(n=>n.innerText.startsWith('批量完成')||n.innerText.startsWith('從我的待辦移除')||n.innerText.startsWith('永久刪除共用待辦')).every(n=>n.disabled)"));await fill('[aria-label="我的待辦關鍵字"]','');
   await selectRows(['QA DISTRIBUTED DECISION']);assert.ok(await evaluate("[...document.querySelectorAll('.work-center button')].find(n=>n.innerText==='批量完成（0）')?.disabled"));await nodeClick(`(${row('QA DISTRIBUTED DECISION')}).querySelector('input')`);assert.deepEqual(await qa.read(),before);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,0);
  });
  await check('permanent shared delete mixed distributed task and unsynced case keeps selection to receipt ACK',async()=>{
   await selectRows(['QA DELETE TASK','QA DELETE CASE','QA DISTRIBUTED DECISION']);const before=await qa.read(),start=qa.metrics.length;
   declineConfirmation=true;const dialogCount=evidence.dialogs.length;await click('永久刪除共用待辦（3）');await until(()=>evidence.dialogs.length>dialogCount,'permanent confirmation decline');await wait(100);declineConfirmation=false;assert.deepEqual(await qa.read(),before);assert.equal(await count(),'已選 3');assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'||m.rpc==='claim_ship_dynamics_edit_lock').length,0);
   let dropped=false,lookup=false,submitted;const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});
   qa.setRecordFault({before:async({name,body})=>{if(name==='get_ship_dynamics_record_receipt_v1'&&dropped){lookup=true;assert.deepEqual(body,submitted);await held;}},after:async({name,body,value})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!dropped){assert.equal(value.ok,true);dropped=true;submitted=structuredClone(body);return true;}return false;}});
   await click('永久刪除共用待辦（3）');await until(()=>lookup,'permanent same operation receipt');const committed=await snapshot('permanent-held');await screen('permanent-held');assert.equal(committed.revision,before.revision+1);assert.equal(await count(),'已選 3');assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);
   assert.ok(!committed.payload.tasks.some(t=>t.id==='qa-delete-task'||t.id===distributedId));assert.ok(!committed.payload.internalControlCases.some(c=>c.id==='qa-delete-case'));assert.equal(committed.payload.meetings.find(m=>m.id===meetingId).taskItems.length,1);assert.deepEqual(committed.payload.taskDismissals,before.payload.taskDismissals,'not personal hide or unrelated dismissal deletion');
   releaseHeldReceipt();releaseHeldReceipt=null;await settled();qa.setRecordFault(null);await wait(1500);assert.deepEqual(await qa.read(),committed);assert.equal(await count(),'已選 0');
   await evaluate('window.__qaOldDocument=true');await call('Page.reload');await until(async()=>await evaluate('!window.__qaOldDocument&&document.readyState==="complete"')&&(await text()).includes('QA OWNER｜Owner'),'fresh permanent readback');await nodeClick("[...document.querySelectorAll('nav button')].find(n=>n.innerText.startsWith('我的待辦'))");await until(()=>evaluate('Boolean(document.querySelector(".work-center"))'),'fresh work');assert.equal(await evaluate('document.querySelectorAll(".work-task-row").length'),0);
   for(const c of ['users','vessels','agendaReports','settings'])assert.deepEqual(committed.payload[c],baseline.payload[c]);for(const t of baseline.payload.tasks.filter(t=>!['qa-complete-task','qa-delete-task'].includes(t.id)))assert.deepEqual(committed.payload.tasks.find(n=>n.id===t.id),t);for(const c of baseline.payload.internalControlCases.filter(c=>!['qa-complete-case','qa-delete-case'].includes(c.id)))assert.deepEqual(committed.payload.internalControlCases.find(n=>n.id===c.id),c);
  });
  }else{
   await check('one exact case lease fault rejects whole original WorkCenter shared batch, no partial records/history/receipt',async()=>{
    await selectRows(['QA COMPLETE TASK','QA COMPLETE CASE','QA COMMON DECISION']);const before=await qa.read(),start=qa.metrics.length;
   declineConfirmation=true;const prior=evidence.dialogs.length;await click('批量完成（3）');await until(()=>evidence.dialogs.length>prior,'complete confirmation decline');await wait(100);declineConfirmation=false;assert.equal(await count(),'已選 3');assert.deepEqual(await qa.read(),before);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'||m.rpc==='claim_ship_dynamics_edit_lock').length,0);
    const storage=async()=>{const result={};for(const {tablename} of (await qa.db.query("select tablename from pg_tables where schemaname='public' and (tablename='ship_dynamics_records' or tablename like 'ship_dynamics_record_%') order by tablename")).rows){assert.match(tablename,/^(ship_dynamics_records|ship_dynamics_record_[a-z_]+)$/);result[tablename]=(await qa.db.query(`select to_jsonb(t) value from ${tablename} t order by to_jsonb(t)::text`)).rows;}assert.ok(Object.keys(result).length>=7);return result;};const storageBefore=await storage();let injected=false;
    qa.setRecordFault({before:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!injected){injected=true;const guard=body.p_lock_guards.find(g=>g.section_key==='internal-control:qa-complete-case');assert.ok(guard);await qa.db.query("update ship_dynamics_edit_locks set expires_at=now()-interval '1 second' where workspace_key='isolated-record-ui-qa' and section_key=$1 and locked_by=$2",[guard.section_key,guard.locked_by]);}}});
    expectBatchRejection=true;await click(deleteProbe?'永久刪除共用待辦（3）':'批量完成（3）');await until(()=>evidence.batchRejection,'actual SQL exact lease rejection');await wait(1100);assert.equal(await count(),'已選 3');assert.deepEqual(await qa.read(),before);assert.deepEqual(await storage(),storageBefore);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,1);assert.ok(qa.metrics.slice(start).some(m=>m.status==='lock-conflict'));
    evidence.rejectedBatch={selectionRetained:true,action:deleteProbe?'delete':'complete',storageUnchanged:true};await snapshot('rejected-batch');await screen('rejected-batch');qa.setRecordFault(null);expectBatchRejection=false;
   });
  }
  await call('Page.navigate',{url:qa.origin+'/__qa/blank'});await until(()=>evaluate("location.pathname==='/__qa/blank'&&document.readyState==='complete'"),'mounted page');
  await evaluate("import('/@react-refresh').then(({default:r})=>{r.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;})");
  evidence.mounted=await evaluate(`import('/scripts/record-work-center-lifecycle-probe.mjs').then(m=>m.run(${JSON.stringify(baseline.payload)}))`);
 }
 assert.deepEqual(await qa.itinerarySnapshot(),qa.itineraryBaseline);assert.deepEqual((await qa.db.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows,legacyBefore);
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>m.status==='UNSUPPORTED'));
 console.log(JSON.stringify({qa:'RECORD_WORK_CENTER_PASS',output,scenarios:evidence.scenarios}));
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

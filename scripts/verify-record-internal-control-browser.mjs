import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-internal-control-browser-'));
const profile=path.join(output,'chrome-profile');
const b1=process.env.QA_RELATED_DRAFT_B1==='1';
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
const holdDeletion=async(action,selector,expectedDraft)=>{
 let waiting=false;const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});const before=await qa.read();
 qa.setRecordFault({before:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){waiting=true;await held;}}});
 await click(action);await until(()=>waiting,'original delete reached transport before SQL');
 assert.ok(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),'pending deletion must not unmount original editor before ACK');
 assert.ok(await evaluate(`[...document.querySelectorAll('.modal textarea, .modal [contenteditable]')].some(n=>(n.value??n.innerText)===${JSON.stringify(expectedDraft)})`),'unsaved delete-editor draft retained');assert.deepEqual(await qa.read(),before);await screen(action==='刪除案件'?'case-delete-pending':'task-delete-pending');
 releaseHeldReceipt();releaseHeldReceipt=null;await finishEditor();qa.setRecordFault(null);
};
const leases=async()=> (await qa.db.query("select section_key,locked_by from ship_dynamics_edit_locks where workspace_key='isolated-record-ui-qa' and expires_at>now() order by section_key")).rows;

try{
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,tracking:true});
 await (await import('./tracking-browser-fixture.mjs')).installTrackingBrowserMigrations(qa.db);
 qa.itineraryBaseline=await qa.itinerarySnapshot(); // Capture AFTER current schema installation, before UI mutations.
 assert.equal((await fetch(`${qa.origin}/__qa/health`)).status,200);
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(chrome));
 browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let port,socketPath;
 await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch(error){if(['ENOENT','EBUSY','EPERM'].includes(error.code))return false;throw error;}},'Chrome readable handshake');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);return;}
  if(message.method==='Runtime.exceptionThrown')evidence.errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  if(message.method==='Page.javascriptDialogOpening'){
   (evidence.dialogs??=[]).push({type:message.params.type,message:message.params.message});
   const abnormal=message.params.type==='confirm'&&message.params.message.startsWith('是否將這筆關聯要事');
   const rejected=expectDeleteRejection&&message.params.type==='alert'&&message.params.message.startsWith('刪除要事未完成：');
   if(rejected)evidence.expectedDeleteRejection=message.params.message;
   // Disposal of the isolated failure page only; NOT a product save/close claim.
   const disposeFailurePage=message.params.type==='beforeunload'&&evidence.rejectedDelete?.draftRetained===true;
   const expected=disposeFailurePage||rejected||abnormal||(message.params.type==='confirm'&&/^(確定將此內控案件改為未結案|確定撤回同步要事|確定刪除此內控案件|確定刪除待辦|同步最新會保留本機修改)/.test(message.params.message))||(message.params.type==='alert'&&/^(同步要事已撤回；|請務必在FLOW系統中申報异常|請務必在FLOW系統中申報異常)/.test(message.params.message));
   if(!expected)evidence.errors.push('Unexpected QA dialog: '+message.params.message);
   void call('Page.handleJavaScriptDialog',{accept:expected&&!abnormal},message.sessionId).catch(error=>evidence.errors.push(error.message));
  }
  if(message.method==='Network.requestWillBeSent'){const url=message.params.request.url;if(/^https?:/.test(url)&&!url.startsWith(qa.origin+'/'))evidence.blockedExternal.push(new URL(url).origin);}
 });
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);
 ({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
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
 await check('original login and case creation synchronizes unique non-abnormal task through SQL ACK',async()=>{
  const before=await snapshot('before-create');
  await click('＋ 批量新增');await until(async()=>(await text()).includes('批量新增內控異常'),'batch editor');
  await select(field('事件分類 *','select'),'維修');
  await fillNode(field('事項內容 *','textarea'),'QA UI MAIN');
  await fillNode(field('解決計劃／最新狀態 *','textarea'),'QA UI PLAN');
  await nodeClick(labelInput('督導','.ic-batch-row > .ic-choice-picker'));
  await nodeClick(labelInput('同步到要事'));
  await until(async()=>(await text()).includes('同步要事設定'),'projection fields');
  await screen('create-draft');await click('保存 1 筆案件');await finishEditor();
  const saved=await snapshot('after-create'),item=saved.payload.internalControlCases.find(i=>i.description==='QA UI MAIN');assert.ok(item);
  const tasks=saved.payload.tasks.filter(t=>t.internalControlCaseId===item.id);assert.equal(tasks.length,1);assert.equal(tasks[0].id,item.linkedTaskId);assert.equal(tasks[0].isAbnormal,false);assert.equal(tasks[0].isInternalControl,true);
  assert.equal(saved.revision,before.revision+1);assert.equal(saved.payload.auditLogs.length,before.payload.auditLogs.length+1);
  assert.ok(qa.metrics.some(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status==='SQL_OK'));
  await screen('create-confirmed');
 });

 const mainId=(await qa.read()).payload.internalControlCases.find(c=>c.description==='QA UI MAIN').id;
 const main=async()=>{const s=await qa.read(),c=s.payload.internalControlCases.find(c=>c.id===mainId);return {s,c,t:s.payload.tasks.find(t=>t.id===c.linkedTaskId)};};
 await check('source update publishes both records and trusted appended progress, then releases all leases',async()=>{
  await openCase('QA UI MAIN');await fillNode(field('事項內容 *','textarea'),'QA SOURCE UPDATE');
  await fill('.ic-status-add textarea','QA SOURCE PROGRESS');await click('加入狀態記錄');await click('保存更新');await finishEditor();
  const {s,c,t}=await main();assert.equal(c.description,'QA SOURCE UPDATE');assert.equal(t.description,c.description);assert.equal(t.status,'QA SOURCE PROGRESS');assert.equal(c.statusLogs[0].byUserId,'qa-owner');assert.equal(t.isAbnormal,false);
  assert.deepEqual(await leases(),[]);await snapshot('source-update');
 });
 await check('case completion closes both ends; original closed-list reopen clears closure on both',async()=>{
  await openCase('QA SOURCE UPDATE');await click('結案並保存');await until(()=>evaluate('Boolean(document.querySelector("[aria-label=結案日期]"))'),'close date form');await evaluate(`(()=>{const n=document.querySelector('[aria-label=結案日期]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'2026-09-24');n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await click('確認結案');await finishEditor();
  let pair=await main();assert.equal(pair.c.isClosed,true);assert.equal(pair.t.isClosed,true);assert.ok(pair.c.closedDate);assert.equal(pair.t.closedDate,pair.c.closedDate);await snapshot('closed');
  await tab('內控結案清單');await openCase('QA SOURCE UPDATE');await click('改為未結案');await finishEditor();
  pair=await main();for(const entity of [pair.c,pair.t]){assert.equal(entity.isClosed,false);assert.equal(entity.closedDate,undefined);assert.equal(entity.closedBy,undefined);}
  await tab('內控未完清單');await snapshot('reopened');
 });
 await check('original task editor reverse update preserves source relation and creates notifications',async()=>{
  qa.setRecordFault({before:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1'){evidence.reverseRequest={operations:body.p_operations.map(o=>({collection:o.collection,kind:o.kind,id:o.entityId,changedFields:o.kind==='entity'?Object.keys(o.value||{}).filter(k=>JSON.stringify(o.expected?.[k])!==JSON.stringify(o.value[k])):[],audit:o.collection==='auditLogs'?{action:o.value?.action,entityType:o.value?.entityType,entityId:o.value?.entityId}:undefined})),guards:body.p_lock_guards};}}});
  await openCase('QA SOURCE UPDATE','要事');await fillRich('事項內容','QA REVERSE UPDATE');await fill('.quick-status-bar textarea','QA REVERSE PROGRESS');await click('加入狀態紀錄');await click('保存變更');await finishEditor();
  const {s,c,t}=await main();assert.match(c.description,/QA REVERSE UPDATE/);assert.equal(t.description,c.description);assert.equal(c.status,'QA REVERSE PROGRESS');assert.equal(t.internalControlCaseId,mainId);assert.ok(s.payload.notifications.some(n=>n.taskId===t.id&&n.kind==='task_updated'&&n.userId==='qa-operator'));await snapshot('reverse-update');qa.setRecordFault(null);
 });
 await check('lost ACK preserves original editor draft and leases until same-operation SQL status confirms',async()=>{
  await openCase('QA REVERSE UPDATE');await fillNode(field('事項內容 *','textarea'),'QA LOST ACK RECOVERED');
  let dropped=false,lookup=false,submitted,renewalFailed=false;
  if(b1){await evaluate(`void(window.__qaDraftNode=(${field('事項內容 *','textarea')}))`);await wait(27_000);}
  const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});
  const start=qa.metrics.length,before=await qa.read();
  qa.setRecordFault({before:async({name,body})=>{if(b1&&name==='renew_ship_dynamics_edit_lock'&&body.p_section_key==='internal-control:'+mainId&&dropped){renewalFailed=true;throw new Error('QA primary renewal transport failure');}if(name==='get_ship_dynamics_record_receipt_v1'&&dropped){lookup=true;assert.equal(body.p_operation_id,submitted.p_operation_id);assert.deepEqual(body,submitted);await held;}},after:async({name,body,value})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!dropped){assert.equal(value.ok,true);dropped=true;submitted=structuredClone(body);return true;}return false;}});
  await click('保存更新');await until(()=>lookup,'same operation status after lost ACK');
  if(b1){
    await until(()=>renewalFailed,'real 30-second client renewal fails during same-operation status',7000);
    await until(()=>evaluate('window.__qaDraftNode.matches(":disabled")'),'original Case draft becomes read-only');
    assert.equal(await evaluate(`window.__qaDraftNode===(${field('事項內容 *','textarea')})`),true,'same Case DOM/editor instance');
    evidence.b1Case={sameNode:true,readonly:true,clientRenewalObserved:true,clock:'real 30-second timer',operationId:submitted.p_operation_id};
    await screen('b1-case-renewal-error-readonly');
  }
  assert.equal(await evaluate(`(${field('事項內容 *','textarea')}).value`),'QA LOST ACK RECOVERED');
  assert.ok((await leases()).some(l=>l.section_key==='internal-control:'+mainId));assert.ok((await leases()).some(l=>l.section_key.startsWith('task:')));
  assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);
  const committed=await snapshot('lost-ack-before-status');assert.equal(committed.revision,before.revision+1);assert.equal(committed.payload.internalControlCases.find(c=>c.id===mainId).description,'QA LOST ACK RECOVERED');await screen('lost-ack-draft-retained');
  releaseHeldReceipt();releaseHeldReceipt=null;await finishEditor();qa.setRecordFault(null);
  const events=qa.metrics.slice(start),patches=events.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status==='SQL_OK'),lookups=events.filter(m=>m.rpc==='get_ship_dynamics_record_receipt_v1'&&m.status==='SQL_OK');
  assert.equal(patches.length,1);assert.equal(lookups.length,1);assert.equal(patches[0].operationId,lookups[0].operationId);assert.deepEqual(await leases(),[]);assert.equal((await qa.read()).revision,committed.revision);
  evidence.lostAck={operationId:patches[0].operationId,patches:patches.length,lookups:lookups.length,draftRetained:true,releaseAfterStatus:true};
  await openCase('QA LOST ACK RECOVERED');assert.equal(await evaluate(`(${field('事項內容 *','textarea')}).value`),'QA LOST ACK RECOVERED');await screen('lost-ack-reopened');await click('取消');await finishEditor();
 });
 await check('task cancellation keeps ordinary task and closed unlinked case, not withdrawal',async()=>{
  await openCase('QA LOST ACK RECOVERED','要事');const before=await main();await nodeClick(labelInput('內部管控（台面下異常管控）'));await click('保存變更');await finishEditor();
  const saved=await snapshot('cancelled'),c=saved.payload.internalControlCases.find(c=>c.id===mainId),t=saved.payload.tasks.find(t=>t.id===before.t.id);
  assert.ok(t);assert.equal(t.isInternalControl,false);assert.equal(t.internalControlCaseId,undefined);assert.equal(t.isAbnormal,false);assert.equal(c.isClosed,true);assert.equal(c.syncToTask,false);assert.equal(c.linkedTaskId,undefined);assert.ok(saved.payload.notifications.some(n=>n.taskId===t.id&&n.kind==='internal_control_cancelled'));
 });
 await check('withdrawal deletes task notices and dismissals, keeps open case; resync allocates new task ID',async()=>{
  const before=await qa.read(),c=before.payload.internalControlCases.find(c=>c.id==='qa-withdraw'),oldTask=c.linkedTaskId;
  assert.ok(before.payload.notifications.some(n=>n.taskId===oldTask));assert.ok(before.payload.taskDismissals.some(d=>d.itemId===oldTask));
  await openCase('QA withdraw');await click('撤回同步要事');await finishEditor();
  const withdrawn=await snapshot('withdrawn'),savedCase=withdrawn.payload.internalControlCases.find(c=>c.id==='qa-withdraw');assert.equal(savedCase.isClosed,false);assert.equal(savedCase.syncToTask,false);assert.equal(savedCase.linkedTaskId,undefined);
  assert.ok(!withdrawn.payload.tasks.some(t=>t.id===oldTask));assert.ok(!withdrawn.payload.notifications.some(n=>n.taskId===oldTask));assert.ok(!withdrawn.payload.taskDismissals.some(d=>d.itemId===oldTask));
  await openCase('QA withdraw');await nodeClick(labelInput('同步到要事'));await click('保存更新');await finishEditor();
  const resynced=await snapshot('resynced'),fresh=resynced.payload.internalControlCases.find(c=>c.id==='qa-withdraw');assert.ok(fresh.linkedTaskId);assert.notEqual(fresh.linkedTaskId,oldTask);assert.equal(resynced.payload.tasks.find(t=>t.id===fresh.linkedTaskId).internalControlCaseId,fresh.id);
 });
 await check('case deletion removes both endpoints; task deletion retains closed history case',async()=>{
  const before=await qa.read(),c=before.payload.internalControlCases.find(c=>c.id==='qa-case-delete');await openCase('QA case-delete');await fillNode(field('事項內容 *','textarea'),'QA UNSAVED CASE DELETE');await holdDeletion('刪除案件','.ic-edit-modal','QA UNSAVED CASE DELETE');
  let saved=await snapshot('case-deleted');assert.ok(!saved.payload.internalControlCases.some(i=>i.id===c.id));assert.ok(!saved.payload.tasks.some(t=>t.id===c.linkedTaskId));
  const other=saved.payload.internalControlCases.find(c=>c.id==='qa-task-delete');await openCase('QA task-delete','要事');await fillRich('事項內容','QA UNSAVED TASK DELETE');await holdDeletion('刪除待辦','.edit-modal','QA UNSAVED TASK DELETE');
  saved=await snapshot('task-deleted');assert.ok(!saved.payload.tasks.some(t=>t.id===other.linkedTaskId));const kept=saved.payload.internalControlCases.find(c=>c.id===other.id);assert.equal(kept.isClosed,true);assert.equal(kept.syncToTask,false);assert.equal(kept.linkedTaskId,undefined);
 });
 await check('restricted operator uses record identity: foreign scope and delete absent, cancel zero writes, assigned save allowed',async()=>{
  await click('切換/退出');await until(async()=>(await text()).includes('人員登入／切換'),'switch login');await select(`document.querySelector('[aria-label="登入人員"]')`,'qa-operator');await fill('input[type="password"]',qa.password);await click('登入');
  await until(async()=>(await text()).includes('QA OPERATOR｜操作員'),'record operator identity');await click('內控異常');await until(async()=>(await text()).includes('QA withdraw'),'operator scoped cases');
  await wait(1500);await until(async()=>(await text()).includes('已安全保存'),'notification receipts durable');
  const before=await qa.read(),start=qa.metrics.length;
  assert.ok(!(await text()).includes('QA restricted'));assert.ok(!(await text()).includes('QA VESSEL 2'));
  await openCase('QA withdraw');assert.ok(!(await text()).includes('刪除案件'));assert.deepEqual(await evaluate(`[...(${field('船舶 *','select')}).options].map(o=>o.value)`),['qa-v1']);await click('取消');await finishEditor();
  assert.equal((await qa.read()).revision,before.revision);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,0);
  await openCase('QA withdraw');await fillNode(field('事項內容 *','textarea'),'QA OPERATOR ALLOWED');await click('保存更新');await finishEditor();
  const saved=await snapshot('operator-saved'),c=saved.payload.internalControlCases.find(c=>c.id==='qa-withdraw');assert.equal(c.updatedBy,'qa-operator');assert.equal(saved.payload.tasks.find(t=>t.id===c.linkedTaskId).description,c.description);await screen('operator-scoped');
 });
 await check('authoritative readback survives reload; unrelated record/formal/history/legacy unchanged and no trailing save',async()=>{
  const saved=await snapshot('final-before-debounce');await wait(1800);assert.equal((await qa.read()).revision,saved.revision);
  await call('Page.reload');await until(async()=>(await text()).includes('QA OPERATOR｜操作員'),'reload identity');await click('內控異常');await until(async()=>(await text()).includes('QA OPERATOR ALLOWED'),'reload saved case');await openCase('QA OPERATOR ALLOWED');assert.equal(await evaluate(`(${field('事項內容 *','textarea')}).value`),'QA OPERATOR ALLOWED');await click('取消');await finishEditor();
  const final=await snapshot('final');assert.equal(final.revision,saved.revision);assert.deepEqual(await leases(),[]);
  for(const collection of ['meetings','agendaReports'])assert.deepEqual(final.payload[collection],baseline.payload[collection]);
  const expectedVessels=structuredClone(baseline.payload.vessels);expectedVessels.find(v=>v.id==='qa-v1').weeklyAttention=[...new Set([...expectedVessels.find(v=>v.id==='qa-v1').weeklyAttention,'maintenance'])];
  assert.deepEqual(final.payload.vessels,expectedVessels);assert.deepEqual(final.payload.tasks.find(t=>t.id==='qa-unrelated-task'),baseline.payload.tasks.find(t=>t.id==='qa-unrelated-task'));assert.deepEqual(final.payload.internalControlCases.find(c=>c.id==='qa-restricted'),baseline.payload.internalControlCases.find(c=>c.id==='qa-restricted'));
  assert.deepEqual(await qa.itinerarySnapshot(),qa.itineraryBaseline);assert.deepEqual((await qa.db.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows,legacyBefore);
  evidence.readback={initialRevision:baseline.revision,finalRevision:final.revision,unrelatedRecordsUnchanged:true,formalAndHistoryUnchanged:true,legacyUnchanged:true};
 });
 await check('expired original task lease rejects deletion atomically and preserves draft after failure callback',async()=>{
  await click('切換/退出');await until(async()=>(await text()).includes('人員登入／切換'),'Owner switch for terminal failure branch');await select(`document.querySelector('[aria-label="登入人員"]')`,'qa-owner');await fill('input[type="password"]',qa.password);await click('登入');await until(async()=>(await text()).includes('QA OWNER｜Owner'),'Owner record identity');await click('內控異常');await until(async()=>(await text()).includes('QA OPERATOR ALLOWED'),'failure branch case');await until(async()=>(await text()).includes('已安全保存'),'Owner settled');
  if(b1)await evaluate("window.__qaSetInterval=window.setInterval;window.setInterval=(callback,ms,...args)=>window.__qaSetInterval(callback,ms===30000?100000:ms,...args)");
  await openCase('QA OPERATOR ALLOWED','要事');await fillRich('事項內容','QA REJECTED DELETE DRAFT');
  if(b1)await evaluate("window.__qaDraftNode=document.querySelector('[aria-label=事項內容][contenteditable]');window.setInterval=window.__qaSetInterval");
  const before=await snapshot('before-rejected-delete'),start=qa.metrics.length;let injected=false;
  qa.setRecordFault({before:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!injected){injected=true;const guard=body.p_lock_guards.find(g=>g.section_key.startsWith('task:'));assert.ok(guard);await qa.db.query("update ship_dynamics_edit_locks set expires_at=now()-interval '1 second' where workspace_key='isolated-record-ui-qa' and section_key=$1 and locked_by=$2",[guard.section_key,guard.locked_by]);}}});
  expectDeleteRejection=true;await click('刪除待辦');await until(()=>evidence.expectedDeleteRejection,'original rejected delete alert');await wait(250);
  assert.equal(await evaluate(`document.querySelector('[contenteditable="true"][aria-label="事項內容"]')?.innerText`),'QA REJECTED DELETE DRAFT','definitively rejected delete must preserve child draft after handoff finishes');
  if(b1){
    const began=Date.now();
    await until(()=>evaluate('window.__qaDraftNode.isConnected&&window.__qaDraftNode.contentEditable===\"false\"'),'actual client validated deadline with delayed primary renewal',90_000);
    assert.equal(await evaluate("window.__qaDraftNode===document.querySelector('[aria-label=事項內容][contenteditable]')"),true,'same Task DOM/editor instance after expiry');
    assert.equal(await evaluate('window.__qaDraftNode.innerText'),'QA REJECTED DELETE DRAFT');
    assert.equal(await evaluate("[...document.querySelectorAll('.edit-modal button')].filter(n=>!n.disabled&&['保存變更','刪除待辦'].includes(n.innerText.trim())).length"),0);
    evidence.b1Task={sameNode:true,readonly:true,waitedAfterRejectionMs:Date.now()-began,clock:'real original expiry timer; primary 30s interval delayed to 100s by controlled scheduler only',server:'actual SQL expired exact owner; no response replacement'};
    await screen('b1-task-client-expiry-readonly');
  }
  const after=await snapshot('rejected-delete-readback');assert.deepEqual(after,before,'expired-lease SQL must not change any records, revision, audit or notices');
  const events=qa.metrics.slice(start);assert.ok(events.some(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status!=='SQL_OK'));assert.equal(events.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status==='SQL_OK').length,0);assert.equal(events.filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);
  evidence.rejectedDelete={layer:'full original App + actual SQL; owner-side lease expiry injection',draftRetained:true,recordsUnchanged:true,noPrematureRelease:true,statuses:events.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').map(m=>m.status)};await screen('rejected-delete-draft-retained');qa.setRecordFault(null);expectDeleteRejection=false;
  if(b1){await click('關閉');await until(async()=>!await evaluate("Boolean(document.querySelector('.modal-backdrop'))")&&(await leases()).length===0,'explicit rejected-draft disposition closes and cleans leases');assert.deepEqual(await qa.read(),before);evidence.b1Task.explicitClose=true;}
 });
 await call('Page.navigate',{url:qa.origin+'/__qa/blank'});
 await until(()=>evaluate("location.pathname==='/__qa/blank'&&document.readyState==='complete'"),'isolated mounted lifecycle page');
 await evaluate("import('/@react-refresh').then(({default:r})=>{r.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;})");
 evidence.lifecycle=await evaluate(`import('/scripts/internal-control-record-lifecycle-probe.mjs').then(m=>m.run(${JSON.stringify(baseline.payload)}))`);
 assert.equal(new Set(evidence.lifecycle.cases).size,5);
 console.log(JSON.stringify({qa:'INTERNAL_CONTROL_MOUNTED_PASS',...evidence.lifecycle}));
 assert.equal(new Set(evidence.scenarios).size,evidence.scenarios.length);
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>m.status==='UNSUPPORTED'));
 console.log(JSON.stringify({qa:'INTERNAL_CONTROL_BROWSER_PASS',output,scenarios:evidence.scenarios},null,2));
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

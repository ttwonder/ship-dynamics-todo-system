import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-meeting-browser-'));
const profile=path.join(output,'chrome-profile');
let qa,browser,ws,failure=null,sessionId,releaseHeldReceipt;
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
const fillRich=async(label,value)=>{await nodeClick(`document.querySelector('[contenteditable="true"][aria-label="${label}"]')`);await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await call('Input.insertText',{text:value});assert.equal(await evaluate(`document.querySelector('[contenteditable="true"][aria-label="${label}"]').innerText`),value,'native rich text replacement precondition');};
const leases=async()=> (await qa.db.query("select section_key,locked_by from ship_dynamics_edit_locks where workspace_key='isolated-record-ui-qa' and expires_at>now() order by section_key")).rows;

try{
 // Reuse existing conflicting-authority fixture as untouched bystanders.
 // All meeting-under-test data is created only through the original App UI.
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
  if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);return;}
  if(message.method==='Runtime.exceptionThrown')evidence.errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  if(message.method==='Page.javascriptDialogOpening'){
   (evidence.dialogs??=[]).push({type:message.params.type,message:message.params.message});
   const meetingConfirm=message.params.type==='confirm'&&/^(確定放棄本次|確定重新開啟|確定移除)/.test(message.params.message);
   const completionPrompt=message.params.type==='prompt'&&message.params.message==='請選擇完成日期（YYYY-MM-DD）';
   const expected=completionPrompt||meetingConfirm;
   if(!expected)evidence.errors.push('Unexpected QA dialog: '+message.params.message);
   void call('Page.handleJavaScriptDialog',{accept:expected,...(completionPrompt?{promptText:message.params.defaultPrompt}:{})},message.sessionId).catch(error=>evidence.errors.push(error.message));
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

 const itemButton=async(index,label)=>{const target=`[...document.querySelectorAll('.meeting-task-item')[${index}].querySelectorAll('button')].find(n=>n.innerText.trim()===${JSON.stringify(label)})`;await until(()=>evaluate(`Boolean((${target})?.getClientRects().length&&!(${target}).disabled)`),'decision action enabled '+label);await nodeClick(target);};
 const openTask=async(index,scope)=>{await itemButton(index,'更新');await until(()=>evaluate("Boolean(document.querySelector('.edit-modal'))"),'original task editor');if(scope)await select(`document.querySelector('[aria-label="待辦進度範圍"]')`,scope);};
 await check('child progress and source edits: canonical scope/priority/category sync, stable IDs and append-only history',async()=>{
  await openTask(0);await fill('.edit-modal .quick-status-bar textarea','QA COMMON HISTORY');await nodeClick("[...document.querySelectorAll('.edit-modal button')].find(n=>n.innerText==='加入狀態紀錄')");await click('保存變更');await finishEditor();
  const before=await current();assert.equal(before.common.status,'QA COMMON HISTORY');assert.equal(before.common.statusLogs[0].text,'QA COMMON HISTORY');
  await editMeeting();await fillRich('待辦事項 1','QA SOURCE EDIT');
  await select(field('會議議題關注程度','select','.temporary-form'),'高');
  await nodeClick("document.querySelectorAll('.meeting-task-category-chip input')[1]");
  await click('QA VESSEL 2');await click('保存並退出編輯');await meetingIdle();
  const narrowed=await current();assert.equal(narrowed.common.id,commonId);assert.equal(narrowed.distributed.id,distributedId);assert.deepEqual(narrowed.common.vesselIds,['qa-v1']);assert.deepEqual(narrowed.distributed.vesselIds,['qa-v1']);assert.equal(narrowed.common.description,'QA SOURCE EDIT');assert.equal(narrowed.common.priority,'高');assert.deepEqual(narrowed.common.categories,narrowed.m.taskItems[0].categories);assert.deepEqual(narrowed.common.statusLogs,before.common.statusLogs);assert.equal(narrowed.common.status,before.common.status);
  await editMeeting();await click('QA VESSEL 2');await click('保存並退出編輯');await meetingIdle();
  const restored=await current();for(const t of [restored.common,restored.distributed])assert.deepEqual(t.vesselIds,['qa-v1','qa-v2']);assert.deepEqual(restored.common.statusLogs,before.common.statusLogs);await snapshot('source-scope-history');
 });
 await check('decision complete/reopen synchronizes only its parent item, not whole meeting or sibling decision',async()=>{
  const before=await current();await itemButton(0,'快速結案');await until(()=>evaluate("Boolean(document.querySelector('#meeting-decision-closure-status'))"),'decision closure dialog');await fill('#meeting-decision-closure-status','QA DECISION COMPLETE');await click('確認結案');await until(async()=>(await current()).common.isClosed===true,'decision complete SQL readback');await meetingIdle();
  const closed=await current();assert.equal(closed.common.isClosed,true);assert.equal(closed.m.taskItems[0].isClosed,true);assert.equal(closed.m.status,before.m.status);assert.deepEqual(closed.distributed,before.distributed);assert.ok(closed.common.statusLogs.some(l=>l.text==='QA DECISION COMPLETE'));assert.equal(closed.common.closedBy,'qa-owner');
  await itemButton(0,'重新開啟此待辦');await until(async()=>(await current()).common.isClosed===false,'decision reopen SQL readback');await meetingIdle();const opened=await current();assert.equal(opened.common.isClosed,false);assert.equal(opened.common.closedDate,undefined);assert.equal(opened.common.closedBy,undefined);assert.equal(opened.m.taskItems[0].isClosed,false);assert.equal(opened.m.status,before.m.status);assert.deepEqual(opened.distributed,before.distributed);for(const l of closed.common.statusLogs)assert.deepEqual(opened.common.statusLogs.find(n=>n.id===l.id),l);await snapshot('decision-reopened');
 });
 await check('single-vessel completion/reopen preserves other member and overall axes, all members sync only parent item',async()=>{
  const before=await current();const overall=t=>({status:t.status,isClosed:t.isClosed,statusLogs:t.statusLogs});
  await openTask(1,'qa-v1');await fillRich('單船目前狀態','QA V1 DONE');await click('標記結案');await click('保存變更');await finishEditor();
  const one=await current(),p1=one.distributed.vesselProgress.find(p=>p.vesselId==='qa-v1');assert.equal(p1.isClosed,true);assert.equal(p1.status,'QA V1 DONE');assert.deepEqual(one.distributed.vesselProgress.find(p=>p.vesselId==='qa-v2'),before.distributed.vesselProgress.find(p=>p.vesselId==='qa-v2'));assert.deepEqual(overall(one.distributed),overall(before.distributed));assert.equal(one.m.taskItems[1].isClosed,false);assert.deepEqual(one.m,before.m);
  await openTask(1,'qa-v2');await fillRich('單船目前狀態','QA V2 DONE');await click('標記結案');await click('保存變更');await finishEditor();
  const both=await current();assert.deepEqual(both.distributed.vesselProgress.find(p=>p.vesselId==='qa-v1'),p1);assert.equal(both.m.taskItems[1].isClosed,true);assert.equal(both.m.status,before.m.status);assert.deepEqual(overall(both.distributed),overall(before.distributed));
  const bTuple=async()=>(await qa.db.query("select value,revision,entry_id,tableoid::text,xmin::text,ctid::text from ship_dynamics_record_task_progress where workspace_key='isolated-record-ui-qa' and task_id=$1 and value->>'vesselId'='qa-v2'",[distributedId])).rows;
  const bBefore=await bTuple();assert.equal(bBefore.length,1,'B is physically stored in a leaf');
  await openTask(1,'qa-v1');await click('重新開啟');await click('保存變更');await finishEditor();
  const reopened=await current();assert.equal(reopened.m.taskItems[1].isClosed,false);assert.equal(reopened.m.status,before.m.status);assert.deepEqual(reopened.distributed.vesselProgress.find(p=>p.vesselId==='qa-v2'),both.distributed.vesselProgress.find(p=>p.vesselId==='qa-v2'));const p=reopened.distributed.vesselProgress.find(p=>p.vesselId==='qa-v1');assert.equal(p.isClosed,false);assert.equal(p.closedDate,undefined);assert.deepEqual(p.statusLogs,p1.statusLogs);assert.deepEqual(reopened.common,before.common);await snapshot('member-reopened');
  assert.deepEqual(await bTuple(),bBefore,'original UI A save must not rewrite closed B leaf');evidence.memberPhysical={before:bBefore,after:await bTuple()};
 });
 await check('meeting lost ACK retains draft and exact leases; same-operation status confirms once before release',async()=>{
  await editMeeting();await fillRich('召開緣由','QA LOST ACK REASON');await fillRich('待辦事項 1','QA ACK SOURCE');
  let dropped=false,lookup=false,submitted;const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});const start=qa.metrics.length,before=await current();
  qa.setRecordFault({before:async({name,body})=>{if(name==='get_ship_dynamics_record_receipt_v1'&&dropped){lookup=true;assert.deepEqual(body,submitted);await held;}},after:async({name,body,value})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!dropped){assert.equal(value.ok,true);dropped=true;submitted=structuredClone(body);return true;}return false;}});
  await click('保存並退出編輯');await until(()=>lookup,'meeting lost ACK exact status');
  assert.equal(await evaluate("document.querySelector('[aria-label=\"召開緣由\"]').innerText"),'QA LOST ACK REASON');assert.equal(await evaluate("document.querySelector('.temporary-form').getAttribute('aria-readonly')"),'false');
  assert.ok((await leases()).some(l=>l.section_key==='meeting:'+meetingId));assert.ok((await leases()).some(l=>l.section_key==='task:'+commonId));assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);
  const committed=await snapshot('lost-ack-committed');assert.equal(committed.revision,before.s.revision+1);assert.equal(committed.payload.tasks.find(t=>t.id===commonId).description,'QA ACK SOURCE');await screen('lost-ack-retained');
  releaseHeldReceipt();releaseHeldReceipt=null;await meetingIdle();qa.setRecordFault(null);
  const events=qa.metrics.slice(start),patches=events.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status==='SQL_OK'),lookups=events.filter(m=>m.rpc==='get_ship_dynamics_record_receipt_v1'&&m.status==='SQL_OK');assert.equal(patches.length,1);assert.equal(lookups.length,1);assert.equal(patches[0].operationId,lookups[0].operationId);assert.equal((await qa.read()).revision,committed.revision);assert.deepEqual(await leases(),[]);evidence.lostAck={operationId:patches[0].operationId,patches:1,lookups:1,retainedDraft:true,releaseAfterStatus:true};
  await editMeeting();assert.equal(await evaluate("document.querySelector('[aria-label=\"召開緣由\"]').innerText"),'QA LOST ACK REASON');await click('取消修改退出編輯');await meetingIdle();
 });
 await check('remove source item archives/unlinks task with history retained, no hard deletion or sibling rewrite',async()=>{
  const before=await current();await editMeeting();await itemButton(0,'移除此事項');await click('保存並退出編輯');await meetingIdle();
  const after=await current();assert.equal(after.m.taskItems.length,1);assert.equal(after.m.taskItems[0].id,before.m.taskItems[1].id);assert.ok(after.common);assert.equal(after.common.isClosed,true);assert.equal(after.common.sourceMeetingId,undefined);assert.equal(after.common.sourceMeetingItemId,undefined);for(const l of before.common.statusLogs)assert.deepEqual(after.common.statusLogs.find(n=>n.id===l.id),l);assert.ok(after.common.statusLogs.length>before.common.statusLogs.length);assert.deepEqual(after.distributed,before.distributed);assert.equal(after.m.status,before.m.status);await snapshot('source-removed');
 });
 await check('restricted original operator record authority: no meeting write controls or foreign scope, zero patch',async()=>{
  await click('切換/退出');await until(async()=>(await text()).includes('人員登入／切換'),'operator switch');await select(`document.querySelector('[aria-label="登入人員"]')`,'qa-operator');await fill('input[type="password"]',qa.password);await click('登入');await until(async()=>(await text()).includes('QA OPERATOR｜操作員'),'operator record identity');await click('臨會/專題');await until(async()=>(await text()).includes('QA UI MEETING'),'operator meeting projection');await wait(1600);await until(async()=>(await text()).includes('已安全保存'),'operator receipt settlement');
  const before=await qa.read(),start=qa.metrics.length;assert.ok(!(await text()).includes('QA UNRELATED MEETING'));assert.equal(await evaluate("[...document.querySelectorAll('button')].filter(n=>n.getClientRects().length&&['取得編輯權','＋ 新增臨會/專題','快速結案','保存並退出編輯'].includes(n.innerText.trim())).length"),0);assert.equal(await evaluate("document.querySelector('.temporary-form').getAttribute('aria-readonly')"),'true');
  await screen('restricted-readonly');await wait(1500);assert.deepEqual(await qa.read(),before);assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1').length,0);
 });
 await check('authoritative reload, no trailing debounce, unrelated records/formal/history/legacy unchanged, exact notification recipients',async()=>{
  const saved=await snapshot('final-before-reload');await evaluate('window.__qaBeforeReload=true');await call('Page.reload');await until(()=>evaluate("!window.__qaBeforeReload&&document.readyState==='complete'&&document.body.innerText.includes('QA OPERATOR｜操作員')"),'new document reload record identity');await click('臨會/專題');await until(async()=>(await text()).includes('QA LOST ACK REASON'),'reload saved reason');await wait(1800);const final=await snapshot('final');assert.equal(final.revision,saved.revision);assert.deepEqual(await leases(),[]);
  for(const c of ['vessels','internalControlCases','agendaReports','taskDismissals','users'])assert.deepEqual(final.payload[c],baseline.payload[c]);
  for(const t of baseline.payload.tasks)assert.deepEqual(final.payload.tasks.find(n=>n.id===t.id),t);
  assert.deepEqual(final.payload.meetings.find(m=>m.id==='qa-unrelated-meeting'),baseline.payload.meetings.find(m=>m.id==='qa-unrelated-meeting'));assert.deepEqual(await qa.itinerarySnapshot(),qa.itineraryBaseline);assert.deepEqual((await qa.db.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows,legacyBefore);
  const notices=final.payload.notifications.filter(n=>[commonId,distributedId].includes(n.taskId));assert.ok(notices.length>0);assert.deepEqual([...new Set(notices.map(n=>n.userId))],['qa-operator']);assert.ok(notices.every(n=>n.actorId==='qa-owner'));assert.ok(final.payload.auditLogs.some(a=>a.entityId===meetingId));evidence.readback={initialRevision:baseline.revision,finalRevision:final.revision,unrelatedUnchanged:true,formalHistoryLegacyUnchanged:true,notificationRecipientIds:[...new Set(notices.map(n=>n.userId))]};
 });

 assert.equal(new Set(evidence.scenarios).size,8);
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>m.status==='UNSUPPORTED'));
 console.log(JSON.stringify({qa:'MEETING_BROWSER_PASS',output,scenarios:evidence.scenarios},null,2));
}catch(error){failure=error;try{evidence.failureText=await text();await snapshot('failure-readback');await screen('failure');}catch{};evidence.error=error.message;evidence.errorStack=error.stack;console.error(JSON.stringify({qa:'FAILED',error:error.message,output,body:evidence.failureText?.slice(0,9000)}));}
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

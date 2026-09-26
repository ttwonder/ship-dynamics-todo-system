import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'tracking-ui-'));
const profile=path.join(output,'chrome-profile');
const b1=process.env.QA_RELATED_DRAFT_B1==='1';
let native,qa,browser,ws,failure=null,sessionId,releaseHeldReceipt,expectDeleteRejection=false,expectStatisticsReadFailure=false;
const pending=new Map(),evidence={label:'真實 UI＋測試資料；原生 PostgreSQL，非 hosted Supabase',scenarios:[],errors:[],blockedExternal:[],metrics:[],dialogs:[]};
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
 native=await createNativeRecordQa(output,evidence,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,tracking:true,taskMember:true,databaseFactory:async()=>native.adapter});
 await (await import('./tracking-browser-fixture.mjs')).installTrackingBrowserMigrations(native.adapter);
 await (await import('./tracking-browser-fixture.mjs')).installTrackingFieldRevision(qa.db);

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
  if(message.method==='Network.responseReceived'&&message.params.response.status>=400)(evidence.httpErrors??=[]).push({status:message.params.response.status,path:new URL(message.params.response.url).pathname});
  if(message.method==='Network.loadingFailed')(evidence.loadErrors??=[]).push({type:message.params.type,error:message.params.errorText});
  if(message.method==='Runtime.exceptionThrown')evidence.errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  if(message.method==='Page.javascriptDialogOpening'){
   (evidence.dialogs??=[]).push({type:message.params.type,message:message.params.message});
   const abnormal=message.params.type==='confirm'&&message.params.message.startsWith('是否將這筆關聯要事');
   const rejected=expectDeleteRejection&&message.params.type==='alert'&&message.params.message.startsWith('刪除要事未完成：');
   if(rejected)evidence.expectedDeleteRejection=message.params.message;
   // Disposal of the isolated failure page only; NOT a product save/close claim.
   const disposeFailurePage=message.params.type==='beforeunload'&&evidence.rejectedDelete?.draftRetained===true;
   const expected=(expectStatisticsReadFailure&&message.params.type==='alert'&&message.params.message==='Synthetic record ACK loss after actual SQL commit')||(message.params.type==='prompt'&&message.params.message==='請選擇完成日期（YYYY-MM-DD）')||(message.params.type==='confirm'&&/^確認保存本次結案／重開變更/.test(message.params.message))||(message.params.type==='confirm'&&/^確定將此內控案件改為未結案/.test(message.params.message))||(message.params.type==='alert'&&/^(tracking-stale-source|跟蹤保存結果尚未確認|此項目正在由 QA other editor)/.test(message.params.message))||(message.params.type==='confirm'&&/^重新核對/.test(message.params.message))||(message.params.type==='confirm'&&/^只同步以下/.test(message.params.message))||disposeFailurePage||rejected||abnormal||(message.params.type==='confirm'&&/^(確定撤回同步要事|確定刪除此內控案件|確定刪除待辦|同步最新會保留本機修改)/.test(message.params.message))||(message.params.type==='alert'&&/^(同步要事已撤回；|請務必在FLOW系統中申報异常|請務必在FLOW系統中申報異常)/.test(message.params.message));
   if(!expected)evidence.errors.push('Unexpected QA dialog: '+message.params.message);
   void call('Page.handleJavaScriptDialog',{accept:expected&&!abnormal,...(message.params.type==='prompt'?{promptText:'2026-09-26'}:{})},message.sessionId).catch(error=>evidence.errors.push(error.message));
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
 try{await until(async()=> (await text()).includes('請輸入管理者設定的進站密碼。'),'site gate');}catch(error){if((await text()).trim()!=='真實 UI＋測試資料｜本機 SQL；非正式環境')throw error;evidence.initialAssetRetry=true;await call('Page.reload');await until(async()=> (await text()).includes('請輸入管理者設定的進站密碼。'),'site gate after one blank-asset retry',40_000);}await fill('input[type="password"]',qa.password);await click('進入系統');
 await until(async()=> (await text()).includes('人員登入／切換'),'personnel login');await fill('input[type="password"]',qa.password);await click('登入');
 await until(async()=> (await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'Owner homepage');

 const baseline=await snapshot('fixture-baseline');
 const legacyBefore=(await qa.db.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows;
 await click('內控異常');await until(async()=>(await text()).includes('QA withdraw'),'record internal control list');
 await screen('internal-control-baseline-desktop');
 evidence.baseline=await evaluate("(()=>{const t=document.querySelector('.ic-table');return {width:innerWidth,table:t?.getBoundingClientRect().width,font:t&&getComputedStyle(t).fontSize,nav:[...document.querySelectorAll('nav button')].map(n=>n.innerText)};})()");
 await check('shore-tracking-navigation-mounted',async()=>{
   assert.ok((await text()).includes('配件/物料/工程跟蹤'),'Missing approved shore tracking entry');
   await click('配件/物料/工程跟蹤');
   await until(()=>evaluate('Boolean(document.querySelector(".tracking-page"))'),'tracking page mounted');
   await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
   const paper=await evaluate("({tracking:getComputedStyle(document.querySelector('.tracking-page')).getPropertyValue('--tracking-paper').trim(),app:getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()})");
   assert.equal(paper.tracking,paper.app,'Tracking must inherit the actual App theme, not independently switch to a dark island');
   await screen('tracking-native-App-dark-theme-consistency');
   await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
 });
 await check('shore-initial-statistics-first-active-and-explicit-list-entry',async()=>{
  const tabs=await evaluate("[...document.querySelectorAll('.tracking-tabs [role=tab]')].map(n=>({label:n.textContent.trim(),active:n.getAttribute('aria-selected')}))");assert.equal(tabs.length,6);assert.equal(tabs[0].label,'統計資訊');assert.equal(tabs[0].active,'true');assert.ok(tabs[1].label.startsWith('未送船清單'));assert.ok(tabs.slice(1).every(t=>t.active==='false'));
  await until(()=>evaluate("Boolean(document.querySelector('[aria-label=統計摘要]'))"),'shore default confirmed statistics');await screen('shore-default-statistics-desktop');assert.ok(!await evaluate("document.querySelector('.tracking-page').innerText.includes('未能讀取此船最新跟蹤資料')"),'default statistics must not race the initial vessel read into a false load failure');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await screen('shore-default-statistics-mobile');assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await nodeClick("[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith('未送船清單'))");await until(()=>evaluate("Boolean(document.querySelector('.tracking-table'))"),'explicit shore list entry');assert.ok(await evaluate("[...document.querySelectorAll('.tracking-page button[title]')].some(n=>n.title.includes('要事'))"),'office-only hover help remains available on shore');
 });
 await check('new-source-real-App-native-ACK-and-reload',async()=>{
   await until(()=>evaluate("Boolean([...document.querySelectorAll('.tracking-heading button')].find(n=>n.innerText==='＋ 新增／批量新增'&&!n.disabled))"),'tracking read ready');
   const before=await qa.read();
   await click('＋ 新增／批量新增');
  await until(()=>evaluate(`Boolean(document.querySelector('[aria-label="第 1 筆 類型"]'))`),'explicit create type');assert.equal(await evaluate("document.querySelector('[aria-label=新增跟蹤說明] strong').textContent"),'船舶：QA VESSEL 1');assert.equal(await evaluate("document.querySelectorAll('[aria-label=新增跟蹤說明] input,[aria-label=新增跟蹤說明] select').length"),0);
  await select("document.querySelector('[aria-label=\"第 1 筆 類型\"]')",'repair');assert.ok(await evaluate("Boolean(document.querySelector('[aria-label=\"第 1 筆 實際送達/完工日期\"]'))"));await select("document.querySelector('[aria-label=\"第 1 筆 類型\"]')",'spares');
   await fill('[aria-label="第 1 筆 申請單號(材料或工程)"]','UI-001');
   await fill('[aria-label="第 1 筆 內容摘要/工程內容"]','真實UI測試來源');
   await click('確認保存 1 項');await finishEditor();
   const saved=await qa.read(),created=saved.payload.trackingItems.find(r=>r.referenceNo==='UI-001');
   assert.ok(created);assert.equal(created.vesselId,'qa-v1');assert.equal(created.expectedDate,'');assert.equal(created.supplementalNotes,'');
   assert.equal(saved.revision,before.revision+1);assert.equal(saved.payload.internalControlCases.length,before.payload.internalControlCases.length);
   assert.ok(qa.metrics.some(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status==='SQL_OK'));
   await screen('tracking-created-desktop');
   const previousDocument=await evaluate('performance.timeOrigin');await call('Page.reload');await until(async()=>await evaluate('performance.timeOrigin')!==previousDocument&&(await text()).includes('QA OWNER'),'new document login',60_000);
   await click('配件/物料/工程跟蹤');await until(()=>evaluate("Boolean(document.querySelector('.tracking-statistics'))"),'shore default after reload');await nodeClick("[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith('未送船清單'))");await until(()=>evaluate("document.querySelector('.tracking-table')?.innerText.includes('UI-001')"),'authoritative reload');
   assert.deepEqual(await qa.read(),saved);
 });
 const trackingRow=reference=>`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.querySelector('.tracking-reference')?.innerText.includes(${JSON.stringify(reference)}))`;
 const rowAction=async(reference,label)=>{await until(()=>evaluate(`Boolean([...(${trackingRow(reference)})?.querySelectorAll('button')||[]].find(n=>n.innerText.trim()===${JSON.stringify(label)}&&!n.disabled))`),'ready source '+reference);await nodeClick(`[...(${trackingRow(reference)}).querySelectorAll('button')].find(n=>n.innerText.trim()===${JSON.stringify(label)})`);await until(()=>evaluate("Boolean(document.querySelector('[role=dialog]'))"),'tracking '+label+' dialog');};
 const dateInput=async(selector,value)=>{await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),"date field ready");await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)throw new Error('date input unavailable');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),value);};
 const trackingTab=async(label)=>{await nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);};
 if(process.argv.includes('--statistics')){
   await (await import('./tracking-statistics-browser-checks.mjs')).statisticsChecks({qa,evaluate,call,click,nodeClick,fill,select,until,screen,check,output,audience:'shore',expectReadFailure:value=>{expectStatisticsReadFailure=value;}});
 }else if(process.argv.includes('--fields')){
   await (await import('./tracking-field-browser-checks.mjs')).trackingFieldChecks({qa,evaluate,call,click,nodeClick,fill,select,until,screen,check,output});
 }else if(process.argv.includes('--layout-only')){
   await (await import('./tracking-layout-browser-checks.mjs')).layoutChecks({qa,call,evaluate,click,nodeClick,fill,until,text,screen,check,rowAction,finishEditor,output});
 }else{
 await check('source-sync-reuses-original-form-one-case-no-default-task',async()=>{
   await rowAction('UI-001','同步到內控');
   assert.ok((await text()).includes('批量新增內控異常'));
   const sourceCaption=await evaluate("document.querySelector('.tracking-sync-form .modal-head p').textContent");
   assert.ok(sourceCaption.includes('每筆')&&!sourceCaption.includes('共用船舶、報告日期及來源'),'Tracking sync caption must describe per-source dates, not the ordinary batch shared-date form');
   assert.equal(await evaluate(`(${labelInput('同步到要事')}).checked`),false);
   assert.equal(await evaluate(`(${labelInput('督導','.ic-batch-row > .ic-choice-picker')}).checked`),true);
   // The fixture has only 督導; missing material department is a visible warning.
   await click('保存 1 筆案件');await finishEditor();
   const saved=await qa.read(),source=saved.payload.trackingItems.find(r=>r.referenceNo==='UI-001');
   assert.equal(source.linkState,'active');const item=saved.payload.internalControlCases.find(c=>c.id===source.linkedCaseId);
   assert.equal(item.trackingItemId,source.id);assert.equal(item.syncToTask,false);assert.equal(item.expectedDate,'');
   assert.ok((await text()).includes('已在這邊輸入項目，不要再在內控重複輸入！'));await screen('tracking-sync-confirmed');
 });
 await check('delivery-independent-linked-close-correct-reopen-and-case-entry',async()=>{
   await rowAction('UI-001','送達／更正');await dateInput('[aria-label="實際送達/完工日期"]','2026-09-25');await click('確認保存 1 項');await finishEditor();
   let saved=await qa.read(),source=saved.payload.trackingItems.find(r=>r.referenceNo==='UI-001');assert.equal(source.deliveryStatus,'delivered');assert.equal(source.isClosed,false);assert.equal(saved.payload.internalControlCases.find(c=>c.id===source.linkedCaseId).isClosed,false);
   await trackingTab('已送船清單');await rowAction('UI-001','結案');assert.ok((await text()).includes(source.linkedCaseId));await dateInput('[aria-label="結案日期"]','2026-09-26');await click('確認保存 1 項');await finishEditor();
   saved=await qa.read();source=saved.payload.trackingItems.find(r=>r.referenceNo==='UI-001');assert.equal(source.closedDate,'2026-09-26');assert.equal(saved.payload.internalControlCases.find(c=>c.id===source.linkedCaseId).closedDate,'2026-09-26');
   await nodeClick(`(${trackingRow('UI-001')}).querySelector('input[type=checkbox]')`);await click('修改結案日期');await dateInput('[aria-label="結案日期"]','2026-09-27');await click('確認保存 1 項');await finishEditor();
   saved=await qa.read();source=saved.payload.trackingItems.find(r=>r.referenceNo==='UI-001');assert.equal(source.closedDate,'2026-09-27');assert.equal(source.actualDeliveryDate,'2026-09-25');
   await rowAction('UI-001','重開此案');await click('確認保存 1 項');await finishEditor();saved=await qa.read();source=saved.payload.trackingItems.find(r=>r.referenceNo==='UI-001');assert.equal(source.isClosed,false);assert.equal(source.closedDate,undefined);assert.equal(source.actualDeliveryDate,'2026-09-25');assert.equal(source.events.filter(e=>e.action==='reopen').length,1);
   await rowAction('UI-001','進度');await fill('[aria-label="UI-001 最新進度"]','第二次進度');await click('確認保存 1 項');await finishEditor();saved=await qa.read();source=saved.payload.trackingItems.find(r=>r.referenceNo==='UI-001');assert.equal(saved.payload.internalControlCases.find(c=>c.id===source.linkedCaseId).status,'第二次進度');
 });
 const context={qa,call,evaluate,click,nodeClick,fill,until,text,screen,check,rowAction,trackingTab,dateInput,finishEditor,leases,select,labelInput,fillNode,field,dialogs:evidence.dialogs};
 await (await import('./tracking-native-browser-checks.mjs')).nativeChecks(context);
 await (await import('./tracking-recovery-browser-checks.mjs')).recoveryChecks(context);
 assert.deepEqual((await qa.db.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows,legacyBefore,'record-native UI never modifies legacy');
 await (await import('./tracking-component-browser-checks.mjs')).componentChecks(context);
 }
 assert.equal(evidence.errors.length,0,JSON.stringify(evidence.errors));
 console.log(JSON.stringify({qa:'TRACKING_UI_PASS',output,scenarios:evidence.scenarios}));
}catch(error){failure=error;try{evidence.failureText=await text();await snapshot('failure-readback');await screen('failure');}catch{};evidence.error=error.message;console.error(JSON.stringify({qa:'FAILED',error:error.message,output,body:evidence.failureText?.slice(0,9000)}));}
finally{
 releaseHeldReceipt?.();
 evidence.metrics=qa?.metrics||[];
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome closed',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome tree stopped',5000);}}
 try{if(qa)await qa.close();if(native)await native.close();}catch(error){failure??=error;}
 if(!failure){try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
 try{if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);evidence.cleanup={httpStopped:true,chromeStopped:true,ownedChromePid:browser?.pid};}catch(error){failure??=error;evidence.cleanup={error:error.message};}
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 if(failure)process.exitCode=1;
}

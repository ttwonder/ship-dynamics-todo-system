import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {fillNativeDate} from './browser-native-date-input.mjs';

// QA-only: original main.tsx -> App, native input, synthetic identities.
// No setters, write helpers, fabricated responses, external hosts or user profile.
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'ui-')),profile=path.join(run,'chrome');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const receipt={kind:'original-App-native-PG-work-center-direct-edit',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-work-center-direct-edit-browser.mjs',exit:null}],productionContacted:false};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const patchRpc='apply_ship_dynamics_record_patch_v1';
let native,qa,browser,ws,failure,chromePort,releaseCommit,currentCase='setup',next=0;
const pending=new Map(),actors=[],netRows=new Map();
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
 p.click=async label=>{const expr=`[...document.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.innerText.trim())===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled)`;await until(()=>p.eval(`Boolean(${expr})`),'ready button '+label);await p.activate(expr);};
 p.fill=async(expr,value)=>{await p.eval(`(()=>{const n=${expr};if(!n||n.disabled||n.readOnly)throw new Error('editable input required');n.focus();if(n.select)n.select();})()`);await call('Input.insertText',{text:value},s);};
 p.screen=async name=>{fs.writeFileSync(path.join(run,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},s)).data,'base64'));};
 p.saved=()=>p.eval("Boolean(document.querySelector('.save-status-strip.saved'))&&!document.querySelector('[role=dialog]')");
 p.sync=async()=>{const start=receipt.network.length;await p.click('同步最新（安全合併）');await until(()=>receipt.network.slice(start).some(r=>r.actor===actor&&/^read_ship_dynamics_record/.test(r.rpc)&&r.finished),'sync HTTP '+actor);await until(()=>p.eval("[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='同步最新（安全合併）'&&!n.disabled)&&!document.querySelector('.save-status-strip.saving')"),'sync idle '+actor);};
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

const read=async()=> (await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;
const locks=async()=> (await native.observer.query('select section_key from ship_dynamics_edit_locks where expires_at>now()')).rows;

const taskDialog="document.querySelector('#task-edit-title')";
let a,rejectNextClose=false;
const dateInput=(selector,value)=>fillNativeDate(a.eval,(method,params)=>call(method,params,a.s),selector,value);
async function check(id,fn){currentCase=id;await fn();receipt.cases.push({caseId:id,status:'PASS'});save();}
const workRow=(text)=>`[...document.querySelectorAll('.work-task-list article')].find(n=>n.textContent.includes(${JSON.stringify(text)}))`;
const caseStatus="[...document.querySelectorAll('.ic-edit-modal .field')].find(n=>n.querySelector('label')?.textContent==='解決計劃／最新狀態 *')?.querySelector('textarea')";
async function assertWork(){assert.equal(await a.eval("Boolean(document.querySelector('.work-center'))"),true,'editor must keep My Work mounted');assert.equal(await a.eval("Boolean(document.querySelector('.ic-filter-panel,.selected-task-list-panel'))"),false,'no navigation to another list');}
async function openCase(text,via='title'){
  await a.activate(`(${workRow(text)}).querySelector(${JSON.stringify(via==='title'?'.task-link':'.work-task-actions .primary')})`);
  await until(()=>a.eval("Boolean(document.querySelector('.ic-edit-modal,.internal-control-page'))"),'direct internal-control editor');
  await assertWork();assert.equal(await a.eval("Boolean(document.querySelector('.ic-edit-modal'))"),true,'original case editor is open');
}
async function replaceRich(expr,text){await a.eval(`(${expr}).focus()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2},a.s);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2},a.s);await call('Input.insertText',{text},a.s);}
try {
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true,initTimeoutMs:120000});
 qa=await createRecordStorageLocalQa({browserAuthority:true,internalControl:true,taskMember:true,scopedRead:true,performanceTrace:true,databaseFactory:async()=>native.adapter,preparePerformanceFixture:async(initial,vite)=>{
   for(const name of ['tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'])initial[name]=[];
   const owner=initial.users.find(u=>u.id==='qa-owner'),at=initial.updatedAt;
   initial.settings.departments=['督導'];
   initial.vessels.forEach((v,i)=>{delete v.nameEn;v.name=v.fullName=v.shortName=`QA VESSEL ${i+1}`;v.assignedUserIds=i===0?['qa-owner','qa-operator']:[];v.weeklyAttention=[];});
   const {createInternalControlCases}=await vite.ssrLoadModule('/src/internalControlData.ts');
   const cases=[{id:'qa-work-standalone',description:'QA work standalone',syncToTask:false},{id:'qa-work-linked',description:'QA work linked',syncToTask:true}].map(c=>({...c,vesselId:'qa-v1',reportDate:at.slice(0,10),reportSource:'日常',priority:'低',category:'維修',isAware:false,status:'QA pending',departments:['督導'],isClosed:false,createdBy:owner.id,updatedBy:owner.id,createdAt:at,updatedAt:at,statusLogs:[],origin:'internal-control'}));
   createInternalControlCases(initial,cases,owner,at,{'qa-work-linked':{categories:['維修'],expectedDate:'',ownerUserIds:['qa-owner','qa-operator'],isAbnormal:false}});
   initial.tasks.push({...structuredClone(initial.tasks[0]),id:'qa-work-ordinary',description:'QA work ordinary',internalControlCaseId:undefined,isInternalControl:false});
 }});
 const {installMorningOracle,schedulerSql}=await import('./record-daily-morning-local-fixture.mjs');
 await installMorningOracle(native.adapter);await native.adapter.exec(fs.readFileSync(schedulerSql,'utf8'));
 for(const file of ['supabase/migrations/20260904161000_appdata_compact_ack_receipts.sql','supabase/migrations/20260817143000_data_management_storage.sql','supabase/migrations/20260818154500_data_management_prune_batch_limit.sql','supabase/normalized-legacy-cutover.sql','supabase/development/20260911_legacy_report_workspace_binding.sql','supabase/development/20260911_business_quiescence.sql','supabase/development/20260911_paused_record_legacy_transfer.sql','supabase/development/20260911_source_authority_publication.sql','supabase/development/20260912_browser_source_authority.sql'])await native.adapter.exec(fs.readFileSync(file,'utf8'));
 receipt.origin=qa.origin;receipt.layer='真實原始 App UI＋測試資料＋本機 PostgreSQL；非正式 Supabase';
 receipt.inputs=Object.fromEntries(['src/App.tsx','src/WorkCenter.tsx','src/InternalControlPage.tsx','src/InternalControlModals.tsx','src/cloudSyncError.ts','src/styles.css','scripts/verify-work-center-direct-edit-browser.mjs'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update',`--explicitly-allowed-ports=${new URL(qa.origin).port}`,'--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socketPath;await until(()=>{try{[chromePort,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
 receipt.chrome={pid:browser.pid,port:Number(chromePort)};
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){const {type,message}=m.params;receipt.dialogs??=[];receipt.dialogs.push({caseId:currentCase,type,message});const reject=type==='confirm'&&message.startsWith('確定結案此內控案件')&&rejectNextClose;if(reject)rejectNextClose=false;await call('Page.handleJavaScriptDialog',{accept:!reject&&(type==='confirm'||type==='beforeunload')},m.sessionId);}
   if(m.method==='Fetch.requestPaused'){const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);if(!allowed)receipt.blockedExternal.push(u.origin);await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}
   if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(qa.origin+'/rest/v1/rpc/')){const b=JSON.parse(m.params.request.postData||'{}'),row={caseId:currentCase,actor:actors.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:b.p_operation_id,readScope:b.p_scope,started:m.params.wallTime*1000};netRows.set(m.sessionId+':'+m.params.requestId,row);receipt.network.push(row);}
   const row=netRows.get(m.sessionId+':'+m.params.requestId);if(m.method==='Network.loadingFinished'&&row){row.finished=Date.now();save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });
 const context=(await call('Target.createBrowserContext')).browserContextId;a=await makePage('qa-owner',context);await login(a);

 await a.activate("[...document.querySelectorAll('nav button')].find(n=>n.textContent.startsWith('我的待辦'))");
 await until(()=>a.eval("document.querySelectorAll('.work-task-list article').length===3"),'three distinct work rows');
 await check('labels-and-deduplication',async()=>{
   assert.match(await a.eval(`(${workRow('QA work standalone')}).textContent`),/內控\(未同步要事\)/);
   assert.match(await a.eval(`(${workRow('QA work linked')}).textContent`),/內控\(已同步要事\)/);
   assert.match(await a.eval(`(${workRow('QA work ordinary')}).textContent`),/普通要事/);
   await a.fill("document.querySelector('[aria-label=我的待辦關鍵字]')",'QA work');
   await a.eval(`(${workRow('QA work ordinary')}).querySelector('input[type=checkbox]').click();void(window.__qaWork=document.querySelector('.work-center'))`);
   await a.screen('work-labels');
 });
 await check('internal-title-opens-editor-in-place-cancel-zero-write',async()=>{
   const before=await read();await openCase('QA work standalone');
   assert.equal(await a.eval(`(${caseStatus}).value`),'QA pending');
   await a.fill(caseStatus,'QA cancel must not save');await a.click('取消');await until(()=>a.eval("!document.querySelector('.ic-edit-modal')"),'cancel editor');
   await until(async()=>(await locks()).length===0,'cancel release');
   assert.deepEqual((await read()).payload.internalControlCases,before.payload.internalControlCases);assert.deepEqual((await read()).payload.tasks,before.payload.tasks);
   assert.equal(await a.eval("window.__qaWork===document.querySelector('.work-center')"),true);assert.equal(await a.eval("document.querySelector('[aria-label=我的待辦關鍵字]').value"),'QA work');assert.equal(await a.eval("document.querySelector('.work-task-panel .batch-selection-count').textContent"),'已選 1');
 });
 await check('direct-status-edit-saves-on-first-attempt',async()=>{
   await openCase('QA work standalone','update');
   await a.fill(caseStatus,'QA directly edited status');
   await dateInput('#ic-edit-dl','2026-10-10');
   await a.click('保存更新');
   await until(()=>a.eval("!document.querySelector('.ic-edit-modal')"),'direct status save must add history and close',10000);
   const c=(await read()).payload.internalControlCases.find(c=>c.id==='qa-work-standalone');
   assert.equal(c.status,'QA directly edited status');assert.equal(c.statusLogs[0].text,c.status);
   assert.equal(c.expectedDate,'2026-10-10');assert.equal(c.isClosed,false);
   assert.equal(c.statusLogs.filter(l=>l.text===c.status).length,1);
 });
 await check('internal-update-button-save-held-ack-and-readback',async()=>{
   await openCase('QA work standalone','update');await a.fill("document.querySelector('.ic-status-add textarea')",'QA saved directly from my work');await a.click('加入狀態記錄');await until(()=>a.eval(`(${caseStatus}).value==='QA saved directly from my work'`),'status history applied');
   let reached=false;const barrier=new Promise(r=>{releaseCommit=r;});
   qa.setRecordFault({after:async({name,body})=>{if(name===patchRpc&&body.p_operations.some(o=>o.collection==='internalControlCases')){reached=true;await barrier;}return false;}});
   await a.click('保存更新');await a.key('Enter');await until(()=>reached,'native case commit before held ACK');
   const row=(await read()).payload.internalControlCases.find(c=>c.id==='qa-work-standalone');assert.equal(row.status,'QA saved directly from my work');
   await assertWork();assert.equal(await a.eval("Boolean(document.querySelector('.ic-edit-modal'))"),true);assert.equal(await a.eval("Boolean(document.querySelector('.save-toast.success'))"),false);
   assert.equal(await a.eval("[...document.querySelectorAll('.ic-edit-modal button')].find(n=>n.innerText==='保存中…')?.disabled"),true);
   await wait(1300);await a.screen('internal-held-ack');releaseCommit();releaseCommit=null;qa.setRecordFault(null);await until(()=>a.eval("!document.querySelector('.ic-edit-modal')"),'ACK closes original editor');
   await until(()=>a.eval(`(${workRow('QA work standalone')}).textContent.includes('QA saved directly from my work')`),'updated work row');
   assert.equal(await a.eval("window.__qaWork===document.querySelector('.work-center')"),true);assert.equal(await a.eval("document.querySelector('.work-task-panel .batch-selection-count').textContent"),'已選 1');
   assert.equal((await read()).payload.internalControlCases.find(c=>c.id==='qa-work-standalone').statusLogs.filter(l=>l.text==='QA saved directly from my work').length,1,'repeated native Enter during save cannot add duplicate history');
 });
 await check('ordinary-and-synced-task-direct-edit-original-save',async()=>{
   await a.activate(`(${workRow('QA work linked')}).querySelector('.task-link')`);await until(()=>a.eval(`Boolean(${taskDialog})`),'linked task original editor');await assertWork();
   await dateInput('.task-global-fields input[type=date]','2026-10-11');await a.click('保存變更');await until(()=>a.eval(`!${taskDialog}`),'linked DL save');
   assert.equal((await read()).payload.internalControlCases.find(c=>c.id==='qa-work-linked').expectedDate,'2026-10-11');
   await a.activate(`(${workRow('QA work ordinary')}).querySelector('.task-link')`);await until(()=>a.eval(`Boolean(${taskDialog})`),'ordinary original editor');await assertWork();
   await replaceRich("document.querySelector('[contenteditable=true][aria-label=事項內容]')",'QA work ordinary updated');await a.click('保存變更');await until(()=>a.eval(`!${taskDialog}`),'ordinary save ACK');
   assert.equal((await read()).payload.tasks.find(t=>t.id==='qa-work-ordinary').description,'QA work ordinary updated');await assertWork();
 });
 await check('matching-source-filters-print-labels-and-responsive-ui',async()=>{
   const expr="document.querySelector('[aria-label=我的待辦來源篩選]')";
   await a.eval(`(${expr}).focus()`);await a.key('End');await a.key('Enter');await until(()=>a.eval(`(${expr}).value==='internal-synced'`),'synced source filter');await until(()=>a.eval("document.querySelectorAll('.work-task-list article').length===1"),'one synced task');assert.match(await a.eval("document.querySelector('.work-task-list').textContent"),/內控\(已同步要事\)/);
   await a.key('ArrowUp');await a.key('Enter');await until(()=>a.eval(`(${expr}).value==='internal'`),'unsynced source filter');await until(()=>a.eval("document.querySelectorAll('.work-task-list article').length===1"),'one standalone case');assert.match(await a.eval("document.querySelector('.work-task-list').textContent"),/內控\(未同步要事\)/);
   await a.click('清除篩選');await a.click('全選目前結果');assert.match(await a.eval("document.querySelector('.work-print-list').textContent"),/內控\(未同步要事\)/);assert.match(await a.eval("document.querySelector('.work-print-list').textContent"),/內控\(已同步要事\)/);
   for(const width of [1280,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},a.s);await a.eval("document.querySelector('.work-task-panel').scrollIntoView({block:'start'});document.fonts.ready");await a.eval("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");const geometry=await a.eval("(()=>{const nodes=[...document.querySelectorAll('.work-task-meta .task-source-badge')];return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,badges:nodes.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {text:n.textContent,left:r.left,right:r.right,height:r.height,display:s.display,visibility:s.visibility,overflow:n.scrollWidth>n.clientWidth};})};})()");assert.equal(geometry.overflow,false);assert.ok(geometry.badges.every(r=>r.height>0&&r.left>=0&&r.right<=width&&r.display!=='none'&&r.visibility==='visible'&&!r.overflow));receipt.geometry??=[];receipt.geometry.push(geometry);await a.screen('work-'+width);
     if(width===390){
       await openCase('QA work standalone');
       const dialog=await a.eval("(()=>{const n=document.querySelector('.ic-edit-modal'),r=n.getBoundingClientRect(),s=getComputedStyle(n);return {kind:'internal-editor',width:innerWidth,left:r.left,right:r.right,height:r.height,display:s.display,visibility:s.visibility,overflow:n.scrollWidth>n.clientWidth};})()");
       assert.ok(dialog.height>0&&dialog.left>=0&&dialog.right<=width&&dialog.display!=='none'&&dialog.visibility==='visible'&&!dialog.overflow);
       receipt.geometry.push(dialog);await a.screen('internal-390');await a.click('取消');await until(()=>a.eval("!document.querySelector('.ic-edit-modal')"),'mobile cancel');await assertWork();
     }
   }
 });
 await check('fresh-document-durability-and-original-internal-page',async()=>{
   await call('Page.reload',{},a.s);await until(()=>a.eval("Boolean(document.querySelector('article.ship-card'))"),'fresh document');await a.sync();await a.activate("[...document.querySelectorAll('nav button')].find(n=>n.textContent.startsWith('我的待辦'))");await until(()=>a.eval("document.querySelectorAll('.work-task-list article').length===3"),'restored rows');assert.match(await a.text(),/QA saved directly from my work/);assert.match(await a.text(),/QA work ordinary updated/);
   await a.click('內控異常');await until(()=>a.eval("Boolean(document.querySelector('.ic-filter-panel'))"),'original internal-control page');assert.match(await a.text(),/內控未完清單/);assert.match(await a.text(),/內控結案清單/);assert.match(await a.text(),/數據統計/);
   assert.match(await a.eval("document.querySelector('.ic-table').textContent"),/期望完成日期\/DL/);assert.match(await a.eval("document.querySelector('.ic-table').textContent"),/2026-10-10/);
   await a.activate("[...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.textContent.includes('QA work standalone')).querySelector('button.primary')");await until(()=>a.eval("Boolean(document.querySelector('.ic-edit-modal'))"),'original page editor');assert.equal(await a.eval(`(${caseStatus}).value`),'QA saved directly from my work');await a.click('取消');
 });
 await check('prominent-close-confirmation-held-ack-and-reopen',async()=>{
   const openOriginal=async()=>{await a.activate("[...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.textContent.includes('QA work standalone')).querySelector('button.primary')");await until(()=>a.eval("Boolean(document.querySelector('.ic-edit-modal'))"),'case editor');};
   await until(()=>a.eval("!document.querySelector('.ic-edit-modal')"),'previous cancel');
   await openOriginal();
   const before=await read();await a.click('結案並保存');await until(()=>a.eval("!!document.querySelector('#ic-close-date')"),'date picker before closure');
   await a.click('確認結案');assert.equal(await a.eval("document.querySelector('#ic-close-date').validity.valueMissing"),true);
   await dateInput('#ic-close-date','2026-09-25');await a.screen('close-date-390');
   const bounds=await a.eval("(()=>{const n=document.querySelector('.ic-close-date-modal'),r=n.getBoundingClientRect();return{left:r.left,right:r.right,viewport:document.documentElement.clientWidth,scroll:n.scrollWidth,width:n.clientWidth};})()");
   assert.ok(bounds.left>=0&&bounds.right<=bounds.viewport+1&&bounds.scroll<=bounds.width+1,JSON.stringify(bounds));await a.click('取消結案');
   assert.deepEqual((await read()).payload.internalControlCases,before.payload.internalControlCases,'cancel close confirmation writes nothing');
   await a.fill("document.querySelector('.ic-status-add textarea')",'QA closed with pending note');
   let reached=false;const barrier=new Promise(r=>{releaseCommit=r;});
   qa.setRecordFault({after:async({name,body})=>{if(name===patchRpc&&body.p_operations.some(o=>o.collection==='internalControlCases')){reached=true;await barrier;}return false;}});
   await a.click('結案並保存');await dateInput('#ic-close-date','2026-09-25');await a.click('確認結案');await a.key('Enter');await until(()=>reached,'close committed before ACK');
   let c=(await read()).payload.internalControlCases.find(x=>x.id==='qa-work-standalone');
   assert.equal(c.isClosed,true);assert.equal(c.status,'QA closed with pending note');assert.equal(c.statusLogs[0].text,c.status);assert.equal(c.closedBy,'qa-owner');
   assert.equal(c.closedDate,'2026-09-25');assert.equal(c.expectedDate,'2026-10-10');
   assert.equal(await a.eval("Boolean(document.querySelector('.ic-edit-modal'))"),true);assert.equal(await a.eval("Boolean(document.querySelector('.save-toast.success'))"),false);
   releaseCommit();releaseCommit=null;qa.setRecordFault(null);await until(()=>a.eval("!document.querySelector('.ic-edit-modal')"),'close ACK');
   await a.activate("[...document.querySelectorAll('.ic-tabs button')].find(n=>n.textContent.startsWith('內控結案清單'))");await until(()=>a.eval("[...document.querySelectorAll('.ic-table tbody tr')].some(n=>n.textContent.includes('QA work standalone'))"),'closed row');
   await openOriginal();await a.eval("document.querySelector('.ic-edit-actions').scrollIntoView({block:'end'})");await a.screen('close-actions-390');
   await a.click('改為未結案');await until(()=>a.eval("!document.querySelector('.ic-edit-modal')"),'reopen ACK');
   c=(await read()).payload.internalControlCases.find(x=>x.id==='qa-work-standalone');assert.equal(c.isClosed,false);assert.equal(c.status,'QA closed with pending note');
   assert.equal(c.statusLogs.filter(l=>l.text===c.status).length,1,'reopen alone does not duplicate status history');
   assert.equal(c.expectedDate,'2026-10-10');assert.equal(c.closedDate,undefined);
 });
 await check('case-DL-updates-linked-task-in-original-editor',async()=>{
   await a.activate("[...document.querySelectorAll('.ic-tabs button')].find(n=>n.textContent.startsWith('內控未完清單'))");
   await a.activate("[...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.textContent.includes('QA work linked')).querySelector('button.primary')");await until(()=>a.eval("!!document.querySelector('#ic-edit-dl')"),'linked case DL');
   assert.equal(await a.eval("document.querySelector('#ic-edit-dl').value"),'2026-10-11');await dateInput('#ic-edit-dl','2026-10-12');await a.click('保存更新');await until(()=>a.eval("!document.querySelector('.ic-edit-modal')"),'paired DL ACK');
   const data=(await read()).payload,c=data.internalControlCases.find(c=>c.id==='qa-work-linked');assert.equal(c.expectedDate,'2026-10-12');assert.equal(data.tasks.find(t=>t.id===c.linkedTaskId).expectedDate,'2026-10-12');
 });
 await check('shore-batch-DL-not-closure-and-selected-batch-date',async()=>{
   await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},a.s);
   await a.click('＋ 批量新增');await until(()=>a.eval("!!document.querySelector('.ic-batch-modal')"),'batch modal');
   assert.doesNotMatch(await a.eval("document.querySelector('.ic-batch-modal').innerText"),/結案日期/);
   for(let i=0;i<2;i++){
     if(i)await a.click('＋ 新增一筆');const row=`.ic-batch-row:nth-child(${i+1})`;
     await a.fill(`document.querySelector('${row} .ic-case-content-row .field:first-child textarea')`,'QA new DL case '+i);
     await a.fill(`document.querySelector('${row} .ic-case-content-row .field:nth-child(2) textarea')`,'QA date only');
     if(i===0)await dateInput(`${row} input[type=date]`,'2026-11-01');
   }
   await a.screen('shore-batch-dl');await a.click('保存 2 筆案件');await until(()=>a.eval("!document.querySelector('.ic-batch-modal')"),'batch create ACK');
   let data=(await read()).payload;const first=data.internalControlCases.find(c=>c.description==='QA new DL case 0'),second=data.internalControlCases.find(c=>c.description==='QA new DL case 1');
   assert.ok(first&&second);assert.equal(first.expectedDate,'2026-11-01');assert.equal(second.expectedDate,'');assert.equal(first.isClosed,false);assert.equal(second.isClosed,false);
   await a.eval("[...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.textContent.includes('QA new DL case 0')).querySelector('input[type=checkbox]').click()");
   await a.click('批量結案（1）');await until(()=>a.eval("!!document.querySelector('#ic-close-date')"),'batch date');await a.click('取消結案');assert.equal((await read()).payload.internalControlCases.find(c=>c.id===first.id).isClosed,false);
   await a.click('批量結案（1）');await dateInput('#ic-close-date','2026-09-26');await a.click('確認結案');await until(()=>a.eval("!document.querySelector('#ic-close-date')"),'batch close ACK');
   data=(await read()).payload;assert.equal(data.internalControlCases.find(c=>c.id===first.id).closedDate,'2026-09-26');assert.equal(data.internalControlCases.find(c=>c.id===first.id).expectedDate,'2026-11-01');assert.deepEqual(data.internalControlCases.find(c=>c.id===second.id),second);
 });
 assert.equal(receipt.errors.length,0,JSON.stringify(receipt.errors));assert.equal(receipt.blockedExternal.length,0);receipt.status='PASS';
} catch(error){failure=error;receipt.status='FAIL';receipt.failure=String(error.stack||error);if(a)try{await a.screen('failure');fs.writeFileSync(path.join(run,'failure-ui.txt'),await a.text());fs.writeFileSync(path.join(run,'failure-sql.json'),JSON.stringify(scrub(await read()),null,2));}catch{};}
finally {
 if(releaseCommit)releaseCommit();if(qa)qa.setRecordFault(null);
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){await until(()=>browser.exitCode!==null,'Chrome exit',7000).catch(()=>{if(process.platform==='win32')spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F']);else browser.kill('SIGKILL');});}
 if(qa)await qa.close();if(native)await native.close();receipt.chromeStopped=chromePort?await portClosed(Number(chromePort)):true;receipt.commands[0].exit=failure?1:0;save();
}
console.log(JSON.stringify({status:receipt.status,cases:receipt.cases,errors:receipt.errors,failure:receipt.failure,evidence:run,stopped:receipt.stopped,chromeStopped:receipt.chromeStopped},null,2));
if(failure)throw failure;

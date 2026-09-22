import assert from 'node:assert/strict';
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
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-total-task-create-browser.mjs',exit:null}],productionContacted:false};
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
 p.click=async label=>{const expr=`[...document.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.innerText.trim())===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled)`;await until(()=>p.eval(`Boolean(${expr})`),'ready button '+label);await p.activate(expr);};
 p.fill=async(expr,value)=>{await p.eval(`(()=>{const n=${expr};if(!n||n.disabled||n.readOnly)throw new Error('editable input required');n.focus();if(n.select)n.select();})()`);await call('Input.insertText',{text:value},s);};
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

const read=async()=> (await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;
const locks=async()=> (await native.observer.query('select section_key from ship_dynamics_edit_locks where expires_at>now()')).rows;
const taskDialog="document.querySelector('#task-edit-title')";
const taskField=label=>`[...document.querySelectorAll('.edit-modal .field')].find(n=>n.querySelector('label')?.textContent.startsWith(${JSON.stringify(label)}))?.querySelector('select')`;
let a;
async function select(p,expr,value){const index=await p.eval(`(()=>{const n=${expr};if(!n||n.disabled)throw new Error('enabled select required');n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(index>=0,'option exists '+value);await p.key('Home');for(let i=0;i<index;i++)await p.key('ArrowDown');await p.key('Enter');await until(()=>p.eval(`(${expr}).value===${JSON.stringify(value)}`),'select '+value);}
async function create(p,id){await p.click('新增要事');await until(()=>p.eval("Boolean(document.querySelector('.task-create-picker')?.open)"),'picker');await select(p,"document.querySelector('[aria-label=新增要事船舶]')",id);await p.click('下一步：填寫要事');await until(()=>p.eval(`Boolean(${taskDialog})&&!document.querySelector('.task-create-picker')?.open`),'original creation editor');assert.equal(await p.eval(`(${taskField('船舶')}).value`),id);assert.equal(await p.eval(`(${taskField('船舶')}).disabled`),true);}
async function content(p,description,category='維修'){await p.fill("document.querySelector('[contenteditable=true][aria-label=事項內容]')",description);await p.eval(`(()=>{for(const label of ${JSON.stringify([category,'海務'])}){const n=[...document.querySelectorAll('.edit-modal .checkbox-multi-picker label')].find(n=>n.querySelector('b')?.textContent===label)?.querySelector('input');if(!n)throw new Error('missing checkbox '+label);if(!n.checked)n.click();}})()`);}
async function check(id,fn){currentCase=id;await fn();receipt.cases.push({caseId:id,status:'PASS'});save();}
try {
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true,initTimeoutMs:120000});
 qa=await createRecordStorageLocalQa({browserAuthority:true,internalControl:true,taskMember:true,scopedRead:true,performanceTrace:true,databaseFactory:async()=>native.adapter,preparePerformanceFixture:async initial=>{
   for(const name of ['tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'])initial[name]=[];
   initial.settings.departments=['督導','海務'];
   const owner=initial.users.find(u=>u.id==='qa-owner');
   initial.users=[owner,{...owner,id:'qa-operator',name:'QA OPERATOR',username:'qa-operator',role:'operator',managedVesselIds:['qa-v2']}];
   initial.vessels.forEach((v,i)=>{delete v.nameEn;v.name=v.fullName=v.shortName=`QA VESSEL ${i+1}`;v.assignedUserIds=i===1?['qa-operator']:[];v.weeklyAttention=i===1?['materials-parts']:[];v.manualAttentionLevel=i===1?'特別關注':'';});
   initial.vessels.push({...structuredClone(initial.vessels[0]),id:'qa-inactive',name:'QA INACTIVE',fullName:'QA INACTIVE',shortName:'QA INACTIVE',isActive:false});
 }});
 const {installMorningOracle,schedulerSql}=await import('./record-daily-morning-local-fixture.mjs');
 await installMorningOracle(native.adapter);await native.adapter.exec(fs.readFileSync(schedulerSql,'utf8'));
 for(const file of ['supabase/migrations/20260904161000_appdata_compact_ack_receipts.sql','supabase/migrations/20260817143000_data_management_storage.sql','supabase/migrations/20260818154500_data_management_prune_batch_limit.sql','supabase/normalized-legacy-cutover.sql','supabase/development/20260911_legacy_report_workspace_binding.sql','supabase/development/20260911_business_quiescence.sql','supabase/development/20260911_paused_record_legacy_transfer.sql','supabase/development/20260911_source_authority_publication.sql','supabase/development/20260912_browser_source_authority.sql'])await native.adapter.exec(fs.readFileSync(file,'utf8'));
 receipt.origin=qa.origin;receipt.layer='真實原始 App UI＋測試資料＋本機 PostgreSQL；非正式 Supabase';
 receipt.inputs=Object.fromEntries(['src/App.tsx','src/TaskCreateEntry.tsx','src/taskCreateEntry.css','scripts/verify-total-task-create-browser.mjs'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socketPath;await until(()=>{try{[chromePort,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
 receipt.chrome={pid:browser.pid,port:Number(chromePort)};
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){const {type,message}=m.params;receipt.dialogs??=[];receipt.dialogs.push({caseId:currentCase,type,message});await call('Page.handleJavaScriptDialog',{accept:type==='confirm'||type==='beforeunload'},m.sessionId);}
   if(m.method==='Fetch.requestPaused'){const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);if(!allowed)receipt.blockedExternal.push(u.origin);await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}
   if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(qa.origin+'/rest/v1/rpc/')){const b=JSON.parse(m.params.request.postData||'{}'),row={caseId:currentCase,actor:actors.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:b.p_operation_id,readScope:b.p_scope,started:m.params.wallTime*1000};netRows.set(m.sessionId+':'+m.params.requestId,row);receipt.network.push(row);}
   const row=netRows.get(m.sessionId+':'+m.params.requestId);if(m.method==='Network.loadingFinished'&&row){row.finished=Date.now();save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });
 const context=(await call('Target.createBrowserContext')).browserContextId;a=await makePage('qa-owner',context);await login(a);
 await a.click('待辦總表');await until(()=>a.eval("Boolean(document.querySelector('.selected-task-list-panel'))"),'total list');await a.click('清除篩選');
 await check('picker-cancel-active-scope-zero-write',async()=>{
   const before=await read(),beforeLocks=await locks();
   await a.click('新增要事');await until(()=>a.eval("Boolean(document.querySelector('.task-create-picker')?.open)"),'picker');
   assert.deepEqual(await a.eval("[...document.querySelector('[aria-label=新增要事船舶]').options].map(o=>o.value)"),['','qa-v1','qa-v2']);
   assert.equal(await a.eval("[...document.querySelectorAll('.task-create-picker button')].find(n=>n.type==='submit').disabled"),true);
   await a.screen('picker-desktop');await a.click('取消');await until(()=>a.eval("!document.querySelector('.task-create-picker').open"),'cancel picker');
   assert.deepEqual(await read(),before);assert.deepEqual(await locks(),beforeLocks);
 });
 await check('draft-cancel-original-lease-no-task-no-lights',async()=>{
   const before=await read();await create(a,'qa-v1');await content(a,'QA cancelled draft');await a.click('取消並關閉');await until(()=>a.eval(`!${taskDialog}`),'cancel original editor');await until(async()=>(await locks()).length===0,'creation lease released');assert.deepEqual((await read()).payload.tasks,before.payload.tasks);assert.deepEqual((await read()).payload.vessels,before.payload.vessels);
 });
 await check('save-held-ack-task-lights-owners-atomic',async()=>{
   await create(a,'qa-v2');await content(a,'QA total created');await select(a,taskField('要事關注程度'),'急');await a.eval("document.querySelector('.abnormal-toggle input').click()");
   const before=await read();let reached=false;
   const barrier=new Promise(r=>{releaseCommit=r;});
   qa.setRecordFault({after:async({name,body})=>{if(name===patchRpc&&body.p_operations.some(o=>o.collection==='tasks')){reached=true;await barrier;}return false;}});
   await a.click('保存並關閉');await until(()=>reached,'actual SQL commit before held ACK');
   const during=await read(),created=during.payload.tasks.find(t=>t.description.includes('QA total created'));assert.ok(created);assert.equal(created.vesselId,'qa-v2');assert.equal(created.priority,'急');assert.equal(created.isAbnormal,true);assert.equal(created.sourceType,'morning');assert.deepEqual(created.ownerUserIds,['qa-operator']);
   assert.deepEqual(during.payload.vessels.find(v=>v.id==='qa-v2').weeklyAttention,['materials-parts','maintenance']);assert.equal(during.payload.vessels.find(v=>v.id==='qa-v2').manualAttentionLevel,'特別關注');assert.deepEqual(during.payload.vessels.find(v=>v.id==='qa-v1'),before.payload.vessels.find(v=>v.id==='qa-v1'));
   assert.equal(await a.eval(`Boolean(${taskDialog})`),true);assert.match(await a.text(),/正在確認雲端/);assert.equal(await a.eval("Boolean(document.querySelector('.save-toast.success'))"),false);
   await a.screen('held-ack');releaseCommit();releaseCommit=null;qa.setRecordFault(null);await until(()=>a.eval(`!${taskDialog}`),'ACK closes editor');await until(async()=>(await a.text()).includes('QA total created'),'saved task appears');
   assert.equal((await read()).payload.tasks.length,1);
 });
 await check('dashboard-and-personal-worklist-original-projections',async()=>{
   await a.click('船隊看板');await until(()=>a.eval("document.querySelectorAll('article.ship-card').length===2"),'cards');
   const target="[...document.querySelectorAll('article.ship-card')].find(n=>n.textContent.includes('QA VESSEL 2'))";
   assert.match(await a.eval(`(${target}).textContent`),/異常存在/);assert.equal(await a.eval(`(${target}).querySelector('select.attention-adjust').value`),'特別關注');
   receipt.cardLights=await a.eval(`[...(${target}).querySelectorAll('button')].filter(n=>n.textContent.includes('維修')||n.textContent.includes('物料配件')).map(n=>({text:n.textContent,className:n.className,pressed:n.getAttribute('aria-pressed')}))`);
   assert.ok(receipt.cardLights.length>=2);assert.ok(receipt.cardLights.every(n=>n.pressed==='true'||/\bon\b|\bactive\b/.test(n.className)),'both original and new light are on');await a.screen('card-linkage');
   const sql=(await read()).payload,{selectUserWorkCenterTasks}=await qa.loadModule('/src/workCenterScope.ts');
   assert.equal(selectUserWorkCenterTasks(sql,sql.users.find(u=>u.id==='qa-operator'),sql.vessels).length,1);assert.equal(selectUserWorkCenterTasks(sql,sql.users.find(u=>u.id==='qa-owner'),sql.vessels).length,0,'creator/Owner alone is not assignment');
   const c=(await call('Target.createBrowserContext')).browserContextId,b=await makePage('qa-operator',c);await login(b);await b.activate("[...document.querySelectorAll('nav button')].find(n=>n.textContent.startsWith('我的待辦'))");await until(async()=>(await b.text()).includes('QA total created'),'assigned operator worklist');await b.click('待辦總表');await b.click('新增要事');await until(()=>b.eval("Boolean(document.querySelector('.task-create-picker')?.open)"),'operator picker');assert.deepEqual(await b.eval("[...document.querySelector('[aria-label=新增要事船舶]').options].map(o=>o.value)"),['','qa-v2']);await b.click('取消');
   await a.click('待辦總表');
 });
 await check('rejected-save-keeps-draft-no-partial-lights-retry-once',async()=>{
   await create(a,'qa-v1');await content(a,'QA retry retained','加油加水');const before=await read();let rejected=false;
   qa.setRecordFault({before:async({name,body})=>{if(name===patchRpc&&body.p_operations.some(o=>o.collection==='tasks')){rejected=true;throw Object.assign(new Error('QA explicit create rejection'),{code:'QA_CREATE_REJECTED'});}}});
   await a.click('保存並關閉');await until(()=>rejected,'rejected attempt');await until(()=>a.eval("[...document.querySelectorAll('.edit-modal button')].some(n=>n.textContent==='保存並關閉'&&!n.disabled)"),'failure returns to same editor');
   assert.match(await a.eval("document.querySelector('[aria-label=事項內容]').textContent"),/QA retry retained/);assert.deepEqual((await read()).payload.tasks,before.payload.tasks);assert.deepEqual((await read()).payload.vessels,before.payload.vessels);await a.screen('rejected-draft');
   qa.setRecordFault(null);await a.click('保存並關閉');await until(()=>a.eval(`!${taskDialog}`),'retry exact draft');await until(async()=>(await read()).payload.tasks.some(t=>t.description.includes('QA retry retained')),'retained lease expiry and original pending-creation recovery',120000);const after=await read();assert.equal(after.payload.tasks.filter(t=>t.description.includes('QA retry retained')).length,1);assert.deepEqual(after.payload.vessels.find(v=>v.id==='qa-v1').weeklyAttention,['bunkering-water']);
 });
 await check('filters-selection-preserved-and-hidden-create-notice',async()=>{
   await a.fill("document.querySelector('input[placeholder=\"船名、事項、狀態...\"]')",'QA total created');await until(()=>a.eval("document.querySelectorAll('.selected-task-list-panel .batch-task-table tbody tr').length===1"),'filtered row');await a.eval("document.querySelector('.selected-task-list-panel tbody input[type=checkbox]').click();void(window.__qaOriginalList=document.querySelector('.selected-task-list-panel'))");
   await create(a,'qa-v1');await content(a,'QA hidden by filter','Survey');await a.click('保存並關閉');await until(()=>a.eval(`!${taskDialog}`),'hidden item saved');
   assert.equal(await a.eval("document.querySelector('input[placeholder=\"船名、事項、狀態...\"]').value"),'QA total created');assert.equal(await a.eval("document.querySelector('.batch-selection-count').textContent"),'已選 1');assert.equal(await a.eval("window.__qaOriginalList===document.querySelector('.selected-task-list-panel')"),true);assert.ok((await read()).payload.tasks.some(t=>t.description.includes('QA hidden by filter')));
   assert.match(await a.eval("document.querySelector('.save-toast')?.textContent||''"),/不符合.*篩選/,'successful but filtered-out new task needs an explicit notice');
   await a.click('清除篩選');await until(()=>a.eval("document.querySelectorAll('.selected-task-list-panel .batch-task-table tbody tr').length===3"),'clear reveals all');
 });
 await check('desktop-mobile-layout-and-reload-durability',async()=>{
   for(const width of [1280,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},a.s);await a.eval('document.fonts.ready');if(await a.eval("Boolean(document.querySelector('.save-toast button'))"))await a.activate("document.querySelector('.save-toast button')");await a.eval("document.querySelector('.selected-task-list-panel').scrollIntoView({block:'start'});");await a.eval("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");const entryGeometry=await a.eval("(()=>{const n=document.querySelector('button[aria-label=新增要事]'),s=getComputedStyle(n),r=n.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,top:r.top,height:r.height,display:s.display,visibility:s.visibility,overflow:n.scrollWidth>n.clientWidth};})()");assert.ok(entryGeometry.height>0&&entryGeometry.top>=0&&entryGeometry.top+entryGeometry.height<=1000&&entryGeometry.left>=0&&entryGeometry.right<=width);assert.notEqual(entryGeometry.display,'none');assert.equal(entryGeometry.visibility,'visible');assert.equal(entryGeometry.overflow,false);receipt.entryGeometry??=[];receipt.entryGeometry.push(entryGeometry);await a.screen('total-'+width);await a.click('新增要事');await until(()=>a.eval("Boolean(document.querySelector('.task-create-picker')?.open)"),'responsive picker');const geometry=await a.eval("(()=>{const r=document.querySelector('.task-create-picker').getBoundingClientRect();return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,left:r.left,right:r.right,height:r.height};})()");assert.equal(geometry.overflow,false);assert.ok(geometry.left>=0&&geometry.right<=width&&geometry.height>0);receipt.geometry??=[];receipt.geometry.push(geometry);await a.screen('picker-'+width);await a.click('取消');}
   const before=await read();await call('Page.reload',{},a.s);await until(()=>a.eval("Boolean(document.querySelector('article.ship-card'))"),'same-session fresh document');await a.sync();await a.click('待辦總表');await a.click('清除篩選');await until(()=>a.eval("document.querySelectorAll('.selected-task-list-panel .batch-task-table tbody tr').length===3"),'durable fresh-document rows');assert.equal((await read()).payload.tasks.length,3);assert.deepEqual((await read()).payload.vessels,before.payload.vessels);assert.match(await a.text(),/QA hidden by filter/);
 });
 assert.equal(receipt.errors.length,0,JSON.stringify(receipt.errors));assert.equal(receipt.blockedExternal.length,0);receipt.status='PASS';
} catch(error){failure=error;receipt.status='FAIL';receipt.failure=String(error.stack||error);for(const p of actors)try{fs.writeFileSync(path.join(run,'failure-'+p.actor+'.txt'),await p.text());}catch{}if(a)try{await a.screen('failure');fs.writeFileSync(path.join(run,'failure-ui.txt'),await a.text());fs.writeFileSync(path.join(run,'failure-sql.json'),JSON.stringify(scrub(await read()),null,2));fs.writeFileSync(path.join(run,'failure-list.json'),JSON.stringify(await a.eval("(()=>{const n=document.querySelector('.selected-task-list-panel');if(!n)return null;let f=n[Object.keys(n).find(k=>k.startsWith('__reactFiber'))];while(f&&f.type?.name!=='ListPanel')f=f.return;return [f,f?.alternate].map(f=>f?{tasks:f.memoizedProps?.tasks,filters:f.memoizedProps?.filters,canEdit:f.memoizedProps?.canEdit,vessels:f.memoizedProps?.visibleVessels.map(v=>({id:v.id,active:v.isActive})),dataTaskIds:f.memoizedProps?.data?.tasks?.map(t=>t.id)}:null);})()"),null,2));fs.writeFileSync(path.join(run,'failure-react.json'),JSON.stringify(await a.eval("(()=>{const n=document.querySelector('.app');if(!n)return null;let f=n[Object.keys(n).find(k=>k.startsWith('__reactFiber'))];while(f&&f.type?.name!=='App')f=f.return;const out=[];for(let h=f?.memoizedState;h;h=h.next){const v=h.memoizedState;if(v&&Array.isArray(v.tasks))out.push({revision:v.revision,tasks:v.tasks,vessels:v.vessels,scope:v._cloudRecordCoverage});}return out;})()"),null,2));}catch{};}
finally {
 if(releaseCommit)releaseCommit();if(qa)qa.setRecordFault(null);
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){await until(()=>browser.exitCode!==null,'Chrome exit',7000).catch(()=>{if(process.platform==='win32')spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F']);else browser.kill('SIGKILL');});}
 if(qa)await qa.close();if(native)await native.close();
 receipt.chromeStopped=chromePort?await portClosed(Number(chromePort)):true;
 receipt.commands[0].exit=failure?1:0;save();
}
console.log(JSON.stringify({status:receipt.status,cases:receipt.cases,errors:receipt.errors,failure:receipt.failure,evidence:run,stopped:receipt.stopped,chromeStopped:receipt.chromeStopped},null,2));
if(failure)throw failure;

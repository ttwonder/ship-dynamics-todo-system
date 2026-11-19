// From the repo root (Windows native PG + Chrome), using a repo-external QA_EVIDENCE_ROOT:
// node scripts/verify-internal-close-scoped-browser.mjs [--baseline] [same-vessel|other-vessel|task|rewrite|rollback]
// --baseline always runs the healthy-save assertion, i.e. it exits nonzero on the reported bug.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';

const args=process.argv.slice(2), baseline=args.includes('--baseline'), scenario=args.find(s=>s!=='--baseline')??'same-vessel';
assert.ok(['same-vessel','other-vessel','task','rewrite','rollback'].includes(scenario));
assert.equal(args.filter(s=>s!=='--baseline').length,Number(args.some(s=>s!=='--baseline')));
const source=process.cwd(), evidence=process.env.QA_EVIDENCE_ROOT, baseCommit='c8c860a5b28ffa5ab340bf471b151c651dce657a';
assert.ok(evidence&&path.isAbsolute(evidence)&&(path.relative(source,evidence).startsWith('..'+path.sep)||path.isAbsolute(path.relative(source,evidence))), 'external absolute QA_EVIDENCE_ROOT required');
const root=path.resolve(evidence);fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,`${baseline?'baseline':'local'}-${scenario}-`)),tree=path.join(run,'site'),profile=path.join(run,'chrome');
const hash=x=>createHash('sha256').update(x).digest('hex');
const write=(name,x)=>fs.writeFileSync(path.join(run,name),JSON.stringify(x,(k,v)=>/password|token|anonkey/i.test(k)?'[omitted]':v,2));
const receipt={scenario,layer:'original main.tsx / App / real v2 projections and native loopback PostgreSQL; synthetic owner',run,status:'RUNNING',probeSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),reads:[],writers:[],dialogs:[],errors:[],blocked:[]};
const save=()=>write('receipt.json',receipt);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=25000){const end=Date.now()+ms;do{const v=await fn();if(v)return v;await wait(50);}while(Date.now()<end);throw Error('Timeout: '+label);}
const closed=port=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));s.setTimeout(1000,()=>{s.destroy();resolve(false);});});
const C='ic-scope-existing',S='source-linked',U='source-sibling',T='ic-scope-task',title='QA spares existing case',date='2026-06-12',dl='2026-06-30',rpc='apply_ship_dynamics_record_patch_v1',readRpc='read_ship_dynamics_record_scopes_v2';
const logRows=(key,n)=>Array.from({length:n},(_,i)=>({id:`${key}-log-${i}`,at:`2026-06-0${n-i}T08:30:00.000Z`,by:'QA OWNER',byUserId:'qa-owner',text:`${key} history ${i}`}));
const imports=name=>import(pathToFileURL(path.join(tree,'scripts',name)));
let qa,native,browser,ws,session,port,number=0,stage='setup',failed;
const links=[],pending=new Map();
const cdp=(method,params={},s=session)=>new Promise((resolve,reject)=>{const id=++number,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,m=>{clearTimeout(t);m.error?reject(Error(m.error.message)):resolve(m.result);});ws.send(JSON.stringify({id,method,params,...(s?{sessionId:s}:{})}));});
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
const body=()=>evaluate('document.body?.innerText||""');
const screen=async name=>fs.writeFileSync(path.join(run,name+'.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
async function activate(expr){await until(()=>evaluate(`(()=>{const n=${expr};if(!n||!n.getClientRects().length||n.disabled)return false;n.focus();return document.activeElement===n;})()`),'enabled control '+expr);await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
const button=(label,where='document')=>`[...(${where}).querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(label)}&&b.getClientRects().length&&!b.disabled)`;
const click=(label,where)=>activate(button(label,where));
async function password(){await evaluate("document.querySelector('input[type=password]').focus()");await cdp('Input.insertText',{text:qa.password});}
const state=async()=> (await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;
const leases=async()=> (await native.observer.query('select section_key from ship_dynamics_edit_locks where workspace_key=$1 and expires_at>now() order by section_key',[qa.workspace])).rows.map(r=>r.section_key);
const by=(payload,collection,id)=>payload[collection].find(row=>row.id===id);
function startInterception(){ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id){const cb=pending.get(m.id);pending.delete(m.id);cb?.(m);return;}
 const handle=async()=>{
  if(m.method==='Network.responseReceived'&&m.params.response.status>=400)(receipt.resourceErrors??=[]).push([m.params.response.status,m.params.response.url]);
  if(m.method==='Log.entryAdded'&&['warning','error'].includes(m.params.entry.level))(receipt.browserLog??=[]).push(m.params.entry.text);
  if(m.method==='Fetch.requestPaused'){const url=new URL(m.params.request.url),allowed=url.origin===qa.origin||['data:','blob:'].includes(url.protocol);if(!allowed)receipt.blocked.push(url.origin);await cdp(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(!allowed?{errorReason:'BlockedByClient'}:{})},m.sessionId);}
  if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  if(m.method==='Page.javascriptDialogOpening'){const {type,message}=m.params;receipt.dialogs.push({stage,type,message});await cdp('Page.handleJavaScriptDialog',{accept:type==='beforeunload'||type==='alert'},m.sessionId);}
 };void handle().catch(e=>receipt.errors.push(e.message));});}
async function sourceSnapshot(){
 fs.mkdirSync(tree);const selected=['src','scripts','supabase','public','package.json','package-lock.json','index.html','ship-itinerary.html','ship-internal-control.html','packageorwork-tracking.html','vite.config.ts','tsconfig.json'];
 if(baseline){const archive=path.join(run,'baseline.tar');execFileSync('git',['archive','-o',archive,baseCommit,'--',...selected],{windowsHide:true});execFileSync('tar.exe',['-xf','baseline.tar','-C','site'],{cwd:run,windowsHide:true});fs.unlinkSync(archive);}
 else for(const p of selected)fs.cpSync(path.join(source,p),path.join(tree,p),{recursive:true});
 receipt.productSource=baseline?baseCommit:'working files at '+source;receipt.head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 receipt.inputs=Object.fromEntries(['src/App.tsx','src/cloudRecordScopes.ts','src/cloudRebase.ts','src/InternalControlModals.tsx','src/tracking/trackingLifecycle.ts','scripts/tracking-browser-fixture.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs'].map(p=>[p,hash(fs.readFileSync(path.join(tree,p)))]));
 const deps=path.join(tree,'node_modules');fs.mkdirSync(deps);for(const entry of fs.readdirSync(path.join(source,'node_modules'),{withFileTypes:true})){if(entry.name.startsWith('.')||!(entry.isDirectory()||entry.isSymbolicLink()))continue;const to=path.join(deps,entry.name);fs.symlinkSync(path.join(source,'node_modules',entry.name),to,'junction');links.push(to);}
 process.env.QA_VITE_CACHE_DIR=path.join(deps,'.vite');process.env.GITHUB_SHA=baseline?baseCommit:receipt.head;process.env.VITE_BASE_PATH='/';process.chdir(tree);
}
async function setup(){
 const {createNativeRecordQa}=await imports('record-storage-native-qa.mjs'),{createRecordStorageLocalQa}=await imports('record-storage-local-qa.mjs');
 const {build}=await import('vite');const dist=path.join(tree,'dist');await build({root:tree,envDir:false,build:{outDir:dist},logLevel:'error'});
 receipt.mainHtmlSha256=hash(fs.readFileSync(path.join(dist,'index.html')));receipt.bundles=Object.fromEntries(fs.readdirSync(path.join(dist,'assets')).filter(p=>p.endsWith('.js')).map(p=>[p,hash(fs.readFileSync(path.join(dist,'assets',p)))]));
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true,initTimeoutMs:120000});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,tracking:true,scopedRead:true,taskMember:true,performanceTrace:true,hmr:false,databaseFactory:async()=>native.adapter,preparePerformanceFixture:initial=>{
  const c=initial.internalControlCases.find(c=>c.id==='qa-withdraw'),t=initial.tasks.find(t=>t.id===c.linkedTaskId),logs=logRows(C,3);
  Object.assign(c,{id:C,vesselId:'qa-v1',reportDate:'2026-06-01',expectedDate:dl,description:title,status:logs[0].text,statusLogs:logs,syncToTask:scenario==='task',trackingItemId:S,trackingLinkState:'active'});
  if(scenario==='task'){c.linkedTaskId=T;Object.assign(t,{id:T,internalControlCaseId:C,reportDate:c.reportDate,description:title,status:c.status,statusLogs:structuredClone(logs),expectedDate:dl});}else delete c.linkedTaskId;
  // A non-targeted case with a private history tail, plus an unrelated task. Both must survive.
  const other=initial.internalControlCases.find(c=>c.id==='qa-restricted');delete other.linkedTaskId;other.syncToTask=false;other.statusLogs=logRows(other.id,4);other.status=other.statusLogs[0].text;
  initial.internalControlCases=[c,other];initial.tasks=[...(scenario==='task'?[t]:[]),initial.tasks.find(t=>t.id==='qa-unrelated-task')];initial.notifications=[];initial.taskDismissals=[];initial.auditLogs=[];
 }});
 // Serve only the private production bundle, leaving the original fixture's
 // health, synthetic config and RPC -> native transaction routing in front of it.
 qa.setUiMiddleware((req,res,next)=>{const url=new URL(req.url,qa.origin),name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)),file=path.resolve(dist,name);if(file.startsWith(dist+path.sep)&&fs.statSync(file,{throwIfNoEntry:false})?.isFile()){res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');fs.createReadStream(file).pipe(res);}else next();});
 const {installTrackingBrowserMigrations,installTrackingFieldRevision}=await imports('tracking-browser-fixture.mjs');await installTrackingBrowserMigrations(qa.db);await installTrackingFieldRevision(qa.db);
 for(const name of ['20260929090000_tracking_delivery_notes','20260929120000_tracking_delivery_close','20260929180000_tracking_completion_close','20261008090000_tracking_unrelated_patch_fast_path','20261009060000_record_reader_inline_bodies','20261013110000_task_unrelated_tracking_fast_path'])await qa.db.exec(fs.readFileSync('supabase/migrations/'+name+'.sql','utf8'));
 const rows=[S,U].map(id=>({id,kind:'supply',requestType:'spares',vesselId:id===U&&scenario==='other-vessel'?'qa-v2':'qa-v1',referenceNo:'QA-SHARED-REF',description:'QA spare '+id,applicationDate:'2026-06-01',expectedDate:dl,urgency:'normal',supplementalNotes:id,deliveryStatus:'not-delivered',isClosed:false,createdAt:'2026-06-01T00:00:00.000Z',updatedAt:'2026-06-03T08:30:00.000Z',createdBy:'qa-owner',updatedBy:'qa-owner',statusLogs:logRows(id,3),progress:id+' history 0',events:[],source:{fileName:'synthetic.xlsx',sheetName:'spares',row:id===S?3:4,originalValues:{fixture:id}},...(id===S?{linkedCaseId:C,linkState:'active'}:{})}));
 Object.assign(rows[0],{deliveryStatus:'delivered',actualDeliveryDate:'2026-06-10'});
 await native.adapter.transaction(async tx=>{await tx.query("insert into ship_dynamics_record_collections(workspace_key,collection,ids) values($1,'trackingItems',$2::jsonb)",[qa.workspace,JSON.stringify(rows.map(r=>r.id))]);await tx.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) select $1,'trackingItems',r->>'id',r,1 from jsonb_array_elements($2::jsonb) r",[qa.workspace,JSON.stringify(rows)]);});
 qa.setRecordFault({before:({name,body:b})=>{if(name===rpc){receipt.writers.push({stage,operationId:b.p_operation_id,ops:b.p_operations.map(o=>({collection:o.collection,id:o.entityId,kind:o.kind})),locks:b.p_lock_guards.map(l=>l.section_key)});}},after:({name,body:b,value:v})=>{if(name===readRpc){receipt.reads.push({stage,scope:b.p_scope,targets:b.p_targets,vessels:b.p_vessel_ids,revision:v.revision,trackingIds:v.collections.trackingItems.ids,rows:Object.fromEntries(['internalControlCases','tasks','trackingItems'].map(c=>[c,v.collections[c].rows.map(r=>({id:r.id,detail:r.detail,logs:r.value.statusLogs?.length}))]))});}return false;}});
 receipt.origin=qa.origin;assert.equal(new URL(qa.origin).hostname,'127.0.0.1');assert.equal((await (await fetch(qa.origin+'/__qa/health')).json()).kind,'REAL_UI_SYNTHETIC_DATA_NATIVE_POSTGRES');
}
async function mount(){
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-default-apps','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});const portFile=path.join(profile,'DevToolsActivePort');const [p,socket]=await until(()=>{try{const pair=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);return pair[1]?.startsWith('/devtools/browser/')&&pair;}catch{return false;}},'Chrome ready');port=+p;receipt.chrome={pid:browser.pid,port};ws=new WebSocket(`ws://127.0.0.1:${port}${socket}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});startInterception();
 const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});({sessionId:session}=await cdp('Target.attachToTarget',{targetId,flatten:true}));for(const m of ['Page.enable','Runtime.enable','Network.enable','Log.enable'])await cdp(m);await cdp('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 stage='home';await cdp('Page.navigate',{url:qa.origin});await until(async()=>(await body()).includes('請輸入管理者設定的進站密碼。'),'site gate');
 await password();await click('進入系統');await until(async()=>(await body()).includes('人員登入／切換'),'personnel gate');await password();await click('登入');await until(async()=>(await body()).includes('QA OWNER')&&!(await body()).includes('人員登入／切換'),'original Home');
 await until(()=>receipt.reads.some(r=>r.scope==='home'&&r.trackingIds.length===0),'native Home excludes tracking');
 stage='open';await click('內控異常');const row=`[...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.querySelector('.ic-description-column')?.innerText.trim()===${JSON.stringify(title)})`;await until(()=>evaluate(`Boolean(${row})`),'exact case row');await click('更新',row);await until(()=>evaluate("document.querySelectorAll('.ic-edit-modal .status-history article').length===3"),'three full mounted history rows');
 receipt.editorText=await evaluate("document.querySelector('.ic-edit-modal').innerText");assert.equal(await evaluate("[...document.querySelectorAll('.ic-edit-modal label')].find(n=>n.innerText.includes('同步')&&n.innerText.includes('要事')).querySelector('input').checked"),scenario==='task');assert.ok(receipt.reads.some(r=>r.scope==='targets'&&r.trackingIds.includes(S)&&!r.trackingIds.includes(U)),'real graph-only source read');await screen('01-editor');
}
async function closeForm(){await click('結案並保存');await until(()=>evaluate("Boolean(document.querySelector('#ic-close-date'))"),'visible close date dialog');await evaluate(`(()=>{const n=document.querySelector('#ic-close-date');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(date)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await screen('02-confirm-date');}
const saved=()=>evaluate("!document.querySelector('.ic-edit-modal')&&Boolean(document.querySelector('.save-status-strip.saved'))");
async function confirm(label){stage=label;await click('確認結案');return until(async()=>await saved()?'saved':receipt.dialogs.find(d=>d.stage===label&&d.type==='alert')?.message,'close result '+label,35000);}
async function exercise(){
 const pre=await state();write('before.json',pre);await mount();assert.deepEqual(await state(),pre,'opening should not mutate work records');assert.equal(receipt.writers.length,0);
 await closeForm();const expectedLocks=['internal-control:'+C,'tracking:'+S,...(scenario==='task'?['task:'+T]:[])].sort();
 if(scenario==='rewrite'){
  // Deliberately violate immutable history in the private fixture AFTER the editor read.
  await native.observer.query(`with bumped as (update ship_dynamics_record_workspaces set revision=revision+1,root=jsonb_set(root,'{revision}',to_jsonb(revision+1)) where workspace_key=$1 returning revision) update ship_dynamics_records set revision=(select revision from bumped), value=jsonb_set(value,'{statusLogs,2,text}',to_jsonb('QA peer rewrote old log'::text)) where workspace_key=$1 and collection='internalControlCases' and entity_id=$2`,[qa.workspace,C]);
 }
 const before=await state();
 if(scenario==='rollback')await native.observer.query(`create function qa_stop_close() returns trigger language plpgsql as $$begin raise exception 'QA forced rollback of source close' using errcode='57014';end$$;create trigger qa_stop_close before update on ship_dynamics_records for each row when(new.collection='trackingItems' and new.entity_id='source-linked') execute function qa_stop_close()`);
 const result=await confirm('submit');receipt.firstOutcome=result;
 if(result!=='saved'){
  await wait(200);const observed=await state();write('rejected.json',observed);receipt.rejection={unchanged:JSON.stringify(observed)===JSON.stringify(before),writerCount:receipt.writers.length,date:await evaluate("document.querySelector('#ic-close-date')?.value"),editorOpen:await evaluate("Boolean(document.querySelector('.ic-edit-modal'))"),body:(await body()).slice(-4000)};await screen('03-rejected');
  assert.deepEqual(observed,before);assert.equal(receipt.rejection.editorOpen,true);assert.equal(receipt.rejection.date,date);
  if(baseline&&scenario==='same-vessel'){assert.match(result,/缺少可信的雲端合併基線/);assert.equal(receipt.writers.length,0);assert.ok(receipt.reads.some(r=>r.stage==='submit'&&r.revision===before.revision&&r.vessels.includes('qa-v1')&&r.trackingIds.includes(S)&&r.trackingIds.includes(U)),'same revision unexpectedly exposed an unlinked sibling');}
  if(scenario==='rewrite'){assert.equal(receipt.writers.length,0);assert.equal(result,'內控狀態歷程只能附加，不得刪除或改寫既有紀錄');assert.equal(by(observed.payload,'internalControlCases',C).statusLogs[2].text,'QA peer rewrote old log');return;}
  if(scenario==='rollback'){const txs=receipt.httpTransactions.filter(t=>t.rpc===rpc);assert.ok(txs.length>0&&txs.every(t=>t.rolledBack&&t.errorCode==='57014'),'all writer transactions rolled back');assert.equal(new Set(receipt.writers.map(w=>w.operationId)).size,1);assert.match(result,/57014/);assert.equal(await saved(),false);await native.observer.query('drop trigger qa_stop_close on ship_dynamics_records;drop function qa_stop_close()');receipt.rollback={attempts:txs.length,commits:0,fullReadbackUnchanged:true,retainedDate:date};return;}
 }
 assert.equal(result,'saved','existing linked case must close: '+result);assert.ok(!['rewrite','rollback'].includes(scenario),'genuine history rewrite and native rollback cannot save');
 if(scenario!=='other-vessel')assert.ok(receipt.reads.filter(r=>['submit','retry'].includes(r.stage)).every(r=>r.scope!=='full'&&!r.trackingIds.includes(U)),'commit preparation and confirmation must not load unrelated tracking siblings');
 await until(async()=>(await leases()).length===0,'owned locks released');const after=await state();write('after.json',after);assert.equal(after.revision,before.revision+1);
 const c=by(after.payload,'internalControlCases',C),s=by(after.payload,'trackingItems',S),t=by(after.payload,'tasks',T);for(const [coll,m] of [['internalControlCases',c],['trackingItems',s],...(scenario==='task'?[['tasks',t]]:[])]){const old=by(before.payload,coll,m.id);assert.equal(m.isClosed,true);assert.equal(m.closedDate,date);assert.equal(m.expectedDate,dl);assert.equal(m.closedBy,'qa-owner');assert.deepEqual(m.statusLogs,old.statusLogs);}
 assert.equal(s.linkedCaseId,c.id);assert.equal(c.trackingItemId,s.id);assert.equal(s.deliveryStatus,'delivered');assert.equal(s.actualDeliveryDate,'2026-06-10');assert.equal(s.events.at(-1).action,'close');assert.equal(s.events.at(-1).entry,'internal-control');assert.deepEqual(s.events.slice(0,-1),by(before.payload,'trackingItems',S).events);assert.deepEqual(c.trackingLifecycle.at(-1),s.events.at(-1));assert.deepEqual(s.source,by(before.payload,'trackingItems',S).source);
 if(scenario==='task'){assert.equal(c.linkedTaskId,T);assert.equal(t.internalControlCaseId,C);}else{assert.equal(c.syncToTask,false);assert.equal(c.linkedTaskId,undefined);assert.deepEqual(after.payload.tasks,before.payload.tasks);}
 for(const [coll,ids] of [['internalControlCases',[C]],['trackingItems',[S]],['tasks',scenario==='task'?[T]:[]],['meetings',[]],['agendaReports',[]]])assert.deepEqual(after.payload[coll].filter(r=>!ids.includes(r.id)),before.payload[coll].filter(r=>!ids.includes(r.id)),'exact sibling records: '+coll);
 const terminal=receipt.writers.filter(w=>w.stage===stage);assert.equal(terminal.length,1);assert.deepEqual(terminal[0].locks.slice().sort(),expectedLocks);const touched=terminal[0].ops.filter(o=>o.kind==='entity'&&['internalControlCases','trackingItems','tasks'].includes(o.collection)).map(o=>o.id).sort();assert.deepEqual(touched,[C,S,...(scenario==='task'?[T]:[])].sort());assert.equal(receipt.httpTransactions.filter(t=>t.rpc===rpc&&t.committed&&t.status==='SQL_OK').length,1);
 await screen('04-committed');receipt.success={revision:after.revision,date,dl,writerCount:terminal.length,exactMembers:touched,unchangedSiblings:true};
}
try{await sourceSnapshot();save();await setup();await exercise();assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.blocked,[]);receipt.status='PASS';}
catch(e){failed=e;receipt.failure={stage,message:e.message,stack:e.stack};receipt.status='FAIL';if(session)try{receipt.failureText=(await body()).slice(-6000);await screen('failure');}catch{};}
finally{
 receipt.metrics=qa?.metrics??[];
 const chromeGone=()=>{if(!browser||browser.exitCode!==null||browser.signalCode!==null)return true;try{process.kill(browser.pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}};
 if(ws?.readyState===WebSocket.OPEN){try{await cdp('Browser.close',{},null);}catch{}ws.close();}
 for(const fn of [()=>qa?.close(),()=>native?.close(),async()=>{try{await until(chromeGone,'owned Chrome exits',15000);}catch{execFileSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await until(chromeGone,'owned Chrome stopped',5000);}},async()=>{receipt.cleanup={chrome:chromeGone(),cdp:!port||await closed(port),pg:native?receipt.stopped&&receipt.portClosed&&receipt.ownedDataRemoved:true,http:!qa||await closed(+new URL(qa.origin).port)};assert.ok(Object.values(receipt.cleanup).every(Boolean));},async()=>{process.chdir(source);for(const l of links)fs.unlinkSync(l);for(const p of [tree,profile])await fs.promises.rm(p,{force:true,recursive:true,maxRetries:10,retryDelay:250});}])try{await fn();}catch(e){(receipt.cleanupErrors??=[]).push(e.message);failed??=e;receipt.status='FAIL';}
 save();console.log(JSON.stringify({status:receipt.status,scenario,baseline,run,outcome:receipt.firstOutcome,success:receipt.success,cleanup:receipt.cleanup,failure:receipt.failure?.message}));if(failed)process.exitCode=1;
}

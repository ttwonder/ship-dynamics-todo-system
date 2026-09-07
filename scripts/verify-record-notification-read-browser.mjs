import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {seedWorkCenter} from './record-work-center-local-fixture.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-notification-read-'));
const profile=path.join(output,'chrome-profile');
const mode=process.argv.includes('--reject')?'reject':process.argv.includes('--identity-switch')?'identity':process.argv.includes('--tracer-only')?'tracer':'receipt';
let qa,browser,ws,failure=null,sessionId,releaseHeldReceipt;
const pending=new Map(),evidence={label:'Original UI / SupabaseJS / private local PGlite; NOT hosted Supabase',mode,scenarios:[],errors:[],blockedExternal:[]};
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
const key=async(key,code=key)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code});};
const select=async(expression,value)=>{
 const index=await evaluate(`(()=>{const n=${expression};if(!n||n.disabled)throw new Error('select unavailable');n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(index>=0,'option '+value);
 await key('Home');for(let i=0;i<index;i++)await key('ArrowDown');await key('Enter');
 await until(async()=>await evaluate(`(${expression}).value`)===value,'selected '+value);
};
const snapshot=async(name)=>{const data=await qa.read();fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(data,null,2));return data;};
const screen=async(name)=>{const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(image.data,'base64'));};
const check=async(name,run)=>{await run();assert.ok(!evidence.scenarios.includes(name));evidence.scenarios.push(name);console.log('PASS',name);};
const phase=()=>evaluate("document.querySelector('.save-phase b')?.innerText");
const local=()=>evaluate("JSON.parse(localStorage.getItem('ship-dynamics-app-data-v1'))");
const goWork=async()=>{await nodeClick("[...document.querySelectorAll('nav button')].find(n=>n.innerText.startsWith('我的待辦'))");await until(()=>evaluate("Boolean(document.querySelector('.work-center'))"),'original WorkCenter');};
const badge=()=>evaluate("document.querySelector('.work-center .unread-count')?.innerText||''");
const switchTo=async(user)=>{
 await click('切換/退出');await until(async()=>(await text()).includes('人員登入／切換'),'original switch gate');
 await select(`document.querySelector('[aria-label="登入人員"]')`,user);
 await fill('input[type="password"]',qa.password);await click('登入');
 await until(async()=>(await text()).includes(user==='qa-owner'?'QA OWNER｜Owner':'QA OPERATOR｜操作員')&&!(await text()).includes('人員登入／切換'),'current original identity');
};
const patchMetrics=start=>qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status!=='ACK_DROPPED_AFTER_SQL');
const storage=async()=>{
 const result={};for(const {tablename} of (await qa.db.query("select tablename from pg_tables where schemaname='public' and (tablename='ship_dynamics_records' or tablename like 'ship_dynamics_record_%') order by tablename")).rows){
  assert.match(tablename,/^(ship_dynamics_records|ship_dynamics_record_[a-z_]+)$/);
  result[tablename]=(await qa.db.query(`select to_jsonb(t) value from ${tablename} t order by to_jsonb(t)::text`)).rows;
 }assert.ok(Object.keys(result).length>=7);return result;
};
const verifyReadDelta=(before,after)=>{
 assert.equal(after.revision,before.revision+1);assert.equal(after.payload.revision,before.payload.revision+1);
 assert.notEqual(after.payload.updatedAt,before.payload.updatedAt);assert.ok(Number.isFinite(Date.parse(after.payload.updatedAt)));
 const expected=structuredClone(before.payload);expected.revision++;expected.updatedAt=after.payload.updatedAt;
 // Receipt timestamp is the click; records-v1 root updatedAt is server commit time.
 const readAt=after.payload.notifications.find(n=>n.id==='qa-own-1').readAt;
 assert.ok(Date.parse(readAt)>Date.parse(before.payload.updatedAt)&&Date.parse(readAt)<=Date.parse(after.payload.updatedAt));
 let changed=0;for(const n of expected.notifications)if(n.userId==='qa-owner'&&!n.readAt){n.readAt=readAt;changed++;}
 assert.equal(changed,4);assert.deepEqual(after.payload,expected,'only own unread receipts and root metadata may change');
 assert.ok(before.payload.auditLogs.length>0,'nonempty audit oracle');
};
try{
 qa=await createRecordStorageLocalQa({internalControl:true});await seedWorkCenter(qa);
 const seed=await qa.read(),at=seed.payload.updatedAt;
 const notice=(id,userId,taskId,readAt)=>({id,userId,vesselId:taskId==='qa-unrelated-task'?'qa-v2':'qa-v1',taskId,kind:'task_updated',title:'QA notification '+id,message:'QA immutable message',actorId:userId==='qa-owner'?'qa-operator':'qa-owner',createdAt:at,...(readAt?{readAt}: {})});
 const notices=[notice('qa-own-1','qa-owner','qa-personal-task'),notice('qa-own-2','qa-owner','qa-personal-task'),notice('qa-own-filtered','qa-owner','qa-complete-task'),notice('qa-own-outside-work','qa-owner','qa-unrelated-task'),notice('qa-own-read','qa-owner','qa-delete-task',at),notice('qa-other-unread','qa-operator','qa-personal-task'),notice('qa-other-read','qa-operator','qa-complete-task',at)];
 await qa.db.transaction(async tx=>{
  await tx.query("delete from ship_dynamics_records where workspace_key=$1 and collection='notifications'",['isolated-record-ui-qa']);
  for(const n of notices)await tx.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,'notifications',$2,$3::jsonb,$4)",['isolated-record-ui-qa',n.id,JSON.stringify(n),seed.revision]);
  await tx.query("update ship_dynamics_record_collections set ids=$2::jsonb where workspace_key=$1 and collection='notifications'",['isolated-record-ui-qa',JSON.stringify(notices.map(n=>n.id))]);
  const audits=['qa-owner','qa-operator'].map((actorId,index)=>({id:'qa-audit-'+index,at,actorId,actorName:index?'QA OPERATOR':'QA OWNER',actorRole:index?'operator':'owner',action:'更新要事',entityType:'task',entityId:index?'qa-complete-task':'qa-personal-task',detail:'QA existing historical audit',ipAddress:'192.0.2.20',ipCountryCode:'TW'}));
  for(const a of audits)await tx.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,'auditLogs',$2,$3::jsonb,$4)",['isolated-record-ui-qa',a.id,JSON.stringify(a),seed.revision]);
  await tx.query("update ship_dynamics_record_collections set ids=$2::jsonb where workspace_key=$1 and collection='auditLogs'",['isolated-record-ui-qa',JSON.stringify(audits.map(a=>a.id))]);
  await tx.query("update ship_dynamics_record_versions set orders=(select jsonb_object_agg(collection,ids) from ship_dynamics_record_collections where workspace_key=$1) where workspace_key=$1",['isolated-record-ui-qa']);
 });
 const baseline=await snapshot('fixture-baseline');
 const legacyBefore=(await qa.db.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows;
 assert.equal(legacyBefore[0].value.revision,99);assert.equal(baseline.revision,1);
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
   (evidence.dialogs??=[]).push(message.params);
   const expected=message.params.type==='beforeunload'||(message.params.type==='confirm'&&message.params.message.startsWith('同步最新會保留本機修改'));if(!expected)evidence.errors.push('Unexpected dialog '+message.params.message);
   void call('Page.handleJavaScriptDialog',{accept:expected},message.sessionId);
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

 await goWork();await until(async()=>await badge()==='2 筆更新','deduplicated own visible badge');
 await check('login-and-unchanged-item-open-no-read-no-audit-save',async()=>{
  await click('QA PERSONAL TASK');await until(()=>evaluate("Boolean(document.querySelector('.modal-backdrop'))"),'original item open');
  await wait(1100);assert.deepEqual(await qa.read(),baseline);assert.equal(patchMetrics(0).length,0);
  // Original unchanged editor cancel via native Escape, never call React handlers.
  await key('Escape');await until(()=>evaluate("!document.querySelector('.modal-backdrop')"),'unchanged item closes');
  await until(async()=>(await qa.db.query("select count(*)::int n from ship_dynamics_edit_locks where expires_at>now()")).rows[0].n===0,'normal editor lease released');
  await wait(1100);assert.deepEqual(await qa.read(),baseline);assert.equal(patchMetrics(0).length,0);assert.equal(await badge(),'2 筆更新');
 });
 await fill('[aria-label="我的待辦關鍵字"]','QA PERSONAL TASK');await until(()=>evaluate("document.querySelectorAll('.work-task-row').length===1"),'one filtered task');
 assert.equal(await badge(),'2 筆更新','badge uses all visible tasks, not filtered page');await screen('before-mark-read');
 const start=qa.metrics.length;let dropped=false,lookup=false,submitted;
 if(mode==='reject'){
  await qa.db.exec(`create function qa_reject_read() returns trigger language plpgsql as $$ begin if new.collection='notifications' and new.entity_id='qa-own-2' and new.value ? 'readAt' then raise exception 'QA intentional notification write rejection'; end if; return new; end $$;
  create trigger qa_reject_read before update on ship_dynamics_records for each row execute function qa_reject_read();`);
  const beforeStorage=await storage();await click('全部標記已讀');
  await until(()=>qa.metrics.slice(start).some(m=>m.status==='SQL_ERROR'),'actual transaction rejection');
  await until(async()=>await phase()==='保存未完成','original global error presentation');await wait(1200);
  await check('sql-rejection-zero-partial-and-no-false-saved',async()=>{
   assert.deepEqual(await qa.read(),baseline);assert.deepEqual(await storage(),beforeStorage);assert.equal(await phase(),'保存未完成');
   const cache=await local();assert.ok(cache.notifications.filter(n=>n.userId==='qa-owner').every(n=>n.readAt),'optimistic local result retained, not cloud success');
   assert.ok(patchMetrics(start).every(m=>m.status==='SQL_ERROR'));evidence.rejectedAttempts=patchMetrics(start).length;
  });await screen('rejected');
 }else{
  if(mode!=='tracer'){
   const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});
   qa.setRecordFault({before:async({name,body})=>{if(name==='get_ship_dynamics_record_receipt_v1'&&dropped){lookup=true;assert.deepEqual(body,submitted,'same operation and immutable arguments');await held;}},after:async({name,body,value})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!dropped){assert.equal(value.ok,true);dropped=true;submitted=structuredClone(body);return true;}return false;}});
  }
  await click('全部標記已讀');
  if(mode!=='tracer'){
   await until(()=>lookup,'lost reply receipt lookup');
   await check('committed-held-receipt-optimistic-read-but-not-global-saved',async()=>{
    const committed=await snapshot('committed-held');verifyReadDelta(baseline,committed);assert.equal(await badge(),'');assert.notEqual(await phase(),'已安全保存');
    assert.equal(patchMetrics(start).length,1);assert.ok(!qa.metrics.slice(start).some(m=>m.rpc.includes('edit_lock')));
    evidence.operationId=submitted.p_operation_id;await screen('held');
   });
   if(mode==='identity'){
    await switchTo('qa-operator');await goWork();assert.equal(await badge(),'1 筆更新');
    evidence.identityBeforeRelease=await text();
   }
   releaseHeldReceipt();releaseHeldReceipt=null;
  }
  if(mode!=='identity')await until(async()=>await phase()==='已安全保存','confirmed global saved');
  else await until(()=>qa.metrics.slice(start).some(m=>m.rpc==='get_ship_dynamics_record_receipt_v1'&&m.status==='SQL_OK'),'old operation receipt delivered after real identity switch');
  qa.setRecordFault(null);await wait(1700);
  if(mode==='identity')await check('real-identity-switch-fences-old-ack-and-original-sync-recovers',async()=>{
   assert.equal(await phase(),'保存未完成');assert.ok((await text()).includes('generation 已失效'));assert.equal(await badge(),'1 筆更新');
   const stale=await local(),cloud=await qa.read();assert.deepEqual({...stale,updatedAt:cloud.payload.updatedAt},cloud.payload,'only root timestamp awaits current-identity reconciliation');
   assert.equal(patchMetrics(start).length,1);await screen('identity-fenced');
   await click('同步最新（安全合併）');await until(async()=>await phase()==='已安全保存','original sync reconciles committed operation');
   assert.deepEqual(await local(),cloud.payload);assert.equal(patchMetrics(start).length,1);assert.equal(await badge(),'1 筆更新');
  });
  await check('own-read-only-full-cloud-local-reconciliation-no-duplicate-patch',async()=>{
   const saved=await snapshot('confirmed');verifyReadDelta(baseline,saved);assert.deepEqual(await local(),saved.payload,'complete local and cloud equality');
   assert.equal(patchMetrics(start).length,1);assert.equal(patchMetrics(start)[0].status,'SQL_OK');
   evidence.ledger=await storage();evidence.patch= submitted?.p_operations;
   if(mode==='identity'){assert.ok((await text()).includes('QA OPERATOR｜操作員'));assert.equal(await badge(),'1 筆更新');}
  });
  if(mode==='identity')await switchTo('qa-owner');
  await check('new-document-owner-readback-and-other-original-login-unread',async()=>{
   await evaluate('window.__qaOldDocument=true');await call('Page.reload');
   await until(async()=>await evaluate('!window.__qaOldDocument&&document.readyState==="complete"')&&(await text()).includes('QA OWNER｜Owner'),'new document owner');
   await goWork();assert.equal(await badge(),'');assert.ok(!await evaluate("[...document.querySelectorAll('.work-center button')].some(n=>n.innerText==='全部標記已讀')"));
   const before=await qa.read();await switchTo('qa-operator');await goWork();assert.equal(await badge(),'1 筆更新');
   assert.ok(await evaluate("[...document.querySelectorAll('.task-link')].some(n=>n.innerText==='QA PERSONAL TASK')"));await wait(1100);assert.deepEqual(await qa.read(),before);assert.deepEqual(await local(),before.payload);
   assert.equal(patchMetrics(start).length,1);await screen('other-user-unread');
  });
 }
 assert.deepEqual(await qa.itinerarySnapshot(),qa.itineraryBaseline);assert.deepEqual((await qa.db.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows,legacyBefore);
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>m.status==='UNSUPPORTED'));
 console.log(JSON.stringify({qa:'RECORD_NOTIFICATION_READ_PASS',output,mode,scenarios:evidence.scenarios}));
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

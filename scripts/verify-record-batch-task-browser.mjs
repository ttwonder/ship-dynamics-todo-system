import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {seedBatchVessel} from './record-batch-vessel-local-fixture.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-batch-task-'));
const profile=path.join(output,'chrome-profile');
const mode=process.argv.includes('--reject')?'reject':process.argv.includes('--tracer-only')?'tracer':'receipt';
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
const patchMetrics=start=>qa.metrics.slice(start).filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'&&m.status!=='ACK_DROPPED_AFTER_SQL');
const storage=async()=>{
 const result={};for(const {tablename} of (await qa.db.query("select tablename from pg_tables where schemaname='public' and (tablename='ship_dynamics_records' or tablename like 'ship_dynamics_record_%') order by tablename")).rows){
  assert.match(tablename,/^(ship_dynamics_records|ship_dynamics_record_[a-z_]+)$/);
  result[tablename]=(await qa.db.query(`select to_jsonb(t) value from ${tablename} t order by to_jsonb(t)::text`)).rows;
 }assert.ok(Object.keys(result).length>=7);return result;
};

const locks=async()=> (await qa.db.query("select section_key,locked_by from ship_dynamics_edit_locks where expires_at>now() order by section_key")).rows;
const untouched=async()=> (await qa.db.query("select to_jsonb(t) value,xmin::text,ctid::text from ship_dynamics_records t where collection<>'auditLogs' and not(collection='vessels' and entity_id in ('qa-v1','qa-v2')) order by collection,entity_id")).rows;
const modal=()=>evaluate("Boolean(document.querySelector('.batch-managed-modal'))");
const field=(index,label)=>`[...document.querySelectorAll('.batch-managed-card')[${index}].querySelectorAll('label')].find(n=>n.firstChild.textContent===${JSON.stringify(label)})?.querySelector('input,textarea,select')`;
const edit=async(index,label,value)=>{await evaluate(`(()=>{const n=${field(index,label)};if(!n||n.matches(':disabled')||n.readOnly)throw new Error('editable field unavailable');n.focus();n.select();})()`);await call('Input.insertText',{text:value});};
const open=async()=>{
 const start=qa.metrics.length;
 for(const name of ['QA VESSEL 1','QA VESSEL 2'])await nodeClick(`[...document.querySelectorAll('article.ship-card')].filter(n=>n.innerText.includes(${JSON.stringify(name)})).flatMap(n=>[...n.querySelectorAll('button')]).find(n=>n.innerText==='批量選取')`);
 await click('批量更新船舶（已選 2）');await until(modal,'original batch modal');
 assert.equal(await evaluate("document.querySelectorAll('.batch-managed-card').length"),2);
 assert.deepEqual((await locks()).map(l=>l.section_key),['vessel:qa-v1','vessel:qa-v2']);
 assert.equal(await evaluate("document.querySelector('.batch-managed-modal').innerText.includes('QA VESSEL 3')"),false);
 const metrics=qa.metrics.slice(start),claims=metrics.map((m,i)=>m.rpc==='claim_ship_dynamics_edit_lock'?i:-1).filter(i=>i>=0);
 assert.equal(claims.length,2);assert.ok(metrics.some((m,i)=>i>Math.max(...claims)&&['read_ship_dynamics_records_v1','read_ship_dynamics_record_delta_v1'].includes(m.rpc)),'authoritative refresh after complete lease bundle');
};
const draft=async(suffix)=>{
 for(let i=0;i<2;i++){await edit(i,'人工備註',`QA REMARK ${i+1} ${suffix}`);await edit(i,'近期動態',`QA NOTE ${i+1} ${suffix}`);}
 await edit(0,'目前位置','QA MANUAL LOCATION');
};
const verifySaved=(before,after)=>{
 assert.equal(after.revision,before.revision+1,'one complete committed transaction');
 const expected=structuredClone(before.payload);expected.revision=after.payload.revision;expected.updatedAt=after.payload.updatedAt;
 for(let i=0;i<2;i++){
  const a=after.payload.vessels.find(v=>v.id===`qa-v${i+1}`),b=expected.vessels.find(v=>v.id===a.id);
  assert.equal(a.note.recentDynamics,`QA NOTE ${i+1} SAVE`);assert.equal(a.note.subsequentDynamics,'');assert.equal(a.position.manualRemark,`QA REMARK ${i+1} SAVE`);
  if(!i)assert.equal(a.position.location,'QA MANUAL LOCATION');
  const allowed=structuredClone(b);Object.assign(allowed.position,{manualRemark:a.position.manualRemark,source:'manual',updatedAt:a.position.updatedAt,...(!i?{location:'QA MANUAL LOCATION'}:{})});
  Object.assign(allowed.note,{recentDynamics:a.note.recentDynamics,subsequentDynamics:'',updatedAt:a.note.updatedAt});allowed.updatedAt=a.updatedAt;
  assert.deepEqual(a,allowed,'only original editable write mask changes vessel');Object.assign(b,allowed);
 }
 const audits=after.payload.auditLogs.filter(a=>!before.payload.auditLogs.some(b=>b.id===a.id));
 assert.equal(audits.length,2);assert.deepEqual(audits.map(a=>a.entityId).sort(),['qa-v1','qa-v2']);
 for(const a of audits){assert.equal(a.action,'批量更新船舶');assert.equal(a.entityType,'vessel');assert.equal(a.actorId,'qa-owner');}
 expected.auditLogs=after.payload.auditLogs;assert.deepEqual(after.payload,expected,'unselected vessel/all other business/notifications unchanged');
};
try{
 qa=await createRecordStorageLocalQa({internalControl:true});await seedBatchVessel(qa);
 const baseline=await snapshot('fixture-baseline'),formalBefore=await qa.itinerarySnapshot(),untouchedBefore=await untouched();
 assert.equal(baseline.payload.vessels.length,3);assert.equal(baseline.revision,1);
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

 await open();await draft('SAVE');
 const before=await qa.read(),start=qa.metrics.length;
 const holdReceipt=()=>{
  let submitted,dropped=false,lookup=false;const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});
  qa.setRecordFault({before:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1')submitted??=structuredClone(body);if(name==='get_ship_dynamics_record_receipt_v1'&&dropped){assert.deepEqual(body,submitted,'exact immutable same-operation receipt');lookup=true;await held;}},after:async({name,value})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&!dropped){assert.equal(value.ok,true);dropped=true;return true;}return false;}});
  return {waiting:()=>lookup,submitted:()=>submitted};
 };
 if(mode==='reject'){
  const beforeStorage=await storage(),owned=await locks();
  await qa.db.exec(`create function qa_reject_handoff() returns trigger language plpgsql as $$ begin if new.collection='auditLogs' and new.value->>'entityId'='qa-v2' and new.value->>'action'='批量更新船舶' then raise exception 'QA rejected batch handoff';end if;return new;end $$;create trigger qa_reject_handoff before insert or update on ship_dynamics_records for each row execute function qa_reject_handoff();`);
  await click('＋ 新增要事',0,2);await until(()=>qa.metrics.slice(start).some(m=>m.status==='SQL_ERROR'),'SQL rejection');await until(async()=>(await text()).includes('重試保存並關閉'),'original rejected callback settled');
  await check('sql-rejection-no-afterSave-no-task-no-partial',async()=>{
   await wait(1300);assert.deepEqual(await storage(),beforeStorage);assert.deepEqual(await locks(),owned);
   assert.equal(await modal(),true);assert.equal(await evaluate("Boolean(document.querySelector('#task-edit-title'))"),false);
   assert.equal(qa.metrics.slice(start).filter(m=>['claim_ship_dynamics_edit_lock','release_ship_dynamics_edit_lock'].includes(m.rpc)).length,0);await screen('reject-no-handoff');
  });
  // Original retry is close-only: a rejected afterSave must not be resurrected.
  await qa.db.exec('drop trigger qa_reject_handoff on ship_dynamics_records;drop function qa_reject_handoff();');
  await click('重試保存並關閉');await until(async()=>!await modal()&&(await locks()).length===0,'retry close without afterSave');
  assert.equal(await evaluate("Boolean(document.querySelector('#task-edit-title'))"),false);verifySaved(before,await qa.read());
  await open();
 }
 const heldBatch=mode==='receipt'?holdReceipt():null;
 await evaluate("void(window.__qaBatchNode=document.querySelector('.batch-managed-modal'))");const batchOwned=await locks();
 await click('＋ 新增要事',0,2);
 if(heldBatch){
  await until(heldBatch.waiting,'batch held receipt');
  await check('batch-held-ACK-no-early-task-handoff',async()=>{
   verifySaved(before,await qa.read());await wait(1100);assert.deepEqual(await locks(),batchOwned);
   assert.equal(await evaluate("window.__qaBatchNode===document.querySelector('.batch-managed-modal')"),true);
   assert.equal(await evaluate("Boolean(document.querySelector('#task-edit-title'))"),false);
   assert.equal(qa.metrics.slice(start).filter(m=>['claim_ship_dynamics_edit_lock','release_ship_dynamics_edit_lock'].includes(m.rpc)).length,0);
   evidence.batchEnvelope=heldBatch.submitted();await screen('batch-held');
  });releaseHeldReceipt();releaseHeldReceipt=null;
 }
 await until(async()=>await evaluate("Boolean(document.querySelector('#task-edit-title'))"),'original task creation after batch save');
 await check('batch-save-release-before-task-creation',async()=>{
  verifySaved(before,await snapshot('batch-saved'));
  assert.equal(await modal(),false);assert.equal((await locks()).length,1);
  assert.ok((await locks())[0].section_key.startsWith('task-create:v2:qa-v1:'));
  const m=qa.metrics.slice(start);evidence.handoffMetrics=m;const claim=m.findLastIndex(x=>x.rpc==='claim_ship_dynamics_edit_lock');assert.ok(m.slice(0,claim).filter(x=>x.rpc==='release_ship_dynamics_edit_lock').length>=2);if(mode==='receipt'){const ack=m.findIndex(x=>x.rpc==='get_ship_dynamics_record_receipt_v1'&&x.status==='SQL_OK');assert.ok(ack>=0);assert.ok(m.every((x,i)=>x.rpc!=='release_ship_dynamics_edit_lock'||i>ack));}qa.setRecordFault(null);
 });
 const saved=await qa.read(),returnStart=qa.metrics.length;await click('取消並關閉');
 await until(modal,'return to exact original two-vessel batch list');
 await check('task-cancel-returns-exact-two-no-task-no-rollback',async()=>{
  assert.equal(await evaluate("document.querySelectorAll('.batch-managed-card').length"),2);
  assert.equal(await evaluate("document.querySelector('.batch-managed-modal').innerText.includes('QA VESSEL 3')"),false);
  assert.deepEqual((await locks()).map(x=>x.section_key),['vessel:qa-v1','vessel:qa-v2']);
  assert.deepEqual(await qa.read(),saved);assert.equal(patchMetrics(returnStart).length,0);const m=qa.metrics.slice(returnStart),lastClaim=m.findLastIndex(x=>x.rpc==='claim_ship_dynamics_edit_lock');assert.equal(m.filter(x=>x.rpc==='claim_ship_dynamics_edit_lock').length,2);assert.ok(m.some((x,i)=>i>lastClaim&&['read_ship_dynamics_records_v1','read_ship_dynamics_record_delta_v1'].includes(x.rpc)));await screen('returned');
 });
 if(mode!=='tracer'){
  const taskStart=qa.metrics.length;
  await click('＋ 新增要事',1,2);await until(async()=>await evaluate("Boolean(document.querySelector('#task-edit-title'))"),'second vessel creation');
  assert.ok((await locks())[0].section_key.startsWith('task-create:v2:qa-v2:'));
  await nodeClick(`document.querySelector('[contenteditable="true"][aria-label="事項內容"]')`);await call('Input.insertText',{text:'QA ROUNDTRIP ORDINARY TASK'});
  for(const label of ['維修','管理組'])await nodeClick(`[...document.querySelectorAll('.modal label')].find(n=>n.innerText.trim()===${JSON.stringify(label)})?.querySelector('input[type=checkbox]')`);
  assert.equal(await evaluate("document.querySelector('.internal-control-toggle input').checked"),false);
  const heldTask=holdReceipt(),owned=await locks();await evaluate("void(window.__qaTaskNode=document.querySelector('[aria-labelledby=task-edit-title]'))");await click('保存並關閉');
  await until(heldTask.waiting,'task held same operation receipt');
  const committed=await snapshot('task-committed-held');
  const added=committed.payload.tasks.filter(t=>!saved.payload.tasks.some(b=>b.id===t.id));
  await check('task-held-ACK-exact-task-no-early-return',async()=>{
   assert.equal(added.length,1);assert.equal(added[0].vesselId,'qa-v2');assert.equal(added[0].isInternalControl,false);assert.ok(added[0].description.includes('QA ROUNDTRIP ORDINARY TASK'));
   assert.equal(committed.revision,saved.revision+1);assert.equal(patchMetrics(taskStart).length,1);
   assert.equal(await modal(),false);assert.equal(await evaluate("window.__qaTaskNode===document.querySelector('[aria-labelledby=task-edit-title]')"),true);
   for(const lock of owned)assert.ok((await locks()).some(x=>x.section_key===lock.section_key&&x.locked_by===lock.locked_by));
   assert.equal(qa.metrics.slice(taskStart).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,2,'only prior batch released, not creation lease');
   evidence.taskEnvelope=heldTask.submitted();await screen('task-held');
  });releaseHeldReceipt();releaseHeldReceipt=null;
  await until(modal,'task save returns original exact batch');qa.setRecordFault(null);await wait(1600);
  await check('task-confirmed-return-rebundle-fresh-no-duplicate',async()=>{
   assert.deepEqual((await locks()).map(x=>x.section_key),['vessel:qa-v1','vessel:qa-v2']);
   assert.equal(await evaluate("document.querySelectorAll('.batch-managed-card').length"),2);assert.equal(await evaluate("document.querySelector('.batch-managed-modal').innerText.includes('QA VESSEL 3')"),false);
   assert.deepEqual(await qa.read(),committed);assert.equal(patchMetrics(taskStart).length,1);
   const m=qa.metrics.slice(taskStart),ack=m.findIndex(x=>x.rpc==='get_ship_dynamics_record_receipt_v1'&&x.status==='SQL_OK'),lastClaim=m.findLastIndex(x=>x.rpc==='claim_ship_dynamics_edit_lock');
   assert.ok(ack>=0&&lastClaim>ack);assert.ok(m.some((x,i)=>i>lastClaim&&['read_ship_dynamics_records_v1','read_ship_dynamics_record_delta_v1'].includes(x.rpc)));
   const audits=committed.payload.auditLogs.filter(a=>!saved.payload.auditLogs.some(b=>b.id===a.id));assert.equal(audits.length,2);assert.deepEqual(audits.map(a=>[a.entityId,a.action]).sort(),[[added[0].id,'新增事項'],['qa-v2','切換一週關注燈']].sort());assert.ok(audits.every(a=>a.actorId==='qa-owner'));
   const expectedVessels=structuredClone(saved.payload.vessels);expectedVessels.find(v=>v.id==='qa-v2').weeklyAttention=['maintenance'];assert.deepEqual(committed.payload.vessels,expectedVessels);assert.deepEqual(committed.payload.notifications,saved.payload.notifications);assert.deepEqual(committed.payload.internalControlCases,saved.payload.internalControlCases);
   for(const t of saved.payload.tasks)assert.deepEqual(committed.payload.tasks.find(a=>a.id===t.id),t);
   await screen('task-saved-return');
  });
  await click('取消並關閉');await until(async()=>!await modal()&&(await locks()).length===0,'post-task batch cancel');
  await check('new-document-task-and-batch-readback-no-trailing-save',async()=>{
   const count=patchMetrics(0).length;await evaluate('window.__qaOldDocument=true');await call('Page.reload');await until(async()=>await evaluate('!window.__qaOldDocument&&document.readyState==="complete"')&&(await text()).includes('QA OWNER｜Owner'),'new document');await until(async()=>(await text()).includes('QA ROUNDTRIP ORDINARY TASK'),'new document renders created task');const reloadedPayload=structuredClone(committed.payload);reloadedPayload.tasks.find(t=>t.id===added[0].id).vesselIds=[];assert.deepEqual(await local(),reloadedPayload,'original reload normalization adds empty optional vesselIds to ordinary task; all other bytes match');
   await open();for(let i=0;i<2;i++)assert.equal(await evaluate(`(${field(i,'近期動態')}).value`),`QA NOTE ${i+1} SAVE`);
   await click('取消並關閉');await until(async()=>!await modal()&&(await locks()).length===0,'reloaded cancel');await wait(1400);assert.deepEqual(await qa.read(),committed);assert.equal(patchMetrics(0).length,count);await screen('reload');
  });
 }else{await click('取消並關閉');await until(async()=>!await modal()&&(await locks()).length===0,'final cancel');}

 assert.deepEqual(await qa.itinerarySnapshot(),formalBefore);assert.deepEqual((await untouched()).filter(r=>untouchedBefore.some(b=>b.value.collection===r.value.collection&&b.value.entity_id===r.value.entity_id)),untouchedBefore);
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);
 console.log(JSON.stringify({qa:'RECORD_BATCH_TASK_PASS',output,scenarios:evidence.scenarios}));
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

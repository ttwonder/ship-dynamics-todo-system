import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {seedBatchVessel} from './record-batch-vessel-local-fixture.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-batch-vessel-'));
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

 await check('batch-open-exact-two-bundle-refresh-readonly-itinerary',async()=>{
  await open();
  const projected=await evaluate(`({last:(${field(0,'上一港')}).value,next:(${field(0,'下一港')}).value,cargo:(${field(0,'貨名貨量')}).value,readonly:[...document.querySelectorAll('.batch-managed-card [aria-readonly]')].every(n=>n.readOnly),dates:[...document.querySelectorAll('.batch-managed-card input[type=date],.batch-managed-card input[type=time]')].every(n=>n.disabled)})`);
  assert.equal(projected.last,'QA FORMAL BUSAN');assert.equal(projected.next,'QA FORMAL KAOHSIUNG');assert.ok(projected.cargo.includes('QA FORMAL CARGO 123 MT'));assert.ok(projected.readonly&&projected.dates);
  evidence.projection=projected;await screen('opened');
 });
 await check('normal-cancel-local-drafts-zero-patch-own-bundle-release',async()=>{
  const before=await storage(),start=qa.metrics.length;await draft('CANCEL');await wait(1200);
  assert.deepEqual(await qa.read(),baseline);assert.equal(patchMetrics(start).length,0);
  await click('取消並關閉');await until(async()=>!await modal()&&(await locks()).length===0,'normal cancel and own locks released');
  await wait(1100);assert.deepEqual(await storage(),before);assert.equal(patchMetrics(start).length,0);
  assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,2);
 });
 await open();await draft('SAVE');await wait(1100);assert.deepEqual(await qa.read(),baseline);
 const start=qa.metrics.length;let submitted,dropped=false,lookup=false;
 if(mode==='reject'){
  // Sequence increments survive rollback: prove both vessel writes were reached before the rejected audit.
  await qa.db.exec(`create sequence qa_batch_steps;create function qa_reject_batch() returns trigger language plpgsql as $$ begin if new.collection='vessels' and new.entity_id in ('qa-v1','qa-v2') then perform nextval('qa_batch_steps');end if;if new.collection='auditLogs' and new.value->>'entityId'='qa-v2' and new.value->>'action'='批量更新船舶' then raise exception 'QA intentional late batch audit rejection'; end if;return new;end $$;create trigger qa_reject_batch before insert or update on ship_dynamics_records for each row execute function qa_reject_batch();`);
  const before=await storage(),owned=await locks();
  await click('保存並關閉');await until(()=>qa.metrics.slice(start).some(m=>m.status==='SQL_ERROR'),'real SQL late audit rejection');
  await until(async()=>(await text()).includes('重試保存並關閉'),'original retry available');
  await check('late-sql-reject-zero-partial-no-false-saved-retains-draft-locks',async()=>{
   evidence.rejectedVesselWriteSteps=Number((await qa.db.query('select last_value from qa_batch_steps')).rows[0].last_value);assert.ok(evidence.rejectedVesselWriteSteps>=2,'both vessel writes reached before transaction rollback');
   await wait(1100);assert.deepEqual(await storage(),before);assert.deepEqual(await locks(),owned);assert.equal(await modal(),true);assert.notEqual(await phase(),'已安全保存');
   for(let i=0;i<2;i++)assert.equal(await evaluate(`(${field(i,'近期動態')}).value`),`QA NOTE ${i+1} SAVE`);
   assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);await screen('rejected');
  });
  await qa.db.exec('drop trigger qa_reject_batch on ship_dynamics_records;drop function qa_reject_batch();drop sequence qa_batch_steps;');await click('重試保存並關閉');
 }else{
  const held=new Promise(resolve=>{releaseHeldReceipt=resolve;});
  qa.setRecordFault({before:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1')submitted??=structuredClone(body);if(name==='get_ship_dynamics_record_receipt_v1'&&dropped){lookup=true;assert.deepEqual(body,submitted,'same operation immutable envelope');await held;}},after:async({name,value})=>{if(mode==='receipt'&&name==='apply_ship_dynamics_record_patch_v1'&&!dropped){assert.equal(value.ok,true);dropped=true;return true;}return false;}});
  await evaluate("void(window.__qaBatchNode=document.querySelector('.batch-managed-modal'))");const owned=await locks();await click('保存並關閉');
  if(mode==='receipt'){
   await until(()=>lookup,'lost ACK exact receipt lookup');
   await check('batch-committed-held-ack-same-modal-drafts-locks-no-early-close',async()=>{
    verifySaved(baseline,await snapshot('committed-held'));assert.equal(await evaluate("window.__qaBatchNode===document.querySelector('.batch-managed-modal')"),true);
    for(let i=0;i<2;i++)assert.equal(await evaluate(`(${field(i,'近期動態')}).value`),`QA NOTE ${i+1} SAVE`);
    assert.deepEqual(await locks(),owned);assert.notEqual(await phase(),'已安全保存');assert.equal(qa.metrics.slice(start).filter(m=>m.rpc==='release_ship_dynamics_edit_lock').length,0);
    assert.equal(patchMetrics(start).length,1);await screen('held-ack');
   });releaseHeldReceipt();releaseHeldReceipt=null;
  }
 }
 await until(async()=>!await modal()&&(await locks()).length===0,'ACK original close and release');qa.setRecordFault(null);await wait(1700);
 await check('batch-confirmed-one-transaction-audits-write-mask-no-trailing-save',async()=>{
  const saved=await snapshot('confirmed');verifySaved(baseline,saved);assert.deepEqual(await local(),saved.payload);
  const success=patchMetrics(start).filter(m=>m.status==='SQL_OK');assert.equal(success.length,1);if(mode!=='reject')assert.equal(patchMetrics(start).length,1);
  assert.equal(await phase(),'已安全保存');
  if(mode==='receipt'){const ms=qa.metrics.slice(start),ack=ms.findIndex(m=>m.rpc==='get_ship_dynamics_record_receipt_v1'&&m.status==='SQL_OK');assert.ok(ack>=0);assert.ok(ms.every((m,i)=>m.rpc!=='release_ship_dynamics_edit_lock'||i>ack));}
  evidence.submitted=submitted;evidence.ledger=await storage();
 });
 await check('new-document-reload-reopen-values-normal-cancel-no-new-save',async()=>{
  const saved=await qa.read(),count=patchMetrics(0).length;await evaluate('window.__qaOldDocument=true');await call('Page.reload');
  await until(async()=>await evaluate('!window.__qaOldDocument&&document.readyState==="complete"')&&(await text()).includes('QA OWNER｜Owner'),'new document identity');
  await open();for(let i=0;i<2;i++){assert.equal(await evaluate(`(${field(i,'近期動態')}).value`),`QA NOTE ${i+1} SAVE`);assert.equal(await evaluate(`(${field(i,'人工備註')}).value`),`QA REMARK ${i+1} SAVE`);}
  await click('取消並關閉');await until(async()=>!await modal()&&(await locks()).length===0,'reloaded unchanged cancel');await wait(1200);
  assert.deepEqual(await qa.read(),saved);assert.equal(patchMetrics(0).length,count);await screen('reloaded');
 });
 assert.deepEqual(await qa.itinerarySnapshot(),formalBefore,'all formal sd tables/history/alternatives and conflicting legacy physically unchanged');
 assert.deepEqual(await untouched(),untouchedBefore,'third vessel and other business records retain value/revision/xmin/ctid');
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>m.status==='UNSUPPORTED'));
 console.log(JSON.stringify({qa:'RECORD_BATCH_VESSEL_PASS',output,mode,scenarios:evidence.scenarios}));
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

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
const run=fs.mkdtempSync(path.join(root,'mixed-')),profile=path.join(run,'chrome');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const receipt={kind:'original-App-native-PG-multi-context',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],network:[],errors:[],blockedExternal:[],commands:[{command:'node scripts/verify-record-mixed-workflows-browser.mjs',exit:null}],productionContacted:false};
receipt.inputs=Object.fromEntries(['scripts/verify-record-mixed-workflows-browser.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','src/App.tsx','supabase/development/20260906_appdata_record_store.sql'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await wait(30);}throw new Error('QA timeout: '+label);};
const field="[...document.querySelectorAll('[role=dialog] .field')].find(n=>n.querySelector('label')?.innerText==='近期／後續動態')?.querySelector('textarea')";
const patchRpc='apply_ship_dynamics_record_patch_v1';
let native,qa,browser,ws,failure,chromePort,releaseCommit,barrier=null,currentCase='setup',next=0;
const pending=new Map(),actors=[],netRows=new Map(),paused=[];
const targets=[['qa-operator','qa-v1'],['qa-owner','qa-v2']];
receipt.rounds=[];receipt.actorResults=[];receipt.dialogs=[];receipt.contract={roundLimit:2,actors:2,preCommitBudgetMs:6000,productRpcTimeoutMs:12000};
let rendezvous=false;
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
 p.click=label=>p.activate(`[...document.querySelectorAll('button')].find(n=>n.innerText.trim()===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled)`);
 p.fill=async(expr,value)=>{await p.eval(`(()=>{const n=${expr};if(!n||n.disabled||n.readOnly)throw new Error('editable input required');n.focus();n.select();})()`);await call('Input.insertText',{text:value},s);};
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
 const selector="document.querySelector('select[aria-label=登入人員]')";
 const index=await p.eval(`(()=>{const n=${selector};n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(p.actor)});})()`);assert.ok(index>=0);
 await p.key('Home');for(let i=0;i<index;i++)await p.key('ArrowDown');await p.key('Enter');
 await until(()=>p.eval(`(${selector}).value===${JSON.stringify(p.actor)}`),'native identity select');
 await p.fill("document.querySelector('input[type=password]')",qa.password);await p.click('登入');
 await until(async()=>!(await p.text()).includes('人員登入／切換')&&(await p.text()).includes(p.actor==='qa-owner'?'QA OWNER':'QA OPERATOR'),'original logged-in homepage');await p.sync();
}
const locks=async()=> (await native.observer.query("select section_key,locked_by from ship_dynamics_edit_locks where expires_at>now() order by section_key")).rows;
const read=async()=> (await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;
const untouched=async()=> (await native.observer.query("select to_jsonb(t) value,xmin::text,ctid::text from ship_dynamics_records t where collection<>'auditLogs' and not(collection='vessels' and entity_id in ('qa-v1','qa-v2','qa-v3','qa-v4','qa-v5')) order by collection,entity_id")).rows;
async function freshReadback(name,expected){
 const c=await native.connect('fresh_'+name),actual=(await c.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;await c.end();
 assert.deepEqual(actual,expected,'complete new SQL connection readback');
 const {normalizeAppData}=await qa.loadModule('/src/normalize.ts');
 for(const p of actors.filter(p=>!p.reader)){
  const fresh=await makePage(p.actor,p.context);fresh.reader=true;
  await call('Page.navigate',{url:qa.origin+'/__qa/blank'},fresh.s);
  await until(()=>fresh.eval("document.readyState==='complete'"),'fresh blank');
  const model=await fresh.eval(`import('/src/cloud.ts').then(m=>{return m.fetchCloudData(${JSON.stringify({supabaseUrl:qa.origin,supabaseAnonKey:'isolated-qa-not-a-service-key',workspaceKey:qa.workspace,tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'delta-v1'})});})`);
  assert.deepEqual(model,JSON.parse(JSON.stringify(normalizeAppData(actual.payload))),'new document complete original cloud read');
  await call('Target.closeTarget',{targetId:fresh.targetId});
 }
 fs.writeFileSync(path.join(run,name+'-readback.json'),JSON.stringify({hash:hash(actual),readback:scrub(actual)},null,2));
}

const outgoing=new Map(),outgoingAuditBodies=new Map();
const clean=v=>JSON.parse(JSON.stringify(v));
const icField=(label,tag,scope='.modal')=>`[...document.querySelectorAll(${JSON.stringify(scope+' .field')})].find(n=>n.querySelector('label')?.innerText.trim()===${JSON.stringify(label)})?.querySelector(${JSON.stringify(tag)})`;
const labelInput=(label,scope='.modal')=>`[...document.querySelectorAll(${JSON.stringify(scope+' label')})].find(n=>n.innerText.trim()===${JSON.stringify(label)})?.querySelector('input')`;
const taskField=`document.querySelector('[contenteditable][aria-label="事項內容"]')`;
const caseField=icField('事項內容 *','textarea');
async function select(p,expr,value){const i=await p.eval(`(()=>{const n=${expr};if(!n||n.disabled)throw new Error('native select unavailable');n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(i>=0);await p.key('Home');for(let n=0;n<i;n++)await p.key('ArrowDown');await p.key('Enter');await until(()=>p.eval(`(${expr}).value===${JSON.stringify(value)}`),'selected '+value);}
async function nodeClick(p,expr){const pos=await p.eval(`(()=>{const n=${expr};if(!n||!n.getClientRects().length||n.matches(':disabled'))throw new Error('UI target unavailable: '+${JSON.stringify(expr)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...pos},p.s);}
async function rich(p,value){await nodeClick(p,taskField);await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2},p.s);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2},p.s);await call('Input.insertText',{text:value},p.s);assert.equal(await p.eval(`(${taskField}).innerText`),value);}
async function mixedFixture(initial,vite){
 initial.auditLogs=Array.from({length:500},(_,i)=>({id:'legacy-'+i,at:i%2?'2001-01-01T00:00:00.000Z':'2000-01-01T00:00:00.000Z',actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action:'fixture',entityType:'vessel',entityId:'qa-v2',detail:'old '+i,ipAddress:'192.0.2.99',ipCountryCode:'JP'}));
 // A third unassigned vessel is an independently nonempty bystander.
 initial.vessels.push({...structuredClone(initial.vessels[1]),id:'qa-v3',name:'QA VESSEL 3',fullName:'QA VESSEL 3',shortName:'QA VESSEL 3',assignedUserIds:[]});
 const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');Object.assign(initial,normalizeAppData(initial));
}
const ledger=async()=> (await native.observer.query('select operation_id,result from ship_dynamics_record_receipts where workspace_key=$1 order by operation_id',[qa.workspace])).rows;
const bystanders=async()=>({formal:await qa.itinerarySnapshot(),legacy:(await native.observer.query('select to_jsonb(t) value from ship_dynamics_app_state t order by workspace_key')).rows,rows:(await native.observer.query("select to_jsonb(t) value,xmin::text,ctid::text from ship_dynamics_records t where (collection not in ('auditLogs','notifications','vessels','tasks','internalControlCases')) or (collection='vessels' and entity_id='qa-v3') or (collection='tasks' and entity_id='qa-unrelated-task') or (collection='internalControlCases' and entity_id='qa-restricted') order by collection,entity_id")).rows});
async function draft(p){return p.eval(`window.__mixedDraft===${p.field}&&window.__mixedDraft.isConnected&&(window.__mixedDraft.value??window.__mixedDraft.innerText)===${JSON.stringify(p.marker)}`);}
async function remember(p){await p.eval(`void(window.__mixedDraft=${p.field})`);assert.ok(await draft(p));}
async function closeCaseOpen(p,label){await nodeClick(p,`[...([...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.querySelector('.ic-description-column')?.innerText.trim()===${JSON.stringify(label)})).querySelectorAll('button')].find(n=>n.innerText.trim()==='更新')`);await until(()=>p.eval(`Boolean(${caseField})`),'original case editor');}
async function expectedStage(before,after,batch,success){
 const {applyCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const {rebaseDisjointAppData}=await qa.loadModule('/src/cloudRebase.ts');
 // JSONB object-key order is not data. Keep every property/value and every array position.
 const canonicalKeys=value=>Array.isArray(value)?value.map(canonicalKeys):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalKeys(value[key])])):value;
 const modelForRebase=raw=>{const model=canonicalKeys(raw);assert.deepEqual(model,raw,'oracle key canonicalization must preserve all values, properties and array order');return model;};
 const ic=await qa.loadModule('/src/internalControlData.ts');
 const locals=batch.map(r=>({r,model:applyCloudBlockPatch(before.payload,outgoing.get(r.operationId).p_operations)}));
 const b=locals.find(x=>x.r.actor==='qa-owner').model,c=b.internalControlCases.find(c=>c.description==='MIXED CASE');
 const linked=b.tasks.find(t=>t.id===c.linkedTaskId);assert.ok(linked);assert.equal(linked.internalControlCaseId,c.id);assert.equal(linked.isInternalControl,true);assert.equal(linked.isAbnormal,false);
 if(currentCase==='M2'){
  const oracle=structuredClone(before.payload),old=oracle.internalControlCases.find(x=>x.id===c.id),actor=oracle.users.find(u=>u.id==='qa-owner');
  ic.updateInternalControlCase(oracle,{...structuredClone(old),isClosed:true,closedDate:c.closedDate},old.updatedAt,actor,c.updatedAt);
  assert.deepEqual(clean(oracle.internalControlCases),b.internalControlCases,'original close helper case oracle');assert.deepEqual(clean(oracle.tasks),b.tasks,'original close helper entire linked task oracle');
  assert.deepEqual(b.notifications,before.payload.notifications,'case closure preserves notifications');assert.deepEqual(b.taskDismissals,before.payload.taskDismissals,'case closure preserves dismissals');
 }else{
  const {internalControlCaseToTask}=await qa.loadModule('/src/internalControlWorkflow.ts');
  const projected=internalControlCaseToTask(c,{id:linked.id,categories:['維修'],expectedDate:'',ownerUserIds:[],isAbnormal:false,actorId:'qa-owner',at:c.updatedAt});
  assert.deepEqual(clean(projected),linked,'original creation projection oracle');
 }
 let expected=structuredClone(before.payload);
 for(const n of success.sort((a,b)=>a.revision-b.revision)){
  const intent=locals.find(x=>x.r.actor===n.actor);assert.ok(intent);
  expected=n===success[0]?structuredClone(intent.model):rebaseDisjointAppData(modelForRebase(before.payload),modelForRebase(intent.model),modelForRebase(expected),after.payload.updatedAt,n.actor);
  for(const a of expected.auditLogs){const o=outgoingAuditBodies.get(a.id);if(o)Object.assign(a,{ipAddress:'192.0.2.30',ipCountryCode:'TW'});}
  const h=(await native.observer.query('select read_ship_dynamics_record_history_v1($1,$2) r',[qa.workspace,n.revision])).rows[0].r;
  expected.revision=n.revision;expected.updatedAt=h.payload.updatedAt;
  fs.writeFileSync(path.join(run,currentCase+'-revision-'+n.revision+'-oracle.json'),JSON.stringify({expected:scrub(clean(expected)),actual:scrub(h.payload)},null,2));assert.deepEqual(h.payload,clean(expected),'full independently replayed command graph at every committed revision');
 }
 assert.deepEqual(after.payload,clean(expected),'complete stage expected graph');
 for(const a of after.payload.auditLogs.filter(a=>outgoingAuditBodies.has(a.id)))assert.deepEqual(a,{...outgoingAuditBodies.get(a.id),ipAddress:'192.0.2.30',ipCountryCode:'TW'},'full original outgoing audit business fields');
 const ordinary=after.payload.tasks.filter(t=>t.description.includes(currentCase==='M1'?'MIXED ORDINARY':'MIXED ORDINARY UPDATED'));assert.equal(ordinary.length,1);assert.equal(ordinary[0].isInternalControl,false);assert.equal(ordinary[0].vesselId,'qa-v1');
 assert.equal(after.payload.tasks.filter(t=>t.internalControlCaseId===c.id).length,1);const finalCase=after.payload.internalControlCases.find(x=>x.id===c.id),finalTask=after.payload.tasks.find(t=>t.id===c.linkedTaskId);assert.equal(finalCase.isClosed,currentCase==='M2');assert.equal(finalTask.isClosed,finalCase.isClosed);if(currentCase==='M2'){assert.equal(finalTask.closedDate,finalCase.closedDate);assert.equal(finalTask.closedBy,finalCase.closedBy);}
 assert.equal(new Set(after.payload.auditLogs.map(a=>a.id)).size,after.payload.auditLogs.length);assert.equal(after.payload.auditLogs.length,500);
 return {caseId:c.id,linkedTaskId:c.linkedTaskId,ordinaryTaskId:ordinary[0].id};
}
async function concurrentStage(id,people,submit){
 currentCase=id;const stageStarted=Date.now(),before=await read(),beforeLedger=await ledger(),unchanged=await bystanders(),networkStart=receipt.network.length;for(const p of people)await remember(p);
 rendezvous=true;await Promise.all(people.map((p,i)=>p.click(submit[i])));
 const batch=await until(()=>{const rows=paused.filter(r=>!r.released);return rows.length===2?rows:false;},id+' actual outgoing rendezvous',7000);
 assert.deepEqual(batch.map(r=>r.actor).sort(),targets.map(t=>t[0]).sort());for(const r of batch)assert.deepEqual(r.auditExpected,before.payload.auditLogs.map(a=>a.id),'same actual audit base');
 const owned=await locks();assert.ok(owned.length>=2);const guards=batch.flatMap(r=>outgoing.get(r.operationId).p_lock_guards);for(const g of guards)assert.ok(owned.some(l=>l.section_key===g.section_key&&l.locked_by===g.locked_by),'all outgoing legal original leases');
 const first=batch.find(r=>r.actor==='qa-operator'),peer=batch.find(r=>r!==first);barrier={operationId:first.operationId};first.released=true;await call('Fetch.continueRequest',{requestId:first.requestId},first.session);await until(()=>barrier.entered,'A pre-COMMIT',4000);peer.released=true;await call('Fetch.continueRequest',{requestId:peer.requestId},peer.session);
 const blocking=await until(async()=>{const rows=(await native.observer.query("select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where application_name like 'record_native_http_%' and wait_event_type='Lock'")).rows;return rows.find(r=>r.blockers.includes(barrier.pid));},'actual B PG blocking',4000);
 assert.ok(receipt.httpTransactions.some(t=>t.operationId===peer.operationId&&t.pid===blocking.pid));assert.notEqual(blocking.pid,barrier.pid);assert.deepEqual(await read(),before);for(const p of people){assert.ok(await draft(p));await p.screen(id+'-pending-'+p.actor);}assert.deepEqual(await locks(),owned);
 receipt.rounds.push({caseId:id,baseRevision:before.revision,requests:batch.map(({session,requestId,...safe})=>safe),blocking:{leaderPid:barrier.pid,peerOperationId:peer.operationId,...blocking},draftRetained:true,preCommitHoldMs:Date.now()-barrier.enteredAt,leaseKeys:owned.map(l=>l.section_key)});save();rendezvous=false;releaseCommit();barrier=null;
 for(const p of people){
  await until(async()=>await p.saved()||await p.eval("Boolean(document.querySelector('.save-status-strip.error'))"),id+' automatic terminal '+p.actor,18000);
  let manualRequired=!(await p.saved()),recoveryAction=null;
  if(manualRequired){assert.ok(await draft(p));await p.screen(id+'-manual-'+p.actor);await p.sync();recoveryAction='original-sync';if(!receipt.network.slice(networkStart).some(n=>n.actor===p.actor&&n.rpc===patchRpc&&n.result==='SQL_OK')){await p.click('重新保存');recoveryAction+='-then-resave';}await until(()=>receipt.network.slice(networkStart).some(n=>n.actor===p.actor&&n.rpc===patchRpc&&n.result==='SQL_OK'),'manual SQL ACK');if(await p.eval("Boolean(document.querySelector('[role=dialog]'))"))await p.click(submit[people.indexOf(p)]);await until(()=>p.saved(),'manual original close');}
  const chain=receipt.network.slice(networkStart).filter(n=>n.actor===p.actor&&n.rpc===patchRpc);assert.equal(chain.filter(n=>n.result==='SQL_OK'&&n.httpStatus===200).length,1,'one actual business ACK per actor');for(let i=1;i<chain.length;i++){assert.notEqual(chain[i].operationId,chain[i-1].operationId);assert.ok(receipt.network.some(n=>n.actor===p.actor&&/^read_ship_dynamics_record/.test(n.rpc)&&n.started>=chain[i-1].started&&n.started<chain[i].started&&n.finished),'original App reread between retry operations');}
  receipt.actorResults.push({caseId:id,actor:p.actor,automaticSuccess:!manualRequired,manualRequired,recoveryAction,attempts:chain.length,chain});await p.screen(id+'-ACK-'+p.actor);
 }
 if(id==='M2'){const a=people[0];await until(()=>a.eval("Boolean(document.querySelector('#vessel-edit-title'))"),'original return to source vessel editor');const closeCount=receipt.network.filter(n=>n.rpc===patchRpc).length;await a.click('取消並關閉');await until(()=>a.saved(),'unchanged source editor closed');assert.equal(receipt.network.filter(n=>n.rpc===patchRpc).length,closeCount,'source return cancel has zero business writes');}
 await until(async()=>(await locks()).length===0,'all stage leases released');const after=await read(),success=receipt.network.slice(networkStart).filter(n=>n.rpc===patchRpc&&n.result==='SQL_OK'&&n.httpStatus===200);assert.equal(success.length,2);assert.equal(after.revision,before.revision+2);const ids=await expectedStage(before,after,batch,success);
 const finalLedger=await ledger();assert.equal(finalLedger.length,beforeLedger.length+2);for(const n of success){assert.equal(finalLedger.filter(r=>r.operation_id===n.operationId&&r.result.revision===n.revision).length,1);assert.ok(receipt.httpTransactions.some(t=>t.operationId===n.operationId&&t.committed&&t.status==='SQL_OK'));}
 await freshReadback(id,after);assert.deepEqual(await bystanders(),unchanged);await wait(1400);assert.deepEqual(await read(),after,'zero trailing writes');assert.deepEqual(await ledger(),finalLedger);receipt.cases.push({caseId:id,status:'PASS',layer:'original-App-native-PG',ids,elapsedMs:Date.now()-stageStarted,fullGraph:true,freshSql:true,freshDocuments:2,allLeasesReleased:true});save();return {after,ids};
}
try{
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true,beforeCommit:async({context,pid,value})=>{
  if(barrier&&context.operationId===barrier.operationId){assert.equal(value.ok,true,'A real SQL executed successfully');barrier.pid=pid;barrier.entered=true;barrier.enteredAt=Date.now();save();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('private commit barrier budget exceeded')),6000);releaseCommit=()=>{clearTimeout(timer);resolve();};});}
 }});
 qa=await createRecordStorageLocalQa({internalControl:true,performanceTrace:true,preparePerformanceFixture:mixedFixture,databaseFactory:async()=>native.adapter});
 receipt.origin=qa.origin;assert.equal((await (await fetch(qa.origin+'/__qa/health')).json()).kind,'REAL_UI_SYNTHETIC_DATA_NATIVE_POSTGRES');
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let socketPath;await until(()=>{try{[chromePort,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(chromePort)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome handshake');
 receipt.chrome={pid:browser.pid,port:Number(chromePort)};
 ws=new WebSocket(`ws://127.0.0.1:${chromePort}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')receipt.errors.push(m.params.exceptionDetails.text);
   if(m.method==='Page.javascriptDialogOpening'){
    const {type,message}=m.params,actor=actors.find(p=>p.s===m.sessionId)?.actor;
    const exhaustion=type==='alert'&&currentCase==='U3a'&&message==='最新修改尚未在雲端確認；協作鎖仍保留，請先處理保存狀態。';
    const abnormal=type==='confirm'&&message==='是否將這筆關聯要事勾選「近期內需要特別關注的異常」？\n\n按「確定」：勾選異常。\n按「取消」：不勾選異常，但仍會建立關聯要事。';
    const accept=abnormal||exhaustion||type==='beforeunload'||type==='confirm'&&['同步最新會保留本機修改','請盡量以船端修改為主'].some(t=>message.startsWith(t));
    receipt.dialogs.push({type,message,actor,caseId:currentCase,classification:exhaustion?'controlled-exhaustion-alert':accept?'expected-confirm':'unexpected'});
    if(!accept)receipt.errors.push('unexpected dialog: '+message);await call('Page.handleJavaScriptDialog',{accept:accept&&!abnormal},m.sessionId);
   }
   if(m.method==='Fetch.requestPaused'){
    const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);
    if(!allowed)receipt.blockedExternal.push(u.origin);
    if(allowed&&rendezvous&&u.pathname.endsWith('/rpc/'+patchRpc)){
     const body=JSON.parse(m.params.request.postData);for(const op of body.p_operations){if(op.kind==='entity'&&op.collection==='auditLogs'&&op.expected===null&&!outgoingAuditBodies.has(op.entityId))outgoingAuditBodies.set(op.entityId,structuredClone(op.value));}paused.push({session:m.sessionId,requestId:m.params.requestId,operationId:body.p_operation_id,actor:body.p_actor_user_id,payloadHash:hash(body),auditExpected:body.p_operations.find(o=>o.kind==='order'&&o.collection==='auditLogs')?.expectedIds});save();return;
    }
    await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);
   }
   if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(qa.origin+'/rest/v1/rpc/')){
    const b=JSON.parse(m.params.request.postData||'{}');if(b.p_operations){outgoing.set(b.p_operation_id,structuredClone(b));for(const o of b.p_operations)if(o.kind==='entity'&&o.collection==='auditLogs'&&o.expected===null&&!outgoingAuditBodies.has(o.entityId))outgoingAuditBodies.set(o.entityId,structuredClone(o.value));}const row={caseId:currentCase,actor:actors.find(p=>p.s===m.sessionId)?.actor,rpc:m.params.request.url.split('/').at(-1),operationId:b.p_operation_id,payloadHash:hash(b),auditExpected:b.p_operations?.find(o=>o.kind==='order'&&o.collection==='auditLogs')?.expectedIds,auditIds:b.p_operations?.filter(o=>o.collection==='auditLogs'&&o.kind!=='order').map(o=>o.id||o.entityId||o.value?.id),started:m.params.wallTime*1000};
    netRows.set(m.sessionId+':'+m.params.requestId,row);receipt.network.push(row);
   }
   const row=netRows.get(m.sessionId+':'+m.params.requestId);
   if(m.method==='Network.responseReceived'&&row)row.httpStatus=m.params.response.status;
   if(m.method==='Network.loadingFinished'&&row){const response=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId);const v=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body);Object.assign(row,{finished:Date.now(),result:v?.ok===false?v.code:'SQL_OK',conflictKey:v?.conflict_key,revision:v?.revision,errorCode:v?.code,message:v?.message});save();}
  };void handle().catch(e=>receipt.errors.push(e.message));
 });

 for(const [actor,vessel] of targets){const context=(await call('Target.createBrowserContext')).browserContextId,p=await makePage(actor,context);p.vessel=vessel;await login(p);await wait(1500);await until(()=>p.saved(),'login notification-read settles');}
 const people=actors.filter(p=>!p.reader),[a,b]=people;for(const p of people)await p.sync();await wait(1500);const settled=await read();receipt.initialization={revision:settled.revision,operations:(await ledger()).length,classification:'legitimate notification-read initialization excluded from business saves'};
 receipt.fixture={audits:settled.payload.auditLogs.length,tasks:settled.payload.tasks.length,cases:settled.payload.internalControlCases.length,vessels:settled.payload.vessels.length,notifications:settled.payload.notifications.length,dismissals:settled.payload.taskDismissals.length};for(const n of Object.values(receipt.fixture))assert.ok(n>0);save();
 a.field=taskField;a.marker='MIXED ORDINARY';b.field=caseField;b.marker='MIXED CASE';
 await a.activate("[...([...document.querySelectorAll('article.ship-card')].find(n=>n.innerText.includes('QA VESSEL 1'))).querySelectorAll('button')].find(n=>n.innerText.trim()==='新增要事')");await until(()=>a.eval("Boolean(document.querySelector('#task-edit-title'))"),'ordinary original creation');await rich(a,a.marker);for(const label of ['維修','管理組'])await nodeClick(a,labelInput(label));assert.equal(await a.eval("document.querySelector('.internal-control-toggle input').checked"),false);
 await b.click('內控異常');await until(async()=>(await b.text()).includes('QA restricted'),'owner original cases');await b.click('＋ 批量新增');await until(async()=>(await b.text()).includes('批量新增內控異常'),'original batch create');await select(b,icField('船舶 *','select'),'qa-v2');await select(b,icField('事件分類 *','select'),'維修');await b.fill(caseField,b.marker);await b.fill(icField('解決計劃／最新狀態 *','textarea'),'MIXED PLAN');await nodeClick(b,labelInput('督導','.ic-batch-row > .ic-choice-picker'));await nodeClick(b,labelInput('同步到要事'));await until(async()=>(await b.text()).includes('同步要事設定'),'linked settings');
 const m1=await concurrentStage('M1',people,['保存並關閉','保存 1 筆案件']);
 for(const p of people)await p.sync();await wait(1200);
 a.marker='MIXED ORDINARY UPDATED';await a.open('qa-v1');await a.activate("[...document.querySelectorAll('.modal-task-row')].find(n=>n.innerText.includes('MIXED ORDINARY'))");await until(()=>a.eval("Boolean(document.querySelector('#task-edit-title'))"),'ordinary original update');await rich(a,a.marker);
 await closeCaseOpen(b,'MIXED CASE');await nodeClick(b,labelInput('點擊結案'));
 const m2=await concurrentStage('M2',people,['保存變更','保存更新']);assert.equal(m2.ids.caseId,m1.ids.caseId);assert.equal(m2.ids.linkedTaskId,m1.ids.linkedTaskId);assert.equal(m2.ids.ordinaryTaskId,m1.ids.ordinaryTaskId);
 for(const p of people){await p.eval('window.__mixedOldDocument=true');await call('Page.reload',{},p.s);await until(()=>p.eval("!window.__mixedOldDocument&&document.readyState==='complete'"),'real replacement document');await until(()=>p.saved(),'original reload readiness');}
 assert.ok((await a.text()).includes('MIXED ORDINARY UPDATED'));await b.click('內控異常');await b.activate("[...document.querySelectorAll('.ic-tabs button')].find(n=>n.innerText.startsWith('內控結案清單'))");await until(async()=>(await b.text()).includes('MIXED CASE'),'closed case after real reload');await wait(1400);assert.deepEqual(await read(),m2.after,'no reload business writes');assert.deepEqual(await locks(),[]);
 receipt.reload={originalDocuments:2,ordinaryUpdatedVisible:true,caseClosedListVisible:true,noBusinessWrites:true};assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>m.status==='UNSUPPORTED'));receipt.status='PASS';receipt.totals={cases:receipt.cases.length,actorStages:receipt.actorResults.length,automatic:receipt.actorResults.filter(r=>r.automaticSuccess).length,manual:receipt.actorResults.filter(r=>r.manualRequired).length};save();
}catch(e){failure=e;try{fs.writeFileSync(path.join(run,'failure-readback.json'),JSON.stringify(scrub(await read()),null,2));receipt.failureLeaseKeys=(await locks()).map(l=>l.section_key);}catch{}receipt.status='FAIL';receipt.failure={caseId:currentCase,message:e.message,stack:e.stack?.split('\n').slice(0,5)};for(const p of actors.filter(p=>!p.reader)){try{receipt['failureText-'+p.actor]=(await p.text()).slice(0,8000);await p.screen('failure-'+p.actor);}catch{}}console.error(JSON.stringify({status:'FAIL',caseId:currentCase,error:e.message,run}));}
finally{
 releaseCommit?.();rendezvous=false;for(const r of paused.filter(r=>!r.released)){try{await call('Fetch.failRequest',{requestId:r.requestId,errorReason:'Aborted'},r.session);}catch{}}receipt.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'Chrome stopped',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});}}
 try{if(qa)await qa.close();if(native)await native.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));if(chromePort)assert.equal(await portClosed(Number(chromePort)),true);assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);fs.rmSync(profile,{recursive:true,force:true});receipt.cleanup={httpStopped:true,chromeStopped:true,chromePortClosed:true,profileRemoved:true,pgStopped:receipt.stopped,pgPortClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved};}catch(e){failure??=e;receipt.cleanupError=e.message;receipt.status='FAIL';}
 receipt.commands[0].exit=failure?1:0;save();console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases.map(c=>c.caseId),cleanup:receipt.cleanup}));if(failure)process.exitCode=1;
}

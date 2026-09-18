import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {shipInternalControlInput,installShipInternalControlFixture} from './ship-internal-control-local-fixture.mjs';

// Real entry points + synthetic fixture + native PostgreSQL. Never hosted Supabase.
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));
const run=fs.mkdtempSync(path.join(root,'concurrent-ui-')),profile=path.join(run,'chrome');
const evidence={label:'真實 UI＋測試資料＋本機 native PostgreSQL；非正式環境',status:'RUNNING',cases:[],commands:[],errors:[],external:[]};
let native,qa,browser,ws,session,sequence=0,failure;
let acceptExpectedConfirm=false;
const pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(80);}throw Error('QA timeout: '+label);};
const call=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++sequence,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const key=async key=>{const p={key,code:key,windowsVirtualKeyCode:({Enter:13,Backspace:8,Home:36,ArrowDown:40})[key],...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})};await call('Input.dispatchKeyEvent',{type:'keyDown',...p});await call('Input.dispatchKeyEvent',{type:'keyUp',...p});};
const click=async(label,selector='button')=>{const expr=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim().includes(${JSON.stringify(label)})&&n.getClientRects().length&&!n.disabled)`;await until(()=>evaluate(`Boolean(${expr})`),'button '+label);await evaluate(`${expr}.focus()`);await key('Enter');};
const fill=async(selector,text)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled||n.readOnly)throw Error('field unavailable');n.focus();n.select();})()`);if(text)await call('Input.insertText',{text});else await key('Backspace');};
const choose=async(selector,value)=>{const index=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)throw Error('select unavailable');n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(index>=0,'option '+value);await key('Home');for(let i=0;i<index;i++)await key('ArrowDown');await key('Enter');};
const screen=async name=>fs.writeFileSync(path.join(run,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
const read=async()=> (await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;
const descriptions=()=>evaluate("[...document.querySelectorAll('.ic-batch-row .ic-case-content-row .field:first-child textarea')].map(n=>n.value)");
const fillRow=async(index,description)=>{const row=`.ic-batch-row:nth-child(${index+1})`;await choose(`${row} .ic-case-classification-row .field:nth-child(2) select`,'維修');await fill(`${row} .ic-case-content-row .field:first-child textarea`,description);await fill(`${row} .ic-case-content-row .field:nth-child(2) textarea`,'待岸端協助 '+description);};
const check=async(id,fn)=>{await fn();evidence.cases.push({caseId:id,status:'PASS'});};
async function page(url){
 const {browserContextId}=await call('Target.createBrowserContext',{},null);
 const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId},null);
 ({sessionId:session}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 for(const method of ['Page.enable','Runtime.enable','Network.enable'])await call(method);
 await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url});return session;
}
async function office(user){
 const sid=await page(qa.origin);
 await until(()=>evaluate("document.body?.innerText.includes('請輸入管理者設定的進站密碼。')"),'site gate');
 await fill('input[type=password]',qa.password);await click('進入系統');
 await until(()=>evaluate("!!document.querySelector('select[aria-label=登入人員]')"),'identity gate');
 await choose('select[aria-label=登入部門]',user==='qa-owner'?'督導':'管理組');
 await choose('select[aria-label=登入人員]',user);
 if(await evaluate("!!document.querySelector('input[type=password]')"))await fill('input[type=password]',qa.password);
 await click('登入');await until(()=>evaluate("!!document.querySelector('nav')&&!document.body.innerText.includes('人員登入／切換')"),'original App login');
 return sid;
}

const RPC_SHIP='submit_ship_dynamics_internal_control_public_v1',RPC_MAIN='apply_ship_dynamics_record_patch_v1';
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const wanted=[],network=new Map();evidence.httpAcks=[];evidence.blocking=[];
let barrier=null,intendedSaves=0;
const freshBarrier=rpc=>{let release;const ready=new Promise(r=>release=r);return {rpc,ready,release,reached:false};};
const preserveUnrelated=(before,after,changed=[])=>{
 for(const key of ['users','vessels','settings','tasks','meetings','agendaReports','taskDismissals','notifications'])assert.equal(sha(after[key]),sha(before[key]),'unrelated '+key);
 for(const c of before.internalControlCases)if(!changed.includes(c.id))assert.equal(sha(after.internalControlCases.find(x=>x.id===c.id)),sha(c),'existing case '+c.id+' retained');
 for(const row of before.auditLogs)assert.equal(sha(after.auditLogs.find(x=>x.id===row.id)),sha(row),'historical audit retained');
 assert.equal(new Set(after.internalControlCases.map(x=>x.id)).size,after.internalControlCases.length,'no duplicate case IDs');
};
const openBatch=async(sid,ship,names)=>{
 session=sid;await click(ship?'增加內控/訴求':'批量新增');await until(()=>evaluate("!!document.querySelector('.ic-batch-modal')"),'batch modal');
 if(!ship)await choose('.ic-batch-modal select','qa-v1');
 for(let i=0;i<names.length;i++){if(i)await click('新增一筆','.ic-batch-modal button');await fillRow(i,names[i]);}
 assert.deepEqual(await descriptions(),names);return names.length;
};
const submitBatch=async(sid,ship,n)=>{session=sid;intendedSaves++;await click(ship?`提交 ${n} 筆`:`保存 ${n} 筆案件`,'.ic-batch-modal button');};
const batchAck=async(sid,ship,n)=>{session=sid;await until(()=>evaluate(`!document.querySelector('.ic-batch-modal')${ship?`&&document.body.innerText.includes('成功提交 ${n} 筆')`:''}`),'original '+(ship?'ship':'shore')+' ACK closes modal');};
const requireCases=async names=>{
 const payload=(await read()).payload;
 for(const name of names){const rows=payload.internalControlCases.filter(x=>x.description===name);assert.equal(rows.length,1,'exactly one '+name);assert.equal(rows[0].status,'待岸端協助 '+name);assert.equal(rows[0].vesselId,'qa-v1');assert.equal(rows[0].syncToTask,false);assert.equal(rows[0].isClosed,false);}
 return payload;
};
const observeBlocked=async(peerRpc,since)=>{
 let observed;
 await until(async()=>{
  const rows=evidence.httpTransactions.filter(x=>x.rpc===peerRpc&&x.started>=since&&x.pid!==barrier.pid&&!x.ended);
  for(const peer of rows){const row=(await native.observer.query('select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[peer.pid])).rows[0];if(row?.wait_event_type==='Lock'&&row.blockers.includes(barrier.pid)){observed={...row,ownerPid:barrier.pid,ownerRpc:barrier.rpc,peerRpc,operationId:peer.operationId};return true;}}
  return false;
 },'actual independent PostgreSQL blocker',6500);
 assert.notEqual(observed.pid,observed.ownerPid);evidence.blocking.push(observed);
};
try{
 evidence.input={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),runnerSha256:sha(fs.readFileSync(new URL(import.meta.url),'utf8'))};
 evidence.input.appSha256=sha(fs.readFileSync('src/App.tsx','utf8'));
 native=await createNativeRecordQa(run,evidence,{httpTransactions:true,beforeCommit:async({context,pid,value})=>{if(barrier&&context.rpc===barrier.rpc&&!barrier.reached&&value?.ok!==false){const active=barrier;active.reached=true;active.pid=pid;active.operationId=context.operationId;await active.ready;}}});
 qa=await createRecordStorageLocalQa({browserAuthority:true,internalControl:true,taskMember:true,scopedRead:true,shipInternalControl:true,performanceTrace:true,databaseFactory:async()=>native.adapter,preparePerformanceFixture:async initial=>{shipInternalControlInput(initial);for(const [i,v] of initial.vessels.entries()){v.name=`QA 船 ${i+1}`;v.shortName=`QA SHIP ${i+1}`;v.fullName=`QA SHIP ${i+1}`;}}});
 await installShipInternalControlFixture(native.adapter,qa.workspace);
 browser=spawn(process.env.QA_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')),'Chrome readiness');
 const [port,socket]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);
 ws=new WebSocket(`ws://127.0.0.1:${port}${socket}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Fetch.requestPaused'){const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);if(!allowed)evidence.external.push(u.origin);await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}
   if(m.method==='Page.javascriptDialogOpening'){const ok=m.params.type==='beforeunload'||(acceptExpectedConfirm&&m.params.type==='confirm'&&m.params.message.includes('本機草稿尚未保存'));if(!ok)evidence.errors.push('unexpected dialog: '+m.params.message);await call('Page.handleJavaScriptDialog',{accept:ok},m.sessionId);}
  };void handle().catch(e=>evidence.errors.push(e.message));
 });

 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);void(async()=>{
  if(m.method==='Network.requestWillBeSent'){
   const q=m.params,uri=new URL(q.request.url),rpc=uri.pathname.split('/').at(-1);
   if([RPC_SHIP,RPC_MAIN].includes(rpc)){const body=JSON.parse(q.request.postData||'{}');network.set(m.sessionId+':'+q.requestId,{rpc,operationId:body.p_operation_id,payloadHash:sha(q.request.postData||''),requestId:q.requestId,sessionId:m.sessionId});}
  }
  const item=network.get(m.sessionId+':'+m.params?.requestId);if(!item)return;
  if(m.method==='Network.responseReceived')item.httpStatus=m.params.response.status;
  if(m.method==='Network.loadingFinished'){
   const response=await call('Network.getResponseBody',{requestId:m.params.requestId},m.sessionId),v=JSON.parse(response.body);
   evidence.httpAcks.push({...item,ok:v?.ok,status:v?.status,code:v?.code,conflictKey:v?.conflict_key,revision:v?.revision});
  }
 })().catch(e=>evidence.errors.push('network evidence: '+e.message));});
 const ship=await page(qa.origin+'/ship-internal-control.html');
 await until(()=>evaluate("document.querySelector('#ship-internal-vessel')?.options.length===3"),'active ship selector');await choose('#ship-internal-vessel','qa-v1');
 const seed='QA 並發原案件';await openBatch(ship,true,[seed]);await submitBatch(ship,true,1);await batchAck(ship,true,1);wanted.push(seed);
 const main=await office('qa-manager');await click('內控異常','nav button');
 await until(()=>evaluate(`document.querySelector('.ic-table')?.innerText.includes(${JSON.stringify(seed)})`),'shore sees ship-created case');
 await check('C01-existing-shore-edit-ship-append-then-real-shore-save',async()=>{
  const before=(await read()).payload,existing=before.internalControlCases.find(x=>x.description===seed);
  await evaluate(`(()=>{const row=[...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.innerText.includes(${JSON.stringify(seed)}));[...row.querySelectorAll('button')].find(n=>n.textContent==='更新').focus();})()`);await key('Enter');
  await until(()=>evaluate("!!document.querySelector('.ic-edit-modal')"),'original case editor');
  const field='.ic-edit-modal .ic-case-content-row .field:nth-child(2) textarea',status='QA 岸端保留原草稿並完成保存';
  await fill('.ic-status-add textarea',status);await click('加入狀態記錄','.ic-status-add button');await evaluate(`void(window.__qaEditingNode=document.querySelector(${JSON.stringify(field)}))`);
  const added='QA 船端在岸端編輯期間新增';await openBatch(ship,true,[added]);await submitBatch(ship,true,1);await batchAck(ship,true,1);
  const between=(await read()).payload;assert.equal(between.internalControlCases.find(x=>x.id===existing.id).status,existing.status,'shore draft not prematurely saved');
  session=main;assert.equal(await evaluate(`document.querySelector(${JSON.stringify(field)})===window.__qaEditingNode&&window.__qaEditingNode.value===${JSON.stringify(status)}`),true,'same mounted draft');await screen('C01-draft-after-ship-commit');
  intendedSaves++;await click('保存更新','.ic-edit-modal button');await until(()=>evaluate("!document.querySelector('.ic-edit-modal')"),'shore actual save ACK');
  const after=await requireCases([added]);assert.equal(after.internalControlCases.find(x=>x.id===existing.id).status,status);preserveUnrelated(before,after,[existing.id]);
  wanted.push(added);await screen('C01-both-saved');
 });
 for(const [caseId,firstShip,shipNames,shoreNames] of [
  ['C02-ship-uncommitted-shore-batch-save',true,['QA C02 船端新增甲','QA C02 船端新增乙'],['QA C02 岸端新增甲','QA C02 岸端新增乙']],
  ['C03-shore-uncommitted-ship-save',false,['QA C03 船端新增'],['QA C03 岸端新增']],
 ])await check(caseId,async()=>{
  const before=(await read()).payload,since=new Date().toISOString();
  await openBatch(main,false,shoreNames);await openBatch(ship,true,shipNames);
  barrier=freshBarrier(firstShip?RPC_SHIP:RPC_MAIN);
  await submitBatch(firstShip?ship:main,firstShip,firstShip?shipNames.length:shoreNames.length);
  await until(()=>barrier.reached,'real RPC before COMMIT');
  await submitBatch(firstShip?main:ship,!firstShip,firstShip?shoreNames.length:shipNames.length);
  await observeBlocked(firstShip?RPC_MAIN:RPC_SHIP,since);
  const pending=(await read()).payload;assert.equal(pending.internalControlCases.length,before.internalControlCases.length,'neither uncommitted batch visible');
  barrier.release();barrier=null;
  await batchAck(ship,true,shipNames.length);await batchAck(main,false,shoreNames.length);
  const after=await requireCases([...shipNames,...shoreNames]);assert.equal(after.internalControlCases.length,before.internalControlCases.length+shipNames.length+shoreNames.length);preserveUnrelated(before,after);
  wanted.push(...shipNames,...shoreNames);await screen(caseId+'-confirmed');
 });
 await check('C04-fresh-shore-list-and-personal-work-center',async()=>{
  await office('qa-manager');await click('內控異常','nav button');
  await until(()=>evaluate(`(()=>{const text=document.querySelector('.ic-table')?.innerText||'';return ${JSON.stringify(wanted)}.every(s=>text.includes(s));})()`),'fresh original list contains every saved case');
  const descriptions=await evaluate("[...document.querySelectorAll('.ic-table tbody tr td.ic-description-column b')].map(n=>n.textContent)");assert.deepEqual(descriptions.sort(),[...wanted].sort());await screen('C04-fresh-main-readback');
  await click('我的待辦','nav button');await until(()=>evaluate(`(()=>{const text=document.body.innerText;return ${JSON.stringify(wanted)}.every(s=>text.includes(s));})()`),'all ship and shore cases in assigned work center');await screen('C04-work-center');
  const data=(await read()).payload;assert.equal(data.internalControlCases.length,wanted.length);assert.equal(data.tasks.length,0);
  evidence.final={caseCount:data.internalControlCases.length,uniqueIds:new Set(data.internalControlCases.map(x=>x.id)).size,expectedDescriptions:wanted,tasks:data.tasks.length,businessDigest:sha(data)};
 });
 await until(()=>evidence.httpAcks.filter(x=>x.ok===true).length>=intendedSaves,'captured actual browser ACKs');
 assert.equal(evidence.httpAcks.filter(x=>x.ok===true).length,intendedSaves,'one browser ACK per UI save intent');
 assert.deepEqual(evidence.external,[]);assert.deepEqual(evidence.errors,[]);
 evidence.metrics=qa.metrics;evidence.end={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),appSha256:sha(fs.readFileSync('src/App.tsx','utf8'))};assert.equal(evidence.end.head,evidence.input.head);assert.equal(evidence.end.status,evidence.input.status);assert.equal(evidence.end.appSha256,evidence.input.appSha256);evidence.status='PASS';
}catch(error){failure=error;evidence.status='FAIL';evidence.error=error.stack;evidence.metrics=qa?.metrics;try{evidence.failureDom=await evaluate("document.body.innerText");await screen('failure');}catch{}}
finally{
 if(barrier){barrier.release();barrier=null;}
 if(ws){try{await call('Browser.close',{},null);}catch{}ws.close();}if(browser)browser.kill();if(qa)await qa.close();if(native)await native.close();
 fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,run,cases:evidence.cases,blocking:evidence.blocking,httpAcks:evidence.httpAcks,final:evidence.final,error:evidence.error},null,2));
}
if(failure)process.exitCode=1;

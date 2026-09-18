import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createNativeRecordQa } from './record-storage-native-qa.mjs';
import { createRecordStorageLocalQa } from './record-storage-local-qa.mjs';

// Original App -> Management -> original commit queue -> local native SQL.
// Synthetic accounts and records only; no persistent user browser or external hosts.
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root && path.isAbsolute(root));
const run=fs.mkdtempSync(path.join(root,'particulars-ui-')),profile=path.join(run,'chrome');
const storageMode=process.env.QA_PARTICULARS_STORAGE||'records-v1';
assert.ok(['records-v1','legacy'].includes(storageMode));
const evidence={storageMode,label:'真實原版 App／Management＋測試資料＋本機 native PostgreSQL；非正式環境',status:'RUNNING',cases:[],commands:[],errors:[],external:[]};
let native,qa,browser,ws,session,sequence=0,failure;
const pending=new Map();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(80);}throw Error('QA timeout: '+label);};
const call=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++sequence,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const key=async key=>{const params={key,code:key,windowsVirtualKeyCode:({Enter:13,Backspace:8,Home:36,ArrowDown:40})[key],...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})};await call('Input.dispatchKeyEvent',{type:'keyDown',...params});await call('Input.dispatchKeyEvent',{type:'keyUp',...params});};
const activate=async expr=>{await evaluate(`(()=>{const n=${expr};if(!n||n.disabled||!n.getClientRects().length)throw Error('button unavailable');n.focus();})()`);await key('Enter');};
const click=async(label,selector='button',ends=false)=>{const expr=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim().${ends?'endsWith':'includes'}(${JSON.stringify(label)})&&n.getClientRects().length&&!n.disabled)`;await until(()=>evaluate(`Boolean(${expr})`),'button '+label);await activate(expr);};
const fill=async(selector,text)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled||n.readOnly)throw Error('field unavailable');n.focus();n.select();})()`);if(text)await call('Input.insertText',{text});else await key('Backspace');};
const screen=async name=>fs.writeFileSync(path.join(run,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
const values=()=>evaluate("[...document.querySelectorAll('input[aria-label=年份],input[aria-label=噸數]')].map(n=>n.value)");
const read=async()=>storageMode==='legacy'?(await native.observer.query('select payload,revision from ship_dynamics_app_state where workspace_key=$1',[qa.workspace])).rows[0]:(await native.observer.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;
async function openManagement(){
 await click('管理','nav button');await until(()=>evaluate("!!document.querySelector('.management-view')"),'Management');
 await click('船舶','.management-sidebar button',true);
 await click('FPMC S AMBER','.management-master .management-list button');
 await until(()=>evaluate("!!document.querySelector('input[aria-label=年份]')"),'particulars inputs');
}
try{
 native=await createNativeRecordQa(run,evidence,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({legacySnapshot:storageMode==='legacy',browserAuthority:true,internalControl:true,taskMember:true,scopedRead:true,performanceTrace:true,databaseFactory:async()=>native.adapter,preparePerformanceFixture:async initial=>{
   Object.assign(initial.vessels[0],{name:'安華輪',shortName:'FPMC S AMBER',fullName:'FPMC S AMBER'});
   Object.assign(initial.vessels[1],{name:'QA OTHER',shortName:'QA OTHER',fullName:'QA OTHER'});
   for(const vessel of initial.vessels){delete vessel.nameEn;delete vessel.yearLabel;delete vessel.tonnageLabel;vessel.assignedUserIds=[];vessel.delegateManagers=[];}
   for(const name of ['tasks','meetings','internalControlCases','agendaReports','notifications','auditLogs','taskDismissals'])initial[name]=[];
 }});
 // Install the current original-App authority prerequisites, not a fake getter.
 const {installMorningOracle,schedulerSql}=await import('./record-daily-morning-local-fixture.mjs');
 await installMorningOracle(native.adapter);await native.adapter.exec(fs.readFileSync(schedulerSql,'utf8'));
 for(const file of ['supabase/migrations/20260904161000_appdata_compact_ack_receipts.sql','supabase/migrations/20260817143000_data_management_storage.sql','supabase/migrations/20260818154500_data_management_prune_batch_limit.sql','supabase/normalized-legacy-cutover.sql','supabase/development/20260911_legacy_report_workspace_binding.sql','supabase/development/20260911_business_quiescence.sql','supabase/development/20260911_paused_record_legacy_transfer.sql','supabase/development/20260911_source_authority_publication.sql','supabase/development/20260912_browser_source_authority.sql'])await native.adapter.exec(fs.readFileSync(file,'utf8'));
 browser=spawn(process.env.QA_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')),'Chrome readiness');
 const [port,socket]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);
 ws=new WebSocket(`ws://127.0.0.1:${port}${socket}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
   const handle=async()=>{
     if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.text);
     if(m.method==='Fetch.requestPaused'){
       const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);
       if(!allowed)evidence.external.push(u.origin);
       await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);
     }
     if(m.method==='Page.javascriptDialogOpening'){
       const ok=m.params.type==='beforeunload';if(!ok)evidence.errors.push('unexpected dialog: '+m.params.message);
       await call('Page.handleJavaScriptDialog',{accept:ok},m.sessionId);
     }
   };void handle().catch(error=>evidence.errors.push(error.message));
 });
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);
 ({sessionId:session}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 for(const method of ['Page.enable','Runtime.enable','Network.enable'])await call(method);
 await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:qa.origin});
 await until(()=>evaluate("document.body?.innerText.includes('請輸入管理者設定的進站密碼。')"),'original site gate');
 await fill('input[type=password]',qa.password);await click('進入系統');
 await until(()=>evaluate("!!document.querySelector('select[aria-label=登入人員]')"),'original identity gate');
 const index=await evaluate("(()=>{const n=document.querySelector('select[aria-label=登入人員]');n.focus();return [...n.options].findIndex(o=>o.value==='qa-owner');})()");
 assert.ok(index>=0);await key('Home');for(let i=0;i<index;i++)await key('ArrowDown');await key('Enter');
 if(await evaluate("!!document.querySelector('input[type=password]')"))await fill('input[type=password]',qa.password);
 await click('登入');await until(()=>evaluate("!!document.querySelector('nav') && !document.body?.innerText.includes('人員登入／切換')"),'logged-in App');
 await openManagement();
 const before=await read();
 assert.deepEqual(await values(),['2021.06','2.0萬']);
 assert.ok(await evaluate("!!document.querySelector('[data-vessel-particulars-reference]')"));
 await screen('prefilled-editor');
 await click('分管表 PDF');await until(()=>evaluate("!!document.querySelector('.management-assignment-paper')"),'unsaved preview');
 assert.ok(!(await evaluate("document.querySelector('.management-assignment-paper').innerText")).includes('2021.06'),'unconfirmed historical suggestions stay out of exports');
 await click('關閉','.management-assignment-modal button');
 assert.deepEqual(await read(),before,'opening/prefilling/exporting never writes the reference');
 evidence.cases.push('original-editor-prefill-is-not-a-save');
 await fill('input[aria-label=年份]','2024.03');await fill('input[aria-label=噸數]','2.1萬');
 await click('保存變更','.management-editor button');
 await until(()=>evaluate("document.body?.innerText.includes('船舶資料已保存')"),'real Management ACK');
 const after=await read();
 assert.equal(after.payload.vessels[0].yearLabel,'2024.03');assert.equal(after.payload.vessels[0].tonnageLabel,'2.1萬');
 assert.deepEqual(after.payload.vessels[1],before.payload.vessels[1]);
 assert.deepEqual(after.payload.users,before.payload.users);
 assert.equal(await evaluate("!!document.querySelector('[data-vessel-particulars-reference]')"),false);
 await click('分管表 PDF');await until(()=>evaluate("!!document.querySelector('.management-assignment-paper')"),'saved preview');
 const savedText=await evaluate("document.querySelector('.management-assignment-paper').innerText");
 assert.ok(savedText.includes('2024.03')&&savedText.includes('2.1萬'));
 await click('關閉','.management-assignment-modal button');
 evidence.cases.push('original-Management-save-native-SQL-readback-and-export');
 await fill('input[aria-label=年份]','');await fill('input[aria-label=噸數]','');
 assert.deepEqual(await values(),['',''],'native Backspace must actually clear both editor controls before Save');
 await click('保存變更','.management-editor button');
 await until(async()=>{const value=await read();return value.payload.vessels[0].yearLabel===''&&value.payload.vessels[0].tonnageLabel==='';},'durable explicit clear');
 await until(()=>evaluate("document.body?.innerText.includes('船舶資料已保存')"),'clear ACK');
 await call('Page.reload');await until(()=>evaluate("!!document.querySelector('nav') && !document.body?.innerText.includes('人員登入／切換')"),'fresh App');
 await openManagement();assert.deepEqual(await values(),['','']);
 assert.equal(await evaluate("!!document.querySelector('[data-vessel-particulars-reference]')"),false,'intentional clears never re-prefill after refresh');
 await screen('cleared-editor-after-reload');
 evidence.cases.push('original-App-reload-preserves-explicit-clears');
 assert.ok(qa.metrics.some(row=>row.rpc===(storageMode==='legacy'?'apply_ship_dynamics_block_patch_v2':'apply_ship_dynamics_record_patch_v1')&&row.status==='SQL_OK'));
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.external,[]);
 evidence.status='PASS';
}catch(error){failure=error;evidence.status='FAIL';evidence.error=error.stack;try{evidence.failureText=await evaluate('document.body?.innerText');await screen('failure');}catch{}}
finally{
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null,'Chrome exit',5000);}catch{browser.kill();}}
 if(qa)await qa.close();if(native)await native.close();
 evidence.cleanup={chromeStopped:!browser||browser.exitCode!==null,postgresStopped:evidence.stopped};
 fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({status:evidence.status,storageMode,run,cases:evidence.cases,error:failure?.message,cleanup:evidence.cleanup}));
 if(failure)process.exitCode=1;
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {shipInternalControlInput,installShipInternalControlFixture} from './ship-internal-control-local-fixture.mjs';

// Original browser entry points, real Chromium printToPDF, and owned native PostgreSQL only.
// A test-specific server request.headers IP is set by record-storage-local-qa; no hosted URL is accepted.
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Set an absolute, disposable QA_EVIDENCE_ROOT');
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'ship-internal-download-browser-'));
const profile=path.join(run,'chrome');
const evidence={kind:'real original UI / isolated native PostgreSQL / synthetic cases',status:'RUNNING',cases:[],errors:[],external:[],productionContacted:false};
const migration='supabase/migrations/20261006090000_ship_internal_control_download.sql';
const own='OWN_OPEN_EXPORT_QA',other='OTHER_VESSEL_PRIVATE_QA',closed='CLOSED_CASE_PRIVATE_QA';
const ip='192.0.2.30';
let native,qa,browser,ws,session,ship,admin,secret,receipt,failure,sequence=0,allowResetConfirm=false;
const pending=new Map(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label,ms=25000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(80);}throw Error('QA timeout: '+label);};
const call=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++sequence,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},20000);pending.set(id,{resolve:v=>{clearTimeout(t);resolve(v);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const key=async k=>{const p={key:k,code:k,windowsVirtualKeyCode:({Enter:13,Backspace:8,Home:36,ArrowDown:40,ArrowUp:38})[k],...(k==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})};for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,...p});};
const click=async(label,selector='button')=>{const expr=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim().includes(${JSON.stringify(label)})&&n.getClientRects().length&&!n.disabled)`;await until(()=>evaluate(`Boolean(${expr})`),'click '+label);await evaluate(`${expr}.focus()`);await key('Enter');};
const fill=async(selector,text)=>{await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`),'field '+selector);await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.focus();n.select()})()`);if(text)await call('Input.insertText',{text});else await key('Backspace');};
const choose=async(selector,value)=>{const state=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)throw Error('select unavailable');n.focus();return {from:n.selectedIndex,to:[...n.options].findIndex(o=>o.value===${JSON.stringify(value)})}})()`);assert.ok(state.to>=0,'option '+value);const direction=state.to>=state.from?'ArrowDown':'ArrowUp';for(let i=0;i<Math.abs(state.to-state.from);i++){await key(direction);const expected=state.from+(direction==='ArrowDown'?i+1:-(i+1));await until(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.selectedIndex===${expected}`),'select intermediate '+selector);}await key('Enter');await until(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`),'selected '+selector);};
const check=async(id,fn)=>{await fn();evidence.cases.push({id,status:'PASS'});};
async function page(url){
 const {browserContextId}=await call('Target.createBrowserContext',{},null);
 const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId},null);
 ({sessionId:session}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 for(const method of ['Page.enable','Runtime.enable','Network.enable'])await call(method);
 await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url});return session;
}
const rpcCount=name=>qa.metrics.filter(row=>row.rpc===name&&row.status==='SQL_OK').length;
const downloadAttempts=()=>qa.metrics.filter(row=>row.rpc==='download_ship_dynamics_internal_control_v1'&&row.status!=='ACK_DROPPED_AFTER_SQL').length;
const audit=async()=> (await native.observer.query('select receipt_id::text,vessel_id,ip_address,case_count,result,action from ship_dynamics_internal_control_private.access_logs where workspace_key=$1 order by created_at,receipt_id',[qa.workspace])).rows;
try {
 assert.ok(fs.existsSync(migration),'New download migration absent; browser QA not run');
 native=await createNativeRecordQa(run,evidence,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({browserAuthority:true,internalControl:true,taskMember:true,scopedRead:true,shipInternalControl:true,shipInternalControlDownload:true,performanceTrace:true,hmr:false,databaseFactory:async()=>native.adapter,
  preparePerformanceFixture:initial=>{
   shipInternalControlInput(initial);
   for(const [index,vessel] of initial.vessels.entries()){vessel.name=`QA 船 ${index+1}`;vessel.shortName=`QA SHIP ${index+1}`;vessel.fullName=`QA SHIP ${index+1}`;}
   const at=initial.updatedAt;
   initial.internalControlCases=[
    {id:'qa-own-open',vesselId:'qa-v1',reportDate:'2026-10-01',reportSource:'日常',priority:'高',description:own,category:'維修',equipmentSubcategory:'',departments:['管理組'],status:'處理中',isClosed:false,createdAt:at,updatedAt:at},
    {id:'qa-other-open',vesselId:'qa-v2',reportDate:'2026-10-02',reportSource:'日常',priority:'低',description:other,category:'維修',equipmentSubcategory:'',departments:['管理組'],status:'處理中',isClosed:false,createdAt:at,updatedAt:at},
    {id:'qa-own-closed',vesselId:'qa-v1',reportDate:'2026-10-03',reportSource:'日常',priority:'低',description:closed,category:'維修',equipmentSubcategory:'',departments:['管理組'],status:'已結案',isClosed:true,closedDate:'2026-10-04',createdAt:at,updatedAt:at},
   ];
  }});
 await installShipInternalControlFixture(native.adapter,qa.workspace);
 const migrationSql=fs.readFileSync(migration,'utf8');
 await native.observer.query(migrationSql);
 evidence.migrationSha256=createHash('sha256').update(migrationSql).digest('hex');
 assert.equal((await qa.read()).payload.internalControlCases.length,3,'Fixture must survive normalized import');
 browser=spawn(process.env.QA_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking',`--explicitly-allowed-ports=${new URL(qa.origin).port}`,'--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')),'Chrome readiness');
 const [port,socket]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);
 ws=new WebSocket(`ws://127.0.0.1:${port}${socket}`);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{
  const m=JSON.parse(event.data);
  if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
  const handle=async()=>{
   if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Fetch.requestPaused'){
    const u=new URL(m.params.request.url),allowed=u.origin===qa.origin||['data:','blob:'].includes(u.protocol);
    if(!allowed)evidence.external.push(u.origin);
    await call(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);
   }
   if(m.method==='Page.javascriptDialogOpening'){
    const accepted=m.params.type==='beforeunload'||(allowResetConfirm&&m.params.type==='confirm'&&m.params.message.includes('下載密碼'));
    if(!accepted)evidence.errors.push('unexpected dialog type '+m.params.type);
    await call('Page.handleJavaScriptDialog',{accept:accepted},m.sessionId);
   }
  };void handle().catch(error=>evidence.errors.push(error.message));
 });
 ship=await page(qa.origin+'/ship-internal-control.html');
 await check('UI01-ship-unauthenticated-entry-no-downloaded-cases',async()=>{
  await until(()=>evaluate("document.querySelector('#ship-internal-vessel')?.options.length===3"),'active ship picker');
  assert.equal(await evaluate('document.body.innerText.includes('+JSON.stringify(own)+')'),false);
  await choose('#ship-internal-vessel','qa-v1');
  await until(()=>evaluate("document.querySelector('.ship-internal-actions button')?.disabled===false"),'selected ship');
  await click('下載未結內控清單');
  assert.equal(await evaluate("document.querySelector('#ship-internal-download-password')?.type"),'password');
 });
 admin=await page(qa.origin);
 await check('UI02-existing-owner-password-mints-cloud-admin-session-and-resets-own-ship',async()=>{
  await until(()=>evaluate("document.body?.innerText.includes('請輸入管理者設定的進站密碼。')"),'site gate');
  await fill('input[type=password]',qa.password);await click('進入系統');
  await until(()=>evaluate("!!document.querySelector('select[aria-label=登入人員]')"),'identity gate');
  await choose('select[aria-label=登入部門]','督導');await choose('select[aria-label=登入人員]','qa-owner');
  await fill('input[type=password]',qa.password);await click('登入');
  await until(()=>evaluate("!!document.querySelector('nav')&&!document.body.innerText.includes('人員登入／切換')"),'owner login');
  await until(()=>rpcCount('issue_ship_dynamics_internal_control_admin_session_v1')===1,'admin session SQL');
  await click('管理','nav button');
  await until(()=>evaluate("!!document.querySelector('.management-sidebar')"),'management');
  await click('船端內控下載','.management-sidebar button');
  await until(()=>evaluate("document.querySelector('.management-detail')?.innerText.includes('雲端下載紀錄')"),'admin downloads');
  await until(()=>rpcCount('manage_ship_dynamics_internal_control_download_v1')>=1,'admin list SQL');
  await until(()=>evaluate("document.querySelector('.management-master')?.innerText.includes('尚未設定下載密碼')"),'admin cloud vessels rendered');
  allowResetConfirm=true;
  try{await click('產生此船密碼','.management-editor-actions button');}
  finally{allowResetConfirm=false;}
  await until(()=>evaluate("!!document.querySelector('textarea[aria-label=此船一次性顯示的新下載密碼]')"),'one-time secret');
  secret=await evaluate("document.querySelector('textarea[aria-label=此船一次性顯示的新下載密碼]').value");
  assert.ok(/^[0-9a-f]{64}$/.test(secret),'one-time secret must be a 64-character hex token');
  await until(()=>evaluate("document.querySelector('.management-detail')?.innerText.includes('已核對該船下載密碼已設定')"),'cloud reset readback');
  const resetLogs=await audit();
  assert.ok(resetLogs.some(row=>row.action==='reset'&&row.result==='reset'&&row.vessel_id==='qa-v1'&&row.ip_address===ip),JSON.stringify(resetLogs.map(({action,result,vessel_id,ip_address})=>({action,result,vessel_id,ip_address}))));
  // Password is not logged in metrics, receipts, or browser storage by this harness.
  evidence.adminIssuedFromExistingLogin=true;
 });
 session=ship;
 await check('UI03-wrong-password-and-wrong-vessel-denied-with-no-case-exposure',async()=>{
  const start=downloadAttempts();
  await fill('#ship-internal-download-password','wrong-qa-password');await click('核對並另存 PDF');
  await until(()=>downloadAttempts()===start+1,'wrong-password SQL');
  await until(()=>evaluate("/未提供|沒有提供/.test(document.querySelector('.ship-notice')?.innerText||'')"),'visible denial');
  assert.equal(await evaluate("!!document.querySelector('.ship-internal-export-print')"),false);
  assert.ok(!(await evaluate("document.querySelector('#ship-internal-download-password')?.value")),'entered download password must not remain');
  await choose('#ship-internal-vessel','qa-v2');
  await until(()=>evaluate("document.querySelector('#ship-internal-vessel')?.value==='qa-v2'"),'other ship picker');
  await until(()=>evaluate("document.querySelector('.ship-internal-actions button')?.disabled===false"),'other ship selected');
  await click('下載未結內控清單');await fill('#ship-internal-download-password',secret);await click('核對並另存 PDF');
  await until(()=>downloadAttempts()===start+2,'wrong-vessel SQL');
  await until(()=>evaluate("/未提供|沒有提供/.test(document.querySelector('.ship-notice')?.innerText||'')"),'other ship denial');
  assert.equal(await evaluate("!!document.querySelector('.ship-internal-export-print')"),false);
  const denied=(await audit()).filter(row=>row.action==='download'&&row.result==='denied');
  assert.deepEqual(denied.map(row=>row.vessel_id).sort(),['qa-v1','qa-v2']);
  assert.ok(denied.every(row=>row.ip_address===ip&&row.case_count===0));
 });
 await check('UI04-real-print-path-scoped-PDF-watermark-IP-and-cloud-receipt',async()=>{
  await choose('#ship-internal-vessel','qa-v1');
  await until(()=>evaluate("document.querySelector('.ship-internal-actions button')?.disabled===false"),'own ship selected');
  await click('下載未結內控清單');
  // Only substitute the native dialog, not the product click, RPC, print tree, or print CSS.
  const originalTitle=await evaluate('document.title');
  await evaluate("void(window.__qaPrintCalls=0);window.print=()=>{window.__qaPrintCalls++;window.__qaPrintTitle=document.title}");
  await fill('#ship-internal-download-password',secret);await click('核對並另存 PDF');
  await until(()=>evaluate("window.__qaPrintCalls===1&&!!document.querySelector('.ship-internal-export-print')"),'real print action');
  const printable=await evaluate("(()=>{const n=document.querySelector('.ship-internal-export-print'),w=n.querySelector('.ship-internal-watermark'),f=n.querySelector('footer'),t=n.querySelector('table');return {text:n.innerText,watermark:w.innerText,footer:f.innerText,bodyMode:document.body.classList.contains('printing-ship-internal-control'),password:document.querySelector('#ship-internal-download-password')?.value,headers:[...t.querySelectorAll('thead th')].map(c=>c.textContent.trim()),cells:t.querySelector('tbody tr')?.cells.length,title:window.__qaPrintTitle,printedAt:n.querySelector('p')?.textContent,watermarkCopies:w.querySelectorAll('[data-watermark-tile]').length}})()");
  assert.equal(printable.bodyMode,true);assert.ok(!printable.password,'print action clears the entered password');
  assert.deepEqual(printable.headers,['報告日期／來源','關注','事項','分類／細項','部門','狀態','結案'],'ship PDF must omit duplicate vessel column');
  assert.equal(printable.cells,7,'ship PDF must have seven data columns');
  const printedDate=printable.printedAt.match(/\d{4}\/\d{2}\/\d{2}/)?.[0].replaceAll('/','-');
  assert.equal(printable.title,`內控清單 - QA 船 1 QA SHIP 1 - ${printedDate}`,'native Save-as-PDF filename comes from document.title');
  assert.ok(printable.watermarkCopies>=24,'watermark must tile across the page, not one center mark');
  for(const text of [own,'QA SHIP 1',ip])assert.ok(printable.text.includes(text),'print DOM missing expected marker');
  for(const text of [other,closed,secret,qa.password])assert.ok(!printable.text.includes(text),'print DOM leaked excluded marker');
  receipt=(await audit()).find(row=>row.action==='download'&&row.result==='success'&&row.vessel_id==='qa-v1');
  assert.ok(receipt?.receipt_id);assert.equal(Number(receipt.case_count),1);assert.equal(receipt.ip_address,ip);
  assert.ok(printable.watermark.includes(receipt.receipt_id));assert.ok(printable.footer.includes(receipt.receipt_id));
  const css=await evaluate("(()=>{const n=document.querySelector('.ship-internal-watermark'),f=document.querySelector('.ship-internal-export-footer');return {wm:getComputedStyle(n).position,footer:getComputedStyle(f).position}})()");
  await call('Emulation.setEmulatedMedia',{media:'print'});
  const printCss=await evaluate("(()=>{const n=document.querySelector('.ship-internal-watermark'),f=document.querySelector('.ship-internal-export-footer');return {wm:getComputedStyle(n).position,footer:getComputedStyle(f).position,visible:getComputedStyle(n).display,printList:getComputedStyle(document.querySelector('.ship-internal-export-print')).display}})()");
  assert.equal(printCss.wm,'fixed');assert.equal(printCss.footer,'fixed');assert.notEqual(printCss.visible,'none');assert.notEqual(printCss.printList,'none');
  assert.ok(css.wm!=='fixed','watermark must be print-only');
  const widths=await evaluate("[...document.querySelectorAll('.ship-internal-export-print thead th')].map(n=>n.getBoundingClientRect().width)");
  assert.equal(widths.length,7);
  for(const [index,weight] of [2/3,1/3,1,1/2,1/2,1,1/3].entries())
   assert.ok(Math.abs(widths[index]/widths[2]-weight)<0.08,`ship PDF column ${index} width ratio differs from requested ${weight}`);
  // Retain an isolated copy for pagination QA; the real print action must still clean up on afterprint.
  await evaluate("window.__qaPrintDom=document.querySelector('.ship-internal-export-print').cloneNode(true)");
  const pdf=Buffer.from((await call('Page.printToPDF',{printBackground:true,preferCSSPageSize:true})).data,'base64');
  assert.ok(pdf.subarray(0,5).equals(Buffer.from('%PDF-'))&&pdf.length>6000,'nontrivial Chromium PDF');
  const pdfPath=path.join(run,'ship-internal-open.pdf');fs.writeFileSync(pdfPath,pdf);
  const text=execFileSync('pdftotext',['-raw',pdfPath,'-'],{encoding:'utf8',timeout:15000});
  for(const token of [own,'QA SHIP 1',ip,receipt.receipt_id])assert.ok(text.includes(token),'PDF missing expected token');
  for(const token of [other,closed,secret,qa.password])assert.ok(!text.includes(token),'PDF leaked excluded marker');
  assert.ok(text.split(receipt.receipt_id).length>=3,'watermark and footer must both reach PDF bytes');
  const pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
  assert.ok(pages>=1,'Chromium PDF page objects');
  evidence.pdf={pages,bytes:pdf.length,sha256:createHash('sha256').update(pdf).digest('hex'),receiptMatched:true};
  await until(()=>evaluate("!document.querySelector('.ship-internal-export-print')&&!document.body.classList.contains('printing-ship-internal-control')"),'native afterprint cleanup');
  assert.equal(await evaluate('document.title'),originalTitle,'native print must restore page title');
  // Only stretch a detached copy of the authenticated print tree: never alter server cases.
  await evaluate("(()=>{document.querySelector('.ship-internal-portal').append(window.__qaPrintDom);document.body.classList.add('printing-ship-internal-control');const body=window.__qaPrintDom.querySelector('tbody'),row=body.querySelector('tr');for(let i=0;i<85;i++){const copy=row.cloneNode(true);copy.querySelectorAll('td')[2].textContent='PRINT_PAGE_QA_'+String(i).padStart(3,'0');body.append(copy)}})()");
  const longPdf=Buffer.from((await call('Page.printToPDF',{printBackground:true,preferCSSPageSize:true})).data,'base64');
  const longPath=path.join(run,'ship-internal-multipage.pdf');fs.writeFileSync(longPath,longPdf);
  const longPages=(longPdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
  assert.ok(longPages>=2,'need an actual multi-page PDF to prove repeated watermark');
  for(let n=1;n<=longPages;n++){
   const pageText=execFileSync('pdftotext',['-f',String(n),'-l',String(n),'-raw',longPath,'-'],{encoding:'utf8',timeout:15000});
   assert.ok(pageText.split(ip).length-1>=12,`IP watermark did not repeat across PDF page ${n}`);
   assert.ok(pageText.includes(receipt.receipt_id),`receipt footer/watermark missing on PDF page ${n}`);
  }
  evidence.multipagePdf={pages:longPages,bytes:longPdf.length,sha256:createHash('sha256').update(longPdf).digest('hex'),ipRepeatedOnEveryPage:true};
  await evaluate("window.__qaPrintDom.remove();window.__qaPrintDom=null;document.body.classList.remove('printing-ship-internal-control')");
  await call('Emulation.setEmulatedMedia',{media:'screen'});
  assert.equal(await evaluate('document.title'),originalTitle,'pagination QA must not change the page title');
 });
 session=admin;
 await check('UI05-admin-cloud-records-and-one-time-password-hiding',async()=>{
  await click('刷新紀錄','.management-editor-actions button');
  await until(()=>evaluate(`document.querySelector('.management-detail')?.innerText.includes(${JSON.stringify(receipt.receipt_id)})`),'admin cloud receipt');
  const rows=await evaluate("[...document.querySelectorAll('.management-detail tbody tr')].map(n=>n.innerText)");
  assert.ok(rows.some(row=>row.includes(receipt.receipt_id)&&row.includes(ip)&&row.includes('1')));
  assert.ok(rows.some(row=>row.includes('遭拒')));
  assert.ok(rows.some(row=>row.includes(ip)));
  await click('QA SHIP 2','.management-list button');
  assert.equal(await evaluate("!!document.querySelector('textarea[aria-label=此船一次性顯示的新下載密碼]')"),false);
  await click('QA SHIP 1','.management-list button');
  assert.equal(await evaluate("!!document.querySelector('textarea[aria-label=此船一次性顯示的新下載密碼]')"),false);
  assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(secret)})`),false);
 });
 session=ship;
 await check('UI06-fresh-document-neither-secret-nor-downloaded-cases',async()=>{
  const before=downloadAttempts();
  await call('Page.reload');
  await until(()=>evaluate("document.querySelector('#ship-internal-vessel')?.value==='qa-v1'"),'ship reload selection');
  assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(own)})`),false);
  assert.equal(await evaluate("!!document.querySelector('.ship-internal-export-print')"),false);
  await click('下載未結內控清單');
  assert.ok(!(await evaluate("document.querySelector('#ship-internal-download-password')?.value")),'entered download password must not remain');
  assert.equal(await evaluate(`Object.values(localStorage).some(v=>v.includes(${JSON.stringify(secret)})||v.includes(${JSON.stringify(own)}))`),false);
  assert.equal(await evaluate(`Object.values(sessionStorage).some(v=>v.includes(${JSON.stringify(secret)})||v.includes(${JSON.stringify(own)}))`),false);
  assert.equal(downloadAttempts(),before,'reload cannot silently re-download cases');
  session=admin;await call('Page.reload');
  await until(()=>evaluate("!!document.querySelector('nav')||!!document.querySelector('.login-page')"),'main reload');
  assert.equal(await evaluate(`Object.values(localStorage).some(v=>v.includes(${JSON.stringify(secret)}))`),false);
  assert.equal(await evaluate(`Object.values(sessionStorage).some(v=>v.includes(${JSON.stringify(secret)}))`),false);
 });
 assert.deepEqual(evidence.external,[]);assert.deepEqual(evidence.errors,[]);
 assert.ok(!JSON.stringify({evidence,metrics:qa.metrics}).includes(secret),'QA evidence must never contain the one-time secret');
 assert.ok(!JSON.stringify({evidence,metrics:qa.metrics}).includes(qa.password),'QA evidence must never contain the owner password');
 evidence.status='PASS';
} catch(error){failure=error;evidence.status='FAIL';evidence.error={code:error.code||null,message:error.message,stack:error.stack};
 // Never persist body text/screenshots here: an admin one-time password may still be displayed.
 try{evidence.failurePage={url:await evaluate('location.pathname'),hasPrint:await evaluate("!!document.querySelector('.ship-internal-export-print')")};}catch{}
} finally {
 secret=undefined;
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null,'Chrome exit',5000);}catch{browser.kill();}}
 if(qa){evidence.metrics=qa.metrics;try{await qa.close();}catch(e){evidence.cleanupError=e.message;failure??=e;}}
 if(native)try{await native.close();}catch(e){evidence.cleanupError=e.message;failure??=e;}
 evidence.cleanup={chromeStopped:!browser||browser.exitCode!==null,postgresStopped:evidence.stopped,portClosed:evidence.portClosed};
 fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({status:evidence.status,cases:evidence.cases,run,error:failure?.message,cleanup:evidence.cleanup}));
 if(failure)process.exitCode=1;
}

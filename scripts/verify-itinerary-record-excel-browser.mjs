import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {seedItineraryExcelFixture,excelBusinessSnapshot,assertOnlyFormalWrites} from './record-itinerary-excel-local-fixture.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'record-itinerary-excel-'));
const profile=path.join(output,'chrome-profile'),downloads=path.join(output,'downloads');fs.mkdirSync(downloads);
const tracerOnly=process.argv.includes('--tracer-only');
let qa,browser,ws,sessionId,failure=null,id=0,hold=null,held=null;
let vesselNames=[];
const pending=new Map(),evidence={label:'真實 UI＋測試資料｜本機 SQL，非正式環境',layer:'original-App/native-UI/SupabaseJS/private-PGlite',tracerOnly,scenarios:[],errors:[],blockedExternal:[],downloads:[],requests:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(test,label,timeout=25_000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(100);}throw new Error('QA timeout: '+label);};
const call=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method));},15_000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const key=async(key,code=key)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,...(key==='Enter'?{windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code});};
const click=async text=>{await evaluate(`(()=>{const n=[...document.querySelectorAll('button')].filter(n=>n.innerText.trim()===${JSON.stringify(text)}&&n.getClientRects().length&&!n.disabled);if(n.length!==1)throw new Error('button cardinality '+${JSON.stringify(text)}+': '+n.length);n[0].focus();if(document.activeElement!==n[0])throw new Error('focus precondition');})()`);await key('Enter');};
const toggle=async expression=>{await evaluate(`(()=>{const n=${expression};if(!n||!n.getClientRects().length||n.disabled)throw new Error('checkbox unavailable');n.focus();})()`);await key(' ','Space');};
const fill=async(selector,text)=>{await evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(n=>n.getClientRects().length);if(n.length!==1)throw new Error('input cardinality');n[0].focus();n[0].select();})()`);await call('Input.insertText',{text});};
const text=()=>evaluate("document.body?.innerText||''");
const screen=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
const persist=(name,value)=>fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(value,null,2));
const check=async(id,run)=>{await run();assert.ok(!evidence.scenarios.includes(id));evidence.scenarios.push(id);persist('evidence',evidence);console.log('PASS',id);};
const snapshot=async name=>{const s=await excelBusinessSnapshot(qa);persist(name,s);return s;};
const documents=async()=>Object.fromEntries((await qa.db.query('select vessel_id,sd_itinerary_document_for_vessel(workspace_id,$1,vessel_id) doc from sd_itinerary_documents order by vessel_id',['isolated-record-ui-qa'])).rows.map(r=>[r.vessel_id,r.doc]));
const saveMetrics=start=>qa.metrics.slice(start).filter(m=>m.rpc==='sd_itinerary_record_save_v1'&&m.status==='SQL_OK');
const modalText=()=>evaluate("document.querySelector('.itinerary-import-modal')?.innerText||''");
const resultRows=()=>evaluate("[...document.querySelectorAll('.itinerary-import-results tbody tr')].map(n=>[...n.cells].map(c=>c.innerText))");
const assertOneSave=async(start,vesselId,previous)=>{
 const writes=saveMetrics(start);assert.equal(writes.length,1);assert.equal(writes[0].vesselId,vesselId);
 const doc=(await documents())[vesselId];assert.equal(doc.revision,previous.revision+1);assert.deepEqual(doc.alternativePlans,previous.alternativePlans);
 for(const table of ['sd_itinerary_history','sd_itinerary_operations'])assert.equal((await qa.db.query(`select count(*)::int n from ${table} where operation_id=$1::uuid`,[writes[0].operationId])).rows[0].n,1,table+' once');
 const sent=evidence.requests.find(r=>r.rpc==='sd_itinerary_record_save_v1'&&r.body.p_operation_id===writes[0].operationId);assert.ok(sent);assert.equal(sent.body.p_expected_revision,previous.revision);assert.equal(sent.body.p_actor_user_id,'qa-owner');assert.deepEqual(doc.rows,sent.body.p_rows,'exact imported main row payload is authoritative');
 return doc;
};
const exportFile=async name=>{
 const before=evidence.downloads.length;await click('匯出 Excel（2）');
 await until(()=>evidence.downloads.length===before+1&&evidence.downloads.at(-1).state==='completed','real Chrome xlsx download');
 const download=evidence.downloads.at(-1),file=path.join(downloads,download.guid);await until(()=>fs.existsSync(file),'download on disk');
 const buffer=fs.readFileSync(file);assert.ok(buffer.length>10000);const destination=path.join(output,name+'.xlsx');fs.copyFileSync(file,destination);
 const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
 download.sha256=createHash('sha256').update(buffer).digest('hex');download.bytes=buffer.length;download.artifact=destination;
 assert.match(download.suggestedFilename,/^Itinerary_.*_2ships\.xlsx$/);assert.deepEqual(book.worksheets.map(s=>s.name),[...vesselNames,'_Itinerary_Meta']);assert.equal(book.getWorksheet('_Itinerary_Meta').state,'veryHidden');
 const zip=await JSZip.loadAsync(buffer);for(const n of [1,2]){const xml=await zip.file(`xl/worksheets/sheet${n}.xml`).async('string');const props=xml.match(/<sheetPr>.*?<\/sheetPr>/)?.[0]||'';assert.ok(!props.includes('<outlinePr')||!props.includes('<pageSetUpPr')||props.indexOf('<outlinePr')<props.indexOf('<pageSetUpPr'));}
 return {book,buffer,file:destination};
};
const importFile=async file=>{
 await click('匯入 Excel');const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'.itinerary-file-input'});assert.ok(nodeId);await call('DOM.setFileInputFiles',{nodeId,files:[file]});
 await until(async()=>(await modalText()).includes('Excel 匯入預覽'),'original input parsed preview');
 assert.equal(await evaluate("document.querySelectorAll('.itinerary-import-status.ready').length"),2,'both valid sheets');assert.equal(await evaluate("document.querySelector('.itinerary-file-input').value"),'','original input reset for repeat import');
};
const uncheckSecond=async()=>{await toggle("document.querySelectorAll('.itinerary-import-sheet-group input[type=checkbox]')[1]");await until(async()=>(await modalText()).includes('準備覆蓋 1 艘'),'preview selected-only');assert.deepEqual(await evaluate("[...document.querySelectorAll('.itinerary-import-sheet-group')].map(n=>({vesselId:n.querySelector('select').value,checked:n.querySelector('input').checked}))"),[{vesselId:'qa-v1',checked:true},{vesselId:'qa-v2',checked:false}]);};
const release=async()=>{const item=held;held=null;hold=null;if(item)await call('Fetch.continueRequest',{requestId:item.requestId});};
const assertPending=async()=>{assert.match(await modalText(),/覆蓋中…/);assert.equal(await evaluate("document.querySelector('.itinerary-import-results')===null"),true);assert.equal(await evaluate("document.querySelector('.itinerary-import-head button').disabled"),true);assert.deepEqual(await evaluate("[...document.querySelectorAll('.itinerary-import-sheet-group input')].map(n=>n.disabled)"),[true,true]);};
try{
 qa=await createRecordStorageLocalQa();await seedItineraryExcelFixture(qa);assert.equal((await fetch(qa.origin+'/__qa/health')).status,200);
 const baseline=await snapshot('baseline'),beforeDocuments=await documents(),appBefore=await qa.read();
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(chrome));browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let port,socketPath;await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'Chrome readable handshake');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(!p)return;pending.delete(message.id);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result);return;}
  const p=message.params;
  if(message.method==='Runtime.exceptionThrown')evidence.errors.push(p.exceptionDetails.exception?.description||p.exceptionDetails.text);
  if(message.method==='Page.javascriptDialogOpening'){(evidence.dialogs??=[]).push({type:p.type,message:p.message});const expected=p.type==='beforeunload'||(p.type==='confirm'&&(/^同步最新會保留本機修改/.test(p.message)||/^將以 Excel 內容覆蓋 [12] 艘船的 Itinerary，並為每艘建立新 Revision。確定繼續嗎？$/.test(p.message)));if(!expected)evidence.errors.push('Unexpected dialog '+p.message);void call('Page.handleJavaScriptDialog',{accept:expected},message.sessionId).catch(e=>evidence.errors.push(e.message));}
  if(message.method==='Network.requestWillBeSent'){
   const url=p.request.url;if(/^https?:/.test(url)&&!url.startsWith(qa.origin+'/'))evidence.blockedExternal.push(new URL(url).origin);
   if(url.startsWith(qa.origin+'/rest/v1/rpc/sd_itinerary_record_')&&p.request.postData)evidence.requests.push({rpc:url.split('/').at(-1),body:JSON.parse(p.request.postData)});
  }
  if(message.method==='Browser.downloadWillBegin')evidence.downloads.push({...p,state:'started'});
  if(message.method==='Browser.downloadProgress'){const d=evidence.downloads.find(d=>d.guid===p.guid);if(d)Object.assign(d,p);}
  if(message.method==='Fetch.requestPaused'){
   const rpc=p.request.url.split('/').at(-1),matches=(hold==='save'&&rpc==='sd_itinerary_record_save_v1'&&p.responseStatusCode===200)||(hold==='status'&&rpc==='sd_itinerary_record_operation_status_v1'&&!p.responseStatusCode);
   if(matches&&!held){held=p;persist('held-'+hold,{rpc,body:JSON.parse(p.request.postData),responseStatusCode:p.responseStatusCode});}else void call('Fetch.continueRequest',{requestId:p.requestId}).catch(e=>evidence.errors.push(e.message));
  }
 });
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['https://*','http://*.supabase.co/*','http://*.supabase.in/*']});await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:downloads,eventsEnabled:true},null);
 // Scope-only fixture label; do not alter the shared QA transform or product UI.
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('DOMContentLoaded',()=>{const n=document.querySelector('#isolated-qa-label');if(n)n.textContent=${JSON.stringify(evidence.label)};});`});
 await call('Fetch.enable',{patterns:[{urlPattern:'*/rest/v1/rpc/sd_itinerary_record_save_v1',requestStage:'Response'},{urlPattern:'*/rest/v1/rpc/sd_itinerary_record_operation_status_v1',requestStage:'Request'}]});
 await call('Page.navigate',{url:qa.origin});await until(async()=>(await text()).includes('請輸入管理者設定的進站密碼。'),'original site gate');await fill('input[type=password]',qa.password);await click('進入系統');await until(async()=>(await text()).includes('人員登入／切換'),'original login');await fill('input[type=password]',qa.password);await click('登入');await until(async()=>(await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'Owner ready');
 await click('同步最新（安全合併）');await until(async()=>!(await text()).includes('身份、權限或船舶範圍已變更，請同步最新資料'),'authority fresh');await click('切換顯示Itinerary信息');await until(()=>evaluate("document.querySelectorAll('.itinerary-panel').length===3"),'original three panels');
 if(await evaluate("document.querySelectorAll('.itinerary-panel.selected').length"))await click('清除選取');
 for(const id of ['qa-v1','qa-v2'])await toggle(`document.querySelector('[data-itinerary-vessel-id="${id}"] input[type=checkbox]')`);
 await until(async()=>(await text()).includes('已選 2／目前可見 3'),'two explicitly selected');
 vesselNames=await evaluate("[...document.querySelectorAll('.itinerary-panel.selected h2')].map(n=>n.innerText)");assert.equal(vesselNames.length,2);evidence.vesselNames=vesselNames;
 const selectedExport=await exportFile('original-selected-export');
 await check('excel-export-selected-formal',async()=>{
  const {book}=selectedExport;const sheet=book.worksheets[0],meta=book.getWorksheet('_Itinerary_Meta');
  assert.equal(sheet.getCell('A2').value,'Vsl name: '+vesselNames[0]);assert.equal(sheet.getCell('B3').value,'Next Port & Dock Name');assert.equal(sheet.getCell('C3').value,'Purpose');assert.equal(sheet.getCell('D3').value,'B/F or I/F Qty (MT/BBLS)');assert.equal(sheet.getCell('O3').value,'UTC Offset');assert.equal(sheet.getCell('AA3').value,'ETA UTC Offset');
  assert.equal(sheet.getCell('B4').value,'QA FORMAL KAOHSIUNG');assert.equal(sheet.getCell('C4').value,'To Load / To Unload');assert.equal(sheet.getCell('D4').value,'QA FORMAL CARGO 123 MT');assert.equal(sheet.getCell('O4').value,'UTC+8');assert.equal(sheet.getCell('AA4').value,'UTC+5:45');assert.equal(sheet.getCell('E4').value.toISOString(),'2026-09-07T05:45:00.000Z');assert.equal(meta.getCell('J2').value,'QA FORMAL BUSAN');assert.equal(meta.getCell('E2').value,7);assert.equal(meta.getCell('B2').value,'qa-v1');assert.equal(meta.getCell('B3').value,'qa-v2');
  assert.ok(!JSON.stringify(book.model).includes('QA ALTERNATIVE MUST NOT PROJECT'));assert.ok(!JSON.stringify(book.model).includes('qa-v3'));assert.deepEqual(await snapshot('after-export'),baseline);await screen('selected-export');
 });
 // Edit the actual downloaded workbook, not an invented/replacement importer.
 const modified=selectedExport.book;for(let i=0;i<2;i++){const sheet=modified.worksheets[i];sheet.getCell('B4').value=`QA IMPORT PORT ${i+1}`;sheet.getCell('N4').value=`QA IMPORT NOTES ${i+1}`;}
 modified.getWorksheet('_Itinerary_Meta').getCell('J2').value=''; // Original blank previousPort backfill contract.
 const inputFile=path.join(output,'valid-edited-import.xlsx');await modified.xlsx.writeFile(inputFile);
 await importFile(inputFile);await uncheckSecond();await check('excel-preview-cancel-zero-save',async()=>{await screen('preview-selected-cancel');await click('取消');await until(()=>evaluate("!document.querySelector('.itinerary-import-modal')"),'preview dismissed');assert.deepEqual(await snapshot('after-cancel'),baseline);assert.equal(saveMetrics(0).length,0);assert.equal(qa.metrics.filter(m=>m.rpc==='sd_itinerary_record_claim_lease_v1').length,0);});
 if(!tracerOnly){
  await importFile(inputFile);await uncheckSecond();const start=qa.metrics.length;hold='save';await click('確認覆蓋 1 艘');await until(()=>held!==null,'held actual SQL ACK');
  await check('excel-selected-apply-per-vessel-ack',async()=>{
   await assertPending();await wait(350);await assertPending();const saved=await assertOneSave(start,'qa-v1',beforeDocuments['qa-v1']);assert.equal(saved.rows[0].portDockName,'QA IMPORT PORT 1');assert.equal(saved.rows[0].notesText,'QA IMPORT NOTES 1');assert.equal(saved.rows[0].previousPortName,'QA FORMAL BUSAN');assert.equal(saved.rows[0].etaUtc,'2026-09-07T00:00:00Z');assert.equal(saved.rows[0].etaTimeZone,'UTC+5:45');assert.equal(saved.rows[0].operation,'To Load / To Unload');assertOnlyFormalWrites(baseline,await snapshot('held-save'),['qa-v1']);await screen('held-save-no-success');
   await release();await until(async()=>(await resultRows()).length===1,'confirmed one-vessel results');assert.deepEqual(await resultRows(),[[vesselNames[0],vesselNames[0],'已覆蓋，Revision 8']]);await until(()=>qa.metrics.slice(start).some(m=>m.rpc==='sd_itinerary_record_release_lease_v1'),'explicit release');await screen('one-selected-success');await click('完成');
  });
  // One real competing holder fails qa-v1; qa-v2 still commits in its own transaction.
  const claim=(await qa.db.query("select sd_itinerary_record_claim_lease_v1($1,'qa-v1','competing-import-tab','ignored',75,'qa-owner') lease",['isolated-record-ui-qa'])).rows[0].lease;assert.equal(claim.ok,true);persist('competing-lease',claim);
  const partialBefore=await snapshot('before-partial'),docsBefore=await documents();await importFile(inputFile);const partialStart=qa.metrics.length;qa.loseNextItineraryAck();hold='status';await click('確認覆蓋 2 艘');await until(()=>held!==null,'lost ACK same-operation status held');
  await check('excel-held-lost-ack-status',async()=>{
   await assertPending();const saved=await assertOneSave(partialStart,'qa-v2',docsBefore['qa-v2']);assert.equal(saved.rows[0].portDockName,'QA IMPORT PORT 2');assert.equal(saved.rows[0].notesText,'QA IMPORT NOTES 2');assert.equal(saved.rows[0].previousPortName,'QA PREVIOUS qa-v2');const writes=saveMetrics(partialStart);assert.equal(JSON.parse(held.request.postData).p_operation_id,writes[0].operationId);assert.equal(qa.metrics.slice(partialStart).filter(m=>m.rpc==='sd_itinerary_record_operation_status_v1').length,0,'status not yet delivered or confirmed');assert.ok(qa.metrics.slice(partialStart).some(m=>m.status==='ACK_DROPPED_AFTER_SQL'));assertOnlyFormalWrites(partialBefore,await snapshot('held-status'),['qa-v2']);await screen('lost-ack-status-pending');
   await release();await until(async()=>(await resultRows()).length===2,'per-vessel final results');const status=qa.metrics.slice(partialStart).filter(m=>m.rpc==='sd_itinerary_record_operation_status_v1');assert.equal(status.length,1);assert.equal(status[0].status,'SQL_OK');assert.equal(status[0].operationId,writes[0].operationId);await assertOneSave(partialStart,'qa-v2',docsBefore['qa-v2']);
  });
  await check('excel-lease-contention-partial-results',async()=>{
   const rows=await resultRows();assert.equal(rows[0][0],vesselNames[0]);assert.equal(rows[0][1],vesselNames[0]);assert.match(rows[0][2],/^正由 .+ 編輯，未覆蓋。$/);assert.deepEqual(rows[1],[vesselNames[1],vesselNames[1],'已覆蓋，Revision 8']);const metrics=qa.metrics.slice(partialStart);assert.equal(metrics.filter(m=>m.rpc==='sd_itinerary_record_claim_lease_v1').length,2);assert.ok(metrics.some(m=>m.rpc==='sd_itinerary_record_claim_lease_v1'&&m.vesselId==='qa-v1'&&m.status==='locked'));assertOnlyFormalWrites(partialBefore,await snapshot('partial-results'),['qa-v2']);assert.deepEqual((await documents())['qa-v1'],docsBefore['qa-v1']);await screen('partial-one-locked-one-saved');await click('完成');
  });
  // Release only our synthetic competing owner, after proving the import did not touch it.
  await qa.db.query("select sd_itinerary_record_release_lease_v1($1,'qa-v1',$2::uuid,'competing-import-tab',$3::bigint,'qa-owner')",['isolated-record-ui-qa',claim.leaseId,claim.fencingToken]);
  await check('excel-new-document-reexport',async()=>{
   const saved=await snapshot('saved'),count=saveMetrics(0).length,readStart=qa.metrics.length;await evaluate('window.__qaOldDocument=true');await call('Page.reload');await until(async()=>await evaluate('!window.__qaOldDocument&&document.readyState==="complete"')&&(await text()).includes('QA OWNER'),'new browser document');
   if(!await evaluate("Boolean(document.querySelector('.itinerary-dashboard'))"))await click('切換顯示Itinerary信息');await until(async()=>await evaluate("document.querySelectorAll('.itinerary-panel').length===3")&&qa.metrics.slice(readStart).some(m=>m.rpc==='sd_itinerary_record_load_many_v1'&&m.status==='SQL_OK'),'new document authoritative read');
   for(const id of ['qa-v1','qa-v2'])assert.ok(await evaluate(`document.querySelector('[data-itinerary-vessel-id="${id}"]').innerText.includes('QA IMPORT PORT ${id==='qa-v1'?1:2}')`));
   if(await evaluate("document.querySelectorAll('.itinerary-panel.selected').length"))await click('清除選取');for(const id of ['qa-v1','qa-v2'])await toggle(`document.querySelector('[data-itinerary-vessel-id="${id}"] input[type=checkbox]')`);
   const {book}=await exportFile('reloaded-reexport');const current=await documents();for(let i=0;i<2;i++){const sheet=book.worksheets[i],doc=current[`qa-v${i+1}`],meta=book.getWorksheet('_Itinerary_Meta');assert.equal(sheet.getCell('B4').value,doc.rows[0].portDockName);assert.equal(sheet.getCell('N4').value,doc.rows[0].notesText);assert.equal(sheet.getCell('C4').value,doc.rows[0].operation);assert.equal(sheet.getCell('AA4').value,doc.rows[0].etaTimeZone);assert.equal(sheet.getCell('E4').value.toISOString(),'2026-09-07T05:45:00.000Z');assert.equal(meta.getCell(i+2,5).value,doc.revision);assert.equal(meta.getCell(i+2,10).value,doc.rows[0].previousPortName);}
   assert.deepEqual(await snapshot('reloaded'),saved);assert.equal(saveMetrics(0).length,count);assert.equal(count,2);await screen('reloaded-reexport');
  });
 }
 assert.deepEqual(await qa.read(),appBefore,'no AppData dual write');const final=await snapshot('final');assertOnlyFormalWrites(baseline,final,tracerOnly?[]:['qa-v1','qa-v2']);
 for(const table of ['sd_itinerary_history','sd_itinerary_operations']){assert.equal(final[table].length,baseline[table].length+(tracerOnly?0:2),'exact total added '+table);for(const old of baseline[table])assert.ok(final[table].some(row=>JSON.stringify(row)===JSON.stringify(old)),'prior append-only row unchanged '+table);}
 assert.equal((await qa.db.query('select count(*)::int n from sd_itinerary_leases where expires_at>now()')).rows[0].n,0,'all owned/synthetic competing leases released');
 assert.equal(await evaluate("document.querySelector('#isolated-qa-label')?.innerText"),evidence.label,'exact private-environment label');
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);assert.ok(!qa.metrics.some(m=>['UNSUPPORTED','SQL_ERROR'].includes(m.status)));assert.ok(qa.metrics.every(m=>!m.rpc.startsWith('sd_itinerary_main_')));assert.equal(evidence.scenarios.length,tracerOnly?2:6);
 console.log(JSON.stringify({qa:'RECORD_ITINERARY_EXCEL_PASS',output,scenarios:evidence.scenarios}));
}catch(error){failure=error;evidence.error=error.stack;try{evidence.failureText=await text();await snapshot('failure-readback');await screen('failure');}catch{}console.error(JSON.stringify({qa:'FAILED',error:error.message,output,body:evidence.failureText?.slice(0,10000)}));}
finally{
 try{await release();}catch{}evidence.metrics=qa?.metrics||[];persist('evidence',evidence);
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome closed',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome tree stopped',5000);}}
 try{if(qa)await qa.close();}catch(e){failure??=e;}
 if(!failure){try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
 try{if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);evidence.cleanup={httpStopped:true,chromeStopped:true,ownedChromePid:browser?.pid,origin:qa?.origin};}catch(e){failure??=e;evidence.cleanup={error:e.message};}
 persist('evidence',evidence);if(failure)process.exitCode=1;
}

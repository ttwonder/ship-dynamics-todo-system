import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'ship-tracking-browser-'));
const profile=path.join(output,'chrome-profile');
const b1=process.env.QA_RELATED_DRAFT_B1==='1';
let native,qa,browser,ws,failure=null,sessionId,releaseHeldReceipt,expectDeleteRejection=false,allowRefresh=false;
const pending=new Map(),evidence={label:'真實 UI＋測試資料；原生 PostgreSQL，非 hosted Supabase',scenarios:[],errors:[],blockedExternal:[],metrics:[],dialogs:[]};
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
const field=(label,tag,scope='.modal')=>`[...document.querySelectorAll(${JSON.stringify(scope+' .field')})].find(n=>n.querySelector('label')?.innerText.trim()===${JSON.stringify(label)})?.querySelector(${JSON.stringify(tag)})`;
const key=async(key,code=key)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code});};
const select=async(expression,value)=>{
 const index=await evaluate(`(()=>{const n=${expression};if(!n||n.disabled)throw new Error('select unavailable');n.focus();return [...n.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`);assert.ok(index>=0,'option '+value);
 await key('Home');for(let i=0;i<index;i++)await key('ArrowDown');await key('Enter');
 await until(async()=>await evaluate(`(${expression}).value`)===value,'selected '+value);
};
const labelInput=(label,scope='.modal')=>`[...document.querySelectorAll(${JSON.stringify(scope+' label')})].find(n=>n.innerText.trim()===${JSON.stringify(label)})?.querySelector('input')`;
const fillNode=async(expression,value)=>{
 await evaluate(`(()=>{const n=${expression};if(!n||n.disabled)throw new Error('field unavailable');n.focus();n.select();})()`);await call('Input.insertText',{text:value});
};
const snapshot=async(name)=>{const data=await qa.read();fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(data,null,2));return data;};
const screen=async(name)=>{const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(image.data,'base64'));};

const check=async(name,run)=>{await run();evidence.scenarios.push(name);console.log('PASS',name);};
const finish=async()=>until(async()=>!await evaluate("Boolean(document.querySelector('.modal-backdrop'))")&&(await text()).includes('已收到伺服器確認並讀回'),'confirmed save closed');
try{
 native=await createNativeRecordQa(output,evidence,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,shipTracking:true,tracking:true,taskMember:true,databaseFactory:async()=>native.adapter});
 await (await import('./tracking-browser-fixture.mjs')).installTrackingBrowserMigrations(qa.db);
 for(const name of ['20260925020000_edit_lock_holder.sql','20260925080000_ship_tracking_public.sql'])await qa.db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 await qa.db.query("update ship_dynamics_records set value=jsonb_set(value,'{name}','\"測試輪\"'::jsonb) where workspace_key=$1 and collection='vessels' and entity_id='qa-v1'",[qa.workspace]);
 assert.ok(fs.existsSync('packageorwork-tracking.html'),'Dedicated public entry packageorwork-tracking.html must exist');
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(chrome));
 browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let port,socketPath;
 await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch(error){if(['ENOENT','EBUSY','EPERM'].includes(error.code))return false;throw error;}},'Chrome readable handshake');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);return;}
  if(message.method==='Network.responseReceived'&&message.params.response.status>=400)(evidence.httpErrors??=[]).push({status:message.params.response.status,path:new URL(message.params.response.url).pathname});
  if(message.method==='Network.loadingFailed')(evidence.loadErrors??=[]).push({type:message.params.type,error:message.params.errorText});
  if(message.method==='Runtime.exceptionThrown')evidence.errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  if(message.method==='Page.javascriptDialogOpening'){
   (evidence.dialogs??=[]).push({type:message.params.type,message:message.params.message});
   const abnormal=message.params.type==='confirm'&&message.params.message.startsWith('是否將這筆關聯要事');
   const rejected=expectDeleteRejection&&message.params.type==='alert'&&message.params.message.startsWith('刪除要事未完成：');
   if(rejected)evidence.expectedDeleteRejection=message.params.message;
   // Disposal of the isolated failure page only; NOT a product save/close claim.
   const disposeFailurePage=message.params.type==='beforeunload'&&evidence.rejectedDelete?.draftRetained===true;
   const expected=(allowRefresh&&message.params.type==='beforeunload')||(message.params.type==='prompt'&&message.params.message==='請選擇完成日期（YYYY-MM-DD）')||(message.params.type==='confirm'&&/^確認保存本次結案／重開變更/.test(message.params.message))||(message.params.type==='confirm'&&/^確定將此內控案件改為未結案/.test(message.params.message))||(message.params.type==='alert'&&/^(tracking-stale-source|跟蹤保存結果尚未確認|此項目正在由 QA other editor)/.test(message.params.message))||(message.params.type==='confirm'&&/^重新核對/.test(message.params.message))||(message.params.type==='confirm'&&/^只同步以下/.test(message.params.message))||disposeFailurePage||rejected||abnormal||(message.params.type==='confirm'&&/^(確定撤回同步要事|確定刪除此內控案件|確定刪除待辦|同步最新會保留本機修改)/.test(message.params.message))||(message.params.type==='alert'&&/^(同步要事已撤回；|請務必在FLOW系統中申報异常|請務必在FLOW系統中申報異常)/.test(message.params.message));
   if(!expected)evidence.errors.push('Unexpected QA dialog: '+message.params.message);
   void call('Page.handleJavaScriptDialog',{accept:expected&&!abnormal,...(message.params.type==='prompt'?{promptText:'2026-09-26'}:{})},message.sessionId).catch(error=>evidence.errors.push(error.message));
  }
  if(message.method==='Network.requestWillBeSent'){const url=message.params.request.url;if(/^https?:/.test(url)&&!url.startsWith(qa.origin+'/'))evidence.blockedExternal.push(new URL(url).origin);}
 });
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);
 ({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
 await call('Network.setBlockedURLs',{urls:['https://*','http://*.supabase.co/*','http://*.supabase.in/*']});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});


 await call('Page.navigate',{url:qa.origin+'/packageorwork-tracking.html'});
 await until(async()=>await evaluate("Boolean(document.querySelector('.tracking-page'))")&&!(await text()).includes('讀取此船最新資料'),'anonymous selected-vessel tracking page');
 await check('anonymous-dedicated-entry-no-office-controls',async()=>{
  assert.ok(!(await text()).includes('要事'));assert.equal(await evaluate("document.querySelectorAll('input[type=password]').length"),0);
  assert.ok((await text()).includes('測試輪 QA VESSEL 1'));assert.ok(!(await text()).includes('QA OWNER'));
  await screen('ship-tracking-desktop');
 });
 await check('original-shared-form-creates-cloud-record-with-exact-ACK',async()=>{
  await click('＋ 新增／批量新增');await until(async()=>await evaluate("Boolean(document.querySelector('.tracking-modal'))"),'create dialog');
  await fill('[aria-label="第 1 筆 項目編號"]','BROWSER-001');await fill('[aria-label="第 1 筆 內容摘要／工程內容"]','真實船端輸入測試');await fill('[aria-label="第 1 筆 最新進度"]','第一筆進度');
  await click('確認保存 1 項');await finish();
  const record=(await qa.read()).payload.trackingItems.find(x=>x.referenceNo==='BROWSER-001');assert.equal(record.description,'真實船端輸入測試');assert.equal(record.statusLogs[0].text,'第一筆進度');
 });
 await check('ship-sync-form-reporter-and-no-office-control',async()=>{
  await click('同步到內控');await until(async()=>await evaluate("Boolean(document.querySelector('#ship-internal-reporter'))"),'ship reporter form');
  assert.ok(!(await text()).includes('要事'));await fill('#ship-internal-reporter','陳測試／輪機長');
  await select(field('事件分類 *','select'),'維修');
  await click('提交 1 筆');await finish();const snap=await qa.read(),source=snap.payload.trackingItems.find(x=>x.referenceNo==='BROWSER-001'),item=snap.payload.internalControlCases.find(x=>x.id===source.linkedCaseId);
  assert.ok(item.description.endsWith('報告人姓名＋職務：陳測試／輪機長'));assert.equal(item.syncToTask,false);assert.ok(!item.linkedTaskId);
 });
 await check('lost-ACK-refresh-keeps-exact-pending-before-new-action',async()=>{
  await click('進度');await until(async()=>await evaluate("Boolean(document.querySelector('[aria-label=\"BROWSER-001 最新進度\"]'))"),'progress editor');await fill('[aria-label="BROWSER-001 最新進度"]','網路中斷仍保留的進度');
  let committed=false,original;qa.setRecordFault({after:async({name,body,value})=>{if(name!=='ship_dynamics_tracking_public_v1')return false;if(body.p_action==='submit'&&value.ok===true){committed=true;original=structuredClone(body);}return committed&&['submit','receipt'].includes(body.p_action);}});
  await click('確認保存 1 項');await until(async()=>(await text()).includes('尚未保存；輸入及精確提交已保留'),'unknown outcome retained');assert.ok(committed);const revision=(await qa.read()).revision;
  const storedBefore=await evaluate("Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('[\"tracking-unsent-v1\"')))"),key=Object.keys(storedBefore)[0];assert.ok(key);const originalDraft=JSON.parse(storedBefore[key]);assert.ok(originalDraft.pending);
  await evaluate('window.__qaPriorDocument=true');allowRefresh=true;await call('Page.reload',{ignoreCache:true});await until(async()=>await evaluate("!window.__qaPriorDocument&&Boolean(document.querySelector('.tracking-page'))")&&!(await text()).includes('讀取此船最新資料'),'reload unknown page');allowRefresh=false;
  if(!await evaluate("Boolean(document.querySelector('.tracking-modal'))"))await click('＋ 新增／批量新增');
  if(await evaluate("Boolean(document.querySelector('[aria-label=\"第 1 筆 項目編號\"]'))"))await fill('[aria-label="第 1 筆 項目編號"]','MUST-NOT-REPLACE-PENDING');
  const retained=await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);assert.deepEqual(retained.pending,originalDraft.pending,'new action must not replace the old unknown submission');assert.deepEqual(retained.draft.rows,originalDraft.draft.rows);
  qa.setRecordFault(null);if(!await evaluate("Boolean(document.querySelector('.tracking-modal'))"))await click('恢復本船未送出草稿');await click('確認結果／重試相同提交');await finish();
  const after=await qa.read();assert.equal(after.revision,revision);assert.equal(after.payload.trackingItems.find(x=>x.referenceNo==='BROWSER-001').statusLogs.filter(x=>x.text==='網路中斷仍保留的進度').length,1);assert.ok(original.p_payload.operationId);
 });
 await check('rejected-create-reacquires-creation-lease-with-original-input',async()=>{
  await click('＋ 新增／批量新增');await fill('[aria-label="第 1 筆 項目編號"]','BROWSER-REJECTED');await fill('[aria-label="第 1 筆 內容摘要／工程內容"]','拒絕後保留原文');
  qa.setRecordFault({after:async({name,body,value,db})=>{if(name==='ship_dynamics_tracking_public_v1'&&body.p_action==='claim'&&value.ok)await db.query("update ship_dynamics_tracking_private.bundles set expires_at=clock_timestamp()-interval '1 second' where workspace=$1 and bundle_id=$2::uuid",[qa.workspace,body.p_payload.bundleId]);return false;}});
  await click('確認保存 1 項');await until(async()=>(await text()).includes('尚未保存；輸入及精確提交已保留'),'confirmed create rejection retained');assert.equal((await qa.read()).payload.trackingItems.some(x=>x.referenceNo==='BROWSER-REJECTED'),false);
  qa.setRecordFault(null);await click('核對最新資料／解除已拒絕提交');await until(async()=>(await text()).includes('已核對最新版本；原輸入保留'),'creation-only reacquire');assert.equal(await evaluate("document.querySelector('[aria-label=\"第 1 筆 內容摘要／工程內容\"]').value"),'拒絕後保留原文');await click('確認保存 1 項');await finish();assert.equal((await qa.read()).payload.trackingItems.filter(x=>x.referenceNo==='BROWSER-REJECTED').length,1);
 });
 const downloads=path.join(output,'downloads');fs.mkdirSync(downloads);await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads},null);
 const Excel=(await import('exceljs')).default;
 await check('downloaded-template-native-file-input-import-real-SQL',async()=>{
  await click('配件物料模板');const template=path.join(downloads,'tracking-parts-materials.xlsx');await until(()=>fs.existsSync(template),'downloaded template');const book=new Excel.Workbook();await book.xlsx.readFile(template);const sheet=book.getWorksheet('填寫資料');assert.ok(sheet);assert.ok(sheet.getCell('A1').text.includes('測試輪 QA VESSEL 1'));
  const values={referenceNo:'EXCEL-SHIP-001',description:'下載模板後回填測試',applicationDate:new Date('2026-09-25T00:00:00Z'),normal:'是',progress:'由 Excel 匯入',vesselId:'qa-v1'};sheet.getRow(3).eachCell((cell,index)=>{const field=cell.text.replace('tracking:','');if(field in values)sheet.getRow(5).getCell(index).value=values[field];});const filled=path.join(output,'filled-template.xlsx');await book.xlsx.writeFile(filled);
  await click('導入 Excel');const {root}=await call('DOM.getDocument'),{nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'[aria-label="選擇跟蹤 XLSX"]'});await call('DOM.setFileInputFiles',{nodeId,files:[filled]});await until(async()=>(await text()).includes('解析完成；'),'parsed real workbook');await nodeClick("document.querySelector('[aria-label=\"確認本次選船\"]')");await click('明確選取前 100 項可匯入資料');await click('確認保存所選 1 項');await until(async()=>(await text()).includes('本批 1 項已確認並權威讀回'),'import exact ACK');await click('關閉導入');assert.equal((await qa.read()).payload.trackingItems.find(x=>x.referenceNo==='EXCEL-SHIP-001').progress,'由 Excel 匯入');
 });
 await check('shared-confirmed-snapshot-exports-real-XLSX-and-PDF',async()=>{
  await click('Excel');await select("document.querySelector('[aria-label=\"匯出欄位\"]')",'full');await click('建立共用快照');await until(async()=>(await text()).includes('共用快照已固定'),'frozen confirmed snapshot');await click('下載 XLSX');
  let file;await until(()=>{file=fs.readdirSync(downloads).find(n=>n.endsWith('.xlsx')&&n!=='tracking-parts-materials.xlsx');return Boolean(file);},'real exported workbook');const book=new Excel.Workbook();await book.xlsx.readFile(path.join(downloads,file));const data=book.getWorksheet('跟蹤資料');assert.ok(data.getCell('A1').text.includes('測試輪 QA VESSEL 1'));const raw=JSON.stringify(data.getSheetValues());for(const ref of ['BROWSER-001','BROWSER-REJECTED','EXCEL-SHIP-001'])assert.ok(raw.includes(ref));assert.ok(raw.includes('網路中斷仍保留的進度'));assert.ok(book.getWorksheet('列印明細'));
  await click('PDF 預覽');await until(()=>evaluate("Boolean(document.querySelector('.tracking-report-modal'))"),'PDF preview');await evaluate("window.__qaPrint=window.print;window.__qaPrinted=false;window.print=()=>{window.__qaPrinted=true}");await click('導出／列印 PDF');await until(()=>evaluate('window.__qaPrinted'),'actual print handler');assert.equal(await evaluate("document.body.classList.contains('printing-tracking-report')"),true);await screen('ship-tracking-pdf-preview');const rendered=await call('Page.printToPDF',{preferCSSPageSize:true,printBackground:false,displayHeaderFooter:false});const pdf=path.join(output,'ship-tracking.pdf');fs.writeFileSync(pdf,Buffer.from(rendered.data,'base64'));const read=spawnSync('python3',['-c',"import sys,json,unicodedata; from pypdf import PdfReader; d=PdfReader(sys.argv[1]); t=''.join(p.extract_text() for p in d.pages); assert all(x in t for x in ['BROWSER-001','BROWSER-REJECTED','EXCEL-SHIP-001']); assert '網路中斷仍保留的進度' in unicodedata.normalize('NFKC',t); print(json.dumps({'pages':len(d.pages),'contentVerified':True}))",pdf],{encoding:'utf8'});assert.equal(read.status,0,read.stderr);evidence.pdf=JSON.parse(read.stdout);
  await evaluate("window.dispatchEvent(new Event('afterprint'));window.print=window.__qaPrint;delete window.__qaPrint");await click('關閉 PDF 預覽');await click('關閉匯出');
 });
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 await check('mobile-dense-shared-table-no-document-overflow',async()=>{
  await wait(150);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));const header=await evaluate("(()=>{const h=document.querySelector('.ship-portal-header'),c=h.firstElementChild;return {height:h.getBoundingClientRect().height,direction:getComputedStyle(h).flexDirection,childBasis:getComputedStyle(c).flexBasis};})()");evidence.mobileHeader=header;assert.ok(header.height<160,'Compact mobile header: '+JSON.stringify(header));await screen('ship-tracking-mobile');
 });
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.blockedExternal,[]);
 evidence.metrics=qa.metrics;console.log(JSON.stringify({status:'PASS',output,scenarios:evidence.scenarios.length}));
}catch(error){failure=error;evidence.failure=error.stack;console.error(error.stack);if(ws&&sessionId){try{evidence.body=await text();await screen('failure');}catch{}}}
finally{try{if(ws){await call('Browser.close',{},null).catch(()=>{});ws.close();}if(browser){await wait(300);if(browser.exitCode===null)spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});}await qa?.close();await native?.close();}catch(error){failure??=error;evidence.cleanupError=error.stack;}evidence.status=failure?'FAIL':'PASS';fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,output}));if(failure)process.exitCode=1;}

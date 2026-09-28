import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import ExcelJS from 'exceljs';

const root=process.env.QA_EVIDENCE_ROOT||path.join(process.env.LOCALAPPDATA||os.homedir(),'hermes','cache','scratch');
fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'tracking-export-months-')),profile=path.join(output,'chrome-profile');
const evidence={gate:'tracking-export-months-browser',label:'真實 TrackingExports／TrackingPage UI＋記憶體測試資料；非資料庫／正式環境',cases:[],errors:[],external:[],geometry:[],artifacts:[]};
const inputFiles=['src/tracking/TrackingExports.tsx','src/tracking/trackingExportMonths.ts','src/tracking/trackingReport.ts','src/tracking/trackingExcel.ts','src/tracking/TrackingReportPreview.tsx','src/tracking/trackingReport.css','src/tracking/TrackingPage.tsx','src/tracking/trackingFilters.ts','src/tracking/trackingColumns.ts','src/tracking/trackingDeletion.ts','src/tracking/tracking.css','scripts/fixtures/tracking-export-months.tsx','scripts/verify-tracking-export-months-browser.mjs'];
const hashes=()=>Object.fromEntries(inputFiles.filter(f=>fs.existsSync(f)).map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));evidence.inputs=hashes();
let server,browser,ws,sessionId,id=0,failure,origin;
const pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(80);}throw new Error('Timeout: '+label);}
function call(method,params={},session=sessionId){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout: '+method));},20000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
const text=()=>evaluate('document.body.innerText');
const settle=()=>evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
const screen=async name=>{const file=path.join(output,name+'.png');fs.writeFileSync(file,Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));evidence.artifacts.push(file);};
const click=async label=>{await evaluate(`(()=>{const nodes=[...document.querySelectorAll('button')].filter(n=>n.textContent.trim()===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled);if(nodes.length!==1)throw new Error('Button cardinality '+nodes.length+' '+${JSON.stringify(label)});nodes[0].focus();})()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await settle();};
const change=async(selector,value)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)throw new Error('Input unavailable '+${JSON.stringify(selector)});const proto=n instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event(n instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);await settle();};
const nodeClick=async expression=>{const pos=await evaluate(`(()=>{const n=${expression};if(!n||!n.getClientRects().length||n.disabled)throw new Error('Target unavailable '+${JSON.stringify(expression)});n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});await settle();};
const check=async(name,run)=>{await run();assert.ok(!evidence.cases.includes(name));evidence.cases.push(name);console.log('PASS',name);};
const snapshot=async()=>{await click('建立共用快照');await until(async()=>(await text()).includes('共用快照已固定'),'shared snapshot');};
const setMonths=async(start,end=start)=>{await change('[aria-label="匯出開始月份"]',start);await change('[aria-label="匯出結束月份"]',end);};
const hasDownload=()=>evaluate("[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='下載 XLSX')");
const download=async name=>{const dir=path.join(output,'downloads',name);fs.mkdirSync(dir,{recursive:true});await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir},null);await click('下載 XLSX');let file;await until(()=>{file=fs.readdirSync(dir).find(f=>f.endsWith('.xlsx'));return Boolean(file);},'actual XLSX download',45000);const saved=path.join(dir,file),book=new ExcelJS.Workbook();await book.xlsx.readFile(saved);evidence.artifacts.push(saved);return {book,file:saved};};
const workbookRows=book=>{const s=book.getWorksheet('跟蹤資料'),keys=s.getRow(3).values.slice(1).map(v=>String(v).replace('tracking:',''));return Array.from({length:s.rowCount-4},(_,i)=>Object.fromEntries(keys.map((key,j)=>[key,s.getCell(i+5,j+1).value])));};
const assertGrid=book=>{for(const sheet of book.worksheets.filter(s=>s.state==='visible'))for(let r=4;r<=sheet.rowCount;r++)for(let c=1;c<=sheet.columnCount;c++)for(const side of ['top','bottom','left','right'])assert.equal(sheet.getCell(r,c).border[side]?.style,'thin',sheet.name+'!'+sheet.getCell(r,c).address+':'+side);};
const pdf=async(name,expectedIds)=>{
 await click('PDF 預覽');await until(()=>evaluate("Boolean(document.querySelector('.tracking-report-paper'))"),'PDF mounted');
 const ids=await evaluate("[...document.querySelectorAll('.tracking-report-paper tbody tr')].filter(n=>n.children[2]?.textContent==='系統 ID').map(n=>n.children[3].textContent)");
 const paperText=await evaluate("document.querySelector('.tracking-report-paper').innerText");for(const marker of expectedIds)assert.ok(paperText.includes(marker));
 assert.ok(!paperText.includes('EXCLUDE-'),'excluded markers absent in print DOM');
 await evaluate("window.__realPrint=window.print;window.__printCalled=false;window.print=()=>{window.__printCalled=true}");await click('導出／列印 PDF');await until(()=>evaluate('window.__printCalled'),'actual print handler');
 assert.equal(await evaluate("document.body.classList.contains('printing-tracking-report')"),true);
 await screen(name+'-preview');const data=await call('Page.printToPDF',{preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});const file=path.join(output,name+'.pdf'),bytes=Buffer.from(data.data,'base64');assert.ok(bytes.subarray(0,5).equals(Buffer.from('%PDF-'))&&bytes.length>3000);fs.writeFileSync(file,bytes);evidence.artifacts.push(file);
 await evaluate("window.dispatchEvent(new Event('afterprint'));window.print=window.__realPrint");assert.equal(await evaluate("document.body.classList.contains('printing-tracking-report')"),false);await click('關閉 PDF 預覽');
 const readback=spawnSync(process.env.QA_PYTHON||'python3',['scripts/verify-tracking-export-pdf.py',file,'--expect',JSON.stringify(expectedIds)],{encoding:'utf8',timeout:45000});
 assert.equal(readback.status,0,readback.stderr||readback.stdout);const parsed=JSON.parse(readback.stdout);(evidence.pdfReadbacks??=[]).push(parsed);evidence.artifacts.push(...parsed.rasters,parsed.text);return {file,ids};
};
try {
 server=await createServer({configFile:false,root:process.cwd(),publicDir:false,base:'/',plugins:[react(),{name:'month-export-isolated-qa',configureServer(vite){vite.middlewares.use((req,res,next)=>{res.setHeader('Content-Security-Policy',"connect-src 'self'; img-src 'self' data: blob:");if(req.url?.startsWith('/__qa_month_export')){res.setHeader('Content-Type','text/html; charset=utf-8');void vite.transformIndexHtml('/__qa_month_export','<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/tracking-export-months.tsx"></script></body></html>').then(html=>res.end(html)).catch(next);}else next();});}}],server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
 await server.listen();await server.transformRequest('/scripts/fixtures/tracking-export-months.tsx');origin='http://127.0.0.1:'+server.httpServer.address().port;assert.equal((await fetch(origin+'/__qa_month_export')).status,200);evidence.origin=origin;
 const chrome=process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(chrome));browser=spawn(chrome,['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let port,socketPath;await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'owned Chrome handshake');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return;}if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')evidence.errors.push(JSON.stringify(m.params.args));if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url)&&!m.params.request.url.startsWith(origin+'/'))evidence.external.push(m.params.request.url);});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['https://*']});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:origin+'/__qa_month_export'});await until(()=>evaluate('Boolean(window.__monthQA)&&Boolean(document.querySelector(".tracking-export-actions"))'),'production export mounted');
 await click('導出excel');
 await check('mounted-required-natural-month-controls-default-Taipei',async()=>{
   const fields=await evaluate("[...document.querySelectorAll('.tracking-export input[type=month]')].map(n=>({label:n.getAttribute('aria-label'),value:n.value,required:n.required}))");
   const today=await evaluate("new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'}).format(new Date())");
   assert.deepEqual(fields,[{label:'匯出開始月份',value:today,required:true},{label:'匯出結束月份',value:today,required:true}]);
 });
 await check('mounted-month-filter-XLSX-PDF-same-immutable-selected-snapshot',async()=>{
   await setMonths('2024-02');await change('[aria-label="匯出資料範圍"]','selected');await change('[aria-label="匯出欄位"]','full');await snapshot();
   const summary=await text();assert.ok(summary.includes('applicationDate')&&summary.includes('2024-02-01')&&summary.includes('2024-02-29')&&summary.includes('所選 2 項'));
   // Mutating the callback's returned source cannot change the prepared snapshot.
   await evaluate("window.__monthQA.captures.at(-1).items.find(r=>r.id==='KEEP-A').description='MUTATED-AFTER-SNAPSHOT'");
   const {book}=await download('selected-full');assertGrid(book);assert.deepEqual(workbookRows(book).map(r=>r.id),['KEEP-B','KEEP-A']);
   const allText=book.worksheets.flatMap(s=>s.getSheetValues().flat(2)).join('\n');assert.ok(!allText.includes('EXCLUDE-')&&!allText.includes('KEEP-SIBLING')&&!allText.includes('MUTATED-AFTER-SNAPSHOT'));
   assert.ok(book.getWorksheet('跟蹤資料').getCell('A2').text.includes('applicationDate'));
   await pdf('selected-full-A4',['KEEP-B','KEEP-A']);
   assert.equal(await evaluate('window.__monthQA.captureCalls'),1,'Excel and PDF must share one capture, not reread independently');
 });
 await check('prepared-month-changes-invalidate-XLSX-and-PDF',async()=>{
   await click('PDF 預覽');await change('[aria-label="匯出開始月份"]','2024-01');assert.equal(await hasDownload(),false);assert.equal(await evaluate("Boolean(document.querySelector('.tracking-report-paper'))"),false);
   await setMonths('2024-02');await snapshot();await change('[aria-label="匯出結束月份"]','2024-03');assert.equal(await hasDownload(),false);await setMonths('2024-02');
 });
 await check('mounted-blank-invalid-reversed-and-zero-match-reject-without-fallback',async()=>{
   for(const [start,end,message] of [['','2024-02','請選擇'],['2024-13','2024-02','請選擇'],['2024-03','2024-02','不可晚於'],['2025-01','2025-01','0 項']]){
     await setMonths(start,end);const before=await evaluate('window.__monthQA.captureCalls');await click('建立共用快照');assert.ok((await text()).includes(message));assert.equal(await hasDownload(),false);if(message!=='0 項')assert.equal(await evaluate('window.__monthQA.captureCalls'),before,'invalid months must not request a snapshot');
   }
   await setMonths('2024-02');await evaluate("window.__monthQA.change({selected:['EXCLUDE-MAR','EXCLUDE-DELETED']})");await settle();await click('建立共用快照');assert.ok((await text()).includes('0 項'));assert.equal(await hasDownload(),false);
   await evaluate("window.__monthQA.change({selected:['KEEP-A','KEEP-B']})");await settle();await snapshot();
 });
 const boundaries=[['identity',"{identity:'new-actor-session'}"],['workspace',"{workspace:'other-workspace'}"],['filter',"{query:{...window.__monthQA.query,filters:{purchaseNos:{text:'OTHER'}}}}"],['keyword',"{query:{...window.__monthQA.query,search:'OTHER'}}"],['vessel',"{query:{...window.__monthQA.query,vesselId:'month-v2'}}"],['tab',"{query:{...window.__monthQA.query,tab:'delivered'}}"],['selection',"{selected:['KEEP-A']}"],['columns',"{preferences:{...window.__monthQA.preferences,hidden:['applicationDate']}}"],['blocked',"{blocked:true}"]];
 await evaluate("window.__baselineProps=structuredClone({identity:window.__monthQA.identity,workspace:window.__monthQA.workspace,query:window.__monthQA.query,selected:window.__monthQA.selected,preferences:window.__monthQA.preferences,blocked:false})");
 for(const [name,patch] of boundaries)await check('prepared-'+name+'-snapshot-invalidation',async()=>{
   if(!await hasDownload())await snapshot();await evaluate(`window.__monthQA.change(${patch})`);await settle();assert.equal(await hasDownload(),false);await evaluate('window.__monthQA.change(structuredClone(window.__baselineProps))');await settle();assert.equal(await hasDownload(),false,'ABA must not revive an old report');
 });
 for(const [name,patch] of boundaries.slice(0,6))await check('late-capture-'+name+'-fence',async()=>{
   await evaluate('window.__monthQA.held=true');const before=await evaluate('window.__monthQA.captureCalls');await click('建立共用快照');await until(()=>evaluate(`window.__monthQA.captureCalls===${before+1}`),'held capture started');assert.equal(await evaluate("[...document.querySelectorAll('.tracking-export input[type=month]')].every(n=>n.disabled)"),true);
   await evaluate(`window.__monthQA.change(${patch})`);await settle();await evaluate('window.__monthQA.change(structuredClone(window.__baselineProps))');await settle();await evaluate('window.__monthQA.held=false;window.__monthQA.release()');await until(()=>evaluate("![...document.querySelectorAll('.tracking-export button')].find(n=>n.textContent==='建立共用快照').disabled"),'late capture drained');assert.equal(await hasDownload(),false);
 });
 await check('source-current-fence-before-and-after-capture',async()=>{
   await evaluate('window.__monthQA.valid=false');await click('建立共用快照');assert.equal(await hasDownload(),false);assert.ok((await text()).includes('資料尚未確認'));
   await evaluate('window.__monthQA.valid=true');await snapshot();await evaluate('window.__monthQA.valid=false');const calls=await evaluate('window.__monthQA.captureCalls');await click('PDF 預覽');assert.equal(await evaluate("Boolean(document.querySelector('.tracking-report-paper'))"),false);await click('下載 XLSX');assert.ok((await text()).includes('快照已失效'));assert.equal(await evaluate('window.__monthQA.captureCalls'),calls);await evaluate('window.__monthQA.valid=true');
 });
 await check('all-filtered-visible-columns-and-order-preserved',async()=>{
   await change('[aria-label="匯出資料範圍"]','all');await change('[aria-label="匯出欄位"]','visible');await evaluate("window.__monthQA.change({query:{...window.__monthQA.query,sort:{key:'referenceNo',direction:'asc'}},preferences:{order:['referenceNo','description','applicationDate','requestType','progress'],hidden:['progress'],widths:{description:420}}})");await settle();await snapshot();
   const {book}=await download('all-visible');assertGrid(book);assert.deepEqual(workbookRows(book).map(r=>r.id),['KEEP-A','KEEP-B','KEEP-SIBLING']);assert.deepEqual(book.getWorksheet('跟蹤資料').getRow(3).values.slice(1),['tracking:exportOrdinal','tracking:referenceNo','tracking:description','tracking:applicationDate','tracking:requestType','tracking:id','tracking:vesselId']);
   await pdf('all-visible-A4',['KEEP-A','KEEP-B','KEEP-SIBLING']);
 });
 await check('real-files-december-january-inclusive-boundaries',async()=>{
   await evaluate("window.__monthQA.change({...structuredClone(window.__baselineProps),selected:['YEAR-DEC','YEAR-JAN']})");await settle();await change('[aria-label="匯出資料範圍"]','selected');await change('[aria-label="匯出欄位"]','compact');await setMonths('2023-12','2024-01');await snapshot();
   const {book}=await download('year-boundary');assertGrid(book);assert.deepEqual(workbookRows(book).map(r=>r.id),['YEAR-JAN','YEAR-DEC']);await pdf('year-boundary-A4',['YEAR-JAN','YEAR-DEC']);
 });
 await check('direct-component-administrative-views-suppress-all-exports',async()=>{
   for(const view of ['deleted','requests']){await evaluate(`window.__monthQA.change({query:{...window.__monthQA.query,view:${JSON.stringify(view)}}})`);await settle();assert.equal(await evaluate("Boolean(document.querySelector('.tracking-export-actions'))"),false);assert.equal(await hasDownload(),false);}await evaluate('window.__monthQA.change(structuredClone(window.__baselineProps))');await settle();
 });
 for(const audience of ['shore','ship'])await check('mounted-'+audience+'-page-filters-selection-desktop-mobile-and-files',async()=>{
   await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:origin+'/__qa_month_export?surface=page&audience='+audience});await until(()=>evaluate("Boolean(document.querySelector('.tracking-page'))&&Boolean(window.__monthQA)"),'production TrackingPage mounted');
   if(audience==='shore')await nodeClick("[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.textContent.startsWith('未送船清單'))");await until(()=>evaluate("Boolean([...document.querySelectorAll('.tracking-export-actions button')].find(n=>n.textContent==='導出excel'&&!n.disabled))"),'page load ready');
   await change('[aria-label="搜尋跟蹤"]','MONTH MATCH');await nodeClick("document.querySelector('.tracking-all-filters summary')");await nodeClick("document.querySelector('[aria-label=\"請購案號(非必填)篩選內容\"]')");await nodeClick("[...document.querySelectorAll('[aria-label=\"請購案號(非必填)多選\"] label')].find(n=>n.textContent.trim()==='KEEP').querySelector('input')");await nodeClick("document.querySelector('.tracking-all-filters summary')");await nodeClick("document.querySelector('.tracking-reference .tracking-sort')");
   for(const marker of ['KEEP-A','KEEP-B'])await nodeClick(`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.querySelector('.tracking-reference')?.textContent.includes(${JSON.stringify(marker)})).querySelector('.tracking-check input')`);
   const pre=await evaluate("({search:document.querySelector('[aria-label=搜尋跟蹤]').value,selected:[...document.querySelectorAll('.tracking-table tbody .tracking-check input:checked')].length,filters:document.querySelector('[aria-label=有效篩選]').textContent})");assert.equal(pre.selected,2);assert.ok(pre.filters.includes('KEEP'));
   await click('導出excel');await setMonths('2024-02');await change('[aria-label="匯出資料範圍"]','selected');await change('[aria-label="匯出欄位"]','full');await snapshot();
   for(const width of [1440,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:false});await settle();await evaluate("document.querySelector('.tracking-export').scrollTop=0");await settle();const geometry=await evaluate("(()=>{const modal=document.querySelector('.tracking-export'),r=modal.getBoundingClientRect();return {viewport:innerWidth,document:document.documentElement.scrollWidth,modal:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,client:modal.clientWidth,scroll:modal.scrollWidth},months:[...modal.querySelectorAll('input[type=month]')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height,value:n.value}})}})()");evidence.geometry.push({audience,...geometry});assert.equal(geometry.viewport,width);assert.ok(geometry.document<=width+1&&geometry.modal.left>=0&&geometry.modal.right<=width+1&&geometry.modal.scroll<=geometry.modal.client+1,'month dialog contained on '+width);assert.ok(geometry.months.every(n=>n.left>=0&&n.right<=width&&n.height>0),'month inputs visible');await screen(audience+'-month-dialog-'+width);}
   const {book}=await download(audience+'-page-selected');assertGrid(book);assert.deepEqual(workbookRows(book).map(r=>r.id),['KEEP-A','KEEP-B']);await pdf(audience+'-page-selected-A4',['KEEP-A','KEEP-B']);await click('關閉匯出');
   assert.deepEqual(await evaluate("({search:document.querySelector('[aria-label=搜尋跟蹤]').value,selected:[...document.querySelectorAll('.tracking-table tbody .tracking-check input:checked')].length,filters:document.querySelector('[aria-label=有效篩選]').textContent})"),pre,'export must preserve parent filters and selection');
   for(const label of ['已刪除清單','刪除申請／結果']){await nodeClick(`[...document.querySelectorAll('.tracking-review-tabs button')].find(n=>n.textContent.startsWith(${JSON.stringify(label)}))`);assert.equal(await evaluate("Boolean(document.querySelector('.tracking-export-actions'))"),false);}
 });
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.external,[]);evidence.status='PASS';
} catch(error){failure=error;evidence.status='FAIL';evidence.failure=error.stack||String(error);if(ws?.readyState===WebSocket.OPEN){evidence.dom=await text().catch(()=>null);await screen('failure').catch(()=>{});}}
finally {
 if(ws?.readyState===WebSocket.OPEN){await call('Browser.close',{},null).catch(()=>{});ws.close();}
 if(browser)await until(()=>browser.exitCode!==null,'owned browser exit',10000).catch(()=>browser.kill());
 if(server)await server.close();
 fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 evidence.cleanup={browserExited:!browser||browser.exitCode!==null,serverClosed:!server?.httpServer?.listening,profileRemoved:!fs.existsSync(profile)};
 evidence.finalInputs=hashes();fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({output,status:evidence.status,cases:evidence.cases,cleanup:evidence.cleanup,error:failure?.message},null,2));
}
if(failure)process.exitCode=1;

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createServer} from 'vite';

const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(process.cwd().toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'fleet-risk-ui-')),profile=path.join(output,'chrome');
const evidence={layer:'真實Dashboard及彈窗UI＋人工合成測試資料；非正式網站／非官網新查詢',cases:[],errors:[],requests:[],output};
const started='2026-11-10T23:00:00.000Z',completed='2026-11-10T23:02:30.000Z';
const rows=[['FPMC S AMBER','9913743','SRS'],['FPMC B 105','9487677','HRS']].map(([name,imo,risk])=>({name,imo,risk,status:'ok',priority:'No Priority',retrievedAt:completed,companyName:'FORMOSA PLASTICS MARINE CORPORATION',companyImo:'0882415',windowFrom:null,windowTo:null,sourceUpdatedAt:null,sourceUrl:'https://apcis.tmou.org/public/'}));
const first={id:'00000000-0000-4000-8000-000000000001',trigger:'scheduled',company:{name:'FORMOSA PLASTICS MARINE CORPORATION',imo:'0882415',performance:'Medium'},queryStartedAt:started,queryCompletedAt:completed,rosterRetrievedAt:started,count:2,rows,coverage:{referenceCount:2,missingReferenceImos:[],addedReferenceImos:[]}};
const second={...structuredClone(first),id:'00000000-0000-4000-8000-000000000002',trigger:'manual',queryStartedAt:'2026-11-11T01:00:00.000Z',queryCompletedAt:'2026-11-11T01:01:00.000Z',rosterRetrievedAt:'2026-11-11T01:00:00.000Z'};
second.rows.forEach(r=>{r.retrievedAt=second.queryCompletedAt;r.risk='LRS';});
const state={snapshot:first,attempt:null,serverTime:'2026-11-11T01:02:00.000Z',nextScheduledAt:'2026-11-11T23:00:00.000Z'};
let server,browser,ws,sessionId,id=0,failure,forceCount=0,readFailure=false,active=false,origin;
const pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,label,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(60);}throw new Error('Timeout '+label);}
function call(method,params={},session=sessionId){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method));},15000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function click(label){await evaluate(`(()=>{const n=[...document.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.textContent.trim())===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled);if(!n)throw new Error('Button missing '+${JSON.stringify(label)});n.focus();})()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
const screen=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
const text=()=>evaluate("document.querySelector('.fleet-risk-dialog')?.innerText||''");
const readSnapshot=()=>evaluate("document.querySelector('.fleet-risk-dialog [data-snapshot-id]')?.dataset.snapshotId");
const reserve=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const entry=`import React from'react';import{createRoot}from'react-dom/client';import Dashboard from'/src/Dashboard.tsx';import'/src/styles.css';window.SHIP_DYNAMICS_SUPABASE_CONFIG={supabaseUrl:location.origin,supabaseAnonKey:'synthetic-public-key',workspaceKey:'qa'};const noop=()=>{};createRoot(document.getElementById('root')).render(React.createElement(Dashboard,{user:{id:'qa',role:'operator',isActive:true},itineraryActor:{userId:'qa'},users:[],vessels:[],tasks:[],calendarTasks:[],internalControlCases:[],meetings:[],selected:[],setSelected:noop,batchSelected:[],setBatchSelected:noop,onOpenVessel:noop,onEdit:noop,onAddTask:noop,onToggleAttention:noop,onAdjustAttention:noop,onStartMeeting:noop,onOpenReport:noop,onTaskMetric:noop,onOpenBatchManagedVessels:noop,canEdit:true,canCreateTasks:true,canUseMeetings:true,canUseReports:true}));`;
try{
  server=await createServer({root:process.cwd(),base:'/',server:{host:'127.0.0.1',port:await reserve(),strictPort:true},logLevel:'silent',plugins:[{name:'isolated-fleet-risk-qa',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    res.setHeader('Content-Security-Policy',"connect-src 'self' ws://127.0.0.1:*");
    if(req.url==='/__qa_fleet_risk'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><p style="background:#fff0c5;padding:8px">真實 UI＋測試資料｜不連正式環境</p><div id="root"></div><script type="module" src="/@qa-fleet-risk"></script></body></html>'));return;}
    if(req.url==='/rest/v1/rpc/read_ship_fleet_risk_v1'||req.url==='/functions/v1/fleet-risk'){
      let body='';for await(const chunk of req)body+=chunk;
      evidence.requests.push({path:req.url,body:JSON.parse(body||'{}')});res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.url.includes('/functions/')){forceCount++;assert.equal(JSON.parse(body).action,'refresh');active=true;state.attempt={id:second.id,trigger:'manual',status:'running',startedAt:second.queryStartedAt,completedAt:null,done:0,total:2,error:null};res.end(JSON.stringify({ok:true,state,runId:second.id,started:true}));return;}
      if(readFailure){res.statusCode=503;res.end('{}');return;}
      res.end(JSON.stringify(state));return;
    }
    next();
  });},resolveId(source){if(source==='/@qa-fleet-risk')return '\0qa-fleet-risk';},load(source){if(source==='\0qa-fleet-risk')return entry;}}]});
  await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=spawn(process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let port,socketPath;await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch{return false;}},'owned Chrome');
  ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:origin+'/__qa_fleet_risk'});
  await until(()=>evaluate("Boolean(document.querySelector('[aria-label=船隊風險清單]'))"),'original Dashboard button');
  await until(()=>Promise.resolve(evidence.requests.length===1),'one shared dashboard snapshot read');
  assert.equal(evidence.requests[0].path,'/rest/v1/rpc/read_ship_fleet_risk_v1','dashboard reads once without crawling');
  assert.equal(forceCount,0);
  await click('船隊風險清單');await until(async()=>await readSnapshot()===first.id,'cached shared snapshot');
  assert.equal(forceCount,0);assert.match(await text(),/Paris MoU/);assert.match(await text(),/USCG/);
  await screen('desktop-scheduled');
  await click('強制更新');assert.match(await text(),/2～4/);await click('取消，保留目前清單');assert.equal(forceCount,0);assert.equal(await readSnapshot(),first.id);
  evidence.cases.push('open snapshot without crawl; confirm cancellation sends zero force requests');
  await evaluate("window.print=()=>{window.__qaPrintCalls=(window.__qaPrintCalls||0)+1;}");
  await click('匯出 PDF');await until(()=>evaluate("document.body.classList.contains('printing-fleet-risk')&&window.__qaPrintCalls===1"),'original PDF entry');
  assert.equal(await evaluate("document.querySelector('.fr-print-root [data-snapshot-id]').dataset.snapshotId"),first.id);
  const pdf=(await call('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false})).data;fs.writeFileSync(path.join(output,'scheduled-snapshot-test.pdf'),Buffer.from(pdf,'base64'));
  await evaluate("dispatchEvent(new Event('afterprint'))");await until(()=>evaluate("!document.body.classList.contains('printing-fleet-risk')"),'print cleanup');
  evidence.cases.push('original PDF action captures exact displayed snapshot; Chromium real PDF saved');
  await click('強制更新');await click('開始更新');await until(()=>Promise.resolve(active),'force request');assert.equal(forceCount,1);assert.equal(await readSnapshot(),first.id,'old complete snapshot stays during refresh');
  state.snapshot=second;state.attempt={...state.attempt,status:'success',done:2,completedAt:second.queryCompletedAt};
  await until(async()=>await readSnapshot()===second.id,'atomic new snapshot');assert.match(await text(),/低風險/);
  assert.equal(await evaluate("document.querySelectorAll('.fleet-risk-dialog .fr-table tbody tr').length"),2);
  await click('匯出 PDF');await until(()=>evaluate('window.__qaPrintCalls===2'),'new snapshot print');
  assert.equal(await evaluate("document.querySelector('.fr-print-root [data-snapshot-id]').dataset.snapshotId"),second.id);
  fs.writeFileSync(path.join(output,'manual-snapshot-test.pdf'),Buffer.from((await call('Page.printToPDF',{printBackground:true,preferCSSPageSize:true})).data,'base64'));
  await evaluate("dispatchEvent(new Event('afterprint'))");
  evidence.cases.push('force success replaces whole snapshot; PDF follows new displayed snapshot');
  state.attempt={...state.attempt,id:'00000000-0000-4000-8000-000000000003',status:'failed',error:'upstream-timeout'};
  await click('讀取更新狀態');await until(async()=>(await text()).includes('更新失敗'),'failure visible');assert.equal(await readSnapshot(),second.id);
  readFailure=true;await click('讀取更新狀態');await until(async()=>(await text()).includes('HTTP 503'),'transport failure');assert.equal(await readSnapshot(),second.id);readFailure=false;
  evidence.cases.push('failed attempt and transport errors preserve shown snapshot and show warning');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await screen('mobile-snapshot');
  const geometry=await evaluate("(()=>{const d=document.querySelector('.fleet-risk-dialog'),r=d.getBoundingClientRect();return{viewport:innerWidth,left:r.left,right:r.right,documentWidth:document.documentElement.scrollWidth,tableScroll:document.querySelector('.fr-table-wrap').scrollWidth};})()");
  assert.ok(geometry.left>=0&&geometry.right<=geometry.viewport+1,'mobile dialog fits viewport');evidence.geometry=geometry;
  await click('關閉風險清單');await until(()=>evaluate("!document.querySelector('.fleet-risk-dialog')"),'dialog closes');
  assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"),'船隊風險清單','focus restores');
  const before=evidence.requests.length;await click('船隊風險清單');await until(async()=>await readSnapshot()===second.id,'reopen latest shared snapshot');assert.ok(evidence.requests.length>before);assert.equal(forceCount,1);
  evidence.cases.push('mobile dialog/table containment, focus restoration, reopen reads shared result without new crawl');
  assert.deepEqual(evidence.errors,[]);
  evidence.status='PASS';
}catch(error){failure=error;evidence.status='FAIL';evidence.failure=error.stack;}
finally{
  if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
  if(browser&&browser.exitCode===null){await Promise.race([new Promise(r=>browser.once('exit',r)),wait(3000)]);if(browser.exitCode===null)browser.kill();}
  if(server)await server.close();
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(evidence,null,2));
}
console.log(JSON.stringify(evidence,null,2));if(failure)throw failure;

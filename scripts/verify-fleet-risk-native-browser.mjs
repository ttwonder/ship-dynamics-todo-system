import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createServer} from 'vite';

import {createNativeRiskBridge} from './fleet-risk-native-bridge.mjs';
const fixtureRoot=process.env.FLEET_RISK_FIXTURE_ROOT;
assert.ok(fixtureRoot&&path.isAbsolute(fixtureRoot),'Absolute FLEET_RISK_FIXTURE_ROOT required');
const live=process.argv.includes('--live');
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(process.cwd().toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'fleet-risk-native-')),profile=path.join(output,'chrome');
const evidence={layer:live?'Original UI + native worker + HTTP RPC + real embedded PostgreSQL + one live official query. NOT hosted Supabase.':'Original UI + native worker + HTTP RPC + real embedded PostgreSQL + saved official HTML replay. NOT live/hosted.',cases:[],errors:[],requests:[],output};
let server,browser,ws,sessionId,id=0,failure,origin,bridge;
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
 server=await createServer({root:process.cwd(),base:'/',server:{host:'127.0.0.1',port:await reserve(),strictPort:true},logLevel:'silent',plugins:[{name:'native-fleet-risk-qa',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  res.setHeader('Content-Security-Policy',"connect-src 'self' ws://127.0.0.1:*");
  if(req.url==='/__qa_fleet_risk'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><p>真實 UI＋本機測試資料庫｜不連正式雲端</p><div id="root"></div><script type="module" src="/@qa-fleet-risk"></script></body></html>'));return;}
  if(bridge)return bridge.middleware(req,res,next);next();
 });},resolveId(source){if(source==='/@qa-fleet-risk')return '\0qa-fleet-risk';},load(source){if(source==='\0qa-fleet-risk')return entry;}}]});
 await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 bridge=await createNativeRiskBridge({loadModule:p=>server.ssrLoadModule(p),fixtureRoot,origin,live});
 const first=(await bridge.seed()).snapshot;fs.writeFileSync(path.join(output,'baseline-replay-snapshot.json'),JSON.stringify(first,null,2));
  browser=spawn(process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let port,socketPath;await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch{return false;}},'owned Chrome');
  ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:origin+'/__qa_fleet_risk'});
  await until(()=>evaluate("Boolean(document.querySelector('[aria-label=船隊風險清單]'))"),'original Dashboard button');

 const baselineCalls=bridge.sourceCalls,baselineForce=bridge.forceRequests;
 await click('船隊風險清單');await until(async()=>await readSnapshot()===first.id,'native baseline snapshot');
 assert.equal(await evaluate("document.querySelectorAll('.fleet-risk-dialog tr[data-imo]').length"),first.count);
 assert.equal(bridge.sourceCalls,baselineCalls,'open only reads');
 await click('強制更新');assert.match(await text(),/2～4/);await click('取消，保留目前清單');assert.equal(bridge.forceRequests,baselineForce);
 evidence.cases.push('open reads exact full PostgreSQL snapshot; cancelled confirmation sends no refresh');
 bridge.setMode(live?'live':'hold');
 const beforeRefresh=Date.now();await click('強制更新');await click('開始更新');
 await until(()=>Promise.resolve(bridge.sourceCalls===baselineCalls+1),'native worker starts');
 assert.equal(await readSnapshot(),first.id,'old full snapshot remains');
 const sessionA=sessionId;
 const peer=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId:peer.targetId,flatten:true},null));
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:origin+'/__qa_fleet_risk'});
 await until(()=>evaluate("Boolean(document.querySelector('[aria-label=船隊風險清單]'))"),'peer Dashboard');await click('船隊風險清單');
 await until(async()=>Boolean(await readSnapshot()),'peer reads shared state');
 const sessionB=sessionId;
 sessionId=sessionA;await click('關閉風險清單');sessionId=sessionB;
 if(!live){assert.equal(await readSnapshot(),first.id);await until(()=>Promise.resolve(bridge.isHeld()),'held source');bridge.release();}
 await until(async()=>{const state=await bridge.read();if(state.attempt?.status==='failed')throw new Error('Native collection failed: '+state.attempt.error);return state.attempt?.status==='success'&&state.snapshot?.id!==first.id;},'complete source publication',140000);
 await bridge.drain();const second=(await bridge.read()).snapshot;
 evidence.refreshElapsedMs=Date.now()-beforeRefresh;evidence.realSource=live;
 assert.equal(second.count,second.rows.length);assert.deepEqual([...new Set(second.rows.map(r=>r.imo))].sort(),bridge.roster.map(r=>r.imo).sort());
 await until(async()=>await readSnapshot()===second.id,'peer whole-snapshot replacement');
 assert.deepEqual((await evaluate("[...document.querySelectorAll('.fleet-risk-dialog tr[data-imo]')].map(r=>r.dataset.imo)")).sort(),second.rows.map(r=>r.imo).sort());
 fs.writeFileSync(path.join(output,live?'live-snapshot.json':'replay-snapshot.json'),JSON.stringify(second,null,2));
 evidence.snapshot={id:second.id,count:second.count,outsourced:second.rows.filter(r=>r.companyImo!=='0882415').map(r=>({imo:r.imo,name:r.name})),riskCounts:Object.fromEntries(['HRS','SRS','LRS'].map(k=>[k,second.rows.filter(r=>r.risk===k).length]))};
 evidence.cases.push('original manual action → worker → source collector → native SQL → independent peer; closing caller does not cancel shared run');
 await screen('desktop-complete');
 await evaluate("window.print=()=>{window.__qaPrinted=true;}");await click('匯出 PDF');await until(()=>evaluate("window.__qaPrinted&&document.body.classList.contains('printing-fleet-risk')"),'mounted print action');
 assert.equal(await evaluate("document.querySelector('.fr-print-root [data-snapshot-id]').dataset.snapshotId"),second.id);
 assert.deepEqual((await evaluate("[...document.querySelectorAll('.fr-print-root tr[data-imo]')].map(r=>r.dataset.imo)")).sort(),second.rows.map(r=>r.imo).sort());
 fs.writeFileSync(path.join(output,'fleet-risk-complete.pdf'),Buffer.from((await call('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false})).data,'base64'));
 await evaluate("dispatchEvent(new Event('afterprint'))");await until(()=>evaluate("!document.body.classList.contains('printing-fleet-risk')"),'print cleanup');
 evidence.cases.push('mounted PDF freezes exact database/display version and every vessel; real Chromium PDF saved');
 bridge.setMode('fail');await click('強制更新');await click('開始更新');
 await until(async()=>(await text()).includes('更新失敗'),'source failure shown');assert.equal(await readSnapshot(),second.id);assert.deepEqual((await bridge.read()).snapshot,second);
 evidence.cases.push('actual worker failure keeps exact native database and displayed last-good snapshot');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await screen('mobile-complete');
 evidence.geometry=await evaluate("(()=>{const r=document.querySelector('.fleet-risk-dialog').getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,tableScroll:document.querySelector('.fr-table-wrap').scrollWidth};})()");
 assert.ok(evidence.geometry.left>=0&&evidence.geometry.right<=evidence.geometry.viewport+1);assert.ok(evidence.geometry.documentWidth<=evidence.geometry.viewport+1);
 sessionId=sessionA;await click('船隊風險清單');await until(async()=>await readSnapshot()===second.id,'reopened first client reads latest');
 evidence.cases.push('390px containment and first client reopen read latest without crawling');
 assert.deepEqual(evidence.errors,[]);evidence.status='PASS';
}catch(error){failure=error;evidence.status='FAIL';evidence.failure=error.stack;}
finally{
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser&&browser.exitCode===null){await Promise.race([new Promise(r=>browser.once('exit',r)),wait(3000)]);if(browser.exitCode===null)browser.kill();}
 if(bridge){evidence.sourceCalls=bridge.sourceCalls;evidence.sourceRequests=bridge.sourceRequests;evidence.liveMetrics=bridge.liveMetrics;evidence.requests=bridge.metrics;await bridge.close();}
 if(server)await server.close();fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(evidence,null,2));
}
console.log(JSON.stringify({status:evidence.status,output,cases:evidence.cases,snapshot:evidence.snapshot,elapsedMs:evidence.refreshElapsedMs,failure:evidence.failure},null,2));if(failure)throw failure;

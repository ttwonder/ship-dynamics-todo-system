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
const output=fs.mkdtempSync(path.join(root,'fleet-risk-cards-')),profile=path.join(output,'chrome');
const evidence={layer:'真實Dashboard及彈窗UI＋合成測試資料；不是正式網站／官網新查詢',cases:[],errors:[],requests:[],output};
const started='2026-11-10T23:00:00.000Z',completed='2026-11-10T23:02:30.000Z';
const rows=[['FPMC B 105','9487677','HRS'],['FPMC B 201','9468229','HRS'],['FPMC S AMBER','9913743','SRS'],['FPMC 25','9433834','LRS']].map(([name,imo,risk])=>({name,imo,risk,status:'ok',priority:'No Priority',retrievedAt:completed,companyName:'FORMOSA PLASTICS MARINE CORPORATION',companyImo:'0882415',windowFrom:null,windowTo:null,sourceUpdatedAt:null,sourceUrl:'https://apcis.tmou.org/public/'}));
const first={id:'00000000-0000-4000-8000-000000000001',trigger:'scheduled',company:{name:'FORMOSA PLASTICS MARINE CORPORATION',imo:'0882415',performance:'Medium'},queryStartedAt:started,queryCompletedAt:completed,rosterRetrievedAt:started,count:rows.length,rows,coverage:{referenceCount:rows.length,missingReferenceImos:[],addedReferenceImos:[]}};
const state={snapshot:first,attempt:null,serverTime:'2026-11-11T01:02:00.000Z',nextScheduledAt:'2026-11-11T23:00:00.000Z'};
let server,browser,ws,sessionId,id=0,failure,forceCount=0,readFailure=false,origin,readBarrier=null,releaseRead=null;
const pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,label,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(60);}throw new Error('Timeout '+label);}
function call(method,params={},session=sessionId){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method));},15000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function activate(expression){await evaluate(`(()=>{const n=${expression};if(!n||n.disabled)throw new Error('Missing enabled control');n.focus();})()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
const click=label=>activate(`[...document.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.textContent.trim())===${JSON.stringify(label)}&&n.getClientRects().length)`);
const screen=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
const visibleNames=()=>evaluate("[...document.querySelectorAll('.ship-name-link')].map(n=>n.textContent.trim())");
const metadataGeometry=()=>evaluate("[...document.querySelectorAll('.ship-card')].map(card=>{const rect=s=>{const n=card.querySelector(s),r=n.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,width:r.width,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth};};return{badge:rect('.fleet-risk-card-badge'),type:rect('.ship-type-supervisor>span:first-of-type'),names:rect('.ship-manager-names'),header:rect('.ship-card-head'),operation:rect('.ship-operation-grid')};})");
function checkMetadata(rows){for(const row of rows){assert.ok(row.badge.right<=row.type.left,'Risk badge must sit left of ship type, not on a separate row');assert.ok(row.badge.top<row.type.bottom&&row.type.top<row.badge.bottom,'Risk badge and ship type must share the same line');assert.ok(row.names.scrollWidth<=row.names.clientWidth+1,'Long manager names wrap inside the right-hand region');}}
const reserve=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const entry=`import React from'react';import{createRoot}from'react-dom/client';import Dashboard from'/src/Dashboard.tsx';import{createInitialData}from'/src/data/seed.ts';import'/src/styles.css';
window.SHIP_DYNAMICS_SUPABASE_CONFIG={supabaseUrl:location.origin,supabaseAnonKey:'synthetic-public-key',workspaceKey:'qa'};
const noop=()=>{},data=createInitialData(),names=['FPMC B 105','FPMC B 201','FPMC S AMBER','FPMC 25','FPMC 26'];
const fixtureManagers=['測試主管甲','測試主管乙','測試主管丙','測試主管丁','測試副理戊','測試經理己','測試經理庚'].map((name,i)=>({id:'qa-manager-'+i,name,username:'qa-manager-'+i,department:'督導',role:'operator',isActive:true,managedVesselIds:[]}));
const vessels=names.map((name,index)=>{const original=data.vessels.find(v=>v.fullName===name);if(!original)throw new Error('Fixture missing '+name);return {...original,assignedUserIds:index===0?['qa',...fixtureManagers.map(u=>u.id)]:index===1?fixtureManagers.slice(0,2).map(u=>u.id):[],delegateManagers:[],shipType:index===0?'測試散貨':'測試油輪',manualAttentionLevel:'',weeklyAttention:[],note:{...original.note,statusList:[],statusSupplement:''}};});
const user={id:'qa',name:'測試督導',username:'qa',department:'督導',role:'operator',isActive:true,managedVesselIds:[]};window.__qaVessels=vessels;window.__qaVesselsBefore=JSON.stringify(vessels);
function Harness(){const[selected,setSelected]=React.useState([]),[batchSelected,setBatchSelected]=React.useState([]);return React.createElement(Dashboard,{user,itineraryActor:{userId:'qa'},users:[user,...fixtureManagers],vessels,tasks:[],calendarTasks:[],internalControlCases:[],meetings:[],selected,setSelected,batchSelected,setBatchSelected,onOpenVessel:noop,onEdit:noop,onAddTask:noop,onToggleAttention:noop,onAdjustAttention:noop,onStartMeeting:noop,onOpenReport:noop,onTaskMetric:noop,onOpenBatchManagedVessels:noop,canEdit:true,canCreateTasks:true,canUseMeetings:true,canUseReports:true});}createRoot(document.getElementById('root')).render(React.createElement(Harness));`;
try{
  server=await createServer({root:process.cwd(),base:'/',server:{host:'127.0.0.1',port:await reserve(),strictPort:true},logLevel:'silent',plugins:[{name:'isolated-fleet-risk-cards-qa',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    res.setHeader('Content-Security-Policy',"connect-src 'self' ws://127.0.0.1:*");
    if(req.url==='/__qa_fleet_risk_cards'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><p style="background:#fff0c5;padding:8px">真實 UI＋測試資料｜不連正式環境</p><main id="root" style="padding:12px"></main><script type="module" src="/@qa-fleet-risk-cards"></script></body></html>'));return;}
    if(req.url.startsWith('/rest/')||req.url.startsWith('/functions/')){
      let body='';for await(const chunk of req)body+=chunk;
      evidence.requests.push({path:req.url,body:JSON.parse(body||'{}')});res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.url==='/functions/v1/fleet-risk'){forceCount++;res.statusCode=503;res.end('{}');return;}
      assert.equal(req.url,'/rest/v1/rpc/read_ship_fleet_risk_v1','No business writer is allowed in display QA');
      if(readBarrier)await readBarrier;
      if(readFailure){res.statusCode=503;res.end('{}');return;}
      res.end(JSON.stringify(state));return;
    }
    next();
  });},resolveId(source){if(source==='/@qa-fleet-risk-cards')return '\0qa-fleet-risk-cards';},load(source){if(source==='\0qa-fleet-risk-cards')return entry;}}]});
  await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=spawn(process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let port,socketPath;await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch{return false;}},'owned Chrome');
  ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:origin+'/__qa_fleet_risk_cards'});
  await until(async()=>(await visibleNames()).length===5,'original five ship cards');
  await screen('desktop-baseline');
  assert.equal(await evaluate("document.querySelectorAll('.ship-card .fleet-risk-card-badge').length"),5,'Every original ship card must expose the compact Tokyo risk badge');
  await until(()=>evaluate("[...document.querySelectorAll('.fleet-risk-card-badge')].map(n=>n.textContent).join(',')==='HRS,HRS,SRS,LRS,—'"),'matched risk grades and unknown');
  await screen('desktop-all');
  evidence.desktopMetadata=await metadataGeometry();checkMetadata(evidence.desktopMetadata);
  const styles=()=>evaluate("[...document.querySelectorAll('.fleet-risk-card-badge,.filter-pill-hrs')].map(n=>({text:n.textContent,fg:getComputedStyle(n).color,bg:getComputedStyle(n).backgroundColor,height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width}))");
  evidence.idleStyles=await styles();
  const lum=rgb=>{const c=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
  const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
  for(const style of evidence.idleStyles)assert.ok(contrast(style.fg,style.bg)>=4.5,`legible ${style.text}`);
  assert.equal(evidence.requests.length,1,'All cards share one snapshot read');assert.equal(forceCount,0,'Mount must not refresh sources');
  evidence.cases.push('cards: compact Tokyo HRS/SRS/LRS/unknown; one shared read; no source crawl');
  await click('HRS船舶');
  await until(async()=>(await visibleNames()).length===2,'HRS-only cards');
  assert.ok((await visibleNames()).every(n=>n.includes('FPMC B 105')||n.includes('FPMC B 201')));
  assert.equal(await evaluate("document.querySelector('.filter-pill-hrs').getAttribute('aria-pressed')"),'true');
  await screen('desktop-hrs');
  evidence.activeStyles=await styles();
  for(const style of evidence.activeStyles)assert.ok(contrast(style.fg,style.bg)>=4.5,`active legible ${style.text}`);
  await click('自管船舶');await until(async()=>(await visibleNames()).length===1,'HRS and self-managed intersection');
  assert.match((await visibleNames())[0],/FPMC B 105/);
  await click('自管船舶');await until(async()=>(await visibleNames()).length===2,'self-managed toggle preserves HRS');
  await click('急／高關注');await until(async()=>(await visibleNames()).length===0,'official HRS is independent of internal attention');
  await click('急／高關注');await until(async()=>(await visibleNames()).length===2,'attention toggle preserves HRS');
  await click('HRS船舶');await until(async()=>(await visibleNames()).length===5,'second HRS click clears it');
  await click('HRS船舶');await click('全部');await until(async()=>(await visibleNames()).length===5,'all resets HRS');
  assert.equal(await evaluate("document.querySelector('.filter-pill-hrs').getAttribute('aria-pressed')"),'false');
  assert.equal(evidence.requests.length,1,'Filters do not fetch, crawl or write');
  assert.equal(await evaluate('JSON.stringify(window.__qaVessels)===window.__qaVesselsBefore'),true);
  evidence.cases.push('filter: HRS-only, AND self-managed/attention, toggle off, All reset; no reads/writes');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate("document.querySelector('.dashboard-toolbar').scrollIntoView({block:'start'})");await screen('mobile-all');
  evidence.mobile=await evaluate("({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.ship-card')].map(n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right};}),filter:(()=>{const r=document.querySelector('.filter-pill-hrs').getBoundingClientRect();return{left:r.left,right:r.right};})()})");
  assert.ok(evidence.mobile.documentWidth<=390);
  for(const card of evidence.mobile.cards)assert.ok(card.left>=0&&card.right<=390);
  assert.ok(evidence.mobile.filter.left>=0&&evidence.mobile.filter.right<=390);
  evidence.mobileMetadata=await metadataGeometry();checkMetadata(evidence.mobileMetadata);
  assert.ok(evidence.mobileMetadata[0].names.height>evidence.mobileMetadata[1].names.height,'Long manager list wraps without moving the badge into its own row');
  evidence.cases.push('metadata layout: compact risk at left, ship type/managers at right; long names wrap on desktop and phone');
  await click('HRS船舶');await until(async()=>(await visibleNames()).length===2,'mobile HRS filter');await evaluate("document.querySelector('.dashboard-toolbar').scrollIntoView({block:'start'})");await screen('mobile-hrs');
  const firstBadge="document.querySelector('.fleet-risk-card-badge')";
  await activate(firstBadge);await until(()=>evaluate('Boolean(document.querySelector("dialog[open]"))'),'touch-accessible risk details');
  const dialogSnapshot=()=>evaluate('document.querySelector("dialog [data-snapshot-id]")?.dataset.snapshotId');
  await until(async()=>await dialogSnapshot()===first.id,'card opens same-version report');
  assert.equal(await evaluate("document.querySelector('.fleet-risk-card-badge').dataset.snapshotId"),first.id);
  await click('關閉風險清單');await until(()=>evaluate('!document.querySelector("dialog")'),'close details');
  assert.equal(await evaluate("document.activeElement?.classList.contains('fleet-risk-card-badge')"),true);
  evidence.cases.push('responsive: 390px containment and readable colors; badge opens same snapshot; close restores focus');
  await click('全部');
  state.snapshot={...first,id:'00000000-0000-4000-8000-000000000002',rows:first.rows.map((r,i)=>({...r,risk:i===0?'LRS':r.risk}))};
  await activate(firstBadge);await until(async()=>await dialogSnapshot()===state.snapshot.id,'new shared cloud version');
  assert.equal(await evaluate("document.querySelector('.fleet-risk-card-badge').textContent"),'LRS');
  assert.equal(await evaluate("document.querySelector('.fleet-risk-card-badge').dataset.snapshotId"),state.snapshot.id);
  readFailure=true;await click('讀取更新狀態');await until(()=>evaluate('Boolean(document.querySelector("dialog [role=alert]"))'),'read error');
  assert.equal(await evaluate("document.querySelector('.fleet-risk-card-badge').textContent"),'LRS');
  assert.match(await evaluate("document.querySelector('.fleet-risk-card-badge').title"),/讀取失敗.*保留上次成功/);
  assert.equal(await dialogSnapshot(),state.snapshot.id);
  readFailure=false;state.serverTime='2026-11-11T23:01:00.000Z';await click('讀取更新狀態');
  await until(()=>evaluate("document.querySelector('.fleet-risk-card-notice')?.textContent==='待更新'"),'old snapshot warning');
  assert.equal(await evaluate("document.querySelector('.fleet-risk-card-badge').textContent"),'LRS');
  await click('關閉風險清單');await until(()=>evaluate('!document.querySelector("dialog")'),'close stale report');
  evidence.cases.push('shared feed: dialog read updates cards atomically; transport failure and staleness retain last grade');
  readFailure=true;let beforeReads=evidence.requests.length;
  await call('Page.reload');await until(()=>evaluate("document.querySelector('.fleet-risk-card-notice')?.textContent==='讀取失敗'"),'cold-load failure stays unknown');
  assert.equal(evidence.requests.length,beforeReads+1);
  assert.equal(await evaluate("[...document.querySelectorAll('.fleet-risk-card-badge')].every(n=>n.textContent==='—')"),true);
  await click('HRS船舶');await until(async()=>(await visibleNames()).length===0,'unknown excluded from HRS');
  assert.match(await evaluate("document.querySelector('.empty-state').textContent"),/不代表低風險/);
  evidence.cases.push('cold read failure: all unknown, not LRS; HRS excludes unknown and explains no confirmed result');
  readFailure=false;state.snapshot=first;state.serverTime='2026-11-11T01:02:00.000Z';
  readBarrier=new Promise(resolve=>{releaseRead=resolve;});beforeReads=evidence.requests.length;
  await call('Page.reload');await until(async()=>(await visibleNames()).length===5&&evidence.requests.length===beforeReads+1,'pending initial read');
  await click('船隊風險清單');await until(()=>evaluate('Boolean(document.querySelector("dialog[open]"))'),'dialog joins pending read');
  assert.equal(evidence.requests.length,beforeReads+1,'no duplicate read while initial snapshot is pending');
  releaseRead();readBarrier=null;
  await until(async()=>await dialogSnapshot()===first.id,'joined read resolves to same version');
  assert.equal(await evaluate("document.querySelector('.fleet-risk-card-badge').dataset.snapshotId"),first.id);
  assert.equal(forceCount,0,'No card, filter, reload or dialog-open path crawls external sources');
  assert.equal(await evaluate('JSON.stringify(window.__qaVessels)===window.__qaVesselsBefore'),true);
  evidence.cases.push('request boundary: reload reads once; dialog coalesces pending read; no source refresh or business writes');
  assert.deepEqual(evidence.errors,[]);evidence.status='PASS';
}catch(error){failure=error;evidence.status='FAIL';evidence.failure=error.stack;}
finally{
  releaseRead?.();readBarrier=null;
  if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
  if(browser&&browser.exitCode===null){await Promise.race([new Promise(r=>browser.once('exit',r)),wait(3000)]);if(browser.exitCode===null)browser.kill();}
  if(server)await server.close();
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(evidence,null,2));
}
console.log(JSON.stringify(evidence,null,2));if(failure)throw failure;

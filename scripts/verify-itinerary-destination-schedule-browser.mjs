import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';

const root=process.env.QA_EVIDENCE_ROOT||path.join(process.env.LOCALAPPDATA||os.homedir(),'hermes/cache/scratch');
fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'destination-schedule-browser-')),profile=path.join(output,'chrome-profile');
const evidence={layer:'真實 Dashboard＋正式 feed/projection＋測試資料；非正式環境／非資料庫端到端',cases:[],errors:[],geometry:[]};
evidence.inputs=Object.fromEntries(['src/Dashboard.tsx','src/itinerary/itineraryOperationalProjection.ts','src/itinerary/useItineraryOperationalProjection.ts','src/scheduleTime.ts','src/styles.css','scripts/fixtures/itinerary-destination-schedule.tsx','scripts/verify-itinerary-destination-schedule-browser.mjs'].map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
let server,browser,ws,sessionId,id=0,failure;
const pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,label,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(80);}throw new Error('Timeout: '+label);}
function call(method,params={},session=sessionId){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout: '+method));},10000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
const screen=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
const nativeClick=async selector=>{const p=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)throw new Error('Missing control');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...p});};
const route=()=>evaluate("[...document.querySelectorAll('.ship-route b')].map(n=>n.textContent)");
const schedules=async expected=>{
  const found={};
  for(let n=0;n<3;n++){
    const actual=await evaluate("(()=>{const n=document.querySelector('.ship-schedule');return{kind:n.querySelector('b').textContent,value:n.querySelector('span').textContent};})()");
    assert.equal(actual.value,expected[actual.kind],actual.kind+' must use the selected row/timezone');found[actual.kind]=actual.value;
    await nativeClick('.ship-schedule');
    await until(()=>evaluate(`document.querySelector('.ship-schedule b').textContent!==${JSON.stringify(actual.kind)}`),'schedule cycle');
  }
  assert.deepEqual(Object.keys(found).sort(),['ETA','ETB','ETD']);
};
const first={ETA:'2026-09-16 08:00',ETB:'2026-09-16 10:00',ETD:'2026-09-23 21:30'};
const second={ETA:'2026-09-25 07:30',ETB:'2026-09-25 00:30',ETD:'2026-09-25 20:45'};
const variant=async mode=>{const old=await evaluate('window.__qaState().revision');await evaluate(`window.__qaVariant(${JSON.stringify(mode)})`);await until(()=>evaluate(`window.__qaState().revision>${old}`),'confirmed fixture revision');};
try{
  server=await createServer({root:process.cwd(),base:'/',server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{name:'isolated-destination-qa',configureServer(vite){vite.middlewares.use((req,res,next)=>{
    res.setHeader('Content-Security-Policy',"connect-src 'self' ws://127.0.0.1:*");
    if(req.url!=='/__qa_destination')return next();
    res.setHeader('Content-Type','text/html; charset=utf-8');
    void vite.transformIndexHtml('/__qa_destination','<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>body{padding:8px}.qa-label{padding:5px 8px;margin-bottom:6px;background:#fff0c5;color:#543c00;font-size:12px;font-weight:700}</style></head><body><div class="qa-label">真實 UI＋測試資料｜不連正式環境</div><div id="root"></div><script type="module" src="/scripts/fixtures/itinerary-destination-schedule.tsx"></script></body></html>').then(html=>res.end(html)).catch(next);
  });}}]});
  await server.listen();await server.transformRequest('/scripts/fixtures/itinerary-destination-schedule.tsx');const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=spawn(process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let port,socketPath;
  await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'owned Chrome');
  ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Log.entryAdded')evidence.errors.push(m.params.entry.text+' '+(m.params.entry.url||''));else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')evidence.errors.push(JSON.stringify(m.params.args));else if(m.method==='Runtime.exceptionThrown')evidence.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));
  await call('Runtime.enable');await call('Log.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:origin+'/__qa_destination'});
  await until(()=>evaluate("Boolean(document.querySelector('.ship-card'))&&window.__qaState?.().ready"),'original ship card and confirmed fixture feed');
  assert.deepEqual(await route(),['BUSAN','FIRST PORT']);await schedules(first);evidence.cases.push('before first ETD: destination and three times use row one');
  await evaluate("window.__qaTick('2026-09-24T01:00:00Z')");assert.deepEqual(await route(),['BUSAN','FIRST PORT']);await schedules(first);evidence.cases.push('exact ETD equality does not advance destination or times');
  await evaluate("window.__qaTick('2026-09-24T01:00:00.001Z')");await until(async()=>JSON.stringify(await route())===JSON.stringify(['BUSAN','SINGAPORE']),'live destination advance');await schedules(second);
  assert.equal(await evaluate('window.__qaState().revision'),1);assert.equal(await evaluate('window.__qaState().sourceUnchanged'),true);assert.ok(await evaluate('window.__qaState().loads>1'));evidence.cases.push('live clock switches destination and three times together while cloud read is pending, without document edit');
  const metadata=await evaluate("({location:document.querySelector('.ship-position b').textContent,navigation:document.querySelector('.ship-navigation b').textContent,load:document.querySelector('.ship-load b').textContent,cargo:document.querySelector('.ship-cargo-items').textContent})");
  assert.deepEqual(metadata,{location:'FIRST AREA',navigation:'航行',load:'空載',cargo:'FIRST CARGO 500 MT'});evidence.cases.push('first-row previous port, state and cargo remain independent of destination');
  for(const width of [1280,390]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await evaluate('document.fonts.ready');await evaluate("document.querySelector('.ship-card').scrollIntoView({block:'center'})");await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const geometry=await evaluate("(()=>{const n=document.querySelector('.ship-card'),r=n.getBoundingClientRect();return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,client:n.clientWidth,scroll:n.scrollWidth};})()");evidence.geometry.push(geometry);assert.ok(geometry.documentWidth<=width+1&&geometry.left>=0&&geometry.right<=width+1&&geometry.scroll<=geometry.client+1,'existing ship card fits viewport');
    await screen('same-row-'+width);
  }
  evidence.cases.push('desktop/mobile actual ship card preserves layout and complete dates');
  await variant('missing-eta');await schedules({...second,ETA:'TBA'});assert.deepEqual(await route(),['BUSAN','SINGAPORE']);evidence.cases.push('missing selected-row time stays TBA without first-row or legacy fallback');
  await variant('absent');await schedules({ETA:'TBA',ETB:'TBA',ETD:'TBA'});assert.deepEqual(await route(),['BUSAN','TBA']);evidence.cases.push('no second row: destination and all three times stay TBA');
  await variant('blank-port');await schedules(second);assert.deepEqual(await route(),['BUSAN','TBA']);evidence.cases.push('blank second-row port keeps second-row times, never borrows another port');
  await variant('third');await evaluate("window.__qaTick('2026-09-28T00:00:00Z')");await schedules(second);assert.deepEqual(await route(),['BUSAN','SINGAPORE']);evidence.cases.push('does not skip to third row after second-row ETD');
  assert.equal(await evaluate('window.__qaWrites'),0);assert.equal(await evaluate('window.__qaState().sourceUnchanged'),true);assert.deepEqual(evidence.errors,[]);evidence.cases.push('no data mutation, write callback, lease claim or console/runtime error');
}catch(error){failure=error;evidence.failure=error.stack||String(error);evidence.dom=await evaluate('document.body.innerText').catch(()=>null);await screen('failure').catch(()=>{});}
finally{
  if(ws?.readyState===WebSocket.OPEN){await call('Browser.close',{},null).catch(()=>{});ws.close();}
  if(browser)await until(()=>browser.exitCode!==null,'owned browser exit',10000).catch(()=>browser.kill());
  if(server)await server.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  evidence.cleanup={browserExited:!browser||browser.exitCode!==null,serverClosed:!server||!server.httpServer.listening,profileRemoved:!fs.existsSync(profile)};
  fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({output,result:failure?'FAIL':'PASS',cases:evidence.cases,geometry:evidence.geometry,cleanup:evidence.cleanup,failure:failure?.message},null,2));
}
if(failure)process.exitCode=1;

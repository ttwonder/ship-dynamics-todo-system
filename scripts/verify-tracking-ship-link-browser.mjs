// Real TrackingPage + isolated synthetic data; navigation/UI proof, not database acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'vite';

const destination='https://ttwonder.github.io/ship-dynamics-todo-system/packageorwork-tracking';
const baseline=process.argv.includes('--baseline');
const evidenceRoot=process.env.QA_EVIDENCE_ROOT||process.env.TMPDIR;
assert.ok(evidenceRoot,'Set QA_EVIDENCE_ROOT to a repo-external evidence directory');
fs.mkdirSync(evidenceRoot,{recursive:true});
const output=fs.mkdtempSync(path.join(evidenceRoot,baseline?'ship-link-before-':'ship-link-after-'));
const profile=path.join(output,'chrome-profile');
const evidence={label:'真實UI＋測試資料；原組件回呼模擬，非正式環境或資料庫验收',baseline,scenarios:[],geometry:[],errors:[],blocked:[],destinationRequests:[]};
let vite,browser,ws,origin,source,sequence=0,failure;
const pending=new Map(),sessions=new Map();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(test,label,timeout=30000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await test();if(value)return value;await wait(100);}throw new Error('QA timeout: '+label);};
const call=(method,params={},session=source)=>new Promise((resolve,reject)=>{
 const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},15000);
 pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
 ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));
});
const evaluate=async(expression,session=source)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},session);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const clickNode=async(expression)=>{
 const point=await evaluate(`(()=>{const n=${expression};if(!n||n.disabled)throw new Error('missing enabled control');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
};
const button=label=>clickNode(`[...document.querySelectorAll('button')].find(n=>n.innerText.trim()===${JSON.stringify(label)}&&!n.disabled)`);
const fill=async(selector,value)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.focus();n.select();})()`);await call('Input.insertText',{text:value});};
const settled=()=>evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
const screenshot=async(name)=>{await settled();const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'));};
const check=async(name,fn)=>{await fn();evidence.scenarios.push(name);console.log('PASS',name);};
const onEvent=async message=>{
 const {method,params,sessionId}=message;
 if(method==='Target.attachedToTarget'){
  const session=params.sessionId;
  // Pause every new tab before its first request. Only local UI and public static assets are allowed.
  await call('Fetch.enable',{patterns:[{urlPattern:'http*'}]},session);
  await call('Runtime.runIfWaitingForDebugger',{},session);
  await call('Runtime.enable',{},session);
  sessions.set(params.targetInfo.targetId,session);
 }
 if(method==='Fetch.requestPaused'){
  const request=params.request,url=new URL(request.url);
  const local=url.origin===origin,staticAsset=url.href.startsWith('https://ttwonder.github.io/ship-dynamics-todo-system/');
  if(staticAsset)evidence.destinationRequests.push(url.pathname);
  if(staticAsset&&url.pathname.endsWith('/supabase-config.js')){
   await call('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:Buffer.from('/* Isolated navigation QA: no production configuration. */').toString('base64')},sessionId);
  }else if((local||staticAsset)&&request.method==='GET')await call('Fetch.continueRequest',{requestId:params.requestId},sessionId);
  else{evidence.blocked.push({method:request.method,origin:url.origin});await call('Fetch.failRequest',{requestId:params.requestId,errorReason:'BlockedByClient'},sessionId);}
 }
 if(method==='Runtime.exceptionThrown')evidence.errors.push({session:sessionId,message:params.exceptionDetails.exception?.description||params.exceptionDetails.text});
};
try{
 vite=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true,headers:{'Content-Security-Policy':"connect-src 'self' ws://127.0.0.1:*"}},logLevel:'error'});
 await vite.listen();origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
 assert.equal((await fetch(origin+'/scripts/fixtures/tracking-ui.html')).status,200);
 const chrome=process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(fs.existsSync(chrome));
 browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let port,socketPath;
 await until(()=>{try{[port,socketPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socketPath?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'browser handshake');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else void onEvent(m).catch(e=>evidence.errors.push({session:m.sessionId,message:e.message}));});
 await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},null);
 const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);
 source=await until(()=>sessions.get(targetId),'source attachment');
 await call('Page.navigate',{url:origin+'/scripts/fixtures/tracking-ui.html'});
 await until(()=>evaluate("Boolean(window.__trackingQA&&document.querySelector('.tracking-statistics'))"),'real component ready');
 await clickNode("[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith('未送船清單'))");
 await until(()=>evaluate("Boolean(document.querySelector('.tracking-table'))&&!document.body.innerText.includes('讀取此船最新資料')"),'list ready');
 for(const width of [1440,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate('window.scrollTo(0,0)');await settled();
  const g=await evaluate(`(()=>{const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};const tabs=document.querySelector('[role=tablist]'),link=[...document.querySelectorAll('a')].find(n=>n.textContent==='打開船端網頁');return{width:innerWidth,scroll:document.documentElement.scrollWidth,tabs:rect(tabs),last:rect(tabs.lastElementChild),link:rect(link),style:link?{color:getComputedStyle(link).color,background:getComputedStyle(link).backgroundColor}:null,selectedBackground:getComputedStyle(tabs.querySelector('[aria-selected=true]')).backgroundColor};})()`);
  evidence.geometry.push(g);assert.ok(g.scroll<=g.width,'no document overflow');
  if(!baseline){
   assert.ok(g.link&&g.link.width>0&&g.link.x>=0&&g.link.right<=g.width,'entire link visible');
   assert.notEqual(g.style.background,g.selectedBackground,'shortcut has a distinct color');
   assert.ok(Math.abs(g.link.height-g.last.height)<=1,'same compact control height');
   if(width>700){assert.ok(g.link.x>=g.last.right,'link follows completed-engineering tab');assert.ok(Math.abs(g.link.y-g.last.y)<=1,'same desktop row');}
  }
  await screenshot(`tracking-ship-link-${width}`);
 }
 if(!baseline){
  await check('visible-link-exact-destination-new-tab-and-isolation-attributes',async()=>{
   const link=await evaluate("(()=>{const n=[...document.querySelectorAll('a')].find(n=>n.textContent==='打開船端網頁');return{href:n.href,target:n.target,rel:[...n.relList],insideTablist:Boolean(n.closest('[role=tablist]'))};})()");
   assert.equal(link.href,destination);assert.equal(link.target,'_blank');assert.deepEqual(link.rel,['noopener','noreferrer']);assert.equal(link.insideTablist,false);
  });
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await check('native-click-opens-real-entry-and-retains-source-filters-and-kept-draft',async()=>{
   await button('＋ 新增／批量新增');await until(()=>evaluate("Boolean(document.querySelector('[aria-label=\"第 1 筆 申請單號(材料或工程)\"]'))"),'new draft');
   await fill('[aria-label="第 1 筆 申請單號(材料或工程)"]','SHIP-LINK-UNSAVED');
   await button('取消');await button('保留草稿並繼續');
   await until(()=>evaluate("!document.querySelector('[role=dialog]')&&document.body.innerText.includes('恢復本船未送出草稿')"),'kept draft');
   await fill('[aria-label="搜尋跟蹤"]','REF-064');
   await until(()=>evaluate("document.querySelectorAll('.tracking-table tbody tr[data-tracking-id]').length===1"),'filtered row');
   await evaluate("void(window.__sourceTable=document.querySelector('.tracking-table'))");
   const before=await evaluate("({url:location.href,search:document.querySelector('[aria-label=搜尋跟蹤]').value,stored:JSON.stringify(Object.entries(localStorage).sort()),submits:window.__trackingQA.submissions.length})");
   assert.ok(before.stored.includes('SHIP-LINK-UNSAVED'));assert.equal(before.submits,0);
   const oldTargets=new Set((await call('Target.getTargets',{},null)).targetInfos.map(t=>t.targetId));
   await clickNode("document.querySelector('.tracking-ship-link')");
   const opened=await until(async()=> (await call('Target.getTargets',{},null)).targetInfos.find(t=>!oldTargets.has(t.targetId)&&t.url===destination),'actual new tab with exact URL');
   const openedSession=await until(()=>sessions.get(opened.targetId),'new tab isolation');
   await until(async()=>await evaluate("document.title==='船端配件／物料／工程跟蹤'&&Boolean(document.getElementById('root'))",openedSession),'real destination document',45000);
   assert.equal(await evaluate('window.opener===null',openedSession),true);
   const after=await evaluate("({url:location.href,search:document.querySelector('[aria-label=搜尋跟蹤]').value,stored:JSON.stringify(Object.entries(localStorage).sort()),submits:window.__trackingQA.submissions.length})");
   assert.deepEqual(after,before);assert.equal(await evaluate("window.__sourceTable===document.querySelector('.tracking-table')"),true);
   evidence.opened={url:opened.url,title:await evaluate('document.title',openedSession),openerNull:true,sourceUnchanged:true,productionConfigDisabled:true};
   await call('Target.closeTarget',{targetId:opened.targetId},null);
  });
  assert.deepEqual(evidence.errors.filter(e=>e.session===source),[],'no source-page JavaScript errors');
  evidence.scenarios.push('desktop-mobile-compact-placement-color-and-no-overflow');
 }
 console.log(JSON.stringify({result:'PASS',baseline,output,scenarios:evidence.scenarios}));
}catch(error){failure=error;evidence.failure=error.stack;console.error(error.stack);if(ws?.readyState===WebSocket.OPEN){try{evidence.failureTargets=(await call('Target.getTargets',{},null)).targetInfos.map(t=>({id:t.targetId,type:t.type,url:t.url}));if(source)await screenshot('failure');}catch{}}}
finally{
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser){try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned browser exit',10000);}catch{spawnSync('taskkill.exe',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});}}
 if(vite)await vite.close();
 fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 evidence.cleanup={browserStopped:!browser||browser.exitCode!==null||browser.signalCode!==null,serverStopped:!vite?.httpServer?.listening,profileRemoved:!fs.existsSync(profile)};
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(evidence,null,2));
 console.log('EVIDENCE',output);
}
if(failure)process.exitCode=1;

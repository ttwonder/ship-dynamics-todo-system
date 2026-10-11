import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {seedShipExcelFixture} from './ship-itinerary-excel-local-fixture.mjs';
import {installShipInternalControlFixture} from './ship-internal-control-local-fixture.mjs';
import {excelBusinessSnapshot,assertOnlyFormalWrites} from './record-itinerary-excel-local-fixture.mjs';

const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'itinerary-purpose-shore-browser-'));
const profile=path.join(output,'chrome-profile');
const evidence={label:'真實 UI＋測試資料｜本機 SQL，非正式環境',layer:'original-App and original-ship-portal / Chromium / SupabaseJS / private PGlite',cases:[],errors:[],externalRequests:[],requests:[],geometry:[]};
let qa,browser,ws,sessionId,id=0,failure,held,hold=false;
const pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(80);}throw new Error('QA timeout: '+label);};
const call=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method));},15000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const key=async(key,code=key)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,...(key==='Enter'?{windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code});};
const click=async(text,scope='document')=>{await evaluate(`(()=>{const nodes=[...${scope}.querySelectorAll('button')].filter(n=>n.innerText.trim()===${JSON.stringify(text)}&&!n.disabled&&n.getClientRects().length);if(nodes.length!==1)throw new Error('button cardinality '+${JSON.stringify(text)}+': '+nodes.length);nodes[0].focus();})()`);await key('Enter');};
const fill=async(selector,value)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled||n.readOnly)throw new Error('input unavailable '+${JSON.stringify(selector)});n.focus();n.select();})()`);await call('Input.insertText',{text:value});};
const select=async(selector,value)=>{await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)throw new Error('select unavailable');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('change',{bubbles:true}));n.blur();})()`);await wait(30);};
const toggleChoice=async(detailsSelector,value)=>{await evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(detailsSelector)});if(!d)throw new Error('details unavailable');d.open=true;const nodes=[...d.querySelectorAll('label')].filter(n=>n.querySelector('span')?.textContent===${JSON.stringify(value)});if(nodes.length!==1)throw new Error('choice cardinality');nodes[0].querySelector('input').focus();})()`);await key(' ','Space');await wait(30);await evaluate(`document.querySelector(${JSON.stringify(detailsSelector)}).open=false`);};
const text=()=>evaluate("document.body?.innerText||''");
const screen=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
const persist=()=>fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(evidence,null,2));
const check=async(name,run)=>{await run();evidence.cases.push({name,ok:true});persist();console.log('PASS',name);};
const readDoc=async()=> (await qa.db.query("select sd_itinerary_document_for_vessel(workspace_id,$1,vessel_id) doc from sd_itinerary_documents where vessel_id='qa-v1'",[qa.workspace])).rows[0].doc;
const getState=()=>evaluate("(()=>{const f=document.querySelector('fieldset[aria-label=\"目前船舶資料\"]');return{location:f.querySelector('[aria-label=\"目前位置\"]').value,navigationStatus:f.querySelector('[aria-label=\"目前航行狀態\"]').value,loadStatus:f.querySelector('[aria-label=\"目前載況\"]').value,statusList:[...f.querySelectorAll('input[type=checkbox]:checked')].map(n=>n.nextElementSibling.textContent)}})()");
const openCompany=async()=>{await click('手動修改',"document.querySelector('[data-itinerary-vessel-id=\"qa-v1\"]')");await until(()=>evaluate("!!document.querySelector('.itinerary-editor-modal')"),'original shore modal');};
const changeCompany=async()=>{await fill('.itinerary-editor-modal [aria-label="目前位置"]','QA SHORE Taiwan Strait');await select('.itinerary-editor-modal [aria-label="目前航行狀態"]','停泊');await select('.itinerary-editor-modal [aria-label="目前載況"]','滿載');for(const v of ['drydock/repair','bunker'])await toggleChoice('.itinerary-editor-modal [data-current-vessel-status]',v);await toggleChoice('.itinerary-editor-table tbody tr:first-child .itinerary-purpose-select','bunker');};
const companyState={location:'QA SHORE Taiwan Strait',navigationStatus:'停泊',loadStatus:'滿載',statusList:['drydock/repair','bunker']};
const storedCompany={...companyState,statusList:['drydock/repiar','bunker']};
const geometry=async(width,height)=>{
 if(await evaluate("!!document.querySelector('button[aria-label=\"關閉保存提醒\"]')")){await evaluate("document.querySelector('button[aria-label=\"關閉保存提醒\"]').click()");await until(()=>evaluate("!document.querySelector('.save-toast')"),'toast explicitly dismissed');}
 await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
 const g=await evaluate("(()=>{const m=document.querySelector('.itinerary-editor-modal'),f=m.querySelector('fieldset'),t=m.querySelector('.itinerary-editor-table-wrap'),footer=m.querySelector('.itinerary-editor-foot');const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return{width:innerWidth,styles:{display:getComputedStyle(m).display,width:getComputedStyle(m).width,minWidth:getComputedStyle(m).minWidth,maxWidth:getComputedStyle(m).maxWidth,boxSizing:getComputedStyle(m).boxSizing,backdropWidth:getComputedStyle(m.parentElement).width,backdropPadding:getComputedStyle(m.parentElement).padding},matchingRules:[...document.styleSheets].flatMap(s=>{try{return[...s.cssRules].flatMap(r=>r.cssRules?[...r.cssRules]:[r]).filter(r=>r.selectorText&&m.matches(r.selectorText)&&/max-width|min-width|width:/.test(r.cssText)).map(r=>r.cssText)}catch{return[]}}),modal:box(m),fields:box(f),table:box(t),footer:box(footer),controls:[...f.querySelectorAll('input:not([type=checkbox]),select,summary')].map(box),documentOverflow:document.documentElement.scrollWidth>innerWidth}})()");
 evidence.geometry.push(g);await screen('company-'+width);
 assert.ok(g.modal.x>=0&&g.modal.right<=width+1,JSON.stringify(g));assert.ok(g.fields.bottom<=g.table.y+1&&g.table.bottom<=g.footer.y+1);assert.ok(g.table.height>100);assert.ok(g.controls.every(r=>r.width>0&&r.x>=g.fields.x&&r.right<=g.fields.right+1));assert.equal(g.documentOverflow,false);
};
const newPage=async url=>{const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true},null));await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['https://*','http://*.supabase.co/*','http://*.supabase.in/*']});await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url});};
try{
 qa=await createRecordStorageLocalQa({shipExcel:true,browserAuthority:true,scopedRead:true,tracking:true,shipInternalControl:true,shipInternalControlDownload:true,hmr:false});await seedShipExcelFixture(qa);
 // Current original-App boot prerequisites; all execute privately, no gate bypass.
 await installShipInternalControlFixture(qa.db,qa.workspace);
 await qa.db.exec(fs.readFileSync('supabase/migrations/20261006090000_ship_internal_control_download.sql','utf8'));
 await qa.db.exec(fs.readFileSync('supabase/migrations/20260924160000_tracking_records.sql','utf8'));
 for(const file of ['20260916090000_itinerary_current_vessel_state.sql','20260917090000_itinerary_bunker_status.sql','20261011090000_itinerary_purpose_bunker_shore_state.sql'])await qa.db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 evidence.prerequisites=['scripts/ship-internal-control-local-fixture.mjs#installShipInternalControlFixture','supabase/migrations/20261006090000_ship_internal_control_download.sql','supabase/migrations/20260924160000_tracking_records.sql'];
 const initial=await readDoc(),appBefore=await qa.read(),baseline=await excelBusinessSnapshot(qa);
 browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let port,socket;await until(()=>{try{[port,socket]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);return /^\d+$/.test(port)&&socket?.startsWith('/devtools/browser/');}catch(e){if(['ENOENT','EBUSY','EPERM'].includes(e.code))return false;throw e;}},'owned Chrome handshake');
 ws=new WebSocket(`ws://127.0.0.1:${port}${socket}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{
  const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return;}
  const p=m.params;
  if(m.method==='Runtime.exceptionThrown')evidence.errors.push(p.exceptionDetails.exception?.description||p.exceptionDetails.text);
  if(m.method==='Network.requestWillBeSent'){
   const url=p.request.url;if(/^https?:/.test(url)&&!url.startsWith(qa.origin+'/'))evidence.externalRequests.push(new URL(url).origin);
   if(url.startsWith(qa.origin+'/rest/v1/rpc/')&&p.request.postData){const b=JSON.parse(p.request.postData);evidence.requests.push({rpc:url.split('/').at(-1),vesselId:b.p_vessel_id,operationId:b.p_operation_id,expectedRevision:b.p_expected_revision,rows:b.p_rows,alternativePlans:b.p_alternative_plans});}
  }
  if(m.method==='Page.javascriptDialogOpening'){
   const expected=p.type==='beforeunload'||p.type==='confirm'&&(/同步最新會保留本機修改|請盡量以船端修改為主|取消將放棄這次|請確認以下項目/.test(p.message));if(!expected)evidence.errors.push('Unexpected dialog '+p.message);
   void call('Page.handleJavaScriptDialog',{accept:expected},m.sessionId).catch(e=>evidence.errors.push(e.message));
  }
  if(m.method==='Fetch.requestPaused'){if(hold&&p.responseStatusCode===200&&!held){held={requestId:p.requestId,session:m.sessionId};}else void call('Fetch.continueRequest',{requestId:p.requestId},m.sessionId).catch(e=>evidence.errors.push(e.message));}
 });
 await newPage(qa.origin+'/');const companySession=sessionId;
 await until(async()=>(await text()).includes('請輸入管理者設定的進站密碼。'),'real original site gate');
 // These are generated credentials for this private synthetic QA only, never production credentials.
 await fill('input[type=password]',qa.password);await click('進入系統');await until(async()=>(await text()).includes('人員登入／切換'),'real original login');await fill('input[type=password]',qa.password);await click('登入');await until(async()=>(await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'original Owner ready');
 await click('同步最新（安全合併）');await until(async()=>!(await text()).includes('身份、權限或船舶範圍已變更，請同步最新資料'),'fresh authority');if(await evaluate("!!document.querySelector('button[aria-label=\"關閉保存提醒\"]')"))await evaluate("document.querySelector('button[aria-label=\"關閉保存提醒\"]').click()");await click('切換顯示Itinerary信息');await until(()=>evaluate("document.querySelectorAll('.itinerary-panel').length===3"),'original Itinerary list');
 await openCompany();await changeCompany();
 await check('company four fields, multiselect bunker and exact quantity label',async()=>{assert.deepEqual(await getState(),companyState);assert.equal(await evaluate("document.querySelector('.itinerary-editor-table th:nth-child(6)').innerText.replace(/\\n/g,'')"),'B/F or I/F Qty(Cargo Name + MT/BBLS/M3)');assert.equal(await evaluate("document.querySelectorAll('.itinerary-editor-table tr:first-child .itinerary-purpose-menu input').length"),7);});
 await check('company compact modal desktop and phone geometry',async()=>{await geometry(1440,1000);await geometry(390,844);await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});});
 await check('cancel discards only local draft and performs no business save',async()=>{await click('取消編輯');await until(()=>evaluate("!document.querySelector('.itinerary-editor-modal')"),'cancel closes');assert.deepEqual(await readDoc(),initial);assert.equal(qa.metrics.filter(m=>m.rpc==='sd_itinerary_record_save_v1').length,0);await openCompany();assert.deepEqual(await getState(),{location:'',navigationStatus:'',loadStatus:'',statusList:[]});await changeCompany();});
 await call('Fetch.enable',{patterns:[{urlPattern:'*/rest/v1/rpc/sd_itinerary_record_save_v1',requestStage:'Response'}]});hold=true;await click('保存並同步');await until(()=>Boolean(held),'hold real SQL committed response');
 await check('company save waits for ACK; exact SQL state, revision and history committed once',async()=>{
  const doc=await readDoc();assert.equal(doc.revision,8);assert.deepEqual(doc.rows[0].currentVesselState,storedCompany);assert.equal(doc.rows[0].operation,'To Load / To Unload / bunker');assert.deepEqual(doc.alternativePlans,initial.alternativePlans);
  assert.equal(await evaluate("document.querySelector('.itinerary-editor-head .btn.primary').innerText"),'保存中…');assert.equal(await evaluate("document.querySelector('.itinerary-editor-modal fieldset').disabled"),true);await screen('company-held-ack');
  const saves=qa.metrics.filter(m=>m.rpc==='sd_itinerary_record_save_v1'&&m.status==='SQL_OK');assert.equal(saves.length,1);assert.equal((await qa.db.query('select count(*)::int n from sd_itinerary_history where operation_id=$1::uuid',[saves[0].operationId])).rows[0].n,1);
  hold=false;await call('Fetch.continueRequest',{requestId:held.requestId},held.session);held=null;await until(()=>evaluate("!document.querySelector('.itinerary-editor-modal')"),'matching ACK closes original editor');assert.ok(await evaluate("document.querySelector('[data-itinerary-vessel-id=\"qa-v1\"]').innerText.includes('QA SHORE Taiwan Strait')"));
 });
 await newPage(qa.origin+'/ship-itinerary.html');
 await until(()=>evaluate("document.querySelectorAll('#ship-vessel-select option').length===4"),'original public ship list');await select('#ship-vessel-select','qa-v1');await until(()=>evaluate("document.querySelector('.ship-latest-card')?.innerText.includes('QA SHORE Taiwan Strait')"),'fresh ship sees company-saved state');
 await check('fresh anonymous ship reads company changes in same formal document',async()=>{assert.equal(await evaluate("document.querySelectorAll('input[type=password]').length"),0);const t=await text();for(const v of ['QA SHORE Taiwan Strait','停泊','滿載','drydock/repair','bunker'])assert.ok(t.includes(v));assert.ok(qa.metrics.some(m=>m.rpc==='sd_itinerary_public_load'&&m.status==='SQL_OK'));await screen('ship-company-state-readback');});
 await click('從最新狀態修改');await until(()=>evaluate("!!document.querySelector('.ship-editor')"),'original ship editor');
 await check('ship editor retains four company fields and bunker Purpose; alternatives do not own state',async()=>{assert.deepEqual(await getState(),companyState);assert.equal(await evaluate("document.querySelectorAll('.ship-alternative-plans fieldset[aria-label=\"目前船舶資料\"]').length"),0);assert.ok(await evaluate("[...document.querySelectorAll('.ship-editor .ship-editor-main-table th')].some(n=>n.innerText.replace(/\\n/g,'')==='B/F or I/F Qty(Cargo Name + MT/BBLS/M3)')"));});
 await fill('.ship-editor [aria-label="目前位置"]','QA SHIP Pacific Ocean');await select('.ship-editor [aria-label="目前航行狀態"]','航行');await select('.ship-editor [aria-label="目前載況"]','非空載');await toggleChoice('.ship-editor [data-current-vessel-status]','drydock/repair');
 await toggleChoice('.ship-alternative-plan .itinerary-purpose-select','bunker');await click('保存並同步');await until(()=>evaluate("!document.querySelector('.ship-editor')&&document.querySelector('.ship-notice')?.innerText.includes('已保存並同步')"),'original ship save ACK');
 await check('ship saves remain valid; bunker alternative separated from formal state',async()=>{const doc=await readDoc();assert.equal(doc.revision,9);assert.deepEqual(doc.rows[0].currentVesselState,{location:'QA SHIP Pacific Ocean',navigationStatus:'航行',loadStatus:'非空載',statusList:['bunker']});assert.equal(doc.rows[0].operation,'To Load / To Unload / bunker');assert.equal(doc.alternativePlans[0].rows[0].operation,'bunker');assert.equal(Object.hasOwn(doc.alternativePlans[0].rows[0],'currentVesselState'),false);await screen('ship-saved-state');});
 sessionId=companySession;await call('Page.reload');await until(async()=>(await text()).includes('QA OWNER'),'new company document ready');if(!await evaluate("!!document.querySelector('.itinerary-dashboard')"))await click('切換顯示Itinerary信息');await until(()=>evaluate("document.querySelector('[data-itinerary-vessel-id=\"qa-v1\"]')?.innerText.includes('QA SHIP Pacific Ocean')"),'fresh company authoritative readback');
 await check('new company page reads ship update; no AppData dual write or unrelated vessel edits',async()=>{await openCompany();assert.deepEqual(await getState(),{location:'QA SHIP Pacific Ocean',navigationStatus:'航行',loadStatus:'非空載',statusList:['bunker']});await click('取消編輯');assert.deepEqual(await qa.read(),appBefore);assertOnlyFormalWrites(baseline,await excelBusinessSnapshot(qa),['qa-v1']);assert.deepEqual(evidence.externalRequests,[]);assert.deepEqual(evidence.errors,[]);assert.ok(!qa.metrics.some(m=>['UNSUPPORTED','SQL_ERROR'].includes(m.status)));});
 evidence.ok=true;console.log(JSON.stringify({qa:'ITINERARY_PURPOSE_SHORE_BROWSER_PASS',output,caseCount:evidence.cases.length}));
}catch(error){failure=error;evidence.error=error.stack;evidence.ok=false;try{evidence.failureText=(await text()).slice(0,9000);await screen('failure');}catch{}console.error(JSON.stringify({qa:'FAILED',output,error:error.message,body:evidence.failureText}));}
finally{
 if(held)try{await call('Fetch.continueRequest',{requestId:held.requestId},held.session);}catch{}
 evidence.metrics=qa?.metrics||[];
 if(ws?.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch{}ws.close();}
 if(browser)try{await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned Chrome exit',5000);}catch{spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});}
 try{if(qa)await qa.close();if(qa)await assert.rejects(()=>fetch(qa.origin+'/__qa/health'));assert.ok(!browser||browser.exitCode!==null||browser.signalCode!==null);evidence.cleanup={httpStopped:true,chromeStopped:true,origin:qa?.origin,chromePid:browser?.pid};}catch(error){failure??=error;evidence.cleanup={error:error.message};}
 persist();if(failure)process.exitCode=1;
}

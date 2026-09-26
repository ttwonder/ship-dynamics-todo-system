import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import ts from 'typescript';

const evidenceRoot = process.env.QA_EVIDENCE_ROOT || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'hermes', 'cache', 'scratch');
fs.mkdirSync(evidenceRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(evidenceRoot, 'list-widths-'));
const profile = path.join(output, 'chrome-profile');
const evidence = { layer: '真實 ListPanel UI＋測試資料；非正式環境／非資料庫驗證', cases: [], errors: [], geometry: [] };
evidence.inputs = Object.fromEntries(['src/App.tsx','src/useTaskListColumns.tsx','src/taskListColumns.css','src/VesselListFilter.tsx','src/vesselDisplay.ts','src/listVesselControls.ts','src/styles.css','scripts/fixtures/page-statistics.ts','scripts/fixtures/data-analysis.ts','scripts/verify-list-column-widths-browser.mjs'].map(file => [file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
let server, browser, ws, sessionId, id = 0, failure;
const pending = new Map(), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await test()) return; await wait(80); } throw new Error('Timeout: ' + label); }
function call(method, params = {}, session = sessionId) { return new Promise((resolve, reject) => { const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(new Error('CDP timeout: ' + method)); }, 10000); pending.set(n, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } }); ws.send(JSON.stringify({ id: n, method, params, ...(session ? { sessionId: session } : {}) })); }); }
async function evaluate(expression) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
const screen = async name => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
const click = text => evaluate(`(() => { const n=[...document.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.textContent.trim())===${JSON.stringify(text)}&&n.getClientRects().length&&!n.disabled); if(!n) throw new Error('Missing button '+${JSON.stringify(text)}); n.click(); })()`);
const change = (selector, value) => evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n)throw new Error('Missing input '+${JSON.stringify(selector)}); const proto=n instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(n,${JSON.stringify(value)}); n.dispatchEvent(new Event(n instanceof HTMLSelectElement?'change':'input',{bubbles:true})); })()`);
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ListPanel}from'/src/App.tsx';import{createPageStatisticsFixture}from'/scripts/fixtures/page-statistics.ts';import'/src/styles.css';
const{data,vessels}=createPageStatisticsFixture();
for(const v of vessels){v.shipType='靈便型散';v.fleetCategory='tanker fleet';}
for(const t of data.tasks){t.departments=['航運處','督導','船員組','航運組','海技組'];t.ownerUserIds=data.users.map(u=>u.id);t.description+=' 船舶停靠港口多日，預計後續仍繼續拋錨，計畫添加淡水補給作業';t.status='待處理，保持追蹤補給進度';}
window.__qaData=data;window.__qaBefore=JSON.stringify(data);window.__qaCalls=[];
const filters0={keyword:'',departments:[],vesselIds:[],fleetTags:[],priorities:[],categories:[],meetingCategories:[],ownerMode:'all',fromDate:'',toDate:'',closedMode:'open',overdueOnly:false,internalControlOnly:false};
function QA(){const[mode,setMode]=useState('total'),[actor,setActor]=useState('qa-a'),[filters,setFilters]=useState(filters0),[refresh,setRefresh]=useState(0);
window.__qaSetMode=setMode;window.__qaSetActor=setActor;window.__qaRefresh=()=>setRefresh(v=>v+1);
const tasks=data.tasks.filter(t=>vessels.some(v=>t.vesselIds.includes(v.id))&&t.isClosed===(mode==='closed'));
return <main className="container"><div className="qa-label">真實 UI＋測試資料｜不連正式環境｜操作員 {actor}</div><ListPanel title={mode==='closed'?'已結案清單':'總清單'} tasks={tasks} data={data} visibleVessels={vessels} filters={{...filters,closedMode:mode==='closed'?'closed':'open'}} setFilters={setFilters} fleetTags={['tanker fleet']} userMap={Object.fromEntries(data.users.map(u=>[u.id,u]))} exportedBy="測試操作員" columnPreferenceKey={JSON.stringify(['qa-workspace',actor,mode])} batchContext={{identity:actor+mode,isCurrent:()=>true}} onEdit={t=>window.__qaCalls.push(['edit',t.id])} onPrint={()=>window.__qaCalls.push(['print'])} onBatchComplete={ids=>{window.__qaCalls.push(['complete',ids]);return false;}} onBatchDelete={ids=>{window.__qaCalls.push(['delete',ids]);return false;}} canEdit canPrint canComplete canDelete={false}/></main>}
createRoot(document.getElementById('root')).render(<React.StrictMode><QA/></React.StrictMode>);`;
const settle=()=>evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
const geometry=()=>evaluate(`(()=>{const table=document.querySelector('.batch-task-table'),wrap=table.parentElement,ths=[...table.querySelectorAll('thead th')];return{viewport:innerWidth,zoom:visualViewport.scale,document:document.documentElement.scrollWidth,client:wrap.clientWidth,scroll:wrap.scrollWidth,width:table.getBoundingClientRect().width,columns:ths.map((n,i)=>({label:n.innerText,width:n.getBoundingClientRect().width,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,font:getComputedStyle(n).fontSize,bodyFont:getComputedStyle(table.tBodies[0].rows[0].cells[i]).fontSize})),dates:[...table.querySelectorAll('td.task-list-date-column')].map(n=>({text:n.innerText,client:n.clientWidth,scroll:n.scrollWidth,whiteSpace:getComputedStyle(n).whiteSpace}))};})()`);
try {
  server = await createServer({ root: process.cwd(), base: '/', server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{ name: 'isolated-analytics-qa', configureServer(vite) { vite.middlewares.use((req, res, next) => { res.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:*"); if (req.url === '/__qa_widths') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); void vite.transformIndexHtml('/__qa_widths', '<!doctype html><html><head><meta charset="UTF-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{padding:8px}.qa-label{padding:5px 8px;margin-bottom:6px;background:#fff0c5;color:#543c00;font-size:12px;font-weight:700}</style></head><body><div class="qa-label">真實 UI＋測試資料｜不連正式環境</div><div id="root"></div><script type="module" src="/@qa-widths"></script></body></html>').then(html => res.end(html)).catch(next); } else next(); }); }, resolveId(source) { if (source === '/@qa-widths') return '\0qa-widths'; }, async load(source) { if (source === '\0qa-widths') return ts.transpileModule(entry,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText; } }] });
  await server.listen(); await server.transformRequest('/@qa-widths'); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = spawn(process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let port, socketPath;
  await until(() => { try { [port, socketPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); return /^\d+$/.test(port) && socketPath?.startsWith('/devtools/browser/'); } catch (e) { if (['ENOENT', 'EBUSY', 'EPERM'].includes(e.code)) return false; throw e; } }, 'owned Chrome');
  ws = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`); await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else if (m.method === 'Log.entryAdded') evidence.errors.push(m.params.entry.text+' '+(m.params.entry.url||'')); else if (m.method === 'Runtime.consoleAPICalled' && m.params.type==='error') evidence.errors.push(JSON.stringify(m.params.args)); else if (m.method === 'Runtime.exceptionThrown') evidence.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null); ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, null)); await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await call('Page.navigate', { url: origin + '/__qa_widths' });
  await until(() => evaluate("Boolean(document.querySelector('.selected-task-list-panel'))"), 'original list mounted');
  await evaluate('document.fonts.ready'); await settle();

  for(const mode of ['total','closed']){
    await evaluate(`window.__qaSetMode('${mode}')`);await settle();
    for(const width of [1366,1440,1920]){await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await settle();evidence.geometry.push({mode,...await geometry(),badgeOverflow:await evaluate("[...document.querySelectorAll('.batch-task-table td .internal-control-tag,.batch-task-table td .task-source-badge')].filter(n=>n.getBoundingClientRect().right>n.closest('td').getBoundingClientRect().right-2).map(n=>n.textContent)")});await evaluate("document.querySelector('.selected-task-list-panel').scrollIntoView({block:'start'})");await screen(mode+'-'+width);}
  }
  const badgeOverflow=await evaluate("[...document.querySelectorAll('.batch-task-table td .internal-control-tag,.batch-task-table td .task-source-badge')].filter(n=>n.getBoundingClientRect().right>n.closest('td').getBoundingClientRect().right-2).map(n=>n.textContent)");assert.deepEqual(badgeOverflow,[],'badges must stay in their columns');
  assert.equal(await evaluate("document.querySelectorAll('.batch-task-table [role=separator]').length"),11,'兩清單每個資料欄與操作欄均須能拖曳調寬，不包含勾選欄');
  for(const g of evidence.geometry){assert.ok(g.scroll<=g.client+1,`100% ${g.viewport}px ${g.mode}須完整顯示操作欄 (${g.scroll}/${g.client})`);assert.deepEqual(g.badgeOverflow,[],`${g.mode} ${g.viewport} badges stay in their columns`);}
  evidence.cases.push('two list default widths fit 1366/1440/1920 at 100%');
  const handle=label=>`document.querySelector('[role=separator][aria-label="調整${label}欄寬"]')`;
  const colWidth=label=>evaluate(`(${handle(label)}).parentElement.getBoundingClientRect().width`);
  const key=mode=> 'ship-task-list-widths-v1:'+JSON.stringify(['qa-workspace','qa-a',mode]);
  const point=async expression=>evaluate(`(()=>{const n=${expression};n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const mouse=async(type,p)=>call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1,...p});
  const drag=async(label,dx,{release=true}={})=>{const p=await point(handle(label));await mouse('mousePressed',p);await mouse('mouseMoved',{x:p.x+dx,y:p.y});await settle();if(release){await mouse('mouseReleased',{x:p.x+dx,y:p.y});await settle();}return p;};
  const mode=async value=>{await evaluate(`window.__qaSetMode('${value}')`);await settle();};
  const actor=async value=>{await evaluate(`window.__qaSetActor('${value}')`);await settle();};
  const approx=(a,b,label)=>assert.ok(Math.abs(a-b)<1.2,`${label}: ${a} / ${b}`);
  const sort=()=>evaluate("[...document.querySelectorAll('.batch-task-table thead th[aria-sort]')].map(n=>n.getAttribute('aria-sort'))");
  const rows=()=>evaluate("[...document.querySelectorAll('.batch-task-table tbody input')].map(n=>n.getAttribute('aria-label'))");
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  for(const m of ['total','closed']){
    await mode(m);await click('重設欄寬');await settle();
    assert.equal(await evaluate("[...document.querySelectorAll('.batch-task-table tbody td:last-child button')].every(n=>{const r=document.createRange();r.selectNodeContents(n);return r.getClientRects().length===1})"),true,'原更新按鈕的文字必須保持單行');
    await evaluate("document.querySelector('.batch-task-table tbody input').click()");await settle();
    const printBefore=await evaluate("document.querySelector('.selected-task-print table')?.outerHTML"),selectedBefore=await evaluate("document.querySelector('.batch-selection-count').textContent"),beforeRows=await rows(),beforeSort=await sort(),before=(await geometry()).columns.map(c=>c.width);
    const start=await colWidth('船種');await drag('船種',55);approx(await colWidth('船種'),start+55,m+' actual pointer resize');
    const after=(await geometry()).columns.map(c=>c.width);for(let i=1;i<after.length;i++)if(i!==2)approx(after[i],before[i],m+' other column '+i+' unchanged during drag');
    assert.deepEqual(await rows(),beforeRows);assert.deepEqual(await sort(),beforeSort);
    assert.equal(await evaluate("document.querySelector('.batch-selection-count').textContent"),selectedBefore);
    assert.ok(await evaluate(`localStorage.getItem(${JSON.stringify(key(m))})`),'persist on pointer release');
    await evaluate('window.__qaRefresh()');await settle();approx(await colWidth('船種'),start+55,'ordinary data refresh retains widths');
    await click('清除篩選');await settle();approx(await colWidth('船種'),start+55,'clear filters does not reset widths');
    assert.equal(await evaluate("document.querySelector('.selected-task-print table')?.outerHTML"),printBefore,'resizing does not alter selected-list print markup');
    const button=await point("document.querySelector('.batch-task-table thead .table-sort-button')");await mouse('mousePressed',button);await mouse('mouseReleased',button);await settle();
    assert.equal((await sort())[0],'ascending');
    await click('導出 PDF（1）');assert.deepEqual((await evaluate('window.__qaCalls')).at(-1),['print']);
    const editPoint=await point("document.querySelector('.batch-task-table tbody td:last-child button')");await mouse('mousePressed',editPoint);await mouse('mouseReleased',editPoint);assert.equal((await evaluate('window.__qaCalls')).at(-1)[0],'edit');
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(n=>n.textContent.includes('批量刪除')).disabled"),true,'operator delete remains forbidden');
    await click('重設欄寬');await settle();assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(key(m))})`),null);assert.equal(await evaluate("document.querySelector('.batch-selection-count').textContent"),selectedBefore);
    evidence.cases.push(m+' pointer drag, no accidental sorting/selection loss, refresh, reset, edit/PDF callbacks and unchanged print markup');
  }
  await mode('total');await click('重設欄寬');await settle();
  const totalDefault=await colWidth('船種');await drag('船種',75);const totalSaved=await colWidth('船種');
  await mode('closed');await click('重設欄寬');await settle();const closedDefault=await colWidth('船種');await drag('船種',35);const closedSaved=await colWidth('船種');
  await mode('total');approx(await colWidth('船種'),totalSaved,'list-specific preferences');
  await actor('qa-b');approx(await colWidth('船種'),totalDefault,'another operator starts at default');await drag('船種',15);await actor('qa-a');approx(await colWidth('船種'),totalSaved,'first operator retained');
  // A context switch during a held pointer must abandon the uncommitted gesture, even A→B→A.
  const persistedBeforeGesture=await evaluate(`localStorage.getItem(${JSON.stringify(key('total'))})`);
  const p=await drag('船舶',40,{release:false});await actor('qa-b');await actor('qa-a');await mouse('mouseReleased',{x:p.x+40,y:p.y});await settle();
  assert.equal(await evaluate(`JSON.stringify([...document.querySelectorAll('.batch-task-table thead th')].slice(1).map(n=>Math.round(n.getBoundingClientRect().width)))`),await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem(${JSON.stringify(key('total'))})).map(Math.round))`),'stale held drag must not alter restored preferences');
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(key('total'))})`),persistedBeforeGesture,'abandoned gesture must not overwrite the original saved layout');
  await call('Page.reload');await until(()=>evaluate("Boolean(document.querySelector('.batch-task-table'))"),'reload mounted');await settle();approx(await colWidth('船種'),totalSaved,'durable widths after fresh document reload');await mode('closed');approx(await colWidth('船種'),closedSaved,'closed independently durable');
  evidence.cases.push('identity/list isolation, context switch during drag, fresh-document persistence');
  // Native keyboard controls for every column, including the trailing actions column.
  for(const label of ['船舶','船種','關注維度／等級','來源','分類/事項','部門','追蹤窗口','發佈日期','期限','狀態','操作']){
    const w=await colWidth(label);await evaluate(`(${handle(label)}).focus()`);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await settle();approx(await colWidth(label),w+10,'keyboard '+label);
  }
  await drag('發佈日期',-350);await drag('期限',-350);const dates=(await geometry()).dates;assert.ok(dates.every(d=>d.whiteSpace==='nowrap'&&d.scroll<=d.client+1),'date minimum widths never wrap/clip date');
  const cancelStart=await colWidth('船種');await drag('船種',40,{release:false});await evaluate(`(${handle('船種')}).dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))`);await mouse('mouseReleased',{x:10,y:10});await settle();approx(await colWidth('船種'),cancelStart,'cancel gesture restores widths');
  evidence.cases.push('11 keyboard resizers, date minimum and cancelled pointer');
  await evaluate("window.__qaSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('QA quota','QuotaExceededError')}");const blockedStart=await colWidth('船種');await drag('船種',20);approx(await colWidth('船種'),blockedStart+20,'storage failure retains current usable width');await evaluate('Storage.prototype.setItem=window.__qaSetItem');
  await click('重設欄寬');await settle();await evaluate(`localStorage.setItem(${JSON.stringify(key('closed'))},'{broken')`);await mode('total');await mode('closed');approx(await colWidth('船種'),closedDefault,'malformed stored widths fall back');
  evidence.cases.push('storage quota and malformed local preference recovery');
  for(const m of ['total','closed']){
    await mode(m);await click('重設欄寬');await call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await settle();await evaluate("document.querySelector('.selected-task-list-panel').scrollIntoView({block:'start'})");
    let g=await geometry();assert.ok(g.document<=390,'mobile no page-wide horizontal overflow');assert.ok(g.scroll>g.client,'mobile local horizontal scroll retained');
    await evaluate("document.querySelector('.table-scroll-top').scrollLeft=400");await settle();assert.equal(await evaluate("document.querySelector('.table-scroll-top').scrollLeft===document.querySelector('.batch-task-table').parentElement.scrollLeft"),true);
    await evaluate("document.querySelector('.batch-task-table').parentElement.scrollLeft=9999");await settle();assert.equal(await evaluate("document.querySelector('.table-scroll-top').scrollLeft===document.querySelector('.batch-task-table').parentElement.scrollLeft"),true);await screen(m+'-390-actions');
    const a=await evaluate("(()=>{const n=document.querySelector('.batch-task-table tbody td:last-child button'),r=n.getBoundingClientRect();return{left:r.left,right:r.right}})()");assert.ok(a.left>=0&&a.right<=390,'mobile actions reachable');
  }
  evidence.cases.push('both mobile lists, local top/bottom synchronized scroll, actions reachable');
  assert.equal(await evaluate('JSON.stringify(window.__qaData)===window.__qaBefore'),true);assert.deepEqual(evidence.errors,[]);
  evidence.cases.push('no business-data mutations or browser errors');
} catch (error) { failure = error; evidence.failure = error.stack || String(error); evidence.dom = await evaluate('document.body.innerText').catch(()=>null); await screen('failure').catch(()=>{}); }
finally {
  if (ws?.readyState === WebSocket.OPEN) { await call('Browser.close', {}, null).catch(() => {}); ws.close(); }
  if (browser) await until(() => browser.exitCode !== null, 'owned browser exit', 10000).catch(() => browser.kill());
  if (server) await server.close(); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  evidence.cleanup = { browserExited: !browser || browser.exitCode !== null, serverClosed: !server || !server.httpServer.listening, profileRemoved: !fs.existsSync(profile) }; fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ output, result: failure ? 'FAIL' : 'PASS', cases: evidence.cases, geometry: evidence.geometry.map(g=>({mode:g.mode,viewport:g.viewport,client:g.client,scroll:g.scroll,columns:g.columns.map(c=>Math.round(c.width))})), cleanup: evidence.cleanup, failure: failure?.message }, null, 2));
}
if (failure) process.exitCode = 1;

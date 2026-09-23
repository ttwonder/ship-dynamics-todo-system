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
const output = fs.mkdtempSync(path.join(evidenceRoot, 'page-statistics-'));
const profile = path.join(output, 'chrome-profile');
const evidence = { layer: '真實 ListPanel／TemporaryMeetingsPage UI＋測試資料；非正式環境／非資料庫驗證', cases: [], errors: [], geometry: [] };
evidence.inputs = Object.fromEntries(['src/App.tsx','src/VesselListFilter.tsx','src/vesselDisplay.ts','src/listVesselControls.ts','src/styles.css','scripts/fixtures/page-statistics.ts','scripts/fixtures/data-analysis.ts','scripts/verify-page-statistics-browser.mjs'].map(file => [file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
let server, browser, ws, sessionId, id = 0, failure;
const pending = new Map(), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await test()) return; await wait(80); } throw new Error('Timeout: ' + label); }
function call(method, params = {}, session = sessionId) { return new Promise((resolve, reject) => { const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(new Error('CDP timeout: ' + method)); }, 10000); pending.set(n, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } }); ws.send(JSON.stringify({ id: n, method, params, ...(session ? { sessionId: session } : {}) })); }); }
async function evaluate(expression) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
const screen = async name => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
const click = text => evaluate(`(() => { const n=[...document.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.textContent.trim())===${JSON.stringify(text)}&&n.getClientRects().length&&!n.disabled); if(!n) throw new Error('Missing button '+${JSON.stringify(text)}); n.click(); })()`);
const change = (selector, value) => evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n)throw new Error('Missing input '+${JSON.stringify(selector)}); const proto=n instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(n,${JSON.stringify(value)}); n.dispatchEvent(new Event(n instanceof HTMLSelectElement?'change':'input',{bubbles:true})); })()`);
const entry = 'import React,{useState} from \'react\';import{createRoot}from\'react-dom/client\';import {ListPanel,taskMatchesFilters} from \'/src/App.tsx\';import TemporaryMeetingsPage from \'/src/TemporaryMeetings.tsx\';import{createPageStatisticsFixture}from\'/scripts/fixtures/page-statistics.ts\';import {taskIsClosedForScope}from\'/src/taskVesselProgress.ts\';import\'/src/styles.css\';\nconst {data,vessels}=createPageStatisticsFixture();Object.assign(vessels[0],{name:\'測試甲輪\',shortName:\'QA1\'});Object.assign(vessels[1],{name:\'QA2\',shortName:\'QA2\'});const noWrite=()=>{throw new Error(\'Statistics must not write or claim a lease\')};window.__qaData=data;window.__qaBefore=JSON.stringify(data);const initialFilters={keyword:\'\',departments:[],vesselIds:[],fleetTags:[],priorities:[],categories:[],meetingCategories:[],ownerMode:\'all\',fromDate:\'\',toDate:\'\',closedMode:\'open\',overdueOnly:false,internalControlOnly:false};\nfunction QA(){const[mode,setMode]=useState(\'total\');const[filters,setFilters]=useState(initialFilters);const tasks=data.tasks.filter(t=>t.vesselIds.some(id=>vessels.some(v=>v.id===id)));const user={...data.users[0],role:\'owner\'};const map=Object.fromEntries(data.vessels.map(v=>[v.id,v]));const filter={...filters,closedMode:mode===\'closed\'?\'closed\':\'open\'};const current=tasks.filter(t=>taskMatchesFilters(t,filter,map,user,true,true));const all=tasks.filter(t=>taskMatchesFilters(t,filter,map,user,false,true));window.__qaSetMode=setMode;window.__qaFilters=filters;window.__qaRerender=()=>setFilters(f=>({...f}));return <><div className="qa-label">真實三頁元件＋測試資料｜不連正式環境</div>{mode===\'meeting\'?<TemporaryMeetingsPage key="meeting" data={data} visibleVessels={vessels} currentUser={user} canExportReports={false} canCloseTasks={false} activeItemLeaseKey="" setData={noWrite} commit={noWrite} claimItemLease={noWrite} requireItemLease={noWrite} releaseItemLease={noWrite} runDurableRelatedMutation={noWrite} onOpenDecisionTask={noWrite} onTransitionDecisionTask={noWrite}/>:<ListPanel key={mode} title={mode===\'closed\'?\'已結案清單\':\'總清單\'} tasks={current} statsTasks={all} data={data} visibleVessels={vessels} filters={{...filters,closedMode:mode===\'closed\'?\'closed\':\'open\'}} setFilters={setFilters} fleetTags={[]} userMap={Object.fromEntries(data.users.map(u=>[u.id,u]))} exportedBy="QA" onEdit={noWrite} onPrint={noWrite} onBatchComplete={noWrite} onBatchDelete={noWrite} canEdit={false} canPrint={false} canComplete={false} canDelete={false} batchContext={{identity:mode,isCurrent:()=>true}}/>}</>};createRoot(document.getElementById(\'root\')).render(<QA/>);';
const metric = label => evaluate(`(()=>{const c=[...document.querySelectorAll('.analysis-metric-grid .metric-card')].find(n=>n.querySelector('small').textContent===${JSON.stringify(label)});return c?c.querySelector('b').textContent:'';})()`);

// Exercise the shared production FilterBar in both list contexts, not a replacement selector.
async function verifyVesselFilter(mode) {
  await evaluate(`window.__qaSetMode(${JSON.stringify(mode)})`);
  const title = mode === 'closed' ? '已結案清單' : '總清單';
  await until(() => evaluate(`document.querySelector('.selected-task-list-panel h2')?.textContent.includes(${JSON.stringify(title)})`), title);
  await click('清除篩選');
  const rows = () => evaluate(`[...document.querySelectorAll('.batch-task-table tbody input[type=checkbox]')].map(n=>n.getAttribute('aria-label').replace('選取待辦 測試事項 ','')).sort()`);
  const allRows = mode === 'closed' ? ['a','e'] : ['b','c','d','f','g'];
  const alphaRows = mode === 'closed' ? ['a'] : ['b','d','g'];
  const nativeClick = async expression => {
    const position = await evaluate(`(()=>{const n=${expression};if(!n||n.disabled)throw new Error('Missing filter control');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...position});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...position});
  };
  const expectRows = async expected => { await until(async()=>JSON.stringify(await rows())===JSON.stringify(expected),mode+' exact filtered rows'); };
  const option = index => `document.querySelectorAll('.vessel-list-filter-options input')[${index}]`;
  await expectRows(allRows);
  await nativeClick(`document.querySelector('[aria-label="待辦清單船舶篩選"]')`);
  await until(()=>evaluate("document.querySelector('.vessel-list-filter').open"),'opened selector');
  await screen(mode+'-filter-before-assert');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.vessel-list-filter-options label span')].map(n=>n.textContent)"),['測試甲輪 QA ALPHA','QA BETA'],mode+' bilingual / English-only labels, unchanged option order and authorized scope');
  for (const width of [1280,390]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await evaluate('document.fonts.ready');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await evaluate("document.querySelector('.vessel-list-filter').scrollIntoView({block:'start'})");
    const geometry = await evaluate("(()=>{const n=document.querySelector('.vessel-list-filter-panel'),r=n.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,client:n.clientWidth,scroll:n.scrollWidth,documentWidth:document.documentElement.scrollWidth,options:[...n.querySelectorAll('.vessel-list-filter-options label')].map(n=>{const range=document.createRange();range.selectNodeContents(n.querySelector('span'));const text=range.getBoundingClientRect();return {client:n.clientWidth,scroll:n.scrollWidth,height:n.getBoundingClientRect().height,textLeft:text.left,textRight:text.right};})};})()");
    evidence.geometry.push({mode,surface:'vessel-filter',...geometry});
    // The unchanged desktop CSS anchors a 380px menu to the last grid field's left edge.
    // Record that existing viewport overhang; this name-only change must not clip labels.
    assert.ok(geometry.scroll<=geometry.client+1&&geometry.options.every(n=>n.height>0&&n.scroll<=n.client+1&&n.textLeft>=0&&n.textRight<=width),'full option names remain visible');
    if(width===390)assert.ok(geometry.left>=0&&geometry.right<=width&&geometry.documentWidth<=width+1,'mobile filter fits without document overflow');
    await screen(mode+'-vessel-filter-'+width);
  }
  await nativeClick(option(0));await expectRows(alphaRows);
  assert.deepEqual(await evaluate('window.__qaFilters.vesselIds'),['qa-v1']);
  await nativeClick(option(1));await expectRows(allRows);
  assert.deepEqual(await evaluate('window.__qaFilters.vesselIds'),['qa-v1','qa-v2']);
  assert.equal(await evaluate("document.querySelector('.vessel-list-filter summary b').textContent"),'已選 2 艘');
  await nativeClick("document.querySelectorAll('.vessel-list-filter-modes input')[1]");await expectRows(alphaRows);
  assert.equal(await evaluate('window.__qaFilters.ownerMode'),'mine');
  await nativeClick("document.querySelectorAll('.vessel-list-filter-modes input')[0]");await expectRows(allRows);
  assert.deepEqual(await evaluate('window.__qaFilters.vesselIds'),[]);
  assert.equal(await evaluate('window.__qaFilters.ownerMode'),'all');
  await nativeClick(`document.querySelector('[aria-label="待辦清單船舶篩選"]')`);
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate('JSON.stringify(window.__qaData)===window.__qaBefore'),true);
  evidence.cases.push(mode+' bilingual vessel selector, desktop/mobile, exact-ID multi-select, mine/all and unchanged data');
}

try {
  server = await createServer({ root: process.cwd(), base: '/', server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{ name: 'isolated-analytics-qa', configureServer(vite) { vite.middlewares.use((req, res, next) => { res.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:*"); if (req.url === '/__qa_analytics') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); void vite.transformIndexHtml('/__qa_analytics', '<!doctype html><html><head><meta charset="UTF-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{padding:8px}.qa-label{padding:5px 8px;margin-bottom:6px;background:#fff0c5;color:#543c00;font-size:12px;font-weight:700}</style></head><body><div class="qa-label">真實 UI＋測試資料｜不連正式環境</div><div id="root"></div><script type="module" src="/@qa-analytics"></script></body></html>').then(html => res.end(html)).catch(next); } else next(); }); }, resolveId(source) { if (source === '/@qa-analytics') return '\0qa-analytics'; }, async load(source) { if (source === '\0qa-analytics') return ts.transpileModule(entry,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText; } }] });
  await server.listen(); await server.transformRequest('/@qa-analytics'); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = spawn(process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let port, socketPath;
  await until(() => { try { [port, socketPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); return /^\d+$/.test(port) && socketPath?.startsWith('/devtools/browser/'); } catch (e) { if (['ENOENT', 'EBUSY', 'EPERM'].includes(e.code)) return false; throw e; } }, 'owned Chrome');
  ws = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`); await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else if (m.method === 'Log.entryAdded') evidence.errors.push(m.params.entry.text+' '+(m.params.entry.url||'')); else if (m.method === 'Runtime.consoleAPICalled' && m.params.type==='error') evidence.errors.push(JSON.stringify(m.params.args)); else if (m.method === 'Runtime.exceptionThrown') evidence.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null); ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, null)); await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }); await call('Page.navigate', { url: origin + '/__qa_analytics' });
  await until(() => evaluate("Boolean(document.querySelector('.selected-task-list-panel'))"), 'original list mounted');
  await evaluate('document.fonts.ready'); await screen('total-baseline');
  await verifyVesselFilter('total');
  await verifyVesselFilter('closed');
  await evaluate("window.__qaSetMode('meeting')");
  await until(() => evaluate("Boolean(document.querySelector('.temporary-meeting-page'))"), 'original meeting mounted');
  await screen('meeting-baseline');
  await evaluate("window.__qaSetMode('total')");
  await until(() => evaluate("Boolean(document.querySelector('.selected-task-list-panel'))"), 'list returned');
  assert.ok(await evaluate("[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='數據統計')"), '待辦總表需要可操作的數據統計入口');
  await evaluate("document.querySelector('tbody input[type=checkbox]').click();void(window.__qaListNode=document.querySelector('.selected-task-list-panel'))");
  await click('數據統計');
  await until(async()=>await metric('案件總數')==='5','open cohort');
  assert.equal(await metric('完成率'),'0%');
  await change('[aria-label="統計案件範圍"]','all');
  await until(async()=>await metric('案件總數')==='7','all statuses');
  assert.equal(await metric('完成率'),'29%');
  assert.equal(await metric('按期完成率'),'50%');
  assert.equal(await metric('逾期結案'),'1');
  assert.equal(await evaluate('window.__qaListNode===document.querySelector(".selected-task-list-panel")'),true);
  evidence.cases.push('total entry, exact cohort, all-state denominator and unchanged list node');
  assert.ok(await evaluate('Boolean(document.querySelector("[aria-label=統計分析面向]"))'),'統計須提供部門／個人等排名面向');
  await change('[aria-label="統計分析面向"]','person');
  await until(()=>evaluate('Boolean(document.querySelector("[data-stat-rank-id=qa-a]"))'),'person ranks');
  assert.equal(await evaluate('document.querySelector("[data-stat-rank-id=qa-a]").dataset.total'),'4');
  await click('查看 測試甲員｜機務 趨勢');
  await until(()=>evaluate('document.querySelector("[data-trend-focus]").dataset.trendFocus==="person:qa-a"'),'person trend');
  assert.match(await evaluate('document.querySelector(".da-trend-legend").innerText'),/新增 3 件.*完成 1 件/s);
  await change('[aria-label="統計人員"]','qa-c');
  await until(async()=>await metric('案件總數')==='1','person filter');
  assert.equal(await evaluate('document.querySelector("[data-trend-focus]").dataset.trendFocus'),'');
  await change('[aria-label="統計日期起"]','2026-04-01');await change('[aria-label="統計日期迄"]','2026-03-01');
  assert.match(await evaluate('document.querySelector("dialog [role=alert]").innerText'),/日期起不得晚於日期迄/);
  await click('重設統計條件');
  await change('[aria-label="統計分析面向"]','vessel');
  await until(()=>evaluate('Boolean(document.querySelector("[data-stat-rank-id=qa-v1]"))'),'vessel ranks');
  assert.equal(await evaluate('document.querySelector("[data-stat-rank-id=qa-v1]").children[3].textContent'),'50%');
  await click('查看 QA ALPHA 趨勢');
  assert.match(await evaluate('document.querySelector(".da-trend-legend").innerText'),/完成 2 件/);
  await change('[aria-label="趨勢時間單位"]','week');await change('[aria-label="趨勢時間單位"]','day');await change('[aria-label="趨勢時間單位"]','month');
  evidence.cases.push('person/vessel rankings, source dates, drilldown, filters and reset');
  await click('關閉統計');
  await until(()=>evaluate('!document.querySelector("dialog").open'),'close dialog');
  assert.equal(await evaluate('document.querySelector(".batch-selection-count").textContent'),'已選 1');
  await change('input[placeholder="船名、事項、狀態..."]','測試事項 b');await click('數據統計');
  await until(async()=>await metric('案件總數')==='1','parent keyword cohort');
  await change('[aria-label="統計案件範圍"]','all');assert.equal(await metric('案件總數'),'1');
  await click('重設統計條件');assert.equal(await metric('案件總數'),'1');await click('關閉統計');
  assert.equal(await evaluate(`document.querySelector('input[placeholder="船名、事項、狀態..."]').value`),'測試事項 b');
  await change('input[placeholder="船名、事項、狀態..."]','');
  evidence.cases.push('parent keyword and selection survive opening/resetting/closing statistics');

  await evaluate("window.__qaSetMode('closed')");await until(()=>evaluate('document.querySelector(".selected-task-list-panel h2").textContent.includes("已結案")'),'closed entry');
  await click('數據統計');await until(async()=>await metric('案件總數')==='2','closed cohort');
  assert.equal(await metric('完成率'),'100%');assert.equal(await metric('未結逾期率'),'0%');assert.equal(await metric('逾期結案'),'1');
  await change('[aria-label="統計案件範圍"]','all');await until(async()=>await metric('案件總數')==='7','closed same-condition base');
  evidence.cases.push('closed entry preserves late-closure analysis and all-state performance');
  await click('關閉統計');await evaluate("window.__qaSetMode('meeting')");
  await until(()=>evaluate('Boolean(document.querySelector(".temporary-meeting-page"))'),'meeting entry');
  assert.ok(await evaluate("[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='數據統計')"),'臨會專題須有統計入口');
  await evaluate('void(window.__qaMeetingNode=document.querySelector(".temporary-meeting-workspace"))');
  await click('數據統計');await until(async()=>await metric('案件總數')==='3','meeting cohort');
  assert.equal(await metric('完成率'),'33%');
  await change('[aria-label="統計對象"]','decisions');await until(async()=>await metric('案件總數')==='1','decision cohort');
  assert.equal(await metric('完成率'),'0%');
  await change('[aria-label="統計對象"]','meetings');
  await click('關閉統計');
  assert.equal(await evaluate('window.__qaMeetingNode===document.querySelector(".temporary-meeting-workspace")'),true);
  await click('未完成清單');await click('數據統計');await until(async()=>await metric('案件總數')==='2','unfinished meeting register');
  await change('[aria-label="統計案件範圍"]','all');await until(async()=>await metric('案件總數')==='3','all meetings base');
  await click('關閉統計');await click('已完成清單');await click('數據統計');await until(async()=>await metric('案件總數')==='1','completed meeting register');
  assert.equal(await metric('完成率'),'100%');await click('關閉統計');
  await change('.meeting-register-filters input','已完成測試會議');await click('數據統計');await change('[aria-label="統計案件範圍"]','all');
  await until(async()=>await metric('案件總數')==='1','meeting query preserved in all-state cohort');
  await click('關閉統計');assert.equal(await evaluate('document.querySelector(".meeting-register-filters input").value'),'已完成測試會議');
  await change('.meeting-register-filters input','');
  evidence.cases.push('meeting/decision separation and both meeting-register status cohorts');
  for(const mode of ['total','closed','meeting']) {
    await evaluate(`window.__qaSetMode(${JSON.stringify(mode)})`);
    await until(()=>evaluate('Boolean(document.querySelector(".statistics-entry"))'),'statistics entry '+mode);
    await click('數據統計');await until(()=>evaluate('Boolean(document.querySelector("dialog[open] .page-statistics-view"))'),'modal '+mode);
    await change('[aria-label="統計案件範圍"]','all');
    for(const width of [1280,820,390]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      await evaluate('document.fonts.ready');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await evaluate('document.querySelector("dialog").scrollTop=0');
      const geometry=await evaluate('(()=>{const d=document.querySelector("dialog[open]");return {width:innerWidth,dialogWidth:d.clientWidth,dialogScroll:d.scrollWidth,left:d.getBoundingClientRect().left,right:d.getBoundingClientRect().right};})()');
      evidence.geometry.push({mode,...geometry});
      assert.ok(geometry.dialogScroll<=geometry.dialogWidth+1,'dialog overflow '+mode+' '+width);
      assert.ok(geometry.left>=0&&geometry.right<=width,'dialog within viewport');
      await screen(mode+'-'+width);
      if(width===390){await evaluate('document.querySelector(".ps-analysis-grid").scrollIntoView()');await screen(mode+'-390-analysis');}
    }
    await change('[aria-label="統計分析面向"]','person');
    assert.ok(await evaluate('[...document.querySelectorAll(".ps-rank-table td")].every(n=>getComputedStyle(n).display!=="none"&&n.getBoundingClientRect().width>0)'),'all ranking cells available, with local scroll');
    await click('關閉統計');
  }
  evidence.cases.push('all three entries at desktop/tablet/mobile, no dialog overflow or hidden ranking data');
  assert.equal(await evaluate('JSON.stringify(window.__qaData)===window.__qaBefore'),true);
  assert.deepEqual(evidence.errors,[]);evidence.cases.push('no business-data mutation, lease/write callback, or console/runtime errors');




} catch (error) { failure = error; evidence.failure = error.stack || String(error); evidence.dom = await evaluate('document.body.innerText').catch(()=>null); await screen('failure').catch(()=>{}); }
finally {
  if (ws?.readyState === WebSocket.OPEN) { await call('Browser.close', {}, null).catch(() => {}); ws.close(); }
  if (browser) await until(() => browser.exitCode !== null, 'owned browser exit', 10000).catch(() => browser.kill());
  if (server) await server.close(); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  evidence.cleanup = { browserExited: !browser || browser.exitCode !== null, serverClosed: !server || !server.httpServer.listening, profileRemoved: !fs.existsSync(profile) }; fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ output, result: failure ? 'FAIL' : 'PASS', cases: evidence.cases, geometry: evidence.geometry, cleanup: evidence.cleanup, failure: failure?.message }, null, 2));
}
if (failure) process.exitCode = 1;

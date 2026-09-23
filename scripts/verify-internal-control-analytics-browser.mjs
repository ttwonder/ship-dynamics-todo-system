import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';

const evidenceRoot = process.env.QA_EVIDENCE_ROOT || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'hermes', 'cache', 'scratch');
fs.mkdirSync(evidenceRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(evidenceRoot, 'ic-analytics-'));
const profile = path.join(output, 'chrome-profile');
const evidence = { layer: '真實 InternalControlPage UI＋測試資料；非正式環境／非資料庫驗證', cases: [], errors: [], geometry: [] };
evidence.inputs = Object.fromEntries(['src/InternalControlPage.tsx','src/VesselListFilter.tsx','src/InternalControlStatsView.tsx','src/vesselDisplay.ts','src/internalControlWorkflow.ts','src/internalControlAnalytics.ts','src/listVesselControls.ts','src/styles.css','src/internalControlAnalytics.css','scripts/fixtures/internal-control-analytics.ts','scripts/verify-internal-control-analytics-browser.mjs'].map(file => [file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
let server, browser, ws, sessionId, id = 0, failure;
const pending = new Map(), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await test()) return; await wait(80); } throw new Error('Timeout: ' + label); }
function call(method, params = {}, session = sessionId) { return new Promise((resolve, reject) => { const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(new Error('CDP timeout: ' + method)); }, 10000); pending.set(n, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } }); ws.send(JSON.stringify({ id: n, method, params, ...(session ? { sessionId: session } : {}) })); }); }
async function evaluate(expression) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
const screen = async name => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
const click = text => evaluate(`(() => { const n=[...document.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.textContent.trim())===${JSON.stringify(text)}&&n.getClientRects().length&&!n.disabled); if(!n) throw new Error('Missing button '+${JSON.stringify(text)}); n.click(); })()`);
const change = (selector, value) => evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n)throw new Error('Missing input '+${JSON.stringify(selector)}); const proto=n instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(n,${JSON.stringify(value)}); n.dispatchEvent(new Event(n instanceof HTMLSelectElement?'change':'input',{bubbles:true})); })()`);
const statsText = () => evaluate("document.querySelector('.internal-control-page > .ic-stats')?.innerText || ''");
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import InternalControlPage from '/src/InternalControlPage.tsx';import{createAnalyticsFixture}from'/scripts/fixtures/internal-control-analytics.ts';import'/src/styles.css';const {data,owner,vessels}=createAnalyticsFixture();vessels[2].name='QA-C';const before=JSON.stringify(data);window.__qaDataUnchanged=()=>JSON.stringify(data)===before;window.__qaMutations=0;const reject=()=>{window.__qaMutations++;throw new Error('Analytics must not mutate data');};createRoot(document.getElementById('root')).render(React.createElement(InternalControlPage,{data,user:owner,vessels,authorizationEpoch:'qa-analytics',canCreate:false,canEdit:false,canClose:false,canDelete:false,canExport:true,onCreate:reject,onUpdate:reject,onWithdrawTaskSync:reject,onDelete:reject,onBatchClose:reject,onBatchDelete:reject,onOpenTask:reject}));`;
try {
  server = await createServer({ root: process.cwd(), base: '/', server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent', plugins: [{ name: 'isolated-analytics-qa', configureServer(vite) { vite.middlewares.use((req, res, next) => { res.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:*"); if (req.url === '/__qa_analytics') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); void vite.transformIndexHtml('/__qa_analytics', '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{padding:8px}.qa-label{padding:5px 8px;margin-bottom:6px;background:#fff0c5;color:#543c00;font-size:12px;font-weight:700}</style></head><body><div class="qa-label">真實 UI＋測試資料｜不連正式環境</div><div id="root"></div><script type="module" src="/@qa-analytics"></script></body></html>').then(html => res.end(html)).catch(next); } else next(); }); }, resolveId(source) { if (source === '/@qa-analytics') return '\0qa-analytics'; }, load(source) { if (source === '\0qa-analytics') return entry; } }] });
  await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = spawn(process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let port, socketPath;
  await until(() => { try { [port, socketPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); return /^\d+$/.test(port) && socketPath?.startsWith('/devtools/browser/'); } catch (e) { if (['ENOENT', 'EBUSY', 'EPERM'].includes(e.code)) return false; throw e; } }, 'owned Chrome');
  ws = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`); await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') evidence.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null); ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, null)); await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }); await call('Page.navigate', { url: origin + '/__qa_analytics' });
  await until(() => evaluate("[...document.querySelectorAll('button')].some(n=>n.textContent==='數據統計')"), 'original component mounted');
  const expectedNames = ['測試甲輪 QA ALPHA','測試乙輪 QA BETA','QA GAMMA'];
  const listNames = () => evaluate("[...document.querySelectorAll('.ic-table tbody tr > td:nth-child(2) > b')].map(n=>n.textContent)");
  const filterNames = () => evaluate("[...document.querySelectorAll('.vessel-list-filter-options label > span')].map(n=>n.textContent)");
  const toggleShip = index => evaluate(`document.querySelectorAll('.vessel-list-filter-options input')[${index}].click()`);
  assert.deepEqual(new Set(await listNames()),new Set(expectedNames),'open list uses bilingual names and English-only fallback');
  assert.equal((await listNames()).length,5);
  await evaluate("document.querySelector('[aria-label=內控清單船舶篩選]').click();document.fonts.ready");
  assert.deepEqual(await filterNames(),expectedNames,'filter names change without changing the English-name option order');
  await screen('open-list-filter-1280');
  await toggleShip(0);await toggleShip(2);
  await until(async()=> (await listNames()).length===2,'exact two-ship open filter');
  assert.deepEqual(new Set(await listNames()),new Set([expectedNames[0],expectedNames[2]]));
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.ic-table tbody .ic-description-column b')].map(n=>n.textContent).sort()"),['測試案件 ic-2','測試案件 ic-8']);
  await click('重設（所有船舶）');await until(async()=>(await listNames()).length===5,'reset open list');
  await evaluate("document.querySelectorAll('.ic-tabs button')[1].click()");
  await until(()=>evaluate("document.querySelector('.ic-list-panel h2')?.textContent.startsWith('內控結案清單')"),'closed list');
  assert.deepEqual(new Set(await listNames()),new Set(expectedNames));assert.equal((await listNames()).length,5);
  evidence.cases.push('bilingual open/closed list and exact-ID multi-ship filter with English-only fallback');
  await click('數據統計'); await until(() => evaluate("Boolean(document.querySelector('.internal-control-page > .ic-stats'))"), 'stats tab');
  assert.deepEqual(await filterNames(),expectedNames);
  assert.deepEqual(new Set(await evaluate("[...document.querySelectorAll('.internal-control-page > .ic-stats [data-overview-dimension=vessel] .ic-overview-rows div > span')].map(n=>n.textContent)")),new Set(expectedNames));
  await toggleShip(0);await toggleShip(2);await until(async()=>/目前篩選.*6.*件/.test(await statsText()),'statistics exact two-ship filter');
  await click('重設（所有船舶）');await until(async()=>/目前篩選.*10.*件/.test(await statsText()),'statistics filter reset');
  await evaluate("document.querySelector('.vessel-list-filter').open=false");
  evidence.cases.push('statistics overview and shared filter use bilingual names without changing the cohort');
  await evaluate('document.fonts.ready'); await screen('desktop-entry');
  evidence.geometry.push(await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,oldPanels:[...document.querySelectorAll('.internal-control-page > .ic-stats .ic-stat-grid > .panel')].map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))})"));
  assert.ok(await evaluate("Boolean(document.querySelector('[aria-label=\"統計分析面向\"]'))"), 'statistics must provide an interactive percentage/ranking analysis dimension');
  assert.match(await statsText(), /目前篩選.*10.*件/);
  assert.equal(await evaluate("document.querySelectorAll('.internal-control-page > .ic-stats [data-overview-dimension]').length"), 6);
  const rowText = key => evaluate(`document.querySelector('.internal-control-page > .ic-stats [data-rank-key='+CSS.escape(${JSON.stringify(key)})+']')?.innerText||''`);
  assert.match(await rowText('設備故障'), /60\.0%/); evidence.cases.push('full filtered denominator and compact six-dimension overview');
  await evaluate("(() => { const group=[...document.querySelectorAll('.ic-filter-group')].find(n=>n.querySelector('summary')?.textContent.startsWith('事項分類')); group.open=true; [...group.querySelectorAll('label')].find(n=>n.textContent==='設備故障').querySelector('input').click(); })()");
  await until(async () => /目前篩選.*6.*件/.test(await statsText()), 'category filter updates all analytics');
  assert.match(await rowText('設備故障'), /100\.0%/);
  await change('[aria-label="統計分析面向"]', 'department'); await until(async () => /66\.7%/.test(await rowText('輪機')), 'department denominator'); assert.match(await statsText(), /合計可能超過 100%/);
  await change('[aria-label="統計分析面向"]', 'equipment'); await until(async () => /50\.0%/.test(await rowText('动力与推进')), 'equipment breakdown'); evidence.cases.push('original category filter drives percentages and dimension rankings');
  await click('查看 动力与推进 趨勢'); await until(() => evaluate("document.querySelector('.internal-control-page > .ic-stats [data-trend-focus]')?.getAttribute('data-trend-focus')==='动力与推进'"), 'rank drill into trend');
  assert.ok(await evaluate("document.querySelector('.internal-control-page > .ic-stats svg[aria-label=\"新增與結案趨勢圖\"]') !== null"));
  await change('[aria-label="趨勢時間單位"]', 'week'); await until(() => evaluate("document.querySelector('.internal-control-page > .ic-stats [data-trend-interval]')?.getAttribute('data-trend-interval')==='week'"), 'weekly trend'); evidence.cases.push('rank drilldown and week/month time-series controls');
  await change('.ic-filter-primary label:nth-of-type(1) input', '2026-03-01');
  await change('.ic-filter-primary label:nth-of-type(2) input', '2026-03-31');
  await until(async () => /目前篩選.*1.*件/.test(await statsText()), 'combined category and date filter');
  assert.match(await rowText('动力与推进'), /100\.0%/);
  assert.equal(await evaluate("document.querySelector('.internal-control-page > .ic-stats [data-trend-focus]').getAttribute('data-trend-focus')"), '');
  assert.match(await evaluate("document.querySelector('.internal-control-page > .ic-stats .ic-trend-legend').innerText"), /新增 1 件\s*結案 0 件/);
  evidence.cases.push('combined report-date/category filters reset drilldown and bound closure events');
  await change('[aria-label="內控異常關鍵字"]', 'no-matching-case'); await until(async () => /目前篩選.*0.*件/.test(await statsText()), 'empty result'); assert.doesNotMatch(await statsText(), /NaN|Infinity/); assert.match(await statsText(), /沒有符合條件/); evidence.cases.push('zero results never show NaN or stale ranking');
  await click('重設（所有船舶）'); await until(async () => /目前篩選.*10.*件/.test(await statsText()), 'reset original filters');
  await change('[aria-label="統計分析面向"]', 'vessel'); await change('[aria-label="趨勢時間單位"]', 'month');
  await until(()=>evaluate("document.querySelector('.internal-control-page > .ic-stats').dataset.analysisDimension==='vessel'"),'vessel analysis');
  for (const [key,name] of [['qa-a',expectedNames[0]],['qa-b',expectedNames[1]],['qa-c',expectedNames[2]]]) assert.ok((await rowText(key)).includes(name));
  await click('查看 測試甲輪 QA ALPHA 趨勢');await until(()=>evaluate("document.querySelector('.internal-control-page > .ic-stats [data-trend-focus]').dataset.trendFocus==='qa-a'"),'bilingual rank still uses exact vessel ID');
  assert.match(await evaluate("document.querySelector('.internal-control-page > .ic-stats .ic-trend-context').innerText"),/測試甲輪 QA ALPHA（4 件）/);
  await click('恢復全部');evidence.cases.push('bilingual ranking and trend focus preserve vessel IDs and counts');
  for (const width of [1280, 820, 390]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const geometry = await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,panels:[...document.querySelectorAll('.internal-control-page > .ic-stats [data-overview-dimension]')].map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})),metrics:document.querySelector('.internal-control-page > .ic-stats .ic-analytics-metrics')?.getBoundingClientRect().height})"); evidence.geometry.push(geometry); assert.ok(geometry.scrollWidth <= width, 'analytics document overflow at ' + width); if (width === 1280) { assert.ok(geometry.panels.every(p=>p.width<340), 'distribution cards must be substantially narrower than half-page panels'); assert.ok(geometry.metrics < 90, 'metrics must stay compact'); }
    await evaluate("document.querySelector('.internal-control-page > .ic-stats').scrollIntoView({block:'start'})"); await screen('analytics-' + width);
    if (width === 390) {
      await evaluate("document.querySelector('.ic-filter-panel').scrollIntoView({block:'start'});document.querySelector('.vessel-list-filter').open=true");
      assert.deepEqual(await filterNames(),expectedNames);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
      const filterBox=await evaluate("(()=>{const r=document.querySelector('.vessel-list-filter-panel').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};})()");assert.ok(filterBox.left>=0&&filterBox.right<=filterBox.width);
      await screen('vessel-filter-390');await evaluate("document.querySelector('.vessel-list-filter').open=false");
      await evaluate("document.querySelector('.internal-control-page > .ic-stats .ic-trend-view').scrollIntoView({block:'start'})"); await screen('analytics-390-trend');
      assert.ok(await evaluate("(()=>{const s=document.querySelector('.internal-control-page > .ic-stats svg');return [...s.querySelectorAll('text')].every(t=>{const b=t.getBBox();return b.x>=0&&b.x+b.width<=s.viewBox.baseVal.width;});})()"), 'mobile chart labels stay inside the chart');
    }
  }
  evidence.cases.push('desktop/tablet/mobile compact layout with no page overflow');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await change('[aria-label="統計分析面向"]', 'source'); await click('查看 外部 趨勢');
  assert.equal(await evaluate("document.querySelector('.internal-control-print [data-analysis-dimension]')?.getAttribute('data-analysis-dimension')"), 'source');
  assert.equal(await evaluate("document.querySelector('.internal-control-print [data-trend-focus]')?.getAttribute('data-trend-focus')"), '外部');
  await evaluate("window.__qaPrintCalled=0;window.print=()=>{window.__qaPrintCalled++;}"); await click('導出 PDF'); await until(() => evaluate('window.__qaPrintCalled===1'), 'original PDF action');
  assert.equal(await evaluate("document.body.classList.contains('printing-internal-control')"), true);
  await call('Emulation.setEmulatedMedia', { media: 'print' });
  await evaluate('document.fonts.ready'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  evidence.printGeometry = await evaluate("[document.querySelector('.internal-control-page>.page-heading'),...document.querySelectorAll('.internal-control-print,.internal-control-print .ic-analytics,.internal-control-print .ic-analytics>*,.internal-control-print .ic-trend-view,.internal-control-print svg')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {className:n.getAttribute('class'),y:r.y,height:r.height,width:r.width,display:s.display,gap:s.gap,breakInside:s.breakInside};})");
  const pdf = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true }); fs.writeFileSync(path.join(output, 'analytics-print.pdf'), Buffer.from(pdf.data, 'base64'));
  evidence.pdfPages = (Buffer.from(pdf.data, 'base64').toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  assert.equal(evidence.pdfPages, 1, 'small statistics report must keep its four ranking rows and trend on one page');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.internal-control-print')).display !== 'none'"), true); evidence.cases.push('print uses the same selected dimension and trend focus');
  assert.equal(await evaluate('window.__qaMutations'), 0);assert.equal(await evaluate('window.__qaDataUnchanged()'),true); assert.deepEqual(evidence.errors, []); evidence.cases.push('read-only interaction with no mutations or uncaught exceptions');
} catch (error) { failure = error; evidence.failure = error.stack || String(error); }
finally {
  if (ws?.readyState === WebSocket.OPEN) { await call('Browser.close', {}, null).catch(() => {}); ws.close(); }
  if (browser) await until(() => browser.exitCode !== null, 'owned browser exit', 10000).catch(() => browser.kill());
  if (server) await server.close(); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  evidence.cleanup = { browserExited: !browser || browser.exitCode !== null, serverClosed: !server || !server.httpServer.listening, profileRemoved: !fs.existsSync(profile) }; fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ output, result: failure ? 'FAIL' : 'PASS', cases: evidence.cases, geometry: evidence.geometry, cleanup: evidence.cleanup, failure: failure?.message }, null, 2));
}
if (failure) process.exitCode = 1;

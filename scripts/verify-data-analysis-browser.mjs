import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const evidenceRoot = process.env.QA_EVIDENCE_ROOT || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'hermes', 'cache', 'scratch');
fs.mkdirSync(evidenceRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(evidenceRoot, 'data-analysis-'));
const profile = path.join(output, 'chrome-profile');
const evidence = { layer: '真實 DataAnalysisView UI＋測試資料；非正式環境／非資料庫驗證', cases: [], errors: [], geometry: [] };
let server, browser, ws, sessionId, id = 0, failure;
const pending = new Map(), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await test()) return; await wait(80); } throw new Error('Timeout: ' + label); }
function call(method, params = {}, session = sessionId) { return new Promise((resolve, reject) => { const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(new Error('CDP timeout: ' + method)); }, 10000); pending.set(n, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } }); ws.send(JSON.stringify({ id: n, method, params, ...(session ? { sessionId: session } : {}) })); }); }
async function evaluate(expression) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
const screen = async name => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
const click = text => evaluate(`(() => { const n=[...document.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.textContent.trim())===${JSON.stringify(text)}&&n.getClientRects().length&&!n.disabled); if(!n) throw new Error('Missing button '+${JSON.stringify(text)}); n.click(); })()`);
const change = (selector, value) => evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n)throw new Error('Missing input '+${JSON.stringify(selector)}); const proto=n instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(n,${JSON.stringify(value)}); n.dispatchEvent(new Event(n instanceof HTMLSelectElement?'change':'input',{bubbles:true})); })()`);
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import DataAnalysisView from '/src/DataAnalysis.tsx';import{createDataAnalysisFixture}from'/scripts/fixtures/data-analysis.ts';import'/src/styles.css';const fixture=createDataAnalysisFixture();const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};window.__qaData=freeze(fixture);window.__qaBefore=JSON.stringify(fixture);const root=createRoot(document.getElementById('root'));window.__qaRerender=()=>root.render(React.createElement(DataAnalysisView,freeze(structuredClone(fixture))));window.__qaRerender();`;
const metric = label => evaluate(`(()=>{const c=[...document.querySelectorAll('.analysis-metric-grid .metric-card')].find(n=>n.querySelector('small').textContent===${JSON.stringify(label)});return c?c.querySelector('b').textContent:'';})()`);

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
  await until(() => evaluate("Boolean(document.querySelector('.data-analysis-view'))"), 'original component mounted');
  await evaluate('document.fonts.ready'); await screen('desktop-entry');
  evidence.geometry.push(await evaluate("({phase:'entry',width:innerWidth,scrollWidth:document.documentElement.scrollWidth,metricsHeight:document.querySelector('.analysis-metric-grid').getBoundingClientRect().height})"));
  assert.equal(await metric('責任事項'), '7');
  assert.equal(await metric('完成率'), '29');
  assert.ok(await evaluate("Boolean(document.querySelector('[aria-label=\"分析建立日期起\"]'))"), 'analysis must offer date filtering shared by percentages, rankings and trends');
  const liveBefore = await evaluate("document.querySelector('.analysis-vessel-table').innerText");
  const rows = kind => evaluate(`Array.from(document.querySelectorAll('[data-compare-kind="${kind}"] [data-compare-id]')).map(n=>({id:n.dataset.compareId,rank:n.dataset.rank,count:Number(n.dataset.count)}))`);
  const chart = () => evaluate("({focus:document.querySelector('[data-trend-focus]').dataset.trendFocus,legend:document.querySelector('.da-trend-legend').innerText,points:[...document.querySelectorAll('[data-trend-key]')].map(n=>[n.dataset.trendKey,Number(n.dataset.ordinary),Number(n.dataset.meeting)])})");
  await change('[aria-label="分析建立日期起"]', '2026-01-01');
  await change('[aria-label="分析建立日期迄"]', '2026-03-31');
  await until(async () => await metric('責任事項') === '4', 'date cohort');
  assert.equal(await metric('完成率'), '25');
  assert.match(await evaluate("document.querySelector('[data-compare-kind=vessel] [data-compare-id=qa-v1]').innerText"), /完成 67%/, 'vessel ranking uses its member completion');
  assert.match(await evaluate("document.querySelector('[data-category-source=ordinary]').innerText"), /3 件/);
  const share = await evaluate("[...document.querySelectorAll('[data-category-source=ordinary] [data-category]')].map(n=>[n.dataset.category,n.dataset.count,n.dataset.share])");
  assert.deepEqual(share, [['事故','2','67'],['維修','2','67']]);
  assert.deepEqual((await chart()).points, [['2026-01-01',2,0],['2026-02-01',0,0],['2026-03-01',1,1]]);
  evidence.cases.push('date cohort, distinct-case multi-category shares, zero-filled monthly trend');
  await change('[aria-label="排名依據"]', 'total');
  await until(async () => (await rows('person'))[0]?.id === 'qa-a', 'count ranking');
  assert.deepEqual((await rows('person')).map(n=>[n.id,n.count]), [['qa-a',3],['qa-b',2],['qa-c',1]]);
  await click('查看 測試甲員｜機務 趨勢');
  await until(async () => (await chart()).focus === 'person:qa-a', 'rank trend focus');
  assert.match((await chart()).legend, /要事 2 件.*臨會\/專題 1 件/s);
  await change('[aria-label="趨勢時間單位"]', 'week');
  assert.ok((await chart()).points.length > 3);
  await change('[aria-label="趨勢時間單位"]', 'day');
  assert.equal((await chart()).points.length, 90);
  await change('[aria-label="趨勢時間單位"]', 'month');
  evidence.cases.push('rank sort, drilldown, daily and weekly intervals');
  await change('[aria-label="顯示範圍"]', 'person');
  await change('[aria-label="分析人員"]', 'qa-a');
  await until(async () => await metric('責任事項') === '3', 'person scope');
  assert.equal(await metric('提出率／件數'), '25');
  assert.equal((await chart()).focus, '');
  assert.deepEqual((await rows('person')).map(n=>[n.id,n.count]), [['qa-a',3],['qa-b',1],['qa-c',1]]);
  await evaluate('window.__qaRerender()');
  await until(async () => await metric('責任事項') === '3', 'scope retained on data rerender');
  assert.equal(await evaluate("document.querySelector('[aria-label=\"分析建立日期起\"]').value"), '2026-01-01');
  await change('[aria-label="顯示範圍"]', 'department');
  await change('[aria-label="分析部門"]', '機務');
  await until(async () => await metric('責任事項') === '3', 'department scope');
  evidence.cases.push('responsibility filter drives rankings, preserves proposal denominator and refresh selection');
  await change('[aria-label="顯示範圍"]', 'overall');
  await change('[aria-label="分析事項來源"]', 'meeting');
  await until(async () => await metric('責任事項') === '1', 'source dimension');
  assert.match((await chart()).legend, /要事 0 件.*臨會\/專題 1 件/s);
  await change('[aria-label="分析事項來源"]', 'ordinary');
  await until(async () => await metric('責任事項') === '3', 'ordinary source');
  assert.equal(await evaluate("document.querySelector('.analysis-vessel-table').innerText"), liveBefore, 'live vessel attention must not become a historical-cohort value');
  evidence.cases.push('meeting and ordinary dimensions stay separate; live vessel state unchanged');
  await change('[aria-label="分析建立日期起"]', '2027-01-01');
  assert.match(await evaluate("document.querySelector('[role=alert]').innerText"), /日期起不得晚於日期迄/);
  await change('[aria-label="分析建立日期迄"]', '2027-01-31');
  await until(async () => await metric('責任事項') === '0', 'empty period');
  assert.deepEqual(await rows('person'), []);
  assert.doesNotMatch(await evaluate("document.querySelector('.data-analysis-view').innerText"), /NaN|Infinity/);
  evidence.cases.push('reversed and empty periods do not leave stale ranks or invalid percentages');
  await click('重設分析條件');
  await until(async () => await metric('責任事項') === '7', 'reset');
  for (const width of [1280, 820, 390]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate('document.fonts.ready'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const geometry = await evaluate("({phase:'compact',width:innerWidth,scrollWidth:document.documentElement.scrollWidth,metricsHeight:document.querySelector('.analysis-metric-grid').getBoundingClientRect().height})");
    evidence.geometry.push(geometry); assert.ok(geometry.scrollWidth <= width, 'document overflow at '+width);
    assert.ok(await evaluate("[...document.querySelectorAll('.category-ratio-panel .analysis-value,.da-comparisons .analysis-value')].every(n=>getComputedStyle(n).display!=='none'&&n.getBoundingClientRect().width>0)"), 'all counts and percentages stay visible at '+width);
    if(width===1280) assert.ok(geometry.metricsHeight<90, 'all eight metrics fit a compact desktop row');
    await evaluate('window.scrollTo(0,0)'); await screen('analysis-'+width);
    if(width===390){await evaluate("document.querySelector('.da-trend-panel').scrollIntoView()");await screen('analysis-390-trend');await evaluate("document.querySelector('.da-comparisons').scrollIntoView()");await screen('analysis-390-ranks');}
  }
  evidence.cases.push('compact desktop/tablet/mobile geometry and screenshots');
  assert.equal(await evaluate('JSON.stringify(window.__qaData)===window.__qaBefore'), true);
  assert.deepEqual(evidence.errors, []); evidence.cases.push('no input-data mutations or uncaught browser exceptions');

} catch (error) { failure = error; evidence.failure = error.stack || String(error); }
finally {
  if (ws?.readyState === WebSocket.OPEN) { await call('Browser.close', {}, null).catch(() => {}); ws.close(); }
  if (browser) await until(() => browser.exitCode !== null, 'owned browser exit', 10000).catch(() => browser.kill());
  if (server) await server.close(); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  evidence.cleanup = { browserExited: !browser || browser.exitCode !== null, serverClosed: !server || !server.httpServer.listening, profileRemoved: !fs.existsSync(profile) }; fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ output, result: failure ? 'FAIL' : 'PASS', cases: evidence.cases, geometry: evidence.geometry, cleanup: evidence.cleanup, failure: failure?.message }, null, 2));
}
if (failure) process.exitCode = 1;

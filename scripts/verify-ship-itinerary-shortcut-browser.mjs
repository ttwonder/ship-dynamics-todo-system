import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, preview } from 'vite';

// UI/navigation only: original local-demo Itinerary + actual intake entry.
// No SQL, production services, changes to the human trial, or remote writes.
const base = '/ship-dynamics-todo-system/';
const label = '內控異常/訴求/報告需求';
const output = fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT || os.tmpdir(), 'itinerary-shortcut-'));
const profile = path.join(output, 'chrome-profile');
const built = process.argv.includes('--built');
const evidence = { layer: '真實 UI＋測試資料｜本機導航；非正式環境／非資料庫驗證', built, cases: [], geometry: [], errors: [] };
let server, browser, ws, sessionId, id = 0, failure;
const pending = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, description, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await test()) return; await wait(100); }
  throw new Error('Timeout: ' + description);
}
function call(method, params = {}, session = sessionId) {
  return new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(n, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id: n, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression, session = sessionId) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const linkExpression = `[...document.querySelectorAll('a')].find(n => n.textContent.trim() === ${JSON.stringify(label)})`;
const screen = async name => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
async function clickButton(text) {
  await evaluate(`(() => { const n = [...document.querySelectorAll('button')].find(n => n.textContent.trim() === ${JSON.stringify(text)} && !n.disabled); if (!n) throw new Error('Missing button'); n.click(); })()`);
}
function guard(server) {
  server.middlewares.use((request, response, next) => {
    // Block external app connections in BOTH entries, including the new tab.
    response.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:*");
    if ((request.url || '').split('?')[0].endsWith('/supabase-config.js')) {
      response.setHeader('Content-Type', 'application/javascript');
      response.end('window.SHIP_DYNAMICS_SUPABASE_CONFIG = {};');
      return;
    }
    next();
  });
}
try {
  const options = { root: process.cwd(), base, logLevel: 'silent', plugins: [{ name: 'isolated-shortcut-qa', configureServer: guard, configurePreviewServer: guard }] };
  server = built
    ? await preview({ ...options, preview: { host: '127.0.0.1', port: 0, strictPort: true } })
    : await createServer({ ...options, server: { host: '127.0.0.1', port: 0, strictPort: true } });
  if (!built) await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const sourceUrl = origin + base + 'ship-itinerary.html?itineraryDemo=1';
  const targetUrl = origin + base + 'ship-internal-control.html';
  const chrome = process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert.ok(fs.existsSync(chrome), 'installed Chrome required');
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let port, socketPath;
  await until(() => { try { [port, socketPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); return /^\d+$/.test(port) && socketPath?.startsWith('/devtools/browser/'); } catch (error) { if (['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) return false; throw error; } }, 'owned Chrome handshake');
  ws = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const item = pending.get(message.id); if (!item) return; pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
    else if (message.method === 'Runtime.exceptionThrown') evidence.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, null));
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.navigate', { url: sourceUrl });
  await until(() => evaluate("document.querySelectorAll('#ship-vessel-select option').length > 1"), 'original local demo ready');
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
    evidence.geometry.push(await evaluate(`(() => { const a = ${linkExpression}; const r = a?.getBoundingClientRect(); const s = a && getComputedStyle(a); return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,button:r && {x:r.x,y:r.y,width:r.width,height:r.height,fontSize:s.fontSize,color:s.color,background:s.backgroundColor,scrollWidth:a.scrollWidth,clientWidth:a.clientWidth},visibleLinks:[...document.querySelectorAll('a')].filter(n=>n.textContent.trim()===${JSON.stringify(label)}&&n.getClientRects().length).length}; })()`));
    await screen('entry-' + width);
  }
  assert.ok(evidence.geometry.every(item => item.visibleLinks === 1), 'Itinerary must show one prominent internal-control shortcut before selecting a vessel');
  for (const item of evidence.geometry) {
    assert.ok(item.scrollWidth <= item.width, 'page must not overflow horizontally');
    assert.ok(item.button.height >= 44 && parseFloat(item.button.fontSize) >= 16, 'shortcut must be larger than neighboring small controls');
    assert.ok(item.button.x >= 0 && item.button.x + item.button.width <= item.width && item.button.scrollWidth <= item.button.clientWidth, 'whole shortcut must fit the viewport');
  }
  evidence.cases.push('desktop/mobile visible large shortcut without overflow');
  const attrs = await evaluate(`(() => { const a = ${linkExpression}; return {href:a.href,target:a.target,rel:a.rel}; })()`);
  assert.equal(attrs.href, targetUrl); assert.equal(attrs.target, '_blank');
  assert.ok(attrs.rel.split(/\s+/).includes('noopener') && attrs.rel.split(/\s+/).includes('noreferrer'));
  evidence.cases.push('repository-subpath destination and protected new-tab attributes');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await evaluate("(() => { const n=document.querySelector('#ship-vessel-select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,n.options[1].value); n.dispatchEvent(new Event('change',{bubbles:true})); })()");
  await until(() => evaluate("Boolean(document.querySelector('.ship-latest-card'))"), 'selected vessel');
  await clickButton('從最新狀態修改');
  await until(() => evaluate("Boolean(document.querySelector('.ship-editor'))"), 'original editor');
  await evaluate("(() => { const n=document.querySelector('.ship-editor textarea'); if (!n) throw new Error('missing editor textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,'QA unsaved itinerary text'); n.dispatchEvent(new Event('input',{bubbles:true})); window.__qaDraftNode=n; })()");
  await until(() => evaluate("window.__qaDraftNode.value === 'QA unsaved itinerary text'"), 'unsaved draft input');
  const beforeTargets = new Set((await call('Target.getTargets', {}, null)).targetInfos.map(item => item.targetId));
  const point = await evaluate(`(() => { const a=${linkExpression}; const r=a.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  let destination;
  await until(async () => { destination = (await call('Target.getTargets', {}, null)).targetInfos.find(item => !beforeTargets.has(item.targetId) && item.url === targetUrl); return Boolean(destination); }, 'click opens actual new tab');
  const { sessionId: targetSession } = await call('Target.attachToTarget', { targetId: destination.targetId, flatten: true }, null);
  await call('Runtime.enable', {}, targetSession);
  await until(() => evaluate("document.readyState==='complete' && Boolean(document.querySelector('#root')?.childElementCount)", targetSession), 'destination application mounted');
  assert.match(await evaluate('document.title', targetSession), /船端內控.*訴求/);
  assert.equal(await evaluate('window.opener === null', targetSession), true);
  assert.equal(await evaluate('location.href'), sourceUrl);
  assert.equal(await evaluate("window.__qaDraftNode === document.querySelector('.ship-editor textarea') && window.__qaDraftNode.value === 'QA unsaved itinerary text'"), true, 'same original editor and unsaved text must survive navigation');
  evidence.cases.push('real click opens intake app in a separate tab and preserves original unsaved editor');
  await screen('editor-preserved');
  assert.deepEqual(evidence.errors, []);
  evidence.cases.push('no uncaught browser exceptions');
} catch (error) {
  failure = error; evidence.failure = error.stack || String(error);
} finally {
  if (ws?.readyState === WebSocket.OPEN) { await call('Browser.close', {}, null).catch(() => {}); ws.close(); }
  if (browser) { await until(() => browser.exitCode !== null, 'owned Chrome exit', 10000).catch(() => browser.kill()); }
  if (server) { if (built) await new Promise(resolve => server.httpServer.close(resolve)); else await server.close(); }
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  evidence.cleanup = { browserExited: !browser || browser.exitCode !== null, serverClosed: !server || !server.httpServer.listening, profileRemoved: !fs.existsSync(profile) };
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ output, built, cases: evidence.cases, geometry: evidence.geometry, cleanup: evidence.cleanup, result: failure ? 'FAIL' : 'PASS', failure: failure?.message }, null, 2));
}
if (failure) process.exitCode = 1;

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const output = fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT || os.tmpdir(), 'management-assignment-'));
const profile = path.join(output, 'chrome-profile');
const extraCount = Number(process.env.QA_EXTRA_VESSELS || 50);
assert.ok(Number.isInteger(extraCount) && extraCount >= 1 && extraCount <= 200);
const entry = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import Management from '/src/Management.tsx'; import { createInitialData } from '/src/data/seed.ts';
import { assignmentPrintFixture } from '/scripts/management-assignment-export-fixture.mjs';
import '/src/styles.css';
const data = assignmentPrintFixture(createInitialData(), ${extraCount});
const baseline = JSON.stringify(data); window.__qaWrites=0; window.__qaPrints=0; window.__qaData=data;
window.__qaUnchanged=()=>JSON.stringify(data)===baseline;
window.print=()=>window.__qaPrints++;
createRoot(document.getElementById('root')).render(React.createElement(Management,{data,currentUser:data.users[0],commit:()=>{window.__qaWrites++;throw Error('Read-only export must not commit');},onExport:()=>{},onImport:()=>{},onReset:()=>{},onCloudDownload:()=>{},captureCommitContext:()=>()=>true}));
`;
let server, browser, ws, sessionId, failure;
let sequence = 0;
const pending = new Map();
const evidence = { label: '真實 Management 元件＋測試資料；唯讀匯出，不接正式雲端', scenarios: [], errors: [], externalRequests: [], downloads: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (test, label, timeout = 25000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await test()) return; await wait(100); } throw Error('QA timeout: ' + label); };
const call = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const click = async (label, selector = 'button') => {
  const point = await evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(n=>(()=>{const c=n.cloneNode(true);c.querySelectorAll('i').forEach(x=>x.remove());return c.textContent.trim()})()===${JSON.stringify(label)}&&n.getClientRects().length&&!n.disabled);if(nodes.length!==1)throw Error('Button '+${JSON.stringify(label)}+': '+nodes.length);nodes[0].scrollIntoView({block:'center'});const r=nodes[0].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
};
const image = async name => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
try {
  server = await createServer({ base: '/', logLevel: 'error', cacheDir: path.join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
    name: 'management-assignment-local-only-qa',
    resolveId(id) { if (id === '/@qa/management-entry.js') return '\0management-assignment-entry.js'; },
    load(id) { if (id === '\0management-assignment-entry.js') return entry; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url !== '/__qa') return next();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(await vite.transformIndexHtml('/__qa', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local assignment export QA</title></head><body><div id="root"></div><script type="module" src="/@qa/management-entry.js"></script></body></html>'));
    }); },
  }] });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = spawn(process.env.QA_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  await until(() => fs.existsSync(path.join(profile, 'DevToolsActivePort')), 'Chrome readiness');
  const [port, socket] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
  ws = new WebSocket(`ws://127.0.0.1:${port}${socket}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const p = pending.get(message.id); if (!p) return; pending.delete(message.id); message.error ? p.reject(Error(message.error.message)) : p.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') evidence.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent') { const url = message.params.request.url; if (/^https?:/.test(url) && !url.startsWith(origin + '/')) evidence.externalRequests.push(url); }
    if (message.method === 'Browser.downloadWillBegin') evidence.downloads.push({ guid: message.params.guid, suggestedFilename: message.params.suggestedFilename, complete: false });
    if (message.method === 'Browser.downloadProgress' && message.params.state === 'completed') { const download = evidence.downloads.find(d => d.guid === message.params.guid); if (download) download.complete = true; }
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, null));
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Network.setBlockedURLs', { urls: ['https://*', 'http://*.supabase.co/*'] });
  await call('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: output, eventsEnabled: true }, null);
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin + '/__qa' });
  await until(() => evaluate("document.body.innerText.includes('分管表 PDF')"), 'real management component');
  await click('人員', '.management-sidebar button');
  await until(() => evaluate("document.querySelector('.management-sidebar button.active')?.textContent.includes('人員')"), 'person editor');
  await image('people-desktop');
  await click('測試督導甲', '.management-list-item b');
  await until(() => evaluate("document.querySelector('.management-form label input')?.value==='測試督導甲'"), 'selected person');
  await evaluate("void(window.__qaDraftInput=document.querySelector('.management-form label input'));window.__qaDraftInput.focus();window.__qaDraftInput.select();");
  await call('Input.insertText', { text: 'QA UNSAVED NAME' });
  await click('分管表 PDF');
  await until(() => evaluate("!!document.querySelector('.management-assignment-paper')"), 'PDF preview');
  evidence.rowCount = await evaluate("document.querySelectorAll('.management-assignment-paper tbody tr').length");
  assert.equal(evidence.rowCount, await evaluate('window.__qaData.vessels.filter(v=>v.isActive).length'));
  assert.match(await evaluate("document.querySelector('.management-assignment-paper').innerText"), /測試督導甲、林督乙 （測試代理丙\*）/);
  assert.ok(!(await evaluate("document.querySelector('.management-assignment-paper').innerText")).includes('QA UNSAVED NAME'));
  assert.ok(!(await evaluate("document.querySelector('.management-assignment-paper').innerText")).includes('來源版本'));
  assert.ok(await evaluate("document.querySelector('.management-assignment-modal').innerText.includes('A4 直向・單頁')"));
  await evaluate('document.fonts.ready');
  evidence.expectedNames = await evaluate("window.__qaData.vessels.filter(v=>v.isActive).map(v=>({chinese:v.name,english:v.fullName}))");
  evidence.departments = ['督導', '管理組', '資材組', '營業組', '航運處', '船員組', '海技組', '海技']; // configured inactive-only department must now also be shown
  evidence.layout = await evaluate(`(()=>{const paper=document.querySelector('.management-assignment-paper');const cells=[...paper.querySelectorAll('tbody tr:first-child td')];return {width:paper.getBoundingClientRect().width,height:paper.getBoundingClientRect().height,scale:Number(paper.style.getPropertyValue('--assignment-print-scale')),columns:cells.map(c=>c.getBoundingClientRect().width),overflow:[...paper.querySelectorAll('.assignment-cell-text')].flatMap(n=>{const r=document.createRange();r.selectNodeContents(n);return r.getBoundingClientRect().width>n.clientWidth+1?[{text:n.textContent,width:r.getBoundingClientRect().width,available:n.clientWidth}]:[]}),wrapping:[...paper.querySelectorAll('.assignment-cell-text')].some(n=>getComputedStyle(n).whiteSpace!=='nowrap')}})()`);
  assert.equal(evidence.layout.columns.length, 6 + evidence.departments.length);
  assert.ok(await evaluate("document.querySelector('.management-assignment-paper').innerText.includes('年份') && document.querySelector('.management-assignment-paper').innerText.includes('噸數') && document.querySelector('.management-assignment-paper').innerText.includes('2021.06') && document.querySelector('.management-assignment-paper').innerText.includes('2.0萬')"));
  evidence.mergedCells = await evaluate("[...document.querySelectorAll('.management-assignment-paper tbody td[rowspan]')].filter(cell=>cell.rowSpan>1).map(cell=>({text:cell.textContent,rows:cell.rowSpan}))");
  assert.ok(evidence.mergedCells.some(cell=>cell.text==='林管甲' && cell.rows===extraCount), 'adjacent office assignments merge without reordering ships');
  assert.ok(evidence.layout.width < 750 && evidence.layout.width > 740, 'fixed A4 portrait printable width');
  assert.ok(evidence.layout.columns[4] > evidence.layout.columns[5] * 2, 'supervisor column is wider than office columns');
  assert.deepEqual(evidence.layout.overflow, [], 'no hidden or overlapping cell text');
  assert.equal(evidence.layout.wrapping, true);
  evidence.allCellWrap = await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.management-assignment-paper .assignment-cell-text')],body=nodes.filter(n=>n.closest('tbody'));return {allWrap:nodes.every(n=>getComputedStyle(n).whiteSpace==='normal'),noInlineShrink:nodes.every(n=>n.style.fontSize===''),bodyFonts:[...new Set(body.map(n=>getComputedStyle(n).fontSize))],wrapped:body.filter(n=>n.getBoundingClientRect().height>parseFloat(getComputedStyle(n).lineHeight)+1).map(n=>n.textContent),contained:nodes.every(n=>{const range=document.createRange();range.selectNodeContents(n);const r=range.getBoundingClientRect(),cell=n.closest('td,th').getBoundingClientRect();return r.left>=cell.left-1&&r.right<=cell.right+1&&r.top>=cell.top-1&&r.bottom<=cell.bottom+1})}})()`);
  assert.equal(evidence.allCellWrap.allWrap, true, 'every cell must wrap regardless of department display label');
  assert.equal(evidence.allCellWrap.noInlineShrink, true, 'no individual cell may be forced to tiny single-line text');
  assert.equal(evidence.allCellWrap.bodyFonts.length, 1, 'all body cells retain the same base font size');
  assert.ok(evidence.allCellWrap.wrapped.some(text=>text.includes('測試督導甲')));
  assert.ok(evidence.allCellWrap.wrapped.some(text=>text.includes('未激活代理丁')), 'an ordinary office column must also really wrap');
  assert.equal(evidence.allCellWrap.contained, true);
  assert.ok(await evaluate("document.querySelector('.management-assignment-paper').innerText.includes('未激活代理丁') && !document.querySelector('.management-assignment-paper').innerText.includes('未激活代理丁*')"));
  assert.ok(evidence.layout.height * evidence.layout.scale <= 284 * 96 / 25.4 + 1, 'complete table fits A4 page height');
  await image('preview-desktop');
  await click('導出／列印 PDF');
  assert.equal(await evaluate('window.__qaPrints'), 1);
  await call('Emulation.setEmulatedMedia', { media: 'print' });
  evidence.printLayout = await evaluate(`(()=>{const p=document.querySelector('.management-assignment-paper'),s=getComputedStyle(p);return{classes:document.body.className,page:s.page,zoom:s.zoom,width:p.getBoundingClientRect().width,height:p.getBoundingClientRect().height,rules:[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules].filter(r=>r.type===6).map(r=>r.cssText))}})()`);
  assert.ok(evidence.printLayout.height <= 284 * 96 / 25.4 + 1, 'measured print height, including rounded borders, must fit one page');
  const pdf = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  await call('Emulation.setEmulatedMedia', { media: '' });
  fs.writeFileSync(path.join(output, 'management-assignments.pdf'), Buffer.from(pdf.data, 'base64'));
  await evaluate("window.dispatchEvent(new Event('afterprint'))");
  assert.equal(await evaluate("document.body.classList.contains('printing-management-assignments')"), false);
  assert.equal(await evaluate("document.querySelector('style[data-assignment-print-page]') === null"), true, 'portrait override must not affect later report printing');
  assert.equal(await evaluate('document.title'), 'Local assignment export QA');
  await click('關閉', '.management-assignment-modal button');
  assert.equal(await evaluate('document.activeElement.textContent.trim()'), '分管表 PDF');
  assert.equal(await evaluate("window.__qaDraftInput===document.querySelector('.management-form label input')&&window.__qaDraftInput.value==='QA UNSAVED NAME'"), true);
  await click('分管表 Excel');
  await until(() => evidence.downloads.filter(d => d.complete).length === 1, 'people XLSX download');
  evidence.scenarios.push('people tab: real preview, full fleet table, production print action + Chrome PDF, cleanup/focus and XLSX download; unsaved person edit excluded and same input preserved');
  await click('船舶', '.management-sidebar button');
  await until(() => evaluate("document.querySelector('.management-sidebar button.active')?.textContent.includes('船舶')"), 'vessel editor');
  await evaluate("(()=>{const input=[...document.querySelectorAll('.management-master input')].find(i=>i.placeholder.includes('搜尋'));if(!input)throw Error('search field missing');input.focus();input.select();})()");
  await call('Input.insertText', { text: 'NO MATCH QA' });
  await click('分管表 PDF');
  await until(() => evaluate("!!document.querySelector('.management-assignment-paper')"), 'vessel preview despite filtered list');
  assert.equal(await evaluate("document.querySelectorAll('.management-assignment-paper tbody tr').length"), evidence.rowCount);
  await click('關閉', '.management-assignment-modal button');
  await click('分管表 Excel');
  await until(() => evidence.downloads.filter(d => d.complete).length === 2, 'vessel XLSX download');
  evidence.scenarios.push('vessel tab: same export includes all active vessels even when search matches none');
  assert.equal(await evaluate("document.querySelector('input[aria-label=\"年份\"]') !== null && document.querySelector('input[aria-label=\"噸數\"]') !== null"), true, 'vessel management must expose maintainable year and tonnage labels');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await image('management-mobile');
  evidence.mobile = await evaluate("({viewport:innerWidth,width:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.management-assignment-export-actions button')].map(b=>({text:b.textContent,width:b.getBoundingClientRect().width,left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right}))})");
  assert.ok(evidence.mobile.buttons.every(b => b.width > 40 && b.left >= 0 && b.right <= evidence.mobile.viewport), 'export controls must fit the narrow viewport');
  assert.equal(await evaluate('window.__qaWrites'), 0);
  assert.equal(await evaluate('window.__qaUnchanged()'), true);
  evidence.scenarios.push('390px export controls remain accessible; no business mutation or cloud request');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.externalRequests, []);
  for (const [index, download] of evidence.downloads.entries()) fs.renameSync(path.join(output, download.guid), path.join(output, index === 0 ? 'people-download.xlsx' : 'vessels-download.xlsx'));
  evidence.status = 'PASS';
} catch (error) {
  failure = error; evidence.status = 'FAIL'; evidence.error = error.stack;
  try { evidence.failureText = await evaluate('document.body.innerText'); await image('failure'); } catch {}
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await call('Browser.close', {}, null); } catch {} ws.close(); }
  if (browser) { try { await until(() => browser.exitCode !== null, 'owned Chrome close', 5000); } catch { browser.kill(); } }
  if (server) await server.close();
  evidence.cleanup = { serverStopped: !server?.httpServer?.listening, chromeStopped: !browser || browser.exitCode !== null };
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: evidence.status, output, scenarios: evidence.scenarios, error: failure?.message, cleanup: evidence.cleanup }));
  if (failure) process.exitCode = 1;
}

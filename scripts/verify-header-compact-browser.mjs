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
const output = fs.mkdtempSync(path.join(evidenceRoot, 'header-compact-'));
const profile = path.join(output, 'chrome-profile');
const evidence = { layer: '原App頁首JSX/CSS＋測試身份；非正式登入或資料庫驗證', cases: [], errors: [], geometry: [] };
evidence.inputs=Object.fromEntries(['src/App.tsx','src/styles.css','scripts/verify-header-compact-browser.mjs'].map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
let server, browser, ws, sessionId, id = 0, failure;
const pending = new Map(), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await test()) return; await wait(80); } throw new Error('Timeout: ' + label); }
function call(method, params = {}, session = sessionId) { return new Promise((resolve, reject) => { const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(new Error('CDP timeout: ' + method)); }, 10000); pending.set(n, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } }); ws.send(JSON.stringify({ id: n, method, params, ...(session ? { sessionId: session } : {}) })); }); }
async function evaluate(expression) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
const screen = async name => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
const click = text => evaluate(`(() => { const n=[...document.querySelectorAll('button')].find(n=>(n.getAttribute('aria-label')||n.textContent.trim())===${JSON.stringify(text)}&&n.getClientRects().length&&!n.disabled); if(!n) throw new Error('Missing button '+${JSON.stringify(text)}); n.click(); })()`);
const app=fs.readFileSync('src/App.tsx','utf8');const start=app.indexOf('<header className="topbar no-print">'),end=app.indexOf('</header>',start)+9;
assert.ok(start>0&&end>start);const header=app.slice(start,end);evidence.headerSha256=createHash('sha256').update(header).digest('hex');
const constants=app.match(/const SYSTEM_TITLE = .*;/)[0]+'\n'+app.match(/const SYSTEM_SUBTITLE = .*;/)[0];
const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{canAccessTab}from'/src/taskWorkflow.ts';import{roleLabel}from'/src/utils.ts';import fpmcLogo from'/src/assets/fpmc-logo.png';import'/src/styles.css';
${constants}
window.__qaCalls=[];
function QA(){const[tab,setTab]=useState('total'),[role,setRole]=useState('owner');window.__qaRole=setRole;const currentUser={id:'qa-header',name:'測試使用者',role},myWorkTaskCount=125,canExportReports=role!=='vessel',canEnterManagement=role==='owner',requireManage=()=>role==='owner',navigateToTab=k=>{window.__qaCalls.push(k);setTab(k)},setPasswordModalOpen=()=>window.__qaCalls.push('password'),leaveCurrentIdentity=()=>window.__qaCalls.push('leave');return <div className="app">${header}<p className="qa-label">原App頁首JSX＋測試身份｜不連正式環境</p></div>}
createRoot(document.getElementById('root')).render(<QA/>);`;
const settle=()=>evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
const geometry=()=>evaluate(`(()=>{const nav=document.querySelector('.topbar-primary-nav'),n=nav.getBoundingClientRect();const box=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),t=document.createRange();t.selectNodeContents(el);return {left:r.left,right:r.right,width:r.width,textWidth:t.getBoundingClientRect().width,height:r.height,font:getComputedStyle(el).fontSize}};return {viewport:innerWidth,zoom:visualViewport.scale,document:document.documentElement.scrollWidth,nav:{left:n.left,right:n.right,width:nav.clientWidth,scroll:nav.scrollWidth},title:box('.brand b'),subtitle:box('.brand small'),brand:box('.brand'),identity:box('.user-chip'),buttons:[...nav.children].map(e=>({text:e.textContent,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,top:e.getBoundingClientRect().top,width:e.getBoundingClientRect().width,font:getComputedStyle(e).fontSize}))};})()`);
try {
  server = await createServer({ root: process.cwd(), base: '/', server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{ name: 'isolated-header-qa', configureServer(vite) { vite.middlewares.use((req, res, next) => { res.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:*"); if (req.url === '/__qa_header') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); void vite.transformIndexHtml('/__qa_header', '<!doctype html><html><head><meta charset="UTF-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{padding:0}.qa-label{padding:5px 8px;margin-bottom:6px;background:#fff0c5;color:#543c00;font-size:12px;font-weight:700}</style></head><body><div class="qa-label">真實 UI＋測試資料｜不連正式環境</div><div id="root"></div><script type="module" src="/@qa-header"></script></body></html>').then(html => res.end(html)).catch(next); } else next(); }); }, resolveId(source) { if (source === '/@qa-header') return '\0qa-header'; }, async load(source) { if (source === '\0qa-header') return ts.transpileModule(entry,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText; } }] });
  await server.listen(); await server.transformRequest('/@qa-header'); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = spawn(process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let port, socketPath;
  await until(() => { try { [port, socketPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); return /^\d+$/.test(port) && socketPath?.startsWith('/devtools/browser/'); } catch (e) { if (['ENOENT', 'EBUSY', 'EPERM'].includes(e.code)) return false; throw e; } }, 'owned Chrome');
  ws = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`); await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else if (m.method === 'Log.entryAdded') evidence.errors.push(m.params.entry.text+' '+(m.params.entry.url||'')); else if (m.method === 'Runtime.consoleAPICalled' && m.params.type==='error') evidence.errors.push(JSON.stringify(m.params.args)); else if (m.method === 'Runtime.exceptionThrown') evidence.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null); ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, null)); await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await call('Page.navigate', { url: origin + '/__qa_header' });
  await until(() => evaluate("Boolean(document.querySelector('.topbar-primary-nav'))"), 'original header mounted');
  await evaluate('document.fonts.ready'); await settle();


  for(const width of [1366,1421,1440,1536,1920]){await call('Emulation.setDeviceMetricsOverride',{width,height:240,deviceScaleFactor:1,mobile:false});await settle();evidence.geometry.push(await geometry());await screen('header-'+width);}
  const expected=['船隊看板','早會工作台','臨會/專題','我的待辦（125）','待辦總表','已結案','內控異常','配件/物料/工程','報告中心','數據','管理'];
  for(const g of evidence.geometry){assert.deepEqual(g.buttons.map(b=>b.text),expected,'only the two requested navigation labels shortened');assert.ok(g.nav.scroll<=g.nav.width+1,`${g.viewport}: all authorized tabs visible at 100%`);assert.equal(g.zoom,1);assert.ok(g.buttons.every(b=>b.left>=g.nav.left-1&&b.right<=g.nav.right+1),'every tab is inside the visible nav');assert.ok(Math.abs(g.subtitle.textWidth-g.title.textWidth)<=2,'English subtitle width follows Chinese brand');assert.ok(g.subtitle.height<=g.title.height,'English subtitle stays on one compact line');assert.ok(g.document<=g.viewport);}
  evidence.cases.push('desktop five viewports full navigation and compact English brand');
  for(const [label,id] of [['配件/物料/工程','tracking'],['數據','stats'],['管理','management']]){await click(label);assert.equal(await evaluate('window.__qaCalls.at(-1)'),id);}
  evidence.cases.push('renamed buttons retain original navigation IDs');
  await evaluate("window.__qaRole('operator')");await settle();assert.equal(await evaluate("[...document.querySelectorAll('.topbar-primary-nav button')].some(n=>n.textContent==='管理')"),false);
  await evaluate("window.__qaRole('owner')");await call('Emulation.setDeviceMetricsOverride',{width:390,height:600,deviceScaleFactor:1,mobile:false});await settle();await evaluate("document.querySelector('.topbar-primary-nav').scrollLeft=9999");await settle();await screen('header-390');const mobile=await geometry();assert.ok(mobile.document<=390);assert.ok(mobile.buttons.at(-1).left>=mobile.nav.left-1&&mobile.buttons.at(-1).right<=mobile.nav.right+1,'mobile Management is in the visible nav after scrolling');assert.deepEqual(evidence.errors,[]);evidence.cases.push('operator permissions preserved, mobile navigation reachable, no console errors');
} catch (error) { failure = error; evidence.failure = error.stack || String(error); evidence.dom = await evaluate('document.body.innerText').catch(()=>null); await screen('failure').catch(()=>{}); }
finally {
  if (ws?.readyState === WebSocket.OPEN) { await call('Browser.close', {}, null).catch(() => {}); ws.close(); }
  if (browser) await until(() => browser.exitCode !== null, 'owned browser exit', 10000).catch(() => browser.kill());
  if (server) await server.close(); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  evidence.cleanup = { browserExited: !browser || browser.exitCode !== null, serverClosed: !server || !server.httpServer.listening, profileRemoved: !fs.existsSync(profile) }; fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ output, result: failure ? 'FAIL' : 'PASS', cases: evidence.cases, geometry: evidence.geometry.map(g=>({viewport:g.viewport,nav:g.nav,title:g.title,subtitle:g.subtitle,last:g.buttons.at(-1)})), cleanup: evidence.cleanup, failure: failure?.message }, null, 2));
}
if (failure) process.exitCode = 1;

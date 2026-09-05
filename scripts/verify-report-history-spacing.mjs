import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Real production component + CSS, isolated fixtures; no cloud/network calls.
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'report-spacing-'));
const vite = await createServer({ server:{middlewareMode:true}, appType:'custom', logLevel:'silent' });
let chrome, ws;
try {
  const { MorningDailyHistoryPanel } = await vite.ssrLoadModule('/src/ReportDailyHistories.tsx');
  const reports = Array.from({length:3}, (_,i)=>({id:`qa-${i}`, businessDate:`2026-09-0${4-i}`, title:`2026年9月${4-i}日早會內容`, updatedAt:'2026-09-04T00:39:00.000Z', createdAt:'2026-09-04T00:39:00.000Z', source:'manual', vesselIds:Array(39).fill('qa'), taskCount:66}));
  const markup=renderToStaticMarkup(React.createElement(MorningDailyHistoryPanel,{reports,onOpen:()=>{}}));
  const css=await fs.readFile('src/styles.css','utf8');
  const html=path.join(tmp,'qa.html');
  await fs.writeFile(html,`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div style="padding:8px 14px;color:#8b2438;font-weight:bold">真實UI＋測試資料｜不連 production</div><main style="padding:12px;max-width:1000px">${markup}</main></body></html>`);
  const exe=process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  chrome=spawn(exe,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${path.join(tmp,'profile')}`,'--no-first-run','--disable-gpu','about:blank'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Chrome startup timeout')),15000);chrome.stderr.on('data',b=>{out+=b;const m=out.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});chrome.on('error',reject);});
  const port=new URL(endpoint).port;
  const target=await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pathToFileURL(html).href)}`,{method:'PUT'})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0;const pending=new Map();ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){const {resolve,reject,timer}=pending.get(m.id);clearTimeout(timer);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error(method+' timeout'));},10000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  await evaluate("document.fonts.ready.then(()=>true)");
  for(const width of [1000,600,390]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const geometry=await evaluate(`(()=>{const panel=document.querySelector('.morning-daily-history-panel'),row=panel.querySelector('.saved-report'),heading=panel.querySelector('h2'),text=row.firstElementChild,button=row.querySelector('button');const p=panel.getBoundingClientRect(),r=row.getBoundingClientRect(),t=text.getBoundingClientRect(),b=button.getBoundingClientRect(),h=heading.getBoundingClientRect();return {left:t.left-r.left,right:r.right-b.right,aligned:Math.abs(t.left-h.left),gap:b.left-t.right,rowHeight:r.height,overflow:document.documentElement.scrollWidth>innerWidth,buttonOverflow:button.scrollWidth>button.clientWidth+1};})()`);
    console.log(JSON.stringify({width,...geometry}));
    assert.ok(geometry.left>=14 && geometry.right>=14,'history rows need symmetric >=14px side gutters');
    assert.ok(geometry.aligned<=1,'row text should align with heading');
    assert.ok(geometry.gap>=10,'text and action need separation');
    assert.equal(geometry.overflow,false);assert.equal(geometry.buttonOverflow,false);
    if(process.env.QA_SCREENSHOT_DIR){await fs.mkdir(process.env.QA_SCREENSHOT_DIR,{recursive:true});const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.QA_SCREENSHOT_DIR,`history-${width}.png`),Buffer.from(shot.data,'base64'));}
  }
  console.log('report_history_spacing=PASS');
} finally {
  ws?.close();
  if(chrome && chrome.exitCode===null){const exited=new Promise(r=>chrome.once('exit',r));chrome.kill();await exited;}
  await vite.close();
  await fs.rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}

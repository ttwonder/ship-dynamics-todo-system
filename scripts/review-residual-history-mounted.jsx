import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import ReportDailyHistories from '../src/ReportDailyHistories.tsx';
const assert=(v,m)=>{if(!v)throw Error(m);};
const tick=()=>new Promise(r=>setTimeout(r,25));
const until=async(f,m)=>{for(let i=0;i<120;i++){if(f())return;await tick();}throw Error(m);};
export async function run(){
 const host=document.createElement('div');document.body.append(host);let root=createRoot(host);let mode='normal',calls=[];
 const summary={reportId:'1',businessDate:'2026-09-25',generatedAt:'2026-09-25T01:00:00Z',generatedBy:'manual',vesselCount:0,rowCount:0};
 const page={items:[summary],page:1,pageCount:1,pageSize:30,dateTotal:1,reportTotal:1,total:1,setToken:'qa-set'};
 window.__historyIO={async list(){calls.push('list');return structuredClone(page);},async load(){calls.push('load');if(mode==='load-failure')throw Error('QA_SNAPSHOT_LOAD_FAILURE');return {...summary,snapshot:{vessels:[]}};},async locate(){calls.push('locate');if(mode==='locate-failure')throw Error('QA_LOCATE_FAILURE');return {found:mode!=='empty',page:mode==='empty'?null:1,setToken:'qa-set'};}};
 const button=t=>[...host.querySelectorAll('button')].find(n=>n.textContent===t);
 const click=t=>{assert(button(t),'missing '+t);flushSync(()=>button(t).click());};
 const mount=async()=>{flushSync(()=>root.render(<ReportDailyHistories actorUserId="qa-owner" morningReports={[]} onOpenMorning={()=>{}}/>));await until(()=>button('檢視橫版 PDF'),'list ready');};
 const reset=async()=>{flushSync(()=>root.unmount());root=createRoot(host);calls=[];await mount();};
 const setDate=()=>{const n=host.querySelector('input[aria-label="每日 Itinerary 記錄日期"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(n,'2026-09-25');flushSync(()=>n.dispatchEvent(new Event('input',{bubbles:true})));};
 const clickLocate=()=>flushSync(()=>host.querySelector('.itinerary-daily-history-panel .daily-report-date-locator button').click());
 const cases=[];
 try{
  await mount();click('檢視橫版 PDF');await until(()=>document.querySelector('.itinerary-daily-report-preview')||document.querySelector('[role="dialog"]'),'normal actual preview');
  cases.push({caseId:'normal-load',status:'PASS',previewShown:true,calls:[...calls]});document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();
  await reset();mode='load-failure';click('檢視橫版 PDF');await until(()=>calls.includes('load')&&!button('載入中…'),'failure refresh finished');await tick();await tick();
  const swallowed=!host.textContent.includes('QA_SNAPSHOT_LOAD_FAILURE')&&!host.querySelector('[role=alert]');assert(!swallowed&&host.textContent.includes('QA_SNAPSHOT_LOAD_FAILURE'),'snapshot load failure must remain visible');assert(!document.querySelector('[role=dialog]'),'failure must not open preview');
  cases.push({caseId:'load-error-auto-refresh',status:'PASS',calls:[...calls],alertText:host.querySelector('[role=alert]')?.textContent??'',previewShown:false,visibleText:host.innerText});
  mode='empty';await reset();setDate();clickLocate();await until(()=>host.textContent.includes('所選日期沒有保存記錄'),'normal empty result');assert(!host.querySelector('[role=alert]'),'normal empty no query error');cases.push({caseId:'normal-empty',status:'PASS',notice:'所選日期沒有保存記錄',alertText:''});
  mode='locate-failure';await reset();setDate();clickLocate();await until(()=>host.textContent.includes('QA_LOCATE_FAILURE'),'real failure shown');await tick();assert(!host.textContent.includes('所選日期沒有保存記錄'),'failed locate must not report not-found');
  cases.push({caseId:'failed-locate-false-empty',status:'PASS',alertText:host.querySelector('[role=alert]')?.textContent,statusText:host.querySelector('.itinerary-daily-history-panel [role=status]')?.textContent,calls:[...calls]});
  mode='normal';await reset();setDate();clickLocate();await until(()=>host.textContent.includes('已定位 2026-09-25'),'normal located');assert(!host.querySelector('[role=alert]'));cases.push({caseId:'normal-found',status:'PASS',notice:'已定位 2026-09-25'});
  return {id:'R6b-F3',status:'PASS',layer:'Original complete ReportDailyHistories + original children mounted in Chrome; controlled API callbacks/context only, no SQL or hosted',cases};
 }finally{flushSync(()=>root.unmount());host.remove();delete window.__historyIO;}
}

import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Manual from '../src/ManualItineraryReportSaveButton.tsx';
import History from '../src/ReportDailyHistories.tsx';
import DataView from '../src/ItineraryReportDataView.tsx';
import * as api from '../src/itineraryDailyReports.ts';
export async function run(){
 const assert=(v,m)=>{if(!v)throw new Error(m);},tick=()=>new Promise(r=>setTimeout(r,15));
 const until=async(f,m)=>{for(let i=0;i<150;i++){if(f())return;await tick();}throw new Error(m);};
 const original={fetch:window.fetch,config:window.SHIP_DYNAMICS_SUPABASE_CONFIG,alert:window.alert,confirm:window.confirm};
 const cfg={supabaseUrl:location.origin,supabaseAnonKey:'report-probe',workspaceKey:'report-probe',tableName:'ship_dynamics_app_state',storageMode:'legacy'};
 const host=document.createElement('div');document.body.append(host);let root=createRoot(host),saved=0,queue=[],alerts=[],calls=[],cases=[];
 const summary={reportId:'9007199254740993',businessDate:'2026-09-06',timezone:'Asia/Taipei',generatedAt:'2026-09-06T01:00:00Z',generatedBy:'manual',generatedByActorId:'owner',vesselCount:0,rowCount:0,sourceMaxRevision:7,logicalBytes:50};
 const page={ok:true,reports:[summary],page:1,pageSize:30,pageCount:1,total:1,dateTotal:1,reportTotal:1,setToken:'a'.repeat(32)};
 let hold='',currentPage=page;
 window.fetch=async(url,init)=>{
  const name=new URL(url).pathname.split('/').pop(),body=JSON.parse(init.body);calls.push({name,body});
  let value=name.includes('list')?currentPage:name.includes('load')?{ok:true,report:{...summary,snapshot:{schemaVersion:1,businessDate:summary.businessDate,timezone:'Asia/Taipei',vessels:[]}}}:name.includes('delete')?{ok:true,operationId:body.p_operation_id,deletedReportIds:body.p_delete_report_ids,deletedCount:1,deletedBytes:50,remainingReportCount:0,remainingSetToken:'b'.repeat(32)}:{ok:true,operationId:body.p_operation_id,created:true,report:summary};
  if(hold&&name.includes(hold))await new Promise(resolve=>queue.push({resolve,name,body}));
  return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
 };
 window.alert=m=>alerts.push(m);window.confirm=()=>true;
 let currentConfig=cfg;
 const render=(Component,config=cfg,actor='owner')=>{currentConfig=config;window.SHIP_DYNAMICS_SUPABASE_CONFIG=config;flushSync(()=>root.render(React.createElement(Component,Component===Manual?{actorUserId:actor,onSaved:()=>saved++}:Component===History?{actorUserId:actor,morningReports:[],onOpenMorning:()=>{}}:{currentUser:{id:actor,role:'owner',isActive:true}})));};
 const reset=()=>{flushSync(()=>root.unmount());host.replaceChildren();root=createRoot(host);hold='';queue=[];alerts=[];calls=[];currentPage=page;};
 const click=t=>{const n=[...host.querySelectorAll('button')].find(n=>n.textContent===t);assert(n,'missing '+t+' '+host.innerText);flushSync(()=>n.click());};
 try{
  for(const change of ['mode','key','actor']){
   reset();render(Manual);await tick();const button=host.querySelector('button'),oldClick=button[Object.keys(button).find(k=>k.startsWith('__reactProps'))].onClick;hold='save_manual';click('手動保存目前 Itinerary');await until(()=>queue.length===1,'deferred manual RPC');
   const old=api.readPendingManualItineraryReportSave(cfg,'owner');assert(old,'old intent durable before RPC');
   const next=change==='mode'?{...cfg,storageMode:'records-v1'}:change==='key'?{...cfg,supabaseAnonKey:'rotated'}:cfg,actor=change==='actor'?'other-owner':'owner';
   render(Manual,next,actor);await tick();const requestCount=calls.length;oldClick();await tick();assert(calls.length===requestCount,'stale '+change+' callback sent RPC');const successor=api.createPendingManualItineraryReportSave({actorUserId:actor,operationId:crypto.randomUUID()},next);api.writePendingManualItineraryReportSave(successor,next);
   const before=saved;queue.shift().resolve();await tick();await tick();assert(saved===before&&alerts.length===0,'late '+change+' manual ACK published success');
   assert(api.readPendingManualItineraryReportSave(next,actor)?.operationId===successor.operationId,'late ACK erased successor intent');
   api.clearPendingManualItineraryReportSave(cfg,'owner');api.clearPendingManualItineraryReportSave(next,actor);
   cases.push('mounted manual '+change+' switch fences late ACK and retains successor pending');
  }
  reset();hold='list';render(History);await until(()=>queue.length===1,'history initial pending');
  currentPage={...page,reports:[],total:0,dateTotal:0,reportTotal:0};hold='';render(History,{...cfg,storageMode:'records-v1'});await until(()=>calls.length===2,'mode must refresh original history');queue.shift().resolve();await tick();await tick();assert(!host.querySelector('.itinerary-daily-history-panel .saved-report'),'late history page leaked into new mode');
  cases.push('mounted history mode refresh fences old list success');
  reset();render(History);await until(()=>host.querySelector('button')&&host.innerText.includes('檢視橫版 PDF'),'history page');hold='load';click('檢視橫版 PDF');await until(()=>queue.length===1,'pending preview');render(History,{...cfg,supabaseAnonKey:'rotated'});await tick();queue.shift().resolve();await tick();await tick();assert(!document.querySelector('.itinerary-daily-report-modal'),'old-key snapshot opened on new history page');hold='';click('檢視橫版 PDF');await until(()=>document.querySelector('.itinerary-daily-report-modal'),'fresh preview positive control');document.querySelector('.itinerary-daily-report-modal .btn.ghost').click();await tick();
  cases.push('mounted original history key rotation fences late preview');
  reset();render(DataView);await until(()=>host.querySelector('input[type=checkbox]'),'DataView ready');flushSync(()=>host.querySelector('input[type=checkbox]').click());await tick();hold='delete';click('刪除所選 1 份');await until(()=>queue.length===1,'pending exact deletion');const old=api.readPendingItineraryDailyReportDelete(cfg,'owner');assert(old,'delete intent persisted');
  currentPage={...page,reports:[],total:0,dateTotal:0,reportTotal:0};render(DataView,{...cfg,storageMode:'records-v1'});await tick();queue.shift().resolve();await tick();await tick();assert(!host.innerText.includes('已刪除：'),'old deletion success leaked');assert(api.readPendingItineraryDailyReportDelete(cfg,'owner')?.operationId===old.operationId,'late old deletion cleared original pending');api.clearPendingItineraryDailyReportDelete(cfg,'owner');
  cases.push('mounted DataView mode change fences old deletion and retains original recovery');
  return {layer:'mounted original report components, controlled deferred transport (not SQL)',cases};
 }finally{flushSync(()=>root.unmount());host.remove();window.fetch=original.fetch;window.SHIP_DYNAMICS_SUPABASE_CONFIG=original.config;window.alert=original.alert;window.confirm=original.confirm;for(const q of queue)q.resolve();}
}

import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import DataView from '../src/ItineraryReportDataView.tsx';
export async function run(){
 const assert=(v,m)=>{if(!v)throw new Error(m);},tick=()=>new Promise(r=>setTimeout(r,15));
 const until=async(f,m)=>{for(let i=0;i<160;i++){if(f())return;await tick();}throw new Error(m);};
 const original={fetch:window.fetch,config:window.SHIP_DYNAMICS_SUPABASE_CONFIG,confirm:window.confirm};
 const cfg={supabaseUrl:location.origin,supabaseAnonKey:'report-probe',workspaceKey:'report-delete-probe',tableName:'ship_dynamics_app_state',storageMode:'records-v1'};
 const host=document.createElement('div');document.body.append(host);let root=createRoot(host),held=false,queue=[],calls=[],cases=[],source={managed:true,source:'legacy',epoch:1,pauseState:'resumed',admitted:true};
 const report={reportId:'3',businessDate:'2026-09-06',timezone:'Asia/Taipei',generatedAt:'2026-09-06T01:00:00Z',generatedBy:'manual',generatedByActorId:'owner',vesselCount:0,rowCount:0,sourceMaxRevision:7,logicalBytes:50};
 window.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').pop(),body=JSON.parse(init.body);
 if(name==='read_ship_dynamics_browser_authority_v1'){if(held)await new Promise(resolve=>queue.push(resolve));return new Response(JSON.stringify({workspace:body.p_workspace_key,...source}),{headers:{'Content-Type':'application/json'}});}
 calls.push({name,body});if(name.includes('delete')&&failNextDelete){failNextDelete=false;return new Response(JSON.stringify({code:'QA_LOST_ACK'}),{status:503,headers:{'Content-Type':'application/json'}});}return new Response(JSON.stringify(name.includes('list')?{ok:true,reports:[report],page:1,pageSize:30,pageCount:1,total:1,dateTotal:1,reportTotal:1,setToken:'a'.repeat(32)}:{ok:true,operationId:body.p_operation_id,deletedReportIds:body.p_delete_report_ids,deletedCount:1,deletedBytes:50,remainingReportCount:0,remainingSetToken:'b'.repeat(32)}),{headers:{'Content-Type':'application/json'}});};
 window.confirm=()=>true;let failNextDelete=false;
 const render=(config=cfg,actor='owner',role='owner')=>{window.SHIP_DYNAMICS_SUPABASE_CONFIG=config;flushSync(()=>root.render(React.createElement(DataView,{currentUser:{id:actor,role,isActive:true}})));};
 const stored=()=>Object.keys(localStorage).filter(k=>k.includes('daily-itinerary-report-delete:')&&k.includes('report-delete-probe'));
 const click=t=>{const b=[...host.querySelectorAll('button')].find(n=>n.textContent===t);assert(b&&!b.disabled,'ready '+t);flushSync(()=>b.click());};
 const reset=()=>{flushSync(()=>root.unmount());root=createRoot(host);held=false;queue=[];calls=[];for(const k of stored())localStorage.removeItem(k);source={managed:true,source:'legacy',epoch:1,pauseState:'resumed',admitted:true};};
 const ready=async()=>{render();await until(()=>host.querySelector('input[type=checkbox]'),'report list ready');flushSync(()=>host.querySelector('input[type=checkbox]').click());await tick();};
 try{
 for(const change of ['config','actor','role','unmount']){
 reset();await ready();held=true;click('刪除所選 1 份');await until(()=>queue.length||calls.some(c=>c.name.includes('delete')),'source capture or wrong dispatch');
 assert(queue.length===1&&!calls.some(c=>c.name.includes('delete')),'fresh delete bypassed source discovery');
 if(change==='unmount'){flushSync(()=>root.unmount());root=createRoot(host);}else render(change==='config'?{...cfg,supabaseAnonKey:'rotated'}:cfg,change==='actor'?'other':'owner',change==='role'?'admin':'owner');
 held=false;for(const release of queue.splice(0))release();await tick();await tick();
 assert(!calls.some(c=>c.name.includes('delete'))&&stored().length===0,'stale capture persisted or dispatched');cases.push('RDEL-CAPTURE-'+change);
 }
 for(const state of ['paused','unadmitted','invalid']){
 reset();await ready();source=state==='invalid'?{managed:true,source:'unknown',epoch:1,pauseState:'resumed',admitted:true}:{managed:true,source:'legacy',epoch:1,pauseState:state==='paused'?'paused':'resumed',admitted:false};
 click('刪除所選 1 份');await tick();await tick();assert(!calls.some(c=>c.name.includes('delete'))&&stored().length===0,'unadmitted fresh intent persisted or dispatched');cases.push('RDEL-REJECT-'+state);
 }
 reset();await ready();click('刪除所選 1 份');await until(()=>host.textContent.includes('已刪除：'),'normal source-bound confirmation');assert(calls.filter(c=>c.name.includes('delete')).length===1&&calls.find(c=>c.name.includes('delete')).name==='delete_sd_itinerary_daily_report_records'&&stored().length===0,'normal captured legacy route');cases.push('RDEL-CAPTURE-CONTROL');
 reset();await ready();failNextDelete=true;click('刪除所選 1 份');await until(()=>host.textContent.includes('對帳上次操作'),'unknown operation pending');
 const pendingKey=stored()[0],pendingRaw=localStorage.getItem(pendingKey);assert(pendingRaw,'natural pending written');
 source={managed:false,source:null,epoch:0,pauseState:'unmanaged',admitted:true};flushSync(()=>root.unmount());root=createRoot(host);render();await until(()=>host.textContent.includes('對帳上次操作'),'reloaded pending before fresh authority');click('對帳上次操作');await until(()=>host.textContent.includes('上次刪除已對帳'),'bound replay after authority change');
 const deletionCalls=calls.filter(c=>c.name.includes('delete'));assert(deletionCalls.length===2&&deletionCalls.every(c=>c.name==='delete_sd_itinerary_daily_report_records')&&JSON.stringify(deletionCalls[0].body)===JSON.stringify(deletionCalls[1].body),'authority drift rebound original operation');assert(stored().length===0,'matching replay clears original pending');cases.push('RDEL-AUTHORITY-DRIFT-REPLAY');
 reset();const bad={...JSON.parse(pendingRaw),sourceAuthority:{source:'unknown'}};localStorage.setItem(pendingKey,JSON.stringify(bad));render();await until(()=>host.textContent.includes('對帳上次操作'),'unsupported source protected');click('對帳上次操作');await tick();await tick();assert(!calls.some(c=>c.name.includes('delete'))&&localStorage.getItem(pendingKey)===JSON.stringify(bad),'unsupported binding dispatched or erased');cases.push('RDEL-UNSUPPORTED-PROTECTED');
 return {layer:'mounted-original-component-controlled-transport-not-SQL',cases};
 }finally{flushSync(()=>root.unmount());host.remove();for(const release of queue)release();for(const k of stored())localStorage.removeItem(k);window.fetch=original.fetch;window.SHIP_DYNAMICS_SUPABASE_CONFIG=original.config;window.confirm=original.confirm;}
}

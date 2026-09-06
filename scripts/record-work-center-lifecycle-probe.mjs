import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import WorkCenter from '../src/WorkCenter.tsx';
export async function run(fixture){
 const cases=[],assert=(x,m)=>{if(!x)throw new Error(m);},tick=()=>new Promise(r=>setTimeout(r,10));
 const outcomes=['committed','rejected','throw','decline','actor-same-name','epoch','actor-ABA','config','config-ABA','view','view-ABA','scope','filter','permission','selection','unmount'];
 const originalConfirm=window.confirm;window.confirm=()=>true;
 try{for(const action of ['dismiss','complete','delete'])for(const outcome of outcomes){
  const base=structuredClone(fixture),user=base.users[0],template=base.tasks.find(t=>t.id==='qa-personal-task');
  const originals=['one','new'].map((id,i)=>({...structuredClone(template),id,description:'MOUNTED '+id,vesselId:i===0?'qa-v1':'qa-v2',vesselIds:[i===0?'qa-v1':'qa-v2'],ownerUserIds:[user.id]}));
  const item={...base.internalControlCases.find(c=>c.id==='qa-personal-case'),id:'two',description:'MOUNTED two'};
  let data={...base,tasks:originals,internalControlCases:[item],taskDismissals:[]},vessels=base.vessels,identity='actor-a|epoch-a|session-1|config-a|work',liveIdentity=identity,canComplete=true,canDelete=true,settle,reject,calls=0;
  const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
  const callback=(ids,caseIds)=>{calls++;assert(ids.join(',')==='one'&&caseIds.join(',')==='two','exact distinct task/case IDs');if(outcome==='decline')return false;return new Promise((r,j)=>{settle=r;reject=j;});};
  const render=()=>{const captured=identity;flushSync(()=>root.render(React.createElement(WorkCenter,{data,user,vessels,onOpenTask:()=>{},onOpenInternalControl:()=>{},onOpenVessel:()=>{},markAllRead:()=>{},canComplete,canDelete,canPrint:true,onPrint:()=>{},onBatchComplete:callback,onBatchDelete:callback,onDismiss:callback,batchContext:{identity:captured,isCurrent:()=>liveIdentity===captured}})));};
  const row=id=>[...host.querySelectorAll('.work-task-row')].find(n=>n.querySelector('.task-link')?.textContent==='MOUNTED '+id);
  const count=()=>host.querySelector('.batch-selection-count')?.textContent;
  const toggle=async id=>{row(id).querySelector('input').click();await tick();};
  const button=()=>[...host.querySelectorAll('button')].find(n=>n.textContent.trim()===(action==='complete'?'批量完成（2）':action==='delete'?'永久刪除共用待辦（2）':'從我的待辦移除（2）'));
  try{
   render();await tick();assert(count()==='已選 0','empty');await toggle('one');await toggle('two');button().click();await tick();assert(calls===1,'one dispatch');
   if(outcome==='decline'){assert(count()==='已選 2','decline selection');cases.push(action+' '+outcome);continue;}
   data={...data,tasks:originals.filter(t=>t.id==='new'),internalControlCases:[]};render();await tick();assert(count()==='已選 2','optimistic rows before ACK');assert(row('one').querySelector('input').checked&&row('two').querySelector('input').checked,'retained rows');button().click();await tick();assert(calls===1,'no repeated pending submission');
   if(['actor-same-name','epoch','actor-ABA','config','config-ABA','view','view-ABA'].includes(outcome)){identity=liveIdentity=outcome+'|successor';data={...data,tasks:originals,internalControlCases:[item]};render();await tick();assert(count()==='已選 0','identity reset');await toggle('new');}
   else if(outcome==='scope'){vessels=base.vessels.filter(v=>v.id==='qa-v2');render();await tick();assert(!row('one')&&!row('two'),'no stale out-of-scope row');await toggle('new');}
   else if(outcome==='filter'){const input=host.querySelector('[aria-label="我的待辦關鍵字"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'new');input.dispatchEvent(new Event('input',{bubbles:true}));await tick();assert(!row('one')&&!row('two'),'filter removes old projection');await toggle('new');}
   else if(outcome==='permission'){canComplete=canDelete=false;render();await tick();await toggle('new');}
   else if(outcome==='selection'){await toggle('one');await toggle('two');await toggle('new');}
   else if(outcome==='unmount'){flushSync(()=>root.unmount());root=createRoot(host);data={...data,tasks:originals,internalControlCases:[item]};render();await tick();await toggle('new');}
   if(outcome==='throw')reject(new Error('unknown callback'));else settle(outcome!=='rejected');await tick();await tick();
   assert(count()===(outcome==='committed'?'已選 0':['rejected','throw'].includes(outcome)?'已選 2':'已選 1'),action+' '+outcome+' late outcome: '+count());assert(!host.querySelector('[batchcontext]')&&!host.innerHTML.includes(identity),'internal identity must not enter DOM');cases.push(action+' '+outcome);
  }finally{settle?.(false);flushSync(()=>root.unmount());host.remove();}
 }}finally{window.confirm=originalConfirm;}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  const user=fixture.users[0],template=fixture.tasks.find(t=>t.id==='qa-personal-task');
  const tasks=Array.from({length:12},(_,i)=>({...template,id:'page-'+i,description:'PAGED '+i,ownerUserIds:[user.id]}));let submitted=[];
  flushSync(()=>root.render(React.createElement(WorkCenter,{data:{...fixture,tasks,internalControlCases:[],taskDismissals:[]},user,vessels:fixture.vessels,onOpenTask:()=>{},onOpenInternalControl:()=>{},onOpenVessel:()=>{},markAllRead:()=>{},canComplete:true,canDelete:true,canPrint:true,onPrint:()=>{},onBatchComplete:ids=>{submitted=ids;return true;},onDismiss:()=>false,onBatchDelete:()=>false,batchContext:{identity:'pagination',isCurrent:()=>true}})));await tick();assert(host.querySelectorAll('.work-task-row').length===10,'original page size');[...host.querySelectorAll('button')].find(n=>n.textContent==='全選目前結果').click();await tick();assert(host.querySelector('.batch-selection-count').textContent==='已選 12','all current results not only page');[...host.querySelectorAll('button')].find(n=>n.textContent==='批量完成（12）').click();await tick();assert(submitted.length===12&&new Set(submitted).size===12,'all pages exact once');cases.push('full-result selection across original pagination');
 }finally{flushSync(()=>root.unmount());host.remove();}
 assert(cases.length===49,'matrix count');return{layer:'original WorkCenter mounted with controlled callbacks; not App auth or SQL',count:cases.length,cases};
}

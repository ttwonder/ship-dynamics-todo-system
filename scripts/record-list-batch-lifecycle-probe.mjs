import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {ListPanel} from '../src/App.tsx';
export async function run(fixture){
 const cases=[],assert=(x,m)=>{if(!x)throw new Error(m);},tick=()=>new Promise(r=>setTimeout(r,10));
 const outcomes=['committed','rejected','throw','decline','actor-same-name','epoch','actor-ABA','config','config-ABA','view','view-ABA','scope','filter','permission','selection','unmount'];
 for(const action of ['complete','delete'])for(const outcome of outcomes){
  const base=structuredClone(fixture),template=base.tasks.find(t=>t.id==='qa-unrelated-task');
  const originals=['one','two','new'].map((id,i)=>({...structuredClone(template),id,description:'MOUNTED '+id,vesselId:i===0?'qa-v1':'qa-v2',vesselIds:[i===0?'qa-v1':'qa-v2'],isClosed:action==='delete'}));
  base.tasks=originals;
  let tasks=originals,vessels=base.vessels,identity='actor-a|epoch-a|session-1|config-a|total',liveIdentity=identity,canComplete=true,canDelete=true,settle,reject,calls=0;
  let filters={keyword:'',departments:[],vesselIds:[],fleetTags:[],priorities:[],categories:[],meetingCategories:[],ownerMode:'all',fromDate:'',toDate:'',closedMode:action==='delete'?'closed':'open',overdueOnly:false,internalControlOnly:false};
  const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
  const callback=ids=>{calls++;assert(ids.join(',')==='one,two','exact selected IDs');if(outcome==='decline')return false;return new Promise((r,j)=>{settle=r;reject=j;});};
  const render=()=>{const captured=identity;flushSync(()=>root.render(React.createElement(ListPanel,{title:'Original ListPanel',tasks,data:base,visibleVessels:vessels,filters,setFilters:f=>{filters=f;render();},fleetTags:[],userMap:Object.fromEntries(base.users.map(u=>[u.id,u])),exportedBy:'SAME NAME',onEdit:()=>{},onPrint:()=>{},onBatchComplete:callback,onBatchDelete:callback,canEdit:true,canPrint:true,canComplete,canDelete,batchContext:{identity:captured,isCurrent:()=>liveIdentity===captured}})));};
  const row=id=>[...host.querySelectorAll('.batch-task-table tbody tr')].find(n=>n.textContent.includes('MOUNTED '+id));
  const count=()=>host.querySelector('.batch-selection-count')?.textContent;
  const toggle=async id=>{row(id).querySelector('input').click();await tick();};
  const button=()=>[...host.querySelectorAll('button')].find(n=>n.textContent.trim()===(action==='complete'?'批量完成（2）':'批量刪除（2）'));
  try{
   render();await tick();assert(count()==='已選 0','empty selection');assert([...host.querySelectorAll('button')].filter(n=>/^批量/.test(n.textContent)).every(n=>n.disabled),'empty actions disabled');
   await toggle('one');await toggle('two');button().click();await tick();assert(calls===1,'one dispatch');
   if(outcome==='decline'){assert(count()==='已選 2','decline selection');cases.push(action+' '+outcome);continue;}
   tasks=originals.filter(t=>t.id==='new');render();await tick();assert(count()==='已選 2','optimistic rows before ACK');assert(row('one').querySelector('input').checked&&row('two').querySelector('input').checked,'retained selected rows');
   button().click();await tick();assert(calls===1,'no repeated pending submission');
   if(['actor-same-name','epoch','actor-ABA','config','config-ABA','view','view-ABA'].includes(outcome)){identity=liveIdentity=outcome+'|successor';tasks=originals;render();await tick();assert(count()==='已選 0','identity reset');await toggle('new');}
   else if(outcome==='scope'){vessels=base.vessels.filter(v=>v.id==='qa-v2');tasks=originals.filter(t=>t.id==='new');render();await tick();assert(!row('one'),'no stale out-of-scope row');await toggle('new');}
   else if(outcome==='filter'){filters={...filters,keyword:'new'};render();await tick();assert(!row('one'),'no retained filtered row');await toggle('new');}
   else if(outcome==='permission'){canComplete=canDelete=false;render();await tick();await toggle('new');}
   else if(outcome==='selection'){await toggle('one');await toggle('two');await toggle('new');}
   else if(outcome==='unmount'){flushSync(()=>root.unmount());root=createRoot(host);tasks=originals;render();await tick();await toggle('new');}
   if(outcome==='throw')reject(new Error('unknown callback'));else settle(outcome!=='rejected');await tick();await tick();
   assert(count()===(outcome==='committed'?'已選 0':['rejected','throw'].includes(outcome)?'已選 2':'已選 1'),action+' '+outcome+' late selection outcome: '+count());
   assert(!host.querySelector('[batchcontext]')&&!host.innerHTML.includes(identity),'internal identity must not enter DOM');
   cases.push(action+' '+outcome);
  }finally{settle?.(false);flushSync(()=>root.unmount());host.remove();}
 }
 // Existing per-vessel eligibility remains distinct from PDF selection.
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{const t={...fixture.tasks.find(t=>t.id==='qa-unrelated-task'),sourceType:'temporary',attentionDimension:'meeting',sourceMeetingId:'mounted-meeting',distributeToVessels:true,vesselIds:['qa-v1','qa-v2'],vesselProgress:[]};
 const filters={keyword:'',departments:[],vesselIds:[],fleetTags:[],priorities:[],categories:[],meetingCategories:[],ownerMode:'all',fromDate:'',toDate:'',closedMode:'open'};
 let calls=0;const props={title:'Per vessel',tasks:[t],data:fixture,visibleVessels:fixture.vessels,filters,setFilters:()=>{},fleetTags:[],userMap:{},exportedBy:'SAME NAME',onEdit:()=>{},onPrint:()=>{},onBatchComplete:()=>{calls++;return true;},onBatchDelete:()=>false,canEdit:true,canPrint:true,canComplete:true,canDelete:true,batchContext:{identity:'per-vessel',isCurrent:()=>true}};
 flushSync(()=>root.render(React.createElement(ListPanel,props)));await tick();host.querySelector('.batch-task-table tbody input').click();await tick();const buttons=[...host.querySelectorAll('button')];assert(buttons.find(n=>n.textContent==='批量完成（0）')?.disabled,'per-vessel complete excluded');assert(!buttons.find(n=>n.textContent==='導出 PDF（1）')?.disabled,'per-vessel PDF remains selectable');
 flushSync(()=>root.render(React.createElement(ListPanel,{...props,filters:{...filters,keyword:'QA'}})));await tick();assert(host.querySelector('.batch-selection-count').textContent==='已選 1','matching filter must preserve existing selection');
 flushSync(()=>root.render(React.createElement(ListPanel,{...props,tasks:[]})));await tick();assert(host.querySelector('.batch-selection-count').textContent==='已選 0','ordinary filtered/empty removes unavailable selection');assert(calls===0,'no empty or per-vessel callback');cases.push('per-vessel PDF/complete and empty/filter');
 }finally{flushSync(()=>root.unmount());host.remove();}
 assert(cases.length===33,'mounted matrix cardinality');return{layer:'original ListPanel mounted with controlled callbacks; not App auth or SQL',count:cases.length,cases};
}

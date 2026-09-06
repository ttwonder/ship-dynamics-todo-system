import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import InternalControlPage from '../src/InternalControlPage.tsx';
// Controlled original Page callbacks, not full App authentication or SQL.
export async function run(fixture){
 const cases=[],assert=(x,label)=>{if(!x)throw new Error(label);};
 const tick=()=>new Promise(r=>setTimeout(r,20));
 for(const action of ['close','delete'])for(const outcome of ['committed','rejected','epoch','scope']){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const base=structuredClone(fixture),owner=base.users.find(u=>u.id==='qa-owner'),ids=['qa-case-delete','qa-restricted'];
  let current=base,epoch='original',vessels=base.vessels,settle=null;
  const deferred=()=>new Promise(resolve=>{settle=resolve;});
  const render=()=>flushSync(()=>root.render(React.createElement(InternalControlPage,{data:current,user:owner,vessels,authorizationEpoch:epoch,canCreate:true,canEdit:true,canClose:true,canDelete:true,canExport:false,onCreate:async()=>false,onUpdate:async()=>false,onWithdrawTaskSync:async()=>false,onDelete:async()=>false,onBatchClose:deferred,onBatchDelete:deferred,onOpenTask:()=>{}})));
  const row=id=>[...host.querySelectorAll('.ic-table tbody tr')].find(n=>n.textContent.includes(base.internalControlCases.find(c=>c.id===id).description));
  const count=()=>host.querySelector('.batch-selection-count')?.textContent;
  try{
   render();await tick();for(const id of ids){row(id).querySelector('input').click();await tick();}
   [...host.querySelectorAll('button')].find(n=>n.textContent.trim()===(action==='close'?'批量結案（2）':'批量刪除（2）')).click();await tick();assert(settle,'original callback pending');
   current={...base,internalControlCases:action==='delete'?base.internalControlCases.filter(c=>!ids.includes(c.id)):base.internalControlCases.map(c=>ids.includes(c.id)?{...c,isClosed:true}:c)};render();await tick();
   assert(count()==='已選 2','optimistic '+action+' cleared pending selection');assert(ids.every(id=>row(id)?.querySelector('input')?.checked),'pending selected rows lost');
   if(outcome==='epoch'){epoch='successor';render();await tick();assert(count()==='已選 0','stale authority retained selection');settle(true);await tick();assert(count()==='已選 0','late success restored stale selection');}
   else if(outcome==='scope'){vessels=base.vessels.filter(v=>v.id==='qa-v2');render();await tick();assert(!row(ids[0]),'retained foreign-scope row exposed');settle(false);await tick();assert(count()==='已選 1','scope-safe remaining selection');}
   else{settle(outcome==='committed');await tick();assert(count()===(outcome==='committed'?'已選 0':'已選 2'),outcome+' selection outcome');}
   cases.push(action+' '+outcome);
  }finally{settle?.(false);flushSync(()=>root.unmount());host.remove();}
 }
 assert(cases.length===8,'mounted case cardinality');return{layer:'original Page mounted; controlled callback settlement and authority/scope props, not full App auth or SQL',cases};
}

import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import InternalControlPage from '../src/InternalControlPage.tsx';

// Original mounted Page/CaseEditModal; controlled callback/lease props, NOT SQL.
// The full-App browser verifier separately exercises actual SupabaseJS/SQL.
export async function run(fixture){
 const assert=(condition,message)=>{if(!condition)throw new Error(message);};
 const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
 const until=async(test,label)=>{for(let i=0;i<150;i++){if(test())return;await tick();}throw new Error(label);};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),cases=[];
 const data=structuredClone(fixture),item=data.internalControlCases.find(c=>c.id==='qa-case-delete'),user=data.users.find(u=>u.id==='qa-owner');
 assert(item&&user,'nonempty original fixture');
 let current=data,epoch='records-v1|key-a|qa-owner',active='internal-control:'+item.id,resolveDelete=null;
 const releases=[];
 const render=()=>flushSync(()=>root.render(React.createElement(InternalControlPage,{
  data:current,user,vessels:data.vessels,authorizationEpoch:epoch,activeItemLeaseKey:active,
  canCreate:true,canEdit:true,canClose:true,canDelete:true,canExport:false,
  claimItemLease:async()=>current,requireItemLease:()=>true,releaseItemLease:async key=>{releases.push(key);return true;},
  onCreate:async()=>false,onUpdate:async()=>false,onWithdrawTaskSync:async()=>false,
  onDelete:()=>new Promise(resolve=>{resolveDelete=resolve;}),onBatchClose:async()=>false,onBatchDelete:async()=>false,onOpenTask:()=>{},
 })));
 const click=label=>{const nodes=[...host.querySelectorAll('button')].filter(n=>n.textContent.trim()===label);assert(nodes.length===1,'button cardinality '+label);nodes[0].click();};
 const open=async()=>{const row=[...host.querySelectorAll('tbody tr')].find(n=>n.textContent.includes('QA case-delete'));assert(row,'fixture row');[...row.querySelectorAll('button')].find(n=>n.textContent==='更新').click();await until(()=>host.querySelector('.ic-edit-modal'),'original case editor');};
 const input=()=>[...host.querySelectorAll('.modal .field')].find(n=>n.querySelector('label')?.textContent==='事項內容 *')?.querySelector('textarea');
 try{
  render();await tick();await open();const field=input();assert(field,'description textarea');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'KEEP ORIGINAL LOCAL DRAFT');field.dispatchEvent(new Event('input',{bubbles:true}));await tick();
  click('刪除案件');await until(()=>resolveDelete,'controlled delete pending');
  current={...data,internalControlCases:data.internalControlCases.filter(c=>c.id!==item.id)};render();await tick();
  assert(input()===field&&field.value==='KEEP ORIGINAL LOCAL DRAFT','optimistic absence rebuilt/lost original local draft');
  resolveDelete(false);resolveDelete=null;await tick();
  assert(input()===field&&field.value==='KEEP ORIGINAL LOCAL DRAFT','rejected delete unmounted local draft');assert(releases.length===0,'unconfirmed delete released lease');
  cases.push('optimistic removal and rejected delete retain same original editor node/draft without release');
  active='internal-control:another-case';render();await tick();assert(!host.querySelector('.ic-edit-modal'),'valid wrong entity key retained old editor');
  cases.push('wrong entity lease cannot retain a missing source editor');
  for(const successor of ['records-v1|key-b|qa-owner','records-v1|key-b|qa-operator','legacy|key-b|qa-owner']){
   current=data;active='internal-control:'+item.id;render();await tick();await open();click('刪除案件');await until(()=>resolveDelete,'pending old epoch delete');
   current={...data,internalControlCases:data.internalControlCases.filter(c=>c.id!==item.id)};epoch=successor;render();await tick();
   assert(!host.querySelector('.ic-edit-modal'),'authority epoch kept old draft visible');resolveDelete(false);resolveDelete=null;await tick();assert(!host.querySelector('.ic-edit-modal'),'late rejected old epoch reopened editor');
   cases.push('changed authority '+successor+' fences retained editor and late rejected callback');
  }
  assert(new Set(cases).size===5,'unique lifecycle cases');return {layer:'mounted original InternalControlPage/CaseEditModal, controlled callbacks and lease props; not full App auth or SQL',cases};
 }finally{resolveDelete?.(false);flushSync(()=>root.unmount());host.remove();}
}

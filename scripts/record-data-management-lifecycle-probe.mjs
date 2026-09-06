import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Panel from '../src/DataManagementPanel.tsx';
import * as api from '../src/dataManagement.ts';
export async function run(){
 const assert=(v,m)=>{if(!v)throw new Error(m);},tick=()=>new Promise(r=>setTimeout(r,15));
 const until=async(f,m)=>{for(let i=0;i<150;i++){if(f())return;await tick();}throw new Error(m);};
 const original={fetch:window.fetch,config:window.SHIP_DYNAMICS_SUPABASE_CONFIG,confirm:window.confirm};
 const cfg={supabaseUrl:location.origin,supabaseAnonKey:'prune-probe',workspaceKey:'prune-probe',tableName:'ship_dynamics_app_state',storageMode:'legacy'};
 const host=document.createElement('div');document.body.append(host);let root=createRoot(host),queue=[],calls=[],cases=[],hold='',empty=false,fail=false;
 const stats={ok:true,currentRevision:7,currentStateBytes:100,revisionHistoryCount:2,revisionHistoryBytes:200,revisions:[{revision:7,current:true,logicalBytes:100},{revision:2,current:false,logicalBytes:100}],collections:[],items:[]};
 window.fetch=async(url,init)=>{
  const name=new URL(url).pathname.split('/').pop(),body=JSON.parse(init.body);calls.push({name,body});
  const reject=fail;
  const value=name.includes('stats')?{...stats,currentRevision:empty?9:7,revisions:empty?[]:stats.revisions}: {ok:true,operationId:body.p_operation_id,deletedRevisions:body.p_delete_revisions,deletedCount:1,deletedBytes:100,remainingRevisionCount:1,currentRevision:7};
  if(hold&&name.includes(hold))await new Promise(resolve=>queue.push({resolve,name,body}));
  return new Response(JSON.stringify(reject?{ok:false,error:'REVISION_SET_CHANGED'}:value),{status:200,headers:{'Content-Type':'application/json'}});
 };
 window.confirm=()=>true;
 const render=(config=cfg,actor='owner')=>{window.SHIP_DYNAMICS_SUPABASE_CONFIG=config;flushSync(()=>root.render(React.createElement(Panel,{currentUser:{id:actor,role:'owner',isActive:true}})));};
 const reset=()=>{flushSync(()=>root.unmount());host.replaceChildren();root=createRoot(host);hold='';queue=[];calls=[];empty=false;fail=false;};
 const button=t=>[...host.querySelectorAll('button')].find(n=>n.textContent===t);
 const click=t=>{const n=button(t);assert(n,'missing '+t+' '+host.innerText);flushSync(()=>n.click());};
 const enter=async()=>{await until(()=>host.querySelector('.data-management-secondary-metrics'),'stats ready');flushSync(()=>[...host.querySelectorAll('.management-list-item')].find(n=>n.textContent.includes('歷史版本清理')).click());await until(()=>host.querySelector('input[type=checkbox]'),'history ready');};
 const envelope=(config,actor='owner')=>api.createPendingRevisionPrune({operationId:crypto.randomUUID(),actorUserId:actor,expectedRevisions:[2,7],deleteRevisions:[2]},config);
 const retained=n=>n[Object.keys(n).find(k=>k.startsWith('__reactProps'))].onClick;
 try{
  for(const change of ['mode','key','actor']){
   const next=change==='mode'?{...cfg,storageMode:'records-v1'}:change==='key'?{...cfg,supabaseAnonKey:'rotated'}:cfg,actor=change==='actor'?'other-owner':'owner';
   reset();hold='stats';render();await until(()=>queue.length===1,'old stats held');empty=true;hold='';render(next,actor);await until(()=>calls.length===2,'context must refresh stats');queue.shift().resolve();await tick();await tick();assert(!host.innerText.includes('r7'),'late '+change+' stats published');cases.push('stats '+change+' late reply fenced');
   for(const recovery of [false,true])for(const lateError of [false,true]){
    reset();const old=recovery?envelope(cfg):null;if(old)api.writePendingRevisionPrune(old,cfg);
    render();await enter();if(!recovery){flushSync(()=>host.querySelector('input[type=checkbox]').click());await tick();}
    const action=recovery?'對帳上次操作':'刪除所選 1 份',callback=retained(button(action));hold='prune';fail=lateError;click(action);await until(()=>queue.length===1,'prune held');
    const intent=api.readPendingRevisionPrune(cfg,'owner');assert(intent,'intent persisted');hold='';fail=false;render(next,actor);await tick();
    const count=calls.length;callback();await tick();assert(calls.length===count,'retained '+change+' callback sent request');
    const successor=envelope(next,actor);api.writePendingRevisionPrune(successor,next);queue.shift().resolve();await tick();await tick();
    assert(!host.querySelector('[role=status]')&&!host.querySelector('.data-management-message.error'),'late '+change+' result published success/error');assert(api.readPendingRevisionPrune(next,actor)?.operationId===successor.operationId,'late '+change+' erased successor pending');
    if(change!=='key')assert(api.readPendingRevisionPrune(cfg,'owner')?.operationId===intent.operationId,'late old result cleared old intent');
    api.clearPendingRevisionPrune(cfg,'owner');api.clearPendingRevisionPrune(next,actor);cases.push((recovery?'recovery':'batch')+' '+change+' retained callback and late '+(lateError?'rejection':'ACK')+' fenced');
   }
  }
  reset();render();await enter();flushSync(()=>host.querySelector('input[type=checkbox]').click());await tick();click('刪除所選 1 份');await until(()=>host.querySelector('[role=status]'),'fresh positive success');assert(!api.readPendingRevisionPrune(cfg,'owner'),'fresh ACK clears matching pending');cases.push('fresh original Panel positive ACK');
  return {layer:'original mounted Panel controlled deferred transport; NOT SQL or full-App evidence',count:cases.length,cases};
 }finally{flushSync(()=>root.unmount());host.remove();window.fetch=original.fetch;window.SHIP_DYNAMICS_SUPABASE_CONFIG=original.config;window.confirm=original.confirm;for(const q of queue)q.resolve();}
}

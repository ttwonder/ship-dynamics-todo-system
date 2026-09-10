import assert from 'node:assert/strict';
import {managementExpected,assertManagementAfter} from './management-scoped-save-oracle.mjs';
export async function runGlobalSaveFeedback({a,qa,read,call,until,wait,write,receipt,setCase,setRelease,freshReadback}){
 const patchRpc='apply_ship_dynamics_record_patch_v1';
 const field="[...document.querySelectorAll('.management-form label')].find(n=>n.textContent==='姓名')?.querySelector('input')";
 const state=()=>a.eval("({global:document.querySelector('.save-toast.success')?.textContent||'',strip:document.querySelector('.save-status-strip')?.className||'',local:document.querySelector('.management-save-toast')?.textContent||''})");
 await a.click('管理');await until(()=>a.eval("Boolean(document.querySelector('.management-view'))"),'management');
 await a.activate("[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith('人員'))");
 await a.activate("[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText==='QA SPARE')");
 for(const mode of ['clean','newer','rejected','multi']){
  const id='GSO-UI-'+mode;setCase(id);qa.setRecordFault(null);
  const warm='GSO '+mode+' A';await a.fill(field,warm);await a.click('保存變更');
  await until(async()=>{const s=await state();return s.global&&s.strip.includes('saved')&&s.local;},'A explicit global success '+mode);
  const aState=await state();write(id+'-A-success',aState);await a.screen(id+'-A-success');
  const before=await read(),started=Date.now(),networkStart=receipt.network.length;let held=0,patches=0,release,expected;
  const bName='GSO '+mode+' B',cName='GSO '+mode+' C';
  qa.setRecordFault({before:async({name,body})=>{
   if(name!==patchRpc)return;
   const base=await read(),intentName=patches===0?bName:cName;
   expected={base,value:await managementExpected(base,body,qa,{kind:'person',id:'qa-spare',name:intentName},started)};
   write(id+'-expected-'+patches,expected);patches++;
   if(mode==='rejected')body.p_lock_guards=[...body.p_lock_guards,{section_key:'vessel:qa-v1',locked_by:'qa-invalid-global-feedback-lease'}];
  },after:async({name})=>{if(name===patchRpc){held++;await new Promise(r=>{release=r;setRelease(r);});}return false;}});
  await a.fill(field,bName);
  assert.ok((await state()).global,'A success must still be visible immediately before accepting B');
  await a.eval("void(window.__gsoSuccesses=[]);void(window.__gsoWatch?.disconnect());void(window.__gsoWatch=new MutationObserver(()=>{if(document.querySelector('.save-toast.success'))window.__gsoSuccesses.push(Date.now());}));window.__gsoWatch.observe(document.body,{childList:true,subtree:true,characterData:true})");
  await a.click('保存變更');await until(()=>held===1,'after-RPC B ACK body held '+mode);
  const heldState=await state();write(id+'-held-feedback',heldState);await a.screen(id+'-held');
  if(mode==='clean'){await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false},a.s);await a.screen(id+'-held-mobile');write(id+'-mobile-geometry',await a.eval('({width:innerWidth,documentWidth:document.documentElement.scrollWidth})'));assert.equal((await state()).global,'');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},a.s);}
  assert.equal(heldState.global,'','accepted B cannot retain A global safe-close');assert.ok(heldState.strip.includes('saving'));assert.equal(heldState.local,'','no B local success before client ACK');
  assert.equal(await a.eval(`(${field}).value`),bName);await a.eval(`void(window.__gsoNode=${field})`);
  if(mode==='newer'||mode==='multi')await a.fill(field,mode==='newer'?'GSO UNSUBMITTED NEW DRAFT':cName);
  if(mode==='multi'){await a.click('保存變更');assert.equal(patches,1,'C cannot overtake B');}
  await a.eval('void(window.__gsoSuccesses=[])');release();
  if(mode==='multi'){
   await until(()=>held===2,'C own SQL ACK held');const cHeld=await state();write(id+'-C-held-feedback',cHeld);await a.screen(id+'-C-held');
   assert.equal(cHeld.global,'','late B ACK cannot paint C safe-close');assert.equal(cHeld.local,'');assert.equal(await a.eval(`(${field}).value`),cName);
   assert.deepEqual(await a.eval('window.__gsoSuccesses'),[],'no transient late-B success before C ACK');release();
  }
  await until(()=>receipt.network.slice(networkStart).filter(r=>r.rpc===patchRpc&&r.finished).length===patches,'client completed own ACK');
  if(mode==='rejected'){
   await until(async()=>(await state()).strip.includes('error'),'rejected strip');assert.deepEqual(await read(),before,'native rejected full graph rollback');
   const s=await state();assert.equal(s.global,'');assert.equal(s.local,'');assert.equal(await a.eval(`(${field}).value`),bName);
   assert.equal(receipt.network.slice(networkStart).find(r=>r.rpc===patchRpc).result,'lock-conflict');
  }else{
   await until(async()=>(await state()).strip.includes('saved'),'confirmed strip');
   const after=await read();assertManagementAfter(expected.base,after,expected.value,started);write(id+'-sql-after',after);
   if(mode==='newer'){assert.equal((await state()).local,'');assert.equal(await a.eval(`(${field}).value`),'GSO UNSUBMITTED NEW DRAFT');assert.equal(await a.eval(`window.__gsoNode===(${field})`),true);}
   else{await until(async()=>Boolean((await state()).local),'matching local success');assert.ok((await state()).global,'final accepted ACK may show success');}
  }
  write(id+'-confirmed-feedback',await state());await a.screen(id+'-confirmed');
  await wait(100);assert.equal(new Set(receipt.network.slice(networkStart).filter(r=>r.rpc===patchRpc).map(r=>r.operationId)).size,mode==='multi'?2:1,'no premature duplicate/changed FIFO');
  receipt.cases.push({caseId:id,layer:'original-UI-native-PG',status:'PASS'});qa.setRecordFault(null);
 }
 await a.eval('window.__gsoWatch.disconnect()');
 await freshReadback('GSO-final',await read());
}

import assert from 'node:assert/strict';
export async function reloadProbe({a,qa,call,until,receipt,save,hash,legacy,full,before,configHash,name,createAuthorityBOracle,native,setCase}){
 setCase('RELOAD-01-authoritative-bootstrap');qa.setRecordFault(null);
 const metricStart=qa.metrics.length,networkStart=receipt.network.length;
 await call('Page.reload',{},a.s);
 await until(async()=>{try{return await a.eval("document.readyState==='complete'&&window.__authorityDocument!==document&&Boolean(document.querySelector('.save-status-strip'))&&!document.querySelector('.save-status-strip.saving')");}catch{return false;}},'new original document bootstrap settled');
 const seen=qa.metrics.slice(metricStart).map(x=>x.rpc).filter(Boolean);
 const state=await a.eval("({sameConfig:JSON.stringify(window.SHIP_DYNAMICS_SUPABASE_CONFIG),actor:document.body.innerText.includes('QA OWNER')&&!document.body.innerText.includes('人員登入／切換'),saved:Boolean(document.querySelector('.save-status-strip.saved'))})");
 receipt.reloadProbe={explicitReload:true,noStorageWritesOrRebaseByHarness:true,readRoutes:seen,actorRestored:state.actor,configUnchanged:hash(state.sameConfig)===configHash,saved:state.saved};save();
 assert.ok(seen.includes('legacy-snapshot-read'),'RELOAD-01 initial business read must follow the published authority');
 assert.ok(!seen.some(x=>/^read_ship_dynamics_record/.test(x)),'RELOAD-01 retired records may not supply fresh bootstrap data');
 assert.equal(receipt.reloadProbe.configUnchanged,true);assert.equal(state.actor,true);
 assert.deepEqual(await full('after-explicit-reload'),before,'reload is read-only across every native business store');
 receipt.cases.push({caseId:'RELOAD-01-authoritative-bootstrap',layer:'original-UI-native-PG',status:'PASS'});save();
 setCase('RELOAD-02-next-original-manual-save');
 await a.click('管理');await until(()=>a.eval("Boolean(document.querySelector('.management-view'))"),'management after reload');
 await a.activate("[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith('人員'))");
 await a.activate(`[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText===${JSON.stringify(name)})`);
 const field="[...document.querySelectorAll('.management-form label')].find(n=>n.textContent==='姓名')?.querySelector('input')";
 assert.equal(await a.eval(`(${field})?.value`),name,'fresh editor must load the saved B value');
 const newer=name+'-C',oracle=await createAuthorityBOracle({native,qa,legacy,intent:{kind:'person',id:'qa-spare',name:newer},mode:'reload',receipt,save});qa.setRecordFault(oracle.fault);
 await a.fill(field,newer);const start=receipt.network.length;await a.click('保存變更');
 await until(()=>receipt.network.slice(start).some(r=>r.rpc==='apply_ship_dynamics_block_patch_v2'&&r.finished&&r.ok),'new C actual legacy SQL acknowledgement');
 await until(()=>a.eval("Boolean(document.querySelector('.save-status-strip.saved'))"),'new C saved feedback');
 const after=await legacy();oracle.verify(after);assert.equal(after.payload.users.find(x=>x.id==='qa-spare').name,newer);
 assert.equal(receipt.network.slice(networkStart).filter(r=>r.rpc==='apply_ship_dynamics_record_patch_v1').length,0);
 receipt.cases.push({caseId:'RELOAD-02-next-original-manual-save',layer:'original-UI-native-PG',status:'PASS'});receipt.reloadProbe.nextSaveConfirmed=true;save();qa.setRecordFault(null);
}

import assert from 'node:assert/strict';

// Original mounted UI + synthetic data + native PostgreSQL. The only injected
// fault rejects an actual scoped read; successful responses always come from SQL.
export async function primary({a,qa,call,until,wait,read,receipt,save,hash,setCase}){
 const pass=caseId=>{receipt.cases.push({caseId,layer:'original-UI-native-PG',status:'PASS'});save();};
 const before=await read(),networkStart=receipt.network.length;
 const cache=()=>a.eval("import('/src/utils.ts').then(m=>[m.STORAGE_KEY,m.CLOUD_CONFIRMED_BASE_KEY,m.CLOUD_REVISION_FLOORS_KEY].map(k=>[k,localStorage.getItem(k)]))");
 const reload=async()=>{
  // Let the original delayed scope prefetch and its response observers settle;
  // otherwise a deliberate navigation can destroy a body CDP is still reading.
  await wait(1400);
  await until(()=>receipt.network.every(r=>r.finished||r.failure),'original request observers settled before reload');
  await a.eval('void(window.__bootProbeDocument=document)');
  await call('Page.reload',{},a.s);
  await until(async()=>{try{return await a.eval("window.__bootProbeDocument!==document&&document.readyState==='complete'&&Boolean(document.querySelector('.save-status-strip'))&&!document.querySelector('.save-status-strip.saving')");}catch{return false;}},'new original document completed bootstrap');
 };
 setCase('BOOT-UI01-healthy-reentry');
 await reload();await until(()=>a.saved(),'healthy reentry saved status');
 assert.equal(await a.eval("Boolean(document.querySelector('.unsaved-work-guidance'))"),false);
 assert.deepEqual(await read(),before);pass('BOOT-UI01-healthy-reentry');
 setCase('BOOT-UI02-reentry-read-failure-preserves-cache');
 const initialCache=await cache();let rejected=0;
 qa.setRecordFault({beforeRead:async()=>{rejected++;throw new Error('QA_TRANSIENT_BOOT_READ_FAILURE');}});
 await reload();
 assert.ok(rejected>0);assert.equal(await a.saved(),false);
 assert.ok((await a.text()).includes('雲端載入失敗'));
 assert.deepEqual(await cache(),initialCache,'failed bootstrap must preserve cache, confirmed base and floors');
 assert.equal(await a.eval("document.querySelector('.unsaved-work-guidance b')?.textContent"),'尚未確認雲端資料，暫停保存','read failure must not assert that a clean cache is unsaved work');
 assert.deepEqual(await read(),before);pass('BOOT-UI02-reentry-read-failure-preserves-cache');
 setCase('BOOT-UI03-explicit-recovery-without-business-save');
 qa.setRecordFault(null);const recoveryStart=receipt.network.length;
 await a.sync();await until(()=>a.saved(),'explicit sync recovered source and clean state');
 assert.ok(receipt.network.slice(recoveryStart).some(r=>r.rpc==='read_ship_dynamics_browser_authority_v1'&&r.finished));
 assert.equal(await a.eval("Boolean(document.querySelector('.unsaved-work-guidance'))"),false);
 assert.ok(!(await a.text()).includes('browser-authority-unavailable'));
 await wait(1100);assert.deepEqual(await read(),before);pass('BOOT-UI03-explicit-recovery-without-business-save');
 setCase('BOOT-UI04-reopen-after-recovery');
 await reload();await until(()=>a.saved(),'reopen after recovered sync');
 assert.equal(await a.eval("Boolean(document.querySelector('.unsaved-work-guidance'))"),false);
 assert.deepEqual(await read(),before);
 const writes=receipt.network.slice(networkStart).filter(r=>/^(apply_|save_|initialize_)/.test(r.rpc));
 assert.deepEqual(writes,[],'clean reentry/recovery must not dispatch a business mutation');
 receipt.bootRecovery={readFaultCount:rejected,cleanRecoveryWrites:writes.length,cachePreservedOnFailure:true,sqlBeforeHash:hash(before),sqlAfterHash:hash(await read()),harnessStorageWrites:false,productionContacted:false};
 pass('BOOT-UI04-reopen-after-recovery');
}

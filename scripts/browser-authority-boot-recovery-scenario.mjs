import assert from 'node:assert/strict';

// Original mounted UI + synthetic data + native PostgreSQL. The only injected
// fault rejects an actual scoped read; successful responses always come from SQL.
export async function primary({a,qa,call,until,wait,read,receipt,save,hash,setCase}){
 const pass=caseId=>{receipt.cases.push({caseId,layer:'original-UI-native-PG',status:'PASS'});save();};
 const before=await read(),networkStart=receipt.network.length;
 const utils=await qa.loadModule('/src/utils.ts');
 const cacheKeys=[utils.STORAGE_KEY,utils.CLOUD_CONFIRMED_BASE_KEY,utils.CLOUD_REVISION_FLOORS_KEY];
 const cache=()=>a.eval(`${JSON.stringify(cacheKeys)}.map(k=>[k,localStorage.getItem(k)])`);
 const reload=async()=>{
  // Let the original delayed scope prefetch and its response observers settle;
  // otherwise a deliberate navigation can destroy a body CDP is still reading.
  await wait(1400);
  await until(()=>receipt.network.every(r=>r.finished||r.failure),'original request observers settled before reload');
  await a.eval('void(window.__bootProbeDocument=document)');
  await call('Page.reload',{},a.s);
  await until(async()=>{try{return await a.eval("window.__bootProbeDocument!==document&&document.readyState==='complete'&&Boolean(document.querySelector('.save-status-strip'))&&!document.querySelector('.save-status-strip.saving')");}catch{return false;}},'new original document completed bootstrap');
 };
 if(process.env.QA_UI_BASELINE){
  setCase('BOOT-UI00-old-build-natural-cache-upgrade');
  await a.click('早會工作台');await until(()=>a.eval("Boolean(document.querySelector('.morning-workspace'))"),'old original morning page');
  await wait(1400);await until(()=>receipt.network.every(r=>r.finished||r.failure),'old scoped reads completed');
  const oldCache=await cache();assert.equal(JSON.parse(oldCache[1][1]).recordReadScope,undefined);
  receipt.baselineBuiltUi=receipt.builtUi;
  qa.startupFixture=(await import('./startup-chunk-browser-fixture.mjs')).installStartupBuildFixture(qa,receipt);
  assert.deepEqual(await cache(),oldCache,'upgrade must not rewrite storage before original bootstrap');
  await reload();await until(()=>a.saved(),'naturally persisted old scoped cache survives upgrade');
  assert.deepEqual(await read(),before);pass('BOOT-UI00-old-build-natural-cache-upgrade');
 }
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
 if(qa.startupFixture){
  // Normalize coverage through the original dashboard action before isolating
  // asset failure: the upgrade above legitimately restored a detailed cache.
  await a.click('船隊看板');
  await until(async()=>{const entries=await cache(),base=JSON.parse(entries[1][1]);return base.recordReadScope==='home'&&JSON.stringify(base.data)===entries[0][1];},'original home scope and cache settled');
  const pages=[['管理','Management','.management-view'],['早會工作台','MorningWorkspace','.morning-workspace'],['臨會/專題','TemporaryMeetings','.temporary-meeting-page'],['數據','DataAnalysis','.data-analysis-view'],['內控異常','InternalControlPage','.internal-control-page'],['配件/物料/工程','TrackingPage','.tracking-page']];
  const resources=()=>a.eval("performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname.slice(1))");
  const initialResources=await resources();
  for(const [,name] of pages){const chunk=Object.values(qa.startupFixture.manifest).find(m=>m.name===name);assert.ok(!initialResources.includes(chunk.file),`${name} must not download before navigation`);}
  setCase('LOAD-UI01-download-failure-retains-shell');
  await a.eval("void(window.__savedStrip=document.querySelector('.save-status-strip'))");
  const failureCache=await cache();qa.startupFixture.failNext('Management');
  await a.click('管理');
  await until(async()=>(await a.text()).includes('功能程式下載失敗')||(await a.text()).includes('系統畫面載入失敗'),'download failure rendered');
  assert.equal(await a.eval("document.querySelector('.save-status-strip')===window.__savedStrip"),true,'a failed lazy download must not unmount the App or other drafts');
  assert.deepEqual(await cache(),failureCache);assert.deepEqual(await read(),before);
  pass('LOAD-UI01-download-failure-retains-shell');
  // Failed ESM imports remain cached in Chrome for this document. Keep other
  // pages usable, never auto-reload over drafts, then reopen the clean QA page.
  await a.click('早會工作台');await until(()=>a.eval("Boolean(document.querySelector('.morning-workspace'))"),'other page survives a failed download');
  assert.equal(await a.eval("document.querySelector('.save-status-strip')===window.__savedStrip"),true);
  await reload();
  try{await until(()=>a.saved(),'clean test document reopens after asset service recovers');}
  catch(error){receipt.startupReopenDiagnostic=await a.eval("({status:document.querySelector('.save-status-strip')?.innerText,phase:document.querySelector('.save-status-strip')?.className,guidance:document.querySelector('.unsaved-work-guidance')?.innerText,dialogCount:document.querySelectorAll('[role=dialog]').length})");save();throw error;}
  await a.eval("void(window.__savedStrip=document.querySelector('.save-status-strip'))");
  pass('BOOT-UI05-clean-scoped-reentry');
  for(const [label,name,selector] of pages){
   setCase('LOAD-UI02-'+name);await a.click(label);
   await until(()=>a.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),'original lazy page '+name);
   const chunk=Object.values(qa.startupFixture.manifest).find(m=>m.name===name);
   assert.ok((await resources()).includes(chunk.file),`${name} loaded its actual built chunk`);
   assert.equal(await a.eval("document.querySelector('.save-status-strip')===window.__savedStrip"),true);
   assert.deepEqual(await read(),before);pass('LOAD-UI02-'+name);
  }
  await a.click('船隊看板');await until(()=>a.saved(),'return to unchanged dashboard');
 }
}

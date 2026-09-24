import assert from 'node:assert/strict';
export async function nativeChecks({qa,call,evaluate,click,nodeClick,fill,until,text,screen,check,rowAction,trackingTab,dateInput,finishEditor,leases,select,labelInput,fillNode,field}){
 const readSource=async ref=>(await qa.read()).payload.trackingItems.find(r=>r.referenceNo===ref);
 const peerUpdate=async(id)=>{
   const {runTrackingCommand}=await qa.loadModule('/src/tracking/trackingWorkflow.ts');const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
   const base=(await qa.read()).payload,source=base.trackingItems.find(r=>r.id===id),operation='peer-'+Date.now();
   const next=runTrackingCommand(base,{type:'progress',items:[{id,expectedUpdatedAt:source.updatedAt,text:'其他協作者已更新'}]},{actorId:'qa-owner',at:new Date().toISOString(),operationId:operation});
   const operations=buildCloudBlockPatch(base,next),guards=[];
   for(const op of operations.filter(o=>o.kind==='entity'&&['trackingItems','internalControlCases','tasks'].includes(o.collection))){const section_key=(op.collection==='trackingItems'?'tracking:':op.collection==='tasks'?'task:':'internal-control:')+op.entityId;const lease=(await qa.db.query("select claim_ship_dynamics_edit_lock($1,$2,$3,'QA peer',300) r",[qa.workspace,section_key,operation])).rows[0].r;assert.equal(lease.ok,true);guards.push({section_key,locked_by:lease.locked_by,lease_version:lease.lease_version});}
   const result=(await qa.db.query("select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,'QA peer','qa-owner',ship_dynamics_actor_guard($4::jsonb,'qa-owner'),null,$5::jsonb) r",[qa.workspace,operation,JSON.stringify(operations),JSON.stringify(base),JSON.stringify(guards)])).rows[0].r;assert.equal(result.ok,true,result.code);
   for(const guard of guards)await qa.db.query('select release_ship_dynamics_edit_lock($1,$2,$3)',[qa.workspace,guard.section_key,operation]);
 };

 const row=ref=>`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.querySelector('.tracking-reference')?.innerText.includes(${JSON.stringify(ref)}))`;
 await check('native-batch-create-cancel-empty-selection-and-changed-progress-only',async()=>{
   await trackingTab('未送船清單');const before=await qa.read();await click('＋ 新增／批量新增');await click('取消');assert.deepEqual(await qa.read(),before);
   assert.equal(await evaluate("[...document.querySelectorAll('button')].find(n=>n.innerText==='批量更新進度').disabled"),true);
   await click('＋ 新增／批量新增');await fill('[aria-label="第 1 筆 項目編號"]','UI-002');await fill('[aria-label="第 1 筆 內容摘要／工程內容"]','第二來源');await click('＋ 新增一列');await fill('[aria-label="第 2 筆 項目編號"]','UI-003');await fill('[aria-label="第 2 筆 內容摘要／工程內容"]','第三來源');await click('確認保存 2 項');await finishEditor();
   let saved=await qa.read();assert.equal(saved.payload.trackingItems.length,before.payload.trackingItems.length+2);assert.equal(saved.revision,before.revision+1);
   await click('選取全部符合條件 2 項');await click('批量更新進度');await until(()=>evaluate("Boolean(document.querySelector('[aria-label=\"UI-003 最新進度\"]'))"),'batch progress');await fill('[aria-label="UI-003 最新進度"]','只變更第三項');await click('確認保存 2 項');await finishEditor();
   assert.equal((await readSource('UI-002')).statusLogs.length,0);assert.equal((await readSource('UI-003')).statusLogs.length,1);assert.equal((await readSource('UI-003')).progress,'只變更第三項');
 });
 await check('native-partial-delivery-remains-open-and-correction-history',async()=>{
   await rowAction('UI-002','送船／更正');await select("document.querySelector('[aria-label=送船狀態]')",'partially-delivered');await click('確認保存 1 項');await finishEditor();
   assert.equal((await readSource('UI-002')).deliveryStatus,'partially-delivered');assert.ok((await text()).includes('UI-002'));
   await rowAction('UI-002','送船／更正');await dateInput('[aria-label="實際全部送達日期"]','2026-09-25');await click('確認保存 1 項');await finishEditor();await trackingTab('已送船清單');
   await rowAction('UI-002','送船／更正');await select("document.querySelector('[aria-label=送船狀態]')",'not-delivered');await click('確認保存 1 項');await finishEditor();
   const source=await readSource('UI-002');assert.equal(source.isClosed,false);assert.equal(source.actualDeliveryDate,undefined);assert.equal(source.events.filter(e=>e.action==='delivery').length,3);
 });
 await check('native-held-ACK-same-editor-latest-typing-and-second-save',async()=>{
   await trackingTab('未送船清單');await rowAction('UI-002','編輯');await fill('[aria-label="第 1 筆 補充說明"]','送出的版本');
   let held=false,release;const barrier=new Promise(resolve=>{release=resolve;});
   qa.setRecordFault({after:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){held=true;await barrier;}}});
   try{
     await evaluate("void(window.__heldTrackingNode=document.querySelector('[aria-label=\"第 1 筆 補充說明\"]'))");await click('確認保存 1 項');await until(()=>held,'actual SQL committed ACK held');assert.equal((await readSource('UI-002')).supplementalNotes,'送出的版本');
     await fill('[aria-label="第 1 筆 補充說明"]','等待時新輸入');assert.ok((await leases()).length>0);await screen('tracking-native-held-ACK');release();
     await until(async()=>(await text()).includes('等待期間的新輸入仍保留'),'latest draft retained');assert.equal(await evaluate("document.querySelector('[aria-label=\"第 1 筆 補充說明\"]')===window.__heldTrackingNode"),true);assert.equal(await evaluate('window.__heldTrackingNode.value'),'等待時新輸入');
     qa.setRecordFault(null);await click('確認保存 1 項');await finishEditor();assert.equal((await readSource('UI-002')).supplementalNotes,'等待時新輸入');
   }finally{release?.();qa.setRecordFault(null);}
 });
 await check('native-mixed-sync-exact-unlinked-subset-and-linked-task',async()=>{
   await trackingTab('配件物料總清單');await click('選取全部符合條件 3 項');await click('同步所選到內控');await until(()=>evaluate("Boolean(document.querySelector('.ic-batch-modal'))"),'mixed eligible sync form');
   assert.equal(await evaluate("document.querySelectorAll('.ic-batch-row').length"),2);await nodeClick(labelInput('同步到要事','.ic-batch-row:first-child'));await click('保存 2 筆案件');await finishEditor();
   const saved=await qa.read();for(const ref of ['UI-002','UI-003']){const source=saved.payload.trackingItems.find(r=>r.referenceNo===ref);const item=saved.payload.internalControlCases.find(c=>c.id===source.linkedCaseId);assert.ok(item);if(item.syncToTask)assert.ok(saved.payload.tasks.find(t=>t.id===item.linkedTaskId));}
   assert.equal(saved.payload.internalControlCases.filter(c=>c.trackingItemId).length,3);assert.equal(saved.payload.tasks.filter(t=>saved.payload.internalControlCases.some(c=>c.trackingItemId&&c.linkedTaskId===t.id)).length,1);
 });
 await check('native-stale-batch-zero-partial-draft-and-explicit-reconciliation',async()=>{
   await trackingTab('未送船清單');await click('選取全部符合條件 2 項');await click('批量更新進度');await until(()=>evaluate("Boolean(document.querySelector('[aria-label=\"UI-002 最新進度\"]'))"),'stale batch editor');await fill('[aria-label="UI-002 最新進度"]','本機第二項');await fill('[aria-label="UI-003 最新進度"]','本機第三項');
   await peerUpdate((await readSource('UI-003')).id);const afterPeer=await qa.read();await click('確認保存 2 項');await until(async()=>(await text()).includes('確認結果／重試相同提交'),'rejected stale input retained');assert.deepEqual(await qa.read(),afterPeer);assert.equal(await evaluate("document.querySelector('[aria-label=\"UI-002 最新進度\"]').value"),'本機第二項');
   let reconciliationReadHeld=false,releaseRead;const readBarrier=new Promise(resolve=>{releaseRead=resolve;});
   qa.setRecordFault({beforeRead:async({name})=>{if(name==='read_ship_dynamics_record_scopes_v2'){reconciliationReadHeld=true;await readBarrier;}}});
   try{
     await click('核對最新資料／解除已拒絕提交');await until(()=>reconciliationReadHeld,'reconciliation latest-data read held');
     assert.equal(await evaluate("document.querySelector('.tracking-modal .modal-actions .btn.primary').disabled"),true,'reconciliation must block another submission until refreshed versions are installed');
     assert.equal(await evaluate("document.querySelector('[aria-label=\"UI-002 最新進度\"]').value"),'本機第二項');assert.deepEqual(await qa.read(),afterPeer);
     await fill('[aria-label="UI-002 最新進度"]','核對期間的新輸入');
   }finally{releaseRead?.();qa.setRecordFault(null);}
   await until(async()=>(await text()).includes('已核對最新版本'),'explicit stale reconciliation finished');assert.equal(await evaluate("document.querySelector('[aria-label=\"UI-002 最新進度\"]').value"),'核對期間的新輸入');await click('確認保存 2 項');await finishEditor();assert.equal((await readSource('UI-002')).progress,'核對期間的新輸入');assert.equal((await readSource('UI-003')).progress,'本機第三項');
 });
 await check('native-engineering-subitems-cancelled-not-completed-date-independence',async()=>{
   await trackingTab('未完成工程單');await click('＋ 新增／批量新增');await fill('[aria-label="第 1 筆 項目編號"]','ENG-001');await fill('[aria-label="第 1 筆 工程分項"]','1');await fill('[aria-label="第 1 筆 內容摘要／工程內容"]','修復分項');await fill('[aria-label="第 1 筆 原備註"]','不可被進度覆寫');await dateInput('[aria-label="第 1 筆 完工日期"]','2026-09-25');await click('＋ 新增一列');await fill('[aria-label="第 2 筆 項目編號"]','ENG-001');await fill('[aria-label="第 2 筆 工程分項"]','2');await fill('[aria-label="第 2 筆 內容摘要／工程內容"]','另一獨立分項');await click('確認保存 2 項');await finishEditor();
   const before=await qa.read(),target=before.payload.trackingItems.find(r=>r.referenceNo==='ENG-001'&&r.subitemNo==='1');
   await nodeClick(`[...document.querySelector('[data-tracking-id="${target.id}"]').querySelectorAll('button')].find(n=>n.innerText==='結案')`);await dateInput('[aria-label="結案日期"]','2026-09-26');await select("document.querySelector('[aria-label=工程結案結果]')",'cancelled');await click('確認保存 1 項');await finishEditor();
   const saved=await qa.read();assert.equal(saved.payload.trackingItems.find(r=>r.id===target.id).completionDate,'2026-09-25');assert.equal(saved.payload.trackingItems.find(r=>r.referenceNo==='ENG-001'&&r.subitemNo==='2').isClosed,false);await trackingTab('已完成工程單');assert.ok((await text()).includes('取消（非完工）'));assert.ok((await text()).includes('完工 0 項'));await screen('tracking-native-engineering-cancelled');
 });
 await check('native-sync-held-ACK-new-typing-updates-existing-case-not-duplicate',async()=>{
   await trackingTab('未送船清單');await click('＋ 新增／批量新增');await fill('[aria-label="第 1 筆 項目編號"]','SYNC-HELD');await fill('[aria-label="第 1 筆 內容摘要／工程內容"]','來源內容不變');await click('確認保存 1 項');await finishEditor();await rowAction('SYNC-HELD','同步到內控');
   let held=false,release;const barrier=new Promise(resolve=>{release=resolve;});qa.setRecordFault({after:async({name})=>{if(name==='apply_ship_dynamics_record_patch_v1'){held=true;await barrier;}}});
   try{
     await click('保存 1 筆案件');await until(()=>held,'sync SQL committed ACK held');await fillNode(field('事項內容 *','textarea'),'等待ACK時修正內控描述');release();await until(async()=>(await text()).includes('等待期間的新輸入仍保留'),'sync newer input kept');qa.setRecordFault(null);
     const before=await qa.read();await click('保存 1 筆案件');await finishEditor();const saved=await qa.read(),source=saved.payload.trackingItems.find(r=>r.referenceNo==='SYNC-HELD');assert.equal(saved.payload.internalControlCases.length,before.payload.internalControlCases.length);assert.equal(saved.payload.internalControlCases.find(c=>c.id===source.linkedCaseId).description,'等待ACK時修正內控描述');assert.equal(source.description,'來源內容不變');
   }finally{release?.();qa.setRecordFault(null);}
 });
}

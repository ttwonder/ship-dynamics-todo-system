import assert from 'node:assert/strict';
export async function recoveryChecks({qa,call,evaluate,click,nodeClick,fill,until,text,screen,check,rowAction,trackingTab,dateInput,finishEditor,leases,select,dialogs}){
 const source=async ref=>(await qa.read()).payload.trackingItems.find(r=>r.referenceNo===ref);
 await check('native-lease-conflict-entry-zero-write-and-owner-release',async()=>{
   await trackingTab('未送船清單');const item=await source('UI-002'),key='tracking:'+item.id;
   const lease=(await qa.db.query("select claim_ship_dynamics_edit_lock($1,$2,'qa-other-lease','QA other editor',300) r",[qa.workspace,key])).rows[0].r;assert.equal(lease.ok,true);const before=await qa.read();
   const dialogStart=dialogs.length;await nodeClick(`[...document.querySelector('[data-tracking-id="${item.id}"]').querySelectorAll('button')].find(n=>n.innerText==='進度')`);
   await until(()=>dialogs.slice(dialogStart).some(d=>d.message.includes('QA other editor')),'holder named in original alert before editor opens');assert.equal(await evaluate("Boolean(document.querySelector('[aria-label=\"UI-002 最新進度\"]'))"),false);assert.deepEqual(await qa.read(),before);
   await qa.db.query('select release_ship_dynamics_edit_lock($1,$2,$3)',[qa.workspace,key,'qa-other-lease']);await rowAction('UI-002','進度');await fill('[aria-label="UI-002 最新進度"]','取得鎖後才保存');await click('確認保存 1 項');await finishEditor();assert.equal((await source('UI-002')).progress,'取得鎖後才保存');
 });
 await check('native-unknown-ACK-exact-operation-replay-one-history',async()=>{
   await rowAction('UI-002','進度');await fill('[aria-label="UI-002 最新進度"]','未知ACK但只一筆歷程');const before=await qa.read(),requests=[];
   qa.setRecordFault({before:async({name,body})=>{if(['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1'].includes(name))requests.push({name,body:structuredClone(body)});},after:async({name})=>['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1'].includes(name)});
   try{
     await click('確認保存 1 項');await until(async()=>(await text()).includes('確認結果／重試相同提交'),'unknown ACK retained',90_000);const committed=await qa.read();assert.equal(committed.revision,before.revision+1);assert.equal((await source('UI-002')).progress,'未知ACK但只一筆歷程');
     await click('核對最新資料／解除已拒絕提交');assert.ok((await text()).includes('尚未證明提交被拒絕'));assert.ok((await text()).includes('確認結果／重試相同提交'));await screen('tracking-native-unknown-ACK');
     qa.setRecordFault({before:async({name,body})=>{if(['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1'].includes(name))requests.push({name,body:structuredClone(body)});}});await click('確認結果／重試相同提交');await finishEditor();assert.deepEqual(await qa.read(),committed);
     assert.equal(new Set(requests.map(r=>r.body.p_operation_id)).size,1,'same durable record operation');const first=requests[0].body;for(const request of requests)assert.deepEqual(request.body,first,'payload/IDs/guards unchanged');assert.equal((await source('UI-002')).statusLogs.filter(log=>log.text==='未知ACK但只一筆歷程').length,1);
   }finally{qa.setRecordFault(null);}
 });
 await check('native-original-case-close-reopen-returns-to-source',async()=>{
   const item=await source('UI-002');await nodeClick(`[...document.querySelector('[data-tracking-id="${item.id}"]').querySelectorAll('button')].find(n=>n.innerText==='查看內控／已同步')`);await until(()=>evaluate("Boolean(document.querySelector('.ic-edit-modal'))"),'linked original case editor');
   assert.ok((await text()).includes(item.id),'exact source effect explanation');await click('結案並保存');await dateInput('[aria-label="結案日期"]','2026-09-26');await click('確認結案');await finishEditor();assert.equal((await source('UI-002')).isClosed,true);
   await click('配件/物料/工程跟蹤');await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'return to tracking');await trackingTab('配件物料總清單');await until(()=>evaluate(`Boolean(document.querySelector('[data-tracking-id="${item.id}"]'))`),'tracking source loaded after case return');await nodeClick(`[...document.querySelector('[data-tracking-id="${item.id}"]').querySelectorAll('button')].find(n=>n.innerText==='查看內控／已同步')`);await until(()=>evaluate("Boolean(document.querySelector('.ic-edit-modal'))"),'closed case original editor');await click('改為未結案');await finishEditor();assert.equal((await source('UI-002')).isClosed,false);
   await click('配件/物料/工程跟蹤');await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'source after original reopen');
 });
 await check('native-original-task-close-reopen-exact-group',async()=>{
   const item=await source('UI-002');await click('內控異常');await until(()=>evaluate("Boolean(document.querySelector('.ic-table'))"),'internal control list');
   const openTask=async()=>{await nodeClick(`[...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.innerText.includes('UI-002')).querySelectorAll('button')[1]`);await until(()=>evaluate("Boolean(document.querySelector('#task-edit-title'))"),'original linked task editor');};
   await openTask();assert.ok((await text()).includes(item.id));await click('標記結案');await click('保存變更');await finishEditor();assert.equal((await source('UI-002')).isClosed,true);
   await click('配件/物料/工程跟蹤');await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'return');await trackingTab('配件物料總清單');await rowAction('UI-002','重開此案');await click('確認保存 1 項');await finishEditor();
   // Close once more from source and reopen at the original Task entry.
   await rowAction('UI-002','結案');await dateInput('[aria-label="結案日期"]','2026-09-26');await click('確認保存 1 項');await finishEditor();await click('內控異常');await until(()=>evaluate("Boolean(document.querySelector('.ic-tabs'))"),'closed cases');await nodeClick("[...document.querySelectorAll('.ic-tabs button')].find(n=>n.innerText.startsWith('內控結案清單'))");await openTask();await click('重新開啟');await click('保存變更');await finishEditor();assert.equal((await source('UI-002')).isClosed,false);
   await click('配件/物料/工程跟蹤');await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'back after task');
 });
 await check('native-App-390-local-table-overflow',async()=>{
   await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
   const geometry=await evaluate("({width:innerWidth,document:document.documentElement.scrollWidth,local:document.querySelector('.tracking-table-scroll').scrollWidth>document.querySelector('.tracking-table-scroll').clientWidth})");assert.equal(geometry.width,390);assert.ok(geometry.document<=390,JSON.stringify(geometry));assert.equal(geometry.local,true);await screen('tracking-native-App-390-light');
   await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 });
 await check('native-original-actor-switch-current-authorized-vessel-only',async()=>{
   await click('切換/退出');await until(async()=>(await text()).includes('人員登入／切換'),'login switch');await select("document.querySelector('[aria-label=登入人員]')",'qa-operator');await fill('input[type="password"]',qa.password);await click('登入');await until(async()=>(await text()).includes('QA OPERATOR｜操作員'),'current operator');await click('配件/物料/工程跟蹤');await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'operator tracking');assert.deepEqual(await evaluate("[...document.querySelector('[aria-label=跟蹤船舶]').options].map(n=>n.value)"),['qa-v1']);assert.ok((await text()).includes('已選 0 項'));await screen('tracking-native-operator-scope');
 });
}

import assert from 'node:assert/strict';

// Original controls, separate logged-in identities and independent native SQL.
export async function editEntryChecks(c){
 const {a,b,qa,native,read,until,check,evidence}=c;
 const locks=async()=> (await native.observer.query('select section_key,locked_by_name from ship_dynamics_edit_locks where workspace_key=$1 and expires_at>clock_timestamp() order by section_key',[qa.workspace])).rows;
 const editable=(p,selector)=>p.eval(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return Boolean(n&&n.matches('input,textarea,[contenteditable="true"]')&&n.getClientRects().length&&!n.matches(':disabled')&&!n.readOnly);})()`);
 const attempt=async(p,expression,selector)=>{
  const start=(evidence.dialogs||[]).length;
  await p.activate(expression);
  await until(async()=>await editable(p,selector)||(evidence.dialogs||[]).slice(start).some(d=>d.actor===p.actor&&d.type==='alert'),'writable editor or visible admission denial');
  return {editable:await editable(p,selector),dialogs:(evidence.dialogs||[]).slice(start).filter(d=>d.actor===p.actor)};
 };
 const trySource=(p,ref)=>attempt(p,`[...(${p.row(ref)})?.querySelectorAll('button')||[]].find(n=>n.innerText.trim()==='進度')`,`[aria-label="${ref} 最新進度"]`);
 const group=async(ref)=>{const d=(await read()).payload,s=d.trackingItems.find(r=>r.referenceNo===ref),i=d.internalControlCases.find(r=>r.id===s.linkedCaseId),t=i&&d.tasks.find(r=>r.id===i.linkedTaskId);return{s,i,t,keys:[`tracking:${s.id}`,...(i?[`internal-control:${i.id}`]:[]),...(t?[`task:${t.id}`]:[])].sort()};};
 const tryCase=(p,ref)=>attempt(p,`[...(${p.row(ref)})?.querySelectorAll('button')||[]].find(n=>n.innerText.trim()==='查看內控／已同步')`,'.ic-status-add textarea');
 const clear=async(p)=>{await p.click('取消');await until(()=>p.eval("!document.querySelector('.modal-backdrop')"),'editor close');};
 await check('E01-source-entry-denies-peer-owner-can-save',async()=>{
  await a.click('＋ 新增／批量新增');await a.fill('[aria-label="第 1 筆 項目編號"]','ENTRY-001');await a.fill('[aria-label="第 1 筆 內容摘要／工程內容"]','編輯進場排他測試');await a.submit();await a.done();await b.sync();
  const before=await read();
  assert.equal((await trySource(a,'ENTRY-001')).editable,true);
  await a.fill('[aria-label="ENTRY-001 最新進度"]','第一位編輯者可以保存');
  const second=await trySource(b,'ENTRY-001');
  assert.equal(second.editable,false,'peer must be denied BEFORE editing, not only on Save');
  assert.ok(second.dialogs.some(d=>d.message.includes('QA OWNER')),'denial names the current holder');
  assert.deepEqual(await read(),before,'admission/typing makes no business writes');
  assert.equal((await locks()).length,1,'only the exact source is locked');
  await b.screen('E01-denied-peer');await a.submit();await a.done();
  assert.equal((await read()).payload.trackingItems[0].progress,'第一位編輯者可以保存');
  await until(async()=>!(await locks()).length,'all editor leases released on confirmed close');
  assert.equal((await trySource(b,'ENTRY-001')).editable,true,'peer admitted after confirmed close');
  await b.click('取消');
 });
 await check('E02-related-source-case-task-both-directions',async()=>{
  await a.tracking();await a.action('ENTRY-001','同步到內控');
  await a.tap("[...document.querySelectorAll('.ic-batch-row label')].find(n=>n.innerText.trim()==='同步到要事').querySelector('input')");
  await a.click('保存 1 筆案件');await a.done();await b.sync();await b.tracking();
  const g=await group('ENTRY-001');assert.ok(g.i&&g.t);
  await trySource(a,'ENTRY-001');
  assert.deepEqual((await locks()).map(l=>l.section_key),g.keys,'source admission owns exact full group');
  assert.equal((await tryCase(b,'ENTRY-001')).editable,false,'source prevents related case edit');
  await clear(a);await a.tracking();await b.tracking();
  assert.equal((await tryCase(a,'ENTRY-001')).editable,true);
  assert.deepEqual((await locks()).map(l=>l.section_key),g.keys,'case admission owns same group');
  assert.equal((await trySource(b,'ENTRY-001')).editable,false,'case prevents source edit');
  await a.fill('.ic-status-add textarea','內控第一位可以保存');await a.click('加入狀態記錄');await a.click('保存更新');await a.done();
  await a.tracking();await b.tracking();await b.openTask('ENTRY-001');
  assert.deepEqual((await locks()).map(l=>l.section_key),g.keys,'task admission owns same group');
  assert.equal((await trySource(a,'ENTRY-001')).editable,false,'task prevents source edit');
  await b.fill('.quick-status-bar textarea','要事第一位可以保存');await b.click('加入狀態紀錄');await b.click('保存變更');await b.done();
  await until(async()=>!(await locks()).length,'related group fully released');
 });
 await check('E03-batch-union-contention-rollback-and-unrelated',async()=>{
  await a.tracking();await a.click('＋ 新增／批量新增');
  for(let n=1;n<=2;n++){if(n>1)await a.click('＋ 新增一列');await a.fill(`[aria-label="第 ${n} 筆 項目編號"]`,`ENTRY-00${n+1}`);await a.fill(`[aria-label="第 ${n} 筆 內容摘要／工程內容"]`,`同船獨立項目 ${n}`);}
  await a.submit(2);await a.done();await b.tracking();await b.sync();
  for(const ref of ['ENTRY-001','ENTRY-002'])await a.tap(`(${a.row(ref)}).querySelector('input[type=checkbox]')`);
  await a.click('批量更新進度');await a.fill('[aria-label="ENTRY-001 最新進度"]','整批保護');
  const g1=await group('ENTRY-001'),g2=await group('ENTRY-002'),g3=await group('ENTRY-003');
  assert.deepEqual((await locks()).map(l=>l.section_key),[...g1.keys,...g2.keys].sort());
  assert.equal((await trySource(b,'ENTRY-002')).editable,false,'batch excludes each selected member');
  assert.equal((await tryCase(b,'ENTRY-001')).editable,false,'batch excludes member relation');
  await b.tracking();assert.equal((await trySource(b,'ENTRY-003')).editable,true,'unrelated same-vessel source remains writable');
  await b.fill('[aria-label="ENTRY-003 最新進度"]','不相干項目照常保存');await b.submit();await b.done();
  await a.submit(2);await a.done();await until(async()=>!(await locks()).length,'batch confirmed close releases all');
  await b.tracking();assert.equal((await trySource(b,'ENTRY-001')).editable,true);
  const before=await read();await a.tracking();
  for(const ref of ['ENTRY-001','ENTRY-002'])await a.tap(`(${a.row(ref)}).querySelector('input[type=checkbox]')`);
  const denied=await attempt(a,"[...document.querySelectorAll('button')].find(n=>n.innerText.trim()==='批量更新進度')",'[aria-label="ENTRY-002 最新進度"]');
  assert.equal(denied.editable,false,'one busy member denies the whole batch');
  assert.ok(denied.dialogs.some(d=>d.message.includes('QA OPERATOR')));
  assert.deepEqual((await locks()).map(l=>l.section_key),g1.keys,'failed batch leaves only original owner locks');
  assert.deepEqual(await read(),before,'failed admission performs no business writes');
  await clear(b);
 });
 await check('E04-related-lease-loss-freezes-input-retains-draft',async()=>{
  await a.tracking();await b.tracking();
  assert.equal((await trySource(a,'ENTRY-001')).editable,true);
  await a.fill('[aria-label="ENTRY-001 最新進度"]','失鎖仍保留的未送出草稿');
  const before=await read(),g=await group('ENTRY-001');
  await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key=$2",[qa.workspace,`internal-control:${g.i.id}`]);
  await until(()=>evidence.network.some(n=>n.caseId==='E04-related-lease-loss-freezes-input-retains-draft'&&n.rpc==='renew_ship_dynamics_edit_lock'&&n.ok===false),'actual related renewal fails',40000);
  await until(async()=>!await editable(a,'[aria-label="ENTRY-001 最新進度"]'),'lost relation lease disables actual input',3000);
  assert.equal(await a.eval('document.querySelector(\'[aria-label="ENTRY-001 最新進度"]\').value'),'失鎖仍保留的未送出草稿');
  assert.deepEqual(await read(),before,'lease loss does not commit draft');await a.screen('E04-frozen-draft');
  await a.click('重新取得編輯權／核對最新資料');
  await until(()=>editable(a,'[aria-label="ENTRY-001 最新進度"]'),'explicitly re-admitted with original draft');
  assert.equal(await a.eval('document.querySelector(\'[aria-label="ENTRY-001 最新進度"]\').value'),'失鎖仍保留的未送出草稿');
  assert.deepEqual(await read(),before);await a.submit();await a.done();
 });
 await check('E05-held-ACK-new-input-keeps-full-editor-group',async()=>{
  await a.tracking();await b.tracking();await a.progress('ENTRY-001','本次提交 A');
  let entered=false,finish;const held=new Promise(r=>finish=r);
  qa.setRecordFault({after:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&body.p_actor_user_id==='qa-owner'){entered=true;await held;}}});
  try{await a.submit();await until(()=>entered,'real COMMIT with held HTTP ACK');await a.fill('[aria-label="ENTRY-001 最新進度"]','等待中新增 B');assert.equal((await group('ENTRY-001')).s.progress,'本次提交 A');}finally{finish();qa.setRecordFault(null);}
  await until(async()=>(await a.text()).includes('等待期間的新輸入仍保留'),'newer draft retained after ACK');
  assert.equal(await editable(a,'[aria-label="ENTRY-001 最新進度"]'),true);
  assert.deepEqual((await locks()).map(l=>l.section_key),(await group('ENTRY-001')).keys);
  assert.equal((await trySource(b,'ENTRY-001')).editable,false,'peer remains excluded while newer unsent input exists');
  await a.submit();await a.done();assert.equal((await group('ENTRY-001')).s.progress,'等待中新增 B');
 });
 await check('E06-create-retained-input-and-restore-admission',async()=>{
  await a.click('＋ 新增／批量新增');
  for(let n=1;n<=2;n++){if(n>1)await a.click('＋ 新增一列');await a.fill(`[aria-label="第 ${n} 筆 項目編號"]`,`ENTRY-00${n+3}`);await a.fill(`[aria-label="第 ${n} 筆 內容摘要／工程內容"]`,`新建 ${n}`);}
  let entered=false,finish;const held=new Promise(r=>finish=r);
  qa.setRecordFault({after:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&body.p_actor_user_id==='qa-owner'){entered=true;await held;}}});
  try{await a.submit(2);await until(()=>entered,'create committed with ACK held');await a.fill('[aria-label="第 2 筆 內容摘要／工程內容"]','新建後額外輸入');}finally{finish();qa.setRecordFault(null);}
  await until(async()=>(await a.text()).includes('等待期間的新輸入仍保留'),'retained create becomes existing editor');
  const g4=await group('ENTRY-004'),g5=await group('ENTRY-005');assert.deepEqual((await locks()).map(l=>l.section_key),[...g4.keys,...g5.keys].sort());
  assert.equal(await editable(a,'[aria-label="第 2 筆 內容摘要／工程內容"]'),true);
  await a.submit(2);await a.done();assert.equal((await group('ENTRY-005')).s.description,'新建後額外輸入');
  await a.progress('ENTRY-001','私有草稿稍後恢复');await a.click('取消');await a.click('保留草稿並繼續');await until(()=>a.eval("!document.querySelector('.modal-backdrop')"),'private draft stored and editor closed');
  await b.tracking();await b.sync();await trySource(b,'ENTRY-001');
  await a.click('恢復本船未送出草稿');await until(()=>a.eval("!!document.querySelector('.tracking-modal')"),'retained draft shown read-only');
  assert.equal(await editable(a,'[aria-label="ENTRY-001 最新進度"]'),false,'restoration cannot bypass peer lease');
  assert.equal(await a.eval('document.querySelector(\'[aria-label="ENTRY-001 最新進度"]\').value'),'私有草稿稍後恢复');
  await clear(b);await a.click('重新取得編輯權／核對最新資料');await until(()=>editable(a,'[aria-label="ENTRY-001 最新進度"]'),'restore reacquired');await a.submit();await a.done();
 });
 await check('E07-case-batch-date-editor-admission',async()=>{
  await a.click('內控異常');await until(()=>a.eval("!!document.querySelector('.ic-table')"),'case table');
  const row="[...document.querySelectorAll('.ic-table tbody tr')].find(n=>n.innerText.includes('ENTRY-001'))";
  await a.tap(`(${row}).querySelector('input[type=checkbox]')`);
  await a.activate("[...document.querySelectorAll('button')].find(n=>n.innerText.includes('批量結案')&&!n.disabled)");
  await until(()=>editable(a,'[aria-label=結案日期]'),'batch date writable');
  const g=await group('ENTRY-001');
  assert.deepEqual((await locks()).map(l=>l.section_key),g.keys,'date selection itself is an exclusive batch editor');
  await b.tracking();assert.equal((await trySource(b,'ENTRY-001')).editable,false);
  await a.date('[aria-label=結案日期]','2026-09-26');await a.click('確認結案');await until(()=>a.eval("!document.querySelector('[aria-label=結案日期]')"),'batch closure confirmed');
  assert.equal((await group('ENTRY-001')).s.isClosed,true);await until(async()=>!(await locks()).length,'batch date close releases group');
 });
 await check('E08-case-and-task-lease-loss-retains-the-actual-editor',async()=>{
  await a.tracking();
  for(const ref of ['ENTRY-002','ENTRY-003']){await a.action(ref,'同步到內控');await a.tap("[...document.querySelectorAll('.ic-batch-row label')].find(n=>n.innerText.trim()==='同步到要事').querySelector('input')");await a.click('保存 1 筆案件');await a.done();}
  await b.tracking();await b.sync();await tryCase(a,'ENTRY-002');await a.fill('.ic-status-add textarea','內控失鎖未加入的文字');
  await b.openTask('ENTRY-003');await b.fill('.quick-status-bar textarea','要事失鎖未加入的文字');
  const g2=await group('ENTRY-002'),g3=await group('ENTRY-003'),before=await read();
  await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key=any($2::text[])",[qa.workspace,[`tracking:${g2.s.id}`,`tracking:${g3.s.id}`]]);
  for(const [p,selector,text] of [[a,'.ic-status-add textarea','內控失鎖未加入的文字'],[b,'.quick-status-bar textarea','要事失鎖未加入的文字']]){
   await until(()=>evidence.network.some(n=>n.caseId==='E08-case-and-task-lease-loss-retains-the-actual-editor'&&n.actor===p.actor&&n.rpc==='renew_ship_dynamics_edit_lock'&&n.ok===false),'real failed relation heartbeat '+p.actor,40000);
   await until(async()=>!await editable(p,selector),'frozen '+p.actor,3000);
   assert.equal(await p.eval(`document.querySelector(${JSON.stringify(selector)})?.value`),text,'actual native editor retains unsent text after group loss');
   await p.screen('E08-frozen');
  }
  assert.deepEqual(await read(),before);await clear(a);await b.click('關閉');await until(()=>b.eval("!document.querySelector('.modal-backdrop')"),'frozen task explicit close');
 });
 await check('E10-source-sync-form-loss-freezes-and-readmits',async()=>{
  await a.tracking();await a.action('ENTRY-005','同步到內控');const selector='.ic-batch-row .ic-case-content-row .field:first-child textarea';
  await a.fill(selector,'同步表單失鎖保留');const before=await read(),g=await group('ENTRY-005');
  await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key=$2",[qa.workspace,`tracking:${g.s.id}`]);
  await until(()=>evidence.network.some(n=>n.caseId==='E10-source-sync-form-loss-freezes-and-readmits'&&n.rpc==='renew_ship_dynamics_edit_lock'&&n.ok===false),'sync form real lease failure',40000);
  assert.equal(await editable(a,selector),false,'sync-to-case form must freeze like the progress editor');assert.equal(await a.eval(`document.querySelector(${JSON.stringify(selector)})?.value`),'同步表單失鎖保留');assert.deepEqual(await read(),before);
  await a.click('重新取得編輯權／核對最新資料');await until(()=>editable(a,selector),'sync form explicit readmission');await a.click('保存 1 筆案件');await a.done();assert.equal((await group('ENTRY-005')).i.description,'同步表單失鎖保留');
 });
 await check('E09-missing-receipt-expired-lease-retains-exact-pending',async()=>{
  await a.tracking();await a.progress('ENTRY-004','未知提交未到達 SQL');
  const before=await read(),requests=[];
  qa.setRecordFault({before:async({name,body})=>{if(name==='apply_ship_dynamics_record_patch_v1'&&body.p_actor_user_id==='qa-owner'){requests.push({id:body.p_operation_id,hash:c.sha(body)});throw Error('QA transport failed before SQL');}}});
  try{
   await a.submit();await a.pending();assert.ok(requests.length);assert.equal(new Set(requests.map(r=>r.id)).size,1);assert.equal(new Set(requests.map(r=>r.hash)).size,1);
   const g=await group('ENTRY-004');await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key=$2",[qa.workspace,`tracking:${g.s.id}`]);
   await until(()=>evidence.network.some(n=>n.caseId==='E09-missing-receipt-expired-lease-retains-exact-pending'&&n.rpc==='renew_ship_dynamics_edit_lock'&&n.ok===false),'unknown submit then actual lease loss',40000);
   const count=requests.length,start=evidence.network.length;await a.click('確認結果／重試相同提交');
   await until(()=>evidence.network.slice(start).some(n=>n.rpc==='get_ship_dynamics_record_receipt_v1'&&n.finished),'original receipt checked after expiry');
   await a.pending();assert.equal(requests.length,count,'missing receipt and expired owner must not generate a new mutation');assert.deepEqual(await read(),before);
   assert.equal(await a.eval('document.querySelector(\'[aria-label="ENTRY-004 最新進度"]\')?.value'),'未知提交未到達 SQL');
   evidence.missingExpiredReceipt={requests,mutationsAfterExpiry:0,pendingRetained:true,confirmed:false};
  }finally{qa.setRecordFault(null);}
 });
}

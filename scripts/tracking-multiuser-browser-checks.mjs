import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function multiuserChecks(c){
 const {a,b,page,qa,native,read,source,until,check,blockNext,release,observeBlocking,evidence,sha,run}=c;
 const mainRpc='apply_ship_dynamics_record_patch_v1',shipRpc='submit_ship_dynamics_internal_control_public_v1';
 const group=async(ref)=>{const data=(await read()).payload,s=data.trackingItems.find(r=>r.referenceNo===ref),item=data.internalControlCases.find(i=>i.id===s.linkedCaseId),task=item&&data.tasks.find(t=>t.id===item.linkedTaskId);return {data,s,item,task};};
 const graph=async()=>{const {payload:d}=await read();for(const key of ['trackingItems','internalControlCases','tasks'])assert.equal(new Set(d[key].map(r=>r.id)).size,d[key].length,'unique '+key);for(const s of d.trackingItems.filter(r=>r.linkState==='active')){const cases=d.internalControlCases.filter(i=>i.id===s.linkedCaseId);assert.equal(cases.length,1);const i=cases[0];assert.equal(i.trackingItemId,s.id);assert.equal(i.isClosed,s.isClosed);assert.equal(i.closedDate,s.closedDate);if(i.syncToTask){const ts=d.tasks.filter(t=>t.id===i.linkedTaskId);assert.equal(ts.length,1);assert.equal(ts[0].internalControlCaseId,i.id);assert.equal(ts[0].isClosed,i.isClosed);assert.equal(ts[0].closedDate,i.closedDate);}}};
 const saveProgress=async(p,ref,value)=>{await p.progress(ref,value);await p.submit();await p.done();assert.equal((await source(ref)).progress,value);};
 const draft=async(p,ref,value)=>assert.equal(await p.eval(`document.querySelector('[aria-label="${ref} 最新進度"]')?.value`),value,'exact retained '+p.actor+' draft');
 const syncTaskCheckbox=p=>p.tap("[...document.querySelectorAll('.ic-batch-row label')].find(n=>n.innerText.trim()==='同步到要事').querySelector('input')");
 const stash=async p=>{await p.click('取消');await p.click('保留草稿並繼續');await until(()=>p.eval("!document.querySelector('.modal-backdrop')"),'private draft kept, editor released');};
 const restore=async p=>{await p.click('恢復本船未送出草稿');await until(()=>p.eval("!!document.querySelector('.tracking-modal')"),'draft restored through normal admission');};
 const denySource=async(p,ref)=>{const from=(evidence.dialogs||[]).length;await p.activate(`[...(${p.row(ref)})?.querySelectorAll('button')||[]].find(n=>n.innerText.trim()==='進度')`);await until(()=>evidence.dialogs.slice(from).some(d=>d.actor===p.actor&&d.type==='alert'&&d.message.includes('QA OWNER')),'peer denied before source editing');assert.equal(await p.eval("!!document.querySelector('.tracking-modal')"),false);};
 await check('M01-distinct-actors-same-vessel-different-items-real-overlap',async()=>{
  await a.click('＋ 新增／批量新增');
  for(let i=1;i<=4;i++){if(i>1)await a.click('＋ 新增一列');await a.fill(`[aria-label="第 ${i} 筆 申請單號(材料或工程)"]`,'MC-00'+i);await a.fill(`[aria-label="第 ${i} 筆 內容摘要/工程內容"]`,'多人驗收獨立來源 '+i);}
  await a.submit(4);await a.done();await b.sync();await b.tracking();await until(()=>b.eval("document.querySelector('.tracking-table')?.innerText.includes('MC-004')"),'B current source list');
  const before=await read();await a.progress('MC-001','甲保存第一項');await b.progress('MC-002','乙保存第二項');
  const hold=blockNext(mainRpc);
  try{await a.submit();await until(()=>hold.entered,'A SQL before commit');await b.submit();await observeBlocking(hold);assert.equal((await read()).revision,before.revision);await draft(b,'MC-002','乙保存第二項');await b.screen('M01-independent-wait');}finally{release();}
  await a.done();await b.done();assert.equal((await source('MC-001')).progress,'甲保存第一項');assert.equal((await source('MC-002')).progress,'乙保存第二項');assert.equal((await read()).revision,before.revision+2);await graph();
 });
 await check('M02-same-item-held-ACK-peer-lock-CAS-retains-draft',async()=>{
  await a.sync();await b.sync();await b.progress('MC-001','乙同項待核對');await stash(b);await a.progress('MC-001','甲同項先保存');
  let held=false,done;const barrier=new Promise(r=>done=r);qa.setRecordFault({after:async({name,body})=>{if(name===mainRpc&&body.p_actor_user_id==='qa-owner'){held=true;await barrier;}}});
  try{await a.submit();await until(()=>held,'committed A receipt held');await denySource(b,'MC-001');assert.equal((await source('MC-001')).progress,'甲同項先保存');await b.screen('M02-peer-blocked-draft');}finally{done();qa.setRecordFault(null);}
  await a.done();await restore(b);await b.submit();await b.pending();const priorDialogs=(evidence.dialogs||[]).length;await b.click('確認結果／重試相同提交');await until(()=>evidence.dialogs.slice(priorDialogs).some(d=>d.actor==='qa-operator'&&d.message==='tracking-stale-source'),'stale exact retry alert');await b.pending();const winner=await read();await draft(b,'MC-001','乙同項待核對');assert.equal(await b.eval("!!document.querySelector('.save-status-strip.saved')"),false,'rejected tracking draft must not advertise globally saved');assert.ok((await b.text()).includes('跟蹤表單尚有未提交的修改'),'feedback names the current tracking form');await b.screen('M02-safe-blocked-draft');await b.reconcile();assert.deepEqual(await read(),winner,'reconciliation is read only');await b.submit();await b.done();const s=await source('MC-001');for(const text of ['甲同項先保存','乙同項待核對'])assert.equal(s.statusLogs.filter(l=>l.text===text).length,1);assert.equal(s.progress,'乙同項待核對');
 });
 await check('M03-stale-member-rejects-whole-batch-no-partial-write',async()=>{
  await a.sync();await b.sync();for(const ref of ['MC-001','MC-002'])await b.tap(`(${b.row(ref)}).querySelector('input[type=checkbox]')`);await b.click('批量更新進度');await b.fill('[aria-label="MC-001 最新進度"]','乙批次第一項');await b.fill('[aria-label="MC-002 最新進度"]','乙批次第二項');
  await stash(b);await saveProgress(a,'MC-002','甲在批次期間更新第二項');const peer=await read();await restore(b);await b.submit(2);await b.pending();assert.deepEqual(await read(),peer,'no partial batch writes');await draft(b,'MC-001','乙批次第一項');await draft(b,'MC-002','乙批次第二項');await b.reconcile();await b.submit(2);await b.done();assert.equal((await read()).revision,peer.revision+1);assert.equal((await source('MC-001')).progress,'乙批次第一項');assert.equal((await source('MC-002')).progress,'乙批次第二項');
 });
 await check('M04-linked-case-edit-blocks-peer-source-and-preserves-history',async()=>{
  await a.sync();
  for(const ref of ['MC-001','MC-003','MC-004']){await a.action(ref,'同步到內控');await syncTaskCheckbox(a);await a.click('保存 1 筆案件');await a.done();}
  await graph();await b.sync();await b.progress('MC-001','乙關聯來源進度');await stash(b);await a.action('MC-001','查看內控／已同步');await until(()=>a.eval("!!document.querySelector('.ic-edit-modal')"),'case editor');
  await a.fill('.ic-status-add textarea','甲主頁內控進度');await a.click('加入狀態記錄');
  const before=await read();await denySource(b,'MC-001');assert.deepEqual(await read(),before);
  await a.click('保存更新');await a.done();assert.equal((await group('MC-001')).item.status,'甲主頁內控進度');
  await restore(b);await b.submit();await b.done();const g=await group('MC-001');assert.equal(g.item.status,'乙關聯來源進度');assert.equal(g.s.progress,'乙關聯來源進度');assert.ok(g.item.statusLogs.some(l=>l.text==='甲主頁內控進度'),'peer case history retained when source progress is later appended');assert.ok(g.task);await graph();
 });
 await check('M05-two-actors-source-case-task-close-and-reopen',async()=>{
  await a.tracking();await a.sync();await b.sync();await a.action('MC-001','結案');await a.date('[aria-label=結案日期]','2026-09-26');await a.submit();await a.done();await graph();assert.equal((await group('MC-001')).task.isClosed,true);
  await b.sync();await b.openTask('MC-001',true);await b.click('重新開啟');await b.click('保存變更');await b.done();await graph();assert.equal((await source('MC-001')).isClosed,false);
  await a.sync();await a.action('MC-001','查看內控／已同步');await a.click('結案並保存');await a.date('[aria-label=結案日期]','2026-09-27');await a.click('確認結案');await a.done();await graph();
  await b.tracking();await b.sync();await b.action('MC-001','重開此案');await b.submit();await b.done();await graph();const g=await group('MC-001');assert.equal(g.s.isClosed,false);assert.equal(g.s.actualDeliveryDate,undefined,'closure never means delivered');assert.equal(g.s.deliveryStatus,'not-delivered');assert.ok(g.s.events.filter(e=>e.action==='reopen').length>=2);
 });
 await check('M06-case-delete-vs-peer-source-draft-no-resurrection',async()=>{
  await a.tracking();await a.sync();await b.sync();await b.progress('MC-003','乙刪案後保留來源進度');await stash(b);const before=await group('MC-003');await a.action('MC-003','查看內控／已同步');await a.click('刪除案件');await a.done();
  let after=await read();assert.ok(!after.payload.internalControlCases.some(i=>i.id===before.item.id));assert.ok(!after.payload.tasks.some(t=>t.id===before.task.id));assert.notEqual((await source('MC-003')).linkState,'active');
  await restore(b);await b.submit();await b.pending();assert.deepEqual(await read(),after,'stale save cannot revive deleted case/task');await draft(b,'MC-003','乙刪案後保留來源進度');await b.reconcile();await b.submit();await b.done();
  after=await read();assert.equal((await source('MC-003')).progress,'乙刪案後保留來源進度');assert.ok(!after.payload.internalControlCases.some(i=>i.id===before.item.id));assert.ok(!after.payload.tasks.some(t=>t.id===before.task.id));await graph();
 });
 await check('M07-task-delete-vs-peer-source-edit-keeps-case-unlinked',async()=>{
  await a.tracking();await a.sync();await b.sync();await b.progress('MC-004','乙刪要事後來源進度');await stash(b);const before=await group('MC-004');await a.openTask('MC-004');await a.click('刪除待辦');await a.done();
  let g=await group('MC-004');assert.ok(g.item);assert.equal(g.item.syncToTask,false);assert.equal(g.item.linkedTaskId,undefined);assert.equal(g.s.linkState,'invalid');assert.equal(g.item.trackingLinkState,'invalid');assert.ok(!g.data.tasks.some(t=>t.id===before.task.id));const retainedCase=structuredClone(g.item);
  await restore(b);await b.submit();await until(async()=>!await b.eval("!!document.querySelector('.tracking-modal')")||(await b.text()).includes('確認結果／重試相同提交'),'peer save terminal');
  if(await b.eval("!!document.querySelector('.tracking-modal')")){await b.reconcile();await b.submit();}await b.done();
  g=await group('MC-004');assert.equal(g.s.progress,'乙刪要事後來源進度');assert.deepEqual(g.item,retainedCase,'invalidated link must not resume source-to-case writes');assert.equal(g.item.syncToTask,false);assert.equal(g.s.isClosed,before.s.isClosed);assert.ok(!g.data.tasks.some(t=>t.id===before.task.id));await graph();
 });
 await check('M08-two-ship-contexts-same-vessel-append-with-shore-draft',async()=>{
  await a.tracking();await a.sync();await a.progress('MC-002','甲船端雙提報後保存');
  const s1=await page('ship-A',true),s2=await page('ship-B',true);assert.notEqual(s1.context,s2.context);
  for(const [p,description] of [[s1,'船端甲同船提報'],[s2,'船端乙同船提報']]){await p.activate("[...document.querySelectorAll('button')].find(n=>n.innerText.includes('增加內控/訴求'))");await p.fill('#ship-internal-reporter',p.actor+' 大副');await p.choose('.ic-batch-row .ic-case-classification-row .field:nth-child(2) select','維修');await p.fill('.ic-batch-row .ic-case-content-row .field:first-child textarea',description);await p.fill('.ic-batch-row .ic-case-content-row .field:nth-child(2) textarea','待辦公室跟進');assert.equal((await p.text()).includes('同步到要事'),false,'ship has no office-only Task choice');}
  const before=await read(),hold=blockNext(shipRpc);
  try{await s1.click('提交 1 筆');await until(()=>hold.entered,'ship A before commit');await s2.click('提交 1 筆');await observeBlocking(hold);assert.equal((await read()).revision,before.revision);await draft(a,'MC-002','甲船端雙提報後保存');}finally{release();}
  for(const p of [s1,s2])await until(async()=>(await p.text()).includes('成功提交 1 筆')&&!await p.eval("!!document.querySelector('.ic-batch-modal')"),'ship ACK '+p.actor);
  await a.submit();await a.done();const data=(await read()).payload;for(const [description,who] of [['船端甲同船提報','ship-A'],['船端乙同船提報','ship-B']]){const rows=data.internalControlCases.filter(i=>i.description.startsWith(description));assert.equal(rows.length,1);assert.ok(rows[0].description.includes(who+' 大副'));assert.equal(rows[0].vesselId,'qa-v1');assert.equal(rows[0].syncToTask,false);}assert.equal((await source('MC-002')).progress,'甲船端雙提報後保存');await graph();await a.screen('M08-all-three-saves');
 });
 await check('M09-lost-ACK-exact-recovery-preserves-peer-later-save',async()=>{
  await a.sync();await b.sync();await a.progress('MC-001','甲未知回應原提交');const captured=[];
  qa.setRecordFault({before:async({name,body})=>{if([mainRpc,'get_ship_dynamics_record_receipt_v1'].includes(name)&&body.p_actor_user_id==='qa-owner')captured.push({name,id:body.p_operation_id,hash:sha(body)});},after:async({name,body})=>[mainRpc,'get_ship_dynamics_record_receipt_v1'].includes(name)&&body.p_actor_user_id==='qa-owner'});
  try{await a.submit();await a.pending();assert.equal((await source('MC-001')).progress,'甲未知回應原提交');await saveProgress(b,'MC-002','乙在甲未知回應期間保存');const both=await read();
   qa.setRecordFault({before:async({name,body})=>{if([mainRpc,'get_ship_dynamics_record_receipt_v1'].includes(name)&&body.p_actor_user_id==='qa-owner')captured.push({name,id:body.p_operation_id,hash:sha(body)});}});
   await a.click('確認結果／重試相同提交');await a.done();assert.deepEqual(await read(),both,'exact recovery never rewrites peer current state');assert.equal(new Set(captured.map(r=>r.id)).size,1);assert.equal(new Set(captured.map(r=>r.hash)).size,1);assert.equal((await source('MC-001')).statusLogs.filter(l=>l.text==='甲未知回應原提交').length,1);evidence.exactRecovery=captured;await a.screen('M09-recovered');
  }finally{qa.setRecordFault(null);}await graph();
 });
 await check('M10-fresh-two-actor-UI-and-independent-SQL-readback',async()=>{
  const expected=await read(),connection=await native.connect('fresh_multiuser_readback');try{const actual=(await connection.query('select read_ship_dynamics_records_v1($1) r',[qa.workspace])).rows[0].r;assert.deepEqual(actual,expected);}finally{await connection.end();}
  for(const actor of ['qa-owner','qa-operator']){const fresh=await page(actor);await until(()=>fresh.eval("document.querySelector('.tracking-table')?.innerText.includes('MC-004')"),'fresh actor source list');const refs=await fresh.eval("[...document.querySelectorAll('.tracking-reference')].map(n=>n.innerText)");for(const ref of ['MC-001','MC-002','MC-003','MC-004'])assert.ok(refs.some(t=>t.includes(ref)));assert.ok((await fresh.text()).includes('乙在甲未知回應期間保存'));await fresh.click('內控異常');await until(()=>fresh.eval("document.querySelector('.ic-table')?.innerText.includes('船端乙同船提報')"),'fresh shore sees ship reports');assert.ok(!(await fresh.text()).includes('MC-003'),'deleted case absent from original UI');await fresh.screen('M10-fresh-readback');}
  await graph();assert.deepEqual(await read(),expected,'fresh readers do not mutate business records');evidence.final={revision:expected.revision,tracking:expected.payload.trackingItems.length,cases:expected.payload.internalControlCases.length,tasks:expected.payload.tasks.length,digest:sha(expected)};fs.writeFileSync(path.join(run,'final-shape.json'),JSON.stringify(evidence.final,null,2));
 });
}

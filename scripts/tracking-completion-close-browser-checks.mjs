import assert from 'node:assert/strict';
// Original mounted shore/ship entry + synthetic fixtures + private native PostgreSQL.
export async function trackingCompletionCloseChecks({qa,call,evaluate,click,nodeClick,fill,until,screen,check,audience,finish}){
 const input=label=>`document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')})`;
 const set=async(label,value)=>{await evaluate(`(()=>{const n=${input(label)};if(!n||n.disabled)throw new Error('field unavailable');Object.getOwnPropertyDescriptor(n.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(()=>evaluate(`${input(label)}.value===${JSON.stringify(value)}`),'rendered input value');};
 const choose=async ids=>{await click('清除選取');for(const id of ids)await nodeClick(`document.querySelector(${JSON.stringify('[data-tracking-id="'+id+'"] .tracking-check input')})`);await until(()=>evaluate(`document.querySelector('.tracking-toolbar>b').innerText==='已選 ${ids.length} 項'`),'exact selected set');};
 const tab=async label=>{await nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'engineering tab ready');};
 const pending=()=>evaluate('Object.values(localStorage).map(s=>{try{return JSON.parse(s)}catch{return null}}).find(s=>s?.draft?.action==="completion"&&s?.pending?.command?.type==="edit")');
 const refs=['CC-SAME','CC-SAME','CC-UNSELECTED'],descriptions=['甲工程同日完工結案','乙工程批量完工結案','未選工程保持原樣'];let rows,ids;
 const open=async()=>{await choose(ids);await click('批量完工／更正');await until(()=>evaluate('Boolean('+input('同時結案')+')'),'completion modal');};
 const prove=(before,after,closed)=>{
  assert.equal(after.revision,before.revision+1);
  for(const old of before.payload.trackingItems){const n=after.payload.trackingItems.find(r=>r.id===old.id);if(!ids.includes(old.id)){assert.deepEqual(n,old);continue;}assert.equal(n.isClosed,closed);assert.equal(n.completionDate,'2026-09-29');for(const k of ['progress','statusLogs','supplementalNotes','expectedDate','deliveryStatus','actualDeliveryDate'])assert.deepEqual(n[k],old[k]);const events=n.events.slice(old.events.length);assert.deepEqual(events.map(e=>e.action),closed?['completion','close']:['completion']);if(closed){assert.equal(n.closedDate,n.completionDate);assert.equal(n.closureOutcome,'completed');assert.equal(events[0].operationId,events[1].operationId);assert.equal(events[0].at,events[1].at);}}
  const source=after.payload.trackingItems.find(r=>r.id===ids[0]),c=after.payload.internalControlCases.find(r=>r.id===source.linkedCaseId),t=after.payload.tasks.find(r=>r.id===c.linkedTaskId);assert.ok(c&&t,'real native linked triple fixture');
  for(const [collection,end] of [['internalControlCases',c],['tasks',t]]){const old=before.payload[collection].find(r=>r.id===end.id);if(!closed){assert.deepEqual(end,old);continue;}assert.equal(end.isClosed,true);assert.equal(end.closedDate,'2026-09-29');assert.deepEqual(end.trackingLifecycle.slice(old.trackingLifecycle?.length||0),[source.events.at(-1)]);for(const k of ['description','status','statusLogs','expectedDate'])assert.deepEqual(end[k],old[k]);}
 };
 await check('CC-UI-'+audience+'-01-real-create-three-engineering-fixture',async()=>{
  await tab('未完成工程單');await click('＋ 新增／批量新增');
  for(let i=0;i<3;i++){if(i)await click('＋ 新增一列');const p=`第 ${i+1} 筆 `;await fill(`[aria-label="${p}申請單號(材料或工程)"]`,refs[i]);await fill(`[aria-label="${p}內容摘要/工程內容"]`,descriptions[i]);await fill(`[aria-label="${p}最新進度"]`,'原工程進度');await set(p+'申請/開單日期','2026-09-01');}
  await click('確認保存 3 項');await finish();const data=(await qa.read()).payload;rows=descriptions.map(d=>data.trackingItems.find(r=>r.description===d));assert.ok(rows.every(r=>r.kind==='engineering'&&!r.isClosed));ids=rows.slice(0,2).map(r=>r.id);
 });
 await check('CC-UI-'+audience+'-02-original-sync-and-native-existing-task-fixture',async()=>{
  await choose([ids[0]]);await click('同步到內控');await until(()=>evaluate('Boolean(document.querySelector(".ic-batch-modal"))'),'sync form');
  if(audience==='ship')await fill('#ship-internal-reporter','QA／輪機長');
  await evaluate(`(()=>{const n=[...document.querySelectorAll('.ic-batch-modal .field')].find(n=>n.querySelector('label')?.innerText.trim()==='事件分類 *')?.querySelector('select');if(!n||![...n.options].some(o=>o.value==='維修'))throw new Error('sync fixture category prerequisite');n.value='維修';n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(()=>evaluate(`[...document.querySelectorAll('.ic-batch-modal .field')].find(n=>n.querySelector('label')?.innerText.trim()==='事件分類 *')?.querySelector('select')?.value==='維修'`),'configured category rendered');
  await click(audience==='ship'?'提交 1 筆':'保存 1 筆案件');await finish();
  // The vessel UI never exposes tasks. Establish an existing task through the same
  // real native record writer as shore; this setup is not claimed as UI input.
  const {updateInternalControlCase}=await qa.loadModule('/src/internalControlData.ts'),{buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');const before=(await qa.read()).payload,next=structuredClone(before),u=next.users.find(r=>r.role==='owner'),source=next.trackingItems.find(r=>r.id===ids[0]),c=next.internalControlCases.find(r=>r.id===source.linkedCaseId);
  updateInternalControlCase(next,{...c,syncToTask:true},c.updatedAt,u,new Date().toISOString(),{categories:['維修'],expectedDate:'2026-11-01',ownerUserIds:[u.id],isAbnormal:false});const ops=buildCloudBlockPatch(before,next),locks=[];
  try{for(const o of ops.filter(o=>o.kind==='entity'&&['trackingItems','internalControlCases','tasks'].includes(o.collection))){const key=({trackingItems:'tracking:',internalControlCases:'internal-control:',tasks:'task:'})[o.collection]+o.entityId;const l=(await qa.db.query("select claim_ship_dynamics_edit_lock($1,$2,'qa-completion-fixture','QA FIXTURE',75) result",[qa.workspace,key])).rows[0].result;assert.ok(l.ok);locks.push({section_key:key,locked_by:l.locked_by,lease_version:l.lease_version});}const guard=(await qa.db.query('select ship_dynamics_actor_guard($1::jsonb,$2) result',[JSON.stringify(before),u.id])).rows[0].result;const r=(await qa.db.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) result',[qa.workspace,'cc-task-fixture',JSON.stringify(ops),'QA FIXTURE',u.id,JSON.stringify(guard),null,JSON.stringify(locks)])).rows[0].result;assert.ok(r.ok,'native fixture record commit');}finally{await qa.db.query("delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by='qa-completion-fixture'",[qa.workspace]);}
  assert.ok((await qa.read()).payload.tasks.some(t=>t.internalControlCaseId===c.id));
 });
 await check('CC-UI-'+audience+'-03-unchecked-only-completion-old-wire',async()=>{
  await open();assert.equal(await evaluate(input('同時結案')+'.checked'),false);await set('實際送達/完工日期','2026-09-29');const before=await qa.read();let entered=false,release;const held=new Promise(r=>release=r);
  qa.setRecordFault({after:async({name,body})=>{if(name===(audience==='ship'?'ship_dynamics_tracking_public_v1':'apply_ship_dynamics_record_patch_v1')&&(audience==='shore'||body.p_action==='submit')){entered=true;await held;}return false;}});
  try{await click('確認保存 2 項');await until(()=>entered,'plain completion committed');const saved=await pending();assert.ok(saved.pending.command.items.every(i=>!Object.hasOwn(i,'closeOnCompletion')));prove(before,await qa.read(),false);release();await finish();}finally{release();qa.setRecordFault(null);}
 });
 await tab('已完成工程單');
 await check('CC-UI-'+audience+'-04-prominent-default-mobile-and-held-ACK-linked-close',async()=>{
  await open();assert.equal(await evaluate(input('同時結案')+'.checked'),false);await set('實際送達/完工日期','2026-09-29');await nodeClick(input('同時結案'));await until(()=>evaluate(input('同時結案')+'.checked'),'checked actual checkbox');
  for(const width of [1440,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:false});await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');await evaluate('document.querySelector(".tracking-delivery-close").scrollIntoView({block:"center"})');assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));assert.ok(await evaluate('(()=>{const n=document.querySelector(".tracking-delivery-close"),r=n.getBoundingClientRect(),c=n.querySelector("input");return r.left>=0&&r.right<=innerWidth+1&&n.scrollWidth<=n.clientWidth+1&&c.getBoundingClientRect().width>=20&&(()=>{const range=document.createRange();range.selectNodeContents(n.querySelector("strong"));return range.getClientRects().length===1;})()})()'));await screen(audience+'-completion-close-'+width);}
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});if(audience==='ship')assert.ok(!await evaluate('document.body.innerText.includes("要事")'));
  const before=await qa.read();let entered=false,release;const held=new Promise(r=>release=r);await evaluate('void(window.__ccForm=document.querySelector(".tracking-modal"))');
  qa.setRecordFault({after:async({name,body})=>{if(name===(audience==='ship'?'ship_dynamics_tracking_public_v1':'apply_ship_dynamics_record_patch_v1')&&(audience==='shore'||body.p_action==='submit')){entered=true;await held;}return false;}});
  try{await click('確認完工並結案 2 項');await until(()=>entered,'completion-close native COMMIT ACK held');assert.ok(await evaluate('window.__ccForm===document.querySelector(".tracking-modal")'));assert.ok(await evaluate(input('同時結案')+'.matches(":disabled")'));assert.equal(await evaluate(input('實際送達/完工日期')+'.value'),'2026-09-29');assert.equal(await evaluate('document.querySelector(".tracking-toolbar>b").innerText'),'已選 2 項');const p=await pending();assert.ok(p.pending.command.items.every(i=>i.closeOnCompletion===true));prove(before,await qa.read(),true);release();await finish();}finally{release();qa.setRecordFault(null);}
 });
 await check('CC-UI-'+audience+'-05-lost-ACK-same-command-selection-form-exact-retry',async()=>{
  await choose(ids);await click('重開所選');await until(()=>evaluate('Boolean(document.querySelector(".tracking-modal"))'),'reopen modal');await click('確認保存 2 項');await finish();await open();assert.equal(await evaluate(input('同時結案')+'.checked'),false);await set('實際送達/完工日期','2026-09-29');await nodeClick(input('同時結案'));await evaluate('void(window.__ccForm=document.querySelector(".tracking-modal"))');
  const before=await qa.read();let committed=false,firstRecordRequest;const matches=(name,body)=>audience==='ship'?name==='ship_dynamics_tracking_public_v1'&&['submit','receipt'].includes(body.p_action):['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1'].includes(name);
  qa.setRecordFault({after:async({name,body,value})=>{if(!matches(name,body))return false;if(audience==='shore'&&name==='apply_ship_dynamics_record_patch_v1'&&!firstRecordRequest)firstRecordRequest=structuredClone(body);if(audience==='shore'||body.p_action==='submit'&&value.ok)committed=true;return committed;}});
  try{await click('確認完工並結案 2 項');await until(()=>evaluate('document.body.innerText.includes("尚未保存；輸入及精確提交已保留")'),'unknown completion retained',90000);assert.ok(committed);const after=await qa.read();prove(before,after,true);const p=await pending();assert.deepEqual(p.pending.command.items.map(i=>i.id),ids);assert.ok(p.pending.command.items.every(i=>i.closeOnCompletion===true));assert.ok(await evaluate('window.__ccForm===document.querySelector(".tracking-modal")'));assert.equal(await evaluate(input('同時結案')+'.checked'),true);assert.equal(await evaluate('document.querySelector(".tracking-toolbar>b").innerText'),'已選 2 項');assert.equal(await evaluate(input('實際送達/完工日期')+'.value'),'2026-09-29');
   let retried=false;qa.setRecordFault({before:async({name,body})=>{
    if(!matches(name,body))return;
    if(audience==='shore'){
     // The record envelope and the nested tracking command have different IDs.
     // Receipt recovery must retain the exact first outgoing record request.
     assert.ok(firstRecordRequest?.p_operation_id);assert.deepEqual(body,firstRecordRequest);
     const current=await pending();assert.deepEqual(current.pending.command,p.pending.command);assert.deepEqual(current.pending.context,p.pending.context);
     for(const id of ids)assert.equal(after.payload.trackingItems.find(r=>r.id===id).events.at(-1).operationId,p.pending.context.operationId);
     retried=true;
    }else{const operation=body.p_payload?.operationId;if(operation){assert.equal(operation,p.pending.context.operationId);retried=true;}}
   }});await click('確認結果／重試相同提交');await finish();assert.ok(retried,'same operation receipt or submit');assert.deepEqual(await qa.read(),after);
  }finally{qa.setRecordFault(null);}
 });
 await check('CC-UI-'+audience+'-06-saved-history-and-closed-entry-guard',async()=>{
  const before=await qa.read();await choose(ids);await click('查看歷史記錄');await until(()=>evaluate('Boolean(document.querySelector(".tracking-history-modal"))'),'read-only history');const text=await evaluate('document.querySelector(".tracking-history-modal").innerText');assert.ok(text.includes('2026-09-29')&&text.includes('完工')&&text.includes('結案'));await screen(audience+'-completion-history');await click('關閉紀錄');await click('批量完工／更正');await until(()=>evaluate('document.body.innerText.includes("已結案項目請先重開")'),'closed entry guard');assert.ok(!await evaluate('document.querySelector(".tracking-modal")'));assert.deepEqual(await qa.read(),before);
 });
}

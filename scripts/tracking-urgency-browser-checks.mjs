import assert from 'node:assert/strict';
// Real shore/ship UI + synthetic data and private native PostgreSQL, never hosted services.
export async function trackingUrgencyChecks({qa,call,evaluate,click,nodeClick,fill,until,screen,check,audience,finish}){
 const input=label=>`document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')})`;
 const set=async(label,value)=>{await evaluate(`(()=>{const n=${input(label)};Object.getOwnPropertyDescriptor(n.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
 const choose=async ids=>{await click('清除選取');for(const id of ids)await nodeClick(`document.querySelector(${JSON.stringify('[data-tracking-id="'+id+'"] .tracking-check input')})`);await until(()=>evaluate(`document.querySelector('.tracking-toolbar>b').innerText==='已選 ${ids.length} 項'`),'exact selected set');};
 const tab=async label=>{await nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);await until(()=>evaluate('Boolean(document.querySelector(".tracking-table"))'),'list tab ready');};
 const close=async()=>{await click('取消');if(await evaluate('Boolean(document.querySelector(".tracking-navigation"))'))await click('捨棄草稿並關閉');await until(()=>evaluate('!document.querySelector(".modal-backdrop")'),'closed without mutation');};
 const size=async width=>{await call('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:false});await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');};
 const readonlyFrame=async(name,width)=>{await size(width);await evaluate('document.querySelector(".tracking-modal").scrollTop=0');assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));assert.ok(await evaluate('(()=>{const n=document.querySelector(".tracking-modal");return n.scrollWidth<=n.clientWidth+1})()'));await screen(audience+'-'+name+'-'+width);};
 const mutationCount=()=>qa.metrics.filter(m=>m.rpc==='apply_ship_dynamics_record_patch_v1'||m.rpc==='ship_dynamics_tracking_public_v1'&&m.action==='submit').length;
 const refs=['URG-SAME','URG-SAME','URG-ENGINEERING','URG-EDIT'];
 const descriptions=['備件緊急必填測試','物料緊急必填測試','工程緊急必填測試','普通可留空說明'];
 const types=['spares','temporary-materials','repair','spares'];let created;
 await check(audience+'-create-urgent-three-domains-empty-and-whitespace-zero-write',async()=>{
  const before=await qa.read(),writes=mutationCount();await click('＋ 新增／批量新增');
  for(let i=0;i<4;i++){
   if(i)await click('＋ 新增一列');const p=`第 ${i+1} 筆 `;
   await fill(`[aria-label="${p}申請單號(材料或工程)"]`,refs[i]);await fill(`[aria-label="${p}內容摘要/工程內容"]`,descriptions[i]);await set(p+'類型',types[i]);await set(p+'申請/開單日期','2026-09-01');
   if(i<3){await nodeClick(input(p+'緊急'));await until(()=>evaluate(input(p+'補充說明')+'.required'),'urgent notes dynamically required');}
  }
  assert.equal(await evaluate(input('第 4 筆 補充說明')+'.required'),false);await click('確認保存 4 項');assert.ok(await evaluate('document.querySelector(".tracking-modal").querySelector(":invalid")!==null'));
  for(let i=1;i<=3;i++)await fill(`[aria-label="第 ${i} 筆 補充說明"]`,' 　\n ');
  await click('確認保存 4 項');await until(()=>evaluate('document.querySelector(".tracking-modal").innerText.includes("不能只填空白")'),'trimmed validation error');assert.deepEqual(await qa.read(),before);assert.equal(mutationCount(),writes);
  for(let i=1;i<=3;i++)await fill(`[aria-label="第 ${i} 筆 補充說明"]`,'第 '+i+' 項獨立緊急原因');
  await readonlyFrame('create-urgent-required',1440);await readonlyFrame('create-urgent-required',390);await size(1440);
  await click('確認保存 4 項');await finish();const after=await qa.read();assert.equal(after.revision,before.revision+1);created=descriptions.map(d=>after.payload.trackingItems.find(r=>r.description===d));
  for(let i=0;i<4;i++){assert.ok(created[i]);assert.equal(created[i].requestType,types[i]);assert.equal(created[i].urgency,i<3?'urgent':'normal');assert.equal(created[i].supplementalNotes,i<3?'第 '+(i+1)+' 項獨立緊急原因':'');}
 });
 await check(audience+'-batch-edit-normal-to-urgent-required-with-normal-toggle-control',async()=>{
  await tab('配件物料總清單');await choose([created[3].id]);await click('批量修正');await until(()=>evaluate('Boolean('+input('第 1 筆 補充說明')+')'),'full editor');const before=await qa.read(),writes=mutationCount();
  await nodeClick(input('第 1 筆 緊急'));await until(()=>evaluate(input('第 1 筆 補充說明')+'.required'),'edit urgent required');
  await click('確認保存 1 項');assert.equal(await evaluate(input('第 1 筆 補充說明')+'.validity.valueMissing'),true);
  await nodeClick(input('第 1 筆 普通'));await until(()=>evaluate('!'+input('第 1 筆 補充說明')+'.required'),'normal removes conditional requirement');
  await nodeClick(input('第 1 筆 緊急'));await fill('[aria-label="第 1 筆 補充說明"]','　 ');await click('確認保存 1 項');await until(()=>evaluate('document.querySelector(".tracking-modal").innerText.includes("不能只填空白")'),'batch edit trim validation');assert.deepEqual(await qa.read(),before);assert.equal(mutationCount(),writes);
  await fill('[aria-label="第 1 筆 補充說明"]','普通改緊急的獨立原因');await click('確認保存 1 項');await finish();const after=await qa.read();assert.equal(after.revision,before.revision+1);assert.equal(after.payload.trackingItems.find(r=>r.id===created[3].id).urgency,'urgent');
 });
 await check(audience+'-urgency-fixture-existing-linked-case-keeps-own-priority',async()=>{
  await choose([created[0].id]);await click('同步到內控');await until(()=>evaluate('Boolean(document.querySelector(".ic-batch-modal"))'),'sync original form');
  if(audience==='ship'){
   await fill('#ship-internal-reporter','QA／輪機長');
   // The existing public sync workflow requires a configured category; its legacy
   // prefill '其他' is not in this fixture's configured list. Review it as usual.
   assert.ok((await qa.read()).payload.settings.taskCategories.includes('維修'));
   await evaluate(`(()=>{const n=[...document.querySelectorAll('.ic-batch-modal .field')].find(n=>n.querySelector('label')?.innerText.trim()==='事件分類 *')?.querySelector('select');if(!n||![...n.options].some(o=>o.value==='維修'))throw new Error('sync category prerequisite');n.value='維修';n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
   await until(()=>evaluate(`[...document.querySelectorAll('.ic-batch-modal .field')].find(n=>n.querySelector('label')?.innerText.trim()==='事件分類 *')?.querySelector('select')?.value==='維修'`),'reviewed configured sync category');
  }
  await click(audience==='ship'?'提交 1 筆':'保存 1 筆案件');await finish();const source=(await qa.read()).payload.trackingItems.find(r=>r.id===created[0].id);assert.ok(source.linkedCaseId);
 });
 const open=async(ids)=>{await choose(ids);await click('修改急迫度');await until(()=>evaluate('Boolean(document.querySelector(".tracking-urgency-fields"))'),'urgency dialog');};
 const prove=(before,after,ids,urgency,note)=>{
  assert.equal(after.revision,before.revision+1);
  for(const row of before.payload.trackingItems){const saved=after.payload.trackingItems.find(r=>r.id===row.id);if(!ids.includes(row.id)){assert.deepEqual(saved,row);continue;}assert.equal(saved.urgency,urgency);assert.equal(saved.supplementalNotes,[row.supplementalNotes,`急迫度改為${urgency==='urgent'?'緊急':'普通'}：${note}`].filter(Boolean).join('\n'));const keep=r=>Object.fromEntries(Object.entries(r).filter(([key])=>!['urgency','supplementalNotes','updatedAt','updatedBy'].includes(key)));assert.deepEqual(keep(saved),keep(row),'every other source field unchanged');}
  assert.deepEqual(after.payload.internalControlCases,before.payload.internalControlCases,'linked priority/content/progress unchanged');assert.deepEqual(after.payload.tasks,before.payload.tasks,'linked tasks unchanged');
 };
 await check(audience+'-batch-urgency-required-both-directions-cancel-and-responsive-dialog',async()=>{
  const ids=created.slice(0,2).map(r=>r.id);await open(ids);const before=await qa.read(),writes=mutationCount();assert.equal(await evaluate('document.querySelectorAll(".tracking-urgency-target input:checked").length'),0);
  for(const target of ['改為普通','改為緊急']){await nodeClick(input(target));await fill('[aria-label="本次急迫度補充說明"]','　 ');await click('確認保存 2 項');await until(()=>evaluate('document.querySelector(".tracking-modal").innerText.includes("不能只填空白")'),'both directions require fresh explanation');}
  assert.deepEqual(await qa.read(),before);assert.equal(mutationCount(),writes);
  await fill('[aria-label="本次急迫度補充說明"]','供應時間已確認，依計畫安排');
  const text=await evaluate('document.querySelector(".tracking-modal").innerText');for(const r of created.slice(0,2)){assert.ok(text.includes(r.description));assert.ok(!text.includes(r.id));}if(audience==='ship')assert.ok(!text.includes('要事'));
  await readonlyFrame('modify-urgency',1440);await readonlyFrame('modify-urgency',390);await size(1440);await close();assert.deepEqual(await qa.read(),before);
 });
 await check(audience+'-batch-normal-held-native-ACK-frozen-input-and-own-note-append',async()=>{
  const ids=created.slice(0,2).map(r=>r.id);await open(ids);await nodeClick(input('改為普通'));const note='供應時間已確認，改為普通';await fill('[aria-label="本次急迫度補充說明"]',note);const before=await qa.read();let entered=false,release;const held=new Promise(r=>{release=r;});
  qa.setRecordFault({after:async({name,body})=>{if(name===(audience==='ship'?'ship_dynamics_tracking_public_v1':'apply_ship_dynamics_record_patch_v1')&&(audience==='shore'||body.p_action==='submit')){entered=true;await held;}return false;}});
  try{await click('確認保存 2 項');await until(()=>entered,'urgency native COMMIT ACK held');assert.ok(await evaluate('Boolean(document.querySelector(".tracking-modal"))'));assert.equal(await evaluate(input('本次急迫度補充說明')+'.matches(":disabled")'),true);const after=await qa.read();prove(before,after,ids,'normal',note);release();await finish();}finally{release();qa.setRecordFault(null);}
 });
 await check(audience+'-batch-urgent-lost-ACK-exact-retry-no-duplicate-append',async()=>{
  const ids=created.slice(0,2).map(r=>r.id);await open(ids);await nodeClick(input('改為緊急'));const note='港口窗口提前，需要緊急供應';await fill('[aria-label="本次急迫度補充說明"]',note);const before=await qa.read();let committed=false;
  const matches=(name,body)=>audience==='ship'?name==='ship_dynamics_tracking_public_v1'&&['submit','receipt'].includes(body.p_action):['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1'].includes(name);
  qa.setRecordFault({after:async({name,body,value})=>{if(!matches(name,body))return false;if(audience==='shore'||body.p_action==='submit'&&value.ok)committed=true;return committed;}});
  try{await click('確認保存 2 項');await until(()=>evaluate('document.body.innerText.includes("尚未保存；輸入及精確提交已保留")'),'unknown urgency result kept',90_000);assert.ok(committed);const after=await qa.read();prove(before,after,ids,'urgent',note);const saved=await evaluate('Object.values(localStorage).map(s=>{try{return JSON.parse(s)}catch{return null}}).find(s=>s?.draft?.action==="urgency"&&s?.pending?.command?.type==="edit")');assert.deepEqual(saved.pending.command.items.map(r=>r.id),ids);assert.equal(await evaluate(input('本次急迫度補充說明')+'.matches(":disabled")'),true);qa.setRecordFault(null);await click('確認結果／重試相同提交');await finish();assert.deepEqual(await qa.read(),after);}finally{qa.setRecordFault(null);}
 });
 await check(audience+'-engineering-batch-urgency-preserves-dates-and-closure',async()=>{
  await tab('未完成工程單');await open([created[2].id]);await nodeClick(input('改為普通'));const note='工程排程已確認';await fill('[aria-label="本次急迫度補充說明"]',note);const before=await qa.read();await click('確認保存 1 項');await finish();prove(before,await qa.read(),[created[2].id],'normal',note);
 });
 await check(audience+'-saved-urgency-and-notes-reopen-authoritative-fields',async()=>{
  await tab('配件物料總清單');await choose(created.slice(0,2).map(r=>r.id));await click('批量修正');await until(()=>evaluate('document.querySelectorAll(".tracking-form-row").length===2'),'authoritative selected editor');
  for(let i=1;i<=2;i++){assert.ok(await evaluate(input(`第 ${i} 筆 緊急`)+'.checked'));const value=await evaluate(input(`第 ${i} 筆 補充說明`)+'.value');assert.ok(value.includes('獨立緊急原因')&&value.includes('改為普通')&&value.includes('改為緊急'));}await close();
 });
}

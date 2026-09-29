import assert from 'node:assert/strict';
// Original shore/ship UI + native private PostgreSQL. No production services.
export async function trackingProgressCopyChecks({qa,evaluate,call,click,nodeClick,fill,until,screen,check,audience,finish,dialogs,setCopyConfirmation}){
 const label='複製第一項更新至全部';
 const descriptions=['同申請單的濾芯','同申請單的墊片','同申請單的螺帽'];
 const button=`[...document.querySelectorAll('.tracking-modal button')].find(n=>n.textContent.trim()===${JSON.stringify(label)})`;
 const fields=()=>evaluate("[...document.querySelectorAll('.tracking-progress-row textarea')].map(n=>({id:n.id.replace(/^tracking-progress-/,''),selector:'[id=\"'+n.id+'\"]',text:n.value}))");
 const open=async()=>{await click('清除選取');for(const description of descriptions)await nodeClick(`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.innerText.includes(${JSON.stringify(description)})).querySelector('input[type=checkbox]')`);await click('批量更新進度');await until(()=>evaluate('document.querySelectorAll(".tracking-progress-row").length===3'),'three selected progress rows');};
 const close=async()=>{await click('取消');if(await evaluate('Boolean(document.querySelector(".tracking-navigation"))'))await click('捨棄草稿並關閉');await until(()=>evaluate('!document.querySelector(".modal-backdrop")'),'closed progress dialog');};
 const collapsed=async()=>{assert.equal(await evaluate("document.querySelectorAll('.tracking-progress-history').length"),3);assert.equal(await evaluate("document.querySelectorAll('.tracking-progress-history[open]').length"),0);};
 const size=async(width,height)=>{await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await evaluate("document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))");await evaluate("document.querySelector('.tracking-modal').scrollTop=0");};
 await check(audience+'-progress-copy-original-UI-three-distinct-source-fixture',async()=>{
  await click('＋ 新增／批量新增');
  for(let i=0;i<3;i++){
   if(i)await click('＋ 新增一列');const p=`第 ${i+1} 筆 `;
   await fill(`[aria-label="${p}申請單號(材料或工程)"]`,'COPY-SAME');await fill(`[aria-label="${p}內容摘要/工程內容"]`,descriptions[i]);await fill(`[aria-label="${p}最新進度"]`,'各項原進度 '+i);
  }
  await click('確認保存 3 項');await finish();
 });
 let draftRows,before;
 const shared='高雄港統一交船／安排施工\n請逐项核對實際完成情況';
 await check(audience+'-progress-history-default-collapse-manual-expansion-and-reopen',async()=>{
  before=await qa.read();await open();await collapsed();
  await nodeClick("document.querySelector('.tracking-progress-history summary')");await until(()=>evaluate("document.querySelector('.tracking-progress-history').open"),'manual history opened');
  assert.ok(await evaluate("document.querySelector('.tracking-progress-history').innerText.includes('各項原進度')"));
  await close();await open();await collapsed();assert.deepEqual(await qa.read(),before);
 });
 await check(audience+'-progress-copy-no-autosave-empty-guard-and-independent-edit',async()=>{
  draftRows=await fields();await fill(draftRows[0].selector,'');assert.equal(await evaluate(button+'.disabled'),true);
  await fill(draftRows[0].selector,shared);assert.equal(await evaluate(button+'.disabled'),false);
  const dialogsBefore=dialogs.length;await click(label);await until(async()=>(await fields()).every(row=>row.text===shared),'copied to all exact rows');
  assert.equal(dialogs.length,dialogsBefore,'normal one-click copy needs no confirmation');await collapsed();assert.deepEqual(await qa.read(),before,'copy is local draft only');
  await fill(draftRows[2].selector,'第三項獨立安排，不能意外覆蓋');setCopyConfirmation(false);await click(label);
  await until(()=>dialogs.length===dialogsBefore+1,'overwrite prompt cancelled');assert.equal((await fields())[2].text,'第三項獨立安排，不能意外覆蓋');
  setCopyConfirmation(true);await click(label);await until(async()=>(await fields()).every(row=>row.text===shared),'overwrite confirmed');assert.equal(dialogs.length,dialogsBefore+2);
  await fill(draftRows[2].selector,'第三項另於次日施工');await collapsed();assert.deepEqual(await qa.read(),before);
  for(const [width,height] of [[1440,1000],[390,844]]){
   await size(width,height);
   const g=await evaluate(`(()=>{const m=document.querySelector('.tracking-modal'),b=${button},v=document.querySelector('[aria-label=本次固定船舶]'),r=b.getBoundingClientRect(),s=v.getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,modalOverflow:m.scrollWidth>m.clientWidth+1,button:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},vessel:{right:s.right,top:s.top,bottom:s.bottom}}})()`);
   assert.ok(g.scroll<=g.width+1&&!g.modalOverflow&&g.button.left>=0&&g.button.right<=g.width+1,'copy control stays inside viewport/dialog');
   if(width===1440)assert.ok(g.button.left>=g.vessel.right&&g.button.top<g.vessel.bottom&&g.button.bottom>g.vessel.top,'button immediately after vessel field');
   await screen(audience+'-progress-copy-'+width);
  }
  await size(1440,1000);
 });
 await check(audience+'-progress-copy-explicit-save-held-ACK-and-own-history-retained',async()=>{
  let entered=false,release;const held=new Promise(r=>{release=r;});
  qa.setRecordFault({after:async({name,body})=>{if(name===(audience==='ship'?'ship_dynamics_tracking_public_v1':'apply_ship_dynamics_record_patch_v1')&&(audience==='shore'||body.p_action==='submit')){entered=true;await held;}return false;}});
  try{
   await click('確認保存 3 項');await until(()=>entered,'native COMMIT held before ACK');
   assert.ok(await evaluate('Boolean(document.querySelector(".tracking-modal"))'));assert.equal(await evaluate(button+'.disabled'),true,'no copying into pending/busy submission');
   const after=await qa.read();assert.equal(after.revision,before.revision+1);
   for(const [index,ui] of draftRows.entries()){
    const original=before.payload.trackingItems.find(row=>row.id===ui.id),saved=after.payload.trackingItems.find(row=>row.id===ui.id);
    assert.equal(saved.progress,index===2?'第三項另於次日施工':shared);assert.equal(saved.statusLogs.length,original.statusLogs.length+1);
    assert.deepEqual(saved.statusLogs.slice(1),original.statusLogs,'no history copied between items');assert.equal(saved.statusLogs[0].text,saved.progress);
    for(const key of ['id','vesselId','referenceNo','description','applicationDate','requestType','urgency','deliveryStatus','isClosed'])assert.equal(saved[key],original[key],key+' unchanged');
   }
   const selected=new Set(draftRows.map(row=>row.id));assert.deepEqual(after.payload.trackingItems.filter(row=>!selected.has(row.id)),before.payload.trackingItems.filter(row=>!selected.has(row.id)),'unselected unchanged');
   assert.deepEqual(after.payload.internalControlCases,before.payload.internalControlCases);assert.deepEqual(after.payload.tasks,before.payload.tasks);
   release();await finish();
  }finally{release();qa.setRecordFault(null);}
  await open();await collapsed();const reread=await fields();assert.deepEqual(reread.map(row=>[row.id,row.text]),draftRows.map((row,i)=>[row.id,i===2?'第三項另於次日施工':shared]));
  await nodeClick("document.querySelector('.tracking-progress-history summary')");await until(()=>evaluate("document.querySelector('.tracking-progress-history').open"),'saved history manual expansion');
  assert.ok(await evaluate("document.querySelector('.tracking-progress-history').innerText.includes('各項原進度')"));
  await close();
 });
}

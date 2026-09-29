import assert from 'node:assert/strict';

// Original public UI + independent real repository client + private native SQL.
// The peer is not a second browser. No hosted service or business data is used.
export async function shipTrackingLockMessageChecks({qa,native,call,evaluate,click,nodeClick,fill,until,screen,check,finish}){
 const expected='所選項目或其關聯資料正由其他人／另一個視窗編輯。請待對方保存或關閉編輯後再試；原輸入已保留。';
 const {ShipTrackingRepository}=await qa.loadModule('/src/tracking/shipTracking.ts');
 const config=JSON.parse((await(await fetch(qa.origin+'/supabase-config.js')).text()).match(/=(\{.*\});/)[1]);
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const peer=new ShipTrackingRepository(config,{storage,isCurrent:()=>true});
 const source=()=>qa.read().then(r=>r.payload.trackingItems.find(r=>r.referenceNo==='BROWSER-001'));
 const item=await source();assert.ok(item);
 const choose=async()=>{await click('清除選取');await nodeClick(`document.querySelector(${JSON.stringify('[data-tracking-id="'+item.id+'"] .tracking-check input')})`);await until(()=>evaluate("document.querySelector('.tracking-toolbar>b').innerText==='已選 1 項'"),'exact selected item');};
 const mutations=()=>qa.metrics.filter(m=>m.rpc==='ship_dynamics_tracking_public_v1'&&m.action==='submit').length;
 await check('real-peer-lock-explicit-message-zero-write-responsive-and-release-success',async()=>{
  const before=await qa.read(),count=mutations();await peer.claim('qa-v1',[item.id]);
  try{
   await choose();await click('修改急迫度');await until(()=>evaluate(`document.querySelector('.ship-notice')?.innerText===${JSON.stringify(expected)}`),'explicit other-editor warning');
   assert.equal(await evaluate("Boolean(document.querySelector('.modal-backdrop'))"),false);
   assert.equal(await evaluate("document.querySelector('.tracking-toolbar>b').innerText"),'已選 1 項');
   assert.equal(mutations(),count);assert.deepEqual(await qa.read(),before);assert.equal(peer.isWritable([item.id]),true);
   for(const width of [1440,390]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:false});
    await evaluate('window.scrollTo(0,0);document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(r)))');
    const box=await evaluate("(()=>{const n=document.querySelector('.ship-notice'),r=n.getBoundingClientRect();return {left:r.left,right:r.right,scroll:n.scrollWidth,client:n.clientWidth,document:document.documentElement.scrollWidth,viewport:innerWidth};})()");
    assert.ok(box.left>=0&&box.right<=box.viewport+1&&box.scroll<=box.client+1&&box.document<=box.viewport+1);await screen('ship-other-editor-'+width);
   }
  }finally{assert.equal(await peer.release(),true);}
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await click('修改急迫度');await until(()=>evaluate("Boolean(document.querySelector('.tracking-urgency-fields'))"),'same original action after peer release');
  await nodeClick("document.querySelector('[aria-label=\"改為普通\"]')");await fill('[aria-label="本次急迫度補充說明"]','對方完成後可正常保存');await click('確認保存 1 項');await finish();
  const saved=await source();assert.ok(saved.supplementalNotes.includes('對方完成後可正常保存'));assert.equal(saved.urgency,'normal');assert.equal(mutations(),count+1);
 });
 await check('real-heartbeat-expiry-keeps-expiry-message-same-draft-and-explicit-recovery',async()=>{
  await choose();await click('批量更新進度');await until(()=>evaluate("Boolean(document.querySelector('.tracking-progress-row textarea'))"),'progress editor');
  await fill('.tracking-progress-row textarea','失效後保留原輸入');await evaluate("void(window.__lockMessageDraft=document.querySelector('.tracking-progress-row textarea'))");const before=await qa.read(),count=mutations();
  await native.observer.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key=$2",[qa.workspace,'tracking:'+item.id]);
  await until(()=>evaluate("document.querySelector('.tracking-progress-row textarea')?.matches(':disabled')"),'real renewal expiration',22000);
  assert.equal(await evaluate("document.querySelector('.ship-notice')?.innerText"),'編輯權未取得或已失效；原輸入保留，請核對最新資料後重新取得編輯權。');
  assert.equal(await evaluate("document.querySelector('.tracking-progress-row textarea')===window.__lockMessageDraft&&window.__lockMessageDraft.value==='失效後保留原輸入'"),true);
  assert.equal(mutations(),count);assert.deepEqual(await qa.read(),before);await screen('ship-real-expiry-preserved-draft');
  await click('重新取得編輯權／核對最新資料');await until(()=>evaluate("document.querySelector('.tracking-modal').innerText.includes('已核對最新版本；原輸入保留')"),'explicit reacquisition');
  assert.equal(await evaluate("document.querySelector('.tracking-progress-row textarea').value"),'失效後保留原輸入');await click('確認保存 1 項');await finish();assert.equal((await source()).progress,'失效後保留原輸入');
 });
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Shared original UI + real local PostgreSQL. All records below are test fixtures.
export async function trackingReclassifyChecks({qa,evaluate,call,click,nodeClick,fill,until,screen,check,output,audience,finish}) {
  const refs=['RECLASS-DATED','RECLASS-PARTIAL','RECLASS-ENGINE'];
  const find=async ref=>(await qa.read()).payload.trackingItems.find(row=>row.referenceNo===ref);
  const field=label=>`document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')})`;
  const value=label=>evaluate(`(${field(label)}).value`);
  const set=async(label,value)=>{
    await until(()=>evaluate(`Boolean(${field(label)})`),'field '+label);
    await evaluate(`(()=>{const n=${field(label)};if(n.disabled||n.closest('fieldset:disabled'))throw new Error('field frozen');const prototype=n.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    assert.equal(await evaluate(`(${field(label)}).value`),value);
  };
  const tab=async label=>{await nodeClick(`[...document.querySelectorAll('.tracking-tabs button')].find(n=>n.innerText.startsWith(${JSON.stringify(label)}))`);await until(()=>evaluate("Boolean(document.querySelector('.tracking-table'))"),'list '+label);};
  const choose=async references=>{await click('清除選取');for(const ref of references)await nodeClick(`[...document.querySelectorAll('.tracking-table tbody tr')].find(n=>n.querySelector('.tracking-reference')?.innerText.includes(${JSON.stringify(ref)})).querySelector('input[type=checkbox]')`);};
  const open=async references=>{await choose(references);await click('修正分類');await until(()=>evaluate(`Boolean(${field('本批目標類型')})`),'reclassification draft after claim');};
  const save=async count=>{await until(()=>evaluate(`[...document.querySelectorAll('.tracking-modal button')].some(n=>n.innerText===${JSON.stringify(`確認保存 ${count} 項`)}&&!n.disabled)`),'save ready after claim');await click(`確認保存 ${count} 項`);await finish();};
  const reviewed=()=>nodeClick(field('已逐筆核對日期及送船狀態'));
  const frozen=()=>evaluate("Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('[\"tracking-unsent-v1\"')))" );

  await check(audience+'-reclassify-real-fixtures-and-ordinary-edit-boundary',async()=>{
    assert.equal(await evaluate("[...document.querySelectorAll('.tracking-toolbar button')].find(n=>n.innerText==='修正分類')?.disabled"),true,'no empty selection');
    await click('＋ 新增／批量新增');
    for(let index=0;index<refs.length;index++) {
      if(index)await click('＋ 新增一列');
      const prefix=`第 ${index+1} 筆 `;
      await fill(`[aria-label="${prefix}申請單號(材料或工程)"]`,refs[index]);
      await fill(`[aria-label="${prefix}內容摘要/工程內容"]`,'人工內容保留 '+refs[index]);
      await fill(`[aria-label="${prefix}補充說明"]`,'獨立說明不可刪除');
      await set(prefix+'申請/開單日期','2026-09-01');
      await set(prefix+'類型',index===2?'repair':'spares');
      if(index!==1)await set(prefix+'實際送達/完工日期',index===2?'2026-09-12':'2026-09-04');
    }
    await save(3);await tab('配件物料總清單');await choose([refs[1]]);await click('批量送達／更正');await set('送船狀態','partially-delivered');await save(1);
    await choose([refs[0]]);await click('批量更新');await until(()=>evaluate(`Boolean(${field('第 1 筆 類型')})`),'ordinary edit');
    assert.deepEqual(await evaluate(`[...(${field('第 1 筆 類型')}).options].filter(n=>['repair','drydock','annual-inspection'].includes(n.value)).map(n=>n.disabled)`),[true,true,true]);
    await click('取消');await until(()=>evaluate("!document.querySelector('.modal-backdrop')"),'clean edit closed');
  });

  await check(audience+'-reclassify-batch-target-review-layout-and-atomic-ACK',async()=>{
    const before=await qa.read();await open(refs.slice(0,2));await set('本批目標類型','annual-inspection');
    assert.equal(await value('第 1 筆 目標完工日期'),'','supply delivery date must not transfer into engineering');
    assert.equal(await value('第 2 筆 目標完工日期'),'');
    assert.equal(await evaluate("document.querySelectorAll('[aria-label=已逐筆核對日期及送船狀態]').length"),1,'one review checkbox for whole selection');
    await click('確認保存 2 項');assert.deepEqual(await qa.read(),before,'missing review cannot dispatch');
    for(const index of [1,2])await set(`第 ${index} 筆 目標完工日期`,'2026-09-10');
    assert.equal(await evaluate(`(${field('已逐筆核對日期及送船狀態')}).checked`),false);
    await evaluate(`(${field('第 1 筆 目標完工日期')}).focus()`);
    const desktop=await evaluate("[...document.querySelector('.tracking-reclassify-grid').children].map(n=>{const r=n.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right};})");
    assert.ok(Math.max(...desktop.map(n=>n.top))-Math.min(...desktop.map(n=>n.top))<3,'compact desktop comparison shares a row');
    await screen(audience+'-reclassify-desktop');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await evaluate("document.querySelector('.tracking-reclassify-fields').scrollIntoView({block:'start'})");
    const mobile=await evaluate("({viewport:innerWidth,document:document.documentElement.scrollWidth,fields:[...document.querySelectorAll('.tracking-reclassify-grid > *')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})})");
    assert.ok(mobile.document<=mobile.viewport+1);assert.ok(mobile.fields.every(n=>n.width>0&&n.left>=0&&n.right<=mobile.viewport+1));
    await screen(audience+'-reclassify-mobile');fs.writeFileSync(path.join(output,'reclassify-geometry.json'),JSON.stringify({desktop,mobile},null,2));
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    if(audience==='ship')assert.ok(!await evaluate("document.querySelector('.tracking-page').innerText.includes('要事')"));
    await reviewed();
    let release,entered=false;const barrier=new Promise(resolve=>{release=resolve;});
    qa.setRecordFault({after:async({name,body})=>{if(name===(audience==='ship'?'ship_dynamics_tracking_public_v1':'apply_ship_dynamics_record_patch_v1')&&(audience!=='ship'||body.p_action==='submit')){entered=true;await barrier;}return false;}});
    try {
      await click('確認保存 2 項');await until(()=>entered,'actual SQL committed before held ACK');
      assert.ok(await evaluate("Boolean(document.querySelector('.tracking-reclassify-fields'))"));
      const pending=Object.values(await frozen()).map(raw=>JSON.parse(raw)).find(x=>x.pending);assert.equal(pending.pending.command.type,'reclassify');assert.equal(pending.pending.command.items.length,2);
      const committed=await qa.read();assert.equal(committed.revision,before.revision+1);
      for(const ref of refs.slice(0,2)){const source=committed.payload.trackingItems.find(row=>row.referenceNo===ref);assert.equal(source.kind,'engineering');assert.equal(source.requestType,'annual-inspection');assert.equal(source.completionDate,'2026-09-10');assert.equal(source.description,'人工內容保留 '+ref);assert.equal(source.supplementalNotes,'獨立說明不可刪除');assert.equal(source.events.filter(e=>e.action==='reclassify').length,1);}
      assert.equal((await find(refs[0])).actualDeliveryDate,'2026-09-04');assert.equal((await find(refs[1])).deliveryStatus,'partially-delivered');
      assert.deepEqual(committed.payload.trackingItems.filter(row=>!refs.slice(0,2).includes(row.referenceNo)),before.payload.trackingItems.filter(row=>!refs.slice(0,2).includes(row.referenceNo)),'unselected records untouched');
      release();await finish();
    } finally {release();qa.setRecordFault(null);}
  });

  await check(audience+'-reclassify-target-stored-facts-and-explicit-supply-date',async()=>{
    await tab('已完成工程單');await open(refs);await set('本批目標類型','drydock-materials');
    assert.equal(await value('第 1 筆 目標實際送達日期'),'2026-09-04');assert.equal(await value('第 1 筆 目標送船狀態'),'delivered');
    assert.equal(await value('第 2 筆 目標實際送達日期'),'');assert.equal(await value('第 2 筆 目標送船狀態'),'partially-delivered');
    assert.equal(await value('第 3 筆 目標實際送達日期'),'','completion date is not a delivery fact');
    await set('第 3 筆 目標送船狀態','delivered');await reviewed();const before=await qa.read();await click('確認保存 3 項');assert.deepEqual(await qa.read(),before,'delivered requires an explicit date');
    await set('第 3 筆 目標實際送達日期','2026-09-14');assert.equal(await evaluate(`(${field('已逐筆核對日期及送船狀態')}).checked`),false,'new date requires a new review');await reviewed();await save(3);
    const saved=await qa.read();assert.equal(saved.revision,before.revision+1);for(const ref of refs){const source=await find(ref);assert.equal(source.kind,'supply');assert.equal(source.requestType,'drydock-materials');assert.equal(source.completionDate,ref===refs[2]?'2026-09-12':'2026-09-10');}
    await tab('配件物料總清單');await choose([refs[0]]);await click('查看所選紀錄');await until(()=>evaluate("Boolean(document.querySelector('.tracking-history-modal'))"),'classification audit viewer');assert.ok(await evaluate("document.querySelector('.tracking-history-modal').innerText.includes('修正分類')"));await screen(audience+'-reclassify-history');await click('關閉紀錄');
  });

  await check(audience+'-reclassify-closed-reopen-and-same-kind-no-extra-review',async()=>{
    await choose([refs[1]]);await click('批量結案');await set('結案日期','2026-09-16');await save(1);
    const closed=await qa.read();await choose([refs[1]]);await click('修正分類');await until(()=>evaluate("document.body.innerText.includes('已結案項目請先重開')"),'closed row rejected before draft');assert.equal(await evaluate("Boolean(document.querySelector('.tracking-modal'))"),false);assert.deepEqual(await qa.read(),closed);
    await click('重開所選');await save(1);await open([refs[1]]);await set('本批目標類型','drydock-spares');assert.equal(await evaluate("document.querySelectorAll('[aria-label=已逐筆核對日期及送船狀態]').length"),0);await save(1);assert.equal((await find(refs[1])).deliveryStatus,'partially-delivered');
  });

  await check(audience+'-reclassify-durable-lost-ACK-exact-retry-no-duplicate-event',async()=>{
    await open([refs[1]]);await set('本批目標類型','repair');assert.equal(await value('第 1 筆 目標完工日期'),'2026-09-10');await reviewed();
    const before=await qa.read(),requests=[];let committed=false;
    const matches=(name,body)=>audience==='ship'?name==='ship_dynamics_tracking_public_v1'&&['submit','receipt'].includes(body.p_action):['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1'].includes(name);
    qa.setRecordFault({before:async({name,body})=>{if(matches(name,body))requests.push(structuredClone(body));},after:async({name,body,value})=>{if(!matches(name,body))return false;if(audience!=='ship'||body.p_action==='submit'&&value.ok)committed=true;return committed;}});
    try {
      await click('確認保存 1 項');await until(()=>evaluate("document.body.innerText.includes('尚未保存；輸入及精確提交已保留')"),'unknown classification outcome retained',90_000);
      assert.ok(committed);const saved=await qa.read();assert.equal(saved.revision,before.revision+1);const retained=await frozen();assert.ok(Object.values(retained).some(raw=>JSON.parse(raw).pending?.command.type==='reclassify'));await screen(audience+'-reclassify-lost-ack');
      if(audience==='shore') {
        await set('本批目標類型','spares');await set('第 1 筆 目標送船狀態','delivered');
        assert.equal(await value('第 1 筆 目標實際送達日期'),'');
        assert.equal(await evaluate("document.querySelector('.tracking-modal').checkValidity()"),false,'newer draft is intentionally incomplete');
        const edited=await frozen();for(const key of Object.keys(retained))assert.deepEqual(JSON.parse(edited[key]).pending,JSON.parse(retained[key]).pending,'visible changes cannot alter durable pending command');
      }
      qa.setRecordFault({before:async({name,body})=>{if(matches(name,body))requests.push(structuredClone(body));}});
      await click('確認結果／重試相同提交');
      if(audience==='shore') {
        await until(()=>evaluate("document.body.innerText.includes('等待期間的新輸入仍保留')"),'ACK retains newer input that existed before retry');
        assert.equal(await value('本批目標類型'),'spares');assert.equal(await value('第 1 筆 目標送船狀態'),'delivered');assert.equal(await value('第 1 筆 目標實際送達日期'),'');
        assert.equal(await evaluate(`(${field('已逐筆核對日期及送船狀態')}).checked`),false,'accepted new originals require a fresh review');
        const remaining=Object.values(await frozen()).map(raw=>JSON.parse(raw));assert.ok(remaining.some(x=>x.draft.dirty&&!x.pending));
        await screen('shore-reclassify-newer-draft-after-ack');await click('取消');await click('捨棄草稿並關閉');await until(()=>evaluate("!document.querySelector('.modal-backdrop')"),'explicit discard of unsent successor');
      } else await finish();
      assert.deepEqual(await qa.read(),saved);
      if(audience==='ship'){assert.equal(new Set(requests.map(r=>r.p_payload.operationId)).size,1);for(const request of requests)assert.deepEqual(request.p_payload,requests[0].p_payload);}
      else {assert.equal(new Set(requests.map(r=>r.p_operation_id)).size,1);for(const request of requests)assert.deepEqual(request,requests[0]);}
      assert.equal((await find(refs[1])).events.filter(e=>e.action==='reclassify').length,4);
    } finally {qa.setRecordFault(null);}
    await tab('已完成工程單');await until(()=>evaluate("document.querySelector('.tracking-table').innerText.includes('RECLASS-PARTIAL')"),'saved classification reflected in destination list');
  });
}

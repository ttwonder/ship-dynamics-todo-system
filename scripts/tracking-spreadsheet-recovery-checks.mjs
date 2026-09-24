import assert from 'node:assert/strict';
import path from 'node:path';
import ExcelJS from 'exceljs';

export async function importRecoveryChecks(c) {
  const {qa,call,evaluate,click,nodeClick,fill,until,text,screen,check,input,output}=c;
  const wb=new ExcelJS.Workbook(), sheet=wb.addWorksheet('F34 工程委託單');
  sheet.addRow(['','工委單編號','工程內容','開單日期','回簽日期','安排廠家','施工港口','完工日期','備註']);
  sheet.addRow(['1','RECOVERY-ONLY','相同內容需明確判斷','20260901','','','','','保留原備註']);
  sheet.addRow(['2','RECOVERY-ONLY','相同內容需明確判斷','20261301','','','','','無效日期不能默默跳過']);
  const file=path.join(output,'neutral-import-recovery.xlsx');await wb.xlsx.writeFile(file);
  const before=await qa.read();
  await check('import-invalid-date-and-suspected-duplicate-zero-write',async()=>{
    await click('導入 Excel');await input(file);
    await until(async()=>(await text()).includes('主表候選 2 項')&&await evaluate("Boolean(document.querySelector('[aria-label=確認本次選船]:not(:disabled)'))"),'recovery preview');
    await nodeClick("document.querySelector('[aria-label=確認本次選船]')");await click('選取全部候選');
    assert.ok((await text()).includes('本檔疑似重複'));assert.ok((await text()).includes('無法唯一判定'));
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='確認保存所選 2 項').disabled"),true);
    assert.deepEqual(await qa.read(),before);await screen('import-invalid-and-duplicate');
    await click('清除本批選取');await nodeClick("document.querySelector('[aria-label=選取來源第2列]')");
    await nodeClick("document.querySelector('[aria-label=\"匯入第 2 列 確認疑似重複仍新增\"]')");
  });
  let committed, savedId;
  await check('import-held-and-lost-ACK-exact-retry-no-duplicate',async()=>{
    let held=false,release;const barrier=new Promise(resolve=>{release=resolve;});const requests=[];
    const collect=async({name,body})=>{if(['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1'].includes(name))requests.push({name,body:structuredClone(body)});};
    qa.setRecordFault({before:collect,after:async({name})=>{
      if(name==='apply_ship_dynamics_record_patch_v1'){held=true;await barrier;return true;}
      return name==='get_ship_dynamics_record_receipt_v1';
    }});
    try {
      await click('確認保存所選 1 項');await until(()=>held,'import SQL committed while response held',45000);
      committed=await qa.read();assert.equal(committed.revision,before.revision+1);
      const created=committed.payload.trackingItems.filter(r=>r.referenceNo==='RECOVERY-ONLY');assert.equal(created.length,1);savedId=created[0].id;
      const pending=await evaluate("Object.entries(localStorage).filter(([k])=>k.includes('tracking-import-v1')).map(([,v])=>JSON.parse(v)).find(s=>s.pending)?.pending");
      assert.ok(pending);assert.equal(pending.command.items.length,1);assert.equal(pending.command.items[0].id,savedId);
      assert.equal(await evaluate("document.querySelector('.tracking-import .modal-actions .primary').disabled"),true);
      assert.equal(await evaluate("document.querySelector('[aria-label=選取來源第2列]').disabled||document.querySelector('[aria-label=選取來源第2列]').closest('fieldset').disabled"),true);
      // A second native Enter while the first response is held cannot dispatch another operation.
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      assert.deepEqual(await qa.read(),committed);release();
      await until(async()=>(await text()).includes('確認結果／重試相同匯入'),'lost import ACK retains exact submission',90000);
      await click('核對並解除已拒絕匯入');
      assert.ok((await text()).includes('確認結果／重試相同匯入'));
      const retained=await evaluate("Object.entries(localStorage).filter(([k])=>k.includes('tracking-import-v1')).map(([,v])=>JSON.parse(v)).find(s=>s.pending)?.pending");
      assert.deepEqual(retained,pending,'unknown submission cannot be discarded or replaced');
      await screen('import-unknown-ACK-retained');qa.setRecordFault({before:collect});
      await click('確認結果／重試相同匯入');await until(async()=>(await text()).includes('本批 1 項已確認並權威讀回'),'original import receipt recovered',45000);
      assert.deepEqual(await qa.read(),committed);assert.ok(requests.length>=2);
      assert.equal(await evaluate("[...document.querySelectorAll('.save-toast')].some(n=>n.innerText.includes('保存結果尚未確認'))"),false,'confirmed exact receipt must clear its obsolete unknown-ACK warning');
      assert.equal(new Set(requests.map(r=>r.body.p_operation_id)).size,1);
      for(const request of requests)assert.deepEqual(request.body,requests[0].body,'record payload/signature input and original operation are exact');
      await click('關閉導入');
    } finally {release?.();qa.setRecordFault(null);}
  });
  await check('import-source-fingerprint-reimport-blocks-exact-row',async()=>{
    await click('導入 Excel');await input(file);
    await until(async()=>(await text()).includes('相同來源指紋已匯入')&&(await text()).includes('解析完成；')&&await evaluate("Boolean(document.querySelector('[aria-label=確認本次選船]:not(:disabled)'))"),'same source blocked after new file parsed');
    assert.equal(await evaluate("document.querySelector('[aria-label=選取來源第2列]').disabled"),true);
    assert.deepEqual(await qa.read(),committed);await click('取消導入');
  });
  await check('import-confirmed-record-survives-real-document-reload',async()=>{
    await until(()=>evaluate("!document.querySelector('.modal-backdrop')&&Boolean(document.querySelector('.save-status-strip.saved'))"),'closed import has settled before reload');
    await evaluate("void(window.__qaOriginalImportDocument=true)");
    await call('Page.reload');await until(async()=>await evaluate("window.__qaOriginalImportDocument!==true")&&((await text()).includes('人員登入／切換')||(await text()).includes('QA OWNER')),'fresh App document',45000);
    if((await text()).includes('人員登入／切換')){await fill('input[type="password"]',qa.password);await click('登入');}
    await until(async()=>(await text()).includes('QA OWNER')&&!(await text()).includes('人員登入／切換'),'original Owner login');
    await click('配件/物料/工程跟蹤');await until(()=>evaluate("Boolean(document.querySelector('.tracking-page'))"),'fresh tracking page');
    await nodeClick("[...document.querySelectorAll('.tracking-tabs button')].find(b=>b.innerText.startsWith('未完成工程單'))");
    await until(()=>evaluate(`Boolean(document.querySelector('[data-tracking-id="${savedId}"]'))`),'authoritatively reloaded import');
    assert.deepEqual(await qa.read(),committed);await screen('import-fresh-document-readback');
  });
  await check('import-explicit-cancelled-closure-one-native-transaction',async()=>{
    const book=new ExcelJS.Workbook(),s=book.addWorksheet('F34 工程委託單');
    s.addRow(['','工委單編號','工程內容','開單日期','回簽日期','安排廠家','施工港口','完工日期','備註']);
    s.addRow(['1','EXPLICIT-CLOSE','自主核對的工程分項','20260901','','','','20260902','原備註保留']);
    const target=path.join(output,'neutral-explicit-closure.xlsx');await book.xlsx.writeFile(target);
    await click('導入 Excel');await input(target);
    await until(async()=>(await text()).includes('來源：neutral-explicit-closure.xlsx')&&(await text()).includes('解析完成；'),'closure file parsed');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"匯入第 2 列 明確結案\"]').checked"),false,'completion date alone must not infer closure');
    await nodeClick("document.querySelector('[aria-label=確認本次選船]')");await nodeClick("document.querySelector('[aria-label=選取來源第2列]')");
    await nodeClick("document.querySelector('.tracking-import-rows details summary')");
    await nodeClick("document.querySelector('[aria-label=\"匯入第 2 列 明確結案\"]')");
    await click('明確採用已核對完工日期作結案日期');
    if(!await evaluate("document.querySelector('.tracking-import-rows details').open"))await nodeClick("document.querySelector('.tracking-import-rows details summary')");
    await c.select("document.querySelector('[aria-label=\"匯入第 2 列 結案結果\"]')",'cancelled');
    const beforeClose=await qa.read();await click('確認保存所選 1 項');
    await until(async()=>(await text()).includes('本批 1 項已確認並權威讀回'),'explicit closure ACK',45000);
    const after=await qa.read(),row=after.payload.trackingItems.find(r=>r.referenceNo==='EXPLICIT-CLOSE');
    assert.equal(after.revision,beforeClose.revision+1);assert.equal(row.isClosed,true);assert.equal(row.closureOutcome,'cancelled');
    assert.equal(row.closedDate,'2026-09-02');assert.equal(row.completionDate,'2026-09-02');assert.equal(row.originalRemarks,'原備註保留');
    assert.equal(after.payload.internalControlCases.length,beforeClose.payload.internalControlCases.length);
    await click('關閉導入');await nodeClick("[...document.querySelectorAll('.tracking-tabs button')].find(b=>b.innerText.startsWith('已完成工程單'))");
    await until(()=>evaluate(`Boolean(document.querySelector('[data-tracking-id="${row.id}"]'))`),'closed import bucket');
    assert.ok((await text()).includes('取消（非完工）'));await screen('import-explicit-cancelled-closure');
  });
}

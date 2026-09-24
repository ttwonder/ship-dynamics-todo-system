import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
export async function spreadsheetChecks(c){
 const {qa,call,evaluate,click,nodeClick,fill,until,text,screen,check,select,output}=c;
 const input=async(file)=>{const doc=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});await call('DOM.setFileInputFiles',{nodeId,files:[file]});};
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('F34 工程委託單');s.addRow(['','工委單編號','工程內容','開單日期','回簽日期','安排廠家','施工港口','完工日期','備註']);s.addRow(['0001','000001234567890123456789','中性工程\n第二行','20260901','','測試廠家','測試港口','','原備註不搬到進度']);
 const file=path.join(output,'neutral-import.xlsx');await book.xlsx.writeFile(file);
 const before=await qa.read();
 await check('file-input-preview-cancel-zero-write',async()=>{await input(file);await until(async()=>(await text()).includes('主表候選 1 項'),'preview source denominator');assert.ok((await text()).includes('欄位映射'));assert.ok((await text()).includes('普通（預設）'));await screen('import-preview');await click('取消導入');assert.deepEqual(await qa.read(),before);});
 await check('file-input-selected-native-atomic-save-and-readback',async()=>{await click('導入 Excel');await input(file);await until(()=>evaluate("Boolean(document.querySelector('[aria-label=確認本次選船]:not(:disabled)'))"),'second preview ready');await nodeClick("document.querySelector('[aria-label=確認本次選船]')");await nodeClick("document.querySelector('[aria-label=選取來源第2列]')");await click('確認保存所選 1 項');await until(async()=>(await text()).includes('本批 1 項已確認並權威讀回'),'native ACK',40000);const saved=await qa.read();assert.equal(saved.revision,before.revision+1);assert.equal(saved.payload.trackingItems.length,1);const row=saved.payload.trackingItems[0];assert.equal(row.referenceNo,'000001234567890123456789');assert.equal(row.description,'中性工程\n第二行');assert.equal(row.originalRemarks,'原備註不搬到進度');assert.equal(row.progress,'');assert.equal(row.source.row,2);assert.equal(row.isClosed,false);assert.equal(saved.payload.internalControlCases.length,before.payload.internalControlCases.length);await screen('import-native-ACK');await click('關閉導入');});
 await check('mounted-export-entry',async()=>{assert.ok(await evaluate("[...document.querySelectorAll('.tracking-page button')].some(b=>b.innerText==='Excel')"),'five-tab genuine export entry required');await click('Excel');await until(()=>evaluate("Boolean(document.querySelector('[aria-label=跟蹤匯出]'))"),'export scope dialog');});
 await click('關閉匯出');
 await check('over-100-explicit-separate-native-atomic-batches',async()=>{
  const wb=new ExcelJS.Workbook(),sh=wb.addWorksheet('F34 工程委託單');sh.addRow(['','工委單編號','工程內容','開單日期','回簽日期','安排廠家','施工港口','完工日期','備註']);
  for(let i=1;i<=101;i++)sh.addRow([String(i).padStart(4,'0'),'BATCH-'+String(i).padStart(3,'0'),i===1?'LONG-BEGIN\n'+('中性長內容與換行完整保留。\n'.repeat(160))+'LONG-END':'中性工程 '+i,i%3===0?new Date('2026-09-01T00:00:00Z'):i%3===1?20260901:'2026/9/1','','測試廠家','中性港口','','=SUM(1,2)\n原備註 '+i]);
  const file=path.join(output,'neutral-101.xlsx');await wb.xlsx.writeFile(file);await click('導入 Excel');await input(file);await until(async()=>(await text()).includes('主表候選 101 項')&&await evaluate("!document.querySelector('[aria-label=確認本次選船]').disabled"),'101 source rows ready');await nodeClick("document.querySelector('[aria-label=確認本次選船]')");const before=await qa.read();await click('選取全部候選');assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='確認保存所選 101 項').disabled"),true);assert.deepEqual(await qa.read(),before);
  await click('明確選取前 100 項可匯入資料');await click('確認保存所選 100 項');await until(async()=>(await text()).includes('本批 100 項已確認並權威讀回'),'first 100 ACK',90000);let saved=await qa.read();assert.equal(saved.revision,before.revision+1);assert.equal(saved.payload.trackingItems.length,101);
  await click('明確選取前 100 項可匯入資料');await click('確認保存所選 1 項');await until(async()=>(await text()).includes('本批 1 項已確認並權威讀回'),'second batch ACK',45000);saved=await qa.read();assert.equal(saved.revision,before.revision+2);assert.equal(saved.payload.trackingItems.length,102);assert.ok((await text()).includes('已確認批次 2'));await screen('import-101-separate-batches');await click('關閉導入');
 });
 await (await import('./tracking-spreadsheet-export-checks.mjs')).exportChecks({...c,input});
 await (await import('./tracking-spreadsheet-recovery-checks.mjs')).importRecoveryChecks({...c,input});
}

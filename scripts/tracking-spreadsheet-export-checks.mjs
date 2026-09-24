import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
export async function exportChecks(c){
 const {qa,call,evaluate,click,nodeClick,fill,until,text,screen,check,select,output,input}=c;
 const downloads=path.join(output,'downloads');fs.mkdirSync(downloads);await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads},null);
 const downloaded=[];
 const download=async(label,alias)=>{
  // CDP may overwrite an existing identical filename; isolate each click's directory.
  const actionDir=path.join(downloads,alias);fs.mkdirSync(actionDir);
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:actionDir},null);
  await click(label);let file;
  await until(()=>{file=fs.readdirSync(actionDir).find(n=>n.endsWith('.xlsx'));return Boolean(file);},'actual download '+label,45000);
  const from=path.join(actionDir,file),target=path.join(output,alias+'.xlsx');fs.copyFileSync(from,target);
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(target);downloaded.push({file:target,downloadName:file});return {file:target,wb};
 };
 const snapshot=async()=>{await click('建立共用快照');await until(async()=>(await text()).includes('共用快照已固定'),'authoritative shared snapshot',45000);};
 const readRows=wb=>{const s=wb.worksheets[0],keys=s.getRow(3).values.slice(1).map(v=>String(v).replace('tracking:',''));return {keys,rows:Array.from({length:Math.max(0,s.rowCount-4)},(_,i)=>Object.fromEntries(keys.map((k,c)=>[k,s.getCell(i+5,c+1).value])))};};
 const pdf=async(name,paper='A4')=>{
  await click('PDF 預覽');await until(()=>evaluate("Boolean(document.querySelector('.tracking-report-paper'))"),'mounted PDF paper');if(paper==='A3')await select("document.querySelector('[aria-label=\"PDF 紙張\"]')",'A3');
  await evaluate("window.__qaRealPrint=window.print;window.__qaPrintCalled=false;window.print=()=>{window.__qaPrintCalled=true;}");await click('導出／列印 PDF');await until(()=>evaluate('window.__qaPrintCalled'),'real print entry');assert.equal(await evaluate("document.body.classList.contains('printing-tracking-report')"),true);
  await screen(name+'-preview');const rendered=await call('Page.printToPDF',{preferCSSPageSize:true,printBackground:false,displayHeaderFooter:false});const file=path.join(output,name+'.pdf');fs.writeFileSync(file,Buffer.from(rendered.data,'base64'));
  await evaluate("window.dispatchEvent(new Event('afterprint'));window.print=window.__qaRealPrint;delete window.__qaRealPrint");assert.equal(await evaluate("document.body.classList.contains('printing-tracking-report')"),false);assert.equal(await evaluate("document.querySelectorAll('style[data-tracking-print]').length"),0);await click('關閉 PDF 預覽');return file;
 };
 await nodeClick("[...document.querySelectorAll('.tracking-tabs button')].find(b=>b.innerText.startsWith('未完成工程單'))");await until(async()=>(await text()).includes('共 102 項'),'authoritative 102 source list');await fill('[aria-label=搜尋跟蹤]','BATCH-');await nodeClick("document.querySelector('.tracking-reference .tracking-sort')");await until(async()=>(await text()).includes('共 101 項'),'full filtered count');
 const before=await qa.read();let fullExport;
 await check('download-all-filtered-sorted-not-30-and-visible-column-order',async()=>{
  await nodeClick("document.querySelector('.tracking-preferences summary')");await nodeClick("[...document.querySelectorAll('.tracking-preferences label')].find(n=>n.innerText==='回簽日期').querySelector('input')");
  // Use the exact accessible column move control; unrelated preferences stay intact.
  await nodeClick("document.querySelector('[aria-label=將原備註前移]')");
  const labels=await evaluate("[...document.querySelectorAll('.tracking-sort')].map(n=>n.innerText.replace(/[↑↓↕]/g,'').trim())");
  await click('Excel');await snapshot();const d=await download('下載 XLSX','browser-filtered-visible');const r=readRows(d.wb);assert.equal(r.rows.length,101);assert.equal(r.rows[0].referenceNo,'BATCH-001');assert.equal(r.rows.at(-1).referenceNo,'BATCH-101');assert.ok(!r.keys.includes('countersignDate'));assert.deepEqual(d.wb.worksheets[0].getRow(4).values.slice(1,1+labels.length),labels);assert.equal(r.rows[0].originalRemarks,'=SUM(1,2)\n原備註 1');await click('關閉匯出');
 });
 await check('selected-only-full-columns-shared-native-browser-pdf',async()=>{
  for(const index of [0,1])await nodeClick(`document.querySelectorAll('.tracking-table tbody .tracking-check input')[${index}]`);
  await click('PDF');await select("document.querySelector('[aria-label=匯出資料範圍]')",'selected');await select("document.querySelector('[aria-label=匯出欄位]')",'full');await snapshot();const d=await download('下載 XLSX','browser-selected-full');fullExport=d.file;const r=readRows(d.wb);assert.equal(r.rows.length,2);assert.deepEqual(r.rows.map(r=>r.referenceNo),['BATCH-001','BATCH-002']);assert.ok(r.keys.includes('countersignDate'));assert.ok(r.keys.includes('source'));assert.ok(r.rows[0].description.endsWith('LONG-END'));
  await pdf('browser-selected-full-A4');await pdf('browser-selected-full-A3','A3');await click('關閉匯出');assert.deepEqual(await qa.read(),before,'exports are read-only');
 });
 await check('all-filtered-compact-pdf-real-pagination',async()=>{
  await click('PDF');await select("document.querySelector('[aria-label=匯出資料範圍]')",'all');await select("document.querySelector('[aria-label=匯出欄位]')",'compact');await snapshot();const d=await download('下載 XLSX','browser-filtered-compact');assert.equal(readRows(d.wb).rows.length,101);await pdf('browser-filtered-compact-A4');await click('關閉匯出');
 });
 await check('native-template-downloads-two-kinds',async()=>{for(const [label,kind] of [['配件物料模板','supply'],['工程模板','engineering']]){const d=await download(label,'browser-template-'+kind);assert.equal(d.wb.getWorksheet('_tracking_schema').getCell('B2').text,kind);assert.ok(readRows(d.wb).keys.includes('expectedDate'));assert.ok(readRows(d.wb).keys.includes('closedDate'));}});
 await check('same-ID-export-reimport-no-silent-duplicate',async()=>{
  await click('導入 Excel');await input(fullExport);await until(async()=>(await text()).includes('主表候選 2 項')&&await evaluate("!document.querySelector('[aria-label=確認本次選船]').disabled"),'reimport full export');assert.ok((await text()).includes('相同系統 ID'));assert.equal(await evaluate("[...document.querySelectorAll('.tracking-import-rows legend input')].every(n=>n.disabled)"),true);await screen('same-id-import-blocked');assert.deepEqual(await qa.read(),before);await click('取消導入');
 });
 fs.writeFileSync(path.join(output,'downloads-receipt.json'),JSON.stringify({downloaded,pdfs:['browser-selected-full-A4.pdf','browser-selected-full-A3.pdf','browser-filtered-compact-A4.pdf']},null,2));
}

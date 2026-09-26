import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {execFileSync} from 'node:child_process';
import {assertTemplateCalendar,assertCalendarPackage} from './tracking-template-date-assertions.mjs';

// Original UI downloads and file-input imports; native local PostgreSQL, test data only.
export async function templateDateChecks({qa,call,click,nodeClick,until,text,screen,check,output,audience}) {
 const receipts=[];
 for (const [label,kind] of [['配件物料模板','supply'],['工程模板','engineering']]) {
  await check(`${audience}-${kind}-template-offline-calendar-download-import-native-readback`,async()=>{
   const downloads=path.join(output,`date-template-${kind}`);fs.mkdirSync(downloads);
   await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads},null);
   const before=await qa.read();await click(label);let name;
   await until(()=>{name=fs.readdirSync(downloads).find(n=>n.endsWith('.xlsm'));return Boolean(name);},'date template download',45000);
   const file=path.join(downloads,name),book=new ExcelJS.Workbook();await book.xlsx.readFile(file);
   const dates=assertTemplateCalendar(book,kind);await assertCalendarPackage(fs.readFileSync(file));assert.deepEqual(await qa.read(),before,'download is read-only');
   const year=2026,actualKey=kind==='supply'?'actualDeliveryDate':'completionDate';
   const referenceNo=`DATE-${audience}-${kind}`;
   const values={referenceNo,description:'離線月曆模板回填；真實UI＋測試資料',applicationDate:`${year}-01-02`,expectedDate:`${year}-02-04`,[actualKey]:`${year}-01-03`,normal:'是',vesselId:'qa-v1'};
   const sheet=book.getWorksheet('填寫資料');
   sheet.getRow(3).eachCell((cell,index)=>{const key=cell.text.replace('tracking:','');if(key in values)sheet.getCell(5,index).value=values[key];});
   const nativeFiller=process.env.QA_CALENDAR_NATIVE_FILLER;
   const filled=path.join(output,`date-filled-${kind}.${nativeFiller?'xlsm':'xlsx'}`);
   if(nativeFiller)execFileSync('python3',[nativeFiller,file,filled,JSON.stringify(values)],{timeout:60000,encoding:'utf8'});
   else await book.xlsx.writeFile(filled); // Legacy XLSX fallback is not native-calendar acceptance.
   if(nativeFiller){const saved=await (await import('jszip')).default.loadAsync(fs.readFileSync(filled));assert.ok(saved.file('xl/vbaProject.bin'),'native save must retain the calendar');}
   await click('導入 Excel');const {root}=await call('DOM.getDocument');
   const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'[aria-label="選擇跟蹤 Excel"]'});
   await call('DOM.setFileInputFiles',{nodeId,files:[filled]});
   await until(async()=>(await text()).includes('解析完成；'),'parsed date template');
   await nodeClick("document.querySelector('[aria-label=\"確認本次選船\"]')");
   await click('明確選取前 100 項可匯入資料');await click('確認保存所選 1 項');
   await until(async()=>(await text()).includes('本批 1 項已確認並權威讀回'),'template import exact ACK');
   await screen(`date-${kind}-import-confirmed`);await click('關閉導入');
   const matches=(await qa.read()).payload.trackingItems.filter(item=>item.referenceNo===referenceNo);
   assert.equal(matches.length,1);const saved=matches[0];
   assert.equal(saved.kind,kind);assert.equal(saved.applicationDate,values.applicationDate);
   assert.equal(saved.expectedDate,values.expectedDate);assert.equal(saved[actualKey],values[actualKey]);
   assert.equal(saved.isClosed,false,'actual delivery/completion must not infer administrative closure');
   receipts.push({audience,kind,file,filled,...dates,nativeExcelSave:Boolean(nativeFiller),datesPreserved:true,readback:true});
  });
 }
 fs.writeFileSync(path.join(output,'template-date-receipt.json'),JSON.stringify({label:'真實UI＋測試資料；非正式站',receipts},null,2));
}

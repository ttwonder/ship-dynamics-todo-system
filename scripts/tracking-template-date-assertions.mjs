import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createHash} from 'node:crypto';
import fs from 'node:fs';

// Saved-file contracts only. Native Excel/calendar clicks are a separate gate.
export function assertTemplateCalendar(book, kind) {
 const sheet=book.getWorksheet('填寫資料');
 const keys=sheet.getRow(3).values.slice(1).map(value=>String(value).replace('tracking:',''));
 const dateKeys=['applicationDate','expectedDate',kind==='supply'?'actualDeliveryDate':'completionDate'];
 for(const key of dateKeys){
  const col=keys.indexOf(key)+1;assert.ok(col>0,key);
  for(const row of [...Array.from({length:10},(_,i)=>i+5),15,104,10000]){
   const rule=sheet.dataValidations.find(`${sheet.getColumn(col).letter}${row}`)||{};
   assert.equal(rule.type,'custom','calendar dates must not retain a list picker');
   assert.equal(rule.allowBlank,true);assert.equal(rule.showErrorMessage,true);assert.equal(rule.errorStyle,'stop');assert.notEqual(rule.showInputMessage,true,'Excel validation balloons must not obscure the calendar');
   assert.match(rule.prompt,/月曆/);assert.equal(rule.formulae.length,1);assert.match(rule.formulae[0],/ISNUMBER/);
   if(row<=14){const cell=sheet.getCell(row,col);assert.equal(cell.value,null,'today is selected only in the calendar');assert.equal(cell.numFmt,'yyyy-mm-dd');}
  }
  assert.equal(sheet.getColumn(col).numFmt,'yyyy-mm-dd');
 }
 assert.equal(book.getWorksheet('_tracking_dates'),undefined,'remove the obsolete date-option list');
 assert.equal(book.definedNames.getRanges('TrackingTemplateDates').ranges.length,0);
 for(const key of ['normal','urgent','requestType'])assert.equal(sheet.getCell(5,keys.indexOf(key)+1).dataValidation.type,'list');
 assert.equal(sheet.rowCount,14);assert.equal(sheet.pageSetup.printArea,'A1:N14');
 assert.deepEqual(book.worksheets.filter(s=>s.state==='visible').map(s=>s.name),['填寫資料','列印明細']);
 return {dateKeys};
}
export async function assertCalendarPackage(bytes){
 const zip=await JSZip.loadAsync(bytes),read=name=>zip.file(name).async('string');
 assert.match(await read('[Content_Types].xml'),/application\/vnd\.ms-excel\.sheet\.macroEnabled\.main\+xml/);
 assert.match(await read('xl/_rels/workbook.xml.rels'),/relationships\/vbaProject/);
 assert.match(await read('xl/workbook.xml'),/codeName="ThisWorkbook"/);
 assert.match(await read('xl/workbook.xml'),/filterPrivacy="0"/,'avoid the native VBA/document-inspector save warning');
 const project=JSON.parse(fs.readFileSync(new URL('../src/tracking/calendar/project.json',import.meta.url),'utf8'));
 const binary=await zip.file('xl/vbaProject.bin').async('nodebuffer');
 assert.equal(createHash('sha256').update(binary).digest('hex'),project.sha256);
 assert.deepEqual(binary,Buffer.from(project.base64,'base64'));
 for(const [i,name] of project.worksheetCodeNames.entries())assert.ok((await read(`xl/worksheets/sheet${i+1}.xml`)).includes(`codeName="${name}"`));
 assert.ok(!Object.keys(zip.files).some(name=>name.startsWith('xl/externalLinks/')));
 return {macroSha256:project.sha256};
}

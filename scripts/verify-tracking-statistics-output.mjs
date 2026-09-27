import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import ExcelJS from 'exceljs';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
try {
 const api=fs.existsSync('src/tracking/trackingStatisticsReport.ts')?await vite.ssrLoadModule('/src/tracking/trackingStatisticsReport.ts'):null;
 assert.equal(typeof api?.makeStatisticsReport,'function','dedicated statistics export preserves the selected cohort without item details');
 const rows=Array.from({length:3},(_,i)=>({id:'stats-'+i,vesselId:'v',referenceNo:'SAME-REQ',kind:'supply',requestType:'spares',applicationDate:'2026-09-25',urgency:'urgent',isClosed:false,deliveryStatus:i===0?'delivered':'not-delivered',actualDeliveryDate:i===0?'2026-09-26':'',expectedDate:'2026-09-25',description:'=SUM(A1) '+('完整長文\n'.repeat(200)),progress:'@NOFORMULA',supplementalNotes:'END-OF-NOTES',statusLogs:[]}));
 const query={vesselId:'v',from:'2026-09-01',to:'2026-09-30',type:'spares',urgency:'urgent'},focus={metric:'completed',category:'all'};
 const report=api.makeStatisticsReport(rows,query,focus,{vesselName:'測試輪 QA SHIP',generatedAt:'2026-09-25T00:00:00Z',today:'2026-09-25'});
 assert.equal(report.stats.summary.total,3);assert.equal(report.stats.summary.completed,1);assert.equal(report.rows,undefined);assert.equal(report.stats.rows,undefined);assert.ok(Object.isFrozen(report));rows[0].description='changed';assert.ok(!JSON.stringify(report).includes('完整長文'));assert.ok(!JSON.stringify(report).includes('@NOFORMULA'));
 const excel=await vite.ssrLoadModule('/src/tracking/trackingStatisticsExcel.ts');
 const bytes=await excel.buildStatisticsWorkbook(report),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
 const summary=book.getWorksheet('統計摘要');assert.ok(summary);assert.deepEqual(book.worksheets.map(s=>s.name),['統計摘要','分類統計']);assert.ok(JSON.stringify(summary.getSheetValues()).includes('2026-09-01'));assert.ok(JSON.stringify(summary.getSheetValues()).includes('備件'));assert.ok(!JSON.stringify(book.worksheets.map(s=>s.getSheetValues())).includes('stats-0'));
 for(const sheet of book.worksheets){assert.equal(sheet.pageSetup.fitToWidth,1);assert.equal(sheet.pageSetup.fitToHeight,0);for(let r=4;r<=sheet.rowCount;r++)for(let c=1;c<=sheet.columnCount;c++)for(const side of ['top','bottom','left','right'])assert.equal(sheet.getCell(r,c).border[side]?.style,'thin',`${sheet.name}!${sheet.getCell(r,c).address} ${side}: full table grid, including empty denominator cells`);}
 if(process.env.QA_OUTPUT)fs.writeFileSync(path.join(process.env.QA_OUTPUT,'statistics-export.xlsx'),Buffer.from(bytes));
 console.log(JSON.stringify({gate:'tracking-statistics-output',status:'PASS',caseCount:4,cases:['immutable-summary-only-no-item-content','real-xlsx-selected-scope-summary-and-categories','all-sheets-one-page-wide-unlimited-height','full-table-borders-including-empty-cells']}));
}finally{await vite.close();}

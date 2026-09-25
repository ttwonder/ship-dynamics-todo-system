import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'vite';
import ExcelJS from 'exceljs';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
try {
 const api=fs.existsSync('src/tracking/trackingStatisticsReport.ts')?await vite.ssrLoadModule('/src/tracking/trackingStatisticsReport.ts'):null;
 assert.equal(typeof api?.makeStatisticsReport,'function','dedicated statistics export preserves cohort and focused detail, not a fake TrackingTab');
 const rows=Array.from({length:3},(_,i)=>({id:'stats-'+i,vesselId:'v',referenceNo:'SAME-REQ',kind:'supply',requestType:'spares',applicationDate:'2026-09-25',urgency:'urgent',isClosed:false,deliveryStatus:i===0?'delivered':'not-delivered',actualDeliveryDate:i===0?'2026-09-26':'',expectedDate:'2026-09-25',description:'=SUM(A1) '+('完整長文\n'.repeat(200)),progress:'@NOFORMULA',supplementalNotes:'END-OF-NOTES',statusLogs:[]}));
 const query={vesselId:'v',from:'2026-09-01',to:'2026-09-30',type:'spares',urgency:'urgent'},focus={metric:'completed',category:'all'};
 const report=api.makeStatisticsReport(rows,query,focus,{vesselName:'測試輪 QA SHIP',generatedAt:'2026-09-25T00:00:00Z',today:'2026-09-25'});
 assert.equal(report.stats.summary.total,3);assert.equal(report.stats.summary.completed,1);assert.equal(report.rows.length,1);assert.ok(Object.isFrozen(report));rows[0].description='changed';assert.ok(report.rows[0].values.description.startsWith('=SUM'));
 const excel=await vite.ssrLoadModule('/src/tracking/trackingStatisticsExcel.ts');
 const bytes=await excel.buildStatisticsWorkbook(report),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
 const summary=book.getWorksheet('統計摘要'),detail=book.getWorksheet('期間申請明細');assert.ok(summary&&detail);assert.ok(JSON.stringify(summary.getSheetValues()).includes('2026-09-01'));assert.ok(JSON.stringify(summary.getSheetValues()).includes('spares')||JSON.stringify(summary.getSheetValues()).includes('備件'));
 assert.equal(detail.rowCount,5);assert.equal(detail.getCell(5,1).text,'stats-0');assert.equal(detail.getCell(5,5).type,ExcelJS.ValueType.String);assert.equal(detail.getCell(5,5).text,report.rows[0].values.description);
 for(const sheet of book.worksheets){assert.equal(sheet.pageSetup.fitToWidth,1);assert.equal(sheet.pageSetup.fitToHeight,0);}
 console.log(JSON.stringify({gate:'tracking-statistics-output',status:'PASS',caseCount:3,cases:['immutable-full-cohort-focused-detail','real-xlsx-scope-text-safety-and-complete-content','all-sheets-one-page-wide-unlimited-height']}));
}finally{await vite.close();}

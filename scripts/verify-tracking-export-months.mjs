import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import ExcelJS from 'exceljs';

const vite = await createServer({ configFile:false, server:{middlewareMode:true,hmr:false}, appType:'custom', logLevel:'silent' });
const cases = [];
if(process.env.QA_OUTPUT)fs.mkdirSync(process.env.QA_OUTPUT,{recursive:true});
const check = async (name, run) => { await run(); cases.push(name); console.log('PASS', name); };
const item = (id, applicationDate = '2024-02-29', patch = {}) => ({
  id, vesselId:'qa-month-v1', kind:'supply', requestType:'spares', referenceNo:id,
  description:'MONTH-MATCH ' + id, applicationDate, urgency:'normal', purchaseNos:'KEEP',
  supplementalNotes:'', progress:'', expectedDate:'', deliveryStatus:'not-delivered', isClosed:false,
  createdBy:'qa', updatedBy:'qa', createdAt:'2024-02-01T00:00:00Z', updatedAt:'2024-02-01T00:00:00Z', statusLogs:[], ...patch,
});
const deletion = {at:'2024-03-01T00:00:00Z',byUserId:'qa',reason:'isolated test'};
const metadata = { vesselId:'qa-month-v1', vesselName:'月份測試輪 MONTH QA', kind:'supply', title:'未送船清單', generatedAt:'2024-03-01T00:00:00Z', summary:'月份測試', selection:'all' };
const receipt = {gate:'tracking-export-months',label:'純函式＋實際 XLSX 讀回；合成資料，非正式環境',cases};
try {
  const reports = await vite.ssrLoadModule('/src/tracking/trackingReport.ts');
  const {trackingColumnsFor} = await vite.ssrLoadModule('/src/tracking/trackingColumns.ts');
  const columns = trackingColumnsFor('supply');
  await check('report-builder-defensively-excludes-deleted-preserves-pending', () => {
    const rows = [item('KEEP-ACTIVE'), item('EXCLUDE-DELETED',undefined,{deletion}), item('KEEP-PENDING',undefined,{deletionRequest:{...deletion,status:'pending'}})];
    const before = structuredClone(rows);
    const report = reports.makeTrackingReport(rows,columns,metadata);
    assert.deepEqual(report.rows.map(r=>r.id), ['KEEP-ACTIVE','KEEP-PENDING']);
    assert.deepEqual(rows,before);
    assert.ok(Object.isFrozen(report) && Object.isFrozen(report.rows) && Object.isFrozen(report.rows[0].item));
    const restored={...rows[1]};delete restored.deletion;
    assert.deepEqual(reports.makeTrackingReport([restored],columns,metadata).rows.map(r=>r.id),['EXCLUDE-DELETED'],'restored sources become eligible without changing their IDs');
  });
  const {selectTrackingRows} = await vite.ssrLoadModule('/src/tracking/trackingFilters.ts');
  // Before the month feature, the real export path only used the view selector.
  const months = fs.existsSync('src/tracking/trackingExportMonths.ts')
    ? await vite.ssrLoadModule('/src/tracking/trackingExportMonths.ts')
    : {selectTrackingExportRows:selectTrackingRows};
  const query = {vesselId:'qa-month-v1',tab:'undelivered',filters:{},search:'',sort:{key:'referenceNo',direction:'desc'}};
  const february = {startMonth:'2024-02',endMonth:'2024-02'};
  await check('natural-leap-february-includes-whole-month-not-neighboring-dates', () => {
    const rows = [item('JAN-EXCLUDED','2024-01-31'),item('FEB-FIRST','2024-02-01'),item('FEB-LAST','2024-02-29'),item('MAR-EXCLUDED','2024-03-01')];
    assert.deepEqual(months.selectTrackingExportRows(rows,query,february).map(r=>r.id),['FEB-LAST','FEB-FIRST']);
  });
  await check('month-validation-reversed-missing-invalid-and-no-match-never-fallback', () => {
    for(const range of [{startMonth:'',endMonth:'2024-02'},{startMonth:'2024-02',endMonth:''},{startMonth:'2024-2',endMonth:'2024-02'},{startMonth:'0000-01',endMonth:'2024-02'},{startMonth:'2024-13',endMonth:'2024-13'},{startMonth:'2024-03',endMonth:'2024-02'}]) {
      assert.throws(()=>months.selectTrackingExportRows([item('MATCH')],query,range),/月份/);
    }
    assert.throws(()=>months.selectTrackingExportRows([item('OUTSIDE','2024-03-01')],query,february),/0 項/);
    assert.throws(()=>months.selectTrackingExportRows([item('MATCH')],query,february,[]),/0 項/);
    assert.throws(()=>months.selectTrackingExportRows([item('MATCH')],{...query,tab:'deleted'},february),/已刪除清單不可匯出/);
    assert.throws(()=>months.selectTrackingExportRows([item('DELETE',undefined,{deletion})],{...query,view:'deleted'},february),/已刪除清單不可匯出/);
  });
  await check('calendar-boundaries-century-leap-year-and-december-january', () => {
    for(const [month,last] of [['2024-02','29'],['2023-02','28'],['1900-02','28'],['2000-02','29'],['2024-04','30'],['2024-12','31']]) {
      assert.deepEqual(months.trackingExportMonthRange({startMonth:month,endMonth:month}),{startMonth:month,endMonth:month,from:month+'-01',to:month+'-'+last,basis:'applicationDate'});
    }
    const rows = [item('NOV','2023-11-30'),item('DEC','2023-12-01'),item('DEC-END','2023-12-31'),item('JAN','2024-01-01'),item('JAN-END','2024-01-31'),item('FEB','2024-02-01')];
    assert.deepEqual(months.selectTrackingExportRows(rows,{...query,sort:{key:'applicationDate',direction:'asc'}},{startMonth:'2023-12',endMonth:'2024-01'}).map(r=>r.id),['DEC','DEC-END','JAN','JAN-END']);
    for(const applicationDate of ['',undefined,'2023-02-29','2024-02-30','2024-2-01','2024-02-01T00:00:00Z','not-a-date']) {
      assert.throws(()=>months.selectTrackingExportRows([item('INVALID','2024-02-01',{applicationDate})],query,{startMonth:'2023-01',endMonth:'2024-12'}),/0 項/);
    }
  });
  await check('month-AND-vessel-tab-keyword-column-filter-selected-IDs-and-order', () => {
    const rows = [item('KEEP-A','2024-02-01'),item('KEEP-B'),item('DELETE',undefined,{deletion}),item('PENDING',undefined,{deletionRequest:{...deletion,status:'pending'}}),item('WRONG-VESSEL',undefined,{vesselId:'qa-month-v2'}),item('WRONG-TAB',undefined,{deliveryStatus:'delivered'}),item('WRONG-KEYWORD',undefined,{description:'other'}),item('WRONG-COLUMN',undefined,{purchaseNos:'OTHER'}),item('WRONG-MONTH','2024-03-01')];
    const filtered = {...query,search:'MONTH-MATCH',filters:{purchaseNos:{text:'KEEP'},applicationDate:{from:'2024-02-15'}}};
    const result = months.selectTrackingExportRows(rows,filtered,february);
    assert.deepEqual(result.map(r=>r.id),['PENDING','KEEP-B']);
    assert.deepEqual(months.selectTrackingExportRows(rows,filtered,february,['KEEP-B','DELETE','WRONG-VESSEL','WRONG-MONTH']).map(r=>r.id),['KEEP-B']);
    assert.throws(()=>months.selectTrackingExportRows(rows,filtered,february,['WRONG-MONTH']),/0 項/);
    assert.ok(!Object.isFrozen(rows[0]),'selection must not mutate/freeze live inputs');
  });
  await check('default-month-uses-Taipei-at-UTC-month-and-year-rollover', () => {
    const RealDate = globalThis.Date;
    try {
      for(const [now,month] of [['2024-01-31T16:30:00Z','2024-02'],['2024-12-31T16:30:00Z','2025-01']]) {
        globalThis.Date = class extends RealDate {constructor(...args){super(...(args.length?args:[now]));} static now(){return new RealDate(now).getTime();}};
        assert.deepEqual(months.defaultTrackingExportMonths(),{startMonth:month,endMonth:month});
      }
    } finally { globalThis.Date = RealDate; }
  });
  const excel = await vite.ssrLoadModule('/src/tracking/trackingExcel.ts');
  await check('direct-workbook-builder-excludes-manually-supplied-deleted-rows', async () => {
    const {trackingRowSnapshot} = await vite.ssrLoadModule('/src/tracking/trackingFilters.ts');
    const rows = [item('KEEP-ACTIVE'),item('EXCLUDE-DELETED',undefined,{deletion}),item('KEEP-PENDING',undefined,{deletionRequest:{...deletion,status:'pending'}})];
    const report = {...trackingRowSnapshot(rows,columns),...metadata};
    const bytes = await excel.buildTrackingWorkbook(report);
    const book = new ExcelJS.Workbook();await book.xlsx.load(bytes);
    const allText = book.worksheets.flatMap(s=>s.getSheetValues().flat(2)).join('\n');
    assert.ok(!allText.includes('EXCLUDE-DELETED'),'deleted marker must be absent from every saved sheet');
    assert.ok(allText.includes('KEEP-ACTIVE') && allText.includes('KEEP-PENDING'));
    assert.equal(book.getWorksheet('跟蹤資料').rowCount,6);
    assert.equal(report.rows.length,3,'defensive builder must not mutate input snapshot');
    if(process.env.QA_OUTPUT)fs.writeFileSync(path.join(process.env.QA_OUTPUT,'defensive-deleted-exclusion.xlsx'),Buffer.from(bytes));
  });
  await check('administrative-request-view-is-not-a-mixed-kind-export', () => {
    const rows=[item('PENDING-SUPPLY',undefined,{deletionRequest:{...deletion,status:'pending'}}),item('PENDING-ENGINEERING',undefined,{kind:'engineering',requestType:'repair',deletionRequest:{...deletion,status:'pending'}})];
    assert.throws(()=>months.selectTrackingExportRows(rows,{...query,view:'requests'},february),/清單不可匯出/);
  });
  await check('month-provenance-merged-summary-remains-readable-with-original-table-coordinates', async () => {
    const summary='所選 2 項｜申請/開單日期（applicationDate）自然月 2024-02 至 2024-02（2024-02-01～2024-02-29，含首尾日）｜分頁 未送船清單｜標準完整欄位｜排序 申請單號(材料或工程) 降冪｜搜尋 MONTH MATCH｜篩選 {"purchaseNos":{"text":"KEEP"}}';
    const report=reports.makeTrackingReport([item('KEEP-B'),item('KEEP-A')],columns,{...metadata,summary});
    const bytes=await excel.buildTrackingWorkbook(report),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
    const print=book.getWorksheet('列印明細');assert.ok(print.getRow(2).height>32,'long merged month/filter provenance needs more than the previous fixed 32pt');
    assert.ok(print.getCell('A2').text.includes(summary));assert.equal(print.getCell('A4').text,'序號');assert.equal(print.views[0].ySplit,4);assert.equal(print.pageSetup.printTitlesRow,'1:4');
    assert.equal(book.getWorksheet('跟蹤資料').getRow(3).hidden,true);
    for(const sheet of book.worksheets.filter(s=>s.state==='visible'))for(let r=4;r<=sheet.rowCount;r++)for(let c=1;c<=sheet.columnCount;c++)for(const side of ['top','bottom','left','right'])assert.equal(sheet.getCell(r,c).border[side]?.style,'thin');
    if(process.env.QA_OUTPUT)fs.writeFileSync(path.join(process.env.QA_OUTPUT,'monthly-provenance-gridlines.xlsx'),Buffer.from(bytes));
  });
  await check('engineering-months-use-application-date-not-DL-or-completion-date', () => {
    const rows=[item('APPLICATION-FEB','2024-02-01',{kind:'engineering',requestType:'repair',expectedDate:'2024-03-01'}),item('DL-ONLY','2024-01-31',{kind:'engineering',requestType:'repair',expectedDate:'2024-02-01'}),item('COMPLETED','2024-02-29',{kind:'engineering',requestType:'repair',completionDate:'2024-03-02'})];
    assert.deepEqual(months.selectTrackingExportRows(rows,{...query,tab:'engineering-open'},february).map(r=>r.id),['APPLICATION-FEB']);
    assert.deepEqual(months.selectTrackingExportRows(rows,{...query,tab:'engineering-closed'},february).map(r=>r.id),['COMPLETED']);
  });
  receipt.status = 'PASS';
} catch (error) {
  receipt.status = 'FAIL'; receipt.error = error.stack; process.exitCode = 1;
} finally {
  await vite.close();
  if(process.env.QA_OUTPUT){fs.mkdirSync(process.env.QA_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.QA_OUTPUT,'export-months-receipt.json'),JSON.stringify(receipt,null,2));}
  console.log(JSON.stringify({...receipt,caseCount:cases.length},null,2));
}

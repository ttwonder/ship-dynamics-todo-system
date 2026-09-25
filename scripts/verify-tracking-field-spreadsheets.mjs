import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import ExcelJS from 'exceljs';import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});const cases=[];
const check=async(name,fn)=>{await fn();cases.push(name);console.log('PASS',name);};
try{
 const {buildTrackingWorkbook,buildTrackingTemplate}=await vite.ssrLoadModule('/src/tracking/trackingExcel.ts');
 const {parseTrackingWorkbook,TRACKING_XLSX_VERSION,importRowErrors}=await vite.ssrLoadModule('/src/tracking/trackingImport.ts');
 const {trackingColumnsFor}=await vite.ssrLoadModule('/src/tracking/trackingColumns.ts');
 const {trackingRowSnapshot}=await vite.ssrLoadModule('/src/tracking/trackingFilters.ts');
 const {compactTrackingColumns}=await vite.ssrLoadModule('/src/tracking/trackingReport.ts');
 const {TRACKING_REQUEST_TYPES}=await vite.ssrLoadModule('/src/tracking/trackingRequestTypes.ts');
 const output=process.env.QA_OUTPUT;if(output)fs.mkdirSync(output,{recursive:true});
 await check('all-five-type-labels-excel-roundtrip-and-independent-dates',async()=>{
  for(const type of TRACKING_REQUEST_TYPES){
   const item={id:'qa-'+type.value,kind:type.kind,requestType:type.value,vesselId:'qa-v1',referenceNo:'00000123456789012345',purchaseNos:'00007\n00008',originalItemNo:'01',description:'內容／工程\n完整保留',applicationDate:'2026-09-25',expectedDate:'2026-10-01',progress:'最新進度',supplementalNotes:'=NOT_A_FORMULA',urgency:'normal',deliveryStatus:type.kind==='supply'?'delivered':'not-delivered',...(type.kind==='supply'?{actualDeliveryDate:'2026-09-26'}:{completionDate:'2026-09-26'}),isClosed:false,statusLogs:[],createdAt:'',updatedAt:'',createdBy:'',updatedBy:''};
   const report={...trackingRowSnapshot([item],trackingColumnsFor(type.kind)),vesselId:item.vesselId,vesselName:'測試輪 QA SHIP',kind:type.kind,title:'欄位測試',generatedAt:'2026-09-25T00:00:00Z',summary:'真實匯出＋測試資料',selection:'all'};
   const bytes=await buildTrackingWorkbook(report),parsed=await parseTrackingWorkbook(bytes,'fields.xlsx','qa-v1');const row=parsed.sheets[0].rows[0];
   assert.equal(row.item.requestType,type.value);assert.equal(row.item.purchaseNos,item.purchaseNos);assert.equal(row.item.isClosed,false);assert.equal(row.item.actualDeliveryDate||row.item.completionDate,'2026-09-26');assert.deepEqual(importRowErrors(row),[]);
   const read=new ExcelJS.Workbook();await read.xlsx.load(bytes);assert.ok(read.getWorksheet('跟蹤資料').getRow(4).values.includes('申請單號(材料或工程)'));assert.equal(read.getWorksheet('列印明細').getCell('B4').text,'申請單號(材料或工程)');
   if(output)fs.writeFileSync(path.join(output,type.value+'.xlsx'),Buffer.from(bytes));
  }
 });
 await check('new-template-only-requested-fields-and-exact-kind-dropdown',async()=>{
  for(const kind of ['supply','engineering']){
   const bytes=await buildTrackingTemplate(kind,'測試輪 QA SHIP','qa-v1'),read=new ExcelJS.Workbook();await read.xlsx.load(bytes);const sheet=read.getWorksheet('填寫資料');const keys=sheet.getRow(3).values.slice(1).map(s=>s.replace('tracking:',''));
   assert.deepEqual(keys,['referenceNo','purchaseNos','originalItemNo','applicationDate','requestType','description','expectedDate',kind==='supply'?'actualDeliveryDate':'completionDate','normal','urgent','supplementalNotes','progress','id','vesselId']);
   const col=keys.indexOf('requestType')+1;assert.equal(sheet.getCell(5,col).dataValidation.type,'list');assert.equal(sheet.getCell(5,col).dataValidation.formulae[0],'"'+TRACKING_REQUEST_TYPES.filter(t=>t.kind===kind).map(t=>t.label).join(',')+'"');
   assert.equal((await parseTrackingWorkbook(bytes,'blank.xlsx','qa-v1')).sheets[0].rows.length,0);
   assert.ok(compactTrackingColumns(kind).some(c=>c.key==='requestType'));assert.ok(compactTrackingColumns(kind).some(c=>c.key=== (kind==='supply'?'actualDeliveryDate':'completionDate')));
   if(output)fs.writeFileSync(path.join(output,'template-'+kind+'.xlsx'),Buffer.from(bytes));
  }
 });
 await check('legacy-system-columns-still-import-with-original-values-and-no-type-inference',async()=>{
  for(const kind of ['supply','engineering']){
   const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('跟蹤資料');book.addWorksheet('_tracking_schema').addRows([['version',TRACKING_XLSX_VERSION],['kind',kind]]);
   const legacy={referenceNo:'OLD-001',description:'舊格式',applicationDate:'2026-09-25',normal:'是',urgent:'否',supplier:'舊供應商',preparationDate:'2026-09-24',materialCategory:'原分類',estimatedSupplyDatePlace:'原地點',countersignDate:'2026-09-24',contractor:'原廠家',constructionPort:'原港口',originalRemarks:'原工程備註',subitemNo:'2',urgentSubtypes:'其他'};
   sheet.addRow(Object.keys(legacy).map(k=>'tracking:'+k));sheet.addRow(Object.keys(legacy));sheet.addRow(Object.values(legacy));
   const parsed=await parseTrackingWorkbook(await book.xlsx.writeBuffer(),'old.xlsx','qa-v1');const row=parsed.sheets[0].rows[0];assert.equal(row.item.supplier,legacy.supplier);assert.equal(row.item.originalRemarks,legacy.originalRemarks);assert.equal(row.item.requestType,undefined);assert.equal(row.item.source.originalValues.F3,'舊供應商');assert.deepEqual(importRowErrors(row),[]);
  }
 });
 console.log(JSON.stringify({status:'PASS',gate:'tracking-field-spreadsheets',caseCount:cases.length,cases}));
}finally{await vite.close();}

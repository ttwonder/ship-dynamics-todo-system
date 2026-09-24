import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import ExcelJS from 'exceljs';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];const check=async(name,fn)=>{await fn();cases.push(name);console.log('PASS',name);};
try {
 const api=fs.existsSync('src/tracking/trackingImport.ts')?await vite.ssrLoadModule('/src/tracking/trackingImport.ts'):{};
 await check('xlsx-parser-available',()=>assert.equal(typeof api.parseTrackingWorkbook,'function','approved XLSX parser must exist'));
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('follow up list (配件)');
 s.getCell('A2').value='項次 Item';s.getCell('B3').value='船上申請日期 Submitted Date';s.getCell('C3').value='材料申請單本單編號 M/R Ref. No.';s.getCell('F3').value='內容摘要 Briefly Contents';s.getCell('I4').value='其他 Others';s.getColumn(9).hidden=true;
 s.addRow([]);s.getCell('B5').value=new Date('2026-09-01T00:00:00Z');s.getCell('C5').value='000000123456789012345';s.getCell('D5').value='00001\n00002';s.getCell('F5').value='中性材料';s.getCell('I5').value='V';s.getCell('M5').value='收到其中一件';
 const bytes=await book.xlsx.writeBuffer();const parsed=await api.parseTrackingWorkbook(bytes,'neutral-f28.xlsx','qa-v1');
 await check('f28-hidden-urgency-and-no-receipt-inference',()=>{const r=parsed.sheets[0].rows[0];assert.equal(r.item.urgency,'urgent');assert.equal(r.item.referenceNo,'000000123456789012345');assert.equal(r.item.purchaseNos,'00001\n00002');assert.equal(r.item.deliveryStatus,'not-delivered');assert.ok(r.issues.some(x=>x.code==='delivery-confirm'));assert.equal(r.item.applicationDate,'2026-09-01');assert.equal(r.item.source.originalValues.I5,'V');});
 if(process.env.TRACKING_REFERENCE_DIR){
  const dir=process.env.TRACKING_REFERENCE_DIR;
  for(const [n,hash,count] of [[1,'4a6335b5142ef44e7334c2b409c62e46c72040172870763b9b3a53d46d51f702',67],[2,'d5f2bb8830d8655200a97e963c40a49f8300725594c381cd396bc81d48e4894d',139]]){
   const file=path.join(dir,`reference-${n}-readonly.xlsx`),input=fs.readFileSync(file);assert.equal(createHash('sha256').update(input).digest('hex'),hash);
   const p=await api.parseTrackingWorkbook(input,`reference-${n}-readonly.xlsx`,'read-only-no-save');const sh=p.sheets[0];
   await check(`original-F${n===1?'28':'34'}-source-count-and-exceptions`,()=>{
    assert.equal(sh.rows.filter(r=>!r.outside).length,count);assert.ok(sh.excluded.length>0);
    if(n===1){assert.ok(sh.rows.some(r=>r.sourceRow===71));assert.equal(sh.mapping.length,13);assert.equal(sh.rows.find(r=>r.sourceRow===14).item.deliveryStatus,'not-delivered');assert.ok(sh.excluded.some(r=>r.sourceRow===93));}
    else {assert.equal(new Set(sh.rows.filter(r=>!r.outside).map(r=>r.item.referenceNo)).size,133);const merged=sh.rows.filter(r=>r.sourceRow>=71&&r.sourceRow<=77);assert.equal(merged.length,7);assert.equal(new Set(merged.map(r=>r.item.referenceNo)).size,1);assert.equal(merged[0].item.referenceNo,'9EX240310');assert.equal(sh.excluded.length,8);assert.ok(sh.rows.find(r=>r.sourceRow===62).issues.some(x=>x.code==='date:completionDate'));for(const row of [64,77,83])assert.ok(sh.rows.find(r=>r.sourceRow===row).issues.some(x=>x.code==='completion-confirm'));assert.ok(sh.rows.every(r=>!r.item.isClosed));}
   });
   assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash);
   if(process.env.QA_OUTPUT)fs.writeFileSync(path.join(process.env.QA_OUTPUT,`original-${n}-parse-receipt.json`),JSON.stringify({hash,format:sh.format,mainCount:sh.rows.length,excluded:sh.excluded.map(r=>({row:r.sourceRow,reason:r.reason})),mapping:sh.mapping,anomalies:sh.rows.filter(r=>r.issues.length).map(r=>({row:r.sourceRow,issues:r.issues}))},null,2));
  }
 }
 await check('cloned-preview-row-not-its-own-duplicate',()=>{const row=parsed.sheets[0].rows[0];assert.equal(api.importDuplicate(structuredClone(row),[row],[]).messages.some(m=>m.includes('疑似')),false);});
 const {runTrackingUiCommand}=await vite.ssrLoadModule('/src/tracking/trackingUiCommands.ts');
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');const data=createInitialData();data.trackingItems=[];data.users=[{...data.users[0],id:'qa-owner',role:'owner',isActive:true}];
 const item={...parsed.sheets[0].rows[0].item,id:'import-close',vesselId:data.vessels[0].id,kind:'engineering',isClosed:true,completionDate:'2026-09-03',closedDate:'2026-09-04'};const context={actorId:'qa-owner',at:'2026-09-24T00:00:00Z',operationId:'qa-import'};
 await check('explicit-import-closure-is-one-delta-not-completion-inference',()=>{
  const next=runTrackingUiCommand(data,{type:'create',items:[item],importClosures:[{id:item.id,date:'2026-09-04',outcome:'cancelled'}]},context);
  assert.equal(next.trackingItems[0].isClosed,true);assert.equal(next.trackingItems[0].closedDate,'2026-09-04');assert.equal(next.trackingItems[0].closureOutcome,'cancelled');assert.equal(next.trackingItems[0].completionDate,'2026-09-03');assert.equal(data.trackingItems.length,0);
  assert.equal(runTrackingUiCommand(data,{type:'create',items:[item]},context).trackingItems[0].isClosed,false);
  assert.throws(()=>runTrackingUiCommand(data,{type:'create',items:[item],importClosures:[{id:'unselected',date:'2026-09-04'}]},context),/import-closure/);
 });
 const excel=fs.existsSync('src/tracking/trackingExcel.ts')?await vite.ssrLoadModule('/src/tracking/trackingExcel.ts'):{};
 await check('genuine-xlsx-export-shared-snapshot',async()=>{
  assert.equal(typeof excel.buildTrackingWorkbook,'function','genuine ExcelJS tracking workbook must exist');
  const {trackingRowSnapshot}=await vite.ssrLoadModule('/src/tracking/trackingFilters.ts');const {trackingColumnsFor}=await vite.ssrLoadModule('/src/tracking/trackingColumns.ts');
  const source={...item,referenceNo:'000001234567890123456789',originalRemarks:'=SUM(1,2)\n原備註',description:'第一行\n第二行',isClosed:false};
  const snapshot={...trackingRowSnapshot([source],trackingColumnsFor('engineering')),vesselId:source.vesselId,vesselName:'中性船 NEUTRAL VESSEL',kind:'engineering',title:'未完成工程單',generatedAt:'2026-09-24T00:00:00Z',summary:'全部符合目前條件 1 項',selection:'all'};
  const output=await excel.buildTrackingWorkbook(snapshot);const read=new ExcelJS.Workbook();await read.xlsx.load(output);
  assert.equal(read.getWorksheet('_tracking_schema').getCell('B1').text,api.TRACKING_XLSX_VERSION);
  const parsedExport=await api.parseTrackingWorkbook(output,'neutral-export.xlsx',source.vesselId);const r=parsedExport.sheets[0].rows[0];assert.equal(r.item.referenceNo,source.referenceNo);assert.equal(r.item.originalRemarks,source.originalRemarks);assert.equal(r.item.applicationDate,source.applicationDate);assert.equal(r.exportedId,source.id);assert.ok(api.importDuplicate(r,[r],[source]).blocked);
  for(const sh of read.worksheets)sh.eachRow(row=>row.eachCell(cell=>assert.notEqual(cell.type,ExcelJS.ValueType.Formula)));
  if(process.env.QA_OUTPUT)fs.writeFileSync(path.join(process.env.QA_OUTPUT,'neutral-full-export.xlsx'),Buffer.from(output));
  for(const kind of ['supply','engineering']){const template=await excel.buildTrackingTemplate(kind,'中性船 NEUTRAL VESSEL',source.vesselId);const p=await api.parseTrackingWorkbook(template,'template.xlsx',source.vesselId);assert.equal(p.sheets[0].rows.length,0);assert.ok(p.sheets[0].mapping.some(m=>m.field==='expectedDate'));if(process.env.QA_OUTPUT)fs.writeFileSync(path.join(process.env.QA_OUTPUT,`template-${kind}.xlsx`),Buffer.from(template));}
 });
 await check('ambiguous-dates-invalid-selection-and-explicit-duplicate-confirmation',()=>{
  for(const value of [20260901,'2026/9/1',new Date('2026-09-01T00:00:00Z')])assert.equal(api.parseTrackingDate(value),'2026-09-01');
  for(const value of ['20260931','20260901/20260903','取消',60])assert.equal(api.parseTrackingDate(value),null);
  const row=structuredClone(parsed.sheets[0].rows[0]);row.acknowledgements=row.issues.map(i=>i.code);row.selected=true;
  assert.equal(api.selectImportBatch([row],[],[]).length,1);
  assert.throws(()=>api.selectImportBatch([{...row,selected:false}],[],[]),/1–100/);
  const duplicate={...structuredClone(row),key:'duplicate',item:{...row.item,id:'another'}};
  assert.throws(()=>api.selectImportBatch([row,duplicate],[],[]),/異常／重複/);
  assert.equal(api.selectImportBatch([row,duplicate],[],[row.key,duplicate.key]).length,2);
  const bad={...duplicate,key:'invalid',item:{...duplicate.item,description:'different',applicationDate:''}};
  assert.throws(()=>api.selectImportBatch([row,bad],[],[]),/整批未提交/);
  const many=Array.from({length:101},(_,i)=>({...structuredClone(row),key:String(i),item:{...row.item,id:String(i),referenceNo:String(i)}}));
  assert.throws(()=>api.selectImportBatch(many,[],[]),/1–100/);
 });
 await check('template-version-and-wrong-vessel-never-silently-reassign',async()=>{
  const buffer=await excel.buildTrackingTemplate('supply','中性船','original-vessel');const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer);
  const sh=wb.worksheets[0],keys=sh.getRow(3).values.slice(1).map(k=>String(k).replace('tracking:',''));
  for(const [key,value] of Object.entries({referenceNo:'00007',description:'中性來源',applicationDate:new Date('2026-09-01T00:00:00Z'),normal:'是',vesselId:'different-vessel'}))sh.getCell(5,keys.indexOf(key)+1).value=value;
  const wrong=await api.parseTrackingWorkbook(await wb.xlsx.writeBuffer(),'wrong-vessel.xlsx','selected-vessel');
  assert.equal(wrong.sheets[0].rows[0].item.vesselId,'selected-vessel');assert.ok(wrong.sheets[0].rows[0].issues.some(i=>i.code==='vessel-confirm'));
  wb.getWorksheet('_tracking_schema').getCell('B1').value='unsupported/2';
  await assert.rejects(()=>wb.xlsx.writeBuffer().then(bytes=>api.parseTrackingWorkbook(bytes,'wrong-version.xlsx','x')),/不支援/);
 });
 console.log(JSON.stringify({gate:'tracking-import-export',status:'PASS',cases,caseCount:cases.length}));
}finally{await vite.close();}

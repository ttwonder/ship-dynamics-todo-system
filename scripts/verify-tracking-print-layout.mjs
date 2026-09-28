import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];const check=(name,run)=>{run();cases.push(name);};
try{
 const {trackingPrintCells,TRACKING_PRINT_GROUPS}=await vite.ssrLoadModule('/src/tracking/trackingPrintLayout.ts');
 const {makeTrackingReport}=await vite.ssrLoadModule('/src/tracking/trackingReport.ts');
 const {trackingColumnsFor}=await vite.ssrLoadModule('/src/tracking/trackingColumns.ts');
 const item={id:'layout-1',vesselId:'layout-v1',kind:'supply',requestType:'drydock-materials',referenceNo:'00000123456789',purchaseNos:'P01、P02',originalItemNo:'0002',description:'說明 <script>literal</script>\n=SUM(1,2)',applicationDate:'2026-09-01',expectedDate:'2026-09-15',actualDeliveryDate:'2026-09-12',completionDate:'',closedDate:'2026-09-14',urgency:'urgent',deliveryStatus:'partially-delivered',isClosed:true,linkState:'active',supplementalNotes:'補充\n完整',progress:'進度末尾',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',createdBy:'QA',updatedBy:'QA',closedBy:'QA',statusLogs:[],events:[]};
 const report=(row,columns)=>makeTrackingReport([row],columns,{vesselId:row.vesselId,vesselName:'測試輪 QA',kind:row.kind,title:'測試清單',generatedAt:item.createdAt,summary:'測試',selection:'all'});
 check('five-fixed-groups-description-wide-notes-widest',()=>{assert.equal(TRACKING_PRINT_GROUPS.length,5);assert.equal(TRACKING_PRINT_GROUPS.reduce((n,g)=>n+g.width,0),100);assert.ok(TRACKING_PRINT_GROUPS[4].width>TRACKING_PRINT_GROUPS[3].width);assert.ok(TRACKING_PRINT_GROUPS.slice(0,3).every(g=>g.width<TRACKING_PRINT_GROUPS[3].width));});
 for(const kind of ['supply','engineering'])check(kind+'-groups-preserve-all-selected-snapshot-values',()=>{
  const row={...item,kind,requestType:kind==='engineering'?'annual-inspection':item.requestType,completionDate:kind==='engineering'?'2026-09-13':'',closureOutcome:'cancelled'};const r=report(row,trackingColumnsFor(kind)),cells=trackingPrintCells(r,r.rows[0]);
  assert.deepEqual(cells[0].map(f=>f.key),['referenceNo','requestType','purchaseNos','originalItemNo']);
  assert.deepEqual(cells[1].map(f=>f.key),['applicationDate','expectedDate',kind==='supply'?'actualDeliveryDate':'completionDate','closedDate']);
  assert.deepEqual(cells[3],[{key:'description',label:'內容摘要/工程內容',value:row.description}]);
  assert.equal(cells[2][0].value,'緊急');assert.ok(cells[2].some(f=>f.key==='isClosed'&&f.value==='已結案'));assert.ok(cells[2].some(f=>f.key==='linkState'&&f.value==='已同步'));
  const fields=cells.flat();assert.equal(new Set(fields.map(f=>f.key)).size,fields.length);assert.equal(fields.length,r.columns.length-1);
  for(const c of r.columns.filter(c=>!['normal','urgent'].includes(c.key)))assert.equal(fields.find(f=>f.key===c.key)?.value,r.rows[0].values[c.key]||'—',c.key);
  assert.deepEqual(cells[4].slice(0,2).map(f=>f.key),['supplementalNotes','progress']);assert.ok(cells[4].some(f=>f.key==='source'));
  if(kind==='engineering'){assert.equal(cells[1].find(f=>f.key==='expectedDate').label,'到期');assert.ok(cells[2].some(f=>f.value==='取消結案'));}
 });
 check('hidden-fields-never-reappear-and-no-live-source-reprojection',()=>{
  const source={...item};const r=report(source,trackingColumnsFor('supply').filter(c=>['progress','normal','referenceNo'].includes(c.key)));source.referenceNo='CHANGED';source.progress='CHANGED';const cells=trackingPrintCells(r,r.rows[0]);
  assert.deepEqual(cells.flat().map(f=>f.key),['referenceNo','normal','progress']);assert.equal(cells[0][0].value,item.referenceNo);assert.equal(cells[2][0].value,'否');assert.equal(cells[4][0].value,item.progress);assert.deepEqual(cells[1],[]);assert.deepEqual(cells[3],[]);
 });
 check('long-fields-are-single-cell-with-no-truncation-or-character-splitting',()=>{
  const value='長內容🛠️\nASCII-KEEP '.repeat(3000)+'FINAL-END';const r=report({...item,description:value,progress:value},trackingColumnsFor('supply'));const cells=trackingPrintCells(r,r.rows[0]);assert.equal(cells[3].length,1);assert.equal(cells[3][0].value,value);assert.equal(cells[4].find(f=>f.key==='progress').value,value);
 });
 console.log(JSON.stringify({status:'PASS',cases},null,2));
}finally{await vite.close();}

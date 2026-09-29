import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
const check=(name,run)=>{run();cases.push(name);};
const row=(id,patch={})=>({id,vesselId:'v1',kind:'supply',requestType:'spares',referenceNo:'REQ-'+id,description:'配件',applicationDate:'2026-09-01',urgency:'normal',purchaseNos:'',supplementalNotes:'',progress:'',expectedDate:'',deliveryStatus:'not-delivered',isClosed:false,createdBy:'qa',updatedBy:'qa',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',statusLogs:[],...patch});
const items=[row('A',{purchaseNos:'AA-101',description:'濾芯配件',urgency:'urgent',supplementalNotes:'需提早供應'}),row('B',{purchaseNos:'BB-202',description:'泵件'}),row('C',{purchaseNos:'CC-303',description:'閥件 A/B；pump, motor'}),row('OTHER-VESSEL',{vesselId:'v2',purchaseNos:'AA-101'}),row('ENGINEERING',{kind:'engineering',requestType:'repair',purchaseNos:'AA-101'}),row('DELIVERED',{deliveryStatus:'delivered',purchaseNos:'AA-101'}),row('DELETED',{purchaseNos:'BB-202',deletion:{at:'2026-09-02T00:00:00Z',byUserId:'qa',reason:'fixture'}})];
const before=structuredClone(items),query={vesselId:'v1',tab:'undelivered',filters:{},sort:{key:'referenceNo',direction:'asc'}};
try{
 const {selectTrackingRows,trackingRowSnapshot}=await vite.ssrLoadModule('/src/tracking/trackingFilters.ts');
 const {selectTrackingExportRows}=await vite.ssrLoadModule('/src/tracking/trackingExportMonths.ts');
 const {trackingColumnsFor}=await vite.ssrLoadModule('/src/tracking/trackingColumns.ts');
 const select=(search,patch={})=>selectTrackingRows(items,{...query,search,...patch}).map(r=>r.id);
 check('ascii-comma-is-OR-not-one-literal-or-AND',()=>assert.deepEqual(select('AA-101,BB-202'),['A','B']));
 check('chinese-comma-is-equivalent',()=>assert.deepEqual(select('AA-101，BB-202'),['A','B']));
 check('mixed-separators-empty-parts-trim-and-case-dedup',()=>assert.deepEqual(select(' ， aa-101, BB-202 ，AA-101,,　'),['A','B']));
 check('same-row-multiple-matches-remains-one-row',()=>assert.deepEqual(select('AA-101,濾芯,REQ-A,aa'),['A']));
 check('cross-field-and-original-hidden-field-search',()=>{assert.deepEqual(select('濾芯,BB-202'),['A','B']);assert.deepEqual(select('需提早供應，BB-202'),['A','B']);});
 check('empty-or-separator-only-keeps-existing-empty-search',()=>{for(const s of [undefined,'','　 ', ',， ,'])assert.deepEqual(select(s),['A','B','C']);});
 check('no-match-is-empty-not-fallback',()=>assert.deepEqual(select('not-found，also-not-found'),[]));
 check('slash-inner-spaces-and-regex-symbols-remain-literal',()=>{assert.deepEqual(select('A/B'),['C']);assert.deepEqual(select('AA-101/BB-202'),[]);assert.deepEqual(select('pump motor'),[]);assert.deepEqual(select('AA.*'),[]);});
 check('vessel-tab-deletion-and-column-AND-scope-preserved',()=>{assert.deepEqual(select('AA-101,BB-202',{filters:{urgent:{values:['是']}}}),['A']);assert.deepEqual(select('AA-101,CC-303',{filters:{description:{text:'pump, motor'}}}),['C']);assert.deepEqual(select('AA-101,BB-202',{vesselId:'v2'}),['OTHER-VESSEL']);assert.deepEqual(select('AA-101,BB-202',{tab:'delivered'}),['DELIVERED']);assert.deepEqual(select('AA-101,BB-202',{view:'deleted'}),['DELETED']);});
 check('existing-sort-not-keyword-order',()=>{assert.deepEqual(select('BB-202,AA-101'),['A','B']);assert.deepEqual(select('AA-101，BB-202',{sort:{key:'referenceNo',direction:'desc'}}),['B','A']);});
 check('export-and-snapshot-use-same-union-with-month-and-selection-scope',()=>{const q={...query,search:'AA-101，BB-202'},range={startMonth:'2026-09',endMonth:'2026-09'};const rows=selectTrackingExportRows(items,q,range);assert.deepEqual(rows.map(r=>r.id),['A','B']);assert.deepEqual(selectTrackingExportRows(items,q,range,['B','C']).map(r=>r.id),['B']);assert.deepEqual(trackingRowSnapshot(rows,trackingColumnsFor('supply')).rows.map(r=>r.id),['A','B']);});
 check('selector-does-not-change-original-records-or-order',()=>assert.deepEqual(items,before));
 console.log(JSON.stringify({gate:'tracking-multi-search',status:'PASS',layer:'real shared selector/export functions with synthetic records; not hosted acceptance',caseCount:cases.length,cases}));
}finally{await vite.close();}

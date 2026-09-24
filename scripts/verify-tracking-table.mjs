import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
try{
 const {selectTrackingRows,trackingRowSnapshot,TRACKING_TABS}=await vite.ssrLoadModule('/src/tracking/trackingFilters.ts');
 const {TRACKING_COLUMNS}=await vite.ssrLoadModule('/src/tracking/trackingColumns.ts');
 const items=Array.from({length:65},(_,i)=>({id:String(i).padStart(3,'0'),kind:'supply',vesselId:'a',referenceNo:'REF-'+String(65-i).padStart(3,'0'),applicationDate:'2026-09-01',description:'test',urgency:i%2?'urgent':'normal',supplier:i===0?'':i%2?'A':'B',progress:'',expectedDate:'',supplementalNotes:'',deliveryStatus:'not-delivered',isClosed:false,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',statusLogs:[]}));
 const q={vesselId:'a',tab:'undelivered',filters:{},sort:{key:'referenceNo',direction:'asc'}};
 let rows=selectTrackingRows(items,q);assert.equal(rows.length,65);assert.equal(rows[0].referenceNo,'REF-001');assert.equal(rows[30].referenceNo,'REF-031');
 for(const direction of ['asc','desc'])assert.equal(selectTrackingRows(items,{...q,sort:{key:'supplier',direction}}).at(-1).id,'000');
 assert.equal(selectTrackingRows(items,{...q,filters:{supplier:{values:['A','B']},urgent:{values:['是']}}}).length,32);
 assert.equal(selectTrackingRows(items,{...q,filters:{supplier:{mode:'blank'}}}).length,1);
 assert.equal(selectTrackingRows(items,{...q,vesselId:'unauthorized'}).length,0);
 const closed={...items[0],id:'closed',isClosed:true};const delivered={...closed,id:'delivered',deliveryStatus:'delivered'};const cancelled={...closed,id:'cancelled',kind:'engineering',closureOutcome:'cancelled'};
 assert.deepEqual(selectTrackingRows([closed,delivered,cancelled],q),[]);
 assert.equal(selectTrackingRows([closed,delivered,cancelled],{...q,tab:'delivered'}).length,1);
 assert.equal(selectTrackingRows([closed,delivered,cancelled],{...q,tab:'engineering-closed'}).length,1);
 const snap=trackingRowSnapshot(rows,TRACKING_COLUMNS);rows[0].description='changed';assert.equal(snap.rows[0].values.description,'test');assert.equal(snap.rows.length,65);
 assert.equal(TRACKING_TABS.length,5);
 const {recordRecoveryReadScope}=await vite.ssrLoadModule('/src/cloudRecordScopes.ts');
 const empty={tasks:[],internalControlCases:[],meetings:[],agendaReports:[],trackingItems:[items[0]]};
 assert.deepEqual(recordRecoveryReadScope(empty,structuredClone(empty)),{targets:[],trackingVesselIds:['a']},'clean reload retains standalone tracking coverage');
 const cases=['global-sort-before-page','nulls-last-both-directions','AND-field-OR-multiselect','blank-filter','vessel-scope','independent-tab-buckets','immutable-full-row-snapshot','five-literal-tabs','clean-standalone-reload-scope']; console.log(JSON.stringify({gate:'tracking-table',caseCount:cases.length,cases,status:'PASS'}));
}finally{await vite.close();}

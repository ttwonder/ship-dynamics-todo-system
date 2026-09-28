import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
try{
 const types=await vite.ssrLoadModule('/src/tracking/trackingRequestTypes.ts');
 const statsApi=await vite.ssrLoadModule('/src/tracking/trackingStatistics.ts');
 const {validateTrackingItem}=await vite.ssrLoadModule('/src/tracking/trackingWorkflow.ts');
 const {selectTrackingRows}=await vite.ssrLoadModule('/src/tracking/trackingFilters.ts');
 const expected=[['annual-inspection','年檢工程','engineering'],['drydock-spares','塢修備件','supply'],['drydock-materials','塢修物料','supply']];
 const row=(id,patch={})=>({id,vesselId:'v1',referenceNo:'SAME',kind:'engineering',requestType:'annual-inspection',description:id,applicationDate:'2026-09-01',expectedDate:'2026-09-25',deliveryStatus:'not-delivered',isClosed:false,urgency:'normal',progress:'',supplementalNotes:'',createdBy:'qa',updatedBy:'qa',createdAt:'',updatedAt:'',statusLogs:[],...patch});
 for(const [value,label,kind] of expected){
  assert.equal(types.parseTrackingRequestType(label),value);assert.equal(types.trackingRequestTypeLabel(value),label);assert.equal(types.trackingRequestKind(value),kind);
  const item=row(value,{kind,requestType:value});assert.doesNotThrow(()=>validateTrackingItem(item));
  assert.throws(()=>validateTrackingItem({...item,kind:kind==='supply'?'engineering':'supply'}),/tracking-request-type-kind/);
  const selected=selectTrackingRows([item],{vesselId:'v1',tab:kind==='supply'?'supply-all':'engineering-open',filters:{requestType:{values:[label]}},search:label,sort:{key:'createdAt',direction:'desc'}});
  assert.deepEqual(selected.map(r=>r.id),[value],'displayed type participates in real list filtering and search');
 }
 cases.push('three-types-kind-validation-list-filter-and-search');
 const annual=[row('due-today'),row('overdue-open',{expectedDate:'2026-09-24'}),row('on-time',{completionDate:'2026-09-25'}),row('late',{completionDate:'2026-09-26'}),row('cancelled',{isClosed:true,closureOutcome:'cancelled',completionDate:'2026-09-26'}),row('blank',{expectedDate:''}),row('invalid',{expectedDate:'2026-02-30'})];
 const others=[row('repair',{requestType:'repair',expectedDate:'2026-09-01'}),row('dock-spares',{kind:'supply',requestType:'drydock-spares'}),row('dock-materials',{kind:'supply',requestType:'drydock-materials'}),row('foreign',{vesselId:'v2'})];
 const query={vesselId:'v1',from:'',to:'',type:'all',urgency:'all'},today='2026-09-25',items=[...annual,...others];
 const stats=statsApi.calculateTrackingStatistics(items,query,today);
 assert.deepEqual(stats.categories.map(c=>c.value),['semiannual-materials','temporary-materials','drydock-materials','spares','drydock-spares','repair','drydock','annual-inspection','unclassified']);
 const inspection=stats.categories.find(c=>c.value==='annual-inspection').summary;
 assert.equal(inspection.total,annual.length);assert.equal(inspection.cancelled,1);assert.equal(inspection.effective,annual.length-1);
 assert.equal(inspection.completed,2);assert.equal(inspection.overdueIncomplete,1);assert.equal(inspection.overdueCompleted,1);assert.equal(inspection.noDeadline,2);assert.equal(inspection.notYetDue,1);assert.equal(inspection.delayEligible,3);assert.equal(inspection.delayRate,2/3);
 assert.equal(stats.summary.total,annual.length+others.filter(r=>r.vesselId==='v1').length,'the annual section is a subset, never a second contribution');
 for(const [key] of statsApi.STATISTICS_METRICS)assert.equal(stats.categories.reduce((n,c)=>n+c.summary[key],0),stats.summary[key]);
 assert.deepEqual(statsApi.calculateTrackingStatistics(items,{...query,type:'annual-inspection'},today).summary,inspection);
 assert.equal(statsApi.calculateTrackingStatistics(items,{...query,type:'materials'},today).summary.total,1,'drydock materials join the materials aggregate, spare parts do not');
 assert.equal(statsApi.calculateTrackingStatistics(items,{...query,type:'engineering'},today).summary.total,annual.length+1,'annual inspection remains engineering');
 cases.push('annual-expiry-independent-category-original-date-rules-and-aggregate-partitions');
 const {trackingStatisticsCharts}=await vite.ssrLoadModule('/src/tracking/TrackingStatisticsCharts.tsx');
 const charts=trackingStatisticsCharts(stats),expiry=charts.find(c=>c.title==='年檢到期狀態');
 assert.ok(expiry,'annual expiry has its own chart, not only a generic category color');assert.equal(expiry.total,inspection.effective);
 assert.equal(expiry.rows.find(r=>r.label==='逾期未完成').value,1);assert.equal(expiry.rows.find(r=>r.label==='未填／無效到期日').value,2);
 for(const chart of charts){assert.equal(chart.rows.reduce((n,r)=>n+r.value,0),chart.total);assert.ok(chart.rows.every(r=>/^#[0-9a-f]{6}$/i.test(r.color)));}
 cases.push('separate-annual-expiry-chart-reconciles-with-own-denominator');
 console.log(JSON.stringify({gate:'tracking-annual-types',status:'PASS',cases}));
}finally{await vite.close();}

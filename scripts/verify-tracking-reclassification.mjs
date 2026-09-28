import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
try {
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {runTrackingCommand,prefillTrackingCase}=await vite.ssrLoadModule('/src/tracking/trackingWorkflow.ts');
 const {trackingInTab}=await vite.ssrLoadModule('/src/tracking/trackingFilters.ts');
 let data=createInitialData(); data.tasks=[];data.internalControlCases=[];data.trackingItems=[];
 const actor=data.users.find(u=>u.role==='owner')||data.users[0];actor.role='owner';actor.isActive=true;
 const vessel=data.vessels.find(v=>v.isActive);assert.ok(vessel);
 const context=n=>({actorId:actor.id,at:`2026-09-28T08:00:${String(n).padStart(2,'0')}.000Z`,operationId:'reclassify-domain-'+n});
 const source={id:'reclass-source',kind:'engineering',requestType:'drydock',vesselId:vessel.id,referenceNo:'SAME-NUMBER',description:'錯放工程的物料',applicationDate:'2026-09-01',urgency:'normal',expectedDate:'2026-10-01',progress:'已詢價',supplementalNotes:'保留人工來源備註',deliveryStatus:'not-delivered',completionDate:'2026-09-20',isClosed:false,createdBy:'',updatedBy:'',createdAt:'',updatedAt:'',statusLogs:[]};
 data=runTrackingCommand(data,{type:'create',items:[source,{...source,id:'unselected-sibling'}]},context(1));
 const initial=data.trackingItems[0],prefill=prefillTrackingCase(data,initial,'reclass-case').item;
 prefill.syncToTask=true;prefill.description+='\n人工補寫：請不要覆蓋。';
 prefill.expectedDate='2026-11-01';prefill.departments=[data.settings.departments[0]];
 data=runTrackingCommand(data,{type:'sync',items:[{id:initial.id,expectedUpdatedAt:initial.updatedAt,item:prefill,projection:{categories:['其他'],expectedDate:prefill.expectedDate,ownerUserIds:[],isAbnormal:false}}]},context(2));
 const before=structuredClone(data),old=data.trackingItems[0];
 const command={type:'reclassify',items:[{id:old.id,expectedUpdatedAt:old.updatedAt,requestType:'drydock-materials',actualDate:'',deliveryStatus:'not-delivered'}]};
 let next;
 assert.doesNotThrow(()=>{next=runTrackingCommand(data,command,context(3));},'dedicated classification correction must support engineering -> supply with exact existing links');
 const saved=next.trackingItems[0];
 assert.equal(saved.kind,'supply');assert.equal(saved.requestType,'drydock-materials');
 assert.equal(saved.id,old.id);assert.equal(saved.linkedCaseId,old.linkedCaseId);
 assert.equal(saved.completionDate,'2026-09-20','inactive engineering fact stays stored, never silently copied or erased');
 assert.equal(saved.actualDeliveryDate,'');assert.equal(saved.deliveryStatus,'not-delivered');
 assert.equal(saved.expectedDate,old.expectedDate);assert.deepEqual(saved.statusLogs,old.statusLogs);
 assert.equal(saved.events.at(-1).action,'reclassify');assert.deepEqual(saved.events.slice(0,-1),old.events);
 for(const collection of ['internalControlCases','tasks']){
  assert.equal(next[collection].length,before[collection].length);
  const linked=next[collection][0],prior=before[collection][0];
  assert.match(linked.description,/類型：塢修物料/);assert.match(linked.description,/人工補寫：請不要覆蓋。/);
  assert.match(linked.description,/原工程完工日期（分類修正前）：2026-09-20/,'generated actual-date text must not falsely imply supply delivery after correction');
  assert.doesNotMatch(linked.description,/實際送達\/完工日期：2026-09-20/);
  assert.equal(linked.id,prior.id);assert.equal(linked.category,prior.category);assert.equal(linked.expectedDate,prior.expectedDate);
  assert.deepEqual(linked.departments,prior.departments);assert.deepEqual(linked.statusLogs,prior.statusLogs);
  assert.deepEqual(linked.trackingLifecycle.at(-1),saved.events.at(-1));
 }
 assert.deepEqual(next.trackingItems[1],before.trackingItems[1],'same-number unselected sibling is untouched');
 assert.deepEqual(data,before,'planner never mutates original');
 assert.equal(trackingInTab(saved,'undelivered'),true);assert.equal(trackingInTab(saved,'engineering-closed'),false);
 cases.push('engineering-to-supply-atomic-triple-in-place-preserves-history-and-inactive-date');
 const normal=runTrackingCommand(next,{type:'edit',items:[{id:saved.id,expectedUpdatedAt:saved.updatedAt,changes:{requestType:'spares',progress:'分類核對完成',actualDeliveryDate:'2026-09-28'}}]},context(4));
 assert.equal(normal.trackingItems[0].kind,'supply');
 for(const collection of ['internalControlCases','tasks']){
  assert.match(normal[collection][0].description,/類型：備件/,'same-kind edit also converges source type label');
  assert.equal(normal[collection][0].status,'分類核對完成');
  assert.equal(normal[collection][0].expectedDate,next[collection][0].expectedDate);
  assert.equal(normal[collection][0].trackingLifecycle.at(-1).action,'reclassify');
 }
 assert.equal(normal.trackingItems[0].events.at(-1).action,'reclassify');
 assert.equal(normal.trackingItems[0].events.at(-2).action,'delivery');
 assert.throws(()=>runTrackingCommand(normal,{type:'edit',items:[{id:saved.id,expectedUpdatedAt:normal.trackingItems[0].updatedAt,changes:{requestType:'repair'}}]},context(5)),/tracking-request-type-kind/,'ordinary edit still rejects crossing kind');
 cases.push('normal-edit-same-kind-classification-plus-progress-converges-only-owned-fields');
 const {assertActorAuthorizedForAppDataChange}=await vite.ssrLoadModule('/src/cloudAuthorization.ts');
 const operatorBase=structuredClone(next),operator={...actor,id:'reclass-editor',role:'operator',managedVesselIds:[vessel.id]};
 operatorBase.users.push(operator);operatorBase.settings.rolePermissions.operator.editBusinessContent=true;operatorBase.settings.rolePermissions.operator.closeTasks=false;
 const operatorNext=runTrackingCommand(operatorBase,{type:'edit',items:[{id:saved.id,expectedUpdatedAt:saved.updatedAt,changes:{requestType:'spares',progress:'一般編輯權核對'}}]},{...context(5),actorId:operator.id});
 assert.doesNotThrow(()=>assertActorAuthorizedForAppDataChange(operatorBase,operatorNext,operator.id),'source classification plus progress must not require unrelated closure authority');
 cases.push('classification-and-source-progress-use-edit-authority-not-close-authority');
 const reject=(items,pattern,base=next)=>{const unchanged=structuredClone(base);assert.throws(()=>runTrackingCommand(base,{type:'reclassify',items},context(6)),pattern);assert.deepEqual(base,unchanged,'rejected batch leaves input and every linked endpoint untouched');};
 const valid={...command.items[0],expectedUpdatedAt:saved.updatedAt};
 reject([],/selection/);reject([valid,valid],/selection/);
 reject(Array.from({length:101},(_,index)=>({...valid,id:`over-limit-${index}`})),/selection/);
 reject([valid,{...valid,id:'unselected-sibling',expectedUpdatedAt:'stale'}],/stale/);
 reject([{...valid,requestType:'arbitrary'}],/reclassification/);
 reject([{...valid,actualDate:'2026-02-30',deliveryStatus:'delivered'}],/invalid-date/);
 reject([{...valid,actualDate:'',deliveryStatus:'delivered'}],/delivery-date/);
 reject([{...valid,actualDate:'2026-09-28',deliveryStatus:'partially-delivered'}],/delivery-date/);
 reject([{...valid,kind:'engineering'}],/reclassification/);
 reject([{...valid,requestType:'repair',deliveryStatus:'delivered'}],/inactive-fact/);
 for(const collection of ['trackingItems','internalControlCases','tasks']){const closed=structuredClone(next);closed[collection][0].isClosed=true;reject([valid],/closed/,closed);}
 const broken=structuredClone(next);broken.internalControlCases[0].trackingItemId='wrong-source';reject([valid],/inconsistent/,broken);
 const blocked=structuredClone(operatorBase);blocked.settings.rolePermissions.operator.editBusinessContent=false;
 assert.throws(()=>runTrackingCommand(blocked,{type:'reclassify',items:[valid]},{...context(6),actorId:operator.id}),/permission/);
 for(const mutate of [d=>{d.tasks[0].status='forged';},d=>{d.tasks[0].isClosed=true;},d=>{d.internalControlCases[0].trackingLifecycle=[];},d=>{d.trackingItems[0].events.at(-1).byUserId='wrong-actor';}]){
  const forged=structuredClone(operatorNext);mutate(forged);assert.throws(()=>assertActorAuthorizedForAppDataChange(operatorBase,forged,operator.id),/closeTasks/);
 }
 cases.push('atomic-negative-selection-stale-closed-bad-date-bad-kind-bad-link-and-permission');
 const {TRACKING_REQUEST_TYPES}=await vite.ssrLoadModule('/src/tracking/trackingRequestTypes.ts');
 for(const target of TRACKING_REQUEST_TYPES){
  const targetData=runTrackingCommand(next,{type:'reclassify',items:next.trackingItems.map(row=>({id:row.id,expectedUpdatedAt:row.updatedAt,requestType:target.value,actualDate:'',deliveryStatus:row.deliveryStatus}))},context(7));
  assert.equal(targetData.trackingItems.length,2);
  for(const row of targetData.trackingItems){assert.equal(row.kind,target.kind);assert.equal(row.requestType,target.value);assert.equal(row.expectedDate,'2026-10-01');assert.equal(row.isClosed,false);}
 }
 cases.push('all-eight-target-types-and-mixed-origin-batch-retain-identities');
 const {reclassifyTrackingDescription}=await vite.ssrLoadModule('/src/tracking/trackingReclassification.ts');
 assert.equal(reclassifyTrackingDescription('<p>類型：塢修工程</p><p>實際送達/完工日期：2026-09-20</p><p>人工補充</p>',old,saved),'<p>類型：塢修物料</p><p>原工程完工日期（分類修正前）：2026-09-20</p><p>人工補充</p>');
 assert.equal(reclassifyTrackingDescription('人工類型：塢修工程細節',old,saved),'人工類型：塢修工程細節\n類型：塢修物料');
 assert.equal(reclassifyTrackingDescription('<p>人工內容</p>',old,saved),'<p>人工內容</p><p>類型：塢修物料</p>');
 assert.equal(reclassifyTrackingDescription('類型：塢修工程\r\n人工內容',old,saved),'類型：塢修物料\r\n人工內容');
 assert.equal(reclassifyTrackingDescription('類型：塢修工程\n實際送達/完工日期：2026-09-20',old,{...saved,actualDeliveryDate:'2026-09-28'}),'類型：塢修物料\n實際送達/完工日期：2026-09-28');
 assert.equal(reclassifyTrackingDescription('原內文',saved,saved),'原內文');
 cases.push('plain-html-crlf-generated-label-and-date-convergence-with-manual-text-preserved');
 const {calculateTrackingStatistics}=await vite.ssrLoadModule('/src/tracking/trackingStatistics.ts');
 const {trackingStatisticsCharts}=await vite.ssrLoadModule('/src/tracking/TrackingStatisticsCharts.tsx');
 const query={vesselId:vessel.id,from:'',to:'',type:'all',urgency:'all'};
 const stats=calculateTrackingStatistics(next.trackingItems,query,'2026-09-28');
 assert.equal(stats.summary.total,2);assert.equal(stats.categories.find(x=>x.value==='drydock').summary.total,1);assert.equal(stats.categories.find(x=>x.value==='drydock-materials').summary.total,1);
 const annual=runTrackingCommand(normal,{type:'reclassify',items:[{id:saved.id,expectedUpdatedAt:normal.trackingItems[0].updatedAt,requestType:'annual-inspection',actualDate:'',deliveryStatus:'delivered'}]},context(8));
 assert.equal(annual.trackingItems[0].actualDeliveryDate,'2026-09-28');assert.equal(annual.trackingItems[0].completionDate,'');
 const annualStats=calculateTrackingStatistics(annual.trackingItems,query,'2026-10-02');
 assert.equal(annualStats.summary.total,2);assert.equal(annualStats.categories.find(x=>x.value==='annual-inspection').summary.overdueIncomplete,1);
 assert.equal(trackingStatisticsCharts(annualStats).find(x=>x.title==='年檢到期狀態').rows.find(x=>x.label==='逾期未完成').value,1);
 cases.push('classification-statistics-and-annual-chart-converge-without-double-counting');
 const {trackingColumnsFor}=await vite.ssrLoadModule('/src/tracking/trackingColumns.ts');
 const {trackingRowSnapshot}=await vite.ssrLoadModule('/src/tracking/trackingFilters.ts');
 const {buildTrackingWorkbook}=await vite.ssrLoadModule('/src/tracking/trackingExcel.ts');
 const {parseTrackingWorkbook}=await vite.ssrLoadModule('/src/tracking/trackingImport.ts');
 for(const row of [saved,annual.trackingItems[0]]){
  const report={...trackingRowSnapshot([row],trackingColumnsFor(row.kind)),vesselId:row.vesselId,vesselName:'測試輪 QA',kind:row.kind,title:'修正分類',generatedAt:context(9).at,summary:'真實匯出＋測試資料',selection:'selected'};
  assert.equal(report.rows[0].values.requestType,TRACKING_REQUEST_TYPES.find(x=>x.value===row.requestType).label);
  const result=await parseTrackingWorkbook(await buildTrackingWorkbook(report),'reclassified.xlsx',row.vesselId);
  assert.equal(result.sheets[0].rows[0].item.requestType,row.requestType);assert.equal(result.sheets[0].rows[0].item.kind,row.kind);
 }
 cases.push('corrected-type-in-real-exported-workbook-and-shared-report-snapshot');
 console.log(JSON.stringify({gate:'tracking-reclassification-domain',label:'真實domain＋測試資料，非正式環境',status:'PASS',caseCount:cases.length,cases}));
} finally {await vite.close();}

import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const vite = await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
try {
  const {createInitialData} = await vite.ssrLoadModule('/src/data/seed.ts');
  const {CaseEditModal} = await vite.ssrLoadModule('/src/InternalControlModals.tsx');
  const data = createInitialData(), vessel = {...data.vessels[0],name:'',fullName:'FPMC 36'};
  const source = {id:'qa-source-uuid',vesselId:vessel.id,kind:'supply',requestType:'spares',referenceNo:'F36202601013',description:'主機啟動閥',originalItemNo:'07',applicationDate:'2026-01-13',deliveryStatus:'partially-delivered',actualDeliveryDate:'2026-02-11',expectedDate:'2026-03-03',isClosed:false,linkState:'active',linkedCaseId:'qa-case-uuid'};
  const item = {id:source.linkedCaseId,vesselId:vessel.id,trackingItemId:source.id,reportDate:'2026-01-14',reportSource:'日常',priority:'低',category:'其他',description:'查核啟動閥',status:'查核中',expectedDate:'2026-03-05',departments:['督導'],statusLogs:[],isClosed:false,syncToTask:false};
  Object.assign(data,{vessels:[vessel],trackingItems:[source,{...source,id:'other-source',description:'同號的其他項目',linkState:undefined,linkedCaseId:undefined}],internalControlCases:[item],tasks:[]});
  const modal = () => renderToStaticMarkup(createElement(CaseEditModal,{item,data,vessels:data.vessels,canEdit:true,canClose:true}));
  const hint = () => modal().match(/<details class="tracking-linked-hint"[^>]*>([\s\S]*?)<\/details>/)?.[1] || '';
  const text = hint();
  for(const fact of ['FPMC 36','F36202601013','主機啟動閥','07','查核啟動閥','2026-01-14','未連結要事','部分送船','2026-02-11','2026-03-03']) assert.ok(text.includes(fact),`case editor should identify the exact affected records and retained facts: ${fact}\n${text}`);
  assert.doesNotMatch(text,/qa-(source|case)-uuid|同號的其他項目|完工日期|日期更正/);
  const {trackingLifecycleExplanation:explain} = await vite.ssrLoadModule('/src/tracking/TrackingLifecycleHint.tsx');
  const preview = (action,date) => explain(data,item.id,{action,date});
  assert.match(preview('close','2026-04-12'), /結案日期[^\n]*2026-04-12/);
  const pendingTask = explain(data,item.id,{action:'close',date:'2026-04-12',createTask:true});
  assert.match(pendingTask,/尚未連結要事.*將建立要事/);
  assert.match(pendingTask,/新要事.*結案/);
  Object.assign(source,{kind:'engineering',requestType:'repair',completionDate:'2026-03-20',isClosed:true,closedDate:'2026-04-12'});
  Object.assign(item,{isClosed:true,closedDate:source.closedDate,syncToTask:true,linkedTaskId:'qa-task-uuid'});
  const task = {id:item.linkedTaskId,description:'<p>安排試車</p>',vesselId:vessel.id,internalControlCaseId:item.id,isInternalControl:true,isClosed:true,closedDate:source.closedDate,ownerUserIds:[]};
  data.tasks=[task];
  assert.match(hint(),/重開後[^<]*未結案[^<]*2026-04-12[^<]*保留歷程/);
  const correction = preview('correct-close-date','2026-04-19');
  for(const fact of ['維修工程','安排試車','維持已結案','2026-04-12 → 2026-04-19','完工日期：2026-03-20','2026-03-03']) assert.ok(correction.includes(fact),fact);
  assert.doesNotMatch(correction,/送船狀態|2026-02-11|qa-task-uuid|重開後/);
  const uncertain = text => {assert.match(text,/無法確認同步範圍/);assert.doesNotMatch(text,/同步結案|未連結要事|安排試車|qa-task-uuid/);};
  uncertain(explain(data,item.id,{taskId:'someone-elses-task'}));
  for(const change of [d=>d.tasks=[], d=>d.tasks.push({...task,id:'duplicate'}), d=>d.internalControlCases.push({...item,id:'second-case'}), d=>d.trackingItems.push({...source,id:'second-active-source'}), d=>d.trackingItems=[], d=>d.tasks[0].vesselId='another-vessel', d=>d.trackingItems[0].isClosed=false]) {
    const inconsistent = structuredClone(data);change(inconsistent);uncertain(explain(inconsistent,item.id));
  }
  item.trackingLinkState=source.linkState='invalid';
  assert.match(hint(),/關聯已失效/);assert.doesNotMatch(hint(),/同步結案|同步日期|主機啟動閥/);
  data.trackingItems=[];delete item.trackingItemId;delete item.trackingLinkState;
  assert.equal(hint(),'','ordinary cases do not acquire a tracking warning');
  console.log('PASS linked lifecycle impact UI');
} finally {await vite.close();}

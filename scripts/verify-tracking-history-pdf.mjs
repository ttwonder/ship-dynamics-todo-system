import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
try{
 const {TrackingHistoryModal}=await vite.ssrLoadModule('/src/tracking/TrackingHistoryModal.tsx');
 const {newTrackingItem}=await vite.ssrLoadModule('/src/tracking/TrackingModals.tsx');
 const row={...newTrackingItem('private-vessel-id','supply'),id:'private-row-id',referenceNo:'REQ-SAME',description:'完整項目 <核對> & 內容',progress:'目前進度',supplementalNotes:'補充說明',createdBy:'private-person-id',updatedBy:'private-person-id',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-29T00:00:00Z',statusLogs:[{id:'private-log-id',at:'2026-09-29T00:00:00Z',by:'測試操作員',text:'已保存的進度 A\n第二行'}],events:[{id:'private-event-id',operationId:'private-operation-id',byUserId:'private-person-id',at:'2026-09-28T00:00:00Z',entry:'tracking',action:'link',before:{caseId:null},after:{caseId:'private-case-id',linkState:'active'}}]};
 const props={rows:[row],users:[],audience:'shore',vesselName:'測試輪 QA SHIP',onClose:()=>{},canExport:true,exportBlocked:false};
 for(const audience of ['shore','ship']){
  const html=renderToStaticMarkup(React.createElement(TrackingHistoryModal,{...props,audience}));
  assert.match(html,/<button[^>]*>導出 PDF<\/button>/,'history dialog has its own export action');
  assert.ok(html.includes('另存為 PDF'));cases.push(audience+'-dialog-export-action-and-save-as-instruction');
  const denied=renderToStaticMarkup(React.createElement(TrackingHistoryModal,{...props,audience,canExport:false}));assert.ok(!denied.includes('>導出 PDF<'));cases.push(audience+'-existing-export-permission');
  const blocked=renderToStaticMarkup(React.createElement(TrackingHistoryModal,{...props,audience,exportBlocked:true}));assert.match(blocked,/<button[^>]*disabled=""[^>]*>導出 PDF<\/button>/);cases.push(audience+'-busy-draft-pending-guard');
 }
 const {makeTrackingHistoryReport,TrackingHistoryReportDocument,trackingHistoryReportFileName}=await vite.ssrLoadModule('/src/tracking/TrackingHistoryReport.tsx');
 const second={...structuredClone(row),id:'private-second-id',description:'同單不同項目 B',statusLogs:[],events:[]};
 const deleted={...row,id:'private-deleted-id',description:'DELETED-MUST-NOT-PRINT',deletion:{at:'2026-09-29T00:00:00Z',byUserId:'private-person-id',reason:'移除'}};
 const before=JSON.stringify([row,second,deleted]);
 const report=makeTrackingHistoryReport({rows:[row,second,deleted],users:[],audience:'ship',vesselName:props.vesselName,generatedAt:'2026-09-29T01:00:00Z'});
 assert.equal(report.items.length,2);assert.equal(report.excludedDeleted,1);assert.equal(JSON.stringify([row,second,deleted]),before);cases.push('same-reference-distinct-items-in-order-deleted-excluded-no-mutation');
 row.progress='UNSAVED-LATER-MUTATION';row.statusLogs[0].text='NOT-IN-CAPTURE';
 const html=renderToStaticMarkup(React.createElement(TrackingHistoryReportDocument,{report}));
 const text=html.replace(/<[^>]*>/g,'');
 assert.ok(text.includes('已保存的進度 A')&&!text.includes('NOT-IN-CAPTURE')&&!text.includes('UNSAVED-LATER-MUTATION'));cases.push('immutable-click-time-saved-read-snapshot');
 assert.ok(html.includes('&lt;核對&gt; &amp;')&&!html.includes('<核對>'));assert.ok(!text.includes('private-'));assert.ok(!text.includes('DELETED-MUST-NOT-PRINT'));assert.ok(!text.includes('要事'));cases.push('escaped-content-no-internal-identifiers-no-ship-office-leak');
 assert.ok(text.indexOf('完整項目')<text.indexOf('項目資料'));assert.ok(text.indexOf('項目資料')<text.indexOf('歷史更新紀錄'));assert.ok(text.indexOf('已保存的進度 A')<text.indexOf('其他操作紀錄'));assert.ok(text.indexOf('其他操作紀錄')<text.indexOf('同單不同項目 B'));assert.ok(text.includes('同步到內控')&&text.includes('已同步'));assert.ok(text.includes('尚無已保存的狀態更新紀錄'));cases.push('per-item-info-before-status-history-before-other-history-including-empty');
 assert.ok(trackingHistoryReportFileName(report).includes('歷史記錄'));assert.ok(!trackingHistoryReportFileName(report).includes('所選狀態更新紀錄'));assert.ok(html.includes('測試輪 QA SHIP｜歷史記錄'));assert.ok(!/[\\/:*?"<>|]/.test(trackingHistoryReportFileName(report)));cases.push('safe-readable-file-title');
 console.log(JSON.stringify({gate:'tracking-history-pdf',status:'PASS',label:'Rendered real components + synthetic data; not browser/hosted acceptance',cases,count:cases.length}));
}finally{await vite.close();}

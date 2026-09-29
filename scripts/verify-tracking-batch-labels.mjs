import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
try{
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {TrackingBusinessModal,makeTrackingDraft,trackingAffectedLabels}=await vite.ssrLoadModule('/src/tracking/TrackingModals.tsx');
 const {TrackingHistoryModal}=await vite.ssrLoadModule('/src/tracking/TrackingHistoryModal.tsx');
 const {BatchCreateModal}=await vite.ssrLoadModule('/src/InternalControlModals.tsx');
 const Page=(await vite.ssrLoadModule('/src/tracking/TrackingPage.tsx')).default;
 const data=createInitialData(),vessel=data.vessels.find(v=>v.isActive),user=data.users.find(u=>u.role==='owner')||data.users[0];
 const rows=['濾芯 2 個 <核對>','墊片 3 個 & 螺帽'].map((description,i)=>({id:'tracking_internal_'+i,kind:'supply',requestType:'spares',vesselId:vessel.id,referenceNo:'SAME-REQ',originalItemNo:String(i+1),description,applicationDate:'2026-09-01',urgency:'normal',expectedDate:'',progress:'目前進度'+i,supplementalNotes:'',deliveryStatus:'not-delivered',isClosed:false,createdBy:user.id,updatedBy:user.id,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-29T00:00:00Z',statusLogs:[{id:'log_internal_'+i,at:'2026-09-29T00:00:00Z',by:'測試操作員',text:'已保存狀態'+i}],events:[{id:'event_internal_'+i,action:'reclassify',byUserId:user.id,at:'2026-09-28T00:00:00Z',entry:'tracking',before:{requestType:'materials'},after:{requestType:'spares'}}]}));
 data.trackingItems=rows;data.internalControlCases=[];data.tasks=[];
 const no=()=>{},visible=html=>html.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
 const verify=(html,context)=>{const text=visible(html);for(const row of rows){assert.ok(text.includes(row.referenceNo)&&text.includes(row.description),context+': application + full description');assert.ok(!text.includes(row.id),context+': no visible internal ID');}return text;};
 for(const audience of ['shore','ship']){
  for(const action of ['edit','reclassify','progress','delivery','completion','close','reopen','correct-close-date','delete','restore','request-delete','reject-delete']){
   const draft=makeTrackingDraft(action,rows,data);
   const text=verify(renderToStaticMarkup(React.createElement(TrackingBusinessModal,{draft,audience,busy:false,pending:false,message:'',affected:trackingAffectedLabels(data,rows),vesselName:'測試船',onChange:no,onSave:no,onReconcile:no,onClose:no})),audience+':'+action);
   if(action==='edit')assert.ok(text.includes('批量修正')&&!text.includes('批量更新跟蹤'));
   if(audience==='ship')assert.ok(!text.includes('要事'));
   cases.push(audience+'-'+action+'-rendered-business-identities');
  }
  const sync=makeTrackingDraft('sync',rows,data);
  const form=renderToStaticMarkup(React.createElement(BatchCreateModal,{data,user,vessels:[vessel],close:no,save:no,sourceForm:{draft:sync.sync,onDraftChange:no,busy:false,pending:false,message:''},...(audience==='ship'?{shipSubmission:{draft:sync.sync,onDraftChange:no,busy:false,pending:false,message:'',catalog:{taskCategories:data.settings.taskCategories,priorities:data.settings.priorities,equipmentFailureSubcategories:data.settings.equipmentFailureSubcategories,departments:data.settings.departments}}}:{})}));
  verify(form,audience+':sync');cases.push(audience+'-sync-original-form-business-identities');
  const history=renderToStaticMarkup(React.createElement(TrackingHistoryModal,{rows,users:data.users,audience,vesselName:'測試船',onClose:no}));verify(history,audience+':history');assert.ok(history.includes('所選狀態更新紀錄'));assert.equal((history.match(/<details class="tracking-history-item"[^>]* open=""/g)||[]).length,2);assert.ok(history.indexOf('已保存狀態0')<history.indexOf('其他操作紀錄'));assert.ok(history.includes('修正分類'));cases.push(audience+'-history-prioritizes-saved-status-retains-secondary-events');
  const page=renderToStaticMarkup(React.createElement(Page,{data,vessels:[vessel],user,workspace:'qa',identity:'qa',audience,canCreate:true,canEdit:true,canClose:true,callbacks:{load:async()=>data,claim:async()=>data,isWritable:()=>true,submit:async()=>true,release:async()=>true,openCase:no,registerNavigationGuard:no}}));
  if(audience==='ship'){assert.ok(visible(page).includes('批量修正'));assert.ok(visible(page).includes('查看所選狀態更新紀錄'));}cases.push(audience+'-page-labels-and-original-default-tab');
 }
 console.log(JSON.stringify({gate:'tracking-batch-labels',status:'PASS',label:'Rendered production components + synthetic data; not browser/production acceptance',caseCount:cases.length,cases}));
}finally{await vite.close();}

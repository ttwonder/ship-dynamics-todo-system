import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
try {
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {default:TrackingPage}=await vite.ssrLoadModule('/src/tracking/TrackingPage.tsx');
 const {TrackingBusinessModal,makeTrackingDraft,newTrackingItem}=await vite.ssrLoadModule('/src/tracking/TrackingModals.tsx');
 const data=createInitialData();data.trackingItems=[];data.tasks=[];data.internalControlCases=[];
 const vessel={...data.vessels[0],id:'v1',name:'測試輪',fullName:'QA SHIP',shortName:'QA',isActive:true};data.vessels=[vessel];
 const callbacks={load:async()=>data,claim:async()=>data,isWritable:()=>true,submit:async()=>false,release:async()=>true,openCase:()=>{},registerNavigationGuard:()=>{}};
 const props={data,vessels:[vessel],user:data.users[0],workspace:'qa',identity:'qa',canCreate:true,canEdit:true,canClose:true,canExport:true,callbacks};
 const ship=renderToStaticMarkup(React.createElement(TrackingPage,{...props,audience:'ship'}));
 assert.ok(!ship.includes('要事'),'ship-side rendered controls/help must omit office-only workflow');
 assert.ok(ship.includes('測試輪 QA SHIP'));assert.ok(ship.includes('導入 Excel'));assert.ok(ship.includes('批量更新進度'));
 const shore=renderToStaticMarkup(React.createElement(TrackingPage,props));assert.ok(shore.includes('要事'),'shore explanations remain unchanged');
 for(const action of ['create','edit','progress','delivery','close','reopen','correct-close-date']) {
  const draft=makeTrackingDraft(action,[{...newTrackingItem('v1','supply'),referenceNo:'QA-001'}],data);
  const html=renderToStaticMarkup(React.createElement(TrackingBusinessModal,{draft,audience:'ship',busy:false,pending:false,message:'',affected:['QA-001'],vesselName:'測試輪 QA SHIP',onChange:()=>{},onSave:()=>{},onReconcile:()=>{},onClose:()=>{}}));
  assert.ok(!html.includes('要事'),action+' dialog must omit office-only workflow');
 }
 const {BatchCreateModal}=await vite.ssrLoadModule('/src/InternalControlModals.tsx');
 const sync=makeTrackingDraft('sync',[{...newTrackingItem('v1','supply'),referenceNo:'QA-001'}],data);
 const bound={draft:sync.sync,onDraftChange:()=>{},busy:false,pending:false,message:''};
 const syncHtml=renderToStaticMarkup(React.createElement(BatchCreateModal,{data,user:data.users[0],vessels:[vessel],close:()=>{},save:async()=>false,sourceForm:{...bound,readOnly:true},shipSubmission:{...bound,catalog:{taskCategories:data.settings.taskCategories,priorities:data.settings.priorities,equipmentFailureSubcategories:data.settings.equipmentFailureSubcategories,departments:data.settings.departments}}}));
 assert.ok(!syncHtml.includes('要事'));assert.ok(syncHtml.includes('報告人姓名＋職務'));assert.ok(!syncHtml.includes('提交成功後無法在船端修改'),'tracking synchronization must not claim the unrelated append-only portal contract');assert.match(syncHtml,/<fieldset disabled=""/,'lost lease must freeze ship source form');
 console.log('PASS ship tracking rendered presentation: shared page, bilingual vessel, ship help absence, shore positive control, action dialogs and bound ship sync form');
}finally{await vite.close();delete globalThis.localStorage;}

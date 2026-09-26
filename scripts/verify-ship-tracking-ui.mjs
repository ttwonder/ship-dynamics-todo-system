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
 assert.ok(ship.includes('測試輪 QA SHIP'));assert.ok(ship.includes('導入 Excel'));
 const tabState=html=>[...html.matchAll(/role="tab" aria-selected="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)].map(([,active,body])=>({active:active==='true',label:body.replace(/<[^>]*>/g,'').trim()}));
 const expectedLists=['未送船清單','已送船清單','配件物料總清單','未完成工程單','已完成工程單'];
 const shipTabs=tabState(ship);
 assert.deepEqual(shipTabs.map(t=>t.label.replace(/\s+0$/,'')),[...expectedLists,'統計資訊'],'ship lists first, statistics last');
 assert.deepEqual(shipTabs.map(t=>t.active),[true,false,false,false,false,false],'ship initially selects undelivered');
 assert.ok(ship.includes('批量更新進度'),'ship default list retains batch actions');
 const urgentButtons=[...ship.matchAll(/<button\b[^>]*aria-pressed="false"[^>]*>緊急<\/button>/g)];
 assert.equal(urgentButtons.length,1,'one initially inactive urgent shortcut');
 assert.ok(ship.indexOf('清除條件</button>')<urgentButtons[0].index&&urgentButtons[0].index<ship.indexOf('aria-label="跟蹤選取與批量操作"'),'urgent shortcut follows Clear and precedes selection toolbar');
 const shore=renderToStaticMarkup(React.createElement(TrackingPage,props)),shoreTabs=tabState(shore);
 assert.deepEqual(shoreTabs.map(t=>t.label.replace(/\s+0$/,'')),['統計資訊',...expectedLists],'shore statistics precedes undelivered');
 assert.deepEqual(shoreTabs.map(t=>t.active),[true,false,false,false,false,false],'shore initially selects statistics');
 assert.ok(shore.includes('跟蹤統計資訊'),'shore statistics panel is mounted by default');
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

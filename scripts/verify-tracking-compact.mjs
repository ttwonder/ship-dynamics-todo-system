import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
const store=new Map();
globalThis.localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)};
try {
  const {TRACKING_COLUMNS,trackingColumnsFor}=await vite.ssrLoadModule('/src/tracking/trackingColumns.ts');
  const {defaultTrackingPreferences,readTrackingPreferences,writeTrackingPreferences,trackingPreferenceKey}=await vite.ssrLoadModule('/src/tracking/trackingTablePreferences.ts');
  const expected={referenceNo:120,purchaseNos:120,originalItemNo:64,applicationDate:112,requestType:88,description:300,expectedDate:112,actualDeliveryDate:112,completionDate:112,normal:52,urgent:52,supplementalNotes:160,progress:170,deliveryStatus:88,isClosed:80,closedDate:112,linkState:96};
  for(const [key,width] of Object.entries(expected))assert.equal(TRACKING_COLUMNS.find(c=>c.key===key)?.width,width,`approved default: ${key}`);
  cases.push('exact-approved-default-widths');
  assert.equal(TRACKING_COLUMNS.find(c=>c.key==='completionStatus').width,125);
  assert.equal(TRACKING_COLUMNS.find(c=>c.key==='closureOutcome').width,155);
  const {TrackingTable}=await vite.ssrLoadModule('/src/tracking/TrackingTable.tsx');
  const {newTrackingItem}=await vite.ssrLoadModule('/src/tracking/TrackingModals.tsx');
  const {default:TrackingExports}=await vite.ssrLoadModule('/src/tracking/TrackingExports.tsx');
  for(const kind of ['supply','engineering']){
    const columns=trackingColumnsFor(kind),prefs=defaultTrackingPreferences(columns);
    for(const blocked of [false,true]){
      const markup=renderToStaticMarkup(React.createElement(TrackingExports,{query:{vesselId:'v1',tab:kind==='supply'?'supply-all':'engineering-open',filters:{},sort:{key:'createdAt',direction:'desc'}},preferences:prefs,selected:[],vesselName:'測試輪 QA SHIP',identity:'qa',workspace:'qa',callbacks:{},blocked,count:0}));
      const buttons=[...markup.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)];
      assert.deepEqual(buttons.map(m=>m[2]),['導出excel','導出pdf','配件物料模板','工程模板'],'export entry labels follow the requested wording; templates are unchanged');
      assert.ok(buttons.every(m=>m[1].includes('disabled=""')===blocked),'renamed export entries retain the existing blocked state');
    }
    cases.push(`${kind}-explicit-export-entry-labels-and-blocked-state`);
    assert.deepEqual(prefs.order.slice(0,2),['referenceNo','requestType'],'default type column immediately follows application number');
    assert.deepEqual(prefs.hidden,columns.filter(c=>c.hidden).map(c=>c.key));
    const key=trackingPreferenceKey('workspace','actor',kind);
    const personal={...prefs,widths:{referenceNo:234,normal:52,originalItemNo:64},hidden:[...prefs.hidden,'purchaseNos']};
    writeTrackingPreferences(key,personal);
    assert.deepEqual(readTrackingPreferences(key,columns),personal,'compact widths and existing personal settings survive reload');
    assert.deepEqual(readTrackingPreferences(trackingPreferenceKey('workspace','other',kind),columns),prefs);
    const legacyBase={order:['referenceNo','description',...columns.map(c=>c.key).filter(k=>!['referenceNo','description','requestType'].includes(k))],hidden:[...prefs.hidden,'purchaseNos'],widths:{referenceNo:234,description:410,requestType:126}};
    for(const [name,order] of [['missing',legacyBase.order],['appended',[...legacyBase.order,'requestType']],['old-default',columns.map(c=>c.key)]]){
      store.set(key,JSON.stringify({...legacyBase,order}));
      const repaired=readTrackingPreferences(key,columns);
      assert.deepEqual(repaired.order.slice(0,2),['referenceNo','requestType'],`${name} legacy type placement repaired`);
      assert.deepEqual(repaired.order.filter(k=>k!=='requestType'),order.filter(k=>k!=='requestType'),'other column order retained');
      assert.deepEqual(repaired.hidden,legacyBase.hidden);assert.deepEqual(repaired.widths,legacyBase.widths);
      writeTrackingPreferences(key,repaired);assert.deepEqual(readTrackingPreferences(key,columns),repaired,'repair remains stable after save/reload');
      cases.push(`${kind}-type-order-upgrade-${name}`);
    }
    const customLegacy={...legacyBase,order:['referenceNo','description','requestType',...legacyBase.order.slice(2)]};
    store.set(key,JSON.stringify(customLegacy));
    assert.deepEqual(readTrackingPreferences(key,columns).order,customLegacy.order,'non-default legacy custom type position retained');
    const newCustom={...prefs,order:[...prefs.order.filter(k=>k!=='requestType'),'requestType']};
    writeTrackingPreferences(key,newCustom);assert.deepEqual(readTrackingPreferences(key,columns),newCustom,'user can deliberately move type again after upgrade');
    const row={...newTrackingItem('v1',kind),id:'r1',referenceNo:'QA-001',urgency:'urgent',linkState:'active',linkedCaseId:'case-1'};
    const html=renderToStaticMarkup(React.createElement(TrackingTable,{rows:[row],columns,preferences:prefs,onPreferences:()=>{},sort:{key:'createdAt',direction:'desc'},onSort:()=>{},selected:[],onSelected:()=>{},onOpenCase:()=>{}}));
    assert.ok(!html.includes('tracking-actions'),'operation column removed, not merely hidden');
    assert.ok(html.includes('aria-label="跟蹤清單上方橫向捲動條"')&&html.includes('aria-label="跟蹤清單，可左右捲動"'));
    assert.ok(html.includes('aria-label="查看 QA-001 的內控"')&&html.includes('>已同步</button>'));
    assert.match(html,/aria-label="QA-001 普通"[^>]*readOnly=""/);
    assert.match(html,/aria-label="QA-001 緊急"[^>]*readOnly=""[^>]*checked=""/);
    const empty=renderToStaticMarkup(React.createElement(TrackingTable,{rows:[],columns,preferences:prefs,onPreferences:()=>{},sort:{key:'createdAt',direction:'desc'},onSort:()=>{},selected:[],onSelected:()=>{},onOpenCase:()=>{}}));
    assert.ok(empty.includes(`colSpan="${columns.filter(c=>!c.hidden).length+1}"`));
    cases.push(`${kind}-compact-table-readonly-urgency-linked-entry-preferences`);
  }
  const {default:TrackingPage}=await vite.ssrLoadModule('/src/tracking/TrackingPage.tsx');
  const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
  const data=createInitialData();data.trackingItems=[];
  const callbacks={load:async()=>data,claim:async()=>{throw new Error('read-only view must not claim');},isWritable:()=>false,submit:async()=>{throw new Error('read-only view must not submit');},release:async()=>true,openCase:()=>{},registerNavigationGuard:()=>{}};
  const page=renderToStaticMarkup(React.createElement(TrackingPage,{data,vessels:data.vessels,user:data.users[0],workspace:'readonly',identity:'readonly',canCreate:false,canEdit:false,canClose:false,audience:'ship',callbacks}));
  assert.ok(page.includes('>查看所選紀錄</button>'),'read-only viewers need a separate history action');
  const {TrackingHistoryModal,trackingHistoryEntries}=await vite.ssrLoadModule('/src/tracking/TrackingHistoryModal.tsx');
  const row={...newTrackingItem('v1','supply'),id:'history-1',referenceNo:'SAME-REF',originalItemNo:'01',isClosed:true,statusLogs:[{id:'p1',at:'2026-09-26T01:00:00Z',by:'測試更新者',text:'已收到備件 <script>invalid</script>'}],events:[{id:'e1',action:'reopen',at:'2026-09-27T01:00:00Z',byUserId:'user-a',entry:'task',before:{isClosed:true,closedDate:'2026-09-26'},after:{isClosed:false,closedDate:''}}]};
  const baseline=structuredClone(row);
  assert.deepEqual(trackingHistoryEntries(row).map(e=>e.id),['event:e1:0','progress:p1:0']);
  for(const audience of ['shore','ship']){
    const html=renderToStaticMarkup(React.createElement(TrackingHistoryModal,{rows:[row,{...row,id:'history-2',originalItemNo:'02',statusLogs:[],events:[]}],users:[{id:'user-a',name:'甲'}],audience,vesselName:'測試輪 QA SHIP',onClose:()=>{}}));
    assert.ok(html.includes('history-1')&&html.includes('history-2')&&html.includes('原項次：01')&&html.includes('原項次：02'));
    assert.ok(html.includes('測試更新者')&&html.includes('甲')&&html.includes('重開')&&html.includes('2026-09-26'));
    assert.ok(html.includes('尚無已保存的進度或事件紀錄'));
    assert.ok(!html.includes('<script>')&&html.includes('&lt;script&gt;'));
    assert.ok(!/<(?:input|textarea|select)\b/.test(html)&&!html.includes('確認保存'));
    assert.equal(html.includes('要事'),audience==='shore');
    cases.push(`${audience}-grouped-readonly-history-closed-and-empty-records`);
  }
  assert.deepEqual(row,baseline,'history display must not mutate or fabricate saved records');
  console.log(JSON.stringify({gate:'tracking-compact',status:'PASS',cases}));
} finally {await vite.close();}

import assert from 'node:assert/strict';
import {createServer} from 'vite';

// Real shared components with synthetic data; not a production/cloud claim.
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const store=new Map();
globalThis.localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
const cases=[];
try {
  const React=await import('react');
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
  const {default:TrackingPage}=await vite.ssrLoadModule('/src/tracking/TrackingPage.tsx');
  const data=createInitialData();
  const vessel={...data.vessels[0],id:'qa-field-vessel',name:'測試輪',fullName:'QA SHIP',isActive:true};
  data.vessels=[vessel]; data.trackingItems=[]; data.tasks=[]; data.internalControlCases=[];
  const callbacks={load:async()=>data,claim:async()=>data,isWritable:()=>true,submit:async()=>false,release:async()=>true,openCase:()=>{},registerNavigationGuard:()=>{}};
  const props={data,vessels:[vessel],user:data.users[0],workspace:'qa-field-revision',identity:'qa',canCreate:true,canEdit:true,canClose:true,canExport:true,callbacks};
  for(const audience of ['shore','ship']) {
    const html=renderToStaticMarkup(React.createElement(TrackingPage,{...props,audience}));
    const filterPanel=html.slice(html.indexOf('<details class="tracking-all-filters">'),html.indexOf('<details class="tracking-preferences">'));
    assert.ok(filterPanel,`${audience}: shared field filters render`);
    assert.doesNotMatch(filterPanel,/<textarea\b|<input\b(?![^>]*type="checkbox")/,`${audience}: field filters must contain dropdown criteria only, not text/date input boxes`);
    assert.match(filterPanel,/<select\b/,`${audience}: dropdown criteria retained`);
    assert.match(html,/<input[^>]+aria-label="搜尋跟蹤"/,`${audience}: global text search retained`);
    assert.ok(html.includes('>批量更新</button>'),`${audience}: multi-selected full-field update reachable`);
    cases.push(`${audience}-dropdown-only-field-filters`);
  }
  const {trackingColumnsFor}=await vite.ssrLoadModule('/src/tracking/trackingColumns.ts');
  const {TrackingBusinessModal,newTrackingItem,makeTrackingDraft,commandForTrackingDraft}=await vite.ssrLoadModule('/src/tracking/TrackingModals.tsx');
  const expectedFields=['referenceNo','purchaseNos','originalItemNo','applicationDate','requestType','description','expectedDate','supplementalNotes'];
  const retired=['subitemNo','materialCategory','urgentSubtypes','preparationDate','supplier','estimatedSupplyDatePlace','countersignDate','contractor','constructionPort','originalRemarks'];
  for(const kind of ['supply','engineering']) {
    const columns=trackingColumnsFor(kind);
    assert.equal(columns.find(c=>c.key==='referenceNo')?.label,'申請單號(材料或工程)','application number label propagates from canonical columns');
    for(const key of expectedFields)assert.ok(columns.some(c=>c.key===key),`${kind}: ${key} column present`);
    assert.ok(!columns.some(c=>retired.includes(c.key)),`${kind}: retired fields excluded even from complete export/settings`);
    assert.equal(columns.find(c=>c.key==='description').required,true);
    assert.ok(!columns.find(c=>c.key==='purchaseNos').required);
    const draft=makeTrackingDraft('create',[newTrackingItem(vessel.id,kind)],data);
    const html=renderToStaticMarkup(React.createElement(TrackingBusinessModal,{draft,audience:'ship',busy:false,pending:false,message:'',affected:[],vesselName:'測試輪 QA SHIP',onChange:()=>{},onSave:()=>{},onReconcile:()=>{},onClose:()=>{}}));
    for(const label of ['維修工程','塢修工程','半年物料','臨時物料','備件'])assert.ok(html.includes(`>${label}</option>`),`${kind}: exact five request choices`);
    assert.ok(!html.includes('新增跟蹤類型'),'per-row request type replaces coarse batch kind selector');
    for(const label of ['備貨完成日期','供應商','預計供料日期','實際全部送達日期','安排廠家','原備註'])assert.ok(!html.includes(label),`${kind}: no retired ${label} form`);
    cases.push(`${kind}-canonical-fields-and-create-form`);
  }
  const {TrackingItemFields}=await vite.ssrLoadModule('/src/tracking/TrackingItemFields.tsx');
  const typeChange=(row,creating,value)=>{
    let patch;
    const rendered=TrackingItemFields({row,creating,prefix:'QA ',onChange:value=>{patch=value;}});
    const select=node=>{if(Array.isArray(node))return node.map(select).find(Boolean);if(!React.isValidElement(node))return undefined;return node.props['aria-label']==='QA 類型'?node:select(node.props.children);};
    select(rendered).props.onChange({target:{value}});return patch;
  };
  const partial={...newTrackingItem(vessel.id,'supply'),requestType:undefined,deliveryStatus:'partially-delivered',actualDeliveryDate:'',completionDate:undefined};
  for(const creating of [true,false])for(const value of ['semiannual-materials','spares'])assert.deepEqual({...partial,...typeChange(partial,creating,value)},{...partial,requestType:value},'same-kind type selection must preserve partial delivery and all independent facts');
  cases.push('same-kind-type-selection-preserves-import-partial-delivery');
  const dated={...partial,actualDeliveryDate:'2026-09-25',deliveryStatus:'delivered'};
  const engineering={...dated,...typeChange(dated,true,'repair')};assert.equal(engineering.kind,'engineering');assert.equal(engineering.completionDate,'2026-09-25');assert.equal(engineering.actualDeliveryDate,undefined);assert.equal(engineering.deliveryStatus,'not-delivered');
  const supply={...engineering,...typeChange(engineering,true,'spares')};assert.equal(supply.kind,'supply');assert.equal(supply.actualDeliveryDate,'2026-09-25');assert.equal(supply.completionDate,undefined);assert.equal(supply.deliveryStatus,'delivered');
  assert.equal(typeChange(partial,false,'repair'),undefined,'stored rows remain kind-immutable');
  cases.push('new-row-cross-kind-date-conversion-and-existing-row-kind-guard');
  for(const audience of ['shore','ship']){
    const first={...newTrackingItem(vessel.id,'supply'),referenceNo:'REQ-LATEST-FIRST',applicationDate:'2026-09-14',requestType:'semiannual-materials',expectedDate:'2026-10-21',description:'Do not copy body',purchaseNos:'FIRST-ONLY',originalItemNo:'01',urgency:'urgent',progress:'Do not copy progress',supplementalNotes:'Do not copy notes',actualDeliveryDate:'2026-09-20',deliveryStatus:'delivered',source:{fileName:'legacy.xlsx',sheetName:'legacy',row:1,originalValues:{A1:'old'}},linkedCaseId:'not-a-new-link',statusLogs:[{id:'old-log',at:'',by:'QA',text:'old history'}]};
    const last={...newTrackingItem(vessel.id,'engineering'),referenceNo:'DO-NOT-COPY-LAST',applicationDate:'2026-01-01',requestType:'drydock',expectedDate:'2026-02-01'};
    const draft=makeTrackingDraft('create',[first,last],data),original=structuredClone(draft);let changed;
    const modal=(overrides={})=>TrackingBusinessModal({draft,audience,busy:false,pending:false,message:'',affected:[],vesselName:'QA',onChange:value=>{changed=value;},onSave:()=>{},onReconcile:()=>{},onClose:()=>{},...overrides});
    const nodes=node=>Array.isArray(node)?node.flatMap(nodes):React.isValidElement(node)?[node,...nodes(node.props.children)]:[];
    const findButton=tree=>nodes(tree).find(node=>node.type==='button'&&node.props.children==='同申請單號新增一筆');
    const button=findButton(modal());assert.ok(button,`${audience}: same-application shortcut must be reachable`);assert.equal(button.props.type,'button');assert.equal(Boolean(button.props.disabled),false);
    const buttons=nodes(modal()).filter(node=>node.type==='button');assert.equal(buttons.findIndex(node=>node.props.children==='同申請單號新增一筆'),buttons.findIndex(node=>node.props.children==='＋ 新增一列')+1,'shortcut belongs immediately beside existing add');
    button.props.onClick();assert.equal(changed.rows.length,3);assert.equal(changed.dirty,true);assert.deepEqual(draft,original);assert.deepEqual(changed.rows.slice(0,2),original.rows);
    const added=changed.rows[2],expected={...newTrackingItem(first.vesselId,first.kind),id:added.id,referenceNo:first.referenceNo,applicationDate:first.applicationDate,requestType:first.requestType,expectedDate:first.expectedDate};assert.deepEqual(added,expected,'only the four named values plus fixed vessel/kind, all remaining fields are fresh');assert.notEqual(added.id,first.id);assert.notEqual(added.id,last.id);assert.deepEqual(commandForTrackingDraft(changed).items,changed.rows);
    for(const overrides of [{pending:true},{busy:true},{readOnly:true},{draft:{...draft,rows:[]}},{draft:{...draft,rows:Array.from({length:100},()=>first)}}])assert.equal(findButton(modal(overrides)).props.disabled,true,'cannot grow frozen, empty or full batch');
    for(const [kind,requestType] of [['supply','semiannual-materials'],['supply','temporary-materials'],['supply','spares'],['engineering','repair'],['engineering','drydock']]){
      const row={...newTrackingItem(vessel.id,kind),referenceNo:'',requestType,applicationDate:'',expectedDate:''};const single={...draft,rows:[row]};findButton(modal({draft:single})).props.onClick();assert.deepEqual(changed.rows[1],{...newTrackingItem(row.vesselId,kind),id:changed.rows[1].id,referenceNo:'',requestType,applicationDate:'',expectedDate:''},'all types and intentional blanks stay literal');
    }
    assert.equal(findButton(modal({draft:{...draft,action:'edit'}})),undefined,'not a duplicate-existing-record action');
    cases.push(`${audience}-same-application-first-row-only-new-identity-and-guards`);
  }
  const completion=makeTrackingDraft('completion',[newTrackingItem(vessel.id,'engineering')],data);completion.date='2026-09-25';
  const command=commandForTrackingDraft(completion);assert.equal(command.type,'edit');assert.deepEqual(command.items[0].changes,{completionDate:'2026-09-25'});
  cases.push('completion-uses-edit-not-lifecycle-or-supply-delivery');
  console.log(JSON.stringify({gate:'tracking-field-revision',label:'真實共用元件＋測試資料，非正式環境',status:'PASS',caseCount:cases.length,cases}));
} finally {
  await vite.close(); delete globalThis.localStorage;
}

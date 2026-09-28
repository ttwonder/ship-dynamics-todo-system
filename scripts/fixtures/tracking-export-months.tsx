// Mounted production components; memory-only capture callbacks, NOT persistence QA.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import TrackingExports from '../../src/tracking/TrackingExports';
import TrackingPage from '../../src/tracking/TrackingPage';
import {createInitialData} from '../../src/data/seed';
import {trackingColumnsFor} from '../../src/tracking/trackingColumns';
import {defaultTrackingPreferences} from '../../src/tracking/trackingTablePreferences';
import '../../src/styles.css';
import '../../src/tracking/tracking.css';
const at='2024-02-01T00:00:00Z';
const actor={id:'month-qa',name:'月份測試員',username:'month-qa',department:'督導',role:'owner' as const,isActive:true,managedVesselIds:[],passwordHash:'',createdAt:at,updatedAt:at};
const row=(id:string,date='2024-02-29',patch:any={})=>({id,vesselId:'month-v1',kind:'supply',requestType:'spares',referenceNo:id,description:'MONTH MATCH '+id,applicationDate:date,urgency:'normal',purchaseNos:'KEEP',supplementalNotes:'',progress:'測試進度',expectedDate:'',deliveryStatus:'not-delivered',isClosed:false,createdBy:actor.id,updatedBy:actor.id,createdAt:at,updatedAt:at,statusLogs:[],...patch});
const deletion={at,byUserId:actor.id,reason:'合成測試理由'};
const rows=[row('KEEP-A','2024-02-01'),row('KEEP-B','2024-02-29',{deletionRequest:{...deletion,status:'pending'}}),row('KEEP-SIBLING','2024-02-20'),row('EXCLUDE-DELETED','2024-02-20',{deletion}),row('EXCLUDE-VESSEL','2024-02-20',{vesselId:'month-v2'}),row('EXCLUDE-TAB','2024-02-20',{deliveryStatus:'delivered'}),row('EXCLUDE-KEYWORD','2024-02-20',{description:'OTHER DESCRIPTION'}),row('EXCLUDE-COLUMN','2024-02-20',{purchaseNos:'OTHER'}),row('EXCLUDE-JAN','2024-01-31'),row('EXCLUDE-MAR','2024-03-01'),row('EXCLUDE-MISSING',''),row('EXCLUDE-INVALID','2024-02-30'),row('YEAR-DEC','2023-12-01'),row('YEAR-JAN','2024-01-31')];
const data=createInitialData();data.users=[actor];data.tasks=[];data.internalControlCases=[];
data.vessels=data.vessels.slice(0,2).map((v,i)=>({...v,id:`month-v${i+1}`,name:`月份測試輪${i+1}`,fullName:`MONTH QA ${i+1}`,shortName:'QA',isActive:true,assignedUserIds:[]}));
data.trackingItems=rows as any;
let refresh:()=>void,release:(()=>void)|null=null;
const control:any={identity:'month-session-a',workspace:'month-workspace',query:{vesselId:'month-v1',tab:'undelivered',search:'MONTH MATCH',filters:{purchaseNos:{text:'KEEP'}},sort:{key:'referenceNo',direction:'desc'}},preferences:defaultTrackingPreferences(trackingColumnsFor('supply')),selected:['KEEP-A','KEEP-B','EXCLUDE-DELETED','EXCLUDE-MAR'],blocked:false,held:false,valid:true,captures:[],captureCalls:0,data,
  layout(kind='supply',long=false){
    const count=long?3:72;
    data.trackingItems=Array.from({length:count},(_,i)=>row(`ROW-${String(i+1).padStart(3,'0')}`,'2024-02-20',{
      kind,requestType:kind==='engineering'?'annual-inspection':'drydock-materials',originalItemNo:String(i+8),purchaseNos:'P-0001、P-0002',expectedDate:'2024-03-01',
      description:`DESC-${String(i+1).padStart(3,'0')} 例行保養及船用材料申請，依技術規格核對。`,supplementalNotes:'請按規格供應，保留原包裝及檢驗證書。',progress:'已詢價，待供應商確認交期。',
      urgency:i%5===0?'urgent':'normal',linkState:i%2===0?'active':'unlinked',actualDeliveryDate:'',completionDate:'',
    })) as any;
    if(long){const middle=data.trackingItems[1];middle.description=Array.from({length:180},(_,i)=>`D${String(i).padStart(4,'0')} 長文完整內容，不可逐欄拆列或省略。`).join('\n');middle.supplementalNotes=Array.from({length:90},(_,i)=>`N${String(i).padStart(4,'0')} 補充備註，保留每行。`).join('\n');middle.progress=Array.from({length:90},(_,i)=>`P${String(i).padStart(4,'0')} 最新進度，保留每行。`).join('\n');}
    control.query={vesselId:'month-v1',tab:kind==='supply'?'undelivered':'engineering-open',search:'',filters:{},sort:{key:'referenceNo',direction:'asc'}};
    control.preferences=defaultTrackingPreferences(trackingColumnsFor(kind));control.selected=[];control.valid=true;refresh();
  },
  change(patch:any){Object.assign(control,patch);refresh();},
  release(){release?.();release=null;},
};
(window as any).__monthQA=control;
const callbacks:any={load:async()=>structuredClone(data),claim:async()=>null,isWritable:()=>false,submit:async()=>{throw new Error('No mutation path in export QA');},release:async()=>true,openCase:()=>{},registerNavigationGuard:()=>{},captureExport:async(vesselId:string)=>{
  control.captureCalls++;
  const source={items:structuredClone(data.trackingItems),isCurrent:()=>control.valid};control.captures.push(source);
  if(control.held)await new Promise<void>(resolve=>{release=resolve;});
  return source;
}};
function Fixture(){const[,render]=useState(0);refresh=()=>render(n=>n+1);
 const page=new URLSearchParams(location.search).get('surface')==='page',audience=new URLSearchParams(location.search).get('audience')==='ship'?'ship':'shore';
 return <main style={{padding:12,minWidth:0}}><p>真實 UI＋測試資料｜記憶體匯出快照｜不連正式環境／非資料庫驗收</p>{page?<TrackingPage data={data} user={actor} vessels={data.vessels} workspace={control.workspace} identity={control.identity} canCreate={false} canEdit={false} canClose={false} canExport audience={audience} callbacks={callbacks}/>:<section className="tracking-page"><h1>配件／物料／工程月份匯出驗證</h1><TrackingExports query={control.query} preferences={control.preferences} selected={control.selected} vesselName="月份測試輪 MONTH QA" identity={control.identity} workspace={control.workspace} callbacks={callbacks} blocked={control.blocked} count={data.trackingItems.length}/></section>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

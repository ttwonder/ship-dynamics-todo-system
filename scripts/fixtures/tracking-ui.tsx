// Internal component-only fixture: callbacks below are NOT persistence evidence.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import TrackingPage from '../../src/tracking/TrackingPage';
import { createInitialData } from '../../src/data/seed';
import { newTrackingItem } from '../../src/tracking/TrackingModals';
import { runTrackingCommand } from '../../src/tracking/trackingWorkflow';
import '../../src/styles.css';
const initial = createInitialData();
const at = '2026-09-24T00:00:00.000Z';
const actor = { id:'component-a',name:'甲',username:'qa-a',department:'督導',role:'owner' as const,isActive:true,managedVesselIds:[],passwordHash:'',createdAt:at,updatedAt:at };
initial.users=[actor,{...actor,id:'component-b',name:'乙'}];
initial.vessels=initial.vessels.slice(0,2).map((v,i)=>({...v,id:`v${i+1}`,name:`測試船${i+1}`,fullName:`QA Vessel ${i+1}`,shortName:'QA',isActive:true,assignedUserIds:[]}));
initial.tasks=[];initial.internalControlCases=[];
initial.trackingItems=Array.from({length:65},(_,i)=>({...newTrackingItem('v1','supply'),id:`r${i}`,referenceNo:`REF-${String(65-i).padStart(3,'0')}`,description:'完整長文測試 '.repeat(35),purchaseNos:i%2?'A':'B',createdBy:actor.id,updatedBy:actor.id,createdAt:at,updatedAt:at,progress:'原進度',urgency:i%2?'urgent' as const:'normal' as const}));
let update:()=>void,release:((value:boolean)=>void)|null=null;
const control:any={ actorId:actor.id,identity:'session-a',canWrite:true,allowed:['v1','v2'],data:initial,submissions:[],mode:'confirm',guard:null,
  change(patch:any){Object.assign(control,patch);update();},
  resolve(ok:boolean){release?.(ok);release=null;},
};
(window as any).__trackingQA=control;
function Fixture(){const [,render]=useState(0);update=()=>render(n=>n+1);
 const user=control.data.users.find((u:any)=>u.id===control.actorId);
 return <main style={{padding:12,maxWidth:'100%',minWidth:0}}><p>真實UI＋測試資料｜組件回呼模擬，不是資料庫驗收</p><TrackingPage key={control.actorId} data={control.data} user={user} vessels={control.data.vessels.filter((v:any)=>control.allowed.includes(v.id))} identity={control.identity} workspace="component-fixture" canCreate={control.canWrite} canEdit={control.canWrite} canClose={control.canWrite} callbacks={{
  load:async()=>structuredClone(control.data), release:async()=>true, openCase:()=>{},registerNavigationGuard:guard=>{control.guard=guard;},
  submit:async submission=>{control.submissions.push(structuredClone(submission));const ok=control.mode==='held'?await new Promise<boolean>(resolve=>{release=resolve;}):control.mode==='confirm';if(ok){control.data=runTrackingCommand(control.data,submission.command,submission.context);update();}return ok;},
 }}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

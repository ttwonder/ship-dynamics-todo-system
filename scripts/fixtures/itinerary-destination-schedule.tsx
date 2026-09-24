// Real production Dashboard + production feed/projection, synthetic read adapter.
// This fixture is reachable only through the dedicated local QA runner.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Dashboard from '../../src/Dashboard';
import {createInitialData} from '../../src/data/seed';
import {useItineraryOperationalProjection} from '../../src/itinerary/useItineraryOperationalProjection';
import {MainSessionItineraryRepository} from '../../src/itinerary/itinerarySourceAuthority';
import {createEmptyItineraryDocument,createBlankItineraryRow} from '../../src/itinerary/itineraryTypes';
import {resolveVesselWithItineraryProjection} from '../../src/itinerary/itineraryOperationalProjection';
import '../../src/styles.css';

const qa=window as any;
qa.SHIP_DYNAMICS_SUPABASE_CONFIG={supabaseUrl:location.origin,supabaseAnonKey:'synthetic-destination-qa',workspaceKey:'destination-qa',tableName:'ship_dynamics_app_state',storageMode:'legacy'};
const data=createInitialData();
const user={...data.users[0],role:'owner' as const,isActive:true};
const vessel=structuredClone(data.vessels[0]);
Object.assign(vessel,{id:'qa-v1',name:'測試甲輪',fullName:'QA ALPHA',shortName:'QA1'});
Object.assign(vessel.position,{lastPort:'WRONG LEGACY PORT',nextPort:'WRONG LEGACY DESTINATION',eta:'2001-01-01T01:00',etb:'2001-01-01T02:00',etd:'2001-01-01T03:00'});
const formal=createEmptyItineraryDocument({workspaceKey:'destination-qa',vesselId:vessel.id,vesselName:'QA ALPHA',rowId:'first'});
formal.revision=1;formal.updatedAt='2026-09-24T00:00:00Z';
Object.assign(formal.rows[0],{
  portDockName:'FIRST PORT',previousPortName:'BUSAN',cargoQuantityText:'FIRST CARGO 500 MT',
  etaUtc:'2026-09-16T00:00:00Z',etaTimeZone:'UTC+8',etbUtc:'2026-09-16T01:00:00Z',etbTimeZone:'UTC+9',
  etdUtc:'2026-09-24T01:00:00Z',etdTimeZone:'UTC-3:30',
  currentVesselState:{location:'FIRST AREA',navigationStatus:'航行',loadStatus:'空載',statusList:['to load']},
});
formal.rows.push({...createBlankItineraryRow('second',1),portDockName:'SINGAPORE',cargoQuantityText:'NEVER SECOND CARGO',
  etaUtc:'2026-09-25T02:00:00Z',etaTimeZone:'UTC+5:30',etbUtc:'2026-09-25T04:00:00Z',etbTimeZone:'UTC-3:30',
  etdUtc:'2026-09-25T12:00:00Z',etdTimeZone:'UTC+8:45'});
// Deliberately not array-ordered: only formal sortOrder controls the source.
formal.rows.reverse();
const sourceBytes=JSON.stringify({vessel,formal});
let now=Date.parse('2026-09-24T00:59:59.999Z'),revision=1,loads=0,feed:any;
const intervals=new Map<number,{callback:()=>void,ms:number}>();
const nativeInterval=window.setInterval.bind(window),nativeClear=window.clearInterval.bind(window);
Date.now=()=>now;
window.setInterval=((callback:()=>void,ms:number)=>{const id=nativeInterval(()=>{},2**30);intervals.set(id,{callback,ms});return id;}) as any;
window.clearInterval=((id:number)=>{intervals.delete(id);nativeClear(id);}) as any;
MainSessionItineraryRepository.prototype.loadMany=async()=>{loads++;if(loads===1)return {[vessel.id]:formal};return new Promise(()=>{});};
const noWrite=()=>{qa.__qaWrites++;throw new Error('Display test must never mutate or claim a lease');};
qa.__qaWrites=0;
qa.__qaState=()=>({now,loads,revision:feed?.records[vessel.id]?.document?.revision,ready:feed?.records[vessel.id]?.status==='ready',sourceUnchanged:JSON.stringify({vessel,formal})===sourceBytes});
qa.__qaTick=(instant:string)=>{now=Date.parse(instant);flushSync(()=>{for(const item of intervals.values())if(item.ms===15000)item.callback();});};
qa.__qaVariant=(mode:string)=>{
  const next=structuredClone(formal);next.rows.sort((a,b)=>a.sortOrder-b.sortOrder);next.revision=++revision;
  if(mode==='absent')next.rows=next.rows.slice(0,1);
  if(mode==='missing-eta')next.rows[1].etaUtc=null;
  if(mode==='blank-port')next.rows[1].portDockName=' ';
  if(mode==='third')next.rows.push({...createBlankItineraryRow('third',2),portDockName:'NEVER THIRD',etaUtc:'2026-09-26T00:00:00Z',etaTimeZone:'UTC+8'});
  flushSync(()=>feed.publishConfirmed(next));
};
function QA(){
  feed=useItineraryOperationalProjection({actor:{userId:user.id},vesselIds:[vessel.id],enabled:true});
  const effective=resolveVesselWithItineraryProjection(vessel,feed.records[vessel.id],feed.projectionNow);
  return <Dashboard user={user} itineraryActor={{userId:user.id}} itineraryOperationalFeed={feed} users={[user]} vessels={[effective]}
    tasks={[]} calendarTasks={[]} internalControlCases={[]} meetings={[]} selected={[]} setSelected={noWrite} batchSelected={[]} setBatchSelected={noWrite}
    onOpenVessel={noWrite} onEdit={noWrite} onAddTask={noWrite} onToggleAttention={noWrite} onAdjustAttention={noWrite} onStartMeeting={noWrite}
    onOpenReport={noWrite} onTaskMetric={noWrite} onOpenBatchManagedVessels={noWrite} canEdit={false} canCreateTasks={false} canUseMeetings={false} canUseReports={false}/>;
}
createRoot(document.getElementById('root')!).render(<QA/>);

import React,{useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useItineraryOperationalProjection} from '../src/itinerary/useItineraryOperationalProjection';
import {MainSessionItineraryRepository as OfficeItineraryCloudRepository} from '../src/itinerary/itinerarySourceAuthority';
import {createEmptyItineraryDocument,createBlankItineraryRow} from '../src/itinerary/itineraryTypes';
import {resolveVesselWithItineraryProjection} from '../src/itinerary/itineraryOperationalProjection';
import ShipItineraryEditor from '../src/itinerary/ShipItineraryEditor';
import '../src/itinerary/shipItinerary.css';

export async function run(){
 const assert=(v,label)=>{if(!v)throw new Error(label);};
 const tick=()=>new Promise(r=>setTimeout(r,0));
 const originalNow=Date.now,originalInterval=window.setInterval,originalClear=window.clearInterval,originalLoad=OfficeItineraryCloudRepository.prototype.loadMany;
 let now=Date.parse('2026-09-01T00:00:00Z'),feed,lastDocument,loadCount=0;const intervals=new Map(),cases=[];
 const formal=createEmptyItineraryDocument({workspaceKey:'current-state-browser',vesselId:'v1',vesselName:'V1',rowId:'r1'});
 formal.rows[0].previousPortName='BUSAN';formal.rows[0].portDockName='FIRST';formal.rows[0].portTimeZone='UTC+8';formal.rows[0].etdUtc='2026-09-01T00:00:00Z';formal.rows[0].calculationStartUtc='2026-09-01T00:00:00Z';formal.rows[0].calculationStartTimeZone='UTC+8';
 formal.rows.push({...createBlankItineraryRow('r2',1),portDockName:'SECOND'});
 const vessel={id:'v1',position:{},cargo:{},note:{statusList:[]}};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 window.SHIP_DYNAMICS_SUPABASE_CONFIG={supabaseUrl:location.origin,supabaseAnonKey:'synthetic-current-state',workspaceKey:'current-state-browser',tableName:'ship_dynamics_app_state',storageMode:'legacy'};
 Date.now=()=>now;
 window.setInterval=(callback,ms)=>{const id=originalInterval(()=>{},2**30);intervals.set(id,{callback,ms});return id;};
 window.clearInterval=id=>{intervals.delete(id);originalClear(id);};
 OfficeItineraryCloudRepository.prototype.loadMany=async()=>{loadCount++;if(loadCount===1)return {v1:formal};return new Promise(()=>{});};
 function Probe(){
  feed=useItineraryOperationalProjection({actor:{userId:'qa'},vesselIds:['v1'],enabled:true});
  const effective=useMemo(()=>resolveVesselWithItineraryProjection(vessel,feed.records.v1,feed.projectionNow),[feed.records,feed.projectionNow]);
  const [draft,setDraft]=useState(formal);lastDocument=draft;
  return React.createElement(React.Fragment,null,React.createElement('output',{id:'next-port'},effective.position.nextPort),React.createElement(ShipItineraryEditor,{document:draft,readOnly:false,canSave:true,onChange:setDraft,onSave(){},onCancel(){}}));
 }
 try{
  flushSync(()=>root.render(React.createElement(Probe)));
  for(let i=0;i<100&&!feed.records.v1?.document;i++)await tick();
  assert(host.querySelector('#next-port').textContent==='FIRST','initial/equality projection '+JSON.stringify({loadCount,records:feed.records,next:host.querySelector('#next-port').textContent}));
  now+=1;
  flushSync(()=>{for(const {callback,ms} of intervals.values())if(ms===15000)callback();});await tick();
  assert(host.querySelector('#next-port').textContent==='SECOND','clock must update next port even while a cloud poll is pending, without a document edit');
  assert(feed.records.v1.document===formal,'clock must not edit confirmed document');
  cases.push('live clock advances projection with unchanged document and pending cloud read');
  const change=(selector,value)=>{const node=host.querySelector(selector);const setter=Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(node,value);flushSync(()=>node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true})));};
  change('[name=currentLocation]','Taiwan Strait');change('[aria-label="目前航行狀態"]','停泊');change('[aria-label="目前載況"]','滿載');
  const details=host.querySelector('[data-current-vessel-status]');details.open=true;flushSync(()=>details.querySelectorAll('input')[5].click());
  assert(lastDocument.rows[0].currentVesselState.location==='Taiwan Strait','location input');
  assert(lastDocument.rows[0].currentVesselState.navigationStatus==='停泊','navigation select preserves location');
  assert(lastDocument.rows[0].currentVesselState.loadStatus==='滿載','load select');
  assert(lastDocument.rows[0].currentVesselState.statusList[0]==='drydock/repiar','display repair / stored repiar alias');
  cases.push('ship fields patch individual keys and preserve multi-select stored alias');
  flushSync(()=>details.querySelector('button').click());assert(lastDocument.rows[0].currentVesselState.statusList.length===0,'explicit status clear');
  assert(lastDocument.rows[0].currentVesselState.location==='Taiwan Strait','clear statuses preserves other fields');
  cases.push('explicit status clear is stored without blanking other fields');
  if (innerWidth >= 1700) {
    const box = selector => host.querySelector(selector).getBoundingClientRect();
    const anchor = box('.ship-calculation-anchor'), state = box('.ship-current-vessel-state'), previous = box('.ship-previous-port-field');
    assert(state.left >= anchor.right && state.right <= previous.left && state.top < anchor.bottom, 'wide screen fields occupy the marked space between time and previous port');
    cases.push('wide screen state fields use the existing header gap');
  }
  return {layer:'controlled mounted React, synthetic data; not App/SQL E2E',cases};
 }finally{Date.now=originalNow;OfficeItineraryCloudRepository.prototype.loadMany=originalLoad;window.setInterval=originalInterval;window.clearInterval=originalClear;for(const id of intervals.keys())originalClear(id);}
}

// Hook-only deterministic deferred I/O probes in a separate blank local browser page.
// These are not SQL/hosted evidence; the original App browser gate uses actual SQL.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {OfficeItineraryCloudRepository} from '../src/itinerary/itineraryCloud.ts';
import {useItineraryOperationalProjection} from '../src/itinerary/useItineraryOperationalProjection.ts';
import {createEmptyItineraryDocument} from '../src/itinerary/itineraryTypes.ts';

export async function run() {
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const until=async(fn,label)=>{for(let i=0;i<100;i++){if(fn())return;await tick();}throw new Error(label);};
  const original=OfficeItineraryCloudRepository.prototype.loadMany;
  const configBefore=window.SHIP_DYNAMICS_SUPABASE_CONFIG;
  const requests=[],cases=[],host=document.createElement('div');host.hidden=true;document.body.append(host);
  const root=createRoot(host);let feed;
  OfficeItineraryCloudRepository.prototype.loadMany=function(){return new Promise((resolve,reject)=>requests.push({repo:this,resolve,reject}));};
  const config={supabaseUrl:location.origin,supabaseAnonKey:'synthetic-hook-key',workspaceKey:'hook-qa',tableName:'ship_dynamics_app_state',storageMode:'legacy'};
  function Probe(){feed=useItineraryOperationalProjection({actor:{userId:'same-actor'},vesselIds:['v1'],enabled:true});return null;}
  const render=cfg=>{window.SHIP_DYNAMICS_SUPABASE_CONFIG=cfg;flushSync(()=>root.render(React.createElement(Probe)));};
  const doc=(revision,label)=>{const d=createEmptyItineraryDocument({workspaceKey:'hook-qa',vesselId:'v1',vesselName:'V1',rowId:'r1'});d.revision=revision;d.rows[0].portDockName=label;return d;};
  const resolve=(request,revision,label)=>request.resolve({v1:doc(revision,label)});
  try {
    render(config);await until(()=>requests.length===1,'initial hook request');
    const legacy=feed,legacyRequest=requests[0];
    render({...config,storageMode:'records-v1'});
    await until(()=>requests.length===2,'mode change must recreate backend and issue a new request');
    assert(requests[1].repo.config.storageMode==='records-v1','new backend retained legacy authority');
    resolve(requests[1],7,'NEW RECORD');await until(()=>feed.records.v1?.document?.revision===7,'record publish');
    resolve(legacyRequest,999,'LATE LEGACY');await tick();await tick();
    assert(feed.records.v1.document.rows[0].portDockName==='NEW RECORD','late legacy success contaminated record feed');
    cases.push('same endpoint/workspace mode switch recreates backend and fences late old-mode success');
    legacy.publishConfirmed(doc(1000,'OLD CONFIRMED'));
    let rejected=false;try {await legacy.refresh();}catch{rejected=true;}
    assert(rejected&&requests.length===2,'old callback issued a request');
    assert(feed.records.v1.document.revision===7,'old publishConfirmed contaminated new mode');
    cases.push('old-mode refresh and confirmed callbacks cannot publish or request');
    const lateError=feed.refresh();const observed=lateError.then(()=>false,()=>true);
    await until(()=>requests.length===3,'pending record request');
    render(config);await until(()=>requests.length===4,'switch back to legacy creates new generation');
    resolve(requests[3],3,'NEW LEGACY');await until(()=>feed.records.v1?.document?.revision===3,'new legacy publication');
    requests[2].reject(new Error('late record failure'));assert(await observed,'pending error must reject');await tick();
    assert(feed.records.v1.status==='ready'&&feed.records.v1.document.revision===3,'late record error polluted new legacy mode');
    cases.push('late old-mode rejection cannot mark the successor feed stale/error');
    const oldKey=feed;render({...config,supabaseAnonKey:'rotated-synthetic-hook-key'});
    await until(()=>requests.length===5,'key rotation must recreate backend and advance identity');
    resolve(requests[4],2,'ROTATED KEY');await until(()=>feed.records.v1?.document?.revision===2,'rotated key publication');
    oldKey.publishConfirmed(doc(999,'OLD KEY'));
    assert(feed.records.v1.document.revision===2,'old key callback was not fenced');
    cases.push('same-mode credential generation refreshes backend and fences prior key callbacks');
    return {layer:'real React hook with deferred repository I/O, not SQL',cases};
  } finally {flushSync(()=>root.unmount());host.remove();OfficeItineraryCloudRepository.prototype.loadMany=original;window.SHIP_DYNAMICS_SUPABASE_CONFIG=configBefore;}
}

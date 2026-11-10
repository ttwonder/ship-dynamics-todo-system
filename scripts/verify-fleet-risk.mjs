import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Real Dashboard entry; controlled transport cases below are not live-source proof.
const server = await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
  const {default:Dashboard} = await server.ssrLoadModule('/src/Dashboard.tsx');
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(Dashboard, {
    user:{id:'qa',role:'operator',isActive:true},itineraryActor:{userId:'qa'},users:[],vessels:[],tasks:[],calendarTasks:[],internalControlCases:[],meetings:[],
    selected:[],setSelected:noop,batchSelected:[],setBatchSelected:noop,onOpenVessel:noop,onEdit:noop,onAddTask:noop,onToggleAttention:noop,onAdjustAttention:noop,
    onStartMeeting:noop,onOpenReport:noop,onTaskMetric:noop,onOpenBatchManagedVessels:noop,canEdit:true,canCreateTasks:true,canUseMeetings:true,canUseReports:true,
  }));
  assert.match(html, /aria-label="船隊風險清單"/, 'original Dashboard exposes fleet-risk button');
  assert.ok(html.indexOf('船隊風險清單') < html.indexOf('顯示行事曆'), 'requested position before calendar button');
  assert.match(html, /class="fleet-card-grid"/, 'unchanged cards remain the default');
  console.log('Fleet-risk Dashboard entry: PASS');
  const {parseFleetRiskState, riskSummary, mostRecentScheduledAt} = await server.ssrLoadModule('/src/fleetRisk/model.ts');
  const instant = '2026-11-11T00:00:00.000Z';
  const row = {name:'FPMC S AMBER',imo:'9913743',risk:'SRS',priority:'No Priority',status:'ok',retrievedAt:instant,companyName:'FORMOSA PLASTICS MARINE CORPORATION',companyImo:'0882415',windowFrom:null,windowTo:null,sourceUpdatedAt:null,sourceUrl:'https://apcis.tmou.org/public/'};
  const snapshot = {id:'00000000-0000-4000-8000-000000000001',trigger:'scheduled',company:{name:'FORMOSA PLASTICS MARINE CORPORATION',imo:'0882415',performance:'Medium'},queryStartedAt:instant,queryCompletedAt:instant,rosterRetrievedAt:instant,count:1,rows:[row],coverage:{referenceCount:1,missingReferenceImos:[],addedReferenceImos:[]}};
  const envelope = {snapshot,attempt:null,serverTime:instant,nextScheduledAt:'2026-11-11T23:00:00Z'};
  assert.equal(parseFleetRiskState(envelope).snapshot.rows[0].risk,'SRS');
  assert.deepEqual(riskSummary(snapshot),{HRS:0,SRS:1,LRS:0});
  assert.throws(()=>parseFleetRiskState({...envelope,snapshot:{...snapshot,count:2}}),/資料/,'declared count must reconcile');
  assert.throws(()=>parseFleetRiskState({...envelope,snapshot:{...snapshot,rows:[{...row,risk:null}]}}),/資料/,'unknown must never become low risk');
  assert.throws(()=>parseFleetRiskState({...envelope,snapshot:{...snapshot,rows:[{...row,imo:'9913744'}]}}),/資料/,'malformed IMO rejected');
  assert.equal(mostRecentScheduledAt('2026-11-10T22:59:59Z'),'2026-11-09T23:00:00.000Z');
  assert.equal(mostRecentScheduledAt('2026-11-10T23:00:00Z'),'2026-11-10T23:00:00.000Z');
  const {createFleetRiskClient} = await server.ssrLoadModule('/src/fleetRisk/client.ts');
  const requests=[];
  const client=createFleetRiskClient({supabaseUrl:'http://127.0.0.1:1',supabaseAnonKey:'synthetic-public-key',workspaceKey:'qa'},async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify(url.includes('/functions/')?{ok:true,state:envelope,runId:snapshot.id,started:true}:envelope),{status:200});});
  const abort=new AbortController();
  await client.read(abort.signal); await client.read(abort.signal);
  assert.equal(requests.length,2,'reopen reads shared snapshot instead of local cache');
  assert.ok(requests.every(r=>r.init.cache==='no-store'));
  assert.ok(requests.every(r=>!r.url.includes('/functions/')),'ordinary opening must never start remote crawl');
  await client.refresh(snapshot.id,abort.signal);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body),{action:'refresh',requestId:snapshot.id});
  assert.equal(requests.filter(r=>r.url.includes('/functions/')).length,1);
  console.log('Fleet-risk model/transport: PASS (controlled data, not cloud acceptance)');
} finally { await server.close(); }

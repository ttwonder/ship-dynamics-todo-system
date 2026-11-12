import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{
  name:'qa-export-existing-report',enforce:'pre',
  transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/App.tsx'))return code+'\nexport {ReportPreviewModal};';},
}]});
const cases=[],failures=[];
const check=(name,fn)=>{try{fn();cases.push(name);}catch(error){failures.push({name,error:error.message});}};
try{
  const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
  const {default:Detail}=await server.ssrLoadModule('/src/VesselDetailPage.tsx');
  const {ReportPreviewModal:Report}=await server.ssrLoadModule('/src/App.tsx');
  const data=createInitialData(),vessel=data.vessels.find(v=>v.fullName==='FPMC S AMBER');
  assert.ok(vessel);data.vessels=[vessel];data.tasks=[];data.internalControlCases=[];data.meetings=[];data.agendaReports=[];
  const user={id:'qa',name:'QA ONLY',role:'owner',department:'督導',isActive:true};data.users=[user];
  const at='2026-11-12T04:50:26.000Z',row={name:vessel.fullName,imo:'9913743',risk:'HRS',status:'ok',retrievedAt:at,priority:'No Priority',companyName:'QA ONLY',companyImo:'0882415',windowFrom:null,windowTo:null,sourceUpdatedAt:null,sourceUrl:'https://apcis.tmou.org/public/'};
  const snapshot={id:'00000000-0000-4000-8000-000000000001',trigger:'manual',company:{name:'QA ONLY',imo:'0882415',performance:'Medium'},queryStartedAt:'2026-11-12T04:49:00.000Z',queryCompletedAt:at,rosterRetrievedAt:at,count:1,rows:[row],coverage:{referenceCount:1,missingReferenceImos:[],addedReferenceImos:[]}};
  const state={snapshot,attempt:null,serverTime:at,nextScheduledAt:'2026-11-12T23:00:00.000Z'},noop=()=>{};
  const risk={state,error:'',loading:false,submitting:false,unknown:false,read:async()=>{},readSnapshot:async()=>({state,error:''}),refresh:async()=>{}};
  const capture={snapshotId:snapshot.id,queryCompletedAt:at,rowsByVessel:{[vessel.id]:row},notice:''};
  const before=JSON.stringify(data);
  const detail=renderToStaticMarkup(React.createElement(Detail,{vessel,data,currentUser:user,fleetRisk:risk,onBack:noop,onEditVessel:noop,onAddTask:noop,onEditTask:noop,onOpenInternalControl:noop,canEditVessel:true,canCreateTasks:true,canEditTasks:true,canViewInternalControl:true}));
  check('detail: official HRS appears before unchanged attention light',()=>{
    assert.match(detail,/data-risk="HRS"/,'Single-vessel detail must display its official Tokyo grade');
    assert.ok(detail.indexOf('data-risk="HRS"')<detail.indexOf('class="priority-pill'),'risk precedes the existing independently derived attention pill');
    assert.match(detail,/data-imo="9913743"/);assert.match(detail,/data-snapshot-id="00000000-0000-4000-8000-000000000001"/);
  });
  const props={data,visibleVessels:data.vessels,user,selected:[],capturedAt:at,fleetRiskCapture:capture,close:noop,onPrint:noop};
  const report=renderToStaticMarkup(React.createElement(Report,props));
  check('report: grade follows officers in the existing ship-name cell',()=>{
    assert.match(report,/data-risk="HRS"/,'Morning report must display the captured Tokyo grade');
    assert.ok(report.indexOf('大管輪：')<report.indexOf('data-risk="HRS"'));
    assert.match(report,/Tokyo MOU/);assert.match(report,/12:50:26/);
  });
  const history=renderToStaticMarkup(React.createElement(Report,{...props,reportDate:'2025-01-02'}));
  check('historical report: current-reference risk is explicitly not the historical daily value',()=>{
    assert.match(history,/data-risk="HRS"/);assert.match(history,/非歷史報告當日風險/);assert.match(history,/2025-01-02/);
  });
  check('display enrichment leaves original vessel/report records unchanged',()=>assert.equal(JSON.stringify(data),before));
  if(!failures.length){
    const {captureFleetRiskReport}=await server.ssrLoadModule('/src/fleetRisk/reportRisk.ts');
    const frozen=captureFleetRiskReport(data.vessels,{state,error:''});
    row.risk='LRS';assert.equal(frozen.rowsByVessel[vessel.id].risk,'HRS');
    assert.deepEqual(captureFleetRiskReport([{...vessel,id:'duplicate'},vessel],{state,error:''}).rowsByVessel,{});
    assert.equal(captureFleetRiskReport(data.vessels,{state,error:'network'}).notice,'讀取失敗');
    assert.deepEqual(captureFleetRiskReport(data.vessels,null).rowsByVessel,{});
    cases.push('capture: detached grade, ambiguous identity stays unknown, failed read retains last-good notice');
    for(const grade of ['HRS','SRS','LRS',null]){
      const input=structuredClone(capture);if(grade)input.rowsByVessel[vessel.id].risk=grade;else input.rowsByVessel={};
      const html=renderToStaticMarkup(React.createElement(Report,{...props,fleetRiskCapture:input}));
      assert.ok(html.includes(`data-risk="${grade||'unknown'}"`));
    }
    cases.push('report: HRS/SRS/LRS and gray unknown; unknown never becomes low risk');
  }
  console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',layer:'real component SSR + synthetic data; not browser or production',caseCount:cases.length,cases,failures},null,2));
  if(failures.length)process.exitCode=1;
}finally{await server.close();}

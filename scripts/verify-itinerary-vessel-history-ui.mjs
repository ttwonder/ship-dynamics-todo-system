import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
let failure;
try {
  const history=await vite.ssrLoadModule('/src/ReportDailyHistories.tsx');
  const Preview=(await vite.ssrLoadModule('/src/ItineraryDailyReportPreview.tsx')).default;
  const pdf=await vite.ssrLoadModule('/src/itineraryDailyReportPdf.ts');

  const page={items:[],page:1,pageSize:30,pageCount:1,total:0,dateTotal:0,reportTotal:0,setToken:'d41d8cd98f00b204e9800998ecf8427e'};
  const markup=renderToStaticMarkup(React.createElement(history.ItineraryDailyHistoryPanel,{pageData:page,loading:false,errorText:'',openingReportId:'',onRefresh(){},onPage(){},onLocate:async()=>false,onOpen(){},onShowVessel(){}}));
  assert.match(markup,/>單船歷程<\/button>/,'existing fleet panel needs the real entry button');
  assert.ok(markup.indexOf('單船歷程')<markup.indexOf('↻ 刷新'));
  assert.equal(typeof history.ItineraryVesselHistoryPanel,'function');
  const single=renderToStaticMarkup(React.createElement(history.ItineraryVesselHistoryPanel,{actorUserId:'qa-owner',onBack(){}}));
  assert.match(single,/返回全船記錄/);assert.match(single,/aria-label="單船歷程船舶"/);
  const overview=rows=>renderToStaticMarkup(React.createElement(history.ItineraryVesselHistoryOverview,{rows}));
  const emptyOverview=overview([]);
  assert.equal((emptyOverview.match(/<dt>/g)||[]).length,11);
  assert.equal((emptyOverview.match(/>TBA<\/dd>/g)||[]).length,2);
  assert.deepEqual([...emptyOverview.matchAll(/<dt>(.*?)<\/dt>/g)].map(match=>match[1]),['Voy No.','上一港','目前位置','目前航行狀態','目前船舶狀態','Next Port','ETA','ETB','ETD','後續港','後續港 ETA']);
  assert.match(emptyOverview,/<dt>後續港<\/dt><dd>TBA<\/dd>/);
  assert.match(emptyOverview,/<dt>後續港 ETA<\/dt><dd>TBA<\/dd>/);
  assert.match(overview(null),/基本資訊摘要尚未部署/);assert.doesNotMatch(overview(null),/TBA|<dl/);
  const vessel={vesselId:'v1',vesselName:'QA SHIP',revision:7,updatedAt:null,rows:[]};
  const report={reportId:'1',businessDate:'2026-09-01',timezone:'Asia/Taipei',generatedAt:'2026-09-01T01:00:00Z',generatedBy:'scheduled',generatedByActorId:null,vesselCount:1,rowCount:0,sourceMaxRevision:7,logicalBytes:1,snapshot:{schemaVersion:1,businessDate:'2026-09-01',timezone:'Asia/Taipei',generatedAt:'2026-09-01T01:00:00Z',vesselCount:1,rowCount:0,sourceMaxRevision:7,vessels:[vessel]}};
  const preview=renderToStaticMarkup(React.createElement(Preview,{report,singleVesselName:'QA SHIP',close(){}}));
  assert.match(preview,/單船歷程快照/);assert.match(preview,/QA SHIP/);assert.match(preview,/無正式 Itinerary 內容/);
  assert.match(pdf.itineraryDailyReportPdfTitle(report.businessDate,report.generatedAt,'scheduled','1','QA SHIP'),/QA SHIP/);
  const beforeReport=JSON.stringify(report);
  const names=[{id:'v1',name:'測試甲船',fullName:'FPMC QA ALPHA'}];
  const bilingualPreview=renderToStaticMarkup(React.createElement(Preview,{report,singleVesselName:'QA SHIP',vesselNames:names,close(){}}));
  assert.match(bilingualPreview,/<h1>測試甲船 FPMC QA ALPHA｜單船歷程快照<\/h1>/,'history preview title uses the bilingual name');
  assert.match(bilingualPreview,/<h2>測試甲船 FPMC QA ALPHA<\/h2>/,'printed vessel header uses the same bilingual name');
  const fleetPreview=renderToStaticMarkup(React.createElement(Preview,{report,vesselNames:names,close(){}}));
  assert.match(fleetPreview,/<h2>測試甲船 FPMC QA ALPHA<\/h2>/,'fleet historical preview uses the same rule');
  const englishPreview=renderToStaticMarkup(React.createElement(Preview,{report,singleVesselName:'QA SHIP',vesselNames:[{id:'v1',name:'F35',shortName:'F35',fullName:'FPMC 35'}],close(){}}));
  assert.match(englishPreview,/<h1>FPMC 35｜單船歷程快照<\/h1>/);assert.match(englishPreview,/<h2>FPMC 35<\/h2>/);assert.doesNotMatch(englishPreview,/F35 FPMC/);
  assert.equal(JSON.stringify(report),beforeReport,'formatting must not rewrite the saved report');
  const {vesselSelectionDisplayName,vesselHistoryDisplayName}=await vite.ssrLoadModule('/src/vesselDisplay.ts');
  for(const [vessel,expected] of [
    [{name:' 測試甲船 ',fullName:' FPMC QA ALPHA '},'測試甲船 FPMC QA ALPHA'],
    [{name:'',fullName:'FPMC QA BETA'},'FPMC QA BETA'],
    [{name:'   ',shortName:'F35',fullName:'FPMC 35'},'FPMC 35'],
    [{name:'F35',shortName:'F35',fullName:'FPMC 35'},'FPMC 35'],
    [{name:'FPMC 35',fullName:'FPMC 35'},'FPMC 35'],
    [{name:'測試丙船',fullName:''},'測試丙船'],
    [{name:'測試丙船',fullName:'測試丙船'},'測試丙船'],
    [{name:'QA RETIRED ONLY'},'QA RETIRED ONLY'],
  ]){
    const before=JSON.stringify(vessel);assert.equal(vesselSelectionDisplayName(vessel),expected);assert.equal(JSON.stringify(vessel),before);
  }
  assert.equal(vesselHistoryDisplayName('retired','QA RETIRED ONLY',names),'QA RETIRED ONLY');
  assert.equal(vesselHistoryDisplayName('v1','QA SHIP',names),'測試甲船 FPMC QA ALPHA');
  console.log('PASS UI contract: entry order, selector, return, scoped preview and named export');
} catch(error) {failure=error;console.error(error.message);}finally{await vite.close();}
if(failure)process.exitCode=1;

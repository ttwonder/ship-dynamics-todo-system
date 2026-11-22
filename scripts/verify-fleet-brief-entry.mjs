import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const vite = await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
  const {default:Dashboard} = await vite.ssrLoadModule('/src/Dashboard.tsx');
  const panel=(canUseReports,canUseMeetings)=>renderToStaticMarkup(createElement(Dashboard,{
    user:{id:'qa-user',isActive:true,role:'operator'}, itineraryActor:{userId:'qa-user'},
    users:[],vessels:[],tasks:[],calendarTasks:[],internalControlCases:[],meetings:[],selected:[],batchSelected:[],
    canUseReports,canUseMeetings,onPrepareFleetBrief:()=>{},fleetRisk:{state:null},
  }));
  const all=panel(true,true);
  assert.ok(all.includes('>重點摘要</button>'),'看板應提供重點摘要');
  assert.ok(!all.includes('開始今日早會'));
  assert.ok(all.includes('快速入會') && all.includes('建立 PDF 報告'),'既有相鄰操作仍可見');
  assert.ok(panel(true,false).includes('>重點摘要</button>'));
  assert.ok(!panel(false,true).includes('>重點摘要</button>'),'早會權限不等於匯出權限');
  console.log('PASS: dashboard entry, report permissions and adjacent actions');
} finally {await vite.close();}

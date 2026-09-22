import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
const cases=[];
try {
  const {ListPanel}=await server.ssrLoadModule('/src/App.tsx');
  const {createPageStatisticsFixture}=await server.ssrLoadModule('/scripts/fixtures/page-statistics.ts');
  const {data,vessels}=createPageStatisticsFixture();
  const filters={keyword:'',departments:[],vesselIds:[],fleetTags:[],priorities:[],categories:[],meetingCategories:[],ownerMode:'all',fromDate:'',toDate:'',closedMode:'open',overdueOnly:false,internalControlOnly:false};
  const noWrite=()=>{throw new Error('Rendering must not write');};
  const props={title:'總清單',tasks:data.tasks,data,visibleVessels:vessels,filters,setFilters:noWrite,fleetTags:[],userMap:Object.fromEntries(data.users.map(u=>[u.id,u])),exportedBy:'QA',onEdit:noWrite,onPrint:noWrite,onBatchComplete:noWrite,onBatchDelete:noWrite,canEdit:true,canPrint:true,canComplete:true,canDelete:true,batchContext:{identity:'qa-owner:total',isCurrent:()=>true}};
  const markup=renderToStaticMarkup(React.createElement(ListPanel,{...props,onCreateTask:noWrite}));
  assert.match(markup,/aria-label="新增要事"/,'總清單需要可操作的新增要事入口');
  assert.ok(markup.indexOf('aria-label="新增要事"')<markup.indexOf('數據統計'),'新增要事位於數據統計左側');
  cases.push('total list exposes create entry before statistics');
  const readonly=renderToStaticMarkup(React.createElement(ListPanel,{...props,canEdit:false}));
  assert.doesNotMatch(readonly,/aria-label="新增要事"/,'無新增權限不得出現新入口');
  const closed=renderToStaticMarkup(React.createElement(ListPanel,{...props,title:'已結案清單'}));
  assert.doesNotMatch(closed,/aria-label="新增要事"/,'已結案頁不新增入口');
  cases.push('existing pages without creation callback keep their original controls');
  const empty=renderToStaticMarkup(React.createElement(ListPanel,{...props,visibleVessels:[],onCreateTask:noWrite}));
  assert.match(empty,/<button[^>]*aria-label="新增要事"[^>]*disabled=""/,'沒有可用船舶時不得建立無船草稿');
  cases.push('empty authorized vessel scope disables creation');
  assert.match(fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8'),/onCreateTask=\{canCreateTasks&&currentUser\.role!=='vessel'\?/, 'shore list must not introduce task creation for vessel role');
  cases.push('total-list caller preserves shore-only creation boundary');
  console.log(JSON.stringify({status:'PASS',layer:'ListPanel server rendering + shore-only caller contract',cases},null,2));
} finally {await server.close();}

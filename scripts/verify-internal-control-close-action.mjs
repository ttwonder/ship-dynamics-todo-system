import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try {
  const {CaseEditModal}=await vite.ssrLoadModule('/src/InternalControlModals.tsx');
  const {createDataAnalysisFixture}=await vite.ssrLoadModule('/scripts/fixtures/data-analysis.ts');
  const {data,vessels}=createDataAnalysisFixture();
  const item={id:'qa-close',vesselId:vessels[0].id,reportDate:'2026-09-23',reportSource:'日常',description:'QA close action',priority:'低',category:'其他',status:'QA pending',statusLogs:[],departments:[],syncToTask:false,isClosed:false,isAware:false};
  const noWrite=()=>{throw Error('SSR must not write');};
  const props={item,data,vessels,canEdit:true,canClose:true,canDelete:false,showWithdrawSync:false,canWithdrawSync:false,withdrawSyncReason:'',close:noWrite,save:noWrite,onWithdrawSync:noWrite,onDelete:noWrite};
  const render=overrides=>renderToStaticMarkup(React.createElement(CaseEditModal,{...props,...overrides}));
  const buttons=html=>[...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(m=>m[1]);
  assert.ok(buttons(render({})).includes('結案並保存'),'the original case editor needs a prominent explicit close action');
  assert.ok(buttons(render({item:{...item,isClosed:true,closedDate:'2026-09-23'}})).includes('改為未結案'));
  assert.ok(!buttons(render({canClose:false})).includes('結案並保存'),'no close action without original close permission');
  assert.ok(!buttons(render({canEdit:false})).includes('結案並保存'),'read-only editor must not introduce a write action');
  console.log('PASS: explicit internal-control close/reopen actions and permission boundaries');
} finally {await vite.close();}

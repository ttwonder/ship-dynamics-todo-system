import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
const cases=[];
try {
  const {default:WorkCenter}=await server.ssrLoadModule('/src/WorkCenter.tsx');
  const {default:InternalControlPage}=await server.ssrLoadModule('/src/InternalControlPage.tsx');
  const {createDataAnalysisFixture}=await server.ssrLoadModule('/scripts/fixtures/data-analysis.ts');
  const {data,vessels}=createDataAnalysisFixture(),user=data.users[0],at=data.updatedAt;
  const task={...data.tasks[0],isClosed:false,ownerUserIds:[user.id],description:'QA synced task',id:'qa-linked-task',isInternalControl:true,internalControlCaseId:'qa-linked-case'};
  data.tasks=[task,{...task,id:'qa-ordinary',description:'QA ordinary task',isInternalControl:false,internalControlCaseId:undefined},{...task,id:'qa-manual-internal',description:'QA manually marked task',internalControlCaseId:undefined}];
  const item={id:'qa-standalone',vesselId:'qa-v1',reportDate:'2026-01-01',reportSource:'日常',description:'QA standalone case',status:'QA pending',category:'維修',priority:'低',departments:['海務'],isAware:false,isClosed:false,syncToTask:false,createdBy:user.id,updatedBy:user.id,createdAt:at,updatedAt:at,statusLogs:[]};
  data.internalControlCases=[item,{...item,id:'qa-linked-case',description:'QA synced case',syncToTask:true,linkedTaskId:task.id}];
  const noWrite=()=>{throw new Error('Rendering must not write');};
  const markup=renderToStaticMarkup(React.createElement(WorkCenter,{data,user,vessels,onOpenTask:noWrite,onOpenInternalControl:noWrite,onOpenVessel:noWrite,markAllRead:noWrite,canComplete:true,canDelete:false,canPrint:true,onPrint:noWrite,onBatchComplete:noWrite,onDismiss:noWrite,onBatchDelete:noWrite}));
  const rows=[...markup.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(match=>match[0]);
  const row=text=>{const found=rows.find(s=>s.includes(text));assert.ok(found,'expected visible row '+text);return found;};
  assert.ok(row('QA standalone case').includes('內控(未同步要事)'),'standalone case needs unambiguous unsynced label');
  assert.ok(row('QA synced task').includes('內控(已同步要事)'),'linked task needs synced internal-control label');
  assert.equal(rows.filter(s=>s.includes('QA synced case')).length,0,'linked case must not duplicate its task row');
  cases.push('standalone and linked case labels, without duplicate rows');
  for(const text of ['QA ordinary task','QA manually marked task']){assert.ok(row(text).includes('普通要事'));assert.ok(!row(text).includes('內控(已同步要事)'));}
  cases.push('ordinary/manual confidentiality flags do not imply internal-control synchronization');
  assert.ok(markup.includes('<option value="internal">內控(未同步要事)</option>'));
  assert.ok(markup.includes('<option value="internal-synced">內控(已同步要事)</option>'));
  cases.push('source filters use matching internal-control status labels');
  const props={data,user,vessels,canCreate:true,canEdit:true,canClose:true,canDelete:false,canExport:true,authorizationEpoch:'qa-epoch',onCreate:noWrite,onUpdate:noWrite,onWithdrawTaskSync:noWrite,onDelete:noWrite,onBatchClose:noWrite,onBatchDelete:noWrite,onOpenTask:noWrite};
  const editorOnly=renderToStaticMarkup(React.createElement(InternalControlPage,{...props,editorOnly:true}));
  assert.ok(editorOnly==='','work-center editor host must not render another page, filter or print list');
  const original=renderToStaticMarkup(React.createElement(InternalControlPage,props));
  assert.ok(original.includes('內控未完清單')&&original.includes('內控結案清單')&&original.includes('數據統計'));
  cases.push('editor-only host is inert when closed; original internal-control page is preserved');
  console.log(JSON.stringify({status:'PASS',layer:'actual component SSR; not browser/SQL evidence',cases},null,2));
} finally {await server.close();}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadReceiptTestModule} from './receipt-test-module-loader.mjs';

// Execute the existing App error reporter and render its original guidance JSX.
// This is a client presentation seam, not native SQL or hosted recovery proof.
// Only reviewed local source is compiled; no user input, service response or
// browser text is interpolated as executable code. This runner is not shipped.
const source=fs.readFileSync('src/App.tsx','utf8');
const reporter=source.slice(source.indexOf('  const reportCloudSaveFailure='),source.indexOf('  const confirmCloudSnapshot='));
assert.ok(reporter.startsWith('  const reportCloudSaveFailure='));
const start=source.indexOf("{(visibleSavePhase!=='saved'||pendingTaskCreations.length>0)&&<aside");
const end=source.indexOf("\n      {currentUser.role!=='vessel'&&activeEditLock",start);
assert.ok(start>=0&&end>start,'original App guidance must be found');
const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const renderGuidance=new Function('React','context',transpile(`const {visibleSavePhase,pendingTaskCreations,cloudSourceUnconfirmed,cloudWriteBlocked,cloudSaveOutcomeProblem,hasManagementPrivateDraft,tab}=context; return <>{${source.slice(start+1,end).trim().replace(/\}$/,'')}} </>;`));
{
  const receipt=loadReceiptTestModule('src/cloudBlockReceipt.ts');
  const {cloudErrorMessage}=loadReceiptTestModule('src/cloudSyncError.ts');
  const invoke=new Function('context',transpile(`const {cloudErrorMessage,CloudBlockPatchConfirmedRefreshError,CloudBlockPatchOutcomeUnknownError,hasUnsavedWork,setSavePhase,setCloudSaveOutcomeProblem,setCloudStatus,showSaveToast}=context; ${reporter};return reportCloudSaveFailure;`));
  for(const [id,error,committed] of [
    ['unknown',new receipt.CloudBlockPatchOutcomeUnknownError('qa-operation',{code:'57014',message:'canceling statement due to statement timeout'},new Error('receipt unavailable')),false],
    ['committed-refresh',new receipt.CloudBlockPatchConfirmedRefreshError({ok:true,status:'committed',operationId:'qa-operation',revision:12,updatedAt:'2026-10-13T01:00:00Z',replayed:false},new Error('read unavailable')),true],
  ]){
    const state={visibleSavePhase:'saved',cloudSaveOutcomeProblem:null};
    const context={...receipt,cloudErrorMessage,hasUnsavedWork:{current:false},setSavePhase:v=>{state.visibleSavePhase=v;},setCloudSaveOutcomeProblem:v=>{state.cloudSaveOutcomeProblem=v;},setCloudStatus:()=>{},showSaveToast:()=>{}};
    invoke(context)(error);
    const markup=renderToStaticMarkup(renderGuidance(React,{...state,pendingTaskCreations:[],cloudSourceUnconfirmed:false,cloudWriteBlocked:true,hasManagementPrivateDraft:()=>false,tab:'total'}));
    assert.match(markup,committed?/雲端已確認保存/:/保存結果尚未確認/,`${id}: persistent guidance must agree with the authoritative outcome`);
    assert.doesNotMatch(markup,/同步完成後，再點擊|這些修改還沒有保存到雲端/,'unknown/confirmed outcomes must not instruct blind resubmission');
    assert.match(markup,/請勿重複操作/);
    console.log(`cloud_save_outcome_guidance_${id}=PASS`);
  }
  const normal=renderToStaticMarkup(renderGuidance(React,{visibleSavePhase:'error',pendingTaskCreations:[],cloudSourceUnconfirmed:false,cloudWriteBlocked:true,cloudSaveOutcomeProblem:null,hasManagementPrivateDraft:()=>false,tab:'total'}));
  assert.match(normal,/同步完成後，再點擊/,'proven ordinary conflicts retain their original recovery steps');
  console.log('cloud_save_outcome_guidance_normal_conflict=PASS');
}

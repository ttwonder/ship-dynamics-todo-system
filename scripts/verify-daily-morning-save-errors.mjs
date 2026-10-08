import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createServer} from 'vite';

// Composed original App callbacks; controlled queue I/O, not hosted/UI proof.
const source=fs.readFileSync('src/App.tsx','utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const matches={};
const walk=node=>{if(ts.isVariableDeclaration(node)&&['saveDailyMorningHistory','saveChanges'].includes(node.name.getText(ast))){const name=node.name.getText(ast);assert.ok(!matches[name]);matches[name]=node.initializer.getText(ast);}ts.forEachChild(node,walk);};
walk(ast);assert.equal(Object.keys(matches).length,2);
const code=ts.transpileModule(`globalThis.save=${matches.saveDailyMorningHistory.replaceAll('import.meta.env.DEV','false')};globalThis.headerSave=${matches.saveChanges};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
const cases=[];
try{
  const {upsertDailyMorningReport}=await server.ssrLoadModule('/src/morningHistory.ts');
  const {cloudErrorMessage,isCloudStatementTimeout}=await server.ssrLoadModule('/src/cloudSyncError.ts');
  const {CloudBlockPatchOutcomeUnknownError,CloudBlockPatchConfirmedRefreshError}=await server.ssrLoadModule('/src/cloudBlockReceipt.ts');
  const {appDataContentEqual}=await server.ssrLoadModule('/src/cloudRebase.ts');
  const at='2026-10-08T01:00:00.000Z';
  const config={supabaseUrl:'http://127.0.0.1:1',supabaseAnonKey:'isolated-fixture',workspaceKey:'isolated-fixture',tableName:'ship_dynamics_app_state'};
  function setup(error,{current=true,confirmed=true}={}){
    let queueError=error;
    const actor={id:'owner',role:'owner',name:'QA OWNER',isActive:true};
    const baseline={revision:1,users:[actor],vessels:[],tasks:[],meetings:[],internalControlCases:[],agendaReports:[],auditLogs:[]};
    const events={alerts:[],toasts:[],publications:[],queued:[],queueArgs:[],phases:[],statuses:[]};
    const context={console,structuredClone,currentUser:actor,data:baseline,cloudSaveInFlight:{current:null},cloudSyncInFlight:{current:false},cloudWriteBlocked:false,
      pendingCloudData:{current:{size:()=>0}},dailyMorningSaveRetry:{current:null},originalAuthority:{current:{mode:'records-v1',epoch:1}},authorizationEpoch:'epoch',
      captureReportAction:()=>()=>current,loadRecordActionScope:async()=>true,
      requireFreshItineraryProjection:async()=>({schemaVersion:2,projectionCapturedAt:at,itineraryProjections:{}}),activeVessels:[],
      liveData:{current:baseline},authorizationEpochFor:()=> 'epoch',upsertDailyMorningReport,
      withAudit:data=>data,getSupabaseConfig:()=>config,cloudIdentity:()=> 'fixture-identity',sameCloudConfig:()=>true,
      liveCurrentUserId:{current:actor.id},saveTimer:{current:null},cloudErrorMessage,isCloudStatementTimeout,CloudBlockPatchOutcomeUnknownError,CloudBlockPatchConfirmedRefreshError,
      confirmedCloudData:{current:null},enqueueCloudSave:async(...args)=>{const candidate=args[0];events.queued.push(candidate);events.queueArgs.push(args);events.beforeQueue?.();if(queueError)throw queueError;if(confirmed)context.confirmedCloudData.current=candidate;},
      mergeConfirmedCloudSnapshot:({confirmed})=>confirmed,nowIso:()=>at,
      flushSync:fn=>fn(),setData:value=>events.publications.push(value),saveLocal:()=>{},showSaveToast:(...args)=>events.toasts.push(args),alert:message=>events.alerts.push(String(message)),
      vesselAttentionSaveStates:{},hasUnsavedWork:{current:true},setSavePhase:x=>events.phases.push(x),setCloudStatus:x=>events.statuses.push(x),retainPageDraftFeedback:()=>false,appDataContentEqual,savedStatus:x=>x,
    };
    vm.createContext(context);vm.runInContext(code,context);
    return {context,events,baseline,run:()=>context.save(at),header:()=>context.headerSave(),setError:e=>{queueError=e;}};
  }
  const check=async(caseId,fn)=>{try{await fn();cases.push({caseId,status:'PASS'});}catch(error){cases.push({caseId,status:'FAIL',message:error.message});}};
  await check('MSE01-structured-statement-timeout-not-object-object',async()=>{
    const x=setup({code:'57014',message:'canceling statement due to statement timeout',details:'while applying report patch'});
    assert.equal(await x.run(),false);assert.equal(x.events.alerts.length,1);
    assert.match(x.events.alerts[0],/57014/);assert.match(x.events.alerts[0],/statement timeout/);assert.doesNotMatch(x.events.alerts[0],/\[object Object\]/);
    assert.equal(x.context.liveData.current,x.baseline);assert.equal(x.events.publications.length,0);assert.equal(x.events.toasts.length,0);
  });
  await check('MSE02-error-instance-retains-message-and-no-success',async()=>{
    const x=setup(new Error('controlled transport unavailable'));assert.equal(await x.run(),false);assert.match(x.events.alerts[0],/controlled transport unavailable/);
    assert.equal(x.context.liveData.current,x.baseline);assert.equal(x.events.toasts.length,0);
  });
  await check('MSE03-matching-authoritative-readback-required',async()=>{
    const x=setup(null,{confirmed:false});assert.equal(await x.run(),false);assert.match(x.events.alerts[0],/雲端未回傳/);assert.equal(x.events.publications.length,0);assert.equal(x.events.toasts.length,0);
  });
  await check('MSE04-matching-confirmation-publishes-once',async()=>{
    const x=setup(null);assert.equal(await x.run(),true);assert.equal(x.events.publications.length,1);assert.equal(x.events.alerts.length,0);assert.equal(x.events.toasts.length,1);
    assert.equal(x.context.liveData.current.agendaReports[0].businessDate,'2026-10-08');
  });
  await check('MSE05-stale-action-does-not-enqueue',async()=>{
    const x=setup(null,{current:false});assert.equal(await x.run(),false);assert.equal(x.events.queued.length,0);assert.equal(x.events.alerts.length,0);assert.equal(x.context.liveData.current,x.baseline);
  });
  await check('MSE06-header-retries-unrendered-intent-with-original-base',async()=>{
    const x=setup({code:'57014',message:'canceling statement due to statement timeout'});x.context.confirmedCloudData.current=x.baseline;assert.equal(await x.run(),false);const intended=x.events.queued[0];
    x.context.confirmedCloudData.current={...x.baseline,revision:2};x.setError(null);await x.header();
    assert.equal(x.events.queued.length,2);assert.equal(x.events.queued[1],intended);assert.equal(x.events.queueArgs[1][5].base.revision,1);assert.equal(x.events.queueArgs[1][5].binding.epoch,1);
    assert.equal(x.events.publications.length,1);assert.equal(x.context.dailyMorningSaveRetry.current,null);assert.equal(x.events.toasts.length,1);
  });
  await check('MSE07-stale-retry-no-dispatch-no-already-latest',async()=>{
    const x=setup({code:'57014',message:'canceling statement due to statement timeout'});assert.equal(await x.run(),false);x.context.liveCurrentUserId.current='different-owner';x.context.confirmedCloudData.current=x.baseline;x.setError(null);await x.header();
    assert.equal(x.events.queued.length,1);assert.equal(x.events.publications.length,0);assert.equal(x.events.toasts.length,0);assert.ok(x.context.dailyMorningSaveRetry.current);assert.deepEqual(x.events.phases,['error']);
  });
  await check('MSE08-unknown-or-confirmed-result-not-definite-timeout-retry',async()=>{
    for(const error of [new CloudBlockPatchOutcomeUnknownError('unknown-id'),new CloudBlockPatchConfirmedRefreshError({revision:2})]){
      error.code='57014';const x=setup(error);assert.equal(await x.run(),false);assert.equal(x.context.dailyMorningSaveRetry.current,null);assert.equal(x.events.publications.length,0);assert.equal(x.events.toasts.length,0);
    }
  });
  await check('MSE09-late-timeout-after-actor-change-does-not-retain-successor-retry',async()=>{
    const x=setup({code:'57014',message:'canceling statement due to statement timeout'});x.events.beforeQueue=()=>{x.context.liveCurrentUserId.current='successor';};assert.equal(await x.run(),false);assert.equal(x.context.dailyMorningSaveRetry.current,null);assert.equal(x.events.alerts.length,0);assert.equal(x.events.publications.length,0);
  });
}finally{await server.close();}
console.log(JSON.stringify({status:cases.every(x=>x.status==='PASS')?'PASS':'FAIL',layer:'actual-App-callback-controlled-queue-IO',cases,caseCount:cases.length}));
if(cases.some(x=>x.status==='FAIL'))process.exitCode=1;

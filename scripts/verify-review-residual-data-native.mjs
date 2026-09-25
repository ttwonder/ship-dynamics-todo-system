import assert from 'node:assert/strict';import net from 'node:net';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID,createHash} from 'node:crypto';import {createServer} from 'node:http';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations,installTrackingFieldRevision} from './tracking-browser-fixture.mjs';
const base=path.dirname(fileURLToPath(import.meta.url)),copy=path.resolve(base,'..'),evidence=process.env.QA_EVIDENCE_ROOT;assert.ok(evidence&&path.isAbsolute(evidence)&&!path.resolve(evidence).startsWith(copy+path.sep),'external QA_EVIDENCE_ROOT required');fs.mkdirSync(evidence,{recursive:true});process.chdir(copy);
const mode=process.argv[2];assert.ok(['r5','r7'].includes(mode));const run=fs.mkdtempSync(path.join(evidence,mode+'-native-'));
process.env.QA_VITE_CACHE_DIR=path.join(run,'vite-cache');process.env.QA_HMR_PORT='0';
const receipt={id:mode==='r5'?'R5-F02':'R3-F7',inputIndex:'e3b3c5fc283eb4c41d7974d29f616588b809cd27',candidate:'working bytes; not the index tree',layer:'exported original production helpers + private native PostgreSQL; not mounted UI/hosted',status:'INCOMPLETE',cases:[],sql:[],productionContacted:false};
receipt.inputs=Object.fromEntries(['src/App.tsx','src/ReportDailyHistories.tsx','src/internalControlData.ts','src/tracking/trackingLifecycle.ts','src/dataManagement.ts','src/DataManagementPanel.tsx','src/cloudSourceAuthority.ts','scripts/verify-review-residual-data-native.mjs','scripts/verify-review-residual-data-browser.mjs','scripts/review-residual-history-mounted.jsx','scripts/record-data-management-lifecycle-probe.mjs'].map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
let native,qa,http;
const q=async(c,sql,args=[])=>{try{const result=(await c.query(sql,args)).rows[0]?.r;receipt.sql.push({sql,result});return result;}catch(e){receipt.sql.push({sql,error:{code:e.code,message:e.message}});throw e;}};
const tx=async(c,role,fn)=>{await c.query('begin;set local role '+role);try{const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}};
try{
 native=await createNativeRecordQa(run,receipt,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,tracking:true,taskMember:true,dataManagement:mode==='r7',databaseFactory:async()=>native.adapter});
 receipt.fixtureOrigin=qa.origin;await installTrackingBrowserMigrations(qa.db);await installTrackingFieldRevision(qa.db);
 const db=native.observer,w=qa.workspace;
 const current=async()=> (await q(db,'select read_ship_dynamics_records_v1($1) r',[w])).payload;
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const make=async(b,n,id)=>{
  const operations=buildCloudBlockPatch(b,n),guards=[];
  const keys=new Set(operations.filter(o=>o.kind==='entity'&&['trackingItems','internalControlCases','tasks'].includes(o.collection)).map(o=>o.collection==='trackingItems'?`tracking:${o.entityId}`:o.collection==='internalControlCases'?`${o.expected?'internal-control':'internal-control-create'}:${o.entityId}`:`task:${o.entityId}`));
  for(const s of b.trackingItems||[])keys.add('tracking:'+s.id);
  for(const section of keys){const lease=await q(db,"select claim_ship_dynamics_edit_lock($1,$2,'residual-data-probe','QA',300) r",[w,section]);assert.equal(lease.ok,true);guards.push({section_key:section,locked_by:lease.locked_by,lease_version:lease.lease_version});}
  return [w,id,JSON.stringify(operations),'QA OWNER','qa-owner',JSON.stringify(await q(db,"select ship_dynamics_actor_guard($1::jsonb,'qa-owner') r",[JSON.stringify(b)])),JSON.stringify(await q(db,'select ship_dynamics_authorization_guard($1::jsonb) r',[JSON.stringify(b)])),JSON.stringify(guards)];
 };
 const apply=args=>tx(native.a,'ship_qa',c=>q(c,'select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',args));
 if(mode==='r5'){
  const wf=await qa.loadModule('/src/tracking/trackingWorkflow.ts'),ic=await qa.loadModule('/src/internalControlData.ts');
  const ctx=id=>({actorId:'qa-owner',at:'2026-09-25T10:00:00.000Z',operationId:id});
  const source={id:'residual-engineering',kind:'engineering',requestType:'repair',vesselId:'qa-v1',referenceNo:'RESIDUAL-001',description:'Synthetic repair',applicationDate:'2026-09-24',urgency:'normal',progress:'待處理',supplementalNotes:'',expectedDate:'2026-09-26',deliveryStatus:'not-delivered',isClosed:false,statusLogs:[]};
  let b=await current(),n=wf.runTrackingCommand(b,{type:'create',items:[source]},ctx('source-create'));
  assert.equal((await apply(await make(b,n,'residual-create'))).ok,true);b=await current();
  const item=wf.prefillTrackingCase(b,b.trackingItems.find(x=>x.id===source.id),'residual-case').item;item.syncToTask=true;item.departments=[b.settings.departments[0]];
  n=wf.runTrackingCommand(b,{type:'sync',items:[{id:source.id,expectedUpdatedAt:b.trackingItems.find(x=>x.id===source.id).updatedAt,item,projection:{categories:['其他'],expectedDate:'2026-09-26',ownerUserIds:[],isAbnormal:false}}]},ctx('sync'));
  assert.equal((await apply(await make(b,n,'residual-sync'))).ok,true);b=await current();
  n=wf.runTrackingCommand(b,{type:'lifecycle',action:'close',date:'2026-09-25',targets:[{entry:'tracking',id:source.id,expectedUpdatedAt:b.trackingItems.find(x=>x.id===source.id).updatedAt}]},ctx('close-control'));
  const positive=await apply(await make(b,n,'residual-normal-close'));assert.equal(positive.ok,true);const closeRead=await current();
  assert.equal(closeRead.trackingItems.find(x=>x.id===source.id).isClosed,true);assert.equal(closeRead.internalControlCases.find(x=>x.id==='residual-case').isClosed,true);assert.equal(closeRead.tasks.find(x=>x.id===b.tasks.find(x=>x.internalControlCaseId==='residual-case').id).isClosed,true);
  receipt.cases.push({caseId:'ordinary-source-close-control',status:'PASS',result:positive,readback:{sourceClosed:true,caseClosed:true,taskClosed:true,completionDate:closeRead.trackingItems.find(x=>x.id===source.id).completionDate??null,actualDeliveryDate:closeRead.trackingItems.find(x=>x.id===source.id).actualDeliveryDate??null}});
  b=await current();n=wf.runTrackingCommand(b,{type:'lifecycle',action:'reopen',targets:[{entry:'tracking',id:source.id,expectedUpdatedAt:b.trackingItems.find(x=>x.id===source.id).updatedAt}]},ctx('reopen-control'));assert.equal((await apply(await make(b,n,'residual-normal-reopen'))).ok,true);b=await current();
  n=structuredClone(b);const task=n.tasks.find(x=>x.internalControlCaseId==='residual-case'),old=structuredClone(task);assert.ok(task);task.isInternalControl=false;
  ic.reconcileInternalControlAfterTaskSave(n,old,task,n.users.find(x=>x.id==='qa-owner'),ctx('cancel').at);
  const planned={source:n.trackingItems.find(x=>x.id===source.id),case:n.internalControlCases.find(x=>x.id==='residual-case'),task};
  assert.equal(planned.source.isClosed,true,'cancel internal control must converge tracking source closure');assert.equal(planned.case.isClosed,true);assert.equal(task.isInternalControl,false);
  const result=await apply(await make(b,n,'residual-cancel-internal-control'));assert.equal(result.ok,true,JSON.stringify(result));
  const after=await current();const sourceAfter=after.trackingItems.find(x=>x.id===source.id),caseAfter=after.internalControlCases.find(x=>x.id==='residual-case'),taskAfter=after.tasks.find(x=>x.id===task.id);
  assert.equal(sourceAfter.isClosed,true);assert.equal(caseAfter.isClosed,true);assert.equal(sourceAfter.closedDate,caseAfter.closedDate);assert.equal(taskAfter.isInternalControl,false);assert.ok(!taskAfter.internalControlCaseId);assert.equal(caseAfter.syncToTask,false);assert.ok(!caseAfter.linkedTaskId);
  const originalSource=b.trackingItems.find(x=>x.id===source.id);for(const key of ['linkedCaseId','linkState','deliveryStatus','actualDeliveryDate','completionDate','statusLogs','caseSyncHistory'])assert.deepEqual(sourceAfter[key],originalSource[key],key+' preserved');
  assert.deepEqual(sourceAfter.events.slice(0,-1),originalSource.events);assert.equal(sourceAfter.events.at(-1).action,'close');assert.deepEqual(caseAfter.statusLogs.slice(1),b.internalControlCases.find(x=>x.id==='residual-case').statusLogs);assert.deepEqual(taskAfter.statusLogs,b.tasks.find(x=>x.id===task.id).statusLogs);assert.equal(taskAfter.isClosed,b.tasks.find(x=>x.id===task.id).isClosed);
  receipt.cases.push({caseId:'cancel-from-task',status:'PASS',planned,result,sourceRelationshipHistoryDeliveryPreserved:true,ordinaryTaskPreserved:true});
  fs.writeFileSync(path.join(run,'cancel-full-readback.json'),JSON.stringify({before:b,planned:n,after},null,2));
  const unlinkedBefore=await current(),unlinkedNext=structuredClone(unlinkedBefore),unlinkedCase=unlinkedNext.internalControlCases.find(x=>!x.trackingItemId&&x.syncToTask&&!x.isClosed),unlinkedTask=unlinkedNext.tasks.find(x=>x.id===unlinkedCase.linkedTaskId),unlinkedOld=structuredClone(unlinkedTask);
  unlinkedTask.isInternalControl=false;ic.reconcileInternalControlAfterTaskSave(unlinkedNext,unlinkedOld,unlinkedTask,unlinkedNext.users.find(x=>x.id==='qa-owner'),ctx('unlinked-control').at);
  const unlinkedResult=await apply(await make(unlinkedBefore,unlinkedNext,'residual-unlinked-cancel'));assert.equal(unlinkedResult.ok,true);const unlinkedRead=await current();assert.equal(unlinkedRead.internalControlCases.find(x=>x.id===unlinkedCase.id).isClosed,true);assert.equal(unlinkedRead.tasks.find(x=>x.id===unlinkedTask.id).isInternalControl,false);
  assert.deepEqual(unlinkedRead.trackingItems,unlinkedBefore.trackingItems);
  receipt.cases.push({caseId:'same-task-cancel-without-tracking-source-control',status:'PASS',result:unlinkedResult,readback:{caseClosed:true,taskInternal:false,trackingUnchanged:true}});
  receipt.migrationSha256=createHash('sha256').update(fs.readFileSync('supabase/migrations/20260925160000_tracking_field_revision.sql')).digest('hex');
  receipt.installedValidator=await q(db,"select jsonb_build_object('identity',p.oid::regprocedure::text,'definitionMd5',md5(pg_get_functiondef(p.oid)),'hasConsistencyGuard',position('tracking-lifecycle-inconsistent' in pg_get_functiondef(p.oid))>0,'hasFieldRevision',position('tracking-request-type-kind' in pg_get_functiondef(p.oid))>0) r from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ship_dynamics_tracking_validate_v1'");
  assert.equal(receipt.installedValidator.hasConsistencyGuard,true);assert.equal(receipt.installedValidator.hasFieldRevision,true);receipt.sqlCaller='ship_qa (same native-fixture execution role as local HTTP adapter; anon ACL not claimed, no grants altered)';
  receipt.status='PASS';
 }else{
  const wid=await q(db,'select id r from sd_workspaces where legacy_key=$1',[w]);
  const legacy=()=>q(db,'select to_jsonb(t) r from ship_dynamics_app_state t where workspace_key=$1',[w]);
  const records=()=>q(db,'select read_ship_dynamics_records_v1($1) r',[w]);
  const digest=p=>q(db,'select sd_legacy_jsonb_sha256($1::jsonb) r',[JSON.stringify(p)]);
  let invalidAuthority=false;const methods={read_ship_dynamics_browser_authority_v1:['text'],get_ship_dynamics_record_storage_stats_v1:['text','text'],get_ship_dynamics_storage_stats:['text','text'],prune_ship_dynamics_record_revision_history_v1:['text','text','uuid','jsonb','jsonb'],prune_ship_dynamics_revision_history:['text','text','uuid','jsonb','jsonb']};
  const names=['p_workspace_key','p_actor_user_id','p_operation_id','p_expected_revisions','p_delete_revisions'];receipt.dispatch=[];
  http=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://127.0.0.1').pathname.split('/').pop();assert.ok(methods[name]);const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());assert.equal(body.p_workspace_key,w);const types=methods[name],args=types.map((t,i)=>t==='jsonb'?JSON.stringify(body[names[i]]):body[names[i]]);const row={name,operationId:body.p_operation_id};receipt.dispatch.push(row);try{row.result=await native.adapter.transaction(c=>q(c,`select ${name}(${types.map((t,i)=>'$'+(i+1)+'::'+t).join(',')}) r`,args));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(name==='read_ship_dynamics_browser_authority_v1'&&invalidAuthority?{...row.result,source:'unknown'}:row.result));}catch(e){row.error={code:e.code,message:e.message};res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(row.error));}}catch(e){res.statusCode=500;res.end(JSON.stringify({code:'QA_ADAPTER_ERROR',message:e.message}));}});
  // Windows ephemeral ranges can include Fetch-blocked IRC ports; do not mistake this for a product failure.
  const blockedPorts=new Set([2049,3659,4045,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
  for(let attempt=0;attempt<12;attempt++){await new Promise(r=>http.listen(0,'127.0.0.1',r));const port=http.address().port;if(port>1024&&!blockedPorts.has(port))break;await new Promise(r=>http.close(r));}
  assert.ok(http.listening,'safe loopback bridge port unavailable');receipt.bridgePort=http.address().port;
  const cfg={supabaseUrl:`http://127.0.0.1:${http.address().port}`,supabaseAnonKey:'synthetic-only',workspaceKey:w,tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'scoped-v1'};
  const api=await qa.loadModule('/src/dataManagement.ts'),{authorityConfig}=await qa.loadModule('/src/cloudSourceAuthority.ts');
  const recordStats=await api.getShipDynamicsStorageStats('qa-owner',cfg);assert.equal(recordStats.currentRevision,(await records()).revision);receipt.cases.push({caseId:'normal-records-stats',status:'PASS'});
  const oldPending=api.createPendingRevisionPrune({operationId:randomUUID(),actorUserId:'qa-owner',expectedRevisions:recordStats.revisions.map(x=>x.revision),deleteRevisions:[recordStats.revisions.filter(x=>!x.current).at(-1).revision]},cfg),oldBytes=JSON.stringify(oldPending);
  const beforeAuthority=await q(db,'select read_ship_dynamics_browser_authority_v1($1) r',[w]);assert.equal(beforeAuthority.source,'records-v1');
  const l=await legacy(),r=await records(),h=await digest(l.payload);
  await tx(native.a,'service_role',c=>q(c,'select freeze_ship_dynamics_legacy_writes($1,$2,$3,$4) r',[w,l.revision,h,`freeze:${w}:${l.revision}:${h}`]));
  const frozen=await q(db,'select to_jsonb(t) r from sd_legacy_write_controls t where workspace_key=$1',[w]);
  const transition=randomUUID(),pause=await tx(native.a,'service_role',c=>q(c,'select pause_ship_dynamics_business_v1($1,$2) r',[w,transition]));
  const digestR=await digest(r.payload),sid=randomUUID(),stage=await tx(native.a,'service_role',c=>q(c,'select stage_ship_dynamics_paused_records_to_legacy_v1($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) r',[w,wid,transition,JSON.stringify(pause.watermark),r.revision,digestR,l.revision,h,frozen.frozen_at,sid]));
  const pubid=randomUUID(),pub=await tx(native.a,'service_role',c=>q(c,'select publish_ship_dynamics_source_authority_v2($1,$2,$3,$4,$5::jsonb,$6,$7) r',[w,wid,transition,sid,JSON.stringify(stage),'legacy',pubid]));
  const resumed=await tx(native.a,'service_role',c=>q(c,'select resume_ship_dynamics_source_authority_v2($1,$2,$3,$4,$5::jsonb,$6) r',[w,wid,transition,pubid,JSON.stringify(pub),randomUUID()]));
  const authority=await q(db,'select read_ship_dynamics_browser_authority_v1($1) r',[w]);assert.equal(authority.source,'legacy');assert.equal(authority.admitted,true);
  const content=p=>{p=structuredClone(p);delete p.updatedAt;delete p.revision;return p;};assert.deepEqual(content((await legacy()).payload),content(r.payload));
  receipt.cases.push({caseId:'supported-local-reverse-publication',status:'PASS',beforeAuthority,stage,pub,resumed,authority,fullContentEqual:true});
  const controlConfig=authorityConfig(cfg,authority);
  const rawStats=await api.getShipDynamicsStorageStats('qa-owner',cfg),controlStats=await api.getShipDynamicsStorageStats('qa-owner',controlConfig);
  assert.equal(rawStats.currentRevision,(await legacy()).revision,'new stats must use admitted legacy authority, not raw records mode');assert.equal(controlStats.currentRevision,rawStats.currentRevision);
  receipt.cases.push({caseId:'new-stats-admitted-route',status:'PASS',rawMode:cfg.storageMode,publishedSource:authority.source,rawStats,controlStats});
  const beforeRecord=await records(),beforeLegacy=await legacy(),dispatchStart=receipt.dispatch.length;
  let error;try{await api.pruneShipDynamicsRevisionHistory(oldPending,cfg);}catch(e){error={code:e.code,message:e.message};}
  assert.ok(error);assert.equal(error.message,'source-authority-retired');assert.equal(JSON.stringify(oldPending),oldBytes);assert.deepEqual(receipt.dispatch.slice(dispatchStart).map(x=>x.name),['prune_ship_dynamics_record_revision_history_v1']);assert.deepEqual(await records(),beforeRecord);assert.deepEqual(await legacy(),beforeLegacy);
  receipt.cases.push({caseId:'old-pending-retired-no-reroute',status:'PASS',operationId:oldPending.operationId,error,exactPendingUnchanged:true});
  const selection=rawStats.revisions.filter(x=>!x.current).map(x=>x.revision);assert.ok(selection.length);const op=randomUUID();
  const pending=await api.preparePendingRevisionPrune({operationId:op,actorUserId:'qa-owner',expectedRevisions:rawStats.revisions.map(x=>x.revision),deleteRevisions:[selection.at(-1)]},cfg,rawStats.sourceAuthority);
  const pendingBytes=JSON.stringify(pending),store=new Map(),storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};api.writePendingRevisionPrune(pending,cfg,storage);const restored=api.readPendingRevisionPrune(cfg,'qa-owner',storage);assert.equal(JSON.stringify(restored),pendingBytes,'new binding survives pending persistence without changing original request');
  const normal=await api.pruneShipDynamicsRevisionHistory(restored,cfg);assert.equal(normal.ok,true);assert.equal(normal.deletedCount,1);const readback=await api.getShipDynamicsStorageStats('qa-owner',cfg);assert.ok(!readback.revisions.some(x=>x.revision===selection.at(-1)));assert.deepEqual(await legacy(),beforeLegacy);assert.deepEqual(await records(),beforeRecord);
  receipt.cases.push({caseId:'new-prune-admitted-route',status:'PASS',normal,readback,currentSourcesUnchanged:true,pendingPayloadUnchanged:JSON.stringify(restored)===pendingBytes});
  const negativeStart=receipt.dispatch.length;invalidAuthority=true;await assert.rejects(()=>api.getShipDynamicsStorageStats('qa-owner',cfg),/browser-authority-invalid-response/);await assert.rejects(()=>api.preparePendingRevisionPrune({operationId:randomUUID(),actorUserId:'qa-owner',expectedRevisions:[1,2],deleteRevisions:[1]},cfg),/browser-authority-invalid-response/);invalidAuthority=false;assert.ok(receipt.dispatch.slice(negativeStart).every(x=>x.name==='read_ship_dynamics_browser_authority_v1'));receipt.cases.push({caseId:'unknown-authority-no-dispatch',status:'PASS',layer:'client invalid-authority-response negative; no business RPC'});
  fs.writeFileSync(path.join(run,'authority-full-readback.json'),JSON.stringify({beforeRecord,beforeLegacy,afterRecord:await records(),afterLegacy:await legacy(),stats:readback},null,2));receipt.status='PASS';

 }
}catch(e){receipt.status='FAIL';receipt.error={message:e.message,stack:e.stack,code:e.code};process.exitCode=1;}
finally{if(http){http.closeAllConnections();await new Promise(r=>http.close(r));}if(qa)await qa.close();if(native)await native.close();const closed=p=>new Promise(r=>{const s=net.connect({host:'127.0.0.1',port:p});s.once('connect',()=>{s.destroy();r(false);});s.once('error',()=>r(true));s.setTimeout(1000,()=>{s.destroy();r(false);});});receipt.fixtureHttpPortClosed=receipt.fixtureOrigin?await closed(Number(new URL(receipt.fixtureOrigin).port)):true;receipt.bridgePortClosed=receipt.bridgePort?await closed(receipt.bridgePort):true;save();}
console.log(JSON.stringify({id:receipt.id,status:receipt.status,receipt:path.join(run,'receipt.json'),cases:receipt.cases.map(x=>({caseId:x.caseId,status:x.status})),error:receipt.error,cleanup:{stopped:receipt.stopped,portClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved}}));

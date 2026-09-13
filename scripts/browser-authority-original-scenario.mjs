import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createAuthorityBOracle} from './browser-authority-b-oracle.mjs';
import {reloadProbe} from './browser-authority-reload-scenario.mjs';
export async function primary({a,qa,native,call,until,wait,read,receipt,save,hash,write,setCase,outgoing}) {
 const mode=process.env.QA_BROWSER_AUTHORITY_MODE||'direct';
 assert.ok(['direct','lost-ack','target-conflict','target-auth-conflict','lost-B-ack','reload'].includes(mode));receipt.mode=mode;
 const vesselIntent=mode==='target-conflict';
 const patch='apply_ship_dynamics_record_patch_v1',field=`[...document.querySelectorAll('.management-form label')].find(n=>n.textContent===${JSON.stringify(vesselIntent?'完整船名':'姓名')})?.querySelector('input')`;
 const q=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
 const eq=(x,y,label)=>assert.ok(isDeepStrictEqual(x,y),label);
 const pass=(caseId,layer,detail={})=>{receipt.cases.push({caseId,layer,status:'PASS',...detail});save();};
 const state=()=>a.eval(`({value:(${field})?.value,sameNode:window.__lateNode===(${field}),global:document.querySelector('.save-toast.success')?.textContent||'',local:document.querySelector('.management-save-toast')?.textContent||'',strip:document.querySelector('.save-status-strip')?.className||'',feedback:[...document.querySelectorAll('.save-toast,.save-status-strip,.management-save-toast')].map(n=>n.textContent).join('|'),identity:document.body.innerText.includes('QA OWNER')&&!document.body.innerText.includes('人員登入／切換'),sameDocument:window.__authorityDocument===document,config:JSON.stringify(window.SHIP_DYNAMICS_SUPABASE_CONFIG)})`);
 const safe=s=>({valueHash:hash(s.value),sameNode:s.sameNode,identity:s.identity,sameDocument:s.sameDocument,globalSuccess:Boolean(s.global),localFeedback:Boolean(s.local),saved:s.strip.includes('saved'),saving:s.strip.includes('saving'),feedbackHash:hash(s.feedback),retiredFeedback:s.feedback.includes('source-authority-retired'),unsavedFeedback:s.feedback.includes('尚未保存')||s.feedback.includes('保存未完成'),configHash:hash(s.config)});
 const op=async(name,sql,args)=>{const c=await native.connect('operator_'+name);let value;try{await c.query('begin;set local role service_role');value=await q(c,sql,args);await c.query('commit');receipt.operatorTransactions??=[];receipt.operatorTransactions.push({name,pid:c.processID,serviceRole:true,committed:true,requestHash:hash(args),result:value});save();return value;}catch(e){await c.query('rollback');throw e;}finally{await c.end();}};
 const w=qa.workspace,wid=await q(native.observer,'select id r from sd_workspaces where legacy_key=$1',[w]);
 const legacy=()=>q(native.observer,'select to_jsonb(t) r from ship_dynamics_app_state t where workspace_key=$1',[w]);
 const ctl=()=>q(native.observer,'select to_jsonb(t) r from sd_legacy_write_controls t where workspace_key=$1',[w]);
 const digest=p=>q(native.observer,'select sd_legacy_jsonb_sha256($1::jsonb) r',[JSON.stringify(p)]);
 const tables=(await native.observer.query('select * from ship_dynamics_quiescence_private.tables_v1()')).rows;
 const full=async label=>{const c=await native.connect('fresh_full_'+label),result={};try{for(const {table_name,key_column} of tables){assert.match(table_name,/^[a-z_]+$/);assert.match(key_column,/^[a-z_]+$/);result[table_name]=(await c.query(`select to_jsonb(t) as value,xmin::text,ctid::text from public.${table_name} t where ${key_column}=$1 order by to_jsonb(t)::text`,[key_column==='workspace_key'?w:wid])).rows;}write('full-'+label,{encoding:'SHA256(JSON.stringify(all complete ordered native rows including xmin/ctid)); raw credential-bearing rows remain in memory',tables:Object.fromEntries(Object.entries(result).map(([k,v])=>[k,{rows:v.length,hash:hash(v)}])),completeHash:hash(result),connectionPid:c.processID});return result;}finally{await c.end();}};
 const authority=()=>op('read_authority','select read_ship_dynamics_source_authority_v1($1) r',[w]);
 const l0=await legacy(),h0=await digest(l0.payload);
 setCase('A00-original-login-target-frozen');
 await op('freeze','select freeze_ship_dynamics_legacy_writes($1,$2,$3,$4) r',[w,l0.revision,h0,`freeze:${w}:${l0.revision}:${h0}`]);
 const frozen=await ctl();assert.equal(frozen.writes_frozen,true);eq(await legacy(),l0,'QA_freeze_business_unchanged');
 await a.click('管理');await until(()=>a.eval("Boolean(document.querySelector('.management-view'))"),'management ready');
 await a.activate(`[...document.querySelectorAll('.management-sidebar button')].find(n=>n.textContent.endsWith(${JSON.stringify(vesselIntent?'船舶':'人員')}))`);
 const display=vesselIntent?(await qa.loadModule('/src/vesselDisplay.ts')).vesselDisplayName(l0.payload.vessels.find(v=>v.id==='qa-v2')):'QA SPARE';
 await a.activate(`[...document.querySelectorAll('.management-master .management-list button')].find(n=>n.querySelector('b')?.innerText===${JSON.stringify(display)})`);
 await a.eval(`void(window.__lateNode=${field});void(window.__authorityDocument=document)`);
 const initialState=await state();assert.equal(initialState.identity,true);const configHash=hash(initialState.config);assert.equal(JSON.parse(initialState.config).storageMode,'records-v1');
 const before=await read(),committedName='A-'+randomUUID(),newerName='B-'+randomUUID();let release,held=false,operationId;
 receipt.syntheticInputs={AHash:hash(committedName),BHash:hash(newerName),rawValuesPersisted:false};receipt.screenshotPolicy={captured:0,viewed:0,reason:'Suppressed credential-bearing original personnel form; all UI evidence is DOM, not image proof'};
 pass('A00-original-login-target-frozen','original-UI-plus-operator-SQL',{configHash,recordConfigured:true,targetFrozen:true});
 qa.setRecordFault({after:async({name,body,value})=>{if(name===patch&&!held){assert.equal(value.ok,true,'QA_A_SQL_not_ACK');operationId=body.p_operation_id;held=true;await new Promise(r=>release=r);return mode==='lost-ack';}return false;}});
 try {
  setCase('A01-original-A-commit-held-HTTP');await a.fill(field,committedName);await a.click('保存變更');await until(()=>held,'HTTP held after actual SQL COMMIT');
  const committed=await read();assert.equal(vesselIntent?committed.payload.vessels.find(v=>v.id==='qa-v2').fullName:committed.payload.users.find(u=>u.id==='qa-spare').name,committedName,'QA_A_source_name');
  const tx=receipt.httpTransactions.find(r=>r.rpc===patch&&r.operationId===operationId&&r.committed);assert.ok(tx,'QA_A_native_COMMIT');
  assert.equal(receipt.network.some(r=>r.operationId===operationId&&r.finished),false);
  const original=outgoing.find(r=>r.body.p_operation_id===operationId);assert.ok(original);const immutableAHash=hash(original.body);assert.equal(tx.payloadHash,immutableAHash);
  eq(await legacy(),l0,'QA_A_target_still_T0');const postA=await full('post-A');
  receipt.heldCommit={operationId,pid:tx.pid,payloadHash:immutableAHash,revision:committed.revision,sourceHash:hash(committed),committed:true,httpUnfinished:true};
  pass('A01-original-A-commit-held-HTTP','original-UI-native-PG',{operationId,revision:committed.revision,pid:tx.pid});
  setCase('A02-newer-B-unsent-same-DOM');await a.fill(field,newerName);let s=await state();assert.ok(s.value===newerName&&s.sameNode&&s.identity&&s.sameDocument,'QA_B_native_DOM');
  assert.equal(hash(s.config),configHash);assert.equal(JSON.stringify(committed.payload).includes(newerName),false);assert.equal(JSON.stringify((await legacy()).payload).includes(newerName),false);
  write('B-held',safe(s));pass('A02-newer-B-unsent-same-DOM','original-UI-native-PG',{sameNode:true,absentSourceAndTarget:true});
  await a.eval("void(window.__lateSuccess=[]);void(window.__lateObserver=new MutationObserver(()=>{if(document.querySelector('.save-toast.success'))window.__lateSuccess.push(Date.now());}));window.__lateObserver.observe(document.body,{childList:true,subtree:true,characterData:true})");
  setCase('A03-pause-stage-publish-while-paused');const transition=randomUUID(),stageId=randomUUID(),pubId=randomUUID();
  const pause=await op('pause','select pause_ship_dynamics_business_v1($1,$2) r',[w,transition]);assert.equal(pause.state,'paused');
  const stage=await op('stage','select stage_ship_dynamics_paused_records_to_legacy_v1($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) r',[w,wid,transition,JSON.stringify(pause.watermark),committed.revision,await digest(committed.payload),l0.revision,h0,frozen.frozen_at,stageId]);
  assert.equal(stage.state,'staged-paused');const expectedTarget={...committed.payload,revision:stage.targetRevision,updatedAt:stage.targetUpdatedAt};eq((await legacy()).payload,expectedTarget,'QA_full_target_expected_source_plus_ACK_metadata');assert.equal(await digest(expectedTarget),stage.targetSha256);
  const published=await op('publish','select publish_ship_dynamics_source_authority_v1($1,$2,$3,$4,$5::jsonb,$6) r',[w,wid,transition,stageId,JSON.stringify(stage),pubId]);
  assert.equal(published.state,'published-paused');assert.equal(published.source,'legacy');assert.equal(published.epoch,1);const pubRead=await authority();assert.equal(pubRead.pauseState,'paused');assert.equal(pubRead.publicationPhase,'published-paused');assert.equal(pubRead.admitted,false);assert.equal((await ctl()).writes_frozen,true);
  const stagedFull=await full('published-paused');for(const t of Object.keys(postA))if(!['ship_dynamics_app_state','ship_dynamics_app_revisions'].includes(t))eq(stagedFull[t],postA[t],'QA_stage_unchanged_'+t);
  eq(await read(),committed,'QA_source_unchanged_after_stage');
  pass('A03-pause-stage-publish-while-paused','operator-native-PG',{source:'legacy',epoch:1,stillPaused:true,fullTargetEquality:true,independentStoresUnchanged:true,browserAuthorityAdoptionProven:false});
  setCase('A04-old-A-ACK-reconciliation-while-paused');const releaseStart=receipt.network.length;release();release=null;
  await until(()=>receipt.network.some(r=>r.rpc===patch&&r.operationId===operationId&&r.finished&&(mode==='lost-ack'?r.httpStatus===503:r.ok)),'historical A response released');await until(async()=>!(await state()).strip.includes('saving'),'old ACK settled');await wait(500);
  s=await state();write('old-A-reconciliation',safe(s));assert.ok(s.sameNode&&s.value===newerName&&s.identity&&s.sameDocument,'QA_B_retained_after_old_ACK');assert.equal(hash(s.config),configHash);assert.equal(s.global,'');assert.equal(s.local,'');assert.ok(!s.strip.includes('saved'));assert.equal((await a.eval('window.__lateSuccess')).length,0);
  eq(await full('old-A-reconciled'),stagedFull,'QA_old_ACK_no_mutation');assert.equal((await authority()).pauseState,'paused');assert.equal(hash(original.body),immutableAHash);
  // Exact terminal receipt lookup is separate operator evidence, never browser source adoption.
  const b=original.body,params=[b.p_workspace_key,b.p_operation_id,JSON.stringify(b.p_operations),b.p_saved_by,b.p_actor_user_id,JSON.stringify(b.p_actor_guard),JSON.stringify(b.p_authorization_guard),JSON.stringify(b.p_lock_guards)];
  const recovery=await native.connect('operator_old_A_receipt');let recovered;try{await recovery.query('begin');recovered=await q(recovery,'select get_ship_dynamics_record_receipt_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',params);await recovery.query('commit');}finally{await recovery.end();}
  write('old-A-receipt',{operatorOnly:true,hash:hash(recovered),ok:recovered?.ok,status:recovered?.status,revision:recovered?.revision,operationId,requestHash:immutableAHash});
  receipt.oldAReconciliation={browserReceiptLookups:receipt.network.slice(releaseStart).filter(r=>r.rpc==='get_ship_dynamics_record_receipt_v1').length,browserReadbacks:receipt.network.slice(releaseStart).filter(r=>/^read_ship_dynamics_record/.test(r.rpc)).length,directHistoricalAck:mode!=='lost-ack',operatorReceiptHash:hash(recovered),sameNewerDraft:true,successSuppressed:true};
  if(mode==='lost-ack'){
   const lookups=outgoing.filter(r=>r.rpc==='get_ship_dynamics_record_receipt_v1'&&r.body.p_operation_id===operationId);
   assert.equal(lookups.length,1,'lost A ACK reconciles once in the original browser');eq(lookups[0].body,original.body,'exact immutable A envelope, not B');
   assert.ok(receipt.network.some(r=>r.rpc==='get_ship_dynamics_record_receipt_v1'&&r.operationId===operationId&&r.finished&&r.ok),'browser receives successful terminal receipt while paused');
   assert.equal(outgoing.filter(r=>r.rpc===patch&&r.body.p_operation_id===operationId).length,1,'no mutation resend');
   pass('BA-A04-browser-lost-ACK-exact-receipt','original-UI-native-PG',{sameOperation:true,whilePaused:true,noMutationResend:true});
  }
  pass('A04-old-A-ACK-reconciliation-while-paused','original-UI-native-PG',receipt.oldAReconciliation);qa.setRecordFault(null);
  setCase('A05-atomic-bound-target-resume');const resumed=await op('resume','select resume_ship_dynamics_legacy_authority_v1($1,$2,$3,$4,$5::jsonb,$6) r',[w,wid,transition,pubId,JSON.stringify(published),randomUUID()]);assert.equal(resumed.state,'resumed');const resumeRead=await authority();assert.equal(resumeRead.admitted,true);assert.equal(resumeRead.source,'legacy');assert.equal(resumeRead.epoch,published.epoch);assert.equal((await ctl()).writes_frozen,false);eq(await full('resumed'),stagedFull,'QA_resume_no_business_write');
  pass('A05-atomic-bound-target-resume','operator-native-PG',{source:'legacy',epoch:published.epoch,admitted:true,atomicControlsReadBack:true});
  const oracle=await createAuthorityBOracle({native,qa,legacy,intent:{kind:vesselIntent?'vessel-name':'person',id:vesselIntent?'qa-v2':'qa-spare',name:newerName},mode,receipt,save});qa.setRecordFault(oracle.fault);
  setCase('A06-original-B-save-selected-route');const start=receipt.network.length;await a.click('保存變更');
  await until(()=>receipt.network.slice(start).find(r=>[patch,'apply_ship_dynamics_block_patch_v2'].includes(r.rpc)&&r.finished),'B actual HTTP result');
  await until(async()=>!(await state()).strip.includes('saving'),'B original UI settled');await wait(1000);
  const responses=receipt.network.slice(start).filter(r=>['apply_ship_dynamics_record_patch_v1','apply_ship_dynamics_block_patch_v2','get_ship_dynamics_block_patch_receipt'].includes(r.rpc)&&r.finished);
  const response=responses.findLast(r=>r.ok||r.receiptStatus==='committed')||responses.at(-1);assert.ok(response);
  s=await state();write('B-save-final',safe(s));const finalFull=await full('final-B');const finalSource=await read(),finalTarget=await legacy();
  receipt.BOutcome={route:response.rpc,operationId:response.operationId,payloadHash:response.payloadHash,httpStatus:response.httpStatus,code:response.code,messageCode:response.message,ok:response.ok===true||response.receiptStatus==='committed',receiptStatus:response.receiptStatus,ui:safe(s),sourceHash:hash(finalSource),targetHash:hash(finalTarget),sourceContainsB:JSON.stringify(finalSource.payload).includes(newerName),targetContainsB:JSON.stringify(finalTarget.payload).includes(newerName),requests:receipt.network.slice(start).map(({rpc,operationId,payloadHash,httpStatus,code,ok,finished})=>({rpc,operationId,payloadHash,httpStatus,code,ok,finished})),sql:receipt.httpTransactions.filter(t=>t.operationId===response.operationId)};
  assert.equal(hash(s.config),configHash,'QA_config_unchanged');assert.ok(s.sameDocument&&s.sameNode&&s.identity&&s.value===newerName,'QA_final_B_retained');
  assert.equal(response.rpc,mode==='lost-B-ack'?'get_ship_dynamics_block_patch_receipt':'apply_ship_dynamics_block_patch_v2','BA-UI-B must use the published legacy route');
  assert.equal(response.ok===true||response.receiptStatus==='committed',mode!=='target-auth-conflict','BA-UI-B respects the original authorization conflict policy');
  assert.equal(receipt.BOutcome.targetContainsB,mode!=='target-auth-conflict');assert.equal(receipt.BOutcome.sourceContainsB,false);
  if(mode==='target-auth-conflict'){assert.equal(s.global,'');assert.ok(!s.strip.includes('saved'));assert.ok(safe(s).unsavedFeedback);}
  if(mode==='lost-B-ack'){
   const submitted=outgoing.filter(r=>r.rpc==='apply_ship_dynamics_block_patch_v2'&&r.body.p_operation_id===response.operationId);
   const recoveredB=outgoing.filter(r=>r.rpc==='get_ship_dynamics_block_patch_receipt'&&r.body.p_operation_id===response.operationId);
   assert.equal(submitted.length,1);assert.equal(recoveredB.length,1);eq(submitted[0].body,recoveredB[0].body,'B exact original request recovery');
   assert.equal(response.receiptStatus,'committed');assert.equal(response.revision,finalTarget.revision);
   pass('BA-B09-browser-lost-ACK-exact-receipt','original-UI-native-PG',{noMutationResend:true,sameOperation:true});
  }
  eq(finalSource,committed,'BA-UI-retired-source-unchanged');
  for(const table of Object.keys(stagedFull))if(!['ship_dynamics_app_state','ship_dynamics_app_revisions','ship_dynamics_block_operations'].includes(table))eq(finalFull[table],stagedFull[table],'BA-UI-independent-'+table);
  assert.equal(finalFull.ship_dynamics_block_operations.length,stagedFull.ship_dynamics_block_operations.length+(mode==='target-conflict'?2:1));
  receipt.BOracle=oracle.verify(finalTarget);
  pass('A06-original-B-save-selected-route','original-UI-native-PG',{route:response.rpc,operationId:response.operationId,targetBCommitCount:mode==='target-auth-conflict'?0:1,sameDocument:true,sameNode:true,unchangedConfig:true,retiredSourceAndIndependentStoresUnchanged:true});
  receipt.status='PASS';
  write('operator-final-authority',await authority());eq(await full('final-after-observation'),finalFull,'QA_no_trailing_business_mutation');
  receipt.firstSequenceNoRefreshNoManualRebaseNoForcedTarget=true;save();
  if(mode==='reload')await reloadProbe({a,qa,call,until,receipt,save,hash,legacy,full,before:finalFull,configHash,name:newerName,createAuthorityBOracle,native,setCase});
  else receipt.noRefreshNoManualRebaseNoForcedTarget=true;save();
 } finally {release?.();qa.setRecordFault(null);try{await a.eval('window.__lateObserver?.disconnect()');}catch{}}
}

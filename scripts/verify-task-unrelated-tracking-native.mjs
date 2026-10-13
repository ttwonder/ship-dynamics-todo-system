import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations,installTrackingFieldRevision} from './tracking-browser-fixture.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'task-tracking-native-'));
const evidence={label:'原生 PostgreSQL＋中性測試資料，非正式 Supabase',status:'RUNNING',productionContacted:false,cases:[],measurements:[]};
const signature='public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)',afterSignature='public.ship_dynamics_tracking_after_v1(text,text,text,jsonb)';
const migration='supabase/migrations/20261013110000_task_unrelated_tracking_fast_path.sql';
let native,qa,probe,failure;const casePass=id=>{evidence.cases.push({caseId:id,status:'PASS'});};
try{
 native=await createNativeRecordQa(run,evidence);
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,tracking:true,taskMember:true,hmr:false,databaseFactory:async()=>native.adapter});
 await installTrackingBrowserMigrations(qa.db);await installTrackingFieldRevision(qa.db);
 for(const name of ['20260929120000_tracking_delivery_close.sql','20260929180000_tracking_completion_close.sql','20261008090000_tracking_unrelated_patch_fast_path.sql'])await qa.db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 const catalog=async()=>(await qa.db.query('select oid::text,prosrc,proacl::text,prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
 const definition=(await qa.db.query('select pg_get_functiondef($1::regprocedure) d',[signature])).rows[0].d;
 const predecessor=await catalog();evidence.predecessorMd5=createHash('md5').update(predecessor.prosrc.replaceAll('\r','')).digest('hex');assert.equal(evidence.predecessorMd5,'33cb06e2cd442c1ff80d5e0f75376287');
 const sources=Array.from({length:1102},(_,i)=>({id:'qa-cost-'+i,vesselId:i%2?'qa-v1':'qa-v2',kind:i%2?'supply':'engineering',requestType:i%2?'spares':'repair',referenceNo:'QA-'+i,description:'Neutral tracking source '+i,applicationDate:'2026-09-01',isClosed:false,linkState:'none',events:[],statusLogs:[],progress:'',createdBy:'qa-owner',updatedBy:'qa-owner',qaOpaque:{keep:null}}));
 const put=async(collection,id,value)=>qa.db.transaction(async tx=>{await tx.query('select public.ship_dynamics_record_writer_gate_v1($1,true)',[qa.workspace]);await tx.query('insert into public.ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,$2,$3,$4::jsonb,1) on conflict(workspace_key,collection,entity_id) do update set value=excluded.value',[qa.workspace,collection,id,JSON.stringify(value)]);await tx.query('update public.ship_dynamics_record_collections set ids=ids||jsonb_build_array($3::text) where workspace_key=$1 and collection=$2 and not (ids ? $3::text)',[qa.workspace,collection,id]);});
 await qa.db.transaction(async tx=>{
  await tx.query('select public.ship_dynamics_record_writer_gate_v1($1,true)',[qa.workspace]);
  await tx.query("insert into public.ship_dynamics_record_collections(workspace_key,collection,ids) values($1,'trackingItems','[]'::jsonb) on conflict(workspace_key,collection) do nothing",[qa.workspace]);
  await tx.query("insert into public.ship_dynamics_records(workspace_key,collection,entity_id,value,revision) select $1,'trackingItems',x->>'id',x,1 from jsonb_array_elements($2::jsonb) x",[qa.workspace,JSON.stringify(sources)]);
  await tx.query("update public.ship_dynamics_record_collections set ids=$2::jsonb where workspace_key=$1 and collection='trackingItems'",[qa.workspace,JSON.stringify(sources.map(s=>s.id))]);
 });
 evidence.fixture={trackingSources:1102,vessels:2,synthetic:true};
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const base=(await qa.read()).payload,template=base.tasks.find(t=>t.id==='qa-unrelated-task');assert.ok(template);
 const newTask=(id,vesselId)=>({...structuredClone(template),id,vesselId,vesselIds:[vesselId],vesselProgress:[{vesselId,status:'',isClosed:false,statusLogs:[]}],description:'QA ordinary new task '+id,isInternalControl:false,internalControlCaseId:undefined,createdBy:'qa-owner',updatedBy:'qa-owner'});
 const next=structuredClone(base);next.tasks.unshift(newTask('qa-fast-new-v1','qa-v1'));
 const ops=buildCloudBlockPatch(base,next),guard=(await qa.db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(base),'qa-owner'])).rows[0].r;
 const validate=async(operations=ops)=>{try{return {value:(await probe.query('select public.ship_dynamics_tracking_validate_v1($1,$2::jsonb,$3,$4::jsonb,$5::jsonb) r',[qa.workspace,JSON.stringify(operations),'qa-owner',JSON.stringify(guard),'[]'])).rows[0].r};}catch(e){return {code:e.code,message:e.message};}};
 probe=await native.connect('cost_probe');
 const start=performance.now();assert.deepEqual(await validate(),{value:null});evidence.measurements.push({stage:'unmodified-validator',ms:Math.round(performance.now()-start),instrumented:false});
 const businessBefore=await qa.read();
 if(!process.argv.includes('--before-upgrade')){
  const sql=fs.readFileSync(migration,'utf8');evidence.migrationSha256=createHash('sha256').update(sql).digest('hex');
  await qa.db.exec(sql);await qa.db.exec(sql.replaceAll('\n','\r\n'));
  const installed=await catalog();for(const k of ['oid','proacl','prosecdef','provolatile','proconfig'])assert.deepEqual(installed[k],predecessor[k]);
  assert.deepEqual(await qa.read(),businessBefore);evidence.installedMd5=createHash('md5').update(installed.prosrc.replaceAll('\r','')).digest('hex');
  casePass('TU01-forward-rerun-preserves-OID-ACL-settings-and-business-data');
 }
 // Instrument ONLY the owned helper; counts are helper invocations, not table
 // scans or hosted timing. Restore its exact definition before real writes.
 const helperDef=(await qa.db.query('select pg_get_functiondef($1::regprocedure) d',[afterSignature])).rows[0].d;
 const helperSource=(await qa.db.query('select prosrc from pg_proc where oid=$1::regprocedure',[afterSignature])).rows[0].prosrc.trim().replace(/;$/,'');
 await qa.db.exec(`create or replace function public.ship_dynamics_tracking_after_v1(w text,c text,i text,ops jsonb) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $qa$ begin raise notice 'QA_AFTER_INVOCATION'; return (${helperSource}); end $qa$;`);
 let calls=0;probe.on('notice',n=>{if(n.message==='QA_AFTER_INVOCATION')calls++;});
 assert.deepEqual(await validate(),{value:null});evidence.unrelatedHelperInvocations=calls;
 await qa.db.exec(helperDef);
 assert.equal(calls,0,'ordinary unlinked task must not run one tracking helper pair per unrelated source');
 casePass('TU02-ordinary-new-task-zero-unrelated-helper-invocations');
 const installedDefinition=(await qa.db.query('select pg_get_functiondef($1::regprocedure) d',[signature])).rows[0].d;
 const compare=async(id,operations=ops)=>{
  await qa.db.exec(definition);const old=await validate(operations);await qa.db.exec(installedDefinition);const current=await validate(operations);assert.deepEqual(current,old,id+' predecessor parity');casePass(id);return current;
 };
 const source=sources[0];
 for(const [label,value] of [['null',null],['scalar',4],['object',{}],['text','bad']]){await put('trackingItems',source.id,{...source,events:value});const result=await compare('TU03-malformed-events-'+label);assert.equal(result.code,'22023');}
 const noEvents={...source};delete noEvents.events;await put('trackingItems',source.id,noEvents);assert.deepEqual(await compare('TU04-absent-events-keeps-legacy-empty-array-semantics'),{value:null});
 const orphanCase={id:'qa-dangling-case',vesselId:source.vesselId,linkedTaskId:'qa-fast-new-v1',trackingItemId:source.id,syncToTask:true,isClosed:false};
 await put('internalControlCases',orphanCase.id,orphanCase);await put('trackingItems',source.id,{...source,linkState:'active',linkedCaseId:orphanCase.id});
 assert.equal((await compare('TU05-dangling-existing-case-to-new-task-still-validates')).value,'tracking-task-link-inconsistent');
 await put('trackingItems',source.id,{...source,linkState:'active',linkedCaseId:orphanCase.id,deletion:{reason:'retained'},isClosed:true});
 await compare('TU06-retained-closed-source-link-is-not-filtered-out');
 await put('trackingItems',source.id,source);
 const caseOps=[...ops,{kind:'entity',collection:'internalControlCases',entityId:orphanCase.id,expected:orphanCase,value:{...orphanCase,trackingItemId:source.id,trackingLinkState:'active'}}];
 assert.equal((await compare('TU07-mixed-case-request-retains-reverse-link-check',caseOps)).value,'tracking-link-inconsistent');
 // Exact original mutation RPC, stable request identity, actual lease/CAS and
 // authoritative readback. No execution-role claim for hosted browser grants.
 const submit=async(id,vessel='qa-v1',bad=null)=>{
  const before=(await qa.read()).payload,after=structuredClone(before);after.tasks.unshift(newTask(id,vessel));const operations=buildCloudBlockPatch(before,after),key=`task-create:v2:${vessel}:${id}`,owner='qa-fast-owner';
  const lease=(await qa.db.query('select public.claim_ship_dynamics_edit_lock($1,$2,$3,$4,75) r',[qa.workspace,key,owner,'QA OWNER'])).rows[0].r;assert.equal(lease.ok,true);
  const actor=(await qa.db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(before),'qa-owner'])).rows[0].r;
  if(bad==='cas')operations.find(o=>o.kind==='order'&&o.collection==='tasks').expectedIds=[];
  const args=[qa.workspace,'qa-operation-'+id,JSON.stringify(operations),'QA OWNER','qa-owner',JSON.stringify(actor),null,JSON.stringify(bad==='lease'?[]:[{section_key:key,locked_by:owner}])];
  try{const began=performance.now();const result=(await qa.db.query('select public.apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',args)).rows[0].r;evidence.measurements.push({stage:'real-writer-'+id,ms:Math.round(performance.now()-began),instrumented:false});if(bad){assert.equal(result.ok,false);assert.deepEqual((await qa.read()).payload,before);}else{assert.equal(result.ok,true,JSON.stringify(result));const readback=await qa.read();assert.equal(readback.payload.tasks.filter(t=>t.id===id).length,1);assert.equal(readback.revision,before.revision+1);const replay=(await qa.db.query('select public.apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',args)).rows[0].r;assert.equal(replay.replayed,true);assert.deepEqual(await qa.read(),readback);}}
  finally{await qa.db.query('select public.release_ship_dynamics_edit_lock($1,$2,$3)',[qa.workspace,key,owner]);}
 };
 for(const [id,vessel] of [['qa-writer-one','qa-v1'],['qa-writer-two','qa-v2']])await submit(id,vessel);casePass('TU08-cross-vessel-create-exact-readback-and-replay-once');
 for(const bad of ['lease','cas'])await submit('qa-negative-'+bad,'qa-v1',bad);casePass('TU09-missing-lease-and-CAS-reject-with-zero-business-write');
 const beforeUnknown=await qa.read();await qa.db.exec(installedDefinition.replace('begin','begin -- unknown QA predecessor'));
 await assert.rejects(qa.db.exec(fs.readFileSync(migration,'utf8')),/task-unrelated-tracking-predecessor-mismatch/);await qa.db.exec('rollback');await qa.db.exec(installedDefinition);assert.deepEqual(await qa.read(),beforeUnknown);casePass('TU10-unknown-function-refused-without-overwrite');
 const rb=fs.readFileSync('supabase/verification/task-unrelated-tracking-readback.sql','utf8');
 await probe.query('begin read only');
 try{
  evidence.readback=(await probe.query(rb)).rows[0];assert.equal(evidence.readback.status,'PASS');
  const wrong=rb.replaceAll('a4e8072efb82e2c64d87f8d664eb9f58','00000000000000000000000000000000');
  assert.equal((await probe.query(wrong)).rows[0].status,'UNKNOWN_PREDECESSOR','wrong offered fingerprint cannot report installed');
 }finally{await probe.query('rollback');}
 evidence.readOnlyReadbackVerified=true;
}catch(e){failure=e;evidence.error={code:e.code,message:e.message,stack:e.stack};}
finally{try{await qa?.close();await native?.close();}catch(e){failure??=e;evidence.cleanupError=e.message;}evidence.status=failure?'FAIL':'PASS';fs.writeFileSync(path.join(run,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,run,cases:evidence.cases,helperInvocations:evidence.unrelatedHelperInvocations,measurements:evidence.measurements,error:evidence.error,stopped:evidence.stopped,portClosed:evidence.portClosed,installedMd5:evidence.installedMd5}));if(failure)process.exitCode=1;}

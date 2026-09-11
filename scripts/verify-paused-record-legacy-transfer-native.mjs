import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {seedQuiescenceLinkedGraph} from './business-quiescence-remainder-qa.mjs';
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root)&&path.resolve(root)!==path.resolve('.')&&!path.resolve(root).startsWith(path.resolve('.')+path.sep));
fs.mkdirSync(root,{recursive:true});const run=fs.mkdtempSync(path.join(root,'stage-native-'));
const addon='supabase/development/20260911_paused_record_legacy_transfer.sql';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=[...new Set([...execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean),addon,'scripts/verify-paused-record-legacy-transfer-native.mjs','docs/paused-record-legacy-transfer-local.md'].filter(f=>fs.existsSync(f)))];
const receipt={kind:'paused-record-legacy-stage-native',status:'RUNNING',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),inputs:Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(f))])),encoding:'SHA256 raw file bytes',cases:[],productionContacted:false};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
let native,qa,failure;
try{
 native=await createNativeRecordQa(run,receipt);
 qa=await createRecordStorageLocalQa({dailyMorning:'browser',taskMember:true,scopedRead:true,performanceTrace:true,preparePerformanceFixture:async(initial,vite)=>{
  seedQuiescenceLinkedGraph(initial);
  // Compose one control through the original builder without importing the
  // incompatible all-in-one internalControlInput/morningInput fixtures.
  const {createInternalControlCases}=await vite.ssrLoadModule('/src/internalControlData.ts');
  const owner=initial.users[0],at=initial.updatedAt;
  const graph={...initial,tasks:[],internalControlCases:[]};
  createInternalControlCases(graph,[{id:'qa-stage-control',vesselId:'qa-v1',reportDate:at.slice(0,10),reportSource:'日常',description:'QA stage control',priority:'低',category:'維修',isAware:false,status:'QA pending',departments:['督導'],syncToTask:true,isClosed:false,createdBy:owner.id,updatedBy:owner.id,createdAt:at,updatedAt:at,statusLogs:[],origin:'internal-control'}],owner,at,{'qa-stage-control':{categories:['維修'],expectedDate:'',ownerUserIds:[],isAbnormal:false}});
  initial.tasks.push(...graph.tasks);initial.internalControlCases.push(...graph.internalControlCases);
  initial.auditLogs.push({id:'qa-stage-provenance',createdAt:at,actorId:owner.id,actorName:owner.name,action:'QA fixture',detail:'trusted imported audit',ipAddress:'192.0.2.45',ipCountryCode:'TW'});
 },databaseFactory:async()=>native.adapter});
 receipt.fixtureHttpPort=Number(new URL(qa.origin).port);
 const {observer,a,b}=native,w=qa.workspace;
 const q=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
 const check=async(caseId,fn)=>{try{const detail=await fn();receipt.cases.push({caseId,status:'PASS',layer:'native-stage',...detail});save();}catch(e){receipt.cases.push({caseId,status:'FAIL',layer:'native-stage',code:e.code??'ASSERTION'});save();throw e;}};
 const equal=(x,y,label)=>assert.ok(isDeepStrictEqual(x,y),label);
 const install=['supabase/migrations/20260904161000_appdata_compact_ack_receipts.sql','supabase/migrations/20260817143000_data_management_storage.sql','supabase/migrations/20260818154500_data_management_prune_batch_limit.sql','supabase/normalized-legacy-cutover.sql','supabase/development/20260911_legacy_report_workspace_binding.sql','supabase/development/20260911_business_quiescence.sql'];
 for(const f of install)await observer.query(fs.readFileSync(f,'utf8'));
 if(fs.existsSync(addon))await observer.query(fs.readFileSync(addon,'utf8'));
 const legacy=()=>q(observer,'select to_jsonb(t) r from ship_dynamics_app_state t where workspace_key=$1',[w]);
 const records=()=>q(observer,'select read_ship_dynamics_records_v1($1) r',[w]);
 const control=()=>q(observer,'select to_jsonb(t) r from sd_legacy_write_controls t where workspace_key=$1',[w]);
 const digest=p=>q(observer,'select sd_legacy_jsonb_sha256($1::jsonb) r',[JSON.stringify(p)]);
 const tx=async(c,fn,role='service_role')=>{await c.query('begin;set local role '+role);try{const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}};
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const make=async(base,next)=>[w,randomUUID(),JSON.stringify(buildCloudBlockPatch(base,next)),'QA OWNER','qa-owner',JSON.stringify(await q(observer,"select ship_dynamics_actor_guard($1::jsonb,'qa-owner') r",[JSON.stringify(base)])),JSON.stringify(await q(observer,'select ship_dynamics_authorization_guard($1::jsonb) r',[JSON.stringify(base)])),'[]'];
 const issue=(c,args,fn='apply_ship_dynamics_record_patch_v1')=>q(c,`select ${fn}($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r`,args);
 // Make destination revision strictly ahead of source; mapping cannot copy the
 // smaller source counter. Only metadata changes in this synthetic precondition.
 await observer.query("update ship_dynamics_app_state set revision=revision+20,payload=jsonb_set(payload,'{revision}',to_jsonb(revision+20)) where workspace_key=$1",[w]);
 const t0=await legacy(),h0=await digest(t0.payload);
 await tx(a,c=>q(c,'select freeze_ship_dynamics_legacy_writes($1,$2,$3,$4) r',[w,t0.revision,h0,`freeze:${w}:${t0.revision}:${h0}`]));
 const baseline=await records(),next=structuredClone(baseline.payload);next.vessels.reverse();
 const committedArgs=await make(baseline.payload,next),ack=await issue(observer,committedArgs);assert.equal(ack.ok,true);
 const t1=await records(),h1=await digest(t1.payload),expectedSource={...next,revision:ack.revision,updatedAt:ack.updated_at};
 await check('ST01-real-latest-source-and-higher-frozen-target',async()=>{equal(t1.payload,expectedSource,'source exact intent');equal(await legacy(),t0,'T0 unchanged');assert.notEqual(h1,h0);assert.ok(t0.revision>t1.revision);assert.ok(t1.payload.tasks.length&&t1.payload.meetings.length&&t1.payload.internalControlCases.length&&t1.payload.auditLogs.length);const control=t1.payload.internalControlCases.find(c=>c.id==='qa-stage-control');assert.ok(t1.payload.tasks.some(t=>t.id===control.linkedTaskId));assert.equal(t1.payload.auditLogs.find(x=>x.id==='qa-stage-provenance').ipAddress,'192.0.2.45');});
 const pending=await make(t1.payload,baseline.payload);
 const wid=await q(observer,'select id r from sd_workspaces where legacy_key=$1',[w]),transition=randomUUID();
 const pause=await tx(a,c=>q(c,'select pause_ship_dynamics_business_v1($1,$2) r',[w,transition]));await a.end();
 const operator=await native.connect('stage_operator');const frozen=await control();
 const state=()=>q(observer,'select read_ship_dynamics_business_pause_v1($1,$2) r',[w,transition]);
 const mark=()=>q(observer,'select ship_dynamics_quiescence_private.watermark_v1($1,$2) r',[w,wid]);
 const beforeMark=await mark();
 const stageSql='select stage_ship_dynamics_paused_records_to_legacy_v1($1,$2::uuid,$3::uuid,$4::jsonb,$5::integer,$6,$7::integer,$8,$9::timestamptz,$10::uuid) r';
 const request=[w,wid,transition,JSON.stringify(pause.watermark),t1.revision,h1,t0.revision,h0,frozen.frozen_at,randomUUID()];
 const stage=(c,args=request)=>q(c,stageSql,args);
 const denied=fn=>assert.rejects(fn,e=>e.code==='55000'&&e.message==='business-writes-paused');
 const invariant=async()=>{equal(await records(),t1,'source unchanged');const m=await mark();for(const k of Object.keys(beforeMark))if(!['ship_dynamics_app_state','ship_dynamics_app_revisions'].includes(k))equal(m[k],beforeMark[k],'independent '+k);equal((await state()).watermark,pause.watermark,'original pause watermark');assert.equal((await state()).state,'paused');};
 await check('ST02-original-restore-remains-blocked',async()=>{await assert.rejects(()=>tx(operator,c=>q(c,'select restore_ship_dynamics_legacy_backup($1,$2,$3::jsonb,$4,$5,$6,$7) r',[w,t1.revision,JSON.stringify(t1.payload),h1,t0.updated_at,'QA',`restore:${w}:${t1.revision}:${h1}`])),e=>e.code==='55000'&&e.message==='business-writes-paused');equal(await mark(),beforeMark,'unchanged after rejected old restore');});
 await check('ST03-input-role-binding-and-stale-negatives',async()=>{
  for(const [i,value] of [[0,'wrong-workspace'],[1,randomUUID()],[2,randomUUID()],[3,'{}'],[4,t1.revision-1],[5,'0'.repeat(64)],[5,h1.toUpperCase()],[6,t0.revision-1],[7,'0'.repeat(64)],[8,'2000-01-01T00:00:00Z'],[9,null]]){const wrong=[...request];wrong[i]=value;await assert.rejects(()=>tx(operator,c=>stage(c,wrong)),e=>['22023','55000'].includes(e.code));}
  for(const role of ['anon','authenticated'])await assert.rejects(()=>tx(operator,async c=>{await c.query("select set_config('request.jwt.claim.role','service_role',true)");return stage(c);},role),e=>e.code==='42501');
  await assert.rejects(()=>stage(observer),e=>e.code==='42501');
  equal(await mark(),beforeMark,'negative requests unchanged');
 });
 await check('ST04-unsafe-prior-locks-and-isolation',async()=>{
  for(const level of ['repeatable read','serializable']){await operator.query('begin isolation level '+level+';set local role service_role');await assert.rejects(()=>stage(operator),e=>e.code==='25001');await operator.query('rollback');}
  for(const lock of ["select pg_advisory_xact_lock(9899,1)","select * from ship_dynamics_app_state for update"]){await observer.query('begin');await observer.query(lock);await observer.query('set local role service_role');await assert.rejects(()=>stage(observer),e=>e.code==='25001');await observer.query('rollback');}
 });
 const privateState=()=>q(observer,"select jsonb_build_object('contexts',(select count(*) from ship_dynamics_quiescence_private.stage_context_v1),'receipts',(select count(*) from ship_dynamics_quiescence_private.stages_v1)) r");
 await check('ST05-fault-after-actual-write-rolls-everything-back',async()=>{
  await observer.query("create sequence public.qa_stage_entered;create function public.qa_stage_fault() returns trigger language plpgsql as $$begin perform nextval('public.qa_stage_entered');raise exception 'qa-stage-after-write' using errcode='P0001';end$$;create trigger zzzz_qa_stage_fault after update on ship_dynamics_app_state for each row execute function public.qa_stage_fault()");
  try{await assert.rejects(()=>tx(operator,stage),e=>e.code==='P0001'&&e.message==='qa-stage-after-write');assert.equal(await q(observer,'select is_called r from qa_stage_entered'),true);equal(await legacy(),t0,'target rollback');equal(await control(),frozen,'restore control rollback');equal(await privateState(),{contexts:0,receipts:0},'private state rollback');equal(await mark(),beforeMark,'histories rollback');}finally{await observer.query('drop trigger zzzz_qa_stage_fault on ship_dynamics_app_state;drop function public.qa_stage_fault();drop sequence public.qa_stage_entered');}
 });
 await check('ST05b-receipt-fault-rolls-target-and-receipt-back',async()=>{
  await observer.query("create sequence qa_stage_receipt_entered;create function public.qa_stage_receipt_fault() returns trigger language plpgsql as $$begin if not exists(select 1 from ship_dynamics_app_state where workspace_key=new.workspace_key and revision=(new.result->>'targetRevision')::integer) or not exists(select 1 from ship_dynamics_quiescence_private.stages_v1 where request_id=new.request_id) then raise exception 'qa-precondition';end if;perform nextval('qa_stage_receipt_entered');raise exception 'qa-receipt-after-write' using errcode='P0001';end$$;create trigger qa_stage_receipt_fault after insert on ship_dynamics_quiescence_private.stages_v1 for each row execute function public.qa_stage_receipt_fault()");
  try{await assert.rejects(()=>tx(operator,stage),e=>e.message==='qa-receipt-after-write');assert.equal(await q(observer,'select is_called r from qa_stage_receipt_entered'),true);equal(await legacy(),t0,'target rollback after receipt');equal(await control(),frozen,'control rollback');equal(await privateState(),{contexts:0,receipts:0},'receipt rollback');equal(await mark(),beforeMark,'business rollback');}finally{await observer.query('drop trigger qa_stage_receipt_fault on ship_dynamics_quiescence_private.stages_v1;drop function public.qa_stage_receipt_fault();drop sequence qa_stage_receipt_entered');}
 });
 await check('ST05c-active-context-wrong-actor-is-not-a-bypass',async()=>{
  await observer.query("create function public.qa_stage_actor_fault() returns trigger language plpgsql as $$begin update ship_dynamics_quiescence_private.stage_context_v1 set actor='qa-other-context' where backend=pg_backend_pid();return new;end$$;create trigger aa_qa_stage_actor_fault before update on ship_dynamics_app_state for each row execute function public.qa_stage_actor_fault()");
  try{await denied(()=>tx(operator,stage));equal(await legacy(),t0,'actor fault rollback');equal(await control(),frozen,'actor control rollback');equal(await privateState(),{contexts:0,receipts:0},'actor context rollback');}finally{await observer.query('drop trigger aa_qa_stage_actor_fault on ship_dynamics_app_state;drop function public.qa_stage_actor_fault()');}
 });
 await check('ST05d-actual-stored-receipt-mismatch-is-atomic',async()=>{
  await observer.query("create function public.qa_stage_result_fault() returns trigger language plpgsql as $$begin new.result=new.result||jsonb_build_object('targetRevision',0);return new;end$$;create trigger qa_stage_result_fault before insert on ship_dynamics_quiescence_private.stages_v1 for each row execute function public.qa_stage_result_fault()");
  try{await assert.rejects(()=>tx(operator,stage),e=>e.message==='paused-stage-final-readback-mismatch');equal(await legacy(),t0,'bad receipt target rollback');equal(await control(),frozen,'bad receipt control rollback');equal(await privateState(),{contexts:0,receipts:0},'bad receipt rollback');equal(await mark(),beforeMark,'all data rollback');}finally{await observer.query('drop trigger qa_stage_result_fault on ship_dynamics_quiescence_private.stages_v1;drop function public.qa_stage_result_fault()');}
 });
 let result,expectedTarget;
 await check('ST06-stage-exact-readback-still-paused',async()=>{
  await operator.query('begin;set local role service_role');result=await stage(operator);
  const waiting=issue(b,pending).then(()=>({code:'UNEXPECTED'}),e=>({code:e.code,message:e.message}));let blocked=false;
  for(let i=0;i<300;i++){const row=(await observer.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[b.processID])).rows[0];if(row.wait_event_type==='Lock'&&row.blockers.includes(operator.processID)){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}
  await operator.query('commit');assert.ok(blocked,'actual stage blocks real writer');assert.equal((await waiting).message,'business-writes-paused');assert.equal(result.state,'staged-paused');assert.equal(result.sourceRevision,t1.revision);assert.equal(result.sourceSha256,h1);assert.equal(result.targetRevision,Math.max(t1.revision,t0.revision)+1);
  // Expected business content is retained pre-write; only server metadata comes
  // from the committed response, exactly as the original save ACK contract.
  expectedTarget={...expectedSource,revision:result.targetRevision,updatedAt:result.targetUpdatedAt};
  const actual=await legacy();equal(actual.payload,expectedTarget,'complete target source graph');assert.equal(actual.revision,result.targetRevision);assert.equal(new Date(actual.updated_at).toISOString(),result.targetUpdatedAt);assert.equal(await digest(expectedTarget),result.targetSha256);
  const history=await q(observer,'select to_jsonb(t) r from ship_dynamics_app_revisions t where workspace_key=$1 and revision=$2',[w,result.targetRevision]);equal(history.payload,expectedTarget,'complete target history');assert.equal(history.saved_by,actual.updated_by);equal(await privateState(),{contexts:0,receipts:1},'no lingering context');
  const ctl=await control();assert.equal(ctl.writes_frozen,true);assert.equal(ctl.restore_in_progress,false);assert.equal(Number(ctl.expected_revision),result.targetRevision);assert.equal(ctl.payload_sha256,result.targetSha256);assert.equal(ctl.frozen_at,frozen.frozen_at);await invariant();assert.equal((await state()).unchanged,false);
 });
 await check('ST07-exact-replay-is-readonly-and-request-bound',async()=>{
  const before=await mark(),ctl=await control();const row=()=>q(observer,"select jsonb_build_object('xmin',xmin::text,'ctid',ctid::text,'result',result) r from ship_dynamics_quiescence_private.stages_v1 where request_id=$1",[request[9]]);const stored=await row();equal(await tx(operator,stage),result,'stored exact replay');equal(await row(),stored,'receipt readonly');equal(await mark(),before,'business readonly');equal(await control(),ctl,'control readonly');
  for(const [i,value] of [[0,'wrong-workspace'],[1,randomUUID()],[2,randomUUID()],[3,'{}'],[4,t1.revision-1],[5,'0'.repeat(64)],[6,t0.revision-1],[7,'0'.repeat(64)],[8,'2000-01-01T00:00:00Z'],[9,randomUUID()]]){const wrong=[...request];wrong[i]=value;await assert.rejects(()=>tx(operator,c=>stage(c,wrong)),e=>e.code==='55000');}
 });
 await check('ST08-no-old-resume-no-business-bypass',async()=>{
  await assert.rejects(()=>tx(operator,c=>q(c,'select resume_ship_dynamics_business_v1($1,$2,$3::jsonb) r',[w,transition,request[3]])),e=>e.message==='business-pause-state-mismatch');await denied(()=>issue(b,pending));const freshLegacy=await make(expectedTarget,{...expectedTarget,vessels:[...expectedTarget.vessels].reverse()});await denied(()=>issue(b,freshLegacy,'apply_ship_dynamics_block_patch_v2'));
  await observer.query('grant select,update on ship_dynamics_app_state to service_role,authenticated');
  for(const role of ['service_role','authenticated']){await denied(()=>tx(operator,async c=>{await c.query("select set_config('request.jwt.claim.role','service_role',true),set_config('app.restore_in_progress','true',true)");return c.query('update ship_dynamics_app_state set updated_by=updated_by where workspace_key=$1',[w]);},role));await assert.rejects(()=>tx(operator,c=>c.query('select * from ship_dynamics_quiescence_private.stage_context_v1'),role),e=>e.code==='42501');}
  await observer.query('create role qa_stage_other nologin;grant service_role to qa_stage_other');
  await b.query('set session authorization qa_stage_other');try{await assert.rejects(()=>tx(b,stage),e=>e.message==='paused-stage-replay-mismatch');}finally{await b.query('reset session authorization');}
  await invariant();
 });
 await check('ST09-real-waiting-writer-and-context-isolation',async()=>{
  // Exact replay retains the exclusive gate but never a private write context.
  await operator.query('begin;set local role service_role');equal(await stage(operator),result,'replay');
  const pendingWrite=issue(b,pending).then(()=>({code:'UNEXPECTED'}),e=>({code:e.code,message:e.message}));
  let barrier;const end=Date.now()+4000;while(Date.now()<end){const row=(await observer.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[b.processID])).rows[0];if(row.wait_event_type==='Lock'&&row.blockers.includes(operator.processID)){barrier=true;break;}await new Promise(r=>setTimeout(r,10));}
  await operator.query('commit');assert.ok(barrier,'real exclusive maintenance wait');assert.equal((await pendingWrite).message,'business-writes-paused');await invariant();return {realBackendBarrier:true};
 });
 await check('ST10-reapply-and-base-then-extension',async()=>{
  const defs=()=>observer.query("select oid,proacl,prosrc from pg_proc where oid in ('ship_dynamics_quiescence_private.row_guard_v1()'::regprocedure,'public.stage_ship_dynamics_paused_records_to_legacy_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid)'::regprocedure) order by oid").then(r=>r.rows);
  const first=await defs();await observer.query(fs.readFileSync(addon,'utf8'));equal(await defs(),first,'repeat definitions ACL');
  await observer.query(fs.readFileSync('supabase/schema.sql','utf8'));for(const f of install.slice(3))await observer.query(fs.readFileSync(f,'utf8'));await observer.query(fs.readFileSync(addon,'utf8'));equal(await defs(),first,'base then extension');equal(await tx(operator,stage),result,'stored replay after reapply');await invariant();await denied(()=>issue(b,pending));
 });
 receipt.status='PASS';receipt.result=result;receipt.boundary={stagedOnly:true,stillPaused:true,sourceAndIndependentStoresUnchanged:true,noRoutePublication:true};
}catch(e){failure=true;receipt.status='FAIL';receipt.error={code:e.code??'ASSERTION',frames:String(e.stack).split('\n').filter(x=>/^\s+at /.test(x))};}
finally{try{if(qa){await qa.close();receipt.fixtureClosed=true;}if(native)await native.close();if(receipt.fixtureHttpPort){receipt.fixturePortClosed=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:receipt.fixtureHttpPort});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));s.setTimeout(2000,()=>{s.destroy();resolve(false);});});assert.equal(receipt.fixturePortClosed,true);}}catch(e){failure=true;receipt.status='CLEANUP_FAIL';receipt.cleanupCode=e.code??'ASSERTION';}receipt.inputsUnchanged=files.every(f=>sha(fs.readFileSync(f))===receipt.inputs[f]);if(!receipt.inputsUnchanged){failure=true;receipt.status='SOURCE_DRIFT';}save();}
console.log(JSON.stringify({status:receipt.status,receipt:path.join(run,'receipt.json'),cases:receipt.cases,error:receipt.error,inputsUnchanged:receipt.inputsUnchanged,cleanup:{stopped:receipt.stopped,portClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved}}));if(failure)process.exitCode=1;

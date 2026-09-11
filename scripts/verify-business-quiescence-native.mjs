import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {createQuiescenceRemainderQa,seedQuiescenceLinkedGraph} from './business-quiescence-remainder-qa.mjs';
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root)&&!path.resolve(root).startsWith(path.resolve('.')+path.sep));
fs.mkdirSync(root,{recursive:true});const run=fs.mkdtempSync(path.join(root,'business-pause-'));
const sqlFile='supabase/development/20260911_business_quiescence.sql';
const bindingFile='supabase/development/20260911_legacy_report_workspace_binding.sql';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sources=execFileSync('git',['ls-files','supabase','scripts','src'],{encoding:'utf8'}).trim().split('\n').filter(p=>/\.(sql|mjs|ts|tsx)$/.test(p));
sources.push('scripts/verify-business-quiescence-native.mjs','scripts/business-quiescence-remainder-qa.mjs',bindingFile);if(fs.existsSync(sqlFile))sources.push(sqlFile);
const receipt={kind:'original-App-business-quiescence',status:'RUNNING',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),inputs:Object.fromEntries([...new Set(sources)].map(f=>[f,sha(fs.readFileSync(f))])),hashEncoding:'raw-file-bytes SHA256',cases:[],layer:'owned loopback native PostgreSQL; no browser or hosted proof',productionContacted:false};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
let native,qa,failure;
try{
 native=await createNativeRecordQa(run,receipt);
 qa=await createRecordStorageLocalQa({dailyMorning:'browser',taskMember:true,scopedRead:true,performanceTrace:true,preparePerformanceFixture:seedQuiescenceLinkedGraph,databaseFactory:async()=>native.adapter});
 const {observer,a,b}=native,w=qa.workspace;
 const q=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
 for(const file of ['supabase/migrations/20260904161000_appdata_compact_ack_receipts.sql','supabase/migrations/20260817143000_data_management_storage.sql','supabase/migrations/20260818154500_data_management_prune_batch_limit.sql','supabase/normalized-legacy-cutover.sql',bindingFile])await observer.query(fs.readFileSync(file,'utf8'));
 const check=async(caseId,fn)=>{try{const detail=await fn();receipt.cases.push({caseId,status:detail?.rowCoverage===false?'PENDING':'PASS',...detail});save();}catch(e){receipt.cases.push({caseId,status:'FAIL',code:e.code,message:String(e.message).split('\n')[0],stackFrames:String(e.stack).split('\n').filter(x=>/^\s+at /.test(x))});save();throw e;}};
 const direct=c=>c.query('update ship_dynamics_app_state set updated_by=$2 where workspace_key=$1',[w,'pause tracer']);
 await check('Q00-normal-direct-business-write',async()=>{await direct(a);assert.equal(await q(observer,'select updated_by r from ship_dynamics_app_state where workspace_key=$1',[w]),'pause tracer');});
 const wid=await q(observer,'select id r from sd_workspaces where legacy_key=$1',[w]);
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const readRecord=async(c=observer)=>(await q(c,'select read_ship_dynamics_records_v1($1) r',[w])).payload;
 const request=async(mode)=>{const base=mode==='record'?await readRecord():await q(observer,'select payload r from ship_dynamics_app_state where workspace_key=$1',[w]);const next=structuredClone(base);next.vessels.reverse();return [w,randomUUID(),JSON.stringify(buildCloudBlockPatch(base,next)),'QA OWNER','qa-owner',JSON.stringify(await q(observer,"select ship_dynamics_actor_guard($1::jsonb,'qa-owner') r",[JSON.stringify(base)])),JSON.stringify(await q(observer,'select ship_dynamics_authorization_guard($1::jsonb) r',[JSON.stringify(base)])),'[]'];};
 const issue=(c,fn,args)=>q(c,`select ${fn}($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r`,args);
 const normal={};let remainder;
 const claim=async(mode='record')=>q(observer,`select sd_itinerary_${mode==='record'?'record_claim_lease_v1':'main_claim_lease'}($1,'qa-v1','quiescence-tab','QA',300,'qa-owner') r`,[w]);
 const itinerary=async(c,args,fn='sd_itinerary_record_save_v1')=>q(c,`select ${fn}($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10,$11::jsonb) r`,args);
 const itineraryRequest=async()=>{const lease=await claim();assert.equal(lease.ok,true);const d=(await observer.query('select * from sd_itinerary_documents where workspace_id=$1 and vessel_id=$2',[wid,'qa-v1'])).rows[0];return [w,'qa-v1',d.revision,randomUUID(),JSON.stringify(d.rows_payload),lease.leaseId,'quiescence-tab',lease.fencingToken,'QA','qa-owner',JSON.stringify(d.alternative_plans_payload)];};
 const report=(c,id)=>q(c,"select sd_itinerary_record_report_save_manual_v1($1,'qa-owner',$2::uuid) r",[w,id]);
 let token=randomUUID();
 if(fs.existsSync(sqlFile)){
  await observer.query(fs.readFileSync(sqlFile,'utf8'));
  await check('Q02-normal-original-legacy-and-record-patches',async()=>{for(const mode of ['legacy','record']){normal[mode]=await request(mode);const r=await issue(observer,mode==='record'?'apply_ship_dynamics_record_patch_v1':'apply_ship_dynamics_block_patch_v2',normal[mode]);assert.equal(r.ok,true,mode+' patch succeeds');}});
  await check('Q03-normal-independent-itinerary',async()=>{await observer.query('delete from sd_itinerary_leases where workspace_id=$1',[wid]);normal.itinerary=await itineraryRequest();assert.equal((await itinerary(observer,normal.itinerary)).ok,true);});
  await check('Q04-normal-manual-and-scheduled-reports',async()=>{normal.report=randomUUID();assert.equal((await report(observer,normal.report)).ok,true);assert.ok(await q(observer,"select sd_generate_daily_itinerary_report($1,'2026-09-10','2026-09-10T01:00Z') r",[wid]));assert.equal((await q(observer,"select run_ship_dynamics_record_daily_morning_v1($1,'quiescence-normal','2026-09-10T01:00Z') r",[w])).ok,true);const dow=await q(observer,"select extract(isodow from clock_timestamp() at time zone 'Asia/Taipei')::integer r");assert.ok(dow<=5,'real legacy scheduler needs a weekday; no fake clock replacement');assert.equal(await q(observer,'select ship_dynamics_run_daily_morning_snapshots() r'),1);});
  await check('Q04-normal-legacy-and-record-prune',async()=>{
   normal.prunes={};
   for(const mode of ['legacy','record']){
    const table=mode==='record'?'ship_dynamics_record_versions':'ship_dynamics_app_revisions';
    const revisions=(await observer.query(`select revision from ${table} where workspace_key=$1 order by revision`,[w])).rows.map(x=>x.revision);assert.ok(revisions.length>1);
    const sql=`select ${mode==='record'?'prune_ship_dynamics_record_revision_history_v1':'prune_ship_dynamics_revision_history'}($1,$2,$3::uuid,$4::jsonb,$5::jsonb) r`;
    const args=[w,'qa-owner',randomUUID(),JSON.stringify(revisions),JSON.stringify([revisions[0]])];
    const result=await q(observer,sql,args);assert.equal(result.ok,true);assert.equal(result.deletedCount,1);normal.prunes[mode]={sql,args,result};
   }
  });
  remainder=await createQuiescenceRemainderQa({observer,b,q,w,wid,check,readRecord});
  normal.pendingRecord=await request('record');normal.pendingLegacy=await request('legacy');normal.pendingItinerary=await itineraryRequest();
  normal.recordPayload=await readRecord();normal.legacyPayload=await q(observer,'select payload r from ship_dynamics_app_state where workspace_key=$1',[w]);
  await q(a,'select pause_ship_dynamics_business_v1($1,$2::uuid) r',[w,token]);
 }else{
  // Behavioral pre-feature RED: the existing transaction gate alone cannot
  // persist a business pause. This is NOT a replacement production pause API.
  receipt.baseline='existing transaction-only record-maintenance-v1 gate';
  await a.query("begin;select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);commit");
 }
 await a.end();
 await check('Q01-pause-persists-after-commit-disconnect',async()=>{
  await assert.rejects(direct(b),e=>e.code==='55000'&&e.message==='business-writes-paused');
 });
 const status=()=>q(observer,'select read_ship_dynamics_business_pause_v1($1,$2::uuid) r',[w,token]);
 const frozen=await status();assert.equal(frozen.unchanged,true);
 const reject=async(fn)=>{await assert.rejects(fn,e=>e.code==='55000'&&e.message==='business-writes-paused');assert.equal((await status()).unchanged,true);};
 await remainder.paused(reject,status);
 for(const [id,fn] of [
  ['legacy-patch',()=>issue(b,'apply_ship_dynamics_block_patch_v2',normal.pendingLegacy)],
  ['record-patch',()=>issue(b,'apply_ship_dynamics_record_patch_v1',normal.pendingRecord)],
  ['independent-itinerary',()=>itinerary(b,normal.pendingItinerary)],

  ['manual-record-report',()=>report(b,randomUUID())],
  ['scheduled-itinerary-report',()=>q(b,"select sd_generate_daily_itinerary_report($1,'2026-09-11','2026-09-11T01:00Z') r",[wid])],
  ['scheduled-record-morning',()=>q(b,"select run_ship_dynamics_record_daily_morning_v1($1,'paused-job','2026-09-11T01:00Z') r",[w])],
  ['scheduled-legacy-morning',()=>q(b,'select ship_dynamics_run_daily_morning_snapshots() r')],
  ['record-import',()=>q(b,'select import_ship_dynamics_records_v1($1,$2::jsonb) r',[w,JSON.stringify(normal.recordPayload)])],
 ])await check('Q05-paused-'+id,()=>reject(fn));
 await check('Q06-reads-and-exact-receipts',async()=>{
  assert.deepEqual(await readRecord(),normal.recordPayload);assert.deepEqual(await q(observer,'select payload r from ship_dynamics_app_state where workspace_key=$1',[w]),normal.legacyPayload);
  for(const mode of ['record','legacy']){const fn=mode==='record'?'get_ship_dynamics_record_receipt_v1':'get_ship_dynamics_block_patch_receipt';assert.equal((await issue(b,fn,normal[mode])).ok,true);const missing=[...normal[mode]];missing[1]=randomUUID();assert.equal((await issue(b,fn,missing)).status,'missing');const wrong=[...normal[mode]];wrong[3]='wrong';assert.ok(['mismatch','operation-mismatch'].includes((await issue(b,fn,wrong)).status)||['operation-mismatch','operation-id-mismatch'].includes((await issue(b,fn,wrong)).code));}
  assert.equal((await q(b,"select sd_itinerary_record_operation_status_v1($1,$2::uuid,'qa-owner') r",[w,normal.itinerary[3]])).ok,true);
  assert.equal((await q(b,"select sd_itinerary_record_operation_status_v1($1,$2::uuid,'qa-owner') r",[w,randomUUID()])).status,'missing');
  const loaded=await q(b,"select sd_itinerary_record_load_many_v1($1,array['qa-v1'],'qa-owner') r",[w]);assert.equal(loaded.length,1);assert.deepEqual(loaded[0].document.rows,JSON.parse(normal.itinerary[4]));
  assert.equal((await report(b,normal.report)).ok,true);assert.equal((await q(b,"select sd_itinerary_record_report_list_v1($1,'qa-owner',1,20) r",[w])).ok,true);
  assert.equal((await q(b,"select get_ship_dynamics_record_storage_stats_v1($1,'qa-owner') r",[w])).ok,true);
  assert.equal((await status()).unchanged,true);
 });
 await check('Q20-exact-terminal-prune-and-record-scheduler',async()=>{
  for(const mode of ['legacy','record']){
   const saved=normal.prunes[mode];assert.deepEqual(await q(b,saved.sql,saved.args),saved.result,'paused terminal replay must return the exact original outcome');
   const wrong=[...saved.args];wrong[4]='[2147483647]';assert.equal((await q(b,saved.sql,wrong)).error,'IDEMPOTENCY_MISMATCH');
   const foreign=[...saved.args];foreign[1]='missing-actor';assert.equal((await q(b,saved.sql,foreign)).error,'OWNER_REQUIRED');
   const missing=[...saved.args];missing[2]=randomUUID();await reject(()=>q(b,saved.sql,missing));
  }
  const replay=await q(b,"select run_ship_dynamics_record_daily_morning_v1($1,'quiescence-normal','2026-09-10T01:00Z') r",[w]);assert.equal(replay.ok,true);assert.equal(replay.replayed,true);
  await assert.rejects(q(b,"select run_ship_dynamics_record_daily_morning_v1($1,'quiescence-normal','2026-09-10T02:00Z') r",[w]),e=>e.message==='operation-id-mismatch');
  await reject(()=>q(b,"select run_ship_dynamics_record_daily_morning_v1($1,'missing-scheduled-op','2026-09-10T01:00Z') r",[w]));
  assert.equal((await status()).unchanged,true);
 });
 for(const mode of ['legacy','record'])await check('Q07-paused-'+mode+'-prune',async()=>{const table=mode==='record'?'ship_dynamics_record_versions':'ship_dynamics_app_revisions';const revisions=(await b.query(`select revision from ${table} where workspace_key=$1 order by revision`,[w])).rows.map(x=>x.revision);assert.ok(revisions.length);await reject(()=>q(b,`select ${mode==='record'?'prune_ship_dynamics_record_revision_history_v1':'prune_ship_dynamics_revision_history'}($1,'qa-owner',$2::uuid,$3::jsonb,$4::jsonb) r`,[w,randomUUID(),JSON.stringify(revisions),JSON.stringify([revisions[0]])]));});
 for(const suffix of ['ids','dates'])await check('Q08-paused-report-delete-'+suffix,async()=>{const set=await q(b,'select sd_itinerary_daily_report_set_token($1) r',[wid]);const row=(await b.query('select report_id::text,business_date::text from sd_itinerary_daily_reports where workspace_id=$1 order by report_id limit 1',[wid])).rows[0];await reject(()=>q(b,`select sd_itinerary_record_report_delete_${suffix}_v1($1,'qa-owner',$2::uuid,$3,$4::jsonb) r`,[w,randomUUID(),set,JSON.stringify([suffix==='ids'?row.report_id:row.business_date])]));});
 await check('Q09-leases-and-disposable-reads-remain-live',async()=>{
  assert.equal((await q(b,"select claim_ship_dynamics_edit_lock($1,'vessel:qa-v2','pause-owner','QA',120) r",[w])).ok,true);
  assert.equal((await q(b,"select renew_ship_dynamics_edit_lock($1,'vessel:qa-v2','pause-owner',120) r",[w])).ok,true);
  assert.equal(await q(b,"select release_ship_dynamics_edit_lock($1,'vessel:qa-v2','pause-owner') r",[w]),true);
  const lease=await claim();assert.equal(lease.ok,true);
  assert.equal((await q(b,"select sd_itinerary_record_renew_lease_v1($1,'qa-v1',$2::uuid,'quiescence-tab',$3::bigint,300,'qa-owner') r",[w,lease.leaseId,lease.fencingToken])).ok,true);
  await reject(()=>itinerary(b,normal.pendingItinerary));
  await q(b,"select sd_itinerary_record_release_lease_v1($1,'qa-v1',$2::uuid,'quiescence-tab',$3::bigint,'qa-owner') r",[w,lease.leaseId,lease.fencingToken]);
  await readRecord(b);assert.equal((await status()).unchanged,true);
 });
 await check('Q10-private-roles-service-not-exempt',async()=>{
  await observer.query('grant select,update on ship_dynamics_app_state to authenticated,service_role');
  for(const role of ['anon','authenticated']){await b.query('begin;set local role '+role);await b.query("select set_config('request.jwt.claim.role','service_role',true)");await assert.rejects(q(b,'select pause_ship_dynamics_business_v1($1,$2::uuid) r',[w,token]),e=>e.code==='42501');await b.query('rollback');await b.query('begin;set local role '+role);await assert.rejects(b.query('select * from ship_dynamics_quiescence_private.workspaces'),e=>e.code==='42501');await b.query('rollback');}
  await b.query('begin;set local role service_role');await assert.rejects(direct(b),e=>e.message==='business-writes-paused');await b.query('rollback');
  await b.query('begin;set local role service_role');await assert.rejects(q(b,'select ship_dynamics_run_daily_morning_snapshots() r'),e=>e.message==='business-writes-paused');await b.query('rollback');
  await b.query('begin;set local role service_role');assert.equal((await q(b,'select read_ship_dynamics_business_pause_v1($1,$2::uuid) r',[w,token])).state,'paused');await b.query('commit');
  assert.equal((await status()).unchanged,true);
 });
 await check('Q11-exact-transition-and-watermark-fail-closed',async()=>{
  for(const args of [[w,randomUUID(),frozen.watermark],['wrong-workspace',token,frozen.watermark],[w,null,frozen.watermark],[w,token,{}]])await assert.rejects(q(b,'select resume_ship_dynamics_business_v1($1,$2::uuid,$3::jsonb) r',args.map((x,i)=>i===2?JSON.stringify(x):x)),e=>e.code==='55000');
  await assert.rejects(q(b,'select pause_ship_dynamics_business_v1($1,$2::uuid) r',[w,randomUUID()]),e=>e.message==='business-pause-transition-mismatch');
  assert.deepEqual((await q(b,'select pause_ship_dynamics_business_v1($1,$2::uuid) r',[w,token])).watermark,frozen.watermark);
  await b.query('begin');await b.query('delete from ship_dynamics_quiescence_private.transitions where workspace_key=$1',[w]);await assert.rejects(direct(b),e=>e.message==='business-pause-control-invalid');await b.query('rollback');
  await b.query('begin');await b.query('update ship_dynamics_quiescence_private.workspaces set transition_id=$2 where workspace_key=$1',[w,randomUUID()]);await assert.rejects(direct(b),e=>e.message==='business-pause-control-invalid');await b.query('rollback');
  assert.equal((await status()).unchanged,true);
 });
 await check('Q12-unsupported-isolation-cannot-use-stale-control',async()=>{for(const level of ['repeatable read','serializable']){await b.query('begin isolation level '+level);await b.query('select count(*) from ship_dynamics_app_state');await assert.rejects(direct(b),e=>e.code==='25001');await b.query('rollback');}});
 await check('Q13-original-report-audit-direct-write',async()=>{await reject(()=>b.query("insert into sd_audit_events select (jsonb_populate_record(null::sd_audit_events,to_jsonb(t)||jsonb_build_object('id',gen_random_uuid()))).* from sd_audit_events t where workspace_id=$1 limit 1",[wid]));});
 const tables=(await observer.query('select * from ship_dynamics_quiescence_private.tables_v1()')).rows;
 receipt.tableInventory=tables;receipt.ephemeralExcluded=['ship_dynamics_edit_locks','ship_dynamics_member_fences','sd_itinerary_leases','ship_dynamics_record_read_bases'];
 for(const t of tables)await check('Q13-direct-table-'+t.table_name,async()=>{
  const target=t.key_column==='workspace_key'?w:wid;
  const count=await q(observer,`select count(*)::integer r from ${t.table_name} where ${t.key_column}::text=$1`,[target]);
  // Empty ledger families are exercised by their real RPC above, but a zero-row
  // UPDATE cannot prove a ROW trigger. Record the gap, never call it coverage.
  if(!count){receipt.emptyTables??=[];receipt.emptyTables.push(t.table_name);return {rowCoverage:false,reason:'no committed fixture row'};}
  if(t.table_name==='sd_audit_events'||t.table_name==='sd_operations'){const key=t.table_name==='sd_operations'?'operation_id':'id';await reject(()=>b.query(`insert into ${t.table_name} select (jsonb_populate_record(null::${t.table_name},to_jsonb(t)||jsonb_build_object('${key}',gen_random_uuid()))).* from ${t.table_name} t where workspace_id=$1 limit 1`,[wid]));return {rowCoverage:true,mutation:'insert',existingAppendOnlyGuardsPreserved:true};}
  await reject(()=>b.query(`update ${t.table_name} set ${t.key_column}=${t.key_column} where ${t.key_column}::text=$1`,[target]));
  await reject(()=>b.query(`delete from ${t.table_name} where ${t.key_column}::text=$1`,[target]));return {rowCoverage:true};
 });
 await check('Q14-peer-workspace-unpaused',async()=>{await q(b,'select import_ship_dynamics_records_v1($1,$2::jsonb) r',['quiescence-peer',JSON.stringify(normal.recordPayload)]);await b.query("insert into ship_dynamics_app_state(workspace_key,payload) values('quiescence-peer','{}')");await b.query("update ship_dynamics_app_state set updated_by='peer' where workspace_key='quiescence-peer'");assert.equal(await q(observer,"select updated_by r from ship_dynamics_app_state where workspace_key='quiescence-peer'"),'peer');assert.equal((await status()).unchanged,true);});
 const resume=()=>q(observer,'select resume_ship_dynamics_business_v1($1,$2::uuid,$3::jsonb) r',[w,token,JSON.stringify(frozen.watermark)]);
 await check('Q15-explicit-resume-normal-successes',async()=>{assert.equal((await resume()).state,'resumed');await remainder.resumed();assert.equal((await issue(b,'apply_ship_dynamics_record_patch_v1',normal.pendingRecord)).ok,true);assert.equal((await issue(b,'apply_ship_dynamics_block_patch_v2',normal.pendingLegacy)).ok,true);assert.equal((await itinerary(b,await itineraryRequest())).ok,true);assert.equal((await itinerary(b,await itineraryRequest(),'sd_itinerary_main_save')).ok,true);assert.equal((await report(b,randomUUID())).ok,true);await assert.rejects(resume(),e=>e.message==='business-pause-transition-mismatch');});
 const c=await native.connect('drain_writer'),d=await native.connect('pause_operator'),holder=await native.connect('tuple_holder');
 const wait=async(waiter,blocker)=>{const end=Date.now()+5000;let row;do{row=(await observer.query('select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[waiter.processID])).rows[0];if(row.wait_event_type==='Lock'&&row.blockers.includes(blocker.processID)){return {...row,locks:(await observer.query("select pid,locktype,mode,granted,classid::text,objid::text from pg_locks where pid=any($1) and locktype='advisory'",[[waiter.processID,blocker.processID]])).rows};}await new Promise(r=>setTimeout(r,10));}while(Date.now()<end);assert.fail('missing native barrier');};
 const caught=p=>p.then(value=>({value}),e=>({error:{code:e.code,message:e.message}}));
 for(const family of ['legacy','record','itinerary','report'])await check('Q16-inflight-drain-'+family,async()=>{
  const args=family==='record'?await request('record'):family==='itinerary'?await itineraryRequest():null;
  await c.query('begin');if(family==='legacy')await direct(c);if(family==='record')assert.equal((await issue(c,'apply_ship_dynamics_record_patch_v1',args)).ok,true);if(family==='itinerary')assert.equal((await itinerary(c,args)).ok,true);if(family==='report')assert.equal((await report(c,randomUUID())).ok,true);
  const next=randomUUID(),p=caught(q(d,'select pause_ship_dynamics_business_v1($1,$2::uuid) r',[w,next]));const barrier=await wait(d,c);await c.query('commit');const result=await p;assert.equal(result.value?.state,'paused');await assert.rejects(direct(b),e=>e.message==='business-writes-paused');const s=await q(observer,'select read_ship_dynamics_business_pause_v1($1,$2::uuid) r',[w,next]);assert.equal(s.unchanged,true);await q(observer,'select resume_ship_dynamics_business_v1($1,$2::uuid,$3::jsonb) r',[w,next,JSON.stringify(s.watermark)]);return {barrier};
 });
 await check('Q17-direct-tuple-before-gate-no-deadlock',async()=>{
  // The pause must complete its MVCC snapshot while this writer owns a tuple
  // but has not yet reached the business trigger/shared gate.
  await observer.query("create function public.qa_hold_before_pause() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(72611,1);return new;end$$;create trigger aaa_qa_hold_before_pause before update on ship_dynamics_app_state for each row execute function public.qa_hold_before_pause();");
  await holder.query('begin;select pg_advisory_xact_lock(72611,1)');const p=caught(direct(c));const barrier=await wait(c,holder);
  await d.query('begin');const next=randomUUID();const paused=await q(d,'select pause_ship_dynamics_business_v1($1,$2::uuid) r',[w,next]);assert.equal(paused.state,'paused');await holder.query('rollback');const result=await p;assert.equal(result.error?.code,'40001');await d.query('commit');await observer.query('drop trigger aaa_qa_hold_before_pause on ship_dynamics_app_state;drop function public.qa_hold_before_pause()');await assert.rejects(direct(c),e=>e.message==='business-writes-paused');await q(observer,'select resume_ship_dynamics_business_v1($1,$2::uuid,$3::jsonb) r',[w,next,JSON.stringify(paused.watermark)]);return {barrier,rejection:result.error.code,pauseDidNotWaitOnTuple:true};
 });
 await check('Q19-record-waiter-sees-newly-committed-pause',async()=>{const args=await request('record'),next=randomUUID();await d.query('begin');const paused=await q(d,'select pause_ship_dynamics_business_v1($1,$2::uuid) r',[w,next]);const pending=caught(issue(c,'apply_ship_dynamics_record_patch_v1',args));const barrier=await wait(c,d);await d.query('commit');assert.equal((await pending).error?.message,'business-writes-paused');const s=await q(observer,'select read_ship_dynamics_business_pause_v1($1,$2::uuid) r',[w,next]);assert.equal(s.unchanged,true);await q(observer,'select resume_ship_dynamics_business_v1($1,$2::uuid,$3::jsonb) r',[w,next,JSON.stringify(paused.watermark)]);return {barrier,readCommittedFreshness:true};});
 await check('Q18-rerun-and-writer-gate-branches-preserved',async()=>{const definition=()=>q(observer,"select pg_get_functiondef('ship_dynamics_record_writer_gate_v1(text,boolean)'::regprocedure) r");const first=await definition();await observer.query(fs.readFileSync(sqlFile,'utf8'));assert.equal(await definition(),first);for(const client of [b,c]){await client.query('begin');await q(client,'select ship_dynamics_record_writer_gate_v1($1,false) r',[w]);}await assert.rejects(q(b,'select ship_dynamics_record_writer_gate_v1($1,true) r',[w]),e=>e.code==='40001');await b.query('rollback');await q(c,'select ship_dynamics_record_writer_gate_v1($1,true) r',[w]);await c.query('rollback');});
 receipt.acceptedBoundaries=['Legacy cron has no per-invocation operation ID: frozen saved-report readback plus drain is evidence, not an invented exact invocation receipt.','SQL-only local tranche; no browser/client cutover, hosted auth, production, or normalized-App writer claim.','sd_operations synthetic seed proves TABLE GUARD ONLY; normalized identity/rollout bootstrap is synthetic.'];
 receipt.pendingContracts=receipt.cases.filter(c=>c.status!=='PASS').map(c=>c.caseId);
 receipt.executedTestsPassed=true;receipt.status=receipt.pendingContracts.length||receipt.emptyTables?.length?'PARTIAL':'PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={code:e.code,message:String(e.message).split('\n')[0]};}
finally{
 // A setup/RPC failure must retain the unfinished matrix, not imply closure.
 const passed=new Set(receipt.cases.filter(c=>c.status==='PASS').map(c=>c.caseId));
 receipt.pendingContracts=[
  ...['Q25-valid-linked-member-paused-receipts-and-lease','Q26-linked-member-resumed-same-pending',
   ...['main','public','office'].flatMap(id=>['Q25-'+id+'-paused-valid-save-and-receipts','Q26-'+id+'-resumed']),
   'Q24-legacy-manual-save-normal','Q25-legacy-manual-paused-save-and-frozen-receipt','Q26-legacy-manual-resumed',
   ...['ids','dates'].flatMap(id=>['Q24-legacy-delete-'+id+'-normal','Q25-legacy-delete-'+id+'-paused-receipts','Q26-legacy-delete-'+id+'-resumed'])].filter(id=>!passed.has(id)),
  ...(!receipt.tableInventory?['nonempty-direct-DML-table-matrix-not-reached']:receipt.tableInventory.map(t=>'Q13-direct-table-'+t.table_name).filter(id=>!passed.has(id)))
 ];
 if(qa){await qa.close();receipt.fixtureClosed=true;}
 if(native)try{await native.close();}catch(e){failure??=e;receipt.status='FAIL';receipt.cleanupError={code:e.code,message:String(e.message).split('\n')[0]};}
 receipt.inputsUnchanged=Object.entries(receipt.inputs).every(([f,h])=>sha(fs.readFileSync(f))===h);if(!receipt.inputsUnchanged){failure??=Error('input drift');receipt.status='FAIL';}save();
}
console.log(JSON.stringify({status:receipt.status,receipt:path.join(run,'receipt.json'),cases:receipt.cases,cleanup:{stopped:receipt.stopped,portClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved}}));if(failure)process.exitCode=1;else if(receipt.status==='PARTIAL')process.exitCode=2;

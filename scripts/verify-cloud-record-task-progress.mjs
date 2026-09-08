import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Private synthetic PostgreSQL only. Same mounted helpers, not a derived UI oracle.
const evidence = fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT || process.env.TEMP || '.', 'task-progress-sql-'));
const baseCommit = 'ece55206dde4aa851eb8a1a0c8680c6b9fa7e9c7';
const sqlPath = 'supabase/development/20260906_appdata_record_store.sql';
const oldSql = process.env.QA_PROGRESS_BASE_DIR?fs.readFileSync(path.join(process.env.QA_PROGRESS_BASE_DIR,'20260906_appdata_record_store.sql'),'utf8'):execFileSync('git', ['show', `${baseCommit}:${sqlPath}`], {encoding:'utf8'});
const db = new PGlite(), oracle = new PGlite();
const vite = await createServer({server:{middlewareMode:true}, appType:'custom', logLevel:'silent'});
const key = 'progress-private', actor = 'qa-owner', at = '2026-09-06T00:00:00.000Z', time = '2026-09-06T01:00:00.000Z';
const clone = structuredClone, cases = [];
let failure;
const query = async(d, sql, args=[]) => (await d.query(sql,args)).rows[0]?.result;
const read = async(d=db) => (await query(d,'select read_ship_dynamics_records_v1($1) result',[key])).payload;
const check = async(id, fn) => { await fn(); cases.push(id); console.log('PASS '+id); };
const tableNames = async(d=db) => (await d.query("select tablename from pg_tables where schemaname='public' and (tablename like 'ship_dynamics_record%' or tablename='ship_dynamics_edit_locks') order by tablename")).rows.map(r=>r.tablename);
const ledger = async(d=db, physical=false) => {
 const result={};
 for(const table of await tableNames(d))result[table]=(await d.query(`select to_jsonb(t) value${physical?',tableoid::text,xmin::text,ctid::text':''} from public.${table} t order by to_jsonb(t)::text`)).rows;
 return result;
};
const ownerOfB = async() => {
 const split = await query(db,"select to_regclass('public.ship_dynamics_record_task_progress') is not null result");
 return (await db.query(split
  ? "select value,revision,tableoid::text,xmin::text,ctid::text from ship_dynamics_record_task_progress where workspace_key=$1 and task_id='task-1' and value->>'vesselId'='v2'"
  : "select value,revision,tableoid::text,xmin::text,ctid::text from ship_dynamics_records where workspace_key=$1 and collection='tasks' and entity_id='task-1'",[key])).rows;
};
const apply = (d, r) => query(d,'select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) result',[key,r.id,JSON.stringify(r.operations),'QA OWNER',actor,JSON.stringify(r.guard),JSON.stringify(r.auth),JSON.stringify(r.locks)]);
try {
 for(const d of [db,oracle]) {
  await d.exec('create role anon nologin; create role authenticated nologin;');
  await d.exec(fs.readFileSync('supabase/schema.sql','utf8'));
  await d.exec(d===db?fs.readFileSync(sqlPath,'utf8'):oldSql);
  await d.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-forwarded-for':'192.0.2.20','cf-ipcountry':'TW'})]);
 }
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {buildCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudBlockPatch.ts');
 const {assertActorAuthorizedForCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudAuthorization.ts');
 const {withAudit}=await vite.ssrLoadModule('/src/utils.ts');
 const progress=await vite.ssrLoadModule('/src/taskVesselProgress.ts');
 const meeting=await vite.ssrLoadModule('/src/meetingTaskWorkflow.ts');
 const {buildTaskNotificationsForVessels}=await vite.ssrLoadModule('/src/taskWorkflow.ts');
 const {vesselDisplayName}=await vite.ssrLoadModule('/src/vesselDisplay.ts');
 const {richTextToPlainText}=await vite.ssrLoadModule('/src/richText.ts');
 const base=createInitialData(); base.revision=1; base.updatedAt=at;
 base.users=[{id:actor,department:'督導',name:'QA OWNER',username:actor,role:'owner',passwordHash:'',isActive:true,managedVesselIds:[],createdAt:at,updatedAt:at}];
 base.users.push({...clone(base.users[0]),id:'qa-observer',username:'qa-observer',name:'QA OBSERVER',role:'operator',managedVesselIds:['v1','v2']});
 base.vessels=['v1','v2'].map(id=>({...clone(base.vessels[0]),id,name:'QA '+id,assignedUserIds:[actor,'qa-observer'],delegateManagers:[]}));
 for(const c of ['tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'])base[c]=[];
 const task={id:'task-1',vesselId:'v1',vesselIds:['v1','v2'],description:'分船事項',priority:'高',isAware:false,isAbnormal:false,isInternalControl:false,category:'其他',categories:['其他'],status:'整體原狀態',statusLogs:[],expectedDate:'',reportDate:'2026-09-06',departments:['督導'],ownerUserIds:[],isClosed:false,sourceType:'temporary',attentionDimension:'meeting',sourceMeetingId:'m1',sourceMeetingItemId:'item-1',distributeToVessels:true,createdBy:actor,updatedBy:actor,createdAt:at,updatedAt:at,vesselProgress:[
  {vesselId:'v2',status:'B已完成',isClosed:true,statusLogs:[],closedDate:'2026-09-05',closedBy:actor,unknown:{literal:[null,false,'B']}},
  {vesselId:'v1',status:'A待完成',isClosed:false,statusLogs:[]},
  {vesselId:'out-of-scope',status:'C歷史',isClosed:true,statusLogs:[],unknown:'closed history'}]};
 base.tasks=[task];
 base.meetings=[{id:'m1',subject:'本機專題',meetingDate:'2026-09-06',reason:'測試來源',participantUserIds:[],taskDescription:'分船事項',vessels:['v1','v2'],vesselScopeMode:'vessels',priority:'高',isAbnormal:false,isInternalControl:false,departments:['督導'],trackingUserIds:[],responsibleUserIds:[],expectedDate:'',resolution:'待執行',status:'進行中',statusLogs:[],taskItems:[{id:'item-1',description:'分船事項',categories:[],distributeToVessels:true}],createdBy:actor,createdAt:at,updatedAt:at}];
 for(const d of [db,oracle]) {
  await query(d,'select import_ship_dynamics_records_v1($1,$2::jsonb) result',[key,JSON.stringify(base)]);
  for(const section of ['task:task-1','meeting:m1'])await d.query("insert into ship_dynamics_edit_locks values($1,$2,'qa-lease','QA OWNER',now(),now()+interval '10 minutes')",[key,section]);
 }
 await check('import-exact-raw-appdata',async()=>{assert.deepEqual(await read(),base); assert.deepEqual(await read(oracle),base);});
 // App.tsx saveTaskVesselProgress handler composition, including notifications + both audits.
 const updated=progress.updateTaskVesselProgress(task,'v1',p=>({...p,status:'已完成',isClosed:true,closedDate:'2026-09-06',closedBy:actor,statusLogs:[{id:'qa-log',at:time,by:'QA OWNER',byUserId:actor,text:'已完成'},...p.statusLogs]}),{at:time,actorId:actor});
 let draft=clone(base); draft.tasks[0]=updated;
 draft.meetings[0]=meeting.synchronizeLinkedMeetingDecisionLifecycle(base.meetings[0],updated,{actorId:actor,actorName:'QA OWNER',at:time,closedDate:'2026-09-06'});
 const notices=buildTaskNotificationsForVessels(base.users,[base.vessels[0]],actor,updated,'task_updated','QA OWNER',base.settings.rolePermissions);
 draft.notifications=[...notices,...draft.notifications].slice(0,1000);
 draft=withAudit(draft,base.users[0],'更新單船進度','task',updated.id,`${vesselDisplayName(base.vessels[0])}｜已完成｜已結案`);
 draft=withAudit(draft,base.users[0],'同步完成臨會/專題待辦','meeting','m1',richTextToPlainText(updated.description)||updated.id);
 const operations=buildCloudBlockPatch(base,draft); assertActorAuthorizedForCloudBlockPatch(base,operations,actor);
 const request={id:'complete-A',operations,guard:await query(db,'select ship_dynamics_actor_guard($1::jsonb,$2) result',[JSON.stringify(base),actor]),auth:await query(db,'select ship_dynamics_authorization_guard($1::jsonb) result',[JSON.stringify(base)]),locks:['task:task-1','meeting:m1'].map(section_key=>({section_key,locked_by:'qa-lease'}))};
 const before=await ownerOfB(); assert.equal(before.length,1);
 const result=await apply(db,request), expected=await apply(oracle,request);
 assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(expected.ok,true,JSON.stringify(expected));
 const actual=await read(), old=await read(oracle);
 await check('complete-A-full-old-representation-parity-and-linked-effects',async()=>{
  assert.deepEqual({...actual,updatedAt:'SERVER_CLOCK'},{...old,updatedAt:'SERVER_CLOCK'});
  assert.deepEqual(actual.tasks[0],updated); assert.deepEqual(actual.tasks[0].vesselProgress.map(p=>p.vesselId),['v1','v2','out-of-scope']);
  assert.equal(actual.tasks[0].status,task.status); assert.equal(actual.tasks[0].isClosed,task.isClosed);
  assert.equal(actual.meetings[0].status,base.meetings[0].status); assert.equal(meeting.meetingDecisionLifecycleIsConsistent(actual.meetings[0],actual.tasks,task.id),true);
  assert.ok(notices.length>0); assert.ok(actual.notifications.every(n=>n.vesselId==='v1')); assert.equal(actual.auditLogs.length,2);
 });
 const after=await ownerOfB(); fs.writeFileSync(path.join(evidence,'B-physical.json'),JSON.stringify({before,after,result},null,2));
 await check('A-update-does-not-rewrite-B-physical-body-tuple',async()=>assert.deepEqual(after,before,'B body owner must retain value/revision/tableoid/xmin/ctid'));
 const {rollbackLocalTaskProgress,upgradeLocalTaskProgress,progressSqlFiles,oldProgressSql,transactionBody}=await import('./record-task-progress-local-rollback.mjs');
 const revisions=async(d)=>{
  const output=[];
  for(const r of (await d.query('select workspace_key,revision from ship_dynamics_record_versions order by workspace_key,revision')).rows)
   output.push(await query(d,'select read_ship_dynamics_record_history_v1($1,$2) result',[r.workspace_key,r.revision]));
  return output;
 };
 await db.exec(fs.readFileSync(progressSqlFiles[1],'utf8'));
 await oracle.exec(oldProgressSql(progressSqlFiles[1]));
 await check('full-history-delta-equal-old-representation',async()=>{
  const comparable=values=>values.map(v=>({...v,updated_at:'SERVER_CLOCK',payload:{...v.payload,updatedAt:'SERVER_CLOCK'}}));
  assert.deepEqual(comparable(await revisions(db)),comparable(await revisions(oracle)));
  const token=await query(db,"select token result from ship_dynamics_record_read_bases where workspace_key=$1 and revision=1",[key]);
  const delta=await query(db,'select read_ship_dynamics_record_delta_v1($1,1,$2) result',[key,token]);
  const oldDelta=await query(oracle,'select read_ship_dynamics_record_delta_v1($1,1,$2) result',[key,token]);
  delta.root.set.updatedAt='SERVER_CLOCK'; oldDelta.root.set.updatedAt='SERVER_CLOCK';
  assert.deepEqual(delta,oldDelta);
  assert.deepEqual(delta.collections.find(c=>c.collection==='tasks').upserts,[updated]);
  assert.equal((await db.query("select value ? 'vesselProgress' embedded from ship_dynamics_records where collection='tasks'")).rows[0].embedded,false);
 });
 const next=clone(actual), reopened=progress.updateTaskVesselProgress(actual.tasks[0],'v1',p=>{
  const n={...p,status:'重新開啟',isClosed:false,statusLogs:[{id:'qa-reopen-log',at:time,by:'QA OWNER',byUserId:actor,text:'重新開啟'},...p.statusLogs]};delete n.closedDate;delete n.closedBy;return n;
 },{at:time,actorId:actor});
 next.tasks[0]=reopened;
 next.meetings[0]=meeting.synchronizeLinkedMeetingDecisionLifecycle(actual.meetings[0],reopened,{actorId:actor,actorName:'QA OWNER',at:time,closedDate:'2026-09-06'});
 next.notifications=[...buildTaskNotificationsForVessels(next.users,[next.vessels[0]],actor,reopened,'task_updated','QA OWNER',next.settings.rolePermissions),...next.notifications].slice(0,1000);
 const audited=withAudit(withAudit(next,next.users[0],'更新單船進度','task','task-1','重新開啟'),next.users[0],'同步重新開啟臨會/專題待辦','meeting','m1','分船事項');
 const pending={...clone(request),id:'reopen-A',operations:buildCloudBlockPatch(actual,audited)};
 assertActorAuthorizedForCloudBlockPatch(actual,pending.operations,actor);
 const reject=async(r,code)=>{const state=await ledger(db,true);const result=await apply(db,r);assert.equal(result.code,code,JSON.stringify(result));assert.deepEqual(await ledger(db,true),state);};
 for(const [id,mutate,code] of [
  ['wrong-lease',r=>{r.locks[0].locked_by='other';},'lock-conflict'],
  ['stale-task-CAS',r=>{r.operations.find(o=>o.collection==='tasks'&&o.kind==='entity').expected.status='stale';},'block-conflict'],
  ['stale-meeting-CAS',r=>{r.operations.find(o=>o.collection==='meetings'&&o.kind==='entity').expected.status='stale';},'block-conflict'],
  ['actor-conflict',r=>{r.guard={};},'authorization-conflict'],
  ['operation-mismatch',r=>{r.id=request.id;},'operation-id-mismatch']
 ])await check(id+'-zero-write',async()=>{const r=clone(pending);r.id=id;mutate(r);await reject(r,code);});
 await db.exec("update ship_dynamics_edit_locks set expires_at=now()-interval '1 minute'");
 await check('expired-lease-zero-write',async()=>reject(pending,'lock-conflict'));
 await check('lost-ACK-exact-replay-after-expiry-zero-physical-write',async()=>{
  const state=await ledger(db,true); const replay=await apply(db,request);
  assert.deepEqual(replay,{...result,replayed:true});assert.deepEqual(await ledger(db,true),state);
 });
 await db.exec("update ship_dynamics_edit_locks set expires_at=now()+interval '10 minutes'");
 await check('late-receipt-exception-proven-leaf-history-linked-write-full-rollback',async()=>{
  const state=await ledger(db,true);
  const auditCount=actual.auditLogs.length;
  await db.exec(`create sequence qa_progress_reached;
   create function qa_fail_progress_receipt() returns trigger language plpgsql as $$ begin
    if not exists(select 1 from ship_dynamics_record_task_progress where workspace_key=new.workspace_key and value->>'vesselId'='v1' and value->>'status'='重新開啟')
      or not exists(select 1 from ship_dynamics_record_task_progress_history where workspace_key=new.workspace_key and valid_to_revision=(new.result->>'revision')::int)
      or not exists(select 1 from ship_dynamics_record_history where workspace_key=new.workspace_key and collection='meetings' and valid_to_revision=(new.result->>'revision')::int)
      or (select count(*) from ship_dynamics_records where workspace_key=new.workspace_key and collection='auditLogs')<>${auditCount+2}
      or not exists(select 1 from ship_dynamics_records where workspace_key=new.workspace_key and collection='meetings' and value->>'latestStatus'='決議待辦重新開啟')
    then raise exception 'QA_WRITES_NOT_REACHED'; end if;
    perform nextval('qa_progress_reached'); raise exception 'QA_LATE_PROGRESS_FAILURE'; end $$;
   create trigger qa_fail_progress before insert on ship_dynamics_record_receipts for each row execute function qa_fail_progress_receipt();`);
  await assert.rejects(apply(db,pending),/QA_LATE_PROGRESS_FAILURE/);
  assert.equal(await query(db,"select case when is_called then last_value else 0 end::int result from qa_progress_reached"),1);
  assert.deepEqual(await ledger(db,true),state);
  await db.exec('drop trigger qa_fail_progress on ship_dynamics_record_receipts; drop function qa_fail_progress_receipt(); drop sequence qa_progress_reached;');
 });
 const rawValues=[undefined,[],null,false,'not-an-array',{unknown:[null,1]},[{vesselId:' duplicate ',unknown:1},{vesselId:' duplicate ',unknown:2},null,false,'literal',{unknown:3},{vesselId:'v2',extra:{x:[1,null]}}]];
 const rawBase=clone(base);rawBase.tasks=rawValues.map((v,i)=>{const t={...clone(task),id:` raw:${i} `,unknownTop:{reservedLooking:'task_progress_meta'}};if(v===undefined)delete t.vesselProgress;else t.vesselProgress=v;return t;});
 for(const d of [db,oracle])await query(d,'select import_ship_dynamics_records_v1($1,$2::jsonb) result',['raw-private',JSON.stringify(rawBase)]);
 await check('raw-absent-empty-null-literal-duplicates-unknown-ID-order-import',async()=>{
  for(const d of [db,oracle])assert.deepEqual((await query(d,'select read_ship_dynamics_records_v1($1) result',['raw-private'])).payload,rawBase);
 });
 // Private core here tests storage conversion, not new client authority rules.
 const rawSave=async(d,workspace,id,mutate)=>d.transaction(async tx=>{
  d=tx;
  if(await query(d,"select to_regprocedure('public.ship_dynamics_record_writer_gate_v1(text,boolean)') is not null result"))
   await query(d,'select ship_dynamics_record_writer_gate_v1($1,true) result',[workspace]);
  const payload=(await query(d,'select read_ship_dynamics_records_v1($1) result',[workspace])).payload;
  const target=clone(payload.tasks[0]);mutate(target);
  const root=(await d.query('select root from ship_dynamics_record_workspaces where workspace_key=$1',[workspace])).rows[0].root;
  const orders=await query(d,"select jsonb_object_agg(collection,ids) result from ship_dynamics_record_collections where workspace_key=$1",[workspace]);
  const operations=[{kind:'entity',collection:'tasks',entityId:target.id,expected:payload.tasks[0],value:target}];
  const r=await query(d,'select ship_dynamics_record_commit_validated_v1($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::jsonb) result',[workspace,JSON.stringify(operations),JSON.stringify(root),JSON.stringify(orders),'PRIVATE QA',id,JSON.stringify([id,operations])]);
  assert.equal(r.ok,true);return r;
 });
 for(const d of [db,oracle])for(const [i,value] of rawValues.entries())await rawSave(d,'raw-private','raw-version-'+i,t=>{if(value===undefined)delete t.vesselProgress;else t.vesselProgress=value;t.description='version '+i;});
 await check('reconstruction-corruption-refused-with-entire-upgrade-transaction-preserved',async()=>{
  for(const [id,sql,args] of [
   ['missing-body',"delete from ship_dynamics_record_task_progress where workspace_key=$1 and task_id='task-1' and value->>'vesselId'='v2'",[key]],
   ['duplicate-slot',"update ship_dynamics_records set task_progress_meta=jsonb_set(task_progress_meta,'{ids}',jsonb_build_array(task_progress_meta#>'{ids,0}',task_progress_meta#>'{ids,0}')) where workspace_key=$1 and collection='tasks' and entity_id='task-1'",[key]],
   ['wrong-workspace',"update ship_dynamics_record_task_progress set workspace_key='raw-private' where workspace_key=$1 and task_id='task-1' and value->>'vesselId'='v2'",[key]],
   ['overlap',"insert into ship_dynamics_record_task_progress_history select workspace_key,task_id,entry_id,value,revision,revision+1 from ship_dynamics_record_task_progress where workspace_key=$1 and task_id='task-1' and value->>'vesselId'='v2'",[key]],
  ]){
   const before=await ledger(db,true);
   await assert.rejects(db.transaction(async tx=>{
    await tx.query(sql,args);
    // A prior sentinel write must roll back too, not merely the final conversion.
    await tx.query("update ship_dynamics_record_workspaces set updated_by='QA_ABORT_SENTINEL' where workspace_key=$1",[key]);
    await tx.exec(transactionBody(fs.readFileSync(sqlPath,'utf8')));
   }),/record-progress-incomplete/,id);
   assert.deepEqual(await ledger(db,true),before,id+' leaves no partial write');
  }
 });
 await check('logical-history-size-counts-full-raw-task-not-storage-refs',async()=>{
  await db.exec(fs.readFileSync(progressSqlFiles[2],'utf8'));
  const sizes=(await db.query("select * from ship_dynamics_record_version_sizes_v1('raw-private') order by revision")).rows;
  for(const size of sizes){
   const historic=await query(db,'select read_ship_dynamics_record_history_v1($1,$2) result',['raw-private',size.revision]);
   const bodies=Object.values(historic.payload).filter(Array.isArray).flat();
   // All fixture root arrays are declared record collections; sum literal JSON
   // bodies from public readback, independently of private metadata/leaf IDs.
   const expected=await query(db,`select pg_column_size(root)::bigint+pg_column_size(orders)+(select sum(pg_column_size(value)::bigint) from jsonb_array_elements($3::jsonb)) result from ship_dynamics_record_versions where workspace_key=$1 and revision=$2`,['raw-private',size.revision,JSON.stringify(bodies)]);
   assert.equal(BigInt(size.logical_bytes),BigInt(expected));
  }
 });
 await check('reorder-exact-raw-duplicates-retains-all-leaf-tuples-ambiguous-change-new-slot',async()=>{
  const leaves=async()=>(await db.query("select entry_id,value,revision,tableoid::text,xmin::text,ctid::text from ship_dynamics_record_task_progress where workspace_key='raw-private' and task_id=' raw:0 ' order by entry_id")).rows;
  const before=await leaves();
  await rawSave(db,'raw-private','reorder-only',t=>{t.vesselProgress.reverse();});
  assert.deepEqual(await leaves(),before);
  const oldIds=before.filter(p=>p.value?.vesselId===' duplicate ').map(p=>p.entry_id);
  await rawSave(db,'raw-private','ambiguous-duplicate-edit',t=>{t.vesselProgress.find(p=>p?.vesselId===' duplicate ').unknown='changed';});
  const after=await leaves(),changed=after.find(p=>p.value?.unknown==='changed');
  assert.ok(changed&&!oldIds.includes(changed.entry_id),'do not guess duplicate vessel identity');
  for(const row of before.filter(p=>p.value?.vesselId!==' duplicate '))assert.deepEqual(after.find(p=>p.entry_id===row.entry_id),row);
 });
 await check('existing-old-current-multiple-history-real-upgrade-and-rerun-zero-write',async()=>{
  const before=await revisions(oracle), ledgerBefore=await ledger(oracle);
  await upgradeLocalTaskProgress(oracle);
  assert.deepEqual(await revisions(oracle),before);
  const state=await ledger(oracle,true);
  await upgradeLocalTaskProgress(oracle);
  assert.deepEqual(await ledger(oracle,true),state,'reapplying DDL must write no record/leaf/history tuples');
  for(const name of ['ship_dynamics_record_workspaces','ship_dynamics_record_versions','ship_dynamics_record_receipts','ship_dynamics_record_read_bases'])assert.deepEqual((await ledger(oracle))[name],ledgerBefore[name]);
  fs.writeFileSync(path.join(evidence,'upgrade.json'),JSON.stringify({versions:before.map(v=>[v.workspace_key,v.revision]),zeroWriteRerun:true,immutableLedger:true},null,2));
 });
 await check('post-upgrade-commit-reverse-new-data-and-all-readable-history',async()=>{
  await rawSave(oracle,'raw-private','new-after-upgrade',t=>{t.vesselProgress=[{vesselId:'post-upgrade',unknown:'NEW DATA NOT IN OLD BACKUP'},...t.vesselProgress];});
  const before=await ledger(oracle);
  const reverse=await rollbackLocalTaskProgress(oracle);
  for(const name of ['ship_dynamics_record_workspaces','ship_dynamics_record_versions','ship_dynamics_record_receipts','ship_dynamics_record_read_bases'])assert.deepEqual((await ledger(oracle))[name],before[name]);
  assert.ok((await query(oracle,'select read_ship_dynamics_records_v1($1) result',['raw-private'])).payload.tasks[0].vesselProgress.some(p=>p?.vesselId==='post-upgrade'));
  fs.writeFileSync(path.join(evidence,'reverse.json'),JSON.stringify(reverse,null,2));
 });
 await check('installed-catalog-private-invoker-RLS-no-browser-grants',async()=>{
  const tables=['ship_dynamics_record_task_progress','ship_dynamics_record_task_progress_history'];
  for(const table of tables){
   assert.equal(await query(db,'select relrowsecurity result from pg_class where oid=$1::regclass',[table]),true);
   for(const role of ['anon','authenticated'])assert.equal(await query(db,"select has_table_privilege($1,$2,'select,insert,update,delete') result",[role,table]),false);
  }
  const functions=(await db.query("select oid::regprocedure::text signature,prosecdef from pg_proc where proname in ('ship_dynamics_record_hydrate_v1','ship_dynamics_record_progress_write_v1')")).rows;
  assert.equal(functions.length,2);
  for(const f of functions){assert.equal(f.prosecdef,false);for(const role of ['anon','authenticated'])assert.equal(await query(db,"select has_function_privilege($1,$2,'execute') result",[role,f.signature]),false);}
  fs.writeFileSync(path.join(evidence,'catalog.json'),JSON.stringify({tables,functions},null,2));
 });

 console.log(JSON.stringify({ok:true,cases,evidence}));
} catch(error) {failure=error;console.error(error.stack||error);} finally {
 fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({ok:!failure,cases,error:failure?.stack,evidence},null,2));
 console.log('EVIDENCE '+evidence);
 await vite.close(); await db.close(); await oracle.close();
}
if(failure)process.exitCode=1;

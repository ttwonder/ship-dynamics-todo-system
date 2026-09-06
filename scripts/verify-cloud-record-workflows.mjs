import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// No remote URL/credentials accepted. Two independent in-memory SQL authorities.
const db = new PGlite(), oracle = new PGlite();
const vite = await createServer({ server:{middlewareMode:true},appType:'custom',logLevel:'silent' });
let failure=null;
const results=[];
const clone=value=>JSON.parse(JSON.stringify(value));
const workspace='workflow-fixture', actor='qa-owner', at='2026-09-06T00:00:00.000Z';
const query=async(d,sql,params=[]) => (await d.query(sql,params)).rows[0]?.result;
const current=async()=> (await query(db,'select public.read_ship_dynamics_records_v1($1) as result',[workspace])).payload;
const rows=async()=> (await db.query(`select kind,value from (
 select 'root' as kind,to_jsonb(w) as value from ship_dynamics_record_workspaces w
 union all select 'collections',to_jsonb(c) from ship_dynamics_record_collections c
 union all select 'records',to_jsonb(r) from ship_dynamics_records r
 union all select 'receipts',to_jsonb(r) from ship_dynamics_record_receipts r
 union all select 'read-bases',to_jsonb(r) from ship_dynamics_record_read_bases r
 union all select 'versions',to_jsonb(r) from ship_dynamics_record_versions r
 union all select 'history',to_jsonb(r) from ship_dynamics_record_history r
) state order by kind,value::text`)).rows;
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
let buildPatch, audit, assertAuthorized;
const make=async(next,keys=[],name='operation',base=null)=>{
 base=base||await current();
 const operations=buildPatch(base,next);
 assertAuthorized(base,operations,actor);
 const guard=await query(db,'select ship_dynamics_actor_guard($1::jsonb,$2) as result',[JSON.stringify(base),actor]);
 const authorization=await query(db,'select ship_dynamics_authorization_guard($1::jsonb) as result',[JSON.stringify(base)]);
 const locks=keys.map(section_key=>({section_key,locked_by:'qa-lease'}));
 for(const d of [db,oracle])for(const section_key of keys) await d.query("insert into ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values($1,$2,'qa-lease','QA OWNER',now()+interval '10 minutes') on conflict(workspace_key,section_key) do update set expires_at=excluded.expires_at",[workspace,section_key]);
 return {id:name,operations,guard,authorization,locks};
};
const run=async(d,request,legacy=false)=>query(d,`select ${legacy?'apply_ship_dynamics_block_patch_v2':'apply_ship_dynamics_record_patch_v1'}($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) as result`,[workspace,request.id,JSON.stringify(request.operations),'QA OWNER',actor,JSON.stringify(request.guard),request.authorization==null?null:JSON.stringify(request.authorization),JSON.stringify(request.locks)]);
const commitBoth=async(request)=>{
 const actual=await run(db,request), expected=await run(oracle,request,true);
 assert.equal(actual.ok,true,JSON.stringify(actual)); assert.equal(expected.ok,true,JSON.stringify(expected));
 assert.equal(actual.revision,expected.revision);
 const value=await current();
 const old=(await oracle.query('select payload from ship_dynamics_app_state where workspace_key=$1',[workspace])).rows[0].payload;
 assert.deepEqual({...value,updatedAt:'SERVER_CLOCK'},{...old,updatedAt:'SERVER_CLOCK'});
 return value;
};
const reject=async(request,code)=>{const before=await rows();const result=await run(db,request);assert.equal(result.code,code,JSON.stringify(result));assert.deepEqual(await rows(),before);};
try {
 for(const d of [db,oracle]){
  await d.exec('create role anon nologin;create role authenticated nologin;');
  await d.exec(fs.readFileSync('supabase/schema.sql','utf8'));
  await d.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-forwarded-for':'192.0.2.20','cf-ipcountry':'TW'})]);
 }
 await db.exec(fs.readFileSync('supabase/development/20260906_appdata_record_store.sql','utf8'));
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 ({buildCloudBlockPatch:buildPatch}=await vite.ssrLoadModule('/src/cloudBlockPatch.ts'));
 ({withAudit:audit}=await vite.ssrLoadModule('/src/utils.ts'));
 ({assertActorAuthorizedForCloudBlockPatch:assertAuthorized}=await vite.ssrLoadModule('/src/cloudAuthorization.ts'));
 const base=createInitialData();base.revision=1;base.updatedAt=at;base.legacyExtension={nested:['保留原值',null,false]};
 base.users=[{id:actor,department:'督導',name:'QA OWNER',username:actor,role:'owner',passwordHash:'',isActive:true,managedVesselIds:[],createdAt:at,updatedAt:at}];
 base.users.push({...clone(base.users[0]),id:'qa-observer',username:'qa-observer',name:'QA OBSERVER',role:'operator',managedVesselIds:['v1','v2']});
 base.vessels=['v1','v2'].map(id=>({...clone(base.vessels[0]),id,name:'QA '+id,assignedUserIds:[actor,'qa-observer'],delegateManagers:[]}));
 for(const c of ['tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'])base[c]=[];
 base.notifications=[{id:'qa-own-notice',userId:actor,vesselId:'v1',taskId:'task-1',kind:'task_updated',title:'本機通知',body:'純測試資料',actorId:'qa-observer',createdAt:at}];
 await query(db,'select import_ship_dynamics_records_v1($1,$2::jsonb) as result',[workspace,JSON.stringify(base)]);
 await oracle.query('insert into ship_dynamics_app_state(workspace_key,payload,revision) values($1,$2::jsonb,1)',[workspace,JSON.stringify(base)]);
 const stamp=(draft,action,type,id)=>audit(draft,draft.users[0],action,type,id,'本機完整交易測試');
 const task={id:'task-1',vesselId:'v1',vesselIds:['v1'],description:'TEST TASK',priority:'低',isAware:false,isAbnormal:false,isInternalControl:false,category:'其他',categories:['其他'],status:'處理中',statusLogs:[],expectedDate:'',reportDate:'2026-09-06',departments:['督導'],ownerUserIds:[],isClosed:false,sourceType:'morning',createdBy:actor,updatedBy:actor,createdAt:at,updatedAt:at};
 await check('ordinary task creation + audit + authoritative order through unchanged producer',async()=>{
  const draft=clone(await current());draft.tasks.push(task);
  await commitBoth(await make(stamp(draft,'新增事項','task',task.id),[`task-create:v2:v1:${task.id}`],'task-create'));
 });
 const {verifyRecordLifecycles}=await import('./verify-cloud-record-lifecycles.mjs');
 await verifyRecordLifecycles({vite,check,current,make,commitBoth,reject,rows,run,db,actor,at,stamp});
 await check('settings updates retain unknown root fields and reject stale settings CAS',async()=>{
  const before=await current();const draft=clone(before);draft.settings.taskCategories=[...draft.settings.taskCategories,'本機分類'];
  const request=await make(stamp(draft,'更新設定','settings','settings'),[],'settings-update');
  const bad=clone(request);bad.id+='-stale';bad.operations.find(op=>op.kind==='settings').expected.taskCategories=[];await reject(bad,'block-conflict');
  await commitBoth(request);
 });
 await check('authorization-bearing user and vessel assignment bundle requires whole-domain guard',async()=>{
  const draft=clone(await current());draft.users.push({...clone(draft.users[1]),id:'qa-new',username:'qa-new',name:'QA NEW'});
  draft.vessels[0].assignedUserIds.push('qa-new');
  const request=await make(stamp(draft,'新增帳戶','user','qa-new'),[],'user-assignment');
  await reject({...request,id:'missing-auth',authorization:null},'authorization-conflict');
  await commitBoth(request);
 });
 await check('whole collection reorder preserves every row body and revision',async()=>{
  const draft=clone(await current());draft.vessels.reverse();
  const before=(await db.query("select entity_id,value,revision,xmin::text from ship_dynamics_records where collection='vessels' order by entity_id")).rows;
  await commitBoth(await make(stamp(draft,'調整船舶排序','vessel','all'),[],'vessel-order'));
  assert.deepEqual((await db.query("select entity_id,value,revision,xmin::text from ship_dynamics_records where collection='vessels' order by entity_id")).rows,before);
 });
 await check('agenda report creation and deletion preserve original payload contract',async()=>{
  let draft=clone(await current());draft.agendaReports.push({id:'qa-report',title:'本機報告',vesselIds:['v1'],createdBy:actor,createdAt:at,taskCount:draft.tasks.length});
  await commitBoth(await make(stamp(draft,'匯出早會報告','report','qa-report'),[],'report-create'));
  draft=clone(await current());draft.agendaReports=[];
  await commitBoth(await make(stamp(draft,'刪除報告','report','qa-report'),[],'report-delete'));
 });
 await check('notification read marker requires no spurious business audit',async()=>{
  const next=clone(await current());next.notifications.find(n=>n.id==='qa-own-notice').readAt=at;
  const auditBefore=clone(next.auditLogs);
  const saved=await commitBoth(await make(next,[],'notice-read'));assert.deepEqual(saved.auditLogs,auditBefore);
 });
 await check('late SQL exception rolls back multi-domain bodies, orders, revision and receipt',async()=>{
  const draft=clone(await current());const task=draft.tasks.find(t=>!t.sourceMeetingId&&!t.internalControlCaseId);task.description+=' crash probe';draft.settings.taskCategories.push('不得留下');
  const request=await make(stamp(draft,'更新事項','task',task.id),['task:'+task.id],'workflow-crash');const before=await rows();
  await db.exec("create function qa_workflow_crash() returns trigger language plpgsql as $$begin raise exception 'QA_WORKFLOW_CRASH';end$$;create trigger qa_crash before insert on ship_dynamics_record_receipts for each row execute function qa_workflow_crash()");
  try{await assert.rejects(run(db,request),/QA_WORKFLOW_CRASH/);assert.deepEqual(await rows(),before);}
  finally{await db.exec('drop trigger qa_crash on ship_dynamics_record_receipts;drop function qa_workflow_crash()');}
 });
 assert.equal((await db.query('select count(*)::integer n from ship_dynamics_app_state')).rows[0].n,0);
 console.log(JSON.stringify({record_workflows:'PASS',cases:results.length,results,hostedSupabase:'NOT_RUN'}));
} catch(error){failure=error;console.error(JSON.stringify({error:error.message,stack:error.stack,code:error.code,where:error.where,actual:error.actual,expected:error.expected}));}
finally {await vite.close();await db.close();await oracle.close();}
if(failure)process.exitCode=1;

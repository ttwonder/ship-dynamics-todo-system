import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'vite';
const db=new PGlite();
const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
const clone=value=>JSON.parse(JSON.stringify(value));
const results=[];const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
let failure=null;
const query=async(sql,params=[]) => (await db.query(sql,params)).rows[0]?.result;
const key='record-delta-fixture',at='2026-09-06T00:00:00.000Z',actor='qa-owner';
const full=async()=> (await query('select read_ship_dynamics_records_v1($1) as result',[key])).payload;
const delta=base=>query('select read_ship_dynamics_record_delta_v1($1,$2,$3) as result',[key,base?.revision??null,base?.token??null]);
try{
 await db.exec('create role anon nologin;create role authenticated nologin;');
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/development/20260906_appdata_record_store.sql','utf8'));
 const deltaSQL='supabase/development/20260906_appdata_record_delta.sql';
 if(fs.existsSync(deltaSQL))await db.exec(fs.readFileSync(deltaSQL,'utf8'));
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {buildCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudBlockPatch.ts');
 const {consumeCloudDeltaResponse}=await vite.ssrLoadModule('/src/cloudDelta.ts');
 const {withAudit}=await vite.ssrLoadModule('/src/utils.ts');
 const {assertActorAuthorizedForCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudAuthorization.ts');
 const base=createInitialData();base.revision=1;base.updatedAt=at;
 base.users=[{id:actor,name:'QA OWNER',username:actor,department:'督導',role:'owner',isActive:true,managedVesselIds:[],passwordHash:'',createdAt:at,updatedAt:at}];
 base.vessels=[{...clone(base.vessels[0]),id:'v1',name:'本機測試船',assignedUserIds:[],delegateManagers:[]}];
 base.tasks=Array.from({length:1000},(_,i)=>({id:'task-'+i,vesselId:'v1',vesselIds:['v1'],description:'僅測試資料 '+i+' x'.repeat(300),priority:'低',isAware:false,isAbnormal:false,isInternalControl:false,category:'其他',categories:['其他'],status:'處理中',statusLogs:[],expectedDate:'',reportDate:'2026-09-06',departments:['督導'],ownerUserIds:[],isClosed:false,sourceType:'morning',createdBy:actor,updatedBy:actor,createdAt:at,updatedAt:at}));
 for(const name of ['internalControlCases','meetings','agendaReports','notifications','auditLogs'])base[name]=[];
 delete base.taskDismissals;
 await query('select import_ship_dynamics_records_v1($1,$2::jsonb) as result',[key,JSON.stringify(base)]);
 let snapshot;let initialBytes;
 const consume=response=>consumeCloudDeltaResponse(response,key,snapshot);
 const save=async(id,mutate,keys=[])=>{
  const before=await full();const next=clone(before);mutate(next);
  const operations=buildCloudBlockPatch(before,next);assertActorAuthorizedForCloudBlockPatch(before,operations,actor);
  const guard=await query('select ship_dynamics_actor_guard($1::jsonb,$2) as result',[JSON.stringify(before),actor]);
  const authorization=await query('select ship_dynamics_authorization_guard($1::jsonb) as result',[JSON.stringify(before)]);
  for(const section of keys)await db.query("insert into ship_dynamics_edit_locks values($1,$2,'qa-lease','QA OWNER',now(),now()+interval '10 minutes') on conflict(workspace_key,section_key) do update set expires_at=excluded.expires_at",[key,section]);
  const result=await query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) as result',[key,id,JSON.stringify(operations),'QA OWNER',actor,JSON.stringify(guard),JSON.stringify(authorization),JSON.stringify(keys.map(section_key=>({section_key,locked_by:'qa-lease'})))]);
  assert.equal(result.ok,true,JSON.stringify(result));return result;
 };
 await check('record delta initial read is an exact authoritative snapshot',async()=>{
  const response=await delta(null);assert.equal(response.status,'snapshot');snapshot=consume(response);assert.deepEqual(snapshot.payload,base);initialBytes=Buffer.byteLength(JSON.stringify(response));
 });
 await check('unchanged read sends no bodies and does not need a history row',async()=>{
  const response=await delta(snapshot);assert.equal(response.status,'delta');assert.deepEqual(response.collections,[]);assert.deepEqual(response.root,{set:{},deleted:[]});assert.deepEqual(consume(response).payload,base);
 });
 const oldSnapshot=clone(snapshot);
 await check('one changed task fetches one row rather than all task bodies',async()=>{
  await save('one-change',draft=>{draft.tasks[0].description='已修改一筆';},['task:task-0']);
  const response=await delta(snapshot);assert.equal(response.status,'delta');assert.deepEqual(response.collections.map(c=>[c.collection,c.upserts.length,c.deleted.length]),[['tasks',1,0]]);
  assert.equal(Object.hasOwn(response.collections[0],'order'),false);
  snapshot=consume(response);assert.deepEqual(snapshot.payload,await full());
  const bytes=Buffer.byteLength(JSON.stringify(response));assert.ok(bytes<initialBytes/10);console.log(JSON.stringify({syntheticTaskRows:1000,snapshotBytes:initialBytes,oneRowDeltaBytes:bytes,realNetworkTiming:'NOT_MEASURED'}));
 });
 await check('missed revisions include deletes, transient creations and current authoritative order',async()=>{
  await save('delete-and-add',draft=>{draft.tasks=draft.tasks.filter(t=>t.id!=='task-1');draft.tasks.push({...clone(draft.tasks[0]),id:'transient'});},['task:task-1','task-create:v2:v1:transient']);
  await save('remove-transient',draft=>{draft.tasks=draft.tasks.filter(t=>t.id!=='transient');draft.tasks.reverse();},['task:transient']);
  const response=await delta(oldSnapshot);const merged=consumeCloudDeltaResponse(response,key,oldSnapshot);assert.deepEqual(merged.payload,await full());
  assert.deepEqual(response.collections.find(c=>c.collection==='tasks').deleted,['task-1']);snapshot=merged;
 });
 await check('new optional collection, settings and server-stamped audit are included atomically',async()=>{
  await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-forwarded-for':'192.0.2.44','cf-ipcountry':'TW'})]);
  await save('settings-dismissal',draft=>{
   draft.settings.taskCategories.push('新分類');draft.taskDismissals=[{id:'d1',itemKind:'task',itemId:'task-0',userId:actor,dismissedBy:actor,dismissedAt:at}];
   Object.assign(draft,withAudit(draft,draft.users[0],'更新設定','settings','settings','本機測試'));
  });
  const response=await delta(snapshot);snapshot=consume(response);assert.deepEqual(snapshot.payload,await full());assert.equal(snapshot.payload.auditLogs[0].ipAddress,'192.0.2.44');assert.ok(Array.isArray(response.root.set.taskDismissals));
 });
 await check('wrong token or pruned baseline returns a real full snapshot, not guessed changes',async()=>{
  assert.equal((await delta({...snapshot,token:'wrong-token'})).status,'snapshot');
  await db.query('delete from ship_dynamics_record_read_bases where workspace_key=$1',[key]);
  const fallback=await delta(oldSnapshot);assert.equal(fallback.status,'snapshot');assert.deepEqual(consumeCloudDeltaResponse(fallback,key,oldSnapshot).payload,await full());
 });
 await check('record delta reader and base metadata stay private to database owner',async()=>{
  for(const role of ['anon','authenticated']){
   assert.equal((await db.query("select has_function_privilege($1,'read_ship_dynamics_record_delta_v1(text,integer,text)','execute') allowed",[role])).rows[0].allowed,false);
   assert.equal((await db.query("select has_table_privilege($1,'ship_dynamics_record_read_bases','select') allowed",[role])).rows[0].allowed,false);
  }
 });
 const sqlCases=results.length;
 await db.exec(fs.readFileSync('supabase/development/20260905_appdata_delta_reads.sql','utf8'));
 const {verifyRecordDeltaAdapter}=await import('./verify-cloud-record-delta-adapter.mjs');
 await verifyRecordDeltaAdapter({db,vite,check,save,full,key});
 console.log(JSON.stringify({recordDeltaSQL:'PASS',sqlCases,adapterCases:results.length-sqlCases,cases:results.length,results,hosted:'NOT_RUN'}));
}catch(error){failure=error;console.error(JSON.stringify({error:error.message,code:error.code,where:error.where,stack:error.code?.startsWith('ERR')?error.stack:undefined,actual:error.actual,expected:error.expected}));}
finally{await vite.close();await db.close();}
if(failure)process.exitCode=1;

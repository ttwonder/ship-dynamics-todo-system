import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'vite';
import {createClient} from '@supabase/supabase-js';
import {installItineraryFixture,seedItineraryFixture,snapshotItineraryAuthority,recordItinerarySql,itineraryWorkspaceId} from './record-itinerary-local-fixture.mjs';
const db=new PGlite(),tests=[];let vite,failure;
const check=async(name,fn)=>{await fn();tests.push(name);console.log(`PASS ${name}`);};
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const key='record-itinerary-qa',uuid='11111111-1111-4111-8111-111111111111';
try {
 await db.exec('create role anon;create role authenticated;');
 for(const file of ['supabase/schema.sql','supabase/development/20260906_appdata_record_store.sql'])await db.exec(fs.readFileSync(file,'utf8'));
 await installItineraryFixture(db);
 vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');const data=createInitialData();
 data.users=[{id:'same-user',name:'Record name',username:'record-name',department:'Record dept',role:'vessel',isActive:true}];
 const vessels=[{id:'v1'},{id:'v2'}];data.vessels=vessels;
 await scalar('select import_ship_dynamics_records_v1($1,$2::jsonb)',[key,JSON.stringify(data)]);
 await db.query('insert into ship_dynamics_app_state(workspace_key,revision,payload) values($1,99,$2::jsonb)',[key,JSON.stringify({...data,users:[{...data.users[0],role:'owner',name:'Legacy name'}]})]);
 const formal=await seedItineraryFixture(db,vite,key,vessels);
 await db.query(`insert into auth.users(id) values($1);`,[uuid]);
 await db.query(`insert into sd_profiles(id,display_name,username_label) values($1,'Profile name','profile-name')`,[uuid]);
 await db.query(`insert into sd_memberships(workspace_id,user_id,legacy_user_id,department,role,is_active) values($1,$2,'same-user','Membership dept','owner',true)`,[itineraryWorkspaceId,uuid]);
 const before=await snapshotItineraryAuthority(db);
 if(fs.existsSync(recordItinerarySql))await db.exec(fs.readFileSync(recordItinerarySql,'utf8'));
 const actor=id=>scalar('select sd_itinerary_record_actor_v1($1,$2)',[key,id]);
 const load=(id='same-user',ids=['v1','v2'])=>scalar('select sd_itinerary_record_load_many_v1($1,$2::text[],$3)',[key,ids,id]);
 await check('record role wins over same-workspace legacy and membership role; formal document authority is shared',async()=>{
  const a=await actor('same-user');assert.equal(a.role,'vessel');assert.equal(a.displayName,'Record name');assert.equal(a.actorUuid,uuid);assert.equal(a.actorKey,uuid);assert.equal(a.legacyUserId,'same-user');
  assert.equal((await scalar('select sd_itinerary_main_actor($1,$2)',[key,'same-user'])).role,'owner');
  const rows=await load();assert.equal(rows.length,2);assert.deepEqual(rows,await scalar('select sd_itinerary_main_load_many($1,$2::text[],$3)',[key,['v1','v2'],'same-user']));
  assert.deepEqual(rows.find(r=>r.vesselId==='v1').document.rows,formal.rows);assert.deepEqual(rows.find(r=>r.vesselId==='v1').document.alternativePlans,formal.alternativePlans);
  assert.equal(rows.find(r=>r.vesselId==='v1').document.vesselName,'FORMAL v1');assert.equal(rows.find(r=>r.vesselId==='v2').document,null);
 });
 await check('UUID mapping keeps existing profile metadata but takes current role from record user',async()=>{
   const a=await actor(uuid);assert.equal(a.role,'vessel');assert.equal(a.displayName,'Profile name');assert.equal(a.department,'Membership dept');assert.equal(a.actorUuid,uuid);assert.equal(a.legacyUserId,'same-user');
   assert.equal((await scalar('select sd_itinerary_main_actor($1,$2)',[key,uuid])).role,'owner');
 });
 for(const role of ['owner','admin','operator','vessel'])await check(`record ${role} preserves existing four-role read scope`,async()=>{
   await db.query("update ship_dynamics_records set value=jsonb_set(value,'{role}',$1::jsonb) where workspace_key=$2 and collection='users' and entity_id='same-user'",[JSON.stringify(role),key]);
   assert.equal((await actor('same-user')).role,role);assert.equal((await load()).length,2);
 });
 await check('inactive record actor cannot be revived by active legacy payload or UUID membership',async()=>{
   await db.query("update ship_dynamics_records set value=jsonb_set(value,'{isActive}','false') where workspace_key=$1 and collection='users'",[key]);
   for(const id of ['same-user',uuid]){await assert.rejects(()=>load(id),/not-authorized/);assert.equal((await scalar('select sd_itinerary_main_actor($1,$2)',[key,id])).role,'owner');}
 });
 await check('missing record actor cannot be revived even for empty list or by active membership',async()=>{
   await db.query("delete from ship_dynamics_records where workspace_key=$1 and collection='users'",[key]);
   for(const id of ['same-user',uuid])for(const ids of [['v1'],[]])await assert.rejects(()=>load(id,ids),/not-authorized/);
   await db.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,'users','same-user',$2::jsonb,1)",[key,JSON.stringify(data.users[0])]);
 });
 await check('invalid role and cross-workspace actor fail closed',async()=>{
   await db.query("update ship_dynamics_records set value=jsonb_set(value,'{role}','\"unknown\"') where workspace_key=$1 and collection='users'",[key]);
   await assert.rejects(()=>load(),/not-authorized/);
   await db.query("update ship_dynamics_records set value=$2::jsonb where workspace_key=$1 and collection='users'",[key,JSON.stringify(data.users[0])]);
   await assert.rejects(()=>scalar('select sd_itinerary_record_load_many_v1($1,$2::text[],$3)',['another-workspace',['v1'],'same-user']),/not-authorized/);
 });
 await check('formal active vessel filter, exact requested IDs and missing document retain old read shape',async()=>{
   assert.deepEqual(await load('same-user',[]),[]);assert.deepEqual(await load('same-user',['missing']),[]);
   await db.exec('begin');try {await db.query("update sd_vessels set is_active=false where id='v1'");assert.deepEqual((await load()).map(r=>r.vesselId),['v2']);}finally{await db.exec('rollback');}
 });
 await check('read plus additive SQL rerun leave all sd_* rows, leases, document/report histories and legacy state physically unchanged',async()=>{
   await db.exec(fs.readFileSync(recordItinerarySql,'utf8'));await load();assert.deepEqual(await snapshotItineraryAuthority(db),before);
   assert.ok(before.sd_itinerary_history.length);assert.ok(before.sd_itinerary_leases.length);assert.ok(before.sd_itinerary_daily_reports.length);
 });
 await check('new SQL is STABLE invoker, private to owner; anon/authenticated execution rejected',async()=>{
   const procs=(await db.query("select proname,provolatile,prosecdef,proconfig from pg_proc where proname in ('sd_itinerary_record_actor_v1','sd_itinerary_record_load_many_v1') order by proname")).rows;
   assert.equal(procs.length,2);for(const p of procs){assert.equal(p.provolatile,'s');assert.equal(p.prosecdef,false);assert.deepEqual(p.proconfig,['search_path=pg_catalog, public']);}
   for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);try {await assert.rejects(()=>load(),/permission denied/);await assert.rejects(()=>actor('same-user'),/permission denied/);}finally {await db.exec('reset role');}}
 });
 const cloud=await vite.ssrLoadModule('/src/itinerary/itineraryCloud.ts');
 const calls=[];let missing=false;
 const client=createClient('http://127.0.0.1:49995','synthetic-not-a-key',{auth:{persistSession:false},global:{fetch:async(url,options)=>{
   const name=new URL(url).pathname.split('/').pop(),args=JSON.parse(options.body);calls.push(name);
   if(missing)return new Response(JSON.stringify({code:'PGRST202',message:'record read capability missing'}),{status:404});
   assert.ok(['sd_itinerary_main_load_many','sd_itinerary_record_load_many_v1'].includes(name));
   try {return new Response(JSON.stringify(await scalar(`select ${name}($1,$2::text[],$3)`,[args.p_workspace_key,args.p_vessel_ids,args.p_actor_user_id])),{status:200});}
   catch(error){return new Response(JSON.stringify({code:error.code,message:error.message}),{status:400});}
 }}});
 const config={supabaseUrl:'http://127.0.0.1:49995',supabaseAnonKey:'synthetic-not-a-key',workspaceKey:key,tableName:'ship_dynamics_app_state',storageMode:'records-v1'};
 const repo=new cloud.OfficeItineraryCloudRepository({userId:'same-user'},config,client);
 await check('real Supabase JS adapter chooses record RPC and validates real formal/alternative SQL document',async()=>{
   const doc=await repo.loadDocument('v1');assert.equal(calls.at(-1),'sd_itinerary_record_load_many_v1');
   assert.equal(doc.revision,7);assert.equal(doc.rows[0].previousPortName,'QA FORMAL BUSAN');assert.deepEqual(doc.alternativePlans,formal.alternativePlans);
 });
 await check('record read authorization error never retries legacy identity',async()=>{
   await db.query("update ship_dynamics_records set value=jsonb_set(value,'{isActive}','false') where workspace_key=$1 and collection='users'",[key]);
   const count=calls.length;await assert.rejects(()=>repo.loadDocument('v1'),/not-authorized/);assert.deepEqual(calls.slice(count),['sd_itinerary_record_load_many_v1']);
   await db.query("update ship_dynamics_records set value=jsonb_set(value,'{isActive}','true') where workspace_key=$1 and collection='users'",[key]);
 });
 await check('missing new RPC fails closed with one call and no legacy fallback',async()=>{
   missing=true;const count=calls.length;await assert.rejects(()=>repo.loadMany(['v1']),/PGRST202/);assert.deepEqual(calls.slice(count),['sd_itinerary_record_load_many_v1']);missing=false;
 });
 await check('legacy config still selects original SQL RPC with record table present',async()=>{
   const legacy=new cloud.OfficeItineraryCloudRepository({userId:'same-user'},{...config,storageMode:'legacy'},client);
   assert.equal((await legacy.loadDocument('v1')).revision,7);assert.equal(calls.at(-1),'sd_itinerary_main_load_many');
 });
 console.log(JSON.stringify({itineraryRecordRead:'PASS',cases:tests.length,tests}));
} catch(error){failure=error;console.error({message:error.message,code:error.code,stack:error.stack});} finally {if(vite)await vite.close();await db.close();if(failure)process.exitCode=1;}

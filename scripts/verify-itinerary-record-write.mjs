import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'vite';
import {createClient} from '@supabase/supabase-js';
import {installItineraryFixture,seedItineraryFixture,recordItinerarySql,recordItineraryWriteSql,recordWriteArgs,itineraryWorkspaceId} from './record-itinerary-local-fixture.mjs';
const writeSql=recordItineraryWriteSql;
const db=new PGlite(),tests=[];let vite,failure;
const check=async(layer,name,fn)=>{await fn();tests.push({layer,name});console.log(`PASS ${layer}: ${name}`);};
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const key='record-itinerary-write-qa',user='same-user';
const sqlCall=async(name,args)=>{
 const specs=recordWriteArgs[name]||recordWriteArgs[name.replace('sd_itinerary_main_','sd_itinerary_record_')+'_v1'];
 assert.ok(specs,`unexpected RPC ${name}`);
 return scalar(`select ${name}(${specs.map((s,i)=>`$${i+1}::${s.split(':')[1]||'text'}`).join(',')})`,specs.map(s=>{const [k,t]=s.split(':');return t==='jsonb'?JSON.stringify(args[k]):args[k];}));
};
const base={p_workspace_key:key,p_vessel_id:'v1',p_holder_session:'tab',p_holder_label:'Spoofed',p_ttl_seconds:75,p_actor_user_id:user};
const call=(action,args)=>sqlCall(`sd_itinerary_record_${action}_v1`,{...base,...args});
const snapshot=async()=>{const result={};for(const {tablename} of (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows)result[tablename]=(await db.query(`select to_jsonb(t) as value,xmin::text,ctid::text from "${tablename}" t order by to_jsonb(t)::text`)).rows;return result;};
let formal,lease,saveArgs,result;
try {
 await db.exec('create role anon;create role authenticated;');
 for(const file of ['supabase/schema.sql','supabase/development/20260906_appdata_record_store.sql'])await db.exec(fs.readFileSync(file,'utf8'));
 await installItineraryFixture(db);
 vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');const data=createInitialData();
 data.users=[{id:user,name:'Record author',username:'record',department:'QA',role:'vessel',isActive:true},{id:'other',name:'Other',role:'owner',isActive:true}];data.vessels=[{id:'v1'},{id:'v2'}];
 await scalar('select import_ship_dynamics_records_v1($1,$2::jsonb)',[key,JSON.stringify(data)]);
 await db.query('insert into ship_dynamics_app_state(workspace_key,revision,payload) values($1,99,$2::jsonb)',[key,JSON.stringify({...data,users:data.users.map(u=>({...u,role:'owner',name:'Legacy author'}))})]);
 formal=await seedItineraryFixture(db,vite,key,data.vessels);
 await db.exec("insert into sd_itinerary_documents select workspace_id,'v2',revision,schema_version,rows_payload,updated_at,updated_actor_kind,updated_actor_id,updated_actor_label,alternative_plans_payload from sd_itinerary_documents where vessel_id='v1'");
 await db.query("insert into sd_itinerary_leases(workspace_id,vessel_id,lease_id,actor_kind,actor_key,holder_session,holder_label,fencing_token,expires_at) values($1,'v2',$2,'office','main:other','other-tab','Other',9,now()+interval '1 hour')",[itineraryWorkspaceId,randomUUID()]);
 await db.exec(fs.readFileSync(recordItinerarySql,'utf8'));
 if(fs.existsSync(writeSql))await db.exec(fs.readFileSync(writeSql,'utf8'));
 await db.exec("update sd_itinerary_leases set expires_at=now()-interval '1 second' where vessel_id='v1'");
 await check('SQL','claim → renew → atomic formal/alternative save → status → release',async()=>{
  const before=await snapshot();
  lease=await call('claim_lease');assert.equal(lease.ok,true);
  assert.equal((await scalar('select holder_label from sd_itinerary_leases where vessel_id=$1',['v1'])),'Record author');
  const guard={p_lease_id:lease.leaseId,p_fencing_token:lease.fencingToken};
  assert.equal((await call('renew_lease',guard)).ok,true);
  saveArgs={...guard,p_expected_revision:7,p_operation_id:randomUUID(),p_rows:formal.rows,p_alternative_plans:formal.alternativePlans,p_actor_label:'Spoofed'};
  result=await call('save',saveArgs);assert.equal(result.ok,true);assert.equal(result.document.revision,8);assert.equal(result.document.updatedActorLabel,'Record author');
  assert.deepEqual(result.document.rows,formal.rows);assert.deepEqual(result.document.alternativePlans,formal.alternativePlans);
  assert.deepEqual(await call('operation_status',{p_operation_id:saveArgs.p_operation_id}),result);
  assert.equal(await call('release_lease',guard),true);
  const after=await snapshot();for(const table of Object.keys(before))if(!['sd_itinerary_documents','sd_itinerary_history','sd_itinerary_operations','sd_itinerary_leases'].includes(table))assert.deepEqual(after[table],before[table],`unrelated ${table}`);
  for(const table of ['sd_itinerary_documents','sd_itinerary_history','sd_itinerary_leases'])assert.deepEqual(after[table].filter(r=>r.value.vessel_id==='v2'),before[table].filter(r=>r.value.vessel_id==='v2'),`other-vessel ${table}`);
  assert.equal(after.sd_itinerary_history.length,before.sd_itinerary_history.length+1);assert.equal(after.sd_itinerary_operations.length,1);
 });
 const rejects=async(fn,pattern)=>{await db.exec('savepoint expected_error');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_error');}};
 const rollback=async fn=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
 await check('SQL','expired-lease exact replay returns original result without document/history/lease writes',async()=>{
  const before=await snapshot(),replay=await call('save',saveArgs);assert.deepEqual(replay,{...result,replayed:true});assert.deepEqual(await snapshot(),before);
 });
 for(const role of ['owner','admin','operator','vessel'])await check('SQL',`${role} retains original four-role Office write scope`,()=>rollback(async()=>{
  await db.query("update ship_dynamics_records set value=jsonb_set(value,'{role}',$1::jsonb) where collection='users' and entity_id=$2",[JSON.stringify(role),user]);
  const claimed=await call('claim_lease');assert.equal(claimed.ok,true);
  assert.equal((await call('save',{...saveArgs,p_operation_id:randomUUID(),p_expected_revision:8,p_lease_id:claimed.leaseId,p_fencing_token:claimed.fencingToken})).ok,true);
 }));
 for(const state of ['inactive','missing','invalid-role'])await check('SQL',`${state} record actor rejected by all five wrappers despite live legacy identity`,()=>rollback(async()=>{
  if(state==='missing')await db.query("delete from ship_dynamics_records where collection='users' and entity_id=$1",[user]);
  else await db.query(`update ship_dynamics_records set value=jsonb_set(value,'{${state==='inactive'?'isActive':'role'}}',$1::jsonb) where collection='users' and entity_id=$2`,[state==='inactive'?'false':'"unknown"',user]);
  assert.equal((await scalar('select sd_itinerary_main_actor($1,$2)',[key,user])).role,'owner');
  const before=await snapshot();for(const action of ['claim_lease','renew_lease','save','operation_status','release_lease'])await rejects(()=>call(action,saveArgs),/not-authorized/);
  assert.deepEqual(await snapshot(),before);
 }));
 await check('SQL','status binds actual actor and workspace; unknown operation stays missing',async()=>{
  assert.deepEqual(await call('operation_status',{...saveArgs,p_actor_user_id:'other'}),{status:'missing'});
  assert.deepEqual(await call('operation_status',{p_operation_id:randomUUID()}),{status:'missing'});
  await assert.rejects(()=>call('operation_status',{...saveArgs,p_workspace_key:'another-workspace'}),/not-authorized/);
 });
 for(const [name,change,expected] of [
  ['stale CAS',{p_expected_revision:7},/revision-conflict/],['wrong fence',{p_fencing_token:999},/lease-expired/],
  ['wrong holder',{p_holder_session:'other-tab'},/lease-expired/],['valid wrong ship lease',{p_vessel_id:'v2'},/lease-expired/],
  ['wrong actor',{p_actor_user_id:'other'},/lease-expired/],['expired lease',{},/lease-expired/],
  ['invalid alternatives',{p_alternative_plans:[{bad:true}]},/invalid-itinerary-payload/],
 ])await check('SQL',`${name} rejects with no partial writes`,()=>rollback(async()=>{
  const claimed=await call('claim_lease');assert.equal(claimed.ok,true);
  const args={...saveArgs,p_operation_id:randomUUID(),p_expected_revision:8,p_lease_id:claimed.leaseId,p_fencing_token:claimed.fencingToken,...change};
  if(name==='expired lease')await db.exec("update sd_itinerary_leases set expires_at=now()-interval '1 second' where vessel_id='v1'");
  const before=await snapshot();await rejects(()=>call('save',args),expected);assert.deepEqual(await snapshot(),before);
  if(['wrong fence','wrong holder','valid wrong ship lease','wrong actor','expired lease'].includes(name)){
   assert.equal((await call('renew_lease',args)).ok,false);assert.deepEqual(await snapshot(),before);
   if(name!=='expired lease'){assert.equal(await call('release_lease',args),false);assert.deepEqual(await snapshot(),before);}
  }
 }));
 await check('SQL','different payload or vessel with same operation is mismatch, never replay',async()=>{
  const before=await snapshot();for(const delta of [{p_vessel_id:'v2'},{p_expected_revision:8},{p_rows:formal.rows.map(r=>({...r,portDockName:'DIFFERENT'}))}])await assert.rejects(()=>call('save',{...saveArgs,...delta}),/operation-mismatch/);assert.deepEqual(await snapshot(),before);
 });
 await check('SQL','late ledger failure rolls back document, history and lease together',()=>rollback(async()=>{
  const claimed=await call('claim_lease');
  await db.exec(`create function qa_fail_receipt() returns trigger language plpgsql as $$begin
   if not exists(select 1 from sd_itinerary_history where operation_id=new.operation_id) then raise exception 'fixture history not reached';end if;
   raise exception 'qa-late-ledger-failure';end;$$;
   create trigger qa_fail_receipt before insert on sd_itinerary_operations for each row execute function qa_fail_receipt();`);
  const before=await snapshot();await db.exec('savepoint failure');
  await assert.rejects(()=>call('save',{...saveArgs,p_operation_id:randomUUID(),p_expected_revision:8,p_lease_id:claimed.leaseId,p_fencing_token:claimed.fencingToken}),/qa-late-ledger-failure/);
  await db.exec('rollback to savepoint failure');assert.deepEqual(await snapshot(),before);
 }));
 await check('SQL','public no-login active ship competes with Office on same single-vessel core',()=>rollback(async()=>{
  await db.query('insert into sd_itinerary_rollout(workspace_id,ship_portal_enabled) values($1,true) on conflict(workspace_id) do update set ship_portal_enabled=true',[itineraryWorkspaceId]);
  const publicClaim=()=>scalar('select sd_itinerary_claim_public_lease($1,$2,$3,$4,$5)',[key,'v1','public-browser','ship-tab',75]);
  const claimed=await call('claim_lease');assert.equal((await publicClaim()).ok,false);
  await call('release_lease',{p_lease_id:claimed.leaseId,p_fencing_token:claimed.fencingToken});
  const ship=await publicClaim();assert.equal(ship.ok,true);assert.equal((await call('claim_lease')).ok,false);
  const before=await snapshot();await rejects(()=>call('save',{...saveArgs,p_operation_id:randomUUID(),p_expected_revision:8,p_lease_id:claimed.leaseId,p_fencing_token:claimed.fencingToken}),/lease-expired/);assert.deepEqual(await snapshot(),before);
  const saved=await scalar('select sd_itinerary_save_public($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb)',[key,'v1',8,randomUUID(),JSON.stringify(formal.rows),ship.leaseId,'public-browser','ship-tab',ship.fencingToken,JSON.stringify(formal.alternativePlans)]);assert.equal(saved.ok,true);assert.equal(saved.document.updatedActorKind,'public');
  await rejects(()=>scalar('select sd_itinerary_claim_public_lease($1,$2,$3,$4,$5)',[key,'missing','public-browser','ship-tab',75]),/not-authorized/);
 }));
 await check('SQL','five wrappers private invoker with fixed path; rerun leaves all data and old functions unchanged',async()=>{
  const before=await snapshot();const old=()=>db.query("select oid,prosrc,proacl,proconfig,prosecdef from pg_proc where proname like 'sd_itinerary_%' and proname not like 'sd_itinerary_record_%' order by oid");const oldBefore=await old();
  await db.exec(fs.readFileSync(writeSql,'utf8'));assert.deepEqual(await snapshot(),before);assert.deepEqual(await old(),oldBefore);
  const procs=(await db.query("select proname,provolatile,prosecdef,proconfig,exists(select 1 from aclexplode(proacl) where grantee=0 and privilege_type='EXECUTE') as public_execute from pg_proc where proname=any($1::text[]) order by proname",[Object.keys(recordWriteArgs)])).rows;
  assert.equal(procs.length,5);for(const p of procs){assert.equal(p.prosecdef,false);assert.deepEqual(p.proconfig,['search_path=pg_catalog, public']);assert.equal(p.public_execute,false);assert.equal(p.provolatile,p.proname.includes('status')?'s':'v');}
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);try{for(const action of ['claim_lease','renew_lease','save','operation_status','release_lease'])await assert.rejects(()=>call(action,saveArgs),/permission denied/);}finally{await db.exec('reset role');}}
 });
 if(!process.argv.includes('--sql-only')){
  const cloud=await vite.ssrLoadModule('/src/itinerary/itineraryCloud.ts');
  const calls=[];let lostAck=false,missing=false;
  const client=createClient('http://127.0.0.1:49994','synthetic-not-a-key',{auth:{persistSession:false},global:{fetch:async(url,options)=>{
   const name=new URL(url).pathname.split('/').pop(),args=JSON.parse(options.body);calls.push({name,args});
   if(missing)return new Response(JSON.stringify({code:'PGRST202',message:'capability missing'}),{status:404});
   try {const value=await sqlCall(name,args);if(lostAck&&name.includes('_save')){lostAck=false;throw new Error('ACK lost after commit');}return new Response(JSON.stringify(value),{status:200});}
   catch(error){return new Response(JSON.stringify({code:error.code||'NETWORK',message:error.message}),{status:400});}
  }}});
  const config={supabaseUrl:'http://127.0.0.1:49994',supabaseAnonKey:'synthetic-not-a-key',workspaceKey:key,tableName:'ship_dynamics_app_state',storageMode:'records-v1'};
  const office=new cloud.OfficeItineraryCloudRepository({userId:user},config,client);
  let input;
  await check('Supabase JS → SQL','all five explicit record routes; lost ACK status returns original result once',async()=>{
   const claim=await office.claimLease('v1',{holderId:'adapter-tab',holderLabel:'Spoofed'});assert.equal(claim.ok,true);
   const renewed=await office.renewLease(claim.lease);assert.equal(renewed.ok,true);
   const doc=structuredClone(result.document);doc.rows[0].portDockName='ADAPTER SAVED';doc.rows[0].calculationStartUtc='2026-09-06T00:00:00Z';doc.rows[0].calculationStartTimeZone='UTC+8';
   input={document:doc,expectedRevision:8,operationId:randomUUID(),lease:renewed.lease,actorLabel:'Spoofed'};
   lostAck=true;const saved=await office.save(input);assert.equal(saved.ok,true);assert.equal(saved.replayed,true);assert.equal(saved.document.rows[0].portDockName,'ADAPTER SAVED');assert.equal(saved.document.alternativePlans[0].rows[0].calculationStartUtc,doc.rows[0].calculationStartUtc);
   assert.equal(await office.releaseLease(renewed.lease),true);
   assert.deepEqual(calls.map(c=>c.name),['claim_lease','renew_lease','save','operation_status','release_lease'].map(a=>`sd_itinerary_record_${a}_v1`));
   assert.equal(await scalar('select count(*)::int from sd_itinerary_operations where operation_id=$1',[input.operationId]),1);
  });
  await check('Supabase JS → SQL','different payload with same operation must not recover an unrelated successful receipt',async()=>{
   const before=await snapshot(),count=calls.length;
   const changed=structuredClone(input);changed.document.rows[0].portDockName='DIFFERENT INTENT';
   const failed=await office.save(changed);assert.equal(failed.ok,false);assert.equal(failed.code,'operation-mismatch');
   assert.deepEqual(calls.slice(count).map(c=>c.name),['sd_itinerary_record_save_v1']);
   assert.deepEqual(await snapshot(),before);assert.equal(changed.document.rows[0].portDockName,'DIFFERENT INTENT');
  });
  await check('Supabase JS → SQL','same actor/workspace cross-mode exact replay keeps one shared sd receipt; legacy mismatch fails',async()=>{
   const legacy=new cloud.OfficeItineraryCloudRepository({userId:user},{...config,storageMode:'legacy'},client),before=await snapshot();
   const replay=await legacy.save(input);assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(await snapshot(),before);
   const changed=structuredClone(input);changed.document.rows[0].portDockName='LEGACY DIFFERENT';
   const count=calls.length,failed=await legacy.save(changed);assert.equal(failed.ok,false);assert.equal(failed.code,'operation-mismatch');
   assert.deepEqual(calls.slice(count).map(c=>c.name),['sd_itinerary_main_save']);assert.deepEqual(await snapshot(),before);
  });
  await check('Supabase JS → SQL','exact record replay after lost ACK does not increment document or history',async()=>{
   const before=await snapshot(),count=calls.length,replay=await office.save(input);assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.deepEqual(await snapshot(),before);assert.deepEqual(calls.slice(count).map(c=>c.name),['sd_itinerary_record_save_v1']);
  });
  await check('Supabase JS → SQL','inactive record actor cannot recover even its formerly valid receipt',async()=>{
   await db.query("update ship_dynamics_records set value=jsonb_set(value,'{isActive}','false') where collection='users' and entity_id=$1",[user]);
   const before=await snapshot(),count=calls.length,failed=await office.save(input);assert.equal(failed.ok,false);assert.match(failed.message,/not-authorized/);assert.deepEqual(await snapshot(),before);
   assert.deepEqual(calls.slice(count).map(c=>c.name),['sd_itinerary_record_save_v1','sd_itinerary_record_operation_status_v1']);
   await db.query("update ship_dynamics_records set value=jsonb_set(value,'{isActive}','true') where collection='users' and entity_id=$1",[user]);
  });
  await check('Supabase JS → SQL','missing capability never falls back in any of five routes',async()=>{
   missing=true;const count=calls.length;
   for(const invoke of [()=>office.claimLease('v1',{holderId:'tab',holderLabel:'QA'}),()=>office.renewLease(input.lease),()=>office.releaseLease(input.lease)])await assert.rejects(invoke,/PGRST202/);
   const failed=await office.save(input);assert.equal(failed.ok,false);assert.equal(failed.code,'unknown-outcome');
   assert.deepEqual(calls.slice(count).map(c=>c.name),['claim_lease','renew_lease','release_lease','save','operation_status'].map(a=>`sd_itinerary_record_${a}_v1`));missing=false;
  });
  await check('Supabase JS → SQL','legacy lease lifecycle stays on main routes with records tables present',async()=>{
   const legacy=new cloud.OfficeItineraryCloudRepository({userId:user},{...config,storageMode:'legacy'},client),count=calls.length;
   const claim=await legacy.claimLease('v1',{holderId:'legacy-tab',holderLabel:'QA'});assert.equal(claim.ok,true);assert.equal((await legacy.renewLease(claim.lease)).ok,true);assert.equal(await legacy.releaseLease(claim.lease),true);
   assert.deepEqual(calls.slice(count).map(c=>c.name),['claim_lease','renew_lease','release_lease'].map(a=>`sd_itinerary_main_${a}`));
  });
 }
 console.log(JSON.stringify({itineraryRecordWrite:'PASS',cases:tests.length,tests}));
}catch(error){failure=error;console.error({message:error.message,code:error.code,stack:error.stack});}finally{if(vite)await vite.close();await db.close();if(failure)process.exitCode=1;}

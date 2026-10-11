import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'vite';
import {PGlite} from '@electric-sql/pglite';
import {installItineraryFixture,seedItineraryFixture,itineraryWorkspaceId as workspace,recordItinerarySql,recordItineraryWriteSql} from './record-itinerary-local-fixture.mjs';

export const purposeShoreMigration='supabase/migrations/20261011090000_itinerary_purpose_bunker_shore_state.sql';
const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'itinerary-purpose-shore-db-'));
const receipt={layer:'private PGlite SQL; synthetic fixtures, not hosted Supabase',cases:[]};
const db=new PGlite();let vite;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const check=async(name,run)=>{try{await run();receipt.cases.push({name,ok:true});}catch(error){receipt.cases.push({name,ok:false,error:error.message.slice(0,400)});}};
const signature='(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)';
const routes=['public.sd_itinerary_save_internal',...['record','legacy','public'].map(n=>'ship_dynamics_authority_private.itinerary_'+n+'_v1')];
const definitions=async()=> (await db.query('select oid,proacl::text,proconfig,prosecdef,provolatile,prosrc from pg_proc where oid=any($1::oid[]) order by oid',[await Promise.all(routes.concat(['public.sd_itinerary_purpose_valid']).map(n=>scalar('select to_regprocedure($1)::oid',[n+(n.includes('purpose')?'(text)':signature)])))])).rows;
try{
 await db.exec('create role anon; create role authenticated;');
 for(const file of ['supabase/schema.sql','supabase/development/20260906_appdata_record_store.sql'])await db.exec(fs.readFileSync(file,'utf8'));
 await installItineraryFixture(db);
 vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const key='purpose-shore-qa';const doc=await seedItineraryFixture(db,vite,key,[{id:'v1'}]);
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');const data=createInitialData();
 data.vessels=[{...data.vessels[0],id:'v1',isActive:true}];data.users=[{id:'qa-owner',name:'QA',username:'qa',role:'owner',department:'QA',isActive:true}];data.tasks=[];data.meetings=[];
 await scalar('select import_ship_dynamics_records_v1($1,$2::jsonb)',[key,JSON.stringify(data)]);
 await db.query('insert into ship_dynamics_app_state(workspace_key,revision,payload) values($1,1,$2::jsonb)',[key,JSON.stringify(data)]);
 for(const file of [recordItinerarySql,recordItineraryWriteSql,'supabase/migrations/20260916090000_itinerary_current_vessel_state.sql','supabase/migrations/20260917090000_itinerary_bunker_status.sql'])await db.exec(fs.readFileSync(file,'utf8'));
 // Fixture copies exercise the exact narrow splice on every installed route.
 // They do not claim to install or verify the production source-authority gate.
 await db.exec('create schema ship_dynamics_authority_private;');
 const predecessor=await scalar('select pg_get_functiondef($1::regprocedure)',[routes[0]+signature]);
 for(const route of routes.slice(1))await db.exec(predecessor.replace(routes[0]+'(',route+'('));
 const beforeDefinitions=await definitions();
 const ledger=async()=>scalar("select jsonb_build_object('documents',(select jsonb_agg(to_jsonb(t)) from sd_itinerary_documents t),'history',(select jsonb_agg(to_jsonb(t)) from sd_itinerary_history t),'operations',(select jsonb_agg(to_jsonb(t)) from sd_itinerary_operations t),'leases',(select jsonb_agg(to_jsonb(t)) from sd_itinerary_leases t))");
 const beforeLedger=await ledger();
 if(fs.existsSync(purposeShoreMigration))await db.exec(fs.readFileSync(purposeShoreMigration,'utf8'));
 const readback='supabase/verification/itinerary_purpose_bunker_shore_state_readback.sql';
 if(fs.existsSync(readback))await check('read-only installed-state checks pass with LF and CRLF copies',async()=>{
   for(const sql of [fs.readFileSync(readback,'utf8'),fs.readFileSync(readback,'utf8').replace(/\r?\n/g,'\r\n')]){
     const results=await db.exec(sql);const result=results.flatMap(r=>r.rows||[]).find(r=>r.overall);
     assert.ok(result);assert.equal(result.overall,'PASS',JSON.stringify(result));
   }
 });
 await check('migration leaves business data, OIDs, ACLs and function settings unchanged',async()=>{
  assert.deepEqual(await ledger(),beforeLedger);
  const current=await definitions();
  assert.deepEqual(current.map(({prosrc,...metadata})=>metadata),beforeDefinitions.map(({prosrc,...metadata})=>metadata));
  for(const definition of current.filter(r=>r.prosrc.includes('v_saved_alternatives'))) {
    assert.ok(definition.prosrc.includes('current_vessel_state_shared_edit_v1'));
    assert.ok(!definition.prosrc.includes('current-vessel-state-ship-only'));
  }
 });
 for(const [value,expected] of [['bunker',true],['To Load / bunker',true],['inspection / bunker',true],['To Load / To Unload / docking / waiting order / repair / inspection / bunker',true],['bunker / To Load',false],['bunker / bunker',false],['Bunker',false],['Loading',true],['Unloading',true],['unknown',false]])await check('SQL canonical Purpose '+value,async()=>assert.equal(await scalar('select sd_itinerary_purpose_valid($1)',[value]),expected));
 const state={location:'SHORE SAVED Taiwan Strait',navigationStatus:'停泊',loadStatus:'滿載',statusList:['drydock/repiar','bunker']};
 const rows=structuredClone(doc.rows);rows[0].operation='To Load';rows[0].currentVesselState=state;
 const alternatives=structuredClone(doc.alternativePlans);alternatives[0].rows[0].operation='To Unload';
 await check('formal and alternative Purpose bunker valid; metadata still formal-first-only',async()=>{
  const purposeRows=structuredClone(rows);purposeRows[0].operation='To Load / bunker';
  const purposeAlternatives=structuredClone(alternatives);purposeAlternatives[0].rows[0].operation='bunker';
  assert.equal(await scalar('select sd_itinerary_rows_valid($1::jsonb)',[JSON.stringify(purposeRows)]),true);
  assert.equal(await scalar('select sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)',[JSON.stringify(purposeAlternatives),JSON.stringify(purposeRows)]),true);
  const bad=structuredClone(alternatives);bad[0].rows[0].currentVesselState={};assert.equal(await scalar('select sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)',[JSON.stringify(bad),JSON.stringify(rows)]),false);
 });
 await db.query('delete from sd_itinerary_leases where workspace_id=$1',[workspace]);
 await db.query('insert into sd_itinerary_rollout(workspace_id,main_enabled,ship_portal_enabled) values($1,true,true) on conflict(workspace_id) do update set main_enabled=true,ship_portal_enabled=true',[workspace]);
 const recordSql='select sd_itinerary_record_save_v1($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10,$11::jsonb)';
 const lease=await scalar('select sd_itinerary_record_claim_lease_v1($1,$2,$3,$4,$5,$6)',[key,'v1','shore-tab','QA',75,'qa-owner']);assert.equal(lease.ok,true);
 const args=[key,'v1',7,'91000000-0000-4000-8000-000000000001',JSON.stringify(rows),lease.leaseId,'shore-tab',lease.fencingToken,'QA','qa-owner',JSON.stringify(alternatives)];
 await check('records company save commits four fields; public ship load reads same revision and history',async()=>{
  const result=await scalar(recordSql,args);assert.deepEqual(result.document.rows[0].currentVesselState,state);assert.equal(result.document.revision,8);
  const loaded=await scalar('select sd_itinerary_public_load($1,$2)',[key,'v1']);assert.deepEqual(loaded.rows[0].currentVesselState,state);assert.equal(loaded.revision,8);assert.equal(loaded.rows[0].operation,'To Load');
  assert.deepEqual(await scalar("select rows_payload->0->'currentVesselState' from sd_itinerary_history where workspace_id=$1 and revision=8",[workspace]),state);
 });
 await check('same-operation lost-ACK replay creates no second document/history write',async()=>{
  const before=await ledger();const replay=await scalar(recordSql,args);assert.equal(replay.replayed,true);assert.deepEqual(replay.document.rows[0].currentVesselState,state);assert.deepEqual(await ledger(),before);
 });
 await check('missing actor, stale CAS and wrong lease remain rejected with unchanged data',async()=>{
  for(const change of [a=>{a[9]='unknown-actor';},a=>{a[2]=6;},a=>{a[5]='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';}]){
   const bad=[...args];bad[3]=crypto.randomUUID();bad[2]=8;change(bad);const before=await ledger();await assert.rejects(()=>scalar(recordSql,bad));assert.deepEqual(await ledger(),before);
  }
 });
 await check('old company client omitting current state preserves it; new explicit clears work',async()=>{

  const office=await scalar('select sd_itinerary_main_claim_lease($1,$2,$3,$4,$5,$6)',[key,'v1','shore-main','QA',75,'qa-owner']);assert.equal(office.ok,true);
  const officeSql='select sd_itinerary_main_save($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10,$11::jsonb)';
  const old=structuredClone(rows);delete old[0].currentVesselState;old[0].voyageNumber='OLD CLIENT';
  const a=[key,'v1',8,crypto.randomUUID(),JSON.stringify(old),office.leaseId,'shore-main',office.fencingToken,'QA','qa-owner',JSON.stringify(alternatives)];
  const saved=await scalar(officeSql,a);assert.deepEqual(saved.document.rows[0].currentVesselState,state);
  const cleared=structuredClone(saved.document.rows);cleared[0].currentVesselState={...state,location:'',statusList:[]};
  const nextLease=await scalar('select sd_itinerary_main_claim_lease($1,$2,$3,$4,$5,$6)',[key,'v1','shore-main','QA',75,'qa-owner']);assert.equal(nextLease.ok,true);
  a[2]=9;a[3]=crypto.randomUUID();a[4]=JSON.stringify(cleared);a[5]=nextLease.leaseId;a[7]=nextLease.fencingToken;
  const clearResult=await scalar(officeSql,a);assert.equal(clearResult.document.rows[0].currentVesselState.location,'');assert.deepEqual(clearResult.document.rows[0].currentVesselState.statusList,[]);assert.equal(clearResult.document.rows[0].currentVesselState.navigationStatus,'停泊');
 });
 await check('migration reruns are idempotent for LF and CRLF',async()=>{
  assert.ok(fs.existsSync(purposeShoreMigration));const before=await definitions(),beforeData=await ledger();
  await db.exec(fs.readFileSync(purposeShoreMigration,'utf8').replace(/\r?\n/g,'\r\n'));await db.exec(fs.readFileSync(purposeShoreMigration,'utf8'));
  assert.deepEqual(await definitions(),before);assert.deepEqual(await ledger(),beforeData);
 });
 await check('unknown route predecessor fails atomically without partial replacement',async()=>{
  assert.ok(fs.existsSync(purposeShoreMigration));
  const route=routes[3]+signature;const definition=await scalar('select pg_get_functiondef($1::regprocedure)',[route]);
  const changed=definition.replace('-- current_vessel_state_shared_edit_v1','-- UNKNOWN_PREDECESSOR');assert.notEqual(changed,definition);
  await db.exec(changed);const before=await definitions();
  try{await assert.rejects(()=>db.exec(fs.readFileSync(purposeShoreMigration,'utf8')),/predecessor-mismatch/);await db.exec('rollback;');assert.deepEqual(await definitions(),before);}
  finally{await db.exec(definition);}
 });
} catch(error){receipt.setupError=error.message;process.exitCode=1;}
finally{
 await vite?.close();await db.close();receipt.ok=!receipt.setupError&&receipt.cases.every(x=>x.ok);
 fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({output,...receipt},null,2));if(!receipt.ok)process.exitCode=1;
}

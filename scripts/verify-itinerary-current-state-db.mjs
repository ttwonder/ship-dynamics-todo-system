import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'vite';
import { PGlite } from '@electric-sql/pglite';
import { createNativeRecordQa } from './record-storage-native-qa.mjs';
import { installItineraryFixture, seedItineraryFixture, itineraryWorkspaceId as workspace } from './record-itinerary-local-fixture.mjs';
import { installMorningOracle, schedulerSql } from './record-daily-morning-local-fixture.mjs';

const migration='supabase/migrations/20260916090000_itinerary_current_vessel_state.sql';
const bunkerMigration='supabase/migrations/20260917090000_itinerary_bunker_status.sql';
const nativeMode=process.argv.includes('--native');
const receipt={layer:nativeMode?'native PostgreSQL':'PGlite',cases:[]};
const run=fs.mkdtempSync(path.join(process.env.QA_OUTPUT||os.tmpdir(),'itinerary-current-state-'));
let native,db,vite;
const test=async(name,fn)=>{try{await fn();receipt.cases.push({name,ok:true});}catch(error){receipt.cases.push({name,ok:false,error:error.message.slice(0,500)});}};
try {
  native=nativeMode?await createNativeRecordQa(run,receipt):null;
  db=native?.adapter||new PGlite();
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  await db.exec('create role anon; create role authenticated;');
  await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/development/20260906_appdata_record_store.sql','utf8'));
  await installItineraryFixture(db); await installMorningOracle(db);
  await db.exec(fs.readFileSync(schedulerSql,'utf8'));
  vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
  const key='current-state-qa';
  const document=await seedItineraryFixture(db,vite,key,[{id:'v1'}]);
  const seed=await vite.ssrLoadModule('/src/data/seed.ts');const data=seed.createInitialData();
  data.vessels=[{...data.vessels[0],id:'v1',isActive:true}];data.tasks=[];data.meetings=[];data.users=[{id:'qa-owner',name:'QA',username:'qa',role:'owner',department:'QA',isActive:true}];
  await scalar('select import_ship_dynamics_records_v1($1,$2::jsonb)',[key,JSON.stringify(data)]);
  await db.query('insert into ship_dynamics_app_state(workspace_key,revision,payload) values($1,1,$2::jsonb)',[key,JSON.stringify(data)]);
  const before=await scalar("select jsonb_agg(to_jsonb(d)) from sd_itinerary_documents d");
  const aclBefore=(await db.query("select oid,proacl::text from pg_proc where proname in ('sd_itinerary_rows_valid','sd_itinerary_alternative_plans_valid','sd_build_daily_morning_snapshot','build_ship_dynamics_record_daily_morning_v1') order by oid")).rows;
  if(fs.existsSync(migration))await db.exec(fs.readFileSync(migration,'utf8'));
    if(fs.existsSync(bunkerMigration)){await db.exec(fs.readFileSync(bunkerMigration,'utf8').replace(/\r?\n/g,'\r\n'));await db.exec(fs.readFileSync(bunkerMigration,'utf8'));}
  const state={location:'Taiwan Strait',navigationStatus:'停泊',loadStatus:'滿載',statusList:['loading','drydock/repiar','bunker']};
  const rows=structuredClone(document.rows); rows[0].currentVesselState=state;
  rows[0].etdUtc='2026-09-07T01:00:00Z';
  const valid=rows=>scalar('select sd_itinerary_rows_valid($1::jsonb)',[JSON.stringify(rows)]);
  await test('valid first-formal-row metadata accepted',async()=>assert.equal(await valid(rows),true));
  await test('legacy shapes unchanged and new keys optional',async()=>{
    assert.equal(await valid(document.rows),true);
    const partial=structuredClone(rows);partial[0].currentVesselState={location:'',statusList:[]};assert.equal(await valid(partial),true);
  });
  for(const invalid of [null,[],{navigationStatus:'bad'},{loadStatus:'bad'},{location:7},{statusList:['drydock/repair']},{statusList:['loading','loading']},{statusList:['bunker','bunker']},{statusList:['unknown']},{unknown:1}])await test('invalid metadata '+JSON.stringify(invalid),async()=>{
    const d=structuredClone(rows);d[0].currentVesselState=invalid;assert.equal(await valid(d),false);
  });
  await test('nonfirst metadata and alternatives rejected',async()=>{
    const next={...rows[0],rowId:'r2',sortOrder:1,previousPortName:''};assert.equal(await valid([...document.rows,next]),false);
    const plans=structuredClone(document.alternativePlans);plans[0].rows[0].currentVesselState={};
    assert.equal(await scalar('select sd_itinerary_alternative_plans_valid($1::jsonb,$2::jsonb)',[JSON.stringify(plans),JSON.stringify(rows)]),false);
  });
  const next={...document.rows[0],rowId:'r2',sortOrder:1,previousPortName:'',portDockName:'SECOND',cargoQuantityText:'NEVER SECOND CARGO'};
  const third={...next,rowId:'r3',sortOrder:2,portDockName:'NEVER THIRD'};
  const builders=[['legacy','select sd_build_daily_morning_snapshot($1::uuid,$2::timestamptz)',workspace],['records','select build_ship_dynamics_record_daily_morning_v1($1,$2::timestamptz)',key]];
  for(const [name,sql,w] of builders)for(const [boundary,etd,now,second,expected] of [
    ['strict past','2026-09-07T01:00:00Z','2026-09-07T09:00:00.001+08:00','SECOND','SECOND'],
    ['equality','2026-09-07T01:00:00Z','2026-09-07T01:00:00Z','SECOND',rows[0].portDockName],
    ['future','2026-09-08T01:00:00Z','2026-09-07T01:00:00Z','SECOND',rows[0].portDockName],
    ['missing',null,'2026-09-07T01:00:00Z','SECOND',rows[0].portDockName],
    ['invalid','bad','2026-09-07T01:00:00Z','SECOND',rows[0].portDockName],
    ['blank second','2026-09-06T01:00:00Z','2026-09-07T01:00:00Z','  ','TBA'],
    ['absent second','2026-09-06T01:00:00Z','2026-09-07T01:00:00Z',null,'TBA'],
  ])await test(name+' snapshot '+boundary,async()=>{
    const first={...rows[0],etdUtc:etd};const payload=second===null?[first]:[third,{...next,portDockName:second},first];
    await db.query('update sd_itinerary_documents set rows_payload=$1::jsonb where workspace_id=$2',[JSON.stringify(payload),workspace]);
    const snapshot=await scalar(sql,[w,now]);const actual=snapshot.itineraryProjections.v1;
    assert.equal(actual.values.portDockName,expected);assert.equal(actual.rowId,first.rowId);
    assert.equal(actual.values.previousPortName,first.previousPortName);assert.equal(actual.values.cargoQuantityText,first.cargoQuantityText);
    assert.equal(actual.values.etdUtc,etd);assert.deepEqual(actual.values.currentVesselState,state);
  });
  await test('rerun is idempotent; no data or existing ACL/OID changes',async()=>{
    await db.query('update sd_itinerary_documents set rows_payload=$1::jsonb where workspace_id=$2',[JSON.stringify(document.rows),workspace]);
    if(fs.existsSync(migration))await db.exec(fs.readFileSync(migration,'utf8'));
    if(fs.existsSync(bunkerMigration)){await db.exec(fs.readFileSync(bunkerMigration,'utf8').replace(/\r?\n/g,'\r\n'));await db.exec(fs.readFileSync(bunkerMigration,'utf8'));}
    assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(d)) from sd_itinerary_documents d'),before);
    assert.deepEqual((await db.query("select oid,proacl::text from pg_proc where proname in ('sd_itinerary_rows_valid','sd_itinerary_alternative_plans_valid','sd_build_daily_morning_snapshot','build_ship_dynamics_record_daily_morning_v1') order by oid")).rows,aclBefore);
  });
  await test('bunker delta rejects an unknown predecessor without overwriting it',async()=>{
    const definition=await scalar("select pg_get_functiondef('public.sd_itinerary_rows_valid(jsonb)'::regprocedure)");
    const changed=definition.replace('legacy_rows jsonb', '/* owned mismatch probe */ legacy_rows jsonb');assert.notEqual(changed,definition);
    const body=fs.readFileSync(bunkerMigration,'utf8').replace('\nbegin;\n','\n').replace(/\ncommit;\s*$/,'\n');
    await db.exec('begin;');
    try{await db.exec(changed);await assert.rejects(()=>db.exec(body),/bunker-current-state-predecessor-mismatch/);}
    finally{await db.exec('rollback;');}
    assert.equal(await scalar("select pg_get_functiondef('public.sd_itinerary_rows_valid(jsonb)'::regprocedure)"),definition);
  });
  await test('ship save, lost-ACK replay, shore preservation and forbidden shore metadata update',async()=>{
    await db.query('delete from sd_itinerary_leases where workspace_id=$1',[workspace]);
    await db.query('insert into sd_itinerary_rollout(workspace_id,main_enabled,ship_portal_enabled) values($1,true,true) on conflict(workspace_id) do update set main_enabled=true,ship_portal_enabled=true',[workspace]);
    const lease=await scalar('select sd_itinerary_claim_public_lease($1,$2,$3,$4,$5)',[key,'v1','qa-ship','qa-tab',75]);assert.equal(lease.ok,true);
    const args=[key,'v1',7,'90000000-0000-4000-8000-000000000001',JSON.stringify(rows),lease.leaseId,'qa-ship','qa-tab',lease.fencingToken,JSON.stringify(document.alternativePlans)];
    const sql='select sd_itinerary_save_public($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8,$9::bigint,$10::jsonb)';
    const saved=await scalar(sql,args);assert.deepEqual(saved.document.rows[0].currentVesselState,state);
    assert.equal((await scalar(sql,args)).replayed,true);
    assert.deepEqual(await scalar("select rows_payload->0->'currentVesselState' from sd_itinerary_history where workspace_id=$1 and revision=8",[workspace]),state);
    const shore=await scalar('select sd_itinerary_main_claim_lease($1,$2,$3,$4,$5,$6)',[key,'v1','shore-tab','QA',75,'qa-owner']);assert.equal(shore.ok,true);
    const officeSql='select sd_itinerary_main_save($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10,$11::jsonb)';
    const tampered=structuredClone(rows);tampered[0].currentVesselState.location='FORBIDDEN';
    const officeArgs=[key,'v1',8,'90000000-0000-4000-8000-000000000002',JSON.stringify(tampered),shore.leaseId,'shore-tab',shore.fencingToken,'QA','qa-owner',JSON.stringify(document.alternativePlans)];
    await assert.rejects(()=>scalar(officeSql,officeArgs),/current-vessel-state-ship-only/);
    const oldClientRows=structuredClone(rows);delete oldClientRows[0].currentVesselState;oldClientRows[0].voyageNumber='SHORE EDIT';officeArgs[4]=JSON.stringify(oldClientRows);
    const preserved=await scalar(officeSql,officeArgs);assert.deepEqual(preserved.document.rows[0].currentVesselState,state);
    assert.equal(preserved.document.rows[0].voyageNumber,'SHORE EDIT');
    assert.equal((await scalar(officeSql,officeArgs)).replayed,true);
  });
} catch(error) { receipt.setupError=error.message; process.exitCode=1; }
finally {
  await vite?.close();await db?.close();await native?.close();
  receipt.ok=!receipt.setupError&&receipt.cases.every(item=>item.ok);
  fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({receipt:path.join(run,'receipt.json'),layer:receipt.layer,ok:receipt.ok,cases:receipt.cases,setupError:receipt.setupError},null,2));
  if(!receipt.ok)process.exitCode=1;
}

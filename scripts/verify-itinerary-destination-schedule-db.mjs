import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { PGlite } from '@electric-sql/pglite';
import { createNativeRecordQa } from './record-storage-native-qa.mjs';
import { installItineraryFixture, seedItineraryFixture, itineraryWorkspaceId as workspace } from './record-itinerary-local-fixture.mjs';
import { installMorningOracle, schedulerSql } from './record-daily-morning-local-fixture.mjs';

const migration='supabase/migrations/20260924093000_itinerary_destination_schedule.sql';
const readback='supabase/verification/itinerary_destination_schedule_readback.sql';
const nativeMode=process.argv.includes('--native');
const receipt={layer:nativeMode?'isolated native PostgreSQL':'PGlite',cases:[]};
const root=process.env.QA_OUTPUT||path.join(process.env.LOCALAPPDATA||os.homedir(),'hermes/cache/scratch');
fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'destination-schedule-db-'));
const test=async(name,fn)=>{await fn();receipt.cases.push(name);};
let db,native,vite;
try {
  native=nativeMode?await createNativeRecordQa(output,receipt):null;
  db=native?.adapter||new PGlite();
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  await db.exec('create role anon; create role authenticated;');
  for(const file of ['supabase/schema.sql','supabase/development/20260906_appdata_record_store.sql'])await db.exec(fs.readFileSync(file,'utf8'));
  await installItineraryFixture(db);await installMorningOracle(db);await db.exec(fs.readFileSync(schedulerSql,'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20260916090000_itinerary_current_vessel_state.sql','utf8'));
  vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
  const key='destination-schedule-qa';
  const document=await seedItineraryFixture(db,vite,key,[{id:'v1'}]);
  const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
  const data=createInitialData();
  data.vessels=[{...data.vessels[0],id:'v1',isActive:true}];data.tasks=[];data.meetings=[];
  data.users=[{id:'qa-owner',name:'QA',username:'qa',role:'owner',department:'QA',isActive:true}];
  await scalar('select import_ship_dynamics_records_v1($1,$2::jsonb)',[key,JSON.stringify(data)]);
  await db.query('insert into ship_dynamics_app_state(workspace_key,revision,payload) values($1,1,$2::jsonb)',[key,JSON.stringify(data)]);
  const originalDocument=await scalar('select jsonb_agg(to_jsonb(d)) from sd_itinerary_documents d');
  const catalogSql="select oid,proname,proacl::text,prosecdef,provolatile,proconfig,case when proname='sd_itinerary_operational_values_v1' then '' else prosrc end as body from pg_proc where pronamespace='public'::regnamespace order by oid";
  const catalogBefore=(await db.query(catalogSql)).rows;
  if(fs.existsSync(migration)) {
    const sql=fs.readFileSync(migration,'utf8');
    await db.exec(sql.replace(/\r?\n/g,'\r\n'));await db.exec(sql);
    receipt.migrationSha256=createHash('sha256').update(sql).digest('hex');
  }
  await test('migration leaves stored documents and all other functions/ACLs unchanged',async()=>{
    assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(d)) from sd_itinerary_documents d'),originalDocument);
    assert.deepEqual((await db.query(catalogSql)).rows,catalogBefore);
  });
  await test('unknown installed helper is rejected without replacing it',async()=>{
    const sql=fs.readFileSync(migration,'utf8');
    const definition=sql.slice(sql.indexOf('create or replace function'),sql.lastIndexOf('commit;')).replace('destination_schedule_v2','qa_unknown_definition');
    await db.exec('begin;');
    try {
      await db.exec(definition);
      await assert.rejects(()=>db.exec(sql.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')),/DESTINATION_SCHEDULE_PRECONDITION_FAILED/);
    } finally {await db.exec('rollback;');}
  });
  const projection=await vite.ssrLoadModule('/src/itinerary/itineraryOperationalProjection.ts');
  const first={...document.rows[0],rowId:'first',sortOrder:0,portDockName:'FIRST',previousPortName:'PREVIOUS',
    etaUtc:'2026-01-01T00:00:00Z',etbUtc:'2026-01-01T01:00:00Z',etdUtc:'2026-01-01T03:00:00Z',
    etaTimeZone:'UTC-6',etbTimeZone:'UTC+9',etdTimeZone:'UTC+8',cargoQuantityText:'FIRST CARGO',
    currentVesselState:{location:'FIRST AREA',navigationStatus:'航行',loadStatus:'空載',statusList:['to load']}};
  const second={...document.rows[0],rowId:'second',sortOrder:1,portDockName:'SECOND',previousPortName:'',
    etaUtc:'2026-01-02T00:00:00Z',etbUtc:'2026-01-02T01:00:00Z',etdUtc:'2026-01-02T03:00:00Z',
    etaTimeZone:'UTC+5:30',etbTimeZone:'UTC-3:30',etdTimeZone:'UTC+8:45',cargoQuantityText:'NEVER SECOND CARGO'};
  const third={...second,rowId:'third',sortOrder:2,portDockName:'NEVER THIRD'};
  const before='2026-01-01T02:59:59.999Z',equal='2026-01-01T03:00:00Z',after='2026-01-01T11:00:00.001+08:00';
  const scenarios=[
    ['strict past',[third,first,second],after,second],['equal',[third,first,second],equal,first],
    ['before',[second,first],before,first],['absent second',[first],after,null],
    ['blank second',[first,{...second,portDockName:' '},third],after,{...second,portDockName:'TBA'}],
    ['missing ETA',[first,{...second,etaUtc:null}],after,{...second,etaUtc:null}],
    ['missing ETB',[first,{...second,etbUtc:null}],after,{...second,etbUtc:null}],
    ['missing ETD',[first,{...second,etdUtc:null}],after,{...second,etdUtc:null}],
    ['second already departed',[first,second,third],'2026-01-05T00:00:00Z',second],
    ...[null,'','invalid','2026-02-30T00:00:00Z'].map(etd=>['invalid first ETD '+String(etd),[{...first,etdUtc:etd},second],after,{...first,etdUtc:etd}]),
  ];
  const keys=['previousPortName','portDockName','etaUtc','etaTimeZone','etbUtc','etbTimeZone','etdUtc','etdTimeZone','cargoQuantityText','currentVesselState'];
  const builders=[['legacy','select sd_build_daily_morning_snapshot($1::uuid,$2::timestamptz)',workspace],['records','select build_ship_dynamics_record_daily_morning_v1($1,$2::timestamptz)',key]];
  for(const [name,rows,now,selected] of scenarios)await test(name,async()=>{
    const values=await scalar('select sd_itinerary_operational_values_v1($1::jsonb,$2::timestamptz)',[JSON.stringify(rows),now]);
    assert.equal(values.portDockName,selected?.portDockName||'TBA');
    for(const field of ['eta','etb','etd']) {
      assert.equal(values[`${field}Utc`],selected?.[`${field}Utc`]||null,`${name}: ${field} follows destination`);
      assert.equal(values[`${field}TimeZone`],selected?.[`${field}TimeZone`]||'',`${name}: ${field} source timezone`);
    }
    const runtime=projection.projectItineraryOperationalDocument({...document,rows},now).values;
    assert.deepEqual(values,Object.fromEntries(keys.map(k=>[k,runtime[k]])),'SQL and actual TS source agree');
    for(const [builder,sql,w] of builders) {
      await db.query('update sd_itinerary_documents set rows_payload=$1::jsonb where workspace_id=$2',[JSON.stringify(rows),workspace]);
      const snapshot=await scalar(sql,[w,now]);
      assert.deepEqual(snapshot.itineraryProjections.v1.values,values,builder+' installed builder uses the same helper');
      assert.equal(snapshot.itineraryProjections.v1.rowId,'first','metadata provenance remains first row');
    }
  });
  await test('private helper remains inaccessible to browser roles',async()=>{
    for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,'sd_itinerary_operational_values_v1(jsonb,timestamptz)','EXECUTE')",[role]),false);
  });
  if(fs.existsSync(readback))await test('independent read-only deployment readback',async()=>{
    const result=await db.exec(fs.readFileSync(readback,'utf8'));
    const row=result.flatMap(r=>r.rows||[]).find(r=>r.overall);
    assert.equal(row?.overall,'PASS',JSON.stringify(row));receipt.readback=row;
    const negative=await db.exec(fs.readFileSync(readback,'utf8').replace('6b9fc89b733809b691f5569db5d6455f','00000000000000000000000000000000'));
    const failed=negative.flatMap(r=>r.rows||[]).find(r=>r.overall);
    assert.equal(failed?.overall,'FAIL');assert.deepEqual(failed.failed,['exact_helper_body'],'wrong fingerprint cannot pass readback');
  });
  receipt.ok=true;
} catch(error) {receipt.ok=false;receipt.error=error.stack;process.exitCode=1;}
finally {
  await vite?.close();await db?.close();await native?.close();
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({receipt:path.join(output,'receipt.json'),...receipt},null,2));
}
if (!receipt.ok) process.exitCode=1;

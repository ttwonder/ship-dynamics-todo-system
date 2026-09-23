import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRecordStorageLocalQa } from './record-storage-local-qa.mjs';
import { seedVesselHistory, vesselHistoryArgs } from './itinerary-vessel-history-fixture.mjs';

export const vesselHistoryMigration = 'supabase/migrations/20260923160000_itinerary_vessel_history.sql';
export const vesselHistoryRpc = 'sd_itinerary_record_report_vessel_history_v1';
const qa = await createRecordStorageLocalQa();
const tests = [];
let failure;
const check = async (name, fn) => { await fn(); tests.push(name); console.log(`PASS ${name}`); };
const read = async (vessel = null, page = 1, date = null, report = null, actor = 'qa-owner', workspace = qa.workspace) =>
  (await qa.db.query(`select public.${vesselHistoryRpc}($1,$2,$3,$4::integer,$5::date,$6::bigint) result`, [workspace, actor, vessel, page, date, report])).rows[0].result;
try {
  if (fs.existsSync(vesselHistoryMigration)) await qa.db.exec(fs.readFileSync(vesselHistoryMigration, 'utf8'));
  await check('SQL: vessel catalogue comes from retained snapshots', async () => {
    const result = await read();
    assert.equal(result.ok, true);
    assert.deepEqual(result.vessels.map(v => v.vesselId).sort(), ['qa-v1', 'qa-v2']);
    assert.equal(result.vessels.find(v => v.vesselId === 'qa-v1').vesselName, 'FORMAL qa-v1');
    assert.equal(JSON.stringify(result).includes('rows'), false, 'catalogue does not download itinerary bodies');
  });
  await seedVesselHistory(qa);
  await check('SQL: filter before distinct-date pagination; retain all same-day saves; scoped frozen detail', async () => {
    const page = await read('qa-v1');
    assert.equal(page.ok,true);
    assert.equal(page.vesselId,'qa-v1');
    assert.equal(page.dateTotal,35);
    assert.equal(page.reportTotal,37);
    assert.equal(page.pageCount,2);
    assert.equal(new Set(page.reports.map(r=>r.businessDate)).size,30);
    assert.equal(page.reports.filter(r=>r.businessDate==='2026-09-04').length,3);
    assert.deepEqual(page.reports.slice(0,3).map(r=>r.generatedBy),['manual','manual','scheduled']);
    assert.ok(page.reports.every(r=>r.vesselCount===1 && r.rowCount===1 && r.sourceMaxRevision===7));
    assert.equal(JSON.stringify(page).includes('rows'),false,'page metadata must not download full snapshots');
    const second=await read('qa-v1',2);
    assert.equal(second.reports.length,5);
    assert.equal((await read('qa-v1',1,'2026-08-01')).page,2);
    assert.equal((await read('qa-v1',1,'1900-01-01')).found,false);
    assert.equal((await read('qa-v2')).dateTotal,3,'sparse vessel must not inherit fleet date counts');
    assert.equal((await read('qa-v2',1,'2026-08-01')).found,false);
    const detail=await read('qa-v1',1,null,page.reports[0].reportId);
    assert.equal(detail.report.snapshot.vessels.length,1);
    assert.equal(detail.report.snapshot.vessels[0].vesselId,'qa-v1');
    assert.equal(detail.report.snapshot.vessels[0].rows[0].portDockName,'QA FORMAL KAOHSIUNG');
    assert.doesNotMatch(JSON.stringify(detail),/LIVE PORT|LIVE NAME|qa-v2|ALTERNATIVE/);
    assert.equal((await read()).vessels.find(v=>v.vesselId==='qa-v1').vesselName,'QA RENAMED ONE');
    assert.equal((await read('qa-v2',1,null,second.reports[0].reportId)).error,'REPORT_NOT_FOUND');
  });
  const adapter=await qa.loadModule('/src/itineraryDailyReports.ts');
  const config={supabaseUrl:qa.origin,supabaseAnonKey:'qa-only',workspaceKey:qa.workspace,tableName:'ship_dynamics_app_state',storageMode:'records-v1'};
  const calls=[];
  const client={rpc:async(name,params)=>{
    calls.push({name,params});assert.equal(name,vesselHistoryRpc);
    return {data:(await qa.db.query(`select ${name}(${vesselHistoryArgs.map((a,i)=>`$${i+1}::${a.split(':')[1]||'text'}`).join(',')}) result`,vesselHistoryArgs.map(a=>params[a.split(':')[0]]))).rows[0].result,error:null};
  }};
  await check('client→SQL: catalogue, vessel page/date and exact scoped detail use explicit read-only RPC',async()=>{
    assert.equal(typeof adapter.listItineraryHistoryVessels,'function','single-vessel client missing');
    assert.equal((await adapter.listItineraryHistoryVessels('qa-owner',config,client)).length,2);
    const page=await adapter.listItineraryVesselHistoryPage('qa-v1','qa-owner',1,null,config,client);
    assert.equal(page.dateTotal,35);assert.equal(page.items[0].vesselName,'QA RENAMED ONE');
    assert.equal((await adapter.listItineraryVesselHistoryPage('qa-v1','qa-owner',1,'2026-08-01',config,client)).page,2);
    const detail=await adapter.loadItineraryVesselHistoryReport(page.items[0].reportId,'qa-v1','qa-owner',config,client);
    assert.equal(detail.snapshot.vessels[0].vesselId,'qa-v1');assert.equal(detail.vesselCount,1);
  });
  await check('SQL: same four actor roles, invalid/missing actors denied, readonly caller privileges and rerun preserve all state',async()=>{
    const first=(await read('qa-v1')).reports[0].reportId;
    for(const role of ['owner','admin','operator','vessel']){
      await qa.db.query("update ship_dynamics_records set value=jsonb_set(value,'{role}',to_jsonb($1::text)) where collection='users' and entity_id='qa-owner'",[role]);
      for(const caller of ['anon','authenticated']){
        await qa.db.exec(`set role ${caller}`);
        try{assert.equal((await read()).ok,true);assert.equal((await read('qa-v1')).ok,true);assert.equal((await read('qa-v1',1,null,first)).ok,true);}finally{await qa.db.exec('reset role');}
      }
    }
    await qa.db.exec("update ship_dynamics_records set value=jsonb_set(value,'{isActive}','false'::jsonb) where collection='users' and entity_id='qa-owner'");
    await assert.rejects(()=>read(),/not-authorized/);
    await assert.rejects(()=>read(null,1,null,null,'missing-actor'),/not-authorized/);
    await assert.rejects(()=>read(null,1,null,null,'qa-owner','other-workspace'),/not-authorized/);
    await qa.db.exec("update ship_dynamics_records set value=jsonb_set(jsonb_set(value,'{isActive}','true'::jsonb),'{role}','\"owner\"'::jsonb) where collection='users' and entity_id='qa-owner'");
    const before=await qa.itinerarySnapshot(),records=await qa.read();
    for(const args of [[],['qa-v1'],['qa-v1',1,'2026-08-01'],['qa-v1',1,null,first],['missing-vessel']])await read(...args);
    await qa.db.exec(fs.readFileSync(vesselHistoryMigration,'utf8'));
    assert.deepEqual(await qa.itinerarySnapshot(),before);assert.deepEqual(await qa.read(),records);
    const catalog=(await qa.db.query("select provolatile,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated from pg_proc where proname=$1",[vesselHistoryRpc])).rows[0];
    assert.equal(catalog.provolatile,'s');assert.equal(catalog.prosecdef,true);assert.equal(catalog.anon,true);assert.equal(catalog.authenticated,true);assert.ok(catalog.proconfig.includes('search_path=pg_catalog, public, pg_temp'));
  });
  await check('client: malformed input/response and wrong identity fail closed; no legacy fallback',async()=>{
    const local={rpc:async()=>{throw Error('must not dispatch')}};
    for(const [vessel,page,date] of [['',1,null],['qa-v1',0,null],['qa-v1',1,'2026-02-30']])await assert.rejects(()=>adapter.listItineraryVesselHistoryPage(vessel,'qa-owner',page,date,config,local));
    await assert.rejects(()=>adapter.loadItineraryVesselHistoryReport('01','qa-v1','qa-owner',config,local));
    await assert.rejects(()=>adapter.listItineraryHistoryVessels('qa-owner',{...config,storageMode:'legacy'},local),e=>e.code==='VESSEL_HISTORY_SOURCE_UNAVAILABLE');
    await assert.rejects(()=>adapter.listItineraryHistoryVessels('qa-owner',config,{rpc:async()=>({data:null,error:{code:'PGRST202'}})}),e=>e.code==='VESSEL_HISTORY_SQL_NOT_DEPLOYED');
    const response=data=>({rpc:async()=>({data,error:null})});
    for(const data of [{ok:true,vessels:null},{ok:true,vessels:[{vesselId:'a',vesselName:'A'},{vesselId:'a',vesselName:'B'}]}])await assert.rejects(()=>adapter.listItineraryHistoryVessels('qa-owner',config,response(data)));
    const page=await read('qa-v1');
    await assert.rejects(()=>adapter.listItineraryVesselHistoryPage('qa-v2','qa-owner',1,null,config,response(page)));
    const detail=await read('qa-v1',1,null,page.reports[0].reportId);
    await assert.rejects(()=>adapter.loadItineraryVesselHistoryReport(page.reports[1].reportId,'qa-v1','qa-owner',config,response(detail)));
    await assert.rejects(()=>adapter.loadItineraryVesselHistoryReport(page.reports[0].reportId,'qa-v2','qa-owner',config,response(detail)));
    const empty=await adapter.listItineraryVesselHistoryPage('not-retained','qa-owner',100,null,config,client);
    assert.equal(empty.items.length,0);assert.equal(empty.dateTotal,0);assert.equal(empty.page,1);
  });
  await check('deployment readback: exact 12 checks PASS and missing-function negative fails',async()=>{
    const sql=fs.readFileSync('supabase/verification/itinerary_vessel_history_readback.sql','utf8');
    const result=(await qa.db.exec(sql)).find(r=>r.rows?.[0]?.result)?.rows[0];
    assert.equal(result.result,'PASS');assert.equal(result.checks,12);assert.deepEqual(result.failed_checks,[]);
    await qa.db.exec(`drop function public.${vesselHistoryRpc}(text,text,text,integer,date,bigint)`);
    const absent=(await qa.db.exec(sql)).find(r=>r.rows?.[0]?.result)?.rows[0];assert.equal(absent.result,'FAIL');assert.ok(absent.failed_checks.includes('function-exists'));
    await qa.db.exec(fs.readFileSync(vesselHistoryMigration,'utf8'));
  });
  console.log(JSON.stringify({status:'PASS', label:'本機真 SQL＋測試資料，非正式 Supabase', tests}));
} catch(error) { failure=error;console.error(JSON.stringify({status:'FAIL',code:error.code,message:error.message})); }
finally { await qa.close(); }
if(failure)process.exitCode=1;

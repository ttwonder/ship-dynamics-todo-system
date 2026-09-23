import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installVesselHistory,seedVesselHistory,vesselHistoryRpc,vesselHistoryArgs} from './itinerary-vessel-history-fixture.mjs';

const migration='supabase/migrations/20260923170000_itinerary_vessel_history_summary.sql';
const qa=await createRecordStorageLocalQa();
const cases=[];
const check=async(name,fn)=>{await fn();cases.push(name);console.log('PASS '+name);};
const read=async(vessel='qa-v1')=>(await qa.db.query(`select ${vesselHistoryRpc}($1,$2,$3) result`,[qa.workspace,'qa-owner',vessel])).rows[0].result;
let failure;
try{
  await installVesselHistory(qa.db);
  await seedVesselHistory(qa,{overview:true});
  const before=await qa.itinerarySnapshot(),records=await qa.read();
  if(fs.existsSync(migration))await qa.db.exec(fs.readFileSync(migration,'utf8'));
  await check('SQL: compact frozen overview uses first two sorted rows, never clock/live/third-row/body data',async()=>{
    const page=await read();
    assert.ok(Array.isArray(page.reports[0].overviewRows),'history list must include compact frozen overview rows');
    assert.equal(page.reports[0].overviewRows.length,2);
    assert.equal(page.reports[0].overviewRows[0].portDockName,'QA FORMAL KAOHSIUNG');
    assert.equal(page.reports[0].overviewRows[0].previousPortName,'QA FORMAL BUSAN');
    assert.equal(page.reports[0].overviewRows[0].voyageNumber,'HIST-001');
    assert.equal(page.reports[0].overviewRows[0].currentVesselState.location,'QA SAVED ANCHORAGE');
    assert.match(page.reports[0].overviewRows[1].portDockName,/^QA SUBSEQUENT PORT/);
    assert.equal(page.reports[1].overviewRows.length,1);
    assert.equal(page.reports[1].overviewRows[0].currentVesselState,null);
    assert.deepEqual((await read('qa-v2')).reports[0].overviewRows,[]);
    assert.doesNotMatch(JSON.stringify(page),/LIVE PORT|LIVE NAME|QA THIRD|QA FULL NOTES|ALTERNATIVE|"snapshot"|"rows"/);
    assert.equal(page.dateTotal,35);assert.equal(page.reportTotal,37);
  });
  const adapter=await qa.loadModule('/src/itineraryDailyReports.ts');
  const config={supabaseUrl:qa.origin,supabaseAnonKey:'qa-only',workspaceKey:qa.workspace,tableName:'ship_dynamics_app_state',storageMode:'records-v1'};
  const client={rpc:async(name,params)=>{
    assert.equal(name,vesselHistoryRpc);
    const args=vesselHistoryArgs.map(a=>params[a.split(':')[0]]);
    const data=(await qa.db.query(`select ${name}(${vesselHistoryArgs.map((a,i)=>`$${i+1}::${a.split(':')[1]||'text'}`).join(',')}) result`,args)).rows[0].result;
    return {data,error:null};
  }};
  let page;
  await check('client→SQL: preserve compact rows and distinguish absent capability from empty itinerary',async()=>{
    page=await adapter.listItineraryVesselHistoryPage('qa-v1','qa-owner',1,null,config,client);
    assert.equal(page.items[0].overviewRows.length,2);
    assert.equal(page.items[1].overviewRows.length,1);
    const raw=await read();for(const report of raw.reports)delete report.overviewRows;
    const old=await adapter.listItineraryVesselHistoryPage('qa-v1','qa-owner',1,null,config,{rpc:async()=>({data:raw,error:null})});
    assert.equal(old.items[0].overviewRows,null);
    for(const bad of [null,{},[{}, {}, {}],[null]]){
      const invalid=await read();invalid.reports[0].overviewRows=bad;
      await assert.rejects(()=>adapter.listItineraryVesselHistoryPage('qa-v1','qa-owner',1,null,config,{rpc:async()=>({data:invalid,error:null})}));
    }
  });
  await check('display: exact first-row fields, per-event LT offsets, separate second-row labels and TBA',async()=>{
    const {itineraryVesselHistorySummary:summary}=await qa.loadModule('/src/itineraryVesselHistorySummary.ts');
    const fields=summary(page.items[0].overviewRows);
    assert.deepEqual(fields.map(f=>f.label),['上一港','目前位置','目前航行狀態','目前船舶狀態','Voy No.','Next Port & Dock Name','ETA','ETB','ETD','後續港','後續港 ETA']);
    assert.deepEqual(fields.slice(0,9).map(f=>f.value),['QA FORMAL BUSAN','QA SAVED ANCHORAGE','拋錨','drydock/repair、bunker','HIST-001','QA FORMAL KAOHSIUNG','2026-08-30 08:00 LT (UTC+8)','2026-08-30 10:00 LT (UTC+9)','2026-08-30 20:30 LT (UTC-3:30)']);
    assert.match(fields[9].value,/^QA SUBSEQUENT PORT/);
    assert.equal(fields[10].value,'2026-09-15 05:30 LT (UTC+5:30)');
    const single=summary(page.items[1].overviewRows);
    assert.deepEqual(single.slice(1,4).map(f=>f.value),['—','—','—']);
    assert.deepEqual(single.slice(-2).map(f=>f.value),['TBA','TBA']);
    assert.deepEqual(summary([]).map(f=>f.value),[...Array(9).fill('—'),'TBA','TBA']);
    const noEta=structuredClone(page.items[0].overviewRows);noEta[1].etaUtc=null;
    assert.match(summary(noEta)[9].value,/^QA SUBSEQUENT/);assert.equal(summary(noEta)[10].value,'TBA');
    assert.equal(summary([{...noEta[0],etaUtc:'invalid'}])[6].value,'時間格式錯誤');
  });
  await check('upgrade/rerun: records, saved reports, documents, leases and existing authority are unchanged',async()=>{
    await qa.db.exec(fs.readFileSync(migration,'utf8'));
    assert.deepEqual(await qa.itinerarySnapshot(),before);assert.deepEqual(await qa.read(),records);
    for(const caller of ['anon','authenticated']){
      await qa.db.exec(`set role ${caller}`);
      try{assert.equal((await read()).ok,true);}finally{await qa.db.exec('reset role');}
    }
    const catalog=(await qa.db.query("select provolatile,prosecdef,proconfig from pg_proc where proname=$1",[vesselHistoryRpc])).rows;
    assert.equal(catalog.length,1);assert.equal(catalog[0].provolatile,'s');assert.equal(catalog[0].prosecdef,true);
    assert.deepEqual(catalog[0].proconfig,['search_path=pg_catalog, public, pg_temp']);
  });
  await check('readback: 12 exact upgrade checks PASS; old body and missing function fail',async()=>{
    const sql=fs.readFileSync('supabase/verification/itinerary_vessel_history_summary_readback.sql','utf8');
    const run=async()=>(await qa.db.exec(sql)).find(result=>result.rows?.[0]?.result)?.rows[0];
    const result=await run();assert.equal(result.result,'PASS');assert.equal(result.checks,12);assert.deepEqual(result.failed_checks,[]);
    await qa.db.exec(fs.readFileSync('supabase/migrations/20260923160000_itinerary_vessel_history.sql','utf8'));
    assert.deepEqual((await run()).failed_checks,['exact-function-body']);
    await qa.db.exec(`drop function ${vesselHistoryRpc}(text,text,text,integer,date,bigint)`);
    const missing=await run();assert.equal(missing.result,'FAIL');assert.ok(missing.failed_checks.includes('function-exists'));
    await qa.db.exec(fs.readFileSync(migration,'utf8'));
    assert.equal((await run()).result,'PASS');
    assert.deepEqual(await qa.itinerarySnapshot(),before);assert.deepEqual(await qa.read(),records);
  });
  console.log(JSON.stringify({status:'PASS',label:'本機真 SQL＋測試資料；非正式 Supabase',cases}));
}catch(error){failure=error;console.error(JSON.stringify({status:'FAIL',code:error.code,message:error.message}));}
finally{await qa.close();}
if(failure)process.exitCode=1;

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {seedShipExcelFixture,shipExcelRpcArgs} from './ship-itinerary-excel-local-fixture.mjs';
import {excelBusinessSnapshot} from './record-itinerary-excel-local-fixture.mjs';
const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'ship-excel-transport-'));
const tests=[];let qa,failure;
const check=async(id,fn)=>{await fn();tests.push({id,layer:'HTTP transport / installed private SQL'});console.log('PASS',id);};
const rpc=async(name,body)=>{const response=await fetch(qa.origin+'/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_workspace_key:'isolated-record-ui-qa',...body})});return {status:response.status,value:await response.json()};};
try{
 qa=await createRecordStorageLocalQa();
 await check('default-transport-public-rpcs-remain-disabled',async()=>{const before=await excelBusinessSnapshot(qa);for(const name of Object.keys(shipExcelRpcArgs)){const result=await rpc(name,{});assert.equal(result.status,404);assert.equal(result.value.code,'PGRST202');}assert.deepEqual(await excelBusinessSnapshot(qa),before);});
 await check('default-transport-record-read-unchanged',async()=>{const before=await excelBusinessSnapshot(qa),expected=await qa.read(),result=await rpc('read_ship_dynamics_records_v1',{});assert.equal(result.status,200);assert.deepEqual(result.value,expected);assert.deepEqual(await excelBusinessSnapshot(qa),before);});
 const firstOrigin=qa.origin;await qa.close();await assert.rejects(()=>fetch(firstOrigin+'/__qa/health'));qa=await createRecordStorageLocalQa({shipExcel:true});await seedShipExcelFixture(qa);
 await check('public-transport-anon-lease-renew-status-release',async()=>{
  const before=await excelBusinessSnapshot(qa),body={p_vessel_id:'qa-v1',p_actor_key:'qa-public-only',p_holder_session:'qa-public-tab',p_ttl_seconds:75};
  const list=await rpc('sd_itinerary_public_list_vessels',{});assert.equal(list.status,200);assert.deepEqual(list.value.map(v=>v.id),['qa-v1','qa-v2','qa-v3']);
  const claimed=await rpc('sd_itinerary_claim_public_lease',body);assert.equal(claimed.status,200);assert.equal(claimed.value.ok,true);const guard={...body,p_lease_id:claimed.value.leaseId,p_fencing_token:claimed.value.fencingToken};
  const renewed=await rpc('sd_itinerary_renew_public_lease',guard);assert.equal(renewed.status,200);assert.equal(renewed.value.ok,true);assert.equal(renewed.value.leaseId,guard.p_lease_id);
  const status=await rpc('sd_itinerary_operation_status_public',{p_operation_id:randomUUID(),p_actor_key:body.p_actor_key});assert.equal(status.status,200);assert.deepEqual(status.value,{status:'missing'});
  const released=await rpc('sd_itinerary_release_public_lease',guard);assert.equal(released.status,200);assert.equal(released.value,true);
  const after=await excelBusinessSnapshot(qa);for(const table of Object.keys(before))if(table!=='sd_itinerary_leases')assert.deepEqual(after[table],before[table]);assert.equal((await qa.db.query('select count(*)::int n from sd_itinerary_leases where expires_at>now()')).rows[0].n,0);
 });
 await check('public-transport-wrong-workspace-zero-sql',async()=>{const before=await excelBusinessSnapshot(qa),count=qa.metrics.length;const result=await rpc('sd_itinerary_public_load',{p_workspace_key:'not-the-fixture',p_vessel_id:'qa-v1'});assert.equal(result.status,403);assert.equal(result.value.code,'QA_SCOPE_MISMATCH');assert.equal(qa.metrics.length,count);assert.deepEqual(await excelBusinessSnapshot(qa),before);});
 assert.equal(tests.length,4);assert.ok(!qa.metrics.some(m=>m.status==='SQL_ERROR'));console.log(JSON.stringify({qa:'SHIP_EXCEL_TRANSPORT_PASS',output,tests}));
}catch(e){failure=e;console.error(e.stack);}
finally{const metrics=qa?.metrics||[],origin=qa?.origin;try{if(qa){await qa.close();await assert.rejects(()=>fetch(origin+'/__qa/health'));}}catch(e){failure??=e;}fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify({tests,metrics,error:failure?.stack,cleanup:{httpStopped:!failure},output},null,2));if(failure)process.exitCode=1;}

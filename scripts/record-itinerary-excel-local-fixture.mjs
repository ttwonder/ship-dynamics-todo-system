import assert from 'node:assert/strict';
import {seedBatchVessel} from './record-batch-vessel-local-fixture.mjs';
import {itineraryWorkspaceId} from './record-itinerary-local-fixture.mjs';

// This slice alone extends the private owner-side fixture. Shared QA defaults stay unchanged.
export async function seedItineraryExcelFixture(qa){
 await seedBatchVessel(qa);
 const first=(await qa.db.query("select * from sd_itinerary_documents where vessel_id='qa-v1'")).rows[0];
 const rows=structuredClone(first.rows_payload);
 Object.assign(rows[0],{operation:'To Load / To Unload',etaMode:'manual',etaUtc:'2026-09-07T00:00:00.000Z',etaTimeZone:'UTC+5:45',portTimeZone:'UTC+8',notesText:'QA EXCEL FORMAL BASELINE'});
 await qa.db.query("update sd_itinerary_documents set rows_payload=$1::jsonb where vessel_id='qa-v1'",[JSON.stringify(rows)]);
 await qa.db.query("update sd_itinerary_history set rows_payload=$1::jsonb where vessel_id='qa-v1'",[JSON.stringify(rows)]);
 for(const id of ['qa-v2','qa-v3']){
  // qa-v2 exists in sd_vessels, qa-v3 was added to the AppData fixture above.
  await qa.db.query("insert into sd_vessels(workspace_id,id,name,short_name,full_name,ship_type,fleet_category) values($1,$2,$3,$2,$3,'bulk','qa') on conflict do nothing",[itineraryWorkspaceId,id,`FORMAL ${id}`]);
  const copy=structuredClone(rows);Object.assign(copy[0],{id:`formal-row-${id}`,portDockName:`QA FORMAL ${id} PORT`,previousPortName:`QA PREVIOUS ${id}`});
  await qa.db.query("insert into sd_itinerary_documents(workspace_id,vessel_id,revision,rows_payload,alternative_plans_payload,updated_at,updated_actor_kind,updated_actor_label) values($1,$2,7,$3::jsonb,'[]',$4,'office','Formal author')",[itineraryWorkspaceId,id,JSON.stringify(copy),first.updated_at]);
  await qa.db.query("insert into sd_itinerary_history(workspace_id,vessel_id,revision,schema_version,rows_payload,alternative_plans_payload,actor_kind,actor_label,operation_id) values($1,$2,7,1,$3::jsonb,'[]','office','Formal author',$4::uuid)",[itineraryWorkspaceId,id,JSON.stringify(copy),id==='qa-v2'?'22222222-2222-4222-8222-222222222222':'33333333-3333-4333-8333-333333333333']);
 }
 await qa.db.exec("delete from sd_itinerary_leases where holder_session='fixture-tab';");
 assert.equal((await qa.read()).payload.vessels.length,3);
}

export async function excelBusinessSnapshot(qa){
 const result={};
 const tables=(await qa.db.query("select tablename from pg_tables where schemaname='public' and (tablename like 'sd_%' or tablename like 'ship_dynamics_%') order by tablename")).rows;
 for(const {tablename} of tables){
  assert.match(tablename,/^[a-z_]+$/);
  result[tablename]=(await qa.db.query(`select to_jsonb(t) value,xmin::text,ctid::text from ${tablename} t order by to_jsonb(t)::text`)).rows;
 }
 return result;
}
export function assertOnlyFormalWrites(before,after,ids){
 const allowed=new Set(['sd_itinerary_documents','sd_itinerary_history','sd_itinerary_operations','sd_itinerary_leases']);
 for(const table of Object.keys(before)){
  if(!allowed.has(table)){assert.deepEqual(after[table],before[table],`unchanged AppData/legacy/other formal ${table}`);continue;}
  const keep=rows=>rows.filter(r=>table==='sd_itinerary_operations'?!ids.some(id=>r.value.target_key==='vessel:'+id):!ids.includes(r.value.vessel_id));
  assert.deepEqual(keep(after[table]),keep(before[table]),`unselected value/xmin/ctid ${table}`);
 }
}

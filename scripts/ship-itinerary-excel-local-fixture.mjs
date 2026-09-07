import assert from 'node:assert/strict';
import {seedItineraryExcelFixture} from './record-itinerary-excel-local-fixture.mjs';
import {itineraryWorkspaceId} from './record-itinerary-local-fixture.mjs';

// Opt-in transport signatures only. Every response executes the installed public SQL.
export const shipExcelRpcArgs={
 sd_itinerary_public_list_vessels:['p_workspace_key'],
 sd_itinerary_public_load:['p_workspace_key','p_vessel_id'],
 sd_itinerary_claim_public_lease:['p_workspace_key','p_vessel_id','p_actor_key','p_holder_session','p_ttl_seconds:integer'],
 sd_itinerary_renew_public_lease:['p_workspace_key','p_vessel_id','p_lease_id:uuid','p_actor_key','p_holder_session','p_fencing_token:bigint','p_ttl_seconds:integer'],
 sd_itinerary_release_public_lease:['p_workspace_key','p_vessel_id','p_lease_id:uuid','p_actor_key','p_holder_session','p_fencing_token:bigint'],
 sd_itinerary_save_public:['p_workspace_key','p_vessel_id','p_expected_revision:bigint','p_operation_id:uuid','p_rows:jsonb','p_lease_id:uuid','p_actor_key','p_holder_session','p_fencing_token:bigint','p_alternative_plans:jsonb'],
 sd_itinerary_operation_status_public:['p_workspace_key','p_operation_id:uuid','p_actor_key'],
};
export async function seedShipExcelFixture(qa){
 await seedItineraryExcelFixture(qa);
 await qa.db.query('insert into sd_itinerary_rollout(workspace_id,ship_portal_enabled) values($1,true) on conflict(workspace_id) do update set ship_portal_enabled=true',[itineraryWorkspaceId]);
 await qa.db.query("insert into sd_vessels(workspace_id,id,name,short_name,full_name,ship_type,fleet_category,is_active) values($1,'qa-inactive','QA INACTIVE','QA INACTIVE','QA INACTIVE','bulk','qa',false)",[itineraryWorkspaceId]);
 const first=(await qa.db.query("select rows_payload,alternative_plans_payload from sd_itinerary_documents where vessel_id='qa-v1'")).rows[0];
 // A complete synthetic report anchor is present before downloading; do not bypass original confirmation.
 const anchor={calculationStartUtc:'2026-09-07T00:00:00Z',calculationStartTimeZone:'UTC+8'};
 Object.assign(first.rows_payload[0],anchor);
 for(const plan of first.alternative_plans_payload)Object.assign(plan.rows[0],anchor);
 for(const table of ['sd_itinerary_documents','sd_itinerary_history'])await qa.db.query(`update ${table} set rows_payload=$1::jsonb,alternative_plans_payload=$2::jsonb where vessel_id='qa-v1'`,[JSON.stringify(first.rows_payload),JSON.stringify(first.alternative_plans_payload)]);
 assert.equal((await qa.db.query("select auth.uid() actor")).rows[0].actor,null);
}

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { itineraryWorkspaceId } from './record-itinerary-local-fixture.mjs';

export const vesselHistoryMigration = 'supabase/migrations/20260923160000_itinerary_vessel_history.sql';
export const vesselHistoryRpc = 'sd_itinerary_record_report_vessel_history_v1';
export const vesselHistoryArgs = ['p_workspace_key','p_actor_user_id','p_vessel_id','p_page:integer','p_business_date:date','p_report_id:bigint'];
export async function installVesselHistory(db) {
  if (fs.existsSync(vesselHistoryMigration)) await db.exec(fs.readFileSync(vesselHistoryMigration,'utf8'));
}
export async function seedVesselHistory(qa) {
  for (let index = 0; index < 35; index++) {
    const date = new Date(Date.UTC(2026,7,1+index)).toISOString().slice(0,10);
    await qa.db.query("update sd_vessels set is_active=$1 where id='qa-v2'", [index >= 33]);
    if (index === 34) await qa.db.query("update sd_vessels set name='QA RENAMED ONE' where id='qa-v1'");
    await qa.db.query('select sd_generate_daily_itinerary_report($1,$2::date,$3::timestamptz)', [itineraryWorkspaceId,date,`${date}T01:00:00Z`]);
  }
  const latest = (await qa.db.query("select * from sd_itinerary_daily_reports where business_date='2026-09-04' and generated_by='scheduled'")).rows[0];
  for (const time of ['2026-09-04T03:00:00Z','2026-09-04T05:00:00Z']) {
    const snapshot = {...latest.snapshot,generatedAt:time};
    await qa.db.query(`insert into sd_itinerary_daily_reports(workspace_id,business_date,timezone,generated_at,generated_by,generated_by_actor_id,operation_id,snapshot,vessel_count,row_count,source_max_revision)
      values($1,'2026-09-04','Asia/Taipei',$2,'manual','qa-owner',$3,$4::jsonb,$5,$6,$7)`,
    [itineraryWorkspaceId,time,randomUUID(),JSON.stringify(snapshot),latest.vessel_count,latest.row_count,latest.source_max_revision]);
  }
  // Current live values must never replace the frozen history or determine eligibility.
  await qa.db.exec("update sd_vessels set is_active=false,name='LIVE NAME NOT HISTORICAL' where id='qa-v1'; update sd_itinerary_documents set revision=99,rows_payload=jsonb_set(rows_payload,'{0,portDockName}','\"LIVE PORT MUST NOT PROJECT\"'::jsonb) where vessel_id='qa-v1';");
}

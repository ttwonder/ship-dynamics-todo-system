import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { itineraryWorkspaceId } from './record-itinerary-local-fixture.mjs';

export const vesselHistoryMigration = 'supabase/migrations/20260923160000_itinerary_vessel_history.sql';
export const vesselHistorySummaryMigration = 'supabase/migrations/20260923170000_itinerary_vessel_history_summary.sql';
export const vesselHistoryRpc = 'sd_itinerary_record_report_vessel_history_v1';
export const vesselHistoryArgs = ['p_workspace_key','p_actor_user_id','p_vessel_id','p_page:integer','p_business_date:date','p_report_id:bigint'];
export async function installVesselHistory(db) {
  if (fs.existsSync(vesselHistoryMigration)) await db.exec(fs.readFileSync(vesselHistoryMigration,'utf8'));
  if (fs.existsSync(vesselHistorySummaryMigration)) await db.exec(fs.readFileSync(vesselHistorySummaryMigration,'utf8'));
}
export async function seedVesselHistory(qa, { overview = false } = {}) {
  if (overview) {
    const original = (await qa.db.query("select rows_payload from sd_itinerary_documents where vessel_id='qa-v1'")).rows[0].rows_payload[0];
    const first = {...original, sortOrder:10, voyageNumber:'HIST-001',
      currentVesselState:{location:'QA SAVED ANCHORAGE',navigationStatus:'拋錨',statusList:['drydock/repiar','bunker']},
      etaUtc:'2026-08-30T00:00:00Z',etaTimeZone:'UTC+8',
      etbUtc:'2026-08-30T01:00:00Z',etbTimeZone:'UTC+9',
      etdUtc:'2026-08-31T00:00:00Z',etdTimeZone:'UTC-3:30',
      notesText:'QA FULL NOTES MUST NOT TRAVEL IN OVERVIEW'};
    const second = {...original,rowId:'second-row',sortOrder:20,previousPortName:'WRONG SECOND PREVIOUS',voyageNumber:'WRONG-VOY',
      currentVesselState:{location:'WRONG SECOND LOCATION',navigationStatus:'航行',statusList:['loading']},
      portDockName:'QA SUBSEQUENT PORT / EAST TERMINAL — 長港名換行測試，不省略原始港口與碼頭名稱',
      etaUtc:'2026-09-15T00:00:00Z',etaTimeZone:'UTC+5:30'};
    const third = {...original,rowId:'third-row',sortOrder:30,portDockName:'QA THIRD MUST NOT PROJECT'};
    await qa.db.query("update sd_itinerary_documents set rows_payload=$1::jsonb where vessel_id='qa-v1'",[JSON.stringify([third,second,first])]);
  }
  for (let index = 0; index < 35; index++) {
    const date = new Date(Date.UTC(2026,7,1+index)).toISOString().slice(0,10);
    await qa.db.query("update sd_vessels set is_active=$1 where id='qa-v2'", [index >= 33]);
    if (index === 34) await qa.db.query("update sd_vessels set name='QA RENAMED ONE' where id='qa-v1'");
    await qa.db.query('select sd_generate_daily_itinerary_report($1,$2::date,$3::timestamptz)', [itineraryWorkspaceId,date,`${date}T01:00:00Z`]);
  }
  const latest = (await qa.db.query("select * from sd_itinerary_daily_reports where business_date='2026-09-04' and generated_by='scheduled'")).rows[0];
  for (const time of ['2026-09-04T03:00:00Z','2026-09-04T05:00:00Z']) {
    const snapshot = structuredClone({...latest.snapshot,generatedAt:time});
    if (overview && time === '2026-09-04T03:00:00Z') {
      const vessel = snapshot.vessels.find(v => v.vesselId === 'qa-v1');
      const first = vessel.rows.find(row => row.sortOrder === 10);
      delete first.currentVesselState; // Old captures must not be backfilled from the live vessel.
      vessel.rows = [first];
      snapshot.rowCount = snapshot.vessels.reduce((sum,v) => sum + v.rows.length, 0);
    }
    await qa.db.query(`insert into sd_itinerary_daily_reports(workspace_id,business_date,timezone,generated_at,generated_by,generated_by_actor_id,operation_id,snapshot,vessel_count,row_count,source_max_revision)
      values($1,'2026-09-04','Asia/Taipei',$2,'manual','qa-owner',$3,$4::jsonb,$5,$6,$7)`,
    [itineraryWorkspaceId,time,randomUUID(),JSON.stringify(snapshot),latest.vessel_count,snapshot.rowCount,latest.source_max_revision]);
  }
  // Current live values must never replace the frozen history or determine eligibility.
  await qa.db.exec("update sd_vessels set is_active=false,name='LIVE NAME NOT HISTORICAL' where id='qa-v1'; update sd_itinerary_documents set revision=99,rows_payload=jsonb_set(rows_payload,'{0,portDockName}','\"LIVE PORT MUST NOT PROJECT\"'::jsonb) where vessel_id='qa-v1';");
}

import fs from 'node:fs';
import {installShipInternalControlFixture} from './ship-internal-control-local-fixture.mjs';
/** Current mounted App prerequisites, installed only in disposable local SQL.
 * Reuse the admitted browser authority + public revision fixture, not a partial
 * migration chain whose default authority is incompatible with scoped reads. */
export async function installTrackingBrowserMigrations(db){
 await installShipInternalControlFixture(db,'isolated-record-ui-qa');
 await db.exec(fs.readFileSync('supabase/migrations/20260924160000_tracking_records.sql','utf8'));
}

export async function installTrackingFieldRevision(db, { fleetStatistics = true } = {}) {
  for(const name of ['20260925020000_edit_lock_holder.sql','20260925080000_ship_tracking_public.sql','20260925160000_tracking_field_revision.sql']) await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
  if(fleetStatistics) for(const name of ['20260927130000_tracking_fleet_statistics.sql','20260928140000_tracking_annual_types.sql']) await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
}

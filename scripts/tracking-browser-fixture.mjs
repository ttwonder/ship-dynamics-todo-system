import fs from 'node:fs';
import {installShipInternalControlFixture} from './ship-internal-control-local-fixture.mjs';
/** Current mounted App prerequisites, installed only in disposable local SQL.
 * Reuse the admitted browser authority + public revision fixture, not a partial
 * migration chain whose default authority is incompatible with scoped reads. */
export async function installTrackingBrowserMigrations(db){
 await installShipInternalControlFixture(db,'isolated-record-ui-qa');
 await db.exec(fs.readFileSync('supabase/migrations/20260924160000_tracking_records.sql','utf8'));
}

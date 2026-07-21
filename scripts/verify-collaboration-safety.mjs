import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const cloud = fs.readFileSync('src/cloud.ts', 'utf8');
const schema = fs.readFileSync('supabase/schema.sql', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.ok(schema.includes('ship_dynamics_app_revisions') && schema.includes('ship_dynamics_edit_locks'), 'Supabase schema must include revision history and edit-lock tables');
assert.ok(schema.includes('claim_ship_dynamics_edit_lock') && schema.includes('release_ship_dynamics_edit_lock'), 'Supabase schema must expose claim/release edit-lock RPCs');
assert.ok(schema.includes('record_ship_dynamics_revision_history') && schema.includes('updated_by'), 'Cloud saves must persist updated_by and revision history');

assert.ok(cloud.includes('export interface CloudEditingLock') && cloud.includes('claimEditLock') && cloud.includes("rpc('claim_ship_dynamics_edit_lock'"), 'cloud.ts must provide claimEditLock via Supabase RPC');
assert.ok(cloud.includes('releaseEditLock') && cloud.includes("rpc('release_ship_dynamics_edit_lock'"), 'cloud.ts must provide releaseEditLock via Supabase RPC');
assert.ok(cloud.includes('updated_by') && cloud.includes('savedByName'), 'cloud.ts save path must store the saver name');

assert.ok(app.includes('activeEditLock') && app.includes('claimEditLock') && app.includes('releaseCurrentEditLock'), 'App must track active edit locks and release them');
assert.ok(app.includes('此項目正在由') && app.includes('避免覆蓋對方內容'), 'App must show a clear collaborative editing conflict message');
assert.ok(app.includes('openVesselEditor') && app.includes("vessel:${id}"), 'Vessel editing must claim a per-vessel lock before opening');
assert.ok(app.includes('openTaskEditor') && app.includes("task:${task.id}"), 'Task editing must claim a per-task lock before opening');
assert.ok(app.includes('collaboration-banner') && app.includes('多人協作安全'), 'App must render collaboration safety status in the UI');

assert.equal(pkg.scripts['test:collaboration-safety'], 'node scripts/verify-collaboration-safety.mjs', 'package.json must register collaboration safety regression');

console.log('Collaboration safety contracts passed.');

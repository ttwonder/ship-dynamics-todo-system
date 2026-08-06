import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

const handler = app.match(/const toggleDashboardVesselAttention=[\s\S]*?\n  const adjustDashboardVesselAttention=/)?.[0] || '';
assert.ok(handler, 'must locate dashboard vessel-attention handler');
assert.ok(handler.includes('vesselAttentionSaveQueue.current?.enqueue'), 'attention click must enqueue the latest desired state');
assert.ok(!handler.includes('mutateVesselWithLease'), 'attention click must not wait for the whole-vessel edit lease workflow');
assert.ok(app.includes('createVesselAttentionSaveQueue'), 'App must own the latest-value per-vessel queue');
assert.ok(app.includes('vesselAttentionDirectSaveSnapshots'), 'direct attention saves must mark their snapshot');
assert.match(app, /const directAttentionSave=vesselAttentionDirectSaveSnapshots\.current\.has\(data\);[\s\S]*?if\(directAttentionSave\)return;/, '900ms autosave must skip snapshots already sent by the attention queue');
assert.ok(app.includes('attentionSaveStates={vesselAttentionSaveStates}'), 'Dashboard must receive per-vessel sync state');
assert.ok(app.includes('onRetryAttentionSave={retryDashboardVesselAttention}'), 'Dashboard must receive a per-card retry action');

const cloudConfigurationChange = app.slice(
  app.indexOf('const saveCloudConfiguration ='),
  app.indexOf('const leaveCurrentIdentity ='),
);
const identityLeave = app.slice(
  app.indexOf('const leaveCurrentIdentity ='),
  app.indexOf('const readOnlyTask='),
);
const attentionPendingGuard = 'vesselAttentionSaveQueue.current?.hasPending()';
assert.ok(cloudConfigurationChange.split(attentionPendingGuard).length - 1 >= 2, 'cloud configuration changes must recheck pending attention intent at the final reload boundary');
assert.ok(identityLeave.split(attentionPendingGuard).length - 1 >= 2, 'identity leave must recheck pending attention intent at the final identity boundary');

for (const contract of [
  'attentionSaveStates?: Record<string, VesselAttentionSaveState>',
  'onRetryAttentionSave?: (vesselId: string) => void',
  '同步中…',
  '待同步',
  '同步失敗，重試',
  'weekly-attention-sync',
]) assert.ok(dashboard.includes(contract), `Dashboard missing attention sync contract: ${contract}`);

for (const className of [
  '.weekly-attention-sync',
  '.weekly-attention-sync.pending',
  '.weekly-attention-sync.saving',
  '.weekly-attention-sync.error',
]) assert.ok(styles.includes(className), `styles missing ${className}`);

console.log('Dashboard vessel-attention integration contracts passed.');

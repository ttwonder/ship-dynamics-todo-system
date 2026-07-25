import assert from 'node:assert/strict';
import { analyzeLegacyMigrationReadiness } from './verify-legacy-migration-readiness.mjs';

const valid = {
  users: [
    { id: 'owner', role: 'owner', isActive: true, passwordHash: 'legacy', managedVesselIds: [] },
    { id: 'operator', role: 'operator', isActive: true, passwordHash: '', managedVesselIds: ['v1'] },
  ],
  vessels: [{ id: 'v1', isActive: true, assignedUserIds: ['operator'], delegateManagers: [] }],
  tasks: [
    { id: 't1', vesselId: 'v1', vesselIds: ['v1'], sourceMeetingId: 'm1', sourceMeetingItemId: 'mi1' },
    { id: 't2', vesselId: 'v1', vesselIds: ['v1'], isInternalControl: true, internalControlCaseId: 'ic1' },
  ],
  meetings: [{ id: 'm1', vessels: ['v1'], taskItems: [{ id: 'mi1', description: 'x' }] }],
  internalControlCases: [{ id: 'ic1', vesselId: 'v1', syncToTask: true, linkedTaskId: 't2' }],
  notifications: [], auditLogs: [], savedReports: [],
};

const good = analyzeLegacyMigrationReadiness(valid, 7);
assert.equal(good.readyForDataImport, true);
assert.equal(good.readyForAuthCutover, false);
assert.equal(good.pendingActivationCount, 1);
assert.deepEqual(good.issueCounts, {});

const broken = structuredClone(valid);
broken.tasks.push({ id: 't1', vesselId: 'missing', vesselIds: ['missing'], sourceMeetingId: 'missing', sourceMeetingItemId: 'none', internalControlCaseId: 'missing' });
broken.internalControlCases[0].linkedTaskId = 'missing-task';
broken.users.push({ id: 'second-owner', role: 'owner', isActive: true, passwordHash: 'legacy', managedVesselIds: [] });
const bad = analyzeLegacyMigrationReadiness(broken, 8);
assert.equal(bad.readyForDataImport, false);
assert.equal(bad.readyForAuthCutover, false);
assert.ok(bad.issueCounts.duplicate_task_id > 0);
assert.ok(bad.issueCounts.invalid_owner_cardinality > 0);
assert.ok(bad.issueCounts.orphan_task_vessel > 0);
assert.ok(bad.issueCounts.invalid_meeting_task_link > 0);
assert.ok(bad.issueCounts.invalid_internal_case_task_link > 0);
assert.ok(!JSON.stringify(bad).includes('missing-task'));

console.log('legacy_migration_readiness=PASS');

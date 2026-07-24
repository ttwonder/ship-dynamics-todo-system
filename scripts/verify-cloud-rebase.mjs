import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const { rebaseDisjointAppData, CloudRebaseConflictError } = await server.ssrLoadModule('/src/cloudRebase.ts');
  const clone = value => structuredClone(value);
  const base = createInitialData();
  assert.ok(base.vessels.length >= 2, 'fixture requires at least two vessels');
  base.revision = 10;
  base.updatedAt = '2026-07-24T00:00:00.000Z';

  const local = clone(base);
  local.revision = 11;
  local.vessels[0].position.location = 'LOCAL-PORT';
  local.auditLogs.unshift({ id: 'audit-local', at: '2026-07-24T00:01:00.000Z', actorId: 'u-local', actorName: 'Local', actorRole: 'operator', action: 'local', entityType: 'vessel', entityId: local.vessels[0].id, detail: 'local change' });

  const remote = clone(base);
  remote.revision = 11;
  remote.vessels[1].position.location = 'REMOTE-PORT';
  remote.auditLogs.unshift({ id: 'audit-remote', at: '2026-07-24T00:01:01.000Z', actorId: 'u-remote', actorName: 'Remote', actorRole: 'operator', action: 'remote', entityType: 'vessel', entityId: remote.vessels[1].id, detail: 'remote change' });

  const rebased = rebaseDisjointAppData(base, local, remote, '2026-07-24T00:02:00.000Z');
  assert.equal(rebased.revision, 12, 'rebased payload must advance from the latest remote revision');
  assert.equal(rebased.vessels[0].position.location, 'LOCAL-PORT', 'local disjoint vessel edit must survive');
  assert.equal(rebased.vessels[1].position.location, 'REMOTE-PORT', 'remote disjoint vessel edit must survive');
  assert.deepEqual(new Set(rebased.auditLogs.slice(0, 2).map(item => item.id)), new Set(['audit-local', 'audit-remote']), 'independent audit entries must both survive');

  const sameEntityLocal = clone(base);
  sameEntityLocal.revision = 11;
  sameEntityLocal.vessels[0].position.location = 'LOCAL-SAME';
  const sameEntityRemote = clone(base);
  sameEntityRemote.revision = 11;
  sameEntityRemote.vessels[0].note.recentDynamics = 'REMOTE-SAME';
  assert.throws(
    () => rebaseDisjointAppData(base, sameEntityLocal, sameEntityRemote, '2026-07-24T00:03:00.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.includes(`vessels:${base.vessels[0].id}`),
    'different edits to the same entity must fail closed even when fields differ',
  );

  const settingsLocal = clone(base);
  settingsLocal.revision = 11;
  settingsLocal.settings.systemTitle = 'LOCAL TITLE';
  const settingsRemote = clone(base);
  settingsRemote.revision = 11;
  settingsRemote.settings.departments = [...settingsRemote.settings.departments, 'REMOTE DEPT'];
  const settingsRebased = rebaseDisjointAppData(base, settingsLocal, settingsRemote, '2026-07-24T00:04:00.000Z');
  assert.equal(settingsRebased.settings.systemTitle, 'LOCAL TITLE');
  assert.ok(settingsRebased.settings.departments.includes('REMOTE DEPT'), 'disjoint settings keys may merge');

  const authorizationLocal = clone(base);
  authorizationLocal.vessels[0].position.location = 'LOCAL-AUTH-RACE';
  const authorizationRemote = clone(base);
  authorizationRemote.users[0].isActive = false;
  assert.throws(
    () => rebaseDisjointAppData(base, authorizationLocal, authorizationRemote, '2026-07-24T00:04:10.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.includes('authorization-domain'),
    'remote identity or authorization changes must prevent automatic reapplication of a local business mutation',
  );

  const vesselAuthorizationBase = clone(base);
  const assignedUserId = vesselAuthorizationBase.users.find(user=>user.isActive)?.id || 'qa-assigned-user';
  vesselAuthorizationBase.vessels[0].assignedUserIds=[assignedUserId];
  const vesselAuthorizationLocal = clone(vesselAuthorizationBase);
  vesselAuthorizationLocal.meetings.push({ id:'local-meeting-after-assignment', vesselIds:[vesselAuthorizationBase.vessels[0].id], marker:'local' });
  vesselAuthorizationLocal.agendaReports.push({ id:'local-report-after-assignment', vesselIds:[vesselAuthorizationBase.vessels[0].id], marker:'local' });
  const vesselAuthorizationRemote = clone(vesselAuthorizationBase);
  vesselAuthorizationRemote.vessels[0].assignedUserIds=[];
  assert.throws(
    () => rebaseDisjointAppData(vesselAuthorizationBase,vesselAuthorizationLocal,vesselAuthorizationRemote,'2026-07-24T00:04:15.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.includes('authorization-domain'),
    'remote vessel assignment/delegation revocation must prevent automatic reapplication of local meeting/report mutations',
  );

  const dependencyBase = clone(base);
  dependencyBase.tasks.push({ id:'dep-task', internalControlCaseId:'dep-case', vesselId:base.vessels[0].id, sourceMeetingId:'dep-meeting', marker:'base' });
  dependencyBase.internalControlCases.push({ id:'dep-case', linkedTaskId:'dep-task', vesselId:base.vessels[0].id, marker:'base' });
  dependencyBase.meetings.push({ id:'dep-meeting', marker:'base' });
  const taskLocal = clone(dependencyBase);
  taskLocal.tasks.find(item => item.id === 'dep-task').marker = 'local-task';
  const caseRemote = clone(dependencyBase);
  caseRemote.internalControlCases.find(item => item.id === 'dep-case').marker = 'remote-case';
  assert.throws(
    () => rebaseDisjointAppData(dependencyBase, taskLocal, caseRemote, '2026-07-24T00:04:20.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.some(item => item.startsWith('dependency:internal-control')),
    'linked task and internal-control case changes are one dependency domain even across collections',
  );
  const meetingRemote = clone(dependencyBase);
  meetingRemote.meetings.find(item => item.id === 'dep-meeting').marker = 'remote-meeting';
  assert.throws(
    () => rebaseDisjointAppData(dependencyBase, taskLocal, meetingRemote, '2026-07-24T00:04:30.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.includes('dependency:meeting-task'),
    'meeting-derived task changes must conflict with concurrent source-meeting changes',
  );
  const vesselRemote = clone(dependencyBase);
  vesselRemote.vessels[0].isActive = false;
  assert.throws(
    () => rebaseDisjointAppData(dependencyBase, taskLocal, vesselRemote, '2026-07-24T00:04:40.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.includes('dependency:vessel-scope'),
    'task changes must not be reapplied when their vessel scope changes remotely',
  );

  const disjointTaskBase = clone(base);
  disjointTaskBase.tasks.push({ id:'task-vessel-a', vesselId:base.vessels[0].id, marker:'base' }, { id:'task-vessel-b', vesselId:base.vessels[1].id, marker:'base' });
  const disjointTaskLocal = clone(disjointTaskBase);
  disjointTaskLocal.tasks.find(item => item.id === 'task-vessel-a').marker = 'local';
  const disjointTaskRemote = clone(disjointTaskBase);
  disjointTaskRemote.tasks.find(item => item.id === 'task-vessel-b').marker = 'remote';
  const disjointTasksRebased = rebaseDisjointAppData(disjointTaskBase, disjointTaskLocal, disjointTaskRemote, '2026-07-24T00:04:50.000Z');
  assert.equal(disjointTasksRebased.tasks.find(item => item.id === 'task-vessel-a').marker, 'local');
  assert.equal(disjointTasksRebased.tasks.find(item => item.id === 'task-vessel-b').marker, 'remote');

  const collectionKeys = ['users', 'vessels', 'tasks', 'internalControlCases', 'meetings', 'agendaReports', 'auditLogs', 'notifications'];
  const snapshotNames = ['base', 'local', 'remote'];
  for (const collectionKey of collectionKeys) {
    for (const snapshotName of snapshotNames) {
      const snapshots = { base: clone(base), local: clone(base), remote: clone(base) };
      snapshots[snapshotName][collectionKey].push(
        { id: '__duplicate-id__', marker: 'first' },
        { id: '__duplicate-id__', marker: 'second' },
      );
      assert.throws(
        () => rebaseDisjointAppData(snapshots.base, snapshots.local, snapshots.remote, '2026-07-24T00:05:00.000Z'),
        error => error instanceof CloudRebaseConflictError && error.conflicts.includes(`${collectionKey}:${snapshotName}:duplicate-id:__duplicate-id__`),
        `${snapshotName}.${collectionKey} duplicate IDs must fail closed before merge indexing`,
      );
    }
  }

  const invalidIds = [
    { label: 'blank', value: '   ' },
    { label: 'non-string', value: 42 },
  ];
  for (const collectionKey of collectionKeys) {
    for (const snapshotName of snapshotNames) {
      for (const invalidId of invalidIds) {
        const snapshots = { base: clone(base), local: clone(base), remote: clone(base) };
        snapshots[snapshotName][collectionKey].push({ id: invalidId.value, marker: invalidId.label });
        assert.throws(
          () => rebaseDisjointAppData(snapshots.base, snapshots.local, snapshots.remote, '2026-07-24T00:06:00.000Z'),
          error => error instanceof CloudRebaseConflictError && error.conflicts.includes(`${collectionKey}:${snapshotName}:invalid-id`),
          `${snapshotName}.${collectionKey} ${invalidId.label} IDs must fail closed before merge indexing`,
        );
      }
    }
  }

  console.log('Cloud disjoint rebase runtime contracts passed.');
} finally {
  await server.close();
}

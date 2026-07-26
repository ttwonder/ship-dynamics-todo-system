import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = '11111111-1111-4111-8111-111111111111';
const lease = {
  leaseKey: 'entity:entity-a',
  ownerSession: '22222222-2222-4222-8222-222222222222',
  fencingToken: 7,
};

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key) { return this.values.get(key) ?? null; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  removeItem(key) { this.values.delete(key); }
  setItem(key, value) { this.values.set(key, String(value)); }
}

class MockClient {
  calls = [];
  reservationResult = { status: 'prepared', replayed: false };
  commandError = null;
  recoveredResult = null;

  async rpc(name, args) {
    this.calls.push({ name, args: structuredClone(args) });
    if (name === 'reserve_ship_dynamics_operation') {
      return { data: this.reservationResult, error: null };
    }
    if (name === 'get_ship_dynamics_operation_status') {
      return {
        data: this.recoveredResult || {
          status: 'prepared',
          command: 'unknown',
          target: 'unknown',
          result: null,
          errorCode: null,
          completedAt: null,
        },
        error: null,
      };
    }
    if (name.startsWith('command_ship_dynamics_')) {
      return this.commandError
        ? { data: null, error: this.commandError }
        : {
            data: {
              status: 'committed',
              replayed: false,
              entityId: String(args.p_task_id || args.p_vessel_id || args.p_meeting_id
                || args.p_case_id || args.p_user_id || args.p_report_id || 'aggregate'),
            },
            error: null,
          };
    }
    return { data: true, error: null };
  }

  from() { throw new Error('unexpected table fallback'); }
  channel() { throw new Error('unexpected Realtime path'); }
  removeChannel() { return Promise.resolve('ok'); }
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const repositoryModule = await server.ssrLoadModule('/src/normalizedRepository.ts');
  const scopeModule = await server.ssrLoadModule('/src/normalizedSupabaseClient.ts');
  const commandModule = await server.ssrLoadModule('/src/normalizedCommands.ts');
  const controllerModule = await server.ssrLoadModule('/src/normalizedUiController.ts');
  const {
    NormalizedRepository,
    NormalizedDurableStateStore,
    NormalizedCommandError,
  } = repositoryModule;
  const { NormalizedRequestScope } = scopeModule;
  const { NormalizedCommandClient } = commandModule;
  const { NormalizedUiController } = controllerModule;

  const client = new MockClient();
  const scope = new NormalizedRequestScope(workspaceId);
  scope.acceptSession({ user: { id: actorId } });
  const storage = new MemoryStorage();
  const repository = new NormalizedRepository(client, scope, {
    durableState: new NormalizedDurableStateStore(storage),
  });
  const commands = new NormalizedCommandClient(repository);

  const entityLease = key => ({ ...lease, leaseKey: key });
  const baseMeeting = {
    scopeMode: 'vessels',
    subject: 'Safety meeting',
    status: '追蹤中',
    meetingDate: '2026-07-26T09:00',
    vesselIds: ['v1'],
    vesselTypeScopes: [],
    departments: ['Operations'],
    participantUserIds: [actorId],
    trackingUserIds: [actorId],
    responsibleUserIds: [actorId],
    reason: 'Review',
    resolution: 'Follow up',
    expectedDate: '2026-07-30',
    completedDate: null,
    priority: '高',
    isAbnormal: false,
    isInternalControl: false,
    includeInMorning: true,
    items: [{ id: 'item-a', description: 'Inspect', categories: ['Safety'], distributeToVessels: true }],
  };
  const internalCase = {
    vesselId: 'v1',
    reportDate: '2026-07-26',
    reportSource: '日常',
    description: 'Internal case',
    priority: '中',
    category: 'Safety',
    equipmentSubcategory: null,
    isAware: false,
    status: '追蹤中',
    origin: 'internal-control',
    isClosed: false,
    closedDate: null,
    departments: ['Operations'],
  };

  const mutationCalls = [
    () => commands.updateVesselManualAttention({
      vesselId: 'v1', baseVersion: 1, lease: entityLease('vessel:v1'),
      manualAttentionLevel: '高',
    }),
    () => commands.updateOrdinaryTask({
      taskId: 'task-a', baseVersion: 1, lease: entityLease('task:task-a'),
      content: { description: 'Task', vesselIds: ['v1'] },
    }),
    () => commands.updateTaskVesselProgress({
      taskId: 'task-a', vesselId: 'v1', taskBaseVersion: 2, progressBaseVersion: 1,
      lease: entityLease('task-progress:task-a:v1'), status: 'Done', isClosed: true,
    }),
    () => commands.createMeeting({
      meetingId: 'meeting-a', lease: entityLease('meeting:meeting-a'), payload: baseMeeting,
    }),
    () => commands.correctMeetingStatus({
      meetingId: 'meeting-a', eventId: 'f0000000-0000-4000-8000-000000000099', baseVersion: 1,
      lease: entityLease('meeting:meeting-a'), correctionKind: 'void',
      correctedStatus: null, reason: 'Duplicate event',
    }),
    () => commands.createInternalCase({
      caseId: 'case-a', caseLease: entityLease('internal-case:case-a'),
      casePayload: internalCase,
    }),
    () => commands.convertTaskToInternalCase({
      caseId: 'case-b', taskId: 'task-b', baseTaskVersion: 1,
      caseLease: entityLease('internal-case:case-b'),
      taskLease: entityLease('task:task-b'), casePayload: internalCase,
    }),
    () => commands.convertInternalCaseToTask({
      caseId: 'case-a', baseCaseVersion: 1, taskId: 'task-c',
      caseLease: entityLease('internal-case:case-a'),
      taskLease: entityLease('task:task-c'),
      taskPayload: { id: 'task-c', expectedDate: null, categories: ['Safety'], ownerUserIds: [actorId] },
    }),
    () => commands.updateUser({
      userId: '33333333-3333-4333-8333-333333333333',
      baseMembershipVersion: 1,
      lease: entityLease('user:33333333-3333-4333-8333-333333333333'),
      user: { department: 'Operations', name: 'Operator', username: 'operator', role: 'operator', isActive: true },
    }),
    () => commands.updateSettingsValues({
      section: 'departments', baseVersion: 1,
      lease: entityLease('settings:departments'), values: ['Operations'],
    }),
    () => commands.updateRolePermissions({
      baseVersion: 1, lease: entityLease('settings:role-permissions'),
      matrix: { operator: { createTasks: true } },
    }),
    () => commands.updateSiteGate({
      baseVersion: 1, lease: entityLease('settings:site-gate'),
      password: 'not-persisted-secret',
    }),
    () => commands.markNotificationsRead(actorId, [{ notificationId: 'notice-a', baseVersion: 1 }]),
    () => commands.saveReport({
      reportId: 'report-a', content: { title: 'Morning report', vesselIds: ['v1'], taskCount: 1 },
    }),
    () => commands.batchUpdateVessels([{
      vesselId: 'v1', baseVersion: 1, leaseKey: 'vessel:v1',
      ownerSession: lease.ownerSession, fencingToken: lease.fencingToken,
      patch: { weeklyAttention: ['survey'] },
    }]),
    () => commands.batchTaskTransition('close', [{
      taskId: 'task-a', baseVersion: 1, leaseKey: 'task:task-a',
      ownerSession: lease.ownerSession, fencingToken: lease.fencingToken,
    }]),
  ];

  for (const mutate of mutationCalls) {
    const before = client.calls.length;
    await mutate();
    const calls = client.calls.slice(before);
    assert.equal(calls.length, 2, 'every aggregate mutation must have reservation + command only');
    assert.equal(calls[0].name, 'reserve_ship_dynamics_operation');
    assert.match(calls[1].name, /^command_ship_dynamics_/);
    assert.equal(
      calls[0].args.p_command,
      calls[1].name.slice('command_ship_dynamics_'.length),
      'reservation command must exactly match the command RPC',
    );
    assert.equal(calls[0].args.p_workspace_id, workspaceId);
    assert.equal(calls[0].args.p_operation_id, calls[1].args.p_operation_id);
    assert.equal(typeof calls[0].args.p_target_key, 'string');
    assert.equal(typeof calls[0].args.p_request, 'object');
    assert.ok(
      storage.values.size === 0
      || [...storage.values.values()].every(value => !value.includes('not-persisted-secret')),
      'credential material must not enter durable operation metadata',
    );
  }

  const rejectedClient = new MockClient();
  rejectedClient.reservationResult = {
    status: 'rejected',
    replayed: true,
    errorCode: 'permission-denied',
  };
  const rejectedRepository = new NormalizedRepository(rejectedClient, scope, {
    durableState: new NormalizedDurableStateStore(new MemoryStorage()),
  });
  await assert.rejects(
    () => new NormalizedCommandClient(rejectedRepository).saveReport({
      reportId: 'report-rejected', content: { title: 'Must not write' },
    }),
    NormalizedCommandError,
  );
  assert.deepEqual(
    rejectedClient.calls.map(call => call.name),
    ['reserve_ship_dynamics_operation'],
    'rejected preflight must produce zero entity writes',
  );

  const ambiguousClient = new MockClient();
  ambiguousClient.commandError = { message: 'network response lost' };
  ambiguousClient.recoveredResult = {
    status: 'committed',
    command: 'save_report',
    target: 'report:ambiguous',
    result: { status: 'committed', reportId: 'ambiguous', replayed: true },
    errorCode: null,
    completedAt: '2026-07-26T00:00:00Z',
  };
  const ambiguousRepository = new NormalizedRepository(ambiguousClient, scope, {
    durableState: new NormalizedDurableStateStore(new MemoryStorage()),
  });
  const ambiguous = await new NormalizedCommandClient(ambiguousRepository).saveReport({
    reportId: 'ambiguous', content: { title: 'Recovered' },
  });
  assert.equal(ambiguous.replayed, true);
  assert.deepEqual(
    ambiguousClient.calls.map(call => call.name),
    [
      'reserve_ship_dynamics_operation',
      'command_ship_dynamics_save_report',
      'get_ship_dynamics_operation_status',
    ],
    'an ambiguous response must replay exact operation status before surfacing an error',
  );

  const offlineDrafts = [];
  let leaseClaims = 0;
  let taskWrites = 0;
  const versionMap = new Map([['task:task-offline', 4]]);
  const offlineRuntime = {
    projection: {
      data: { tasks: [], vessels: [] },
      versions: {
        get: key => versionMap.get(key),
        has: key => versionMap.has(key),
      },
    },
    saveDraft: (entityKey, draft, baseVersions) =>
      offlineDrafts.push({ entityKey, draft, baseVersions }),
    commands: {
      claimLease: async () => { leaseClaims += 1; },
      createOrdinaryTask: async () => { taskWrites += 1; },
      updateOrdinaryTask: async () => { taskWrites += 1; },
    },
  };
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: false },
  });
  try {
    const offlineController = new NormalizedUiController(offlineRuntime);
    const outcome = await offlineController.saveTask({
      id: 'task-offline',
      vesselId: 'v1',
      vesselIds: ['v1'],
      priority: '中',
      isAware: false,
      isAbnormal: false,
      isInternalControl: false,
      sourceType: 'morning',
      category: 'Safety',
      categories: ['Safety'],
      description: 'Offline draft',
      status: '',
      expectedDate: '',
      reportDate: '2026-07-26',
      departments: ['Operations'],
      ownerUserIds: [actorId],
      isClosed: false,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: '2026-07-26T00:00:00Z',
      updatedAt: '2026-07-26T00:00:00Z',
      statusLogs: [],
    }, false);
    assert.equal(outcome, 'drafted');
    assert.equal(offlineDrafts.length, 1);
    assert.deepEqual(offlineDrafts[0].baseVersions, { 'task:task-offline': 4 });
    assert.equal(leaseClaims, 0, 'offline edits cannot claim a lease');
    assert.equal(taskWrites, 0, 'offline edits cannot write an entity');
    assert.doesNotMatch(JSON.stringify(offlineDrafts[0]), /"tasks"|"users"|"settings"/);
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: previousNavigator,
    });
  }

  const ordinaryTask = {
    id: 'task-atomic-save',
    vesselId: 'v1',
    vesselIds: ['v1'],
    priority: '高',
    isAware: false,
    isAbnormal: false,
    isInternalControl: false,
    sourceType: 'morning',
    category: 'Safety',
    categories: ['Safety'],
    description: 'Atomic content update',
    status: '已結案',
    expectedDate: '2026-08-01',
    reportDate: '2026-07-26',
    departments: ['Operations'],
    ownerUserIds: [actorId],
    isClosed: true,
    closedDate: '2026-07-26',
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: '2026-07-26T00:00:00Z',
    updatedAt: '2026-07-26T00:00:00Z',
    statusLogs: [],
  };
  const atomicProjection = {
    data: {
      tasks: [{ ...ordinaryTask, description: 'Persisted before save', status: '待處理', isClosed: false }],
      vessels: [],
      internalControlCases: [],
    },
    versions: new Map([['task:task-atomic-save', 7]]),
  };
  let persistedDescription = 'Persisted before save';
  let legacyUpdateCalls = 0;
  let legacyTransitionCalls = 0;
  let atomicSaveCalls = 0;
  const atomicRuntime = {
    projection: atomicProjection,
    refreshEntities: async () => atomicProjection,
    loadDraft: () => null,
    removeDraft: () => undefined,
    commands: {
      claimLease: async ({ leaseKey }) => ({
        ok: true,
        leaseKey,
        ownerSession: lease.ownerSession,
        fencingToken: lease.fencingToken,
      }),
      releaseLease: async () => true,
      updateOrdinaryTask: async input => {
        legacyUpdateCalls += 1;
        persistedDescription = input.content.description;
      },
      transitionOrdinaryTask: async () => {
        legacyTransitionCalls += 1;
        throw new Error('injected-transition-failure');
      },
      saveOrdinaryTask: async () => {
        atomicSaveCalls += 1;
        throw new Error('injected-atomic-save-failure');
      },
    },
  };
  await assert.rejects(
    () => new NormalizedUiController(atomicRuntime).saveTask(ordinaryTask, false),
    /injected-atomic-save-failure/,
    'an edit plus close must surface one authoritative atomic command failure',
  );
  assert.equal(persistedDescription, 'Persisted before save',
    'a failed edit plus close must not leave content committed');
  assert.equal(atomicSaveCalls, 1, 'the complete user save must use one atomic command');
  assert.equal(legacyUpdateCalls, 0, 'the controller must not pre-commit content in a separate command');
  assert.equal(legacyTransitionCalls, 0, 'the controller must not emulate a transaction with a second command');

  const linkedCase = {
    id: 'case-projection',
    vesselId: 'v1',
    reportDate: '2026-07-26',
    reportSource: '日常',
    description: 'Linked case edited',
    priority: '中',
    category: 'Safety',
    isAware: false,
    status: '追蹤中',
    departments: ['Operations'],
    syncToTask: true,
    linkedTaskId: 'task-projection',
    origin: 'internal-control',
    isClosed: false,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: '2026-07-26T00:00:00Z',
    updatedAt: '2026-07-26T00:00:00Z',
    statusLogs: [],
  };
  const linkedProjection = {
    data: { tasks: [], vessels: [], internalControlCases: [linkedCase] },
    versions: new Map([
      ['internal-case:case-projection', 3],
      ['task:task-projection', 5],
    ]),
  };
  let linkedUpdateInput;
  const linkedRuntime = {
    projection: linkedProjection,
    refreshEntities: async () => linkedProjection,
    loadDraft: () => null,
    removeDraft: () => undefined,
    commands: {
      claimLeaseSet: async requests => requests.map((request, index) => ({
        leaseKey: request.leaseKey,
        ownerSession: lease.ownerSession,
        fencingToken: lease.fencingToken + index,
      })),
      releaseLeaseSet: async () => undefined,
      updateInternalCase: async input => { linkedUpdateInput = input; },
    },
  };
  await new NormalizedUiController(linkedRuntime).updateInternalCase(linkedCase, {
    expectedDate: '2026-09-05',
    categories: ['Safety', 'Fleet'],
    equipmentSubcategory: undefined,
    ownerUserIds: [actorId],
  });
  assert.deepEqual(linkedUpdateInput.taskPayload, {
    id: 'task-projection',
    expectedDate: '2026-09-05',
    categories: ['Safety', 'Fleet'],
    ownerUserIds: [actorId],
  }, 'linked internal-case edits must carry the editable task projection into the cross-aggregate RPC');

  const appSource = await readFile(resolve(root, 'src/NormalizedApp.tsx'), 'utf8');
  const runtimeSource = await readFile(resolve(root, 'src/normalizedRuntime.ts'), 'utf8');
  const projectionSource = await readFile(resolve(root, 'src/normalizedProjection.ts'), 'utf8');
  assert.match(appSource, /if\s*\(activationLocked\)\s*return\s*<ActivationLock/,
    'password activation must block the normal application render tree');
  assert.match(appSource, /activatePersonalPassword/,
    'the activation lock must call the normalized Auth activation contract');
  assert.match(runtimeSource, /StaleNormalizedResponseError/,
    'stale auth/workspace generations must be dropped');
  assert.match(runtimeSource, /refreshEntities\(pending\)/,
    'Realtime processing must refetch invalidated entities');
  assert.doesNotMatch(runtimeSource, /payload\.(?:new|old).*#projection|setProjection\([^)]*payload/s,
    'Realtime row payloads must never become application state');
  assert.match(projectionSource, /vesselAccount[\s\S]*meetings\s*=\s*\[\]/,
    'vessel projections must suppress meeting existence and content');
  assert.match(projectionSource, /internalControlCases\s*=\s*\[\]/,
    'vessel projections must suppress internal-control content');
  assert.doesNotMatch(appSource, /(?:load|save|subscribe)CloudData|fetchCloudData|ship_dynamics_app_state/);
} finally {
  await server.close();
}

console.log('normalized_frontend_contract=PASS');

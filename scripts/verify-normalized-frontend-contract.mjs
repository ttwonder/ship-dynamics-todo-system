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
      caseId: 'case-a', caseLease: entityLease('internal-case-create:v1'),
      casePayload: internalCase,
    }),
    () => commands.convertTaskToInternalCase({
      caseId: 'case-b', taskId: 'task-b', baseTaskVersion: 1,
      caseLease: entityLease('internal-case-create:v1'),
      taskLease: entityLease('task:task-b'), casePayload: internalCase,
    }),
    () => commands.convertInternalCaseToTask({
      caseId: 'case-a', baseCaseVersion: 1, taskId: 'task-c',
      caseLease: entityLease('internal-case:case-a'),
      taskLease: entityLease('task:task-c'),
      taskPayload: { id: 'task-c', expectedDate: null, categories: ['Safety'], ownerUserIds: [actorId] },
    }),
    () => commands.withdrawInternalCaseTaskSync({
      caseId: 'case-a', baseCaseVersion: 2,
      caseLease: entityLease('internal-case:case-a'),
      baseTaskVersion: 1,
      taskLease: entityLease('task:task-derived'),
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
  const withdrawalRpc = client.calls.find(call =>
    call.name === 'command_ship_dynamics_withdraw_internal_case_task_sync');
  assert.ok(withdrawalRpc, 'withdrawal must reach its dedicated RPC');
  assert.equal('p_task_id' in withdrawalRpc.args, false,
    'withdrawal RPC args must not accept an arbitrary task ID');
  const withdrawalReservation = client.calls.find(call =>
    call.name === 'reserve_ship_dynamics_operation'
      && call.args.p_command === 'withdraw_internal_case_task_sync');
  assert.ok(withdrawalReservation);
  assert.equal('taskId' in withdrawalReservation.args.p_request, false,
    'durable withdrawal request must derive task identity from the parent link');

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
  const linkedTask = {
    id: 'task-projection',
    description: 'Derived internal-control task',
    vesselId: 'v1',
    vesselIds: ['v1'],
    status: '追蹤中',
    priority: '中',
    sourceType: 'morning',
    attentionDimension: 'task',
    isInternalControl: true,
    internalControlCaseId: 'case-projection',
    isAbnormal: true,
    isAware: false,
    isClosed: false,
    distributeToVessels: false,
    updatedAt: '2026-07-26T00:00:00Z',
  };
  const linkedProjection = {
    data: { tasks: [linkedTask], vessels: [{ id: 'v1' }], internalControlCases: [linkedCase] },
    versions: new Map([
      ['internal-case:case-projection', 3],
      ['task:task-projection', 5],
    ]),
    allowedEntityKeys: new Set([
      'internal-case:case-projection',
      'task:task-projection',
      'vessel:v1',
    ]),
  };
  let linkedUpdateInput;
  let withdrawalInput;
  let linkedLeaseRequests = [];
  let linkedRefreshes = [];
  let linkedLeaseReleases = 0;
  const linkedRuntime = {
    projection: linkedProjection,
    refreshEntities: async keys => { linkedRefreshes.push([...keys]); return linkedProjection; },
    loadDraft: () => null,
    removeDraft: () => undefined,
    commands: {
      claimLeaseSet: async requests => {
        linkedLeaseRequests = structuredClone(requests);
        return requests.map((request, index) => ({
          leaseKey: request.leaseKey,
          ownerSession: lease.ownerSession,
          fencingToken: lease.fencingToken + index,
        }));
      },
      releaseLeaseSet: async () => { linkedLeaseReleases += 1; },
      updateInternalCase: async input => { linkedUpdateInput = input; },
      withdrawInternalCaseTaskSync: async input => { withdrawalInput = input; },
    },
  };
  await new NormalizedUiController(linkedRuntime).updateInternalCase(linkedCase, {
    expectedDate: '2026-09-05',
    categories: ['Safety', 'Fleet'],
    equipmentSubcategory: undefined,
    ownerUserIds: [actorId],
    isAbnormal: false,
  });
  assert.deepEqual(linkedUpdateInput.taskPayload, {
    id: 'task-projection',
    expectedDate: '2026-09-05',
    categories: ['Safety', 'Fleet'],
    ownerUserIds: [actorId],
    isAbnormal: false,
  }, 'linked internal-case edits must carry the editable task projection into the cross-aggregate RPC');

  linkedUpdateInput = undefined;
  await new NormalizedUiController(linkedRuntime).saveTask({
    ...linkedTask,
    category: 'Safety',
    categories: ['Safety', 'Fleet'],
    expectedDate: '2026-09-05',
    reportDate: '2026-07-26',
    departments: ['Operations'],
    ownerUserIds: [actorId],
    isAbnormal: false,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: '2026-07-26T00:00:00Z',
    statusLogs: [],
  }, false);
  assert.equal(linkedUpdateInput.taskPayload.isAbnormal, false,
    'unchecking abnormal in the task editor must reach the authoritative internal-case RPC as false');

  linkedRefreshes = [];
  linkedLeaseRequests = [];
  linkedLeaseReleases = 0;
  await new NormalizedUiController(linkedRuntime).withdrawInternalCaseTaskSync(
    linkedCase,
    linkedTask.updatedAt,
  );
  assert.deepEqual(linkedRefreshes, [
    ['internal-case:case-projection'],
    ['internal-case:case-projection', 'task:task-projection'],
    ['internal-case:case-projection', 'task:task-projection'],
  ], 'withdrawal must derive the child after parent refresh and refresh both aggregates after commit');
  assert.deepEqual(linkedLeaseRequests, [
    { leaseKey: 'internal-case:case-projection', entityType: 'internal-case', entityId: 'case-projection' },
    { leaseKey: 'task:task-projection', entityType: 'internal-task', entityId: 'task-projection' },
  ]);
  assert.deepEqual(withdrawalInput, {
    caseId: 'case-projection',
    baseCaseVersion: 3,
    caseLease: {
      leaseKey: 'internal-case:case-projection',
      ownerSession: lease.ownerSession,
      fencingToken: lease.fencingToken,
    },
    baseTaskVersion: 5,
    taskLease: {
      leaseKey: 'task:task-projection',
      ownerSession: lease.ownerSession,
      fencingToken: lease.fencingToken + 1,
    },
  });
  assert.equal('taskId' in withdrawalInput, false,
    'controller must not convert its derived child into an arbitrary task-id command argument');
  assert.equal(linkedLeaseReleases, 1);

  linkedLeaseRequests = [];
  const originalLinkedTaskUpdatedAt = linkedTask.updatedAt;
  linkedTask.updatedAt = '2026-07-26T00:00:01Z';
  await assert.rejects(
    () => new NormalizedUiController(linkedRuntime).withdrawInternalCaseTaskSync(
      linkedCase,
      originalLinkedTaskUpdatedAt,
    ),
    /較新版本|重新開啟/,
  );
  assert.deepEqual(linkedLeaseRequests, [], 'stale child version must fail before claiming either lease');
  linkedTask.updatedAt = originalLinkedTaskUpdatedAt;

  linkedLeaseRequests = [];
  linkedTask.attentionDimension = 'meeting';
  await assert.rejects(
    () => new NormalizedUiController(linkedRuntime).withdrawInternalCaseTaskSync(
      linkedCase,
      linkedTask.updatedAt,
    ),
    /唯一雙向關聯|重新開啟/,
  );
  assert.deepEqual(linkedLeaseRequests, [], 'meeting-derived source must fail before claiming either lease');
  linkedTask.attentionDimension = 'task';

  const previousNavigatorForWithdrawal = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: false },
  });
  linkedRefreshes = [];
  linkedLeaseRequests = [];
  try {
    await assert.rejects(
      () => new NormalizedUiController(linkedRuntime).withdrawInternalCaseTaskSync(
        linkedCase,
        linkedTask.updatedAt,
      ),
      /離線時不能撤回同步要事/,
    );
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: previousNavigatorForWithdrawal,
    });
  }
  assert.deepEqual(linkedRefreshes, []);
  assert.deepEqual(linkedLeaseRequests, [], 'offline withdrawal must not queue a destructive draft or claim leases');

  const materializingCase = {
    ...linkedCase,
    id: 'case-materialize',
    description: 'Materialize atomically',
    linkedTaskId: undefined,
    syncToTask: true,
  };
  const materializingProjection = {
    data: {
      tasks: [],
      vessels: [{ id: 'v1' }],
      internalControlCases: [{ ...materializingCase, syncToTask: false }],
    },
    versions: new Map([['internal-case:case-materialize', 4]]),
    allowedEntityKeys: new Set(['internal-case:case-materialize', 'vessel:v1']),
  };
  let persistedMaterializingDescription = 'Persisted before materialization';
  let atomicMaterializationCalls = 0;
  let legacyConversionCalls = 0;
  const materializingRuntime = {
    projection: materializingProjection,
    refreshEntities: async () => materializingProjection,
    loadDraft: () => null,
    removeDraft: () => undefined,
    commands: {
      claimLeaseSet: async requests => requests.map((request, index) => ({
        leaseKey: request.leaseKey,
        ownerSession: lease.ownerSession,
        fencingToken: lease.fencingToken + index,
      })),
      releaseLeaseSet: async () => undefined,
      updateInternalCase: async input => {
        if (input.linkAction === 'materialize' && input.taskPayload) {
          atomicMaterializationCalls += 1;
          throw new Error('injected-atomic-materialization-failure');
        }
        persistedMaterializingDescription = input.casePayload.description;
      },
      convertInternalCaseToTask: async () => {
        legacyConversionCalls += 1;
        throw new Error('injected-legacy-conversion-failure');
      },
    },
  };
  await assert.rejects(
    () => new NormalizedUiController(materializingRuntime).updateInternalCase(materializingCase, {
      expectedDate: '2026-09-15',
      categories: ['Safety'],
      equipmentSubcategory: undefined,
      ownerUserIds: [actorId],
    }),
    /injected-(?:atomic-materialization|legacy-conversion)-failure/,
  );
  assert.equal(
    persistedMaterializingDescription,
    'Persisted before materialization',
    'a failed task materialization must not leave the case update committed',
  );
  assert.equal(atomicMaterializationCalls, 1,
    'case update plus task materialization must use one atomic command');
  assert.equal(legacyConversionCalls, 0,
    'the controller must not materialize a linked task through a second RPC');

  // Offline materialization persists the complete case+task action and recovers
  // through the same atomic update while refreshing both old and new vessel scopes.
  {
    const offlineOperationId = '55555555-5555-4555-8555-555555555555';
    const offlineCandidate = {
      ...materializingCase,
      id: 'case-offline-materialize',
      vesselId: 'v2',
      description: 'Offline materialization exact intent',
    };
    const persistedCase = {
      ...offlineCandidate,
      vesselId: 'v1',
      syncToTask: false,
      linkedTaskId: undefined,
    };
    const offlineProjection = {
      data: {
        tasks: [],
        vessels: [{ id: 'v1' }, { id: 'v2' }],
        internalControlCases: [persistedCase],
      },
      versions: new Map([['internal-case:case-offline-materialize', 9]]),
      allowedEntityKeys: new Set([
        'internal-case:case-offline-materialize',
        'vessel:v1',
        'vessel:v2',
      ]),
    };
    const taskProjection = {
      expectedDate: '2026-10-05',
      categories: ['Safety', 'Fleet'],
      equipmentSubcategory: undefined,
      ownerUserIds: [actorId],
    };
    const saved = [];
    const previousNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: false },
    });
    try {
      const offlineRuntime = {
        projection: offlineProjection,
        saveDraft: (entityKey, draft, baseVersions) =>
          saved.push({ entityKey, draft, baseVersions }),
        commands: { createOperationId: () => offlineOperationId },
      };
      const outcome = await new NormalizedUiController(offlineRuntime)
        .updateInternalCase(offlineCandidate, taskProjection);
      assert.equal(outcome, 'drafted');
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: previousNavigator,
      });
    }

    assert.equal(saved.length, 1);
    const [offline] = saved;
    assert.equal(offline.entityKey, 'internal-case:case-offline-materialize');
    assert.equal(offline.draft.operationId, offlineOperationId);
    assert.equal(offline.draft.linkAction, 'materialize');
    assert.equal(offline.draft.oldVesselId, 'v1');
    assert.equal(typeof offline.draft.taskId, 'string');
    assert.ok(offline.draft.taskId);
    assert.deepEqual(offline.draft.taskPayload, {
      id: offline.draft.taskId,
      expectedDate: taskProjection.expectedDate,
      categories: taskProjection.categories,
      ownerUserIds: taskProjection.ownerUserIds,
    }, 'the offline action must preserve the exact linked-task projection');
    assert.deepEqual(offline.baseVersions, {
      'internal-case:case-offline-materialize': 9,
    });

    const refreshes = [];
    const updates = [];
    let conversionCalls = 0;
    const cleared = [];
    const envelope = {
      version: 1,
      workspaceId,
      actorId,
      entityKey: offline.entityKey,
      draft: offline.draft,
      baseVersions: offline.baseVersions,
      updatedAt: '2026-07-26T00:00:00Z',
    };
    const cachedAbsentProjection = {
      ...offlineProjection,
      data: { ...offlineProjection.data, internalControlCases: [] },
      versions: new Map(),
      allowedEntityKeys: new Set(['vessel:v1', 'vessel:v2']),
    };
    const recoveryRuntime = {
      projection: cachedAbsentProjection,
      refreshEntities: async keys => {
        refreshes.push([...keys]);
        if (keys.length === 1 && keys[0] === offline.entityKey) {
          recoveryRuntime.projection = offlineProjection;
        }
        return recoveryRuntime.projection;
      },
      loadDraft: key => key === envelope.entityKey ? envelope : null,
      removeDraft: key => { cleared.push(key); },
      commands: {
        createOperationId: () => { throw new Error('recovery must reuse the original operation'); },
        claimLeaseSet: async requests => requests.map((request, index) => ({
          leaseKey: request.leaseKey,
          ownerSession: lease.ownerSession,
          fencingToken: lease.fencingToken + index,
        })),
        releaseLeaseSet: async () => true,
        updateInternalCase: async input => { updates.push(structuredClone(input)); },
        convertInternalCaseToTask: async () => { conversionCalls += 1; },
      },
    };
    await new NormalizedUiController(recoveryRuntime).recoverDraft(envelope);
    assert.deepEqual(refreshes[0], [offline.entityKey],
      'recovery must refetch an initially absent case before consulting cached projection');
    assert.equal(updates.length, 1,
      'offline case+task intent must recover through one atomic update RPC');
    assert.equal(conversionCalls, 0,
      'offline materialization must not recover as a second conversion RPC');
    assert.equal(updates[0].operationId, offlineOperationId);
    assert.equal(updates[0].linkAction, 'materialize');
    assert.equal(updates[0].taskLease.leaseKey, 'task-create:v2');
    assert.deepEqual(updates[0].taskPayload, offline.draft.taskPayload);
    assert.ok(refreshes.some(keys =>
      keys.includes('vessel:v1') && keys.includes('vessel:v2')),
    'recovery must refresh current authorization for old and new vessel scopes');
    assert.ok(
      refreshes.at(-1).includes(`task:${offline.draft.taskId}`),
      'a committed materialization must refresh the fixed new task into the projection',
    );
    assert.deepEqual(cleared, [offline.entityKey]);

    const changedProjection = {
      ...offlineProjection,
      data: {
        ...offlineProjection.data,
        vessels: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
        internalControlCases: [{ ...persistedCase, vesselId: 'v3' }],
      },
      allowedEntityKeys: new Set([
        offline.entityKey,
        'vessel:v1',
        'vessel:v2',
        'vessel:v3',
      ]),
    };
    const mismatchRefreshes = [];
    let mismatchLeaseClaims = 0;
    let mismatchRpcCalls = 0;
    let mismatchDraftClears = 0;
    const mismatchRuntime = {
      projection: offlineProjection,
      refreshEntities: async keys => {
        mismatchRefreshes.push([...keys]);
        if (keys.length === 1 && keys[0] === offline.entityKey) {
          mismatchRuntime.projection = changedProjection;
        }
        return mismatchRuntime.projection;
      },
      loadDraft: key => key === envelope.entityKey ? envelope : null,
      removeDraft: () => { mismatchDraftClears += 1; },
      commands: {
        claimLeaseSet: async () => {
          mismatchLeaseClaims += 1;
          return [];
        },
        releaseLeaseSet: async () => true,
        updateInternalCase: async () => { mismatchRpcCalls += 1; },
      },
    };
    await assert.rejects(
      () => new NormalizedUiController(mismatchRuntime).recoverDraft(envelope),
      error => error instanceof NormalizedCommandError
        && error.code === 'offline-internal-case-old-vessel-mismatch',
      'recovery must fail closed when the current case moved away from the durable old vessel',
    );
    assert.deepEqual(mismatchRefreshes[0], [offline.entityKey],
      'recovery must refresh the current internal case before trusting its vessel identity');
    assert.equal(mismatchLeaseClaims, 0,
      'an old-vessel mismatch must fail before any lease claim');
    assert.equal(mismatchRpcCalls, 0,
      'an old-vessel mismatch must fail before the atomic RPC');
    assert.equal(mismatchDraftClears, 0,
      'an old-vessel mismatch must preserve the offline draft');

    const pendingEnvelope = {
      ...envelope,
      pendingOperation: {
        operationId: offlineOperationId,
        command: 'update_internal_case',
        targetKey: offline.entityKey,
        dispatchedAt: '2026-07-26T00:00:01Z',
      },
    };
    const malformedPendingEnvelopes = [
      { ...pendingEnvelope, unexpectedEnvelopeField: true },
      { ...pendingEnvelope, draft: { ...pendingEnvelope.draft, unexpectedDraftField: true } },
      { ...pendingEnvelope, draft: { ...pendingEnvelope.draft, operationId: 'not-a-uuid' } },
      {
        ...pendingEnvelope,
        draft: {
          ...pendingEnvelope.draft,
          candidate: { ...pendingEnvelope.draft.candidate, id: 'case:malformed' },
        },
        entityKey: 'internal-case:case:malformed',
        pendingOperation: {
          ...pendingEnvelope.pendingOperation,
          targetKey: 'internal-case:case:malformed',
        },
      },
      { ...pendingEnvelope, draft: { ...pendingEnvelope.draft, taskId: 'task-other' } },
      {
        ...pendingEnvelope,
        pendingOperation: {
          ...pendingEnvelope.pendingOperation,
          operationId: '66666666-6666-4666-8666-666666666666',
        },
      },
      {
        ...pendingEnvelope,
        pendingOperation: { ...pendingEnvelope.pendingOperation, command: 'save_report' },
      },
      {
        ...pendingEnvelope,
        pendingOperation: {
          ...pendingEnvelope.pendingOperation,
          targetKey: 'internal-case:case-other',
        },
      },
      {
        ...pendingEnvelope,
        pendingOperation: { ...pendingEnvelope.pendingOperation, unexpectedPendingField: true },
      },
    ];
    for (const malformedEnvelope of malformedPendingEnvelopes) {
      let malformedRecoveryCalls = 0;
      let malformedRefreshCalls = 0;
      let malformedDraftClears = 0;
      const malformedRuntime = {
        projection: offlineProjection,
        recoverPendingOperation: async () => {
          malformedRecoveryCalls += 1;
          return {
            status: 'committed',
            command: 'update_internal_case',
            targetKey: malformedEnvelope.entityKey,
            result: {},
            errorCode: null,
            completedAt: '2026-07-26T00:00:02Z',
          };
        },
        refreshEntities: async () => {
          malformedRefreshCalls += 1;
          return offlineProjection;
        },
        loadDraft: key => key === malformedEnvelope.entityKey ? malformedEnvelope : null,
        removeDraft: () => { malformedDraftClears += 1; },
      };
      await assert.rejects(
        () => new NormalizedUiController(malformedRuntime).recoverDraft(malformedEnvelope),
        error => error instanceof NormalizedCommandError
          && error.code === 'offline-internal-case-update-invalid',
        'malformed internal-case recovery data must fail closed locally',
      );
      assert.equal(malformedRecoveryCalls, 0,
        'malformed internal-case recovery data must fail before status/replay RPC');
      assert.equal(malformedRefreshCalls, 0,
        'malformed internal-case recovery data must fail before authorization refresh RPC');
      assert.equal(malformedDraftClears, 0,
        'malformed internal-case recovery data must remain durable');
    }

    const committedPendingRefreshes = [];
    const committedPendingClears = [];
    const committedPendingRuntime = {
      projection: offlineProjection,
      recoverPendingOperation: async () => ({
        status: 'committed',
        command: 'update_internal_case',
        targetKey: offline.entityKey,
        result: {},
        errorCode: null,
        completedAt: '2026-07-26T00:00:02Z',
      }),
      refreshEntities: async keys => {
        committedPendingRefreshes.push([...keys]);
        return offlineProjection;
      },
      loadDraft: key => key === envelope.entityKey ? pendingEnvelope : null,
      removeDraft: key => { committedPendingClears.push(key); },
    };
    await new NormalizedUiController(committedPendingRuntime).recoverDraft(pendingEnvelope);
    assert.ok(
      committedPendingRefreshes.at(-1).includes(offline.entityKey)
        && committedPendingRefreshes.at(-1).includes('vessel:v1')
        && committedPendingRefreshes.at(-1).includes('vessel:v2')
        && committedPendingRefreshes.at(-1).includes(`task:${offline.draft.taskId}`),
      'an already-committed pending materialization must refresh the complete fixed intent',
    );
    assert.deepEqual(committedPendingClears, [offline.entityKey]);

    let preparedReplayDispatches = 0;
    let preparedDraftClears = 0;
    const preparedMismatchRuntime = {
      projection: offlineProjection,
      refreshEntities: async keys => {
        if (keys.length === 1 && keys[0] === offline.entityKey) {
          preparedMismatchRuntime.projection = changedProjection;
        }
        return preparedMismatchRuntime.projection;
      },
      recoverPendingOperation: async (_key, options) => {
        await options.beforeReplay();
        preparedReplayDispatches += 1;
        return {
          status: 'committed',
          command: 'update_internal_case',
          targetKey: offline.entityKey,
          result: {},
          errorCode: null,
          completedAt: '2026-07-26T00:00:03Z',
        };
      },
      loadDraft: key => key === envelope.entityKey ? pendingEnvelope : null,
      removeDraft: () => { preparedDraftClears += 1; },
    };
    await assert.rejects(
      () => new NormalizedUiController(preparedMismatchRuntime).recoverDraft(pendingEnvelope),
      error => error instanceof NormalizedCommandError
        && error.code === 'offline-internal-case-old-vessel-mismatch',
      'prepared replay must revalidate the live old vessel immediately before leases/RPC',
    );
    assert.equal(preparedReplayDispatches, 0,
      'prepared replay must stop before repository lease reclamation and RPC dispatch');
    assert.equal(preparedDraftClears, 0,
      'prepared replay preflight failure must preserve the offline draft');
  }

  const appSource = await readFile(resolve(root, 'src/NormalizedApp.tsx'), 'utf8');
  const managementSource = await readFile(resolve(root, 'src/NormalizedManagement.tsx'), 'utf8');
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
  assert.match(appSource, /listManageUserRecoveries\(\)/,
    'authorized recoveries must be discovered after a fresh application start');
  assert.match(appSource, /onResumeUserRecovery=\{[^}]*resumeManageUserRecovery/s,
    'the recovery surface must invoke the exact durable manage-user resume contract');
  assert.match(managementSource, /requiresPassword[\s\S]*prompt\(/,
    'credential recovery must explicitly ask for password re-entry');
  assert.match(managementSource, /不能取消|不可取消/,
    'the recovery surface must explain that recovery-required effects cannot be cancelled');
  assert.doesNotMatch(managementSource, /userRecoveries[\s\S]{0,500}operationId/,
    'the UI must not expose durable operation identifiers');
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

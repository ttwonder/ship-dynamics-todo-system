import assert from 'node:assert/strict';
import { createServer } from 'vite';

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const ownerSession = '33333333-3333-4333-8333-333333333333';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key) { return this.values.get(key) ?? null; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  removeItem(key) { this.values.delete(key); }
  setItem(key, value) { this.values.set(key, String(value)); }
  serialized() { return [...this.values.values()].join('\n'); }
}

class MockClient {
  calls = [];
  status = {
    status: 'prepared',
    command: 'update_vessel_manual_attention',
    target: 'vessel:v1',
    result: null,
    errorCode: null,
    completedAt: null,
  };
  commandError = null;
  commandResult = {
    status: 'committed',
    replayed: false,
    entityId: 'v1',
    version: 2,
  };
  lease = {
    ok: true,
    leaseKey: 'vessel:v1',
    ownerSession,
    fencingToken: 7,
    expiresAt: '2026-07-26T01:00:00Z',
  };

  async rpc(name, args) {
    this.calls.push({ name, args: structuredClone(args) });
    if (name === 'reserve_ship_dynamics_operation') {
      return { data: { status: 'prepared', replayed: this.calls.length > 1 }, error: null };
    }
    if (name === 'get_ship_dynamics_operation_status') {
      return { data: structuredClone(this.status), error: null };
    }
    if (name === 'reject_ship_dynamics_operation_reservation') {
      this.status = {
        ...this.status,
        status: 'rejected',
        errorCode: args.p_error_code,
        completedAt: '2026-07-26T00:10:00Z',
      };
      return {
        data: { status: 'rejected', replayed: false, errorCode: args.p_error_code },
        error: null,
      };
    }
    if (name === 'reject_ship_dynamics_user_operation') {
      this.status = {
        ...this.status,
        status: 'rejected',
        errorCode: args.p_error_code,
        completedAt: '2026-07-26T00:10:00Z',
      };
      return { data: true, error: null };
    }
    if (name === 'claim_ship_dynamics_entity_lease') {
      return {
        data: {
          ...structuredClone(this.lease),
          leaseKey: args.p_lease_key,
          ownerSession: args.p_owner_session,
        },
        error: null,
      };
    }
    if (name === 'release_ship_dynamics_entity_lease') {
      return { data: true, error: null };
    }
    if (name.startsWith('command_ship_dynamics_')) {
      if (this.commandError) return { data: null, error: this.commandError };
      this.status = {
        status: 'committed',
        command: name.slice('command_ship_dynamics_'.length),
        target: this.status.target,
        result: structuredClone(this.commandResult),
        errorCode: null,
        completedAt: '2026-07-26T00:05:00Z',
      };
      return { data: structuredClone(this.commandResult), error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  }

  from() { throw new Error('unexpected table query'); }
  channel() { throw new Error('unexpected realtime subscription'); }
  removeChannel() { return Promise.resolve('ok'); }
}

class ManageUserClient extends MockClient {
  constructor() {
    super();
    this.session = {
      access_token: 'owner-access-token',
      refresh_token: 'owner-refresh-token',
      user: { id: actorId },
    };
    this.status = null;
    this.invocations = [];
    this.auth = {
      getSession: async () => ({ data: { session: this.session }, error: null }),
      getUser: async () => ({ data: { user: this.session.user }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      updateUser: async () => ({ data: {}, error: null }),
      signInWithPassword: async () => ({
        data: { session: this.session, user: this.session.user },
        error: null,
      }),
    };
    this.functions = {
      invoke: async (name, options) => {
        this.invocations.push({ name, body: structuredClone(options.body) });
        this.status = {
          status: 'committed',
          command: `manage_user:${options.body.action}`,
          target: `user:${options.body.targetUserId}`,
          result: { userId: options.body.targetUserId, disabled: true },
          errorCode: null,
          completedAt: '2026-07-26T00:20:00Z',
        };
        return { data: structuredClone(this.status.result), error: null };
      },
    };
  }
}

const ownerProjection = {
  data: {
    users: [{
      id: 'target-user', name: 'Target', username: 'target', department: 'Operations',
      role: 'operator', isActive: true, managedVesselIds: [], createdAt: '', updatedAt: '',
    }],
    vessels: [], tasks: [], meetings: [], internalControlCases: [],
    notifications: [], agendaReports: [], auditLogs: [],
    settings: { rolePermissions: { owner: { manageUsers: true } } },
  },
  versions: new Map(),
  actor: { id: actorId, role: 'owner', name: 'Owner', department: 'Operations' },
  workspaceId,
  vesselAccount: false,
  allowedEntityKeys: new Set(),
};

async function createManageUserRuntime(NormalizedApplicationRuntime, storage, client) {
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    const runtime = new NormalizedApplicationRuntime({
      supabaseUrl: 'https://example.invalid',
      supabaseAnonKey: 'browser-anon-key',
      workspaceKey: 'workspace-legacy-key',
    }, client);
    runtime.repository.resolveWorkspaceByLegacyKey = async () => {
      runtime.scope.setWorkspace(workspaceId);
      return { id: workspaceId, legacy_key: 'workspace-legacy-key', name: 'Workspace', is_active: true };
    };
    runtime.auth.passwordActivationRequired = async () => false;
    runtime.projectionReader.fetchApplicationProjection = async () => ownerProjection;
    runtime.projectionReader.refetchInvalidatedProjection = async () => ownerProjection;
    runtime.commands.createOperationId = () => operationId;
    await runtime.initialize();
    return runtime;
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    });
  }
}

function createScope(NormalizedRequestScope) {
  const scope = new NormalizedRequestScope(workspaceId);
  scope.acceptSession({ user: { id: actorId } });
  return scope;
}

function safeCommand(repository) {
  return repository.executeCommand({
    rpc: 'command_ship_dynamics_update_vessel_manual_attention',
    command: 'update_vessel_manual_attention',
    operationId,
    entityKey: 'vessel:v1',
    targetKey: 'vessel:v1',
    request: {
      vesselId: 'v1',
      baseVersion: 1,
      leaseKey: 'vessel:v1',
      ownerSession,
      fencingToken: 7,
      manualAttentionLevel: '高',
    },
    args: {
      p_vessel_id: 'v1',
      p_base_version: 1,
      p_lease_key: 'vessel:v1',
      p_owner_session: ownerSession,
      p_fencing_token: 7,
      p_manual_attention_level: '高',
    },
  });
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const repositoryModule = await server.ssrLoadModule('/src/normalizedRepository.ts');
  const scopeModule = await server.ssrLoadModule('/src/normalizedSupabaseClient.ts');
  const commandModule = await server.ssrLoadModule('/src/normalizedCommands.ts');
  const controllerModule = await server.ssrLoadModule('/src/normalizedUiController.ts');
  const runtimeModule = await server.ssrLoadModule('/src/normalizedRuntime.ts');
  const {
    NormalizedUiController,
    reconcileNormalizedDraftEnvelopes,
  } = controllerModule;
  const { NormalizedCommandClient, batchTargetKey } = commandModule;
  const {
    NormalizedCommandError,
    NormalizedDurableStateStore,
    NormalizedRepository,
  } = repositoryModule;
  const { NormalizedRequestScope } = scopeModule;
  const { NormalizedApplicationRuntime } = runtimeModule;

  // Durable manage-user recovery metadata is a closed schema: credentials cannot
  // be smuggled beside the sanitized input object.
  {
    const store = new NormalizedDurableStateStore(new MemoryStorage());
    assert.throws(() => store.markPendingOperation({
      workspaceId,
      actorId,
      entityKey: 'user:target-user',
      operationId,
      command: 'manage_user:reset-password',
      targetKey: 'user:target-user',
      manageUserResume: {
        version: 1,
        action: 'reset-password',
        input: { action: 'reset-password', targetUserId: 'target-user' },
        requiresPassword: true,
        password: ['must', 'never', 'persist'].join('-'),
      },
    }), /metadata fields are invalid/i);
  }

  // Safe payload
  // the exact lease identity, and replay the exact operation ID and request.
  {
    const storage = new MemoryStorage();
    const firstClient = new MockClient();
    firstClient.commandError = { message: 'network response lost' };
    const firstRepository = new NormalizedRepository(
      firstClient,
      createScope(NormalizedRequestScope),
      { durableState: new NormalizedDurableStateStore(storage) },
    );
    await assert.rejects(() => safeCommand(firstRepository), error => (
      error instanceof NormalizedCommandError && error.kind === 'recovery'
    ));
    const pending = firstRepository.loadLocalState('vessel:v1')?.pendingOperation;
    assert.equal(pending?.replay?.rpc, 'command_ship_dynamics_update_vessel_manual_attention');
    assert.equal(pending?.replay?.request.manualAttentionLevel, '高');
    assert.equal(pending?.replay?.args.p_fencing_token, 7);

    const secondClient = new MockClient();
    let refetches = 0;
    const secondRepository = new NormalizedRepository(
      secondClient,
      createScope(NormalizedRequestScope),
      { durableState: new NormalizedDurableStateStore(storage) },
    );
    const recovered = await secondRepository.recoverPendingOperation('vessel:v1', {
      beforeReplay: async () => { refetches += 1; },
    });
    assert.equal(refetches, 1, 'fresh-process replay must refetch current authorized state first');
    assert.equal(recovered?.status, 'committed');
    assert.equal(recovered?.result.version, 2);
    assert.equal(secondRepository.loadLocalState('vessel:v1')?.pendingOperation, undefined);
    assert.ok(secondClient.calls.some(call => (
      call.name === 'claim_ship_dynamics_entity_lease'
      && call.args.p_owner_session === ownerSession
    )), 'fresh-process replay must reacquire the exact stored lease identity');
    const replayCall = secondClient.calls.find(call => (
      call.name === 'command_ship_dynamics_update_vessel_manual_attention'
    ));
    assert.equal(replayCall?.args.p_operation_id, operationId);
    assert.equal(replayCall?.args.p_fencing_token, 7);
  }

  // Internal-case writes, including the submitted batch, are transaction-only
  // commands and must retain a secret-free exact replay envelope after a lost response.
  {
    const internalCommands = [
      'create_internal_case',
      'update_internal_case',
      'delete_internal_case',
      'link_internal_case_task',
      'unlink_internal_case_task',
      'cancel_internal_case',
      'reopen_internal_case',
      'delete_task_preserving_internal_case',
      'create_internal_case_from_task',
      'create_task_from_internal_case',
    ];
    for (const [index, command] of internalCommands.entries()) {
      const storage = new MemoryStorage();
      const client = new MockClient();
      const entityKey = `internal-case:replay-${index}`;
      const commandOperationId = `internal-operation-${index}`;
      client.status = {
        status: 'prepared', command, target: entityKey,
        result: null, errorCode: null, completedAt: null,
      };
      client.commandError = { message: 'Failed to fetch' };
      const repository = new NormalizedRepository(client, createScope(NormalizedRequestScope), {
        durableState: new NormalizedDurableStateStore(storage),
      });
      await assert.rejects(() => repository.executeCommand({
        rpc: `command_ship_dynamics_${command}`,
        command,
        operationId: commandOperationId,
        entityKey,
        request: {
          caseLeaseKey: entityKey,
          caseOwnerSession: ownerSession,
          caseFencingToken: 7,
        },
        args: {
          p_case_lease_key: entityKey,
          p_case_owner_session: ownerSession,
          p_case_fencing_token: 7,
        },
      }), error => error instanceof NormalizedCommandError && error.kind === 'recovery');
      assert.ok(repository.loadLocalState(entityKey)?.pendingOperation?.replay,
        `${command} must preserve an exact replay envelope`);
      assert.doesNotMatch(storage.serialized(), /password|secret|access_token|refresh_token/i);
    }
  }

  // A prepared batch reclaims every exact lease and dispatches the original
  // ordered p_items once under the original operation and target identities.
  {
    const durableBatchKey = `internal-case-batch:${operationId}`;
    const batchItems = [{
      caseId: 'case-replay-a',
      caseLeaseKey: 'internal-case:case-replay-a',
      caseOwnerSession: ownerSession,
      caseFencingToken: 7,
      case: {
        vesselId: 'v1', reportDate: '2026-07-26', reportSource: 'daily',
        description: 'Replay batch A', priority: 'medium', category: 'Safety',
        equipmentSubcategory: null, isAware: false, status: 'open',
        origin: 'internal-control', isClosed: false, departments: ['Operations'],
      },
      task: {
        id: 'task-replay-a', expectedDate: '2026-08-01',
        categories: ['Safety'], ownerUserIds: [actorId],
      },
      taskLeaseKey: 'task-create:v1',
      taskOwnerSession: ownerSession,
      taskFencingToken: 7,
    }, {
      caseId: 'case-replay-b',
      caseLeaseKey: 'internal-case:case-replay-b',
      caseOwnerSession: ownerSession,
      caseFencingToken: 7,
      case: {
        vesselId: 'v2', reportDate: '2026-07-27', reportSource: 'daily',
        description: 'Replay batch B', priority: 'high', category: 'Fleet',
        equipmentSubcategory: null, isAware: true, status: 'open',
        origin: 'internal-control', isClosed: false, departments: [],
      },
      task: null,
      taskLeaseKey: null,
      taskOwnerSession: null,
      taskFencingToken: null,
    }];
    const targetKey = batchTargetKey('internal-case', batchItems);
    const storage = new MemoryStorage();
    const firstClient = new MockClient();
    firstClient.status = {
      status: 'prepared', command: 'batch_create_internal_cases', target: targetKey,
      result: null, errorCode: null, completedAt: null,
    };
    firstClient.commandError = { message: 'network response lost' };
    const firstRepository = new NormalizedRepository(
      firstClient,
      createScope(NormalizedRequestScope),
      { durableState: new NormalizedDurableStateStore(storage) },
    );
    await assert.rejects(
      () => new NormalizedCommandClient(firstRepository)
        .batchCreateInternalCases(batchItems, operationId, durableBatchKey),
      error => error instanceof NormalizedCommandError && error.kind === 'recovery',
    );
    const pending = firstRepository.loadLocalState(durableBatchKey)?.pendingOperation;
    assert.equal(pending?.command, 'batch_create_internal_cases');
    assert.equal(pending?.targetKey, targetKey);
    assert.deepEqual(pending?.replay?.request, { items: batchItems });
    assert.deepEqual(pending?.replay?.args, { p_items: batchItems });
    assert.deepEqual(
      pending?.replay?.leases.map(item => item.leaseKey).sort(),
      ['internal-case:case-replay-a', 'internal-case:case-replay-b', 'task-create:v1'],
    );

    const secondClient = new MockClient();
    secondClient.status = structuredClone(firstClient.status);
    const secondRepository = new NormalizedRepository(
      secondClient,
      createScope(NormalizedRequestScope),
      { durableState: new NormalizedDurableStateStore(storage) },
    );
    const recovered = await secondRepository.recoverPendingOperation(durableBatchKey, {
      beforeReplay: async () => undefined,
    });
    assert.equal(recovered?.status, 'committed');
    const leaseClaims = secondClient.calls.filter(call =>
      call.name === 'claim_ship_dynamics_entity_lease');
    assert.deepEqual(
      leaseClaims.map(call => call.args.p_lease_key).sort(),
      ['internal-case:case-replay-a', 'internal-case:case-replay-b', 'task-create:v1'],
      'prepared batch replay must reclaim the complete exact lease set',
    );
    assert.equal(leaseClaims.every(call =>
      call.args.p_owner_session === ownerSession), true);
    const replayCalls = secondClient.calls.filter(call =>
      call.name === 'command_ship_dynamics_batch_create_internal_cases');
    assert.equal(replayCalls.length, 1, 'the original batch RPC must replay exactly once');
    assert.equal(replayCalls[0].args.p_operation_id, operationId);
    assert.deepEqual(replayCalls[0].args.p_items, batchItems,
      'prepared batch replay must preserve exact item order and content');
  }

  // Secret-bearing commands retain only non-secret cancellation metadata.
  {
    const storage = new MemoryStorage();
    const client = new MockClient();
    client.status = {
      status: 'prepared', command: 'update_site_gate', target: 'settings:site-gate',
      result: null, errorCode: null, completedAt: null,
    };
    client.commandError = { message: 'network response lost' };
    const repository = new NormalizedRepository(client, createScope(NormalizedRequestScope), {
      durableState: new NormalizedDurableStateStore(storage),
    });
    await assert.rejects(() => repository.executeCommand({
      rpc: 'command_ship_dynamics_update_site_gate',
      command: 'update_site_gate',
      operationId,
      entityKey: 'settings:site-gate',
      request: { baseVersion: 1, leaseKey: 'settings:site-gate', ownerSession, fencingToken: 7 },
      args: {
        p_base_version: 1,
        p_lease_key: 'settings:site-gate',
        p_owner_session: ownerSession,
        p_fencing_token: 7,
        p_password: 'site-secret-must-never-persist',
      },
    }), error => error instanceof NormalizedCommandError && error.kind === 'recovery');
    const serialized = storage.serialized();
    assert.doesNotMatch(serialized, /site-secret-must-never-persist|p_password|authAlias|access_token|refresh_token/i);
    assert.equal(repository.loadLocalState('settings:site-gate')?.pendingOperation?.replay, undefined);
  }

  // Ambiguous transport errors query status and retain the replay envelope; they
  // must never reject a reservation while the terminal outcome is unknown.
  {
    const storage = new MemoryStorage();
    const client = new MockClient();
    client.commandError = { message: 'Failed to fetch' };
    const repository = new NormalizedRepository(client, createScope(NormalizedRequestScope), {
      durableState: new NormalizedDurableStateStore(storage),
    });
    await assert.rejects(() => safeCommand(repository), error => (
      error instanceof NormalizedCommandError && error.kind === 'recovery'
    ));
    assert.ok(client.calls.some(call => call.name === 'get_ship_dynamics_operation_status'));
    assert.equal(
      client.calls.some(call => call.name === 'reject_ship_dynamics_operation_reservation'),
      false,
    );
    assert.ok(repository.loadLocalState('vessel:v1')?.pendingOperation?.replay);
  }

  // A deterministic validation failure may reject the prepared reservation,
  // after a status query proves no terminal operation result exists.
  {
    const storage = new MemoryStorage();
    const client = new MockClient();
    client.commandError = { message: 'invalid-manual-attention' };
    const repository = new NormalizedRepository(client, createScope(NormalizedRequestScope), {
      durableState: new NormalizedDurableStateStore(storage),
    });
    await assert.rejects(() => safeCommand(repository), error => (
      error instanceof NormalizedCommandError && error.kind === 'invalid'
    ));
    assert.deepEqual(
      client.calls.filter(call => call.name === 'get_ship_dynamics_operation_status'
        || call.name === 'reject_ship_dynamics_operation_reservation').map(call => call.name),
      ['get_ship_dynamics_operation_status', 'reject_ship_dynamics_operation_reservation'],
    );
    assert.equal(repository.loadLocalState('vessel:v1')?.pendingOperation, undefined);
  }

  // Tampered local identity and a different/no current actor authority both fail
  // closed without dispatching or rejecting the server reservation.
  {
    const storage = new MemoryStorage();
    const firstClient = new MockClient();
    firstClient.commandError = { message: 'Failed to fetch' };
    const firstRepository = new NormalizedRepository(
      firstClient,
      createScope(NormalizedRequestScope),
      { durableState: new NormalizedDurableStateStore(storage) },
    );
    await assert.rejects(() => safeCommand(firstRepository));

    const mismatchClient = new MockClient();
    mismatchClient.status = {
      ...mismatchClient.status,
      command: 'different_command',
    };
    const mismatchRepository = new NormalizedRepository(
      mismatchClient,
      createScope(NormalizedRequestScope),
      { durableState: new NormalizedDurableStateStore(storage) },
    );
    await assert.rejects(
      () => mismatchRepository.recoverPendingOperation('vessel:v1'),
      error => error instanceof NormalizedCommandError
        && error.code === 'operation-recovery-mismatch',
    );
    assert.equal(mismatchClient.calls.some(call => call.name.startsWith('command_ship_dynamics_')), false);
    assert.equal(mismatchClient.calls.some(call => call.name.startsWith('reject_ship_dynamics_')), false);

    const noAuthorityClient = new MockClient();
    noAuthorityClient.status = null;
    const noAuthorityRepository = new NormalizedRepository(
      noAuthorityClient,
      createScope(NormalizedRequestScope),
      { durableState: new NormalizedDurableStateStore(storage) },
    );
    await assert.rejects(
      () => noAuthorityRepository.terminatePendingOperation('vessel:v1'),
      error => error instanceof NormalizedCommandError && error.kind === 'permission',
    );
    assert.equal(noAuthorityClient.calls.some(call => call.name.startsWith('reject_ship_dynamics_')), false);
  }

  // A non-replayable prepared operation has an explicit, status-first API cancel.
  {
    const storage = new MemoryStorage();
    const client = new MockClient();
    client.status = {
      status: 'prepared', command: 'update_site_gate', target: 'settings:site-gate',
      result: null, errorCode: null, completedAt: null,
    };
    client.commandError = { message: 'Failed to fetch' };
    const repository = new NormalizedRepository(client, createScope(NormalizedRequestScope), {
      durableState: new NormalizedDurableStateStore(storage),
    });
    await assert.rejects(() => repository.executeCommand({
      rpc: 'command_ship_dynamics_update_site_gate',
      command: 'update_site_gate',
      operationId,
      entityKey: 'settings:site-gate',
      request: { baseVersion: 1, leaseKey: 'settings:site-gate', ownerSession, fencingToken: 7 },
      args: { p_password: 'discarded-after-call' },
    }));
    const terminated = await repository.terminatePendingOperation('settings:site-gate');
    assert.equal(terminated?.status, 'rejected');
    assert.deepEqual(
      client.calls.filter(call => call.name === 'get_ship_dynamics_operation_status'
        || call.name === 'reject_ship_dynamics_operation_reservation').slice(-3).map(call => call.name),
      [
        'get_ship_dynamics_operation_status',
        'reject_ship_dynamics_operation_reservation',
        'get_ship_dynamics_operation_status',
      ],
    );
    assert.equal(repository.loadLocalState('settings:site-gate')?.pendingOperation, undefined);
    assert.doesNotMatch(storage.serialized(), /discarded-after-call/);
  }

  // Draft recovery is independent per envelope: an early failure cannot strand a
  // later operation, and the aggregate result exposes no entity identity.
  {
    const attempted = [];
    const result = await reconcileNormalizedDraftEnvelopes([
      { entityKey: 'hidden-a' },
      { entityKey: 'hidden-b' },
    ], async envelope => {
      attempted.push(envelope.entityKey);
      if (envelope.entityKey === 'hidden-a') throw new Error('secret target hidden-a failed');
    });
    assert.deepEqual(attempted, ['hidden-a', 'hidden-b']);
    assert.deepEqual(result, { failureCount: 1 });
    assert.doesNotMatch(JSON.stringify(result), /hidden-a|secret target/i);
  }

  // A fresh authorized process can explicitly resume a no-secret manage-user
  // recovery with the exact operation ID and sanitized action fields.
  {
    const storage = new MemoryStorage();
    const firstClient = new ManageUserClient();
    const firstRuntime = await createManageUserRuntime(
      NormalizedApplicationRuntime,
      storage,
      firstClient,
    );
    firstClient.functions.invoke = async (name, options) => {
      firstClient.invocations.push({ name, body: structuredClone(options.body) });
      firstClient.status = {
        status: 'recovery_required',
        command: 'manage_user:disable',
        target: 'user:target-user',
        result: null,
        errorCode: 'operation-recovery-required',
        completedAt: null,
      };
      return { data: null, error: { message: 'response lost after Auth effect' } };
    };
    await assert.rejects(
      () => firstRuntime.manageUser({ action: 'disable', targetUserId: 'target-user' }),
      error => error instanceof NormalizedCommandError && error.kind === 'recovery',
    );
    const stored = firstRuntime.loadDraft('user:target-user');
    assert.deepEqual(stored?.pendingOperation?.manageUserResume, {
      version: 1,
      action: 'disable',
      input: { action: 'disable', targetUserId: 'target-user' },
      requiresPassword: false,
    });
    assert.deepEqual(firstRuntime.listManageUserRecoveries(), [{
      entityKey: 'user:target-user',
      action: 'disable',
      requiresPassword: false,
      targetUserId: 'target-user',
    }]);
    assert.doesNotMatch(
      JSON.stringify(firstRuntime.listManageUserRecoveries()),
      new RegExp(operationId),
      'the management UI summary must not expose the durable operation identity',
    );
    assert.doesNotMatch(
      storage.serialized(),
      /p_password|credentialFingerprint|owner-access-token|owner-refresh-token/i,
    );

    const secondClient = new ManageUserClient();
    secondClient.status = structuredClone(firstClient.status);
    const secondRuntime = await createManageUserRuntime(
      NormalizedApplicationRuntime,
      storage,
      secondClient,
    );
    const resumed = await secondRuntime.resumeManageUserRecovery('user:target-user');
    assert.equal(resumed?.status, 'committed');
    assert.deepEqual(secondClient.invocations, [{
      name: 'manage-user',
      body: {
        action: 'disable',
        targetUserId: 'target-user',
        workspaceId,
        operationId,
      },
    }]);
    assert.equal(secondRuntime.loadDraft('user:target-user')?.pendingOperation, undefined);
  }

  // Credential recovery persists only safe action fields. A wrong re-entry must
  // fail closed against the server ledger and preserve the exact operation for
  // a later retry with the original password.
  {
    const secret = 'original-secret-123';
    const wrongSecret = 'different-secret-456';
    const invalidCredential = 'short'.padEnd(9, 'x');
    const storage = new MemoryStorage();
    const firstClient = new ManageUserClient();
    const firstRuntime = await createManageUserRuntime(
      NormalizedApplicationRuntime,
      storage,
      firstClient,
    );
    await assert.rejects(
      () => firstRuntime.manageUser({
        action: 'reset-password', targetUserId: 'target-user', password: invalidCredential,
      }),
      error => error instanceof NormalizedCommandError && error.kind === 'invalid',
    );
    assert.equal(firstRuntime.loadDraft('user:target-user'), null,
      'invalid credentials must fail before a durable operation is created');
    assert.equal(firstClient.invocations.length, 0);
    firstClient.functions.invoke = async (name, options) => {
      firstClient.invocations.push({ name, body: structuredClone(options.body) });
      firstClient.status = {
        status: 'recovery_required',
        command: 'manage_user:reset-password',
        target: 'user:target-user',
        result: null,
        errorCode: 'operation-recovery-required',
        completedAt: null,
      };
      return { data: null, error: { message: 'response lost after credential update' } };
    };
    await assert.rejects(
      () => firstRuntime.manageUser({
        action: 'reset-password', targetUserId: 'target-user', password: secret,
      }),
      error => error instanceof NormalizedCommandError && error.kind === 'recovery',
    );
    const secretPending = firstRuntime.loadDraft('user:target-user')?.pendingOperation;
    assert.deepEqual(secretPending?.manageUserResume, {
      version: 1,
      action: 'reset-password',
      input: { action: 'reset-password', targetUserId: 'target-user' },
      requiresPassword: true,
    });
    assert.doesNotMatch(storage.serialized(), new RegExp(`${secret}|${wrongSecret}`));

    const secondClient = new ManageUserClient();
    secondClient.status = structuredClone(firstClient.status);
    secondClient.functions.invoke = async (name, options) => {
      secondClient.invocations.push({ name, body: structuredClone(options.body) });
      if (options.body.password !== secret) {
        return { data: null, error: { message: 'operation-mismatch' } };
      }
      secondClient.status = {
        status: 'committed',
        command: 'manage_user:reset-password',
        target: 'user:target-user',
        result: { userId: 'target-user', credentialReset: true },
        errorCode: null,
        completedAt: '2026-07-26T00:30:00Z',
      };
      return { data: structuredClone(secondClient.status.result), error: null };
    };
    const secondRuntime = await createManageUserRuntime(
      NormalizedApplicationRuntime,
      storage,
      secondClient,
    );
    await assert.rejects(
      () => secondRuntime.resumeManageUserRecovery('user:target-user', wrongSecret),
      error => error instanceof NormalizedCommandError && error.kind === 'recovery',
    );
    assert.ok(secondRuntime.loadDraft('user:target-user')?.pendingOperation,
      'a fingerprint mismatch must preserve the pending operation');
    assert.doesNotMatch(storage.serialized(), new RegExp(`${secret}|${wrongSecret}`));

    const recovered = await secondRuntime.resumeManageUserRecovery('user:target-user', secret);
    assert.equal(recovered?.status, 'committed');
    assert.equal(secondRuntime.loadDraft('user:target-user')?.pendingOperation, undefined);
    assert.equal(secondClient.invocations.length, 2);
    assert.equal(secondClient.invocations[0].body.operationId, operationId);
    assert.equal(secondClient.invocations[1].body.operationId, operationId);
  }
} finally {
  await server.close();
}

console.log('normalized_prepared_recovery=PASS');

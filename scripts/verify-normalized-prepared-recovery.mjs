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
      return { data: structuredClone(this.lease), error: null };
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
  const controllerModule = await server.ssrLoadModule('/src/normalizedUiController.ts');
  const { NormalizedUiController } = controllerModule;
  const {
    NormalizedCommandError,
    NormalizedDurableStateStore,
    NormalizedRepository,
  } = repositoryModule;
  const { NormalizedRequestScope } = scopeModule;

  // Safe payload: process A loses the response; process B must refetch, reclaim
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
} finally {
  await server.close();
}

console.log('normalized_prepared_recovery=PASS');

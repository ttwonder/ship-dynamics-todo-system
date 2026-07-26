import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const protectedPaths = ['public/supabase-config.js'];

class MemoryStorage {
  #values = new Map();

  get length() { return this.#values.size; }
  clear() { this.#values.clear(); }
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  key(index) { return [...this.#values.keys()][index] ?? null; }
  removeItem(key) { this.#values.delete(key); }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

class Deferred {
  promise = new Promise((resolvePromise, rejectPromise) => {
    this.resolve = resolvePromise;
    this.reject = rejectPromise;
  });
}

class MockQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.selection = '';
    this.sort = null;
    this.maxRows = null;
  }

  select(selection) { this.selection = selection; return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order(column, options) { this.sort = [column, options]; return this; }
  limit(maxRows) { this.maxRows = maxRows; return this; }
  maybeSingle() { return this.#resolve('maybeSingle'); }
  single() { return this.#resolve('single'); }
  then(resolvePromise, rejectPromise) { return this.#resolve('many').then(resolvePromise, rejectPromise); }

  #resolve(mode) {
    const call = {
      table: this.table,
      selection: this.selection,
      filters: [...this.filters],
      sort: this.sort,
      maxRows: this.maxRows,
      mode,
    };
    this.client.queryCalls.push(call);
    return Promise.resolve(this.client.queryHandler(call));
  }
}

class MockSupabase {
  constructor() {
    this.queryCalls = [];
    this.rpcCalls = [];
    this.functionCalls = [];
    this.channelCallbacks = [];
    this.removedChannels = [];
    this.session = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      user: { id: 'actor-a' },
    };
    this.authListener = null;
    this.queryHandler = ({ table, mode }) => {
      if (table === 'sd_operations' && mode === 'maybeSingle') {
        return {
          data: {
            workspace_id: 'workspace-a',
            operation_id: 'operation-a',
            actor_id: 'actor-a',
            command: 'update_task',
            target_key: 'task:task-a',
            status: 'committed',
            result: { entityId: 'task-a', version: 2, replayed: true },
            error_code: null,
            completed_at: '2026-07-26T00:00:00.000Z',
          },
          error: null,
        };
      }
      return { data: [], error: null };
    };
    this.rpcHandler = (name) => {
      if (name === 'reserve_ship_dynamics_operation') {
        return {
          data: {
            operationId: 'operation-a',
            command: 'update_task',
            targetKey: 'task:task-a',
            status: 'prepared',
            result: null,
            errorCode: null,
          },
          error: null,
        };
      }
      if (name === 'get_ship_dynamics_operation_status') {
        return {
          data: {
            command: 'update_task',
            targetKey: 'task:task-a',
            status: 'committed',
            result: { entityId: 'task-a', version: 2, replayed: true },
            errorCode: null,
            completedAt: '2026-07-26T00:00:00.000Z',
          },
          error: null,
        };
      }
      if (name === 'command_ship_dynamics_update_task') {
        return {
          data: { status: 'committed', entityId: 'task-a', version: 2, replayed: true },
          error: null,
        };
      }
      if (name === 'claim_ship_dynamics_entity_lease') {
        return {
          data: {
            ok: true,
            leaseKey: 'task:task-a',
            ownerSession: 'session-a',
            fencingToken: 7,
            expiresAt: '2026-07-26T00:01:00.000Z',
          },
          error: null,
        };
      }
      return { data: true, error: null };
    };
    this.auth = {
      getSession: async () => ({ data: { session: this.session }, error: null }),
      getUser: async () => {
        this.getUserCalls = (this.getUserCalls || 0) + 1;
        return { data: { user: this.session?.user || null }, error: null };
      },
      onAuthStateChange: (callback) => {
        this.authListener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signInWithPassword: async (credentials) => {
        this.signInCredentials = credentials;
        this.session = { access_token: 'login-access-token', refresh_token: 'login-refresh-token', user: { id: 'actor-login' } };
        return { data: { session: this.session, user: this.session.user }, error: null };
      },
      signOut: async () => {
        this.session = null;
        this.authListener?.('SIGNED_OUT', null);
        return { error: null };
      },
      updateUser: async (attributes) => {
        this.updatedUserAttributes = attributes;
        return { data: { user: { id: 'actor-a' } }, error: null };
      },
    };
    this.functions = {
      invoke: async (name, options) => {
        this.functionCalls.push({ name, options });
        if (name === 'site-unlock') {
          return {
            data: { gateToken: 'signed-gate-token', expiresAt: '2026-07-26T00:05:00.000Z' },
            error: null,
          };
        }
        if (options?.body?.action === 'directory') {
          return {
            data: { people: [{ department: 'Operations', usernameLabel: 'Alice', displayName: 'Alice', authAlias: 'opaque@internal.invalid', mustChangePassword: true }] },
            error: null,
          };
        }
        return {
          data: {
            session: {
              access_token: 'login-access-token',
              refresh_token: 'login-refresh-token',
            },
          },
          error: null,
        };
      },
    };
  }

  from(table) { return new MockQuery(this, table); }

  async rpc(name, args) {
    this.rpcCalls.push({ name, args });
    return this.rpcHandler(name, args);
  }

  channel(name) {
    const channel = {
      name,
      on: (_kind, filter, callback) => {
        this.channelCallbacks.push({ filter, callback });
        return channel;
      },
      subscribe: () => channel,
    };
    return channel;
  }

  async removeChannel(channel) {
    this.removedChannels.push(channel);
    return 'ok';
  }
}

function assertWorkspacePinned(call, expectedWorkspace = 'workspace-a') {
  assert.deepEqual(
    call.filters.find(([column]) => column === 'workspace_id'),
    ['workspace_id', expectedWorkspace],
    `${call.table} must pin workspace_id`,
  );
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const clientModule = await server.ssrLoadModule('/src/normalizedSupabaseClient.ts');
  const authModule = await server.ssrLoadModule('/src/normalizedAuth.ts');
  const repositoryModule = await server.ssrLoadModule('/src/normalizedRepository.ts');

  const {
    NormalizedRequestScope,
    StaleNormalizedResponseError,
    assertBrowserSafeNormalizedConfig,
  } = clientModule;
  const {
    NormalizedAuth,
    flagPasswordlessCutoverAccounts,
  } = authModule;
  const {
    NormalizedDurableStateStore,
    NormalizedRepository,
    realtimeEntityKeys,
  } = repositoryModule;

  assert.equal(typeof NormalizedRequestScope, 'function');
  assert.equal(typeof NormalizedRepository, 'function');
  assert.equal(typeof NormalizedAuth, 'function');
  assert.throws(
    () => assertBrowserSafeNormalizedConfig({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'service_role.not-browser-safe',
      workspaceId: 'workspace-a',
    }),
    /service.role|browser/i,
  );

  const client = new MockSupabase();
  const scope = new NormalizedRequestScope('workspace-a');
  const gateStorage = new MemoryStorage();
  const auth = new NormalizedAuth(client, scope, { gateStorage });
  const session = await auth.initialize();
  assert.equal(session?.user.id, 'actor-a');
  assert.equal(client.getUserCalls, 1, 'initialize must validate a persisted session with Supabase Auth getUser');
  assert.equal(auth.actorId, 'actor-a', 'the actor must come from the verified Supabase user');
  assert.equal(scope.actorId, 'actor-a');

  const generationBeforeSignOut = scope.generation;
  client.authListener('SIGNED_OUT', null);
  assert.equal(auth.actorId, null);
  assert.ok(scope.generation > generationBeforeSignOut, 'auth changes must invalidate captured requests');
  assert.throws(() => auth.requireActor(), /authenticated|session/i);

  const gate = await auth.unlockSite({ workspaceKey: 'ship-dynamics-main', password: 'entered-only-once' });
  assert.equal(gate.gateToken, 'signed-gate-token');
  assert.equal(gateStorage.getItem('ship-dynamics.normalized.gate'), 'signed-gate-token');
  assert.equal(
    [...Array(gateStorage.length)].map((_, index) => gateStorage.key(index)).some(key => /password/i.test(key)),
    false,
    'site passwords must never be stored',
  );

  const directory = await auth.getLoginDirectory({
    workspaceKey: 'ship-dynamics-main',
    gateToken: gate.gateToken,
  });
  assert.equal(directory[0].displayName, 'Alice');
  assert.equal(directory[0].authAlias, 'opaque@internal.invalid');
  assert.equal(directory[0].mustChangePassword, true);
  await auth.signInWithDirectoryPassword({
    authAlias: directory[0].authAlias,
    password: 'personal-secret',
    gateToken: gate.gateToken,
  });
  assert.deepEqual(client.signInCredentials, {
    email: 'opaque@internal.invalid',
    password: 'personal-secret',
  }, 'password authentication must use the native Supabase Auth client');
  const directoryCall = client.functionCalls.at(-1);
  assert.equal(directoryCall.name, 'login-directory');
  assert.equal('password' in directoryCall.options.body, false, 'the Edge directory must never receive the password');
  assert.equal('userId' in directoryCall.options.body, false, 'the login directory must not expose auth.uid');
  assert.equal(auth.actorId, 'actor-login', 'native Auth session output must become the only actor');
  await auth.changePersonalPassword('new-personal-secret');
  assert.deepEqual(client.updatedUserAttributes, { password: 'new-personal-secret' });
  assert.equal(await auth.passwordActivationRequired('workspace-a'), true);
  await auth.activatePersonalPassword('workspace-a', 'activated-personal-secret');
  assert.deepEqual(client.updatedUserAttributes, { password: 'activated-personal-secret' });
  assert.ok(client.rpcCalls.some(call => call.name === 'get_my_ship_dynamics_password_activation_status'));
  assert.ok(client.rpcCalls.some(call => call.name === 'complete_my_ship_dynamics_password_activation'));

  const signOutDeferred = new Deferred();
  client.auth.signOut = () => signOutDeferred.promise;
  const signOutRequest = auth.signOut();
  assert.equal(auth.actorId, null, 'sign-out must revoke local authority before any network await');
  assert.throws(() => auth.requireActor(), /authenticated|session/i);
  signOutDeferred.resolve({ error: null });
  await signOutRequest;

  assert.deepEqual(
    flagPasswordlessCutoverAccounts([
      { legacyUserId: 'u-a', displayName: 'Has password', hasPassword: true },
      { legacyUserId: 'u-b', displayName: 'Missing password', hasPassword: false },
    ]),
    [{ legacyUserId: 'u-b', displayName: 'Missing password', reason: 'passwordless-account' }],
    'secure cutover must flag passwordless legacy accounts',
  );

  const repositoryClient = new MockSupabase();
  const repositoryScope = new NormalizedRequestScope('workspace-a');
  repositoryScope.acceptSession({ user: { id: 'actor-a' } });
  let commandDispatchStarted = false;
  let commandMarkerSawDispatch = false;
  class DispatchAwareStorage extends MemoryStorage {
    setItem(key, value) {
      const envelope = JSON.parse(value);
      if (envelope.pendingOperation?.operationId === 'operation-a') {
        commandMarkerSawDispatch = commandDispatchStarted;
      }
      super.setItem(key, value);
    }
  }
  const durableStorage = new DispatchAwareStorage();
  const durable = new NormalizedDurableStateStore(durableStorage);
  const repository = new NormalizedRepository(repositoryClient, repositoryScope, { durableState: durable });

  await repository.fetchProjection('tasks');
  assertWorkspacePinned(repositoryClient.queryCalls.at(-1));

  const lease = await repository.claimLease({
    leaseKey: 'task:task-a',
    entityType: 'task',
    entityId: 'task-a',
    ownerSession: 'session-a',
  });
  assert.equal(lease.fencingToken, 7);
  assert.equal(repositoryClient.rpcCalls.at(-1).args.p_workspace_id, 'workspace-a');

  durable.saveDraft({
    workspaceId: 'workspace-a',
    actorId: 'actor-a',
    entityKey: 'task:task-a',
    draft: { description: 'local unsaved draft' },
    baseVersions: { task: 1 },
  });
  assert.throws(
    () => durable.saveDraft({
      workspaceId: 'workspace-a',
      actorId: 'actor-a',
      entityKey: 'task:unsafe',
      draft: { tasks: [], users: [], settings: {} },
      baseVersions: {},
    }),
    /may not persist/i,
    'durable local state must reject whole AppData/server projections',
  );

  const originalRpc = repositoryClient.rpc.bind(repositoryClient);
  repositoryClient.rpc = (name, args) => {
    if (name !== 'command_ship_dynamics_update_task') return originalRpc(name, args);
    repositoryClient.rpcCalls.push({ name, args });
    return {
      then(resolvePromise, rejectPromise) {
        commandDispatchStarted = true;
        return Promise.resolve(repositoryClient.rpcHandler(name, args)).then(resolvePromise, rejectPromise);
      },
    };
  };
  const commandResult = await repository.executeCommand({
    rpc: 'command_ship_dynamics_update_task',
    command: 'update_task',
    operationId: 'operation-a',
    entityKey: 'task:task-a',
    targetKey: 'task:task-a',
    request: {
      taskId: 'task-a',
      baseVersion: 1,
      description: 'updated',
    },
    args: {
      p_task_id: 'task-a',
      p_base_version: 1,
      p_fencing_token: 7,
      p_lease_key: 'task:task-a',
      p_owner_session: 'session-a',
      p_description: 'updated',
    },
  });
  assert.equal(commandResult.replayed, true, 'an idempotent replay returns its original operation result');
  assert.equal(commandMarkerSawDispatch, false, 'pending operation state must be durable after reservation and before command dispatch');
  const reservationIndex = repositoryClient.rpcCalls.findIndex(call => call.name === 'reserve_ship_dynamics_operation');
  const commandIndex = repositoryClient.rpcCalls.findIndex(call => call.name === 'command_ship_dynamics_update_task');
  assert.ok(reservationIndex >= 0 && commandIndex > reservationIndex, 'reservation must precede command dispatch');
  assert.deepEqual(
    repositoryClient.rpcCalls[reservationIndex].args,
    {
      p_workspace_id: 'workspace-a',
      p_operation_id: 'operation-a',
      p_command: 'update_task',
      p_target_key: 'task:task-a',
      p_request: {
        taskId: 'task-a',
        baseVersion: 1,
        description: 'updated',
      },
    },
    'reservation must use the exact command, target, and request payload',
  );
  assert.equal(repositoryClient.rpcCalls.at(-1).args.p_workspace_id, 'workspace-a');
  assert.equal(repositoryClient.rpcCalls.at(-1).args.p_operation_id, 'operation-a');
  assert.equal(
    durable.load('workspace-a', 'actor-a', 'task:task-a')?.draft.description,
    'local unsaved draft',
    'a successful command must not silently destroy a draft',
  );

  durable.markPendingOperation({
    workspaceId: 'workspace-a',
    actorId: 'actor-a',
    entityKey: 'task:task-a',
    operationId: 'operation-a',
    command: 'update_task',
    targetKey: 'task:task-a',
  });
  const recovered = await repository.getOperationStatus('operation-a');
  assert.equal(recovered?.status, 'committed');
  assert.equal(recovered?.result.replayed, true);
  assert.deepEqual(
    repositoryClient.rpcCalls.at(-1),
    {
      name: 'get_ship_dynamics_operation_status',
      args: {
        p_workspace_id: 'workspace-a',
        p_operation_id: 'operation-a',
      },
    },
    'operation recovery must use the server status RPC',
  );
  repository.resolvePendingOperation('task:task-a', recovered);
  assert.equal(
    durable.load('workspace-a', 'actor-a', 'task:task-a')?.pendingOperation,
    undefined,
    'a durable pending reference clears only after a definitive server status',
  );

  const invalidations = [];
  const unsubscribe = repository.subscribeInvalidations(keys => invalidations.push(keys));
  const realtimeCallback = repositoryClient.channelCallbacks.find(
    ({ filter }) => filter.table === 'sd_tasks',
  )?.callback;
  assert.ok(realtimeCallback, 'tasks projection must subscribe for invalidation');
  realtimeCallback({
    eventType: 'UPDATE',
    new: {
      workspace_id: 'workspace-a',
      id: 'task-a',
      description: 'untrusted realtime row content',
    },
    old: {},
  });
  assert.deepEqual(invalidations, [['task:task-a']]);
  await repository.refetchInvalidatedEntities(invalidations[0]);
  assertWorkspacePinned(repositoryClient.queryCalls.at(-1));
  assert.deepEqual(
    repositoryClient.queryCalls.at(-1).filters.find(([column]) => column === 'id'),
    ['id', 'task-a'],
    'Realtime entity keys must drive an authoritative keyed refetch',
  );
  assert.deepEqual(
    realtimeEntityKeys('sd_task_vessels', { task_id: 'task-a', vessel_id: 'vessel-a' }),
    ['task:task-a', 'task-progress:task-a:vessel-a'],
  );
  assert.deepEqual(
    realtimeEntityKeys('sd_profiles', { id: 'actor-a' }),
    ['user:actor-a'],
    'profile invalidation must refetch the membership/profile projection',
  );
  const subscribedTables = new Set(repositoryClient.channelCallbacks.map(({ filter }) => filter.table));
  assert.equal(subscribedTables.has('sd_profiles'), true);
  assert.equal(subscribedTables.has('sd_audit_events'), false);
  assert.equal(subscribedTables.has('sd_operations'), false);
  assert.equal(
    durable.load('workspace-a', 'actor-a', 'task:task-a')?.draft.description,
    'local unsaved draft',
    'Realtime invalidation must preserve local drafts',
  );
  await unsubscribe();

  const slowClient = new MockSupabase();
  const deferred = new Deferred();
  slowClient.queryHandler = () => deferred.promise;
  const changingScope = new NormalizedRequestScope('workspace-a');
  changingScope.acceptSession({ user: { id: 'actor-a' } });
  const changingRepository = new NormalizedRepository(slowClient, changingScope);
  const slowRequest = changingRepository.fetchProjection('vessels');
  changingScope.setWorkspace('workspace-b');
  deferred.resolve({ data: [{ workspace_id: 'workspace-a', id: 'vessel-a' }], error: null });
  await assert.rejects(slowRequest, StaleNormalizedResponseError, 'out-of-order workspace responses must be discarded');

  const slowAuthClient = new MockSupabase();
  const authDeferred = new Deferred();
  slowAuthClient.queryHandler = () => authDeferred.promise;
  const changingAuthScope = new NormalizedRequestScope('workspace-a');
  changingAuthScope.acceptSession({ user: { id: 'actor-a' } });
  const changingAuthRepository = new NormalizedRepository(slowAuthClient, changingAuthScope);
  const slowAuthRequest = changingAuthRepository.fetchProjection('tasks');
  changingAuthScope.acceptSession({ user: { id: 'actor-b' } });
  authDeferred.resolve({ data: [{ workspace_id: 'workspace-a', id: 'task-a' }], error: null });
  await assert.rejects(slowAuthRequest, StaleNormalizedResponseError, 'out-of-order auth responses must be discarded');

  assert.equal(
    Object.keys(repositoryModule).some(name => /save.*app.*data|app.*data.*save/i.test(name)),
    false,
    'the normalized repository must not expose a whole-AppData save API',
  );
} finally {
  await server.close();
}

const browserFiles = [
  'src/normalizedSupabaseClient.ts',
  'src/normalizedRepository.ts',
  'src/normalizedAuth.ts',
];
for (const path of browserFiles) {
  const source = await readFile(resolve(root, path), 'utf8');
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service[_-]role/i, `${path} must be anon/session only`);
  assert.doesNotMatch(source, /sitePasswordHash|passwordHash/i, `${path} must not carry browser-readable password hashes`);
  assert.doesNotMatch(source, /saveAppData/i, `${path} must not expose whole-workspace saves`);
}

const edgeFiles = [
  'supabase/functions/_shared/security.ts',
  'supabase/functions/site-unlock/index.ts',
  'supabase/functions/login-directory/index.ts',
  'supabase/functions/manage-user/index.ts',
];
for (const path of edgeFiles) {
  const source = await readFile(resolve(root, path), 'utf8');
  assert.match(source, /Deno\.env\.get/, `${path} must source configuration from Edge runtime env`);
  assert.doesNotMatch(source, /https:\/\/[a-z0-9-]+\.supabase\.co/i, `${path} must not hard-code a Supabase project`);
  const transpiled = ts.transpileModule(source, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      allowImportingTsExtensions: true,
    },
  });
  const syntaxErrors = (transpiled.diagnostics || []).filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    syntaxErrors,
    [],
    `${path} contains TypeScript syntax errors: ${syntaxErrors.map(error => error.messageText).join('; ')}`,
  );
}

const sharedEdge = await readFile(resolve(root, edgeFiles[0]), 'utf8');
assert.match(sharedEdge, /ALLOWED_ORIGINS/);
assert.match(sharedEdge, /constantTime|timingSafe/i);
assert.match(sharedEdge, /authorization/i);
assert.match(sharedEdge, /consume_ship_dynamics_rate_limit/);
assert.match(sharedEdge, /enforceRateLimit/);
const requireJwtUserSource = sharedEdge.match(
  /export async function requireJwtUser[\s\S]*?\n}\r?\n\r?\nexport interface GateClaims/,
)?.[0] || '';
assert.match(requireJwtUserSource, /auth\.getUser\(accessToken\)/);
assert.doesNotMatch(
  requireJwtUserSource,
  /global:\s*\{\s*headers:/,
  'JWT validation must not duplicate the Authorization header already supplied to getUser',
);
const siteUnlockEdge = await readFile(resolve(root, edgeFiles[1]), 'utf8');
assert.match(siteUnlockEdge, /verify_ship_dynamics_site_password/);
assert.match(siteUnlockEdge, /enforceRateLimit/);
assert.match(siteUnlockEdge, /gateToken/);
assert.doesNotMatch(siteUnlockEdge, /\.from\([^)]*sd_public_site_gate/i, 'site password hashes stay behind a verifier RPC');
const loginDirectoryEdge = await readFile(resolve(root, edgeFiles[2]), 'utf8');
assert.match(loginDirectoryEdge, /auth_alias/);
assert.match(loginDirectoryEdge, /enforceRateLimit/);
assert.doesNotMatch(loginDirectoryEdge, /grant_type=password|access_token|refresh_token/);
assert.doesNotMatch(loginDirectoryEdge, /body\.password|password\s*:/, 'the directory Edge Function must never receive a login password');
const manageUserEdge = await readFile(resolve(root, edgeFiles[3]), 'utf8');
assert.match(manageUserEdge, /requireJwtUser\(/, 'manage-user must verify the caller JWT inside the function');
assert.match(manageUserEdge, /role\s*!==\s*["']owner["']/i);
assert.match(manageUserEdge, /role\s*!==\s*["']admin["']/i);
assert.match(manageUserEdge, /auth\.admin\.(createUser|updateUserById|deleteUser)/);
assert.match(manageUserEdge, /transfer_ship_dynamics_owner/);
assert.match(manageUserEdge, /p_user_id:\s*targetId/);
assert.doesNotMatch(manageUserEdge, /p_new_owner_id/);
assert.match(manageUserEdge, /passwordless-account|password.{0,30}required/is);
assert.doesNotMatch(manageUserEdge, /p_request:\s*body/, 'operation ledgers must not store submitted passwords');
assert.match(manageUserEdge, /credentialFingerprint/, 'credential operations need secret request matching without plaintext');
assert.match(manageUserEdge, /enforceRateLimit/);
assert.match(manageUserEdge, /mark_ship_dynamics_user_operation_effect/);
assert.match(manageUserEdge, /mark_ship_dynamics_user_operation_recovery_required/);
assert.match(manageUserEdge, /deterministicSyntheticEmail/);
assert.doesNotMatch(manageUserEdge, /const\s+syntheticEmail\s*=\s*`\$\{crypto\.randomUUID\(\)\}/, 'create recovery requires deterministic operation correlation');
const edgeConfig = await readFile(resolve(root, 'supabase/config.toml'), 'utf8');
assert.match(edgeConfig, /\[functions\.site-unlock\]\s+verify_jwt\s*=\s*false/);
assert.match(edgeConfig, /\[functions\.login-directory\]\s+verify_jwt\s*=\s*false/);
assert.match(edgeConfig, /\[functions\.manage-user\]\s+verify_jwt\s*=\s*false/);

const contractDoc = await readFile(resolve(root, 'docs/normalized-auth-contract.md'), 'utf8');
for (const phrase of [
  'auth.uid()',
  'short-lived',
  'synthetic',
  'passwordless',
  'Realtime',
  'operation',
  'localStorage',
]) {
  assert.match(contractDoc, new RegExp(phrase, 'i'), `contract doc must cover ${phrase}`);
}

const changedProtected = execFileSync(
  'git',
  ['diff', 'HEAD', '--name-only', '--', ...protectedPaths],
  { cwd: root, encoding: 'utf8' },
).trim();
assert.equal(changedProtected, '', `production configuration and prohibited files changed:\n${changedProtected}`);

const functionFiles = [];
async function collectFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(absolute);
    else functionFiles.push(relative(root, absolute));
  }
}
await collectFiles(resolve(root, 'supabase', 'functions'));
assert.ok(functionFiles.length >= 4);

console.log('normalized client/auth/repository contract verification passed');

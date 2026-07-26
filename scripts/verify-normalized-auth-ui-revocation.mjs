import assert from 'node:assert/strict';
import { createServer } from 'vite';

class Deferred {
  promise = new Promise((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
}

class MockSupabase {
  constructor() {
    this.session = {
      access_token: 'owner-access-token',
      refresh_token: 'owner-refresh-token',
      user: { id: 'owner-a' },
    };
    this.authListener = null;
    this.auth = {
      getSession: async () => ({ data: { session: this.session }, error: null }),
      getUser: async () => ({ data: { user: this.session?.user || null }, error: null }),
      onAuthStateChange: callback => {
        this.authListener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signInWithPassword: async () => ({
        data: { session: this.session, user: this.session?.user || null },
        error: null,
      }),
      signOut: async () => ({ error: null }),
      updateUser: async () => ({ data: {}, error: null }),
    };
    this.functions = { invoke: async () => ({ data: {}, error: null }) };
  }

  async rpc() { return { data: false, error: null }; }
  from() { throw new Error('unexpected normalized query'); }
  channel() { throw new Error('unexpected realtime channel'); }
  removeChannel() { return Promise.resolve('ok'); }
}

class InitialSessionCallbackClient extends MockSupabase {
  constructor() {
    super();
    this.auth.onAuthStateChange = callback => {
      this.authListener = callback;
      queueMicrotask(() => callback('INITIAL_SESSION', this.session));
      return { data: { subscription: { unsubscribe() {} } } };
    };
  }
}

class ProjectionQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
  }

  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order() { return this; }
  limit() { return this; }
  then(resolve, reject) {
    return Promise.resolve(this.client.query(this.table, this.filters)).then(resolve, reject);
  }
}

class ProjectionClient {
  constructor() {
    this.taskDescription = 'baseline';
    this.deferredTask = null;
  }

  from(table) { return new ProjectionQuery(this, table); }

  query(table, filters) {
    const keyedTask = table === 'sd_tasks'
      && filters.some(([column]) => column === 'id');
    if (keyedTask && this.deferredTask) return this.deferredTask.promise;
    if (table === 'sd_memberships') {
      return { data: [{
        workspace_id: 'workspace-a',
        user_id: 'owner-a',
        department: 'Operations',
        role: 'owner',
        is_active: true,
        version: 1,
        created_at: '2026-07-26T00:00:00.000Z',
        updated_at: '2026-07-26T00:00:00.000Z',
        profile: { display_name: 'Owner', username_label: 'owner' },
      }], error: null };
    }
    if (table === 'sd_tasks') {
      return { data: [{
        workspace_id: 'workspace-a',
        id: 'task-a',
        description: this.taskDescription,
        status: 'open',
        priority: '中',
        source_kind: 'ordinary',
        is_deleted: false,
        is_closed: false,
        version: this.taskDescription === 'newest' ? 2 : 1,
        created_at: '2026-07-26T00:00:00.000Z',
        updated_at: '2026-07-26T00:00:00.000Z',
      }], error: null };
    }
    return { data: [], error: null };
  }
}

const ownerProjection = {
  data: {
    revision: 1,
    users: [],
    vessels: [],
    tasks: [{ id: 'secret-task', description: 'owner-only projection' }],
    meetings: [],
    internalControlCases: [],
    notifications: [],
    agendaReports: [],
    auditLogs: [],
    settings: {},
  },
  versions: { get() { return 1; }, has() { return true; }, entries() { return new Map().entries(); } },
  actor: { id: 'owner-a', role: 'owner', name: 'Owner' },
  workspaceId: 'workspace-a',
  vesselAccount: false,
  allowedEntityKeys: new Set(['task:secret-task']),
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { NormalizedApplicationRuntime } = await server.ssrLoadModule('/src/normalizedRuntime.ts');
  const initialCallbackClient = new InitialSessionCallbackClient();
  const initialCallbackRuntime = new NormalizedApplicationRuntime({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'browser-anon-key',
    workspaceKey: 'workspace-a',
  }, initialCallbackClient);
  initialCallbackRuntime.repository.resolveWorkspaceByLegacyKey = async () => ({ id: 'workspace-a' });
  initialCallbackRuntime.auth.passwordActivationRequired = async () => false;
  initialCallbackRuntime.projectionReader.fetchApplicationProjection = async () => ownerProjection;
  await initialCallbackRuntime.initialize();
  assert.equal(initialCallbackRuntime.projection?.actor.id, 'owner-a',
    'the normal async INITIAL_SESSION callback must not invalidate its matching initialize operation');

  const client = new MockSupabase();
  const runtime = new NormalizedApplicationRuntime({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'browser-anon-key',
    workspaceKey: 'workspace-a',
  }, client);
  runtime.repository.resolveWorkspaceByLegacyKey = async () => ({ id: 'workspace-a' });
  runtime.auth.passwordActivationRequired = async () => false;
  runtime.projectionReader.fetchApplicationProjection = async () => ownerProjection;
  runtime.projectionReader.refetchInvalidatedProjection = async () => ownerProjection;

  await runtime.initialize();
  assert.equal(runtime.projection?.actor.id, 'owner-a');
  assert.equal(runtime.projection?.data.tasks[0]?.description, 'owner-only projection');

  let publishedProjection = runtime.projection;
  const publishedSnapshots = [];
  const unsubscribeProjection = typeof runtime.subscribeProjection === 'function'
    ? runtime.subscribeProjection(projection => {
        publishedProjection = projection;
        publishedSnapshots.push(projection);
      })
    : () => {};
  let invalidationStops = 0;
  runtime.repository.subscribeInvalidations = () => async () => { invalidationStops += 1; };
  runtime.startInvalidations(() => {}, error => { throw error; });

  client.authListener('SIGNED_OUT', null);
  assert.equal(runtime.scope.actorId, null, 'cross-tab SIGNED_OUT must clear request authority');
  assert.equal(runtime.projection, null,
    'cross-tab SIGNED_OUT must synchronously purge the runtime owner projection');
  assert.equal(typeof runtime.subscribeProjection, 'function',
    'the runtime must expose a projection transition contract to mounted UI owners');
  assert.equal(publishedProjection, null,
    'cross-tab SIGNED_OUT must synchronously publish a null UI projection');
  assert.equal(publishedSnapshots.at(-1), null);
  assert.equal(invalidationStops, 1,
    'auth revocation must synchronously detach Realtime invalidations');
  unsubscribeProjection();

  const staleProjection = new Deferred();
  const abaClient = new MockSupabase();
  const abaRuntime = new NormalizedApplicationRuntime({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'browser-anon-key',
    workspaceKey: 'workspace-a',
  }, abaClient);
  abaRuntime.repository.resolveWorkspaceByLegacyKey = async () => ({ id: 'workspace-a' });
  abaRuntime.auth.passwordActivationRequired = async () => false;
  abaRuntime.projectionReader.fetchApplicationProjection = async () => ownerProjection;
  await abaRuntime.initialize();
  abaRuntime.projectionReader.fetchApplicationProjection = () => staleProjection.promise;
  const staleRefresh = abaRuntime.refreshAll();
  abaClient.authListener('SIGNED_OUT', null);
  abaClient.authListener('SIGNED_IN', abaClient.session);
  staleProjection.resolve(ownerProjection);
  await assert.rejects(staleRefresh, /expired|stale|generation/i,
    'a stale owner refetch must not survive same-user sign-out/sign-in ABA');
  assert.equal(abaRuntime.projection, null,
    'same-user ABA must not republish the pre-revocation owner projection');

  const publicationClient = new MockSupabase();
  const publicationRuntime = new NormalizedApplicationRuntime({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'browser-anon-key',
    workspaceKey: 'workspace-a',
  }, publicationClient);
  publicationRuntime.repository.resolveWorkspaceByLegacyKey = async () => ({ id: 'workspace-a' });
  publicationRuntime.auth.passwordActivationRequired = async () => false;
  publicationRuntime.projectionReader.fetchApplicationProjection = async () => ownerProjection;
  await publicationRuntime.initialize();
  const olderPublication = new Deferred();
  const newerPublication = new Deferred();
  let publicationRequests = 0;
  publicationRuntime.projectionReader.fetchApplicationProjection = () => (
    ++publicationRequests === 1 ? olderPublication.promise : newerPublication.promise
  );
  const olderRefresh = publicationRuntime.refreshAll();
  const newerRefresh = publicationRuntime.refreshAll();
  newerPublication.resolve({
    ...ownerProjection,
    data: {
      ...ownerProjection.data,
      revision: 3,
      tasks: [{ id: 'secret-task', description: 'newer publication' }],
    },
  });
  await newerRefresh;
  olderPublication.resolve(ownerProjection);
  await assert.rejects(olderRefresh, /expired|stale|generation/i,
    'an older same-authority refresh must not publish after a newer request completes');
  assert.equal(publicationRuntime.projection?.data.tasks[0]?.description, 'newer publication');

  const refreshClient = new MockSupabase();
  const refreshRuntime = new NormalizedApplicationRuntime({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'browser-anon-key',
    workspaceKey: 'workspace-a',
  }, refreshClient);
  refreshRuntime.repository.resolveWorkspaceByLegacyKey = async () => ({ id: 'workspace-a' });
  refreshRuntime.auth.passwordActivationRequired = async () => false;
  refreshRuntime.projectionReader.fetchApplicationProjection = async () => ownerProjection;
  await refreshRuntime.initialize();
  const invalidationCallbacks = [];
  let invalidationUnsubscribes = 0;
  let invalidationRefetches = 0;
  refreshRuntime.repository.subscribeInvalidations = callback => {
    invalidationCallbacks.push(callback);
    return async () => { invalidationUnsubscribes += 1; };
  };
  const refreshedProjection = {
    ...ownerProjection,
    data: {
      ...ownerProjection.data,
      revision: 2,
      tasks: [{ id: 'secret-task', description: 'refetched after token refresh' }],
    },
  };
  const pendingTokenRefreshRefetch = new Deferred();
  refreshRuntime.projectionReader.refetchInvalidatedProjection = async () => {
    invalidationRefetches += 1;
    return invalidationRefetches === 1
      ? pendingTokenRefreshRefetch.promise
      : refreshedProjection;
  };
  const realtimePublications = [];
  refreshRuntime.startInvalidations(projection => realtimePublications.push(projection), error => {
    throw error;
  });
  const firstInvalidationCallback = invalidationCallbacks[0];
  firstInvalidationCallback(['task:secret-task']);
  await Promise.resolve();
  const authorizationBeforeRefresh = refreshRuntime.authorizationGeneration;
  const requestGenerationBeforeRefresh = refreshRuntime.scope.generation;
  refreshClient.authListener('TOKEN_REFRESHED', {
    ...refreshClient.session,
    access_token: 'rotated-access-token',
  });
  assert.ok(refreshRuntime.scope.generation > requestGenerationBeforeRefresh,
    'same-user token replacement must invalidate requests made with the old credential');
  assert.equal(refreshRuntime.authorizationGeneration, authorizationBeforeRefresh,
    'same-user token replacement must preserve the published authorization scope');
  assert.equal(invalidationCallbacks.length, 2,
    'same-user token replacement must install a current authoritative invalidation subscription');
  assert.equal(invalidationUnsubscribes, 1,
    'the obsolete invalidation subscription must be detached exactly once');
  pendingTokenRefreshRefetch.resolve(ownerProjection);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(realtimePublications.length, 0,
    'an obsolete request/subscription callback must never publish after token replacement');
  firstInvalidationCallback(['task:secret-task']);
  invalidationCallbacks[1](['task:secret-task']);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(invalidationRefetches, 2,
    'the stale callback is inert while the replacement subscription still triggers a current refetch');
  assert.equal(realtimePublications.at(-1)?.data.tasks[0]?.description,
    'refetched after token refresh');

  const { NormalizedProjectionReader } = await server.ssrLoadModule('/src/normalizedProjection.ts');
  const { NormalizedRequestScope } = await server.ssrLoadModule('/src/normalizedSupabaseClient.ts');
  const projectionClient = new ProjectionClient();
  const projectionScope = new NormalizedRequestScope('workspace-a');
  projectionScope.acceptSession({ user: { id: 'owner-a' } });
  const projectionReader = new NormalizedProjectionReader(projectionClient, projectionScope);
  const baselineProjection = await projectionReader.fetchApplicationProjection();
  assert.equal(baselineProjection.data.tasks[0]?.description, 'baseline');
  const staleTaskRows = new Deferred();
  projectionClient.deferredTask = staleTaskRows;
  const stalePartialRefetch = projectionReader.refetchInvalidatedProjection(['task:task-a']);
  await Promise.resolve();
  projectionClient.taskDescription = 'newest';
  const newestFullProjection = await projectionReader.fetchApplicationProjection();
  assert.equal(newestFullProjection.data.tasks[0]?.description, 'newest');
  staleTaskRows.resolve({ data: [{
    workspace_id: 'workspace-a',
    id: 'task-a',
    description: 'stale partial row',
    status: 'open',
    priority: '中',
    source_kind: 'ordinary',
    is_deleted: false,
    is_closed: false,
    version: 1,
    created_at: '2026-07-26T00:00:00.000Z',
    updated_at: '2026-07-26T00:00:00.000Z',
  }], error: null });
  await assert.rejects(stalePartialRefetch, /expired|stale|generation/i,
    'an older partial refetch must be rejected after a newer projection request starts');
  projectionClient.deferredTask = null;
  const cacheProbe = await projectionReader.refetchInvalidatedProjection(['audit']);
  assert.equal(cacheProbe.data.tasks[0]?.description, 'newest',
    'a stale partial refetch must not pollute the committed row cache');

  const uiModule = await server.ssrLoadModule('/src/normalizedAuthorizationUi.ts');
  const {
    createNormalizedAuthorizationEpoch,
    openNormalizedTaskEditor,
    resolveAuthorizedTaskEditor,
  } = uiModule;
  const task = {
    id: 'secret-task',
    vesselId: 'vessel-b',
    vesselIds: ['vessel-b'],
    description: 'scope-revoked modal secret',
  };
  const ownerEpoch = createNormalizedAuthorizationEpoch({
    authorizationGeneration: 1,
    projectionGeneration: 1,
    actorId: 'owner-a',
    role: 'owner',
    permissionBits: '1111',
    vesselIds: ['vessel-a', 'vessel-b'],
  });
  const editor = openNormalizedTaskEditor(task, {
    authorizationEpoch: ownerEpoch,
    creating: false,
    progressVesselId: '',
    draftOwner: {
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      entityKey: 'task:secret-task',
    },
  });
  assert.equal(resolveAuthorizedTaskEditor(editor, {
    authorizationEpoch: ownerEpoch,
    visibleTasks: [task],
    visibleVesselIds: new Set(['vessel-a', 'vessel-b']),
    canCreate: true,
  })?.description, 'scope-revoked modal secret', 'an authorized visible task may open');

  const revokedEpoch = createNormalizedAuthorizationEpoch({
    authorizationGeneration: 1,
    projectionGeneration: 2,
    actorId: 'owner-a',
    role: 'operator',
    permissionBits: '0000',
    vesselIds: ['vessel-a'],
  });
  assert.equal(resolveAuthorizedTaskEditor(editor, {
    authorizationEpoch: revokedEpoch,
    visibleTasks: [],
    visibleVesselIds: new Set(['vessel-a']),
    canCreate: false,
  }), null, 'an opened task modal must disappear synchronously when RLS scope is revoked');

  const sameUserAbaEpoch = createNormalizedAuthorizationEpoch({
    authorizationGeneration: 3,
    projectionGeneration: 1,
    actorId: 'owner-a',
    role: 'owner',
    permissionBits: '1111',
    vesselIds: ['vessel-a', 'vessel-b'],
  });
  assert.equal(resolveAuthorizedTaskEditor(editor, {
    authorizationEpoch: sameUserAbaEpoch,
    visibleTasks: [task],
    visibleVesselIds: new Set(['vessel-a', 'vessel-b']),
    canCreate: true,
  }), null, 'an old editor cannot ride a same-user re-login ABA');
} finally {
  await server.close();
}

console.log('normalized_auth_ui_revocation=PASS');

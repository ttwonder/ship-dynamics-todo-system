import type {
  NormalizedRequestScope,
  NormalizedRequestToken,
} from './normalizedSupabaseClient';

type JsonObject = Record<string, unknown>;

interface QueryResult<T> {
  data: T;
  error: unknown;
}

interface QueryBuilder<T = unknown> extends PromiseLike<QueryResult<T[]>> {
  select(selection: string): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  limit(maxRows: number): QueryBuilder<T>;
  maybeSingle(): Promise<QueryResult<T | null>>;
}

interface RealtimeChannel {
  on(
    kind: string,
    filter: Record<string, unknown>,
    callback: (payload: { eventType?: string; new?: JsonObject; old?: JsonObject }) => void,
  ): RealtimeChannel;
  subscribe(): RealtimeChannel;
}

interface NormalizedRepositoryClient {
  from<T = unknown>(table: string): QueryBuilder<T>;
  rpc<T = unknown>(name: string, args: JsonObject): Promise<QueryResult<T>>;
  channel(name: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): Promise<unknown>;
}

export type MemberRole = 'owner' | 'admin' | 'operator' | 'vessel';

export interface WorkspaceProjection {
  id: string;
  legacy_key: string;
  name: string;
  is_active: boolean;
}

export interface RosterProjection {
  workspace_id: string;
  user_id: string;
  department: string;
  role: MemberRole;
  is_active: boolean;
  version: number;
  profile: {
    display_name: string;
    username_label: string;
  };
}

export interface VesselProjection {
  workspace_id: string;
  id: string;
  name: string;
  short_name: string;
  full_name: string;
  ship_type: string;
  fleet_category: string;
  position: JsonObject;
  cargo: JsonObject;
  note: JsonObject;
  is_active: boolean;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

export interface TaskProjection {
  workspace_id: string;
  id: string;
  description: string;
  status: string;
  priority: string;
  source_kind: string;
  source_meeting_item_id: string | null;
  is_internal_control: boolean;
  is_closed: boolean;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

export interface TaskProgressProjection {
  workspace_id: string;
  task_id: string;
  vessel_id: string;
  is_active_scope: boolean;
  status: string;
  is_closed: boolean;
  version: number;
}

export interface OperationStatus<TResult = JsonObject> {
  workspace_id: string;
  operation_id: string;
  actor_id: string;
  command: string;
  target_key: string;
  status: 'prepared' | 'recovery_required' | 'committed' | 'rejected';
  result: TResult | null;
  error_code: string | null;
  completed_at: string | null;
}

export interface LeaseGrant {
  ok: boolean;
  leaseKey: string;
  ownerSession?: string;
  fencingToken?: number;
  expiresAt?: string;
  blockedByName?: string;
}

export interface InvalidatedEntityResult {
  entityKey: string;
  data: WorkspaceProjection | RosterProjection | VesselProjection | TaskProjection
    | TaskProgressProjection | OperationStatus | null;
}

export interface ProjectionTypes {
  workspace: WorkspaceProjection;
  roster: RosterProjection;
  vessels: VesselProjection;
  tasks: TaskProjection;
  taskProgress: TaskProgressProjection;
}

type ProjectionName = keyof ProjectionTypes;

const PROJECTIONS: Record<ProjectionName, {
  table: string;
  selection: string;
  workspaceColumn: string;
  order?: string;
}> = {
  workspace: {
    table: 'sd_workspaces',
    selection: 'id,legacy_key,name,is_active',
    workspaceColumn: 'id',
  },
  roster: {
    table: 'sd_memberships',
    selection: 'workspace_id,user_id,department,role,is_active,version,profile:sd_profiles!inner(display_name,username_label)',
    workspaceColumn: 'workspace_id',
    order: 'department',
  },
  vessels: {
    table: 'sd_vessels',
    selection: 'workspace_id,id,name,short_name,full_name,ship_type,fleet_category,position,cargo,note,is_active,version,updated_at,updated_by',
    workspaceColumn: 'workspace_id',
    order: 'id',
  },
  tasks: {
    table: 'sd_tasks',
    selection: 'workspace_id,id,description,status,priority,source_kind,source_meeting_item_id,is_internal_control,is_closed,version,updated_at,updated_by',
    workspaceColumn: 'workspace_id',
    order: 'id',
  },
  taskProgress: {
    table: 'sd_task_vessels',
    selection: 'workspace_id,task_id,vessel_id,is_active_scope,status,is_closed,version',
    workspaceColumn: 'workspace_id',
    order: 'task_id',
  },
};

export interface DurableDraftEnvelope<TDraft = JsonObject> {
  version: 1;
  workspaceId: string;
  actorId: string;
  entityKey: string;
  draft?: TDraft;
  baseVersions?: Record<string, number>;
  pendingOperation?: {
    operationId: string;
    command: string;
    targetKey: string;
    dispatchedAt: string;
  };
  updatedAt: string;
}

function storageKey(workspaceId: string, actorId: string, entityKey: string) {
  return [
    'ship-dynamics.normalized.local',
    encodeURIComponent(workspaceId),
    encodeURIComponent(actorId),
    encodeURIComponent(entityKey),
  ].join(':');
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertIdentity(value: unknown, label: string, maximum = 256): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > maximum) throw new Error(`${label} is invalid.`);
  return normalized;
}

function defaultDurableStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export class NormalizedDurableStateStore {
  #storage: Storage | null;

  constructor(storage: Storage | null = defaultDurableStorage()) {
    this.#storage = storage;
  }

  load<TDraft = JsonObject>(
    workspaceId: string,
    actorId: string,
    entityKey: string,
  ): DurableDraftEnvelope<TDraft> | null {
    const key = storageKey(workspaceId, actorId, entityKey);
    const raw = this.#storage?.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as DurableDraftEnvelope<TDraft>;
      if (
        parsed.version !== 1
        || parsed.workspaceId !== workspaceId
        || parsed.actorId !== actorId
        || parsed.entityKey !== entityKey
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  saveDraft<TDraft>(input: {
    workspaceId: string;
    actorId: string;
    entityKey: string;
    draft: TDraft;
    baseVersions: Record<string, number>;
  }): DurableDraftEnvelope<TDraft> {
    const previous = this.load<TDraft>(input.workspaceId, input.actorId, input.entityKey);
    const next: DurableDraftEnvelope<TDraft> = {
      version: 1,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      entityKey: input.entityKey,
      draft: input.draft,
      baseVersions: { ...input.baseVersions },
      pendingOperation: previous?.pendingOperation,
      updatedAt: new Date().toISOString(),
    };
    this.#write(next);
    return next;
  }

  markPendingOperation(input: {
    workspaceId: string;
    actorId: string;
    entityKey: string;
    operationId: string;
    command: string;
    targetKey: string;
  }): DurableDraftEnvelope {
    const previous = this.load(input.workspaceId, input.actorId, input.entityKey);
    const next: DurableDraftEnvelope = {
      version: 1,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      entityKey: input.entityKey,
      draft: previous?.draft,
      baseVersions: previous?.baseVersions,
      pendingOperation: {
        operationId: input.operationId,
        command: input.command,
        targetKey: input.targetKey,
        dispatchedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    this.#write(next);
    return next;
  }

  clearPendingOperation(workspaceId: string, actorId: string, entityKey: string) {
    const previous = this.load(workspaceId, actorId, entityKey);
    if (!previous?.pendingOperation) return previous;
    const next = { ...previous, pendingOperation: undefined, updatedAt: new Date().toISOString() };
    this.#write(next);
    return next;
  }

  removeDraft(workspaceId: string, actorId: string, entityKey: string) {
    const previous = this.load(workspaceId, actorId, entityKey);
    if (!previous) return;
    if (previous.pendingOperation) {
      this.#write({
        ...previous,
        draft: undefined,
        baseVersions: undefined,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    this.#storage?.removeItem(storageKey(workspaceId, actorId, entityKey));
  }

  #write<TDraft>(envelope: DurableDraftEnvelope<TDraft>) {
    this.#storage?.setItem(
      storageKey(envelope.workspaceId, envelope.actorId, envelope.entityKey),
      JSON.stringify(envelope),
    );
  }
}

function errorFromUnknown(error: unknown): Error {
  if (error instanceof Error) return error;
  if (isRecord(error) && typeof error.message === 'string') return new Error(error.message);
  return new Error('The normalized data request failed.');
}

function parseLease(value: unknown, fallbackKey: string): LeaseGrant {
  if (!isRecord(value)) throw new Error('The lease response is invalid.');
  const numberValue = value.fencingToken ?? value.fencing_token;
  return {
    ok: Boolean(value.ok),
    leaseKey: String(value.leaseKey ?? value.lease_key ?? fallbackKey),
    ownerSession: value.ownerSession || value.owner_session
      ? String(value.ownerSession ?? value.owner_session)
      : undefined,
    fencingToken: numberValue === undefined ? undefined : Number(numberValue),
    expiresAt: value.expiresAt || value.expires_at
      ? String(value.expiresAt ?? value.expires_at)
      : undefined,
    blockedByName: value.blockedByName || value.blocked_by_name
      ? String(value.blockedByName ?? value.blocked_by_name)
      : undefined,
  };
}

export function realtimeEntityKeys(table: string, identity: JsonObject): string[] {
  const id = typeof identity.id === 'string' ? identity.id : '';
  const taskId = typeof identity.task_id === 'string' ? identity.task_id : '';
  const vesselId = typeof identity.vessel_id === 'string' ? identity.vessel_id : '';
  const userId = typeof identity.user_id === 'string' ? identity.user_id : '';
  switch (table) {
    case 'sd_vessels': return id ? [`vessel:${id}`] : [];
    case 'sd_tasks': return id ? [`task:${id}`] : [];
    case 'sd_task_vessels':
      return taskId && vesselId
        ? [`task:${taskId}`, `task-progress:${taskId}:${vesselId}`]
        : taskId ? [`task:${taskId}`] : [];
    case 'sd_task_status_events': return taskId ? [`task:${taskId}`] : [];
    case 'sd_memberships': return userId ? [`user:${userId}`] : [];
    case 'sd_vessel_assignments':
      return [...(vesselId ? [`vessel:${vesselId}`] : []), ...(userId ? [`user:${userId}`] : [])];
    case 'sd_operations': {
      const operationId = typeof identity.operation_id === 'string' ? identity.operation_id : '';
      return operationId ? [`operation:${operationId}`] : [];
    }
    default: return [];
  }
}

const INVALIDATION_TABLES = [
  'sd_memberships',
  'sd_vessels',
  'sd_vessel_assignments',
  'sd_tasks',
  'sd_task_vessels',
  'sd_task_status_events',
  'sd_operations',
] as const;

export class NormalizedRepository {
  #client: NormalizedRepositoryClient;
  #scope: NormalizedRequestScope;
  #durableState: NormalizedDurableStateStore;

  constructor(
    client: NormalizedRepositoryClient,
    scope: NormalizedRequestScope,
    options: { durableState?: NormalizedDurableStateStore } = {},
  ) {
    this.#client = client;
    this.#scope = scope;
    this.#durableState = options.durableState || new NormalizedDurableStateStore();
  }

  async fetchProjection<TName extends ProjectionName>(
    name: TName,
  ): Promise<ProjectionTypes[TName][]> {
    const token = this.#scope.capture();
    const definition = PROJECTIONS[name];
    let query = this.#client
      .from<ProjectionTypes[TName]>(definition.table)
      .select(definition.selection)
      .eq(definition.workspaceColumn, token.workspaceId);
    if (definition.order) query = query.order(definition.order, { ascending: true });
    const { data, error } = await query;
    this.#scope.assertCurrent(token);
    if (error) throw errorFromUnknown(error);
    return data || [];
  }

  fetchWorkspace() { return this.fetchProjection('workspace'); }
  fetchRoster() { return this.fetchProjection('roster'); }
  fetchVessels() { return this.fetchProjection('vessels'); }
  fetchTasks() { return this.fetchProjection('tasks'); }
  fetchTaskProgress() { return this.fetchProjection('taskProgress'); }

  async claimLease(input: {
    leaseKey: string;
    entityType: string;
    entityId: string;
    ownerSession: string;
    ttlSeconds?: number;
  }): Promise<LeaseGrant> {
    const token = this.#scope.capture();
    const leaseKey = assertIdentity(input.leaseKey, 'Lease key');
    const response = await this.#client.rpc('claim_ship_dynamics_entity_lease', {
      p_workspace_id: token.workspaceId,
      p_lease_key: leaseKey,
      p_entity_type: assertIdentity(input.entityType, 'Entity type', 64),
      p_entity_id: assertIdentity(input.entityId, 'Entity identity'),
      p_owner_session: assertIdentity(input.ownerSession, 'Owner session'),
      p_ttl_seconds: Math.min(300, Math.max(30, Math.trunc(input.ttlSeconds ?? 75))),
    });
    this.#scope.assertCurrent(token);
    if (response.error) throw errorFromUnknown(response.error);
    return parseLease(response.data, leaseKey);
  }

  async renewLease(input: {
    leaseKey: string;
    ownerSession: string;
    fencingToken: number;
    ttlSeconds?: number;
  }): Promise<LeaseGrant> {
    const token = this.#scope.capture();
    const leaseKey = assertIdentity(input.leaseKey, 'Lease key');
    const response = await this.#client.rpc('renew_ship_dynamics_entity_lease', {
      p_workspace_id: token.workspaceId,
      p_lease_key: leaseKey,
      p_owner_session: assertIdentity(input.ownerSession, 'Owner session'),
      p_fencing_token: input.fencingToken,
      p_ttl_seconds: Math.min(300, Math.max(30, Math.trunc(input.ttlSeconds ?? 75))),
    });
    this.#scope.assertCurrent(token);
    if (response.error) throw errorFromUnknown(response.error);
    return parseLease(response.data, leaseKey);
  }

  async releaseLease(input: {
    leaseKey: string;
    ownerSession: string;
    fencingToken: number;
  }): Promise<boolean> {
    const token = this.#scope.capture();
    const response = await this.#client.rpc<boolean>('release_ship_dynamics_entity_lease', {
      p_workspace_id: token.workspaceId,
      p_lease_key: assertIdentity(input.leaseKey, 'Lease key'),
      p_owner_session: assertIdentity(input.ownerSession, 'Owner session'),
      p_fencing_token: input.fencingToken,
    });
    this.#scope.assertCurrent(token);
    if (response.error) throw errorFromUnknown(response.error);
    return response.data === true;
  }

  async executeCommand<TResult extends JsonObject = JsonObject>(input: {
    rpc: string;
    operationId: string;
    entityKey: string;
    args: JsonObject;
  }): Promise<TResult> {
    if (!/^command_ship_dynamics_[a-z0-9_]+$/.test(input.rpc)) {
      throw new Error('Only explicit normalized command RPCs may be dispatched.');
    }
    const token = this.#scope.capture();
    const operationId = assertIdentity(input.operationId, 'Operation identity');
    const entityKey = assertIdentity(input.entityKey, 'Entity key');
    const request = this.#client.rpc<TResult>(input.rpc, {
      ...input.args,
      p_workspace_id: token.workspaceId,
      p_operation_id: operationId,
    }).then(response => response);
    this.#durableState.markPendingOperation({
      workspaceId: token.workspaceId,
      actorId: token.actorId,
      entityKey,
      operationId,
      command: input.rpc.replace(/^command_ship_dynamics_/, ''),
      targetKey: entityKey,
    });
    const response = await request;
    this.#scope.assertCurrent(token);
    if (response.error) throw errorFromUnknown(response.error);
    this.#durableState.clearPendingOperation(token.workspaceId, token.actorId, entityKey);
    return response.data;
  }

  async getOperationStatus<TResult = JsonObject>(
    operationId: string,
  ): Promise<OperationStatus<TResult> | null> {
    const token = this.#scope.capture();
    const response = await this.#client
      .from<OperationStatus<TResult>>('sd_operations')
      .select('workspace_id,operation_id,actor_id,command,target_key,status,result,error_code,completed_at')
      .eq('workspace_id', token.workspaceId)
      .eq('operation_id', assertIdentity(operationId, 'Operation identity'))
      .maybeSingle();
    this.#scope.assertCurrent(token);
    if (response.error) throw errorFromUnknown(response.error);
    return response.data;
  }

  async refetchInvalidatedEntities(entityKeys: string[]): Promise<InvalidatedEntityResult[]> {
    const uniqueKeys = [...new Set(entityKeys.map(key => assertIdentity(key, 'Entity key')))];
    return Promise.all(uniqueKeys.map(entityKey => this.#refetchInvalidatedEntity(entityKey)));
  }

  resolvePendingOperation(entityKey: string, status: OperationStatus | null) {
    if (!status || !['committed', 'rejected'].includes(status.status)) return;
    const token = this.#scope.capture();
    this.#durableState.clearPendingOperation(
      token.workspaceId,
      token.actorId,
      assertIdentity(entityKey, 'Entity key'),
    );
  }

  saveDraft<TDraft>(entityKey: string, draft: TDraft, baseVersions: Record<string, number>) {
    const token = this.#scope.capture();
    return this.#durableState.saveDraft({
      workspaceId: token.workspaceId,
      actorId: token.actorId,
      entityKey: assertIdentity(entityKey, 'Entity key'),
      draft,
      baseVersions,
    });
  }

  loadLocalState<TDraft = JsonObject>(entityKey: string) {
    const token = this.#scope.capture();
    return this.#durableState.load<TDraft>(
      token.workspaceId,
      token.actorId,
      assertIdentity(entityKey, 'Entity key'),
    );
  }

  subscribeInvalidations(onInvalidate: (entityKeys: string[]) => void): () => Promise<void> {
    const token = this.#scope.capture();
    let channel = this.#client.channel(
      `ship-dynamics:${token.workspaceId}:${token.actorId}:${token.generation}`,
    );
    for (const table of INVALIDATION_TABLES) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `workspace_id=eq.${token.workspaceId}`,
        },
        payload => {
          if (!this.#scope.isCurrent(token)) return;
          const identity = isRecord(payload.new) && Object.keys(payload.new).length
            ? payload.new
            : isRecord(payload.old) ? payload.old : {};
          if (identity.workspace_id !== token.workspaceId) return;
          const keys = realtimeEntityKeys(table, identity);
          if (keys.length) onInvalidate(keys);
        },
      );
    }
    const subscribed = channel.subscribe();
    return async () => {
      await this.#client.removeChannel(subscribed);
    };
  }

  async #refetchInvalidatedEntity(entityKey: string): Promise<InvalidatedEntityResult> {
    if (entityKey.startsWith('operation:')) {
      const data = await this.getOperationStatus(entityKey.slice('operation:'.length));
      return { entityKey, data };
    }
    const token = this.#scope.capture();
    let table: string;
    let selection: string;
    let filters: Array<[string, string]>;
    if (entityKey.startsWith('task-progress:')) {
      const [taskId, vesselId] = entityKey.slice('task-progress:'.length).split(':');
      if (!taskId || !vesselId) throw new Error('Task progress entity key is invalid.');
      table = PROJECTIONS.taskProgress.table;
      selection = PROJECTIONS.taskProgress.selection;
      filters = [['task_id', taskId], ['vessel_id', vesselId]];
    } else if (entityKey.startsWith('task:')) {
      table = PROJECTIONS.tasks.table;
      selection = PROJECTIONS.tasks.selection;
      filters = [['id', entityKey.slice('task:'.length)]];
    } else if (entityKey.startsWith('vessel:')) {
      table = PROJECTIONS.vessels.table;
      selection = PROJECTIONS.vessels.selection;
      filters = [['id', entityKey.slice('vessel:'.length)]];
    } else if (entityKey.startsWith('user:')) {
      table = PROJECTIONS.roster.table;
      selection = PROJECTIONS.roster.selection;
      filters = [['user_id', entityKey.slice('user:'.length)]];
    } else {
      throw new Error(`Unsupported invalidation entity key: ${entityKey}`);
    }
    let query = this.#client
      .from<WorkspaceProjection | RosterProjection | VesselProjection | TaskProjection | TaskProgressProjection>(
        table,
      )
      .select(selection)
      .eq('workspace_id', token.workspaceId);
    for (const [column, value] of filters) {
      query = query.eq(column, assertIdentity(value, `${column} identity`));
    }
    const response = await query.maybeSingle();
    this.#scope.assertCurrent(token);
    if (response.error) throw errorFromUnknown(response.error);
    return { entityKey, data: response.data };
  }
}

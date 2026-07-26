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
  command: string;
  targetKey: string;
  status: 'prepared' | 'recovery_required' | 'committed' | 'rejected';
  result: TResult | null;
  errorCode: string | null;
  completedAt: string | null;
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
    | TaskProgressProjection | OperationStatus | JsonObject | null;
}

export interface OperationReservation<TResult = JsonObject> {
  status: 'prepared' | 'recovery_required' | 'committed' | 'rejected';
  replayed: boolean;
  result?: TResult | null;
  errorCode?: string | null;
}

export type NormalizedCommandFailureKind =
  | 'busy'
  | 'version'
  | 'permission'
  | 'recovery'
  | 'rejected'
  | 'invalid';

export class NormalizedCommandError extends Error {
  readonly kind: NormalizedCommandFailureKind;
  readonly code: string;
  readonly operationId?: string;

  constructor(
    kind: NormalizedCommandFailureKind,
    code: string,
    message: string,
    operationId?: string,
  ) {
    super(message);
    this.name = 'NormalizedCommandError';
    this.kind = kind;
    this.code = code;
    this.operationId = operationId;
  }
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
    assertSafeDraftValue(input.draft);
    if (JSON.stringify(input.draft).length > 512_000) {
      throw new Error('Draft content is too large.');
    }
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

  list(workspaceId: string, actorId: string): DurableDraftEnvelope[] {
    if (!this.#storage) return [];
    const prefix = storageKey(workspaceId, actorId, '');
    const envelopes: DurableDraftEnvelope[] = [];
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const raw = this.#storage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as DurableDraftEnvelope;
        if (
          parsed.version === 1
          && parsed.workspaceId === workspaceId
          && parsed.actorId === actorId
          && parsed.entityKey
        ) envelopes.push(parsed);
      } catch {
        // Ignore malformed local metadata; it never becomes authority.
      }
    }
    return envelopes.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
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

function errorCodeFromUnknown(error: unknown): string {
  if (isRecord(error)) {
    for (const key of ['message', 'code', 'details', 'hint']) {
      const value = error[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'normalized-command-failed';
}

function commandFailure(
  errorCode: string,
  operationId?: string,
): NormalizedCommandError {
  const normalized = errorCode.toLowerCase();
  if (/version-conflict|stale-version|40001/.test(normalized)) {
    return new NormalizedCommandError(
      'version',
      errorCode,
      '資料已由其他使用者更新，請重新整理後再提交。',
      operationId,
    );
  }
  if (/lease|busy|locked|fencing/.test(normalized)) {
    return new NormalizedCommandError(
      'busy',
      errorCode,
      '此項目正由其他使用者編輯，或編輯租約已失效。',
      operationId,
    );
  }
  if (/not-authorized|permission|row-level|42501|401|403/.test(normalized)) {
    return new NormalizedCommandError(
      'permission',
      errorCode,
      '目前登入身分沒有執行此操作的權限。',
      operationId,
    );
  }
  if (/invalid|mismatch|unsupported|duplicate/.test(normalized)) {
    return new NormalizedCommandError(
      'invalid',
      errorCode,
      '提交內容未通過伺服器驗證。',
      operationId,
    );
  }
  return new NormalizedCommandError(
    'rejected',
    errorCode,
    '伺服器拒絕此操作，資料未變更。',
    operationId,
  );
}

function parseOperationStatus<TResult = JsonObject>(
  value: unknown,
): OperationStatus<TResult> | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error('The operation status response is invalid.');
  const status = String(value.status || '');
  if (!['prepared', 'recovery_required', 'committed', 'rejected'].includes(status)) {
    throw new Error('The operation status response is invalid.');
  }
  return {
    command: String(value.command || ''),
    targetKey: String(value.target ?? value.targetKey ?? value.target_key ?? ''),
    status: status as OperationStatus<TResult>['status'],
    result: (value.result ?? null) as TResult | null,
    errorCode: value.errorCode || value.error_code
      ? String(value.errorCode ?? value.error_code)
      : null,
    completedAt: value.completedAt || value.completed_at
      ? String(value.completedAt ?? value.completed_at)
      : null,
  };
}

function assertSafeDraftValue(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error('Draft content is too deeply nested.');
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafeDraftValue(item, depth + 1);
    return;
  }
  if (!isRecord(value)) throw new Error('Draft content must be JSON-compatible.');
  const forbiddenKeys = new Set([
    'revision',
    'settings',
    'users',
    'vessels',
    'tasks',
    'meetings',
    'internalControlCases',
    'agendaReports',
    'auditLogs',
    'notifications',
    ['password', 'Hash'].join(''),
    'rolePermissions',
    'authAlias',
    'requestPayload',
    'cloudPayload',
  ]);
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) {
      throw new Error(`Draft content may not persist ${key}.`);
    }
    assertSafeDraftValue(item, depth + 1);
  }
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
  const meetingId = typeof identity.meeting_id === 'string' ? identity.meeting_id : '';
  const caseId = typeof identity.case_id === 'string' ? identity.case_id : '';
  const sectionKey = typeof identity.section_key === 'string' ? identity.section_key : '';
  switch (table) {
    case 'sd_vessels': return id ? [`vessel:${id}`] : [];
    case 'sd_tasks': return id ? [`task:${id}`] : [];
    case 'sd_task_vessels':
      return taskId && vesselId
        ? [`task:${taskId}`, `task-progress:${taskId}:${vesselId}`]
        : taskId ? [`task:${taskId}`] : [];
    case 'sd_task_status_events':
    case 'sd_task_categories':
    case 'sd_task_departments':
    case 'sd_task_owners':
    case 'sd_task_type_scopes':
      return taskId ? [`task:${taskId}`] : [];
    case 'sd_task_vessel_status_events':
      return taskId && vesselId
        ? [`task:${taskId}`, `task-progress:${taskId}:${vesselId}`]
        : taskId ? [`task:${taskId}`] : [];
    case 'sd_memberships': return userId ? [`user:${userId}`] : [];
    case 'sd_profiles': return id ? [`user:${id}`] : [];
    case 'sd_vessel_assignments':
      return [...(vesselId ? [`vessel:${vesselId}`] : []), ...(userId ? [`user:${userId}`] : [])];
    case 'sd_meetings': return id ? [`meeting:${id}`] : [];
    case 'sd_meeting_vessels':
    case 'sd_meeting_type_scopes':
    case 'sd_meeting_departments':
    case 'sd_meeting_participants':
    case 'sd_meeting_status_events':
    case 'sd_meeting_status_event_corrections':
      return meetingId ? [`meeting:${meetingId}`] : [];
    case 'sd_meeting_items':
      return meetingId ? [`meeting:${meetingId}`] : [];
    case 'sd_internal_cases': return id ? [`internal-case:${id}`] : [];
    case 'sd_internal_case_departments':
    case 'sd_internal_case_status_events':
      return caseId ? [`internal-case:${caseId}`] : [];
    case 'sd_internal_case_task_links':
      return [
        ...(caseId ? [`internal-case:${caseId}`] : []),
        ...(taskId ? [`task:${taskId}`] : []),
      ];
    case 'sd_settings': return sectionKey ? [`settings:${sectionKey}`] : [];
    case 'sd_role_permissions': return ['settings:role-permissions'];
    case 'sd_departments': return ['settings:departments'];
    case 'sd_category_options': {
      const categoryScope = typeof identity.category_scope === 'string'
        ? identity.category_scope
        : '';
      return categoryScope === 'meeting'
        ? ['settings:meeting-task-categories']
        : categoryScope === 'ordinary' ? ['settings:task-categories'] : [];
    }
    case 'sd_priority_options': return ['settings:priorities'];
    case 'sd_equipment_options': return ['settings:equipment-options'];
    case 'sd_notifications': return id ? [`notification:${id}`] : [];
    case 'sd_saved_reports': return id ? [`report:${id}`] : [];
    case 'sd_saved_report_vessels': {
      const reportId = typeof identity.report_id === 'string' ? identity.report_id : '';
      return reportId ? [`report:${reportId}`] : [];
    }
    default: return [];
  }
}

const INVALIDATION_TABLES = [
  'sd_profiles',
  'sd_memberships',
  'sd_vessels',
  'sd_vessel_assignments',
  'sd_tasks',
  'sd_task_vessels',
  'sd_task_status_events',
  'sd_task_vessel_status_events',
  'sd_task_categories',
  'sd_task_departments',
  'sd_task_owners',
  'sd_task_type_scopes',
  'sd_meetings',
  'sd_meeting_vessels',
  'sd_meeting_type_scopes',
  'sd_meeting_departments',
  'sd_meeting_participants',
  'sd_meeting_items',
  'sd_meeting_item_categories',
  'sd_meeting_status_events',
  'sd_meeting_status_event_corrections',
  'sd_internal_cases',
  'sd_internal_case_departments',
  'sd_internal_case_status_events',
  'sd_internal_case_task_links',
  'sd_settings',
  'sd_role_permissions',
  'sd_departments',
  'sd_category_options',
  'sd_priority_options',
  'sd_equipment_options',
  'sd_notifications',
  'sd_saved_reports',
  'sd_saved_report_vessels',
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

  async resolveWorkspaceByLegacyKey(legacyKey: string): Promise<WorkspaceProjection> {
    const token = this.#scope.capture();
    const response = await this.#client
      .from<WorkspaceProjection>('sd_workspaces')
      .select(PROJECTIONS.workspace.selection)
      .eq('legacy_key', assertIdentity(legacyKey, 'Workspace key', 128))
      .maybeSingle();
    this.#scope.assertCurrent(token);
    if (response.error) throw errorFromUnknown(response.error);
    if (!response.data?.id || !response.data.is_active) {
      throw new Error('The authenticated workspace is unavailable.');
    }
    this.#scope.setWorkspace(response.data.id);
    return response.data;
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

  async reserveOperation<TResult = JsonObject>(input: {
    operationId: string;
    command: string;
    targetKey: string;
    request: JsonObject;
  }): Promise<OperationReservation<TResult>> {
    const token = this.#scope.capture();
    const response = await this.#client.rpc<OperationReservation<TResult>>(
      'reserve_ship_dynamics_operation',
      {
        p_workspace_id: token.workspaceId,
        p_operation_id: assertIdentity(input.operationId, 'Operation identity'),
        p_command: assertIdentity(input.command, 'Command', 128),
        p_target_key: assertIdentity(input.targetKey, 'Target key'),
        p_request: input.request,
      },
    );
    this.#scope.assertCurrent(token);
    if (response.error) {
      throw commandFailure(errorCodeFromUnknown(response.error), input.operationId);
    }
    if (!isRecord(response.data)) {
      throw new Error('The operation reservation response is invalid.');
    }
    return response.data;
  }

  async executeCommand<TResult extends JsonObject = JsonObject>(input: {
    rpc: string;
    command: string;
    operationId: string;
    entityKey: string;
    targetKey?: string;
    request: JsonObject;
    args: JsonObject;
  }): Promise<TResult> {
    if (!/^command_ship_dynamics_[a-z0-9_]+$/.test(input.rpc)) {
      throw new Error('Only explicit normalized command RPCs may be dispatched.');
    }
    const token = this.#scope.capture();
    const operationId = assertIdentity(input.operationId, 'Operation identity');
    const entityKey = assertIdentity(input.entityKey, 'Entity key');
    const command = assertIdentity(input.command, 'Command', 128);
    if (input.rpc !== `command_ship_dynamics_${command}`) {
      throw new Error('The command and RPC identity do not match.');
    }
    const targetKey = assertIdentity(input.targetKey || entityKey, 'Target key');
    if (!isRecord(input.request)) {
      throw new Error('The command reservation request is invalid.');
    }

    const reservationResponse = await this.#client.rpc<OperationReservation<TResult>>(
      'reserve_ship_dynamics_operation',
      {
        p_workspace_id: token.workspaceId,
        p_operation_id: operationId,
        p_command: command,
        p_target_key: targetKey,
        p_request: input.request,
      },
    );
    this.#scope.assertCurrent(token);
    if (reservationResponse.error) {
      throw commandFailure(errorCodeFromUnknown(reservationResponse.error), operationId);
    }
    const reservation = reservationResponse.data;
    if (!isRecord(reservation)) {
      throw new Error('The operation reservation response is invalid.');
    }
    if (reservation.status === 'committed') {
      return (reservation.result || {}) as TResult;
    }
    if (reservation.status === 'rejected') {
      throw commandFailure(String(reservation.errorCode || 'operation-rejected'), operationId);
    }
    if (reservation.status !== 'prepared' && reservation.status !== 'recovery_required') {
      throw new Error('The operation reservation response is invalid.');
    }

    this.#durableState.markPendingOperation({
      workspaceId: token.workspaceId,
      actorId: token.actorId,
      entityKey,
      operationId,
      command,
      targetKey,
    });

    const response = await this.#client.rpc<TResult>(input.rpc, {
      ...input.args,
      p_workspace_id: token.workspaceId,
      p_operation_id: operationId,
    });
    this.#scope.assertCurrent(token);
    if (response.error) {
      let recovered: OperationStatus<TResult> | null = null;
      try {
        recovered = await this.getOperationStatus<TResult>(operationId);
      } catch {
        // The durable reservation remains available for a later recovery pass.
      }
      this.#scope.assertCurrent(token);
      if (recovered?.status === 'committed' && recovered.result) {
        this.#durableState.clearPendingOperation(token.workspaceId, token.actorId, entityKey);
        return recovered.result;
      }
      if (recovered?.status === 'rejected') {
        this.#durableState.clearPendingOperation(token.workspaceId, token.actorId, entityKey);
        throw commandFailure(recovered.errorCode || 'operation-rejected', operationId);
      }
      throw new NormalizedCommandError(
        'recovery',
        errorCodeFromUnknown(response.error),
        '操作結果尚未能確認；系統已保留操作編號，請連線後查詢並重播同一操作。',
        operationId,
      );
    }
    this.#durableState.clearPendingOperation(token.workspaceId, token.actorId, entityKey);
    return response.data;
  }

  async getOperationStatus<TResult = JsonObject>(
    operationId: string,
  ): Promise<OperationStatus<TResult> | null> {
    const token = this.#scope.capture();
    const response = await this.#client.rpc<unknown>(
      'get_ship_dynamics_operation_status',
      {
        p_workspace_id: token.workspaceId,
        p_operation_id: assertIdentity(operationId, 'Operation identity'),
      },
    );
    this.#scope.assertCurrent(token);
    if (response.error) throw errorFromUnknown(response.error);
    return parseOperationStatus<TResult>(response.data);
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

  listLocalStates() {
    const token = this.#scope.capture();
    return this.#durableState.list(token.workspaceId, token.actorId);
  }

  removeDraft(entityKey: string) {
    const token = this.#scope.capture();
    this.#durableState.removeDraft(
      token.workspaceId,
      token.actorId,
      assertIdentity(entityKey, 'Entity key'),
    );
  }

  removeOwnedDraft(workspaceId: string, actorId: string, entityKey: string) {
    this.#durableState.removeDraft(
      assertIdentity(workspaceId, 'Workspace identity'),
      assertIdentity(actorId, 'Actor identity'),
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

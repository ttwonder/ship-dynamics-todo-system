import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  NormalizedAuth,
  type LoginDirectoryPerson,
  type NormalizedAuthTransition,
  type SiteGateGrant,
} from './normalizedAuth';
import { NormalizedCommandClient, leaseProof, type LeaseProof } from './normalizedCommands';
import {
  NormalizedCommandError,
  NormalizedRepository,
  parseDurableManageUserResume,
  type DurableDraftEnvelope,
  type DurableManageUserResume,
  type ManageUserAction,
  type OperationStatus,
} from './normalizedRepository';
import {
  NormalizedProjectionReader,
  type NormalizedApplicationProjection,
} from './normalizedProjection';
import type { NormalizedDraftOwner } from './normalizedAuthorizationUi';
import { hasPermission } from './permissions';
import {
  createNormalizedSupabaseClient,
  NormalizedRequestScope,
  StaleNormalizedResponseError,
  type NormalizedRequestToken,
} from './normalizedSupabaseClient';

type JsonObject = Record<string, unknown>;

interface PublicSupabaseConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  workspaceKey?: string;
  tableName?: string;
}

export interface NormalizedRuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  workspaceKey: string;
}

export interface SubmitDraftContext {
  lease: LeaseProof;
  projection: NormalizedApplicationProjection;
}

export interface MutationOutcome {
  committed: boolean;
  drafted: boolean;
}

export interface ManageUserRecoverySummary {
  entityKey: string;
  action: ManageUserAction;
  requiresPassword: boolean;
  targetUserId?: string;
}

export type ManageUserInput = JsonObject & {
  action: ManageUserAction;
  targetUserId?: string;
};

function requiredManageUserText(value: unknown, field: string, maximum = 128) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > maximum) {
    throw new NormalizedCommandError('invalid', `invalid-${field}`, '帳號管理內容不完整。');
  }
  return normalized;
}

function requiredManageUserPassword(value: unknown) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 12 || password.length > 256) {
    throw new NormalizedCommandError('invalid', 'invalid-password', '密碼必須為 12 至 256 字元。');
  }
  return password;
}

function durableManageUserResume(input: ManageUserInput): DurableManageUserResume {
  const action = input.action;
  if (action === 'create') {
    const role = requiredManageUserText(input.role, 'role', 32);
    if (!['admin', 'operator', 'vessel'].includes(role)) {
      throw new NormalizedCommandError('invalid', 'invalid-role', '帳號角色不正確。');
    }
    return {
      version: 1,
      action,
      input: {
        action,
        displayName: requiredManageUserText(input.displayName, 'display-name'),
        usernameLabel: requiredManageUserText(input.usernameLabel, 'username-label'),
        department: requiredManageUserText(input.department, 'department'),
        role,
      },
      requiresPassword: true,
    };
  }
  const targetUserId = requiredManageUserText(input.targetUserId, 'target-user-id', 256);
  if (action === 'change-role') {
    const role = requiredManageUserText(input.role, 'role', 32);
    if (!['admin', 'operator', 'vessel'].includes(role)) {
      throw new NormalizedCommandError('invalid', 'invalid-role', '帳號角色不正確。');
    }
    return {
      version: 1,
      action,
      input: { action, targetUserId, role },
      requiresPassword: false,
    };
  }
  if (!['disable', 'transfer-owner', 'reset-password'].includes(action)) {
    throw new NormalizedCommandError('invalid', 'invalid-action', '帳號管理操作不正確。');
  }
  return {
    version: 1,
    action,
    input: { action, targetUserId },
    requiresPassword: action === 'reset-password',
  };
}

export interface NormalizedRuntimeView {
  readonly projection: NormalizedApplicationProjection | null;
  readonly authorizationGeneration: number;
  readonly projectionGeneration: number;
}

export function readNormalizedRuntimeConfig(
  source: PublicSupabaseConfig | undefined = typeof window === 'undefined'
    ? undefined
    : window.SHIP_DYNAMICS_SUPABASE_CONFIG,
): NormalizedRuntimeConfig {
  const supabaseUrl = source?.supabaseUrl?.trim() || '';
  const supabaseAnonKey = source?.supabaseAnonKey?.trim() || '';
  const workspaceKey = source?.workspaceKey?.trim() || '';
  if (!supabaseUrl || !supabaseAnonKey || !workspaceKey) {
    throw new Error('缺少 Supabase 網址、瀏覽器憑證或工作區設定。');
  }
  return { supabaseUrl, supabaseAnonKey, workspaceKey };
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function entityParts(entityKey: string) {
  if (entityKey.startsWith('task-progress:')) {
    const [taskId, vesselId] = entityKey.slice('task-progress:'.length).split(':');
    return { entityType: 'task-progress', entityId: `${taskId}:${vesselId}` };
  }
  const separator = entityKey.indexOf(':');
  if (separator < 1 || separator === entityKey.length - 1) {
    throw new Error('The normalized entity key is invalid.');
  }
  return {
    entityType: entityKey.slice(0, separator),
    entityId: entityKey.slice(separator + 1),
  };
}

export class NormalizedApplicationRuntime {
  readonly config: NormalizedRuntimeConfig;
  readonly client: SupabaseClient;
  readonly scope: NormalizedRequestScope;
  readonly auth: NormalizedAuth;
  readonly repository: NormalizedRepository;
  readonly commands: NormalizedCommandClient;
  readonly projectionReader: NormalizedProjectionReader;

  #projection: NormalizedApplicationProjection | null = null;
  #directoryPasswordChange = false;
  #activationRequired = false;
  #unsubscribe: (() => Promise<void>) | null = null;
  #invalidationQueue = new Set<string>();
  #invalidationPromise: Promise<void> | null = null;
  #invalidationHandlers: {
    onProjection: (projection: NormalizedApplicationProjection) => void;
    onError: (error: Error) => void;
  } | null = null;
  #invalidationGeneration = 0;
  #authorizationGeneration = 0;
  #projectionGeneration = 0;
  #publicationRequestGeneration = 0;
  #view: NormalizedRuntimeView = Object.freeze({
    projection: null,
    authorizationGeneration: 0,
    projectionGeneration: 0,
  });
  #viewListeners = new Set<() => void>();

  constructor(
    config = readNormalizedRuntimeConfig(),
    client?: SupabaseClient,
  ) {
    this.config = config;
    this.client = client || createNormalizedSupabaseClient({
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      workspaceId: config.workspaceKey,
    });
    this.scope = new NormalizedRequestScope(config.workspaceKey);
    this.auth = new NormalizedAuth(this.client as never, this.scope, {
      onTransition: transition => this.#handleAuthTransition(transition),
    });
    this.repository = new NormalizedRepository(this.client as never, this.scope);
    this.commands = new NormalizedCommandClient(this.repository);
    this.projectionReader = new NormalizedProjectionReader(this.client as never, this.scope);
  }

  get projection() {
    return this.#projection;
  }

  get authorizationGeneration() {
    return this.#authorizationGeneration;
  }

  get projectionGeneration() {
    return this.#projectionGeneration;
  }

  getViewSnapshot = () => this.#view;

  subscribeView = (listener: () => void) => {
    this.#viewListeners.add(listener);
    return () => this.#viewListeners.delete(listener);
  };

  subscribeProjection(listener: (projection: NormalizedApplicationProjection | null) => void) {
    const notify = () => listener(this.#projection);
    this.#viewListeners.add(notify);
    return () => this.#viewListeners.delete(notify);
  }

  get activationRequired() {
    return this.#activationRequired;
  }

  async initialize(): Promise<Session | null> {
    const session = await this.auth.initialize();
    if (!session) return null;
    await this.#establishAuthenticatedWorkspace();
    return session;
  }

  unlockSite(password: string): Promise<SiteGateGrant> {
    return this.auth.unlockSite({
      workspaceKey: this.config.workspaceKey,
      password,
    });
  }

  getLoginDirectory(): Promise<LoginDirectoryPerson[]> {
    return this.auth.getLoginDirectory({ workspaceKey: this.config.workspaceKey });
  }

  async signIn(person: LoginDirectoryPerson, password: string) {
    const session = await this.auth.signInWithDirectoryPassword({
      authAlias: person.authAlias,
      password,
    });
    this.#directoryPasswordChange = person.mustChangePassword;
    await this.#establishAuthenticatedWorkspace();
    return session;
  }

  async activatePersonalPassword(password: string) {
    await this.auth.activatePersonalPassword(this.scope.workspaceId, password);
    this.#directoryPasswordChange = false;
    this.#activationRequired = await this.auth.passwordActivationRequired(
      this.scope.workspaceId,
    );
    if (this.#activationRequired) {
      throw new Error('伺服器仍要求完成個人密碼啟用。');
    }
  }

  async changePersonalPassword(password: string) {
    await this.auth.changePersonalPassword(password);
  }

  async signOut() {
    await this.auth.signOut();
  }

  async refreshAll() {
    const token = this.scope.capture();
    const authorizationGeneration = this.#authorizationGeneration;
    const publicationRequestGeneration = ++this.#publicationRequestGeneration;
    const projection = await this.projectionReader.fetchApplicationProjection();
    this.#assertPublicationCurrent(
      token,
      authorizationGeneration,
      publicationRequestGeneration,
    );
    this.#publishProjection(projection);
    return projection;
  }

  async refreshEntities(entityKeys: string[]) {
    if (!entityKeys.length) return this.#projection;
    const token = this.scope.capture();
    const authorizationGeneration = this.#authorizationGeneration;
    const publicationRequestGeneration = ++this.#publicationRequestGeneration;
    const projection = await this.projectionReader.refetchInvalidatedProjection(entityKeys);
    this.#assertPublicationCurrent(
      token,
      authorizationGeneration,
      publicationRequestGeneration,
    );
    this.#publishProjection(projection);
    return projection;
  }

  startInvalidations(
    onProjection: (projection: NormalizedApplicationProjection) => void,
    onError: (error: Error) => void,
  ) {
    this.#invalidationHandlers = { onProjection, onError };
    void this.#detachInvalidations();
    const generation = ++this.#invalidationGeneration;
    this.#unsubscribe = this.repository.subscribeInvalidations(keys => {
        if (generation !== this.#invalidationGeneration) return;
        const current = this.#projection;
        const visibleVesselId = current?.vesselAccount
          ? current.data.vessels[0]?.id || ''
          : '';
        const vesselTaskScopeVisible = current?.vesselAccount
          && keys.some(key => key.startsWith('task-progress:')
            && key.endsWith(`:${visibleVesselId}`));
        for (const key of keys) {
          if (current?.vesselAccount) {
            const allowed = current.allowedEntityKeys.has(key)
              || key.startsWith('notification:')
              || (vesselTaskScopeVisible && (
                key.startsWith('task:')
                || (key.startsWith('task-progress:') && key.endsWith(`:${visibleVesselId}`))
              ));
            if (!allowed) continue;
          }
          this.#invalidationQueue.add(key);
        }
        if (this.#invalidationPromise) return;
        this.#invalidationPromise = Promise.resolve().then(async () => {
          while (generation === this.#invalidationGeneration && this.#invalidationQueue.size) {
            const pending = [...this.#invalidationQueue];
            this.#invalidationQueue.clear();
            try {
              const projection = await this.refreshEntities(pending);
              if (generation === this.#invalidationGeneration && projection) onProjection(projection);
            } catch (error) {
              if (error instanceof StaleNormalizedResponseError) return;
              const safeError = this.#projection?.vesselAccount
                ? new Error('授權資料已變更，請重新整理。')
                : error instanceof Error ? error : new Error(String(error));
              if (generation === this.#invalidationGeneration) onError(safeError);
            }
          }
        }).finally(() => {
          if (generation === this.#invalidationGeneration) this.#invalidationPromise = null;
        });
      });
  }

  async stopInvalidations() {
    this.#invalidationHandlers = null;
    await this.#detachInvalidations();
  }

  saveDraft<TDraft extends JsonObject>(
    entityKey: string,
    draft: TDraft,
    baseVersions: Record<string, number>,
  ) {
    return this.repository.saveDraft(entityKey, draft, baseVersions);
  }

  loadDraft<TDraft = JsonObject>(entityKey: string): DurableDraftEnvelope<TDraft> | null {
    return this.repository.loadLocalState<TDraft>(entityKey);
  }

  listDrafts() {
    return this.repository.listLocalStates().filter(
      envelope => envelope.draft !== undefined || envelope.pendingOperation !== undefined,
    );
  }

  listManageUserRecoveries(): ManageUserRecoverySummary[] {
    const projection = this.#projection;
    if (!projection || projection.vesselAccount
        || !hasPermission(projection.data.settings.rolePermissions, projection.actor, 'manageUsers')) {
      return [];
    }
    const recoveries: ManageUserRecoverySummary[] = [];
    for (const envelope of this.repository.listLocalStates()) {
      const pending = envelope.pendingOperation;
      if (!pending?.manageUserResume) continue;
      try {
        const resume = parseDurableManageUserResume(
          pending.manageUserResume,
          pending.command,
          pending.targetKey,
        );
        const targetUserId = typeof resume.input.targetUserId === 'string'
          ? resume.input.targetUserId
          : undefined;
        if (targetUserId && !projection.data.users.some(account => account.id === targetUserId)) {
          continue;
        }
        recoveries.push({
          entityKey: envelope.entityKey,
          action: resume.action,
          requiresPassword: resume.requiresPassword,
          ...(targetUserId ? { targetUserId } : {}),
        });
      } catch {
        // Invalid local metadata remains fail-closed and is not rendered as an actionable recovery.
      }
    }
    return recoveries;
  }

  removeDraft(entityKey: string) {
    this.repository.removeDraft(entityKey);
  }

  removeOwnedDraft(owner: NormalizedDraftOwner) {
    this.repository.removeOwnedDraft(owner.workspaceId, owner.actorId, owner.entityKey);
  }

  async recoverPendingOperation(
    entityKey: string,
    options: { beforeReplay?: () => Promise<void> } = {},
  ): Promise<OperationStatus | null> {
    return this.repository.recoverPendingOperation(entityKey, {
      beforeReplay: options.beforeReplay || (async () => { await this.refreshAll(); }),
    });
  }

  async terminatePendingOperation(entityKey: string): Promise<OperationStatus | null> {
    const status = await this.repository.terminatePendingOperation(entityKey);
    if (status?.status === 'committed' || status?.status === 'rejected') {
      await this.refreshAll();
    }
    return status;
  }

  async runEntityMutation<TDraft extends JsonObject>(input: {
    entityKey: string;
    baseVersions: Record<string, number>;
    draft: TDraft;
    submit: (context: SubmitDraftContext) => Promise<unknown>;
    refreshKeys?: string[];
  }): Promise<MutationOutcome> {
    if (!online()) {
      this.saveDraft(input.entityKey, input.draft, input.baseVersions);
      return { committed: false, drafted: true };
    }

    const fresh = await this.refreshEntities([input.entityKey]);
    if (!fresh) throw new Error('The normalized projection is unavailable.');
    for (const [versionKey, expected] of Object.entries(input.baseVersions)) {
      if (!fresh.versions.has(versionKey) || fresh.versions.get(versionKey) !== expected) {
        throw new NormalizedCommandError(
          'version',
          'version-conflict',
          '資料已由其他使用者更新，請重新載入後再提交。',
        );
      }
    }
    const { entityType, entityId } = entityParts(input.entityKey);
    const grant = await this.commands.claimLease({
      leaseKey: input.entityKey,
      entityType,
      entityId,
    });
    const lease = leaseProof(grant);
    try {
      await input.submit({ lease, projection: fresh });
      await this.refreshEntities(input.refreshKeys || [input.entityKey]);
      return { committed: true, drafted: false };
    } finally {
      await this.commands.releaseLease(lease).catch(() => false);
    }
  }

  async manageUser(input: ManageUserInput) {
    const resume = durableManageUserResume(input);
    const password = resume.requiresPassword ? requiredManageUserPassword(input.password) : undefined;
    this.#assertManageUserRecoveryAuthority(resume);
    const operationId = this.commands.createOperationId();
    const command = `manage_user:${resume.action}`;
    const targetKey = typeof resume.input.targetUserId === 'string'
      ? `user:${resume.input.targetUserId}`
      : 'user:new';
    this.repository.rememberPendingOperation({
      entityKey: targetKey,
      operationId,
      command,
      targetKey,
      manageUserResume: resume,
    });
    return this.#dispatchManageUserResume(targetKey, operationId, resume, password);
  }

  async resumeManageUserRecovery(
    entityKey: string,
    password?: string,
  ): Promise<OperationStatus | null> {
    const local = this.loadDraft(entityKey);
    const pending = local?.pendingOperation;
    if (!pending?.manageUserResume) return null;
    let resume: DurableManageUserResume;
    try {
      resume = parseDurableManageUserResume(
        pending.manageUserResume,
        pending.command,
        pending.targetKey,
      );
    } catch {
      throw new NormalizedCommandError(
        'invalid',
        'manage-user-recovery-envelope-invalid',
        '本機帳號復原資料無效；未重播也未取消伺服器操作。',
        pending.operationId,
      );
    }
    this.#assertManageUserRecoveryAuthority(resume);
    let status = await this.repository.getOperationStatus(pending.operationId);
    this.#assertManageUserStatusIdentity(pending, status);
    if (status?.status === 'committed' || status?.status === 'rejected') {
      this.repository.resolvePendingOperation(entityKey, status);
      await this.refreshAll();
      return status;
    }
    if (status?.status !== 'prepared' && status?.status !== 'recovery_required') {
      throw new NormalizedCommandError(
        'permission',
        'operation-status-unavailable',
        '目前登入身分無法確認先前帳號操作；未重播也未取消。',
        pending.operationId,
      );
    }
    if (resume.requiresPassword && (!password || password.length < 12 || password.length > 256)) {
      throw new NormalizedCommandError(
        'invalid',
        'manage-user-password-reentry-required',
        '請重新輸入原操作密碼以完成復原。',
        pending.operationId,
      );
    }
    await this.refreshAll();
    this.#assertManageUserRecoveryAuthority(resume);
    status = await this.repository.getOperationStatus(pending.operationId);
    this.#assertManageUserStatusIdentity(pending, status);
    if (status?.status === 'committed' || status?.status === 'rejected') {
      this.repository.resolvePendingOperation(entityKey, status);
      return status;
    }
    if (status?.status !== 'prepared' && status?.status !== 'recovery_required') {
      throw new NormalizedCommandError(
        'permission',
        'operation-status-unavailable',
        '目前登入身分無法確認先前帳號操作；未重播也未取消。',
        pending.operationId,
      );
    }
    return this.#dispatchManageUserResume(entityKey, pending.operationId, resume, password);
  }

  #assertManageUserRecoveryAuthority(resume: DurableManageUserResume) {
    const projection = this.#projection;
    let token;
    try {
      token = this.scope.capture();
    } catch {
      throw new NormalizedCommandError(
        'permission',
        'manage-user-recovery-not-authorized',
        '目前登入身分沒有帳號復原權限。',
      );
    }
    if (!projection
        || projection.workspaceId !== token.workspaceId
        || projection.actor.id !== token.actorId
        || projection.vesselAccount
        || !hasPermission(projection.data.settings.rolePermissions, projection.actor, 'manageUsers')) {
      throw new NormalizedCommandError(
        'permission',
        'manage-user-recovery-not-authorized',
        '目前登入身分沒有帳號復原權限。',
      );
    }
    const targetUserId = resume.input.targetUserId;
    if (typeof targetUserId === 'string'
        && !projection.data.users.some(account => account.id === targetUserId)) {
      throw new NormalizedCommandError(
        'permission',
        'manage-user-recovery-target-unavailable',
        '目前授權投影無法確認帳號復原目標。',
      );
    }
  }

  #assertManageUserStatusIdentity(
    pending: NonNullable<DurableDraftEnvelope['pendingOperation']>,
    status: OperationStatus | null,
  ) {
    if (!status) return;
    if (status.command !== pending.command || status.targetKey !== pending.targetKey) {
      throw new NormalizedCommandError(
        'invalid',
        'operation-recovery-mismatch',
        '本機復原資料與伺服器操作識別不一致，已停止復原且未取消伺服器操作。',
        pending.operationId,
      );
    }
  }

  async #dispatchManageUserResume(
    entityKey: string,
    operationId: string,
    resume: DurableManageUserResume,
    password?: unknown,
  ): Promise<OperationStatus> {
    const body: JsonObject = {
      ...resume.input,
      ...(resume.requiresPassword ? { password } : {}),
      workspaceId: this.scope.workspaceId,
      operationId,
    };
    const response = await this.client.functions.invoke('manage-user', { body });
    let terminal = await this.repository.getOperationStatus(operationId).catch(() => null);
    if (terminal) {
      const pending = this.loadDraft(entityKey)?.pendingOperation;
      if (pending) this.#assertManageUserStatusIdentity(pending, terminal);
    }
    if (terminal?.status === 'committed' || terminal?.status === 'rejected') {
      this.repository.resolvePendingOperation(entityKey, terminal);
      await this.refreshAll();
      if (terminal.status === 'rejected') {
        throw new NormalizedCommandError(
          'rejected',
          terminal.errorCode || 'operation-rejected',
          '帳號管理操作已被伺服器拒絕。',
          operationId,
        );
      }
      return terminal;
    }
    if (response.error) {
      throw new NormalizedCommandError(
        'recovery',
        terminal?.errorCode || 'manage-user-recovery-required',
        '帳號服務結果尚未確認，請使用保留的操作編號完成復原。',
        operationId,
      );
    }
    terminal = await this.repository.getOperationStatus(operationId).catch(() => null);
    if (terminal?.status === 'committed' || terminal?.status === 'rejected') {
      this.repository.resolvePendingOperation(entityKey, terminal);
      await this.refreshAll();
      return terminal;
    }
    throw new NormalizedCommandError(
      'recovery',
      terminal?.errorCode || 'manage-user-terminal-status-required',
      '帳號服務尚未提供可確認的最終狀態；已保留操作編號。',
      operationId,
    );
  }

  #handleAuthTransition(transition: NormalizedAuthTransition) {
    if (!transition.authorityChanged) {
      const handlers = this.#invalidationHandlers;
      if (handlers) this.startInvalidations(handlers.onProjection, handlers.onError);
      return;
    }
    this.#authorizationGeneration += 1;
    this.#publicationRequestGeneration += 1;
    this.#directoryPasswordChange = false;
    this.#activationRequired = false;
    this.#invalidationHandlers = null;
    void this.#detachInvalidations();
    this.#publishProjection(null);
  }

  #assertPublicationCurrent(
    token: NormalizedRequestToken,
    authorizationGeneration: number,
    publicationRequestGeneration: number,
  ) {
    this.scope.assertCurrent(token);
    if (authorizationGeneration !== this.#authorizationGeneration
       || publicationRequestGeneration !== this.#publicationRequestGeneration) {
      throw new StaleNormalizedResponseError();
    }
  }

  #publishProjection(projection: NormalizedApplicationProjection | null) {
    this.#projection = projection;
    this.#projectionGeneration += 1;
    this.#view = Object.freeze({
      projection,
      authorizationGeneration: this.#authorizationGeneration,
      projectionGeneration: this.#projectionGeneration,
    });
    for (const listener of [...this.#viewListeners]) listener();
  }

  #detachInvalidations(): Promise<void> {
    this.#invalidationGeneration += 1;
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = null;
    this.#invalidationQueue.clear();
    this.#invalidationPromise = null;
    if (!unsubscribe) return Promise.resolve();
    try {
      return Promise.resolve(unsubscribe()).then(() => undefined);
    } catch {
      return Promise.resolve();
    }
  }

  async #establishAuthenticatedWorkspace() {
    const authorizationGeneration = this.#authorizationGeneration;
    await this.repository.resolveWorkspaceByLegacyKey(this.config.workspaceKey);
    if (authorizationGeneration !== this.#authorizationGeneration) {
      throw new StaleNormalizedResponseError();
    }
    this.#activationRequired = this.#directoryPasswordChange
      || await this.auth.passwordActivationRequired(this.scope.workspaceId);
    if (authorizationGeneration !== this.#authorizationGeneration) {
      throw new StaleNormalizedResponseError();
    }
    await this.refreshAll();
  }
}

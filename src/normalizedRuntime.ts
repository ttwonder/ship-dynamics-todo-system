import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { NormalizedAuth, type LoginDirectoryPerson, type SiteGateGrant } from './normalizedAuth';
import { NormalizedCommandClient, leaseProof, type LeaseProof } from './normalizedCommands';
import {
  NormalizedCommandError,
  NormalizedRepository,
  type DurableDraftEnvelope,
  type OperationStatus,
} from './normalizedRepository';
import {
  NormalizedProjectionReader,
  type NormalizedApplicationProjection,
} from './normalizedProjection';
import {
  createNormalizedSupabaseClient,
  NormalizedRequestScope,
  StaleNormalizedResponseError,
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
    this.auth = new NormalizedAuth(this.client as never, this.scope);
    this.repository = new NormalizedRepository(this.client as never, this.scope);
    this.commands = new NormalizedCommandClient(this.repository);
    this.projectionReader = new NormalizedProjectionReader(this.client as never, this.scope);
  }

  get projection() {
    return this.#projection;
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
    await this.stopInvalidations();
    this.#projection = null;
    this.#directoryPasswordChange = false;
    this.#activationRequired = false;
    await this.auth.signOut();
  }

  async refreshAll() {
    this.#projection = await this.projectionReader.fetchApplicationProjection();
    return this.#projection;
  }

  async refreshEntities(entityKeys: string[]) {
    if (!entityKeys.length) return this.#projection;
    const projection = await this.projectionReader.refetchInvalidatedProjection(entityKeys);
    this.#projection = projection;
    return projection;
  }

  startInvalidations(
    onProjection: (projection: NormalizedApplicationProjection) => void,
    onError: (error: Error) => void,
  ) {
    void this.stopInvalidations().then(() => {
      this.#unsubscribe = this.repository.subscribeInvalidations(keys => {
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
          while (this.#invalidationQueue.size) {
            const pending = [...this.#invalidationQueue];
            this.#invalidationQueue.clear();
            try {
              const projection = await this.refreshEntities(pending);
              if (projection) onProjection(projection);
            } catch (error) {
              if (error instanceof StaleNormalizedResponseError) return;
              const safeError = this.#projection?.vesselAccount
                ? new Error('授權資料已變更，請重新整理。')
                : error instanceof Error ? error : new Error(String(error));
              onError(safeError);
            }
          }
        }).finally(() => {
          this.#invalidationPromise = null;
        });
      });
    });
  }

  async stopInvalidations() {
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = null;
    this.#invalidationQueue.clear();
    if (unsubscribe) await unsubscribe();
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
    return this.repository.listLocalStates().filter(envelope => envelope.draft !== undefined);
  }

  removeDraft(entityKey: string) {
    this.repository.removeDraft(entityKey);
  }

  async recoverPendingOperation(entityKey: string): Promise<OperationStatus | null> {
    const local = this.repository.loadLocalState(entityKey);
    const operationId = local?.pendingOperation?.operationId;
    if (!operationId) return null;
    const status = await this.repository.getOperationStatus(operationId);
    this.repository.resolvePendingOperation(entityKey, status);
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

  async manageUser(input: JsonObject & {
    action: 'create' | 'disable' | 'change-role' | 'transfer-owner' | 'reset-password';
    targetUserId?: string;
  }) {
    if (!this.#projection) throw new Error('The normalized projection is unavailable.');
    const operationId = this.commands.createOperationId();
    const command = `manage_user:${input.action}`;
    const targetKey = input.targetUserId
      ? `user:${input.targetUserId}`
      : 'user:new';
    const reservationRequest = {
      ...Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== 'password'),
      ),
      targetUserId: input.targetUserId || null,
    };
    const reservation = await this.repository.reserveOperation({
      operationId,
      command,
      targetKey,
      request: reservationRequest,
    });
    if (reservation.status === 'rejected') {
      throw new NormalizedCommandError(
        'rejected',
        reservation.errorCode || 'operation-rejected',
        '帳號管理操作已被伺服器拒絕。',
        operationId,
      );
    }
    const response = await this.client.functions.invoke('manage-user', {
      body: {
        ...input,
        workspaceId: this.scope.workspaceId,
        operationId,
      },
    });
    if (response.error) {
      const recovered = await this.repository.getOperationStatus(operationId).catch(() => null);
      if (recovered?.status !== 'committed') {
        throw new NormalizedCommandError(
          'recovery',
          'manage-user-recovery-required',
          '帳號服務結果尚未確認，請以相同操作編號進行復原。',
          operationId,
        );
      }
    }
    await this.refreshAll();
    return response.data;
  }

  async #establishAuthenticatedWorkspace() {
    await this.repository.resolveWorkspaceByLegacyKey(this.config.workspaceKey);
    this.#activationRequired = this.#directoryPasswordChange
      || await this.auth.passwordActivationRequired(this.scope.workspaceId);
    this.#projection = await this.projectionReader.fetchApplicationProjection();
  }
}

import {
  getSupabaseClient,
  getSupabaseConfig,
  type ResolvedSupabaseConfig,
} from './cloud';

export type DataCollectionKey =
  | 'settings'
  | 'users'
  | 'vessels'
  | 'tasks'
  | 'internalControlCases'
  | 'meetings'
  | 'agendaReports'
  | 'taskDismissals'
  | 'auditLogs'
  | 'notifications';

export interface StorageRevisionRow {
  revision: number;
  savedAt: string;
  savedBy: string;
  logicalBytes: number;
  current: boolean;
}

export interface StorageCollectionRow {
  key: DataCollectionKey;
  label: string;
  itemCount: number;
  logicalBytes: number;
}

export interface StorageItemRow {
  collectionKey: Exclude<DataCollectionKey, 'settings'>;
  collectionLabel: string;
  id: string;
  label: string;
  logicalBytes: number;
}

export interface ShipDynamicsStorageStats {
  ok: true;
  generatedAt: string;
  databaseTotalBytes: number;
  appDatabasePhysicalBytes: number;
  storageObjectBytes: number;
  storageObjectCount: number;
  currentStateBytes: number;
  currentRevision: number;
  revisionHistoryBytes: number;
  revisionHistoryCount: number;
  staticSiteHost: string;
  staticSiteInSupabase: false;
  revisions: StorageRevisionRow[];
  collections: StorageCollectionRow[];
  items: StorageItemRow[];
  logicalMetric: 'current_content_and_revision_history';
}

export interface RevisionPruneRequest {
  operationId: string;
  actorUserId: string;
  expectedRevisions: number[];
  deleteRevisions: number[];
}

export interface RevisionPruneResult {
  ok: true;
  operationId: string;
  deletedCount: number;
  deletedBytes: number;
  deletedRevisions: number[];
  remainingRevisionCount: number;
  currentRevision: number;
}

export interface PendingRevisionPrune extends RevisionPruneRequest {
  version: 1;
  configIdentity: string;
  workspaceKey: string;
  createdAt: string;
}

export class DataManagementRpcError extends Error {
  readonly code: string;
  readonly definitive: boolean;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, definitive = false, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DataManagementRpcError';
    this.code = code;
    this.definitive = definitive;
    this.details = details;
  }
}

const PENDING_PREFIX = 'ship-dynamics-data-management-prune:v1:';
const RPC_TIMEOUT_MS = 25_000;
const CANONICAL_STATE_TABLE = 'ship_dynamics_app_state';

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asText = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const asNonNegativeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const asInteger = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const integerSet = (value: unknown) => Array.from(new Set(asArray(value)
  .map(asInteger)
  .filter(revision => revision > 0)))
  .sort((left, right) => left - right);

export function formatDataBytes(value: number) {
  const bytes = Math.max(0, Number.isFinite(value) ? value : 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let amount = bytes / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const decimals = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
}

export function dataManagementErrorMessage(error: unknown) {
  const code = error instanceof DataManagementRpcError ? error.code : '';
  const map: Record<string, string> = {
    CLOUD_NOT_CONFIGURED: '尚未配置 Supabase，無法讀取雲端用量。',
    NON_CANONICAL_STATE_TABLE: '數據管理只支援正式 ship_dynamics_app_state 資料表。',
    DATA_MANAGEMENT_SQL_NOT_DEPLOYED: 'Supabase 數據管理 SQL 尚未部署。請先執行本次 migration。',
    FORBIDDEN: '目前身份無權讀取數據管理統計。',
    OWNER_REQUIRED: '只有 Owner 可以刪除歷史版本。',
    WORKSPACE_NOT_FOUND: 'Supabase 找不到目前工作區。',
    INVALID_PAYLOAD: '刪除選擇無效，未執行任何刪除。',
    IDEMPOTENCY_MISMATCH: '上次操作識別碼與本次選擇不一致，已停止。',
    REVISION_SET_CHANGED: '預覽後歷史版本集合已變更；本次未刪除，請刷新後重新選擇。',
    CURRENT_REVISION_PROTECTED: '目前正式 Revision 必須保留，未執行刪除。',
    CURRENT_REVISION_HISTORY_MISSING: '目前正式 Revision 的歷史列缺失；為避免誤刪，已停止。',
    BATCH_LIMIT_EXCEEDED: '單次最多刪除 100 份歷史版本；本次未刪除，請只勾選目前一頁。',
    PRUNE_BATCH_TIMEOUT: '歷史版本刪除逾時，結果尚未確認；請勿建立新刪除，應使用同一 operation 對帳。',
    '57014': 'Supabase 空間統計逾時；未刪除任何資料。請先套用數據管理效能修補 SQL，再重新刷新。',
    RPC_TIMEOUT: '連線逾時，刪除結果尚未確認；請使用「對帳上次操作」。',
  };
  if (code && map[code]) return map[code];
  if (error instanceof Error && error.message) return error.message;
  return '數據管理操作失敗。';
}

function currentConfig(config?: ResolvedSupabaseConfig | null) {
  const resolved = config === undefined ? getSupabaseConfig() : config;
  if (!resolved) throw new DataManagementRpcError('CLOUD_NOT_CONFIGURED', 'Supabase is not configured', true);
  if (resolved.tableName !== CANONICAL_STATE_TABLE) {
    throw new DataManagementRpcError('NON_CANONICAL_STATE_TABLE', `Unsupported state table: ${resolved.tableName}`, true);
  }
  return resolved;
}

export function dataManagementConfigIdentity(config: ResolvedSupabaseConfig) {
  let origin = config.supabaseUrl.trim().replace(/\/+$/, '');
  try { origin = new URL(config.supabaseUrl).origin; } catch { /* keep the normalized URL */ }
  return `${origin}|${config.workspaceKey}|${config.tableName}`;
}

async function runRpc(
  name: string,
  params: Record<string, unknown>,
  config?: ResolvedSupabaseConfig | null,
): Promise<Record<string, unknown>> {
  const resolved = currentConfig(config);
  const supabase = getSupabaseClient(resolved);
  if (!supabase) throw new DataManagementRpcError('CLOUD_NOT_CONFIGURED', 'Supabase client is unavailable', true);
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const { data, error } = await supabase.rpc(name, params).abortSignal(controller.signal);
    if (error) {
      const code = String((error as { code?: unknown }).code || 'RPC_FAILED');
      if (code === 'PGRST202' || code === '42883') {
        throw new DataManagementRpcError('DATA_MANAGEMENT_SQL_NOT_DEPLOYED', error.message, true);
      }
      throw new DataManagementRpcError(code, error.message || code, false);
    }
    const response = asObject(data);
    if (response.ok !== true) {
      const code = asText(response.error || response.code, 'INVALID_RESPONSE');
      throw new DataManagementRpcError(code, code, true, response);
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted) throw new DataManagementRpcError('RPC_TIMEOUT', 'RPC timeout', false);
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function getShipDynamicsStorageStats(
  actorUserId: string,
  config?: ResolvedSupabaseConfig | null,
): Promise<ShipDynamicsStorageStats> {
  const resolved = currentConfig(config);
  const response = await runRpc('get_ship_dynamics_storage_stats', {
    p_workspace_key: resolved.workspaceKey,
    p_actor_user_id: actorUserId,
  }, resolved);

  const revisions = asArray(response.revisions).map(value => {
    const row = asObject(value);
    return {
      revision: asInteger(row.revision),
      savedAt: asText(row.savedAt),
      savedBy: asText(row.savedBy, '未記錄'),
      logicalBytes: asNonNegativeNumber(row.logicalBytes),
      current: row.current === true,
    } satisfies StorageRevisionRow;
  }).filter(row => row.revision > 0).sort((left, right) => right.revision - left.revision);

  const collections = asArray(response.collections).map(value => {
    const row = asObject(value);
    return {
      key: asText(row.key) as DataCollectionKey,
      label: asText(row.label),
      itemCount: asInteger(row.itemCount),
      logicalBytes: asNonNegativeNumber(row.logicalBytes),
    } satisfies StorageCollectionRow;
  }).filter(row => row.key && row.label);

  const items = asArray(response.items).map(value => {
    const row = asObject(value);
    return {
      collectionKey: asText(row.collectionKey) as StorageItemRow['collectionKey'],
      collectionLabel: asText(row.collectionLabel),
      id: asText(row.id),
      label: asText(row.label, asText(row.id, '未命名資料')),
      logicalBytes: asNonNegativeNumber(row.logicalBytes),
    } satisfies StorageItemRow;
  }).filter(row => row.collectionKey && row.id);

  return {
    ok: true,
    generatedAt: asText(response.generatedAt),
    databaseTotalBytes: asNonNegativeNumber(response.databaseTotalBytes),
    appDatabasePhysicalBytes: asNonNegativeNumber(response.appDatabasePhysicalBytes),
    storageObjectBytes: asNonNegativeNumber(response.storageObjectBytes),
    storageObjectCount: asInteger(response.storageObjectCount),
    currentStateBytes: asNonNegativeNumber(response.currentStateBytes),
    currentRevision: asInteger(response.currentRevision),
    revisionHistoryBytes: asNonNegativeNumber(response.revisionHistoryBytes),
    revisionHistoryCount: asInteger(response.revisionHistoryCount),
    staticSiteHost: asText(response.staticSiteHost, 'GitHub Pages'),
    staticSiteInSupabase: false,
    revisions,
    collections,
    items,
    logicalMetric: 'current_content_and_revision_history',
  };
}

export async function pruneShipDynamicsRevisionHistory(
  request: RevisionPruneRequest,
  config?: ResolvedSupabaseConfig | null,
): Promise<RevisionPruneResult> {
  const resolved = currentConfig(config);
  let response: Record<string, unknown>;
  try {
    response = await runRpc('prune_ship_dynamics_revision_history', {
      p_workspace_key: resolved.workspaceKey,
      p_actor_user_id: request.actorUserId,
      p_operation_id: request.operationId,
      p_expected_revisions: integerSet(request.expectedRevisions),
      p_delete_revisions: integerSet(request.deleteRevisions),
    }, resolved);
  } catch (error) {
    if (error instanceof DataManagementRpcError && error.code === '57014') {
      throw new DataManagementRpcError('PRUNE_BATCH_TIMEOUT', error.message, false, error.details);
    }
    throw error;
  }
  return {
    ok: true,
    operationId: asText(response.operationId, request.operationId),
    deletedCount: asInteger(response.deletedCount),
    deletedBytes: asNonNegativeNumber(response.deletedBytes),
    deletedRevisions: integerSet(response.deletedRevisions),
    remainingRevisionCount: asInteger(response.remainingRevisionCount),
    currentRevision: asInteger(response.currentRevision),
  };
}

function pendingKey(config: ResolvedSupabaseConfig, actorUserId: string) {
  return `${PENDING_PREFIX}${encodeURIComponent(dataManagementConfigIdentity(config))}:${encodeURIComponent(actorUserId)}`;
}

export function createPendingRevisionPrune(
  request: RevisionPruneRequest,
  config: ResolvedSupabaseConfig,
): PendingRevisionPrune {
  return {
    version: 1,
    configIdentity: dataManagementConfigIdentity(config),
    workspaceKey: config.workspaceKey,
    createdAt: new Date().toISOString(),
    operationId: request.operationId,
    actorUserId: request.actorUserId,
    expectedRevisions: integerSet(request.expectedRevisions),
    deleteRevisions: integerSet(request.deleteRevisions),
  };
}

export function readPendingRevisionPrune(
  config: ResolvedSupabaseConfig,
  actorUserId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): PendingRevisionPrune | null {
  try {
    const raw = storage.getItem(pendingKey(config, actorUserId));
    if (!raw) return null;
    const parsed = asObject(JSON.parse(raw));
    const pending: PendingRevisionPrune = {
      version: 1,
      configIdentity: asText(parsed.configIdentity),
      workspaceKey: asText(parsed.workspaceKey),
      createdAt: asText(parsed.createdAt),
      operationId: asText(parsed.operationId),
      actorUserId: asText(parsed.actorUserId),
      expectedRevisions: integerSet(parsed.expectedRevisions),
      deleteRevisions: integerSet(parsed.deleteRevisions),
    };
    if (parsed.version !== 1
      || pending.configIdentity !== dataManagementConfigIdentity(config)
      || pending.workspaceKey !== config.workspaceKey
      || pending.actorUserId !== actorUserId
      || !pending.operationId
      || !pending.expectedRevisions.length
      || !pending.deleteRevisions.length) return null;
    return pending;
  } catch {
    return null;
  }
}

export function writePendingRevisionPrune(
  pending: PendingRevisionPrune,
  config: ResolvedSupabaseConfig,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
) {
  storage.setItem(pendingKey(config, pending.actorUserId), JSON.stringify(pending));
}

export function clearPendingRevisionPrune(
  config: ResolvedSupabaseConfig,
  actorUserId: string,
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
) {
  storage.removeItem(pendingKey(config, actorUserId));
}

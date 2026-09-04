import { getSupabaseClient, getSupabaseConfig, type ResolvedSupabaseConfig } from './cloud';
import type { ItineraryRow } from './itinerary/itineraryTypes';

export const ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE = 100;
const RPC_TIMEOUT_MS = 25_000;
const PENDING_DELETE_PREFIX = 'ship-dynamics-daily-itinerary-report-delete:v1:';

export interface ItineraryDailyReportSummary {
  businessDate: string;
  timezone: 'Asia/Taipei';
  generatedAt: string;
  generatedBy: 'scheduled';
  vesselCount: number;
  rowCount: number;
  sourceMaxRevision: number;
  logicalBytes: number;
}

export interface ItineraryDailyReportVesselSnapshot {
  vesselId: string;
  vesselName: string;
  revision: number;
  updatedAt: string | null;
  rows: ItineraryRow[];
}

export interface ItineraryDailyReportSnapshot {
  schemaVersion: 1;
  businessDate: string;
  timezone: 'Asia/Taipei';
  generatedAt: string;
  vesselCount: number;
  rowCount: number;
  sourceMaxRevision: number;
  vessels: ItineraryDailyReportVesselSnapshot[];
}

export interface ItineraryDailyReport extends ItineraryDailyReportSummary {
  snapshot: ItineraryDailyReportSnapshot;
}

export interface ItineraryDailyReportDeleteRequest {
  operationId: string;
  actorUserId: string;
  expectedDates: string[];
  deleteDates: string[];
}

export interface ItineraryDailyReportDeleteResult {
  ok: true;
  operationId: string;
  deletedCount: number;
  deletedBytes: number;
  deletedDates: string[];
  remainingReportCount: number;
}

export interface PendingItineraryDailyReportDelete extends ItineraryDailyReportDeleteRequest {
  version: 1;
  configIdentity: string;
  workspaceKey: string;
  createdAt: string;
}

export class ItineraryDailyReportRpcError extends Error {
  readonly code: string;
  readonly definitive: boolean;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, definitive = false, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ItineraryDailyReportRpcError';
    this.code = code;
    this.definitive = definitive;
    this.details = details;
  }
}

type RpcResponse = { data: unknown; error: unknown };
export type ItineraryDailyReportRpcClient = {
  rpc: (name: string, params: Record<string, unknown>) =>
    | Promise<RpcResponse>
    | { abortSignal?: (signal: AbortSignal) => Promise<RpcResponse> };
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asText = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asNonNegativeInteger = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};
const isBusinessDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const strictDateSet = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !isBusinessDate(item))) return null;
  const unique = new Set(value);
  return unique.size === value.length ? Array.from(unique).sort() : null;
};

function requiredConfig(config?: ResolvedSupabaseConfig | null): ResolvedSupabaseConfig {
  const resolved = config === undefined ? getSupabaseConfig() : config;
  if (!resolved) throw new ItineraryDailyReportRpcError('CLOUD_NOT_CONFIGURED', 'Supabase 尚未配置。', true);
  return resolved;
}

function errorText(error: unknown): string {
  const value = asObject(error);
  return [value.message, value.details, value.hint, value.code].filter(Boolean).join(' ') || 'RPC failed';
}

async function runRpc(
  name: string,
  params: Record<string, unknown>,
  config?: ResolvedSupabaseConfig | null,
  suppliedClient?: ItineraryDailyReportRpcClient | null,
): Promise<Record<string, unknown>> {
  const resolved = requiredConfig(config);
  const client = suppliedClient || getSupabaseClient(resolved) as unknown as ItineraryDailyReportRpcClient | null;
  if (!client) throw new ItineraryDailyReportRpcError('CLOUD_NOT_CONFIGURED', 'Supabase client 不可用。', true);
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const request = client.rpc(name, params);
    const response = typeof (request as { abortSignal?: unknown }).abortSignal === 'function'
      ? await (request as { abortSignal: (signal: AbortSignal) => Promise<RpcResponse> }).abortSignal(controller.signal)
      : await request as RpcResponse;
    if (response.error) {
      const providerCode = asText(asObject(response.error).code, 'RPC_FAILED');
      if (providerCode === 'PGRST202' || providerCode === '42883') {
        throw new ItineraryDailyReportRpcError(
          'DAILY_ITINERARY_REPORTS_SQL_NOT_DEPLOYED',
          'Daily Itinerary reports migration 尚未部署。',
          true,
        );
      }
      throw new ItineraryDailyReportRpcError(providerCode, errorText(response.error), false);
    }
    const value = asObject(response.data);
    if (value.ok !== true) {
      const code = asText(value.error || value.code, 'INVALID_RESPONSE');
      throw new ItineraryDailyReportRpcError(code, code, true, value);
    }
    return value;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ItineraryDailyReportRpcError('RPC_TIMEOUT', 'Daily Itinerary report RPC timeout', false);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function parseSummary(value: unknown): ItineraryDailyReportSummary {
  const row = asObject(value);
  const businessDate = asText(row.businessDate);
  const timezone = asText(row.timezone);
  const generatedAt = asText(row.generatedAt);
  if (!isBusinessDate(businessDate) || timezone !== 'Asia/Taipei' || !generatedAt) {
    throw new Error('每日 Itinerary 報告 metadata 格式不正確。');
  }
  return {
    businessDate,
    timezone: 'Asia/Taipei',
    generatedAt,
    generatedBy: 'scheduled',
    vesselCount: asNonNegativeInteger(row.vesselCount),
    rowCount: asNonNegativeInteger(row.rowCount),
    sourceMaxRevision: asNonNegativeInteger(row.sourceMaxRevision),
    logicalBytes: asNonNegativeInteger(row.logicalBytes),
  };
}

function parseSnapshot(value: unknown, expected: ItineraryDailyReportSummary): ItineraryDailyReportSnapshot {
  const snapshot = asObject(value);
  if (snapshot.schemaVersion !== 1
    || snapshot.businessDate !== expected.businessDate
    || snapshot.timezone !== 'Asia/Taipei'
    || !Array.isArray(snapshot.vessels)) {
    throw new Error('每日 Itinerary 快照格式不正確。');
  }
  const seen = new Set<string>();
  const vessels = snapshot.vessels.map(rawValue => {
    const raw = asObject(rawValue);
    const vesselId = asText(raw.vesselId);
    const vesselName = asText(raw.vesselName);
    if (!vesselId || !vesselName || seen.has(vesselId) || !Array.isArray(raw.rows)) {
      throw new Error('每日 Itinerary 快照格式不正確。');
    }
    seen.add(vesselId);
    const rows = raw.rows.map(rawRow => {
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
        throw new Error('每日 Itinerary 快照格式不正確。');
      }
      return structuredClone(rawRow) as ItineraryRow;
    });
    return {
      vesselId,
      vesselName,
      revision: asNonNegativeInteger(raw.revision),
      updatedAt: raw.updatedAt === null ? null : asText(raw.updatedAt) || null,
      rows,
    } satisfies ItineraryDailyReportVesselSnapshot;
  });
  const rowCount = vessels.reduce((total, vessel) => total + vessel.rows.length, 0);
  if (vessels.length !== expected.vesselCount || rowCount !== expected.rowCount) {
    throw new Error('每日 Itinerary 快照格式不正確。');
  }
  return {
    schemaVersion: 1,
    businessDate: expected.businessDate,
    timezone: 'Asia/Taipei',
    generatedAt: asText(snapshot.generatedAt, expected.generatedAt),
    vesselCount: vessels.length,
    rowCount,
    sourceMaxRevision: asNonNegativeInteger(snapshot.sourceMaxRevision),
    vessels,
  };
}

export async function listItineraryDailyReports(
  actorUserId: string,
  config?: ResolvedSupabaseConfig | null,
  client?: ItineraryDailyReportRpcClient | null,
): Promise<ItineraryDailyReportSummary[]> {
  const resolved = requiredConfig(config);
  const response = await runRpc('sd_itinerary_daily_report_list', {
    p_workspace_key: resolved.workspaceKey,
    p_actor_user_id: actorUserId,
  }, resolved, client);
  return asArray(response.reports).map(parseSummary)
    .sort((left, right) => right.businessDate.localeCompare(left.businessDate));
}

export async function loadItineraryDailyReport(
  businessDate: string,
  actorUserId: string,
  config?: ResolvedSupabaseConfig | null,
  client?: ItineraryDailyReportRpcClient | null,
): Promise<ItineraryDailyReport> {
  if (!isBusinessDate(businessDate)) throw new Error('每日 Itinerary 報告日期格式不正確。');
  const resolved = requiredConfig(config);
  const response = await runRpc('sd_itinerary_daily_report_load', {
    p_workspace_key: resolved.workspaceKey,
    p_business_date: businessDate,
    p_actor_user_id: actorUserId,
  }, resolved, client);
  const reportValue = asObject(response.report);
  const summary = parseSummary(reportValue);
  return { ...summary, snapshot: parseSnapshot(reportValue.snapshot, summary) };
}

export async function deleteItineraryDailyReports(
  request: PendingItineraryDailyReportDelete,
  config?: ResolvedSupabaseConfig | null,
  client?: ItineraryDailyReportRpcClient | null,
): Promise<ItineraryDailyReportDeleteResult> {
  const resolved = requiredConfig(config);
  if (request.version !== 1
    || request.configIdentity !== configIdentity(resolved)
    || request.workspaceKey !== resolved.workspaceKey
    || !request.actorUserId) {
    throw new ItineraryDailyReportRpcError(
      'DELETE_CONTEXT_CHANGED',
      'Daily Itinerary delete context changed before submit.',
      true,
    );
  }
  const expectedDates = strictDateSet(request.expectedDates);
  const deleteDates = strictDateSet(request.deleteDates);
  if (!expectedDates || !deleteDates || deleteDates.some(date => !expectedDates.includes(date))) {
    throw new ItineraryDailyReportRpcError(
      'INVALID_DELETE_ENVELOPE',
      'Daily Itinerary delete dates are invalid or no longer exact.',
      true,
    );
  }
  const response = await runRpc('delete_sd_itinerary_daily_reports', {
    p_workspace_key: resolved.workspaceKey,
    p_actor_user_id: request.actorUserId,
    p_operation_id: request.operationId,
    p_expected_dates: expectedDates,
    p_delete_dates: deleteDates,
  }, resolved, client);
  const operationId = asText(response.operationId);
  const deletedDates = strictDateSet(response.deletedDates);
  const deletedCount = asNonNegativeInteger(response.deletedCount);
  if (operationId !== request.operationId
    || !deletedDates
    || deletedCount !== deletedDates.length
    || JSON.stringify(deletedDates) !== JSON.stringify(deleteDates)) {
    throw new ItineraryDailyReportRpcError(
      'INVALID_RESPONSE',
      'Daily Itinerary delete receipt did not match the submitted operation.',
      false,
    );
  }
  return {
    ok: true,
    operationId,
    deletedCount,
    deletedBytes: asNonNegativeInteger(response.deletedBytes),
    deletedDates,
    remainingReportCount: asNonNegativeInteger(response.remainingReportCount),
  };
}

export function itineraryDailyReportErrorMessage(error: unknown): string {
  const code = error instanceof ItineraryDailyReportRpcError ? error.code : '';
  const messages: Record<string, string> = {
    CLOUD_NOT_CONFIGURED: '尚未配置 Supabase，無法讀取每日 Itinerary 記錄。',
    DAILY_ITINERARY_REPORTS_SQL_NOT_DEPLOYED: '每日 Itinerary 記錄 SQL 尚未部署。請先執行本次 migration。',
    FORBIDDEN: '目前身份無權讀取每日 Itinerary 記錄。',
    OWNER_REQUIRED: '只有 Owner 可以刪除每日 Itinerary 記錄。',
    REPORT_NOT_FOUND: '找不到所選日期的每日 Itinerary 記錄。',
    REPORT_SET_CHANGED: '預覽後每日 Itinerary 記錄集合已變更；本次未刪除，請刷新後重新選擇。',
    IDEMPOTENCY_MISMATCH: '上次刪除操作與本次選擇不一致，已停止。',
    DELETE_CONTEXT_CHANGED: '雲端專案、工作區或身份已切換；舊的刪除操作未送出，請切回原環境對帳。',
    INVALID_DELETE_ENVELOPE: '刪除操作的日期集合不完整、重複或已被改動；本次未送出。',
    BATCH_LIMIT_EXCEEDED: '單次最多刪除 100 份每日 Itinerary 記錄。',
    RPC_TIMEOUT: '連線逾時，刪除結果尚未確認；請使用相同操作對帳。',
  };
  if (code && messages[code]) return messages[code];
  if (error instanceof Error && error.message) return error.message;
  return '每日 Itinerary 記錄操作失敗。';
}

function configIdentity(config: ResolvedSupabaseConfig): string {
  let origin = config.supabaseUrl.trim().replace(/\/+$/, '');
  try { origin = new URL(config.supabaseUrl).origin; } catch { /* keep normalized input */ }
  return `${origin}|${config.workspaceKey}|${config.tableName}`;
}

function pendingKey(config: ResolvedSupabaseConfig, actorUserId: string) {
  return `${PENDING_DELETE_PREFIX}${encodeURIComponent(configIdentity(config))}:${encodeURIComponent(actorUserId)}`;
}

export function createPendingItineraryDailyReportDelete(
  request: ItineraryDailyReportDeleteRequest,
  config: ResolvedSupabaseConfig,
  now = new Date(),
): PendingItineraryDailyReportDelete {
  const expectedDates = strictDateSet(request.expectedDates);
  const deleteDates = strictDateSet(request.deleteDates);
  if (!expectedDates || !deleteDates || deleteDates.some(date => !expectedDates.includes(date))) {
    throw new ItineraryDailyReportRpcError('INVALID_DELETE_ENVELOPE', 'Invalid Daily Itinerary delete request.', true);
  }
  return {
    version: 1,
    configIdentity: configIdentity(config),
    workspaceKey: config.workspaceKey,
    createdAt: now.toISOString(),
    operationId: request.operationId,
    actorUserId: request.actorUserId,
    expectedDates,
    deleteDates,
  };
}

export function readPendingItineraryDailyReportDelete(
  config: ResolvedSupabaseConfig,
  actorUserId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): PendingItineraryDailyReportDelete | null {
  try {
    const raw = storage.getItem(pendingKey(config, actorUserId));
    if (!raw) return null;
    const parsed = asObject(JSON.parse(raw));
    const expectedDates = strictDateSet(parsed.expectedDates);
    const deleteDates = strictDateSet(parsed.deleteDates);
    if (!expectedDates || !deleteDates || deleteDates.some(date => !expectedDates.includes(date))) return null;
    const pending: PendingItineraryDailyReportDelete = {
      version: 1,
      configIdentity: asText(parsed.configIdentity),
      workspaceKey: asText(parsed.workspaceKey),
      createdAt: asText(parsed.createdAt),
      operationId: asText(parsed.operationId),
      actorUserId: asText(parsed.actorUserId),
      expectedDates,
      deleteDates,
    };
    if (parsed.version !== 1
      || pending.configIdentity !== configIdentity(config)
      || pending.workspaceKey !== config.workspaceKey
      || pending.actorUserId !== actorUserId
      || !pending.operationId
      || !pending.expectedDates.length
      || !pending.deleteDates.length) return null;
    return pending;
  } catch {
    return null;
  }
}

export function writePendingItineraryDailyReportDelete(
  pending: PendingItineraryDailyReportDelete,
  config: ResolvedSupabaseConfig,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  storage.setItem(pendingKey(config, pending.actorUserId), JSON.stringify(pending));
}

export function clearPendingItineraryDailyReportDelete(
  config: ResolvedSupabaseConfig,
  actorUserId: string,
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
): void {
  storage.removeItem(pendingKey(config, actorUserId));
}

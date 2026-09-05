import { getSupabaseClient, getSupabaseConfig, type ResolvedSupabaseConfig } from './cloud';
import type { ItineraryRow } from './itinerary/itineraryTypes';

export const ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE = 100;
const RPC_TIMEOUT_MS = 25_000;
const PENDING_DELETE_PREFIX = 'ship-dynamics-daily-itinerary-report-delete:v3:';
const PENDING_LEGACY_DELETE_PREFIX = 'ship-dynamics-daily-itinerary-report-delete:v2:';
const PENDING_MANUAL_SAVE_PREFIX = 'ship-dynamics-daily-itinerary-report-manual-save:v1:';
const MAX_BIGINT_TEXT = '9223372036854775807';

export interface ItineraryDailyReportSummary {
  reportId: string;
  businessDate: string;
  timezone: 'Asia/Taipei';
  generatedAt: string;
  generatedBy: 'scheduled' | 'manual';
  generatedByActorId: string | null;
  vesselCount: number;
  rowCount: number;
  sourceMaxRevision: number;
  logicalBytes: number;
}

export interface ItineraryDailyReportPage {
  items: ItineraryDailyReportSummary[];
  page: number;
  pageSize: 30;
  pageCount: number;
  total: number;
  dateTotal: number;
  reportTotal: number;
  setToken: string;
}

export interface ItineraryDailyReportLocation {
  found: boolean;
  businessDate: string;
  page: number | null;
  pageSize: 30;
  setToken: string;
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
  expectedSetToken: string;
  deleteReportIds: string[];
}

export interface ItineraryDailyReportDeleteResult {
  ok: true;
  operationId: string;
  deletedCount: number;
  deletedBytes: number;
  deletedReportIds: string[];
  remainingReportCount: number;
  remainingSetToken: string;
}

export interface PendingItineraryDailyReportDelete extends ItineraryDailyReportDeleteRequest {
  version: 3;
  configIdentity: string;
  workspaceKey: string;
  createdAt: string;
}

export interface PendingLegacyItineraryDailyReportDelete {
  version: 2;
  operationId: string;
  actorUserId: string;
  configIdentity: string;
  workspaceKey: string;
  expectedSetToken: string;
  deleteDates: string[];
  createdAt: string;
}

export interface LegacyItineraryDailyReportDeleteResult {
  ok: true;
  operationId: string;
  deletedCount: number;
  deletedBytes: number;
  deletedDates: string[];
  remainingReportCount: number;
  remainingSetToken: string;
}

export interface ManualItineraryReportSaveRequest {
  operationId: string;
  actorUserId: string;
}

export interface PendingManualItineraryReportSave extends ManualItineraryReportSaveRequest {
  version: 1;
  configIdentity: string;
  workspaceKey: string;
  createdAt: string;
}

export interface ManualItineraryReportSaveResult {
  ok: true;
  operationId: string;
  created: boolean;
  report: ItineraryDailyReportSummary;
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
const strictPositiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
const strictNonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const isBusinessDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const isReportId = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) return false;
  return value.length < MAX_BIGINT_TEXT.length
    || (value.length === MAX_BIGINT_TEXT.length && value <= MAX_BIGINT_TEXT);
};
const reportIdCompare = (left: string, right: string) =>
  left.length - right.length || left.localeCompare(right, 'en');
const strictReportIdSet = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || !value.length || value.some(item => !isReportId(item))) return null;
  const unique = new Set<string>(value);
  return unique.size === value.length ? Array.from(unique).sort(reportIdCompare) : null;
};
const strictDateSet = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || !value.length
    || value.some(item => typeof item !== 'string' || !isBusinessDate(item))) return null;
  const unique = new Set<string>(value);
  return unique.size === value.length ? Array.from(unique).sort() : null;
};
const isCanonicalIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
};
const strictSetToken = (value: unknown): string | null => {
  const token = asText(value);
  return /^[0-9a-f]{32}$/.test(token) ? token : null;
};
const isOperationId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

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
  const reportId = asText(row.reportId);
  const businessDate = asText(row.businessDate);
  const timezone = asText(row.timezone);
  const generatedAt = asText(row.generatedAt);
  const generatedBy = row.generatedBy;
  const generatedByActorId = row.generatedByActorId === null ? null : asText(row.generatedByActorId) || null;
  const vesselCount = strictNonNegativeInteger(row.vesselCount);
  const rowCount = strictNonNegativeInteger(row.rowCount);
  const sourceMaxRevision = strictNonNegativeInteger(row.sourceMaxRevision);
  const logicalBytes = strictNonNegativeInteger(row.logicalBytes);
  if (!isReportId(reportId)
    || !isBusinessDate(businessDate)
    || timezone !== 'Asia/Taipei'
    || !generatedAt
    || (generatedBy !== 'scheduled' && generatedBy !== 'manual')
    || (generatedBy === 'scheduled' && generatedByActorId !== null)
    || (generatedBy === 'manual' && !generatedByActorId)
    || vesselCount === null
    || rowCount === null
    || sourceMaxRevision === null
    || logicalBytes === null) {
    throw new Error('每日 Itinerary 報告 metadata 格式不正確。');
  }
  return {
    reportId,
    businessDate,
    timezone:'Asia/Taipei',
    generatedAt,
    generatedBy,
    generatedByActorId,
    vesselCount,
    rowCount,
    sourceMaxRevision,
    logicalBytes,
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
      revision:asNonNegativeInteger(raw.revision),
      updatedAt:raw.updatedAt === null ? null : asText(raw.updatedAt) || null,
      rows,
    } satisfies ItineraryDailyReportVesselSnapshot;
  });
  const rowCount = vessels.reduce((total, vessel) => total + vessel.rows.length, 0);
  if (vessels.length !== expected.vesselCount || rowCount !== expected.rowCount) {
    throw new Error('每日 Itinerary 快照格式不正確。');
  }
  return {
    schemaVersion:1,
    businessDate:expected.businessDate,
    timezone:'Asia/Taipei',
    generatedAt:asText(snapshot.generatedAt, expected.generatedAt),
    vesselCount:vessels.length,
    rowCount,
    sourceMaxRevision:asNonNegativeInteger(snapshot.sourceMaxRevision),
    vessels,
  };
}

export async function listItineraryDailyReportPage(
  actorUserId: string,
  requestedPage: number,
  config?: ResolvedSupabaseConfig | null,
  client?: ItineraryDailyReportRpcClient | null,
): Promise<ItineraryDailyReportPage> {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    throw new Error('每日 Itinerary 報告頁碼不正確。');
  }
  const resolved = requiredConfig(config);
  const response = await runRpc('sd_itinerary_daily_report_list_v2', {
    p_workspace_key:resolved.workspaceKey,
    p_actor_user_id:actorUserId,
    p_page:requestedPage,
    p_page_size:30,
  }, resolved, client);
  const page = strictPositiveInteger(response.page);
  const pageSize = strictPositiveInteger(response.pageSize);
  const pageCount = strictPositiveInteger(response.pageCount);
  const total = strictNonNegativeInteger(response.total);
  const dateTotal = strictNonNegativeInteger(response.dateTotal);
  const reportTotal = strictNonNegativeInteger(response.reportTotal);
  const setToken = strictSetToken(response.setToken);
  const items = asArray(response.reports).map(parseSummary);
  const reportIds = new Set(items.map(item => item.reportId));
  const dateCount = new Set(items.map(item => item.businessDate)).size;
  if (!page || pageSize !== 30 || !pageCount || total === null || dateTotal === null || reportTotal === null || !setToken
    || total !== dateTotal
    || pageCount !== Math.max(1, Math.ceil(dateTotal / pageSize))
    || page > pageCount
    || dateCount > pageSize
    || reportIds.size !== items.length
    || reportTotal < items.length
    || (dateTotal === 0 && items.length !== 0)
    || (dateTotal > 0 && dateCount === 0)
    || (dateTotal > 0 && (page - 1) * pageSize + dateCount > dateTotal)) {
    throw new Error('每日 Itinerary 報告分頁格式不正確。');
  }
  return { items, page, pageSize:30, pageCount, total, dateTotal, reportTotal, setToken };
}

export async function locateItineraryDailyReport(
  businessDate: string,
  actorUserId: string,
  config?: ResolvedSupabaseConfig | null,
  client?: ItineraryDailyReportRpcClient | null,
): Promise<ItineraryDailyReportLocation> {
  if (!isBusinessDate(businessDate)) throw new Error('每日 Itinerary 報告日期格式不正確。');
  const resolved = requiredConfig(config);
  const response = await runRpc('sd_itinerary_daily_report_locate_v2', {
    p_workspace_key:resolved.workspaceKey,
    p_business_date:businessDate,
    p_actor_user_id:actorUserId,
    p_page_size:30,
  }, resolved, client);
  const pageSize = strictPositiveInteger(response.pageSize);
  const setToken = strictSetToken(response.setToken);
  const found = response.found;
  const page = found === true ? strictPositiveInteger(response.page) : null;
  if (response.businessDate !== businessDate || pageSize !== 30 || !setToken
    || (found !== true && found !== false) || (found === true && !page)) {
    throw new Error('每日 Itinerary 報告日期定位格式不正確。');
  }
  return { found, businessDate, page, pageSize:30, setToken };
}

export async function loadItineraryDailyReport(
  reportId: string,
  actorUserId: string,
  config?: ResolvedSupabaseConfig | null,
  client?: ItineraryDailyReportRpcClient | null,
): Promise<ItineraryDailyReport> {
  if (!isReportId(reportId)) throw new Error('每日 Itinerary 報告 ID 格式不正確。');
  const resolved = requiredConfig(config);
  const response = await runRpc('sd_itinerary_daily_report_load_by_id', {
    p_workspace_key:resolved.workspaceKey,
    p_report_id:reportId,
    p_actor_user_id:actorUserId,
  }, resolved, client);
  const reportValue = asObject(response.report);
  const summary = parseSummary(reportValue);
  if (summary.reportId !== reportId) throw new Error('每日 Itinerary 報告 ID 不一致。');
  return { ...summary, snapshot:parseSnapshot(reportValue.snapshot, summary) };
}

export async function saveManualItineraryDailyReport(
  request: PendingManualItineraryReportSave,
  config?: ResolvedSupabaseConfig | null,
  client?: ItineraryDailyReportRpcClient | null,
): Promise<ManualItineraryReportSaveResult> {
  const resolved = requiredConfig(config);
  if (request.version !== 1
    || request.configIdentity !== configIdentity(resolved)
    || request.workspaceKey !== resolved.workspaceKey
    || !request.actorUserId) {
    throw new ItineraryDailyReportRpcError(
      'MANUAL_SAVE_CONTEXT_CHANGED',
      'Manual Itinerary save context changed before submit.',
      true,
    );
  }
  if (!isOperationId(request.operationId)) {
    throw new ItineraryDailyReportRpcError('INVALID_MANUAL_SAVE_ENVELOPE', 'Invalid manual Itinerary save operation.', true);
  }
  const response = await runRpc('sd_save_manual_itinerary_report', {
    p_workspace_key:resolved.workspaceKey,
    p_actor_user_id:request.actorUserId,
    p_operation_id:request.operationId,
  }, resolved, client);
  const operationId = asText(response.operationId);
  const created = response.created;
  let report: ItineraryDailyReportSummary;
  try { report = parseSummary(response.report); }
  catch {
    throw new ItineraryDailyReportRpcError('INVALID_RESPONSE', 'Manual Itinerary save receipt is malformed.', false);
  }
  if (operationId !== request.operationId
    || (created !== true && created !== false)
    || report.generatedBy !== 'manual'
    || report.generatedByActorId !== request.actorUserId) {
    throw new ItineraryDailyReportRpcError(
      'INVALID_RESPONSE',
      'Manual Itinerary save receipt did not match the submitted operation.',
      false,
    );
  }
  return { ok:true, operationId, created, report };
}

export async function deleteItineraryDailyReports(
  request: PendingItineraryDailyReportDelete,
  config?: ResolvedSupabaseConfig | null,
  client?: ItineraryDailyReportRpcClient | null,
): Promise<ItineraryDailyReportDeleteResult> {
  const resolved = requiredConfig(config);
  if (request.version !== 3
    || request.configIdentity !== configIdentity(resolved)
    || request.workspaceKey !== resolved.workspaceKey
    || !request.actorUserId) {
    throw new ItineraryDailyReportRpcError(
      'DELETE_CONTEXT_CHANGED',
      'Daily Itinerary delete context changed before submit.',
      true,
    );
  }
  const deleteReportIds = strictReportIdSet(request.deleteReportIds);
  const expectedSetToken = strictSetToken(request.expectedSetToken);
  if (!isOperationId(request.operationId) || !expectedSetToken || !deleteReportIds) {
    throw new ItineraryDailyReportRpcError(
      'INVALID_DELETE_ENVELOPE',
      'Daily Itinerary delete report IDs are invalid or no longer exact.',
      true,
    );
  }
  const response = await runRpc('delete_sd_itinerary_daily_report_records', {
    p_workspace_key:resolved.workspaceKey,
    p_actor_user_id:request.actorUserId,
    p_operation_id:request.operationId,
    p_expected_set_token:expectedSetToken,
    p_delete_report_ids:deleteReportIds,
  }, resolved, client);
  const operationId = asText(response.operationId);
  const deletedReportIds = strictReportIdSet(response.deletedReportIds);
  const deletedCount = strictNonNegativeInteger(response.deletedCount);
  const deletedBytes = strictNonNegativeInteger(response.deletedBytes);
  const remainingReportCount = strictNonNegativeInteger(response.remainingReportCount);
  const remainingSetToken = strictSetToken(response.remainingSetToken);
  if (operationId !== request.operationId
    || !deletedReportIds
    || deletedCount === null
    || deletedBytes === null
    || remainingReportCount === null
    || !remainingSetToken
    || deletedCount !== deletedReportIds.length
    || JSON.stringify(deletedReportIds) !== JSON.stringify(deleteReportIds)) {
    throw new ItineraryDailyReportRpcError(
      'INVALID_RESPONSE',
      'Daily Itinerary delete receipt did not match the submitted operation.',
      false,
    );
  }
  return {
    ok:true,
    operationId,
    deletedCount,
    deletedBytes,
    deletedReportIds,
    remainingReportCount,
    remainingSetToken,
  };
}

export async function reconcileLegacyItineraryDailyReportDelete(
  request: PendingLegacyItineraryDailyReportDelete,
  config?: ResolvedSupabaseConfig | null,
  client?: ItineraryDailyReportRpcClient | null,
): Promise<LegacyItineraryDailyReportDeleteResult> {
  const resolved = requiredConfig(config);
  if (request.version !== 2
    || request.configIdentity !== configIdentity(resolved)
    || request.workspaceKey !== resolved.workspaceKey
    || !request.actorUserId) {
    throw new ItineraryDailyReportRpcError(
      'DELETE_CONTEXT_CHANGED',
      'Legacy Daily Itinerary delete context changed before reconciliation.',
      true,
    );
  }
  const expectedSetToken = strictSetToken(request.expectedSetToken);
  const deleteDates = strictDateSet(request.deleteDates);
  if (!isOperationId(request.operationId)
    || !isCanonicalIsoTimestamp(request.createdAt)
    || !expectedSetToken
    || !deleteDates) {
    throw new ItineraryDailyReportRpcError(
      'INVALID_DELETE_ENVELOPE',
      'Legacy Daily Itinerary delete dates are invalid or no longer exact.',
      true,
    );
  }
  const response = await runRpc('delete_sd_itinerary_daily_reports', {
    p_workspace_key:resolved.workspaceKey,
    p_actor_user_id:request.actorUserId,
    p_operation_id:request.operationId,
    p_expected_set_token:expectedSetToken,
    p_delete_dates:deleteDates,
  }, resolved, client);
  const operationId = asText(response.operationId);
  const deletedDates = strictDateSet(response.deletedDates);
  const deletedCount = strictNonNegativeInteger(response.deletedCount);
  const deletedBytes = strictNonNegativeInteger(response.deletedBytes);
  const remainingReportCount = strictNonNegativeInteger(response.remainingReportCount);
  const remainingSetToken = strictSetToken(response.remainingSetToken);
  if (operationId !== request.operationId
    || !deletedDates
    || deletedCount === null
    || deletedBytes === null
    || remainingReportCount === null
    || !remainingSetToken
    || deletedCount !== deletedDates.length
    || JSON.stringify(deletedDates) !== JSON.stringify(deleteDates)) {
    throw new ItineraryDailyReportRpcError(
      'INVALID_RESPONSE',
      'Legacy Daily Itinerary delete receipt did not match the submitted operation.',
      false,
    );
  }
  return {
    ok:true,
    operationId,
    deletedCount,
    deletedBytes,
    deletedDates,
    remainingReportCount,
    remainingSetToken,
  };
}

export function itineraryDailyReportErrorMessage(error: unknown): string {
  const code = error instanceof ItineraryDailyReportRpcError ? error.code : '';
  const messages: Record<string, string> = {
    CLOUD_NOT_CONFIGURED:'尚未配置 Supabase，無法讀取每日 Itinerary 記錄。',
    DAILY_ITINERARY_REPORTS_SQL_NOT_DEPLOYED:'手動／每日 Itinerary 記錄 SQL 尚未部署。請先執行本次 migration。',
    FORBIDDEN:'目前身份無權讀取每日 Itinerary 記錄。',
    OWNER_OR_ADMIN_REQUIRED:'只有 Owner／管理員可以手動保存目前 Itinerary。',
    OWNER_REQUIRED:'只有 Owner 可以刪除每日 Itinerary 記錄。',
    REPORT_NOT_FOUND:'找不到所選的每日 Itinerary 快照。',
    REPORT_SET_CHANGED:'預覽後每日 Itinerary 記錄集合已變更；本次未刪除，請刷新後重新選擇。',
    OPERATION_ID_REUSED:'保存操作識別碼已被其他操作使用，本次已停止。',
    IDEMPOTENCY_MISMATCH:'上次刪除操作與本次選擇不一致，已停止。',
    MANUAL_SAVE_CONTEXT_CHANGED:'雲端專案、工作區或身份已切換；舊的手動保存未送出。',
    INVALID_MANUAL_SAVE_ENVELOPE:'手動保存的對帳資料不完整；本次未送出。',
    DELETE_CONTEXT_CHANGED:'雲端專案、工作區或身份已切換；舊的刪除操作未送出，請切回原環境對帳。',
    INVALID_DELETE_ENVELOPE:'刪除操作的快照ID集合不完整、重複或已被改動；本次未送出。',
    BATCH_LIMIT_EXCEEDED:'單次最多刪除 100 份每日 Itinerary 記錄。',
    RPC_TIMEOUT:'連線逾時，操作結果尚未確認；請使用相同操作對帳。',
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

function pendingKey(prefix: string, config: ResolvedSupabaseConfig, actorUserId: string) {
  return `${prefix}${encodeURIComponent(configIdentity(config))}:${encodeURIComponent(actorUserId)}`;
}

export function createPendingManualItineraryReportSave(
  request: ManualItineraryReportSaveRequest,
  config: ResolvedSupabaseConfig,
  now = new Date(),
): PendingManualItineraryReportSave {
  if (!request.actorUserId || !isOperationId(request.operationId)) {
    throw new ItineraryDailyReportRpcError('INVALID_MANUAL_SAVE_ENVELOPE', 'Invalid manual Itinerary save request.', true);
  }
  return {
    version:1,
    configIdentity:configIdentity(config),
    workspaceKey:config.workspaceKey,
    createdAt:now.toISOString(),
    operationId:request.operationId,
    actorUserId:request.actorUserId,
  };
}

export function readPendingManualItineraryReportSave(
  config: ResolvedSupabaseConfig,
  actorUserId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): PendingManualItineraryReportSave | null {
  try {
    const raw = storage.getItem(pendingKey(PENDING_MANUAL_SAVE_PREFIX, config, actorUserId));
    if (!raw) return null;
    const parsed = asObject(JSON.parse(raw));
    const pending: PendingManualItineraryReportSave = {
      version:1,
      configIdentity:asText(parsed.configIdentity),
      workspaceKey:asText(parsed.workspaceKey),
      createdAt:asText(parsed.createdAt),
      operationId:asText(parsed.operationId),
      actorUserId:asText(parsed.actorUserId),
    };
    if (parsed.version !== 1
      || pending.configIdentity !== configIdentity(config)
      || pending.workspaceKey !== config.workspaceKey
      || pending.actorUserId !== actorUserId
      || !isOperationId(pending.operationId)) return null;
    return pending;
  } catch {
    return null;
  }
}

export function writePendingManualItineraryReportSave(
  pending: PendingManualItineraryReportSave,
  config: ResolvedSupabaseConfig,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  storage.setItem(pendingKey(PENDING_MANUAL_SAVE_PREFIX, config, pending.actorUserId), JSON.stringify(pending));
}

export function clearPendingManualItineraryReportSave(
  config: ResolvedSupabaseConfig,
  actorUserId: string,
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
): void {
  storage.removeItem(pendingKey(PENDING_MANUAL_SAVE_PREFIX, config, actorUserId));
}

export function createPendingItineraryDailyReportDelete(
  request: ItineraryDailyReportDeleteRequest,
  config: ResolvedSupabaseConfig,
  now = new Date(),
): PendingItineraryDailyReportDelete {
  const expectedSetToken = strictSetToken(request.expectedSetToken);
  const deleteReportIds = strictReportIdSet(request.deleteReportIds);
  if (!request.actorUserId || !isOperationId(request.operationId) || !expectedSetToken || !deleteReportIds) {
    throw new ItineraryDailyReportRpcError('INVALID_DELETE_ENVELOPE', 'Invalid Daily Itinerary delete request.', true);
  }
  return {
    version:3,
    configIdentity:configIdentity(config),
    workspaceKey:config.workspaceKey,
    createdAt:now.toISOString(),
    operationId:request.operationId,
    actorUserId:request.actorUserId,
    expectedSetToken,
    deleteReportIds,
  };
}

export function readPendingItineraryDailyReportDelete(
  config: ResolvedSupabaseConfig,
  actorUserId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): PendingItineraryDailyReportDelete | null {
  try {
    const raw = storage.getItem(pendingKey(PENDING_DELETE_PREFIX, config, actorUserId));
    if (!raw) return null;
    const parsed = asObject(JSON.parse(raw));
    const expectedSetToken = strictSetToken(parsed.expectedSetToken);
    const deleteReportIds = strictReportIdSet(parsed.deleteReportIds);
    if (!expectedSetToken || !deleteReportIds) return null;
    const pending: PendingItineraryDailyReportDelete = {
      version:3,
      configIdentity:asText(parsed.configIdentity),
      workspaceKey:asText(parsed.workspaceKey),
      createdAt:asText(parsed.createdAt),
      operationId:asText(parsed.operationId),
      actorUserId:asText(parsed.actorUserId),
      expectedSetToken,
      deleteReportIds,
    };
    if (parsed.version !== 3
      || pending.configIdentity !== configIdentity(config)
      || pending.workspaceKey !== config.workspaceKey
      || pending.actorUserId !== actorUserId
      || !isOperationId(pending.operationId)) return null;
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
  storage.setItem(pendingKey(PENDING_DELETE_PREFIX, config, pending.actorUserId), JSON.stringify(pending));
}

export function clearPendingItineraryDailyReportDelete(
  config: ResolvedSupabaseConfig,
  actorUserId: string,
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
): void {
  storage.removeItem(pendingKey(PENDING_DELETE_PREFIX, config, actorUserId));
}

export function readPendingLegacyItineraryDailyReportDelete(
  config: ResolvedSupabaseConfig,
  actorUserId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): PendingLegacyItineraryDailyReportDelete | null {
  try {
    const raw = storage.getItem(pendingKey(PENDING_LEGACY_DELETE_PREFIX, config, actorUserId));
    if (!raw) return null;
    const parsed = asObject(JSON.parse(raw));
    const expectedSetToken = strictSetToken(parsed.expectedSetToken);
    const deleteDates = strictDateSet(parsed.deleteDates);
    if (!expectedSetToken || !deleteDates) return null;
    const pending: PendingLegacyItineraryDailyReportDelete = {
      version:2,
      configIdentity:asText(parsed.configIdentity),
      workspaceKey:asText(parsed.workspaceKey),
      createdAt:asText(parsed.createdAt),
      operationId:asText(parsed.operationId),
      actorUserId:asText(parsed.actorUserId),
      expectedSetToken,
      deleteDates,
    };
    if (parsed.version !== 2
      || pending.configIdentity !== configIdentity(config)
      || pending.workspaceKey !== config.workspaceKey
      || pending.actorUserId !== actorUserId
      || !isCanonicalIsoTimestamp(pending.createdAt)
      || !isOperationId(pending.operationId)) return null;
    return pending;
  } catch {
    return null;
  }
}

export function clearPendingLegacyItineraryDailyReportDelete(
  config: ResolvedSupabaseConfig,
  actorUserId: string,
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
): void {
  storage.removeItem(pendingKey(PENDING_LEGACY_DELETE_PREFIX, config, actorUserId));
}

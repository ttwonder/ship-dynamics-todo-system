import { getSupabaseClient, getSupabaseConfig, type ResolvedSupabaseConfig } from './cloud';

import type { InternalControlBatchDraft, ShipInternalControlForm } from './InternalControlModals';

export type ShipInternalControlCatalog = ShipInternalControlForm['catalog'];
export type ShipInternalControlVessel = { id: string; name: string; shortName: string; fullName: string };
export type ShipInternalControlItem = {
  reportDate: string; reportSource: string; description: string; priority: string; category: string;
  equipmentSubcategory: string; isAware: boolean; status: string; departments: string[];
};
export type ShipInternalControlPending = {
  version: 1 | 2; vesselId: string; actorKey: string; operationId: string; items: ShipInternalControlItem[];
};
export type ShipInternalControlReceipt = {
  ok: true; status: 'committed'; operation_id: string; workspace_key: string; vessel_id: string;
  case_ids: string[]; item_count: number; revision: number; updated_at: string; replayed: boolean;
};
export type ShipInternalControlDraftRecord = {
  version: 1; vessel: ShipInternalControlVessel; catalog: ShipInternalControlCatalog;
  draft: InternalControlBatchDraft; pending?: ShipInternalControlPending;
};
export type ShipInternalControlOutcome =
  | { kind: 'committed'; receipt: ShipInternalControlReceipt }
  | { kind: 'unknown' | 'rejected'; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const validCatalog = (value: unknown): value is ShipInternalControlCatalog => object(value)
  && ['taskCategories', 'priorities', 'equipmentFailureSubcategories', 'departments'].every(key => strings(value[key]))
  && (value.priorities as string[]).every(priority => ['急', '高', '中', '低'].includes(priority));
const validVessel = (value: unknown): value is ShipInternalControlVessel => object(value)
  && ['id', 'name', 'shortName', 'fullName'].every(key => typeof value[key] === 'string') && Boolean(value.id);

export function prepareShipInternalControlSubmission(draft: InternalControlBatchDraft, actorKey: string, operationId: string): ShipInternalControlPending {
  return buildShipInternalControlSubmission(draft, actorKey, operationId, 2);
}

function buildShipInternalControlSubmission(draft: InternalControlBatchDraft, actorKey: string, operationId: string, version: 1 | 2): ShipInternalControlPending {
  if (!uuid.test(actorKey) || !uuid.test(operationId) || !draft.vesselId || draft.rows.length < 1 || draft.rows.length > 100) throw new Error('每次可提交 1–100 筆內控。');
  const reporter = typeof draft.reporterNameAndRole === 'string' ? draft.reporterNameAndRole.trim() : '';
  if (version === 2 && (!reporter || reporter.length > 120)) throw new Error('請填寫報告人姓名＋職務（最多 120 字）；輸入已保留。');
  if (version === 2 && draft.rows.some(row => !row.description.trim())) throw new Error('請填寫每筆事項內容；輸入已保留。');
  // v1 is only reconstructed when reading a previously persisted immutable request.
  // Never append new information to that request: its original receipt signature must survive upgrades.
  const reporterSuffix = version === 2 ? `\n\n報告人姓名＋職務：${reporter}` : '';
  // Explicit allowlist: no client case IDs, closure, task, account or responsibility fields can cross this boundary.
  const items = draft.rows.map(row => ({
    reportDate: draft.reportDate, reportSource: draft.reportSource, description: row.description.trim() + reporterSuffix,
    priority: row.priority, category: row.category, equipmentSubcategory: row.category === '設備故障' ? row.equipmentSubcategory : '',
    isAware: row.isAware, status: row.status.trim(), departments: [...row.departments],
  }));
  if (items.some(item => item.description.length > 10000 || item.status.length > 10000)) throw new Error('每筆事項內容（含報告人）及最新狀態各限 10,000 字；輸入已保留。');
  if (new TextEncoder().encode(JSON.stringify(items)).length > 1900000) throw new Error('本批內容過長，請減少筆數後提交；輸入已保留。');
  return { version, vesselId: draft.vesselId, actorKey, operationId, items };
}

export function parseShipInternalControlReceipt(value: unknown, pending: ShipInternalControlPending, workspaceKey: string): ShipInternalControlReceipt {
  if (!object(value) || value.ok !== true || value.status !== 'committed' || value.operation_id !== pending.operationId
    || value.workspace_key !== workspaceKey || value.vessel_id !== pending.vesselId || value.item_count !== pending.items.length
    || !strings(value.case_ids) || value.case_ids.length !== pending.items.length
    || value.case_ids.some((id, index) => id !== `ship-internal-case:${pending.operationId}:${index + 1}`)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at)) || typeof value.replayed !== 'boolean') {
    throw new Error('提交回覆不完整，尚未確認保存結果；草稿及原提交編號已保留。');
  }
  return value as ShipInternalControlReceipt;
}

export const shipInternalControlStoragePrefix = (config: ResolvedSupabaseConfig) => `ship-internal-v1:${encodeURIComponent(config.supabaseUrl)}:${encodeURIComponent(config.workspaceKey)}:`;
export const shipInternalControlDraftKey = (config: ResolvedSupabaseConfig, vesselId: string) => `${shipInternalControlStoragePrefix(config)}draft:${encodeURIComponent(vesselId)}`;

export function readShipInternalControlDraft(storage: Pick<Storage, 'getItem'>, key: string): ShipInternalControlDraftRecord | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!object(record) || record.version !== 1 || !validVessel(record.vessel) || !validCatalog(record.catalog)
      || !object(record.draft) || record.draft.vesselId !== record.vessel.id || typeof record.draft.reportDate !== 'string'
      || typeof record.draft.reportSource !== 'string' || !Array.isArray(record.draft.rows) || !record.draft.rows.length
      || (record.draft.reporterNameAndRole !== undefined && typeof record.draft.reporterNameAndRole !== 'string')
      || record.draft.rows.length > 100 || record.draft.rows.some(row => !object(row)
        || !['key', 'description', 'status', 'priority', 'category', 'equipmentSubcategory', 'closedDate', 'taskEquipmentSubcategory', 'taskExpectedDate'].every(key => typeof row[key] === 'string')
        || !['departments', 'taskCategories', 'taskOwnerUserIds'].every(key => strings(row[key]))
        || !['isAware', 'syncToTask', 'taskIsAbnormal'].every(key => typeof row[key] === 'boolean'))) throw new Error();
    if (record.pending !== undefined) {
      const pending = record.pending;
      if (!object(pending) || (pending.version !== 1 && pending.version !== 2) || pending.vesselId !== record.vessel.id
        || typeof pending.actorKey !== 'string' || !uuid.test(pending.actorKey) || typeof pending.operationId !== 'string' || !uuid.test(pending.operationId)
        || JSON.stringify(buildShipInternalControlSubmission(record.draft as InternalControlBatchDraft, pending.actorKey, pending.operationId, pending.version)) !== JSON.stringify(pending)) throw new Error();
    }
    return record as ShipInternalControlDraftRecord;
  } catch { throw new Error('無法讀取本機草稿；沒有清除或覆寫原資料，請保留此瀏覽器並聯絡岸端。'); }
}

export function saveShipInternalControlDraft(storage: Pick<Storage, 'setItem' | 'getItem'>, key: string, record: ShipInternalControlDraftRecord): void {
  try {
    const raw = JSON.stringify(record);
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error();
  } catch { throw new Error('本機草稿未能保存；請先保留畫面並釋放瀏覽器空間。本次不會提交雲端。'); }
}

class SubmissionFailure extends Error {
  constructor(readonly code: string, readonly domain: string) { super(domain); }
}
export function shipInternalControlErrorMessage(error: unknown): string {
  if (!(error instanceof SubmissionFailure)) return error instanceof Error ? error.message : '暫時無法連線，請保留草稿後重試。';
  if (error.code === 'PGRST202' || error.code === '42883') return '船端內控接口尚未啟用，請通知岸端完成 SQL 更新。';
  if (error.domain === 'stale-config') return '雲端設定已變更；原草稿及提交編號仍保留，請勿重新建立相同事項。';
  if (error.domain === 'ship-internal-operation-id-mismatch' || error.domain === 'ship-internal-id-conflict') return '原提交編號與雲端記錄不符；草稿已保留，請聯絡岸端核對，勿另建相同事項。';
  if (error.domain === 'ship-internal-vessel-unavailable') return '此船舶已停用或目前不可用；輸入已保留，請聯絡岸端。';
  if (error.domain === 'business-writes-paused') return '雲端暫停新增；輸入已保留，請稍後再提交。';
  if (error.domain === 'source-authority-retired' || error.domain === 'ship-internal-source-unavailable') return '目前雲端資料來源未開放船端新增；輸入已保留。';
  if (error.code === '22023') return '雲端未接受本批內容，請核對日期、必填內容及選項；全部輸入已保留。';
  if (error.code === '40001' || error.code === '57014') return '雲端忙碌，本批尚未保存；輸入已保留，請再提交。';
  return '尚未確認雲端保存結果；原草稿及提交編號已保留，請按「確認結果／重試相同提交」。';
}

export class ShipInternalControlRepository {
  private readonly client: NonNullable<ReturnType<typeof getSupabaseClient>>;
  private readonly current: () => boolean;
  constructor(readonly config: ResolvedSupabaseConfig, client = getSupabaseClient(config), isCurrent?: () => boolean) {
    // Static config may omit storageMode; every dedicated RPC gates the live admitted records authority.
    if (!client || config.tableName !== 'ship_dynamics_app_state') throw new Error('船端內控服務設定不完整或資料表設定不相容。');
    this.client = client;
    const identity = JSON.stringify(config);
    this.current = isCurrent || (() => JSON.stringify(getSupabaseConfig()) === identity);
  }
  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.current()) throw new SubmissionFailure('', 'stale-config');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const result = await this.client.rpc(name, args).abortSignal(controller.signal);
      if (!this.current()) throw new SubmissionFailure('', 'stale-config');
      if (result.error) throw new SubmissionFailure(result.error.code || '', result.error.message || 'transport');
      return result.data;
    } catch (error) {
      if (error instanceof SubmissionFailure) throw error;
      throw new SubmissionFailure('', 'transport');
    } finally { clearTimeout(timer); }
  }
  async catalog(vesselId: string | null = null): Promise<{ vessels: ShipInternalControlVessel[]; vessel: ShipInternalControlVessel | null; catalog: ShipInternalControlCatalog | null }> {
    const value = await this.rpc('read_ship_dynamics_internal_control_public_v1', { p_workspace_key: this.config.workspaceKey, p_vessel_id: vesselId });
    if (!object(value) || !Array.isArray(value.vessels) || !value.vessels.every(validVessel)
      || (vesselId !== null && (!validVessel(value.vessel) || value.vessel.id !== vesselId || !validCatalog(value.catalog)))) throw new Error('船舶清單回覆不完整，已停止新增。');
    return { vessels: value.vessels, vessel: vesselId ? value.vessel as ShipInternalControlVessel : null, catalog: vesselId ? value.catalog as ShipInternalControlCatalog : null };
  }
  private args(pending: ShipInternalControlPending) {
    return { p_workspace_key: this.config.workspaceKey, p_vessel_id: pending.vesselId, p_actor_key: pending.actorKey, p_operation_id: pending.operationId, p_items: pending.items };
  }
  async receipt(pending: ShipInternalControlPending): Promise<ShipInternalControlReceipt | null> {
    const result = await this.rpc('get_ship_dynamics_internal_control_public_receipt_v1', this.args(pending));
    if (object(result) && result.status === 'not-found' && result.ok === false && result.operation_id === pending.operationId) return null;
    return parseShipInternalControlReceipt(result, pending, this.config.workspaceKey);
  }
  async submit(pending: ShipInternalControlPending): Promise<ShipInternalControlOutcome> {
    // Check an existing exact receipt before any write. Retry NEVER creates another operation ID.
    try {
      const existing = await this.receipt(pending);
      if (existing) return { kind: 'committed', receipt: existing };
    } catch (error) { return { kind: 'unknown', message: shipInternalControlErrorMessage(error) }; }
    try {
      const result = await this.rpc('submit_ship_dynamics_internal_control_public_v1', this.args(pending));
      return { kind: 'committed', receipt: parseShipInternalControlReceipt(result, pending, this.config.workspaceKey) };
    } catch (error) {
      try {
        const recovered = await this.receipt(pending);
        if (recovered) return { kind: 'committed', receipt: recovered };
        const definitive = error instanceof SubmissionFailure && /^[0-9A-Z]{5}$/.test(error.code)
          && !['ship-internal-operation-id-mismatch', 'ship-internal-id-conflict'].includes(error.domain);
        if (definitive) return { kind: 'rejected', message: shipInternalControlErrorMessage(error) };
      } catch { /* A failed lookup cannot prove that the original write was rejected. */ }
      return { kind: 'unknown', message: shipInternalControlErrorMessage(error) };
    }
  }
}

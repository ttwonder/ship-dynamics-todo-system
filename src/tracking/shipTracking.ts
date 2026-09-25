import { getSupabaseClient, getSupabaseConfig, type ResolvedSupabaseConfig } from '../cloud';
import type { ShipInternalControlCatalog, ShipInternalControlVessel } from '../shipInternalControl';
import type { InternalControlCase } from '../types';
import type { TrackingItem } from './trackingTypes';
import type { TrackingSubmission } from './trackingUiTypes';
import { TRACKING_CREATE_FIELDS, validateTrackingItem } from './trackingWorkflow';

const protocol = 'ship-tracking-public-v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (x: unknown): x is Record<string, unknown> => Boolean(x && typeof x === 'object' && !Array.isArray(x));
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === 'string');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const pick = (value: object, keys: readonly string[]) => Object.fromEntries(keys.filter(k => Object.prototype.hasOwnProperty.call(value, k) && (value as Record<string, unknown>)[k] !== undefined).map(k => [k, (value as Record<string, unknown>)[k]]));
const validVessel = (x: unknown): x is ShipInternalControlVessel => object(x) && ['id', 'name', 'shortName', 'fullName'].every(k => typeof x[k] === 'string') && Boolean(x.id);
export interface ShipTrackingSnapshot {
  protocol: typeof protocol; workspace: string; revision: number; updatedAt: string;
  vessels: ShipInternalControlVessel[]; vessel: ShipInternalControlVessel | null; catalog: ShipInternalControlCatalog | null;
  trackingItems: TrackingItem[]; cases: InternalControlCase[];
}
interface Bundle { id: string; vesselId: string; ids: string[]; creation: boolean; holder: string; deadline: number }
interface Pending {
  version: 1; identity: string; vesselId: string; actor: string; holder: string;
  submission: TrackingSubmission; payload: { operationId: string; bundleId: string; command: Record<string, unknown> };
  terminal?: 'committed' | 'rejected';
}
export type ShipTrackingOutcome = { kind: 'committed'; snapshot: ShipTrackingSnapshot } | { kind: 'unknown' | 'rejected'; message: string };
class ShipTrackingError extends Error { constructor(readonly code: string, readonly domain: string) { super(domain); } }
export function shipTrackingMessage(error: unknown): string {
  const domain = error instanceof ShipTrackingError ? error.domain : '';
  if (error instanceof ShipTrackingError && ['PGRST202', '42883'].includes(error.code)) return '船端跟蹤接口尚未啟用，請通知岸端完成 SQL 更新。';
  if (domain === 'stale-config') return '雲端設定已變更；原輸入與提交編號保留，已停止新提交。';
  if (domain.includes('lease') || domain.includes('locked')) return '編輯權未取得或已失效；原輸入保留，請核對最新資料後重新取得編輯權。';
  if (domain.includes('revision-conflict') || domain.includes('link-inconsistent') || domain.includes('lifecycle-inconsistent')) return '資料或關聯已變更；整批未保存，請核對最新資料，原輸入保留。';
  if (domain === 'business-writes-paused') return '雲端暫停保存；原輸入與原提交編號保留。';
  if (domain.includes('vessel-unavailable')) return '本船目前停用或不可用；原草稿仍保留，請聯絡岸端。';
  if (domain.includes('operation-mismatch')) return '原提交編號與雲端記錄不符；請保留本頁並聯絡岸端，不可重建相同項目。';
  if (error instanceof ShipTrackingError) return '尚未確認保存；請保留原輸入，使用原提交確認結果或核對資料。';
  return error instanceof Error ? error.message : '尚未確認保存，請保留此頁及草稿。';
}

export function shipTrackingCommand(submission: TrackingSubmission, vesselId: string): Record<string, unknown> {
  const command = submission.command;
  if (command.type === 'sync-edit') throw new Error('原案件已建立；請關閉已完成的提交，從跟蹤清單繼續操作。');
  if (command.type === 'create') {
    for (const item of command.items) { if (item.vesselId !== vesselId) throw new Error('所選船舶不符；未送出。'); validateTrackingItem(item); }
    return { type: 'create', items: command.items.map(item => pick(item, TRACKING_CREATE_FIELDS)), ...('importClosures' in command && command.importClosures.length ? { importClosures: structuredClone(command.importClosures) } : {}) };
  }
  if (command.type === 'sync') {
    const reporter = submission.reporterNameAndRole?.trim();
    if (!reporter || reporter.length > 120) throw new Error('請填寫報告人姓名＋職務（最多 120 字）；輸入已保留。');
    if (command.items.some(x => x.item.vesselId !== vesselId || x.item.syncToTask || x.projection)) throw new Error('本頁只可建立所選船的內控；未送出。');
    return { type: 'sync', reporterNameAndRole: reporter, items: command.items.map(x => ({ id: x.id, expectedUpdatedAt: x.expectedUpdatedAt, item: pick(x.item, ['id', 'reportDate', 'reportSource', 'description', 'priority', 'category', 'equipmentSubcategory', 'isAware', 'status', 'departments', 'expectedDate']) })) };
  }
  if (command.type === 'lifecycle' && command.targets.some(t => t.entry !== 'tracking')) throw new Error('本頁只能從跟蹤來源操作；未送出。');
  return structuredClone(command) as unknown as Record<string, unknown>;
}

/** Dedicated public command client. It never calls a general workspace reader/writer. */
export class ShipTrackingRepository {
  readonly actorKey: string;
  readonly holder = crypto.randomUUID();
  readonly identity: string;
  readonly namespace: string;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  private readonly client: NonNullable<ReturnType<typeof getSupabaseClient>>;
  private readonly current: () => boolean;
  private bundle: Bundle | null = null;
  private activePending: Pending | null = null;
  private serial = 0;
  constructor(readonly config: ResolvedSupabaseConfig, options: { storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; client?: ReturnType<typeof getSupabaseClient>; isCurrent?: () => boolean } = {}) {
    this.client = options.client || getSupabaseClient(config)!;
    if (!this.client || config.tableName !== 'ship_dynamics_app_state') throw new Error('船端跟蹤雲端設定不完整，沒有讀取或寫入資料。');
    this.storage = options.storage || localStorage;
    this.namespace = JSON.stringify(['ship-tracking-v1', config.supabaseUrl, config.workspaceKey]);
    const key = this.namespace + ':actor', saved = this.storage.getItem(key);
    if (saved && !uuid.test(saved)) throw new Error('本機船端識別資料無法讀取；已保留原資料，請聯絡岸端。');
    this.actorKey = saved || crypto.randomUUID();
    if (!saved) this.store(key, this.actorKey);
    this.identity = JSON.stringify([this.namespace, this.actorKey]);
    const configId = JSON.stringify(config);
    this.current = options.isCurrent || (() => JSON.stringify(getSupabaseConfig()) === configId);
  }
  private store(key: string, raw: string) {
    try { this.storage.setItem(key, raw); if (this.storage.getItem(key) !== raw) throw new Error(); }
    catch { throw new Error('本機草稿未能保存；請保留此頁並處理瀏覽器儲存空間，本次不送出。'); }
  }
  private pendingKey(vesselId: string) { return `${this.namespace}:pending:${encodeURIComponent(vesselId)}`; }
  private pending(vesselId: string): Pending | null {
    const raw = this.storage.getItem(this.pendingKey(vesselId)); if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Pending;
      if (p.version !== 1 || p.identity !== this.identity || p.vesselId !== vesselId || p.actor !== this.actorKey || !uuid.test(p.holder) || !uuid.test(p.payload.bundleId)
        || p.submission.identity !== this.identity || p.payload.operationId !== p.submission.context.operationId || !same(p.payload.command, shipTrackingCommand(p.submission, vesselId))
        || p.terminal !== undefined && !['committed', 'rejected'].includes(p.terminal)) throw new Error();
      return p;
    } catch { throw new Error('原提交資料無法完整讀取；已保留原內容，請勿另建相同項目。'); }
  }
  private savePending(p: Pending) { this.store(this.pendingKey(p.vesselId), JSON.stringify(p)); this.activePending = p; }
  private async rpc(action: string, vesselId: string | null, payload: object = {}, holder: string = this.holder): Promise<unknown> {
    if (!this.current()) throw new ShipTrackingError('', 'stale-config');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    try {
      const result = await this.client.rpc('ship_dynamics_tracking_public_v1', { p_workspace_key: this.config.workspaceKey, p_vessel_id: vesselId, p_actor_key: this.actorKey, p_holder: holder, p_action: action, p_payload: payload }).abortSignal(controller.signal);
      if (!this.current()) throw new ShipTrackingError('', 'stale-config');
      if (result.error) throw new ShipTrackingError(result.error.code || '', result.error.message || 'transport');
      return result.data;
    } catch (e) { if (e instanceof ShipTrackingError) throw e; throw new ShipTrackingError('', 'transport'); }
    finally { clearTimeout(timer); }
  }
  private snapshot(raw: unknown, vesselId: string | null): ShipTrackingSnapshot {
    if (!object(raw) || raw.protocol !== protocol || raw.workspace !== this.config.workspaceKey || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0
      || !Array.isArray(raw.vessels) || !raw.vessels.every(validVessel) || !Array.isArray(raw.trackingItems) || !Array.isArray(raw.cases)
      || typeof raw.updatedAt !== 'string' || (vesselId ? !validVessel(raw.vessel) || raw.vessel.id !== vesselId || !object(raw.catalog) || !['taskCategories', 'priorities', 'equipmentFailureSubcategories', 'departments'].every(k => strings((raw.catalog as Record<string, unknown>)[k])) : raw.vessel !== null || raw.trackingItems.length !== 0 || raw.cases.length !== 0)
      || raw.trackingItems.some(x => !object(x) || x.vesselId !== vesselId || typeof x.id !== 'string' || !Array.isArray(x.statusLogs) || !Array.isArray(x.events))
      || raw.cases.some(x => !object(x) || x.vesselId !== vesselId || typeof x.id !== 'string' || x.syncToTask !== false || 'linkedTaskId' in x)) throw new Error('此船資料回覆不完整，已停止寫入；原草稿保留。');
    return raw as unknown as ShipTrackingSnapshot;
  }
  async load(vesselId: string | null) { return this.snapshot(await this.rpc('read', vesselId), vesselId); }
  isWritable(ids: readonly string[]) { return this.current() && Boolean(this.bundle && performance.now() < this.bundle.deadline && ids.every(id => this.bundle!.ids.includes(id))); }
  private acceptLease(raw: unknown, expected: Bundle, started: number) {
    if (!object(raw) || raw.ok !== true) throw new ShipTrackingError('', object(raw) && typeof raw.code === 'string' ? raw.code : 'lease-unconfirmed');
    if (raw.bundleId !== expected.id || !strings(raw.ids) || !same([...raw.ids].sort(), [...expected.ids].sort()) || raw.creation !== expected.creation || typeof raw.leaseMs !== 'number' || raw.leaseMs <= 0 || raw.leaseMs > 75000) throw new Error('編輯權回覆不完整；未開放修改。');
    expected.deadline = started + Math.max(0, raw.leaseMs - 1000);
    if (performance.now() >= expected.deadline) throw new ShipTrackingError('', 'lease-expired');
  }
  async claim(vesselId: string, ids: string[], creation = false): Promise<ShipTrackingSnapshot> {
    if (this.activePending && !this.activePending.terminal) throw new Error('原提交尚未確認，不能改取另一組編輯權。');
    if (!await this.release()) throw new Error('前一組編輯權未能釋放；未開啟新操作。');
    const token = ++this.serial, started = performance.now();
    const b: Bundle = { id: crypto.randomUUID(), vesselId, ids: [...ids].sort(), creation, holder: this.holder, deadline: 0 };
    const raw = await this.rpc('claim', vesselId, { bundleId: b.id, ids: b.ids, creation });
    if (token !== this.serial) { await this.rpc('release', vesselId, { bundleId: b.id }, b.holder); throw new Error('操作已變更；未開啟舊編輯。'); }
    this.acceptLease(raw, b, started); this.bundle = b;
    return this.snapshot((raw as Record<string, unknown>).data, vesselId);
  }
  async renew(): Promise<void> {
    const b = this.bundle; if (!b) return;
    const started = performance.now();
    try { const raw = await this.rpc('renew', b.vesselId, { bundleId: b.id }, b.holder); if (this.bundle === b) this.acceptLease(raw, b, started); }
    catch (e) { if (this.bundle === b) b.deadline = 0; throw e; }
  }
  async release(): Promise<boolean> {
    if (this.activePending && !this.activePending.terminal) return false;
    const b = this.bundle; if (!b) return true;
    const raw = await this.rpc('release', b.vesselId, { bundleId: b.id }, b.holder);
    if (!object(raw) || raw.ok !== true || raw.bundleId !== b.id) return false;
    if (this.bundle === b) { this.bundle = null; this.serial++; }
    return true;
  }
  private receipt(raw: unknown, p: Pending): 'committed' | 'rejected' | 'not-found' {
    if (object(raw) && raw.ok === false && raw.status === 'not-found' && raw.operationId === p.payload.operationId) return 'not-found';
    const ids = ((p.payload.command.items || p.payload.command.targets) as { id: string }[]).map(x => x.id).sort();
    if (!object(raw) || raw.protocol !== protocol || raw.workspace !== this.config.workspaceKey || raw.vesselId !== p.vesselId || raw.operationId !== p.payload.operationId || raw.bundleId !== p.payload.bundleId || typeof raw.replayed !== 'boolean') throw new Error('保存回覆不完整；原提交已保留，尚未確認成功。');
    if (raw.ok === false && raw.status === 'rejected' && typeof raw.code === 'string') return 'rejected';
    const caseIds = p.submission.command.type === 'sync' ? p.submission.command.items.map(x => x.item.id).sort() : [];
    if (raw.ok !== true || raw.status !== 'committed' || raw.operation_id !== 'ship-tracking:' + p.payload.operationId || !strings(raw.ids) || !same([...raw.ids].sort(), ids)
      || !strings(raw.caseIds) || !same([...raw.caseIds].sort(), caseIds) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0 || typeof raw.updated_at !== 'string' || !Number.isFinite(Date.parse(raw.updated_at))) throw new Error('保存回覆不完整；原提交已保留，尚未確認成功。');
    return 'committed';
  }
  async submit(submission: TrackingSubmission): Promise<ShipTrackingOutcome> {
    let p: Pending;
    try {
      if (submission.identity !== this.identity) throw new Error('此提交屬於不同工作階段；原資料保留，未送出。');
      const command = submission.command;
      const vesselId = command.type === 'create' ? command.items[0]?.vesselId : this.bundle?.vesselId || this.activePending?.vesselId;
      // Restored non-create drafts carry their exact vessel in the independent durable envelope.
      const matched = vesselId ? this.pending(vesselId) : this.findPending(submission.context.operationId);
      p = matched!;
      if (p && p.payload.operationId === submission.context.operationId) { if (!same(p.submission, submission)) throw new Error('原提交內容不符；請保留資料並核對。'); }
      else {
        if (p && !p.terminal) throw new Error('尚有原提交未確認，不可建立第二份。');
        if (!vesselId) throw new Error('尚未取得此船編輯權。');
        const wire = shipTrackingCommand(submission, vesselId);
        const ids = (command.type === 'lifecycle' ? command.targets : command.items).map(x => x.id);
        if (command.type === 'create') await this.claim(vesselId, ids, true);
        if (!this.isWritable(ids) || !this.bundle || this.bundle.vesselId !== vesselId) throw new ShipTrackingError('', 'lease-expired');
        p = { version: 1, identity: this.identity, vesselId, actor: this.actorKey, holder: this.bundle.holder, submission: structuredClone(submission), payload: { operationId: submission.context.operationId, bundleId: this.bundle.id, command: wire } };
        this.savePending(p);
      }
      this.activePending = p;
      let raw = await this.rpc('receipt', p.vesselId, p.payload, p.holder), status = this.receipt(raw, p);
      if (status === 'not-found') {
        try { raw = await this.rpc('submit', p.vesselId, p.payload, p.holder); status = this.receipt(raw, p); }
        catch { raw = await this.rpc('receipt', p.vesselId, p.payload, p.holder); status = this.receipt(raw, p); }
      }
      if (status === 'rejected') { this.savePending({ ...p, terminal: 'rejected' }); return { kind: 'rejected', message: shipTrackingMessage(new ShipTrackingError('', String((raw as Record<string, unknown>).code))) }; }
      if (status !== 'committed') return { kind: 'unknown', message: '尚未確認保存；保留原提交，請確認結果／重試相同提交。' };
      const snapshot = await this.load(p.vesselId);
      if (snapshot.revision < Number((raw as Record<string, unknown>).revision)) throw new Error('尚未讀回已確認版本；請保留原提交並確認結果。');
      this.savePending({ ...p, terminal: 'committed' });
      // Reload may have a new holder; release only the exact old request's own bundle.
      if (!this.bundle) this.bundle = { id: p.payload.bundleId, vesselId: p.vesselId, ids: [], creation: false, holder: p.holder, deadline: 0 };
      return { kind: 'committed', snapshot };
    } catch (e) { return { kind: 'unknown', message: shipTrackingMessage(e) }; }
  }
  private findPending(operationId: string): Pending | null {
    // The UI passes an operation from an explicit restored draft, never a workspace scan.
    if (this.activePending?.payload.operationId === operationId) return this.activePending;
    return null;
  }
  rememberVessel(vesselId: string) { this.activePending = this.pending(vesselId); }
  async discardRejected(): Promise<boolean> {
    const p = this.activePending; if (!p) return true;
    const raw = await this.rpc('receipt', p.vesselId, p.payload, p.holder);
    if (this.receipt(raw, p) !== 'rejected') return false;
    this.savePending({ ...p, terminal: 'rejected' });
    if (!this.bundle) this.bundle = { id: p.payload.bundleId, vesselId: p.vesselId, ids: [], creation: false, holder: p.holder, deadline: 0 };
    return this.release();
  }
}

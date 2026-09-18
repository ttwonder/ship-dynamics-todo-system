// Frozen v1 codec extracted without behavioral changes from 4b9f27305c1f51a3511e846c33b08fe842efc6b3.
// Prior full module SHA-256: fb104271955609172141f12a09fea0b218659b43c5fd95656638329287d4faf2
import type { InternalControlBatchDraft } from '../../src/InternalControlModals';
import type { ShipInternalControlPending, ShipInternalControlDraftRecord } from '../../src/shipInternalControl';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function prepareShipInternalControlSubmission(draft: InternalControlBatchDraft, actorKey: string, operationId: string): ShipInternalControlPending {
  if (!uuid.test(actorKey) || !uuid.test(operationId) || !draft.vesselId || draft.rows.length < 1 || draft.rows.length > 100) throw new Error('每次可提交 1–100 筆內控。');
  // Explicit allowlist: no client case IDs, closure, task, account or responsibility fields can cross this boundary.
  const items = draft.rows.map(row => ({
    reportDate: draft.reportDate, reportSource: draft.reportSource, description: row.description.trim(),
    priority: row.priority, category: row.category, equipmentSubcategory: row.category === '設備故障' ? row.equipmentSubcategory : '',
    isAware: row.isAware, status: row.status.trim(), departments: [...row.departments],
  }));
  if (items.some(item => item.description.length > 10000 || item.status.length > 10000)) throw new Error('每筆事項內容及最新狀態各限 10,000 字；輸入已保留。');
  if (new TextEncoder().encode(JSON.stringify(items)).length > 1900000) throw new Error('本批內容過長，請減少筆數後提交；輸入已保留。');
  return { version: 1, vesselId: draft.vesselId, actorKey, operationId, items };
}

export function saveShipInternalControlDraft(storage: Pick<Storage, 'setItem' | 'getItem'>, key: string, record: ShipInternalControlDraftRecord): void {
  try {
    const raw = JSON.stringify(record);
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error();
  } catch { throw new Error('本機草稿未能保存；請先保留畫面並釋放瀏覽器空間。本次不會提交雲端。'); }
}

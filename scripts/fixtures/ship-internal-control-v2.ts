// Frozen v2 codec from 15bb3212a0bc1afdab579ec84c652de52f41cca3.
// Original module SHA-256: 46fa2a467fe2b44f7f3a333dc69a06061bd1b9437a1be3b00ad1d080b8831d15
import type { InternalControlBatchDraft } from '../../src/InternalControlModals';
import type { ShipInternalControlPending } from '../../src/shipInternalControl';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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

import type { TrackingReport } from './trackingReport';

/** Presentation only: every selected snapshot field appears in exactly one cell. */
export const TRACKING_PRINT_GROUPS = [
  { key: 'identity', label: '編號／類型／請購資訊', width: 18 },
  { key: 'dates', label: '申請／期望／實際日期', width: 16 },
  { key: 'status', label: '狀態', width: 10 },
  { key: 'description', label: '內容摘要／工程內容', width: 25 },
  { key: 'notes', label: '補充說明／最新進度', width: 31 },
] as const;
const keys = [
  ['referenceNo', 'requestType', 'purchaseNos', 'originalItemNo'],
  ['applicationDate', 'expectedDate', 'actualDeliveryDate', 'completionDate', 'closedDate'],
  ['normal', 'urgent', 'deliveryStatus', 'completionStatus', 'isClosed', 'closureOutcome', 'linkState'],
  ['description'],
  ['supplementalNotes', 'progress'],
];
const labels: Record<string, string> = {
  referenceNo: '編號', requestType: '類型', purchaseNos: '請購', originalItemNo: '原項次',
  applicationDate: '申請', expectedDate: '期望/DL', actualDeliveryDate: '送達', completionDate: '完工', closedDate: '結案',
  deliveryStatus: '送船', completionStatus: '工程', isClosed: '結案', closureOutcome: '結果', linkState: '內控',
};
export interface TrackingPrintField { key: string; label: string; value: string }
export function trackingPrintCells(report: TrackingReport, row: TrackingReport['rows'][number]): TrackingPrintField[][] {
  const columns = new Map(report.columns.map(column => [column.key, column]));
  const known = new Set(keys.flat());
  return keys.map((group, index) => {
    const selected = [...group, ...(index === 4 ? report.columns.filter(column => !known.has(column.key)).map(column => column.key) : [])].filter(key => columns.has(key));
    return selected.flatMap(key => {
      if (key === 'urgent' && columns.has('normal')) return [];
      if (key === 'normal' && columns.has('urgent')) return [{ key: 'urgency', label: '優先', value: row.values.urgent === '是' ? '緊急' : row.values.normal === '是' ? '普通' : '—' }];
      return [{ key, label: key === 'expectedDate' && row.item.requestType === 'annual-inspection' ? '到期' : labels[key] || columns.get(key)!.label, value: row.values[key] || '—' }];
    });
  });
}

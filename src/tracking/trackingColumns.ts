import type { TrackingItem, TrackingKind } from './trackingTypes';

export type TrackingColumnType = 'text' | 'date' | 'multi';
export interface TrackingColumn {
  key: string; label: string; type: TrackingColumnType; width: number;
  kinds?: TrackingKind[]; hidden?: boolean; editable?: boolean; required?: boolean;
  value: (row: TrackingItem) => string;
}
const field = (key: keyof TrackingItem, label: string, type: TrackingColumnType = 'text', width = 140, extra: Partial<TrackingColumn> = {}): TrackingColumn => ({
  key, label, type, width, value: row => { const value = row[key]; return value == null ? '' : Array.isArray(value) ? value.join('、') : String(value); }, ...extra,
});
const supply = { kinds: ['supply'] as TrackingKind[], editable: true };
const engineering = { kinds: ['engineering'] as TrackingKind[], editable: true };
const edit = { editable: true };
export const TRACKING_COLUMNS: readonly TrackingColumn[] = [
  field('referenceNo', '項目編號', 'text', 180, { ...edit, required: true }),
  field('originalItemNo', '原項次', 'text', 90, { ...edit, hidden: true }),
  field('subitemNo', '工程分項', 'text', 95, engineering),
  field('applicationDate', '申請／開單日期', 'date', 135, { ...edit, required: true }),
  field('purchaseNos', '請購案號', 'text', 180, supply),
  field('materialCategory', '材料類別', 'multi', 125, supply),
  field('description', '內容摘要／工程內容', 'text', 300, { ...edit, required: true }),
  { key: 'normal', label: '普通', type: 'multi', width: 80, value: row => row.urgency === 'normal' ? '是' : '否' },
  { key: 'urgent', label: '緊急', type: 'multi', width: 80, value: row => row.urgency === 'urgent' ? '是' : '否' },
  field('urgentSubtypes', '原急件類型', 'text', 145, { ...edit, hidden: true }),
  field('preparationDate', '備貨完成日期', 'date', 135, supply),
  field('supplier', '供應商', 'multi', 160, supply),
  field('estimatedSupplyDatePlace', '預計供料日期／地點', 'text', 210, supply),
  field('countersignDate', '回簽日期', 'date', 135, engineering),
  field('contractor', '安排廠家', 'multi', 170, engineering),
  field('constructionPort', '施工港口', 'multi', 155, engineering),
  field('completionDate', '完工日期', 'date', 135, engineering),
  field('originalRemarks', '原備註', 'text', 280, engineering),
  field('expectedDate', '期望完成日/DL', 'date', 140, edit),
  field('supplementalNotes', '補充說明', 'text', 320, edit),
  field('progress', '最新進度', 'text', 340),
  { ...field('deliveryStatus', '送船狀態', 'multi', 135, { kinds: ['supply'] }), value: row => ({ 'not-delivered': '未送船', 'partially-delivered': '部分送船', delivered: '已送船' })[row.deliveryStatus] },
  field('actualDeliveryDate', '實際全部送達日期', 'date', 145, { kinds: ['supply'] }),
  { ...field('isClosed', '結案狀態', 'multi', 125), value: row => row.isClosed ? '已結案' : '未結案' },
  field('closedDate', '結案日期', 'date', 130),
  { ...field('closureOutcome', '工程結案結果', 'multi', 155, { kinds: ['engineering'] }), value: row => !row.isClosed ? '' : row.closureOutcome === 'cancelled' ? '取消（非完工）' : '完工' },
  { ...field('linkState', '內控同步', 'multi', 120), value: row => row.linkState === 'active' ? '已同步' : row.linkState === 'invalid' ? '關聯已失效' : '未同步' },
  field('linkedCaseId', '內控 ID', 'text', 200, { hidden: true }),
  field('createdBy', '建立人', 'multi', 135, { hidden: true }),
  field('createdAt', '建立時間', 'date', 180, { hidden: true }),
  field('updatedBy', '更新人', 'multi', 135, { hidden: true }),
  field('updatedAt', '更新時間', 'date', 180, { hidden: true }),
  field('closedBy', '結案人', 'multi', 135, { hidden: true }),
  field('id', '系統 ID', 'text', 230, { hidden: true }),
  { key: 'source', label: '來源追溯', type: 'text', width: 300, hidden: true, value: row => row.source ? JSON.stringify(row.source) : '' },
  { key: 'statusLogs', label: '進度歷程', type: 'text', width: 360, hidden: true, value: row => row.statusLogs.map(log => `${log.at} ${log.by}\n${log.text}`).join('\n\n') },
  { key: 'events', label: '更正／結案歷程', type: 'text', width: 360, hidden: true, value: row => (row.events || []).map(event => `${event.at} ${event.byUserId} ${event.action}\n${JSON.stringify(event.before)} → ${JSON.stringify(event.after)}`).join('\n\n') },
];
export const trackingColumnsFor = (kind: TrackingKind) => TRACKING_COLUMNS.filter(column => !column.kinds || column.kinds.includes(kind));

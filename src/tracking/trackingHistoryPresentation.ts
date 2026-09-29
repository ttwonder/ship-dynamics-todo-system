import { formatTaipeiDateTime } from '../taipeiTime';
import type { TrackingEvent, TrackingItem } from './trackingTypes';
import { trackingRequestTypeLabel } from './trackingRequestTypes';

const eventLabels: Record<TrackingEvent['action'], string> = {
  delete: '刪除來源／批准申請', restore: '還原來源', 'request-delete': '申請刪除', 'reject-delete': '駁回刪除申請',
  reclassify: '修正分類', close: '結案', reopen: '重開', 'correct-close-date': '更正結案日期',
  delivery: '送船狀態／日期更正', completion: '完工日期更正', link: '同步到內控', 'invalidate-link': '內控關聯失效',
};
export const trackingHistoryFieldLabels: Record<string, string> = {
  deletion: '刪除狀態', deletionRequest: '刪除申請', reason: '操作理由',
  kind: '大類', requestType: '類型', isClosed: '結案狀態', closedDate: '結案日期', closedBy: '結案人', deliveryStatus: '送船狀態',
  actualDeliveryDate: '實際送達日期', completionDate: '完工日期', closureOutcome: '工程結案結果',
  caseId: '內控 ID', taskId: '要事 ID', linkState: '內控同步',
};
const valueLabels: Record<string, string> = {
  'not-delivered': '未送船', 'partially-delivered': '部分送船', delivered: '已送船',
  supply: '配件／物料', engineering: '工程', active: '已同步', invalid: '關聯已失效', completed: '正常結案', cancelled: '取消結案',
};
export const displayValue = (key: string, value: unknown, names: Map<string, string>, unknownIdentity?: string): string => {
  if (value === undefined || value === null || value === '') return '—';
  if (key === 'isClosed' && typeof value === 'boolean') return value ? '已結案' : '未結案';
  if (key === 'requestType' && typeof value === 'string') return trackingRequestTypeLabel(value) || value;
  if (key === 'closedBy' && typeof value === 'string') return names.get(value) || unknownIdentity || value;
  if ((key === 'deletion' || key === 'deletionRequest') && typeof value === 'object') {
    const detail = value as Record<string, unknown>;
    const state = key === 'deletion' ? '已刪除' : ({ pending: '待審核', approved: '已批准', rejected: '已駁回' }[String(detail.status)] || '申請');
    return [state, typeof detail.at === 'string' ? formatTaipeiDateTime(detail.at) + '（UTC+8）' : '', typeof detail.byUserId === 'string' ? (names.get(detail.byUserId) || unknownIdentity || detail.byUserId) : '', `${key === 'deletion' ? '刪除' : '申請'}理由：${detail.reason || '—'}`, typeof detail.reviewedAt === 'string' ? `審核時間：${formatTaipeiDateTime(detail.reviewedAt)}（UTC+8）` : '', detail.reviewReason ? `審核理由：${detail.reviewReason}` : ''].filter(Boolean).join('｜');
  }
  if (typeof value === 'string') return valueLabels[value] || value;
  return JSON.stringify(value);
};

// Project saved entries only. Never infer historical changes from current fields.
export function trackingHistoryEntries(row: TrackingItem) {
  return [
    ...(row.statusLogs || []).map((log, index) => ({ id: `progress:${log.id}:${index}`, at: log.at, actor: log.by, actorId: log.byUserId, title: '進度更新', text: log.text, event: undefined as TrackingEvent | undefined })),
    ...(row.events || []).map((event, index) => ({ id: `event:${event.id}:${index}`, at: event.at, actor: '', actorId: event.byUserId, title: eventLabels[event.action] || event.action, text: '', event })),
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
}

export const isTrackingStatusEntry = (entry: ReturnType<typeof trackingHistoryEntries>[number]) => !entry.event || ['delivery', 'completion', 'close', 'reopen', 'correct-close-date'].includes(entry.event.action);

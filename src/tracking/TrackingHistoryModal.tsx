import { useEffect, useRef } from 'react';
import type { UserAccount } from '../types';
import { formatTaipeiDateTime } from '../taipeiTime';
import type { TrackingEvent, TrackingItem } from './trackingTypes';
import type { TrackingAudience } from './trackingUiTypes';
import { trackingRequestTypeLabel } from './trackingRequestTypes';
import { TrackingDeletionStatus } from './TrackingDeletionFields';
import { trackingReviewColumns } from './trackingColumns';
import { isTrackingDeleted } from './trackingDeletion';

const eventLabels: Record<TrackingEvent['action'], string> = {
  delete: '刪除來源／批准申請', restore: '還原來源', 'request-delete': '申請刪除', 'reject-delete': '駁回刪除申請',
  reclassify: '修正分類', close: '結案', reopen: '重開', 'correct-close-date': '更正結案日期',
  delivery: '送船狀態／日期更正', completion: '完工日期更正', link: '同步到內控', 'invalidate-link': '內控關聯失效',
};
const fieldLabels: Record<string, string> = {
  deletion: '刪除狀態', deletionRequest: '刪除申請', reason: '操作理由',
  kind: '大類', requestType: '類型', isClosed: '結案狀態', closedDate: '結案日期', closedBy: '結案人', deliveryStatus: '送船狀態',
  actualDeliveryDate: '實際送達日期', completionDate: '完工日期', closureOutcome: '工程結案結果',
  caseId: '內控 ID', taskId: '要事 ID', linkState: '內控同步',
};
const valueLabels: Record<string, string> = {
  'not-delivered': '未送船', 'partially-delivered': '部分送船', delivered: '已送船',
  supply: '配件／物料', engineering: '工程', active: '已同步', invalid: '關聯已失效', completed: '正常結案', cancelled: '取消結案',
};
const displayValue = (key: string, value: unknown, names: Map<string, string>): string => {
  if (value === undefined || value === null || value === '') return '—';
  if (key === 'isClosed' && typeof value === 'boolean') return value ? '已結案' : '未結案';
  if (key === 'requestType' && typeof value === 'string') return trackingRequestTypeLabel(value) || value;
  if (key === 'closedBy' && typeof value === 'string') return names.get(value) || value;
  if ((key === 'deletion' || key === 'deletionRequest') && typeof value === 'object') {
    const detail = value as Record<string, unknown>;
    const state = key === 'deletion' ? '已刪除' : ({ pending: '待審核', approved: '已批准', rejected: '已駁回' }[String(detail.status)] || '申請');
    return [state, typeof detail.at === 'string' ? formatTaipeiDateTime(detail.at) + '（UTC+8）' : '', typeof detail.byUserId === 'string' ? (names.get(detail.byUserId) || detail.byUserId) : '', `${key === 'deletion' ? '刪除' : '申請'}理由：${detail.reason || '—'}`, typeof detail.reviewedAt === 'string' ? `審核時間：${formatTaipeiDateTime(detail.reviewedAt)}（UTC+8）` : '', detail.reviewReason ? `審核理由：${detail.reviewReason}` : ''].filter(Boolean).join('｜');
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

export function TrackingHistoryModal({ rows, users, audience, vesselName, onClose }: {
  rows: TrackingItem[]; users: Pick<UserAccount, 'id' | 'name'>[]; audience: TrackingAudience; vesselName: string; onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const names = new Map(users.map(user => [user.id, user.name]));
  return <div className="modal-backdrop"><section className="modal tracking-history-modal" role="dialog" aria-modal="true" aria-labelledby="tracking-history-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button,summary')].filter(node => node.getClientRects().length);
      const edge = event.shiftKey ? nodes[0] : nodes[nodes.length - 1], next = event.shiftKey ? nodes[nodes.length - 1] : nodes[0];
      if (document.activeElement === edge) { event.preventDefault(); next?.focus(); }
    }
  }}>
    <div className="modal-head"><h2 id="tracking-history-title">所選項目紀錄（{rows.length} 項）</h2><button ref={closeButton} type="button" className="btn ghost" onClick={onClose}>關閉紀錄</button></div>
    <p className="tracking-history-note"><strong>{vesselName}</strong>｜目前清單已讀取的紀錄，不含未保存輸入。此視窗僅供查看，不取得編輯權。</p>
    <p className="tracking-history-note">顯示已保存的進度與送達／完工、結案等事件；不是所有欄位的完整修改歷史。</p>
    {rows.map(row => {
      const entries = trackingHistoryEntries(row);
      return <details className="tracking-history-item" data-history-id={row.id} key={row.id} open={rows.length === 1}>
        <summary><strong>{row.referenceNo}</strong>{row.originalItemNo && <span>｜原項次：{row.originalItemNo}</span>}<span>｜{row.isClosed ? '已結案' : '未結案'}｜{entries.length} 筆紀錄</span><small>{row.id}</small></summary>
        <p className="tracking-history-description">{row.description}</p>
        <TrackingDeletionStatus row={row}/>
        <details className="tracking-retained-details" open={isTrackingDeleted(row)}><summary>目前保留資料（含原分類及日期）</summary><dl className="tracking-history-changes">{trackingReviewColumns().filter(column => !['events', 'statusLogs', 'description'].includes(column.key)).map(column => <div key={column.key}><dt>{column.label}</dt><dd>{column.value(row) || '—'}</dd></div>)}</dl></details>
        {entries.length ? <ol className="tracking-history-timeline">{entries.map(entry => <li key={entry.id}>
          <div className="tracking-history-meta"><strong>{entry.title}</strong><time dateTime={entry.at}>{formatTaipeiDateTime(entry.at) || '時間未記錄'}</time><span>（UTC+8）｜{entry.actor || names.get(entry.actorId || '') || entry.actorId || '更新者未記錄'}</span>
            {entry.event && <span>｜{entry.event.entry === 'tracking' ? '跟蹤清單' : entry.event.entry === 'internal-control' ? '內控' : audience === 'shore' ? '要事' : '關聯記錄'}</span>}
          </div>
          {entry.event ? <dl className="tracking-history-changes">{[...new Set([...Object.keys(entry.event.before || {}), ...Object.keys(entry.event.after || {})])].filter(key => audience !== 'ship' || key !== 'taskId').map(key => <div key={key}><dt>{fieldLabels[key] || key}</dt><dd><span>{displayValue(key, entry.event!.before?.[key], names)}</span><span aria-label="變更為"> → </span><span>{displayValue(key, entry.event!.after?.[key], names)}</span></dd></div>)}</dl> : <p className="tracking-history-text">{entry.text}</p>}
        </li>)}</ol> : <p>尚無已保存的進度或事件紀錄。</p>}
      </details>;
    })}
  </section></div>;
}

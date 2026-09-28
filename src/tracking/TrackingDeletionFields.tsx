import type { TrackingItem } from './trackingTypes';
import type { TrackingDraft } from './TrackingModals';
import type { TrackingUiCommand } from './trackingUiCommands';
import { isTrackingDeleted, isTrackingDeletionPending, type TrackingDeletionAction } from './trackingDeletion';
import { trackingDeletionRequestLabel } from './trackingColumns';
import { trackingRequestTypeLabel } from './trackingRequestTypes';
import { formatTaipeiDateTime } from '../taipeiTime';

export const isTrackingDeletionAction = (action: string): action is TrackingDeletionAction => ['delete', 'restore', 'request-delete', 'reject-delete'].includes(action);
export function trackingDeletionSelectionError(action: TrackingDeletionAction, rows: readonly TrackingItem[]) {
  if (!rows.length || rows.length > 100 || new Set(rows.map(row => row.id)).size !== rows.length) return '請精確選取 1 至 100 項；不會自動截斷或略過衝突列。';
  if (action === 'restore') return rows.some(row => !isTrackingDeleted(row)) ? '只有已刪除項目可還原；請重新核對所選項目。' : '';
  if (rows.some(isTrackingDeleted)) return '所選項目已刪除，僅可查看紀錄或由岸端還原。';
  if (action === 'request-delete' && rows.some(isTrackingDeletionPending)) return '所選項目已有待審核申請；不能重複申請。';
  if (action === 'reject-delete' && rows.some(row => !isTrackingDeletionPending(row))) return '駁回僅適用待審核申請；請重新核對所選項目。';
  return '';
}
// A retry ACK must not discard a newer reason entered before that retry began.
export function trackingDeletionDraftMatchesCommand(draft: TrackingDraft | null, command: TrackingUiCommand): boolean {
  if (command.type !== 'delete' && command.type !== 'restore' && command.type !== 'request-delete' && command.type !== 'reject-delete') return true;
  return Boolean(draft && draft.action === command.type && draft.rows.length === command.items.length && command.items.every(item => draft.rows.some(row => row.id === item.id) && item.reason === draft.deletionReason?.trim()));
}
export function TrackingDeletionStatus({ row }: { row: TrackingItem }) {
  return <div className="tracking-deletion-status">
    {row.deletion && <p><strong>來源已刪除</strong>｜{formatTaipeiDateTime(row.deletion.at)}（UTC+8）｜刪除理由：{row.deletion.reason}</p>}
    {row.deletionRequest && <p><strong>刪除申請：{trackingDeletionRequestLabel(row)}</strong>｜{formatTaipeiDateTime(row.deletionRequest.at)}（UTC+8）<br/>申請理由：{row.deletionRequest.reason}{row.deletionRequest.reviewedAt && <><br/>審核時間：{formatTaipeiDateTime(row.deletionRequest.reviewedAt)}（UTC+8）｜審核理由：{row.deletionRequest.reviewReason || '—'}</>}</p>}
  </div>;
}
export function TrackingDeletionFields({ draft, onChange }: { draft: TrackingDraft; onChange: (reason: string) => void }) {
  return <div className="tracking-deletion-fields">
    <div className="tracking-deletion-sources">{draft.originals.map(row => <article key={row.id}><strong>{row.referenceNo} [{row.id}]</strong><span>｜{trackingRequestTypeLabel(row.requestType) || (row.kind === 'supply' ? '配件／物料' : '工程')}｜{row.isClosed ? '已結案' : '未結案'}｜申請/開單日期：{row.applicationDate}</span><TrackingDeletionStatus row={row}/></article>)}</div>
    <label>本批操作理由（必填，最多 500 字）<textarea aria-label="本批操作理由" required maxLength={500} value={draft.deletionReason || ''} onChange={event => onChange(event.target.value)}/></label>
    <small>同一理由套用至上述精確選取項目；保存確認前不移出清單。原分類、業務日期、進度與歷程均保留。</small>
  </div>;
}

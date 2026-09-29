import type { UserAccount } from '../types';
import { formatTaipeiDateTime } from '../taipeiTime';
import type { TrackingItem } from './trackingTypes';
import type { TrackingAudience } from './trackingUiTypes';
import { trackingReviewColumns } from './trackingColumns';
import { isTrackingDeleted } from './trackingDeletion';
import { displayValue, trackingHistoryEntries, trackingHistoryFieldLabels, isTrackingStatusEntry } from './trackingHistoryPresentation';
import './trackingHistoryReport.css';

type Field = { label: string; value: string };
type HistoryEntry = { title: string; at: string; actor: string; origin: string; text: string; changes: Field[] };
export interface TrackingHistoryReport {
  vesselName: string; generatedAt: string; excludedDeleted: number;
  items: { reference: string; description: string; fields: Field[]; notes: Field[]; statuses: HistoryEntry[]; other: HistoryEntry[] }[];
}

// Presentation snapshot only: no draft reads, identity fallback, writes or inferred audit.
export function makeTrackingHistoryReport({ rows, users, audience, vesselName, generatedAt }: {
  rows: TrackingItem[]; users: Pick<UserAccount, 'id' | 'name'>[]; audience: TrackingAudience; vesselName: string; generatedAt: string;
}): TrackingHistoryReport {
  const names = new Map(users.map(user => [user.id, user.name]));
  const printable = rows.filter(row => !isTrackingDeleted(row));
  const format = (entry: ReturnType<typeof trackingHistoryEntries>[number]): HistoryEntry => ({
    title: entry.title, at: formatTaipeiDateTime(entry.at) || '時間未記錄',
    actor: entry.actor || names.get(entry.actorId || '') || '更新者未記錄',
    origin: !entry.event ? '' : entry.event.entry === 'tracking' ? '跟蹤清單' : entry.event.entry === 'internal-control' ? '內控' : audience === 'shore' ? '要事' : '關聯記錄',
    text: entry.text,
    changes: entry.event ? [...new Set([...Object.keys(entry.event.before || {}), ...Object.keys(entry.event.after || {})])]
      .filter(key => !['id', 'caseId', 'taskId', 'linkedCaseId', 'operationId', 'byUserId'].includes(key))
      .map(key => ({ label: trackingHistoryFieldLabels[key] || key, value: `${displayValue(key, entry.event!.before?.[key], names, '姓名未記錄')} → ${displayValue(key, entry.event!.after?.[key], names, '姓名未記錄')}` })) : [],
  });
  return { vesselName, generatedAt, excludedDeleted: rows.length - printable.length, items: printable.map(row => {
    const entries = trackingHistoryEntries(row);
    const fields = trackingReviewColumns()
      .filter(column => !['events', 'statusLogs', 'description', 'id', 'source', 'linkedCaseId', 'progress', 'supplementalNotes', 'referenceNo'].includes(column.key))
      .map(column => ({ label: column.label, value: ['createdBy', 'updatedBy', 'closedBy'].includes(column.key)
        ? names.get(String(row[column.key as keyof TrackingItem] || '')) || '—'
        : ['createdAt', 'updatedAt'].includes(column.key) ? formatTaipeiDateTime(String(row[column.key as keyof TrackingItem] || '')) || '—' : column.value(row) || '—', key: column.key }))
      .filter(field => !field.key.startsWith('deletion') || field.value !== '—')
      .map(({ label, value }) => ({ label, value }));
    return { reference: row.referenceNo.trim() || '申請單號未填', description: row.description || '內容未填', fields,
      notes: [{ label: '補充說明', value: row.supplementalNotes || '—' }, { label: '最新進度', value: row.progress || '—' }],
      statuses: entries.filter(isTrackingStatusEntry).map(format), other: entries.filter(entry => !isTrackingStatusEntry(entry)).map(format) };
  }) };
}

export const trackingHistoryReportFileName = (report: TrackingHistoryReport) =>
  `${report.vesselName}＿歷史記錄＿${formatTaipeiDateTime(report.generatedAt).replace(/[/: ]/g, '-')}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');

function Timeline({ entries }: { entries: HistoryEntry[] }) {
  return <ol className="tracking-history-print-timeline">{entries.map((entry, index) => <li key={index}>
    <p className="tracking-history-print-meta"><strong>{entry.title}</strong>｜{entry.at}（UTC+8）｜{entry.actor}{entry.origin && `｜${entry.origin}`}</p>
    {entry.text && <p className="tracking-history-print-text">{entry.text}</p>}
    {entry.changes.map((field, index) => <p className="tracking-history-print-change" key={index}><strong>{field.label}：</strong>{field.value}</p>)}
  </li>)}</ol>;
}

export function TrackingHistoryReportDocument({ report }: { report: TrackingHistoryReport }) {
  return <article className="tracking-history-print-document">
    <header><h1>{report.vesselName}｜歷史記錄</h1>
      <p>{report.items.length} 項｜匯出時間：{formatTaipeiDateTime(report.generatedAt)}（UTC+8）</p>
      <p>目前視窗已讀取的已保存資料，包含收合內容，不含未保存輸入；非所有欄位的完整修改歷史。各類紀錄由新到舊排列。</p>
      {report.excludedDeleted > 0 && <p>已排除 {report.excludedDeleted} 項已刪除來源。</p>}
    </header>
    {report.items.map((item, index) => <section key={index} className="tracking-history-print-item">
      <h2>{index + 1}. {item.reference}</h2>
      <p className="tracking-history-print-description"><strong>內容摘要／工程內容：</strong>{item.description}</p>
      <h3>項目資料</h3>
      <table aria-label={`${item.reference} 項目資料`}><colgroup><col style={{ width: '18%' }}/><col style={{ width: '32%' }}/><col style={{ width: '18%' }}/><col style={{ width: '32%' }}/></colgroup>
        <tbody>{Array.from({ length: Math.ceil(item.fields.length / 2) }, (_, i) => <tr key={i}>
          {[item.fields[i * 2], item.fields[i * 2 + 1]].map((field, j) => <Cell key={j} field={field}/>)}
        </tr>)}</tbody>
      </table>
      {item.notes.map(field => <p className="tracking-history-print-text" key={field.label}><strong>{field.label}：</strong>{field.value}</p>)}
      <h3>歷史更新紀錄（{item.statuses.length}）</h3>
      {item.statuses.length ? <Timeline entries={item.statuses}/> : <p>尚無已保存的狀態更新紀錄。</p>}
      <h3>其他操作紀錄（{item.other.length}）</h3>
      {item.other.length ? <Timeline entries={item.other}/> : <p>尚無其他操作紀錄。</p>}
    </section>)}
  </article>;
}
function Cell({ field }: { field?: Field }) { return <><th>{field?.label || ''}</th><td>{field?.value || ''}</td></>; }

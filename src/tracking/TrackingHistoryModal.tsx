import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { makeTrackingHistoryReport, TrackingHistoryReportDocument, trackingHistoryReportFileName, type TrackingHistoryReport } from './TrackingHistoryReport';
import type { UserAccount } from '../types';
import { formatTaipeiDateTime } from '../taipeiTime';
import type { TrackingItem } from './trackingTypes';
import type { TrackingAudience } from './trackingUiTypes';
import { TrackingDeletionStatus } from './TrackingDeletionFields';
import { trackingReviewColumns } from './trackingColumns';
import { isTrackingDeleted } from './trackingDeletion';
import { trackingItemLabel } from './trackingDisplay';

import { trackingHistoryFieldLabels as fieldLabels, displayValue, trackingHistoryEntries, isTrackingStatusEntry } from './trackingHistoryPresentation';
export { trackingHistoryEntries } from './trackingHistoryPresentation';

export function TrackingHistoryModal({ rows, users, audience, vesselName, onClose, canExport = false, exportBlocked = false }: {
  rows: TrackingItem[]; users: Pick<UserAccount, 'id' | 'name'>[]; audience: TrackingAudience; vesselName: string; onClose: () => void; canExport?: boolean; exportBlocked?: boolean;
}) {
  const [report, setReport] = useState<TrackingHistoryReport | null>(null);
  const [printing, setPrinting] = useState(false), [printNotice, setPrintNotice] = useState('');
  const mounted = useRef(false), busy = useRef(false), generation = useRef(0), cleanupPrint = useRef<null | (() => void)>(null);
  const signature = JSON.stringify([rows, users, audience, vesselName, canExport, exportBlocked]);
  const lastSignature = useRef(signature);
  if (lastSignature.current !== signature) { lastSignature.current = signature; generation.current++; }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; cleanupPrint.current?.(); };
  }, []);
  useEffect(() => { cleanupPrint.current?.(); }, [signature]);
  const printableCount = rows.filter(row => !isTrackingDeleted(row)).length;
  const print = async () => {
    if (busy.current || !canExport || exportBlocked || !printableCount) return;
    busy.current = true; setPrinting(true); setPrintNotice('正在整理所選紀錄…');
    const token = generation.current, current = () => mounted.current && token === generation.current;
    let handedToPrint = false;
    try {
      const snapshot = makeTrackingHistoryReport({ rows, users, audience, vesselName, generatedAt: new Date().toISOString() });
      // Mount only escaped, frozen display strings. Collapsed screen DOM is never the print source.
      flushSync(() => setReport(snapshot));
      await document.fonts.ready;
      if (!current()) return;
      const previousTitle = document.title, style = document.createElement('style');
      style.dataset.trackingHistoryPrint = 'true';
      style.textContent = '@page { size: A4 portrait; margin: 10mm 11mm 14mm; @bottom-right { content: "第 " counter(page) " 頁／共 " counter(pages) " 頁"; font-family: "Microsoft JhengHei"; font-size: 8pt; } }';
      document.head.append(style); document.title = trackingHistoryReportFileName(snapshot);
      document.body.classList.add('printing-tracking-history');
      const cleanup = () => {
        style.remove(); document.title = previousTitle; document.body.classList.remove('printing-tracking-history');
        window.removeEventListener('afterprint', cleanup); cleanupPrint.current = null; busy.current = false;
        if (mounted.current) { setReport(null); setPrinting(false); }
      };
      cleanupPrint.current = cleanup; window.addEventListener('afterprint', cleanup, { once: true });
      handedToPrint = true; setPrintNotice('已開啟列印視窗；請選擇「另存為 PDF」。取消列印不會修改任何資料。');
      window.print();
    } catch {
      cleanupPrint.current?.(); handedToPrint = false;
      if (mounted.current) setPrintNotice('未能啟動 PDF 列印，請重試。');
    } finally {
      if (!handedToPrint) {
        busy.current = false;
        if (mounted.current) { setReport(null); setPrinting(false); if (!current()) setPrintNotice('資料、身份或範圍已變更，本次未導出；請重新核對紀錄後再試。'); }
      }
    }
  };
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const names = new Map(users.map(user => [user.id, user.name]));
  const timeline = (entries: ReturnType<typeof trackingHistoryEntries>) => <ol className="tracking-history-timeline">{entries.map(entry => <li key={entry.id}>
    <div className="tracking-history-meta"><strong>{entry.title}</strong><time dateTime={entry.at}>{formatTaipeiDateTime(entry.at) || '時間未記錄'}</time><span>（UTC+8）｜{entry.actor || names.get(entry.actorId || '') || '更新者未記錄'}</span>
      {entry.event && <span>｜{entry.event.entry === 'tracking' ? '跟蹤清單' : entry.event.entry === 'internal-control' ? '內控' : audience === 'shore' ? '要事' : '關聯記錄'}</span>}
    </div>
    {entry.event ? <dl className="tracking-history-changes">{[...new Set([...Object.keys(entry.event.before || {}), ...Object.keys(entry.event.after || {})])].filter(key => !['caseId', 'taskId'].includes(key)).map(key => <div key={key}><dt>{fieldLabels[key] || key}</dt><dd><span>{displayValue(key, entry.event!.before?.[key], names)}</span><span aria-label="變更為"> → </span><span>{displayValue(key, entry.event!.after?.[key], names)}</span></dd></div>)}</dl> : <p className="tracking-history-text">{entry.text}</p>}
  </li>)}</ol>;
  return <><div className="modal-backdrop"><section className="modal tracking-history-modal" role="dialog" aria-modal="true" aria-labelledby="tracking-history-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),summary')].filter(node => node.getClientRects().length);
      const edge = event.shiftKey ? nodes[0] : nodes[nodes.length - 1], next = event.shiftKey ? nodes[nodes.length - 1] : nodes[0];
      if (document.activeElement === edge) { event.preventDefault(); next?.focus(); }
    }
  }}>
    <div className="modal-head"><h2 id="tracking-history-title">歷史記錄（{rows.length} 項）</h2><div className="tracking-history-pdf-actions">{canExport && <button type="button" className="btn primary" disabled={exportBlocked || printing || !printableCount} onClick={() => void print()}>導出 PDF</button>}<button ref={closeButton} type="button" className="btn ghost" onClick={onClose}>關閉紀錄</button></div></div>
    {canExport && <p className="tracking-history-note">PDF 包含所選未刪除項目的完整資料與收合紀錄，先項目資料、後歷史；A4 直向。於列印視窗選擇「另存為 PDF」。</p>}
    {printNotice && <p className="tracking-history-note" role="status">{printNotice}</p>}
    <p className="tracking-history-note"><strong>{vesselName}</strong>｜目前清單已讀取的紀錄，不含未保存輸入。此視窗僅供查看，不取得編輯權。</p>
    <p className="tracking-history-note">優先顯示已保存的進度文字、送船／完工及結案狀態變更；其他操作另行收合。不是所有欄位的完整修改歷史。</p>
    {rows.map(row => {
      const entries = trackingHistoryEntries(row);
      const statuses = entries.filter(isTrackingStatusEntry), other = entries.filter(entry => !isTrackingStatusEntry(entry));
      return <details className="tracking-history-item" data-history-id={row.id} key={row.id} open>
        <summary><strong>{trackingItemLabel(row)}</strong><span>｜{row.isClosed ? '已結案' : '未結案'}｜{statuses.length} 筆狀態更新</span></summary>
        <TrackingDeletionStatus row={row}/>
        {statuses.length ? timeline(statuses) : <p>尚無已保存的狀態更新紀錄。</p>}
        <details className="tracking-other-history"><summary>其他操作紀錄（{other.length}）</summary>{other.length ? timeline(other) : <p>尚無其他操作紀錄。</p>}</details>
        <details className="tracking-retained-details" open={isTrackingDeleted(row)}><summary>目前保留資料（含原分類及日期）</summary><dl className="tracking-history-changes">{trackingReviewColumns().filter(column => !['events', 'statusLogs', 'description', 'id', 'source'].includes(column.key)).map(column => <div key={column.key}><dt>{column.label}</dt><dd>{column.key === 'closedBy' ? names.get(row.closedBy || '') || '—' : column.value(row) || '—'}</dd></div>)}</dl></details>
      </details>;
    })}
  </section></div>{report && createPortal(<div className="tracking-history-print-root" aria-hidden="true"><TrackingHistoryReportDocument report={report}/></div>, document.body)}</>;
}

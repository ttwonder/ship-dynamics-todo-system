import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppData, UserAccount } from './types';
import { formatTaipeiDateTime } from './taipeiTime';
import { assignmentCellText, assignmentReportFileName, buildManagementAssignmentReport, canExportManagementAssignments, type ManagementAssignmentReport } from './managementAssignmentReport';
import './managementAssignmentReport.css';

export function ManagementAssignmentPaper({ report }: { report: ManagementAssignmentReport }) {
  return <article className="management-assignment-paper">
    <header><h1>目前船舶分管表</h1><p>匯出時間（台北）：{formatTaipeiDateTime(report.generatedAt)}｜啟用船舶 {report.vessels.length} 艘｜來源版本 Rev.{report.revision}</p></header>
    <table><colgroup><col className="fleet"/><col className="ship-type"/><col className="chinese"/><col className="english"/>{report.departments.map(department => <col key={department}/>)}</colgroup>
      <thead><tr><th rowSpan={2}>船隊</th><th rowSpan={2}>船型</th><th colSpan={2}>船名</th><th colSpan={report.departments.length}>分管部門／人員</th></tr><tr><th>中文</th><th>英文</th>{report.departments.map(department => <th key={department}>{department}</th>)}</tr></thead>
      <tbody>{report.vessels.map(vessel => <tr key={vessel.id}><td>{vessel.fleet}</td><td>{vessel.shipType}</td><td>{vessel.chineseName || '—'}</td><td>{vessel.englishName || '—'}</td>{vessel.cells.map((cell, index) => <td key={report.departments[index]}>{assignmentCellText(cell)}</td>)}</tr>)}
        {!report.vessels.length && <tr><td colSpan={4 + report.departments.length}>目前無啟用船舶</td></tr>}</tbody>
    </table>
    <footer>範圍：全部啟用船舶及啟用岸端分管人員，不受列表搜尋影響。括號內為已啟用代理；系統未記錄一對一職務代理關係。停用人員、未啟用代理、船舶帳戶及未保存編輯不列入。</footer>
  </article>;
}

function AssignmentPreview({ report, close }: { report: ManagementAssignmentReport; close: () => void }) {
  const shell = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null), cleanupPrint = useRef<(() => void) | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(shell.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1]?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0]?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); cleanupPrint.current?.(); previous?.focus(); };
  }, []);
  const print = () => {
    cleanupPrint.current?.();
    const title = document.title;
    const cleanup = () => { document.body.classList.remove('printing-management-assignments'); document.title = title; window.removeEventListener('afterprint', cleanup); cleanupPrint.current = null; };
    cleanupPrint.current = cleanup;
    document.title = assignmentReportFileName(report, 'pdf').replace(/\.pdf$/, '');
    document.body.classList.add('printing-management-assignments');
    window.addEventListener('afterprint', cleanup, { once: true });
    try { window.print(); } catch (error) { cleanup(); throw error; }
  };
  return createPortal(<div className="report-preview-modal management-assignment-modal" role="dialog" aria-modal="true" aria-labelledby="management-assignment-title">
    <div ref={shell} className="report-preview-shell management-assignment-shell">
      <div className="report-preview-actions no-print"><h2 id="management-assignment-title">船舶分管 PDF 預覽</h2><span>A4 橫向</span><div className="spacer"/><button className="btn primary" onClick={print}>導出／列印 PDF</button><button ref={closeButton} className="btn ghost" onClick={close}>關閉</button></div>
      <ManagementAssignmentPaper report={report}/>
    </div>
  </div>, document.body);
}

export default function ManagementAssignmentExports({ data, currentUser, captureContext }: { data: AppData; currentUser: UserAccount; captureContext: () => () => boolean }) {
  const [report, setReport] = useState<ManagementAssignmentReport | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const mounted = useRef(true), latest = useRef({ data, currentUser });
  latest.current = { data, currentUser };
  const allowed = canExportManagementAssignments(data, currentUser);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setReport(null); setNotice(''); }, [currentUser.id, allowed]);
  const exportExcel = async () => {
    if (busy || !canExportManagementAssignments(latest.current.data, latest.current.currentUser)) return;
    const context = captureContext();
    const actorId = currentUser.id;
    const isCurrent = () => mounted.current && context() && latest.current.currentUser.id === actorId && canExportManagementAssignments(latest.current.data, latest.current.currentUser);
    const snapshot = buildManagementAssignmentReport(latest.current.data);
    setBusy(true); setNotice('');
    try {
      const { downloadManagementAssignmentWorkbook } = await import('./managementAssignmentExcel');
      if (isCurrent() && await downloadManagementAssignmentWorkbook(snapshot, isCurrent) && isCurrent()) setNotice('分管 Excel 已產生，含船舶及人員分管分頁。');
    } catch (error) { if (isCurrent()) setNotice(`分管 Excel 匯出失敗：${error instanceof Error ? error.message : '請稍後再試'}`); }
    finally { if (mounted.current) setBusy(false); }
  };
  if (!allowed) return null;
  return <>
    <div className="management-assignment-export-actions" aria-label="目前分管情況匯出">
      <button className="btn small ghost" title="匯出全部啟用船舶，不受列表搜尋影響；未保存編輯不納入" onClick={() => { if (canExportManagementAssignments(latest.current.data, latest.current.currentUser)) setReport(buildManagementAssignmentReport(latest.current.data)); }}>分管表 PDF</button>
      <button className="btn small ghost" title="匯出全部啟用船舶及人員分管明細" disabled={busy} onClick={() => void exportExcel()}>{busy ? '匯出中…' : '分管表 Excel'}</button>
      {notice && <small role="status">{notice}</small>}
    </div>
    {report && <AssignmentPreview report={report} close={() => setReport(null)}/>}
  </>;
}

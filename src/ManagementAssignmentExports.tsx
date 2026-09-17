import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppData, UserAccount } from './types';
import { formatTaipeiDateTime } from './taipeiTime';
import { assignmentCellText, assignmentColumnWidths, assignmentRowSpans, assignmentReportFileName, buildManagementAssignmentReport, canExportManagementAssignments, type ManagementAssignmentReport } from './managementAssignmentReport';
import './managementAssignmentReport.css';

function fitAssignmentPaper(paper: HTMLElement): void {
  // Measure once at the fixed printable width; never inverse-compensate zoom.
  paper.style.setProperty('--assignment-print-scale', '1');
  const previousZoom = paper.style.getPropertyValue('zoom');
  paper.style.setProperty('zoom', '1');
  // Cells wrap at the shared table font size; only the whole page may scale.
  // A4 portrait, 6 mm margins, plus 1 mm rounding allowance at the bottom.
  const maxHeight = 284 * 96 / 25.4;
  let scale = Math.min(1, maxHeight / Math.max(1, paper.getBoundingClientRect().height));
  // Collapsed table borders round to device pixels; actual zoomed height is
  // not exactly unscaled height * scale, especially for a long fleet list.
  for (let attempt = 0; attempt < 4; attempt++) {
    paper.style.setProperty('zoom', String(scale));
    const height = paper.getBoundingClientRect().height;
    if (height <= maxHeight) break;
    scale *= maxHeight / height * 0.995;
  }
  paper.style.setProperty('--assignment-print-scale', String(scale));
  if (previousZoom) paper.style.setProperty('zoom', previousZoom);
  else paper.style.removeProperty('zoom');
}

export function ManagementAssignmentPaper({ report }: { report: ManagementAssignmentReport }) {
  const paper = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    const fit = () => { if (active && paper.current) fitAssignmentPaper(paper.current); };
    fit();
    void document.fonts.ready.then(fit);
    window.addEventListener('beforeprint', fit);
    return () => { active = false; window.removeEventListener('beforeprint', fit); };
  }, [report]);
  const widths = assignmentColumnWidths(report.departments), total = widths.reduce((sum, width) => sum + width, 0);
  const rowSpans = assignmentRowSpans(report);
  const text = (value: string) => <span className="assignment-cell-text">{value}</span>;
  return <article ref={paper} className="management-assignment-paper">
    <header><h1>目前船舶分管表</h1><p>匯出時間（台北）：{formatTaipeiDateTime(report.generatedAt)}｜啟用船舶 {report.vessels.length} 艘</p></header>
    <table><colgroup>{widths.map((width, index) => <col key={index} style={{ width: `${width / total * 100}%` }}/>)}</colgroup>
      <thead><tr><th rowSpan={2}>{text('船隊')}</th><th rowSpan={2}>{text('船型')}</th><th colSpan={2}>{text('船名')}</th><th colSpan={report.departments.length}>{text('分管部門／人員')}</th><th rowSpan={2}>{text('年份')}</th><th rowSpan={2}>{text('噸數')}</th></tr><tr><th>{text('中文')}</th><th>{text('英文')}</th>{report.departments.map(department => <th key={department}>{text(department)}</th>)}</tr></thead>
      <tbody>{report.vessels.map((vessel, row) => <tr key={vessel.id}>
        {[vessel.fleet, vessel.shipType, vessel.chineseName || '—', vessel.englishName || '—'].map((value, index) => <td key={index}>{text(value)}</td>)}
        {vessel.cells.map((cell, column) => rowSpans[row][column] ? <td key={`department-${column}`} rowSpan={rowSpans[row][column]}>{text(assignmentCellText(cell, ' '))}</td> : null)}
        <td>{text(vessel.yearLabel || '—')}</td><td>{text(vessel.tonnageLabel || '—')}</td>
      </tr>)}
        {!report.vessels.length && <tr><td colSpan={6 + report.departments.length}>目前無啟用船舶</td></tr>}</tbody>
    </table>
    <footer>範圍：全部啟用船舶及啟用岸端分管人員，不受列表搜尋影響。括號內為預設代管人員，* 表示該船代管已激活；系統未記錄一對一職務代理關係。停用人員、船舶帳戶及未保存編輯不列入。</footer>
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
    const paper = shell.current?.querySelector<HTMLElement>('.management-assignment-paper');
    if (paper) fitAssignmentPaper(paper);
    const title = document.title;
    // Also scope the anonymous page used by Chromium's print root. The app's
    // shared landscape @page can otherwise win despite the article's named page.
    const pageStyle = document.createElement('style');
    pageStyle.dataset.assignmentPrintPage = 'true';
    pageStyle.textContent = '@page { size: A4 portrait; margin: 6mm; }';
    document.head.append(pageStyle);
    const cleanup = () => { pageStyle.remove(); document.body.classList.remove('printing-management-assignments'); document.title = title; window.removeEventListener('afterprint', cleanup); cleanupPrint.current = null; };
    cleanupPrint.current = cleanup;
    document.title = assignmentReportFileName(report, 'pdf').replace(/\.pdf$/, '');
    document.body.classList.add('printing-management-assignments');
    window.addEventListener('afterprint', cleanup, { once: true });
    try { window.print(); } catch (error) { cleanup(); throw error; }
  };
  return createPortal(<div className="report-preview-modal management-assignment-modal" role="dialog" aria-modal="true" aria-labelledby="management-assignment-title">
    <div ref={shell} className="report-preview-shell management-assignment-shell">
      <div className="report-preview-actions no-print"><h2 id="management-assignment-title">船舶分管 PDF 預覽</h2><span>A4 直向・單頁</span><div className="spacer"/><button className="btn primary" onClick={print}>導出／列印 PDF</button><button ref={closeButton} className="btn ghost" onClick={close}>關閉</button></div>
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

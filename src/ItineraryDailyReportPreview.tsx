import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatTaipeiDateTime } from './taipeiTime';
import { printItineraryDailyReportPdf } from './itineraryDailyReportPdf';
import type { ItineraryDailyReport, ItineraryDailyReportVesselSnapshot } from './itineraryDailyReports';
import { formatItineraryUtcOffset, instantToWallTime } from './itinerary/itineraryTime';
import { formatItineraryOperation, resolveItineraryTimeZone, type ItineraryRow } from './itinerary/itineraryTypes';

interface Props {
  report: ItineraryDailyReport;
  close: () => void;
}

const text = (value: unknown, fallback = '—') => {
  const normalized = typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value);
  return normalized || fallback;
};

const numberText = (value: unknown, suffix: string) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : '';

function businessDateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function itineraryTime(row: ItineraryRow, field: 'etaUtc' | 'etbUtc' | 'etcUtc' | 'etdUtc'): string {
  const instant = row[field];
  if (!instant) return '—';
  const zone = resolveItineraryTimeZone(row, field);
  const wall = instantToWallTime(instant, zone);
  if (!wall.ok) return '時間格式錯誤';
  const offset = formatItineraryUtcOffset(zone, instant) || zone;
  return `${wall.date}\n${wall.time} ${offset}`;
}

function calculationNotes(row: ItineraryRow): string[] {
  const movement = [
    numberText(row.oceanDistanceNm, ' NM'),
    numberText(row.speedKnots, ' kn'),
    numberText(row.sailingHours, ' h航行'),
    numberText(row.berthWaitHours, ' h等泊'),
    numberText(row.channelSailingHours, ' h航道'),
  ].filter(Boolean).join('｜');
  const operation = [
    text(row.tanksText, ''),
    numberText(row.operationQuantityMt, ' MT'),
    numberText(row.operationRateMtPerHour, ' MT/h'),
    numberText(row.operationHours, ' h作業'),
    numberText(row.preCompletionDelayHours, ' h完貨前'),
    numberText(row.postCompletionDelayHours, ' h完貨後'),
    numberText(row.departureBufferDays, ' d緩衝'),
  ].filter(Boolean).join('｜');
  return [text(row.notesText, ''), movement, operation].filter(Boolean);
}

function VesselItinerary({ vessel }: { vessel: ItineraryDailyReportVesselSnapshot }) {
  const rows = useMemo(() => [...vessel.rows].sort((left, right) =>
    Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      || text(left.rowId, '').localeCompare(text(right.rowId, '')),
  ), [vessel.rows]);
  const previousPort = rows[0]?.previousPortName?.trim() || '未填';
  return <section className="itinerary-daily-report-vessel">
    <header>
      <div><h2>{vessel.vesselName}</h2><span>上一港：{previousPort}</span></div>
      <p>正式 Rev.{vessel.revision || 0}｜更新：{vessel.updatedAt ? formatTaipeiDateTime(vessel.updatedAt, false) : '尚無正式保存'}</p>
    </header>
    {rows.length ? <table className="itinerary-daily-report-table">
      <colgroup><col className="voyage"/><col className="port"/><col className="purpose"/><col className="cargo"/>
        <col className="time"/><col className="time"/><col className="rate"/><col className="time"/><col className="time"/>
        <col className="draft"/><col className="rob"/><col className="notes"/></colgroup>
      <thead><tr><th>Voy No.</th><th>Next Port &amp; Dock</th><th>Purpose</th><th>Cargo / Qty</th><th>ETA (LT)</th><th>ETB (LT)</th><th>L/D Rate</th><th>ETC (LT)</th><th>ETD (LT)</th><th>Draft (Arr → Dep)</th><th>ROB (Arr → Dep)</th><th>備註／計算</th></tr></thead>
      <tbody>{rows.map(row => <tr key={text(row.rowId, `${vessel.vesselId}-${row.sortOrder}`)}>
        <td>{text(row.voyageNumber)}</td><td>{text(row.portDockName)}</td><td>{text(formatItineraryOperation(row.operation))}</td><td>{text(row.cargoQuantityText)}</td>
        <td>{itineraryTime(row, 'etaUtc')}</td><td>{itineraryTime(row, 'etbUtc')}</td><td>{text(row.ldRateText)}</td><td>{itineraryTime(row, 'etcUtc')}</td><td>{itineraryTime(row, 'etdUtc')}</td>
        <td className="itinerary-daily-report-pair"><span><b>Arr</b>{text(row.arrivalDraftText)}</span><span><b>Dep</b>{text(row.departureDraftText)}</span></td>
        <td className="itinerary-daily-report-pair"><span><b>Arr</b>{text(row.arrivalRobText)}</span><span><b>Dep</b>{text(row.departureRobText)}</span></td>
        <td>{calculationNotes(row).length ? calculationNotes(row).map((line, index) => <span key={index}>{line}</span>) : '—'}</td>
      </tr>)}</tbody>
    </table> : <div className="itinerary-daily-report-empty">無正式 Itinerary 內容</div>}
  </section>;
}

export default function ItineraryDailyReportPreview({ report, close }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !shellRef.current) return;
      const focusable = Array.from(shellRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  const content = <div className="report-preview-modal itinerary-daily-report-modal" role="dialog" aria-modal="true" aria-labelledby="itinerary-daily-report-title">
    <div ref={shellRef} tabIndex={-1} className="report-preview-shell itinerary-daily-report-shell">
      <div className="report-preview-actions no-print">
        <h2 id="itinerary-daily-report-title">每日 Itinerary PDF 預覽</h2><span>A4 橫向</span><div className="spacer"/>
        <button className="btn primary" onClick={() => printItineraryDailyReportPdf(report.businessDate)}>導出／列印 PDF</button>
        <button ref={closeButtonRef} className="btn ghost" onClick={close}>關閉</button>
      </div>
      <article className="itinerary-daily-report-paper">
        <header className="itinerary-daily-report-heading">
          <div><p>FLEET OPERATIONS</p><h1>每日正式 Itinerary 匯整</h1></div>
          <dl><div><dt>報告日期</dt><dd>{businessDateLabel(report.businessDate)}</dd></div><div><dt>產生時間</dt><dd>{formatTaipeiDateTime(report.generatedAt, false)}（台北）</dd></div><div><dt>產生方式</dt><dd>09:00 自動</dd></div></dl>
        </header>
        <div className="itinerary-daily-report-kpis"><span>船舶 <b>{report.vesselCount}</b> 艘</span><span>正式行程 <b>{report.rowCount}</b> 列</span><span>來源最高版本 <b>Rev.{report.sourceMaxRevision}</b></span><span>時區 <b>Asia/Taipei</b></span></div>
        {report.snapshot.vessels.map(vessel => <VesselItinerary key={vessel.vesselId} vessel={vessel}/>)}
        <footer>本報告於台北時間每日 09:00 自動凍結；僅包含各船正式主 Itinerary，不包含備選方案。後續修改不會回寫本快照。</footer>
      </article>
    </div>
  </div>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

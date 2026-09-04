import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgendaReport } from './types';
import { formatTaipeiDateTime } from './taipeiTime';
import { locateDailyReportDate, paginateDailyReportHistory } from './dailyReportHistory';
import {
  itineraryDailyReportErrorMessage,
  listItineraryDailyReports,
  loadItineraryDailyReport,
  type ItineraryDailyReport,
  type ItineraryDailyReportSummary,
} from './itineraryDailyReports';
import ItineraryDailyReportPreview from './ItineraryDailyReportPreview';

function businessDateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function HistoryPager({ page, pageCount, pageStart, pageSize, total, onPage }: { page:number; pageCount:number; pageStart:number; pageSize:number; total:number; onPage:(page:number)=>void }) {
  return <div className="daily-report-pagination">
    <button className="btn small ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>← 上一頁</button>
    <span>{`第 ${page}／${pageCount} 頁`}</span>
    <em>{`顯示 ${total ? pageStart + 1 : 0}–${Math.min(pageStart + pageSize, total)}／共 ${total} 天`}</em>
    <button className="btn small ghost" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>下一頁 →</button>
  </div>;
}

function DateLocator<T extends { businessDate: string }>({ reports, label, onPage }: { reports:readonly T[]; label:string; onPage:(page:number)=>void }) {
  const [date, setDate] = useState('');
  const [notice, setNotice] = useState('');
  const locate = () => {
    const target = locateDailyReportDate(reports, date);
    if (!target) {
      setNotice(date ? '所選日期沒有保存記錄' : '請先選擇日期');
      return;
    }
    onPage(target.page);
    setNotice(`已定位 ${date}`);
  };
  return <div className="daily-report-date-locator">
    <input type="date" aria-label={label} value={date} onChange={event => { setDate(event.target.value); setNotice(''); }}/>
    <button className="btn small ghost" onClick={locate}>定位日期</button>
    {notice && <small role="status">{notice}</small>}
  </div>;
}

export function MorningDailyHistoryPanel({ reports, onOpen }: { reports:AgendaReport[]; onOpen:(report:AgendaReport)=>void }) {
  const [page, setPage] = useState(1);
  const dailyReports = useMemo(() => reports.filter((report): report is AgendaReport & { businessDate:string } => /^\d{4}-\d{2}-\d{2}$/.test(report.businessDate || '')), [reports]);
  const current = useMemo(() => paginateDailyReportHistory(dailyReports, page), [dailyReports, page]);
  useEffect(() => { if (current.page !== page) setPage(current.page); }, [current.page, page]);
  return <div className="panel daily-report-history-panel morning-daily-history-panel">
    <div className="daily-report-history-heading"><div><h2>每日早會歷史</h2><small>每頁最多 30 天</small></div><DateLocator reports={dailyReports} label="每日早會歷史日期" onPage={setPage}/></div>
    {current.items.length ? <div className="daily-report-history-list">{current.items.map(report => <div className="saved-report" key={report.id}>
      <div><b>{report.title}</b><small>{report.businessDate}｜更新 {formatTaipeiDateTime(report.updatedAt || report.createdAt, false)}｜{report.source === 'scheduled' ? '09:00自動' : '手動'}｜{report.vesselIds.length} 艘｜{report.taskCount} 件</small></div>
      <button className="btn small ghost" onClick={() => onOpen(report)}>檢視當日快照</button>
    </div>)}</div> : <div className="empty-state compact">尚無每日早會歷史</div>}
    <HistoryPager page={current.page} pageCount={current.pageCount} pageStart={current.pageStart} pageSize={current.items.length} total={current.total} onPage={setPage}/>
  </div>;
}

export function ItineraryDailyHistoryPanel({ reports, loading, errorText, openingDate, onRefresh, onOpen }: {
  reports:ItineraryDailyReportSummary[];
  loading:boolean;
  errorText:string;
  openingDate:string;
  onRefresh:()=>void;
  onOpen:(report:ItineraryDailyReportSummary)=>void;
}) {
  const [page, setPage] = useState(1);
  const current = useMemo(() => paginateDailyReportHistory(reports, page), [reports, page]);
  useEffect(() => { if (current.page !== page) setPage(current.page); }, [current.page, page]);
  return <div className="panel daily-report-history-panel itinerary-daily-history-panel">
    <div className="daily-report-history-heading"><div><h2>每日 Itinerary 記錄</h2><small>每天 09:00（台北）自動凍結｜每頁最多 30 天</small></div><button className="btn small ghost" disabled={loading} onClick={onRefresh}>{loading ? '讀取中…' : '↻ 刷新'}</button></div>
    <DateLocator reports={reports} label="每日 Itinerary 記錄日期" onPage={setPage}/>
    {errorText && <div className="daily-report-history-error" role="alert">{errorText}</div>}
    {current.items.length ? <div className="daily-report-history-list">{current.items.map(report => <div className="saved-report" key={report.businessDate}>
      <div><b>{businessDateLabel(report.businessDate)} Itinerary</b><small>{report.businessDate}｜{formatTaipeiDateTime(report.generatedAt, false)}｜09:00自動｜{report.vesselCount} 艘｜{report.rowCount} 列</small></div>
      <button className="btn small ghost" disabled={Boolean(openingDate)} onClick={() => onOpen(report)}>{openingDate === report.businessDate ? '載入中…' : '檢視橫版 PDF'}</button>
    </div>)}</div> : <div className="empty-state compact">{loading ? '正在讀取每日 Itinerary 記錄…' : '尚無每日 Itinerary 記錄'}</div>}
    <HistoryPager page={current.page} pageCount={current.pageCount} pageStart={current.pageStart} pageSize={current.items.length} total={current.total} onPage={setPage}/>
  </div>;
}

export default function ReportDailyHistories({ actorUserId, morningReports, onOpenMorning }: {
  actorUserId:string;
  morningReports:AgendaReport[];
  onOpenMorning:(report:AgendaReport)=>void;
}) {
  const [itineraryReports, setItineraryReports] = useState<ItineraryDailyReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [preview, setPreview] = useState<ItineraryDailyReport | null>(null);
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setErrorText('');
    try {
      const reports = await listItineraryDailyReports(actorUserId);
      if (requestGeneration.current === generation) setItineraryReports(reports);
    } catch (error) {
      if (requestGeneration.current === generation) setErrorText(itineraryDailyReportErrorMessage(error));
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [actorUserId]);

  useEffect(() => {
    setItineraryReports([]);
    setPreview(null);
    setOpeningDate('');
    void refresh();
    return () => { requestGeneration.current += 1; };
  }, [refresh]);

  const open = async (summary: ItineraryDailyReportSummary) => {
    if (openingDate) return;
    setOpeningDate(summary.businessDate);
    setErrorText('');
    try {
      setPreview(await loadItineraryDailyReport(summary.businessDate, actorUserId));
    } catch (error) {
      setErrorText(itineraryDailyReportErrorMessage(error));
      void refresh();
    } finally {
      setOpeningDate('');
    }
  };

  return <>
    <div className="grid cols-2 report-daily-history-grid">
      <ItineraryDailyHistoryPanel reports={itineraryReports} loading={loading} errorText={errorText} openingDate={openingDate} onRefresh={() => void refresh()} onOpen={report => void open(report)}/>
      <MorningDailyHistoryPanel reports={morningReports} onOpen={onOpenMorning}/>
    </div>
    {preview && <ItineraryDailyReportPreview report={preview} close={() => setPreview(null)}/>}
  </>;
}

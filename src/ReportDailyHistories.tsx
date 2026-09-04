import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgendaReport } from './types';
import { formatTaipeiDateTime } from './taipeiTime';
import { getSupabaseConfig } from './cloud';
import { locateDailyReportDate, paginateDailyReportHistory } from './dailyReportHistory';
import {
  itineraryDailyReportErrorMessage,
  listItineraryDailyReportPage,
  locateItineraryDailyReport,
  loadItineraryDailyReport,
  type ItineraryDailyReport,
  type ItineraryDailyReportPage,
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

function RemoteDateLocator({ label, loading, onLocate }: { label:string; loading:boolean; onLocate:(date:string)=>Promise<boolean> }) {
  const [date, setDate] = useState('');
  const [notice, setNotice] = useState('');
  const locate = async () => {
    if (!date) { setNotice('請先選擇日期'); return; }
    setNotice('');
    const found = await onLocate(date);
    setNotice(found ? `已定位 ${date}` : '所選日期沒有保存記錄');
  };
  return <div className="daily-report-date-locator">
    <input type="date" aria-label={label} disabled={loading} value={date} onChange={event => { setDate(event.target.value); setNotice(''); }}/>
    <button className="btn small ghost" disabled={loading} onClick={() => void locate()}>{loading ? '定位中…' : '定位日期'}</button>
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

export function ItineraryDailyHistoryPanel({ pageData, loading, errorText, openingDate, onRefresh, onPage, onLocate, onOpen }: {
  pageData:ItineraryDailyReportPage;
  loading:boolean;
  errorText:string;
  openingDate:string;
  onRefresh:()=>void;
  onPage:(page:number)=>void;
  onLocate:(date:string)=>Promise<boolean>;
  onOpen:(report:ItineraryDailyReportSummary)=>void;
}) {
  return <div className="panel daily-report-history-panel itinerary-daily-history-panel">
    <div className="daily-report-history-heading"><div><h2>每日 Itinerary 記錄</h2><small>每天 09:00（台北）自動凍結｜每頁最多 30 天</small></div><button className="btn small ghost" disabled={loading} onClick={onRefresh}>{loading ? '讀取中…' : '↻ 刷新'}</button></div>
    <RemoteDateLocator label="每日 Itinerary 記錄日期" loading={loading} onLocate={onLocate}/>
    {errorText && <div className="daily-report-history-error" role="alert">{errorText}</div>}
    {pageData.items.length ? <div className="daily-report-history-list">{pageData.items.map(report => <div className="saved-report" key={report.businessDate}>
      <div><b>{businessDateLabel(report.businessDate)} Itinerary</b><small>{report.businessDate}｜{formatTaipeiDateTime(report.generatedAt, false)}｜09:00自動｜{report.vesselCount} 艘｜{report.rowCount} 列</small></div>
      <button className="btn small ghost" disabled={Boolean(openingDate)} onClick={() => onOpen(report)}>{openingDate === report.businessDate ? '載入中…' : '檢視橫版 PDF'}</button>
    </div>)}</div> : <div className="empty-state compact">{loading ? '正在讀取每日 Itinerary 記錄…' : '尚無每日 Itinerary 記錄'}</div>}
    <HistoryPager page={pageData.page} pageCount={pageData.pageCount} pageStart={(pageData.page - 1) * pageData.pageSize} pageSize={pageData.items.length} total={pageData.total} onPage={onPage}/>
  </div>;
}

const EMPTY_ITINERARY_PAGE: ItineraryDailyReportPage = {
  items: [], page:1, pageSize:30, pageCount:1, total:0,
  setToken:'d41d8cd98f00b204e9800998ecf8427e',
};

export default function ReportDailyHistories({ actorUserId, morningReports, onOpenMorning }: {
  actorUserId:string;
  morningReports:AgendaReport[];
  onOpenMorning:(report:AgendaReport)=>void;
}) {
  const [pageData, setPageData] = useState<ItineraryDailyReportPage>(EMPTY_ITINERARY_PAGE);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [preview, setPreview] = useState<ItineraryDailyReport | null>(null);
  const requestGeneration = useRef(0);

  const refresh = useCallback(async (requestedPage: number) => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setErrorText('');
    try {
      const next = await listItineraryDailyReportPage(actorUserId, requestedPage, getSupabaseConfig());
      if (requestGeneration.current === generation) setPageData(next);
      return requestGeneration.current === generation ? next : null;
    } catch (error) {
      if (requestGeneration.current === generation) setErrorText(itineraryDailyReportErrorMessage(error));
      return null;
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [actorUserId]);

  useEffect(() => {
    setPageData(EMPTY_ITINERARY_PAGE);
    setPreview(null);
    setOpeningDate('');
    void refresh(1);
    return () => { requestGeneration.current += 1; };
  }, [refresh]);

  const locate = async (businessDate: string): Promise<boolean> => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setErrorText('');
    try {
      const config = getSupabaseConfig();
      const location = await locateItineraryDailyReport(businessDate, actorUserId, config);
      if (requestGeneration.current !== generation || !location.found || !location.page) return false;
      const next = await listItineraryDailyReportPage(actorUserId, location.page, config);
      if (requestGeneration.current !== generation) return false;
      if (next.setToken !== location.setToken
        || !next.items.some(report => report.businessDate === businessDate)) {
        setPageData(next);
        setErrorText('定位期間每日 Itinerary 記錄已變更，請再定位一次。');
        return false;
      }
      setPageData(next);
      return true;
    } catch (error) {
      if (requestGeneration.current === generation) setErrorText(itineraryDailyReportErrorMessage(error));
      return false;
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  };

  const open = async (summary: ItineraryDailyReportSummary) => {
    if (openingDate) return;
    setOpeningDate(summary.businessDate);
    setErrorText('');
    try {
      setPreview(await loadItineraryDailyReport(summary.businessDate, actorUserId));
    } catch (error) {
      setErrorText(itineraryDailyReportErrorMessage(error));
      void refresh(pageData.page);
    } finally {
      setOpeningDate('');
    }
  };

  return <>
    <div className="grid cols-2 report-daily-history-grid">
      <ItineraryDailyHistoryPanel pageData={pageData} loading={loading} errorText={errorText} openingDate={openingDate} onRefresh={() => void refresh(pageData.page)} onPage={page => void refresh(page)} onLocate={locate} onOpen={report => void open(report)}/>
      <MorningDailyHistoryPanel reports={morningReports} onOpen={onOpenMorning}/>
    </div>
    {preview && <ItineraryDailyReportPreview report={preview} close={() => setPreview(null)}/>}
  </>;
}

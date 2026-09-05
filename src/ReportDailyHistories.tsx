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

export function ItineraryDailyHistoryPanel({ pageData, loading, errorText, openingReportId, onRefresh, onPage, onLocate, onOpen }: {
  pageData:ItineraryDailyReportPage;
  loading:boolean;
  errorText:string;
  openingReportId:string;
  onRefresh:()=>void;
  onPage:(page:number)=>void;
  onLocate:(date:string)=>Promise<boolean>;
  onOpen:(report:ItineraryDailyReportSummary)=>void;
}) {
  const dateGroups = pageData.items.reduce<Array<{ businessDate:string; reports:ItineraryDailyReportSummary[] }>>((groups, report) => {
    const current = groups[groups.length - 1];
    if (current?.businessDate === report.businessDate) current.reports.push(report);
    else groups.push({ businessDate:report.businessDate, reports:[report] });
    return groups;
  }, []);
  return <div className="panel daily-report-history-panel itinerary-daily-history-panel">
    <div className="daily-report-history-heading"><div><h2>每日 Itinerary 記錄</h2><small>09:00 自動快照＋手動快照｜每頁最多 30 天</small></div><button className="btn small ghost" disabled={loading} onClick={onRefresh}>{loading ? '讀取中…' : '↻ 刷新'}</button></div>
    <RemoteDateLocator label="每日 Itinerary 記錄日期" loading={loading} onLocate={onLocate}/>
    {errorText && <div className="daily-report-history-error" role="alert">{errorText}</div>}
    {dateGroups.length ? <div className="daily-report-history-list itinerary-report-date-groups">{dateGroups.map(group => <section className="itinerary-report-date-group" key={group.businessDate}>
      <div className="itinerary-report-date-heading"><b>{businessDateLabel(group.businessDate)} Itinerary</b><small>{group.reports.length} 份快照</small></div>
      {group.reports.map(report => <div className="saved-report" key={report.reportId}>
        <div><b>{report.generatedBy === 'scheduled' ? '09:00 自動快照' : '手動保存快照'}</b><small>{formatTaipeiDateTime(report.generatedAt, false)}｜{report.vesselCount} 艘｜{report.rowCount} 列</small></div>
        <button className="btn small ghost" disabled={Boolean(openingReportId)} onClick={() => onOpen(report)}>{openingReportId === report.reportId ? '載入中…' : '檢視橫版 PDF'}</button>
      </div>)}
    </section>)}</div> : <div className="empty-state compact">{loading ? '正在讀取每日 Itinerary 記錄…' : '尚無每日 Itinerary 記錄'}</div>}
    <HistoryPager page={pageData.page} pageCount={pageData.pageCount} pageStart={(pageData.page - 1) * pageData.pageSize} pageSize={pageData.pageSize} total={pageData.dateTotal} onPage={onPage}/>
  </div>;
}

const EMPTY_ITINERARY_PAGE: ItineraryDailyReportPage = {
  items: [], page:1, pageSize:30, pageCount:1, total:0, dateTotal:0, reportTotal:0,
  setToken:'d41d8cd98f00b204e9800998ecf8427e',
};

export default function ReportDailyHistories({ actorUserId, morningReports, onOpenMorning, refreshToken = 0 }: {
  actorUserId:string;
  morningReports:AgendaReport[];
  onOpenMorning:(report:AgendaReport)=>void;
  refreshToken?:number;
}) {
  const [pageData, setPageData] = useState<ItineraryDailyReportPage>(EMPTY_ITINERARY_PAGE);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [openingReportId, setOpeningReportId] = useState('');
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
    setOpeningReportId('');
    void refresh(1);
    return () => { requestGeneration.current += 1; };
  }, [refresh, refreshToken]);

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
    if (openingReportId) return;
    setOpeningReportId(summary.reportId);
    setErrorText('');
    try {
      setPreview(await loadItineraryDailyReport(summary.reportId, actorUserId));
    } catch (error) {
      setErrorText(itineraryDailyReportErrorMessage(error));
      void refresh(pageData.page);
    } finally {
      setOpeningReportId('');
    }
  };

  return <>
    <div className="grid cols-2 report-daily-history-grid">
      <ItineraryDailyHistoryPanel pageData={pageData} loading={loading} errorText={errorText} openingReportId={openingReportId} onRefresh={() => void refresh(pageData.page)} onPage={page => void refresh(page)} onLocate={locate} onOpen={report => void open(report)}/>
      <MorningDailyHistoryPanel reports={morningReports} onOpen={onOpenMorning}/>
    </div>
    {preview && <ItineraryDailyReportPreview report={preview} close={() => setPreview(null)}/>}
  </>;
}

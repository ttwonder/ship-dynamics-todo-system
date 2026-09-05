import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseConfig } from './cloud';
import { formatDataBytes } from './dataManagement';
import {
  clearPendingItineraryDailyReportDelete,
  createPendingItineraryDailyReportDelete,
  deleteItineraryDailyReports,
  itineraryDailyReportErrorMessage,
  ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE,
  ItineraryDailyReportRpcError,
  listItineraryDailyReportPage,
  readPendingItineraryDailyReportDelete,
  writePendingItineraryDailyReportDelete,
  type ItineraryDailyReportPage,
  type ItineraryDailyReportSummary,
  type PendingItineraryDailyReportDelete,
} from './itineraryDailyReports';
import { formatTaipeiDateTime } from './taipeiTime';
import type { UserAccount } from './types';

const reportListLabel = (reports: ItineraryDailyReportSummary[]) => {
  const labels = reports.map(report => `${report.businessDate} ${report.generatedBy === 'scheduled' ? '09:00自動' : '手動'} ${formatTaipeiDateTime(report.generatedAt, false)}`);
  return labels.length <= 10 ? labels.join('、') : `${labels.slice(0, 10).join('、')}，另 ${labels.length - 10} 份`;
};

export function ItineraryReportDataTable({ pageData, owner, selectedReports, setSelectedReports, acting, pending, onDelete, onPage }: {
  pageData: ItineraryDailyReportPage;
  owner: boolean;
  selectedReports: Record<string, ItineraryDailyReportSummary>;
  setSelectedReports: React.Dispatch<React.SetStateAction<Record<string, ItineraryDailyReportSummary>>>;
  acting: boolean;
  pending: boolean;
  onDelete: () => void;
  onPage: (page:number) => void;
}) {
  const selectedIds = Object.keys(selectedReports);
  const selectedBytes = Object.values(selectedReports).reduce((sum, report) => sum + report.logicalBytes, 0);
  const pageIds = pageData.items.map(report => report.reportId);
  const pageFullySelected = pageIds.length > 0 && pageIds.every(reportId => Boolean(selectedReports[reportId]));
  const toggle = (report: ItineraryDailyReportSummary) => setSelectedReports(previous => {
    const next = { ...previous };
    if (next[report.reportId]) delete next[report.reportId];
    else next[report.reportId] = report;
    return next;
  });
  const togglePage = () => setSelectedReports(previous => {
    const next = { ...previous };
    for (const report of pageData.items) {
      if (pageFullySelected) delete next[report.reportId];
      else next[report.reportId] = report;
    }
    return next;
  });
  const pageStart = (pageData.page - 1) * pageData.pageSize;

  return <>
    <div className="data-management-retention-head itinerary-report-data-actions">
      <div><b>{owner ? `已人工選擇 ${selectedIds.length} 份` : '管理員可查看；只有 Owner 可刪除'}</b><span>{owner ? `預估邏輯量 ${formatDataBytes(selectedBytes)}｜可跨頁累積` : '自動與手動 Itinerary 快照均為唯讀'}</span></div>
      {owner && <><button className="btn small ghost" disabled={!pageIds.length || acting || pending} onClick={togglePage}>{pageFullySelected ? '取消當頁全部' : '勾選當頁全部'}</button><button className="btn small ghost" disabled={!selectedIds.length || acting || pending} onClick={() => setSelectedReports({})}>清除選擇</button><button className="btn danger" disabled={!selectedIds.length || acting || pending} onClick={onDelete}>{acting ? '處理中…' : `刪除所選 ${selectedIds.length} 份`}</button></>}
    </div>
    <div className="data-management-history-pagination"><button className="btn small ghost" disabled={pageData.page <= 1 || acting} onClick={() => onPage(pageData.page - 1)}>← 上一頁</button><span>{`第 ${pageData.page}／${pageData.pageCount} 頁`}</span><button className="btn small ghost" disabled={pageData.page >= pageData.pageCount || acting} onClick={() => onPage(pageData.page + 1)}>下一頁 →</button><em>{`顯示日期 ${pageData.dateTotal ? pageStart + 1 : 0}–${Math.min(pageStart + pageData.pageSize, pageData.dateTotal)}／共 ${pageData.dateTotal} 天｜本頁 ${pageData.items.length} 份／全部 ${pageData.reportTotal} 份`}</em></div>
    <div className="data-management-table-wrap history"><table className="data-management-table itinerary-report-data-table"><thead><tr><th>選擇</th><th>報告日期</th><th>保存方式</th><th>保存時間</th><th>船舶</th><th>正式行程列</th><th>最高來源版本</th><th>邏輯量</th></tr></thead><tbody>{pageData.items.map(report => <tr key={report.reportId} className={selectedReports[report.reportId] ? 'selected' : ''}><td>{owner ? <input type="checkbox" aria-label={`選擇刪除快照 ${report.reportId}`} disabled={pending || acting} checked={Boolean(selectedReports[report.reportId])} onChange={() => toggle(report)}/> : <span className="data-management-lock">唯讀</span>}</td><td><b>{report.businessDate}</b></td><td>{report.generatedBy === 'scheduled' ? '09:00自動' : '手動保存'}</td><td>{formatTaipeiDateTime(report.generatedAt)}</td><td>{report.vesselCount} 艘</td><td>{report.rowCount} 列</td><td>Rev.{report.sourceMaxRevision}</td><td>{formatDataBytes(report.logicalBytes)}</td></tr>)}{!pageData.items.length && <tr><td className="data-management-empty-row" colSpan={8}>尚無每日 Itinerary 日快照。</td></tr>}</tbody></table></div>
    <div className="data-management-warning danger"><b>只刪除所選報告快照</b><p>這個動作只會逐份刪除勾選的 <code>sd_itinerary_daily_reports</code> 報告列；不會刪除同一天其他快照、各船目前正式 Itinerary、備選行程、AppData、revision history 或操作紀錄。送出時會核對伺服器集合指紋；若預覽後有新快照產生，整批停止且不做部分刪除。</p></div>
  </>;
}

const EMPTY_REPORT_PAGE: ItineraryDailyReportPage = {
  items:[], page:1, pageSize:30, pageCount:1, total:0, dateTotal:0, reportTotal:0,
  setToken:'d41d8cd98f00b204e9800998ecf8427e',
};

export default function ItineraryReportDataView({ currentUser }: { currentUser: UserAccount }) {
  const owner = currentUser.role === 'owner';
  const [pageData, setPageData] = useState<ItineraryDailyReportPage>(EMPTY_REPORT_PAGE);
  const [selectedReports, setSelectedReports] = useState<Record<string, ItineraryDailyReportSummary>>({});
  const [selectionSetToken, setSelectionSetToken] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingItineraryDailyReportDelete | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [notice, setNotice] = useState('');
  const requestGeneration = useRef(0);

  const refresh = useCallback(async (requestedPage: number) => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setErrorText('');
    try {
      const config = getSupabaseConfig();
      if (config) setPending(readPendingItineraryDailyReportDelete(config, currentUser.id));
      const next = await listItineraryDailyReportPage(currentUser.id, requestedPage, config);
      if (requestGeneration.current !== generation) return null;
      setPageData(next);
      return next;
    } catch (error) {
      if (requestGeneration.current === generation) setErrorText(itineraryDailyReportErrorMessage(error));
      return null;
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => {
    setPageData(EMPTY_REPORT_PAGE);
    setSelectedReports({});
    setSelectionSetToken(null);
    setPending(null);
    setNotice('');
    void refresh(1);
    return () => { requestGeneration.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (!Object.keys(selectedReports).length) setSelectionSetToken(null);
    else setSelectionSetToken(previous => previous ?? pageData.setToken);
  }, [pageData.setToken, selectedReports]);

  const performDelete = async (envelope: PendingItineraryDailyReportDelete, reconciling: boolean) => {
    const config = getSupabaseConfig();
    if (!config) { setErrorText('尚未配置 Supabase，無法刪除每日 Itinerary 日快照。'); return; }
    setActing(true);
    setErrorText('');
    setNotice('');
    try {
      const result = await deleteItineraryDailyReports(envelope, config);
      clearPendingItineraryDailyReportDelete(config, currentUser.id);
      setPending(null);
      setSelectedReports({});
      setSelectionSetToken(null);
      setNotice(`${reconciling ? '上次刪除已對帳' : '每日 Itinerary 日快照已刪除'}：${result.deletedCount} 份，邏輯量 ${formatDataBytes(result.deletedBytes)}。正式 Itinerary 未變更。`);
      await refresh(pageData.page);
    } catch (error) {
      const definitive = error instanceof ItineraryDailyReportRpcError && error.definitive;
      if (definitive) {
        clearPendingItineraryDailyReportDelete(config, currentUser.id);
        setPending(null);
      } else setPending(envelope);
      if (definitive && error instanceof ItineraryDailyReportRpcError && error.code === 'REPORT_SET_CHANGED') {
        setSelectedReports({});
        setSelectionSetToken(null);
        await refresh(pageData.page);
      }
      setErrorText(itineraryDailyReportErrorMessage(error));
    } finally {
      setActing(false);
    }
  };

  const startDelete = async () => {
    if (!owner || pending || acting) return;
    const chosen = Object.keys(selectedReports).sort();
    if (!chosen.length) { setErrorText('請先人工勾選要刪除的每日 Itinerary 日快照。'); return; }
    const selectedBytes = Object.values(selectedReports).reduce((sum, report) => sum + report.logicalBytes, 0);
    const batchCount = Math.ceil(chosen.length / ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE);
    if (!window.confirm([
      `確定刪除 ${chosen.length} 份每日 Itinerary 日快照？`,
      `快照：${reportListLabel(chosen.map(reportId => selectedReports[reportId]))}`,
      `預估邏輯量：${formatDataBytes(selectedBytes)}`,
      `系統會分成 ${batchCount} 批，每批最多 ${ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE} 份。`,
      '',
      '各船目前正式 Itinerary、備選方案、AppData 與 revision history 都不會刪除。',
      '刪除後無法復原。',
    ].join('\n'))) return;
    const config = getSupabaseConfig();
    if (!config) { setErrorText('尚未配置 Supabase，無法刪除每日 Itinerary 日快照。'); return; }

    let expectedSetToken = selectionSetToken ?? pageData.setToken;
    let completed = 0;
    let deletedBytes = 0;
    setActing(true);
    setErrorText('');
    setNotice('');
    try {
      for (let index = 0; index < chosen.length; index += ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE) {
        const batch = chosen.slice(index, index + ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE);
        const envelope = createPendingItineraryDailyReportDelete({ operationId: crypto.randomUUID(), actorUserId: currentUser.id, expectedSetToken, deleteReportIds: batch }, config);
        try { writePendingItineraryDailyReportDelete(envelope, config); }
        catch { setErrorText(`已完成 ${completed}／${chosen.length} 份；下一批無法保存對帳資料，因此尚未送出。`); return; }
        setPending(envelope);
        let result;
        try { result = await deleteItineraryDailyReports(envelope, config); }
        catch (error) {
          const definitive = error instanceof ItineraryDailyReportRpcError && error.definitive;
          if (definitive) { clearPendingItineraryDailyReportDelete(config, currentUser.id); setPending(null); }
          const prefix = completed ? `已完成 ${completed}／${chosen.length} 份；` : '';
          setErrorText(`${prefix}${itineraryDailyReportErrorMessage(error)}`);
          return;
        }
        clearPendingItineraryDailyReportDelete(config, currentUser.id);
        setPending(null);
        const deleted = new Set<string>(result.deletedReportIds);
        expectedSetToken = result.remainingSetToken;
        completed += result.deletedCount;
        deletedBytes += result.deletedBytes;
        setSelectedReports(previous => {
          const next = { ...previous };
          for (const reportId of deleted) delete next[reportId];
          return next;
        });
        setNotice(`每日 Itinerary 日快照分批清理中：已完成 ${completed}／${chosen.length} 份。`);
      }
      await refresh(pageData.page);
      setSelectionSetToken(null);
      setNotice(`每日 Itinerary 日快照已刪除：${completed} 份，邏輯量 ${formatDataBytes(deletedBytes)}。正式 Itinerary 未變更。`);
    } finally {
      setActing(false);
    }
  };

  return <>
    <div className="management-editor-heading"><div><h2>Itinerary 日快照記錄</h2><p>查看09:00自動及人工保存的正式主 Itinerary 快照；只有 Owner 可逐份選擇刪除。</p></div><button className="btn small ghost" disabled={loading || acting} onClick={() => void refresh(pageData.page)}>{loading ? '讀取中…' : '↻ 刷新記錄'}</button></div>
    {errorText && <div className="data-management-message error" role="alert">{errorText}</div>}
    {notice && <div className="data-management-message success" role="status">{notice}</div>}
    {pending && <div className="data-management-pending" role="alert"><div><b>上次 Itinerary 快照刪除結果尚未確認</b><span>操作 {pending.operationId.slice(0, 8)}｜預定刪除 {pending.deleteReportIds.length} 份。系統只會用相同 operation 對帳。</span></div><button className="btn danger" disabled={acting} onClick={() => void performDelete(pending, true)}>{acting ? '對帳中…' : '對帳上次操作'}</button></div>}
    {loading && !pageData.items.length ? <div className="management-empty"><b>正在讀取每日 Itinerary 記錄</b><span>伺服器每頁只回傳30個日期內的快照時間、方式、船數、行程列數與邏輯量，不下載完整快照。</span></div> : <ItineraryReportDataTable pageData={pageData} owner={owner} selectedReports={selectedReports} setSelectedReports={setSelectedReports} acting={acting} pending={Boolean(pending)} onDelete={() => void startDelete()} onPage={page => void refresh(page)}/>}
  </>;
}

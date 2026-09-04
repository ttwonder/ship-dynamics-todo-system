import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseConfig } from './cloud';
import { paginateDailyReportHistory } from './dailyReportHistory';
import { formatDataBytes } from './dataManagement';
import {
  clearPendingItineraryDailyReportDelete,
  createPendingItineraryDailyReportDelete,
  deleteItineraryDailyReports,
  itineraryDailyReportErrorMessage,
  ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE,
  ItineraryDailyReportRpcError,
  listItineraryDailyReports,
  readPendingItineraryDailyReportDelete,
  writePendingItineraryDailyReportDelete,
  type ItineraryDailyReportSummary,
  type PendingItineraryDailyReportDelete,
} from './itineraryDailyReports';
import { formatTaipeiDateTime } from './taipeiTime';
import type { UserAccount } from './types';

const dateListLabel = (dates: string[]) => dates.length <= 10
  ? dates.join('、')
  : `${dates.slice(0, 10).join('、')}，另 ${dates.length - 10} 份`;

export function ItineraryReportDataTable({ reports, owner, selectedDates, setSelectedDates, acting, pending, onDelete }: {
  reports: ItineraryDailyReportSummary[];
  owner: boolean;
  selectedDates: string[];
  setSelectedDates: React.Dispatch<React.SetStateAction<string[]>>;
  acting: boolean;
  pending: boolean;
  onDelete: () => void;
}) {
  const [page, setPage] = useState(1);
  const current = useMemo(() => paginateDailyReportHistory(reports, page), [reports, page]);
  useEffect(() => { if (current.page !== page) setPage(current.page); }, [current.page, page]);
  const pageDates = current.items.map(report => report.businessDate);
  const pageFullySelected = pageDates.length > 0 && pageDates.every(date => selectedDates.includes(date));
  const selectedBytes = reports.filter(report => selectedDates.includes(report.businessDate)).reduce((sum, report) => sum + report.logicalBytes, 0);
  const toggle = (date: string) => setSelectedDates(previous => previous.includes(date)
    ? previous.filter(value => value !== date)
    : [...previous, date].sort().reverse());
  const togglePage = () => setSelectedDates(previous => {
    const pageSet = new Set(pageDates);
    if (pageFullySelected) return previous.filter(date => !pageSet.has(date));
    return Array.from(new Set([...previous, ...pageDates])).sort().reverse();
  });

  return <>
    <div className="data-management-retention-head itinerary-report-data-actions">
      <div><b>{owner ? `已人工選擇 ${selectedDates.length} 份` : '管理員可查看；只有 Owner 可刪除'}</b><span>{owner ? `預估邏輯量 ${formatDataBytes(selectedBytes)}｜可跨頁累積` : '每日 Itinerary 日快照為唯讀'}</span></div>
      {owner && <><button className="btn small ghost" disabled={!pageDates.length || acting || pending} onClick={togglePage}>{pageFullySelected ? '取消當頁全部' : '勾選當頁全部'}</button><button className="btn small ghost" disabled={!selectedDates.length || acting || pending} onClick={() => setSelectedDates([])}>清除選擇</button><button className="btn danger" disabled={!selectedDates.length || acting || pending} onClick={onDelete}>{acting ? '處理中…' : `刪除所選 ${selectedDates.length} 份`}</button></>}
    </div>
    <div className="data-management-history-pagination"><button className="btn small ghost" disabled={current.page <= 1} onClick={() => setPage(current.page - 1)}>← 上一頁</button><span>{`第 ${current.page}／${current.pageCount} 頁`}</span><button className="btn small ghost" disabled={current.page >= current.pageCount} onClick={() => setPage(current.page + 1)}>下一頁 →</button><em>{`顯示 ${current.total ? current.pageStart + 1 : 0}–${Math.min(current.pageStart + current.items.length, current.total)}／共 ${current.total} 份`}</em></div>
    <div className="data-management-table-wrap history"><table className="data-management-table itinerary-report-data-table"><thead><tr><th>選擇</th><th>報告日期</th><th>自動產生時間</th><th>船舶</th><th>正式行程列</th><th>最高來源版本</th><th>邏輯量</th></tr></thead><tbody>{current.items.map(report => <tr key={report.businessDate} className={selectedDates.includes(report.businessDate) ? 'selected' : ''}><td>{owner ? <input type="checkbox" aria-label={`選擇刪除 ${report.businessDate}`} disabled={pending || acting} checked={selectedDates.includes(report.businessDate)} onChange={() => toggle(report.businessDate)}/> : <span className="data-management-lock">唯讀</span>}</td><td><b>{report.businessDate}</b></td><td>{formatTaipeiDateTime(report.generatedAt)}</td><td>{report.vesselCount} 艘</td><td>{report.rowCount} 列</td><td>Rev.{report.sourceMaxRevision}</td><td>{formatDataBytes(report.logicalBytes)}</td></tr>)}{!current.items.length && <tr><td className="data-management-empty-row" colSpan={7}>尚無每日 Itinerary 日快照。</td></tr>}</tbody></table></div>
    <div className="data-management-warning danger"><b>只刪除每日報告快照</b><p>這個動作只會刪除勾選日期的 <code>sd_itinerary_daily_reports</code> 報告列；不會刪除各船目前正式 Itinerary、不會刪除備選行程，也不會改動 AppData、revision history 或操作紀錄。送出時會核對完整日期集合；若預覽後有新快照產生，整批停止且不做部分刪除。</p></div>
  </>;
}

export default function ItineraryReportDataView({ currentUser }: { currentUser: UserAccount }) {
  const owner = currentUser.role === 'owner';
  const [reports, setReports] = useState<ItineraryDailyReportSummary[]>([]);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingItineraryDailyReportDelete | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [notice, setNotice] = useState('');
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setErrorText('');
    try {
      const config = getSupabaseConfig();
      if (config) setPending(readPendingItineraryDailyReportDelete(config, currentUser.id));
      const next = await listItineraryDailyReports(currentUser.id, config);
      if (requestGeneration.current !== generation) return;
      setReports(next);
      const available = new Set(next.map(report => report.businessDate));
      setSelectedDates(previous => previous.filter(date => available.has(date)));
    } catch (error) {
      if (requestGeneration.current === generation) setErrorText(itineraryDailyReportErrorMessage(error));
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => {
    setReports([]);
    setSelectedDates([]);
    setPending(null);
    setNotice('');
    void refresh();
    return () => { requestGeneration.current += 1; };
  }, [refresh]);

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
      const deleted = new Set(result.deletedDates);
      setSelectedDates(previous => previous.filter(date => !deleted.has(date)));
      setNotice(`${reconciling ? '上次刪除已對帳' : '每日 Itinerary 日快照已刪除'}：${result.deletedCount} 份，邏輯量 ${formatDataBytes(result.deletedBytes)}。正式 Itinerary 未變更。`);
      await refresh();
    } catch (error) {
      const definitive = error instanceof ItineraryDailyReportRpcError && error.definitive;
      if (definitive) {
        clearPendingItineraryDailyReportDelete(config, currentUser.id);
        setPending(null);
      } else setPending(envelope);
      if (definitive && error instanceof ItineraryDailyReportRpcError && error.code === 'REPORT_SET_CHANGED') await refresh();
      setErrorText(itineraryDailyReportErrorMessage(error));
    } finally {
      setActing(false);
    }
  };

  const startDelete = async () => {
    if (!owner || pending || acting) return;
    const chosen = Array.from(new Set(selectedDates)).sort().reverse();
    if (!chosen.length) { setErrorText('請先人工勾選要刪除的每日 Itinerary 日快照。'); return; }
    const selectedBytes = reports.filter(report => chosen.includes(report.businessDate)).reduce((sum, report) => sum + report.logicalBytes, 0);
    const batchCount = Math.ceil(chosen.length / ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE);
    if (!window.confirm([
      `確定刪除 ${chosen.length} 份每日 Itinerary 日快照？`,
      `日期：${dateListLabel(chosen)}`,
      `預估邏輯量：${formatDataBytes(selectedBytes)}`,
      `系統會分成 ${batchCount} 批，每批最多 ${ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE} 份。`,
      '',
      '各船目前正式 Itinerary、備選方案、AppData 與 revision history 都不會刪除。',
      '刪除後無法復原。',
    ].join('\n'))) return;
    const config = getSupabaseConfig();
    if (!config) { setErrorText('尚未配置 Supabase，無法刪除每日 Itinerary 日快照。'); return; }

    let expectedDates = reports.map(report => report.businessDate).sort();
    let completed = 0;
    let deletedBytes = 0;
    setActing(true);
    setErrorText('');
    setNotice('');
    try {
      for (let index = 0; index < chosen.length; index += ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE) {
        const batch = chosen.slice(index, index + ITINERARY_DAILY_REPORT_DELETE_BATCH_SIZE);
        const envelope = createPendingItineraryDailyReportDelete({ operationId: crypto.randomUUID(), actorUserId: currentUser.id, expectedDates, deleteDates: batch }, config);
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
        const deleted = new Set(result.deletedDates);
        expectedDates = expectedDates.filter(date => !deleted.has(date));
        completed += result.deletedCount;
        deletedBytes += result.deletedBytes;
        setSelectedDates(previous => previous.filter(date => !deleted.has(date)));
        setNotice(`每日 Itinerary 日快照分批清理中：已完成 ${completed}／${chosen.length} 份。`);
      }
      await refresh();
      setNotice(`每日 Itinerary 日快照已刪除：${completed} 份，邏輯量 ${formatDataBytes(deletedBytes)}。正式 Itinerary 未變更。`);
    } finally {
      setActing(false);
    }
  };

  return <>
    <div className="management-editor-heading"><div><h2>Itinerary 日快照記錄</h2><p>查看每天台北時間 09:00 自動凍結的正式主 Itinerary；只有 Owner 可選擇刪除。</p></div><button className="btn small ghost" disabled={loading || acting} onClick={() => void refresh()}>{loading ? '讀取中…' : '↻ 刷新記錄'}</button></div>
    {errorText && <div className="data-management-message error" role="alert">{errorText}</div>}
    {notice && <div className="data-management-message success" role="status">{notice}</div>}
    {pending && <div className="data-management-pending" role="alert"><div><b>上次 Itinerary 快照刪除結果尚未確認</b><span>操作 {pending.operationId.slice(0, 8)}｜預定刪除 {pending.deleteDates.length} 份。系統只會用相同 operation 對帳。</span></div><button className="btn danger" disabled={acting} onClick={() => void performDelete(pending, true)}>{acting ? '對帳中…' : '對帳上次操作'}</button></div>}
    {loading && !reports.length ? <div className="management-empty"><b>正在讀取每日 Itinerary 記錄</b><span>只載入日期、船數、行程列數與邏輯量，不下載完整快照。</span></div> : <ItineraryReportDataTable reports={reports} owner={owner} selectedDates={selectedDates} setSelectedDates={setSelectedDates} acting={acting} pending={Boolean(pending)} onDelete={() => void startDelete()}/>}
  </>;
}

import { useEffect, useRef, useState } from 'react';
import { todayDate } from '../runtimeUtils';
import { formatTaipeiDateTime } from '../taipeiTime';
import type { Vessel } from '../types';
import type { TrackingUiCallbacks } from './trackingUiTypes';
import { calculateTrackingStatistics, statisticsPercent, statisticsQueryError, statisticsScope, STATISTICS_METRICS, STATISTICS_TYPES, type TrackingStatisticsQuery } from './trackingStatistics';
import TrackingStatisticsExports from './TrackingStatisticsExports';
import TrackingStatisticsCharts from './TrackingStatisticsCharts';
import { trackingStatisticsSummary } from './trackingStatisticsReport';
import { statisticsScopeKey, statisticsScopeOptions, statisticsVesselCatalog, statisticsVesselScopeLabel, type StatisticsCapture, type StatisticsVesselScope } from './trackingStatisticsScope';
import './trackingStatistics.css';

type Snapshot = StatisticsCapture & { generation: number; signature: string };
export default function TrackingStatistics({ vesselId, vessels, identity, workspace, callbacks, blocked, canExport }: { vesselId: string; vessels: Vessel[]; identity: string; workspace: string; callbacks: TrackingUiCallbacks; blocked: boolean; canExport: boolean }) {
  const initial: TrackingStatisticsQuery = { vesselId, from: '', to: '', type: 'all', urgency: 'all' };
  const [query, setQuery] = useState(initial), [selection, setSelection] = useState<StatisticsVesselScope>({ kind: 'vessel', value: vesselId });
  const [catalog, setCatalog] = useState(() => statisticsVesselCatalog(vessels));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0);
  const signature = JSON.stringify([identity, workspace, vesselId, selection, query]);
  const error = statisticsQueryError(query);
  const generation = useRef(0), live = useRef({ signature, blocked, canExport, callbacks });
  live.current = { signature, blocked, canExport, callbacks };
  useEffect(() => {
    const token = ++generation.current; let active = true;
    setSnapshot(null); setNotice('');
    if (blocked || !vesselId || !canExport || error) { setLoading(false); return; }
    const current = () => active && token === generation.current && signature === live.current.signature && !live.current.blocked && live.current.canExport;
    setLoading(true);
    void (async () => {
      try {
        // Let the parent clear its private-draft feedback before confirmed reads.
        await Promise.resolve(); if (!current()) return;
        let source: StatisticsCapture | null;
        if (live.current.callbacks.captureStatistics) source = await live.current.callbacks.captureStatistics(selection, query);
        else {
          // Compatibility for a single-vessel consumer only; never broaden a failed read.
          if (selection.kind !== 'vessel' || selection.value !== vesselId) throw new Error('多船統計接口尚未就緒；未以單船或部分資料代替。');
          const captured = await live.current.callbacks.captureExport?.(vesselId), today = todayDate();
          source = captured ? { stats: trackingStatisticsSummary(calculateTrackingStatistics(captured.items, query, today)), vessels: statisticsVesselCatalog(vessels), vesselIds: [vesselId], at: new Date().toISOString(), today, isCurrent: captured.isCurrent } : null;
        }
        if (!current()) return;
        if (!source || !source.isCurrent()) { setNotice('未能讀取已確認統計資料。請先完成保存／確認原結果，再重讀統計；目前不顯示零筆或部分統計。'); return; }
        setCatalog(structuredClone(source.vessels));
        setSnapshot({ ...source, stats: trackingStatisticsSummary(source.stats), generation: token, signature, isCurrent: () => current() && source!.isCurrent() });
      } catch (e) { if (current()) setNotice(e instanceof Error ? e.message : '統計讀取失敗，未建立已確認快照。請重讀統計。'); }
      finally { if (current()) setLoading(false); }
    })();
    return () => { active = false; };
    // A confirmed read may replace callbacks. The ref prevents publication loops.
  }, [signature, blocked, canExport, refresh, error]);
  useEffect(() => {
    if (snapshot && snapshot.generation === generation.current && snapshot.signature === signature && !blocked && canExport && !snapshot.isCurrent()) {
      setSnapshot(null); setRefresh(value => value + 1);
    }
  });
  const ready = snapshot && snapshot.signature === signature && snapshot.isCurrent() && !blocked;
  const stats = ready && !error ? snapshot.stats : null;
  const scope = statisticsScope(query, { metric: 'total', category: 'all' }), options = statisticsScopeOptions(catalog);
  const vesselName = statisticsVesselScopeLabel(catalog, selection);
  const update = (change: Partial<TrackingStatisticsQuery>) => setQuery(q => ({ ...q, ...change }));
  return <section className="tracking-statistics" aria-label="跟蹤統計資訊">
    <div className="tracking-stat-filters">
      <label>統計範圍<select aria-label="統計範圍" value={statisticsScopeKey(selection)} onChange={e => { const option = options.find(o => o.key === e.target.value); if (option) setSelection(option.scope); }}>{['船隊', '細分船種', '個別船舶'].map(group => <optgroup key={group} label={group}>{options.filter(o => o.group === group).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>)}</select></label>
      <label>申請／開單日期<input type="date" aria-label="統計開始日期" value={query.from} onChange={e => update({ from: e.target.value })}/></label><span>～</span><input type="date" aria-label="統計結束日期" value={query.to} onChange={e => update({ to: e.target.value })}/>
      <button className="btn small" onClick={() => update({ from: '', to: '' })}>全部期間</button><button className="btn small" onClick={() => { const today = todayDate(); update({ from: `${today.slice(0,7)}-01`, to: today }); }}>本月</button><button className="btn small" onClick={() => { const today = todayDate(); update({ from: `${today.slice(0,4)}-01-01`, to: today }); }}>今年</button>
      <select aria-label="統計類型" value={query.type} onChange={e => update({ type: e.target.value as TrackingStatisticsQuery['type'] })}>{STATISTICS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select><select aria-label="統計急件" value={query.urgency} onChange={e => update({ urgency: e.target.value as TrackingStatisticsQuery['urgency'] })}><option value="all">普通＋急件</option><option value="normal">普通</option><option value="urgent">急件</option></select>
      <button className="btn small" onClick={() => setQuery(initial)}>重設統計條件</button><button className="btn small" disabled={loading || blocked || !canExport} onClick={() => setRefresh(n => n + 1)}>重讀統計</button>
    </div>
    <p className="tracking-stat-scope">{vesselName}｜{scope.cohort}</p>
    <p className="tracking-stat-note">只統計範圍內的啟用船舶。申請數按項目 ID 計算，同單號不合併。只計目前已保存狀態，不重建歷史；取消另列、不列入有效項目與比率。</p>
    {error && <p role="alert">{error}</p>}
    {!stats && !error && <p role="status">{loading ? '正在讀取已確認統計資料…' : blocked ? '尚有讀取、編輯或未確認提交；統計暫不可用，草稿不列入統計。' : !canExport ? '此身份沒有已確認統計快照的讀取／匯出權限。' : notice || '快照尚未就緒或已失效，請重讀統計。'}</p>}
    {stats && snapshot && <>
      <p className="tracking-stat-note">確認快照：{formatTaipeiDateTime(snapshot.at)}（台北）｜逾期判定日 {snapshot.today}｜{snapshot.vesselIds.length} 艘船｜摘要、分類及圖形使用同一範圍；比率按總件數計算，不平均各船百分比。</p>
      <TrackingStatisticsExports stats={stats} query={{ ...query, vesselIds: snapshot.vesselIds }} vesselName={vesselName} generatedAt={snapshot.at} today={snapshot.today} isCurrent={snapshot.isCurrent}/>
      <div className="tracking-stat-summary" aria-label="統計摘要">{STATISTICS_METRICS.map(([key,label]) => <span key={key}>{label} <b data-stat={key}>{stats.summary[key]}</b></span>)}<span>完成率 <b data-stat="completionRate">{statisticsPercent(stats.summary.completionRate)}</b>（{stats.summary.completed}/{stats.summary.effective}）</span><span>延遲率 <b data-stat="delayRate">{statisticsPercent(stats.summary.delayRate)}</b>（{stats.summary.delayed}/{stats.summary.delayEligible}）</span></div>
      <p className="tracking-stat-note">延遲率只計有有效 DL／到期日且「已完成、實際日期齊全」或「已過 DL／到期日仍未完成」的有效項目。今日等於 DL／到期日不逾期；無 DL／到期日、日期不足與未到期未完成均不當作準時。年檢工程按到期日獨立統計，已包含於總計，不重複加總。</p>
      <div className="tracking-stat-scroll"><table className="tracking-stat-table" aria-label="統計分類表"><thead><tr>{['分類','申請數','有效項目','已完成','未完成','取消','完成率','延遲數','延遲可判定','延遲率','急件總數'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{stats.categories.map(c => <tr key={c.value}><th>{c.label}</th>{(['total','effective','completed','incomplete','cancelled'] as const).map(key => <td key={key}>{c.summary[key]}</td>)}<td>{statisticsPercent(c.summary.completionRate)}</td><td>{c.summary.delayed}</td><td>{c.summary.delayEligible}</td><td>{statisticsPercent(c.summary.delayRate)}</td><td>{c.summary.urgent}</td></tr>)}</tbody></table></div>
      <TrackingStatisticsCharts stats={stats}/>
    </>}
  </section>;
}

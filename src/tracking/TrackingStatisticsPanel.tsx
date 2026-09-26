import { useEffect, useRef, useState } from 'react';
import { todayDate } from '../runtimeUtils';
import { formatTaipeiDateTime } from '../taipeiTime';
import type { TrackingUiCallbacks } from './trackingUiTypes';
import { calculateTrackingStatistics, statisticsFocusRows, statisticsPercent, statisticsQueryError, statisticsScope, STATISTICS_METRICS, STATISTICS_TYPES, type StatisticsFocus, type StatisticsMetric, type StatisticsCategory, type TrackingStatisticsQuery } from './trackingStatistics';
import TrackingStatisticsExports from './TrackingStatisticsExports';
import { statisticsStatus, statisticsDelay } from './trackingStatisticsReport';
import type { TrackingItem } from './trackingTypes';
import './trackingStatistics.css';

type Snapshot = { items: TrackingItem[]; isCurrent: () => boolean; generation: number; at: string; today: string };
const neutralFocus: StatisticsFocus = { metric: 'total', category: 'all' };
export default function TrackingStatistics({ vesselId, vesselName, identity, workspace, callbacks, blocked, canExport }: { vesselId: string; vesselName: string; identity: string; workspace: string; callbacks: TrackingUiCallbacks; blocked: boolean; canExport: boolean }) {
  const initial: TrackingStatisticsQuery = { vesselId, from: '', to: '', type: 'all', urgency: 'all' };
  const [query, setQuery] = useState(initial), [focus, setFocus] = useState<StatisticsFocus>(neutralFocus);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(false), [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0);
  const generation = useRef(0), live = useRef({ identity, workspace, vesselId, blocked, canExport, callbacks });
  live.current = { identity, workspace, vesselId, blocked, canExport, callbacks };
  useEffect(() => {
    const token = ++generation.current; let active = true;
    setSnapshot(null); setNotice('');
    if (blocked || !vesselId || !canExport) { setLoading(false); return; }
    const current = () => active && token === generation.current && identity === live.current.identity && workspace === live.current.workspace && vesselId === live.current.vesselId && !live.current.blocked && live.current.canExport;
    setLoading(true);
    void (async () => {
      try {
        // Parent draft-feedback effects run after child effects. Wait for that
        // same commit to clear its dirty channel before the confirmed read.
        await Promise.resolve();
        if (!current()) return;
        const source = await live.current.callbacks.captureExport?.(vesselId);
        if (!current()) return;
        if (!source || !source.isCurrent()) { setNotice('未能讀取已確認統計資料。請先完成保存／確認原結果，再重試讀取；目前不顯示零筆統計。'); return; }
        setSnapshot({ items: structuredClone(source.items), generation: token, at: new Date().toISOString(), today: todayDate(), isCurrent: () => current() && source.isCurrent() });
      } catch { if (current()) setNotice('統計讀取失敗，未建立已確認快照。請重試讀取。'); }
      finally { if (current()) setLoading(false); }
    })();
    return () => { active = false; };
    // captureExport may publish AppData and replace callbacks. It is deliberately
    // read through a ref, never an effect dependency (no capture/publication loop).
  }, [identity, workspace, vesselId, blocked, canExport, refresh]);
  useEffect(() => {
    // A parent read may invalidate the confirmed source without changing scope.
    // Recapture once when that invalidation is rendered; keep query/focus intact.
    // Valid snapshots and failed reads do not trigger a capture/publication loop.
    if (snapshot && snapshot.generation === generation.current && !blocked && canExport && !snapshot.isCurrent()) {
      setSnapshot(null);
      setRefresh(value => value + 1);
    }
  });
  const scopedQuery = { ...query, vesselId }, error = statisticsQueryError(scopedQuery);
  const ready = snapshot && snapshot.isCurrent() && !blocked;
  const stats = ready && !error ? calculateTrackingStatistics(snapshot.items, scopedQuery, snapshot.today) : null;
  const details = stats ? statisticsFocusRows(stats, focus) : [], scope = statisticsScope(scopedQuery, focus);
  const update = (patch: Partial<TrackingStatisticsQuery>) => { setQuery(q => ({ ...q, ...patch })); setFocus(neutralFocus); };
  const pick = (metric: StatisticsMetric, category: StatisticsCategory | 'all' = 'all') => setFocus(previous => previous.metric === metric && previous.category === category ? neutralFocus : { metric, category });
  const count = (metric: StatisticsMetric, value: number, category: StatisticsCategory | 'all' = 'all') => <button type="button" className="tracking-stat-number" aria-pressed={focus.metric === metric && focus.category === category} aria-label={`${category === 'all' ? '摘要' : STATISTICS_TYPES.find(t => t.value === category)?.label} ${STATISTICS_METRICS.find(m => m[0] === metric)![1]} ${value}`} onClick={() => pick(metric, category)}>{value}</button>;
  return <section className="tracking-statistics" aria-label="跟蹤統計資訊">
    <div className="tracking-stat-filters">
      <label>申請／開單日期<input type="date" aria-label="統計開始日期" value={query.from} onChange={e => update({ from: e.target.value })}/></label><span>～</span><input type="date" aria-label="統計結束日期" value={query.to} onChange={e => update({ to: e.target.value })}/>
      <button className="btn small" onClick={() => update({ from: '', to: '' })}>全部期間</button><button className="btn small" onClick={() => { const today = todayDate(); update({ from: `${today.slice(0,7)}-01`, to: today }); }}>本月</button><button className="btn small" onClick={() => { const today = todayDate(); update({ from: `${today.slice(0,4)}-01-01`, to: today }); }}>今年</button>
      <select aria-label="統計類型" value={query.type} onChange={e => update({ type: e.target.value as TrackingStatisticsQuery['type'] })}>{STATISTICS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select><select aria-label="統計急件" value={query.urgency} onChange={e => update({ urgency: e.target.value as TrackingStatisticsQuery['urgency'] })}><option value="all">普通＋急件</option><option value="normal">普通</option><option value="urgent">急件</option></select>
      <button className="btn small" onClick={() => { setQuery(initial); setFocus(neutralFocus); }}>重設統計條件</button><button className="btn small" disabled={loading || blocked || !canExport} onClick={() => setRefresh(n => n + 1)}>重讀統計</button>
    </div>
    <p className="tracking-stat-scope">{vesselName}｜{scope.cohort}</p>
    <p className="tracking-stat-note">申請數按項目 ID 計算，同單號不合併。只計目前已保存狀態，不重建歷史；申請日期不是完成日期。取消另列、不列入有效項目與比率。</p>
    {error && <p role="alert">{error}</p>}
    {!stats && !error && <p role="status">{loading ? '正在讀取已確認統計資料…' : blocked ? '尚有讀取、編輯或未確認提交；統計暫不可用，草稿不列入統計。' : !canExport ? '此身份沒有已確認統計快照的讀取／匯出權限。' : notice || '快照尚未就緒或已失效，請重讀統計。'}</p>}
    {stats && snapshot && <>
      <p className="tracking-stat-note">確認快照：{formatTaipeiDateTime(snapshot.at)}（台北）｜逾期判定日 {snapshot.today}｜摘要與分類表為完整條件範圍；點數字只聚焦下方明細，不改變分母。</p>
      <TrackingStatisticsExports items={snapshot.items} query={scopedQuery} focus={focus} vesselName={vesselName} generatedAt={snapshot.at} today={snapshot.today} isCurrent={snapshot.isCurrent}/>
      <div className="tracking-stat-summary" aria-label="統計摘要">{STATISTICS_METRICS.map(([key,label]) => <span key={key}>{label} {count(key, stats.summary[key])}</span>)}<span>完成率 <b data-stat="completionRate">{statisticsPercent(stats.summary.completionRate)}</b>（{stats.summary.completed}/{stats.summary.effective}）</span><span>延遲率 <b data-stat="delayRate">{statisticsPercent(stats.summary.delayRate)}</b>（{stats.summary.delayed}/{stats.summary.delayEligible}）</span></div>
      <p className="tracking-stat-note">延遲率只計有有效 DL 且「已完成、實際日期齊全」或「已過 DL 仍未完成」的有效項目。今日等於 DL 不逾期；無 DL、日期不足與未到期未完成均不當作準時。</p>
      <div className="tracking-stat-scroll"><table className="tracking-stat-table" aria-label="統計分類表"><thead><tr>{['分類','申請數','有效項目','已完成','未完成','取消','完成率','延遲數','延遲可判定','延遲率','急件總數'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{stats.categories.map(c => <tr key={c.value}><th>{c.label}</th>{(['total','effective','completed','incomplete','cancelled'] as const).map(key => <td key={key}>{count(key,c.summary[key],c.value)}</td>)}<td>{statisticsPercent(c.summary.completionRate)}</td><td>{count('delayed',c.summary.delayed,c.value)}</td><td>{count('delayEligible',c.summary.delayEligible,c.value)}</td><td>{statisticsPercent(c.summary.delayRate)}</td><td>{count('urgent',c.summary.urgent,c.value)}</td></tr>)}</tbody></table></div>
      <div className="tracking-stat-detail-heading"><h3>期間申請明細：{details.length} 項</h3><span>明細焦點：{scope.detail}（完整條件 {stats.summary.total} 項）</span><button className="btn small" onClick={() => setFocus(neutralFocus)}>清除明細焦點</button></div>
      <div className="tracking-stat-scroll"><table className="tracking-stat-table tracking-stat-details" aria-label="統計期間明細"><thead><tr>{['申請單號／項目 ID','申請／開單日期','分類／急件','內容摘要／工程內容','DL','實際送達／完工','目前狀態','延遲判定','最新進度','補充說明'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{details.map(r => <tr key={r.item.id} data-stat-id={r.item.id}><td>{r.item.referenceNo || '—'}<small>{r.item.id}</small></td><td>{r.item.applicationDate || '—'}</td><td>{STATISTICS_TYPES.find(t => t.value === r.category)?.label}<br/>{r.item.urgency === 'urgent' ? '急件' : '普通'}</td><td>{r.item.description}</td><td>{r.item.expectedDate || '—'}</td><td>{r.actualDate || '—'}</td><td>{statisticsStatus(r)}</td><td>{statisticsDelay(r)}</td><td>{r.item.progress}</td><td>{r.item.supplementalNotes}</td></tr>)}{!details.length && <tr><td colSpan={10}>沒有符合目前條件／焦點的項目；可清除焦點或重設統計條件。</td></tr>}</tbody></table></div>
    </>}
  </section>;
}

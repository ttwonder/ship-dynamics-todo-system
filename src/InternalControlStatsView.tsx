import { useEffect, useRef, useState } from 'react';
import type { InternalControlCase } from './types';
import type { InternalControlStats, InternalControlVessel } from './internalControlWorkflow';
import {
  buildInternalControlBreakdowns,
  buildInternalControlTrend,
  selectInternalControlTrendCases,
  type InternalControlAnalysisSelection,
  type InternalControlTrend,
} from './internalControlAnalytics';
import './internalControlAnalytics.css';

interface Props {
  stats: InternalControlStats;
  cases: InternalControlCase[];
  vessels: InternalControlVessel[];
  fromDate: string;
  toDate: string;
  filterSummary: string;
  selection: InternalControlAnalysisSelection;
  onSelectionChange: (selection: InternalControlAnalysisSelection) => void;
  formatVesselName?: (vessel: InternalControlVessel) => string;
  printMode?: boolean;
}
const percent = (value: number) => `${value.toFixed(1)}%`;

function TrendChart({ trend }: { trend: InternalControlTrend }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(580);
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const measured = entries[0]?.contentRect.width;
      if (measured > 0) setWidth(Math.max(260, Math.round(measured)));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const left = 32, right = width - 18, top = 16, bottom = 174;
  const peak = Math.max(1, ...trend.points.flatMap(point => [point.created, point.closed]));
  const ticks = [...new Set([0, Math.ceil(peak / 2), peak])];
  const x = (index: number) => trend.points.length === 1 ? (left + right) / 2 : left + index / (trend.points.length - 1) * (right - left);
  const y = (value: number) => bottom - value / peak * (bottom - top);
  const tickCount = width < 440 ? 3 : 5;
  const step = Math.max(1, Math.ceil((trend.points.length - 1) / (tickCount - 1)));
  return <div ref={container} className="ic-trend-chart">
    <svg viewBox={`0 0 ${width} 211`} role="img" aria-label="新增與結案趨勢圖">
      <title>{`${trend.fromDate} 至 ${trend.toDate}，所選案件新增與結案件數`}</title>
      {ticks.map(tick => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="ic-chart-grid"/><text x={left - 7} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
      {(['created', 'closed'] as const).map(series => <g className={`ic-chart-${series}`} key={series}>
        <polyline fill="none" strokeWidth="2.4" points={trend.points.map((point, index) => `${x(index)},${y(point[series])}`).join(' ')}/>
        {trend.points.map((point, index) => <circle key={point.key} cx={x(index)} cy={y(point[series])} r={trend.points.length > 60 ? 2 : 3.5}><title>{`${point.label}｜${series === 'created' ? '新增' : '結案'} ${point[series]} 件`}</title></circle>)}
      </g>)}
      {trend.points.map((point, index) => index % step === 0 || index === trend.points.length - 1
        ? <text key={point.key} x={x(index)} y={198} textAnchor={index === 0 ? 'start' : index === trend.points.length - 1 ? 'end' : 'middle'}>{trend.interval === 'month' ? point.label : point.key.slice(5)}</text>
        : null)}
    </svg>
  </div>;
}

export default function InternalControlStatsView({ stats, cases, vessels, fromDate, toDate, filterSummary, selection, onSelectionChange, formatVesselName, printMode = false }: Props) {
  const breakdowns = buildInternalControlBreakdowns(cases, vessels, formatVesselName);
  const selected = breakdowns.find(dimension => dimension.key === selection.dimension) || breakdowns[3];
  const focused = selected.rows.find(row => row.key === selection.focusKey);
  const focusKey = focused?.key || '';
  const trendCases = selectInternalControlTrendCases(cases, vessels, selected.key, focusKey);
  // Keep the same time axis when drilling into a ranking; missing periods stay zero.
  const completeTrend = buildInternalControlTrend(cases, { interval: selection.interval, fromDate, toDate });
  const trend = focusKey ? buildInternalControlTrend(trendCases, { interval: selection.interval, fromDate: completeTrend.fromDate, toDate: completeTrend.toDate }) : completeTrend;
  const trendTotal = trend.points.reduce((sum, point) => ({ created: sum.created + point.created, closed: sum.closed + point.closed }), { created: 0, closed: 0 });
  const changeDimension = (dimension: InternalControlAnalysisSelection['dimension']) => onSelectionChange({ ...selection, dimension, focusKey: '' });
  return <section className="ic-stats ic-analytics" data-analysis-dimension={selected.key}>
    <div className="ic-analytics-topline"><b>目前篩選 {stats.total} 件</b><span>所有佔比與排名隨上方條件更新；佔比基準＝目前案件數</span></div>
    {filterSummary && <p className="ic-analytics-scope">{filterSummary}</p>}
    <div className="ic-analytics-metrics">
      {[
        ['案件總數', stats.total, '件', 'total'], ['內控未完', stats.open, '件', 'open'], ['已結案', stats.closed, '件', 'closed'],
        ['急／高關注', stats.highAttention, '件', 'high'], ['結案率', stats.closureRate, '%', 'rate'],
      ].map(([label, value, unit, tone]) => <div className={`ic-analytics-metric ${tone}`} key={label}><small>{label}</small><strong>{value}<em>{unit}</em></strong></div>)}
    </div>
    <div className="ic-overview-grid" aria-label="緊湊分布總覽">
      {breakdowns.slice(0, 6).map(dimension => <section className={`ic-overview-card ${dimension.key === selected.key ? 'selected' : ''}`} data-overview-dimension={dimension.key} key={dimension.key}>
        <header><h2>{dimension.label}</h2>{!printMode && <button type="button" onClick={() => changeDimension(dimension.key)} aria-label={`分析${dimension.label}分布`}>查看排名</button>}</header>
        {dimension.rows.length ? <><div className="ic-overview-rows">{dimension.rows.slice(0, 3).map(row => <div key={row.key}><span title={row.label}>{row.label}</span><b>{row.count}</b><em>{percent(row.share)}</em></div>)}</div><small>共 {dimension.rows.length} 項{dimension.rows.length > 3 ? ' · 顯示前三項' : ''}{dimension.multiple ? ' · 多部門分別計入' : ''}</small></> : <p className="ic-analytics-empty">沒有資料</p>}
      </section>)}
    </div>
    <div className="ic-analysis-toolbar">
      {printMode ? <b>分析面向：{selected.label}</b> : <label>分析面向<select aria-label="統計分析面向" value={selected.key} onChange={event => changeDimension(event.target.value as InternalControlAnalysisSelection['dimension'])}>{breakdowns.map(dimension => <option value={dimension.key} key={dimension.key}>{dimension.label}</option>)}</select></label>}
      <span>{selected.multiple ? '部門涉及率＝涉及案件／目前案件數；同案可跨部門，合計可能超過 100%。' : '每案只計一次；因四捨五入，佔比合計可能略有差異。'}</span>
    </div>
    <div className="ic-analysis-detail">
      <section className="ic-analysis-panel ic-ranking-panel">
        <header><h2>{selected.label}佔比與排名</h2><span>共 {selected.rows.length} 項 · 件數由多到少</span></header>
        {selected.rows.length ? <div className="ic-ranking-scroll"><table className="ic-ranking-table"><thead><tr><th>排名</th><th>{selected.label}</th><th>件數</th><th>{selected.multiple ? '涉及率' : '佔比'}</th></tr></thead><tbody>
          {selected.rows.map(row => <tr key={row.key} data-rank-key={row.key} className={focusKey === row.key ? 'focused' : ''}>
            <td>{row.rank}</td><td>{printMode ? <span>{row.label}</span> : <button type="button" className="ic-rank-focus" title="點擊查看此項的期間趨勢" aria-label={`查看 ${row.label} 趨勢`} aria-pressed={focusKey === row.key} onClick={() => onSelectionChange({ ...selection, focusKey: focusKey === row.key ? '' : row.key })}>{row.label}</button>}<span className="ic-share-track" aria-hidden="true"><i style={{ width: `${Math.min(100, row.share)}%` }}/></span></td>
            <td><b>{row.count}</b></td><td>{percent(row.share)}</td>
          </tr>)}
        </tbody></table></div> : <div className="ic-analytics-empty">沒有符合條件的案件</div>}
        {!printMode && selected.rows.length > 0 && <p className="ic-analytics-note">點排名中的名稱，可查看該項趨勢；再次點擊恢復全部。</p>}
      </section>
      <section className="ic-analysis-panel ic-trend-view" data-trend-focus={focusKey} data-trend-interval={selection.interval}>
        <header><h2>期間趨勢</h2>{!printMode ? <label>單位<select aria-label="趨勢時間單位" value={selection.interval} onChange={event => onSelectionChange({ ...selection, interval: event.target.value as InternalControlAnalysisSelection['interval'] })}><option value="day">日</option><option value="week">週</option><option value="month">月</option></select></label> : <span>按{{ day: '日', week: '週', month: '月' }[selection.interval]}</span>}</header>
        <div className="ic-trend-context"><b>{focused ? `${selected.label}：${focused.label}` : '全部篩選案件'}（{trendCases.length} 件）</b>{focused && !printMode && <button type="button" onClick={() => onSelectionChange({ ...selection, focusKey: '' })}>恢復全部</button>}</div>
        <p className="ic-trend-range">{trend.fromDate || '—'} ～ {trend.toDate || '—'}{selection.interval === 'week' ? '（週一為起日）' : ''}</p>
        <div className="ic-trend-legend"><span className="created">新增 {trendTotal.created} 件</span><span className="closed">結案 {trendTotal.closed} 件</span></div>
        {trend.error ? <p className="ic-analytics-warning" role="status">{trend.error}</p> : trend.points.length ? <TrendChart trend={trend}/> : <div className="ic-analytics-empty">沒有符合條件且日期有效的資料</div>}
        <p className="ic-analytics-note">沿用上方報告日期篩選的案件。新增依報告日期、結案依結案日期；圖內只計此區間的事件，不代表全站結案量。空白期間補 0。</p>
        {(trend.invalidReportDates > 0 || trend.invalidClosedDates > 0) && <p className="ic-analytics-warning">日期缺漏或無效：報告 {trend.invalidReportDates} 件、結案 {trend.invalidClosedDates} 件，未納入對應曲線。</p>}
        {!printMode && trend.points.length > 0 && <details className="ic-trend-data"><summary>查看每期數值（{trend.points.length} 期）</summary><div className="ic-trend-table-scroll"><table><thead><tr><th>期間</th><th>新增</th><th>結案</th></tr></thead><tbody>{trend.points.map(point => <tr key={point.key}><td>{point.label}</td><td>{point.created}</td><td>{point.closed}</td></tr>)}</tbody></table></div></details>}
      </section>
    </div>
  </section>;
}

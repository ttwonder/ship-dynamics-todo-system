import { useEffect, useRef, useState } from 'react';
import { buildStatisticsTrend } from './pageStatisticsModel';
import type { AnalysisInterval } from './dataAnalysisModel';
import type { StatisticsCase } from './pageStatisticsModel';

export function PageStatisticsTrend({ records, fromDate, toDate, interval, onInterval, focusKey, focusLabel, onReset }: {
  records: StatisticsCase[]; fromDate: string; toDate: string; interval: AnalysisInterval;
  onInterval: (value: AnalysisInterval) => void; focusKey: string; focusLabel: string; onReset: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const trend = buildStatisticsTrend(records, { fromDate, toDate, interval });
  const { points } = trend;
  const totals = points.reduce((sum, point) => ({ added: sum.added + point.added, closed: sum.closed + point.closed }), { added: 0, closed: 0 });
  const max = Math.max(1, ...points.flatMap(point => [point.added, point.closed]));
  const left = 30, right = width - 14, top = 14, bottom = 137;
  const x = (index: number) => points.length < 2 ? (left + right) / 2 : left + index / (points.length - 1) * (right - left);
  const y = (count: number) => bottom - count / max * (bottom - top);
  const labels = Math.max(2, Math.floor((right - left) / 105));
  const stride = Math.max(1, Math.ceil((points.length - 1) / (labels - 1)));
  return <div className="panel analysis-panel da-trend-panel" data-trend-focus={focusKey}>
    <div className="panel-title"><h3>新增／完成趨勢</h3><label className="da-interval"><span>單位</span><select aria-label="趨勢時間單位" value={interval} onChange={event => onInterval(event.target.value as AnalysisInterval)}><option value="day">日</option><option value="week">週</option><option value="month">月</option></select></label></div>
    <div className="da-trend-caption"><b>{focusLabel || '目前統計範圍'}</b>{focusKey && <button type="button" className="da-text-button" onClick={onReset}>恢復全部</button>}<small>{trend.fromDate && trend.toDate ? `${trend.fromDate} ～ ${trend.toDate}` : '未有有效事件日期'}</small></div>
    <div className="da-trend-legend"><span className="da-ordinary">新增 {totals.added} 件</span><span className="da-meeting">完成 {totals.closed} 件</span></div>
    <div ref={host} className="da-trend-canvas">
      {trend.error ? <p role="alert" className="da-error">{trend.error}</p> : points.length ? <svg className="da-trend-svg" viewBox={`0 0 ${width} 167`} role="img" aria-label="案件新增與完成趨勢圖">
        <title>{`按各自日期統計：新增 ${totals.added} 件；完成 ${totals.closed} 件`}</title>
        {[0, Math.ceil(max / 2), max].filter((value, index, values) => values.indexOf(value) === index).map(count => <g key={count}><line x1={left} x2={right} y1={y(count)} y2={y(count)} stroke="#e8e1ed"/><text x={left - 7} y={y(count) + 4} textAnchor="end">{count}</text></g>)}
        {(['added', 'closed'] as const).map(kind => <polyline key={kind} points={points.map((point, index) => `${x(index)},${y(point[kind])}`).join(' ')} fill="none" stroke={kind === 'added' ? '#257a9c' : '#9863b6'} strokeWidth="2" strokeDasharray={kind === 'closed' ? '5 3' : undefined}/>)}
        {points.map((point, index) => <g key={point.key} data-trend-key={point.key} data-added={point.added} data-closed={point.closed}>
          <title>{`${point.label}：新增 ${point.added} 件；完成 ${point.closed} 件`}</title>
          <circle cx={x(index)} cy={y(point.added)} r="3" fill="#257a9c"/><circle cx={x(index)} cy={y(point.closed)} r="3" fill="#9863b6"/>
          {(index === 0 || index === points.length - 1 || (index % stride === 0 && index < points.length - 1 - stride / 2)) && <text x={x(index)} y="158" textAnchor={points.length === 1 ? 'middle' : index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{interval === 'month' ? point.label : point.key.slice(5)}</text>}
        </g>)}
      </svg> : <p className="empty-text">沒有符合條件且具有效日期的案件</p>}
    </div>
    <small className="da-note">新增按建立日、完成按完成日（台北日期）；缺期補零，週從星期一開始。{trend.invalidDates > 0 && ` ${trend.invalidDates} 個事件日期缺漏／無效，未納入曲線。`}</small>
    {!!points.length && <details className="da-period-details"><summary>逐期件數</summary><div className="table-wrap"><table><thead><tr><th>期間</th><th>新增</th><th>完成</th></tr></thead><tbody>{points.map(point => <tr key={point.key}><td>{point.label}</td><td>{point.added}</td><td>{point.closed}</td></tr>)}</tbody></table></div></details>}
  </div>;
}

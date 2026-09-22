import { useEffect, useRef, useState } from 'react';
import { buildAnalysisTrend } from './dataAnalysisModel';
import type { AnalysisInterval } from './dataAnalysisModel';
import type { TaskItem } from './types';

export function DataAnalysisTrend({ tasks, fromDate, toDate, interval, onInterval, focusKey, focusLabel, onReset }: {
  tasks: TaskItem[]; fromDate: string; toDate: string; interval: AnalysisInterval;
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
  const trend = buildAnalysisTrend(tasks, { fromDate, toDate, interval });
  const { points } = trend;
  const totals = points.reduce((sum, point) => ({ ordinary: sum.ordinary + point.ordinary, meeting: sum.meeting + point.meeting }), { ordinary: 0, meeting: 0 });
  const max = Math.max(1, ...points.flatMap(point => [point.ordinary, point.meeting]));
  const left = 30, right = width - 14, top = 14, bottom = 137;
  const x = (index: number) => points.length < 2 ? (left + right) / 2 : left + index / (points.length - 1) * (right - left);
  const y = (count: number) => bottom - count / max * (bottom - top);
  const labels = Math.max(2, Math.floor((right - left) / 105));
  const stride = Math.max(1, Math.ceil((points.length - 1) / (labels - 1)));
  return <div className="panel analysis-panel da-trend-panel" data-trend-focus={focusKey}>
    <div className="panel-title"><h3>事項新增趨勢</h3><label className="da-interval"><span>單位</span><select aria-label="趨勢時間單位" value={interval} onChange={event => onInterval(event.target.value as AnalysisInterval)}><option value="day">日</option><option value="week">週</option><option value="month">月</option></select></label></div>
    <div className="da-trend-caption"><b>{focusLabel || '目前責任範圍'}</b>{focusKey && <button type="button" className="da-text-button" onClick={onReset}>恢復全部</button>}<small>{trend.fromDate && trend.toDate ? `${trend.fromDate} ～ ${trend.toDate}` : '未有有效建立日期'}</small></div>
    <div className="da-trend-legend"><span className="da-ordinary">要事 {totals.ordinary} 件</span><span className="da-meeting">臨會/專題 {totals.meeting} 件</span></div>
    <div ref={host} className="da-trend-canvas">
      {trend.error ? <p role="alert" className="da-error">{trend.error}</p> : points.length ? <svg className="da-trend-svg" viewBox={`0 0 ${width} 167`} role="img" aria-label="要事與臨會專題新增趨勢圖">
        <title>{`按台北時間建立日期統計：要事 ${totals.ordinary} 件；臨會/專題 ${totals.meeting} 件`}</title>
        {[0, Math.ceil(max / 2), max].filter((value, index, values) => values.indexOf(value) === index).map(count => <g key={count}><line x1={left} x2={right} y1={y(count)} y2={y(count)} stroke="#e8e1ed"/><text x={left - 7} y={y(count) + 4} textAnchor="end">{count}</text></g>)}
        {(['ordinary', 'meeting'] as const).map(kind => <polyline key={kind} points={points.map((point, index) => `${x(index)},${y(point[kind])}`).join(' ')} fill="none" stroke={kind === 'ordinary' ? '#257a9c' : '#9863b6'} strokeWidth="2" strokeDasharray={kind === 'meeting' ? '5 3' : undefined}/>)}
        {points.map((point, index) => <g key={point.key} data-trend-key={point.key} data-ordinary={point.ordinary} data-meeting={point.meeting}>
          <title>{`${point.label}：要事 ${point.ordinary} 件；臨會/專題 ${point.meeting} 件`}</title>
          <circle cx={x(index)} cy={y(point.ordinary)} r="3" fill="#257a9c"/><circle cx={x(index)} cy={y(point.meeting)} r="3" fill="#9863b6"/>
          {(index === 0 || index === points.length - 1 || (index % stride === 0 && index < points.length - 1 - stride / 2)) && <text x={x(index)} y="158" textAnchor={points.length === 1 ? 'middle' : index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{interval === 'month' ? point.label : point.key.slice(5)}</text>}
        </g>)}
      </svg> : <p className="empty-text">沒有符合條件且具有效建立日期的事項</p>}
    </div>
    <small className="da-note">按建立日期（台北時間）；缺期補零；不含未同步的獨立內控案件。{trend.invalidDates > 0 && ` ${trend.invalidDates} 件日期缺漏／無效，未納入曲線。`}</small>
    {!!points.length && <details className="da-period-details"><summary>逐期件數</summary><div className="table-wrap"><table><thead><tr><th>期間</th><th>要事</th><th>臨會/專題</th></tr></thead><tbody>{points.map(point => <tr key={point.key}><td>{point.label}</td><td>{point.ordinary}</td><td>{point.meeting}</td></tr>)}</tbody></table></div></details>}
  </div>;
}

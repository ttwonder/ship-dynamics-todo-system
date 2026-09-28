import type { TrackingStatisticsSummary } from './trackingStatisticsReport';
import { statisticsPercent } from './trackingStatistics';

export function trackingStatisticsCharts(stats: TrackingStatisticsSummary) {
  const s = stats.summary, annual = stats.categories.find(c => c.value === 'annual-inspection')?.summary;
  if (!annual) throw new Error('年檢到期統計尚未取得完整分類。');
  return [
    { title: '完成狀態', total: s.total, denominator: '全部申請', rows: [
      { label: '已完成', value: s.completed, color: '#28774f' },
      { label: '未完成', value: s.incomplete, color: '#b86d16' },
      { label: '取消', value: s.cancelled, color: '#788290' },
    ] },
    { title: '類型件數', total: s.total, denominator: '全部申請', rows: stats.categories.map((c, i) => ({ label: c.label, value: c.summary.total, color: ['#3977a5', '#62833b', '#658576', '#7353a2', '#a04e78', '#b87928', '#27878d', '#5265aa', '#788290'][i] })) },
    { title: '延遲狀態', total: s.effective, denominator: '有效項目（不含取消）', rows: [
      { label: '逾期未完成', value: s.overdueIncomplete, color: '#b73939' },
      { label: '逾期完成', value: s.overdueCompleted, color: '#b86d16' },
      { label: '準時完成', value: s.delayEligible - s.delayed, color: '#28774f' },
      { label: '未到期未完成', value: s.notYetDue, color: '#3977a5' },
      { label: '未填／無效 DL／到期日', value: s.noDeadline, color: '#788290' },
      { label: '完成日期不足', value: s.insufficientDate, color: '#7353a2' },
    ] },
    { title: '年檢到期狀態', total: annual.effective, denominator: '有效年檢工程（不含取消；已含於總計）', rows: [
      { label: '逾期未完成', value: annual.overdueIncomplete, color: '#b73939' },
      { label: '逾期完成', value: annual.overdueCompleted, color: '#b86d16' },
      { label: '到期前／當日完成', value: annual.delayEligible - annual.delayed, color: '#28774f' },
      { label: '未到期未完成', value: annual.notYetDue, color: '#3977a5' },
      { label: '未填／無效到期日', value: annual.noDeadline, color: '#788290' },
      { label: '完成日期不足', value: annual.insufficientDate, color: '#7353a2' },
    ] },
  ];
}
export default function TrackingStatisticsCharts({ stats }: { stats: TrackingStatisticsSummary }) {
  return <div className="tracking-stat-charts" aria-label="圖形化總計">{trackingStatisticsCharts(stats).map(chart => <section className="tracking-stat-chart" key={chart.title} aria-label={chart.title}>
    <h3>{chart.title}<span>{chart.total} 項</span></h3><p>占比基準：{chart.denominator}</p>
    <div className="tracking-stat-stack" role="img" aria-label={`${chart.title}：${chart.rows.map(r => `${r.label} ${r.value}`).join('，')}`}><svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="10" fill="#e1e5e9"/>{chart.rows.map((r, i) => <rect key={r.label} x={chart.total ? chart.rows.slice(0, i).reduce((sum, n) => sum + n.value, 0) / chart.total * 100 : 0} y="0" width={chart.total ? r.value / chart.total * 100 : 0} height="10" fill={r.color}/>)}</svg></div>
    <ul>{chart.rows.map(r => <li key={r.label}><span className="tracking-stat-chart-label"><i style={{ backgroundColor: r.color }}/>{r.label}</span><b>{r.value}</b><span>{statisticsPercent(chart.total ? r.value / chart.total : null)}</span></li>)}</ul>
    {!chart.total && <p>目前條件沒有可統計項目。</p>}
  </section>)}</div>;
}

import { useMemo, useState } from 'react';
import type { AppData, TaskItem, Vessel } from './types';
import { daysDiff } from './utils';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskVesselIds } from './taskVesselScope';
import { deriveVesselAttention } from './vesselAttention';
import { vesselAttentionTasks } from './taskAttention';
import { isMeetingTaskSource, taskCategoriesOf } from './taskCategories';

type ScopeMode = 'overall' | 'department' | 'person';
type Metrics = {
  total: number;
  closed: number;
  overdue: number;
  completionRate: number;
  overdueRate: number;
  proposed: number;
  proposalRate: number;
  highRisk: number;
  highRiskRate: number;
  aware: number;
  awareRate: number;
  internal: number;
  internalRate: number;
  abnormal: number;
  abnormalRate: number;
};

const pct = (part: number, total: number) => total ? Math.round(part / total * 100) : 0;
const metricOf = (tasks: TaskItem[], proposed: number, proposalBase: number): Metrics => {
  const closed = tasks.filter(task => task.isClosed).length;
  const overdue = tasks.filter(task => !task.isClosed && Boolean(task.expectedDate) && (daysDiff(task.expectedDate) ?? 0) < 0).length;
  const highRiskTasks = tasks.filter(task => task.priority === '急' || task.priority === '高');
  const awareTasks = tasks.filter(task => task.isAware);
  const internalTasks = tasks.filter(task => task.isInternalControl);
  const abnormalTasks = tasks.filter(task => task.isAbnormal);
  return {
    total: tasks.length,
    closed,
    overdue,
    completionRate: pct(closed, tasks.length),
    overdueRate: pct(overdue, tasks.length),
    proposed,
    proposalRate: pct(proposed, proposalBase),
    highRisk: highRiskTasks.length,
    highRiskRate: pct(highRiskTasks.filter(task => task.isClosed).length, highRiskTasks.length),
    aware: awareTasks.length,
    awareRate: pct(awareTasks.filter(task => task.isClosed).length, awareTasks.length),
    internal: internalTasks.length,
    internalRate: pct(internalTasks.filter(task => task.isClosed).length, internalTasks.length),
    abnormal: abnormalTasks.length,
    abnormalRate: pct(abnormalTasks.filter(task => task.isClosed).length, abnormalTasks.length),
  };
};
const localMonthKey = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const monthKeys = () => Array.from({ length: 6 }, (_, index) => {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  date.setMonth(date.getMonth() - (5 - index));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
});

export default function DataAnalysisView({ data, vessels }: { data: AppData; vessels: Vessel[] }) {
  const [scopeMode, setScopeMode] = useState<ScopeMode>('overall');
  const [department, setDepartment] = useState('');
  const [personId, setPersonId] = useState('');
  const vesselIds = useMemo(() => new Set(vessels.map(vessel => vessel.id)), [vessels]);
  const tasks = useMemo(() => data.tasks.filter(task => taskVesselIds(task).some(id => vesselIds.has(id))), [data.tasks, vesselIds]);
  const users = data.users.filter(user => user.isActive && user.role !== 'vessel');
  const departments = Array.from(new Set([
    ...data.settings.departments,
    ...tasks.flatMap(task => task.departments),
    ...users.map(user => user.department),
  ].map(item => item.trim()).filter(item => item && item !== '船舶帳戶'))).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  const selectedDepartment = department || departments[0] || '';
  const departmentUsers = users.filter(user => user.department === selectedDepartment);
  const selectedPerson = users.find(user => user.id === personId) || users[0];
  const vesselById = Object.fromEntries(vessels.map(vessel => [vessel.id, vessel]));
  const responsibleFor = (task: TaskItem, userIds: Set<string>, scopeDepartment = '') => {
    const taskScopeVessels = taskVesselIds(task).map(id => vesselById[id]).filter(Boolean);
    return task.ownerUserIds.some(id => userIds.has(id)) || taskScopeVessels.some(vessel => vessel.assignedUserIds.some(id => userIds.has(id))) || Boolean(scopeDepartment && task.departments.includes(scopeDepartment));
  };
  const scopedUsers = scopeMode === 'department' ? departmentUsers : scopeMode === 'person' && selectedPerson ? [selectedPerson] : users;
  const scopedUserIds = new Set(scopedUsers.map(user => user.id));
  const scopeTasks = scopeMode === 'overall' ? tasks : tasks.filter(task => responsibleFor(task, scopedUserIds, scopeMode === 'department' ? selectedDepartment : ''));
  const proposed = scopeMode === 'overall' ? tasks.length : tasks.filter(task => scopedUserIds.has(task.createdBy)).length;
  const metrics = metricOf(scopeTasks, proposed, tasks.length);
    const ordinaryCategoryCounts = categoryCounts(scopeTasks.filter(task => !isMeetingTaskSource(task)));
    const meetingCategoryCounts = categoryCounts(scopeTasks.filter(task => isMeetingTaskSource(task)));
    const scopeLabel = scopeMode === 'overall' ? '總體／全部船隊' : scopeMode === 'department' ? `部門：${selectedDepartment || '未選擇'}` : `個人：${selectedPerson?.name || '未選擇'}`;

  const compareRows = (mode: 'department' | 'person') => {
    const groups = mode === 'department'
      ? departments.map(name => ({ id: name, name, users: users.filter(user => user.department === name) }))
      : users.map(user => ({ id: user.id, name: `${user.name}｜${user.department}`, users: [user] }));
    return groups.map(group => {
      const ids = new Set(group.users.map(user => user.id));
      const groupTasks = tasks.filter(task => responsibleFor(task, ids, mode === 'department' ? group.id : ''));
      const groupProposed = tasks.filter(task => ids.has(task.createdBy)).length;
      return { ...group, metrics: metricOf(groupTasks, groupProposed, tasks.length) };
    }).filter(group => group.metrics.total > 0 || group.metrics.proposed > 0)
      .sort((a, b) => b.metrics.completionRate - a.metrics.completionRate || a.metrics.overdueRate - b.metrics.overdueRate || b.metrics.total - a.metrics.total);
  };
  const departmentRows = compareRows('department');
  const personRows = compareRows('person');
  const months = monthKeys();
  const vesselRows = vessels.map(vessel => {
    const vesselTasks = tasks.filter(task => taskHasVessel(task, vessel.id));
    const attentionTasks = vesselAttentionTasks(vesselTasks);
    const open = attentionTasks.filter(task => !task.isClosed);
    const attentionResult = deriveVesselAttention(vessel, open);
    return {
      vessel,
      counts: Object.fromEntries(['急', '高', '中', '低'].map(priority => [priority, attentionTasks.filter(task => task.priority === priority).length])) as Record<string, number>,
      abnormal: attentionTasks.filter(task => task.isAbnormal).length,
      lights: vessel.weeklyAttention.length,
      attention: attentionResult.manual
        ? `${attentionResult.effective}（手動 ${attentionResult.manual}／自動下限 ${attentionResult.automatic}）`
        : `${attentionResult.effective}（自動）`,
      trend: months.map(month => attentionTasks.filter(task => localMonthKey(task.createdAt) === month).length),
    };
  });

  return <section className="data-analysis-view">
    <div className="page-heading"><div><h1>數據分析</h1><p>按總體、部門或個人查看責任範圍、提出情況，並橫向比較排名與船舶趨勢。</p></div></div>
    <div className="panel analysis-filters no-print">
      <label><span>顯示範圍</span><select value={scopeMode} onChange={event => setScopeMode(event.target.value as ScopeMode)}><option value="overall">總體</option><option value="department">指定部門</option><option value="person">指定個人</option></select></label>
      {scopeMode === 'department' && <label><span>部門</span><select value={selectedDepartment} onChange={event => setDepartment(event.target.value)}>{departments.map(item => <option key={item}>{item}</option>)}</select></label>}
      {scopeMode === 'person' && <label><span>人員</span><select value={selectedPerson?.id || ''} onChange={event => setPersonId(event.target.value)}>{users.map(user => <option key={user.id} value={user.id}>{user.name}｜{user.department}</option>)}</select></label>}
      <strong className="analysis-scope-note">{scopeLabel}</strong>
    </div>
    <div className="metric-grid analysis-metric-grid">
      <MetricCard label="責任事項" value={metrics.total} suffix="件" />
      <MetricCard label="完成率" value={metrics.completionRate} suffix={`%｜${metrics.closed} 件`} />
      <MetricCard label="逾期率" value={metrics.overdueRate} suffix={`%｜${metrics.overdue} 件`} />
      <MetricCard label="提出率／件數" value={metrics.proposalRate} suffix={`%｜${metrics.proposed} 件`} />
      <MetricCard label="高風險" value={metrics.highRisk} suffix={`件｜完成 ${metrics.highRiskRate}%`} />
      <MetricCard label="需知曉" value={metrics.aware} suffix={`件｜完成 ${metrics.awareRate}%`} />
      <MetricCard label="內控" value={metrics.internal} suffix={`件｜完成 ${metrics.internalRate}%`} />
      <MetricCard label="異常" value={metrics.abnormal} suffix={`件｜完成 ${metrics.abnormalRate}%`} />
    </div>
    <div className="grid cols-2 analysis-category-grid">
      <CategoryPanel title="要事分類比例" rows={ordinaryCategoryCounts} />
      <CategoryPanel title="臨會/專題分類比例" rows={meetingCategoryCounts} />
    </div>
    <ComparePanel title="部門橫向比較與排名" rows={departmentRows} />
    <ComparePanel title="人員橫向比較與排名" rows={personRows} />
    <div className="panel analysis-panel"><div className="panel-title"><h3>船舶優先級／異常／關注度／點亮項目／趨勢</h3><small>趨勢為近六個月新增事項件數</small></div><div className="table-wrap analysis-vessel-table"><table><thead><tr><th>船舶</th><th>急／高／中／低累計</th><th>異常</th><th>目前關注度</th><th>點亮項目</th><th>{months.join('　')}</th></tr></thead><tbody>{vesselRows.map(row => { const max = Math.max(1, ...row.trend); return <tr key={row.vessel.id}><td><b>{vesselDisplayName(row.vessel)}</b></td><td><div className="priority-counts"><span>急 {row.counts['急']}</span><span>高 {row.counts['高']}</span><span>中 {row.counts['中']}</span><span>低 {row.counts['低']}</span></div></td><td>{row.abnormal}</td><td><span className="attention-level">{row.attention}</span></td><td>{row.lights}／7</td><td><div className="analysis-trend" title={row.trend.join('、')}>{row.trend.map((count, index) => <i key={months[index]} style={{ height: `${Math.max(4, count / max * 100)}%` }} />)}</div></td></tr>; })}</tbody></table></div></div>
    <div className="panel analysis-panel"><div className="panel-title"><h3>統計口徑</h3></div><ul className="analysis-method"><li>完成率：已結案事項 ÷ 責任範圍內全部事項。</li><li>逾期率：尚未結案且預計完成日已過 ÷ 責任範圍內全部事項。</li><li>提出率：所選人員建立的事項 ÷ 目前可見船隊全部事項；同時顯示實際件數。</li><li>個人責任範圍：事項涉及人員或所屬船舶分管人員；部門範圍另包含事項部門。</li><li>高風險為「急／高」事項；需知曉、內控、異常按事項勾選欄位統計。</li></ul></div>
  </section>;
}

function MetricCard({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return <div className="metric-card"><small>{label}</small><b>{value}</b><span>{suffix}</span></div>;
}

function categoryCounts(tasks: TaskItem[]) {
  const counts = new Map<string, number>();
  tasks.forEach(task => {
    const categories = taskCategoriesOf(task);
    (categories.length ? categories : ['未分類']).forEach(category => counts.set(category, (counts.get(category) || 0) + 1));
  });
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-TW'));
}

function CategoryPanel({ title, rows }: { title: string; rows: Array<{ name: string; count: number }> }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <div className="panel analysis-panel category-ratio-panel"><div className="panel-title"><h3>{title}</h3><small>{total} 件</small></div>{rows.length ? <div className="analysis-compare-list">{rows.map(row => <div className="analysis-compare-row" key={row.name}><b className="analysis-name">{row.name}</b><div className="analysis-bar"><i style={{ width: `${Math.max(4, row.count / Math.max(1, total) * 100)}%` }} /></div><span className="analysis-value">{row.count} 件</span><span className="analysis-value">{Math.round(row.count / Math.max(1, total) * 100)}%</span></div>)}</div> : <p className="empty-text">暫無資料</p>}</div>;
}

function ComparePanel({ title, rows }: { title: string; rows: Array<{ id: string; name: string; metrics: Metrics }> }) {
  return <div className="panel analysis-panel"><div className="panel-title"><h3>{title}</h3><small>依完成率高、逾期率低、責任件數多排序</small></div><div className="analysis-compare-list">{rows.map((row, index) => <div className="analysis-compare-row" key={row.id}><span className="analysis-rank">{index + 1}</span><b className="analysis-name">{row.name}</b><div className="analysis-bar"><i style={{ width: `${row.metrics.completionRate}%` }} /></div><span className="analysis-value">完成 {row.metrics.completionRate}%</span><span className="analysis-value">逾期 {row.metrics.overdueRate}%</span><span className="analysis-value">責任 {row.metrics.total}</span><span className="analysis-value">提出 {row.metrics.proposed}</span></div>)}</div></div>;
}

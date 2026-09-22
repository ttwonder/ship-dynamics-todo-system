import { useMemo, useState } from 'react';
import type { AppData, TaskItem, Vessel } from './types';
import { daysDiff } from './runtimeUtils';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskVesselIds } from './taskVesselScope';
import { deriveVesselAttention } from './vesselAttention';
import { vesselAttentionTasks } from './taskAttention';
import { meetingCreatesVesselAbnormalAlert } from './meetingVesselAttention';
import { taskIsClosedForScope, taskIsClosedForVessel } from './taskVesselProgress';
import { isMeetingTaskSource, taskCategoriesOf } from './taskCategories';
import { dataAnalysisVesselAbnormalCount } from './dataAnalysisVesselAttention';
import { taipeiMonthKey, taipeiRecentMonthKeys } from './taipeiTime';
import { analysisDateError, emptyAnalysisFilters, filterAnalysisTasks, sortAnalysisRows } from './dataAnalysisModel';
import type { AnalysisFilters, AnalysisInterval, AnalysisSort } from './dataAnalysisModel';
import { DataAnalysisTrend } from './DataAnalysisTrend';
import './dataAnalysis.css';

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
const taskClosedForAnalysis = (task: TaskItem) => taskIsClosedForScope(task,taskVesselIds(task));
const metricOf = (tasks: TaskItem[], proposed: number, proposalBase: number, isClosed = taskClosedForAnalysis): Metrics => {
  const closed = tasks.filter(isClosed).length;
  const overdue = tasks.filter(task => !isClosed(task) && Boolean(task.expectedDate) && (daysDiff(task.expectedDate) ?? 0) < 0).length;
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
    highRiskRate: pct(highRiskTasks.filter(isClosed).length, highRiskTasks.length),
    aware: awareTasks.length,
    awareRate: pct(awareTasks.filter(isClosed).length, awareTasks.length),
    internal: internalTasks.length,
    internalRate: pct(internalTasks.filter(isClosed).length, internalTasks.length),
    abnormal: abnormalTasks.length,
    abnormalRate: pct(abnormalTasks.filter(isClosed).length, abnormalTasks.length),
  };
};
const localMonthKey = taipeiMonthKey;
const monthKeys = () => taipeiRecentMonthKeys(6);

export default function DataAnalysisView({ data, vessels }: { data: AppData; vessels: Vessel[] }) {
  const [scopeMode, setScopeMode] = useState<ScopeMode>('overall');
  const [department, setDepartment] = useState('');
  const [personId, setPersonId] = useState('');
  const [filters, setFilters] = useState<AnalysisFilters>(emptyAnalysisFilters);
  const [sort, setSort] = useState<AnalysisSort>('completionRate');
  const [interval, setInterval] = useState<AnalysisInterval>('month');
  const [focusKey, setFocusKey] = useState('');
  const updateFilters = (patch: Partial<AnalysisFilters>) => { setFilters(current => ({ ...current, ...patch })); setFocusKey(''); };
  const vesselIds = useMemo(() => new Set(vessels.map(vessel => vessel.id)), [vessels]);
  const tasks = useMemo(() => data.tasks.filter(task => taskVesselIds(task).some(id => vesselIds.has(id))), [data.tasks, vesselIds]);
  const analysisTasks = useMemo(() => filterAnalysisTasks(tasks, filters), [tasks, filters]);
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
  const scopeTasks = scopeMode === 'overall' ? analysisTasks : analysisTasks.filter(task => responsibleFor(task, scopedUserIds, scopeMode === 'department' ? selectedDepartment : ''));
  const proposed = scopeMode === 'overall' ? analysisTasks.length : analysisTasks.filter(task => scopedUserIds.has(task.createdBy)).length;
  const metrics = metricOf(scopeTasks, proposed, analysisTasks.length);
    const ordinaryCategoryCounts = categoryCounts(scopeTasks.filter(task => !isMeetingTaskSource(task)));
    const meetingCategoryCounts = categoryCounts(scopeTasks.filter(task => isMeetingTaskSource(task)));
    const scopeLabel = scopeMode === 'overall' ? '總體／全部船隊' : scopeMode === 'department' ? `部門：${selectedDepartment || '未選擇'}` : `個人：${selectedPerson?.name || '未選擇'}`;

  const compareRows = (mode: 'department' | 'person') => {
    const groups = mode === 'department'
      ? departments.map(name => ({ id: name, name, users: users.filter(user => user.department === name) }))
      : users.map(user => ({ id: user.id, name: `${user.name}｜${user.department}`, users: [user] }));
    return sortAnalysisRows(groups.map(group => {
      const ids = new Set(group.users.map(user => user.id));
      const groupTasks = scopeTasks.filter(task => responsibleFor(task, ids, mode === 'department' ? group.id : ''));
      const groupProposed = scopeTasks.filter(task => ids.has(task.createdBy)).length;
      return { ...group, tasks: groupTasks, metrics: metricOf(groupTasks, groupProposed, scopeTasks.length) };
    }).filter(group => group.metrics.total > 0 || group.metrics.proposed > 0), sort);
  };
  const departmentRows = compareRows('department');
  const personRows = compareRows('person');
  const vesselRankRows = sortAnalysisRows(vessels.map(vessel => {
    const groupTasks = scopeTasks.filter(task => taskHasVessel(task, vessel.id));
    return { id: vessel.id, name: vesselDisplayName(vessel), tasks: groupTasks, metrics: metricOf(groupTasks, 0, scopeTasks.length, task => taskIsClosedForVessel(task, vessel.id)) };
  }).filter(row => row.metrics.total > 0), sort === 'proposed' ? 'total' : sort);
  const focusChoices = [
    ...departmentRows.map(row => ({ ...row, key: `department:${row.id}` })),
    ...personRows.map(row => ({ ...row, key: `person:${row.id}` })),
    ...vesselRankRows.map(row => ({ ...row, key: `vessel:${row.id}` })),
  ];
  const focused = focusChoices.find(row => row.key === focusKey);
  const toggleFocus = (key: string) => setFocusKey(current => current === key ? '' : key);
  const months = monthKeys();
  const vesselRows = vessels.map(vessel => {
    const vesselTasks = tasks.filter(task => taskHasVessel(task, vessel.id));
    const attentionTasks = vesselAttentionTasks(vesselTasks);
    const standaloneInternalCases = data.internalControlCases.filter(item => !item.linkedTaskId && item.vesselId === vessel.id);
    const open = attentionTasks.filter(task => !taskIsClosedForVessel(task,vessel.id));
    const abnormalMeetingIds=data.meetings.filter(meeting=>meetingCreatesVesselAbnormalAlert(meeting,vessel.id)).map(meeting=>meeting.id);
    const hasMeetingAbnormal = abnormalMeetingIds.length>0;
    const attentionResult = deriveVesselAttention(vessel, open, hasMeetingAbnormal, data.internalControlCases);
    return {
      vessel,
      counts: Object.fromEntries(['急', '高', '中', '低'].map(priority => [priority, attentionTasks.filter(task => task.priority === priority).length + standaloneInternalCases.filter(item => item.priority === priority).length])) as Record<string, number>,
      abnormal: dataAnalysisVesselAbnormalCount(tasks,abnormalMeetingIds,vessel.id),
      lights: vessel.weeklyAttention.length,
      attention: attentionResult.manual
        ? `${attentionResult.effective}（手動 ${attentionResult.manual}／自動下限 ${attentionResult.automatic}）`
        : `${attentionResult.effective}（自動）`,
      trend: months.map(month => attentionTasks.filter(task => localMonthKey(task.createdAt) === month).length + standaloneInternalCases.filter(item => localMonthKey(item.createdAt) === month).length),
    };
  });

  return <section className="data-analysis-view">
    <div className="page-heading"><div><h1>數據分析</h1><p>按總體、部門或個人查看責任範圍、提出情況，並橫向比較排名與船舶趨勢。</p></div></div>
    <div className="panel analysis-filters no-print">
      <label><span>顯示範圍</span><select aria-label="顯示範圍" value={scopeMode} onChange={event => { setScopeMode(event.target.value as ScopeMode); setFocusKey(''); }}><option value="overall">總體</option><option value="department">指定部門</option><option value="person">指定個人</option></select></label>
      {scopeMode === 'department' && <label><span>部門</span><select aria-label="分析部門" value={selectedDepartment} onChange={event => { setDepartment(event.target.value); setFocusKey(''); }}>{departments.map(item => <option key={item}>{item}</option>)}</select></label>}
      {scopeMode === 'person' && <label><span>人員</span><select aria-label="分析人員" value={selectedPerson?.id || ''} onChange={event => { setPersonId(event.target.value); setFocusKey(''); }}>{users.map(user => <option key={user.id} value={user.id}>{user.name}｜{user.department}</option>)}</select></label>}
      <label><span>建立日期起</span><input type="date" aria-label="分析建立日期起" value={filters.fromDate} onChange={event => updateFilters({ fromDate: event.target.value })}/></label>
      <label><span>建立日期迄</span><input type="date" aria-label="分析建立日期迄" value={filters.toDate} onChange={event => updateFilters({ toDate: event.target.value })}/></label>
      <label><span>事項來源</span><select aria-label="分析事項來源" value={filters.source} onChange={event => updateFilters({ source: event.target.value as AnalysisFilters['source'] })}><option value="all">全部來源</option><option value="ordinary">一般要事</option><option value="meeting">臨會/專題</option></select></label>
      <button type="button" className="btn da-reset" onClick={() => { setFilters(emptyAnalysisFilters); setScopeMode('overall'); setDepartment(''); setPersonId(''); setFocusKey(''); }}>重設分析條件</button>
      <strong className="analysis-scope-note">{scopeLabel} · {metrics.total} 件</strong>
    </div>
    {!!analysisDateError(filters) && <p role="alert" className="da-error">{analysisDateError(filters)}</p>}
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
    <div className="da-overview">
      <CategoryPanel title="要事分類比例" source="ordinary" rows={ordinaryCategoryCounts} total={scopeTasks.filter(task => !isMeetingTaskSource(task)).length} />
      <CategoryPanel title="臨會/專題分類比例" source="meeting" rows={meetingCategoryCounts} total={scopeTasks.filter(isMeetingTaskSource).length} />
      <DataAnalysisTrend tasks={focused?.tasks || scopeTasks} fromDate={filters.fromDate} toDate={filters.toDate} interval={interval} onInterval={setInterval} focusKey={focused?.key || ''} focusLabel={focused ? `${focused.name}（責任事項）` : ''} onReset={() => setFocusKey('')}/>
    </div>
    <div className="da-rank-controls"><label>排名依據 <select aria-label="排名依據" value={sort} onChange={event => setSort(event.target.value as AnalysisSort)}><option value="completionRate">完成率</option><option value="total">責任件數</option><option value="overdue">逾期件數</option><option value="proposed">範圍內提出件數</option></select></label><small>依目前責任範圍比較；點名稱看趨勢。同一事項可歸屬多個部門、人員或船舶，佔比合計可能超過 100%。</small></div>
    <div className="da-comparisons">
      <ComparePanel title="部門橫向比較與排名" kind="department" rows={departmentRows} total={scopeTasks.length} focusKey={focused?.key || ''} onFocus={toggleFocus}/>
      <ComparePanel title="人員橫向比較與排名" kind="person" rows={personRows} total={scopeTasks.length} focusKey={focused?.key || ''} onFocus={toggleFocus}/>
      <ComparePanel title="船舶比較與排名" kind="vessel" rows={vesselRankRows} total={scopeTasks.length} focusKey={focused?.key || ''} onFocus={toggleFocus}/>
    </div>
    {sort === 'proposed' && <small className="da-note">提出者為人員，不歸因於船舶；船舶欄此時按責任件數排序。</small>}
    <div className="da-live-note">以下為可見船隊即時概況，保留原口徑；不套用上方責任、日期或來源篩選。</div>
    <div className="panel analysis-panel"><div className="panel-title"><h3>船舶優先級／異常／關注度／點亮項目／趨勢</h3><small>優先級與趨勢包含未同步內控；趨勢為近六個月新增件數</small></div><div className="table-wrap analysis-vessel-table"><table><thead><tr><th>船舶</th><th>急／高／中／低累計</th><th>異常</th><th>目前關注度</th><th>點亮項目</th><th>{months.join('　')}</th></tr></thead><tbody>{vesselRows.map(row => { const max = Math.max(1, ...row.trend); return <tr key={row.vessel.id}><td><b>{vesselDisplayName(row.vessel)}</b></td><td><div className="priority-counts"><span>急 {row.counts['急']}</span><span>高 {row.counts['高']}</span><span>中 {row.counts['中']}</span><span>低 {row.counts['低']}</span></div></td><td>{row.abnormal}</td><td><span className="attention-level">{row.attention}</span></td><td>{row.lights}／7</td><td><div className="analysis-trend" title={row.trend.join('、')}>{row.trend.map((count, index) => <i key={months[index]} style={{ height: `${Math.max(4, count / max * 100)}%` }} />)}</div></td></tr>; })}</tbody></table></div></div>
    <details className="panel analysis-panel da-method"><summary>統計口徑與分母說明</summary><ul className="analysis-method"><li>完成率：已結案事項 ÷ 責任範圍內全部事項；逾期率：未結案且預計完成日已過 ÷ 同一分母。</li><li>上方指標保留提出率原口徑：所選人員建立的事項 ÷ 目前日期及來源條件下的可見船隊全部事項，可能含其非責任事項；排名「提出」僅計目前責任範圍內的建立件數。</li><li>個人責任範圍：事項追蹤窗口或所屬船舶分管人員；部門範圍另包含事項部門。</li><li>高風險為「急／高」事項；需知曉、內控、異常按事項勾選欄位統計，卡片後綴為該子集完成率。</li><li>要事／臨會專題分類分開計算；各分類件數 ÷ 該來源事項總數，多選事項在每個分類各計一次，不以分類次數作分母。</li><li>排名佔比為責任件數 ÷ 目前責任事項總數。依所選指標排序，同值並列；完成率同值時依逾期率低、責任件數多排列。船舶完成／逾期使用逐船進度。</li><li>日期與新增趨勢均按建立日期（台北時間），不是報告日或結案日；週從星期一開始，首尾週只計篩選區間。未選日期時使用有效建立日期的完整範圍。</li><li>獨立且未同步的內控案件維持在下方船隊即時概況；不混入上方責任事項分析。</li></ul></details>
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

function CategoryPanel({ title, source, rows, total }: { title: string; source: string; rows: Array<{ name: string; count: number }>; total: number }) {
  return <div className="panel analysis-panel category-ratio-panel" data-category-source={source}><div className="panel-title"><h3>{title}</h3><small>{total} 件</small></div><small className="da-note">以本來源事項為分母；多選合計可能超過 100%。</small>{rows.length ? <div className="analysis-compare-list">{rows.map(row => <div className="analysis-compare-row" key={row.name} data-category={row.name} data-count={row.count} data-share={pct(row.count, total)}><b className="analysis-name">{row.name}</b><div className="analysis-bar"><i style={{ width: `${pct(row.count, total)}%` }} /></div><span className="analysis-value">{row.count} 件</span><span className="analysis-value">{pct(row.count, total)}%</span></div>)}</div> : <p className="empty-text">沒有符合條件的事項</p>}</div>;
}

function ComparePanel({ title, kind, rows, total, focusKey, onFocus }: { title: string; kind: string; rows: Array<{ id: string; name: string; rank: number; metrics: Metrics }>; total: number; focusKey: string; onFocus: (key: string) => void }) {
  return <div className="panel analysis-panel da-compare-panel" data-compare-kind={kind}><div className="panel-title"><h3>{title}</h3><small>{rows.length} 項</small></div>{rows.length ? <div className="analysis-compare-list">{rows.map(row => <div className="analysis-compare-row" key={row.id} data-compare-id={row.id} data-rank={row.rank} data-count={row.metrics.total}>
    <span className="analysis-rank">{row.rank}</span><button type="button" className="analysis-name da-text-button" aria-label={`查看 ${row.name} 趨勢`} aria-pressed={focusKey === `${kind}:${row.id}`} onClick={() => onFocus(`${kind}:${row.id}`)}>{row.name}</button><span className="da-share">佔 {pct(row.metrics.total, total)}%</span>
    <div className="analysis-bar"><i style={{ width: `${pct(row.metrics.total, total)}%` }}/></div><div className="da-row-values"><span className="analysis-value">完成 {row.metrics.completionRate}%</span><span className="analysis-value">逾期 {row.metrics.overdueRate}%</span><span className="analysis-value">責任 {row.metrics.total}</span>{kind !== 'vessel' && <span className="analysis-value">提出 {row.metrics.proposed}</span>}</div>
  </div>)}</div> : <p className="empty-text">沒有符合條件的事項</p>}</div>;
}

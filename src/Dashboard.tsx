import { useState } from 'react';
import type { ScheduleKind, TaskItem, UserAccount, Vessel, WeeklyAttentionKey } from './types';
import { daysDiff, todayDate } from './utils';

const PRIORITY_RANK = { 急: 0, 高: 1, 中: 2, 低: 3 } as const;
const WEEKLY_ATTENTION_OPTIONS: Array<{ key: WeeklyAttentionKey; label: string }> = [
  { key: 'crew-operation', label: '換員操作' },
  { key: 'bunkering-water', label: '加油加水' },
  { key: 'materials-parts', label: '物料配件' },
  { key: 'maintenance', label: '維修' },
  { key: 'survey', label: 'Survey' },
  { key: 'audit-inspection', label: '稽核檢查' },
  { key: 'psc-window', label: 'PSC窗開' },
];

interface DashboardProps {
  user: UserAccount;
  vessels: Vessel[];
  tasks: TaskItem[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  onEdit: (id: string) => void;
  onAddTask: (id: string) => void;
  onToggleAttention: (vesselId: string, key: WeeklyAttentionKey) => void;
  onStartMeeting: () => void;
  onOpenReport: () => void;
  onTaskMetric: (mode: 'open' | 'high' | 'overdue') => void;
  canEdit: boolean;
  canCreateTasks: boolean;
  canUseMeetings: boolean;
  canUseReports: boolean;
}

export default function Dashboard({ user, vessels, tasks, selected, setSelected, onEdit, onAddTask, onToggleAttention, onStartMeeting, onOpenReport, onTaskMetric, canEdit, canCreateTasks, canUseMeetings, canUseReports }: DashboardProps) {
  const [fleetFilter, setFleetFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [scheduleByVessel, setScheduleByVessel] = useState<Record<string, ScheduleKind>>({});
  const scheduleKinds: ScheduleKind[] = ['ETA','ETB','ETD'];
  const scheduleField = { ETA: 'eta', ETB: 'etb', ETD: 'etd' } as const;

  const visible = vessels.filter(vessel => {
    const vesselTasks = tasks.filter(task => task.vesselId === vessel.id && !task.isClosed);
    if (fleetFilter === 'selected' && !selected.includes(vessel.id)) return false;
    if (fleetFilter === 'high' && !vesselTasks.some(task => task.priority === '急' || task.priority === '高')) return false;
    if (fleetFilter === 'mine' && !vessel.assignedUserIds.includes(user.id) && !user.managedVesselIds.includes(vessel.id)) return false;
    if (!['all', 'selected', 'high', 'mine'].includes(fleetFilter) && !vessel.fleetCategory.toLowerCase().includes(fleetFilter)) return false;
    const query = keyword.trim().toLowerCase();
    return !query || [
      vessel.shortName,
      vessel.fullName,
      vessel.name,
      vessel.position.location,
      vessel.position.lastPort,
      vessel.position.nextPort,
      ...vessel.cargo.items.flatMap(item => [item.name, item.quantity]),
      vessel.position.manualRemark,
      vessel.note.recentDynamics,
    ].join(' ').toLowerCase().includes(query);
  });

  const openTasks = tasks.filter(task => !task.isClosed && vessels.some(vessel => vessel.id === task.vesselId));
  const urgentHighCount = openTasks.filter(task => task.priority === '急' || task.priority === '高').length;
  const overdueCount = openTasks.filter(task => (daysDiff(task.expectedDate) ?? 0) < 0).length;
  const updatedToday = vessels.filter(vessel => (vessel.updatedAt || vessel.position.updatedAt).slice(0, 10) === todayDate()).length;
  const toggleMeeting = (id: string) => setSelected(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
  const cycleSchedule = (vesselId: string) => setScheduleByVessel(previous => {
    const current = previous[vesselId] || 'ETA';
    return { ...previous, [vesselId]: scheduleKinds[(scheduleKinds.indexOf(current) + 1) % scheduleKinds.length] };
  });

  return <section className="dashboard-view">
    <div className="page-heading">
      <div><h1>船舶看板</h1><p>集中查看上下港、位置、載況、時間、貨物、未來一週關注與重要要事。</p></div>
      {(canUseMeetings||canUseReports)&&<div className="heading-actions no-print">{canUseMeetings&&<button className="btn pink" onClick={onStartMeeting}>開始今日早會</button>}{canUseReports&&<button className="btn primary" onClick={onOpenReport}>建立 PDF 報告</button>}</div>}
    </div>
    <div className="metric-grid">
      <div className="metric-card blue"><small>今日船舶</small><b>{vessels.length}</b><span>艘</span></div>
      <button type="button" className="metric-card metric-link pink" onClick={() => onTaskMetric('open')}><small>未結要事</small><b>{openTasks.length}</b><span>件</span></button>
      <button type="button" className="metric-card metric-link purple" onClick={() => onTaskMetric('high')}><small>急／高關注</small><b>{urgentHighCount}</b><span>件</span></button>
      <button type="button" className="metric-card metric-link yellow" onClick={() => onTaskMetric('overdue')}><small>已逾期</small><b>{overdueCount}</b><span>件</span></button>
      <div className="metric-card mint"><small>今日已更新</small><b>{updatedToday}</b><span>艘</span></div>
      {canUseMeetings&&<div className="metric-card"><small>選入會議</small><b>{selected.length}</b><span>艘</span></div>}
    </div>
    <div className="dashboard-toolbar no-print">
      <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜尋船名、港口、貨物、動態..." />
      {[
        ['all', '全部'], ['mine', '自管船舶'], ['tanker', '油輪'], ['bulk', '散貨'], ['high', '急／高關注'], ...(canUseMeetings ? [['selected', '選入會議']] : []),
      ].map(([key, label]) => <button key={key} className={`filter-pill ${fleetFilter === key ? 'active' : ''}`} onClick={() => setFleetFilter(key)}>{label}</button>)}
    </div>
    <div className="fleet-card-grid">{visible.map(vessel => {
      const vesselTasks = tasks.filter(task => task.vesselId === vessel.id && !task.isClosed);
      const urgent = vesselTasks.filter(task => task.priority === '急').length;
      const high = vesselTasks.filter(task => task.priority === '高').length;
      const mid = vesselTasks.filter(task => task.priority === '中').length;
      const low = vesselTasks.filter(task => task.priority === '低').length;
      const level = urgent ? 'urgent' : high ? 'high' : mid ? 'mid' : 'low';
      const abnormal = vesselTasks.some(task => task.isAbnormal);
      const scheduleKind = scheduleByVessel[vessel.id] || 'ETA';
      const scheduleValue = vessel.position[scheduleField[scheduleKind]]||'TBA';
      const sortedTasks = [...vesselTasks].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Number(b.isAbnormal) - Number(a.isAbnormal));
      const highest = urgent ? `急關注 ${urgent}` : high ? `高關注 ${high}` : mid ? `中關注 ${mid}` : `低關注 ${low}`;
      const selectedForMeeting = selected.includes(vessel.id);
      return <article key={vessel.id} className={`ship-card ${selectedForMeeting ? 'selected' : ''} level-${level}`}>
        <div className="ship-card-head">
          <div className="ship-identity"><h3>{vessel.shortName || vessel.name}</h3><small>{vessel.fullName} · {vessel.shipType}</small></div>
          <div className="ship-head-badges">{abnormal && <span className="abnormal-badge"><i />異常存在</span>}<span className={`priority-pill ${level}`}>{highest}</span></div>
        </div>
        <div className="ship-operation-grid">
          <div className="ship-route"><b>{vessel.position.lastPort || '未設定'}</b><span>→</span><b>{vessel.position.nextPort || '未設定'}</b></div>
          <div className="ship-position"><small>位置</small><b>{vessel.position.location || '未設定'}</b></div>
          <div className="ship-navigation"><small>航行狀態</small><b>{vessel.position.navigationStatus === '航行' ? `${vessel.position.speedKnots || 0} kn` : vessel.position.navigationStatus}</b></div>
          <div className="ship-load"><b>{vessel.cargo.loadStatus}</b></div>
          <button type="button" className="ship-schedule" onClick={() => cycleSchedule(vessel.id)} title="點擊循環顯示 ETA／ETB／ETD"><b>{scheduleKind}</b><span>{scheduleValue}</span></button>
          <div className="ship-cargo"><small>貨名貨量</small>{vessel.cargo.items.length ? vessel.cargo.items.map((item, index) => <span key={`${item.name}-${index}`}><b>{item.name || '未填貨名'}</b>{item.quantity && ` ${item.quantity}`}</span>) : <span>TBA</span>}</div>
        </div>
        <div className="weekly-attention no-print" aria-label="未來一週關注事項">{WEEKLY_ATTENTION_OPTIONS.map(option => {
          const active = vessel.weeklyAttention.includes(option.key);
          return <button type="button" key={option.key} disabled={!canEdit} className={`${active ? 'active' : ''} ${option.key === 'psc-window' ? 'psc' : ''}`} aria-pressed={active} onClick={() => onToggleAttention(vessel.id, option.key)}><i />{option.label}</button>;
        })}</div>
        <div className="ship-summary"><b>重要摘要：</b>{sortedTasks.length ? <ul>{sortedTasks.slice(0, 3).map(task => <li key={task.id}>{task.isAbnormal && <span>異常</span>}<strong>{task.priority}</strong>{task.description || '尚未輸入要事內容'}</li>)}</ul> : <p>目前無未結要事</p>}</div>
        <div className="ship-card-foot"><span className="task-mini"><i className="urgent">急 {urgent}</i><i className="high">高 {high}</i><i className="mid">中 {mid}</i><i className="low">低 {low}</i></span><div className="card-buttons no-print">{canEdit && <button className="btn small" onClick={() => onEdit(vessel.id)}>快速更新</button>}{canCreateTasks && <button className="btn small ghost" onClick={() => onAddTask(vessel.id)}>新增要事</button>}{canUseMeetings&&<button className={`btn small ${selectedForMeeting ? 'pink' : 'ghost'}`} onClick={() => toggleMeeting(vessel.id)}>{selectedForMeeting ? '已選入會議' : '選入會議'}</button>}</div></div>
      </article>;
    })}</div>
    {!visible.length && <div className="empty-state">沒有符合條件的船舶</div>}
  </section>;
}

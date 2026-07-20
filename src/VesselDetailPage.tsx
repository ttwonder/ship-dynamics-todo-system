import { useMemo, useState } from 'react';
import type { AppData, TaskPriority, UserAccount, Vessel } from './types';
import { selectVesselDetailTasks, type VesselTaskClosedMode, type VesselTaskSort } from './vesselDetail';
import { vesselDisplayName } from './vesselDisplay';
import { taskSourceLabel } from './taskWorkflow';
import { deriveVesselAttention, vesselAttentionClass, vesselAttentionLabel } from './vesselAttention';
import { vesselAttentionTasks } from './taskAttention';
import { taskIsClosedForVessel, taskProgressForVessel } from './taskVesselProgress';
import RichTextContent from './RichTextContent';

const attentionLabels: Record<string, string> = {
  'crew-operation': '換員操作', 'bunkering-water': '加油加水', 'materials-parts': '物料配件',
  maintenance: '維修', survey: 'Survey', 'audit-inspection': '稽核檢查', 'psc-window': 'PSC窗開',
};
const value = (text?: string | number) => text === '' || text === undefined || text === null ? '未設定' : String(text);
const sourceLabel = (source: string) => source === 'manual' ? '人工更新' : source === 'smart-ship-api' ? '智慧船舶 API' : '模擬智慧船舶資料';
const dateTime = (text?: string) => text ? text.replace('T', ' ').slice(0, 16) : '未設定';
const priorityClass = (priority: TaskPriority) => priority === '急' ? 'urgent' : priority === '高' ? 'high' : priority === '中' ? 'mid' : 'low';

interface VesselDetailPageProps {
  vessel: Vessel;
  data: AppData;
  currentUser: UserAccount;
  onBack: () => void;
  onEditVessel: () => void;
  onAddTask: () => void;
  onEditTask: (taskId: string) => void;
  canEditVessel: boolean;
  canCreateTasks: boolean;
  canEditTasks: boolean;
}

export default function VesselDetailPage({ vessel, data, currentUser, onBack, onEditVessel, onAddTask, onEditTask, canEditVessel, canCreateTasks, canEditTasks }: VesselDetailPageProps) {
  const [query, setQuery] = useState('');
  const [closedMode, setClosedMode] = useState<VesselTaskClosedMode>('all');
  const [priority, setPriority] = useState<'all' | TaskPriority>('all');
  const [sort, setSort] = useState<VesselTaskSort>('priority');
  const tasks = useMemo(() => selectVesselDetailTasks(data.tasks, vessel.id, { query, closedMode, priority, sort }), [data.tasks, vessel.id, query, closedMode, priority, sort]);
  const allVesselTasks = useMemo(() => selectVesselDetailTasks(data.tasks, vessel.id, { query: '', closedMode: 'all', priority: 'all', sort: 'priority' }), [data.tasks, vessel.id]);
  const openCount = allVesselTasks.filter(task => !taskIsClosedForVessel(task,vessel.id)).length;
  const closedCount = allVesselTasks.length - openCount;
  const attentionTaskItems = vesselAttentionTasks(allVesselTasks.filter(task => !taskIsClosedForVessel(task,vessel.id)));
  const attention = deriveVesselAttention(vessel, attentionTaskItems);
  const assignedNames = vessel.assignedUserIds.map(id => data.users.find(user => user.id === id)?.name).filter(Boolean);
  const ownerName = (id: string) => data.users.find(user => user.id === id)?.name || id;
  return <section className="vessel-detail-page">
    <div className="vessel-detail-top no-print">
      <button type="button" className="btn ghost vessel-detail-back" onClick={onBack}>← 回到船隊看板</button>
      <div className="heading-actions">
        {canEditVessel && <button type="button" className="btn" onClick={onEditVessel}>修改船舶狀態</button>}
        {canCreateTasks && <button type="button" className="btn primary" onClick={onAddTask}>＋ 新增待辦</button>}
      </div>
    </div>
    <div className="page-heading vessel-detail-heading"><div><h1>{vesselDisplayName(vessel)}</h1><p>{vessel.shipType || '未設定船種'}｜{vessel.fullName || vessel.name}</p></div><span className={`priority-pill ${vesselAttentionClass(attention.effective)}`}>{vesselAttentionLabel(attention, attentionTaskItems)}</span></div>
    <div className="vessel-detail-metrics">
      <div><small>未結待辦</small><b>{openCount}</b></div><div><small>已結案</small><b>{closedCount}</b></div><div><small>目前位置</small><b>{value(vessel.position.location)}</b></div><div><small>航行狀態</small><b>{vessel.position.navigationStatus === '航行' ? `${vessel.position.speedKnots || 0} kn` : value(vessel.position.navigationStatus)}</b></div>
    </div>

    <div className="vessel-detail-grid">
      <section className="panel vessel-info-panel"><h2>船舶基本資料</h2><dl>
        <div><dt>顯示船名</dt><dd>{vesselDisplayName(vessel)}</dd></div><div><dt>簡稱</dt><dd>{value(vessel.shortName)}</dd></div>
        <div><dt>完整船名</dt><dd>{value(vessel.fullName)}</dd></div><div><dt>船種</dt><dd>{value(vessel.shipType)}</dd></div>
        <div><dt>船隊類別</dt><dd>{value(vessel.fleetCategory)}</dd></div><div><dt>船隊標籤</dt><dd>{vessel.fleetTags.join('、') || '未設定'}</dd></div>
        <div><dt>啟用狀態</dt><dd>{vessel.isActive ? '啟用' : '停用'}</dd></div><div><dt>經管人員</dt><dd>{assignedNames.join('、') || '未指派'}</dd></div>
        <div><dt>建立時間</dt><dd>{dateTime(vessel.createdAt)}</dd></div><div><dt>最後更新</dt><dd>{dateTime(vessel.updatedAt)}</dd></div>
      </dl></section>
      <section className="panel vessel-info-panel"><h2>航行與港口</h2><dl>
        <div><dt>目前位置</dt><dd>{value(vessel.position.location)}</dd></div><div><dt>航行狀態</dt><dd>{value(vessel.position.navigationStatus)}</dd></div>
        <div><dt>速度</dt><dd>{vessel.position.speedKnots || 0} kn</dd></div><div><dt>上一港</dt><dd>{value(vessel.position.lastPort)}</dd></div>
        <div><dt>下一港</dt><dd>{value(vessel.position.nextPort)}</dd></div><div className="span-2"><dt>航線</dt><dd>{value(vessel.position.lastPort)} → {value(vessel.position.nextPort)}</dd></div>
      </dl></section>
      <section className="panel vessel-info-panel"><h2>時間與資料來源</h2><dl>
        <div><dt>ETA</dt><dd>{dateTime(vessel.position.eta)}</dd></div><div><dt>ETB</dt><dd>{dateTime(vessel.position.etb)}</dd></div>
        <div><dt>ETD</dt><dd>{dateTime(vessel.position.etd)}</dd></div><div><dt>位置資料來源</dt><dd>{sourceLabel(vessel.position.source)}</dd></div>
        <div><dt>位置資料更新時間</dt><dd>{dateTime(vessel.position.updatedAt)}</dd></div><div><dt>貨載資料更新時間</dt><dd>{dateTime(vessel.cargo.updatedAt)}</dd></div>
      </dl></section>
      <section className="panel vessel-info-panel"><h2>貨載資訊</h2><dl>
        <div><dt>載況</dt><dd>{value(vessel.cargo.loadStatus)}</dd></div><div><dt>資料來源</dt><dd>{sourceLabel(vessel.cargo.source)}</dd></div>
        <div className="span-2"><dt>貨名／貨量</dt><dd>{vessel.cargo.items.length ? vessel.cargo.items.map((item,index)=><span className="detail-cargo-line" key={`${item.name}-${index}`}>{value(item.name)}{item.quantity ? `｜${item.quantity}` : ''}</span>) : `${value(vessel.cargo.name)}${vessel.cargo.quantity ? `｜${vessel.cargo.quantity}` : ''}`}</dd></div>
      </dl></section>
      <section className="panel vessel-info-panel vessel-note-panel"><h2>動態與備註</h2><dl>
        <div><dt>船舶狀態</dt><dd>{vessel.note.statusList.join('、') || '未設定'}</dd></div><div><dt>人工關注程度</dt><dd>{value(vessel.manualAttentionLevel)}</dd></div>
        <div className="span-2"><dt>未來一週關注</dt><dd>{vessel.weeklyAttention.map(item=>attentionLabels[item]||item).join('、') || '無'}</dd></div>
        <div className="span-2"><dt>人工動態備註</dt><dd>{value(vessel.position.manualRemark)}</dd></div>
        <div className="span-2"><dt>近期／後續動態</dt><dd>{value(vessel.note.recentDynamics)}</dd></div>
        {vessel.note.subsequentDynamics&&<div className="span-2"><dt>後續動態（舊資料）</dt><dd>{vessel.note.subsequentDynamics}</dd></div>}
        <div><dt>動態更新時間</dt><dd>{dateTime(vessel.note.updatedAt)}</dd></div><div><dt>目前查看人</dt><dd>{currentUser.name}</dd></div>
      </dl></section>
    </div>

    <section className="panel vessel-detail-tasks">
      <div className="panel-title"><h2>單船重要事項清單 <span className="muted">({tasks.length}/{allVesselTasks.length})</span></h2>{canCreateTasks&&<button type="button" className="btn primary small no-print" onClick={onAddTask}>＋ 新增待辦</button>}</div>
      <p className="muted single-vessel-task-note">單船待辦只顯示普通單船要事，以及已勾選「分派到涉及船舶單船跟蹤」的臨會／專題待辦；未分派的公司層決議請在臨會／專題或待辦總表跟蹤。</p>
      <div className="vessel-task-toolbar no-print">
        <input aria-label="單船待辦關鍵字" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜尋內容、狀態、分類、部門…" />
        <select aria-label="單船待辦狀態篩選" value={closedMode} onChange={event=>setClosedMode(event.target.value as VesselTaskClosedMode)}><option value="all">全部狀態</option><option value="open">未結</option><option value="closed">已結案</option></select>
        <select aria-label="單船待辦關注程度篩選" value={priority} onChange={event=>setPriority(event.target.value as 'all'|TaskPriority)}><option value="all">全部關注程度</option>{data.settings.priorities.map(item=><option key={item}>{item}</option>)}</select>
        <select aria-label="單船待辦排序" value={sort} onChange={event=>setSort(event.target.value as VesselTaskSort)}><option value="priority">關注程度：急到低</option><option value="due-asc">期限：近到遠</option><option value="updated-desc">最近更新</option></select>
        {(query||closedMode!=='all'||priority!=='all'||sort!=='priority')&&<button type="button" className="btn ghost small" onClick={()=>{setQuery('');setClosedMode('all');setPriority('all');setSort('priority');}}>清除篩選</button>}
      </div>
      {tasks.length?<div className="table-wrap"><table className="data-table vessel-detail-task-table"><thead><tr><th>結案</th><th>關注</th><th>事項內容</th><th>單船狀態</th><th>分類／部門</th><th>追蹤窗口</th><th>期限</th><th>來源</th><th className="no-print">操作</th></tr></thead><tbody>{tasks.map(task=>{const progress=taskProgressForVessel(task,vessel.id);return <tr key={task.id}><td><span className={`status-chip ${progress.isClosed?'closed':'open'}`}>{progress.isClosed?'已結案':'未結'}</span></td><td><span className={`badge ${priorityClass(task.priority)}`}>{task.priority}</span></td><td>{task.isAbnormal&&<span className="inline-abnormal">異常</span>}<RichTextContent compact value={task.description} fallback="尚未輸入事項內容"/></td><td><RichTextContent compact value={progress.status} fallback="尚未更新"/></td><td><small>{task.categories.join('、')||'未分類'}<br/>{task.departments.join('、')||'未指定部門'}</small></td><td>{task.ownerUserIds.map(ownerName).join('、')||'未指定'}</td><td>{task.expectedDate||'未設定'}</td><td>{taskSourceLabel(task)}</td><td className="no-print"><button type="button" className="btn small ghost" onClick={()=>onEditTask(task.id)}>{canEditTasks?'修改':'查看'}</button></td></tr>})}</tbody></table></div>:<div className="empty-state compact">沒有符合目前條件的待辦事項</div>}
    </section>
  </section>;
}

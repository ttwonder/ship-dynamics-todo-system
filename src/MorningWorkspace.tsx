import { useEffect, useState } from 'react';
import type { AppData, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import { daysDiff, nowIso, todayDate, uid, yesterdayDate } from './utils';
import { taskCategoryLabel } from './taskCategories';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskVesselIds, taskVesselLabel } from './taskVesselScope';
import { morningDiscussionTasks } from './morningTaskScope';
import { taskIsClosedForScope, taskIsClosedForVessel, taskProgressForVessel } from './taskVesselProgress';
import RichTextContent from './RichTextContent';

type Props = {
  data: AppData;
  user: UserAccount;
  visibleVessels: Vessel[];
  selected: string[];
  setSelected: (ids:string[]) => void;
  onEditTask: (task:TaskItem, vesselId?:string) => void;
  onAddTask: (vesselId:string) => void;
  onOpenVessel: (id:string) => void;
  onOpenTemporaryMeeting: () => void;
  onOpenReport: () => void;
  commit: (mutate:(draft:AppData)=>void, action:string, entityType:string, entityId:string, detail:string)=>void;
};

const priorityOrder = { 急:0, 高:1, 中:2, 低:3 } as const;
type AgendaViewMode = 'all' | 'today' | 'history';
type AgendaSortMode = 'priority' | 'newest' | 'oldest';

const taskReportDate = (task: TaskItem) => (task.createdAt || task.updatedAt || '').slice(0, 10);
const taskReportTime = (task: TaskItem) => {
  const raw = task.createdAt || task.updatedAt;
  if (!raw) return '未記錄時間';
  return raw.replace('T', ' ').slice(0, 16);
};

export default function MorningWorkspaceView({ data, user, visibleVessels, selected, setSelected, onEditTask, onAddTask, onOpenVessel, onOpenTemporaryMeeting, onOpenReport, commit }:Props) {
  const allIds = visibleVessels.map(v => v.id);
  const showAll = selected.length === 0 || selected.length === visibleVessels.length;
  const scopeIds = showAll ? allIds : selected.filter(id => allIds.includes(id));
  const scopeSet = new Set(scopeIds);
  const morningTasks = morningDiscussionTasks(data.tasks, data.meetings);
  const discussionVessels = visibleVessels.filter(v => scopeSet.has(v.id));
  const [newTaskVesselId, setNewTaskVesselId] = useState(scopeIds[0] || '');
  const [agendaView, setAgendaView] = useState<AgendaViewMode>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [sortMode, setSortMode] = useState<AgendaSortMode>('priority');
  useEffect(() => { if (!scopeIds.includes(newTaskVesselId)) setNewTaskVesselId(scopeIds[0] || ''); }, [scopeIds.join('|'), newTaskVesselId]);
  const firstScopeIndex = (task: TaskItem) => Math.min(...taskVesselIds(task).map(id => scopeIds.indexOf(id)).filter(index => index >= 0));
  const sortTasks = (items: TaskItem[]) => [...items].sort((a,b) => {
    if (sortMode === 'newest') return (b.createdAt || b.updatedAt).localeCompare(a.createdAt || a.updatedAt) || priorityOrder[a.priority] - priorityOrder[b.priority];
    if (sortMode === 'oldest') return (a.createdAt || a.updatedAt).localeCompare(b.createdAt || b.updatedAt) || priorityOrder[a.priority] - priorityOrder[b.priority];
    const vesselDiff = firstScopeIndex(a) - firstScopeIndex(b);
    return vesselDiff || priorityOrder[a.priority] - priorityOrder[b.priority] || (daysDiff(a.expectedDate) ?? 999) - (daysDiff(b.expectedDate) ?? 999);
  });
  const openDiscussionTasks = morningTasks.filter(t => taskVesselIds(t).some(id => scopeSet.has(id)) && !taskIsClosedForScope(t,scopeIds));
  const priorityFilteredTasks = openDiscussionTasks.filter(task => priorityFilter === 'all' || task.priority === priorityFilter);
  const todayKey = todayDate();
  const todayDiscussionTasks = sortTasks(priorityFilteredTasks.filter(task => taskReportDate(task) === todayKey));
  const historicalDiscussionTasks = sortTasks(priorityFilteredTasks.filter(task => taskReportDate(task) < todayKey));
  const fallbackDiscussionTasks = sortTasks(priorityFilteredTasks.filter(task => taskReportDate(task) > todayKey || !taskReportDate(task)));
  const displayedDiscussionTasks = [
    ...(agendaView === 'history' ? [] : todayDiscussionTasks),
    ...(agendaView === 'today' ? [] : historicalDiscussionTasks),
    ...(agendaView === 'history' ? [] : fallbackDiscussionTasks),
  ];
  const allScopeTasks = morningTasks.filter(t => taskVesselIds(t).some(id => scopeSet.has(id)));
  const yesterdayOpen = openDiscussionTasks.filter(t => (t.updatedAt || t.createdAt).slice(0,10) <= yesterdayDate()).length;
  const urgentHigh = openDiscussionTasks.filter(t => t.priority === '急' || t.priority === '高').length;
  const completed = allScopeTasks.filter(t => taskIsClosedForScope(t,scopeIds)).length;
  const completion = allScopeTasks.length ? Math.round(completed / allScopeTasks.length * 100) : 0;
  const toggle = (id:string) => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const saveAgenda = () => {
    if (!scopeIds.length) return alert('目前沒有可加入早會的船舶');
    const id = uid('agenda');
    commit(d => { d.agendaReports.unshift({ id, title:'船舶早會動態暨待辦報告', vesselIds:scopeIds, createdBy:user.id, createdAt:nowIso(), taskCount:openDiscussionTasks.length }); }, '保存早會報告紀錄', 'agenda', id, `${scopeIds.length} 艘船、${openDiscussionTasks.length} 件事項`);
    alert('早會報告紀錄已保存；日後檢視會使用當時選船範圍與目前最新資料。');
  };
  const openReport = () => { if (showAll) setSelected(allIds); onOpenReport(); };

  const AgendaTaskCard = ({ task, index }: { task: TaskItem; index: number }) => {
    const taskIds=taskVesselIds(task);
    const displayStatus=scopeIds.length===1?taskProgressForVessel(task,scopeIds[0]).status:task.status;
    return <article className={`meeting-agenda-card priority-${task.priority}`} key={task.id}>
      <div className="agenda-number">{String(index+1).padStart(2,'0')}</div>
      <div className="agenda-content">
        <div className="agenda-vessel-label"><b>{taskVesselLabel(task,visibleVessels)}</b><span className="agenda-report-time">報告時間 {taskReportTime(task)}</span></div>
        <div className="agenda-task-title">{task.isAbnormal&&<span className="inline-abnormal">異常</span>}<RichTextContent compact value={task.description} fallback="尚未輸入要事內容"/></div>
        <p>{task.priority}關注｜{taskCategoryLabel(task)}｜{task.departments.join('、')||'未指定部門'}｜期限 {task.expectedDate||'未設定'}</p>
        <div className="agenda-status"><b>目前狀態：</b><RichTextContent compact value={displayStatus} fallback="尚未更新狀態"/></div>
        <div className="agenda-actions no-print"><button className="btn small primary" onClick={()=>onEditTask(task,scopeIds.length===1&&taskIds.includes(scopeIds[0])?scopeIds[0]:'')}>更新狀態／決議</button>{taskIds.length===1&&<button className="btn small ghost" onClick={()=>onOpenVessel(taskIds[0])}>打開船舶</button>}</div>
      </div>
    </article>;
  };

  const AgendaSection = ({ title, subtitle, tasks, offset = 0 }: { title: string; subtitle: string; tasks: TaskItem[]; offset?: number }) => <section className="agenda-split-section"><div className="agenda-split-title"><div><h3>{title}</h3><span>{subtitle}</span></div><b>{tasks.length} 件</b></div>{tasks.length ? tasks.map((task,index) => <AgendaTaskCard task={task} index={offset+index} key={task.id}/>) : <div className="empty-state compact">目前沒有符合條件的議題</div>}</section>;

  return <section><div className="page-heading"><div><h1>今日早會工作台</h1><p>左側勾選討論範圍；未選或全選時，中間顯示全部內容。</p></div><div className="heading-actions no-print"><button className="btn ghost" onClick={onOpenTemporaryMeeting}>＋ 臨會/專題</button><button className="btn green" onClick={saveAgenda}>保存早會</button><button className="btn primary" onClick={openReport}>預覽 PDF</button></div></div>
    {!visibleVessels.length ? <div className="empty-state"><h3>目前沒有可見船舶</h3></div> : <div className="morning-workspace">
      <aside className="meeting-column vessel-rail"><div className="column-title"><div><h2>今日討論船舶</h2><span>{showAll ? `全部 ${visibleVessels.length} 艘` : `已選 ${selected.length} 艘`}</span></div><button className="btn small ghost" aria-label="全選討論船舶" onClick={() => setSelected(allIds)}>全選</button></div><div className="vessel-rail-tools no-print"><button className="btn small ghost" onClick={() => setSelected([])}>清空（顯示全部）</button></div><div className="column-scroll">{visibleVessels.map(v => { const vt=morningTasks.filter(t=>taskHasVessel(t,v.id)&&!taskIsClosedForVessel(t,v.id)); const urgent=vt.filter(t=>t.priority==='急').length; const hi=vt.filter(t=>t.priority==='高').length; const abnormal=vt.some(t=>t.isAbnormal); return <button key={v.id} className={`mini-ship-card ${selected.includes(v.id)?'active':''}`} onClick={() => toggle(v.id)}><span className="mini-ship-head"><span className={`meeting-check ${selected.includes(v.id)?'on':''}`}>{selected.includes(v.id)?'✓':''}</span><b>{vesselDisplayName(v)}</b>{abnormal&&<i>異常</i>}{urgent>0?<i>急 {urgent}</i>:hi>0&&<i>高 {hi}</i>}</span><span>{v.position.lastPort||v.position.location} → {v.position.nextPort||'未設定'}</span><small>{v.position.navigationStatus==='航行'?`${v.position.speedKnots||0} kn`:v.position.navigationStatus}｜{v.cargo.loadStatus}｜{v.cargo.items.map(item=>item.name).filter(Boolean).join('、')||'未填貨名'}</small></button>})}</div></aside>
      <section className="meeting-column agenda-column"><div className="column-title"><div><h2>逐項討論與決議</h2><span>{showAll ? '顯示全部內容' : `${discussionVessels.length} 艘船`}</span></div><div className="heading-actions no-print"><select aria-label="新增待辦船舶" value={newTaskVesselId} onChange={event=>setNewTaskVesselId(event.target.value)}>{discussionVessels.map(vessel=><option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select><button className="btn small primary" disabled={!newTaskVesselId} onClick={()=>newTaskVesselId&&onAddTask(newTaskVesselId)}>＋ 新增待辦</button></div></div><div className="column-scroll"><div className="meeting-vessel-summary"><div><h2>{discussionVessels.length===1 ? vesselDisplayName(discussionVessels[0]) : '全部討論內容'}</h2><p>{discussionVessels.length} 艘船｜{openDiscussionTasks.length} 件未結要事｜今日 {todayDiscussionTasks.length}｜歷史未結 {historicalDiscussionTasks.length}｜急／高關注 {urgentHigh} 件</p></div><span>早會進行中</span></div><div className="agenda-filter-bar no-print"><button className={agendaView==='all'?'active':''} onClick={()=>setAgendaView('all')}>全部討論</button><button className={agendaView==='today'?'active':''} onClick={()=>setAgendaView('today')}>今日討論</button><button className={agendaView==='history'?'active':''} onClick={()=>setAgendaView('history')}>歷史未結</button>{(['急','高','中','低'] as TaskPriority[]).map(priority=><button key={priority} className={priorityFilter===priority?'active':''} onClick={()=>setPriorityFilter(priorityFilter===priority?'all':priority)}>{priority}</button>)}<button className={sortMode!=='priority'?'active':''} onClick={()=>setSortMode(sortMode==='newest'?'oldest':sortMode==='oldest'?'priority':'newest')}>{sortMode==='priority'?'以時間序排列':sortMode==='newest'?'時間新→舊':'時間舊→新'}</button></div>{displayedDiscussionTasks.length ? <>{agendaView!=='history'&&<AgendaSection title="今日早會議題" subtitle="今日新增／報告的未結早會事項" tasks={todayDiscussionTasks}/>} {agendaView!=='today'&&<AgendaSection title="歷史未結早會議題" subtitle="今日以前報告但尚未結案的早會事項" tasks={historicalDiscussionTasks} offset={agendaView==='all'?todayDiscussionTasks.length:0}/>} {agendaView!=='history'&&fallbackDiscussionTasks.length>0&&<AgendaSection title="其他日期議題" subtitle="日期未記錄或晚於今日的未結事項" tasks={fallbackDiscussionTasks} offset={todayDiscussionTasks.length+historicalDiscussionTasks.length}/>}</> : <div className="empty-state">目前沒有符合條件的早會議題</div>}</div></section>
      <aside className="meeting-column summary-column"><div className="column-title"><h2>早會即時摘要</h2></div><div className="column-scroll"><div className="summary-card pink"><h3>昨日未結</h3><b>{yesterdayOpen}</b><span> 件</span><small>急／高關注 {urgentHigh} 件</small></div><div className="summary-card blue"><h3>本次早會</h3><div className="summary-line"><span>討論船舶</span><b>{scopeIds.length}</b></div><div className="summary-line"><span>未結要事</span><b>{openDiscussionTasks.length}</b></div><div className="summary-line"><span>今日議題</span><b>{todayDiscussionTasks.length}</b></div><div className="summary-line"><span>歷史未結</span><b>{historicalDiscussionTasks.length}</b></div><div className="summary-line"><span>急／高關注</span><b>{urgentHigh}</b></div></div><div className="summary-card mint"><h3>討論範圍完成率</h3><b>{completion}%</b><div className="progress"><span style={{width:`${completion}%`}}/></div></div><div className="summary-card"><h3>報告內容</h3>{discussionVessels.map(v=><div className="summary-line" key={v.id}><span>{vesselDisplayName(v)}</span><b>{morningTasks.filter(t=>taskHasVessel(t,v.id)&&!taskIsClosedForVessel(t,v.id)).length} 項</b></div>)}<button className="btn primary full" onClick={openReport}>預覽美觀 PDF</button></div></div></aside>
    </div>}
  </section>;
}

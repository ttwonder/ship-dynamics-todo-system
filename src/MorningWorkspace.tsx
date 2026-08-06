import { useEffect, useState, type ReactNode } from 'react';
import type { AppData, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import { nowIso } from './runtimeUtils';
import { taskCategoryLabel } from './taskCategories';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskVesselIds, taskVesselLabel } from './taskVesselScope';
import { morningDiscussionTasks } from './morningTaskScope';
import { taskIsClosedForScope, taskIsClosedForVessel, taskProgressForVessel } from './taskVesselProgress';
import RichTextContent from './RichTextContent';
import { deriveVesselAttention } from './vesselAttention';
import { vesselAttentionTasks } from './taskAttention';
import { meetingCreatesVesselAbnormalAlert } from './meetingVesselAttention';
import { userCanManageVesselByAssignmentOrDelegation } from './vesselDelegation';
import VesselFilterControls from './VesselFilterControls';
import { attentionFilterGroup, emptyVesselFilterState, hasActiveVesselFilters, matchingVesselIds, shipTypeFilterOptions, supervisorIdsForVessel, vesselSupervisorOptions } from './vesselDashboardFilters';
import { formatTaipeiDateTime, taipeiDateKey, taipeiDaysDiff, taipeiYesterdayDate } from './taipeiTime';
import { paginateMorningHistory } from './morningHistoryPagination';

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
  canSaveDailyMorning: boolean;
  onSaveDailyMorning: (at:string)=>Promise<boolean>;
};

const priorityOrder = { 急:0, 高:1, 中:2, 低:3 } as const;
type AgendaViewMode = 'all' | 'today' | 'history';
type AgendaSortMode = 'priority' | 'newest' | 'oldest';

type HistoryPaginationControlsProps = {
  position: '上方' | '下方';
  currentPage: number;
  pageCount: number;
  totalItems: number;
  visibleItems: number;
  onPageChange: (page: number) => void;
};

const HistoryPaginationControls = ({ position, currentPage, pageCount, totalItems, visibleItems, onPageChange }: HistoryPaginationControlsProps) => (
  <nav className={`morning-history-pagination ${position === '上方' ? 'top' : 'bottom'} no-print`} aria-label={`歷史未結分頁（${position}）`}>
    <span>第 {currentPage}／{pageCount} 頁｜本頁 {visibleItems} 件｜共 {totalItems} 件</span>
    <div>
      <button className="btn small ghost" aria-label={`歷史未結${position}上一頁`} disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>上一頁</button>
      <label>跳至第
        <select aria-label={position === '上方' ? '歷史未結上方頁碼' : '歷史未結下方頁碼'} value={currentPage} onChange={event => onPageChange(Number(event.target.value))}>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map(page => <option key={page} value={page}>{page}</option>)}
        </select>
        頁
      </label>
      <button className="btn small ghost" aria-label={`歷史未結${position}下一頁`} disabled={currentPage >= pageCount} onClick={() => onPageChange(currentPage + 1)}>下一頁</button>
    </div>
  </nav>
);

const taskReportDate = (task: TaskItem) => task.reportDate || taipeiDateKey(task.createdAt || task.updatedAt);
const taskReportTime = (task: TaskItem) => {
  const raw = task.createdAt || task.updatedAt;
  if (!raw) return '未記錄時間';
  return formatTaipeiDateTime(raw, false, '未記錄時間');
};

export default function MorningWorkspaceView({ data, user, visibleVessels, selected, setSelected, onEditTask, onAddTask, onOpenVessel, onOpenTemporaryMeeting, onOpenReport, canSaveDailyMorning, onSaveDailyMorning }:Props) {
  const allIds = visibleVessels.map(v => v.id);
  const [vesselFilters, setVesselFilters] = useState(emptyVesselFilterState);
  const morningTasks = morningDiscussionTasks(data.tasks, data.meetings);
  const filterFacts = visibleVessels.map(vessel => {
    const vesselTasks = data.tasks.filter(task => taskHasVessel(task, vessel.id) && !taskIsClosedForVessel(task, vessel.id));
    const hasMeetingAbnormal = data.meetings.some(meeting => meetingCreatesVesselAbnormalAlert(meeting, vessel.id));
    const attention = deriveVesselAttention(vessel, vesselAttentionTasks(vesselTasks), hasMeetingAbnormal, data.internalControlCases).effective;
    return {
      id: vessel.id,
      selfManaged: userCanManageVesselByAssignmentOrDelegation(vessel, user),
      shipType: vessel.shipType.trim(),
      attentionGroup: attentionFilterGroup(attention),
      selectedForMeeting: selected.includes(vessel.id),
      supervisorIds: supervisorIdsForVessel(vessel, data.users),
    };
  });
  const filtersActive = hasActiveVesselFilters(vesselFilters);
  const showAll = !filtersActive && (selected.length === 0 || selected.length === visibleVessels.length);
  const scopeIds = showAll ? allIds : selected.filter(id => allIds.includes(id));
  const scopeSet = new Set(scopeIds);
  const discussionVessels = visibleVessels.filter(v => scopeSet.has(v.id));
  const shipTypes = shipTypeFilterOptions(visibleVessels);
  const supervisors = vesselSupervisorOptions(visibleVessels, data.users);
  const applyVesselFilters = (nextFilters: ReturnType<typeof emptyVesselFilterState>) => {
    setVesselFilters(nextFilters);
    setSelected(hasActiveVesselFilters(nextFilters) ? matchingVesselIds(filterFacts, nextFilters) : []);
  };
  const [newTaskVesselId, setNewTaskVesselId] = useState(scopeIds[0] || '');
  const [agendaView, setAgendaView] = useState<AgendaViewMode>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [sortMode, setSortMode] = useState<AgendaSortMode>('priority');
  const [historyPage, setHistoryPage] = useState(1);
  const [savingAgenda, setSavingAgenda] = useState(false);
  useEffect(() => { if (!scopeIds.includes(newTaskVesselId)) setNewTaskVesselId(scopeIds[0] || ''); }, [scopeIds.join('|'), newTaskVesselId]);
  const firstScopeIndex = (task: TaskItem) => Math.min(...taskVesselIds(task).map(id => scopeIds.indexOf(id)).filter(index => index >= 0));
  const sortTasks = (items: TaskItem[]) => [...items].sort((a,b) => {
    if (sortMode === 'newest') return (b.createdAt || b.updatedAt).localeCompare(a.createdAt || a.updatedAt) || priorityOrder[a.priority] - priorityOrder[b.priority];
    if (sortMode === 'oldest') return (a.createdAt || a.updatedAt).localeCompare(b.createdAt || b.updatedAt) || priorityOrder[a.priority] - priorityOrder[b.priority];
    const vesselDiff = firstScopeIndex(a) - firstScopeIndex(b);
    return vesselDiff || priorityOrder[a.priority] - priorityOrder[b.priority] || (taipeiDaysDiff(a.expectedDate) ?? 999) - (taipeiDaysDiff(b.expectedDate) ?? 999);
  });
  const openDiscussionTasks = morningTasks.filter(t => taskVesselIds(t).some(id => scopeSet.has(id)) && !taskIsClosedForScope(t,scopeIds));
  const priorityFilteredTasks = openDiscussionTasks.filter(task => priorityFilter === 'all' || task.priority === priorityFilter);
  const todayKey = taipeiDateKey();
  const todayDiscussionTasks = sortTasks(priorityFilteredTasks.filter(task => taskReportDate(task) === todayKey));
  const historicalDiscussionTasks = sortTasks(priorityFilteredTasks.filter(task => taskReportDate(task) < todayKey));
  const historicalPage = paginateMorningHistory(historicalDiscussionTasks, historyPage);
  const fallbackDiscussionTasks = sortTasks(priorityFilteredTasks.filter(task => taskReportDate(task) > todayKey || !taskReportDate(task)));
  const displayedDiscussionTasks = [
    ...(agendaView === 'history' ? [] : todayDiscussionTasks),
    ...(agendaView === 'today' ? [] : historicalPage.items),
    ...(agendaView === 'history' ? [] : fallbackDiscussionTasks),
  ];
  useEffect(() => { if (historyPage !== historicalPage.currentPage) setHistoryPage(historicalPage.currentPage); }, [historyPage, historicalPage.currentPage]);
  useEffect(() => { setHistoryPage(1); }, [scopeIds.join('|'), priorityFilter, sortMode]);
  const allScopeTasks = morningTasks.filter(t => taskVesselIds(t).some(id => scopeSet.has(id)));
  const yesterdayOpen = openDiscussionTasks.filter(t => taipeiDateKey(t.updatedAt || t.createdAt) <= taipeiYesterdayDate()).length;
  const urgentHigh = openDiscussionTasks.filter(t => t.priority === '急' || t.priority === '高').length;
  const completed = allScopeTasks.filter(t => taskIsClosedForScope(t,scopeIds)).length;
  const completion = allScopeTasks.length ? Math.round(completed / allScopeTasks.length * 100) : 0;
  const toggle = (id:string) => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const saveAgenda = async () => {
    if (!canSaveDailyMorning || savingAgenda) return;
    setSavingAgenda(true);
    try { await onSaveDailyMorning(nowIso()); }
    finally { setSavingAgenda(false); }
  };
  const openReport = () => { if (showAll) setSelected(allIds); onOpenReport(); };

  const AgendaTaskCard = ({ task, index }: { task: TaskItem; index: number }) => {
    const taskIds=taskVesselIds(task);
    const displayStatus=scopeIds.length===1?taskProgressForVessel(task,scopeIds[0]).status:task.status;
    return <article className={`meeting-agenda-card priority-${task.priority}`} key={task.id}>
      <div className="agenda-number">{String(index+1).padStart(2,'0')}</div>
      <div className="agenda-content">
        <div className="agenda-vessel-label"><b>{taskVesselLabel(task,visibleVessels)}</b><span className="agenda-report-time">報告日期 {taskReportDate(task)||'未設定'}｜建立 {taskReportTime(task)}</span></div>
        <div className="agenda-task-title">{task.isAbnormal&&<span className="inline-abnormal">異常</span>}<RichTextContent compact value={task.description} fallback="尚未輸入要事內容"/></div>
        <p>{task.priority}關注｜{taskCategoryLabel(task)}｜{task.departments.join('、')||'未指定部門'}｜期限 {task.expectedDate||'未設定'}</p>
        <div className="agenda-status"><b>目前狀態：</b><RichTextContent compact value={displayStatus} fallback="尚未更新狀態"/></div>
        <div className="agenda-actions no-print"><button className="btn small primary" onClick={()=>onEditTask(task,scopeIds.length===1&&taskIds.includes(scopeIds[0])?scopeIds[0]:'')}>更新狀態／決議</button>{taskIds.length===1&&<button className="btn small ghost" onClick={()=>onOpenVessel(taskIds[0])}>打開船舶</button>}</div>
      </div>
    </article>;
  };

  const AgendaSection = ({ title, subtitle, tasks, offset = 0, totalCount = tasks.length, topControls, bottomControls }: { title: string; subtitle: string; tasks: TaskItem[]; offset?: number; totalCount?: number; topControls?: ReactNode; bottomControls?: ReactNode }) => <section className="agenda-split-section"><div className="agenda-split-title"><div><h3>{title}</h3><span>{subtitle}</span></div><b>{totalCount} 件</b></div>{topControls}{tasks.length ? tasks.map((task,index) => <AgendaTaskCard task={task} index={offset+index} key={task.id}/>) : <div className="empty-state compact">目前沒有符合條件的議題</div>}{bottomControls}</section>;

  return <section><div className="page-heading"><div><h1>今日早會工作台</h1><p>左側勾選討論範圍；未選或全選時，中間顯示全部內容。</p></div><div className="heading-actions no-print"><button className="btn ghost" onClick={onOpenTemporaryMeeting}>＋ 臨會/專題</button>{canSaveDailyMorning&&<button className="btn green" disabled={savingAgenda} onClick={()=>void saveAgenda()}>{savingAgenda?'雲端確認中…':'保存今日早會'}</button>}<button className="btn primary" onClick={openReport}>預覽 PDF</button></div></div>
    {!visibleVessels.length ? <div className="empty-state"><h3>目前沒有可見船舶</h3></div> : <div className="morning-workspace">
      <aside className="meeting-column vessel-rail"><div className="column-title"><div><h2>今日討論船舶</h2><span>{showAll ? `全部 ${visibleVessels.length} 艘` : `已選 ${selected.length} 艘`}</span></div><button className="btn small ghost" aria-label="全選討論船舶" onClick={() => setSelected(allIds)}>全選</button></div><div className="vessel-rail-tools no-print"><VesselFilterControls filters={vesselFilters} shipTypes={shipTypes} supervisors={supervisors} onChange={applyVesselFilters} showSupervisors={false}/><button className="btn small ghost" onClick={() => applyVesselFilters(emptyVesselFilterState())}>清空（顯示全部）</button></div><div className="column-scroll">{visibleVessels.map(v => { const vt=morningTasks.filter(t=>taskHasVessel(t,v.id)&&!taskIsClosedForVessel(t,v.id)); const urgent=vt.filter(t=>t.priority==='急').length; const hi=vt.filter(t=>t.priority==='高').length; const abnormal=vt.some(t=>t.isAbnormal); return <button key={v.id} className={`mini-ship-card ${selected.includes(v.id)?'active':''}`} onClick={() => toggle(v.id)}><span className="mini-ship-head"><span className={`meeting-check ${selected.includes(v.id)?'on':''}`}>{selected.includes(v.id)?'✓':''}</span><b>{vesselDisplayName(v)}</b>{abnormal&&<i>異常</i>}{urgent>0?<i>急 {urgent}</i>:hi>0&&<i>高 {hi}</i>}</span><span>{v.position.lastPort||v.position.location} → {v.position.nextPort||'未設定'}</span><small>{v.position.navigationStatus==='航行'?`${v.position.speedKnots||0} kn`:v.position.navigationStatus}｜{v.cargo.loadStatus}｜{v.cargo.items.map(item=>item.name).filter(Boolean).join('、')||'未填貨名'}</small></button>})}</div></aside>
      <section className="meeting-column agenda-column"><div className="column-title"><div><h2>逐項討論與決議</h2><span>{showAll ? '顯示全部內容' : `${discussionVessels.length} 艘船`}</span></div><div className="heading-actions morning-supervisor-filter no-print"><VesselFilterControls filters={vesselFilters} shipTypes={shipTypes} supervisors={supervisors} onChange={applyVesselFilters} showPills={false}/><select aria-label="新增待辦船舶" value={newTaskVesselId} onChange={event=>setNewTaskVesselId(event.target.value)}>{discussionVessels.map(vessel=><option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select><button className="btn small primary" disabled={!newTaskVesselId} onClick={()=>newTaskVesselId&&onAddTask(newTaskVesselId)}>＋ 新增待辦</button></div></div><div className="column-scroll"><div className="meeting-vessel-summary"><div><h2>{discussionVessels.length===1 ? vesselDisplayName(discussionVessels[0]) : '全部討論內容'}</h2><p>{discussionVessels.length} 艘船｜{openDiscussionTasks.length} 件未結要事｜今日 {todayDiscussionTasks.length}｜歷史未結 {historicalDiscussionTasks.length}｜急／高關注 {urgentHigh} 件</p></div><span>早會進行中</span></div><div className="agenda-filter-bar no-print"><button className={agendaView==='all'?'active':''} onClick={()=>setAgendaView('all')}>全部討論</button><button className={agendaView==='today'?'active':''} onClick={()=>setAgendaView('today')}>今日討論</button><button className={agendaView==='history'?'active':''} onClick={()=>setAgendaView('history')}>歷史未結</button>{(['急','高','中','低'] as TaskPriority[]).map(priority=><button key={priority} className={priorityFilter===priority?'active':''} onClick={()=>setPriorityFilter(priorityFilter===priority?'all':priority)}>{priority}</button>)}<button className={sortMode!=='priority'?'active':''} onClick={()=>setSortMode(sortMode==='newest'?'oldest':sortMode==='oldest'?'priority':'newest')}>{sortMode==='priority'?'以時間序排列':sortMode==='newest'?'時間新→舊':'時間舊→新'}</button></div>{displayedDiscussionTasks.length ? <>{agendaView!=='history'&&<AgendaSection title="今日早會議題" subtitle="今日新增／報告的未結早會事項" tasks={todayDiscussionTasks}/>} {agendaView!=='today'&&<AgendaSection title="歷史未結早會議題" subtitle={`今日以前報告但尚未結案的早會事項｜第 ${historicalPage.currentPage}／${historicalPage.pageCount} 頁`} tasks={historicalPage.items} offset={(agendaView==='all'?todayDiscussionTasks.length:0)+historicalPage.startIndex} totalCount={historicalPage.totalItems} topControls={historicalDiscussionTasks.length>0?<HistoryPaginationControls position="上方" currentPage={historicalPage.currentPage} pageCount={historicalPage.pageCount} totalItems={historicalPage.totalItems} visibleItems={historicalPage.items.length} onPageChange={setHistoryPage}/>:null} bottomControls={historicalDiscussionTasks.length>0?<HistoryPaginationControls position="下方" currentPage={historicalPage.currentPage} pageCount={historicalPage.pageCount} totalItems={historicalPage.totalItems} visibleItems={historicalPage.items.length} onPageChange={setHistoryPage}/>:null}/>} {agendaView!=='history'&&fallbackDiscussionTasks.length>0&&<AgendaSection title="其他日期議題" subtitle="日期未記錄或晚於今日的未結事項" tasks={fallbackDiscussionTasks} offset={todayDiscussionTasks.length+historicalDiscussionTasks.length}/>}</> : <div className="empty-state">目前沒有符合條件的早會議題</div>}</div></section>
      <aside className="meeting-column summary-column"><div className="column-title"><h2>早會即時摘要</h2></div><div className="column-scroll"><div className="summary-card pink"><h3>昨日未結</h3><b>{yesterdayOpen}</b><span> 件</span><small>急／高關注 {urgentHigh} 件</small></div><div className="summary-card blue"><h3>本次早會</h3><div className="summary-line"><span>討論船舶</span><b>{scopeIds.length}</b></div><div className="summary-line"><span>未結要事</span><b>{openDiscussionTasks.length}</b></div><div className="summary-line"><span>今日議題</span><b>{todayDiscussionTasks.length}</b></div><div className="summary-line"><span>歷史未結</span><b>{historicalDiscussionTasks.length}</b></div><div className="summary-line"><span>急／高關注</span><b>{urgentHigh}</b></div></div><div className="summary-card mint"><h3>討論範圍完成率</h3><b>{completion}%</b><div className="progress"><span style={{width:`${completion}%`}}/></div></div><div className="summary-card"><h3>報告內容</h3>{discussionVessels.map(v=><div className="summary-line" key={v.id}><span>{vesselDisplayName(v)}</span><b>{morningTasks.filter(t=>taskHasVessel(t,v.id)&&!taskIsClosedForVessel(t,v.id)).length} 項</b></div>)}<button className="btn primary full" onClick={openReport}>預覽美觀 PDF</button></div></div></aside>
    </div>}
  </section>;
}

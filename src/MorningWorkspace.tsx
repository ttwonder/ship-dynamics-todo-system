import { useEffect, useState, type ReactNode } from 'react';
import type { AppData, InternalControlCase, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import { nowIso } from './runtimeUtils';
import { taskCategoryLabel } from './taskCategories';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskVesselIds, taskVesselLabel } from './taskVesselScope';
import { morningDiscussionTasks } from './morningTaskScope';
import VesselImportantSummary from './VesselImportantSummary';
import { taskIsClosedForScope, taskIsClosedForVessel, taskProgressForVessel } from './taskVesselProgress';
import RichTextContent from './RichTextContent';
import { deriveVesselAttention } from './vesselAttention';
import { vesselAttentionTasks } from './taskAttention';
import { meetingCreatesVesselAbnormalAlert } from './meetingVesselAttention';
import { userCanManageVesselByAssignmentOrDelegation } from './vesselDelegation';
import VesselFilterControls from './VesselFilterControls';
import { attentionFilterGroup, emptyVesselFilterState, hasActiveVesselFilters, matchingVesselIds, shipTypeFilterOptions, supervisorIdsForVessel, vesselSupervisorOptions } from './vesselDashboardFilters';
import { formatTaipeiDateTime, taipeiDateKey, taipeiDaysDiff } from './taipeiTime';
import { liveMorningWindow, morningBaselineSnapshot, morningWindowIsAccumulatingNextMeeting } from './morningHistory';
import { classifyMorningAgenda } from './morningAgenda';
import { paginateMorningHistory } from './morningHistoryPagination';

type Props = {
  data: AppData;
  user: UserAccount;
  visibleVessels: Vessel[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  onEditTask: (task: TaskItem, vesselId?: string) => void;
  onOpenInternalControl: (caseId: string) => void;
  onAddTask: (vesselId: string) => void;
  onOpenVessel: (id: string) => void;
  onOpenTemporaryMeeting: () => void;
  onOpenReport: () => void;
  canSaveDailyMorning: boolean;
  onSaveDailyMorning: (at:string)=>Promise<boolean>;
};

const priorityOrder = { 急: 0, 高: 1, 中: 2, 低: 3 } as const;
type AgendaViewMode = 'all' | 'today' | 'history';
type AgendaSortMode = 'priority' | 'newest' | 'oldest';
type AgendaEntry =
  | { kind: 'task'; item: TaskItem }
  | { kind: 'internal-control'; item: InternalControlCase };

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
const itemReportTime = (item: Pick<TaskItem, 'createdAt' | 'updatedAt'>) => {
  const raw = item.createdAt || item.updatedAt;
  if (!raw) return '未記錄時間';
  return formatTaipeiDateTime(raw, false, '未記錄時間');
};
const entryPriority = (entry: AgendaEntry) => entry.item.priority;
const entryUpdatedAt = (entry: AgendaEntry) => entry.item.updatedAt || entry.item.createdAt;
const entryVesselIds = (entry: AgendaEntry) => entry.kind === 'task' ? taskVesselIds(entry.item) : [entry.item.vesselId];

export default function MorningWorkspaceView({ data, user, visibleVessels, selected, setSelected, onEditTask, onOpenInternalControl, onAddTask, onOpenVessel, onOpenTemporaryMeeting, onOpenReport, canSaveDailyMorning, onSaveDailyMorning }: Props) {
  const allIds = visibleVessels.map(vessel => vessel.id);
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
  const discussionVessels = visibleVessels.filter(vessel => scopeSet.has(vessel.id));
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

  const morningWindow = liveMorningWindow(data.agendaReports);
  const morningBaseline = morningBaselineSnapshot(data.agendaReports, morningWindow);
  const accumulatingNextMeeting = morningWindowIsAccumulatingNextMeeting(morningWindow);
  const activeAgendaTitle = accumulatingNextMeeting ? '下一場早會議題（累積中）' : '今日早會議題';
  const activeAgendaLabel = accumulatingNextMeeting ? '下一場議題' : '今日議題';
  const classifiedAgenda = classifyMorningAgenda({
    tasks: data.tasks,
    internalControlCases: data.internalControlCases,
    meetings: data.meetings,
    scopeVesselIds: scopeIds,
    window: morningWindow,
    baselineTasks: morningBaseline?.tasks,
    baselineInternalControlCases: morningBaseline?.internalControlCases,
  });
  const firstScopeIndex = (entry: AgendaEntry) => Math.min(...entryVesselIds(entry).map(id => scopeIds.indexOf(id)).filter(index => index >= 0));
  const sortEntries = (items: AgendaEntry[]) => [...items].sort((left, right) => {
    if (sortMode === 'newest') return entryUpdatedAt(right).localeCompare(entryUpdatedAt(left)) || priorityOrder[entryPriority(left)] - priorityOrder[entryPriority(right)];
    if (sortMode === 'oldest') return entryUpdatedAt(left).localeCompare(entryUpdatedAt(right)) || priorityOrder[entryPriority(left)] - priorityOrder[entryPriority(right)];
    const vesselDiff = firstScopeIndex(left) - firstScopeIndex(right);
    const dueLeft = left.kind === 'task' ? taipeiDaysDiff(left.item.expectedDate) ?? 999 : 999;
    const dueRight = right.kind === 'task' ? taipeiDaysDiff(right.item.expectedDate) ?? 999 : 999;
    return vesselDiff || priorityOrder[entryPriority(left)] - priorityOrder[entryPriority(right)] || dueLeft - dueRight;
  });
  const filterPriority = (entry: AgendaEntry) => priorityFilter === 'all' || entryPriority(entry) === priorityFilter;
  const todayEntries = sortEntries([
    ...classifiedAgenda.todayTasks.map(item => ({ kind: 'task' as const, item })),
    ...classifiedAgenda.todayInternalControlCases.map(item => ({ kind: 'internal-control' as const, item })),
  ].filter(filterPriority));
  const historicalEntries = sortEntries([
    ...classifiedAgenda.historyTasks.map(item => ({ kind: 'task' as const, item })),
    ...classifiedAgenda.historyInternalControlCases.map(item => ({ kind: 'internal-control' as const, item })),
  ].filter(filterPriority));
  const historicalPage = paginateMorningHistory(historicalEntries, historyPage);
  useEffect(() => { if (historyPage !== historicalPage.currentPage) setHistoryPage(historicalPage.currentPage); }, [historyPage, historicalPage.currentPage]);
  useEffect(() => { setHistoryPage(1); }, [scopeIds.join('|'), priorityFilter, sortMode]);

  const openDiscussionTasks = [...classifiedAgenda.todayTasks.filter(task => !taskIsClosedForScope(task, scopeIds)), ...classifiedAgenda.historyTasks];
  const openInternalCases = [...classifiedAgenda.todayInternalControlCases.filter(item => !item.isClosed), ...classifiedAgenda.historyInternalControlCases];
  const openDiscussionCount = openDiscussionTasks.length + openInternalCases.length;
  const historyOpenCount = historicalEntries.length;
  const urgentHigh = [...openDiscussionTasks, ...openInternalCases].filter(item => item.priority === '急' || item.priority === '高').length;
  const allScopeTasks = morningTasks.filter(task => !task.isInternalControl && taskVesselIds(task).some(id => scopeSet.has(id)));
  const allScopeCases = data.internalControlCases.filter(item => scopeSet.has(item.vesselId));
  const completed = allScopeTasks.filter(task => taskIsClosedForScope(task, scopeIds)).length + allScopeCases.filter(item => item.isClosed).length;
  const allScopeCount = allScopeTasks.length + allScopeCases.length;
  const completion = allScopeCount ? Math.round(completed / allScopeCount * 100) : 0;
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
  const saveAgenda = async () => {
    if (!canSaveDailyMorning || savingAgenda) return;
    setSavingAgenda(true);
    try { await onSaveDailyMorning(nowIso()); }
    finally { setSavingAgenda(false); }
  };
  const openReport = () => { if (showAll) setSelected(allIds); onOpenReport(); };

  const AgendaTaskCard = ({ task, index }: { task: TaskItem; index: number }) => {
    const taskIds = taskVesselIds(task);
    const displayStatus = scopeIds.length === 1 ? taskProgressForVessel(task, scopeIds[0]).status : task.status;
    const closedInScope = taskIsClosedForScope(task, scopeIds);
    return <article className={`meeting-agenda-card priority-${task.priority}`}>
      <div className="agenda-number">{String(index + 1).padStart(2, '0')}</div>
      <div className="agenda-content">
        <div className="agenda-vessel-label"><b>{taskVesselLabel(task, visibleVessels)}</b>{closedInScope && <span className="period-closed-badge">本期已結</span>}<span className="agenda-report-time">報告日期 {taskReportDate(task) || '未設定'}｜建立 {itemReportTime(task)}</span></div>
        <div className="agenda-task-title">{task.isAbnormal && <span className="inline-abnormal">異常</span>}<RichTextContent compact value={task.description} fallback="尚未輸入要事內容" /></div>
        <p>{task.priority}關注｜{taskCategoryLabel(task)}｜{task.departments.join('、') || '未指定部門'}｜期限 {task.expectedDate || '未設定'}</p>
        <div className="agenda-status"><b>目前狀態：</b><RichTextContent compact value={displayStatus} fallback="尚未更新狀態" /></div>
        <div className="agenda-actions no-print"><button className="btn small primary" onClick={() => onEditTask(task, scopeIds.length === 1 && taskIds.includes(scopeIds[0]) ? scopeIds[0] : '')}>更新狀態／決議</button>{taskIds.length === 1 && <button className="btn small ghost" onClick={() => onOpenVessel(taskIds[0])}>打開船舶</button>}</div>
      </div>
    </article>;
  };

  const AgendaInternalControlCard = ({ item, index }: { item: InternalControlCase; index: number }) => {
    const vessel = visibleVessels.find(candidate => candidate.id === item.vesselId);
    return <article className={`meeting-agenda-card internal-control-agenda-card priority-${item.priority}`}>
      <div className="agenda-number">{String(index + 1).padStart(2, '0')}</div>
      <div className="agenda-content">
        <div className="agenda-vessel-label"><b>{vessel ? vesselDisplayName(vessel) : '未授權船舶'}</b><span className="internal-control-tag">內控</span>{item.isClosed && <span className="period-closed-badge">本期已結</span>}<span className="agenda-report-time">報告日期 {item.reportDate || '未設定'}｜建立 {itemReportTime(item)}</span></div>
        <div className="agenda-task-title"><RichTextContent compact value={item.description} fallback="尚未輸入內控內容" /></div>
        <p>{item.priority}關注｜{item.category || '未分類'}｜{item.departments.join('、') || '未指定部門'}｜來源 {item.reportSource}</p>
        <div className="agenda-status"><b>目前狀態：</b><RichTextContent compact value={item.status} fallback="尚未更新狀態" /></div>
        <div className="agenda-actions no-print"><button className="btn small primary" onClick={() => onOpenInternalControl(item.id)}>更新內控</button><button className="btn small ghost" onClick={() => onOpenVessel(item.vesselId)}>打開船舶</button></div>
      </div>
    </article>;
  };

  const AgendaSection = ({ title, subtitle, entries, offset = 0, totalCount = entries.length, topControls, bottomControls }: { title: string; subtitle: string; entries: AgendaEntry[]; offset?: number; totalCount?: number; topControls?: ReactNode; bottomControls?: ReactNode }) => <section className="agenda-split-section">
    <div className="agenda-split-title"><div><h3>{title}</h3><span>{subtitle}</span></div><b>{totalCount} 件</b></div>
    {topControls}
    {entries.length ? entries.map((entry, index) => entry.kind === 'task'
      ? <AgendaTaskCard task={entry.item} index={offset + index} key={`task-${entry.item.id}`} />
      : <AgendaInternalControlCard item={entry.item} index={offset + index} key={`internal-${entry.item.id}`} />)
      : <div className="empty-state compact">目前沒有符合條件的議題</div>}
    {bottomControls}
  </section>;

  const windowSubtitle = morningWindow.startedAt
    ? `${accumulatingNextMeeting ? '今日首次成功保存後，' : ''}自 ${formatTaipeiDateTime(morningWindow.startedAt, false, '前次切點')} 起至目前的新增、實質修改及結案`
    : '尚無前次人工保存切點；目前未結內容列為本次議題';

  return <section>
    <div className="page-heading"><div><h1>今日早會工作台</h1><p>左側勾選討論範圍；未選或全選時，中間顯示全部內容。</p></div><div className="heading-actions no-print"><button className="btn ghost" onClick={onOpenTemporaryMeeting}>＋ 臨會/專題</button>{canSaveDailyMorning && <button className="btn green" disabled={savingAgenda} onClick={() => void saveAgenda()}>{savingAgenda ? '雲端確認中…' : '保存今日早會'}</button>}<button className="btn primary" onClick={openReport}>預覽 PDF</button></div></div>
    {!visibleVessels.length ? <div className="empty-state"><h3>目前沒有可見船舶</h3></div> : <div className="morning-workspace">
      <aside className="meeting-column vessel-rail">
        <div className="column-title"><div><h2>今日討論船舶</h2><span>{showAll ? `全部 ${visibleVessels.length} 艘` : `已選 ${selected.length} 艘`}</span></div><button className="btn small ghost" aria-label="全選討論船舶" onClick={() => setSelected(allIds)}>全選</button></div>
        <div className="vessel-rail-tools no-print"><VesselFilterControls filters={vesselFilters} shipTypes={shipTypes} supervisors={supervisors} onChange={applyVesselFilters} showSupervisors={false} /><button className="btn small ghost" onClick={() => applyVesselFilters(emptyVesselFilterState())}>清空（顯示全部）</button></div>
        <div className="column-scroll">{visibleVessels.map(vessel => {
          const vesselTasks = morningTasks.filter(task => taskHasVessel(task, vessel.id) && !taskIsClosedForVessel(task, vessel.id));
          const urgent = vesselTasks.filter(task => task.priority === '急').length;
          const high = vesselTasks.filter(task => task.priority === '高').length;
          const abnormal = vesselTasks.some(task => task.isAbnormal);
          return <button key={vessel.id} className={`mini-ship-card ${selected.includes(vessel.id) ? 'active' : ''}`} onClick={() => toggle(vessel.id)}>
            <span className="mini-ship-head"><span className={`meeting-check ${selected.includes(vessel.id) ? 'on' : ''}`}>{selected.includes(vessel.id) ? '✓' : ''}</span><b>{vesselDisplayName(vessel)}</b>{abnormal && <i>異常</i>}{urgent > 0 ? <i>急 {urgent}</i> : high > 0 && <i>高 {high}</i>}</span>
            <span>{vessel.position.lastPort || vessel.position.location} → {vessel.position.nextPort || '未設定'}</span>
            <VesselImportantSummary compact vessel={vessel} tasks={morningTasks} internalControlCases={data.internalControlCases} meetings={data.meetings} canDiscloseMeetingSubjects={user.role !== 'vessel'}/>
          </button>;
        })}</div>
      </aside>
      <section className="meeting-column agenda-column">
        <div className="column-title"><div><h2>逐項討論與決議</h2><span>{showAll ? '顯示全部內容' : `${discussionVessels.length} 艘船`}</span></div><div className="heading-actions morning-supervisor-filter no-print"><VesselFilterControls filters={vesselFilters} shipTypes={shipTypes} supervisors={supervisors} onChange={applyVesselFilters} showPills={false} /><select aria-label="新增待辦船舶" value={newTaskVesselId} onChange={event => setNewTaskVesselId(event.target.value)}>{discussionVessels.map(vessel => <option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select><button className="btn small primary" disabled={!newTaskVesselId} onClick={() => newTaskVesselId && onAddTask(newTaskVesselId)}>＋ 新增待辦</button></div></div>
        <div className="column-scroll">
          <div className="meeting-vessel-summary"><div><h2>{discussionVessels.length === 1 ? vesselDisplayName(discussionVessels[0]) : '全部討論內容'}</h2><p>{discussionVessels.length} 艘船｜{openDiscussionCount} 件未結議題｜{activeAgendaLabel} {todayEntries.length}｜歷史未結 {historyOpenCount}｜急／高關注 {urgentHigh} 件</p></div><span>{accumulatingNextMeeting ? '下一場累積中' : '早會進行中'}</span></div>
          <div className="agenda-filter-bar no-print"><button className={agendaView === 'all' ? 'active' : ''} onClick={() => setAgendaView('all')}>全部討論</button><button className={agendaView === 'today' ? 'active' : ''} onClick={() => setAgendaView('today')}>{accumulatingNextMeeting ? '下一場累積' : '今日討論'}</button><button className={agendaView === 'history' ? 'active' : ''} onClick={() => setAgendaView('history')}>歷史未結</button>{(['急', '高', '中', '低'] as TaskPriority[]).map(priority => <button key={priority} className={priorityFilter === priority ? 'active' : ''} onClick={() => setPriorityFilter(priorityFilter === priority ? 'all' : priority)}>{priority}</button>)}<button className={sortMode !== 'priority' ? 'active' : ''} onClick={() => setSortMode(sortMode === 'newest' ? 'oldest' : sortMode === 'oldest' ? 'priority' : 'newest')}>{sortMode === 'priority' ? '以時間序排列' : sortMode === 'newest' ? '時間新→舊' : '時間舊→新'}</button></div>
          {agendaView !== 'history' && <AgendaSection title={activeAgendaTitle} subtitle={windowSubtitle} entries={todayEntries} />}
          {agendaView !== 'today' && <AgendaSection title="歷史未結早會議題" subtitle="前次切點前已存在且目前仍未結案" entries={historicalPage.items} offset={historicalPage.startIndex} totalCount={historicalPage.totalItems} topControls={historicalPage.totalItems > 0 ? <HistoryPaginationControls position="上方" currentPage={historicalPage.currentPage} pageCount={historicalPage.pageCount} totalItems={historicalPage.totalItems} visibleItems={historicalPage.items.length} onPageChange={setHistoryPage} /> : undefined} bottomControls={historicalPage.totalItems > 0 ? <HistoryPaginationControls position="下方" currentPage={historicalPage.currentPage} pageCount={historicalPage.pageCount} totalItems={historicalPage.totalItems} visibleItems={historicalPage.items.length} onPageChange={setHistoryPage} /> : undefined} />}
        </div>
      </section>
      <aside className="meeting-column summary-column"><div className="column-title"><h2>早會即時摘要</h2></div><div className="column-scroll"><div className="summary-card pink"><h3>歷史未結</h3><b>{historyOpenCount}</b><span> 件</span><small>急／高關注 {urgentHigh} 件</small></div><div className="summary-card blue"><h3>{accumulatingNextMeeting ? '下一場早會' : '本次早會'}</h3><div className="summary-line"><span>討論船舶</span><b>{scopeIds.length}</b></div><div className="summary-line"><span>未結議題</span><b>{openDiscussionCount}</b></div><div className="summary-line"><span>{activeAgendaLabel}</span><b>{todayEntries.length}</b></div><div className="summary-line"><span>歷史未結</span><b>{historyOpenCount}</b></div><div className="summary-line"><span>急／高關注</span><b>{urgentHigh}</b></div></div><div className="summary-card mint"><h3>討論範圍完成率</h3><b>{completion}%</b><div className="progress"><span style={{ width: `${completion}%` }} /></div></div><div className="summary-card"><h3>報告內容</h3>{discussionVessels.map(vessel => <div className="summary-line" key={vessel.id}><span>{vesselDisplayName(vessel)}</span><b>{openDiscussionTasks.filter(task => taskHasVessel(task, vessel.id)).length + openInternalCases.filter(item => item.vesselId === vessel.id).length} 項</b></div>)}<button className="btn primary full" onClick={openReport}>預覽美觀 PDF</button></div></div></aside>
    </div>}
  </section>;
}

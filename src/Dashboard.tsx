import { lazy, Suspense, useEffect, useState } from 'react';
import type { InternalControlCase, ScheduleKind, TaskItem, UserAccount, Vessel, VesselAttentionLevel, WeeklyAttentionKey } from './types';
import { daysDiff, todayDate } from './runtimeUtils';
import { taipeiDateKey } from './taipeiTime';
import { dashboardVesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskVesselIds } from './taskVesselScope';
import { deriveVesselAttention, manualVesselAttentionAllowed, VESSEL_ATTENTION_LEVELS, vesselAttentionClass, vesselAttentionPriorityCount } from './vesselAttention';
import QuickMorningPicker from './QuickMorningPicker';
import { vesselAttentionTasks } from './taskAttention';
import { taskIsClosedForScope, taskIsClosedForVessel } from './taskVesselProgress';
import { automaticScheduleKind, formatCompleteScheduleDisplay, nextScheduleKind } from './scheduleTime';
import { userCanManageVesselByAssignmentOrDelegation } from './vesselDelegation';
import { meetingCreatesVesselAbnormalAlert, type DashboardMeetingAlert } from './meetingVesselAttention';
import VesselFilterControls from './VesselFilterControls';
import VesselImportantSummary from './VesselImportantSummary';
import { attentionFilterGroup, effectiveVesselManagerNames, emptyVesselFilterState, matchesVesselFilterGroups, shipTypeFilterOptions, supervisorIdsForVessel, vesselSupervisorOptions } from './vesselDashboardFilters';
import { WEEKLY_ATTENTION_OPTIONS } from './weeklyAttention';
import type { VesselAttentionSaveState } from './vesselAttentionSaveQueue';
import { dashboardVesselCardId } from './dashboardVesselReturn';
import type { ItineraryMainActor } from './itinerary/itineraryCloud';

import { itineraryOperationalSourceLabel, type ItineraryOperationalFeedRecord } from './itinerary/itineraryOperationalProjection';
import type { ItineraryOperationalFeed } from './itinerary/useItineraryOperationalProjection';

const ItineraryDashboard = lazy(() => import('./itinerary/ItineraryDashboard'));

const attentionLevelLabel = (level: VesselAttentionLevel) => level === '特別關注' ? level : `${level}關注`;
const automaticAttentionLevelLabel = (level: VesselAttentionLevel, hasPscWindow: boolean) =>
  `${attentionLevelLabel(level)}${level === '高' && hasPscWindow ? '-PSC' : ''}`;

interface DashboardProps {
  user: UserAccount;
  itineraryActor: ItineraryMainActor;
  itineraryOperationalFeed?: ItineraryOperationalFeed;
  users: UserAccount[];
  vessels: Vessel[];
  tasks: TaskItem[];
  calendarTasks: TaskItem[];
  internalControlCases: InternalControlCase[];
  meetings: DashboardMeetingAlert[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  batchSelected: string[];
  setBatchSelected: (ids: string[]) => void;
  onOpenVessel: (id: string) => void;
  onEdit: (id: string) => void;
  onAddTask: (id: string) => void;
  onToggleAttention: (vesselId: string, key: WeeklyAttentionKey) => void;
  attentionSaveStates?: Record<string, VesselAttentionSaveState>;
  onRetryAttentionSave?: (vesselId: string) => void;
  onAdjustAttention: (vesselId: string, manualAttentionLevel: VesselAttentionLevel | '') => void;
  onStartMeeting: (requestedIds?: string[]) => void;
  onOpenReport: () => void;
  onTaskMetric: (mode: 'open' | 'high' | 'overdue') => void;
  onOpenBatchManagedVessels: () => void;
  canEdit: boolean;
  canCreateTasks: boolean;
  canUseMeetings: boolean;
  canUseReports: boolean;
}

export default function Dashboard({ user, itineraryActor, itineraryOperationalFeed, users, vessels, tasks, calendarTasks, internalControlCases, meetings, selected, setSelected, batchSelected, setBatchSelected, onOpenVessel, onEdit, onAddTask, onToggleAttention, attentionSaveStates = {}, onRetryAttentionSave = () => undefined, onAdjustAttention, onStartMeeting, onOpenReport, onTaskMetric, onOpenBatchManagedVessels, canEdit, canCreateTasks, canUseMeetings, canUseReports }: DashboardProps) {
  const [vesselFilters, setVesselFilters] = useState(emptyVesselFilterState);
  const [keyword, setKeyword] = useState('');
  const [scheduleByVessel, setScheduleByVessel] = useState<Record<string, ScheduleKind>>({});
  const [scheduleNow, setScheduleNow] = useState(() => new Date());
  const [dashboardMode, setDashboardMode] = useState<'cards' | 'itinerary'>('cards');
  const [itinerarySelected, setItinerarySelected] = useState<string[]>([]);
  const scheduleField = { ETA: 'eta', ETB: 'etb', ETD: 'etd' } as const;

  useEffect(() => {
    const timer = window.setInterval(() => setScheduleNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);


  useEffect(() => {
    const allowed = new Set(vessels.map(vessel => vessel.id));
    setItinerarySelected(previous => previous.filter(id => allowed.has(id)));
  }, [vessels]);

  const abnormalMeetingsForVessel = (vesselId: string) => meetings.filter(meeting => meetingCreatesVesselAbnormalAlert(meeting, vesselId));

  const filterFactsByVessel = new Map(vessels.map(vessel => {
    const vesselTasks = tasks.filter(task => taskHasVessel(task, vessel.id) && !taskIsClosedForVessel(task, vessel.id));
    const attention = deriveVesselAttention(vessel, vesselAttentionTasks(vesselTasks), abnormalMeetingsForVessel(vessel.id).length > 0, internalControlCases).effective;
    return [vessel.id, {
      id: vessel.id,
      selfManaged: userCanManageVesselByAssignmentOrDelegation(vessel, user),
      shipType: vessel.shipType.trim(),
      attentionGroup: attentionFilterGroup(attention),
      selectedForMeeting: selected.includes(vessel.id),
      supervisorIds: supervisorIdsForVessel(vessel, users),
    }] as const;
  }));
  const shipTypes = shipTypeFilterOptions(vessels);
  const supervisors = vesselSupervisorOptions(vessels, users);

  const visible = vessels.filter(vessel => {
    const filterFacts = filterFactsByVessel.get(vessel.id);
    if (!filterFacts || !matchesVesselFilterGroups(filterFacts, vesselFilters)) return false;
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

  const visibleVesselIds = new Set(vessels.map(vessel => vessel.id));
  const openTasks = tasks.filter(task => taskVesselIds(task).some(id => visibleVesselIds.has(id)) && !taskIsClosedForScope(task,[...visibleVesselIds]));
  const urgentHighCount = openTasks.filter(task => task.priority === '急' || task.priority === '高').length;
  const overdueCount = openTasks.filter(task => (daysDiff(task.expectedDate) ?? 0) < 0).length;
  const updatedToday = vessels.filter(vessel => {
    const sourceUpdatedAt=itineraryOperationalFeed?.records[vessel.id]?.document?.updatedAt||vessel.updatedAt||vessel.position.updatedAt;
    return taipeiDateKey(sourceUpdatedAt) === todayDate();
  }).length;
  const toggleMeeting = (id: string) => setSelected(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
  const cycleSchedule = (vesselId: string, automaticKind: ScheduleKind) => setScheduleByVessel(previous => {
    const current = previous[vesselId] ?? automaticKind;
    return { ...previous, [vesselId]: nextScheduleKind(current) };
  });

  return <section className="dashboard-view">
    <div className="page-heading">
      <div><h1>船舶看板</h1><p>集中查看上下港、位置、載況、時間、貨物、未來一週關注與重要要事。</p></div>
      <div className="heading-actions no-print"><button type="button" className="btn itinerary-view-toggle" aria-pressed={dashboardMode==='itinerary'} onClick={()=>setDashboardMode(mode=>mode==='cards'?'itinerary':'cards')}>{dashboardMode==='itinerary'?'返回船舶卡片':'切換顯示Itinerary信息'}</button>{canEdit&&<button className="btn green" onClick={onOpenBatchManagedVessels}>批量更新船舶（已選 {batchSelected.length}）</button>}{canUseMeetings&&<QuickMorningPicker vessels={vessels} selectedIds={selected} onChange={setSelected} onEnter={onStartMeeting}/>} {canUseMeetings&&<button className="btn pink" onClick={() => onStartMeeting()}>開始今日早會</button>}{canUseReports&&<button className="btn primary" onClick={onOpenReport}>建立 PDF 報告</button>}</div>
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
      <input className="dashboard-search" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜尋船名、港口、貨物、動態..." />
      <VesselFilterControls filters={vesselFilters} shipTypes={shipTypes} supervisors={supervisors} onChange={setVesselFilters} showMeeting={canUseMeetings}/>
    </div>
    {dashboardMode==='itinerary'?<Suspense fallback={<div className="itinerary-empty">正在載入 Itinerary 視圖…</div>}><ItineraryDashboard user={user} actor={itineraryActor} operationalFeed={itineraryOperationalFeed} vessels={visible} calendarTaskVessels={vessels} calendarTasks={calendarTasks} selectedVesselIds={itinerarySelected} setSelectedVesselIds={setItinerarySelected}/></Suspense>:<div className="fleet-card-grid">{visible.map(vessel => {
      const vesselTasks = tasks.filter(task => taskHasVessel(task, vessel.id) && !taskIsClosedForVessel(task,vessel.id));
      const attentionTasks = vesselAttentionTasks(vesselTasks);
      const abnormalMeetings = abnormalMeetingsForVessel(vessel.id);
      const attentionResult = deriveVesselAttention(vessel, attentionTasks, abnormalMeetings.length > 0, internalControlCases);
      const urgent = vesselAttentionPriorityCount(attentionResult, attentionTasks, '急');
      const high = vesselAttentionPriorityCount(attentionResult, attentionTasks, '高');
      const mid = vesselAttentionPriorityCount(attentionResult, attentionTasks, '中');
      const low = vesselAttentionPriorityCount(attentionResult, attentionTasks, '低');
      const abnormal = attentionResult.hasAbnormal;
      const attention = attentionResult.effective;
      const level = vesselAttentionClass(attention);
      const automaticKind = automaticScheduleKind(vessel.position, scheduleNow);
      const scheduleKind = scheduleByVessel[vessel.id] ?? automaticKind;
      const scheduleValue = formatCompleteScheduleDisplay(vessel.position[scheduleField[scheduleKind]])||'TBA';
      const selectedManualAttention = manualVesselAttentionAllowed(attentionResult.manual, attentionResult.automatic) ? attentionResult.manual : '';
      const selectedForMeeting = selected.includes(vessel.id);
      const attentionSaveState = attentionSaveStates[vessel.id];
      const managerNames = effectiveVesselManagerNames(vessel, users);
      const itineraryFeedRecord=itineraryOperationalFeed?.records[vessel.id];
      const statusSupplement = [
        vessel.note.statusList.map(status => status === 'drydock/repiar' ? 'drydock/repair' : status).join('、'),
        vessel.note.statusSupplement.trim(),
      ].filter(Boolean).join('｜') || '未設定';
      return <article key={vessel.id} id={dashboardVesselCardId(vessel.id)} data-dashboard-vessel-id={vessel.id} className={`ship-card ${selectedForMeeting ? 'selected' : ''} level-${level}`}>
        <div className="ship-card-head">
          <div className="ship-identity"><button type="button" className="ship-name-link" onClick={() => onOpenVessel(vessel.id)} aria-label={`查看 ${dashboardVesselDisplayName(vessel)} 單船詳情`}>{dashboardVesselDisplayName(vessel)}</button></div>
          <div className="ship-head-badges">{abnormal && <span className="abnormal-badge"><i />異常存在</span>}{itineraryOperationalFeed&&<span className={`itinerary-source-badge ${itineraryFeedRecord?.status||'loading'}`} title="上一港、下一港、ETA／ETB／ETD 與貨名貨量的資料來源">{itineraryOperationalSourceLabel(itineraryFeedRecord)}</span>}<select disabled={!canEdit} className={`priority-pill attention-adjust attention-adjust-select ${level}`} aria-label={`${dashboardVesselDisplayName(vessel)} 關注程度`} title={canEdit?'直接選擇自動或不低於目前自動下限的手動關注度':'目前關注度'} value={selectedManualAttention} onChange={event=>onAdjustAttention(vessel.id,event.target.value as VesselAttentionLevel|'')}><option className={`attention-option ${vesselAttentionClass(attentionResult.automatic)}`} value="">自動：{automaticAttentionLevelLabel(attentionResult.automatic, attentionResult.hasPscWindow)}</option>{VESSEL_ATTENTION_LEVELS.map(option=><option className={`attention-option ${vesselAttentionClass(option)}`} key={option} value={option} disabled={!manualVesselAttentionAllowed(option,attentionResult.automatic)}>手動：{attentionLevelLabel(option)}</option>)}</select></div>
          <div className="ship-type-supervisor"><span>{vessel.shipType || '-'}</span><i aria-hidden="true">｜</i><span className="ship-manager-label">分管：</span><span className="ship-manager-names">{managerNames.length ? managerNames.map((name,index)=><span className="ship-manager-name" key={`${name}-${index}`}>{index>0&&<>、<wbr/></>}{name}</span>) : '-'}</span></div>
        </div>
        <div className="ship-operation-grid">
          <div className="ship-route"><b>{vessel.position.lastPort || '未設定'}</b><span>→</span><b>{vessel.position.nextPort || '未設定'}</b></div>
          <div className="ship-position"><small>位置</small><b>{vessel.position.location || '未設定'}</b></div>
          <div className="ship-navigation"><small className="ship-data-label">航行狀態</small><b className="ship-data-value">{vessel.position.navigationStatus}</b></div>
          <button type="button" className="ship-schedule" onClick={() => cycleSchedule(vessel.id, automaticKind)} title="點擊循環顯示 ETA／ETB／ETD"><b className="ship-data-label">{scheduleKind}</b><span className="ship-data-value">{scheduleValue}</span></button>
          <div className="ship-status"><small className="ship-data-label">狀態補充</small><b className="ship-data-value">{statusSupplement}</b></div>
          <div className="ship-load"><small>載況</small><b>{vessel.cargo.loadStatus}</b></div>
          <div className="ship-cargo"><small className="ship-data-label">貨名貨量：</small><div className="ship-cargo-items ship-data-value">{vessel.cargo.items.length ? vessel.cargo.items.map((item, index) => <span key={`${item.name}-${index}`}><span className="ship-cargo-name">{item.name || '未填貨名'}</span>{item.quantity && <em>{item.quantity}</em>}</span>) : <span>TBA</span>}</div></div>
        </div>
        <div className="weekly-attention no-print" aria-label="未來一週關注事項">{WEEKLY_ATTENTION_OPTIONS.map(option => {
          const active = vessel.weeklyAttention.includes(option.key);
          return <button type="button" key={option.key} disabled={!canEdit} className={`${active ? 'active' : ''} ${option.key === 'psc-window' ? 'psc' : ''}`} aria-pressed={active} onClick={() => onToggleAttention(vessel.id, option.key)}><i />{option.label}</button>;
        })}{attentionSaveState&&<div className={`weekly-attention-sync ${attentionSaveState.phase}`} role="status" title={attentionSaveState.message||''}>{attentionSaveState.phase==='error'?<button type="button" disabled={!canEdit} onClick={()=>onRetryAttentionSave(vessel.id)}>同步失敗，重試</button>:<span>{attentionSaveState.phase==='saving'?'同步中…':'待同步'}</span>}</div>}</div>
        <VesselImportantSummary vessel={vessel} tasks={tasks} internalControlCases={internalControlCases} meetings={meetings} canDiscloseMeetingSubjects={canUseMeetings}/>
        <div className="ship-card-foot"><span className="task-mini"><i className="urgent">急 {urgent}</i><i className="high">高 {high}</i><i className="mid">中 {mid}</i><i className="low">低 {low}</i></span><div className="card-buttons no-print">{canEdit&&<button type="button" className={`btn small ${batchSelected.includes(vessel.id)?'green':'ghost'}`} aria-pressed={batchSelected.includes(vessel.id)} onClick={()=>setBatchSelected(batchSelected.includes(vessel.id)?batchSelected.filter(id=>id!==vessel.id):[...batchSelected,vessel.id])}>{batchSelected.includes(vessel.id)?'取消批量選取':'批量選取'}</button>}{canEdit && <button className="btn small" onClick={() => onEdit(vessel.id)}>快速更新</button>}{canCreateTasks && <button className="btn small ghost" onClick={() => onAddTask(vessel.id)}>新增要事</button>}{canUseMeetings&&<button className={`btn small ${selectedForMeeting ? 'pink' : 'ghost'}`} onClick={() => toggleMeeting(vessel.id)}>{selectedForMeeting ? '已選入會議' : '選入會議'}</button>}</div></div>
      </article>;
    })}</div>}
    {dashboardMode==='cards'&&!visible.length && <div className="empty-state">沒有符合條件的船舶</div>}
  </section>;
}

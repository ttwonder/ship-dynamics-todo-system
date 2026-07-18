import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppData,
  MeetingTaskItem,
  MeetingVesselScopeMode,
  TaskPriority,
  TemporaryMeeting,
  TemporaryMeetingStatus,
  UserAccount,
  Vessel,
} from './types';
import { nowIso, roleLabel, todayDate, uid } from './utils';
import { hasPermission } from './permissions';
import { buildTaskNotifications } from './taskWorkflow';
import { reconcileMeetingTasks, meetingTaskItems, meetingTaskNotificationEvents, unchangedMeetingTaskItemIds } from './meetingTaskWorkflow';
import { canEditTemporaryMeetings, meetingAppliesToUser } from './meetingAccess';
import { vesselDisplayName } from './vesselDisplay';

type Props = {
  data: AppData;
  visibleVessels: Vessel[];
  currentUser: UserAccount;
  commit: (mutate: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => void;
};

type MeetingDraft = Pick<
  TemporaryMeeting,
  'subject' | 'meetingDate' | 'vessels' | 'reason' | 'departments' | 'resolution' | 'taskItems' | 'expectedDate' | 'priority'
> & {
  status: TemporaryMeetingStatus;
  vesselScopeMode: MeetingVesselScopeMode;
  vesselTypeScopes: string[];
};

type ScopeFilter = 'any' | MeetingVesselScopeMode;

const statuses: TemporaryMeetingStatus[] = ['待開會', '進行中', '追蹤中', '已完成'];
const statusOf = (meeting: TemporaryMeeting): TemporaryMeetingStatus => meeting.status || '追蹤中';
const scopeModeOf = (meeting: TemporaryMeeting): MeetingVesselScopeMode => meeting.vesselScopeMode || 'vessels';
const scopeModeLabel = (mode: MeetingVesselScopeMode) => mode === 'all' ? '全部船舶' : mode === 'types' ? '按船舶類型' : '逐船選擇';
const meetingScopeLabel = (meeting: TemporaryMeeting) => {
  const mode = scopeModeOf(meeting);
  if (mode === 'all') return '全部船舶';
  if (mode === 'types') return `船型：${(meeting.vesselTypeScopes || []).join('、') || '未指定'}`;
  return meeting.vessels.length ? `逐船：${meeting.vessels.length} 艘` : '未指定船舶';
};

const blankDraft = (): MeetingDraft => ({
  subject: '',
  status: '待開會',
  meetingDate: todayDate(),
  vesselScopeMode: 'vessels',
  vesselTypeScopes: [],
  vessels: [],
  reason: '',
  departments: [],
  resolution: '',
  taskItems: [{ id: uid('meeting-task-item'), description: '' }],
  expectedDate: todayDate(),
  priority: '中',
});

const draftFrom = (meeting?: TemporaryMeeting, tasks = [] as AppData['tasks']): MeetingDraft => meeting ? {
  subject: meeting.subject,
  status: statusOf(meeting),
  meetingDate: meeting.meetingDate,
  vesselScopeMode: scopeModeOf(meeting),
  vesselTypeScopes: [...(meeting.vesselTypeScopes || [])],
  vessels: [...meeting.vessels],
  reason: meeting.reason,
  departments: [...meeting.departments],
  resolution: meeting.resolution,
  taskItems: meetingTaskItems(meeting, tasks).length ? meetingTaskItems(meeting, tasks) : [{ id: uid('meeting-task-item'), description: '' }],
  expectedDate: meeting.expectedDate,
  priority: meeting.priority,
} : blankDraft();

export default function TemporaryMeetingsPage({ data, visibleVessels, currentUser, commit }: Props) {
  const canViewAllMeetings = hasPermission(data.settings.rolePermissions, currentUser, 'viewAllVessels');
  const editable = canEditTemporaryMeetings(data.settings.rolePermissions, currentUser);
  const visibleIds = new Set(visibleVessels.map(vessel => vessel.id));
  const appliesToUser = (meeting: TemporaryMeeting) => meetingAppliesToUser(meeting, visibleVessels, canViewAllMeetings);
  const accessibleMeetings = data.meetings.filter(appliesToUser);
  const initialMeeting = accessibleMeetings[0];
  const [selectedId, setSelectedId] = useState(initialMeeting?.id || '');
  const [creating, setCreating] = useState(editable && !initialMeeting);
  const [draft, setDraft] = useState<MeetingDraft>(() => draftFrom(initialMeeting, data.tasks));
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部' | TemporaryMeetingStatus>('全部');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('any');
  const [typeFilter, setTypeFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'workspace' | 'register'>('workspace');
  const [meetingExportSelection, setMeetingExportSelection] = useState<string[]>([]);
  const [printMode, setPrintMode] = useState<'meetings' | 'register' | ''>('');
  const [notice, setNotice] = useState('');
  const savingRef = useRef(false);
  const printInFlightRef = useRef(false);

  const selected = accessibleMeetings.find(meeting => meeting.id === selectedId);
  const linkedTasks = selected ? data.tasks.filter(task => task.sourceMeetingId === selectedId && visibleIds.has(task.vesselId)) : [];
  const users = useMemo(() => Object.fromEntries(data.users.map(user => [user.id, user])), [data.users]);
  const vesselById = useMemo(() => Object.fromEntries(visibleVessels.map(vessel => [vessel.id, vessel])), [visibleVessels]);
  const shipTypes = useMemo(
    () => Array.from(new Set(visibleVessels.map(vessel => vessel.shipType.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-TW')),
    [visibleVessels],
  );

  const meetingVesselTypes = (meeting: TemporaryMeeting) => {
    if (scopeModeOf(meeting) === 'all') return shipTypes;
    if (scopeModeOf(meeting) === 'types') return meeting.vesselTypeScopes || [];
    return Array.from(new Set(meeting.vessels.map(id => vesselById[id]?.shipType).filter((value): value is string => Boolean(value))));
  };

  const filtered = accessibleMeetings.filter(meeting => {
    const q = query.trim().toLowerCase();
    if (statusFilter !== '全部' && statusOf(meeting) !== statusFilter) return false;
    if (scopeFilter !== 'any' && scopeModeOf(meeting) !== scopeFilter) return false;
    if (typeFilter !== 'all') {
      if (scopeModeOf(meeting)==='all') return !q || `${meeting.subject} ${meeting.reason} ${meeting.resolution} ${meetingTaskItems(meeting, data.tasks).map(item => item.description).join(' ')} ${meeting.meetingDate} ${meetingScopeLabel(meeting)}`.toLowerCase().includes(q);
      if (!meetingVesselTypes(meeting).includes(typeFilter)) return false;
    }
    return !q || `${meeting.subject} ${meeting.reason} ${meeting.resolution} ${meetingTaskItems(meeting, data.tasks).map(item => item.description).join(' ')} ${meeting.meetingDate} ${meetingScopeLabel(meeting)}`.toLowerCase().includes(q);
  });

  const resolvedVesselIds = useMemo(() => {
    if (draft.vesselScopeMode === 'all') return visibleVessels.map(vessel => vessel.id);
    if (draft.vesselScopeMode === 'types') return visibleVessels.filter(vessel => draft.vesselTypeScopes.includes(vessel.shipType)).map(vessel => vessel.id);
    return draft.vessels.filter(id => visibleVessels.some(vessel => vessel.id === id));
  }, [draft.vesselScopeMode, draft.vesselTypeScopes, draft.vessels, visibleVessels]);

  const cleanTaskItems = (items: MeetingTaskItem[]) => {
    const seen = new Set<string>();
    return items.map((item, index) => {
      const rawId = item.id || `meeting-task-item-${index + 1}`;
      const id = seen.has(rawId) ? `${rawId}-duplicate-${index + 1}` : rawId;
      seen.add(id);
      return { id, description: item.description.trim() };
    }).filter(item => item.description);
  };

  useEffect(() => {
    if (creating && !editable) {
      const next = accessibleMeetings[0];
      setCreating(false);
      setSelectedId(next?.id || '');
      setDraft(draftFrom(next, data.tasks));
      return;
    }
    if (creating) return;
    const meeting = accessibleMeetings.find(item => item.id === selectedId);
    if (meeting) {
      setDraft(draftFrom(meeting, data.tasks));
      return;
    }
    const next = accessibleMeetings[0];
    setSelectedId(next?.id || '');
    setDraft(draftFrom(next, data.tasks));
  }, [selectedId, data.revision, creating, canViewAllMeetings, visibleVessels, currentUser.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!printMode) return;
    printInFlightRef.current = true;
    document.body.classList.add('printing-meetings');
    let cleaned = false;
    let frame = 0;
    let fallback = 0;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('printing-meetings');
      window.removeEventListener('afterprint', cleanup);
      if (frame) window.cancelAnimationFrame(frame);
      if (fallback) window.clearTimeout(fallback);
      printInFlightRef.current = false;
      setPrintMode('');
    };
    window.addEventListener('afterprint', cleanup);
    frame = window.requestAnimationFrame(() => {
      try {
        window.print();
        fallback = window.setTimeout(cleanup, 60000);
      } catch {
        cleanup();
      }
    });
    return cleanup;
  }, [printMode]);

  const selectMeeting = (meeting: TemporaryMeeting) => {
    setCreating(false);
    setSelectedId(meeting.id);
    setDraft(draftFrom(meeting, data.tasks));
    setViewMode('workspace');
  };
  const startNew = () => {
    if (!editable) return alert('修改臨會/專題需同時具備「新增及修改臨會/專題」與「查看全部船舶」權限');
    setCreating(true);
    setSelectedId('');
    setDraft(blankDraft());
    setViewMode('workspace');
  };
  const toggleVessel = (id: string) => setDraft(previous => ({
    ...previous,
    vessels: previous.vessels.includes(id) ? previous.vessels.filter(value => value !== id) : [...previous.vessels, id],
  }));
  const toggleVesselType = (shipType: string) => setDraft(previous => ({
    ...previous,
    vesselTypeScopes: previous.vesselTypeScopes.includes(shipType)
      ? previous.vesselTypeScopes.filter(value => value !== shipType)
      : [...previous.vesselTypeScopes, shipType],
  }));
  const toggleDepartment = (name: string) => setDraft(previous => ({
    ...previous,
    departments: previous.departments.includes(name)
      ? previous.departments.filter(value => value !== name)
      : [...previous.departments, name],
  }));
  const addTaskItem = () => setDraft(previous => ({ ...previous, taskItems: [...previous.taskItems, { id: uid('meeting-task-item'), description: '' }] }));
  const updateTaskItem = (id: string, description: string) => setDraft(previous => ({ ...previous, taskItems: previous.taskItems.map(item => item.id === id ? { ...item, description } : item) }));
  const removeTaskItem = (id: string) => setDraft(previous => ({
    ...previous,
    taskItems: previous.taskItems.length > 1
      ? previous.taskItems.filter(item => item.id !== id)
      : previous.taskItems.map(item => item.id === id ? { ...item, description: '' } : item),
  }));

  const save = () => {
    if (!editable) return alert('您無權修改臨會/專題');
    if (!creating && !selected) return alert('會議已不在目前可見範圍，請重新選擇');
    if (savingRef.current) return;
    if (!draft.subject.trim()) return alert('請填寫會議主題');
    if (!draft.reason.trim()) return alert('請填寫召開緣由');
    if (draft.vesselScopeMode === 'types' && !draft.vesselTypeScopes.length) return alert('請至少選擇一個船舶類型');
    if (!resolvedVesselIds.length) return alert('請至少選擇一艘船舶');
    savingRef.current = true;
    const id = creating ? uid('meet') : selectedId;
    const at = nowIso();
    const savedDraft: MeetingDraft = {
      ...draft,
      vesselTypeScopes: draft.vesselScopeMode === 'types' ? [...draft.vesselTypeScopes] : [],
      vessels: [...resolvedVesselIds],
      taskItems: cleanTaskItems(draft.taskItems),
    };
    const taskDescription = savedDraft.taskItems[0]?.description || '';
    const preserveExistingDescriptionItemIds = unchangedMeetingTaskItemIds(selected, data.tasks, savedDraft.taskItems);
    commit(draftData => {
      let meeting = draftData.meetings.find(item => item.id === id);
      if (!meeting) {
        meeting = { id, ...savedDraft, taskDescription, createdBy: currentUser.id, createdAt: at, updatedAt: at };
        draftData.meetings.unshift(meeting);
      } else {
        Object.assign(meeting, { ...savedDraft, taskDescription, updatedAt: at });
      }
      const reconciliation = reconcileMeetingTasks({
        tasks: draftData.tasks,
        meetingId: id,
        vesselIds: savedDraft.vessels,
        followUps: savedDraft.taskItems,
        priority: savedDraft.priority,
        expectedDate: savedDraft.expectedDate,
        departments: savedDraft.departments,
        initialStatus: savedDraft.resolution,
        actorId: currentUser.id,
        actorName: currentUser.name,
        at,
        preserveExistingDescriptionItemIds,
      });
      meetingTaskNotificationEvents(draftData.tasks, reconciliation).forEach(({ task, kind }) => {
        const vessel = draftData.vessels.find(item => item.id === task.vesselId);
        if (vessel) draftData.notifications.unshift(...buildTaskNotifications(draftData.users, vessel, currentUser.id, task, kind, currentUser.name));
      });
      draftData.notifications = draftData.notifications.slice(0, 1000);
    }, creating ? '新增臨會/專題' : '更新臨會/專題', 'meeting', id, `${draft.subject.trim()}｜${scopeModeLabel(draft.vesselScopeMode)}`);
    setDraft({ ...savedDraft, taskItems: savedDraft.taskItems.length ? savedDraft.taskItems : [{ id: uid('meeting-task-item'), description: '' }] });
    setCreating(false);
    setSelectedId(id);
    setNotice(`✓ ${creating ? '臨會/專題已建立' : '臨會/專題已保存'}`);
    window.setTimeout(()=>{ savingRef.current=false; },0);
  };

  const counts = Object.fromEntries(statuses.map(status => [status, accessibleMeetings.filter(meeting => statusOf(meeting) === status).length])) as Record<TemporaryMeetingStatus, number>;
  const meetingVesselIds = (meeting: TemporaryMeeting) => {
    const saved = meeting.vessels.filter(id => visibleIds.has(id));
    if (saved.length) return saved;
    if (scopeModeOf(meeting) === 'all') return visibleVessels.map(vessel => vessel.id);
    if (scopeModeOf(meeting) === 'types') return visibleVessels.filter(vessel => (meeting.vesselTypeScopes || []).includes(vessel.shipType)).map(vessel => vessel.id);
    return saved;
  };
  const meetingTaskCount = (meetingId: string) => data.tasks.filter(task => task.sourceMeetingId === meetingId && visibleIds.has(task.vesselId)).length;
  const selectedExportMeetings = accessibleMeetings.filter(meeting => meetingExportSelection.includes(meeting.id));
  const toggleMeetingExport = (id: string) => setMeetingExportSelection(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  const printMeetings = (mode: 'meetings' | 'register') => {
    if (printInFlightRef.current || printMode) return alert('正在準備列印，請稍候');
    if (mode === 'meetings' && !selectedExportMeetings.length) return alert('請先勾選至少一筆會議');
    setPrintMode(mode);
  };
  const creator = selected ? users[selected.createdBy] : undefined;
  const selectedTaskItemNumbers = new Map((selected ? meetingTaskItems(selected, data.tasks) : []).map((item, index) => [item.id, index + 1]));

  if (creating && !editable) return <section className="temporary-meeting-page"><div className="page-heading"><div><h1>臨會/專題</h1><p>目前身份沒有建立臨會/專題權限，已停止顯示先前的新增草稿。</p></div></div><div className="empty-state">目前沒有可編輯的臨會/專題草稿</div></section>;
  if (!creating && !selected) return <section className="temporary-meeting-page"><div className="page-heading"><div><h1>臨會/專題</h1><p>目前沒有可檢視的臨會/專題，或原選取會議已不在目前權限範圍。</p></div>{editable&&<div className="heading-actions no-print"><button className="btn primary" onClick={startNew}>＋ 新增臨會/專題</button></div>}</div><div className="empty-state">目前沒有可檢視的臨會/專題</div></section>;

  return <><section className="temporary-meeting-page meeting-screen">
    <div className="page-heading">
      <div><h1>臨會/專題</h1><p>建立突發議題會議，可按全部船舶、船舶類型或逐船設定範圍。</p></div>
      <div className="heading-actions no-print"><button className="btn ghost" onClick={() => setViewMode(viewMode === 'register' ? 'workspace' : 'register')}>{viewMode === 'register' ? '返回會議詳情' : '臨會/專題總清單'}</button>{editable?<button className="btn primary" onClick={startNew}>＋ 新增臨會/專題</button>:<span className="badge">操作員唯讀</span>}</div>
    </div>
    {viewMode === 'register' ? <section className="panel meeting-register">
      <div className="panel-title"><div><h2>臨會/專題總清單</h2><p className="muted">共 {accessibleMeetings.length} 筆，目前篩選顯示 {filtered.length} 筆｜已選 {selectedExportMeetings.length} 筆</p></div><div className="heading-actions no-print"><button className="btn small ghost" onClick={() => setMeetingExportSelection(Array.from(new Set([...meetingExportSelection, ...filtered.map(meeting => meeting.id)])))}>全選目前篩選</button><button className="btn small ghost" onClick={() => setMeetingExportSelection([])}>清空</button><button className="btn small primary" onClick={() => printMeetings('meetings')}>匯出所選會議 PDF</button><button className="btn small green" onClick={() => printMeetings('register')}>匯出總清單 PDF</button></div></div>
      <div className="meeting-register-filters no-print">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋主題、緣由、待辦、船型…" />
        <select aria-label="總清單會議狀態篩選" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option>全部</option>{statuses.map(status => <option key={status}>{status}</option>)}</select>
        <select aria-label="總清單會議範圍篩選" value={scopeFilter} onChange={event => setScopeFilter(event.target.value as ScopeFilter)}><option value="any">全部範圍</option><option value="all">全部船舶</option><option value="types">按船舶類型</option><option value="vessels">逐船選擇</option></select>
        <select aria-label="總清單船舶類型篩選" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">全部船型</option>{shipTypes.map(shipType => <option key={shipType}>{shipType}</option>)}</select>
      </div>
      {filtered.length ? <div className="table-wrap"><table className="compact meeting-register-table"><thead><tr><th className="no-print">選取</th><th>召開日期</th><th>狀態</th><th>會議主題</th><th>會議範圍</th><th>船舶</th><th>部門</th><th>待辦</th><th>期限</th><th className="no-print">操作</th></tr></thead><tbody>{filtered.map(meeting => { const vesselIds = meetingVesselIds(meeting); const vesselNames = vesselIds.map(id => vesselDisplayName(vesselById[id])); return <tr key={meeting.id}><td className="no-print"><input aria-label={`選取會議 ${meeting.subject}`} type="checkbox" checked={meetingExportSelection.includes(meeting.id)} onChange={() => toggleMeetingExport(meeting.id)}/></td><td>{meeting.meetingDate || '-'}</td><td><span className={`meeting-status status-${statusOf(meeting)}`}>{statusOf(meeting)}</span></td><td><b>{meeting.subject}</b><br/><span className="muted">{meeting.reason || '未填召開緣由'}</span></td><td>{meetingScopeLabel(meeting)}</td><td title={vesselNames.join('、')}>{vesselIds.length} 艘<br/><span className="muted">{vesselNames.slice(0, 3).join('、')}{vesselNames.length > 3 ? '…' : ''}</span></td><td>{meeting.departments.join('、') || '-'}</td><td><span className="task-source-badge source-temporary">{meetingTaskCount(meeting.id)} 件</span></td><td>{meeting.expectedDate || '-'}</td><td className="no-print"><button className="btn small primary" onClick={() => selectMeeting(meeting)}>進入詳情</button></td></tr>; })}</tbody></table></div> : <div className="empty-state">目前沒有符合條件的臨會/專題</div>}
    </section> : <div className="temporary-meeting-workspace">
      <aside className="meeting-column temporary-list-column">
        <div className="column-title"><div><h2>基本資訊清單</h2><span>{filtered.length} 筆</span></div>{editable&&<button className="btn small primary" onClick={startNew}>新增</button>}</div>
        <div className="temporary-list-tools">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋主題、緣由、待辦、船型…" />
          <select aria-label="會議狀態篩選" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option>全部</option>{statuses.map(status => <option key={status}>{status}</option>)}</select>
          <select aria-label="會議範圍篩選" value={scopeFilter} onChange={event => setScopeFilter(event.target.value as ScopeFilter)}><option value="any">全部範圍</option><option value="all">全部船舶</option><option value="types">按船舶類型</option><option value="vessels">逐船選擇</option></select>
          <select aria-label="船舶類型篩選" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">全部船型</option>{shipTypes.map(shipType => <option key={shipType}>{shipType}</option>)}</select>
        </div>
        <div className="column-scroll">
          {filtered.map(meeting => <button key={meeting.id} className={`temporary-meeting-item ${!creating && selectedId === meeting.id ? 'active' : ''}`} onClick={() => selectMeeting(meeting)}>
            <span className={`meeting-status status-${statusOf(meeting)}`}>{statusOf(meeting)}</span><b>{meeting.subject}</b>
            <small>{meeting.meetingDate}｜{meetingScopeLabel(meeting)}｜{meeting.departments.length} 部門</small><p>{meeting.reason || '尚未填寫召開緣由'}</p>
          </button>)}
          {!filtered.length && <div className="empty-state compact">目前沒有符合條件的臨會/專題</div>}
        </div>
      </aside>

      <section className="meeting-column temporary-editor-column">
        <div className="column-title"><div><h2>{creating ? '新增臨會/專題' : draft.subject || '會議資料'}</h2><span>{editable?(creating ? '建立基本資訊與會議範圍' : '修改後請按保存變更'):'唯讀檢視'}</span></div>{editable&&<button className="btn green" onClick={save}>{creating ? '建立會議' : '保存變更'}</button>}</div>
        <fieldset disabled={!editable} className={`column-scroll temporary-form ${!editable?'readonly-form':''}`} aria-readonly={!editable}>
          <div className="grid cols-3">
            <div className="field span-2"><label>會議主題</label><input value={draft.subject} onChange={event => setDraft({ ...draft, subject: event.target.value })} placeholder="例如：颱風避風臨時協調會" /></div>
            <div className="field"><label>狀態</label><select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as TemporaryMeetingStatus })}>{statuses.map(status => <option key={status}>{status}</option>)}</select></div>
            <div className="field"><label>召開日期</label><input type="date" value={draft.meetingDate} onChange={event => setDraft({ ...draft, meetingDate: event.target.value })} /></div>
            <div className="field"><label>預計完成日期</label><input type="date" value={draft.expectedDate} onChange={event => setDraft({ ...draft, expectedDate: event.target.value })} /></div>
            <div className="field"><label>關注程度</label><select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as TaskPriority })}>{data.settings.priorities.map(priority => <option key={priority}>{priority}</option>)}</select></div>
            <div className="field span-3"><label>召開緣由</label><textarea value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} placeholder="說明為何召開本次臨會/專題" /></div>
            <div className="field span-3"><label>決議／會議結論</label><textarea value={draft.resolution} onChange={event => setDraft({ ...draft, resolution: event.target.value })} placeholder="記錄本次會議決議或結論" /></div>
            <div className="field span-3 meeting-task-items-editor">
              <div className="meeting-task-items-title"><label>待辦事項</label><button type="button" className="btn small primary" onClick={addTaskItem}>＋ 增加待辦事項</button></div>
              {draft.taskItems.map((item, index) => <div className="meeting-task-item" key={item.id}>
                <div><label htmlFor={`meeting-task-${item.id}`}>待辦事項 {index + 1}</label><button type="button" className="btn small ghost" onClick={() => removeTaskItem(item.id)}>移除此事項</button></div>
                <textarea id={`meeting-task-${item.id}`} value={item.description} onChange={event => updateTaskItem(item.id, event.target.value)} placeholder="填寫後保存，會依實際船舶範圍建立或同步待辦" />
              </div>)}
            </div>
          </div>

          <div className="temporary-picker meeting-scope-picker">
            <div className="temporary-picker-title"><b>涉會船舶範圍</b><span>{resolvedVesselIds.length} 艘</span></div>
            <div className="meeting-scope-modes">
              {(['all', 'types', 'vessels'] as MeetingVesselScopeMode[]).map(mode => <button key={mode} type="button" className={`scope-mode-card ${draft.vesselScopeMode === mode ? 'active' : ''}`} aria-pressed={draft.vesselScopeMode === mode} onClick={() => setDraft(previous => ({ ...previous, vesselScopeMode: mode }))}><b>{scopeModeLabel(mode)}</b><small>{mode === 'all' ? '目前可見的所有船舶' : mode === 'types' ? '可同時選一個或多個船型' : '逐艘勾選特定船舶'}</small></button>)}
            </div>
            {draft.vesselScopeMode === 'all' && <div className="scope-result-note"><b>全部船舶</b><span>本次會議涵蓋目前可見的 {resolvedVesselIds.length} 艘船舶。</span></div>}
            {draft.vesselScopeMode === 'types' && <>
              <div className="temporary-picker-title scope-subtitle"><b>選擇船舶類型</b><span>已選 {draft.vesselTypeScopes.length} 類</span><button className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, vesselTypeScopes: [...shipTypes] }))}>全選類型</button><button className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, vesselTypeScopes: [] }))}>清空</button></div>
              <div className="vessel-type-scope-grid">{shipTypes.map(shipType => { const count = visibleVessels.filter(vessel => vessel.shipType === shipType).length; const active = draft.vesselTypeScopes.includes(shipType); return <button type="button" key={shipType} className={`vessel-type-scope ${active ? 'active' : ''}`} aria-pressed={active} onClick={() => toggleVesselType(shipType)}><span className={`meeting-check ${active ? 'on' : ''}`}>{active ? '✓' : ''}</span><b>{shipType}</b><small>{count} 艘</small></button>; })}</div>
              <div className="scope-result-note"><b>實際範圍</b><span>{draft.vesselTypeScopes.length ? `${draft.vesselTypeScopes.join('、')}，共 ${resolvedVesselIds.length} 艘` : '請至少選擇一個船舶類型'}</span></div>
            </>}
            {draft.vesselScopeMode === 'vessels' && <>
              <div className="temporary-picker-title scope-subtitle"><b>逐船選擇</b><span>{draft.vessels.length} 艘</span><button className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, vessels: visibleVessels.map(vessel => vessel.id) }))}>全選</button><button className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, vessels: [] }))}>清空</button></div>
              <div className="temporary-chip-grid">{visibleVessels.map(vessel => <button type="button" key={vessel.id} className={`chip ${draft.vessels.includes(vessel.id) ? 'on' : ''}`} onClick={() => toggleVessel(vessel.id)}>{vesselDisplayName(vessel)}</button>)}</div>
            </>}
          </div>

          <div className="temporary-picker"><div className="temporary-picker-title"><b>涉及部門</b><span>{draft.departments.length} 個</span></div><div className="temporary-chip-grid departments">{data.settings.departments.map(department => <button type="button" key={department} className={`chip ${draft.departments.includes(department) ? 'on' : ''}`} onClick={() => toggleDepartment(department)}>{department}</button>)}</div></div>
        </fieldset>
      </section>

      <aside className="meeting-column temporary-summary-column">
        <div className="column-title"><h2>會議狀態</h2></div>
        <div className="column-scroll">
          <div className="temporary-status-grid">{statuses.map(status => <button key={status} className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}><span>{status}</span><b>{counts[status]}</b></button>)}</div>
          <div className="summary-card blue"><h3>目前會議</h3><div className="summary-line"><span>狀態</span><b>{draft.status}</b></div><div className="summary-line"><span>範圍</span><b>{scopeModeLabel(draft.vesselScopeMode)}</b></div><div className="summary-line"><span>船舶</span><b>{resolvedVesselIds.length}</b></div><div className="summary-line"><span>部門</span><b>{draft.departments.length}</b></div><div className="summary-line"><span>關注</span><b>{draft.priority}</b></div></div>
          <div className="summary-card"><h3>建立資訊</h3><p>{selected ? new Date(selected.createdAt).toLocaleString() : '尚未建立'}</p><small>{creator ? `${creator.department}｜${creator.name}｜${roleLabel(creator.role)}` : '建立後顯示建立者'}</small></div>
          <div className="summary-card mint"><h3>關聯待辦事項</h3>{linkedTasks.length ? <div className="meeting-linked-tasks">{linkedTasks.map(task => <article key={task.id}><b>{vesselDisplayName(vesselById[task.vesselId])}</b><p>{task.description}</p><small>{task.sourceMeetingItemId && selectedTaskItemNumbers.get(task.sourceMeetingItemId) ? `待辦事項 ${selectedTaskItemNumbers.get(task.sourceMeetingItemId)}｜` : ''}{task.isClosed ? '已結案' : task.status || '待執行'}｜期限 {task.expectedDate || '未設定'}</small></article>)}</div> : <p>{draft.taskItems.some(item => item.description.trim()) ? '保存後將依船舶範圍建立待辦。' : '尚未填寫待辦事項。'}</p>}</div>
          <div className="summary-card blue"><h3>待辦同步規則</h3><p>每個已填寫的待辦事項保存後，會依每艘實際範圍船舶各建立一筆待辦；再次保存會按事項同步且不重複新增。</p></div>
        </div>
      </aside>
    </div>}
    {notice && <div className="management-save-toast" role="status" aria-live="polite">{notice}</div>}
  </section>
  {printMode&&<section className="meeting-print print-only">
    {printMode==='meetings'&&selectedExportMeetings.map(meeting=>{const vesselIds=meetingVesselIds(meeting);const vesselNames=vesselIds.map(id=>vesselDisplayName(vesselById[id]));const items=meetingTaskItems(meeting,data.tasks);return <article className="meeting-print-page" key={meeting.id}><header><h1>臨會／專題會議報告</h1><p>匯出時間：{new Date().toLocaleString('zh-TW')}｜匯出人：{currentUser.name}</p></header><div className="meeting-print-meta"><div><small>會議主題</small><b>{meeting.subject||'-'}</b></div><div><small>狀態</small><b>{statusOf(meeting)}</b></div><div><small>召開日期</small><b>{meeting.meetingDate||'-'}</b></div><div><small>預計完成</small><b>{meeting.expectedDate||'-'}</b></div><div><small>關注程度</small><b>{meeting.priority}</b></div><div><small>會議範圍</small><b>{meetingScopeLabel(meeting)}</b></div></div><section><h2>涉會船舶</h2><p>{vesselNames.join('、')||'未指定'}</p></section><section><h2>涉及部門</h2><p>{meeting.departments.join('、')||'未指定'}</p></section><section><h2>召開緣由</h2><p>{meeting.reason||'未填寫'}</p></section><section><h2>決議／會議結論</h2><p>{meeting.resolution||'未填寫'}</p></section><section><h2>待辦事項</h2>{items.length?<ol>{items.map(item=><li key={item.id}>{item.description||'未填寫'}</li>)}</ol>:<p>尚無待辦事項</p>}</section></article>;})}
    {printMode==='register'&&<article className="meeting-print-register"><header><h1>臨會／專題總清單</h1><p>匯出時間：{new Date().toLocaleString('zh-TW')}｜匯出人：{currentUser.name}｜共 {accessibleMeetings.length} 筆</p></header><table><thead><tr><th>召開日期</th><th>狀態</th><th>主題</th><th>範圍</th><th>船舶</th><th>部門</th><th>待辦</th><th>期限</th></tr></thead><tbody>{accessibleMeetings.map(meeting=>{const vesselIds=meetingVesselIds(meeting);return <tr key={meeting.id}><td>{meeting.meetingDate||'-'}</td><td>{statusOf(meeting)}</td><td><b>{meeting.subject||'-'}</b><br/>{meeting.reason||'未填召開緣由'}</td><td>{meetingScopeLabel(meeting)}</td><td>{vesselIds.length} 艘<br/>{vesselIds.map(id=>vesselDisplayName(vesselById[id])).join('、')}</td><td>{meeting.departments.join('、')||'-'}</td><td>{meetingTaskCount(meeting.id)} 件</td><td>{meeting.expectedDate||'-'}</td></tr>;})}</tbody></table></article>}
  </section>}
  </>;
}

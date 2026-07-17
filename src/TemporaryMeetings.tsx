import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppData,
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

type Props = {
  data: AppData;
  visibleVessels: Vessel[];
  currentUser: UserAccount;
  commit: (mutate: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => void;
};

type MeetingDraft = Pick<
  TemporaryMeeting,
  'subject' | 'meetingDate' | 'vessels' | 'reason' | 'departments' | 'resolution' | 'expectedDate' | 'priority'
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
  expectedDate: todayDate(),
  priority: '中',
});

const draftFrom = (meeting?: TemporaryMeeting): MeetingDraft => meeting ? {
  subject: meeting.subject,
  status: statusOf(meeting),
  meetingDate: meeting.meetingDate,
  vesselScopeMode: scopeModeOf(meeting),
  vesselTypeScopes: [...(meeting.vesselTypeScopes || [])],
  vessels: [...meeting.vessels],
  reason: meeting.reason,
  departments: [...meeting.departments],
  resolution: meeting.resolution,
  expectedDate: meeting.expectedDate,
  priority: meeting.priority,
} : blankDraft();

export default function TemporaryMeetingsPage({ data, visibleVessels, currentUser, commit }: Props) {
  const editable = hasPermission(data.settings.rolePermissions, currentUser, 'manageMeetings');
  const visibleIds = new Set(visibleVessels.map(vessel => vessel.id));
  const appliesToUser = (meeting: TemporaryMeeting) => editable || scopeModeOf(meeting)==='all' || (scopeModeOf(meeting)==='types' ? visibleVessels.some(vessel=>(meeting.vesselTypeScopes||[]).includes(vessel.shipType)) : meeting.vessels.some(id=>visibleIds.has(id)));
  const initialMeeting = data.meetings.find(appliesToUser);
  const [selectedId, setSelectedId] = useState(initialMeeting?.id || '');
  const [creating, setCreating] = useState(editable && !initialMeeting);
  const [draft, setDraft] = useState<MeetingDraft>(() => draftFrom(initialMeeting));
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部' | TemporaryMeetingStatus>('全部');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('any');
  const [typeFilter, setTypeFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const savingRef = useRef(false);

  const selected = data.meetings.find(meeting => meeting.id === selectedId);
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

  const accessibleMeetings = data.meetings.filter(appliesToUser);
  const filtered = accessibleMeetings.filter(meeting => {
    const q = query.trim().toLowerCase();
    if (statusFilter !== '全部' && statusOf(meeting) !== statusFilter) return false;
    if (scopeFilter !== 'any' && scopeModeOf(meeting) !== scopeFilter) return false;
    if (typeFilter !== 'all') {
      if (scopeModeOf(meeting)==='all') return !q || `${meeting.subject} ${meeting.reason} ${meeting.resolution} ${meeting.meetingDate} ${meetingScopeLabel(meeting)}`.toLowerCase().includes(q);
      if (!meetingVesselTypes(meeting).includes(typeFilter)) return false;
    }
    return !q || `${meeting.subject} ${meeting.reason} ${meeting.resolution} ${meeting.meetingDate} ${meetingScopeLabel(meeting)}`.toLowerCase().includes(q);
  });

  const resolvedVesselIds = useMemo(() => {
    if (draft.vesselScopeMode === 'all') return visibleVessels.map(vessel => vessel.id);
    if (draft.vesselScopeMode === 'types') return visibleVessels.filter(vessel => draft.vesselTypeScopes.includes(vessel.shipType)).map(vessel => vessel.id);
    return draft.vessels.filter(id => visibleVessels.some(vessel => vessel.id === id));
  }, [draft.vesselScopeMode, draft.vesselTypeScopes, draft.vessels, visibleVessels]);

  useEffect(() => {
    if (creating) return;
    const meeting = data.meetings.find(item => item.id === selectedId);
    if (meeting) setDraft(draftFrom(meeting));
  }, [selectedId, data.revision, creating]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectMeeting = (meeting: TemporaryMeeting) => {
    setCreating(false);
    setSelectedId(meeting.id);
    setDraft(draftFrom(meeting));
  };
  const startNew = () => {
    if (!editable) return alert('操作員僅可檢視適用於指派船舶的臨時會議');
    setCreating(true);
    setSelectedId('');
    setDraft(blankDraft());
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

  const save = () => {
    if (!editable) return alert('您無權修改臨時會議');
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
    };
    commit(draftData => {
      let meeting = draftData.meetings.find(item => item.id === id);
      const wasNew = !meeting;
      const mayGenerate = wasNew || !meeting?.resolution.trim() || draftData.tasks.some(task => task.sourceMeetingId === id);
      const linkedVesselIds = new Set(draftData.tasks.filter(task => task.sourceMeetingId === id).map(task => task.vesselId));
      if (!meeting) {
        meeting = { id, ...savedDraft, createdBy: currentUser.id, createdAt: at, updatedAt: at };
        draftData.meetings.unshift(meeting);
      } else {
        Object.assign(meeting, { ...savedDraft, updatedAt: at });
      }
      if (savedDraft.resolution.trim() && mayGenerate) savedDraft.vessels.filter(vesselId=>!linkedVesselIds.has(vesselId)).forEach(vesselId => {
        const task = {
          id: uid('task'),
          sourceMeetingId: id,
          vesselId,
          priority: savedDraft.priority,
          isAware: true,
          isAbnormal: false,
          isInternalControl: false,
          category: '臨時會議決議',
          description: `${savedDraft.subject}：${savedDraft.reason}`,
          status: savedDraft.resolution,
          expectedDate: savedDraft.expectedDate,
          departments: savedDraft.departments,
          ownerUserIds: [],
          isClosed: false,
          createdBy: currentUser.id,
          updatedBy: currentUser.id,
          createdAt: at,
          updatedAt: at,
          statusLogs: [{ id: uid('log'), at, by: currentUser.name, text: savedDraft.resolution }],
        };
        draftData.tasks.unshift(task);
        const vessel = draftData.vessels.find(item => item.id === vesselId);
        if (vessel) draftData.notifications.unshift(...buildTaskNotifications(draftData.users, vessel, currentUser.id, task, 'task_created', currentUser.name));
      });
      draftData.notifications = draftData.notifications.slice(0, 1000);
    }, creating ? '新增臨時會議' : '更新臨時會議', 'meeting', id, `${draft.subject.trim()}｜${scopeModeLabel(draft.vesselScopeMode)}`);
    setDraft(savedDraft);
    setCreating(false);
    setSelectedId(id);
    setNotice(`✓ ${creating ? '臨時會議已建立' : '臨時會議已保存'}`);
    window.setTimeout(()=>{ savingRef.current=false; },0);
  };

  const counts = Object.fromEntries(statuses.map(status => [status, accessibleMeetings.filter(meeting => statusOf(meeting) === status).length])) as Record<TemporaryMeetingStatus, number>;
  const creator = selected ? users[selected.createdBy] : undefined;

  return <section className="temporary-meeting-page">
    <div className="page-heading">
      <div><h1>臨時會議</h1><p>建立突發議題會議，可按全部船舶、船舶類型或逐船設定範圍。</p></div>
      <div className="heading-actions no-print">{editable?<button className="btn primary" onClick={startNew}>＋ 新增臨時會議</button>:<span className="badge">操作員唯讀</span>}</div>
    </div>
    <div className="temporary-meeting-workspace">
      <aside className="meeting-column temporary-list-column">
        <div className="column-title"><div><h2>基本資訊清單</h2><span>{filtered.length} 筆</span></div>{editable&&<button className="btn small primary" onClick={startNew}>新增</button>}</div>
        <div className="temporary-list-tools">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋主題、緣由、船型…" />
          <select aria-label="會議狀態篩選" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option>全部</option>{statuses.map(status => <option key={status}>{status}</option>)}</select>
          <select aria-label="會議範圍篩選" value={scopeFilter} onChange={event => setScopeFilter(event.target.value as ScopeFilter)}><option value="any">全部範圍</option><option value="all">全部船舶</option><option value="types">按船舶類型</option><option value="vessels">逐船選擇</option></select>
          <select aria-label="船舶類型篩選" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">全部船型</option>{shipTypes.map(shipType => <option key={shipType}>{shipType}</option>)}</select>
        </div>
        <div className="column-scroll">
          {filtered.map(meeting => <button key={meeting.id} className={`temporary-meeting-item ${!creating && selectedId === meeting.id ? 'active' : ''}`} onClick={() => selectMeeting(meeting)}>
            <span className={`meeting-status status-${statusOf(meeting)}`}>{statusOf(meeting)}</span><b>{meeting.subject}</b>
            <small>{meeting.meetingDate}｜{meetingScopeLabel(meeting)}｜{meeting.departments.length} 部門</small><p>{meeting.reason || '尚未填寫召開緣由'}</p>
          </button>)}
          {!filtered.length && <div className="empty-state compact">目前沒有符合條件的臨時會議</div>}
        </div>
      </aside>

      <section className="meeting-column temporary-editor-column">
        <div className="column-title"><div><h2>{creating ? '新增臨時會議' : draft.subject || '會議資料'}</h2><span>{editable?(creating ? '建立基本資訊與會議範圍' : '修改後請按保存變更'):'唯讀檢視'}</span></div>{editable&&<button className="btn green" onClick={save}>{creating ? '建立會議' : '保存變更'}</button>}</div>
        <fieldset disabled={!editable} className={`column-scroll temporary-form ${!editable?'readonly-form':''}`} aria-readonly={!editable}>
          <div className="grid cols-3">
            <div className="field span-2"><label>會議主題</label><input value={draft.subject} onChange={event => setDraft({ ...draft, subject: event.target.value })} placeholder="例如：颱風避風臨時協調會" /></div>
            <div className="field"><label>狀態</label><select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as TemporaryMeetingStatus })}>{statuses.map(status => <option key={status}>{status}</option>)}</select></div>
            <div className="field"><label>召開日期</label><input type="date" value={draft.meetingDate} onChange={event => setDraft({ ...draft, meetingDate: event.target.value })} /></div>
            <div className="field"><label>預計完成日期</label><input type="date" value={draft.expectedDate} onChange={event => setDraft({ ...draft, expectedDate: event.target.value })} /></div>
            <div className="field"><label>關注程度</label><select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as TaskPriority })}>{data.settings.priorities.map(priority => <option key={priority}>{priority}</option>)}</select></div>
            <div className="field span-3"><label>召開緣由</label><textarea value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} placeholder="說明為何召開本次臨時會議" /></div>
            <div className="field span-3"><label>決議及追蹤要求</label><textarea value={draft.resolution} onChange={event => setDraft({ ...draft, resolution: event.target.value })} placeholder="可先留空；有決議後保存，新建會議才會產生跟進事項" /></div>
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
              <div className="temporary-chip-grid">{visibleVessels.map(vessel => <button type="button" key={vessel.id} className={`chip ${draft.vessels.includes(vessel.id) ? 'on' : ''}`} onClick={() => toggleVessel(vessel.id)}>{vessel.shortName || vessel.name}</button>)}</div>
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
          <div className="summary-card mint"><h3>跟進事項規則</h3><p>新增會議且已有決議時，才會依保存時解析出的實際船舶建立待辦；修改舊會議不會重複產生。</p></div>
        </div>
      </aside>
    </div>
    {notice && <div className="management-save-toast" role="status" aria-live="polite">{notice}</div>}
  </section>;
}

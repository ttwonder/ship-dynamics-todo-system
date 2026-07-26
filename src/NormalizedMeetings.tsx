import { useMemo, useState } from 'react';
import type {
  AppData,
  MeetingTaskItem,
  TemporaryMeeting,
  TemporaryMeetingStatus,
  UserAccount,
  Vessel,
} from './types';
import { vesselDisplayName } from './vesselDisplay';
import RichTextContent from './RichTextContent';

type Props = {
  data: AppData;
  user: UserAccount;
  vessels: Vessel[];
  canEdit: boolean;
  onSave: (meeting: TemporaryMeeting, creating: boolean) => Promise<boolean>;
  onDelete: (meetingId: string) => Promise<boolean>;
  onCorrectStatus: (input: {
    meetingId: string;
    eventId: string;
    correctionKind: 'void' | 'correct';
    correctedStatus?: string | null;
    reason: string;
  }) => Promise<void>;
};

const statuses: TemporaryMeetingStatus[] = ['待召開', '追蹤中', '已完成'];

function nowLocalDateTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function newMeeting(user: UserAccount, vesselIds: string[]): TemporaryMeeting {
  const id = crypto.randomUUID();
  return {
    id,
    subject: '',
    status: '待召開',
    meetingDate: nowLocalDateTime(),
    vesselScopeMode: 'vessels',
    vesselTypeScopes: [],
    vessels: vesselIds,
    reason: '',
    departments: [],
    participantUserIds: [],
    trackingUserIds: [],
    responsibleUserIds: [],
    resolution: '',
    taskDescription: '',
    taskItems: [],
    expectedDate: '',
    priority: '中',
    isAbnormal: false,
    isInternalControl: false,
    includeInMorning: false,
    createdBy: user.id,
    createdAt: new Date().toISOString(),
  };
}

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

function CheckGroup({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (values: string[]) => void;
}) {
  return <fieldset className="meeting-check-group">
    <legend>{label}</legend>
    <div className="checkbox-grid">
      {options.map(option => <label key={option.value}>
        <input
          type="checkbox"
          checked={values.includes(option.value)}
          onChange={() => onChange(toggle(values, option.value))}
        />
        <span>{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}

function MeetingEditor({
  initial,
  data,
  vessels,
  creating,
  close,
  save,
  remove,
}: {
  initial: TemporaryMeeting;
  data: AppData;
  vessels: Vessel[];
  creating: boolean;
  close: () => void;
  save: (meeting: TemporaryMeeting) => Promise<boolean>;
  remove: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const change = <K extends keyof TemporaryMeeting>(key: K, value: TemporaryMeeting[K]) => (
    setDraft(previous => ({ ...previous, [key]: value }))
  );
  const updateItem = (index: number, patch: Partial<MeetingTaskItem>) => {
    const items = structuredClone(draft.taskItems || []);
    items[index] = { ...items[index], ...patch };
    change('taskItems', items);
  };
  const addItem = () => change('taskItems', [
    ...(draft.taskItems || []),
    {
      id: crypto.randomUUID(),
      description: '',
      categories: [],
      distributeToVessels: false,
    },
  ]);
  const submit = async () => {
    if (!draft.subject.trim()) return alert('請填寫會議主旨。');
    if (!draft.meetingDate) return alert('請填寫會議日期。');
    if (draft.vesselScopeMode === 'vessels' && !draft.vessels.length) {
      return alert('請選擇至少一艘船舶。');
    }
    if (draft.vesselScopeMode === 'types' && !(draft.vesselTypeScopes || []).length) {
      return alert('請選擇至少一個船型。');
    }
    if (draft.taskItems.some(item => !item.description.trim())) {
      return alert('會議待辦內容不得空白。');
    }
    setSaving(true);
    try {
      if (await save(draft)) close();
    } finally {
      setSaving(false);
    }
  };
  const users = data.users.filter(user => user.isActive);
  const userOptions = users.map(user => ({
    value: user.id,
    label: `${user.department}｜${user.name}`,
  }));
  const vesselOptions = vessels.map(vessel => ({
    value: vessel.id,
    label: vesselDisplayName(vessel),
  }));
  const shipTypeOptions = Array.from(new Set(vessels.map(vessel => vessel.shipType).filter(Boolean)))
    .map(value => ({ value, label: value }));
  const departmentOptions = data.settings.departments.map(value => ({ value, label: value }));

  return <div className="modal-backdrop" role="presentation">
    <section className="modal large normalized-meeting-editor" role="dialog" aria-modal="true">
      <div className="modal-head">
        <div><h2>{creating ? '新增臨時會議' : '編輯臨時會議'}</h2><p>會議、範圍、參與人員與待辦由伺服器一次提交。</p></div>
        <button className="icon-btn" onClick={close} aria-label="關閉">×</button>
      </div>
      <div className="form-grid">
        <label className="span-2">會議主旨
          <input value={draft.subject} onChange={event => change('subject', event.target.value)}/>
        </label>
        <label>會議日期
          <input type="datetime-local" value={draft.meetingDate.slice(0, 16)}
            onChange={event => change('meetingDate', event.target.value)}/>
        </label>
        <label>狀態
          <select value={draft.status || '待召開'}
            onChange={event => change('status', event.target.value as TemporaryMeetingStatus)}>
            {statuses.map(status => <option key={status}>{status}</option>)}
          </select>
        </label>
        <label>船舶範圍
          <select value={draft.vesselScopeMode || 'vessels'}
            onChange={event => change('vesselScopeMode', event.target.value as TemporaryMeeting['vesselScopeMode'])}>
            <option value="all">全部授權船舶</option>
            <option value="types">依船型</option>
            <option value="vessels">指定船舶</option>
          </select>
        </label>
        <label>優先程度
          <select value={draft.priority} onChange={event => change('priority', event.target.value as TemporaryMeeting['priority'])}>
            {data.settings.priorities.map(priority => <option key={priority}>{priority}</option>)}
          </select>
        </label>
        {draft.vesselScopeMode === 'vessels' && <div className="span-2">
          <CheckGroup label="指定船舶" values={draft.vessels} options={vesselOptions}
            onChange={values => change('vessels', values)}/>
        </div>}
        {draft.vesselScopeMode === 'types' && <div className="span-2">
          <CheckGroup label="指定船型" values={draft.vesselTypeScopes || []} options={shipTypeOptions}
            onChange={values => change('vesselTypeScopes', values)}/>
        </div>}
        <label className="span-2">召開原因
          <textarea value={draft.reason} onChange={event => change('reason', event.target.value)}/>
        </label>
        <div className="span-2">
          <CheckGroup label="涉及部門" values={draft.departments} options={departmentOptions}
            onChange={values => change('departments', values)}/>
        </div>
        <div className="span-2">
          <CheckGroup label="參與人員" values={draft.participantUserIds} options={userOptions}
            onChange={values => change('participantUserIds', values)}/>
        </div>
        <div className="span-2">
          <CheckGroup label="追蹤人員" values={draft.trackingUserIds} options={userOptions}
            onChange={values => change('trackingUserIds', values)}/>
        </div>
        <div className="span-2">
          <CheckGroup label="負責人員" values={draft.responsibleUserIds} options={userOptions}
            onChange={values => change('responsibleUserIds', values)}/>
        </div>
        <label className="span-2">決議
          <textarea value={draft.resolution} onChange={event => change('resolution', event.target.value)}/>
        </label>
        <label>預計日期
          <input type="date" value={draft.expectedDate} onChange={event => change('expectedDate', event.target.value)}/>
        </label>
        <label>完成日期
          <input type="date" value={draft.completedDate || ''}
            onChange={event => change('completedDate', event.target.value || undefined)}/>
        </label>
        <div className="span-2 checkbox-grid">
          <label><input type="checkbox" checked={draft.isAbnormal}
            onChange={event => change('isAbnormal', event.target.checked)}/>異常事項</label>
          <label><input type="checkbox" checked={draft.isInternalControl}
            onChange={event => change('isInternalControl', event.target.checked)}/>內控事項</label>
          <label><input type="checkbox" checked={draft.includeInMorning === true}
            onChange={event => change('includeInMorning', event.target.checked)}/>納入晨會</label>
        </div>
      </div>
      <section className="meeting-items-editor">
        <div className="panel-title"><h3>會議待辦</h3><button className="btn small ghost" onClick={addItem}>＋新增待辦</button></div>
        {(draft.taskItems || []).map((item, index) => <div className="meeting-item-edit" key={item.id}>
          <textarea aria-label={`待辦 ${index + 1}`} value={item.description}
            onChange={event => updateItem(index, { description: event.target.value })}/>
          <div>
            {data.settings.meetingTaskCategories.map(category => <label key={category}>
              <input type="checkbox" checked={(item.categories || []).includes(category)}
                onChange={() => updateItem(index, { categories: toggle(item.categories || [], category) })}/>
              {category}
            </label>)}
            <label><input type="checkbox" checked={item.distributeToVessels === true}
              onChange={event => updateItem(index, { distributeToVessels: event.target.checked })}/>
              分派到各船
            </label>
          </div>
          <button className="btn small danger" onClick={() => change(
            'taskItems',
            draft.taskItems.filter((_, itemIndex) => itemIndex !== index),
          )}>移除</button>
        </div>)}
      </section>
      <div className="modal-actions">
        {!creating && <button className="btn danger" disabled={saving} onClick={async () => {
          if (!confirm('確定刪除此會議及由它管理的關聯嗎？')) return;
          setSaving(true);
          try { if (await remove()) close(); } finally { setSaving(false); }
        }}>刪除會議</button>}
        <span className="spacer"/>
        <button className="btn ghost" onClick={close}>取消</button>
        <button className="btn primary" disabled={saving} onClick={submit}>
          {saving ? '提交中…' : '儲存會議'}
        </button>
      </div>
    </section>
  </div>;
}

export default function NormalizedMeetings({
  data,
  user,
  vessels,
  canEdit,
  onSave,
  onDelete,
  onCorrectStatus,
}: Props) {
  const [editing, setEditing] = useState<TemporaryMeeting | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const vesselMap = useMemo(
    () => Object.fromEntries(vessels.map(vessel => [vessel.id, vessel])),
    [vessels],
  );
  const meetings = data.meetings.filter(meeting => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return [
      meeting.subject,
      meeting.reason,
      meeting.resolution,
      ...meeting.vessels.map(id => vesselMap[id] ? vesselDisplayName(vesselMap[id]) : ''),
    ].join(' ').toLowerCase().includes(keyword);
  });
  return <section className="temporary-meetings-page">
    <div className="page-heading">
      <div><h1>臨時會議</h1><p>會議內容、範圍、人員、待辦與狀態歷程均由歸一化伺服器管理。</p></div>
      {canEdit && <button className="btn primary" onClick={() => {
        setCreating(true);
        setEditing(newMeeting(user, vessels.slice(0, 1).map(vessel => vessel.id)));
      }}>＋新增會議</button>}
    </div>
    <section className="panel">
      <input aria-label="搜尋會議" value={query} onChange={event => setQuery(event.target.value)}
        placeholder="搜尋主旨、原因、決議或船舶"/>
    </section>
    <section className="meeting-grid">
      {meetings.map(meeting => <article className="panel meeting-card" key={meeting.id}>
        <div className="panel-title"><div><span className="badge">{meeting.status || '待召開'}</span>
          <h2>{meeting.subject}</h2></div>
          {canEdit && <button className="btn small primary" onClick={() => {
            setCreating(false);
            setEditing(structuredClone(meeting));
          }}>編輯</button>}
        </div>
        <p>{meeting.meetingDate.replace('T', ' ').slice(0, 16)}｜{
          meeting.vesselScopeMode === 'all'
            ? '全部授權船舶'
            : meeting.vesselScopeMode === 'types'
              ? (meeting.vesselTypeScopes || []).join('、')
              : meeting.vessels.map(id => vesselMap[id] ? vesselDisplayName(vesselMap[id]) : '').filter(Boolean).join('、')
        }</p>
        <RichTextContent value={meeting.reason} fallback="尚未填寫召開原因"/>
        {!!meeting.taskItems.length && <div className="meeting-task-summary">
          <b>會議待辦 {meeting.taskItems.length} 項</b>
          {meeting.taskItems.map(item => <div key={item.id}>{item.description}</div>)}
        </div>}
        {!!meeting.statusLogs?.length && <details>
          <summary>狀態歷程 {meeting.statusLogs.length}</summary>
          {meeting.statusLogs.map(log => <div className="status-history-row" key={log.id}>
            <span>{log.at.replace('T', ' ').slice(0, 16)}｜{log.by}</span>
            <b>{log.text}</b>
            {canEdit && <button className="btn tiny ghost" onClick={async () => {
              const reason = prompt('請填寫更正原因');
              if (!reason?.trim()) return;
              const correctedStatus = prompt('新狀態；留空代表作廢此筆');
              await onCorrectStatus({
                meetingId: meeting.id,
                eventId: log.id,
                correctionKind: correctedStatus?.trim() ? 'correct' : 'void',
                correctedStatus: correctedStatus?.trim() || null,
                reason: reason.trim(),
              });
            }}>更正</button>}
          </div>)}
        </details>}
      </article>)}
      {!meetings.length && <div className="empty-state">目前沒有符合條件的會議</div>}
    </section>
    {editing && <MeetingEditor
      initial={editing}
      data={data}
      vessels={vessels}
      creating={creating}
      close={() => setEditing(null)}
      save={meeting => onSave(meeting, creating)}
      remove={() => onDelete(editing.id)}
    />}
  </section>;
}

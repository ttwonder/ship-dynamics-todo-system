import { useEffect, useRef, useState } from 'react';
import type { AppData, LoadStatus, NavigationStatus, ShipStatus, TaskItem, TaskPriority, UserAccount, Vessel, VesselCargoItem } from './types';
import { nowIso, todayDate, uid } from './utils';
import { FLOW_INTERNAL_CONTROL_REMINDER } from './taskWorkflow';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskShipTypeLabel, taskVesselIds, taskVesselLabel } from './taskVesselScope';
import { appearsInSingleVesselTasks } from './taskAttention';
import { isEligibleTaskOwner } from './permissions';
import RichTextEditor from './RichTextEditor';
import RichTextContent from './RichTextContent';
import MeetingPeoplePicker from './MeetingPeoplePicker';
import { isRichTextEmpty, richTextToPlainText } from './richText';
import { taskIsClosedForVessel, taskProgressForVessel, taskVesselProgressSummary, usesPerVesselProgress } from './taskVesselProgress';
import { categoryChoicesForTask } from './taskCategories';
import { composeScheduleValue, scheduleDateValue, scheduleTimeValue } from './scheduleTime';
export { scheduleDateValue as scheduleInputValue } from './scheduleTime';

type Commit = (updater: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => void;
type MultiChoice = { value: string; label: string; detail?: string };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const priorityBadgeClass = (priority: TaskPriority) => priority === '急' ? 'urgent' : priority === '高' ? 'high' : priority === '中' ? 'mid' : 'low';
const cargoLines = (items: VesselCargoItem[]) => items.map(item => `${item.name}${item.quantity ? `｜${item.quantity}` : ''}`).join('\n');
const parseCargoLines = (value: string): VesselCargoItem[] => value.split(/\r?\n/).map(line => {
  const [name = '', ...quantityParts] = line.split(/[｜|]/);
  return { name: name.trim(), quantity: quantityParts.join('｜').trim() };
}).filter(item => item.name || item.quantity);
const askCompletionDate = (current = todayDate()) => {
  const value = window.prompt('請選擇完成日期（YYYY-MM-DD）', current || todayDate());
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    alert('完成日期格式需為 YYYY-MM-DD');
    return null;
  }
  return normalized;
};

function useEscapeClose(close: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [close]);
}

function CheckboxMultiPicker({ label, values, choices, onChange, required = false }: { label: string; values: string[]; choices: MultiChoice[]; onChange: (values: string[]) => void; required?: boolean }) {
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  return <fieldset className="checkbox-multi-picker" aria-required={required}><legend>{label}{required && <span className="danger-note" aria-hidden="true">＊</span>}<span>已選 {values.length}</span></legend><div className="checkbox-multi-grid">{choices.map(choice => {
    const checked = values.includes(choice.value);
    return <label key={choice.value} className={checked ? 'selected' : ''}><input type="checkbox" checked={checked} onChange={() => toggle(choice.value)}/><span><b>{choice.label}</b>{choice.detail && <small>{choice.detail}</small>}</span></label>;
  })}</div></fieldset>;
}

function DropdownMultiPicker({ label, values, choices, onChange, disabled = false }: { label: string; values: string[]; choices: MultiChoice[]; onChange: (values: string[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = `multi-picker-${label}`;
  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);
  useEffect(() => { if (disabled) { setOpen(false); setQuery(''); } }, [disabled]);
  const selectedChoices = choices.filter(choice => values.includes(choice.value));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredChoices = choices.filter(choice => !normalizedQuery || `${choice.label} ${choice.detail || ''}`.toLowerCase().includes(normalizedQuery));
  const summary = selectedChoices.length
    ? `${selectedChoices.slice(0, 3).map(choice => choice.label).join('、')}${selectedChoices.length > 3 ? ` 等 ${selectedChoices.length} 人` : ''}`
    : `請選擇${label}`;
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  return <div ref={rootRef} className={`dropdown-multi-picker ${open ? 'open' : ''}`} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); window.setTimeout(()=>triggerRef.current?.focus(),0); }
  }}>
    <label>{label}<span>已選 {values.length}</span></label>
    <button ref={triggerRef} type="button" className="dropdown-multi-trigger" disabled={disabled} aria-disabled={disabled} aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>
      <span className={selectedChoices.length ? '' : 'muted'}>{summary}</span><b aria-hidden="true">⌄</b>
    </button>
    {open && <div className="dropdown-multi-menu" id={listId}>
      <div className="dropdown-multi-tools"><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋姓名或部門…" aria-label={`搜尋${label}`}/>{values.length > 0 && <button type="button" className="btn small ghost" onClick={() => onChange([])}>清空</button>}</div>
      <div className="dropdown-multi-options">{filteredChoices.length ? filteredChoices.map(choice => {
        const checked = values.includes(choice.value);
        return <label key={choice.value} className={checked ? 'selected' : ''}><input type="checkbox" checked={checked} onChange={() => toggle(choice.value)}/><span><b>{choice.label}</b>{choice.detail && <small>{choice.detail}</small>}</span></label>;
      }) : <div className="empty-state compact">沒有符合條件的人員</div>}</div>
    </div>}
  </div>;
}

function ScheduleDateTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const date = scheduleDateValue(value);
  const time = scheduleTimeValue(value);
  return <div className="field schedule-date-time-field"><label>{label}</label><div className="schedule-date-time-inputs"><input type="date" aria-label={`${label} 日期`} value={date} onChange={event => onChange(composeScheduleValue(event.target.value, time))}/><input type="time" aria-label={`${label} 小時分鐘`} value={time} disabled={!date} onChange={event => onChange(composeScheduleValue(date, event.target.value))}/></div><small>選填；可只填日期，若填小時分鐘會顯示到 HH:mm；未選擇時顯示 TBA</small></div>;
}

export function VesselEditModal({ vessel, data, currentUser, close, commit, addTask, editTask }: { vessel?: Vessel; data: AppData; currentUser: UserAccount; close: () => void; commit: Commit; addTask: (vesselId: string) => void; editTask: (taskId: string) => void }) {
  useEscapeClose(close);
  if (!vessel) return null;
  const update = (change: (target: Vessel, draft: AppData) => void, detail: string) => commit(draft => {
    const target = draft.vessels.find(item => item.id === vessel.id);
    if (!target) return;
    change(target, draft);
    target.updatedAt = nowIso();
  }, '快速更新船舶', 'vessel', vessel.id, detail);
  const openTasks = data.tasks.filter(task => appearsInSingleVesselTasks(task) && taskHasVessel(task, vessel.id) && !taskIsClosedForVessel(task,vessel.id));
  return <div className="modal-backdrop"><div className="modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="vessel-edit-title"><div className="modal-header"><div><h2 id="vessel-edit-title">快速更新｜{vesselDisplayName(vessel)}</h2><small>修改後立即保存；按 Esc 可關閉</small></div><button className="btn ghost" onClick={close}>完成並關閉</button></div>
    <div className="smart-ship-api-note"><b>智慧船舶接口預留</b><span>上下港、位置、速度／航行狀態、載況、ETA／ETB／ETD 與貨名貨量日後可自動同步；目前欄位同時支援手動修改，手動值會正常保存。</span></div>
    <div className="grid cols-4">
      <div className="field"><label>目前位置</label><input value={vessel.position.location} onChange={event => { const value = event.target.value; update(target => { target.position.location = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改目前位置'); }}/></div>
      <div className="field"><label>上一港</label><input value={vessel.position.lastPort} onChange={event => { const value = event.target.value; update(target => { target.position.lastPort = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改上一港'); }}/></div>
      <div className="field"><label>下一港</label><input value={vessel.position.nextPort} onChange={event => { const value = event.target.value; update(target => { target.position.nextPort = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改下一港'); }}/></div>
      <div className="field"><label>航行狀態</label><select value={vessel.position.navigationStatus} onChange={event => { const value = event.target.value as NavigationStatus; update(target => { target.position.navigationStatus = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改航行狀態'); }}><option>航行</option><option>拋錨</option><option>進港中</option><option>出港中</option><option>停泊</option><option>漂航</option></select></div>
      <div className="field"><label>速度（kn）</label><input type="number" min="0" step="0.1" value={vessel.position.speedKnots} onChange={event => { const value = Number(event.target.value || 0); update(target => { target.position.speedKnots = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改速度'); }}/></div>
      <div className="field"><label>載況</label><select value={vessel.cargo.loadStatus} onChange={event => { const value = event.target.value as LoadStatus; update(target => { target.cargo.loadStatus = value; target.cargo.source = 'manual'; target.cargo.updatedAt = nowIso(); }, '修改載況'); }}><option>空載</option><option>非空載</option><option>滿載</option></select></div>
      <ScheduleDateTimeField label="ETA" value={vessel.position.eta} onChange={value => update(target => { target.position.eta = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改 ETA')}/>
      <ScheduleDateTimeField label="ETB" value={vessel.position.etb} onChange={value => update(target => { target.position.etb = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改 ETB')}/>
      <ScheduleDateTimeField label="ETD" value={vessel.position.etd} onChange={value => update(target => { target.position.etd = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改 ETD')}/>
      <div className="field span-2"><label>多筆貨名／貨量</label><textarea value={cargoLines(vessel.cargo.items)} placeholder={'每行一筆，例如：\n原油｜28,000 MT\n柴油｜5,000 MT'} onChange={event => { const items = parseCargoLines(event.target.value); update(target => { target.cargo.items = items; target.cargo.name = items[0]?.name || ''; target.cargo.quantity = items[0]?.quantity || ''; target.cargo.source = 'manual'; target.cargo.updatedAt = nowIso(); }, `修改貨名貨量：${items.length} 筆`); }}/></div>
      <div className="field"><label>人工備註</label><input value={vessel.position.manualRemark} onChange={event => { const value = event.target.value; update(target => { target.position.manualRemark = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改人工動態備註'); }}/></div>
      <div className="field span-2"><label>近期／後續動態</label><textarea value={vessel.note.recentDynamics} onChange={event => { const value = event.target.value; update(target => { target.note.recentDynamics = value; target.note.subsequentDynamics = ''; target.note.updatedAt = nowIso(); }, '修改近期／後續動態'); }}/></div>
    </div>
    <CheckboxMultiPicker label="船舶狀態" values={vessel.note.statusList} choices={data.settings.vesselStatuses.map(status => ({ value: status, label: status }))} onChange={values => update(target => { target.note.statusList = values as ShipStatus[]; target.note.updatedAt = nowIso(); }, `修改船舶狀態：${values.join('、') || '無'}`)}/>
    <section className="modal-task-section"><div className="panel-title"><h3>未結要事 <span className="muted">({openTasks.length})</span></h3><button className="btn primary small" onClick={() => addTask(vessel.id)}>＋ 新增要事</button></div>{openTasks.length ? openTasks.map(task => <button key={task.id} className="modal-task-row" onClick={() => editTask(task.id)}><span className={`badge ${priorityBadgeClass(task.priority)}`}>{task.priority}</span><b>{task.isAbnormal && <span className="inline-abnormal">異常</span>}{richTextToPlainText(task.description) || '尚未輸入要事內容'}</b><small>{richTextToPlainText(task.status) || '尚未更新狀態'}｜期限 {task.expectedDate || '未設定'}</small></button>) : <div className="empty-state compact">目前沒有未結要事</div>}</section>
  </div></div>;
}

export function TaskEditModal({ task, creating = false, data, visibleVessels, currentUser, canClose, canDelete, canCancelInternalControl, canEditOverall, initialProgressVesselId = '', readOnly = false, close, onSave, onSaveVesselProgress, onDelete }: { task?: TaskItem; creating?: boolean; data: AppData; visibleVessels: Vessel[]; currentUser: UserAccount; canClose: boolean; canDelete: boolean; canCancelInternalControl: boolean; canEditOverall: boolean; initialProgressVesselId?: string; readOnly?: boolean; close: () => void; onSave: (task: TaskItem, creating: boolean, expectedUpdatedAt: string, expectedRevision: number) => boolean; onSaveVesselProgress: (task: TaskItem, vesselId: string, expectedUpdatedAt: string, expectedRevision: number) => boolean; onDelete: () => void }) {
  useEscapeClose(close);
  const [draft, setDraft] = useState<TaskItem | null>(() => task ? clone(task) : null);
  const expectedUpdatedAtRef=useRef(task?.updatedAt||'');
  const expectedRevisionRef=useRef(data.revision);
  const [quickStatus, setQuickStatus] = useState('');
  const initialTaskScopeIds=task?taskVesselIds(task):[];
  const initialVisibleScopeIds=initialTaskScopeIds.filter(id=>visibleVessels.some(vessel=>vessel.id===id));
  const hasPerVesselProgress=Boolean(task&&usesPerVesselProgress(task));
  const [progressScope,setProgressScope]=useState(()=>hasPerVesselProgress
    ? (initialProgressVesselId&&initialVisibleScopeIds.includes(initialProgressVesselId)?initialProgressVesselId:initialVisibleScopeIds[0]||'')
    : 'overall');
  if (!draft) return null;
  const hasVisibleScope=taskVesselIds(draft).some(id=>visibleVessels.some(vessel=>vessel.id===id));
  if(!hasVisibleScope)return <div className="modal-backdrop"><div className="modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="task-restricted-title"><div className="modal-header"><div><h2 id="task-restricted-title">查看待辦</h2><small>仅显示负责人可见内容；船舶资料仍受权限保护</small></div><button className="btn ghost" onClick={close}>關閉</button></div><div className="detail-grid"><div><b>事项内容</b><RichTextContent value={draft.description} fallback="尚未输入事项内容"/></div><div><b>总体状态</b><RichTextContent value={draft.status} fallback="尚未更新状态"/></div><div><b>涉及部门</b><p>{draft.departments.join('、')||'未指定部门'}</p></div><div><b>预计完成</b><p>{draft.expectedDate||'未设定'}</p></div></div><div className="callout warning">您可因负责人关系查看本事项，但目前无权查看或修改相关船舶资料。</div></div></div>;
  const hasMeetingScope = Boolean(draft.sourceMeetingId);
  const perVesselMode=usesPerVesselProgress(draft);
  const taskScopeIds=taskVesselIds(draft);
  const visibleScopeIds=taskScopeIds.filter(id=>visibleVessels.some(vessel=>vessel.id===id));
  const editingSingleVessel=perVesselMode&&progressScope!=='overall';
  const globalReadOnly=readOnly||editingSingleVessel||(perVesselMode&&!canEditOverall);
  const change = (fn: (target: TaskItem) => void) => setDraft(previous => { if (!previous) return previous; const next=clone(previous); fn(next); next.updatedAt=nowIso(); next.updatedBy=currentUser.id; return next; });
  const selectedProgress=editingSingleVessel?taskProgressForVessel(draft,progressScope):{vesselId:'overall',status:draft.status,isClosed:draft.isClosed,closedDate:draft.closedDate,closedBy:draft.closedBy,updatedAt:draft.updatedAt,updatedBy:draft.updatedBy,statusLogs:draft.statusLogs};
  const changeProgress=(fn:(progress:ReturnType<typeof taskProgressForVessel>)=>void)=>change(target=>{
    if(progressScope==='overall'){
      const progress={vesselId:'overall',status:target.status,isClosed:target.isClosed,closedDate:target.closedDate,closedBy:target.closedBy,updatedAt:target.updatedAt,updatedBy:target.updatedBy,statusLogs:target.statusLogs};
      fn(progress);
      target.status=progress.status;target.isClosed=progress.isClosed;target.statusLogs=progress.statusLogs;
      if(progress.closedDate)target.closedDate=progress.closedDate;else delete target.closedDate;
      if(progress.closedBy)target.closedBy=progress.closedBy;else delete target.closedBy;
      return;
    }
    const progress=taskProgressForVessel(target,progressScope);
    fn(progress);
    target.vesselProgress=[progress,...(target.vesselProgress||[]).filter(item=>item.vesselId!==progressScope&&taskScopeIds.includes(item.vesselId))];
  });
  const addStatus = () => { const value=quickStatus.trim(); if(!value||readOnly)return; changeProgress(target=>{target.status=value;target.statusLogs.unshift({id:uid('log'),at:nowIso(),by:currentUser.name,text:value});});setQuickStatus(''); };
  const toggleClosed = () => {
    if (!canClose||readOnly) return alert('目前角色未獲授權結案或重新開啟待辦');
    if (selectedProgress.isClosed) {
      changeProgress(target=>{target.isClosed=false;delete target.closedDate;delete target.closedBy;});
      return;
    }
    const closedDate = askCompletionDate(selectedProgress.closedDate || todayDate());
    if (!closedDate) return;
    changeProgress(target=>{target.isClosed=true;target.closedDate=closedDate;target.closedBy=currentUser.id;});
  };
  const setCompletionDate = (closedDate: string) => {
    if (!canClose||readOnly) return alert('目前角色未獲授權結案或重新開啟待辦');
    changeProgress(target=>{
      if (closedDate) { target.isClosed=true; target.closedDate=closedDate; target.closedBy ||= currentUser.id; }
      else { target.isClosed=false; delete target.closedDate; delete target.closedBy; }
    });
  };
  const save = () => {
    if(editingSingleVessel){if(onSaveVesselProgress(draft,progressScope,expectedUpdatedAtRef.current,expectedRevisionRef.current))close();return;}
    const selectedCategories = Array.from(new Set(draft.categories || (draft.category ? [draft.category] : [])));
    if (creating && !draft.vesselId) return alert('請選擇船舶');
    if (creating && !draft.priority) return alert('請選擇關注程度');
    if (isRichTextEmpty(draft.description)) return alert('請填寫事項內容');
    if (creating && !selectedCategories.length) return alert('請選擇分類');
    if (creating && !draft.departments.length) return alert('請選擇涉及部門');
    const saved=clone(draft);
    saved.categories = selectedCategories;
    saved.category = saved.categories[0] || '';
    if (saved.isClosed) { saved.closedDate ||= todayDate(); saved.closedBy ||= currentUser.id; }
    else { delete saved.closedDate; delete saved.closedBy; }
    if (onSave(saved, creating, expectedUpdatedAtRef.current, expectedRevisionRef.current)) close();
  };
  const users=data.users.filter(user=>user.isActive);
  const taskScopeVessels=taskScopeIds.map(vesselId=>data.vessels.find(item=>item.id===vesselId)).filter((vessel): vessel is Vessel=>Boolean(vessel));
  const eligibleOwnerUsers=users.filter(user=>isEligibleTaskOwner(data.settings.rolePermissions,user,taskScopeVessels));
  const involvedUserIdsForVessel = (vesselId: string) => {
    const vessel = data.vessels.find(item => item.id === vesselId);
    const activeUserIds = new Set(users.filter(user => user.role !== 'vessel').map(user => user.id));
    return vessel ? vessel.assignedUserIds.filter(id => activeUserIds.has(id)) : [];
  };
  const progressSummary=taskVesselProgressSummary(draft,visibleScopeIds);
  const selectedVessel=data.vessels.find(vessel=>vessel.id===progressScope);
  const editorTitle=hasMeetingScope?(readOnly?'查看臨會／專題待辦':'更新臨會／專題待辦'):(creating?'新增要事':readOnly?'查看要事':'更新要事');
  const taskCategoryChoices = categoryChoicesForTask(draft, data.settings);
  return <div className="modal-backdrop"><div className="modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="task-edit-title"><div className="modal-header"><div><h2 id="task-edit-title">{editorTitle}</h2><small>{editingSingleVessel?`${vesselDisplayName(selectedVessel!)} 單船進度`:'總體進度'}｜{selectedProgress.isClosed?'已結案':'未結'}｜{readOnly?'只讀檢視':'按保存才會寫入資料'}</small></div><div className="heading-actions">{!readOnly&&!creating&&!editingSingleVessel&&canDelete&&<button className="btn red" onClick={onDelete}>刪除待辦</button>}{!readOnly&&canClose&&<button className={`btn ${selectedProgress.isClosed?'green':'red'}`} onClick={toggleClosed}>{selectedProgress.isClosed?'重新開啟':'標記結案'}</button>}<button className="btn ghost" onClick={close}>{readOnly?'關閉':'取消'}</button>{!readOnly&&<button className="btn primary" onClick={save}>{creating?'建立要事':'保存變更'}</button>}</div></div>
    <div className={readOnly?'read-only-body':''} aria-readonly={readOnly}>
    {perVesselMode&&<section className="vessel-progress-scope"><div className="field"><label>進度範圍</label><select aria-label="待辦進度範圍" value={progressScope} onChange={event=>{setProgressScope(event.target.value);setQuickStatus('');}}>{visibleScopeIds.map(id=>{const vessel=data.vessels.find(item=>item.id===id);return <option key={id} value={id}>單船進度｜{vessel?vesselDisplayName(vessel):id}</option>})}{canEditOverall&&<option value="overall">總體進度｜全部涉船</option>}</select></div><div className="progress-scope-note"><b>單船 {progressSummary.completed}/{progressSummary.total} 已結案</b><span>{editingSingleVessel?'目前操作只会更新所选船舶，不影响总体及其他船舶。':'目前操作会更新整项会议待办的总体进度。'}</span></div></section>}
    <fieldset disabled={globalReadOnly} className="task-global-fields"><div className="grid cols-3">
      <div className="field"><label>船舶{creating && <span className="danger-note" aria-hidden="true">＊</span>}</label>{hasMeetingScope?<div className="scope-result-note task-scope-readonly"><b>{taskVesselLabel(draft, visibleVessels)}</b><span>船種：{taskShipTypeLabel(draft, visibleVessels)}｜範圍由臨會／專題同步</span></div>:<select required={creating} aria-required={creating} value={draft.vesselId} onChange={event=>{const value=event.target.value;change(target=>{target.vesselId=value;if(creating)target.ownerUserIds=involvedUserIdsForVessel(value);});}}>{visibleVessels.map(vessel=><option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select>}</div>
      <div className="field"><label>{hasMeetingScope?'會議議題關注程度':'要事關注程度'}{creating && <span className="danger-note" aria-hidden="true">＊</span>}</label><select disabled={globalReadOnly||hasMeetingScope} required={creating} aria-required={creating} value={draft.priority} onChange={event=>{const value=event.target.value as TaskPriority;change(target=>{target.priority=value;});}}>{data.settings.priorities.map(priority=><option key={priority}>{priority}</option>)}</select>{hasMeetingScope&&<small>範圍與關注程度由臨會／專題同步</small>}</div>
      <div className="field span-3"><label>事項內容{creating && <span className="danger-note" aria-hidden="true">＊</span>}</label><RichTextEditor ariaLabel="事項內容" required={creating} readOnly={globalReadOnly} value={draft.description} onChange={value=>change(target=>{target.description=value;})}/></div>
      <div className="field span-2"><label>{perVesselMode?'總體狀態／決議':'目前狀態／決議'}</label><RichTextEditor ariaLabel="目前狀態／決議" readOnly={globalReadOnly} value={draft.status} onChange={value=>change(target=>{target.status=value;})}/></div>
      <div className="field"><label>預計完成日期</label><input type="date" value={draft.expectedDate} onChange={event=>{const value=event.target.value;change(target=>{target.expectedDate=value;});}}/></div>
      <div className="field"><label>報告日期</label><input type="date" value={draft.reportDate} onChange={event=>{const value=event.target.value;change(target=>{target.reportDate=value;});}}/></div>
      <label className="aware-toggle"><input type="checkbox" checked={draft.isAware} onChange={event=>{const value=event.target.checked;change(target=>{target.isAware=value;});}}/><span>標記為知曉事項</span></label>
      <label className="aware-toggle abnormal-toggle"><input type="checkbox" checked={draft.isAbnormal} onChange={event=>{const value=event.target.checked;change(target=>{target.isAbnormal=value;});}}/><span>異常（看板顯示「異常存在」）</span></label>
      <label className="aware-toggle internal-control-toggle"><input type="checkbox" checked={draft.isInternalControl} disabled={!creating&&Boolean(task?.isInternalControl)&&!canCancelInternalControl} onChange={event=>{const value=event.target.checked;if(draft.isInternalControl&&!value)alert(FLOW_INTERNAL_CONTROL_REMINDER);change(target=>{target.isInternalControl=value;if(value)target.isAbnormal=true;});}}/><span>內部管控（台面下異常管控）</span></label>
    </div>
    <CheckboxMultiPicker label={hasMeetingScope?'臨會/專題待辦分類':'要事分類'} required={creating} values={draft.categories || (draft.category ? [draft.category] : [])} choices={taskCategoryChoices.map(category=>({value:category,label:category}))} onChange={values=>change(target=>{target.categories=values;target.category=values[0]||'';})}/>
    <CheckboxMultiPicker label="涉及部門" required={creating} values={draft.departments} choices={data.settings.departments.map(department=>({value:department,label:department}))} onChange={values=>change(target=>{target.departments=values;})}/>
    {currentUser.role!=='vessel'&&<MeetingPeoplePicker label="追蹤窗口" users={eligibleOwnerUsers} departments={data.settings.departments} selectedIds={draft.ownerUserIds} onChange={values=>change(target=>{target.ownerUserIds=values;})} disabled={globalReadOnly}/>}</fieldset>
    {!creating&&<div className="grid cols-3 task-completion-date-row"><div className="field"><label>完成日期</label><input type="date" disabled={readOnly||!canClose} value={selectedProgress.closedDate||''} onChange={event=>setCompletionDate(event.target.value)}/><small>{selectedProgress.isClosed?'已結案日期；與「標記結案」彈出的日期同步':'選擇日期會同步標記為已結案'}</small></div></div>}
    {editingSingleVessel&&<div className="field vessel-progress-status"><label>單船目前狀態／決議｜{selectedVessel?vesselDisplayName(selectedVessel):progressScope}</label><RichTextEditor ariaLabel="單船目前狀態" readOnly={readOnly} value={selectedProgress.status} onChange={value=>changeProgress(target=>{target.status=value;})}/></div>}
    {!readOnly&&<div className="quick-status-bar"><input value={quickStatus} onChange={event=>setQuickStatus(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();addStatus();}}} placeholder={editingSingleVessel?'快速更新此船狀態…':'快速更新總體狀態…'}/><button className="btn primary" onClick={addStatus}>加入狀態紀錄</button></div>}
    <section className="status-history"><h3>{editingSingleVessel?'單船狀態歷程':'總體狀態歷程'}</h3>{selectedProgress.statusLogs.length?selectedProgress.statusLogs.map(log=><article key={log.id}><b>{log.text}</b><small>{new Date(log.at).toLocaleString('zh-TW')}｜{log.by}</small></article>):<p className="muted">尚無狀態紀錄</p>}</section></div>
  </div></div>;
}

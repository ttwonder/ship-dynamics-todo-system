import { useEffect, useState } from 'react';
import type { AppData, LoadStatus, NavigationStatus, ShipStatus, TaskItem, TaskPriority, UserAccount, Vessel, VesselCargoItem } from './types';
import { nowIso, todayDate, uid } from './utils';
import { FLOW_INTERNAL_CONTROL_REMINDER } from './taskWorkflow';
import { vesselDisplayName } from './vesselDisplay';

type Commit = (updater: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => void;
type MultiChoice = { value: string; label: string; detail?: string };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const priorityBadgeClass = (priority: TaskPriority) => priority === '急' ? 'urgent' : priority === '高' ? 'high' : priority === '中' ? 'mid' : 'low';
const cargoLines = (items: VesselCargoItem[]) => items.map(item => `${item.name}${item.quantity ? `｜${item.quantity}` : ''}`).join('\n');
export const scheduleInputValue = (value: string) => {
  const normalized = value.trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return `${normalized}T00:00`;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized) ? normalized.slice(0, 16) : '';
};
const parseCargoLines = (value: string): VesselCargoItem[] => value.split(/\r?\n/).map(line => {
  const [name = '', ...quantityParts] = line.split(/[｜|]/);
  return { name: name.trim(), quantity: quantityParts.join('｜').trim() };
}).filter(item => item.name || item.quantity);

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

export function VesselEditModal({ vessel, data, currentUser, close, commit, addTask, editTask }: { vessel?: Vessel; data: AppData; currentUser: UserAccount; close: () => void; commit: Commit; addTask: (vesselId: string) => void; editTask: (taskId: string) => void }) {
  useEscapeClose(close);
  if (!vessel) return null;
  const update = (change: (target: Vessel, draft: AppData) => void, detail: string) => commit(draft => {
    const target = draft.vessels.find(item => item.id === vessel.id);
    if (!target) return;
    change(target, draft);
    target.updatedAt = nowIso();
  }, '快速更新船舶', 'vessel', vessel.id, detail);
  const openTasks = data.tasks.filter(task => task.vesselId === vessel.id && !task.isClosed);
  return <div className="modal-backdrop"><div className="modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="vessel-edit-title"><div className="modal-header"><div><h2 id="vessel-edit-title">快速更新｜{vesselDisplayName(vessel)}</h2><small>修改後立即保存；按 Esc 可關閉</small></div><button className="btn ghost" onClick={close}>完成並關閉</button></div>
    <div className="smart-ship-api-note"><b>智慧船舶接口預留</b><span>上下港、位置、速度／拋錨／停泊、載況、ETA／ETB／ETD 與貨名貨量日後可自動同步；目前欄位同時支援手動修改，手動值會正常保存。</span></div>
    <div className="grid cols-4">
      <div className="field"><label>目前位置</label><input value={vessel.position.location} onChange={event => { const value = event.target.value; update(target => { target.position.location = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改目前位置'); }}/></div>
      <div className="field"><label>上一港</label><input value={vessel.position.lastPort} onChange={event => { const value = event.target.value; update(target => { target.position.lastPort = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改上一港'); }}/></div>
      <div className="field"><label>下一港</label><input value={vessel.position.nextPort} onChange={event => { const value = event.target.value; update(target => { target.position.nextPort = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改下一港'); }}/></div>
      <div className="field"><label>航行狀態</label><select value={vessel.position.navigationStatus} onChange={event => { const value = event.target.value as NavigationStatus; update(target => { target.position.navigationStatus = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改航行狀態'); }}><option>航行</option><option>拋錨</option><option>停泊</option></select></div>
      <div className="field"><label>速度（kn）</label><input type="number" min="0" step="0.1" value={vessel.position.speedKnots} onChange={event => { const value = Number(event.target.value || 0); update(target => { target.position.speedKnots = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改速度'); }}/></div>
      <div className="field"><label>載況</label><select value={vessel.cargo.loadStatus} onChange={event => { const value = event.target.value as LoadStatus; update(target => { target.cargo.loadStatus = value; target.cargo.source = 'manual'; target.cargo.updatedAt = nowIso(); }, '修改載況'); }}><option>空載</option><option>非空載</option><option>滿載</option></select></div>
      <div className="field"><label>ETA</label><input type="datetime-local" value={scheduleInputValue(vessel.position.eta)} onChange={event => { const value = event.target.value; update(target => { target.position.eta = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改 ETA'); }}/><small>選填；未選擇時顯示 TBA</small></div>
      <div className="field"><label>ETB</label><input type="datetime-local" value={scheduleInputValue(vessel.position.etb)} onChange={event => { const value = event.target.value; update(target => { target.position.etb = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改 ETB'); }}/><small>選填；未選擇時顯示 TBA</small></div>
      <div className="field"><label>ETD</label><input type="datetime-local" value={scheduleInputValue(vessel.position.etd)} onChange={event => { const value = event.target.value; update(target => { target.position.etd = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改 ETD'); }}/><small>選填；未選擇時顯示 TBA</small></div>
      <div className="field span-2"><label>多筆貨名／貨量</label><textarea value={cargoLines(vessel.cargo.items)} placeholder={'每行一筆，例如：\n原油｜28,000 MT\n柴油｜5,000 MT'} onChange={event => { const items = parseCargoLines(event.target.value); update(target => { target.cargo.items = items; target.cargo.name = items[0]?.name || ''; target.cargo.quantity = items[0]?.quantity || ''; target.cargo.source = 'manual'; target.cargo.updatedAt = nowIso(); }, `修改貨名貨量：${items.length} 筆`); }}/></div>
      <div className="field"><label>人工備註</label><input value={vessel.position.manualRemark} onChange={event => { const value = event.target.value; update(target => { target.position.manualRemark = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改人工動態備註'); }}/></div>
      <div className="field span-2"><label>近期／後續動態</label><textarea value={vessel.note.recentDynamics} onChange={event => { const value = event.target.value; update(target => { target.note.recentDynamics = value; target.note.subsequentDynamics = ''; target.note.updatedAt = nowIso(); }, '修改近期／後續動態'); }}/></div>
    </div>
    <CheckboxMultiPicker label="船舶狀態" values={vessel.note.statusList} choices={data.settings.vesselStatuses.map(status => ({ value: status, label: status }))} onChange={values => update(target => { target.note.statusList = values as ShipStatus[]; target.note.updatedAt = nowIso(); }, `修改船舶狀態：${values.join('、') || '無'}`)}/>
    <section className="modal-task-section"><div className="panel-title"><h3>未結要事 <span className="muted">({openTasks.length})</span></h3><button className="btn primary small" onClick={() => addTask(vessel.id)}>＋ 新增要事</button></div>{openTasks.length ? openTasks.map(task => <button key={task.id} className="modal-task-row" onClick={() => editTask(task.id)}><span className={`badge ${priorityBadgeClass(task.priority)}`}>{task.priority}</span><b>{task.isAbnormal && <span className="inline-abnormal">異常</span>}{task.description || '尚未輸入要事內容'}</b><small>{task.status || '尚未更新狀態'}｜期限 {task.expectedDate || '未設定'}</small></button>) : <div className="empty-state compact">目前沒有未結要事</div>}</section>
  </div></div>;
}

export function TaskEditModal({ task, creating = false, data, visibleVessels, currentUser, canClose, canDelete, canCancelInternalControl, readOnly = false, close, onSave, onDelete }: { task?: TaskItem; creating?: boolean; data: AppData; visibleVessels: Vessel[]; currentUser: UserAccount; canClose: boolean; canDelete: boolean; canCancelInternalControl: boolean; readOnly?: boolean; close: () => void; onSave: (task: TaskItem, creating: boolean) => boolean; onDelete: () => void }) {
  useEscapeClose(close);
  const [draft, setDraft] = useState<TaskItem | null>(() => task ? clone(task) : null);
  const [quickStatus, setQuickStatus] = useState('');
  if (!draft || !visibleVessels.some(vessel => vessel.id === draft.vesselId)) return null;
  const change = (fn: (target: TaskItem) => void) => setDraft(previous => { if (!previous) return previous; const next=clone(previous); fn(next); next.updatedAt=nowIso(); next.updatedBy=currentUser.id; return next; });
  const addStatus = () => { const value=quickStatus.trim(); if(!value)return; change(target=>{target.status=value;target.statusLogs.unshift({id:uid('log'),at:nowIso(),by:currentUser.name,text:value});});setQuickStatus(''); };
  const toggleClosed = () => { if (!canClose) return alert('目前角色未獲授權結案或重新開啟要事'); change(target=>{target.isClosed=!target.isClosed;if(target.isClosed){target.closedDate=todayDate();target.closedBy=currentUser.id;}else{delete target.closedDate;delete target.closedBy;}}); };
  const save = () => {
    const selectedCategories = Array.from(new Set(draft.categories || (draft.category ? [draft.category] : [])));
    if (creating && !draft.vesselId) return alert('請選擇船舶');
    if (creating && !draft.priority) return alert('請選擇關注程度');
    if (!draft.description.trim()) return alert('請填寫事項內容');
    if (creating && !selectedCategories.length) return alert('請選擇分類');
    if (creating && !draft.departments.length) return alert('請選擇涉及部門');
    const saved=clone(draft);
    saved.categories = selectedCategories;
    saved.category = saved.categories[0] || '';
    if (saved.isClosed) { saved.closedDate ||= todayDate(); saved.closedBy ||= currentUser.id; }
    else { delete saved.closedDate; delete saved.closedBy; }
    if (onSave(saved, creating)) close();
  };
  const users=data.users.filter(user=>user.isActive);
  const involvedUserIdsForVessel = (vesselId: string) => {
    const vessel = data.vessels.find(item => item.id === vesselId);
    const activeUserIds = new Set(users.filter(user => user.role !== 'vessel').map(user => user.id));
    return vessel ? vessel.assignedUserIds.filter(id => activeUserIds.has(id)) : [];
  };
  return <div className="modal-backdrop"><div className="modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="task-edit-title"><div className="modal-header"><div><h2 id="task-edit-title">{creating?'新增要事':readOnly?'查看要事':'更新要事'}</h2><small>{draft.isClosed?'已結案':'未結'}｜{readOnly?'只讀檢視':'按保存才會寫入資料'}</small></div><div className="heading-actions">{!readOnly&&!creating&&canDelete&&<button className="btn red" onClick={onDelete}>刪除待辦</button>}{!readOnly&&canClose && <button className={`btn ${draft.isClosed?'green':'red'}`} onClick={toggleClosed}>{draft.isClosed?'重新開啟':'標記結案'}</button>}<button className="btn ghost" onClick={close}>{readOnly?'關閉':'取消'}</button>{!readOnly&&<button className="btn primary" onClick={save}>{creating?'建立要事':'保存變更'}</button>}</div></div>
    <div className={readOnly?'read-only-body':''} aria-readonly={readOnly}>
    <div className="grid cols-3">
      <div className="field"><label>船舶{creating && <span className="danger-note" aria-hidden="true">＊</span>}</label><select required={creating} aria-required={creating} value={draft.vesselId} onChange={event=>{const value=event.target.value;change(target=>{target.vesselId=value;if(creating)target.ownerUserIds=involvedUserIdsForVessel(value);});}}>{visibleVessels.map(vessel=><option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select></div>
      <div className="field"><label>關注程度{creating && <span className="danger-note" aria-hidden="true">＊</span>}</label><select required={creating} aria-required={creating} value={draft.priority} onChange={event=>{const value=event.target.value as TaskPriority;change(target=>{target.priority=value;});}}>{data.settings.priorities.map(priority=><option key={priority}>{priority}</option>)}</select></div>
      <div className="field span-3"><label>事項內容{creating && <span className="danger-note" aria-hidden="true">＊</span>}</label><textarea required={creating} aria-required={creating} value={draft.description} onChange={event=>{const value=event.target.value;change(target=>{target.description=value;});}}/></div>
      <div className="field span-2"><label>目前狀態／決議</label><textarea value={draft.status} onChange={event=>{const value=event.target.value;change(target=>{target.status=value;});}}/></div>
      <div className="field"><label>預計完成日期</label><input type="date" value={draft.expectedDate} onChange={event=>{const value=event.target.value;change(target=>{target.expectedDate=value;});}}/></div>
      <label className="aware-toggle"><input type="checkbox" checked={draft.isAware} onChange={event=>{const value=event.target.checked;change(target=>{target.isAware=value;});}}/><span>標記為知曉事項</span></label>
      <label className="aware-toggle abnormal-toggle"><input type="checkbox" checked={draft.isAbnormal} onChange={event=>{const value=event.target.checked;change(target=>{target.isAbnormal=value;});}}/><span>異常（看板顯示「異常存在」）</span></label>
      <label className="aware-toggle internal-control-toggle"><input type="checkbox" checked={draft.isInternalControl} disabled={!creating&&Boolean(task?.isInternalControl)&&!canCancelInternalControl} onChange={event=>{const value=event.target.checked;if(draft.isInternalControl&&!value)alert(FLOW_INTERNAL_CONTROL_REMINDER);change(target=>{target.isInternalControl=value;if(value)target.isAbnormal=true;});}}/><span>內部管控（台面下異常管控）</span></label>
    </div>
    <CheckboxMultiPicker label="分類" required={creating} values={draft.categories || (draft.category ? [draft.category] : [])} choices={data.settings.taskCategories.map(category=>({value:category,label:category}))} onChange={values=>change(target=>{target.categories=values;target.category=values[0]||'';})}/>
    <CheckboxMultiPicker label="涉及部門" required={creating} values={draft.departments} choices={data.settings.departments.map(department=>({value:department,label:department}))} onChange={values=>change(target=>{target.departments=values;})}/>
    {creating&&currentUser.role!=='vessel'&&<CheckboxMultiPicker
      label="涉及人員"
      values={draft.ownerUserIds}
      choices={users.filter(user=>user.role!=='vessel').map(user=>({value:user.id,label:user.name,detail:user.department}))}
      onChange={values=>change(target=>{target.ownerUserIds=values;})}
    />}
    <div className="quick-status-bar"><input value={quickStatus} onChange={event=>setQuickStatus(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')addStatus();}} placeholder="現場快速更新狀態…"/><button className="btn primary" onClick={addStatus}>加入狀態紀錄</button></div>
    <section className="status-history"><h3>狀態歷程</h3>{draft.statusLogs.length?draft.statusLogs.map(log=><article key={log.id}><b>{log.text}</b><small>{new Date(log.at).toLocaleString('zh-TW')}｜{log.by}</small></article>):<p className="muted">尚無狀態紀錄</p>}</section></div>
  </div></div>;
}

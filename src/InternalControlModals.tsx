import { useState } from 'react';
import type { AppData, InternalControlCase, InternalControlReportSource, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import type { InternalControlTaskProjection } from './internalControlData';
import { validateInternalControlCase } from './internalControlWorkflow';
import { isEligibleTaskOwner } from './permissions';
import MeetingPeoplePicker from './MeetingPeoplePicker';
import { uid, todayDate } from './utils';
import { vesselDisplayName } from './vesselDisplay';

const REPORT_SOURCES: InternalControlReportSource[] = ['日常', '訪船', '隨船', '外部'];
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

type BatchRow = {
  key: string;
  description: string;
  priority: TaskPriority;
  category: string;
  equipmentSubcategory: string;
  isAware: boolean;
  status: string;
  departments: string[];
  closedDate: string;
  syncToTask: boolean;
  taskCategories: string[];
  taskEquipmentSubcategory: string;
  taskExpectedDate: string;
  taskOwnerUserIds: string[];
};

const newRow = (category: string): BatchRow => ({
  key: uid('ic-row'), description: '', priority: '低', category, equipmentSubcategory: '', isAware: false, status: '', departments: [], closedDate: '', syncToTask: false,
  taskCategories: category ? [category] : [], taskEquipmentSubcategory: '', taskExpectedDate: '', taskOwnerUserIds: [],
});

const defaultOwnerIds = (data: AppData, vesselId: string) => {
  const vessel = data.vessels.find(item => item.id === vesselId);
  if (!vessel) return [];
  const activeInternalIds = new Set(data.users.filter(user => user.isActive && user.role !== 'vessel').map(user => user.id));
  return vessel.assignedUserIds.filter(id => activeInternalIds.has(id));
};

function DepartmentPicker({ values, choices, onChange }: { values: string[]; choices: string[]; onChange: (values: string[]) => void }) {
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  return <fieldset className="ic-choice-picker" aria-required="true"><legend>涉及部門 * <span>已選 {values.length}</span></legend><div>{choices.map(value => <label key={value} className={values.includes(value) ? 'selected' : ''}><input type="checkbox" checked={values.includes(value)} onChange={() => toggle(value)}/><span>{value}</span></label>)}</div></fieldset>;
}

function TaskProjectionFields({ data, vesselId, projection, onChange }: { data: AppData; vesselId: string; projection: InternalControlTaskProjection; onChange: (projection: InternalControlTaskProjection) => void }) {
  const categoryChoices = unique([...data.settings.taskCategories, ...projection.categories, '設備故障']);
  const vessel = data.vessels.find(item => item.id === vesselId);
  const eligibleOwners = data.users.filter(user => user.isActive && vessel && isEligibleTaskOwner(data.settings.rolePermissions, user, [vessel]));
  const toggleCategory = (value: string) => onChange({ ...projection, categories: projection.categories.includes(value) ? projection.categories.filter(item => item !== value) : [...projection.categories, value] });
  return <section className="ic-task-projection" aria-label="同步要事設定">
    <div className="ic-task-projection-head"><h4>同步要事設定</h4><small>以下欄位直接寫入要事；必填規則與「新增要事」一致。</small></div>
    <fieldset className="ic-choice-picker" aria-required="true"><legend>要事分類 * <span>已選 {projection.categories.length}</span></legend><div>{categoryChoices.map(value => <label key={value} className={projection.categories.includes(value) ? 'selected' : ''}><input type="checkbox" checked={projection.categories.includes(value)} onChange={() => toggleCategory(value)}/><span>{value}</span></label>)}</div></fieldset>
    {projection.categories.includes('設備故障') && <div className="field"><label>要事設備故障細項 *</label><select required value={projection.equipmentSubcategory || ''} onChange={event => onChange({ ...projection, equipmentSubcategory: event.target.value || undefined })}><option value="">請選擇</option>{data.settings.equipmentFailureSubcategories.map(value => <option key={value}>{value}</option>)}</select></div>}
    <div className="grid cols-2 ic-task-projection-meta"><div className="field"><label>預計完成日期</label><input type="date" value={projection.expectedDate} onChange={event => onChange({ ...projection, expectedDate: event.target.value })}/></div><div className="field"><label>涉及部門 *</label><div className="scope-result-note"><b>沿用本案件涉及部門</b><span>請在上方至少選擇一個部門</span></div></div></div>
    <MeetingPeoplePicker label="追蹤窗口" users={eligibleOwners} departments={data.settings.departments} selectedIds={projection.ownerUserIds} onChange={ownerUserIds => onChange({ ...projection, ownerUserIds })}/>
  </section>;
}

export function BatchCreateModal({ data, user, vessels, close, save }: { data: AppData; user: UserAccount; vessels: Vessel[]; close: () => void; save: (items: InternalControlCase[], projections: Record<string, InternalControlTaskProjection>) => boolean }) {
  const categories = unique([...data.settings.taskCategories, '設備故障']);
  const [vesselId, setVesselId] = useState(vessels[0]?.id || '');
  const [reportDate, setReportDate] = useState(todayDate());
  const [reportSource, setReportSource] = useState<InternalControlReportSource>('日常');
  const [rows, setRows] = useState<BatchRow[]>([newRow(categories[0] || '設備故障')]);
  const update = (key: string, patch: Partial<BatchRow>) => setRows(previous => previous.map(row => row.key === key ? { ...row, ...patch } : row));
  const projectionFor = (row: BatchRow): InternalControlTaskProjection => ({ categories: row.taskCategories, equipmentSubcategory: row.taskEquipmentSubcategory || row.equipmentSubcategory || undefined, expectedDate: row.taskExpectedDate, ownerUserIds: row.taskOwnerUserIds });
  const submit = () => {
    const at = new Date().toISOString();
    const candidates: InternalControlCase[] = rows.map(row => ({
      id: uid('internal'), vesselId, reportDate, reportSource, description: row.description.trim(), priority: row.priority, category: row.category,
      equipmentSubcategory: row.category === '設備故障' ? row.equipmentSubcategory : undefined, isAware: row.isAware, status: row.status.trim(), departments: row.departments,
      syncToTask: row.syncToTask, isClosed: Boolean(row.closedDate), closedDate: row.closedDate || undefined, createdBy: user.id, updatedBy: user.id, createdAt: at, updatedAt: at, origin: 'internal-control', statusLogs: [],
    }));
    if (!vesselId || !reportDate || !reportSource) return alert('請完整填寫船舶、報告日期與報告來源');
    const errors = candidates.flatMap((item, index) => validateInternalControlCase(item).map(error => `第 ${index + 1} 筆：${error}`));
    rows.forEach((row, index) => {
      if (!row.syncToTask) return;
      if (!row.taskCategories.length) errors.push(`第 ${index + 1} 筆：要事分類`);
      if (row.taskCategories.includes('設備故障') && !(row.taskEquipmentSubcategory || row.equipmentSubcategory)) errors.push(`第 ${index + 1} 筆：要事設備故障細項`);
    });
    if (errors.length) return alert(errors.join('\n'));
    const projections = Object.fromEntries(candidates.map((item, index) => [item.id, projectionFor(rows[index])]).filter((_, index) => rows[index].syncToTask));
    save(candidates, projections);
  };
  const changeVessel = (nextVesselId: string) => {
    setVesselId(nextVesselId);
    setRows(previous => previous.map(row => row.syncToTask ? { ...row, taskOwnerUserIds: defaultOwnerIds(data, nextVesselId) } : row));
  };
  return <div className="modal-backdrop"><div className="modal ic-batch-modal" role="dialog" aria-modal="true" aria-labelledby="ic-batch-title">
    <div className="modal-head"><div><h2 id="ic-batch-title">批量新增內控異常</h2><p>共用船舶、報告日期及來源；保存後每列拆成獨立案件。</p></div><button className="btn ghost" onClick={close}>關閉</button></div>
    <div className="grid cols-3"><div className="field"><label>船舶 *</label><select value={vesselId} onChange={event => changeVessel(event.target.value)}>{vessels.map(vessel => <option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select></div><div className="field"><label>報告日期 *</label><input type="date" value={reportDate} onChange={event => setReportDate(event.target.value)}/></div><div className="field"><label>報告來源 *</label><select value={reportSource} onChange={event => setReportSource(event.target.value as InternalControlReportSource)}>{REPORT_SOURCES.map(source => <option key={source}>{source}</option>)}</select></div></div>
    <div className="ic-batch-rows">{rows.map((row, index) => <article className="ic-batch-row" key={row.key}>
      <div className="ic-batch-row-head"><h3>第 {index + 1} 筆</h3>{rows.length > 1 && <button className="btn small danger" onClick={() => setRows(previous => previous.filter(item => item.key !== row.key))}>刪除本筆</button>}</div>
      <div className="grid cols-3 ic-case-classification-row"><div className="field"><label>關注程度 *</label><select value={row.priority} onChange={event => update(row.key, { priority: event.target.value as TaskPriority })}>{data.settings.priorities.map(priority => <option key={priority}>{priority}</option>)}</select></div><div className="field"><label>事件分類 *</label><select value={row.category} onChange={event => { const category = event.target.value; update(row.key, { category, equipmentSubcategory: category === '設備故障' ? row.equipmentSubcategory : '', taskCategories: row.taskCategories.length <= 1 ? [category] : row.taskCategories }); }}>{categories.map(category => <option key={category}>{category}</option>)}</select></div><div className="field"><label>設備故障細項{row.category === '設備故障' ? ' *' : ''}</label><select disabled={row.category !== '設備故障'} value={row.equipmentSubcategory} onChange={event => update(row.key, { equipmentSubcategory: event.target.value })}><option value="">{row.category === '設備故障' ? '請選擇' : '不適用'}</option>{data.settings.equipmentFailureSubcategories.map(value => <option key={value}>{value}</option>)}</select></div></div>
      <div className="grid cols-2 ic-case-content-row"><div className="field"><label>事項內容 *</label><textarea value={row.description} onChange={event => update(row.key, { description: event.target.value })}/></div><div className="field"><label>解決計劃／最新狀態 *</label><textarea value={row.status} onChange={event => update(row.key, { status: event.target.value })}/></div></div>
      <div className="ic-inline-options"><label><input type="checkbox" checked={row.isAware} onChange={event => update(row.key, { isAware: event.target.checked })}/>標記為知曉事項</label><label><input type="checkbox" checked={row.syncToTask} onChange={event => update(row.key, { syncToTask: event.target.checked, taskCategories: row.taskCategories.length ? row.taskCategories : [row.category], taskOwnerUserIds: event.target.checked ? defaultOwnerIds(data, vesselId) : row.taskOwnerUserIds })}/>同步到要事</label><div className="field"><label>結案日期（可選）</label><input type="date" value={row.closedDate} onChange={event => update(row.key, { closedDate: event.target.value })}/></div></div>
      <DepartmentPicker values={row.departments} choices={data.settings.departments} onChange={departments => update(row.key, { departments })}/>
      {row.syncToTask && <TaskProjectionFields data={data} vesselId={vesselId} projection={projectionFor(row)} onChange={projection => update(row.key, { taskCategories: projection.categories, taskEquipmentSubcategory: projection.equipmentSubcategory || '', taskExpectedDate: projection.expectedDate, taskOwnerUserIds: projection.ownerUserIds })}/>}
    </article>)}</div>
    <div className="modal-actions"><button className="btn ghost" onClick={() => setRows(previous => [...previous, newRow(categories[0] || '設備故障')])}>＋ 新增一筆</button><button className="btn ghost" onClick={close}>取消</button><button className="btn primary" onClick={submit}>保存 {rows.length} 筆案件</button></div>
  </div></div>;
}

export function CaseEditModal({ item, data, vessels, canEdit, canClose, canDelete, close, save, onDelete }: { item: InternalControlCase; data: AppData; vessels: Vessel[]; canEdit: boolean; canClose: boolean; canDelete: boolean; close: () => void; save: (item: InternalControlCase, projection?: InternalControlTaskProjection) => boolean; onDelete: (item: InternalControlCase) => boolean }) {
  const linkedTask: TaskItem | undefined = item.linkedTaskId ? data.tasks.find(task => task.id === item.linkedTaskId) : undefined;
  const [draft, setDraft] = useState(item);
  const [projection, setProjection] = useState<InternalControlTaskProjection>({
    categories: linkedTask?.categories?.length ? [...linkedTask.categories] : (item.category ? [item.category] : []),
    equipmentSubcategory: linkedTask?.equipmentSubcategory || item.equipmentSubcategory,
    expectedDate: linkedTask?.expectedDate || '',
    ownerUserIds: linkedTask ? [...linkedTask.ownerUserIds] : defaultOwnerIds(data, item.vesselId),
  });
  const [logText, setLogText] = useState('');
  const categories = unique([...data.settings.taskCategories, draft.category, '設備故障']);
  const change = (patch: Partial<InternalControlCase>) => setDraft(previous => ({ ...previous, ...patch }));
  const addLog = () => { const text = logText.trim(); if (!text) return; setDraft(previous => ({ ...previous, status: text, statusLogs: [{ id: uid('client-log'), at: '', by: '', text }, ...previous.statusLogs] })); setLogText(''); };
  const submit = () => {
    const errors = validateInternalControlCase(draft);
    if (draft.syncToTask && !projection.categories.length) errors.push('要事分類');
    if (draft.syncToTask && projection.categories.includes('設備故障') && !projection.equipmentSubcategory) errors.push('要事設備故障細項');
    if (errors.length) return alert(`請完成：${errors.join('、')}`);
    save(draft, draft.syncToTask ? projection : undefined);
  };
  const vessel = vessels.find(entry => entry.id === draft.vesselId);
  return <div className="modal-backdrop"><div className="modal ic-edit-modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><h2>更新內控案件</h2><p>{vessel ? vesselDisplayName(vessel) : draft.vesselId}｜{draft.reportDate}｜{draft.reportSource}{draft.linkedTaskId ? '｜已同步要事' : '｜僅內控'}</p></div><button className="btn ghost" onClick={close}>關閉</button></div>
    <fieldset disabled={!canEdit}>
      <div className="grid cols-3"><div className="field"><label>船舶 *</label><select value={draft.vesselId} onChange={event => { const vesselId = event.target.value; change({ vesselId }); setProjection(previous => ({ ...previous, ownerUserIds: defaultOwnerIds(data, vesselId) })); }}>{vessels.map(value => <option key={value.id} value={value.id}>{vesselDisplayName(value)}</option>)}</select></div><div className="field"><label>報告日期 *</label><input type="date" value={draft.reportDate} onChange={event => change({ reportDate: event.target.value })}/></div><div className="field"><label>報告來源 *</label><select value={draft.reportSource} onChange={event => change({ reportSource: event.target.value as InternalControlReportSource })}>{REPORT_SOURCES.map(value => <option key={value}>{value}</option>)}</select></div></div>
      <div className="grid cols-3 ic-case-classification-row"><div className="field"><label>關注程度 *</label><select value={draft.priority} onChange={event => change({ priority: event.target.value as TaskPriority })}>{data.settings.priorities.map(priority => <option key={priority}>{priority}</option>)}</select></div><div className="field"><label>事件分類 *</label><select value={draft.category} onChange={event => change({ category: event.target.value, equipmentSubcategory: event.target.value === '設備故障' ? draft.equipmentSubcategory : undefined })}>{categories.map(category => <option key={category}>{category}</option>)}</select></div><div className="field"><label>設備故障細項{draft.category === '設備故障' ? ' *' : ''}</label><select disabled={draft.category !== '設備故障'} value={draft.equipmentSubcategory || ''} onChange={event => change({ equipmentSubcategory: event.target.value })}><option value="">{draft.category === '設備故障' ? '請選擇' : '不適用'}</option>{data.settings.equipmentFailureSubcategories.map(value => <option key={value}>{value}</option>)}</select></div></div>
      <div className="grid cols-2 ic-case-content-row"><div className="field"><label>事項內容 *</label><textarea value={draft.description} onChange={event => change({ description: event.target.value })}/></div><div className="field"><label>解決計劃／最新狀態 *</label><textarea value={draft.status} onChange={event => change({ status: event.target.value })}/></div></div>
      <div className="ic-inline-options"><label><input type="checkbox" checked={draft.isAware} onChange={event => change({ isAware: event.target.checked })}/>知曉事項</label><label><input type="checkbox" checked={draft.syncToTask} disabled={Boolean(item.linkedTaskId)} onChange={event => change({ syncToTask: event.target.checked })}/>{item.linkedTaskId ? '已同步要事' : '同步到要事'}</label></div>
      <DepartmentPicker values={draft.departments} choices={data.settings.departments} onChange={departments => change({ departments })}/>
      {draft.syncToTask && <TaskProjectionFields data={data} vesselId={draft.vesselId} projection={projection} onChange={setProjection}/>}
      <section className="ic-status-add"><h3>加入狀態記錄</h3><div><textarea value={logText} onChange={event => setLogText(event.target.value)} placeholder="輸入本次最新進度、處理結果或備註…"/><button type="button" className="btn green" onClick={addLog}>加入狀態記錄</button></div></section>
      <label className="ic-close-toggle"><input type="checkbox" disabled={!canClose} checked={draft.isClosed} onChange={event => change({ isClosed: event.target.checked, closedDate: event.target.checked ? (draft.closedDate || todayDate()) : undefined })}/>點擊結案</label>
    </fieldset>
    <section className="status-history"><h3>狀態歷程</h3>{draft.statusLogs.length ? draft.statusLogs.map(log => <article key={log.id}><b>{log.text}</b><small>{log.at ? new Date(log.at).toLocaleString('zh-TW') : '尚未保存'}｜{log.by || '目前使用者'}</small></article>) : <p className="muted">尚無狀態紀錄</p>}</section>
    <div className="modal-actions ic-edit-actions">{canDelete && <button className="btn danger" onClick={() => { if (confirm(`確定刪除此內控案件${item.linkedTaskId ? '及其關聯要事' : ''}？此操作不可復原。`)) onDelete(item); }}>刪除案件</button>}<span/><button className="btn ghost" onClick={close}>取消</button>{canEdit && <button className="btn primary" onClick={submit}>保存更新</button>}</div>
  </div></div>;
}

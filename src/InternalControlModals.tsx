import { useRef, useState } from 'react';
import type { AppData, InternalControlCase, InternalControlReportSource, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import type { InternalControlTaskProjection } from './internalControlData';
import { validateInternalControlCase } from './internalControlWorkflow';
import { isEligibleTaskOwner } from './permissions';
import MeetingPeoplePicker from './MeetingPeoplePicker';
import { uid, todayDate } from './runtimeUtils';
import { vesselDisplayName } from './vesselDisplay';
import { formatTaipeiDateTime } from './taipeiTime';
import { richTextToPlainText } from './richText';

const REPORT_SOURCES: InternalControlReportSource[] = ['日常', '訪船', '隨船', '外部'];
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const LINKED_TASK_ABNORMAL_PROMPT = '是否將這筆關聯要事勾選「近期內需要特別關注的異常」？\n\n按「確定」：勾選異常。\n按「取消」：不勾選異常，但仍會建立關聯要事。';
type TaskSyncChoice = { syncToTask: false } | { syncToTask: true; isAbnormal: boolean };

export function internalControlTaskSyncChoice(
  checked: boolean,
  confirmChoice: (message: string) => boolean = message => window.confirm(message),
): TaskSyncChoice {
  if (!checked) return { syncToTask: false };
  return { syncToTask: true, isAbnormal: confirmChoice(LINKED_TASK_ABNORMAL_PROMPT) };
}

export type InternalControlBatchRow = {
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
  taskIsAbnormal: boolean;
};

export const newInternalControlBatchRow = (category: string): InternalControlBatchRow => ({
  key: uid('ic-row'), description: '', priority: '低', category, equipmentSubcategory: '', isAware: false, status: '', departments: [], closedDate: '', syncToTask: false,
  taskCategories: category ? [category] : [], taskEquipmentSubcategory: '', taskExpectedDate: '', taskOwnerUserIds: [], taskIsAbnormal: false,
});

export type InternalControlBatchCatalog = Pick<AppData['settings'], 'taskCategories' | 'priorities' | 'equipmentFailureSubcategories' | 'departments'> & {
  owners: UserAccount[];
  defaultOwnerIds: string[];
};
export type InternalControlBatchDraft = {
  vesselId: string;
  reportDate: string;
  reportSource: InternalControlReportSource;
  reporterNameAndRole?: string;
  rows: InternalControlBatchRow[];
};
export type ShipInternalControlForm = {
  draft: InternalControlBatchDraft;
  catalog: Omit<InternalControlBatchCatalog, 'owners' | 'defaultOwnerIds'>;
  busy: boolean;
  pending: boolean;
  message: string;
  onDraftChange: (draft: InternalControlBatchDraft) => void;
};
export const createInternalControlBatchDraft = (vesselId: string, category: string): InternalControlBatchDraft => ({
  vesselId, reportDate: todayDate(), reportSource: '日常', rows: [newInternalControlBatchRow(category)],
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

function catalogForVessel(data: AppData, vesselId: string): InternalControlBatchCatalog {
  const vessel = data.vessels.find(item => item.id === vesselId);
  return {
    taskCategories: data.settings.taskCategories, priorities: data.settings.priorities,
    equipmentFailureSubcategories: data.settings.equipmentFailureSubcategories, departments: data.settings.departments,
    owners: data.users.filter(user => user.isActive && vessel && isEligibleTaskOwner(data.settings.rolePermissions, user, [vessel])),
    defaultOwnerIds: defaultOwnerIds(data, vesselId),
  };
}

function TaskProjectionFields({ data, catalog: suppliedCatalog, vesselId, projection, onChange }: { data?: AppData; catalog?: InternalControlBatchCatalog; vesselId: string; projection: InternalControlTaskProjection; onChange: (projection: InternalControlTaskProjection) => void }) {
  const catalog = suppliedCatalog || catalogForVessel(data!, vesselId);
  const categoryChoices = unique([...catalog.taskCategories, ...projection.categories, '設備故障']);
  const eligibleOwners = catalog.owners;
  const toggleCategory = (value: string) => onChange({ ...projection, categories: projection.categories.includes(value) ? projection.categories.filter(item => item !== value) : [...projection.categories, value] });
  return <section className="ic-task-projection" aria-label="同步要事設定">
    <div className="ic-task-projection-head"><h4>同步要事設定</h4><small>以下欄位直接寫入要事；必填規則與「新增要事」一致。</small></div>
    <fieldset className="ic-choice-picker" aria-required="true"><legend>要事分類 * <span>已選 {projection.categories.length}</span></legend><div>{categoryChoices.map(value => <label key={value} className={projection.categories.includes(value) ? 'selected' : ''}><input type="checkbox" checked={projection.categories.includes(value)} onChange={() => toggleCategory(value)}/><span>{value}</span></label>)}</div></fieldset>
    {projection.categories.includes('設備故障') && <div className="field"><label>要事設備故障細項 *</label><select required value={projection.equipmentSubcategory || ''} onChange={event => onChange({ ...projection, equipmentSubcategory: event.target.value || undefined })}><option value="">請選擇</option>{catalog.equipmentFailureSubcategories.map(value => <option key={value}>{value}</option>)}</select></div>}
    <div className="grid cols-2 ic-task-projection-meta"><div className="field"><label>預計完成日期</label><input type="date" value={projection.expectedDate} onChange={event => onChange({ ...projection, expectedDate: event.target.value })}/></div><div className="field"><label>涉及部門 *</label><div className="scope-result-note"><b>沿用本案件涉及部門</b><span>請在上方至少選擇一個部門</span></div></div></div>
    <MeetingPeoplePicker label="追蹤窗口" users={eligibleOwners} departments={catalog.departments} selectedIds={projection.ownerUserIds} onChange={ownerUserIds => onChange({ ...projection, ownerUserIds })}/>
  </section>;
}

export function BatchCreateModal({ data, user, vessels, close, save, shipSubmission }: { data?: AppData; user: Pick<UserAccount, 'id'>; vessels: Array<Pick<Vessel, 'id' | 'name' | 'shortName' | 'fullName'>>; close: () => void; save: (items: InternalControlCase[], projections: Record<string, InternalControlTaskProjection>) => boolean | Promise<boolean>; shipSubmission?: ShipInternalControlForm }) {
  const [localDraft, setLocalDraft] = useState(() => createInternalControlBatchDraft(vessels[0]?.id || '', data?.settings.taskCategories[0] || '設備故障'));
  const draft = shipSubmission?.draft || localDraft;
  const { vesselId, reportDate, reportSource, rows } = draft;
  const catalog: InternalControlBatchCatalog = shipSubmission ? { ...shipSubmission.catalog, owners: [], defaultOwnerIds: [] } : catalogForVessel(data!, vesselId);
  const categories = unique([...catalog.taskCategories, '設備故障']);
  const setDraft = (next: InternalControlBatchDraft) => {
    if (shipSubmission) { if (!shipSubmission.busy && !shipSubmission.pending) shipSubmission.onDraftChange(next); }
    else setLocalDraft(next);
  };
  const setRows = (updateRows: (rows: InternalControlBatchRow[]) => InternalControlBatchRow[]) => setDraft({ ...draft, rows: updateRows(rows) });
  const update = (key: string, patch: Partial<InternalControlBatchRow>) => setRows(previous => previous.map(row => row.key === key ? { ...row, ...patch } : row));
  const projectionFor = (row: InternalControlBatchRow): InternalControlTaskProjection => ({ categories: row.taskCategories, equipmentSubcategory: row.taskEquipmentSubcategory || row.equipmentSubcategory || undefined, expectedDate: row.taskExpectedDate, ownerUserIds: row.taskOwnerUserIds, isAbnormal: row.taskIsAbnormal });
  const changeTaskSync = (row: InternalControlBatchRow, checked: boolean) => {
    const choice = internalControlTaskSyncChoice(checked);
    update(row.key, {
      syncToTask: choice.syncToTask,
      taskIsAbnormal: choice.syncToTask ? choice.isAbnormal : row.taskIsAbnormal,
      taskCategories: row.taskCategories.length ? row.taskCategories : [row.category],
      taskOwnerUserIds: choice.syncToTask ? catalog.defaultOwnerIds : row.taskOwnerUserIds,
    });
  };
  const submit = async () => {
    if (shipSubmission?.busy) return;
    const at = new Date().toISOString();
    const candidates: InternalControlCase[] = rows.map(row => ({
      id: uid('internal'), vesselId, reportDate, reportSource, description: row.description.trim(), priority: row.priority, category: row.category,
      equipmentSubcategory: row.category === '設備故障' ? row.equipmentSubcategory : undefined, isAware: row.isAware, status: row.status.trim(), departments: row.departments,
      syncToTask: shipSubmission ? false : row.syncToTask, isClosed: shipSubmission ? false : Boolean(row.closedDate), closedDate: shipSubmission ? undefined : row.closedDate || undefined, createdBy: user.id, updatedBy: user.id, createdAt: at, updatedAt: at, origin: 'internal-control', statusLogs: [],
    }));
    if (!vesselId || !reportDate || !reportSource) return alert('請完整填寫船舶、報告日期與報告來源');
    const errors = candidates.flatMap((item, index) => validateInternalControlCase(item).map(error => `第 ${index + 1} 筆：${error}`));
    rows.forEach((row, index) => {
      if (shipSubmission || !row.syncToTask) return;
      if (!row.taskCategories.length) errors.push(`第 ${index + 1} 筆：要事分類`);
      if (row.taskCategories.includes('設備故障') && !(row.taskEquipmentSubcategory || row.equipmentSubcategory)) errors.push(`第 ${index + 1} 筆：要事設備故障細項`);
    });
    if (errors.length) return alert(errors.join('\n'));
    const projections = Object.fromEntries(candidates.map((item, index) => [item.id, projectionFor(rows[index])]).filter((_, index) => !shipSubmission && rows[index].syncToTask));
    if (await save(candidates, projections)) close();
  };
  const changeVessel = (nextVesselId: string) => {
    if (shipSubmission) return;
    setDraft({ ...draft, vesselId: nextVesselId, rows: rows.map(row => row.syncToTask ? { ...row, taskOwnerUserIds: defaultOwnerIds(data!, nextVesselId) } : row) });
  };
  const fields = <>
    {shipSubmission && <div className="field ship-ic-reporter"><label htmlFor="ship-internal-reporter">報告人姓名＋職務 *</label><input id="ship-internal-reporter" type="text" required maxLength={120} placeholder="例如：王小明／大副" value={draft.reporterNameAndRole || ''} onChange={event => setDraft({ ...draft, reporterNameAndRole: event.target.value })}/><small>本批共用，會自動附在每筆事項內容末尾。{shipSubmission.pending && !draft.reporterNameAndRole && '舊版待確認提交將依原內容確認，不補寫或改動原提交。'}</small></div>}
    <div className="grid cols-3"><div className="field"><label>船舶 *</label><select value={vesselId} disabled={Boolean(shipSubmission)} onChange={event => changeVessel(event.target.value)}>{vessels.map(vessel => <option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select></div><div className="field"><label>報告日期 *</label><input type="date" value={reportDate} onChange={event => setDraft({ ...draft, reportDate: event.target.value })}/></div><div className="field"><label>報告來源 *</label><select value={reportSource} onChange={event => setDraft({ ...draft, reportSource: event.target.value as InternalControlReportSource })}>{REPORT_SOURCES.map(source => <option key={source}>{source}</option>)}</select></div></div>
    <div className="ic-batch-rows">{rows.map((row, index) => <article className="ic-batch-row" key={row.key}>
      <div className="ic-batch-row-head"><h3>第 {index + 1} 筆</h3>{rows.length > 1 && <button className="btn small danger" onClick={() => setRows(previous => previous.filter(item => item.key !== row.key))}>刪除本筆</button>}</div>
      <div className="grid cols-3 ic-case-classification-row"><div className="field"><label>關注程度 *</label><select value={row.priority} onChange={event => update(row.key, { priority: event.target.value as TaskPriority })}>{catalog.priorities.map(priority => <option key={priority}>{priority}</option>)}</select></div><div className="field"><label>事件分類 *</label><select value={row.category} onChange={event => { const category = event.target.value; update(row.key, { category, equipmentSubcategory: category === '設備故障' ? row.equipmentSubcategory : '', taskCategories: row.taskCategories.length <= 1 ? [category] : row.taskCategories }); }}>{categories.map(category => <option key={category}>{category}</option>)}</select></div><div className="field"><label>設備故障細項{row.category === '設備故障' ? ' *' : ''}</label><select disabled={row.category !== '設備故障'} value={row.equipmentSubcategory} onChange={event => update(row.key, { equipmentSubcategory: event.target.value })}><option value="">{row.category === '設備故障' ? '請選擇' : '不適用'}</option>{catalog.equipmentFailureSubcategories.map(value => <option key={value}>{value}</option>)}</select></div></div>
      <div className="grid cols-2 ic-case-content-row"><div className="field"><label>事項內容 *</label><textarea value={row.description} onChange={event => update(row.key, { description: event.target.value })}/></div><div className="field"><label>解決計劃／最新狀態 *</label><textarea value={row.status} onChange={event => update(row.key, { status: event.target.value })}/></div></div>
      <div className="ic-inline-options"><label><input type="checkbox" checked={row.isAware} onChange={event => update(row.key, { isAware: event.target.checked })}/>標記為知曉事項</label>{!shipSubmission && <label><input type="checkbox" checked={row.syncToTask} onChange={event => changeTaskSync(row, event.target.checked)}/>同步到要事</label>}{!shipSubmission && <div className="field"><label>結案日期（可選）</label><input type="date" value={row.closedDate} onChange={event => update(row.key, { closedDate: event.target.value })}/></div>}</div>
      <DepartmentPicker values={row.departments} choices={catalog.departments} onChange={departments => update(row.key, { departments })}/>
      {!shipSubmission && row.syncToTask && <TaskProjectionFields catalog={catalog} vesselId={vesselId} projection={projectionFor(row)} onChange={projection => update(row.key, { taskCategories: projection.categories, taskEquipmentSubcategory: projection.equipmentSubcategory || '', taskExpectedDate: projection.expectedDate, taskOwnerUserIds: projection.ownerUserIds, taskIsAbnormal: projection.isAbnormal === true })}/>}
    </article>)}</div>
  </>;
  return <div className="modal-backdrop"><div className="modal ic-batch-modal" role="dialog" aria-modal="true" aria-labelledby="ic-batch-title">
    <div className="modal-head"><div><h2 id="ic-batch-title">{shipSubmission ? '增加內控/訴求' : '批量新增內控異常'}</h2><p>共用船舶、報告日期及來源；保存後每列拆成獨立案件。</p></div><button className="btn ghost" onClick={close}>關閉</button></div>
    {shipSubmission?.message && <div className="ship-ic-form-notice" role="status">{shipSubmission.message}</div>}
    {shipSubmission && <p className="ship-ic-form-notice">提交成功後無法在船端修改；如需更正，請重新提交修正版，多餘項目由辦公室刪除。</p>}
    {shipSubmission ? <fieldset disabled={shipSubmission.busy || shipSubmission.pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{fields}</fieldset> : fields}
    <div className="modal-actions"><button className="btn ghost" disabled={Boolean(shipSubmission && (shipSubmission.busy || shipSubmission.pending || rows.length >= 100))} onClick={() => setRows(previous => [...previous, newInternalControlBatchRow(categories[0] || '設備故障')])}>＋ 新增一筆</button><button className="btn ghost" onClick={close}>{shipSubmission ? '關閉（保留草稿）' : '取消'}</button><button className="btn primary" disabled={shipSubmission?.busy} onClick={submit}>{shipSubmission ? (shipSubmission.busy ? '提交中…' : shipSubmission.pending ? '確認結果／重試相同提交' : `提交 ${rows.length} 筆`) : `保存 ${rows.length} 筆案件`}</button></div>
  </div></div>;
}

export function prepareInternalControlEditForSave(draft:InternalControlCase,pendingLogText=''):InternalControlCase {
  const next={...draft,status:draft.status.trim(),statusLogs:[...draft.statusLogs]};
  const append=(text:string)=>{next.status=text;next.statusLogs.unshift({id:uid('client-log'),at:'',by:'',text});};
  if(next.status&&next.status!==next.statusLogs[0]?.text.trim())append(next.status);
  const pending=pendingLogText.trim();
  if(pending&&(pending!==next.status||next.statusLogs.length===draft.statusLogs.length))append(pending);
  return next;
}

export function CaseEditModal({ item, data, vessels, canEdit, canClose, canDelete, showWithdrawSync, canWithdrawSync, withdrawSyncReason, close, save, onWithdrawSync, onDelete }: { item: InternalControlCase; data: AppData; vessels: Vessel[]; canEdit: boolean; canClose: boolean; canDelete: boolean; showWithdrawSync: boolean; canWithdrawSync: boolean; withdrawSyncReason: string; close: () => void; save: (item: InternalControlCase, projection?: InternalControlTaskProjection) => boolean | Promise<boolean>; onWithdrawSync: (item: InternalControlCase) => boolean | Promise<boolean>; onDelete: (item: InternalControlCase) => boolean | Promise<boolean> }) {
  const linkedTask: TaskItem | undefined = item.linkedTaskId ? data.tasks.find(task => task.id === item.linkedTaskId) : undefined;
  const [draft, setDraft] = useState(item);
  const [projection, setProjection] = useState<InternalControlTaskProjection>({
    categories: linkedTask?.categories?.length ? [...linkedTask.categories] : (item.category ? [item.category] : []),
    equipmentSubcategory: linkedTask?.equipmentSubcategory || item.equipmentSubcategory,
    expectedDate: linkedTask?.expectedDate || '',
    ownerUserIds: linkedTask ? [...linkedTask.ownerUserIds] : defaultOwnerIds(data, item.vesselId),
    isAbnormal: linkedTask?.isAbnormal ?? false,
  });
  const [logText, setLogText] = useState('');
  const [withdrawing,setWithdrawing]=useState(false);
  const [saving,setSaving]=useState(false);
  const savingRef=useRef(false);
  const categories = unique([...data.settings.taskCategories, draft.category, '設備故障']);
  const change = (patch: Partial<InternalControlCase>) => setDraft(previous => ({ ...previous, ...patch }));
  const changeTaskSync = (checked: boolean) => {
    const choice = internalControlTaskSyncChoice(checked);
    change({ syncToTask: choice.syncToTask });
    if (choice.syncToTask) setProjection(previous => ({ ...previous, isAbnormal: choice.isAbnormal }));
  };
  const addLog = () => { const text = logText.trim(); if (!text) return; setDraft(previous => ({ ...previous, status: text, statusLogs: [{ id: uid('client-log'), at: '', by: '', text }, ...previous.statusLogs] })); setLogText(''); };
  const submit = async (value=draft,confirmation='') => {
    if(!canEdit||savingRef.current||withdrawing)return;
    const candidate=prepareInternalControlEditForSave(value,logText);
    const errors = validateInternalControlCase(candidate);
    if (candidate.syncToTask && !projection.categories.length) errors.push('要事分類');
    if (candidate.syncToTask && projection.categories.includes('設備故障') && !projection.equipmentSubcategory) errors.push('要事設備故障細項');
    if (errors.length) return alert(`請完成：${errors.join('、')}`);
    if(confirmation&&!confirm(confirmation))return;
    savingRef.current=true;setSaving(true);
    try{if(await save(candidate,candidate.syncToTask?projection:undefined))close();}
    finally{savingRef.current=false;setSaving(false);}
  };
  const saveClosedState=()=>{
    if(!canClose)return;
    const isClosed=!item.isClosed;
    const confirmation=`確定${isClosed?'結案':'重新開啟'}此內控案件？\n\n本視窗的修改會一併保存${item.linkedTaskId?'，關聯要事也會同步更新':''}。雲端確認後才算完成。`;
    void submit({...draft,isClosed,closedDate:isClosed?(draft.closedDate||todayDate()):undefined},confirmation);
  };
  const withdrawSync=async()=>{
    if(!canWithdrawSync||withdrawing||savingRef.current)return;
    const taskLabel=richTextToPlainText(linkedTask?.description||'')||item.linkedTaskId||'關聯要事';
    if(!confirm(`確定撤回同步要事「${taskLabel}」？\n\n此操作會刪除由本案件自動建立的要事，但保留此內控案件及既有早會歷史。\n重新同步會建立新的要事，不會恢復原要事。\n本視窗尚未保存的其他修改不會一併保存。`))return;
    setWithdrawing(true);
    try{if(await onWithdrawSync(item))close();}
    finally{setWithdrawing(false);}
  };
  const vessel = vessels.find(entry => entry.id === draft.vesselId);
  return <div className="modal-backdrop"><div className="modal ic-edit-modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><h2>更新內控案件</h2><p>{vessel ? vesselDisplayName(vessel) : draft.vesselId}｜{draft.reportDate}｜{draft.reportSource}{draft.linkedTaskId ? '｜已同步要事' : '｜僅內控'}</p></div><button className="btn ghost" disabled={saving||withdrawing} onClick={close}>關閉</button></div>
    <fieldset disabled={!canEdit||saving||withdrawing}>
      <div className="grid cols-3"><div className="field"><label>船舶 *</label><select value={draft.vesselId} onChange={event => { const vesselId = event.target.value; change({ vesselId }); setProjection(previous => ({ ...previous, ownerUserIds: defaultOwnerIds(data, vesselId) })); }}>{vessels.map(value => <option key={value.id} value={value.id}>{vesselDisplayName(value)}</option>)}</select></div><div className="field"><label>報告日期 *</label><input type="date" value={draft.reportDate} onChange={event => change({ reportDate: event.target.value })}/></div><div className="field"><label>報告來源 *</label><select value={draft.reportSource} onChange={event => change({ reportSource: event.target.value as InternalControlReportSource })}>{REPORT_SOURCES.map(value => <option key={value}>{value}</option>)}</select></div></div>
      <div className="grid cols-3 ic-case-classification-row"><div className="field"><label>關注程度 *</label><select value={draft.priority} onChange={event => change({ priority: event.target.value as TaskPriority })}>{data.settings.priorities.map(priority => <option key={priority}>{priority}</option>)}</select></div><div className="field"><label>事件分類 *</label><select value={draft.category} onChange={event => change({ category: event.target.value, equipmentSubcategory: event.target.value === '設備故障' ? draft.equipmentSubcategory : undefined })}>{categories.map(category => <option key={category}>{category}</option>)}</select></div><div className="field"><label>設備故障細項{draft.category === '設備故障' ? ' *' : ''}</label><select disabled={draft.category !== '設備故障'} value={draft.equipmentSubcategory || ''} onChange={event => change({ equipmentSubcategory: event.target.value })}><option value="">{draft.category === '設備故障' ? '請選擇' : '不適用'}</option>{data.settings.equipmentFailureSubcategories.map(value => <option key={value}>{value}</option>)}</select></div></div>
      <div className="grid cols-2 ic-case-content-row"><div className="field"><label>事項內容 *</label><textarea value={draft.description} onChange={event => change({ description: event.target.value })}/></div><div className="field"><label>解決計劃／最新狀態 *</label><textarea value={draft.status} onChange={event => change({ status: event.target.value })}/></div></div>
      <div className="ic-inline-options"><label><input type="checkbox" checked={draft.isAware} onChange={event => change({ isAware: event.target.checked })}/>知曉事項</label><label><input type="checkbox" checked={draft.syncToTask} disabled={Boolean(item.linkedTaskId)} onChange={event => changeTaskSync(event.target.checked)}/>{item.linkedTaskId ? '已同步要事' : '同步到要事'}</label></div>
      <DepartmentPicker values={draft.departments} choices={data.settings.departments} onChange={departments => change({ departments })}/>
      {draft.syncToTask && <TaskProjectionFields data={data} vesselId={draft.vesselId} projection={projection} onChange={setProjection}/>}
      <section className="ic-status-add"><h3>加入狀態記錄</h3><div><textarea value={logText} onChange={event => setLogText(event.target.value)} placeholder="輸入本次最新進度、處理結果或備註…"/><button type="button" className="btn green" onClick={addLog}>加入狀態記錄</button></div></section>
      <label className="ic-close-toggle"><input type="checkbox" disabled={!canClose} checked={draft.isClosed} onChange={event => change({ isClosed: event.target.checked, closedDate: event.target.checked ? (draft.closedDate || todayDate()) : undefined })}/>點擊結案</label>
    </fieldset>
    <section className="status-history"><h3>狀態歷程</h3>{draft.statusLogs.length ? draft.statusLogs.map(log => <article key={log.id}><b>{log.text}</b><small>{log.at ? formatTaipeiDateTime(log.at) : '尚未保存'}｜{log.by || '目前使用者'}</small></article>) : <p className="muted">尚無狀態紀錄</p>}</section>
    <div className="modal-actions ic-edit-actions">{showWithdrawSync && <button type="button" className="btn red" disabled={!canWithdrawSync||withdrawing||saving} title={!canWithdrawSync?withdrawSyncReason:undefined} onClick={()=>void withdrawSync()}>{withdrawing?'撤回中…':'撤回同步要事'}</button>}{canDelete && <button className="btn danger" disabled={saving||withdrawing} onClick={async () => { if (confirm(`確定刪除此內控案件${item.linkedTaskId ? '及其關聯要事' : ''}？此操作不可復原。`) && await onDelete(item)) close(); }}>刪除案件</button>}<span/><button className="btn ghost" disabled={saving||withdrawing} onClick={close}>取消</button>{canEdit&&canClose&&<button type="button" className="btn green ic-close-save" disabled={saving||withdrawing} onClick={saveClosedState}>{item.isClosed?'重新開啟並保存':'結案並保存'}</button>}{canEdit && <button className="btn primary" disabled={saving||withdrawing} onClick={()=>void submit()}>{saving?'保存中…':'保存更新'}</button>}</div>
  </div></div>;
}

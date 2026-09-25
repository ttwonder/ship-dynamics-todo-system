import type { AppData, InternalControlCase } from '../types';
import { todayDate, uid } from '../runtimeUtils';
import { formatTaipeiDateTime } from '../taipeiTime';
import { prepareInternalControlEditForSave, newInternalControlBatchRow, type InternalControlBatchDraft } from '../InternalControlModals';
import { prefillTrackingCase, TRACKING_EDIT_FIELDS } from './trackingWorkflow';
import type { TrackingItem, TrackingKind, TrackingDeliveryStatus } from './trackingTypes';
import { TrackingItemFields } from './TrackingItemFields';
import { resolveTrackingGroup } from './trackingLifecycle';
import { TRACKING_HELP, trackingHelp, type TrackingAudience } from './trackingUiTypes';
import type { InternalControlTaskProjection } from '../internalControlData';
import type { TrackingUiCommand } from './trackingUiCommands';

export type TrackingAction = keyof typeof TRACKING_HELP;
export interface TrackingDraft {
  action: TrackingAction; rows: TrackingItem[]; originals: TrackingItem[];
  date: string; delivery: TrackingDeliveryStatus; outcome: 'completed' | 'cancelled';
  sync?: InternalControlBatchDraft; savedCases?: InternalControlCase[]; warnings: string[]; dirty: boolean;
}
export function newTrackingItem(vesselId: string, kind: TrackingKind): TrackingItem {
  return { id: uid('tracking'), vesselId, kind, requestType: kind === 'supply' ? 'spares' : 'repair', referenceNo: '', description: '', applicationDate: todayDate(), urgency: 'normal', expectedDate: '', progress: '', supplementalNotes: '', deliveryStatus: 'not-delivered', isClosed: false, createdBy: '', updatedBy: '', createdAt: '', updatedAt: '', statusLogs: [] };
}
export function makeTrackingDraft(action: TrackingAction, rows: TrackingItem[], data: AppData): TrackingDraft {
  const draft: TrackingDraft = { action, rows: structuredClone(rows), originals: structuredClone(rows), date: '', delivery: 'delivered', outcome: 'completed', warnings: [], dirty: false };
  if (action === 'sync') {
    const prefilled = rows.map(row => prefillTrackingCase(data, row, uid('internal')));
    draft.warnings = [...new Set(prefilled.flatMap(value => value.missingDepartments))].map(name => `缺少預設部門「${name}」，請從現有部門核對選擇；不會自動新增。`);
    if (rows.some(row => data.internalControlCases.some(item => item.vesselId === row.vesselId && item.description.includes(row.referenceNo)))) draft.warnings.push('已有相同編號文字的內控，可能重複，請核對；系統不會自動合併。');
    draft.sync = { vesselId: rows[0].vesselId, reportDate: rows[0].applicationDate, reportSource: '日常', rows: prefilled.map(({ item }, index) => ({ ...newInternalControlBatchRow(item.category), key: rows[index].id, sourceCaseId: item.id, sourceReference: `${rows[index].referenceNo}｜${rows[index].id}`, reportDate: item.reportDate, reportSource: item.reportSource, description: item.description, priority: item.priority, status: item.status, expectedDate: item.expectedDate, departments: item.departments })) };
  }
  return draft;
}
export function commandForTrackingDraft(draft: TrackingDraft, cases?: InternalControlCase[], projections: Record<string, InternalControlTaskProjection> = {}): TrackingUiCommand | null {
  const versions = draft.originals.map(row => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));
  switch (draft.action) {
    case 'create': return { type: 'create', items: draft.rows };
    case 'edit': return { type: 'edit', items: draft.rows.map((row, index) => ({ ...versions[index], changes: Object.fromEntries(TRACKING_EDIT_FIELDS.map(key => [key, row[key]])) })) };
    case 'progress': {
      const items = draft.rows.flatMap((row, index) => row.progress.trim() === draft.originals[index].progress ? [] : [{ ...versions[index], text: row.progress }]);
      return items.length ? { type: 'progress', items } : null;
    }
    case 'completion': return { type: 'edit', items: versions.map(version => ({ ...version, changes: { completionDate: draft.date } })) };
    case 'delivery': return { type: 'delivery', items: versions.map(version => ({ ...version, status: draft.delivery, date: draft.date })) };
    case 'sync': if (!cases || cases.length !== versions.length) throw new Error('同步表單與來源集合不一致');
      if(draft.savedCases)return {type:'sync-edit',items:versions.map((version,index)=>{
        const previous=draft.savedCases![index],form=cases[index];
        const item=prepareInternalControlEditForSave({...previous,...Object.fromEntries(['reportDate','reportSource','description','priority','category','equipmentSubcategory','isAware','status','departments','expectedDate','syncToTask'].map(key=>[key,form[key as keyof InternalControlCase]]))});
        return {...version,item,expectedCaseUpdatedAt:previous.updatedAt,projection:projections[item.id]};
      })};
      return { type: 'sync', items: versions.map((version, index) => ({ ...version, item: cases[index], projection: projections[cases[index].id] })) };
    default: return { type: 'lifecycle', action: draft.action, date: draft.date, outcome: draft.outcome, targets: versions.map(version => ({ ...version, entry: 'tracking' })) };
  }
}
export function trackingAffectedLabels(data: AppData, rows: TrackingItem[]) {
  return rows.map(row => { const group = resolveTrackingGroup(data, row.id); return `${row.referenceNo} ${row.subitemNo || ''} [${row.id}]${group.item ? ` → 內控 [${group.item.id}] ${group.item.description}` : '（僅來源）'}${group.task ? ` → 要事 [${group.task.id}]` : ''}`; });
}
export function TrackingBusinessModal({ draft, busy, pending, readOnly=false, audience='shore', message, affected, vesselName, onChange, onSave, onReconcile, onClose }: {
  draft: TrackingDraft; busy: boolean; pending: boolean; readOnly?: boolean; audience?: TrackingAudience; message: string; affected: string[]; vesselName: string;
  onChange: (draft: TrackingDraft) => void; onSave: () => void; onReconcile: () => void; onClose: () => void;
}) {
  const titles: Record<TrackingAction, string> = { create: '新增／批量新增跟蹤', edit: '編輯／批量更新跟蹤項目', progress: '批量更新最新進度', completion: '工程完工／更正', delivery: '送達確認／更正', close: '結案', reopen: '重開此案', 'correct-close-date': '修改結案日期', sync: '同步到內控' };
  const change = (patch: Partial<TrackingDraft>) => onChange({ ...draft, ...patch, dirty: true });
  const update = (id: string, patch: Partial<TrackingItem>) => change({ rows: draft.rows.map(row => row.id === id ? { ...row, ...patch } : row) });
  const formFields = ['create', 'edit'].includes(draft.action);
  return <div className="modal-backdrop"><form className={`modal tracking-modal${draft.action === 'progress' ? ' tracking-progress-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="tracking-modal-title" onSubmit={event => { event.preventDefault(); if (!busy) onSave(); }}>
    <div className="modal-head"><h2 id="tracking-modal-title">{titles[draft.action]}</h2><button type="button" className="btn ghost" onClick={onClose}>關閉</button></div>
    <p>{trackingHelp(audience)[draft.action]}</p><p>本次精確選取 {draft.rows.length} 項（每批上限 100 項）。只有伺服器確認後才算保存。</p>
    <label>本次固定船舶<input aria-label="本次固定船舶" value={vesselName} readOnly/></label>
    <fieldset disabled={readOnly} style={{border:0,padding:0,margin:0,minWidth:0}}>

    {!formFields && <ul className="tracking-affected" aria-label="實際影響範圍">{affected.map(label => <li key={label}>{label}</li>)}</ul>}
    {draft.action === 'progress' ? draft.rows.map(row => {
      const original = draft.originals.find(value => value.id === row.id);
      const history = original?.statusLogs || [];
      return <div className="tracking-progress-row" key={row.id}>
        <label htmlFor={`tracking-progress-${row.id}`}>{row.referenceNo} {row.subitemNo} [{row.id}]</label>
        <small>最新已讀值：{original?.progress || '（空白）'}</small>
        {!pending && draft.rows.length > 1 && <button type="button" className="btn small" onClick={() => change({ rows: draft.rows.filter(value => value.id !== row.id), originals: draft.originals.filter(value => value.id !== row.id) })}>從本批移除 {row.referenceNo}</button>}
        <textarea id={`tracking-progress-${row.id}`} aria-label={`${row.referenceNo} 最新進度`} value={row.progress} onChange={event => update(row.id, { progress: event.target.value })}/>
        <details className="tracking-progress-history" aria-label="進度更新記錄" open>
          <summary>進度更新記錄（{history.length}）</summary>
          {history.length ? <div>{history.map(log => <article key={log.id}><small><time dateTime={log.at}>{formatTaipeiDateTime(log.at)}</time>（UTC+8）｜{log.by}</small><p>{log.text}</p></article>)}</div> : <p>尚無已保存的進度記錄。</p>}
        </details>
      </div>;
    }) : formFields ? draft.rows.map((row, index) => <fieldset className="tracking-form-row" key={row.id}><legend>第 {index + 1} 筆｜{row.id}</legend>
      <TrackingItemFields row={row} prefix={`第 ${index + 1} 筆 `} creating={draft.action === 'create'} onChange={patch => update(row.id, patch)}/>
    {draft.action === 'create' && draft.rows.length > 1 && <button type="button" className="btn small danger" disabled={pending} onClick={() => change({ rows: draft.rows.filter(value => value.id !== row.id) })}>移除此列</button>}</fieldset>) : <>
      {draft.action === 'delivery' && <label>送船狀態<select aria-label="送船狀態" value={draft.delivery} onChange={event => change({ delivery: event.target.value as TrackingDeliveryStatus })}><option value="not-delivered">未送船</option><option value="partially-delivered">部分送船</option><option value="delivered">已送船（全部實際交到船）</option></select></label>}
      {draft.action !== 'reopen' && (draft.action !== 'delivery' || draft.delivery === 'delivered') && <label>{['delivery','completion'].includes(draft.action) ? '實際送達/完工日期' : '結案日期'} *<input aria-label={['delivery','completion'].includes(draft.action) ? '實際送達/完工日期' : '結案日期'} type="date" required value={draft.date} onChange={event => change({ date: event.target.value })}/></label>}
      {draft.action === 'close' && draft.rows.some(row => row.kind === 'engineering') && <label>工程結案結果<select aria-label="工程結案結果" value={draft.outcome} onChange={event => change({ outcome: event.target.value as TrackingDraft['outcome'] })}><option value="completed">正常結案（不代填完工日期）</option><option value="cancelled">取消結案</option></select></label>}
      {draft.action === 'correct-close-date' && <ul>{draft.rows.map(row => <li key={row.id}>{row.referenceNo}：{row.closedDate} → {draft.date || '請選擇新日期'}</li>)}</ul>}
    </>}
    </fieldset>
    {readOnly&&<p role="status">編輯鎖已失效或尚未取得；原輸入已唯讀保留，不能新增修改或保存。請重新取得編輯權並核對最新資料。</p>}
    {message && <p role="status">{message}</p>}{(pending||readOnly) && <button type="button" className="btn" disabled={busy} onClick={onReconcile}>{pending?'核對最新資料／解除已拒絕提交':'重新取得編輯權／核對最新資料'}</button>}
    <div className="modal-actions">{draft.action === 'create' && <button type="button" className="btn ghost" disabled={pending || draft.rows.length >= 100} onClick={() => change({ rows: [...draft.rows, newTrackingItem(draft.rows[0].vesselId, draft.rows[0].kind)] })}>＋ 新增一列</button>}<button type="button" className="btn ghost" onClick={onClose}>取消</button><button className="btn primary" disabled={busy||readOnly&&!pending}>{busy ? '等待雲端確認…' : pending ? '確認結果／重試相同提交' : `確認保存 ${draft.rows.length} 項`}</button></div>
  </form></div>;
}

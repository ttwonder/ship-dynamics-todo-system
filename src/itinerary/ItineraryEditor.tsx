import { useEffect, useMemo, useRef, useState } from 'react';
import { createBlankItineraryRow, createItineraryId, type ItineraryDocument, type ItineraryRow } from './itineraryTypes';
import { pendingOperationForDocument } from './itineraryOperation';
import { resequenceItineraryRows } from './itineraryDomain';
import { instantToWallTime, wallTimeToInstant } from './itineraryTime';
import { deleteItineraryDraft, itineraryDraftKey, saveItineraryDraft, type ItineraryPendingOperation } from './itineraryDraftStore';
import { validateItineraryDocument } from './itineraryValidation';
import type { ItineraryLease, ItineraryLeaseRenewResult, ItinerarySaveResult } from './itineraryCollaboration';
import UtcOffsetSelect from './UtcOffsetSelect';

interface ItineraryEditorProps {
  document: ItineraryDocument;
  initialDocument?: ItineraryDocument;
  initialPendingOperation?: ItineraryPendingOperation;
  lease: ItineraryLease;
  actorId: string;
  onSave: (document: ItineraryDocument, lease: ItineraryLease, operationId: string) => Promise<ItinerarySaveResult>;
  onRenewLease: (lease: ItineraryLease) => Promise<ItineraryLeaseRenewResult>;
  onCancel: (lease: ItineraryLease) => Promise<void>;
  onSaved: (document: ItineraryDocument) => void;
}

interface TimeCellProps {
  row: ItineraryRow;
  field: 'etaUtc' | 'etbUtc' | 'etcUtc' | 'etdUtc';
  disabled: boolean;
  onChange: (value: string | null) => void;
  onError: (message: string) => void;
}


function TimeCell({ row, field, disabled, onChange, onError }: TimeCellProps) {
  const local = row[field] && row.portTimeZone ? instantToWallTime(row[field] as string, row.portTimeZone) : null;
  const date = local?.ok ? local.date : '';
  const time = local?.ok ? local.time : '';
  const commit = (nextDate: string, nextTime: string) => {
    if (!nextDate) return onChange(null);
    if (!row.portTimeZone) return onError('請先為此列選擇 UTC Offset。');
    const result = wallTimeToInstant(nextDate, nextTime || '00:00', row.portTimeZone);
    if (!result.ok) return onError('日期、時間或 UTC Offset 無效，請重新選擇。');
    onChange(result.instant);
  };
  return <div className="itinerary-time-inputs">
    <input type="date" value={date} disabled={disabled} onChange={event=>commit(event.target.value,time||'00:00')}/>
    <input type="time" value={time} disabled={disabled||!date} onChange={event=>commit(date,event.target.value)}/>
    <button type="button" disabled={disabled||!row[field]} onClick={()=>onChange(null)} aria-label="清除時間">×</button>
  </div>;
}

function cloneDocument(document: ItineraryDocument): ItineraryDocument {
  return structuredClone(document);
}

function saveError(result: Exclude<ItinerarySaveResult, { ok: true }>): string {
  if (result.code === 'revision-conflict') return `雲端已有較新版本（Revision ${result.currentRevision ?? '未知'}），本次未覆蓋；草稿已保留。`;
  if (result.code === 'lease-expired' || result.code === 'lease-mismatch') return '編輯鎖已失效，本次未保存；草稿已保留。';
  if (result.code === 'operation-mismatch') return '保存操作識別與內容不一致，已停止重試以避免重複寫入。';
  if (result.code === 'unknown-outcome') return '保存結果仍無法確認；草稿與相同操作識別已保留，可重試相同內容。';
  return result.message || '文件驗證未通過，本次未保存。';
}

export default function ItineraryEditor({ document, initialDocument, initialPendingOperation, lease: initialLease, actorId, onSave, onRenewLease, onCancel, onSaved }: ItineraryEditorProps) {
  const [draft, setDraft] = useState<ItineraryDocument>(() => cloneDocument(initialDocument || document));
  const [lease, setLease] = useState(initialLease);
  const [dirty, setDirty] = useState(Boolean(initialDocument));
  const [saving, setSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [message, setMessage] = useState(initialDocument ? '已恢復此瀏覽器保存的草稿。' : '');
  const [idleWarning, setIdleWarning] = useState(false);
  const draftKey = useMemo(() => itineraryDraftKey(document.workspaceKey, document.vesselId, actorId), [document.workspaceKey, document.vesselId, actorId]);
  const lastActivity = useRef(Date.now());
  const dirtyRef = useRef(dirty);
  const draftRef = useRef(draft);
  const pendingOperationRef = useRef<ItineraryPendingOperation | null>(initialPendingOperation || null);
  dirtyRef.current = dirty;
  draftRef.current = draft;

  const touch = () => { lastActivity.current = Date.now(); setIdleWarning(false); };
  const updateDraft = (updater: (current: ItineraryDocument) => ItineraryDocument) => {
    if (readOnly || saving) return;
    pendingOperationRef.current = null;
    setDraft(current => updater(current));
    setDirty(true);
    setMessage('');
    touch();
  };
  const updateRow = (rowId: string, patch: Partial<ItineraryRow>) => updateDraft(current => ({
    ...current,
    rows: current.rows.map(row => row.rowId === rowId ? { ...row, ...patch } : row),
  }));

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void saveItineraryDraft({ key: draftKey, workspaceKey: draft.workspaceKey, vesselId: draft.vesselId, actorId, baseRevision: document.revision, savedAt: new Date().toISOString(), document: cloneDocument(draft), pendingOperation: pendingOperationRef.current || undefined });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, draftKey, actorId, document.revision]);

  useEffect(() => {
    if (readOnly) return;
    const timer = window.setInterval(() => {
      void onRenewLease(lease).then(result => {
        if (result.ok) setLease(result.lease);
        else {
          setReadOnly(true);
          setMessage('編輯鎖已失效；目前內容保持唯讀，草稿已保留。');
          void saveItineraryDraft({ key: draftKey, workspaceKey: draftRef.current.workspaceKey, vesselId: draftRef.current.vesselId, actorId, baseRevision: document.revision, savedAt: new Date().toISOString(), document: cloneDocument(draftRef.current), pendingOperation: pendingOperationRef.current || undefined });
        }
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [readOnly, lease, onRenewLease, draftKey, actorId, document.revision]);

  useEffect(() => {
    if (readOnly) return;
    const timer = window.setInterval(() => {
      const idleMs = Date.now() - lastActivity.current;
      if (idleMs >= 10 * 60_000) {
        setReadOnly(true);
        setMessage('已超過 10 分鐘沒有操作，編輯權已退出；草稿保留在此瀏覽器。');
        void saveItineraryDraft({ key: draftKey, workspaceKey: draftRef.current.workspaceKey, vesselId: draftRef.current.vesselId, actorId, baseRevision: document.revision, savedAt: new Date().toISOString(), document: cloneDocument(draftRef.current), pendingOperation: pendingOperationRef.current || undefined });
      } else if (idleMs >= 8 * 60_000) setIdleWarning(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [readOnly, draftKey, actorId, document.revision]);

  useEffect(() => {
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
      void saveItineraryDraft({ key: draftKey, workspaceKey: draftRef.current.workspaceKey, vesselId: draftRef.current.vesselId, actorId, baseRevision: document.revision, savedAt: new Date().toISOString(), document: cloneDocument(draftRef.current), pendingOperation: pendingOperationRef.current || undefined });
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [draftKey, actorId, document.revision]);

  const addRow = () => updateDraft(current => {
    const row = createBlankItineraryRow(createItineraryId('row'), current.rows.length);
    row.portTimeZone = current.rows[current.rows.length - 1]?.portTimeZone || 'UTC+8';
    return { ...current, rows: [...current.rows, row] };
  });
  const removeRow = (rowId: string) => updateDraft(current => {
    if (current.rows.length === 1) return { ...current, rows: [createBlankItineraryRow(current.rows[0].rowId, 0)] };
    return { ...current, rows: resequenceItineraryRows(current.rows.filter(row => row.rowId !== rowId)) };
  });

  const submit = async () => {
    if (readOnly || saving) return;
    const candidate = { ...draft, rows: resequenceItineraryRows(draft.rows) };
    const validation = validateItineraryDocument(candidate);
    if (validation.ok === false) {
      setMessage(validation.errors.slice(0, 3).map(error => error.message).join('；'));
      return;
    }
    setSaving(true);
    setMessage('正在保存並等待確認…');
    pendingOperationRef.current = pendingOperationForDocument(candidate, pendingOperationRef.current);
    const operationId = pendingOperationRef.current.id;
    await saveItineraryDraft({ key: draftKey, workspaceKey: candidate.workspaceKey, vesselId: candidate.vesselId, actorId, baseRevision: document.revision, savedAt: new Date().toISOString(), document: cloneDocument(candidate), pendingOperation: pendingOperationRef.current });
    try {
      const result = await onSave(candidate, lease, operationId);
      if (result.ok === true) {
        pendingOperationRef.current = null;
        setDirty(false);
        await deleteItineraryDraft(draftKey);
        onSaved(result.document);
        return;
      }
      setMessage(saveError(result));
      if (result.code !== 'unknown-outcome') {
        pendingOperationRef.current = null;
        await saveItineraryDraft({ key: draftKey, workspaceKey: candidate.workspaceKey, vesselId: candidate.vesselId, actorId, baseRevision: document.revision, savedAt: new Date().toISOString(), document: cloneDocument(candidate) });
      }
      if (result.code === 'revision-conflict' || result.code === 'lease-expired' || result.code === 'lease-mismatch' || result.code === 'operation-mismatch') setReadOnly(true);
    } catch {
      setMessage('保存結果無法確認；未顯示成功，草稿已保留。請保持此視窗並重試相同內容。');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (dirty && !window.confirm('取消將放棄這次尚未同步的修改；確定取消嗎？')) return;
    await deleteItineraryDraft(draftKey);
    await onCancel(lease);
  };
  const closePreservingDraft = async () => {
    await saveItineraryDraft({ key: draftKey, workspaceKey: draft.workspaceKey, vesselId: draft.vesselId, actorId, baseRevision: document.revision, savedAt: new Date().toISOString(), document: cloneDocument(draft), pendingOperation: pendingOperationRef.current || undefined });
    await onCancel(lease);
  };

  return <div className="modal-backdrop itinerary-editor-backdrop" role="presentation">
    <section className="modal itinerary-editor-modal" role="dialog" aria-modal="true" aria-labelledby="itinerary-editor-title" onPointerDown={touch} onKeyDown={touch}>
      <header className="itinerary-editor-head">
        <div><h2 id="itinerary-editor-title">手動修改｜{document.vesselName}</h2><p>Revision {document.revision}｜辦公室只修改 A:M；日期及時間以各港 UTC Offset 輸入。</p></div>
        <div className="itinerary-editor-head-actions">{readOnly&&dirty&&<button type="button" className="btn small red" onClick={cancel}>丟棄草稿</button>}<button type="button" className="btn ghost" onClick={readOnly&&dirty?closePreservingDraft:cancel}>{readOnly&&dirty?'關閉（保留草稿）':'取消編輯'}</button><button type="button" className="btn primary" disabled={readOnly||saving} onClick={submit}>{saving?'保存中…':'保存並同步'}</button></div>
      </header>
      {(message||idleWarning)&&<div className={`itinerary-editor-message ${readOnly?'error':idleWarning?'warning':''}`} role="status">{message||'已閒置 8 分鐘；再無操作將於 10 分鐘時退出可寫狀態並保留草稿。'}</div>}
      <div className="itinerary-editor-table-wrap">
        <table className="itinerary-editor-table"><thead><tr><th>#</th><th>Voy No.</th><th>Port &amp; Dock Name／時區</th><th>Loading / Unloading</th><th>B/F or I/F Qty (MT)</th><th>ETA (LT)</th><th>ETB (LT)</th><th>L/D rate</th><th>ETC (LT)</th><th>ETD (LT)</th><th>Arr Draft</th><th>Dep Draft</th><th>arr ROB</th><th>dep ROB</th><th>操作</th></tr></thead>
          <tbody>{draft.rows.map((row,index)=><tr key={row.rowId}>
            <td>{index+1}</td>
            <td><input value={row.voyageNumber} disabled={readOnly} onChange={event=>updateRow(row.rowId,{voyageNumber:event.target.value})}/></td>
            <td><div className="itinerary-port-zone-inline"><input title={row.portDockName} value={row.portDockName} disabled={readOnly} placeholder="Port / Dock" onChange={event=>updateRow(row.rowId,{portDockName:event.target.value})}/><UtcOffsetSelect className="itinerary-zone-input" value={row.portTimeZone} disabled={readOnly} onChange={value=>updateRow(row.rowId,{portTimeZone:value})}/></div></td>
            <td><select value={row.operation} disabled={readOnly} onChange={event=>updateRow(row.rowId,{operation:event.target.value as ItineraryRow['operation']})}><option value="">—</option><option value="Loading">Loading</option><option value="Unloading">Unloading</option></select></td>
            <td><input title={row.cargoQuantityText} value={row.cargoQuantityText} disabled={readOnly} onChange={event=>updateRow(row.rowId,{cargoQuantityText:event.target.value})}/></td>
            <td><TimeCell row={row} field="etaUtc" disabled={readOnly} onError={setMessage} onChange={value=>updateRow(row.rowId,{etaUtc:value,etaMode:'manual'})}/></td>
            <td><TimeCell row={row} field="etbUtc" disabled={readOnly} onError={setMessage} onChange={value=>updateRow(row.rowId,{etbUtc:value,etbMode:'manual'})}/></td>
            <td><input title={row.ldRateText} value={row.ldRateText} disabled={readOnly} onChange={event=>updateRow(row.rowId,{ldRateText:event.target.value})}/></td>
            <td><TimeCell row={row} field="etcUtc" disabled={readOnly} onError={setMessage} onChange={value=>updateRow(row.rowId,{etcUtc:value,etcMode:'manual'})}/></td>
            <td><TimeCell row={row} field="etdUtc" disabled={readOnly} onError={setMessage} onChange={value=>updateRow(row.rowId,{etdUtc:value,etdMode:'manual'})}/></td>
            <td><input title={row.arrivalDraftText} value={row.arrivalDraftText} disabled={readOnly} onChange={event=>updateRow(row.rowId,{arrivalDraftText:event.target.value})}/></td>
            <td><input title={row.departureDraftText} value={row.departureDraftText} disabled={readOnly} onChange={event=>updateRow(row.rowId,{departureDraftText:event.target.value})}/></td>
            <td><input title={row.arrivalRobText} value={row.arrivalRobText} disabled={readOnly} onChange={event=>updateRow(row.rowId,{arrivalRobText:event.target.value})}/></td>
            <td><input title={row.departureRobText} value={row.departureRobText} disabled={readOnly} onChange={event=>updateRow(row.rowId,{departureRobText:event.target.value})}/></td>
            <td><button type="button" className="btn small red" disabled={readOnly} onClick={()=>removeRow(row.rowId)}>刪列</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <footer className="itinerary-editor-foot"><button type="button" className="btn ghost" disabled={readOnly} onClick={addRow}>＋ 增加下一行</button><span>{dirty?'草稿會保存在此瀏覽器':'尚未修改'}</span></footer>
    </section>
  </div>;
}

import { useMemo } from 'react';
import { recalculateItineraryRows } from './itineraryDomain';
import { instantToWallTime, wallTimeToInstant } from './itineraryTime';
import { addShipDraftRow, removeShipDraftRow, updateShipDraftRow } from './shipItineraryModel';
import type { ItineraryDocument, ItineraryRow, ItineraryTimeMode } from './itineraryTypes';
import UtcOffsetSelect from './UtcOffsetSelect';

interface ShipItineraryEditorProps {
  document: ItineraryDocument;
  readOnly: boolean;
  canSave: boolean;
  remoteUpdated: boolean;
  saving: boolean;
  onChange: (document: ItineraryDocument) => void;
  onSave: () => void;
  onCancel: () => void;
  onClosePreservingDraft: () => void;
  onDiscardDraft: () => void;
  onSyncLatest: () => void;
  onExportDraft: () => void;
}

const timeFields = {
  etaUtc: 'etaMode', etbUtc: 'etbMode', etcUtc: 'etcMode', etdUtc: 'etdMode',
} as const;

type TimeField = keyof typeof timeFields;

function numeric(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function TimeInput({ row, field, allowAuto, disabled, onPatch }: { row: ItineraryRow; field: TimeField; allowAuto: boolean; disabled: boolean; onPatch: (patch: Partial<ItineraryRow>) => void }) {
  const modeField = timeFields[field];
  const mode = row[modeField] as ItineraryTimeMode;
  const wallResult = row[field] && row.portTimeZone ? instantToWallTime(row[field], row.portTimeZone) : null;
  const wall = wallResult?.ok ? wallResult : null;
  const applyWall = (date: string, time: string) => {
    if (!date) return onPatch({ [field]: null, [modeField]: 'manual' } as Partial<ItineraryRow>);
    if (!row.portTimeZone) return;
    const result = wallTimeToInstant(date, time || '00:00', row.portTimeZone);
    if (result.ok) onPatch({ [field]: result.instant, [modeField]: 'manual' } as Partial<ItineraryRow>);
  };
  const automatic = mode === 'auto';
  return <div className="ship-time-input">
    <button type="button" className={`ship-mode ${automatic ? 'auto' : 'manual'}`} disabled={disabled || !allowAuto} onClick={() => onPatch({ [modeField]: automatic ? 'manual' : 'auto' } as Partial<ItineraryRow>)}>{automatic ? 'A' : 'M'}</button>
    <input type="date" value={wall?.date || ''} disabled={disabled || automatic} onChange={event => applyWall(event.target.value, wall?.time || '00:00')} />
    <input type="time" value={wall?.time || ''} disabled={disabled || automatic || !wall?.date} onChange={event => applyWall(wall?.date || '', event.target.value)} />
  </div>;
}

export default function ShipItineraryEditor({ document, readOnly, canSave, remoteUpdated, saving, onChange, onSave, onCancel, onClosePreservingDraft, onDiscardDraft, onSyncLatest, onExportDraft }: ShipItineraryEditorProps) {
  const calculation = useMemo(() => recalculateItineraryRows(document.rows), [document.rows]);
  const patchRow = (rowId: string, patch: Partial<ItineraryRow>) => onChange(updateShipDraftRow(document, rowId, patch));

  return <section className="ship-editor" aria-label="船端 Itinerary 編輯器">
    {remoteUpdated && <div className="ship-conflict-banner"><b>辦公室已有更新，保存已暫停。</b><span>目前草稿仍在本機；先匯出草稿或直接載入最新，再繼續。</span><div><button className="btn ghost small" onClick={onExportDraft}>匯出目前草稿</button><button className="btn primary small" onClick={onSyncLatest}>同步最新</button></div></div>}
    {readOnly && !remoteUpdated && <div className="ship-conflict-banner"><b>編輯鎖已失效，畫面已凍結。</b><span>草稿仍保留，不會自動覆蓋雲端。</span></div>}
    <div className="ship-editor-scroll">
      <table className="ship-editor-table">
        <thead><tr><th>#</th><th>A Voy</th><th>B Port & Dock</th><th>C L/U</th><th>D Qty</th><th>E ETA</th><th>F ETB</th><th>G L/D rate</th><th>H ETC</th><th>I ETD</th><th>J Arr Draft</th><th>K Dep Draft</th><th>L arr ROB</th><th>M dep ROB</th><th>N UTC Offset</th><th>O Dist nm</th><th>P Speed kt</th><th>Q Sail h</th><th>R Wait h</th><th>S Tanks</th><th>T Qty MT</th><th>U Rate</th><th>V Op h</th><th>W Buffer d</th><th></th></tr></thead>
        <tbody>{document.rows.map((row, index) => <tr key={row.rowId}>
          <td className="ship-row-number">{index + 1}</td>
          <td><input value={row.voyageNumber} disabled={readOnly} onChange={event => patchRow(row.rowId, { voyageNumber: event.target.value })} /></td>
          <td><input value={row.portDockName} disabled={readOnly} onChange={event => patchRow(row.rowId, { portDockName: event.target.value })} /></td>
          <td><select value={row.operation} disabled={readOnly} onChange={event => patchRow(row.rowId, { operation: event.target.value as ItineraryRow['operation'] })}><option value="">—</option><option value="Loading">Loading</option><option value="Unloading">Unloading</option></select></td>
          <td><input value={row.cargoQuantityText} disabled={readOnly} onChange={event => patchRow(row.rowId, { cargoQuantityText: event.target.value })} /></td>
          <td><TimeInput row={row} field="etaUtc" allowAuto={index > 0} disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
          <td><TimeInput row={row} field="etbUtc" allowAuto disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
          <td><input value={row.ldRateText} disabled={readOnly} onChange={event => patchRow(row.rowId, { ldRateText: event.target.value })} /></td>
          <td><TimeInput row={row} field="etcUtc" allowAuto disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
          <td><TimeInput row={row} field="etdUtc" allowAuto disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
          <td><input value={row.arrivalDraftText} disabled={readOnly} onChange={event => patchRow(row.rowId, { arrivalDraftText: event.target.value })} /></td>
          <td><input value={row.departureDraftText} disabled={readOnly} onChange={event => patchRow(row.rowId, { departureDraftText: event.target.value })} /></td>
          <td><input value={row.arrivalRobText} disabled={readOnly} onChange={event => patchRow(row.rowId, { arrivalRobText: event.target.value })} /></td>
          <td><input value={row.departureRobText} disabled={readOnly} onChange={event => patchRow(row.rowId, { departureRobText: event.target.value })} /></td>
          <td><UtcOffsetSelect value={row.portTimeZone} disabled={readOnly} onChange={value => patchRow(row.rowId, { portTimeZone: value })} /></td>
          <td><input type="number" min="0" value={row.oceanDistanceNm ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { oceanDistanceNm: numeric(event.target.value) })} /></td>
          <td><input type="number" min="0" step="0.1" value={row.speedKnots ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { speedKnots: numeric(event.target.value) })} /></td>
          <td className="ship-derived">{row.sailingHours ?? '—'}</td>
          <td><input type="number" min="0" step="0.1" value={row.berthWaitHours ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { berthWaitHours: numeric(event.target.value) })} /></td>
          <td><input value={row.tanksText} disabled={readOnly} onChange={event => patchRow(row.rowId, { tanksText: event.target.value })} /></td>
          <td><input type="number" min="0" step="0.1" value={row.operationQuantityMt ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { operationQuantityMt: numeric(event.target.value) })} /></td>
          <td><input type="number" min="0" step="0.1" value={row.operationRateMtPerHour ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { operationRateMtPerHour: numeric(event.target.value) })} /></td>
          <td className="ship-derived">{row.operationHours === null ? '—' : row.operationHours.toFixed(1)}</td>
          <td><input type="number" min="0" step="0.05" value={row.departureBufferDays ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { departureBufferDays: numeric(event.target.value) })} /></td>
          <td><button type="button" className="ship-row-delete" disabled={readOnly || document.rows.length <= 1} onClick={() => onChange(removeShipDraftRow(document, row.rowId))}>×</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="ship-editor-footer">
      <button type="button" className="btn ghost small" disabled={readOnly} onClick={() => onChange(addShipDraftRow(document))}>＋ 下一行</button>
      <span className={!canSave || calculation.issues.length ? 'ship-issue' : 'ship-ok'}>{!canSave ? '請至少填寫一列資料' : calculation.issues.length ? `${calculation.issues.length} 個欄位待補` : '公式檢查正常'}</span>
      <div className="ship-editor-actions">
        {readOnly ? <><button className="btn ghost small" onClick={onClosePreservingDraft}>關閉（保留草稿）</button><button className="btn red small" onClick={onDiscardDraft}>丟棄草稿</button></> : <button className="btn ghost small" onClick={onCancel}>取消編輯</button>}
        <button className="btn primary small" disabled={readOnly || saving || remoteUpdated || !canSave} onClick={onSave}>{saving ? '保存中…' : '保存並同步'}</button>
      </div>
    </div>
  </section>;
}

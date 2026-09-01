import { useMemo, useRef, useState } from 'react';
import { recalculateItineraryRows } from './itineraryDomain';
import { instantToWallTime, wallTimeToInstant } from './itineraryTime';
import { ITINERARY_MAIN_FIELD_LABELS, ITINERARY_PARAMETER_FIELD_LABELS } from './itineraryFieldLayout';
import { addShipDraftRow, removeShipDraftRow, setAllShipTimesManual, setShipAutomaticCalculation, updateShipDraftRow } from './shipItineraryModel';
import type { ItineraryDocument, ItineraryRow, ItineraryTimeMode } from './itineraryTypes';
import UtcOffsetSelect from './UtcOffsetSelect';
import ItineraryOperationOptions from './ItineraryOperationOptions';

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
  const dateInputRef = useRef<HTMLInputElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);
  const applyCompleteWall = (source: 'date' | 'time') => {
    const date = dateInputRef.current?.value || '';
    let time = timeInputRef.current?.value || '';
    if (source === 'date' && date && !time) {
      time = '00:00';
      if (timeInputRef.current) timeInputRef.current.value = time;
    }
    if (!date || !time || !row.portTimeZone) return;
    const result = wallTimeToInstant(date, time, row.portTimeZone);
    if (result.ok) onPatch({ [field]: result.instant, [modeField]: 'manual' } as Partial<ItineraryRow>);
  };
  const clearIncomplete = () => {
    const date = dateInputRef.current?.value || '';
    const time = timeInputRef.current?.value || '';
    if ((!date || !time) && row[field]) onPatch({ [field]: null, [modeField]: 'manual' } as Partial<ItineraryRow>);
  };
  const automatic = mode === 'auto';
  const modeLabel = automatic ? '自' : '手';
  return <div className="ship-time-input">
    <button type="button" className={`ship-mode ${automatic ? 'auto' : 'manual'}`} title={allowAuto ? automatic ? '自動計算；點擊改為手動' : '手動輸入；點擊改為自動' : '第一列 ETA 必須手動輸入'} aria-label={allowAuto ? automatic ? '切換為手動輸入' : '切換為自動計算' : '第一列 ETA 手動輸入'} disabled={disabled || !allowAuto} onClick={() => onPatch({ [modeField]: automatic ? 'manual' : 'auto' } as Partial<ItineraryRow>)}>{modeLabel}</button>
    <input key={`${field}-date-${row.portTimeZone}-${row[field] || ''}`} ref={dateInputRef} type="date" defaultValue={wall?.date || ''} disabled={disabled || automatic} onChange={() => applyCompleteWall('date')} onBlur={clearIncomplete} />
    <input key={`${field}-time-${row.portTimeZone}-${row[field] || ''}`} ref={timeInputRef} type="time" defaultValue={wall?.time || ''} disabled={disabled || automatic} onChange={() => applyCompleteWall('time')} onBlur={clearIncomplete} />
  </div>;
}

function gapMessage(missing: Array<{ rowNumber: number; label: string }>): string {
  const grouped = new Map<number, string[]>();
  missing.forEach(item => grouped.set(item.rowNumber, [...(grouped.get(item.rowNumber) || []), item.label]));
  return [...grouped.entries()].map(([row, labels]) => `第 ${row} 列：${[...new Set(labels)].join('、')}`).join('\n');
}

export default function ShipItineraryEditor({ document, readOnly, canSave, remoteUpdated, saving, onChange, onSave, onCancel, onClosePreservingDraft, onDiscardDraft, onSyncLatest, onExportDraft }: ShipItineraryEditorProps) {
  const [modeMessage, setModeMessage] = useState('');
  const calculation = useMemo(() => recalculateItineraryRows(document.rows), [document.rows]);
  const patchRow = (rowId: string, patch: Partial<ItineraryRow>) => onChange(updateShipDraftRow(document, rowId, patch));

  const switchAllManual = () => {
    if (!window.confirm('切換後，所有 ETA／ETB／ETC／ETD 都改為手動輸入；修改右側參數將不再更新這些時間。確定繼續嗎？')) return;
    onChange(setAllShipTimesManual(document));
    setModeMessage('已切換為全手動輸入；目前計算結果已保留為手動值。');
  };

  const calculateAllAutomatic = () => {
    const result = setShipAutomaticCalculation(document);
    onChange(result.document);
    if (result.missing.length) {
      const details = gapMessage(result.missing);
      setModeMessage(`自動計算尚缺資料：\n${details}`);
      window.alert(`自動計算尚缺以下資料：\n${details}\n\n請補填後再按一次「一鍵自動計算」，或將個別時間欄切換為「手」。`);
      return;
    }
    setModeMessage('自動計算完成；後續修改右側參數時，標示「自」的時間會立即重算。');
  };

  return <section className="ship-editor" aria-label="船端 Itinerary 編輯器">
    {remoteUpdated && <div className="ship-conflict-banner"><b>辦公室已有更新，保存已暫停。</b><span>目前草稿仍在本機；先匯出草稿或直接載入最新，再繼續。</span><div><button className="btn ghost small" onClick={onExportDraft}>匯出目前草稿</button><button className="btn primary small" onClick={onSyncLatest}>同步最新</button></div></div>}
    {readOnly && !remoteUpdated && <div className="ship-conflict-banner"><b>編輯鎖已失效，畫面已凍結。</b><span>草稿仍保留，不會自動覆蓋雲端。</span></div>}
    <div className="ship-editor-mode-bar">
      <div><b>計算模式</b><span>單一時間欄可用「自／手」切換</span></div>
      <button type="button" className="btn ghost small" disabled={readOnly} onClick={switchAllManual}>全部手動輸入</button>
      <button type="button" className="btn primary small" disabled={readOnly} onClick={calculateAllAutomatic}>一鍵自動計算</button>
      {modeMessage && <span className="ship-mode-message" role="status">{modeMessage}</span>}
    </div>
    <div className="ship-editor-workspace">
      <section className="ship-editor-pane ship-editor-main-pane" aria-label="輸入與計算區">
        <header><b>輸入／計算區</b><span>與主頁 Itinerary 欄位一致</span></header>
        <div className="ship-editor-pane-scroll" tabIndex={0}>
          <table className="ship-editor-grid ship-editor-main-table">
            <thead><tr><th>#</th>{ITINERARY_MAIN_FIELD_LABELS.map(label => <th key={label}>{label}</th>)}<th>操作</th></tr></thead>
            <tbody>{document.rows.map((row, index) => <tr key={row.rowId}>
              <td className="ship-row-number">{index + 1}</td>
              <td><input value={row.voyageNumber} disabled={readOnly} onChange={event => patchRow(row.rowId, { voyageNumber: event.target.value })} /></td>
              <td><input value={row.portDockName} disabled={readOnly} onChange={event => patchRow(row.rowId, { portDockName: event.target.value })} /></td>
              <td><ItineraryOperationOptions value={row.operation} disabled={readOnly} onChange={operation => patchRow(row.rowId, { operation })}/></td>
              <td><textarea value={row.cargoQuantityText} disabled={readOnly} onChange={event => patchRow(row.rowId, { cargoQuantityText: event.target.value })} /></td>
              <td><TimeInput row={row} field="etaUtc" allowAuto={index > 0} disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
              <td><TimeInput row={row} field="etbUtc" allowAuto disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
              <td><input value={row.ldRateText} disabled={readOnly} onChange={event => patchRow(row.rowId, { ldRateText: event.target.value })} /></td>
              <td><TimeInput row={row} field="etcUtc" allowAuto disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
              <td><TimeInput row={row} field="etdUtc" allowAuto disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
              <td><textarea value={row.arrivalDraftText} disabled={readOnly} onChange={event => patchRow(row.rowId, { arrivalDraftText: event.target.value })} /></td>
              <td><textarea value={row.departureDraftText} disabled={readOnly} onChange={event => patchRow(row.rowId, { departureDraftText: event.target.value })} /></td>
              <td><textarea value={row.arrivalRobText} disabled={readOnly} onChange={event => patchRow(row.rowId, { arrivalRobText: event.target.value })} /></td>
              <td><textarea value={row.departureRobText} disabled={readOnly} onChange={event => patchRow(row.rowId, { departureRobText: event.target.value })} /></td>
              <td><button type="button" className="ship-row-delete" disabled={readOnly || document.rows.length <= 1} onClick={() => onChange(removeShipDraftRow(document, row.rowId))}>×</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="ship-editor-pane ship-editor-parameter-pane" aria-label="自動計算參數區">
        <header><b>自動計算用變化參數區</b><span>修改後即時更新「自」欄位</span></header>
        <div className="ship-editor-pane-scroll" tabIndex={0}>
          <table className="ship-editor-grid ship-editor-parameter-table">
            <thead><tr><th>#</th>{ITINERARY_PARAMETER_FIELD_LABELS.map(label => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{document.rows.map((row, index) => <tr key={row.rowId}>
              <td className="ship-row-number">{index + 1}</td>
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
            </tr>)}</tbody>
          </table>
        </div>
      </section>
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

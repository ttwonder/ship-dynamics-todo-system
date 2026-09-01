import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { recalculateItineraryRows } from './itineraryDomain';
import { instantToWallTime, wallTimeToInstant } from './itineraryTime';
import {
  ITINERARY_EDITOR_ACTION_WIDTH, ITINERARY_EDITOR_MAIN_COLUMN_WIDTHS, ITINERARY_EDITOR_MAIN_TABLE_WIDTH,
  ITINERARY_EDITOR_PARAMETER_COLUMN_WIDTHS, ITINERARY_EDITOR_PARAMETER_TABLE_WIDTH, ITINERARY_EDITOR_ROW_NUMBER_WIDTH,
  ITINERARY_MAIN_FIELD_LABELS, ITINERARY_PARAMETER_FIELD_LABELS,
} from './itineraryFieldLayout';
import {
  addShipDraftRow, removeShipDraftRow, setAllShipTimesManual, setShipAutomaticCalculation,
  shipCalculationStartTimeZonePatch, shipPortTimeZonePatch, shipTimeZonePatch, updateShipDraftRow,
} from './shipItineraryModel';
import {
  ITINERARY_TIME_ZONE_FIELDS, resolveItineraryTimeZone,
  type ItineraryDocument, type ItineraryRow, type ItineraryTimeField, type ItineraryTimeMode,
} from './itineraryTypes';
import ItineraryDateInput from './ItineraryDateInput';
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

function displayHours(value: number | null): string {
  if (value === null) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function TimeInput({ row, field, allowAuto, disabled, onPatch }: { row: ItineraryRow; field: TimeField; allowAuto: boolean; disabled: boolean; onPatch: (patch: Partial<ItineraryRow>) => void }) {
  const modeField = timeFields[field];
  const zoneField = ITINERARY_TIME_ZONE_FIELDS[field];
  const mode = row[modeField] as ItineraryTimeMode;
  const timeZone = resolveItineraryTimeZone(row, field);
  const wallResult = row[field] && timeZone ? instantToWallTime(row[field], timeZone) : null;
  const wall = wallResult?.ok ? wallResult : null;
  const timeInputRef = useRef<HTMLInputElement>(null);

  const commit = (date: string, time: string) => {
    if (!date) return onPatch({ [field]: null, [modeField]: 'manual' } as Partial<ItineraryRow>);
    if (!timeZone) return;
    const result = wallTimeToInstant(date, time || '00:00', timeZone);
    if (result.ok) onPatch({ [field]: result.instant, [modeField]: 'manual' } as Partial<ItineraryRow>);
  };

  const automatic = mode === 'auto';
  const modeLabel = automatic ? '自' : '手';
  const emptyZoneLabel = `跟隨港口（${row.portTimeZone || '未選'}）`;
  return <div className="ship-time-input">
    <button type="button" className={`ship-mode ${automatic ? 'auto' : 'manual'}`} title={allowAuto ? automatic ? '自動計算；點擊改為手動' : '手動輸入；點擊改為自動' : '只可手動輸入'} aria-label={allowAuto ? automatic ? '切換為手動輸入' : '切換為自動計算' : '手動輸入'} disabled={disabled || !allowAuto} onClick={() => onPatch({ [modeField]: automatic ? 'manual' : 'auto' } as Partial<ItineraryRow>)}>{modeLabel}</button>
    <ItineraryDateInput
      value={wall?.date || ''}
      disabled={disabled || automatic || !timeZone}
      ariaLabel={`${field.slice(0, 3).toUpperCase()} 日期`}
      onChange={date => {
        const time = timeInputRef.current?.value || wall?.time || '00:00';
        if (timeInputRef.current && !timeInputRef.current.value) timeInputRef.current.value = time;
        commit(date, time);
      }}
    />
    <input key={`${field}-time-${timeZone}-${row[field] || ''}`} ref={timeInputRef} type="time" defaultValue={wall?.time || ''} disabled={disabled || automatic || !timeZone || !wall?.date} onChange={event => commit(wall?.date || '', event.target.value)} />
    <UtcOffsetSelect
      className="ship-time-zone-select"
      value={row[zoneField]}
      emptyLabel={emptyZoneLabel}
      ariaLabel={`${field.slice(0, 3).toUpperCase()} UTC Offset`}
      disabled={disabled}
      onChange={value => onPatch(shipTimeZonePatch(row, field, value))}
    />
  </div>;
}

function CalculationStartInput({ row, disabled, onPatch }: { row: ItineraryRow; disabled: boolean; onPatch: (patch: Partial<ItineraryRow>) => void }) {
  const wallResult = row.calculationStartUtc && row.calculationStartTimeZone
    ? instantToWallTime(row.calculationStartUtc, row.calculationStartTimeZone) : null;
  const wall = wallResult?.ok ? wallResult : null;
  const timeInputRef = useRef<HTMLInputElement>(null);
  const commit = (date: string, time: string) => {
    if (!date) return onPatch({ calculationStartUtc: null });
    if (!row.calculationStartTimeZone) return;
    const result = wallTimeToInstant(date, time || '00:00', row.calculationStartTimeZone);
    if (result.ok) onPatch({ calculationStartUtc: result.instant });
  };
  const useNow = () => {
    if (!row.calculationStartTimeZone) return;
    const now = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    onPatch({ calculationStartUtc: now });
  };
  return <div className="ship-calculation-anchor" aria-label="首列 ETA 起算時間">
    <div className="ship-calculation-anchor-title"><b>首列 ETA 起算</b><span>當下時間＋Offset</span></div>
    <ItineraryDateInput value={wall?.date || ''} disabled={disabled || !row.calculationStartTimeZone} ariaLabel="首列 ETA 起算日期" onChange={date => commit(date, timeInputRef.current?.value || wall?.time || '00:00')} />
    <input key={`start-time-${row.calculationStartTimeZone}-${row.calculationStartUtc || ''}`} ref={timeInputRef} type="time" defaultValue={wall?.time || ''} disabled={disabled || !row.calculationStartTimeZone || !wall?.date} aria-label="首列 ETA 起算時間" onChange={event => commit(wall?.date || '', event.target.value)} />
    <UtcOffsetSelect value={row.calculationStartTimeZone} emptyLabel="起算 Offset" ariaLabel="首列 ETA 起算 UTC Offset" disabled={disabled} onChange={value => onPatch(shipCalculationStartTimeZonePatch(row, value))} />
    <button type="button" className="btn ghost small" disabled={disabled || !row.calculationStartTimeZone} onClick={useNow}>使用現在</button>
  </div>;
}

function gapMessage(missing: Array<{ rowNumber: number; label: string }>): string {
  const grouped = new Map<number, string[]>();
  missing.forEach(item => grouped.set(item.rowNumber, [...(grouped.get(item.rowNumber) || []), item.label]));
  return [...grouped.entries()].map(([row, labels]) => `第 ${row} 列：${[...new Set(labels)].join('、')}`).join('\n');
}

export default function ShipItineraryEditor({ document, readOnly, canSave, remoteUpdated, saving, onChange, onSave, onCancel, onClosePreservingDraft, onDiscardDraft, onSyncLatest, onExportDraft }: ShipItineraryEditorProps) {
  const [modeMessage, setModeMessage] = useState('');
  const [leftPanePercent, setLeftPanePercent] = useState(66);
  const resizing = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const calculation = useMemo(() => recalculateItineraryRows(document.rows), [document.rows]);
  const patchRow = (rowId: string, patch: Partial<ItineraryRow>) => onChange(updateShipDraftRow(document, rowId, patch));
  const firstRow = document.rows[0];

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
      setModeMessage(`自動計算尚缺必要的時間／Offset：\n${details}`);
      window.alert(`自動計算尚缺以下必要資料：\n${details}\n\n其他未填時數会按 0 計算，也可將個別時間欄切換為「手」。`);
      return;
    }
    setModeMessage('自動計算完成；未填的時數按 0 計算，後續修改參數時標示「自」的時間會立即重算。');
  };

  const resizeAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing.current || !workspaceRef.current) return;
    const bounds = workspaceRef.current.getBoundingClientRect();
    const percent = ((event.clientX - bounds.left) / bounds.width) * 100;
    setLeftPanePercent(Math.max(40, Math.min(82, Math.round(percent))));
  };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const stopResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizing.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const workspaceStyle = {
    '--ship-editor-left': `${leftPanePercent}fr`,
    '--ship-editor-right': `${100 - leftPanePercent}fr`,
  } as CSSProperties;

  return <section className="ship-editor" aria-label="船端 Itinerary 編輯器">
    {remoteUpdated && <div className="ship-conflict-banner"><b>辦公室已有更新，保存已暫停。</b><span>目前草稿仍在本機；先匯出草稿或直接載入最新，再繼續。</span><div><button className="btn ghost small" onClick={onExportDraft}>匯出目前草稿</button><button className="btn primary small" onClick={onSyncLatest}>同步最新</button></div></div>}
    {readOnly && !remoteUpdated && <div className="ship-conflict-banner"><b>編輯鎖已失效，畫面已凍結。</b><span>草稿仍保留，不會自動覆蓋雲端。</span></div>}
    <div className="ship-editor-mode-bar">
      {firstRow && <CalculationStartInput row={firstRow} disabled={readOnly} onPatch={patch => patchRow(firstRow.rowId, patch)} />}
      <div className="ship-editor-mode-actions"><button type="button" className="btn ghost small" disabled={readOnly} onClick={switchAllManual}>全部手動輸入</button><button type="button" className="btn primary small" disabled={readOnly} onClick={calculateAllAutomatic}>一鍵自動計算</button></div>
      {modeMessage && <span className="ship-mode-message" role="status">{modeMessage}</span>}
    </div>
    <div className="ship-editor-workspace" ref={workspaceRef} style={workspaceStyle}>
      <section className="ship-editor-pane ship-editor-main-pane" aria-label="輸入與計算區">
        <header><b>輸入／計算區</b><span>时间均为各欄指定 Offset 的 LT</span></header>
        <div className="ship-editor-pane-scroll" tabIndex={0}>
          <table className="ship-editor-grid ship-editor-main-table" style={{ width: ITINERARY_EDITOR_MAIN_TABLE_WIDTH }}>
            <colgroup><col style={{ width: ITINERARY_EDITOR_ROW_NUMBER_WIDTH }} />{ITINERARY_EDITOR_MAIN_COLUMN_WIDTHS.map((width, index) => <col key={`main-${index}`} style={{ width }} />)}<col style={{ width: ITINERARY_EDITOR_ACTION_WIDTH }} /></colgroup>
            <thead><tr><th>#</th>{ITINERARY_MAIN_FIELD_LABELS.map(label => <th key={label}>{label}</th>)}<th>操作</th></tr></thead>
            <tbody>{document.rows.map((row, index) => <tr key={row.rowId}>
              <td className="ship-row-number">{index + 1}</td>
              <td><input value={row.voyageNumber} disabled={readOnly} onChange={event => patchRow(row.rowId, { voyageNumber: event.target.value })} /></td>
              <td><input value={row.portDockName} disabled={readOnly} onChange={event => patchRow(row.rowId, { portDockName: event.target.value })} /></td>
              <td><UtcOffsetSelect value={row.portTimeZone} disabled={readOnly} ariaLabel="港口 UTC Offset" onChange={value => patchRow(row.rowId, shipPortTimeZonePatch(row, value))} /></td>
              <td><ItineraryOperationOptions value={row.operation} disabled={readOnly} onChange={operation => patchRow(row.rowId, { operation })}/></td>
              <td><textarea value={row.cargoQuantityText} disabled={readOnly} onChange={event => patchRow(row.rowId, { cargoQuantityText: event.target.value })} /></td>
              <td><TimeInput row={row} field="etaUtc" allowAuto disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
              <td><TimeInput row={row} field="etbUtc" allowAuto disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
              <td><input value={row.ldRateText} inputMode="decimal" disabled={readOnly} onChange={event => patchRow(row.rowId, { ldRateText: event.target.value })} /></td>
              <td><TimeInput row={row} field="etcUtc" allowAuto disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
              <td><TimeInput row={row} field="etdUtc" allowAuto disabled={readOnly} onPatch={patch => patchRow(row.rowId, patch)} /></td>
              <td><textarea value={row.arrivalDraftText} disabled={readOnly} onChange={event => patchRow(row.rowId, { arrivalDraftText: event.target.value })} /></td>
              <td><textarea value={row.departureDraftText} disabled={readOnly} onChange={event => patchRow(row.rowId, { departureDraftText: event.target.value })} /></td>
              <td><textarea value={row.arrivalRobText} disabled={readOnly} onChange={event => patchRow(row.rowId, { arrivalRobText: event.target.value })} /></td>
              <td><textarea value={row.departureRobText} disabled={readOnly} onChange={event => patchRow(row.rowId, { departureRobText: event.target.value })} /></td>
              <td><textarea value={row.notesText || ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { notesText: event.target.value })} /></td>
              <td><button type="button" className="ship-row-delete" disabled={readOnly || document.rows.length <= 1} onClick={() => onChange(removeShipDraftRow(document, row.rowId))}>×</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
      <div className="ship-editor-resizer" role="separator" aria-label="調整輸入區與參數區寬度" aria-orientation="vertical" aria-valuemin={40} aria-valuemax={82} aria-valuenow={leftPanePercent} tabIndex={0} onPointerDown={startResize} onPointerMove={resizeAt} onPointerUp={stopResize} onPointerCancel={stopResize} onKeyDown={event => { if (event.key === 'ArrowLeft') setLeftPanePercent(value => Math.max(40, value - 2)); if (event.key === 'ArrowRight') setLeftPanePercent(value => Math.min(82, value + 2)); }} />
      <section className="ship-editor-pane ship-editor-parameter-pane" aria-label="自動計算參數區">
        <header><b>自動計算用變化參數區</b><span>空白时数按 0；修改后即時更新「自」欄位</span></header>
        <div className="ship-editor-pane-scroll" tabIndex={0}>
          <table className="ship-editor-grid ship-editor-parameter-table" style={{ width: ITINERARY_EDITOR_PARAMETER_TABLE_WIDTH }}>
            <colgroup><col style={{ width: ITINERARY_EDITOR_ROW_NUMBER_WIDTH }} />{ITINERARY_EDITOR_PARAMETER_COLUMN_WIDTHS.map((width, index) => <col key={`parameter-${index}`} style={{ width }} />)}</colgroup>
            <thead><tr><th>#</th>{ITINERARY_PARAMETER_FIELD_LABELS.map(label => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{document.rows.map((row, index) => <tr key={row.rowId}>
              <td className="ship-row-number">{index + 1}</td>
              <td><input type="number" min="0" value={row.oceanDistanceNm ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { oceanDistanceNm: numeric(event.target.value) })} /></td>
              <td><input type="number" min="0" step="0.1" value={row.speedKnots ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { speedKnots: numeric(event.target.value) })} /></td>
              <td className="ship-derived">{displayHours(row.sailingHours)}</td>
              <td><input type="number" min="0" step="0.1" value={row.berthWaitHours ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { berthWaitHours: numeric(event.target.value) })} /></td>
              <td><input type="number" min="0" step="0.1" value={row.channelSailingHours ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { channelSailingHours: numeric(event.target.value) })} /></td>
              <td><input value={row.tanksText} disabled={readOnly} onChange={event => patchRow(row.rowId, { tanksText: event.target.value })} /></td>
              <td><input type="number" min="0" step="0.1" value={row.operationQuantityMt ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { operationQuantityMt: numeric(event.target.value) })} /></td>
              <td className="ship-derived">{row.operationRateMtPerHour === null ? '—' : displayHours(row.operationRateMtPerHour)}</td>
              <td className="ship-derived">{displayHours(row.operationHours)}</td>
              <td><input type="number" min="0" step="0.1" value={row.preCompletionDelayHours ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { preCompletionDelayHours: numeric(event.target.value) })} /></td>
              <td><input type="number" min="0" step="0.1" value={row.postCompletionDelayHours ?? ''} disabled={readOnly} onChange={event => patchRow(row.rowId, { postCompletionDelayHours: numeric(event.target.value), departureBufferDays: null })} /></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
    <div className="ship-editor-footer">
      <button type="button" className="btn ghost small" disabled={readOnly} onClick={() => onChange(addShipDraftRow(document))}>＋ 下一行</button>
      <span className={!canSave || calculation.issues.length ? 'ship-issue' : 'ship-ok'}>{!canSave ? '請至少填寫一列資料' : calculation.issues.length ? `${calculation.issues.length} 個欄位待確認` : '公式檢查正常'}</span>
      <div className="ship-editor-actions">
        {readOnly ? <><button className="btn ghost small" onClick={onClosePreservingDraft}>關閉（保留草稿）</button><button className="btn red small" onClick={onDiscardDraft}>丟棄草稿</button></> : <button className="btn ghost small" onClick={onCancel}>取消編輯</button>}
        <button className="btn primary small" disabled={readOnly || saving || remoteUpdated || !canSave} onClick={onSave}>{saving ? '保存中…' : '保存並同步'}</button>
      </div>
    </div>
  </section>;
}

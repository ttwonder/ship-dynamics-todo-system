import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { instantToWallTime, wallTimeToInstant } from './itineraryTime';
import {
  ITINERARY_EDITOR_ACTION_WIDTH, ITINERARY_EDITOR_MAIN_COLUMN_WIDTHS, ITINERARY_EDITOR_MAIN_TABLE_WIDTH,
  ITINERARY_EDITOR_PARAMETER_COLUMN_WIDTHS, ITINERARY_EDITOR_PARAMETER_TABLE_WIDTH, ITINERARY_EDITOR_ROW_NUMBER_WIDTH,
  ITINERARY_MAIN_FIELD_LABELS, ITINERARY_PARAMETER_FIELD_LABELS,
} from './itineraryFieldLayout';
import {
  parseItineraryRateText, shipPortTimeZonePatch, shipTimeZonePatch,
} from './shipItineraryModel';
import {
  ITINERARY_TIME_ZONE_FIELDS, resolveItineraryTimeZone,
  type ItineraryRow, type ItineraryTimeField, type ItineraryTimeMode,
} from './itineraryTypes';
import ItineraryDateInput from './ItineraryDateInput';
import ItineraryTimeInput from './ItineraryTimeInput';
import ItineraryNumericInput from './ItineraryNumericInput';
import UtcOffsetSelect from './UtcOffsetSelect';
import ItineraryOperationOptions from './ItineraryOperationOptions';

interface ShipItineraryPlanWorkspaceProps {
  rows: ItineraryRow[];
  readOnly: boolean;
  labelPrefix?: string;
  onPatchRow: (rowId: string, patch: Partial<ItineraryRow>) => void;
  onRemoveRow: (rowId: string) => void;
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
    <ItineraryTimeInput inputRef={timeInputRef} value={wall?.time || ''} ariaLabel={`${field.slice(0, 3).toUpperCase()} 時間`} disabled={disabled || automatic || !timeZone || !wall?.date} onChange={time => commit(wall?.date || '', time)} />
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

export default function ShipItineraryPlanWorkspace({ rows, readOnly, labelPrefix = '', onPatchRow, onRemoveRow }: ShipItineraryPlanWorkspaceProps) {
  const [leftPanePercent, setLeftPanePercent] = useState(66);
  const resizing = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const mainAriaLabel = labelPrefix ? `${labelPrefix} 輸入與計算區` : '輸入與計算區';
  const parameterAriaLabel = labelPrefix ? `${labelPrefix} 自動計算參數區` : '自動計算參數區';

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

  return <div className="ship-editor-workspace" ref={workspaceRef} style={workspaceStyle}>
    <section className="ship-editor-pane ship-editor-main-pane" aria-label={mainAriaLabel}>
      <header><b>輸入／計算區</b><span>时间均为各欄指定 Offset 的 LT</span></header>
      <div className="ship-editor-pane-scroll" tabIndex={0}>
        <table className="ship-editor-grid ship-editor-main-table" style={{ width: ITINERARY_EDITOR_MAIN_TABLE_WIDTH }}>
          <colgroup><col style={{ width: ITINERARY_EDITOR_ROW_NUMBER_WIDTH }} />{ITINERARY_EDITOR_MAIN_COLUMN_WIDTHS.map((width, index) => <col key={`main-${index}`} style={{ width }} />)}<col style={{ width: ITINERARY_EDITOR_ACTION_WIDTH }} /></colgroup>
          <thead><tr><th>#</th>{ITINERARY_MAIN_FIELD_LABELS.map(label => <th className={label.includes('\n') ? 'itinerary-field-heading-multiline' : undefined} key={label}>{label}</th>)}<th>操作</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.rowId}>
            <td className="ship-row-number">{index + 1}</td>
            <td><input value={row.voyageNumber} disabled={readOnly} onChange={event => onPatchRow(row.rowId, { voyageNumber: event.target.value })} /></td>
            <td><input value={row.portDockName} disabled={readOnly} onChange={event => onPatchRow(row.rowId, { portDockName: event.target.value })} /></td>
            <td><UtcOffsetSelect value={row.portTimeZone} disabled={readOnly} ariaLabel="港口 UTC Offset" onChange={value => onPatchRow(row.rowId, shipPortTimeZonePatch(row, value))} /></td>
            <td><ItineraryOperationOptions value={row.operation} disabled={readOnly} onChange={operation => onPatchRow(row.rowId, { operation })}/></td>
            <td><textarea value={row.cargoQuantityText} disabled={readOnly} onChange={event => onPatchRow(row.rowId, { cargoQuantityText: event.target.value })} /></td>
            <td><TimeInput row={row} field="etaUtc" allowAuto disabled={readOnly} onPatch={patch => onPatchRow(row.rowId, patch)} /></td>
            <td><TimeInput row={row} field="etbUtc" allowAuto disabled={readOnly} onPatch={patch => onPatchRow(row.rowId, patch)} /></td>
            <td><ItineraryNumericInput value={parseItineraryRateText(row.ldRateText)} label="預計L/D rate (MT/h)" disabled={readOnly} onChange={value => onPatchRow(row.rowId, { ldRateText: value === null ? '' : String(value) })} /></td>
            <td><TimeInput row={row} field="etcUtc" allowAuto disabled={readOnly} onPatch={patch => onPatchRow(row.rowId, patch)} /></td>
            <td><TimeInput row={row} field="etdUtc" allowAuto disabled={readOnly} onPatch={patch => onPatchRow(row.rowId, patch)} /></td>
            <td><textarea value={row.arrivalDraftText} disabled={readOnly} onChange={event => onPatchRow(row.rowId, { arrivalDraftText: event.target.value })} /></td>
            <td><textarea value={row.departureDraftText} disabled={readOnly} onChange={event => onPatchRow(row.rowId, { departureDraftText: event.target.value })} /></td>
            <td><textarea value={row.arrivalRobText} disabled={readOnly} onChange={event => onPatchRow(row.rowId, { arrivalRobText: event.target.value })} /></td>
            <td><textarea value={row.departureRobText} disabled={readOnly} onChange={event => onPatchRow(row.rowId, { departureRobText: event.target.value })} /></td>
            <td><textarea value={row.notesText || ''} disabled={readOnly} onChange={event => onPatchRow(row.rowId, { notesText: event.target.value })} /></td>
            <td><button type="button" className="ship-row-delete" disabled={readOnly || rows.length <= 1} onClick={() => onRemoveRow(row.rowId)}>×</button></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <div className="ship-editor-resizer" role="separator" aria-label={`${labelPrefix ? `${labelPrefix} ` : ''}調整輸入區與參數區寬度`} aria-orientation="vertical" aria-valuemin={40} aria-valuemax={82} aria-valuenow={leftPanePercent} tabIndex={0} onPointerDown={startResize} onPointerMove={resizeAt} onPointerUp={stopResize} onPointerCancel={stopResize} onKeyDown={event => { if (event.key === 'ArrowLeft') setLeftPanePercent(value => Math.max(40, value - 2)); if (event.key === 'ArrowRight') setLeftPanePercent(value => Math.min(82, value + 2)); }} />
    <section className="ship-editor-pane ship-editor-parameter-pane" aria-label={parameterAriaLabel}>
      <header><b>自動計算用變化參數區</b><span>空白时数按 0；修改后即時更新「自」欄位</span></header>
      <div className="ship-editor-pane-scroll" tabIndex={0}>
        <table className="ship-editor-grid ship-editor-parameter-table" style={{ width: ITINERARY_EDITOR_PARAMETER_TABLE_WIDTH }}>
          <colgroup><col style={{ width: ITINERARY_EDITOR_ROW_NUMBER_WIDTH }} />{ITINERARY_EDITOR_PARAMETER_COLUMN_WIDTHS.map((width, index) => <col key={`parameter-${index}`} style={{ width }} />)}</colgroup>
          <thead><tr><th>#</th>{ITINERARY_PARAMETER_FIELD_LABELS.map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.rowId}>
            <td className="ship-row-number">{index + 1}</td>
            <td><ItineraryNumericInput value={row.oceanDistanceNm} label="DTG(NM)" disabled={readOnly} onChange={value => onPatchRow(row.rowId, { oceanDistanceNm: value })} /></td>
            <td><ItineraryNumericInput value={row.speedKnots} label="預估航速(kn)" disabled={readOnly} onChange={value => onPatchRow(row.rowId, { speedKnots: value })} /></td>
            <td className="ship-derived">{displayHours(row.sailingHours)}</td>
            <td><ItineraryNumericInput value={row.berthWaitHours} label="預估等待時間(靠泊前)(h)" disabled={readOnly} onChange={value => onPatchRow(row.rowId, { berthWaitHours: value })} /></td>
            <td><ItineraryNumericInput value={row.channelSailingHours} label="預計航道航行時間(h)" disabled={readOnly} onChange={value => onPatchRow(row.rowId, { channelSailingHours: value })} /></td>
            <td><input value={row.tanksText} disabled={readOnly} onChange={event => onPatchRow(row.rowId, { tanksText: event.target.value })} /></td>
            <td><input type="number" min="0" step="0.1" value={row.operationQuantityMt ?? ''} disabled={readOnly} onChange={event => onPatchRow(row.rowId, { operationQuantityMt: numeric(event.target.value) })} /></td>
            <td className="ship-derived">{row.operationRateMtPerHour === null ? '—' : displayHours(row.operationRateMtPerHour)}</td>
            <td className="ship-derived">{displayHours(row.operationHours)}</td>
            <td><ItineraryNumericInput value={row.preCompletionDelayHours} label="預估等待/延誤時間(完貨前)(h)" disabled={readOnly} onChange={value => onPatchRow(row.rowId, { preCompletionDelayHours: value })} /></td>
            <td><ItineraryNumericInput value={row.postCompletionDelayHours} label="預估等待/延誤時間(完貨後)(h)" disabled={readOnly} onChange={value => onPatchRow(row.rowId, { postCompletionDelayHours: value, departureBufferDays: null })} /></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </div>;
}

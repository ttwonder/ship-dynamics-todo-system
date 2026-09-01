import { useState } from 'react';
import { formatItineraryUtcOffset, formatRelativeUpdatedAt, instantToWallTime } from './itineraryTime';
import {
  formatItineraryOperation,
  resolveItineraryTimeZone,
  type ItineraryDocument,
  type ItineraryRow,
  type ItineraryTimeField,
} from './itineraryTypes';
import { ITINERARY_MAIN_FIELD_LABELS } from './itineraryFieldLayout';

interface ItineraryPanelProps {
  document: ItineraryDocument;
  selected: boolean;
  nowMs: number;
  canEdit: boolean;
  onToggleSelected: () => void;
  onEdit?: () => void;
}

const dash = '—';

function text(value: string): string {
  return value.trim() || dash;
}

function rowUtcOffset(row: ItineraryRow): string {
  return formatItineraryUtcOffset(row.portTimeZone, row.etaUtc || row.etbUtc || row.etcUtc || row.etdUtc);
}

function ItineraryBrowseTime({ row, field }: { row: ItineraryRow; field: ItineraryTimeField }) {
  const value = row[field];
  const zone = resolveItineraryTimeZone(row, field);
  const local = value && zone ? instantToWallTime(value, zone) : null;
  const localLabel = local?.ok ? `${local.date.slice(5)} ${local.time}` : value ? '時區待確認' : dash;
  const offset = formatItineraryUtcOffset(zone, value);
  return <div className="itinerary-time-display"><span>{localLabel}</span>{offset&&<small className="itinerary-time-offset-label">{offset}</small>}</div>;
}

export default function ItineraryPanel({ document, selected, nowMs, canEdit, onToggleSelected, onEdit }: ItineraryPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? document.rows : document.rows.slice(0, 7);
  const relativeUpdatedAt = formatRelativeUpdatedAt(document.updatedAt, nowMs);
  return <article className={`itinerary-panel ${selected ? 'selected' : ''}`} data-itinerary-vessel-id={document.vesselId}>
    <header className="itinerary-panel-head">
      <label className="itinerary-select"><input type="checkbox" checked={selected} onChange={onToggleSelected}/><span>選取</span></label>
      <div className="itinerary-vessel-heading"><h2>{document.vesselName}</h2>{document.updatedActorLabel&&<p>更新者｜{document.updatedActorLabel}</p>}</div>
      <div className="itinerary-panel-meta"><span>{relativeUpdatedAt}</span>{canEdit&&<button type="button" className="btn small itinerary-edit-button" onClick={onEdit}>手動修改</button>}</div>
    </header>
    <div className="itinerary-table-scroll" tabIndex={0} aria-label={`${document.vesselName} Itinerary`}>
      <table className="itinerary-table">
        <thead><tr>{ITINERARY_MAIN_FIELD_LABELS.map((label,index)=><th className={index===1?'itinerary-port-column':undefined} key={label}>{label}</th>)}</tr></thead>
        <tbody>{visibleRows.map(row=><tr key={row.rowId}>
          <td title={row.voyageNumber}>{text(row.voyageNumber)}</td>
          <td className="itinerary-port-column" title={row.portDockName}>{text(row.portDockName)}</td>
          <td>{rowUtcOffset(row)||dash}</td>
          <td>{formatItineraryOperation(row.operation)||dash}</td>
          <td className="itinerary-multiline" title={row.cargoQuantityText}>{text(row.cargoQuantityText)}</td>
          <td><ItineraryBrowseTime row={row} field="etaUtc"/></td>
          <td><ItineraryBrowseTime row={row} field="etbUtc"/></td>
          <td title={row.ldRateText}>{text(row.ldRateText)}</td>
          <td><ItineraryBrowseTime row={row} field="etcUtc"/></td>
          <td><ItineraryBrowseTime row={row} field="etdUtc"/></td>
          <td title={row.arrivalDraftText}>{text(row.arrivalDraftText)}</td>
          <td title={row.departureDraftText}>{text(row.departureDraftText)}</td>
          <td title={row.arrivalRobText}>{text(row.arrivalRobText)}</td>
          <td title={row.departureRobText}>{text(row.departureRobText)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {document.rows.length>7&&<footer className="itinerary-panel-foot"><button type="button" className="btn small ghost" onClick={()=>setExpanded(value=>!value)}>{expanded?'收合至 7 列':`展開全部 ${document.rows.length} 列`}</button></footer>}
  </article>;
}

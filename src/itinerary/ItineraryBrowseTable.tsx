import {
  ITINERARY_BROWSE_EXPANDED_TABLE_WIDTH,
  ITINERARY_BROWSE_MAIN_COLUMN_WIDTHS,
  ITINERARY_BROWSE_MAIN_TABLE_WIDTH,
  ITINERARY_BROWSE_PARAMETER_COLUMN_WIDTHS,
  ITINERARY_MAIN_FIELD_LABELS,
  ITINERARY_PARAMETER_FIELD_LABELS,
} from './itineraryFieldLayout';
import { formatItineraryUtcOffset, instantToWallTime } from './itineraryTime';
import {
  formatItineraryOperation,
  resolveItineraryTimeZone,
  type ItineraryRow,
  type ItineraryTimeField,
} from './itineraryTypes';
import './itineraryBrowseTable.css';

interface ItineraryBrowseTableProps {
  rows: ItineraryRow[];
  showMoreParameters: boolean;
  ariaLabel: string;
}

interface ItineraryMoreParametersButtonProps {
  expanded: boolean;
  onToggle: () => void;
}

const dash = '—';

function text(value: string | null | undefined): string {
  return value?.trim() || dash;
}

function numberText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return dash;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function rowUtcOffset(row: ItineraryRow): string {
  return formatItineraryUtcOffset(row.portTimeZone, row.etaUtc || row.etbUtc || row.etcUtc || row.etdUtc) || dash;
}

function ItineraryBrowseTime({ row, field }: { row: ItineraryRow; field: ItineraryTimeField }) {
  const value = row[field];
  const zone = resolveItineraryTimeZone(row, field);
  const wall = value && zone ? instantToWallTime(value, zone) : null;
  const label = wall?.ok ? `${wall.date.slice(5)} ${wall.time}` : value ? '時區待確認' : dash;
  const offset = formatItineraryUtcOffset(zone, value);
  return <div className="itinerary-browse-time"><span>{label}</span>{offset && <small className="itinerary-browse-time-offset">{offset}</small>}</div>;
}

function MainBrowseCells({ row }: { row: ItineraryRow }) {
  return <>
    <td title={row.voyageNumber}>{text(row.voyageNumber)}</td>
    <td className="itinerary-browse-port" title={row.portDockName}>{text(row.portDockName)}</td>
    <td>{rowUtcOffset(row)}</td>
    <td className="itinerary-browse-multiline" title={formatItineraryOperation(row.operation)}>{formatItineraryOperation(row.operation) || dash}</td>
    <td className="itinerary-browse-multiline" title={row.cargoQuantityText}>{text(row.cargoQuantityText)}</td>
    <td><ItineraryBrowseTime row={row} field="etaUtc" /></td>
    <td><ItineraryBrowseTime row={row} field="etbUtc" /></td>
    <td title={row.ldRateText}>{text(row.ldRateText)}</td>
    <td><ItineraryBrowseTime row={row} field="etcUtc" /></td>
    <td><ItineraryBrowseTime row={row} field="etdUtc" /></td>
    <td className="itinerary-browse-multiline" title={row.arrivalDraftText}>{text(row.arrivalDraftText)}</td>
    <td className="itinerary-browse-multiline" title={row.departureDraftText}>{text(row.departureDraftText)}</td>
    <td className="itinerary-browse-multiline" title={row.arrivalRobText}>{text(row.arrivalRobText)}</td>
    <td className="itinerary-browse-multiline" title={row.departureRobText}>{text(row.departureRobText)}</td>
    <td className="itinerary-browse-multiline itinerary-browse-notes" title={row.notesText}>{text(row.notesText)}</td>
  </>;
}

function ParameterBrowseCells({ row }: { row: ItineraryRow }) {
  return <>
    <td>{numberText(row.oceanDistanceNm)}</td>
    <td>{numberText(row.speedKnots)}</td>
    <td>{numberText(row.sailingHours)}</td>
    <td>{numberText(row.berthWaitHours)}</td>
    <td>{numberText(row.channelSailingHours)}</td>
    <td className="itinerary-browse-multiline" title={row.tanksText}>{text(row.tanksText)}</td>
    <td>{numberText(row.operationQuantityMt)}</td>
    <td>{numberText(row.operationRateMtPerHour)}</td>
    <td>{numberText(row.operationHours)}</td>
    <td>{numberText(row.preCompletionDelayHours)}</td>
    <td>{numberText(row.postCompletionDelayHours)}</td>
  </>;
}

export function ItineraryMoreParametersButton({ expanded, onToggle }: ItineraryMoreParametersButtonProps) {
  return <button
    type="button"
    className="btn small ghost itinerary-more-parameters-button"
    aria-expanded={expanded}
    onClick={onToggle}
  >{expanded ? '隱藏更多預估參數' : '顯示更多預估參數'}</button>;
}

export function ItineraryBrowseTable({ rows, showMoreParameters, ariaLabel }: ItineraryBrowseTableProps) {
  const tableWidth = showMoreParameters ? ITINERARY_BROWSE_EXPANDED_TABLE_WIDTH : ITINERARY_BROWSE_MAIN_TABLE_WIDTH;
  return <div className="itinerary-browse-scroll" tabIndex={0} aria-label={ariaLabel}>
    <table className="itinerary-browse-table" style={{ width: tableWidth }}>
      <colgroup>
        {ITINERARY_BROWSE_MAIN_COLUMN_WIDTHS.map((width, index) => <col key={`main-${index}`} style={{ width }} />)}
        {showMoreParameters && ITINERARY_BROWSE_PARAMETER_COLUMN_WIDTHS.map((width, index) => <col key={`parameter-${index}`} style={{ width }} />)}
      </colgroup>
      <thead><tr>
        {ITINERARY_MAIN_FIELD_LABELS.map((label, index) => <th className={label.includes('\n') ? 'itinerary-field-heading-multiline' : undefined} key={`main-${index}`}>{label}</th>)}
        {showMoreParameters && ITINERARY_PARAMETER_FIELD_LABELS.map((label, index) => <th className="itinerary-browse-parameter-heading" key={`parameter-${index}`}>{label}</th>)}
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.rowId}>
        <MainBrowseCells row={row} />
        {showMoreParameters && <ParameterBrowseCells row={row} />}
      </tr>)}</tbody>
    </table>
  </div>;
}

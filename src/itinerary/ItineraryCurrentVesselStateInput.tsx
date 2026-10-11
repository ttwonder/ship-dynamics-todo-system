import { NAVIGATION_STATUSES, LOAD_STATUSES, VESSEL_STATUSES, shipStatusLabel } from '../vesselStateChoices';
import type { LoadStatus, NavigationStatus } from '../types';
import type { ItineraryCurrentVesselState, ItineraryRow } from './itineraryTypes';
import './itineraryCurrentVesselStateInput.css';

/** Both editors update the same optional metadata on the formal first row. */
export default function ItineraryCurrentVesselStateInput({ row, disabled, onPatch, className = 'ship-current-vessel-state' }: {
  row: ItineraryRow;
  disabled: boolean;
  onPatch: (patch: Partial<ItineraryRow>) => void;
  className?: string;
}) {
  const state = row.currentVesselState || {};
  const patch = (value: Partial<ItineraryCurrentVesselState>) => onPatch({ currentVesselState: { ...state, ...value } });
  const statuses = state.statusList || [];
  return <fieldset className={className} disabled={disabled} aria-label="目前船舶資料">
    <label>目前位置<input name="currentLocation" aria-label="目前位置" maxLength={240} value={state.location ?? ''} disabled={disabled} onChange={event => patch({ location: event.target.value })}/><small>非經緯度，而是大致區域位置</small></label>
    <label>目前航行狀態<select aria-label="目前航行狀態" value={state.navigationStatus ?? ''} onChange={event => patch({ navigationStatus: event.target.value as NavigationStatus })}><option value="" disabled>請選擇</option>{NAVIGATION_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <label>目前載況<select aria-label="目前載況" value={state.loadStatus ?? ''} onChange={event => patch({ loadStatus: event.target.value as LoadStatus })}><option value="" disabled>請選擇</option>{LOAD_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <div><span>目前船舶狀態</span><details className="itinerary-purpose-select" data-current-vessel-status>
      <summary aria-label="目前船舶狀態（可多選）">{statuses.length ? statuses.map(shipStatusLabel).join(' / ') : '選擇船舶狀態'}</summary>
      <div className="itinerary-purpose-menu" role="group" aria-label="目前船舶狀態（可多選）">{VESSEL_STATUSES.map(value => <label key={value}><input type="checkbox" checked={statuses.includes(value)} disabled={disabled} onChange={event => patch({ statusList: event.target.checked ? [...statuses, value] : statuses.filter(status => status !== value) })}/><span>{shipStatusLabel(value)}</span></label>)}<button type="button" disabled={disabled} onClick={() => patch({ statusList: [] })}>清除</button></div>
    </details></div>
  </fieldset>;
}

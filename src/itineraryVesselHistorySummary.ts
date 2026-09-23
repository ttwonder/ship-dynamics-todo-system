import { formatItineraryUtcOffset, instantToWallTime } from './itinerary/itineraryTime';
import type { ItineraryCurrentVesselState, ItineraryRow } from './itinerary/itineraryTypes';
import { NAVIGATION_STATUSES, VESSEL_STATUSES, shipStatusLabel } from './vesselStateChoices';

const textFields = ['previousPortName','voyageNumber','portDockName','portTimeZone','etaTimeZone','etbTimeZone','etdTimeZone'] as const;
const instantFields = ['etaUtc','etbUtc','etdUtc'] as const;
export type ItineraryHistoryOverviewRow = Pick<ItineraryRow, typeof textFields[number] | typeof instantFields[number] | 'currentVesselState'>;

/** Undefined means the old query is still installed; [] means a genuinely empty snapshot. */
export function parseItineraryHistoryOverview(value: unknown, rowCount: number): ItineraryHistoryOverviewRow[] | null {
  if (value === undefined) return null;
  const invalid = () => { throw new Error('單船歷程基本資訊格式不正確。'); };
  if (!Array.isArray(value) || value.length !== Math.min(2, rowCount)) return invalid();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
    const row = raw as Record<string, unknown>;
    for (const field of [...textFields,...instantFields]) {
      if (row[field] != null && typeof row[field] !== 'string') return invalid();
    }
    let currentVesselState: ItineraryCurrentVesselState | undefined;
    if (row.currentVesselState != null) {
      const state = row.currentVesselState as Record<string, unknown>;
      if (typeof state !== 'object' || Array.isArray(state)
        || (state.location !== undefined && typeof state.location !== 'string')
        || (state.navigationStatus !== undefined && !NAVIGATION_STATUSES.some(item => item === state.navigationStatus))
        || (state.statusList !== undefined && (!Array.isArray(state.statusList) || !state.statusList.every(item => VESSEL_STATUSES.includes(item))))) return invalid();
      currentVesselState = {
        location: state.location as ItineraryCurrentVesselState['location'],
        navigationStatus: state.navigationStatus as ItineraryCurrentVesselState['navigationStatus'],
        statusList: state.statusList as ItineraryCurrentVesselState['statusList'],
      };
    }
    return {
      ...Object.fromEntries(textFields.map(field => [field, row[field] ?? ''])),
      ...Object.fromEntries(instantFields.map(field => [field, row[field] ?? null])),
      currentVesselState,
    } as ItineraryHistoryOverviewRow;
  });
}

const text = (value: string | undefined, fallback = '—') => value?.trim() || fallback;
function time(row: ItineraryHistoryOverviewRow | undefined, field: 'eta' | 'etb' | 'etd', fallback = '—'): string {
  const instant = row?.[`${field}Utc`];
  if (!row || !instant) return fallback;
  const zone = row[`${field}TimeZone`] || row.portTimeZone;
  const wall = instantToWallTime(instant, zone);
  if (!wall.ok) return '時間格式錯誤';
  return `${wall.date} ${wall.time} LT (${formatItineraryUtcOffset(zone, instant) || zone})`;
}

/** Rows are already frozen and sorted by the read-only RPC; no live vessel or clock input. */
export function itineraryVesselHistorySummary(rows: readonly ItineraryHistoryOverviewRow[]) {
  const [first, second] = rows;
  return [
    { key:'previousPort', label:'上一港', value:text(first?.previousPortName) },
    { key:'location', label:'目前位置', value:text(first?.currentVesselState?.location) },
    { key:'navigationStatus', label:'目前航行狀態', value:text(first?.currentVesselState?.navigationStatus) },
    { key:'shipStatus', label:'目前船舶狀態', value:text(first?.currentVesselState?.statusList?.map(shipStatusLabel).join('、')) },
    { key:'voyage', label:'Voy No.', value:text(first?.voyageNumber) },
    { key:'port', label:'Next Port & Dock Name', value:text(first?.portDockName) },
    { key:'eta', label:'ETA', value:time(first,'eta') },
    { key:'etb', label:'ETB', value:time(first,'etb') },
    { key:'etd', label:'ETD', value:time(first,'etd') },
    { key:'subsequentPort', label:'後續港', value:text(second?.portDockName,'TBA') },
    { key:'subsequentEta', label:'後續港 ETA', value:time(second,'eta','TBA') },
  ];
}

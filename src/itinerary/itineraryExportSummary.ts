import { shipStatusLabel } from '../vesselStateChoices';
import { firstItineraryRow, type ItineraryRow } from './itineraryTypes';

/** Export metadata belongs to these rows (a frozen snapshot or the exported document), never the live vessel card. */
export function itineraryExportSummary(rows: readonly ItineraryRow[]) {
  const first = firstItineraryRow({ rows: [...rows] });
  const state = first?.currentVesselState;
  return [
    { key: 'location', label: '目前位置', value: state?.location?.trim() || '未填' },
    { key: 'timeZone', label: '現在所處時區', value: first?.calculationStartTimeZone?.trim() || '未填' },
    { key: 'navigationStatus', label: '目前航行狀態', value: state?.navigationStatus || '未填' },
    { key: 'loadStatus', label: '目前載況', value: state?.loadStatus || '未填' },
    { key: 'statusList', label: '目前船舶狀態', value: state?.statusList?.map(shipStatusLabel).join('、') || '未填' },
    { key: 'previousPort', label: '上一港', value: first?.previousPortName?.trim() || '未填' },
  ];
}

import { shipStatusLabel } from '../vesselStateChoices';
import { firstItineraryRow, type ItineraryDocument } from './itineraryTypes';
import './itineraryCurrentVesselStateSummary.css';

/** Browse-only: the confirmed formal document remains the sole state source. */
export default function ItineraryCurrentVesselStateSummary({ document }: { document: ItineraryDocument }) {
  const state = firstItineraryRow(document)?.currentVesselState;
  const fields = [
    { key: 'location', label: '目前位置', value: state?.location?.trim() },
    { key: 'navigationStatus', label: '目前航行狀態', value: state?.navigationStatus },
    { key: 'loadStatus', label: '目前載況', value: state?.loadStatus },
    { key: 'statusList', label: '目前船舶狀態', value: state?.statusList?.map(shipStatusLabel).join('、') },
  ];
  return <dl className="itinerary-current-state-summary" aria-label="目前船舶狀態摘要">
    {fields.map(field => <div key={field.key} data-current-state-field={field.key}>
      <dt>{field.label}</dt><dd>{field.value || '未填'}</dd>
    </div>)}
  </dl>;
}

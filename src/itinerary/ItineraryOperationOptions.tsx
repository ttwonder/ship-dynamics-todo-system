import { itineraryOperationSelected, setItineraryOperationSelected, type ItineraryOperation } from './itineraryTypes';

interface ItineraryOperationOptionsProps {
  value: ItineraryOperation;
  disabled?: boolean;
  onChange: (value: ItineraryOperation) => void;
}

export default function ItineraryOperationOptions({ value, disabled = false, onChange }: ItineraryOperationOptionsProps) {
  return <div className="itinerary-operation-options" role="group" aria-label="裝卸貨安排（可多選）">
    <label><input type="checkbox" checked={itineraryOperationSelected(value, 'load')} disabled={disabled} onChange={event => onChange(setItineraryOperationSelected(value, 'load', event.target.checked))}/><span>To Load</span></label>
    <label><input type="checkbox" checked={itineraryOperationSelected(value, 'unload')} disabled={disabled} onChange={event => onChange(setItineraryOperationSelected(value, 'unload', event.target.checked))}/><span>To Unload</span></label>
  </div>;
}

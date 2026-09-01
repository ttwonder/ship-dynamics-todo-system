import {
  formatItineraryOperation, itineraryOperationSelected, ITINERARY_PURPOSE_OPTIONS,
  setItineraryOperationSelected, type ItineraryOperation,
} from './itineraryTypes';

interface ItineraryOperationOptionsProps {
  value: ItineraryOperation;
  disabled?: boolean;
  onChange: (value: ItineraryOperation) => void;
}

export default function ItineraryOperationOptions({ value, disabled = false, onChange }: ItineraryOperationOptionsProps) {
  const canonicalSummary = formatItineraryOperation(value);
  const summary = canonicalSummary ? canonicalSummary.toLocaleLowerCase('en-US') : '選擇 Purpose';
  return <details className="itinerary-purpose-select">
    <summary aria-label="Purpose（可多選）" title={summary}>{summary}</summary>
    <div className="itinerary-purpose-menu" role="group" aria-label="Purpose（可多選）">
      {ITINERARY_PURPOSE_OPTIONS.map(option => <label key={option.choice}>
        <input
          type="checkbox"
          checked={itineraryOperationSelected(value, option.choice)}
          disabled={disabled}
          onChange={event => onChange(setItineraryOperationSelected(value, option.choice, event.target.checked))}
        />
        <span>{option.label.toLocaleLowerCase('en-US')}</span>
      </label>)}
      <button type="button" disabled={disabled || !value} onClick={() => onChange('')}>清除</button>
    </div>
  </details>;
}

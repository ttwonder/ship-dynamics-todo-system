import { isValidUtcOffset, UTC_OFFSET_OPTIONS } from './itineraryTime';

interface UtcOffsetSelectProps {
  value: string;
  disabled?: boolean;
  className?: string;
  emptyLabel?: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
}

export default function UtcOffsetSelect({ value, disabled = false, className, emptyLabel = 'UTC Offset', ariaLabel = 'UTC Offset', onChange }: UtcOffsetSelectProps) {
  const legacyValue = Boolean(value) && !isValidUtcOffset(value);
  return <select className={className} value={value} disabled={disabled} aria-label={ariaLabel} onChange={event => onChange(event.target.value)}>
    <option value="">{emptyLabel}</option>
    {legacyValue && <option value={value}>舊格式，請改選 UTC Offset</option>}
    {UTC_OFFSET_OPTIONS.map(offset => <option value={offset} key={offset}>{offset}</option>)}
  </select>;
}

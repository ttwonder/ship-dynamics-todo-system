import { isValidUtcOffset, UTC_OFFSET_OPTIONS } from './itineraryTime';

interface UtcOffsetSelectProps {
  value: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
}

export default function UtcOffsetSelect({ value, disabled = false, className, onChange }: UtcOffsetSelectProps) {
  const legacyValue = Boolean(value) && !isValidUtcOffset(value);
  return <select className={className} value={value} disabled={disabled} aria-label="UTC Offset" onChange={event => onChange(event.target.value)}>
    <option value="">UTC Offset</option>
    {legacyValue && <option value={value}>舊格式，請改選 UTC Offset</option>}
    {UTC_OFFSET_OPTIONS.map(offset => <option value={offset} key={offset}>{offset}</option>)}
  </select>;
}

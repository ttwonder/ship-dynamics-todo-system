import { useEffect, useRef, type RefObject } from 'react';

interface ItineraryTimeInputProps {
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}

export default function ItineraryTimeInput({ value, disabled = false, ariaLabel, inputRef, onChange }: ItineraryTimeInputProps) {
  const localInputRef = useRef<HTMLInputElement>(null);
  const stableInputRef = inputRef || localInputRef;

  useEffect(() => {
    const input = stableInputRef.current;
    if (!input || document.activeElement === input || input.value === value) return;
    input.value = value;
  }, [stableInputRef, value]);

  return <input
    ref={stableInputRef}
    type="time"
    defaultValue={value}
    disabled={disabled}
    aria-label={ariaLabel}
    onChange={event => onChange(event.currentTarget.value)}
  />;
}

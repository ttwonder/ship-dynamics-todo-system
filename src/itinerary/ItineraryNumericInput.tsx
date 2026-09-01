import { useEffect, useRef, type ClipboardEvent, type FormEvent } from 'react';

interface ItineraryNumericInputProps {
  value: number | null;
  label: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  onChange: (value: number | null) => void;
  onInvalid?: (message: string) => void;
}

export function isItineraryNumericDraft(value: string): boolean {
  return /^(?:\d+(?:\.\d*)?|\.\d*)?$/.test(value);
}

export function itineraryNumericDraftValue(value: string): number | null {
  if (!value || value === '.') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function itineraryNumericWarning(label: string): string {
  return `${label}僅限輸入數字，可使用小數點。`;
}

function displayNumeric(value: number | null): string {
  return value !== null && Number.isFinite(value) ? String(value) : '';
}

function insertedDraft(input: HTMLInputElement, inserted: string): string {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  return `${input.value.slice(0, start)}${inserted}${input.value.slice(end)}`;
}

export default function ItineraryNumericInput({ value, label, disabled = false, title, className, onChange, onInvalid }: ItineraryNumericInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    const next = displayNumeric(value);
    if (!input || document.activeElement === input || input.value === next) return;
    input.value = next;
  }, [value]);

  const warn = () => {
    const message = itineraryNumericWarning(label);
    if (onInvalid) onInvalid(message);
    else window.alert(message);
  };

  const rejectInvalidInsertion = (event: FormEvent<HTMLInputElement>) => {
    const inserted = (event.nativeEvent as InputEvent).data;
    if (inserted === null || inserted === '' || isItineraryNumericDraft(insertedDraft(event.currentTarget, inserted))) return;
    event.preventDefault();
    warn();
  };

  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const inserted = event.clipboardData.getData('text');
    if (isItineraryNumericDraft(insertedDraft(event.currentTarget, inserted))) return;
    event.preventDefault();
    warn();
  };

  return <input
    ref={inputRef}
    className={className}
    type="text"
    inputMode="decimal"
    autoComplete="off"
    defaultValue={displayNumeric(value)}
    disabled={disabled}
    title={title}
    aria-label={label}
    onBeforeInput={rejectInvalidInsertion}
    onPaste={paste}
    onChange={event => {
      const raw = event.currentTarget.value;
      if (!isItineraryNumericDraft(raw)) {
        event.currentTarget.value = displayNumeric(value);
        warn();
        return;
      }
      onChange(itineraryNumericDraftValue(raw));
    }}
    onBlur={event => {
      const parsed = itineraryNumericDraftValue(event.currentTarget.value);
      event.currentTarget.value = parsed === null ? '' : String(parsed);
    }}
  />;
}

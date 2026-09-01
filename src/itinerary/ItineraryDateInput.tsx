import { useEffect, useRef } from 'react';
import { normalizeItineraryDateInput } from './itineraryTime';

interface ItineraryDateInputProps {
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
  onInvalid?: (message: string) => void;
}

export default function ItineraryDateInput({ value, disabled = false, ariaLabel, onChange, onInvalid }: ItineraryDateInputProps) {
  const dateInputRef = useRef<HTMLInputElement>(null);
  const pickerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const textInput = dateInputRef.current;
    if (textInput && document.activeElement !== textInput && textInput.value !== value) textInput.value = value;
    const pickerInput = pickerInputRef.current;
    if (pickerInput && pickerInput.value !== value) pickerInput.value = value;
  }, [value]);

  const commit = (raw: string): boolean => {
    const normalized = normalizeItineraryDateInput(raw);
    if (!normalized) return false;
    if (dateInputRef.current) {
      dateInputRef.current.value = normalized;
      dateInputRef.current.setCustomValidity('');
    }
    if (pickerInputRef.current) pickerInputRef.current.value = normalized;
    onChange(normalized);
    return true;
  };

  const resetInvalid = () => {
    const raw = dateInputRef.current?.value.trim() || '';
    if (!raw) {
      onChange('');
      return;
    }
    if (commit(raw)) return;
    if (dateInputRef.current) {
      dateInputRef.current.value = value;
      dateInputRef.current.setCustomValidity('');
    }
    onInvalid?.('日期格式無效，請輸入 YYYY-MM-DD、YYYY/MM/DD 或 YYYYMMDD。');
  };

  const openPicker = () => {
    const picker = pickerInputRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === 'function') picker.showPicker();
    else picker.click();
  };

  return <span className="itinerary-date-entry">
    <input
      ref={dateInputRef}
      className="itinerary-date-text"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="YYYY-MM-DD"
      aria-label={ariaLabel}
      defaultValue={value}
      disabled={disabled}
      onFocus={event => event.currentTarget.setCustomValidity('')}
      onChange={event => event.currentTarget.setCustomValidity('')}
      onKeyDown={event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        resetInvalid();
      }}
      onPaste={event => {
        const pasted = event.clipboardData.getData('text');
        if (!normalizeItineraryDateInput(pasted)) return;
        event.preventDefault();
        commit(pasted);
      }}
      onBlur={resetInvalid}
    />
    <button type="button" className="itinerary-date-picker-button" aria-label={`${ariaLabel}：開啟日期選擇器`} title="選擇日期" disabled={disabled} onClick={openPicker}>▾</button>
    <input
      ref={pickerInputRef}
      className="itinerary-native-date-picker"
      type="date"
      tabIndex={-1}
      aria-hidden="true"
      defaultValue={value}
      disabled={disabled}
      onChange={event => { if (event.target.value) commit(event.target.value); }}
    />
  </span>;
}

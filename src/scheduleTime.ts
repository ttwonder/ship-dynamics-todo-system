const DATE_RE = /^(\d{4}-\d{2}-\d{2})$/;
const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/;

export function scheduleDateValue(value = ''): string {
  const normalized = value.trim();
  const dateOnly = normalized.match(DATE_RE);
  if (dateOnly) return dateOnly[1];
  const dateTime = normalized.match(DATE_TIME_RE);
  return dateTime ? dateTime[1] : '';
}

export function scheduleTimeValue(value = ''): string {
  const normalized = value.trim();
  const dateTime = normalized.match(DATE_TIME_RE);
  return dateTime ? dateTime[2] : '';
}

export function composeScheduleValue(date: string, time: string): string {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? date.trim() : '';
  if (!safeDate) return '';
  const safeTime = /^\d{2}:\d{2}$/.test(time.trim()) ? time.trim() : '';
  return safeTime ? `${safeDate}T${safeTime}` : safeDate;
}

export function formatScheduleDisplay(value = ''): string {
  const date = scheduleDateValue(value);
  if (!date) return '';
  const time = scheduleTimeValue(value);
  return time ? `${date} ${time}` : date;
}

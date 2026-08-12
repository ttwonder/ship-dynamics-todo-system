import type { ScheduleKind } from './types';

const DATE_RE = /^(\d{4}-\d{2}-\d{2})$/;
const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/;
const SCHEDULE_KINDS: ScheduleKind[] = ['ETA', 'ETB', 'ETD'];

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

export function formatCompleteScheduleDisplay(value = ''): string {
  const date = scheduleDateValue(value);
  const time = scheduleTimeValue(value);
  return date && time ? `${date} ${time}` : '';
}

function completeScheduleTimestamp(value = ''): number | null {
  const date = scheduleDateValue(value);
  const time = scheduleTimeValue(value);
  if (!date || !time) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const local = new Date(year, month - 1, day, hour, minute);
  if (
    local.getFullYear() !== year
    || local.getMonth() !== month - 1
    || local.getDate() !== day
    || local.getHours() !== hour
    || local.getMinutes() !== minute
  ) return null;
  return local.getTime();
}

export function automaticScheduleKind(
  schedule: { eta: string; etb: string; etd: string },
  now = new Date(),
): ScheduleKind {
  const nowTimestamp = now.getTime();
  const etaTimestamp = completeScheduleTimestamp(schedule.eta);
  if (!Number.isFinite(nowTimestamp) || etaTimestamp === null || etaTimestamp >= nowTimestamp) return 'ETA';
  const etbTimestamp = completeScheduleTimestamp(schedule.etb);
  if (etbTimestamp === null || etbTimestamp >= nowTimestamp) return 'ETB';
  return 'ETD';
}

export function nextScheduleKind(current: ScheduleKind): ScheduleKind {
  return SCHEDULE_KINDS[(SCHEDULE_KINDS.indexOf(current) + 1) % SCHEDULE_KINDS.length];
}

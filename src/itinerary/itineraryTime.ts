import { Temporal } from '@js-temporal/polyfill';

export const UTC_OFFSET_OPTIONS = [
  'UTC-12','UTC-11','UTC-10','UTC-9:30','UTC-9','UTC-8','UTC-7','UTC-6','UTC-5','UTC-4','UTC-3:30','UTC-3','UTC-2:30','UTC-2','UTC-1',
  'UTC',
  'UTC+1','UTC+2','UTC+3','UTC+3:30','UTC+4','UTC+4:30','UTC+5','UTC+5:30','UTC+5:45','UTC+6','UTC+6:30','UTC+7','UTC+8','UTC+8:45',
  'UTC+9','UTC+9:30','UTC+10','UTC+10:30','UTC+11','UTC+12','UTC+12:45','UTC+13','UTC+13:45','UTC+14',
] as const;

export type WallTimeResult = { ok: true; instant: string } | { ok: false; reason: 'invalid-time-zone' | 'invalid-wall-time' };
export type LocalWallTimeResult = { ok: true; date: string; time: string } | { ok: false; reason: 'invalid-time-zone' | 'invalid-instant' };

let supportedZones: Set<string> | null = null;

function timeZoneSet(): Set<string> {
  if (supportedZones) return supportedZones;
  const intlWithSupportedValues = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const values = typeof intlWithSupportedValues.supportedValuesOf === 'function'
    ? intlWithSupportedValues.supportedValuesOf('timeZone')
    : [];
  supportedZones = new Set([...values, 'UTC']);
  return supportedZones;
}

export function isValidIanaTimeZone(value: string): boolean {
  const zone = value.trim();
  if (!zone || !(zone === 'UTC' || zone.includes('/'))) return false;
  if (timeZoneSet().has(zone)) return true;
  try {
    Temporal.Now.zonedDateTimeISO(zone);
    return true;
  } catch {
    return false;
  }
}

export function parseUtcOffsetMinutes(value: string): number | null {
  const normalized = value.trim();
  if (normalized === 'UTC') return 0;
  const match = /^UTC([+-])(\d{1,2})(?::(00|15|30|45))?$/.exec(normalized);
  if (!match) return null;
  const magnitude = Number(match[2]) * 60 + Number(match[3] || 0);
  const minutes = match[1] === '-' ? -magnitude : magnitude;
  return minutes >= -12 * 60 && minutes <= 14 * 60 ? minutes : null;
}

export function isValidUtcOffset(value: string): boolean {
  return parseUtcOffsetMinutes(value) !== null;
}

export function formatUtcOffsetMinutes(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes < -12 * 60 || minutes > 14 * 60 || Math.abs(minutes) % 15 !== 0) return null;
  if (minutes === 0) return 'UTC';
  const sign = minutes < 0 ? '-' : '+';
  const magnitude = Math.abs(minutes);
  const hours = Math.floor(magnitude / 60);
  const remainder = magnitude % 60;
  return `UTC${sign}${hours}${remainder ? `:${String(remainder).padStart(2, '0')}` : ''}`;
}

export function formatItineraryUtcOffset(timeZone: string, instant?: string | null): string {
  const fixedOffset = parseUtcOffsetMinutes(timeZone);
  if (fixedOffset !== null) return formatUtcOffsetMinutes(fixedOffset) || '';
  if (!instant || !isValidIanaTimeZone(timeZone)) return '';
  try {
    const offset = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).offset;
    const minutes = parseUtcOffsetMinutes(`UTC${offset}`);
    return minutes === null ? '' : formatUtcOffsetMinutes(minutes) || '';
  } catch {
    return '';
  }
}

export function isValidItineraryTimeZone(value: string): boolean {
  return isValidUtcOffset(value) || isValidIanaTimeZone(value);
}

function isoOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const magnitude = Math.abs(minutes);
  return `${sign}${String(Math.floor(magnitude / 60)).padStart(2, '0')}:${String(magnitude % 60).padStart(2, '0')}`;
}

export function normalizeInstant(value: string): string | null {
  try {
    return Temporal.Instant.from(value).toString({ smallestUnit: 'second' });
  } catch {
    return null;
  }
}

export function wallTimeToInstant(date: string, time: string, timeZone: string): WallTimeResult {
  if (!isValidItineraryTimeZone(timeZone)) return { ok: false, reason: 'invalid-time-zone' };
  try {
    const plain = Temporal.PlainDateTime.from(`${date}T${time.length === 5 ? `${time}:00` : time}`);
    const offsetMinutes = parseUtcOffsetMinutes(timeZone);
    if (offsetMinutes !== null) {
      const instant = Temporal.Instant.from(`${plain.toString({ smallestUnit: 'second' })}${isoOffset(offsetMinutes)}`);
      return { ok: true, instant: instant.toString({ smallestUnit: 'second' }) };
    }
    const zoned = plain.toZonedDateTime(timeZone, { disambiguation: 'reject' });
    return { ok: true, instant: zoned.toInstant().toString({ smallestUnit: 'second' }) };
  } catch {
    return { ok: false, reason: 'invalid-wall-time' };
  }
}

export function instantToWallTime(instant: string, timeZone: string): LocalWallTimeResult {
  if (!isValidItineraryTimeZone(timeZone)) return { ok: false, reason: 'invalid-time-zone' };
  try {
    const offsetMinutes = parseUtcOffsetMinutes(timeZone);
    const local = Temporal.Instant.from(instant).toZonedDateTimeISO(offsetMinutes === null ? timeZone : isoOffset(offsetMinutes));
    return {
      ok: true,
      date: local.toPlainDate().toString(),
      time: local.toPlainTime().toString({ smallestUnit: 'minute' }),
    };
  } catch {
    return { ok: false, reason: 'invalid-instant' };
  }
}

export function addHoursToInstant(instant: string, hours: number): string | null {
  if (!Number.isFinite(hours)) return null;
  try {
    const milliseconds = Math.round(hours * 60 * 60 * 1000);
    return Temporal.Instant.from(instant).add({ milliseconds }).toString({ smallestUnit: 'second' });
  } catch {
    return null;
  }
}

export function formatRelativeUpdatedAt(updatedAt: string | null, nowMs = Date.now()): string {
  if (!updatedAt) return '尚未同步';
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return '更新時間無效';
  const elapsedMs = Math.max(0, nowMs - updatedMs);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return '剛剛更新';
  if (minutes < 60) return `${minutes} 分鐘前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前更新`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前更新`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 個月前更新`;
  return `${Math.floor(months / 12)} 年前更新`;
}

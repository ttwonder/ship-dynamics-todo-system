import { Temporal } from '@js-temporal/polyfill';

export const COMMON_IANA_TIME_ZONES = ['UTC','Asia/Taipei','Asia/Shanghai','Asia/Hong_Kong','Asia/Seoul','Asia/Tokyo','Asia/Singapore','Asia/Jakarta','Asia/Dubai','Europe/Rotterdam','Europe/London','America/Los_Angeles','America/New_York'] as const;

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

export function normalizeInstant(value: string): string | null {
  try {
    return Temporal.Instant.from(value).toString({ smallestUnit: 'second' });
  } catch {
    return null;
  }
}

export function wallTimeToInstant(date: string, time: string, timeZone: string): WallTimeResult {
  if (!isValidIanaTimeZone(timeZone)) return { ok: false, reason: 'invalid-time-zone' };
  try {
    const plain = Temporal.PlainDateTime.from(`${date}T${time.length === 5 ? `${time}:00` : time}`);
    const zoned = plain.toZonedDateTime(timeZone, { disambiguation: 'reject' });
    return { ok: true, instant: zoned.toInstant().toString({ smallestUnit: 'second' }) };
  } catch {
    return { ok: false, reason: 'invalid-wall-time' };
  }
}

export function instantToWallTime(instant: string, timeZone: string): LocalWallTimeResult {
  if (!isValidIanaTimeZone(timeZone)) return { ok: false, reason: 'invalid-time-zone' };
  try {
    const local = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
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

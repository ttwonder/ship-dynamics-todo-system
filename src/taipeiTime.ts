export const TAIPEI_TIME_ZONE = 'Asia/Taipei';

export type DateTimeInput = Date | string | number | null | undefined;

function asDate(value: DateTimeInput): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateTimeParts(value: DateTimeInput) {
  const date = asDate(value);
  if (!date) return undefined;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return {
    year: valueOf('year'),
    month: valueOf('month'),
    day: valueOf('day'),
    hour: valueOf('hour'),
    minute: valueOf('minute'),
    second: valueOf('second'),
  };
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAIPEI_WALL_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function taipeiDateKey(value: DateTimeInput = new Date()): string {
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) return value;
  const parts = dateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

export function formatTaipeiDate(value: DateTimeInput, fallback = '-'): string {
  const key = taipeiDateKey(value);
  if (!key) return fallback;
  const [year, month, day] = key.split('-');
  return `${year}/${month}/${day}`;
}

export function formatTaipeiDateTime(value: DateTimeInput, includeSeconds = true, fallback = '-'): string {
  if (typeof value === 'string') {
    const wallTime = value.match(TAIPEI_WALL_TIME_RE);
    if (wallTime) {
      const [, year, month, day, hour, minute, second = '00'] = wallTime;
      return `${year}/${month}/${day} ${hour}:${minute}${includeSeconds ? `:${second}` : ''}`;
    }
  }
  const parts = dateTimeParts(value);
  if (!parts) return fallback;
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}${includeSeconds ? `:${parts.second}` : ''}`;
}

export function taipeiDateTimeLocalValue(value: DateTimeInput = new Date()): string {
  const formatted = formatTaipeiDateTime(value, false, '');
  return formatted ? formatted.replace(/\//g, '-').replace(' ', 'T') : '';
}

export function taipeiMonthKey(value: DateTimeInput = new Date()): string {
  return taipeiDateKey(value).slice(0, 7);
}

export function taipeiRecentMonthKeys(count = 6, value: DateTimeInput = new Date()): string[] {
  const key = taipeiDateKey(value);
  if (!key || count < 1) return [];
  const [year, month] = key.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const offset = count - 1 - index;
    return new Date(Date.UTC(year, month - 1 - offset, 1)).toISOString().slice(0, 7);
  });
}

export function taipeiYesterdayDate(now: DateTimeInput = new Date()): string {
  const today = taipeiDateKey(now);
  if (!today) return '';
  const [year, month, day] = today.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return previous.toISOString().slice(0, 10);
}

export function taipeiDaysDiff(targetDate: string, now: DateTimeInput = new Date()): number | null {
  if (!DATE_ONLY_RE.test(targetDate)) return null;
  const today = taipeiDateKey(now);
  if (!today) return null;
  const [targetYear, targetMonth, targetDay] = targetDate.split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  const delta = Date.UTC(targetYear, targetMonth - 1, targetDay) - Date.UTC(todayYear, todayMonth - 1, todayDay);
  return Math.round(delta / 86_400_000);
}

export function isTaipeiBusinessDay(value: DateTimeInput = new Date()): boolean {
  const key = taipeiDateKey(value);
  if (!key) return false;
  const [year, month, day] = key.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

export function taipeiBusinessDateLabel(value: DateTimeInput = new Date()): string {
  const key = taipeiDateKey(value);
  if (!key) return '';
  const [year, month, day] = key.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

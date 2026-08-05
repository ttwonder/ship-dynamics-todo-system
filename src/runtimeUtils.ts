import { taipeiDateKey, taipeiDaysDiff, taipeiYesterdayDate } from './taipeiTime';

export function nowIso() {
  return new Date().toISOString();
}

let identifierSequence = 0;
export function uid(prefix: string) {
  identifierSequence = (identifierSequence + 1) % Number.MAX_SAFE_INTEGER;
  const entropy = globalThis.crypto?.randomUUID?.()
    || Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${identifierSequence.toString(36)}_${entropy}`;
}

export function localDate(date = new Date()) {
  return taipeiDateKey(date);
}

export function todayDate() {
  return taipeiDateKey();
}

export function yesterdayDate() {
  return taipeiYesterdayDate();
}

export function daysDiff(value: string) {
  return taipeiDaysDiff(value);
}

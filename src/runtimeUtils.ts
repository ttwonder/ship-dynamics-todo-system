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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayDate() {
  return localDate();
}

export function yesterdayDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDate(date);
}

export function daysDiff(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  if (
    target.getFullYear() !== year
    || target.getMonth() !== month - 1
    || target.getDate() !== day
  ) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

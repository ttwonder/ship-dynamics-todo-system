import { Temporal } from '@js-temporal/polyfill';
import { isValidIanaTimeZone } from './itineraryTime';
import type { ItineraryDocument, ItineraryRow } from './itineraryTypes';

export interface ItineraryCalendarRange {
  ok: true;
  startInstant: string;
  endInstant: string;
  dayStarts: string[];
}

export type ItineraryCalendarRangeResult = ItineraryCalendarRange | { ok: false; reason: 'invalid-date' | 'invalid-time-zone' | 'invalid-days' };

export interface ItineraryCalendarEntry {
  vesselId: string;
  vesselName: string;
  row: ItineraryRow;
  startInstant: string;
  endInstant: string;
  leftPercent: number;
  widthPercent: number;
}

export function calendarRangeFromLocalDate(localDate: string, days: number, timeZone: string): ItineraryCalendarRangeResult {
  if (!isValidIanaTimeZone(timeZone)) return { ok: false, reason: 'invalid-time-zone' };
  if (!Number.isInteger(days) || days < 1 || days > 60) return { ok: false, reason: 'invalid-days' };
  try {
    const date = Temporal.PlainDate.from(localDate);
    const start = date.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from('00:00') });
    const dayStarts = Array.from({ length: days + 1 }, (_, index) => start.add({ days: index }).toInstant().toString());
    return { ok: true, startInstant: dayStarts[0], endInstant: dayStarts[dayStarts.length - 1], dayStarts };
  } catch {
    return { ok: false, reason: 'invalid-date' };
  }
}

export function buildItineraryCalendarEntries(documents: ItineraryDocument[], rangeStart: string, rangeEnd: string): ItineraryCalendarEntry[] {
  const startMs = Date.parse(rangeStart);
  const endMs = Date.parse(rangeEnd);
  const duration = endMs - startMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || duration <= 0) return [];
  const entries: ItineraryCalendarEntry[] = [];
  for (const document of documents) {
    for (const row of document.rows) {
      const rowStart = row.etaUtc || row.etbUtc || row.etcUtc || row.etdUtc;
      const rowEnd = row.etdUtc || row.etcUtc || row.etbUtc || row.etaUtc;
      if (!rowStart || !rowEnd) continue;
      const rawStart = Date.parse(rowStart);
      const rawEnd = Math.max(rawStart, Date.parse(rowEnd));
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= startMs || rawStart >= endMs) continue;
      const clippedStart = Math.max(startMs, rawStart);
      const clippedEnd = Math.min(endMs, rawEnd);
      entries.push({
        vesselId: document.vesselId,
        vesselName: document.vesselName,
        row,
        startInstant: rowStart,
        endInstant: rowEnd,
        leftPercent: ((clippedStart - startMs) / duration) * 100,
        widthPercent: Math.max(((clippedEnd - clippedStart) / duration) * 100, 0.25),
      });
    }
  }
  return entries.sort((a, b) => Date.parse(a.startInstant) - Date.parse(b.startInstant) || a.vesselName.localeCompare(b.vesselName));
}

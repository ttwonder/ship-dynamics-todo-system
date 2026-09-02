import { Temporal } from '@js-temporal/polyfill';
import { isValidItineraryTimeZone, wallTimeToInstant } from './itineraryTime';
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

export interface ItineraryCalendarLaneEvent extends ItineraryCalendarEntry {
  layer: number;
}

export interface ItineraryCalendarLane {
  vesselId: string;
  vesselName: string;
  events: ItineraryCalendarLaneEvent[];
  layerCount: number;
}

export function calendarRangeFromLocalDate(localDate: string, days: number, timeZone: string): ItineraryCalendarRangeResult {
  if (!isValidItineraryTimeZone(timeZone)) return { ok: false, reason: 'invalid-time-zone' };
  if (!Number.isInteger(days) || days < 1 || days > 60) return { ok: false, reason: 'invalid-days' };
  try {
    const date = Temporal.PlainDate.from(localDate);
    const dayStarts: string[] = [];
    for (let index = 0; index <= days; index += 1) {
      const boundary = wallTimeToInstant(date.add({ days: index }).toString(), '00:00', timeZone);
      if (!boundary.ok) return { ok: false, reason: 'invalid-date' };
      dayStarts.push(boundary.instant);
    }
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

export function buildItineraryCalendarLanes(documents: ItineraryDocument[], rangeStart: string, rangeEnd: string): ItineraryCalendarLane[] {
  const rangeStartMs = Date.parse(rangeStart);
  const rangeEndMs = Date.parse(rangeEnd);
  return documents.map(document => {
    const layerEnds: number[] = [];
    const events = buildItineraryCalendarEntries([document], rangeStart, rangeEnd).map((entry): ItineraryCalendarLaneEvent => {
      const rawStart = Date.parse(entry.startInstant);
      const rawEnd = Math.max(rawStart, Date.parse(entry.endInstant));
      const visibleStart = Math.max(rangeStartMs, rawStart);
      const visibleEnd = Math.min(rangeEndMs, rawEnd);
      let layer = layerEnds.findIndex(layerEnd => layerEnd <= visibleStart);
      if (layer < 0) layer = layerEnds.length;
      layerEnds[layer] = visibleEnd;
      return { ...entry, layer };
    });
    return {
      vesselId: document.vesselId,
      vesselName: document.vesselName,
      events,
      layerCount: Math.max(1, layerEnds.length),
    };
  });
}

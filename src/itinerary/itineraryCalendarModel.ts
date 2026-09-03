import { Temporal } from '@js-temporal/polyfill';
import { formatItineraryUtcOffset, instantToWallTime, isValidItineraryTimeZone, wallTimeToInstant } from './itineraryTime';
import { formatItineraryOperation, resolveItineraryTimeZone } from './itineraryTypes';
import type { ItineraryDocument, ItineraryRow, ItineraryTimeField } from './itineraryTypes';
import type { TaskItem } from '../types';
import type { TaskPlannedCalendarEvent } from '../taskPlannedSchedule';

export interface ItineraryCalendarRange {
  ok: true;
  startInstant: string;
  endInstant: string;
  dayStarts: string[];
}

export type ItineraryCalendarRangeResult = ItineraryCalendarRange | { ok: false; reason: 'invalid-date' | 'invalid-time-zone' | 'invalid-days' };

interface CalendarEntryLayout {
  vesselId: string;
  vesselName: string;
  eventId: string;
  startInstant: string;
  endInstant: string;
  leftPercent: number;
  widthPercent: number;
}

export type ItineraryCalendarEntry = CalendarEntryLayout & (
  | { source: 'itinerary'; row: ItineraryRow }
  | { source: 'task'; task: TaskItem; rangeLabel: string }
);

export type ItineraryCalendarLaneEvent = ItineraryCalendarEntry & { layer: number };

export interface ItineraryCalendarLane {
  vesselId: string;
  vesselName: string;
  events: ItineraryCalendarLaneEvent[];
  layerCount: number;
}

function compactTooltipText(value: string): string {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.length ? lines.join('；') : '—';
}

function formatDestinationTimeZone(row: ItineraryRow): string {
  const timeZone = row.portTimeZone.trim();
  if (!timeZone) return '—';
  const referenceInstant = row.etaUtc || row.etbUtc || row.etcUtc || row.etdUtc;
  const offset = formatItineraryUtcOffset(timeZone, referenceInstant);
  if (!offset || offset === timeZone) return timeZone;
  return `${timeZone}（${offset}）`;
}

function formatTooltipTime(row: ItineraryRow, field: ItineraryTimeField): string {
  const instant = row[field];
  if (!instant) return '—';
  const timeZone = resolveItineraryTimeZone(row, field);
  const wall = instantToWallTime(instant, timeZone);
  const offset = formatItineraryUtcOffset(timeZone, instant);
  if (!wall.ok || !offset) return '—';
  return `${wall.date} ${wall.time}（${offset}）`;
}

export function buildItineraryCalendarEventTitle(vesselName: string, row: ItineraryRow): string {
  return [
    `船舶：${compactTooltipText(vesselName)} ｜ 航次：${compactTooltipText(row.voyageNumber)}`,
    `港口：${compactTooltipText(row.portDockName)} ｜ 預計作業類型：${formatItineraryOperation(row.operation) || '—'} ｜ 目的地時區：${formatDestinationTimeZone(row)}`,
    `ETA：${formatTooltipTime(row, 'etaUtc')} ｜ ETB：${formatTooltipTime(row, 'etbUtc')}`,
    `ETC：${formatTooltipTime(row, 'etcUtc')} ｜ ETD：${formatTooltipTime(row, 'etdUtc')}`,
    `B/F or I/F Qty (MT/BBLS)：${compactTooltipText(row.cargoQuantityText)} ｜ 預計裝卸速度：${compactTooltipText(row.ldRateText)}`,
    `到港吃水：${compactTooltipText(row.arrivalDraftText)} ｜ 離港吃水：${compactTooltipText(row.departureDraftText)}`,
  ].join('\n');
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

function eventLayout(startInstant: string, endInstant: string, rangeStartMs: number, rangeEndMs: number) {
  const rawStart = Date.parse(startInstant);
  const parsedEnd = Date.parse(endInstant);
  const rawEnd = Math.max(rawStart, parsedEnd);
  const duration = rangeEndMs - rangeStartMs;
  if (!Number.isFinite(rawStart) || !Number.isFinite(parsedEnd) || rawEnd <= rangeStartMs || rawStart >= rangeEndMs || duration <= 0) return null;
  const clippedStart = Math.max(rangeStartMs, rawStart);
  const clippedEnd = Math.min(rangeEndMs, rawEnd);
  return {
    leftPercent: ((clippedStart - rangeStartMs) / duration) * 100,
    widthPercent: Math.max(((clippedEnd - clippedStart) / duration) * 100, 0.25),
  };
}

export function buildItineraryCalendarEntries(
  documents: ItineraryDocument[],
  rangeStart: string,
  rangeEnd: string,
  taskEvents: TaskPlannedCalendarEvent[] = [],
): ItineraryCalendarEntry[] {
  const rangeStartMs = Date.parse(rangeStart);
  const rangeEndMs = Date.parse(rangeEnd);
  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs) return [];
  const documentIds = new Set(documents.map(document => document.vesselId));
  const entries: ItineraryCalendarEntry[] = [];
  for (const document of documents) {
    for (const row of document.rows) {
      const rowStart = row.etaUtc || row.etbUtc || row.etcUtc || row.etdUtc;
      const rowEnd = row.etdUtc || row.etcUtc || row.etbUtc || row.etaUtc;
      if (!rowStart || !rowEnd) continue;
      const layout = eventLayout(rowStart, rowEnd, rangeStartMs, rangeEndMs);
      if (!layout) continue;
      entries.push({
        source: 'itinerary',
        eventId: `itinerary:${document.vesselId}:${row.rowId}`,
        vesselId: document.vesselId,
        vesselName: document.vesselName,
        row,
        startInstant: rowStart,
        endInstant: rowEnd,
        ...layout,
      });
    }
  }
  for (const event of taskEvents) {
    if (!documentIds.has(event.vesselId)) continue;
    const layout = eventLayout(event.startInstant, event.endInstant, rangeStartMs, rangeEndMs);
    if (!layout) continue;
    entries.push({
      source: 'task',
      eventId: event.eventId,
      vesselId: event.vesselId,
      vesselName: event.vesselName,
      task: event.task,
      startInstant: event.startInstant,
      endInstant: event.endInstant,
      rangeLabel: event.rangeLabel,
      ...layout,
    });
  }
  return entries.sort((a, b) => Date.parse(a.startInstant) - Date.parse(b.startInstant)
    || a.vesselName.localeCompare(b.vesselName)
    || a.eventId.localeCompare(b.eventId));
}

export function buildItineraryCalendarLanes(
  documents: ItineraryDocument[],
  rangeStart: string,
  rangeEnd: string,
  taskEvents: TaskPlannedCalendarEvent[] = [],
): ItineraryCalendarLane[] {
  const rangeStartMs = Date.parse(rangeStart);
  const rangeEndMs = Date.parse(rangeEnd);
  const entries = buildItineraryCalendarEntries(documents, rangeStart, rangeEnd, taskEvents);
  return documents.map(document => {
    const layerEnds: number[] = [];
    const events = entries.filter(entry => entry.vesselId === document.vesselId).map((entry): ItineraryCalendarLaneEvent => {
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

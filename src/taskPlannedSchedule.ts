import { Temporal } from '@js-temporal/polyfill';
import type { TaskItem } from './types';
import { taskVesselIds } from './taskVesselScope';
import { addHoursToInstant, wallTimeToInstant } from './itinerary/itineraryTime';

export type PlannedTaskScheduleFailureReason =
  | 'missing-date'
  | 'invalid-date'
  | 'missing-duration'
  | 'invalid-duration'
  | 'invalid-time-zone';

export interface PlannedTaskSchedule {
  ok: true;
  startDate: string;
  durationDays: number;
  startInstant: string;
  endInstant: string;
  rangeLabel: string;
}

export type PlannedTaskScheduleResult = PlannedTaskSchedule | { ok: false; reason: PlannedTaskScheduleFailureReason };

export interface TaskCalendarVessel {
  id: string;
  vesselName: string;
}

export interface TaskPlannedCalendarEvent {
  source: 'task';
  eventId: string;
  vesselId: string;
  vesselName: string;
  task: TaskItem;
  startInstant: string;
  endInstant: string;
  rangeLabel: string;
}

export function normalizePlannedStartDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  try {
    const parsed = Temporal.PlainDate.from(value);
    return parsed.toString() === value ? value : undefined;
  } catch {
    return undefined;
  }
}

export function isValidPlannedDurationDays(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && (value === 0.5 || (Number.isInteger(value) && value >= 1));
}

export function normalizePlannedDurationDays(value: unknown): number | undefined {
  return isValidPlannedDurationDays(value) ? value : undefined;
}

export function isPlannedDurationEditingInput(value: string): boolean {
  return value === '' || value === '0' || value === '0.' || value === '0.5' || /^[1-9]\d*$/.test(value);
}

export function plannedDurationInputAfterDateChange(nextDate: string, currentInput: string): string {
  return nextDate && currentInput === '' ? '1' : currentInput;
}

export function parsePlannedDurationInput(value: string): { ok: true; value: number | undefined } | { ok: false } {
  if (value === '') return { ok: true, value: undefined };
  if (!(value === '0.5' || /^[1-9]\d*$/.test(value))) return { ok: false };
  const parsed = Number(value);
  return isValidPlannedDurationDays(parsed) ? { ok: true, value: parsed } : { ok: false };
}

function scheduleRangeLabel(startDate: string, durationDays: number): string {
  if (durationDays === 0.5) return `${startDate} 00:00～12:00`;
  const start = Temporal.PlainDate.from(startDate);
  const inclusiveEnd = start.add({ days: durationDays - 1 }).toString();
  return inclusiveEnd === startDate ? startDate : `${startDate}～${inclusiveEnd}`;
}

export function buildPlannedTaskSchedule(startDateValue: unknown, durationValue: unknown, timeZone: string): PlannedTaskScheduleResult {
  if (startDateValue === '' || startDateValue === undefined || startDateValue === null) return { ok: false, reason: 'missing-date' };
  const startDate = normalizePlannedStartDate(startDateValue);
  if (!startDate) return { ok: false, reason: 'invalid-date' };
  if (durationValue === '' || durationValue === undefined || durationValue === null) return { ok: false, reason: 'missing-duration' };
  const durationDays = normalizePlannedDurationDays(durationValue);
  if (!durationDays) return { ok: false, reason: 'invalid-duration' };
  const start = wallTimeToInstant(startDate, '00:00', timeZone);
  if (!start.ok) return { ok: false, reason: 'invalid-time-zone' };
  const endInstant = addHoursToInstant(start.instant, durationDays * 24);
  if (!endInstant) return { ok: false, reason: 'invalid-date' };
  return {
    ok: true,
    startDate,
    durationDays,
    startInstant: start.instant,
    endInstant,
    rangeLabel: scheduleRangeLabel(startDate, durationDays),
  };
}

export function changedTaskPlannedCalendarEvents(
  previous: TaskPlannedCalendarEvent[],
  current: TaskPlannedCalendarEvent[],
): TaskPlannedCalendarEvent[] {
  const previousSignatures = new Map(previous.map(event => [event.eventId, `${event.startInstant}\u0000${event.endInstant}`]));
  return current.filter(event => previousSignatures.get(event.eventId) !== `${event.startInstant}\u0000${event.endInstant}`);
}

export function projectTaskPlannedCalendarEvents(
  tasks: TaskItem[],
  vessels: TaskCalendarVessel[],
  timeZone: string,
): TaskPlannedCalendarEvent[] {
  const vesselById = new Map(vessels.map(vessel => [vessel.id, vessel]));
  const events: TaskPlannedCalendarEvent[] = [];
  for (const task of tasks) {
    const schedule = buildPlannedTaskSchedule(task.plannedStartDate, task.plannedDurationDays, timeZone);
    if (!schedule.ok) continue;
    for (const vesselId of taskVesselIds(task)) {
      const vessel = vesselById.get(vesselId);
      if (!vessel) continue;
      events.push({
        source: 'task',
        eventId: `task:${task.id}:${vesselId}`,
        vesselId,
        vesselName: vessel.vesselName,
        task,
        startInstant: schedule.startInstant,
        endInstant: schedule.endInstant,
        rangeLabel: schedule.rangeLabel,
      });
    }
  }
  return events;
}

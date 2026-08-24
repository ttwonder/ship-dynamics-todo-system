import type { AgendaReport, AppData, InternalControlCase, MorningReportSnapshot, TaskItem, TemporaryMeeting, Vessel } from './types';
import { isTaipeiBusinessDay, taipeiBusinessDateLabel, taipeiDateKey } from './taipeiTime';
import { morningDiscussionTasks } from './morningTaskScope';
import { taskVesselIds } from './taskVesselScope';
import { taskIsClosedForScope } from './taskVesselProgress';

export type MorningHistoryData = Pick<AppData, 'agendaReports' | 'vessels' | 'tasks' | 'meetings'> & {
  internalControlCases?: InternalControlCase[];
};

export interface MorningWindow {
  startedAt?: string;
  endedAt: string;
}

export interface DailyMorningSaveInput {
  at?: Date | string | number;
  actorUserId: string;
  source: 'manual' | 'scheduled';
}

export type DailyMorningSaveResult<T extends MorningHistoryData> =
  | { status: 'not-business-day'; data: T; report?: undefined }
  | { status: 'saved'; data: T; report: AgendaReport };

function instantIso(value: Date | string | number | undefined): string {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('無效的早會快照時間');
  return date.toISOString();
}

function validInstant(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function reportCutoff(report: AgendaReport): string | undefined {
  if (report.kind !== 'daily-morning' || report.source === 'scheduled') return undefined;
  return validInstant(report.snapshot?.windowEndedAt) || validInstant(report.createdAt) || validInstant(report.snapshot?.capturedAt);
}

function latestManualReport(reports: AgendaReport[], endedAt: string, excludedReportId = ''): AgendaReport | undefined {
  const candidates = reports
    .filter(report => report.id !== excludedReportId)
    .map(report => ({ report, cutoff: reportCutoff(report) }))
    .filter((entry): entry is { report: AgendaReport; cutoff: string } => Boolean(entry.cutoff) && entry.cutoff! <= endedAt)
    .sort((left, right) => left.cutoff.localeCompare(right.cutoff));
  return candidates[candidates.length - 1]?.report;
}

function latestManualCutoff(reports: AgendaReport[], endedAt: string, excludedReportId = ''): string | undefined {
  const report = latestManualReport(reports, endedAt, excludedReportId);
  return report ? reportCutoff(report) : undefined;
}

export function liveMorningWindow(reports: AgendaReport[], at?: Date | string | number): MorningWindow {
  const endedAt = instantIso(at);
  return { startedAt: latestManualCutoff(reports, endedAt), endedAt };
}

export function morningWindowIsAccumulatingNextMeeting(window: MorningWindow): boolean {
  return Boolean(window.startedAt && taipeiDateKey(window.startedAt) === taipeiDateKey(window.endedAt));
}

export function morningBaselineSnapshot(reports: AgendaReport[], window: MorningWindow): MorningReportSnapshot | undefined {
  if (!window.startedAt) return undefined;
  const report = latestManualReport(reports, window.endedAt);
  return report && reportCutoff(report) === window.startedAt ? report.snapshot : undefined;
}

const TECHNICAL_MORNING_KEYS = new Set(['createdAt', 'updatedAt', 'updatedBy', '_v7Id', '_v7Revision']);

function morningBusinessValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(morningBusinessValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const statusLog = typeof record.text === 'string' && 'at' in record;
  return Object.fromEntries(Object.keys(record).sort().flatMap(key => {
    if (TECHNICAL_MORNING_KEYS.has(key) || (statusLog && (key === 'id' || key === 'at'))) return [];
    return [[key, morningBusinessValue(record[key])]];
  }));
}

export function morningItemBusinessContentChanged(current: object, baseline: object): boolean {
  return JSON.stringify(morningBusinessValue(current)) !== JSON.stringify(morningBusinessValue(baseline));
}

export function morningItemChangedInWindow(
  item: { createdAt?: string; updatedAt?: string },
  window: MorningWindow,
  baseline?: { createdAt?: string; updatedAt?: string },
): boolean {
  const createdAt = validInstant(item.createdAt);
  if (createdAt && (!window.startedAt || createdAt > window.startedAt) && createdAt <= window.endedAt) return true;
  const updatedAt = validInstant(item.updatedAt);
  if (!updatedAt || (window.startedAt && updatedAt <= window.startedAt) || updatedAt > window.endedAt) return false;
  return baseline ? morningItemBusinessContentChanged(item, baseline) : true;
}

function cloneSnapshot(
  vessels: Vessel[],
  tasks: TaskItem[],
  internalControlCases: InternalControlCase[],
  meetings: TemporaryMeeting[],
  capturedAt: string,
  window: MorningWindow,
  manualCutoff: boolean,
  todayTaskIds: string[],
  todayInternalControlCaseIds: string[],
): MorningReportSnapshot {
  return structuredClone({
    capturedAt,
    ...(window.startedAt ? { windowStartedAt: window.startedAt } : {}),
    ...(manualCutoff ? { windowEndedAt: window.endedAt, todayTaskIds, todayInternalControlCaseIds } : {}),
    vessels,
    tasks,
    internalControlCases,
    meetings,
  });
}

function morningSnapshotContent(
  tasks: TaskItem[],
  internalControlCases: InternalControlCase[],
  meetings: TemporaryMeeting[],
  vesselIds: string[],
  window: MorningWindow,
  baselineTasks: TaskItem[] = [],
  baselineInternalControlCases: InternalControlCase[] = [],
) {
  const allowed = new Set(vesselIds);
  const visibleMeetings = meetings.filter(meeting => meeting.includeInMorning && !meeting.isInternalControl);
  const meetingIds = new Set(visibleMeetings.map(meeting => meeting.id));
  const discussionTasks = morningDiscussionTasks(tasks, visibleMeetings);
  const baselineTaskById = new Map(baselineTasks.map(task => [task.id, task]));
  const baselineCaseById = new Map(baselineInternalControlCases.map(item => [item.id, item]));
  const todayTaskIds = new Set<string>();
  const todayInternalControlCaseIds = new Set<string>();
  discussionTasks.forEach(task => {
    if (!task.isInternalControl && (!task.isClosed || window.startedAt) && morningItemChangedInWindow(task, window, baselineTaskById.get(task.id))) todayTaskIds.add(task.id);
  });
  internalControlCases.forEach(item => {
    if ((!item.isClosed || window.startedAt) && morningItemChangedInWindow(item, window, baselineCaseById.get(item.id))) todayInternalControlCaseIds.add(item.id);
  });
  const visibleTasks = discussionTasks.filter(task => {
    if (task.isInternalControl) return false;
    if (task.sourceMeetingId && !meetingIds.has(task.sourceMeetingId)) return false;
    const scopedIds = taskVesselIds(task).filter(id => allowed.has(id));
    if (!scopedIds.length || validInstant(task.createdAt)! > window.endedAt) return false;
    return !taskIsClosedForScope(task, scopedIds) || todayTaskIds.has(task.id);
  });
  const visibleInternalControlCases = internalControlCases.filter(item => {
    if (!allowed.has(item.vesselId) || validInstant(item.createdAt)! > window.endedAt) return false;
    return !item.isClosed || todayInternalControlCaseIds.has(item.id);
  });
  const usedMeetingIds = new Set(visibleTasks.map(task => task.sourceMeetingId).filter(Boolean));
  return {
    tasks: visibleTasks,
    internalControlCases: visibleInternalControlCases,
    meetings: visibleMeetings.filter(meeting => usedMeetingIds.has(meeting.id)),
    todayTaskIds: [...todayTaskIds].filter(id => visibleTasks.some(task => task.id === id)),
    todayInternalControlCaseIds: [...todayInternalControlCaseIds].filter(id => visibleInternalControlCases.some(item => item.id === id)),
  };
}

export function upsertDailyMorningReport<T extends MorningHistoryData>(data: T, input: DailyMorningSaveInput): DailyMorningSaveResult<T> {
  const capturedAt = instantIso(input.at);
  if (!isTaipeiBusinessDay(capturedAt)) return { status: 'not-business-day', data };

  const businessDate = taipeiDateKey(capturedAt);
  const vessels = data.vessels.filter(vessel => vessel.isActive !== false);
  const vesselIds = vessels.map(vessel => vessel.id);
  const existingIndex = data.agendaReports.findIndex(report => report.kind === 'daily-morning' && report.businessDate === businessDate);
  const existing = existingIndex >= 0 ? data.agendaReports[existingIndex] : undefined;
  const existingManualCutoff = existing?.source === 'manual' ? reportCutoff(existing) : undefined;
  const manualCutoff = input.source === 'manual' || existing?.source === 'manual';
  const windowEndedAt = manualCutoff ? existingManualCutoff || capturedAt : capturedAt;
  const refreshingExistingManual = Boolean(existingManualCutoff && existing?.source === 'manual' && existing.snapshot);
  const previousManualReport = latestManualReport(data.agendaReports, windowEndedAt, existing?.id);
  const previousManualCutoff = previousManualReport ? reportCutoff(previousManualReport) : undefined;
  const window: MorningWindow = {
    startedAt: refreshingExistingManual
      ? validInstant(existing?.snapshot?.windowStartedAt) || previousManualCutoff
      : previousManualCutoff,
    endedAt: windowEndedAt,
  };
  const content = refreshingExistingManual ? {
    tasks: structuredClone(existing!.snapshot!.tasks),
    internalControlCases: structuredClone(existing!.snapshot!.internalControlCases || []),
    meetings: structuredClone(existing!.snapshot!.meetings),
    todayTaskIds: [...(existing!.snapshot!.todayTaskIds || [])],
    todayInternalControlCaseIds: [...(existing!.snapshot!.todayInternalControlCaseIds || [])],
  } : morningSnapshotContent(
    data.tasks,
    data.internalControlCases || [],
    data.meetings,
    vesselIds,
    window,
    previousManualReport?.snapshot?.tasks || [],
    previousManualReport?.snapshot?.internalControlCases || [],
  );
  const snapshot = cloneSnapshot(
    vessels,
    content.tasks,
    content.internalControlCases,
    content.meetings,
    capturedAt,
    window,
    manualCutoff,
    content.todayTaskIds,
    content.todayInternalControlCaseIds,
  );
  const report: AgendaReport = {
    id: existing?.id || `daily-morning-${businessDate}`,
    title: `${taipeiBusinessDateLabel(capturedAt)}早會內容`,
    vesselIds,
    createdBy: existing?.createdBy || input.actorUserId,
    createdAt: existing?.createdAt || capturedAt,
    taskCount: content.tasks.length + content.internalControlCases.length,
    kind: 'daily-morning',
    businessDate,
    source: input.source === 'manual' || existing?.source !== 'manual' ? input.source : 'manual',
    updatedAt: capturedAt,
    snapshot,
  };
  const agendaReports = [...data.agendaReports];
  if (existingIndex >= 0) agendaReports[existingIndex] = report;
  else agendaReports.unshift(report);
  return { status: 'saved', data: { ...data, agendaReports } as T, report };
}

export function dailyMorningReports(reports: AgendaReport[]): AgendaReport[] {
  return reports
    .filter(report => report.kind === 'daily-morning' && Boolean(report.businessDate) && Boolean(report.snapshot))
    .sort((left, right) => (right.businessDate || '').localeCompare(left.businessDate || '') || (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt));
}

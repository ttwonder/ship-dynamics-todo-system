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

function latestManualCutoff(reports: AgendaReport[], endedAt: string, excludedReportId = ''): string | undefined {
  const cutoffs = reports
    .filter(report => report.id !== excludedReportId)
    .map(reportCutoff)
    .filter((value): value is string => Boolean(value) && value <= endedAt)
    .sort();
  return cutoffs[cutoffs.length - 1];
}

export function liveMorningWindow(reports: AgendaReport[], at?: Date | string | number): MorningWindow {
  const endedAt = instantIso(at);
  return { startedAt: latestManualCutoff(reports, endedAt), endedAt };
}

export function morningWindowIsAccumulatingNextMeeting(window: MorningWindow): boolean {
  return Boolean(window.startedAt && taipeiDateKey(window.startedAt) === taipeiDateKey(window.endedAt));
}

export function morningItemChangedInWindow(item: { createdAt?: string; updatedAt?: string }, window: MorningWindow): boolean {
  const instants = [validInstant(item.createdAt), validInstant(item.updatedAt)].filter((value): value is string => Boolean(value));
  return instants.some(value => (!window.startedAt || value > window.startedAt) && value <= window.endedAt);
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
  preservedTodayTaskIds: string[] = [],
  preservedTodayInternalControlCaseIds: string[] = [],
) {
  const allowed = new Set(vesselIds);
  const visibleMeetings = meetings.filter(meeting => meeting.includeInMorning && !meeting.isInternalControl);
  const meetingIds = new Set(visibleMeetings.map(meeting => meeting.id));
  const todayTaskIds = new Set(preservedTodayTaskIds);
  const todayInternalControlCaseIds = new Set(preservedTodayInternalControlCaseIds);
  tasks.forEach(task => {
    if (!task.isInternalControl && (!task.isClosed || window.startedAt) && morningItemChangedInWindow(task, window)) todayTaskIds.add(task.id);
  });
  internalControlCases.forEach(item => {
    if ((!item.isClosed || window.startedAt) && morningItemChangedInWindow(item, window)) todayInternalControlCaseIds.add(item.id);
  });
  const visibleTasks = morningDiscussionTasks(tasks, visibleMeetings).filter(task => {
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
  const window: MorningWindow = {
    startedAt: refreshingExistingManual
      ? validInstant(existing?.snapshot?.windowStartedAt) || latestManualCutoff(data.agendaReports, windowEndedAt, existing?.id)
      : latestManualCutoff(data.agendaReports, windowEndedAt, existing?.id),
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

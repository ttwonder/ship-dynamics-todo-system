import type { AppData, TaskItem, TemporaryMeeting, Vessel } from './types';
import { taskVesselIds } from './taskVesselScope';
import { taskProgressForVessel, usesPerVesselProgress } from './taskVesselProgress';
import { taskCategoriesOf, isMeetingTaskSource } from './taskCategories';
import { taipeiDateKey } from './taipeiTime';
import { meetingHandoverVesselIds, vesselResponsibilityIncludes } from './vesselManagerHandover';
import { analysisDateError } from './dataAnalysisModel';
import type { AnalysisInterval } from './dataAnalysisModel';
import { meetingDecisionCompletionSummary } from './meetingTaskWorkflow';

export type CaseProgress = { closed: boolean; closedDate: string };
export interface StatisticsCase extends CaseProgress {
  id: string; source: string; createdDate: string; dueDate: string;
  priority: string; status: string; departments: string[]; people: string[];
  vesselIds: string[]; categories: string[]; flags: string[];
  members?: Record<string, CaseProgress>;
}
export function validStatisticsDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : '';
}
export function statisticsTimestampDate(value: string): string {
  if (!validStatisticsDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) return '';
  return validStatisticsDate(taipeiDateKey(value));
}
export const statisticsPercent = (part: number, total: number): number | null => total ? Math.round(part / total * 100) : null;
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86400000;
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
export function scopedCaseProgress(members: CaseProgress[]): CaseProgress {
  const closed = members.length > 0 && members.every(member => member.closed);
  return { closed, closedDate: closed && members.every(member => member.closedDate) ? members.map(member => member.closedDate).sort().slice(-1)[0]! : '' };
}
// Input tasks have already passed the parent page's authorization and filters.
// Never recover a hidden task from data.tasks or widen the supplied vessel scope.
export function taskStatisticsCases(tasks: TaskItem[], data: AppData, vessels: Vessel[]): StatisticsCase[] {
  return tasks.map(task => {
    const scope = vessels.filter(vessel => taskVesselIds(task).includes(vessel.id));
    const members = usesPerVesselProgress(task) && scope.length ? Object.fromEntries(scope.map(vessel => {
      const progress = taskProgressForVessel(task, vessel.id);
      return [vessel.id, { closed: progress.isClosed, closedDate: validStatisticsDate(progress.closedDate || '') }];
    })) : undefined;
    const progress = members ? scopedCaseProgress(Object.values(members)) : { closed: task.isClosed, closedDate: validStatisticsDate(task.closedDate || '') };
    const managers = data.users.filter(user => user.isActive && user.role !== 'vessel' && scope.some(vessel => vesselResponsibilityIncludes(task, vessel, user)));
    const people = unique([...task.ownerUserIds, ...managers.map(user => user.id)]);
    return { id: task.id, source: isMeetingTaskSource(task) ? '臨會/專題待辦' : '一般要事', ...progress, members,
      createdDate: statisticsTimestampDate(task.createdAt), dueDate: validStatisticsDate(task.expectedDate),
      priority: task.priority, status: progress.closed ? '已完成' : '未完成',
      departments: unique([...task.departments, ...data.users.filter(user => people.includes(user.id)).map(user => user.department)]), people,
      vesselIds: scope.map(vessel => vessel.id), categories: taskCategoriesOf(task),
      flags: [task.isAware ? '需知曉' : '', task.isInternalControl ? '內部管控' : '', task.isAbnormal ? '異常' : ''].filter(Boolean),
    };
  });
}
export function statisticsMetrics(records: StatisticsCase[], today = taipeiDateKey()) {
  const closed = records.filter(record => record.closed);
  const open = records.filter(record => !record.closed);
  const overdue = open.filter(record => record.dueDate && record.dueDate < today);
  const datedClosed = closed.filter(record => record.dueDate && record.closedDate);
  const onTime = datedClosed.filter(record => record.closedDate <= record.dueDate);
  const durations = closed.filter(record => record.createdDate && record.closedDate && record.closedDate >= record.createdDate).map(record => daysBetween(record.createdDate, record.closedDate));
  return { total: records.length, closed: closed.length, open: open.length, overdue: overdue.length,
    completionRate: statisticsPercent(closed.length, records.length), overdueRate: statisticsPercent(overdue.length, records.length),
    openOverdueRate: statisticsPercent(overdue.length, open.length), onTime: onTime.length, onTimeBase: datedClosed.length,
    onTimeRate: statisticsPercent(onTime.length, datedClosed.length), lateClosed: datedClosed.length - onTime.length,
    averageDays: durations.length ? Math.round(durations.reduce((a,b) => a+b,0) / durations.length * 10) / 10 : null,
    durationBase: durations.length, noDueDate: records.filter(record => !record.dueDate).length,
    unknownClosedTiming: closed.length - datedClosed.length,
  };
}

export function meetingStatisticsCases(meetings: TemporaryMeeting[], data: AppData, vessels: Vessel[]): StatisticsCase[] {
  return meetings.map(meeting => {
    const ids = meetingHandoverVesselIds({vessels},meeting);
    const scope = vessels.filter(vessel => ids.includes(vessel.id));
    const managers = data.users.filter(user => user.isActive && user.role !== 'vessel' && scope.some(vessel => vesselResponsibilityIncludes(meeting,vessel,user)));
    const people = unique([...(meeting.trackingUserIds || []), ...meeting.responsibleUserIds, ...managers.map(user => user.id)]);
    return { id: meeting.id, source: '會議/專題', closed: meeting.status === '已完成', closedDate: validStatisticsDate(meeting.completedDate || ''),
      createdDate: statisticsTimestampDate(meeting.createdAt), dueDate: validStatisticsDate(meeting.expectedDate),
      priority: meeting.priority, status: meeting.status || '追蹤中',
      departments: unique([...meeting.departments,...data.users.filter(user => people.includes(user.id)).map(user => user.department)]), people,
      vesselIds: scope.map(vessel => vessel.id), categories: [], flags: [meeting.isInternalControl?'內部管控':'',meeting.isAbnormal?'異常':''].filter(Boolean),
    };
  });
}
export function meetingDecisionStatisticsCases(meetings: TemporaryMeeting[], data: AppData, vessels: Vessel[]) {
  const meetingIds = new Set(meetings.map(meeting => meeting.id));
  const tasks = data.tasks.filter(task => task.sourceMeetingId && meetingIds.has(task.sourceMeetingId));
  const records = taskStatisticsCases(tasks,data,vessels);
  const parents = new Map(meetingStatisticsCases(meetings,data,vessels).map(record => [record.id,record]));
  let unavailable = 0;
  for (const meeting of meetings) {
    const summary = meetingDecisionCompletionSummary(meeting,data.tasks);
    for (const decision of summary.items) {
      if (decision.task && tasks.some(task => task.id === decision.task!.id)) continue;
      // Only the original no-vessel decision workflow has independent item closure.
      // Missing/hidden/duplicate links are not invented as completed or overdue tasks.
      if (!meeting.vessels.length && !decision.task && (decision.state === 'open' || decision.state === 'closed')) {
        records.push({ ...parents.get(meeting.id)!, id: `decision:${meeting.id}:${decision.item.id}`, source: '無涉船會議決議', closed: decision.state === 'closed', closedDate: validStatisticsDate(decision.item.closedDate || ''), status: decision.state === 'closed' ? '已完成' : '未完成', categories: decision.item.categories });
      } else unavailable++;
    }
  }
  return { records, unavailable };
}

export type StatisticsDimension = 'department' | 'person' | 'vessel' | 'source' | 'category' | 'priority' | 'status' | 'flags' | 'age';
export type StatisticsSort = 'total' | 'completionRate' | 'overdueRate' | 'overdue' | 'lateClosed' | 'onTimeRate';
export const statisticsDimensions: Record<StatisticsDimension, string> = { department: '部門', person: '人員', vessel: '船舶', source: '來源', category: '分類', priority: '關注程度', status: '完成狀態', flags: '管控標記', age: '未結案齡' };
export function statisticsGroupKeys(record: StatisticsCase, dimension: StatisticsDimension, today = taipeiDateKey()): string[] {
  if (dimension === 'department') return record.departments.length ? unique(record.departments) : ['未指定部門'];
  if (dimension === 'person') return record.people.length ? unique(record.people) : ['未指定人員'];
  if (dimension === 'vessel') return record.vesselIds.length ? unique(record.vesselIds) : ['無可見涉船'];
  if (dimension === 'category') return (record.categories.length ? unique(record.categories) : ['未分類']).map(category => `${record.source}｜${category}`);
  if (dimension === 'flags') return record.flags.length ? unique(record.flags) : ['無標記'];
  if (dimension === 'age') {
    if (record.closed) return [];
    if (!record.createdDate || record.createdDate > today) return ['日期不明／未到'];
    const days = daysBetween(record.createdDate, today);
    return [days <= 7 ? '0–7 天' : days <= 30 ? '8–30 天' : days <= 90 ? '31–90 天' : '超過 90 天'];
  }
  return [record[dimension] || '未指定'];
}
export function statisticsGroups(records: StatisticsCase[], dimension: StatisticsDimension, sort: StatisticsSort = 'total', today = taipeiDateKey()) {
  const groups = new Map<string, StatisticsCase[]>();
  records.forEach(record => statisticsGroupKeys(record, dimension, today).forEach(key => {
    const scoped = dimension === 'vessel' && record.members?.[key] ? { ...record, ...record.members[key] } : record;
    const group = groups.get(key);
    if (group) group.push(scoped);
    else groups.set(key, [scoped]);
  }));
  const rows = [...groups].map(([id, cases]) => ({ id, records: cases, metrics: statisticsMetrics(cases, today) }));
  rows.sort((a,b) => (b.metrics[sort] ?? -1) - (a.metrics[sort] ?? -1) || b.metrics.total-a.metrics.total || a.id.localeCompare(b.id,'zh-TW'));
  return rows.map(row => ({ ...row, rank: rows.findIndex(other => other.metrics[sort] === row.metrics[sort]) + 1 }));
}
export interface StatisticsFilters { department: string; person: string; vessel: string; source: string; priority: string; fromDate: string; toDate: string; dateBasis: 'created' | 'closed' }
export const emptyStatisticsFilters: StatisticsFilters = { department: '', person: '', vessel: '', source: '', priority: '', fromDate: '', toDate: '', dateBasis: 'created' };
export function filterStatisticsCases(records: StatisticsCase[], filters: StatisticsFilters) {
  if (analysisDateError(filters)) return [];
  return records.filter(record => {
    if (filters.department && !record.departments.includes(filters.department)) return false;
    if (filters.person && !record.people.includes(filters.person)) return false;
    if (filters.vessel && !record.vesselIds.includes(filters.vessel)) return false;
    if (filters.source && record.source !== filters.source) return false;
    if (filters.priority && record.priority !== filters.priority) return false;
    const date = filters.dateBasis === 'created' ? record.createdDate : record.closed ? record.closedDate : '';
    return !(filters.fromDate || filters.toDate) || Boolean(date && (!filters.fromDate || date >= filters.fromDate) && (!filters.toDate || date <= filters.toDate));
  });
}
export function buildStatisticsTrend(records: StatisticsCase[], options: { interval: AnalysisInterval; fromDate: string; toDate: string }) {
  const events = records.flatMap(record => [{ date: record.createdDate, series: 'added' as const }, ...(record.closed ? [{ date: record.closedDate, series: 'closed' as const }] : [])]);
  const dates = events.map(event => event.date).filter(Boolean).sort();
  const result = { points: [] as Array<{ key: string; label: string; added: number; closed: number }>, fromDate: options.fromDate || dates[0] || '', toDate: options.toDate || dates[dates.length-1] || '', invalidDates: events.filter(event => !event.date).length, error: analysisDateError(options) };
  if (result.error || !result.fromDate || !result.toDate || result.fromDate > result.toDate) return result;
  const bucket = (key: string) => {
    const date = new Date(`${key}T00:00:00Z`);
    if (options.interval === 'month') date.setUTCDate(1);
    if (options.interval === 'week') date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
    return date;
  };
  const cursor = bucket(result.fromDate);
  while (cursor.toISOString().slice(0,10) <= result.toDate) {
    if (result.points.length >= 366) return { ...result, points: [], error: '區間超過 366 個時間點；請縮短日期範圍，或改用週／月。' };
    const key = cursor.toISOString().slice(0,10);
    result.points.push({ key, label: options.interval === 'month' ? key.slice(0,7) : key, added: 0, closed: 0 });
    if (options.interval === 'month') cursor.setUTCMonth(cursor.getUTCMonth()+1);
    else cursor.setUTCDate(cursor.getUTCDate()+(options.interval === 'week' ? 7 : 1));
  }
  const points = new Map(result.points.map(point => [point.key,point]));
  for (const event of events) {
    if (!event.date || event.date < result.fromDate || event.date > result.toDate) continue;
    const point = points.get(bucket(event.date).toISOString().slice(0,10));
    if (point) point[event.series]++;
  }
  return result;
}

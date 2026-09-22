import type { TaskItem } from './types';
import { isMeetingTaskSource } from './taskCategories';
import { taipeiDateKey } from './taipeiTime';

export type AnalysisSource = 'all' | 'ordinary' | 'meeting';
export type AnalysisInterval = 'day' | 'week' | 'month';
export type AnalysisSort = 'completionRate' | 'total' | 'overdue' | 'proposed';
export interface AnalysisFilters { fromDate: string; toDate: string; source: AnalysisSource }
export const emptyAnalysisFilters: AnalysisFilters = { fromDate: '', toDate: '', source: 'all' };
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const dateKey = (value: Date) => value.toISOString().slice(0, 10);

export function analysisDateError(filters: Pick<AnalysisFilters, 'fromDate' | 'toDate'>): string {
  if ([filters.fromDate, filters.toDate].some(value => value && !validDate(value))) return '日期格式無效，請重新選擇。';
  return filters.fromDate && filters.toDate && filters.fromDate > filters.toDate ? '日期起不得晚於日期迄。' : '';
}

export function analysisCreatedDate(task: Pick<TaskItem, 'createdAt'>): string {
  if (!validDate(task.createdAt.slice(0, 10))) return '';
  return taipeiDateKey(task.createdAt);
}

export function filterAnalysisTasks(tasks: TaskItem[], filters: AnalysisFilters): TaskItem[] {
  if (analysisDateError(filters)) return [];
  return tasks.filter(task => {
    if (filters.source !== 'all' && isMeetingTaskSource(task) !== (filters.source === 'meeting')) return false;
    if (!filters.fromDate && !filters.toDate) return true;
    const date = analysisCreatedDate(task);
    return Boolean(date && (!filters.fromDate || date >= filters.fromDate) && (!filters.toDate || date <= filters.toDate));
  });
}

export function sortAnalysisRows<T extends { id: string; metrics: { completionRate: number; overdueRate: number; total: number; overdue: number; proposed: number } }>(rows: T[], sort: AnalysisSort): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => b.metrics[sort] - a.metrics[sort] || (sort === 'completionRate' ? a.metrics.overdueRate - b.metrics.overdueRate || b.metrics.total - a.metrics.total : 0) || a.id.localeCompare(b.id, 'zh-TW'));
  return sorted.map((row, index) => ({ ...row, rank: sorted.findIndex(other => other.metrics[sort] === row.metrics[sort]) + 1 || index + 1 }));
}

export interface AnalysisTrendPoint { key: string; label: string; ordinary: number; meeting: number }
export interface AnalysisTrend { points: AnalysisTrendPoint[]; fromDate: string; toDate: string; invalidDates: number; error: string }
function bucketStart(value: string, interval: AnalysisInterval): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (interval === 'month') date.setUTCDate(1);
  if (interval === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date;
}

// The input is the mounted page's already-visible responsibility cohort.
// Each source has its own series. A multi-vessel task is still one task here.
export function buildAnalysisTrend(tasks: TaskItem[], options: { interval: AnalysisInterval; fromDate: string; toDate: string }): AnalysisTrend {
  const result: AnalysisTrend = { points: [], fromDate: options.fromDate, toDate: options.toDate, invalidDates: 0, error: analysisDateError(options) };
  if (result.error) return result;
  const events = tasks.map(task => ({ date: analysisCreatedDate(task), meeting: isMeetingTaskSource(task) }));
  result.invalidDates = events.filter(event => !event.date).length;
  const dates = events.map(event => event.date).filter(Boolean).sort();
  result.fromDate ||= dates[0] || '';
  result.toDate ||= dates[dates.length - 1] || '';
  if (!result.fromDate || !result.toDate || result.fromDate > result.toDate) return result;
  const cursor = bucketStart(result.fromDate, options.interval);
  while (dateKey(cursor) <= result.toDate) {
    if (result.points.length >= 366) return { ...result, points: [], error: '區間超過 366 個時間點；請縮短日期範圍，或改用週／月。' };
    const key = dateKey(cursor);
    result.points.push({ key, label: options.interval === 'month' ? key.slice(0, 7) : `${key}${options.interval === 'week' ? ' 週' : ''}`, ordinary: 0, meeting: 0 });
    if (options.interval === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + (options.interval === 'week' ? 7 : 1));
  }
  const points = new Map(result.points.map(point => [point.key, point]));
  for (const event of events) {
    if (!event.date || event.date < result.fromDate || event.date > result.toDate) continue;
    const point = points.get(dateKey(bucketStart(event.date, options.interval)));
    if (point) point[event.meeting ? 'meeting' : 'ordinary']++;
  }
  return result;
}

import type { TaskItem, WeeklyAttentionKey } from './types';

export const WEEKLY_ATTENTION_CATEGORY_MAP: Record<string, WeeklyAttentionKey> = {
  '換員操作': 'crew-operation',
  '加油加水': 'bunkering-water',
  '物料配件': 'materials-parts',
  '維修': 'maintenance',
  'Survey': 'survey',
  '稽核檢查': 'audit-inspection',
  'PSC窗口': 'psc-window',
};

export const REQUIRED_TASK_CATEGORIES = [
  '換員操作', '加油加水', '物料配件', '維修', 'Survey', '稽核檢查', 'PSC窗口', '事故',
  '證書', '缺失驗證', 'vetting', '貨品', '港口安排',
] as const;

export const REQUIRED_MEETING_TASK_CATEGORIES = [
  '船員管理', '船員培訓', '稽核認證', '船舶維護管理', '岸基培訓', '岸基人員管理',
] as const;

const retiredLegacyCategories = new Set(['人員', '物料', '檢驗', '內外部檢查', '臨時會議決議', '臨會/專題']);
const migrateCategory = (value: string) => value === '臨時會議決議' ? '臨會/專題' : value.trim();

export function normalizeTaskCategoryList(primary: unknown, categories: unknown): string[] {
  const list = Array.isArray(categories) ? categories.filter((item): item is string => typeof item === 'string') : [];
  const fallback = typeof primary === 'string' ? [primary] : [];
  return Array.from(new Set((list.length ? list : fallback).map(migrateCategory).filter(Boolean)));
}

export function normalizeConfiguredTaskCategories(categories: unknown): string[] {
  const provided = Array.isArray(categories) ? categories.filter((item): item is string => typeof item === 'string') : [];
  const custom = provided.map(migrateCategory).filter(item => item && !retiredLegacyCategories.has(item) && !REQUIRED_TASK_CATEGORIES.includes(item as typeof REQUIRED_TASK_CATEGORIES[number]));
  return [...REQUIRED_TASK_CATEGORIES, ...Array.from(new Set(custom))];
}

export function sanitizeEditableTaskCategories(categories: unknown): string[] {
  if (!Array.isArray(categories)) return [...REQUIRED_TASK_CATEGORIES];
  const clean = Array.from(new Set(categories.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item && !retiredLegacyCategories.has(item))));
  return clean.length ? clean : [...REQUIRED_TASK_CATEGORIES];
}

export function normalizeConfiguredMeetingTaskCategories(categories: unknown): string[] {
  const provided = Array.isArray(categories) ? categories.filter((item): item is string => typeof item === 'string') : [];
  const custom = provided.map(item => item.trim()).filter(item => item && !REQUIRED_MEETING_TASK_CATEGORIES.includes(item as typeof REQUIRED_MEETING_TASK_CATEGORIES[number]));
  return [...REQUIRED_MEETING_TASK_CATEGORIES, ...Array.from(new Set(custom))];
}

export function sanitizeEditableMeetingTaskCategories(categories: unknown): string[] {
  if (!Array.isArray(categories)) return [...REQUIRED_MEETING_TASK_CATEGORIES];
  const clean = Array.from(new Set(categories.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)));
  return clean.length ? clean : [...REQUIRED_MEETING_TASK_CATEGORIES];
}

export function attentionKeysForCategories(categories: string[]): WeeklyAttentionKey[] {
  return Array.from(new Set(categories.map(category => WEEKLY_ATTENTION_CATEGORY_MAP[category]).filter((key): key is WeeklyAttentionKey => Boolean(key))));
}

export function mergeAttentionFromCategories(current: WeeklyAttentionKey[], categories: string[]): WeeklyAttentionKey[] {
  return Array.from(new Set([...current, ...attentionKeysForCategories(categories)]));
}

export const taskCategoriesOf = (task: { category?: string; categories?: string[] }) => normalizeTaskCategoryList(task.category, task.categories);
export const taskCategoryLabel = (task: { category?: string; categories?: string[] }) => taskCategoriesOf(task).join('、') || '未分類';

export const isMeetingTaskSource = (task: Pick<TaskItem, 'sourceType' | 'sourceMeetingId' | 'attentionDimension'>) =>
  Boolean(task.sourceMeetingId || task.sourceType === 'temporary' || task.attentionDimension === 'meeting');

export const categoryChoicesForTask = (task: Pick<TaskItem, 'sourceType' | 'sourceMeetingId' | 'attentionDimension'>, settings: { taskCategories: string[]; meetingTaskCategories: string[] }) =>
  isMeetingTaskSource(task) ? settings.meetingTaskCategories : settings.taskCategories;

export function normalizeMeetingTaskCategoryList(categories: unknown, choices: string[] = [...REQUIRED_MEETING_TASK_CATEGORIES]): string[] {
  const allowed = choices.length ? choices : [...REQUIRED_MEETING_TASK_CATEGORIES];
  const allowedSet = new Set(allowed);
  const list = Array.isArray(categories) ? categories.filter((item): item is string => typeof item === 'string') : [];
  const clean = Array.from(new Set(list.map(item => item.trim()).filter(item => item && allowedSet.has(item))));
  return clean.length ? clean : [allowed[0]];
}

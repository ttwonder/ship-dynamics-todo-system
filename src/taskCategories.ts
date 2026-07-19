import type { WeeklyAttentionKey } from './types';

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
  '證書', '缺失驗證', 'vetting', '貨品', '港口安排', '臨會/專題',
] as const;

const retiredLegacyCategories = new Set(['人員', '物料', '檢驗', '內外部檢查', '臨時會議決議']);
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
  const clean = Array.from(new Set(categories.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)));
  return clean.length ? clean : [...REQUIRED_TASK_CATEGORIES];
}

export function attentionKeysForCategories(categories: string[]): WeeklyAttentionKey[] {
  return Array.from(new Set(categories.map(category => WEEKLY_ATTENTION_CATEGORY_MAP[category]).filter((key): key is WeeklyAttentionKey => Boolean(key))));
}

export function mergeAttentionFromCategories(current: WeeklyAttentionKey[], categories: string[]): WeeklyAttentionKey[] {
  return Array.from(new Set([...current, ...attentionKeysForCategories(categories)]));
}

export const taskCategoriesOf = (task: { category?: string; categories?: string[] }) => normalizeTaskCategoryList(task.category, task.categories);
export const taskCategoryLabel = (task: { category?: string; categories?: string[] }) => taskCategoriesOf(task).join('、') || '未分類';

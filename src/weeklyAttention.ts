import type { WeeklyAttentionKey } from './types';

export const WEEKLY_ATTENTION_OPTIONS: ReadonlyArray<{ key: WeeklyAttentionKey; label: string }> = [
  { key: 'crew-operation', label: '換員操作' },
  { key: 'bunkering-water', label: '加油加水' },
  { key: 'materials-parts', label: '物料配件' },
  { key: 'maintenance', label: '維修' },
  { key: 'survey', label: 'Survey' },
  { key: 'audit-inspection', label: '稽核檢查' },
  { key: 'psc-window', label: 'PSC窗開' },
];

export const WEEKLY_ATTENTION_KEYS = WEEKLY_ATTENTION_OPTIONS.map(option => option.key);

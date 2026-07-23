import type {
  InternalControlCase,
  InternalControlFilters,
  InternalControlReportSource,
  StatusLog,
  TaskItem,
  TaskPriority,
  UserAccount,
  Vessel,
} from './types';
import { hasActiveVesselDelegation } from './vesselDelegation';
import { richTextToPlainText } from './richText';

export const INTERNAL_CONTROL_REPORT_SOURCES: InternalControlReportSource[] = ['日常', '訪船', '隨船', '外部'];

export const isValidInternalControlDate = (value: string | undefined): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
};

// Kept in the exact order and wording supplied in the equipment-failure screenshot.
export const DEFAULT_EQUIPMENT_FAILURE_SUBCATEGORIES = [
  '机舱设备',
  '救生、消防、应急及安全设备',
  '驾驶台设备',
  '系泊和锚泊设备',
  '动力与推进',
  '防污染设备',
  '货物操作设备',
  '甲板机械',
  '船体/结构',
  '生活区/MLC设备',
  '保安/保全设备',
  '个人防护/作业安全设备',
  '医疗/急救设备',
  '测试/测量/校验工具',
  '电子管理平台/数据系统',
] as const;

export const sanitizeEquipmentFailureSubcategories = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [...DEFAULT_EQUIPMENT_FAILURE_SUBCATEGORIES];
  const seen = new Set<string>();
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => {
      const key = item.toLocaleLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export type InternalControlVessel = Pick<Vessel, 'id' | 'isActive' | 'assignedUserIds' | 'delegateManagers' | 'shipType' | 'name' | 'shortName' | 'fullName'>;
export type InternalControlUser = Pick<UserAccount, 'id' | 'role' | 'managedVesselIds'> & { isActive?: boolean };

export const userManagesInternalControlVessel = (user: InternalControlUser, vessel: InternalControlVessel): boolean =>
  user.role === 'owner'
  || user.role === 'admin'
  || user.managedVesselIds.includes(vessel.id)
  || vessel.assignedUserIds.includes(user.id)
  || hasActiveVesselDelegation(vessel, user.id);

export const managedInternalControlVesselIds = (user: InternalControlUser, vessels: InternalControlVessel[]): string[] =>
  vessels.filter(vessel => vessel.isActive !== false && (
    user.managedVesselIds.includes(vessel.id)
    || vessel.assignedUserIds.includes(user.id)
    || hasActiveVesselDelegation(vessel, user.id)
  )).map(vessel => vessel.id);

export const defaultInternalControlVesselIds = (user: InternalControlUser, vessels: InternalControlVessel[]): string[] => {
  const activeIds = new Set(vessels.filter(vessel => vessel.isActive !== false).map(vessel => vessel.id));
  const firstExplicit = user.managedVesselIds.find(id => activeIds.has(id));
  if (firstExplicit) return [firstExplicit];
  const firstManaged = managedInternalControlVesselIds(user, vessels)[0];
  if (firstManaged) return [firstManaged];
  const firstVisible = vessels.find(vessel => vessel.isActive !== false);
  return firstVisible ? [firstVisible.id] : [];
};

export const emptyInternalControlFilters = (vesselIds: string[] = []): InternalControlFilters => ({
  keyword: '',
  vesselIds: [...vesselIds],
  shipTypes: [],
  priorities: [],
  categories: [],
  departments: [],
  reportSources: [],
  equipmentSubcategories: [],
  fromDate: '',
  toDate: '',
  awareMode: 'all',
  closureMode: 'all',
});

const intersects = (selected: string[], values: string[]) => !selected.length || selected.some(value => values.includes(value));

export function filterInternalControlCases(
  cases: InternalControlCase[],
  vessels: InternalControlVessel[],
  filters: InternalControlFilters,
): InternalControlCase[] {
  const vesselMap = new Map(vessels.map(vessel => [vessel.id, vessel]));
  const keyword = filters.keyword.trim().toLocaleLowerCase();
  return cases.filter(item => {
    const vessel = vesselMap.get(item.vesselId);
    if (!vessel) return false;
    if (filters.vesselIds.length && !filters.vesselIds.includes(item.vesselId)) return false;
    if (filters.shipTypes.length && !filters.shipTypes.includes(vessel.shipType)) return false;
    if (filters.priorities.length && !filters.priorities.includes(item.priority)) return false;
    if (filters.categories.length && !filters.categories.includes(item.category)) return false;
    if (!intersects(filters.departments, item.departments)) return false;
    if (filters.reportSources.length && !filters.reportSources.includes(item.reportSource)) return false;
    if (filters.equipmentSubcategories?.length && (!item.equipmentSubcategory || !filters.equipmentSubcategories.includes(item.equipmentSubcategory))) return false;
    if (filters.awareMode === 'aware' && !item.isAware) return false;
    if (filters.awareMode === 'not-aware' && item.isAware) return false;
    if (filters.closureMode === 'open' && item.isClosed) return false;
    if (filters.closureMode === 'closed' && !item.isClosed) return false;
    if (filters.fromDate && item.reportDate < filters.fromDate) return false;
    if (filters.toDate && item.reportDate > filters.toDate) return false;
    if (!keyword) return true;
    return [
      vessel.name,
      vessel.shortName,
      vessel.fullName,
      vessel.shipType,
      richTextToPlainText(item.description),
      richTextToPlainText(item.status),
      item.category,
      item.equipmentSubcategory || '',
      item.reportSource,
      ...item.departments,
    ].join(' ').toLocaleLowerCase().includes(keyword);
  });
}

export interface InternalControlStatisticItem { label: string; count: number }
export interface InternalControlMonthlyTrend extends InternalControlStatisticItem { month: string; created: number; closed: number }
export interface InternalControlStats {
  total: number;
  open: number;
  closed: number;
  aware: number;
  highAttention: number;
  closureRate: number;
  byVessel: InternalControlStatisticItem[];
  byShipType: InternalControlStatisticItem[];
  byPriority: InternalControlStatisticItem[];
  byCategory: InternalControlStatisticItem[];
  byDepartment: InternalControlStatisticItem[];
  bySource: InternalControlStatisticItem[];
  monthlyTrend: InternalControlMonthlyTrend[];
}

const countValues = (values: string[], preferred: string[] = []): InternalControlStatisticItem[] => {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  const preferredRank = new Map(preferred.map((value, index) => [value, index]));
  return [...counts].map(([label, count]) => ({ label, count })).sort((left, right) => {
    const leftRank = preferredRank.get(left.label) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = preferredRank.get(right.label) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || right.count - left.count || left.label.localeCompare(right.label, 'zh-TW');
  });
};

export function buildInternalControlStats(cases: InternalControlCase[], vessels: InternalControlVessel[] = []): InternalControlStats {
  const closed = cases.filter(item => item.isClosed).length;
  const vesselMap = new Map(vessels.map(vessel => [vessel.id, vessel]));
  const months = Array.from(new Set(cases.flatMap(item => [item.reportDate.slice(0, 7), item.closedDate?.slice(0, 7) || '']).filter(Boolean))).sort();
  return {
    total: cases.length,
    open: cases.length - closed,
    closed,
    aware: cases.filter(item => item.isAware).length,
    highAttention: cases.filter(item => item.priority === '急' || item.priority === '高').length,
    closureRate: cases.length ? Math.round(closed / cases.length * 1000) / 10 : 0,
    byVessel: countValues(cases.map(item => {
      const vessel = vesselMap.get(item.vesselId);
      return vessel?.name || vessel?.shortName || vessel?.fullName || item.vesselId;
    })),
    byShipType: countValues(cases.map(item => vesselMap.get(item.vesselId)?.shipType || '未填船型')),
    byPriority: countValues(cases.map(item => item.priority), ['急', '高', '中', '低']),
    byCategory: countValues(cases.map(item => item.category)),
    byDepartment: countValues(cases.flatMap(item => item.departments)),
    bySource: countValues(cases.map(item => item.reportSource), INTERNAL_CONTROL_REPORT_SOURCES),
    monthlyTrend: months.map(month => {
      const created = cases.filter(item => item.reportDate.startsWith(month)).length;
      const completed = cases.filter(item => item.closedDate?.startsWith(month)).length;
      return { label: month, count: created, month, created, closed: completed };
    }),
  };
}

interface CaseToTaskOptions {
  id: string;
  ownerUserIds: string[];
  actorId: string;
  at: string;
}

const clonedLogs = (logs: StatusLog[]) => logs.map(log => ({ ...log }));

export function internalControlCaseToTask(item: InternalControlCase, options: CaseToTaskOptions): TaskItem {
  return {
    id: options.id,
    vesselId: item.vesselId,
    priority: item.priority,
    attentionDimension: 'task',
    isAware: item.isAware,
    isAbnormal: true,
    isInternalControl: true,
    internalControlCaseId: item.id,
    category: item.category,
    categories: item.category ? [item.category] : [],
    equipmentSubcategory: item.category === '設備故障' ? item.equipmentSubcategory : undefined,
    description: item.description,
    status: item.status,
    expectedDate: '',
    reportDate: item.reportDate,
    departments: [...item.departments],
    ownerUserIds: [...options.ownerUserIds],
    isClosed: item.isClosed,
    closedDate: item.closedDate,
    closedBy: item.closedBy,
    sourceType: 'morning',
    createdBy: item.createdBy || options.actorId,
    updatedBy: options.actorId,
    createdAt: item.createdAt || options.at,
    updatedAt: options.at,
    statusLogs: clonedLogs(item.statusLogs),
  };
}

interface TaskToCaseOptions { actorId: string; at: string; reportSource?: InternalControlReportSource }

export function taskToInternalControlCase(task: TaskItem, existing: InternalControlCase | undefined, options: TaskToCaseOptions): InternalControlCase {
  const id = existing?.id || task.internalControlCaseId || `internal-${task.id}`;
  const category = task.category || task.categories[0] || '';
  const equipmentSubcategory = category === '設備故障'
    ? task.equipmentSubcategory || (existing?.category === '設備故障' ? existing.equipmentSubcategory : undefined)
    : undefined;
  return {
    id,
    vesselId: task.vesselId,
    reportDate: task.reportDate || task.createdAt.slice(0, 10),
    reportSource: existing?.reportSource || options.reportSource || '日常',
    description: task.description,
    priority: task.priority,
    category,
    equipmentSubcategory,
    isAware: task.isAware,
    status: task.status,
    departments: [...task.departments],
    syncToTask: true,
    linkedTaskId: task.id,
    origin: existing?.origin || 'task',
    isClosed: task.isClosed,
    closedDate: task.isClosed ? task.closedDate : undefined,
    closedBy: task.isClosed ? task.closedBy : undefined,
    createdBy: existing?.createdBy || task.createdBy,
    updatedBy: options.actorId,
    createdAt: existing?.createdAt || task.createdAt,
    updatedAt: options.at,
    statusLogs: clonedLogs(task.statusLogs),
  };
}

export function syncInternalControlCaseToLinkedTask(item: InternalControlCase, task: TaskItem, actorId: string, at: string): TaskItem {
  return {
    ...task,
    vesselId: item.vesselId,
    vesselIds: undefined,
    vesselScopeMode: 'vessels',
    vesselTypeScopes: [],
    distributeToVessels: false,
    vesselProgress: [],
    priority: item.priority,
    isAware: item.isAware,
    isAbnormal: true,
    isInternalControl: true,
    internalControlCaseId: item.id,
    category: item.category,
    categories: item.category ? [item.category] : [],
    equipmentSubcategory: item.category === '設備故障' ? item.equipmentSubcategory : undefined,
    description: item.description,
    status: item.status,
    reportDate: item.reportDate,
    departments: [...item.departments],
    isClosed: item.isClosed,
    closedDate: item.isClosed ? item.closedDate : undefined,
    closedBy: item.isClosed ? item.closedBy : undefined,
    updatedBy: actorId,
    updatedAt: at,
    statusLogs: clonedLogs(item.statusLogs),
  };
}

export const internalControlCasesForAttention = (cases: InternalControlCase[], vesselId?: string): InternalControlCase[] =>
  cases.filter(item => !item.isClosed && !item.linkedTaskId && (!vesselId || item.vesselId === vesselId));

export function validateInternalControlCase(item: InternalControlCase, equipmentFailureCategory = '設備故障'): string[] {
  const errors: string[] = [];
  if (!item.vesselId) errors.push('船舶');
  if (!isValidInternalControlDate(item.reportDate)) errors.push('報告日期');
  if (item.closedDate && !isValidInternalControlDate(item.closedDate)) errors.push('結案日期');
  if (isValidInternalControlDate(item.reportDate) && isValidInternalControlDate(item.closedDate) && item.closedDate! < item.reportDate) errors.push('結案日期');
  if (!INTERNAL_CONTROL_REPORT_SOURCES.includes(item.reportSource)) errors.push('報告來源');
  if (!richTextToPlainText(item.description).trim()) errors.push('事項內容');
  if (!(['急', '高', '中', '低'] as TaskPriority[]).includes(item.priority)) errors.push('關注程度');
  if (!item.category.trim()) errors.push('事項分類');
  if (item.category === equipmentFailureCategory && !item.equipmentSubcategory?.trim()) errors.push('設備故障細項');
  if (!richTextToPlainText(item.status).trim()) errors.push('解決計劃／最新狀態');
  return errors;
}

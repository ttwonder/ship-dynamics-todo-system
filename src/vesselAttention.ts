import type { InternalControlCase, TaskItem, TaskPriority, Vessel, VesselAttentionLevel } from './types';
import { taskCategoriesOf } from './taskCategories';
import { vesselAttentionTasks } from './taskAttention';

export const VESSEL_ATTENTION_LEVELS: VesselAttentionLevel[] = ['低', '中', '高', '急', '特別關注'];

const attentionRank = (level: VesselAttentionLevel) => VESSEL_ATTENTION_LEVELS.indexOf(level);
const higherAttention = (left: VesselAttentionLevel, right: VesselAttentionLevel): VesselAttentionLevel => attentionRank(left) >= attentionRank(right) ? left : right;

export const taskIndicatesAccident = (task: TaskItem) =>
  taskCategoriesOf(task).some(category => category.includes('事故'))
  || [task.description, task.status].some(value => value.includes('事故'));

export interface VesselAttentionResult {
  automatic: VesselAttentionLevel;
  effective: VesselAttentionLevel;
  manual: VesselAttentionLevel | '';
  hasAccident: boolean;
  hasAbnormal: boolean;
  hasPscWindow: boolean;
  hasOtherIndicator: boolean;
  internalControlUnlinkedCount: number;
  internalControlPriorityCounts: Record<TaskPriority, number>;
}

export const unlinkedInternalControlCasesForVessel = (cases: InternalControlCase[], vesselId: string): InternalControlCase[] =>
  cases.filter(item => !item.isClosed && !item.linkedTaskId && item.vesselId === vesselId);

export function deriveVesselAttention(vessel: Vessel, openTasks: TaskItem[], hasMeetingAbnormal = false, internalControlCases: InternalControlCase[] = []): VesselAttentionResult {
  const attentionTasks = vesselAttentionTasks(openTasks);
  const unlinkedInternalCases = unlinkedInternalControlCasesForVessel(internalControlCases, vessel.id);
  const internalControlPriorityCounts = Object.fromEntries(
    (['急', '高', '中', '低'] as TaskPriority[]).map(priority => [priority, unlinkedInternalCases.filter(item => item.priority === priority).length]),
  ) as Record<TaskPriority, number>;
  const hasAccident = attentionTasks.some(taskIndicatesAccident);
  const hasAbnormal = hasMeetingAbnormal || attentionTasks.some(task => task.isAbnormal);
  const hasPscWindow = vessel.weeklyAttention.includes('psc-window');
  const hasOtherIndicator = vessel.weeklyAttention.some(key => key !== 'psc-window');
  const taskLevel = attentionTasks.reduce<VesselAttentionLevel>((level, task) => higherAttention(level, task.priority), '低');
  const internalControlLevel = unlinkedInternalCases
    .reduce<VesselAttentionLevel>((level, item) => higherAttention(level, item.priority), '低');
  const signalFloor: VesselAttentionLevel = hasAccident || hasAbnormal || hasPscWindow ? '高' : hasOtherIndicator ? '中' : '低';
  const automatic = higherAttention(higherAttention(taskLevel, internalControlLevel), signalFloor);
  const manual = vessel.manualAttentionLevel || '';
  const effective = manual ? higherAttention(automatic, manual) : automatic;
  return { automatic, effective, manual, hasAccident, hasAbnormal, hasPscWindow, hasOtherIndicator, internalControlUnlinkedCount: unlinkedInternalCases.length, internalControlPriorityCounts };
}

export function nextManualVesselAttention(current: VesselAttentionLevel | '', automatic: VesselAttentionLevel): VesselAttentionLevel | '' {
  const allowed: Array<VesselAttentionLevel | ''> = ['', ...VESSEL_ATTENTION_LEVELS.filter(level => attentionRank(level) >= attentionRank(automatic))];
  const index = allowed.indexOf(current);
  return allowed[(index + 1) % allowed.length];
}

export const vesselAttentionClass = (level: VesselAttentionLevel) => level === '特別關注' ? 'special' : level === '急' ? 'urgent' : level === '高' ? 'high' : level === '中' ? 'mid' : 'low';

export function vesselAttentionPriorityCount(result: VesselAttentionResult, openTasks: TaskItem[], priority: TaskPriority): number {
  return vesselAttentionTasks(openTasks).filter(task => task.priority === priority).length + result.internalControlPriorityCounts[priority];
}

export function vesselAttentionLabel(result: VesselAttentionResult, openTasks: TaskItem[]): string {
  const attentionTasks = vesselAttentionTasks(openTasks);
  if (result.manual && result.effective === result.manual) return result.effective === '特別關注' ? '手動 特別關注' : `手動 ${result.effective}關注`;
  if (result.effective === '急') return `急關注 ${vesselAttentionPriorityCount(result, attentionTasks, '急')}`;
  if (result.hasAccident) return '高關注 事故';
  if (result.hasAbnormal) return '高關注 異常';
  if (result.hasPscWindow) return '高關注 PSC窗開';
  if (result.effective === '高') return `高關注 ${vesselAttentionPriorityCount(result, attentionTasks, '高')}`;
  if (result.hasOtherIndicator) return '中關注 狀態燈';
  if (result.effective === '中') return `中關注 ${vesselAttentionPriorityCount(result, attentionTasks, '中')}`;
  return `低關注 ${vesselAttentionPriorityCount(result, attentionTasks, '低')}`;
}

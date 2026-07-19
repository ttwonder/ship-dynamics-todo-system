import type { TaskItem, Vessel, VesselAttentionLevel } from './types';
import { taskCategoriesOf } from './taskCategories';

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
}

export function deriveVesselAttention(vessel: Vessel, openTasks: TaskItem[]): VesselAttentionResult {
  const hasAccident = openTasks.some(taskIndicatesAccident);
  const hasAbnormal = openTasks.some(task => task.isAbnormal);
  const hasPscWindow = vessel.weeklyAttention.includes('psc-window');
  const hasOtherIndicator = vessel.weeklyAttention.some(key => key !== 'psc-window');
  const taskLevel = openTasks.reduce<VesselAttentionLevel>((level, task) => higherAttention(level, task.priority), '低');
  const signalFloor: VesselAttentionLevel = hasAccident || hasAbnormal || hasPscWindow ? '高' : hasOtherIndicator ? '中' : '低';
  const automatic = higherAttention(taskLevel, signalFloor);
  const manual = vessel.manualAttentionLevel || '';
  const effective = manual ? higherAttention(automatic, manual) : automatic;
  return { automatic, effective, manual, hasAccident, hasAbnormal, hasPscWindow, hasOtherIndicator };
}

export function nextManualVesselAttention(current: VesselAttentionLevel | '', automatic: VesselAttentionLevel): VesselAttentionLevel | '' {
  const allowed: Array<VesselAttentionLevel | ''> = ['', ...VESSEL_ATTENTION_LEVELS.filter(level => attentionRank(level) >= attentionRank(automatic))];
  const index = allowed.indexOf(current);
  return allowed[(index + 1) % allowed.length];
}

export const vesselAttentionClass = (level: VesselAttentionLevel) => level === '特別關注' ? 'special' : level === '急' ? 'urgent' : level === '高' ? 'high' : level === '中' ? 'mid' : 'low';

export function vesselAttentionLabel(result: VesselAttentionResult, openTasks: TaskItem[]): string {
  if (result.manual && result.effective === result.manual) return result.effective === '特別關注' ? '手動 特別關注' : `手動 ${result.effective}關注`;
  if (result.effective === '急') return `急關注 ${openTasks.filter(task => task.priority === '急').length || 1}`;
  if (result.hasAccident) return '高關注 事故';
  if (result.hasAbnormal) return '高關注 異常';
  if (result.hasPscWindow) return '高關注 PSC窗開';
  if (result.effective === '高') return `高關注 ${openTasks.filter(task => task.priority === '高').length || 1}`;
  if (result.hasOtherIndicator) return '中關注 狀態燈';
  if (result.effective === '中') return `中關注 ${openTasks.filter(task => task.priority === '中').length || 1}`;
  return `低關注 ${openTasks.filter(task => task.priority === '低').length}`;
}

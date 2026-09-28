import type { Vessel } from '../types';
import { isValidInternalControlDate } from '../internalControlWorkflow';
import { STATISTICS_CATEGORIES, STATISTICS_METRICS } from './trackingStatistics';
import { vesselSelectionDisplayName } from '../vesselDisplay';
import type { TrackingStatisticsSummary } from './trackingStatisticsReport';

export interface StatisticsVesselScope { kind: 'all' | 'fleet' | 'type' | 'vessel'; value: string }
export type StatisticsVessel = Pick<Vessel, 'id' | 'name' | 'shortName' | 'fullName' | 'shipType' | 'fleetCategory'>;
export interface StatisticsCapture {
  stats: TrackingStatisticsSummary; vessels: StatisticsVessel[]; vesselIds: string[];
  at: string; today: string; isCurrent: () => boolean;
}
export function statisticsVesselCatalog(vessels: readonly Vessel[]): StatisticsVessel[] {
  return vessels.filter(v => v.isActive).map(({ id, name, shortName, fullName, shipType, fleetCategory }) => ({ id, name, shortName, fullName, shipType, fleetCategory }));
}
export function resolveStatisticsVessels(vessels: readonly StatisticsVessel[], scope: StatisticsVesselScope): string[] {
  return vessels.filter(v => scope.kind === 'all' || (scope.kind === 'vessel' ? v.id === scope.value : scope.kind === 'fleet' ? v.fleetCategory === scope.value : v.shipType === scope.value)).map(v => v.id);
}
export const statisticsScopeKey = (scope: StatisticsVesselScope) => JSON.stringify(scope);
export function statisticsScopeOptions(vessels: readonly StatisticsVessel[]) {
  const option = (kind: StatisticsVesselScope['kind'], value: string, label: string, group: string) => ({ scope: { kind, value }, key: statisticsScopeKey({ kind, value }), label, group });
  return [
    option('all', '', '全船隊', '船隊'),
    option('fleet', 'bulk fleet', 'Bulker／散貨船', '船隊'),
    option('fleet', 'tanker fleet', 'Tanker／油輪', '船隊'),
    ...[...new Set(vessels.map(v => v.shipType))].sort((a, b) => a.localeCompare(b)).map(type => option('type', type, type || '未填船種', '細分船種')),
    ...vessels.map(v => option('vessel', v.id, vesselSelectionDisplayName(v), '個別船舶')),
  ];
}
export function statisticsVesselScopeLabel(vessels: readonly StatisticsVessel[], scope: StatisticsVesselScope) {
  return statisticsScopeOptions(vessels).find(o => o.key === statisticsScopeKey(scope))?.label || '所選範圍已不可用';
}

/** Validate the dedicated public envelope before displaying or exporting it. */
export function parseStatisticsSnapshot(raw: unknown, workspace: string, selection: StatisticsVesselScope): Omit<StatisticsCapture, 'isCurrent'> {
  const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
  const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
  const fail = (): never => { throw new Error('統計回覆不完整或範圍不符；未顯示零筆或部分統計，請重讀統計。'); };
  const fields = STATISTICS_METRICS.map(([key]) => key);
  const summary = (v: unknown): v is TrackingStatisticsSummary['summary'] => {
    if (!exact(v, [...fields, 'completionRate', 'delayRate']) || !fields.every(k => Number.isSafeInteger(v[k]) && Number(v[k]) >= 0)) return false;
    const s = v as unknown as TrackingStatisticsSummary['summary'];
    const rate = (value: number | null, n: number, d: number) => d ? typeof value === 'number' && Number.isFinite(value) && Math.abs(value - n / d) < 1e-12 : value === null;
    return s.total === s.effective + s.cancelled && s.effective === s.completed + s.incomplete && s.delayed === s.overdueCompleted + s.overdueIncomplete
      && s.delayed <= s.delayEligible && s.delayEligible <= s.effective && s.urgent === s.urgentCompleted + s.urgentIncomplete + s.urgentCancelled
      && s.urgent <= s.total && s.partial <= s.incomplete && s.delayEligible + s.noDeadline + s.insufficientDate + s.notYetDue === s.effective
      && rate(s.completionRate, s.completed, s.effective) && rate(s.delayRate, s.delayed, s.delayEligible);
  };
  if (!exact(raw, ['protocol', 'workspace', 'vessels', 'vesselIds', 'at', 'today', 'stats']) || raw.protocol !== 'ship-tracking-statistics-v2' || raw.workspace !== workspace
    || typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at)) || typeof raw.today !== 'string' || !isValidInternalControlDate(raw.today)
    || !Array.isArray(raw.vessels) || !raw.vessels.every(v => exact(v, ['id', 'name', 'shortName', 'fullName', 'shipType', 'fleetCategory']) && Object.values(v).every(x => typeof x === 'string') && Boolean(v.id))
    || !Array.isArray(raw.vesselIds) || !exact(raw.stats, ['summary', 'categories']) || !summary(raw.stats.summary) || !Array.isArray(raw.stats.categories) || raw.stats.categories.length !== STATISTICS_CATEGORIES.length) return fail();
  const vessels = raw.vessels as StatisticsVessel[];
  if (new Set(vessels.map(v => v.id)).size !== vessels.length || JSON.stringify(raw.vesselIds) !== JSON.stringify(resolveStatisticsVessels(vessels, selection))
    || selection.kind === 'vessel' && raw.vesselIds.length !== 1) return fail();
  const categories = raw.stats.categories;
  if (!categories.every((v, i) => exact(v, ['value', 'label', 'summary']) && v.value === STATISTICS_CATEGORIES[i].value && v.label === STATISTICS_CATEGORIES[i].label && summary(v.summary))) return fail();
  const stats = raw.stats as unknown as TrackingStatisticsSummary;
  if (!fields.every(k => stats.categories.reduce((sum, c) => sum + c.summary[k], 0) === stats.summary[k])) return fail();
  return structuredClone({ stats, vessels, vesselIds: raw.vesselIds as string[], at: raw.at, today: raw.today as string });
}

import type { UserAccount, Vessel, VesselAttentionLevel } from './types';
import { userCanManageVesselByAssignmentOrDelegation } from './vesselDelegation';

export type VesselAttentionFilterGroup = 'urgent-high' | 'medium';
export type VesselAttentionGroup = VesselAttentionFilterGroup | 'other';

export interface VesselFilterState {
  selfManagedOnly: boolean;
  shipTypes: string[];
  attentionGroups: VesselAttentionFilterGroup[];
  meetingOnly: boolean;
  supervisorIds: string[];
}

export interface VesselFilterFacts {
  id: string;
  selfManaged: boolean;
  shipType: string;
  attentionGroup: VesselAttentionGroup;
  selectedForMeeting: boolean;
  supervisorIds: string[];
}

export interface VesselSupervisorOption {
  id: string;
  name: string;
  department: string;
}

export function vesselSupervisorDisplayName(user: Pick<UserAccount, 'id' | 'name' | 'username'>): string {
  return user.name.trim() || user.username.trim() || `未命名督導（${user.id}）`;
}

export function emptyVesselFilterState(): VesselFilterState {
  return {
    selfManagedOnly: false,
    shipTypes: [],
    attentionGroups: [],
    meetingOnly: false,
    supervisorIds: [],
  };
}

export function toggleFilterValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

export function hasActiveVesselFilters(filters: VesselFilterState): boolean {
  return filters.selfManagedOnly
    || filters.shipTypes.length > 0
    || filters.attentionGroups.length > 0
    || filters.meetingOnly
    || filters.supervisorIds.length > 0;
}

export function shipTypeFilterOptions(vessels: Array<Pick<Vessel, 'shipType'>>): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const vessel of vessels) {
    const value = vessel.shipType.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function attentionFilterGroup(level: VesselAttentionLevel): VesselAttentionGroup {
  if (level === '急' || level === '高' || level === '特別關注') return 'urgent-high';
  if (level === '中') return 'medium';
  return 'other';
}

export function supervisorIdsForVessel(vessel: Pick<Vessel, 'id' | 'assignedUserIds' | 'delegateManagers'>, users: UserAccount[]): string[] {
  return users
    .filter(user => user.isActive && user.role !== 'vessel' && user.department.includes('督導') && userCanManageVesselByAssignmentOrDelegation(vessel, user))
    .map(user => user.id);
}

export function vesselSupervisorOptions(vessels: Array<Pick<Vessel, 'id' | 'assignedUserIds' | 'delegateManagers'>>, users: UserAccount[]): VesselSupervisorOption[] {
  const visibleSupervisorIds = new Set(vessels.flatMap(vessel => supervisorIdsForVessel(vessel, users)));
  return users
    .filter(user => visibleSupervisorIds.has(user.id))
    .map(user => ({ id: user.id, name: vesselSupervisorDisplayName(user), department: user.department }));
}

export function matchesVesselFilterGroups(vessel: VesselFilterFacts, filters: VesselFilterState): boolean {
  if (filters.selfManagedOnly && !vessel.selfManaged) return false;
  if (filters.shipTypes.length > 0 && !filters.shipTypes.includes(vessel.shipType)) return false;
  if (filters.attentionGroups.length > 0 && !filters.attentionGroups.includes(vessel.attentionGroup as VesselAttentionFilterGroup)) return false;
  if (filters.meetingOnly && !vessel.selectedForMeeting) return false;
  if (filters.supervisorIds.length > 0 && !vessel.supervisorIds.some(id => filters.supervisorIds.includes(id))) return false;
  return true;
}

export function matchingVesselIds(vessels: VesselFilterFacts[], filters: VesselFilterState): string[] {
  return vessels.filter(vessel => matchesVesselFilterGroups(vessel, filters)).map(vessel => vessel.id);
}

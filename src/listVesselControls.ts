import type { UserAccount, Vessel } from './types';
import { compareCreatedNewestFirst, type CreatedRecord } from './recordSorting';
import { userCanManageVesselByAssignmentOrDelegation } from './vesselDelegation';

export type VesselListFilterMode = 'all' | 'mine' | 'custom';
export type VesselListSelection = { mode: VesselListFilterMode; vesselIds: string[] };
export type ListColumnSort =
  | 'created-desc'
  | 'vessel-asc'
  | 'vessel-desc'
  | 'date-asc'
  | 'date-desc'
  | 'closed-date-asc'
  | 'closed-date-desc';
export type ListSortColumn = 'vessel' | 'date' | 'closed-date';

type ListVessel = Pick<Vessel, 'id' | 'isActive' | 'assignedUserIds' | 'delegateManagers'>;
type ListUser = Pick<UserAccount, 'id' | 'role' | 'managedVesselIds'>;

export function managedListVesselIds(user: ListUser, vessels: readonly ListVessel[]): string[] {
  return vessels
    .filter(vessel => vessel.isActive !== false && userCanManageVesselByAssignmentOrDelegation(vessel, user))
    .map(vessel => vessel.id);
}

export function sanitizeListVesselIds(vesselIds: readonly string[], vessels: readonly Pick<ListVessel, 'id' | 'isActive'>[]): string[] {
  const allowed = new Set(vessels.filter(vessel => vessel.isActive !== false).map(vessel => vessel.id));
  const seen = new Set<string>();
  return vesselIds.filter(id => {
    if (!allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function matchesListVesselSelection(
  recordVesselIds: readonly string[],
  selection: VesselListSelection,
  managedVesselIds: readonly string[],
  userId = '',
  ownerUserIds: readonly string[] = [],
): boolean {
  if (selection.mode === 'all') return true;
  if (selection.mode === 'mine') {
    if (userId && ownerUserIds.includes(userId)) return true;
    const managed = new Set(managedVesselIds);
    return recordVesselIds.some(id => managed.has(id));
  }
  if (!selection.vesselIds.length) return false;
  const selected = new Set(selection.vesselIds);
  return recordVesselIds.some(id => selected.has(id));
}

export function nextListColumnSort(current: ListColumnSort, column: ListSortColumn): ListColumnSort {
  const ascending: ListColumnSort = column === 'vessel' ? 'vessel-asc' : column === 'date' ? 'date-asc' : 'closed-date-asc';
  const descending: ListColumnSort = column === 'vessel' ? 'vessel-desc' : column === 'date' ? 'date-desc' : 'closed-date-desc';
  return current === ascending ? descending : ascending;
}

export function compareOptionalListDate(left: string | null | undefined, right: string | null | undefined, direction: 1 | -1): number {
  const leftDate = left?.trim() || '';
  const rightDate = right?.trim() || '';
  if (!leftDate && !rightDate) return 0;
  if (!leftDate) return 1;
  if (!rightDate) return -1;
  return leftDate.localeCompare(rightDate) * direction;
}

export function sortListRecords<T extends CreatedRecord>(
  records: readonly T[],
  sort: ListColumnSort,
  vesselLabel: (item: T) => string,
  primaryDate: (item: T) => string | null | undefined,
  closedDate: (item: T) => string | null | undefined = () => '',
): T[] {
  return [...records].sort((left, right) => {
    if (sort === 'vessel-asc' || sort === 'vessel-desc') {
      const direction = sort === 'vessel-asc' ? 1 : -1;
      return vesselLabel(left).localeCompare(vesselLabel(right), 'zh-TW') * direction || compareCreatedNewestFirst(left, right);
    }
    if (sort === 'date-asc' || sort === 'date-desc') {
      return compareOptionalListDate(primaryDate(left), primaryDate(right), sort === 'date-asc' ? 1 : -1) || compareCreatedNewestFirst(left, right);
    }
    if (sort === 'closed-date-asc' || sort === 'closed-date-desc') {
      return compareOptionalListDate(closedDate(left), closedDate(right), sort === 'closed-date-asc' ? 1 : -1) || compareCreatedNewestFirst(left, right);
    }
    return compareCreatedNewestFirst(left, right);
  });
}

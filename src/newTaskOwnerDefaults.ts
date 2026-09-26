import type { UserAccount, Vessel } from './types';

/** Suggestions for a new single-vessel task only; never migrate saved owners. */
export function newTaskOwnerDefaults(
  vessel: Pick<Vessel, 'assignedUserIds'> | undefined,
  users: readonly Pick<UserAccount, 'id' | 'department' | 'isActive' | 'role'>[],
  departments: readonly string[] = [],
): string[] {
  const selectedDepartments = new Set(['督導', ...departments]);
  const eligibleIds = new Set(users
    .filter(user => user.isActive && user.role !== 'vessel' && selectedDepartments.has(user.department))
    .map(user => user.id));
  return [...new Set(vessel?.assignedUserIds || [])].filter(id => eligibleIds.has(id));
}

/** Reconcile a department click without replacing the user's manual choices. */
export function updateNewTaskOwnerSelection(
  selectedIds: readonly string[],
  automaticIds: readonly string[],
  previousDefaults: readonly string[],
  nextDefaults: readonly string[],
): { selectedIds: string[]; automaticIds: string[] } {
  const automatic = new Set(automaticIds), before = new Set(previousDefaults), after = new Set(nextDefaults);
  const kept = selectedIds.filter(id => !automatic.has(id) || after.has(id));
  // Add only newly involved departments, not people the user already unchecked.
  const added = nextDefaults.filter(id => !before.has(id) && !selectedIds.includes(id));
  const nextSelected = [...new Set([...kept, ...added])];
  return {
    selectedIds: nextSelected,
    automaticIds: [...new Set([...automaticIds.filter(id => nextSelected.includes(id)), ...added])],
  };
}

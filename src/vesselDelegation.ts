import type { UserAccount, Vessel, VesselDelegateAssignment } from './types';

type DelegationVessel = Pick<Vessel, 'delegateManagers'> | { delegateManagers?: VesselDelegateAssignment[] };

type DelegationUser = Pick<UserAccount, 'id' | 'role' | 'managedVesselIds'>;

export function normalizeVesselDelegateManagers(value: unknown): VesselDelegateAssignment[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map(item => item && typeof item === 'object' ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map(item => ({ userId: typeof item.userId === 'string' ? item.userId : '', isActive: typeof item.isActive === 'boolean' ? item.isActive : false }))
    .filter(item => {
      if (!item.userId || seen.has(item.userId)) return false;
      seen.add(item.userId);
      return true;
    });
}

export function hasActiveVesselDelegation(vessel: DelegationVessel | null | undefined, userId: string): boolean {
  return Boolean(userId && vessel?.delegateManagers?.some(item => item.userId === userId && item.isActive));
}

export function hasAnyVesselDelegation(vessel: DelegationVessel | null | undefined, userId: string): boolean {
  return Boolean(userId && vessel?.delegateManagers?.some(item => item.userId === userId));
}

export function userCanManageVesselByAssignmentOrDelegation(vessel: Pick<Vessel, 'id' | 'assignedUserIds' | 'delegateManagers'>, user: DelegationUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return vessel.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(vessel.id) || hasActiveVesselDelegation(vessel, user.id);
}

import type { InternalControlCase, TaskItem, Vessel } from './types';
import { taskVesselIds } from './taskVesselScope';

// Operational visibility only. Never use these projections as a save snapshot.
export function selectOperationalTasks<T extends Pick<TaskItem, 'vesselId' | 'vesselIds' | 'vesselScopeMode' | 'vesselTypeScopes'>>(tasks: T[], vessels: Vessel[]): T[] {
  const activeIds = new Set(vessels.filter(vessel => vessel.isActive).map(vessel => vessel.id));
  return tasks.filter(task => taskVesselIds(task).some(id => activeIds.has(id)));
}

export function selectOperationalCases<T extends Pick<InternalControlCase, 'vesselId'>>(cases: T[], vessels: Vessel[]): T[] {
  const activeIds = new Set(vessels.filter(vessel => vessel.isActive).map(vessel => vessel.id));
  return cases.filter(item => activeIds.has(item.vesselId));
}

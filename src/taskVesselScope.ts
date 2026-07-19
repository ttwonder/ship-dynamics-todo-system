import type { TaskItem, Vessel } from './types';
import { vesselDisplayName } from './vesselDisplay';

type TaskVesselScope = Pick<TaskItem, 'vesselId' | 'vesselIds' | 'vesselScopeMode' | 'vesselTypeScopes'>;

export const taskVesselIds = (task: TaskVesselScope): string[] => {
  const ids = task.vesselIds?.length ? task.vesselIds : [task.vesselId];
  return Array.from(new Set(ids.filter(Boolean)));
};

export const taskHasVessel = (task: TaskVesselScope, vesselId: string) => taskVesselIds(task).includes(vesselId);

export const taskVessels = (task: TaskVesselScope, vessels: Vessel[]): Vessel[] => {
  const vesselById = new Map(vessels.map(vessel => [vessel.id, vessel]));
  return taskVesselIds(task).map(id => vesselById.get(id)).filter((vessel): vessel is Vessel => Boolean(vessel));
};

export const taskVesselLabel = (task: TaskVesselScope, vessels: Vessel[]): string => {
  if (task.vesselScopeMode === 'all') return '全部船舶';
  const names = taskVessels(task, vessels).map(vesselDisplayName);
  const restrictedCount = Math.max(0, taskVesselIds(task).length - names.length);
  return [...names, ...(restrictedCount ? [`另含受限船舶 ${restrictedCount} 艘`] : [])].join('、') || '-';
};

export const taskShipTypeLabel = (task: TaskVesselScope, vessels: Vessel[]): string => {
  if (task.vesselScopeMode === 'all') return '全部';
  const visibleVesselCount = taskVessels(task, vessels).length;
  const restrictedCount = Math.max(0, taskVesselIds(task).length - visibleVesselCount);
  const types = !restrictedCount && task.vesselScopeMode === 'types' && task.vesselTypeScopes?.length
    ? task.vesselTypeScopes
    : taskVessels(task, vessels).map(vessel => vessel.shipType).filter(Boolean);
  const labels = Array.from(new Set(types));
  if (restrictedCount) labels.push(`另含受限船舶 ${restrictedCount} 艘`);
  return labels.join('、') || '-';
};

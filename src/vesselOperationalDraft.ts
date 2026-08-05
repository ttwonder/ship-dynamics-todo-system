import type { Vessel } from './types';

function editableSnapshot(vessel: Vessel) {
  return {
    position: vessel.position,
    cargo: vessel.cargo,
    note: vessel.note,
  };
}

export function vesselOperationalDraftEquals(left: Vessel, right: Vessel): boolean {
  return JSON.stringify(editableSnapshot(left)) === JSON.stringify(editableSnapshot(right));
}

export function applyVesselOperationalDraft(target: Vessel, source: Vessel, updatedAt: string): void {
  if (target.id !== source.id) throw new Error('拒絕把船舶快速更新草稿套用到不同船舶');
  target.position = structuredClone(source.position);
  target.cargo = structuredClone(source.cargo);
  target.note = structuredClone(source.note);
  target.updatedAt = updatedAt;
}

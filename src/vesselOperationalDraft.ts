import type { Vessel } from './types';

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function editablePosition(position: Vessel['position']) {
  return {
    source: position.source,
    location: position.location,
    speedKnots: position.speedKnots,
    navigationStatus: position.navigationStatus,
    manualRemark: position.manualRemark,
  };
}

function editableCargo(cargo: Vessel['cargo']) {
  return { source: cargo.source, loadStatus: cargo.loadStatus };
}

function editableSnapshot(vessel: Vessel) {
  return {
    position: editablePosition(vessel.position),
    cargo: editableCargo(vessel.cargo),
    note: vessel.note,
  };
}

export function applyItineraryOperationalWriteMask(base: Vessel, candidate: Vessel): Vessel {
  const next = structuredClone(candidate);
  const positionChanged = !equal(editablePosition(base.position), editablePosition(candidate.position));
  const cargoChanged = !equal(editableCargo(base.cargo), editableCargo(candidate.cargo));

  next.position.lastPort = base.position.lastPort;
  next.position.nextPort = base.position.nextPort;
  next.position.eta = base.position.eta;
  next.position.etb = base.position.etb;
  next.position.etd = base.position.etd;
  if (!positionChanged) next.position.updatedAt = base.position.updatedAt;

  next.cargo.name = base.cargo.name;
  next.cargo.quantity = base.cargo.quantity;
  next.cargo.items = base.cargo.items.map(item => ({ ...item }));
  if (!cargoChanged) next.cargo.updatedAt = base.cargo.updatedAt;
  return next;
}

export function vesselOperationalDraftEquals(left: Vessel, right: Vessel): boolean {
  return equal(editableSnapshot(left), editableSnapshot(right));
}

export function applyVesselOperationalDraft(target: Vessel, source: Vessel, updatedAt: string): void {
  if (target.id !== source.id) throw new Error('拒絕把船舶快速更新草稿套用到不同船舶');
  const safe = applyItineraryOperationalWriteMask(target, source);
  target.position = structuredClone(safe.position);
  target.cargo = structuredClone(safe.cargo);
  target.note = structuredClone(safe.note);
  target.updatedAt = updatedAt;
}

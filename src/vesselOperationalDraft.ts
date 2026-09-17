import type { Vessel } from './types';

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function editablePosition(position: Vessel['position']) {
  return { speedKnots: position.speedKnots, manualRemark: position.manualRemark };
}

function editableNote(note: Vessel['note']) {
  const { statusList: _statusList, updatedAt: _updatedAt, ...editable } = note;
  return editable;
}

function editableSnapshot(vessel: Vessel) {
  return { position: editablePosition(vessel.position), note: editableNote(vessel.note) };
}

export function applyItineraryOperationalWriteMask(base: Vessel, candidate: Vessel): Vessel {
  const next = structuredClone(candidate);
  const positionChanged = !equal(editablePosition(base.position), editablePosition(candidate.position));
  const noteChanged = !equal(editableNote(base.note), editableNote(candidate.note));
  next.position.location = base.position.location;
  next.position.navigationStatus = base.position.navigationStatus;
  next.position.lastPort = base.position.lastPort;
  next.position.nextPort = base.position.nextPort;
  next.position.eta = base.position.eta;
  next.position.etb = base.position.etb;
  next.position.etd = base.position.etd;
  if (!positionChanged) {
    next.position.source = base.position.source;
    next.position.updatedAt = base.position.updatedAt;
  }
  next.cargo = structuredClone(base.cargo);
  next.note.statusList = [...base.note.statusList];
  if (!noteChanged) next.note.updatedAt = base.note.updatedAt;
  if (!positionChanged && !noteChanged) next.updatedAt = base.updatedAt;
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

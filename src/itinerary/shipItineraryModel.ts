import { recalculateItineraryRows } from './itineraryDomain';
import { createBlankItineraryRow, createEmptyItineraryDocument, type ItineraryDocument, type ItineraryRow } from './itineraryTypes';

export type ShipDraftStartMode = 'blank' | 'latest';

function cloneDocument(document: ItineraryDocument): ItineraryDocument {
  return structuredClone(document);
}

export function createShipDraft(latest: ItineraryDocument, mode: ShipDraftStartMode, blankRowId?: string): ItineraryDocument {
  if (mode === 'latest') return cloneDocument(latest);
  const blank = createEmptyItineraryDocument({ workspaceKey: latest.workspaceKey, vesselId: latest.vesselId, vesselName: latest.vesselName, rowId: blankRowId });
  blank.revision = latest.revision;
  blank.updatedAt = latest.updatedAt;
  blank.updatedActorKind = latest.updatedActorKind;
  blank.updatedActorLabel = latest.updatedActorLabel;
  blank.rows[0].etaMode = 'manual';
  blank.rows[0].etbMode = 'auto';
  blank.rows[0].etcMode = 'auto';
  blank.rows[0].etdMode = 'auto';
  return blank;
}

export function addShipDraftRow(document: ItineraryDocument, rowId?: string): ItineraryDocument {
  const next = cloneDocument(document);
  const previous = next.rows[next.rows.length - 1];
  const row = createBlankItineraryRow(rowId, next.rows.length);
  row.portTimeZone = previous?.portTimeZone || '';
  next.rows = recalculateItineraryRows([...next.rows, row]).rows;
  return next;
}

export function removeShipDraftRow(document: ItineraryDocument, rowId: string): ItineraryDocument {
  if (document.rows.length <= 1) return cloneDocument(document);
  const next = cloneDocument(document);
  const remaining = next.rows.filter(row => row.rowId !== rowId).map((row, index) => ({ ...row, sortOrder: index }));
  next.rows = recalculateItineraryRows(remaining.length ? remaining : [createBlankItineraryRow(undefined, 0)]).rows;
  if (next.rows[0]) next.rows[0].etaMode = next.rows[0].etaUtc ? next.rows[0].etaMode : 'manual';
  return next;
}

export function updateShipDraftRow(document: ItineraryDocument, rowId: string, patch: Partial<ItineraryRow>): ItineraryDocument {
  const next = cloneDocument(document);
  next.rows = recalculateItineraryRows(next.rows.map(row => row.rowId === rowId ? { ...row, ...patch } : row)).rows;
  return next;
}

export function hasRemoteItineraryUpdate(baseRevision: number, latestRevision: number): boolean {
  return Number.isInteger(latestRevision) && latestRevision > baseRevision;
}

function rowHasBusinessContent(row: ItineraryRow): boolean {
  return Boolean(
    row.voyageNumber.trim() || row.portDockName.trim() || row.operation || row.cargoQuantityText.trim()
    || row.etaUtc || row.etbUtc || row.ldRateText.trim() || row.etcUtc || row.etdUtc
    || row.arrivalDraftText.trim() || row.departureDraftText.trim() || row.arrivalRobText.trim() || row.departureRobText.trim()
    || row.oceanDistanceNm !== null || row.speedKnots !== null || row.berthWaitHours !== null || row.tanksText.trim()
    || row.operationQuantityMt !== null || row.operationRateMtPerHour !== null || row.departureBufferDays !== null
  );
}

export function hasShipDraftBusinessContent(document: ItineraryDocument): boolean {
  return document.rows.some(rowHasBusinessContent);
}

export function trimTrailingBlankShipRows(document: ItineraryDocument): ItineraryDocument {
  const next = cloneDocument(document);
  while (next.rows.length > 1 && !rowHasBusinessContent(next.rows[next.rows.length - 1])) next.rows.pop();
  next.rows = next.rows.map((row, index) => ({ ...row, sortOrder: index }));
  return next;
}

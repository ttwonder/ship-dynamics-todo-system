import { recalculateItineraryRows } from './itineraryDomain';
import { instantToWallTime, isValidItineraryTimeZone, wallTimeToInstant } from './itineraryTime';
import {
  createBlankItineraryRow, createEmptyItineraryDocument, ITINERARY_TIME_ZONE_FIELDS, resolveItineraryTimeZone,
  type ItineraryDocument, type ItineraryRow, type ItineraryTimeField,
} from './itineraryTypes';

export type ShipDraftStartMode = 'blank' | 'latest';

export interface ShipAutomaticInputGap {
  rowId: string;
  rowNumber: number;
  field: keyof ItineraryRow;
  label: string;
}

export interface ShipAutomaticCalculationResult {
  document: ItineraryDocument;
  missing: ShipAutomaticInputGap[];
}

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
  const normalizedPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, 'ldRateText')) normalizedPatch.operationRateMtPerHour = parseItineraryRateText(patch.ldRateText || '');
  next.rows = recalculateItineraryRows(next.rows.map(row => row.rowId === rowId ? { ...row, ...normalizedPatch } : row)).rows;
  return next;
}

export function parseItineraryRateText(value: string): number | null {
  const match = value.replace(/,/g, '').match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$|[A-Za-z/])/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function reinterpretedInstant(instant: string | null, oldZone: string, newZone: string): string | undefined {
  if (!instant || !isValidItineraryTimeZone(oldZone) || !isValidItineraryTimeZone(newZone)) return undefined;
  const wall = instantToWallTime(instant, oldZone);
  if (!wall.ok) return undefined;
  const converted = wallTimeToInstant(wall.date, wall.time, newZone);
  return converted.ok ? converted.instant : undefined;
}

export function shipTimeZonePatch(row: ItineraryRow, field: ItineraryTimeField, value: string): Partial<ItineraryRow> {
  const zoneField = ITINERARY_TIME_ZONE_FIELDS[field];
  const oldZone = resolveItineraryTimeZone(row, field);
  const newZone = value || row.portTimeZone;
  const instant = reinterpretedInstant(row[field], oldZone, newZone);
  return { [zoneField]: value, ...(instant ? { [field]: instant } : {}) } as Partial<ItineraryRow>;
}

export function shipCalculationStartTimeZonePatch(row: ItineraryRow, value: string): Partial<ItineraryRow> {
  const instant = reinterpretedInstant(row.calculationStartUtc, row.calculationStartTimeZone, value);
  return { calculationStartTimeZone: value, ...(instant ? { calculationStartUtc: instant } : {}) };
}

export function shipPortTimeZonePatch(row: ItineraryRow, value: string): Partial<ItineraryRow> {
  const patch: Partial<ItineraryRow> = { portTimeZone: value };
  for (const field of Object.keys(ITINERARY_TIME_ZONE_FIELDS) as ItineraryTimeField[]) {
    const zoneField = ITINERARY_TIME_ZONE_FIELDS[field];
    if (row[zoneField]) continue;
    const instant = reinterpretedInstant(row[field], row.portTimeZone, value);
    if (instant) Object.assign(patch, { [field]: instant });
  }
  return patch;
}

export function shipAutomaticInputGaps(rows: readonly ItineraryRow[]): ShipAutomaticInputGap[] {
  const missing: ShipAutomaticInputGap[] = [];
  const require = (row: ItineraryRow, rowNumber: number, field: keyof ItineraryRow, label: string, absent: boolean) => {
    if (absent) missing.push({ rowId: row.rowId, rowNumber, field, label });
  };
  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    require(row, rowNumber, 'portTimeZone', 'UTC Offset', !row.portTimeZone);
    if (index === 0) {
      require(row, rowNumber, 'calculationStartUtc', '首列 ETA 起算時間', !row.calculationStartUtc);
      require(row, rowNumber, 'calculationStartTimeZone', '首列 ETA 起算 UTC Offset', !row.calculationStartTimeZone);
    }
  });
  return missing;
}

export function setShipAutomaticCalculation(document: ItineraryDocument): ShipAutomaticCalculationResult {
  const next = cloneDocument(document);
  const rows = next.rows.map((row, index) => ({
    ...row,
    etaMode: 'auto' as const,
    etbMode: 'auto' as const,
    etcMode: 'auto' as const,
    etdMode: 'auto' as const,
  }));
  const missing = shipAutomaticInputGaps(rows);
  next.rows = recalculateItineraryRows(rows).rows;
  return { document: next, missing };
}

export function setAllShipTimesManual(document: ItineraryDocument): ItineraryDocument {
  const next = cloneDocument(document);
  next.rows = recalculateItineraryRows(next.rows).rows.map(row => ({
    ...row,
    etaMode: 'manual', etbMode: 'manual', etcMode: 'manual', etdMode: 'manual',
  }));
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
    || row.oceanDistanceNm !== null || row.speedKnots !== null || row.berthWaitHours !== null || row.channelSailingHours !== null || row.tanksText.trim()
    || row.operationQuantityMt !== null || row.operationRateMtPerHour !== null || row.preCompletionDelayHours !== null
    || row.postCompletionDelayHours !== null || row.departureBufferDays !== null
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

import { recalculateItineraryRows } from './itineraryDomain';
import { instantToWallTime, isValidItineraryTimeZone, wallTimeToInstant } from './itineraryTime';
import {
  createBlankItineraryRow, createEmptyItineraryDocument, createItineraryId, ITINERARY_MAX_ALTERNATIVE_PLANS, ITINERARY_TIME_ZONE_FIELDS, resolveItineraryTimeZone,
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

function documentAlternativePlans(document: ItineraryDocument) {
  return Array.isArray(document.alternativePlans) ? document.alternativePlans : [];
}

function synchronizeAlternativeAnchors(document: ItineraryDocument): ItineraryDocument {
  const formalAnchor = document.rows[0];
  document.alternativePlans = documentAlternativePlans(document).map(plan => ({
    ...plan,
    rows: recalculateItineraryRows(plan.rows.map((row, index) => ({
      ...row,
      previousPortName: '',
      calculationStartUtc: index === 0 ? formalAnchor?.calculationStartUtc || null : null,
      calculationStartTimeZone: index === 0 ? formalAnchor?.calculationStartTimeZone || '' : '',
    }))).rows,
  }));
  return document;
}

export function synchronizeShipAlternativeAnchors(document: ItineraryDocument): ItineraryDocument {
  return synchronizeAlternativeAnchors(cloneDocument(document));
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
  blank.alternativePlans = structuredClone(documentAlternativePlans(latest));
  return synchronizeAlternativeAnchors(blank);
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
  const removedFirstRow = next.rows[0]?.rowId === rowId ? next.rows[0] : null;
  const remaining = next.rows.filter(row => row.rowId !== rowId).map((row, index) => ({ ...row, sortOrder: index }));
  if (removedFirstRow && remaining[0]) {
    remaining[0] = {
      ...remaining[0],
      previousPortName: (removedFirstRow.portDockName || '').trim(),
      calculationStartUtc: removedFirstRow.calculationStartUtc,
      calculationStartTimeZone: removedFirstRow.calculationStartTimeZone,
    };
  }
  next.rows = recalculateItineraryRows(remaining.length ? remaining : [createBlankItineraryRow(undefined, 0)]).rows;
  if (next.rows[0]) next.rows[0].etaMode = next.rows[0].etaUtc ? next.rows[0].etaMode : 'manual';
  return removedFirstRow ? synchronizeAlternativeAnchors(next) : next;
}

export function updateShipDraftRow(document: ItineraryDocument, rowId: string, patch: Partial<ItineraryRow>): ItineraryDocument {
  const next = cloneDocument(document);
  const normalizedPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, 'ldRateText')) normalizedPatch.operationRateMtPerHour = parseItineraryRateText(patch.ldRateText || '');
  next.rows = recalculateItineraryRows(next.rows.map(row => row.rowId === rowId ? { ...row, ...normalizedPatch } : row)).rows;
  const changesAnchor = next.rows[0]?.rowId === rowId
    && (Object.prototype.hasOwnProperty.call(patch, 'calculationStartUtc') || Object.prototype.hasOwnProperty.call(patch, 'calculationStartTimeZone'));
  return changesAnchor ? synchronizeAlternativeAnchors(next) : next;
}

export function replaceShipDraftRows(document: ItineraryDocument, rows: ItineraryRow[]): ItineraryDocument {
  const next = cloneDocument(document);
  next.rows = rows.map(row => ({ ...row }));
  return synchronizeAlternativeAnchors(next);
}

export function addShipAlternativePlan(document: ItineraryDocument, planId = createItineraryId('alternative'), rowId = createItineraryId('alternative-row')): ItineraryDocument {
  const next = cloneDocument(document);
  const plans = documentAlternativePlans(next);
  if (plans.length >= ITINERARY_MAX_ALTERNATIVE_PLANS) {
    next.alternativePlans = plans;
    return next;
  }
  const formalAnchor = next.rows[0];
  const row = createBlankItineraryRow(rowId, 0);
  row.etaMode = 'manual';
  row.previousPortName = '';
  row.calculationStartUtc = formalAnchor?.calculationStartUtc || null;
  row.calculationStartTimeZone = formalAnchor?.calculationStartTimeZone || '';
  next.alternativePlans = [...plans, { planId, sortOrder: plans.length, rows: [row] }];
  return next;
}

export function removeShipAlternativePlan(document: ItineraryDocument, planId: string): ItineraryDocument {
  const next = cloneDocument(document);
  next.alternativePlans = documentAlternativePlans(next)
    .filter(plan => plan.planId !== planId)
    .map((plan, index) => ({ ...plan, sortOrder: index }));
  return next;
}

export function updateShipAlternativePlanRow(document: ItineraryDocument, planId: string, rowId: string, patch: Partial<ItineraryRow>): ItineraryDocument {
  const next = cloneDocument(document);
  const normalizedPatch = { ...patch };
  delete normalizedPatch.previousPortName;
  delete normalizedPatch.calculationStartUtc;
  delete normalizedPatch.calculationStartTimeZone;
  if (Object.prototype.hasOwnProperty.call(patch, 'ldRateText')) normalizedPatch.operationRateMtPerHour = parseItineraryRateText(patch.ldRateText || '');
  next.alternativePlans = documentAlternativePlans(next).map(plan => plan.planId !== planId ? plan : {
    ...plan,
    rows: recalculateItineraryRows(plan.rows.map(row => row.rowId === rowId ? { ...row, ...normalizedPatch } : row)).rows,
  });
  return next;
}

export function addShipAlternativePlanRow(document: ItineraryDocument, planId: string, rowId = createItineraryId('alternative-row')): ItineraryDocument {
  const next = cloneDocument(document);
  next.alternativePlans = documentAlternativePlans(next).map(plan => {
    if (plan.planId !== planId) return plan;
    const row = createBlankItineraryRow(rowId, plan.rows.length);
    row.portTimeZone = plan.rows[plan.rows.length - 1]?.portTimeZone || '';
    return { ...plan, rows: recalculateItineraryRows([...plan.rows, row]).rows };
  });
  return next;
}

export function removeShipAlternativePlanRow(document: ItineraryDocument, planId: string, rowId: string): ItineraryDocument {
  const next = cloneDocument(document);
  const formalAnchor = next.rows[0];
  next.alternativePlans = documentAlternativePlans(next).map(plan => {
    if (plan.planId !== planId || plan.rows.length <= 1) return plan;
    const removedFirst = plan.rows[0]?.rowId === rowId;
    const rows = plan.rows.filter(row => row.rowId !== rowId).map((row, index) => ({
      ...row,
      sortOrder: index,
      previousPortName: '',
      calculationStartUtc: index === 0 && removedFirst ? formalAnchor?.calculationStartUtc || null : row.calculationStartUtc,
      calculationStartTimeZone: index === 0 && removedFirst ? formalAnchor?.calculationStartTimeZone || '' : row.calculationStartTimeZone,
    }));
    const recalculated = recalculateItineraryRows(rows).rows;
    if (removedFirst && recalculated[0]) recalculated[0].etaMode = recalculated[0].etaUtc ? recalculated[0].etaMode : 'manual';
    return { ...plan, rows: recalculated };
  });
  return next;
}

export function setShipAlternativeAutomaticCalculation(document: ItineraryDocument, planId: string): ShipAutomaticCalculationResult {
  const next = cloneDocument(document);
  let missing: ShipAutomaticInputGap[] = [];
  next.alternativePlans = documentAlternativePlans(next).map(plan => {
    if (plan.planId !== planId) return plan;
    const rows = plan.rows.map(row => ({ ...row, etaMode: 'auto' as const, etbMode: 'auto' as const, etcMode: 'auto' as const, etdMode: 'auto' as const }));
    missing = shipAutomaticInputGaps(rows);
    return { ...plan, rows: recalculateItineraryRows(rows).rows };
  });
  return { document: next, missing };
}

export function setAllShipAlternativeTimesManual(document: ItineraryDocument, planId: string): ItineraryDocument {
  const next = cloneDocument(document);
  next.alternativePlans = documentAlternativePlans(next).map(plan => plan.planId !== planId ? plan : {
    ...plan,
    rows: recalculateItineraryRows(plan.rows).rows.map(row => ({
      ...row,
      etaMode: 'manual', etbMode: 'manual', etcMode: 'manual', etdMode: 'manual',
    })),
  });
  return next;
}

export function promoteShipAlternativePlanToDraft(document: ItineraryDocument, planId: string, createRowId: () => string = () => createItineraryId('row')): ItineraryDocument {
  const next = cloneDocument(document);
  const plan = documentAlternativePlans(next).find(candidate => candidate.planId === planId);
  if (!plan) return next;
  const formalFirst = next.rows[0];
  next.rows = recalculateItineraryRows(plan.rows.map((row, index) => ({
    ...structuredClone(row),
    rowId: createRowId(),
    sortOrder: index,
    previousPortName: index === 0 ? formalFirst?.previousPortName || '' : '',
    calculationStartUtc: index === 0 ? formalFirst?.calculationStartUtc || null : null,
    calculationStartTimeZone: index === 0 ? formalFirst?.calculationStartTimeZone || '' : '',
  }))).rows;
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

function draftHasBusinessContent(value: string | undefined): boolean {
  const normalized = String(value ?? '').split(/\r?\n/).map(line => line.trim()).join('\n').trim();
  return normalized !== '' && normalized !== 'A:\nF:';
}

function rowHasBusinessContent(row: ItineraryRow): boolean {
  return Boolean(
    row.voyageNumber.trim() || row.portDockName.trim() || row.operation || row.cargoQuantityText.trim()
    || row.etaUtc || row.etbUtc || row.ldRateText.trim() || row.etcUtc || row.etdUtc
    || draftHasBusinessContent(row.arrivalDraftText) || draftHasBusinessContent(row.departureDraftText)
    || row.arrivalRobText.trim() || row.departureRobText.trim() || (row.notesText || '').trim()
    || row.oceanDistanceNm !== null || row.speedKnots !== null || row.berthWaitHours !== null || row.channelSailingHours !== null || row.tanksText.trim()
    || row.operationQuantityMt !== null || row.operationRateMtPerHour !== null || row.preCompletionDelayHours !== null
    || row.postCompletionDelayHours !== null || row.departureBufferDays !== null
  );
}

export function hasShipDraftBusinessContent(document: ItineraryDocument): boolean {
  return document.rows.some(rowHasBusinessContent);
}

export function hasShipPreviousPortName(document: ItineraryDocument): boolean {
  return Boolean(document.rows[0]?.previousPortName?.trim());
}

export function trimTrailingBlankShipRows(document: ItineraryDocument): ItineraryDocument {
  const next = cloneDocument(document);
  while (next.rows.length > 1 && !rowHasBusinessContent(next.rows[next.rows.length - 1])) next.rows.pop();
  next.rows = next.rows.map((row, index) => ({ ...row, sortOrder: index }));
  next.alternativePlans = documentAlternativePlans(next).map((plan, planIndex) => {
    const rows = plan.rows.map(row => ({ ...row }));
    while (rows.length > 1 && !rowHasBusinessContent(rows[rows.length - 1])) rows.pop();
    return {
      ...plan,
      sortOrder: planIndex,
      rows: rows.map((row, rowIndex) => ({ ...row, sortOrder: rowIndex, previousPortName: '' })),
    };
  });
  return synchronizeAlternativeAnchors(next);
}

import { ITINERARY_MAX_ROWS, ITINERARY_SCHEMA_VERSION, type ItineraryDocument, type ItineraryRow } from './itineraryTypes';
import { isValidIanaTimeZone, normalizeInstant } from './itineraryTime';

export interface ItineraryValidationError {
  path: string;
  code: string;
  message: string;
}

export type ItineraryValidationResult =
  | { ok: true; value: ItineraryDocument }
  | { ok: false; errors: ItineraryValidationError[] };

const stringLimits: Partial<Record<keyof ItineraryRow, number>> = {
  rowId: 120,
  voyageNumber: 80,
  portDockName: 240,
  cargoQuantityText: 1000,
  ldRateText: 240,
  arrivalDraftText: 240,
  departureDraftText: 240,
  arrivalRobText: 500,
  departureRobText: 500,
  portTimeZone: 100,
  tanksText: 500,
};

const numericLimits: Partial<Record<keyof ItineraryRow, [number, number]>> = {
  oceanDistanceNm: [0, 50_000],
  speedKnots: [0.01, 100],
  sailingHours: [0, 100_000],
  berthWaitHours: [0, 720],
  operationQuantityMt: [0, 1_000_000_000],
  operationRateMtPerHour: [0.01, 10_000_000],
  operationHours: [0, 100_000],
  departureBufferDays: [0, 365],
};

function add(errors: ItineraryValidationError[], path: string, code: string, message: string): void {
  errors.push({ path, code, message });
}

function validateString(errors: ItineraryValidationError[], row: Record<string, unknown>, key: keyof ItineraryRow, path: string): void {
  const value = row[key];
  const limit = stringLimits[key];
  if (typeof value !== 'string') return add(errors, `${path}.${String(key)}`, 'invalid-string', '欄位必須是文字。');
  if (limit && value.length > limit) add(errors, `${path}.${String(key)}`, 'string-too-long', `文字不可超過 ${limit} 字。`);
}

function validateNullableNumber(errors: ItineraryValidationError[], row: Record<string, unknown>, key: keyof ItineraryRow, path: string): void {
  const value = row[key];
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) return add(errors, `${path}.${String(key)}`, 'invalid-number', '欄位必須是有效數字或空白。');
  const range = numericLimits[key];
  if (range && (value < range[0] || value > range[1])) add(errors, `${path}.${String(key)}`, 'number-out-of-range', `數值必須介於 ${range[0]} 至 ${range[1]}。`);
}

export function validateItineraryDocument(input: unknown): ItineraryValidationResult {
  const errors: ItineraryValidationError[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ path: '$', code: 'invalid-document', message: 'Itinerary 文件格式無效。' }] };
  }
  const document = input as ItineraryDocument;
  if (document.schemaVersion !== ITINERARY_SCHEMA_VERSION) add(errors, 'schemaVersion', 'unsupported-schema', '不支援此 Itinerary schema 版本。');
  for (const [key, limit] of [['workspaceKey', 160], ['vesselId', 160], ['vesselName', 240], ['updatedActorLabel', 240]] as const) {
    const value = document[key];
    if (typeof value !== 'string' || (!value.trim() && key !== 'updatedActorLabel')) add(errors, key, 'invalid-string', '欄位必須是非空文字。');
    else if (value.length > limit) add(errors, key, 'string-too-long', `文字不可超過 ${limit} 字。`);
  }
  if (!Number.isInteger(document.revision) || document.revision < 0) add(errors, 'revision', 'invalid-revision', 'revision 必須是 0 或正整數。');
  if (document.updatedAt !== null && (typeof document.updatedAt !== 'string' || !normalizeInstant(document.updatedAt))) add(errors, 'updatedAt', 'invalid-instant', 'updatedAt 必須是 UTC instant 或空白。');
  if (!['owner', 'vessel', 'demo'].includes(document.updatedActorKind)) add(errors, 'updatedActorKind', 'invalid-actor-kind', '更新來源無效。');
  if (!Array.isArray(document.rows) || document.rows.length < 1 || document.rows.length > ITINERARY_MAX_ROWS) {
    add(errors, 'rows', 'invalid-row-count', `必須有 1 至 ${ITINERARY_MAX_ROWS} 列。`);
  } else {
    const rowIds = new Set<string>();
    document.rows.forEach((typedRow, index) => {
      const path = `rows[${index}]`;
      if (!typedRow || typeof typedRow !== 'object' || Array.isArray(typedRow)) {
        add(errors, path, 'invalid-row', '航次列格式無效。');
        return;
      }
      const row = typedRow as unknown as Record<string, unknown>;
      for (const key of Object.keys(stringLimits) as (keyof ItineraryRow)[]) validateString(errors, row, key, path);
      const rowId = typeof row.rowId === 'string' ? row.rowId : '';
      if (!rowId.trim()) add(errors, `${path}.rowId`, 'missing-row-id', 'rowId 不可空白。');
      else if (rowIds.has(rowId)) add(errors, `${path}.rowId`, 'duplicate-row-id', 'rowId 不可重複。');
      else rowIds.add(rowId);
      if (!Number.isInteger(row.sortOrder) || row.sortOrder !== index) add(errors, `${path}.sortOrder`, 'invalid-sort-order', 'sortOrder 必須依畫面順序由 0 連續排列。');
      if (!['', 'Loading', 'Unloading'].includes(String(row.operation))) add(errors, `${path}.operation`, 'invalid-operation', 'Loading / Unloading 值無效。');
      for (const key of ['etaMode', 'etbMode', 'etcMode', 'etdMode'] as const) {
        if (row[key] !== 'auto' && row[key] !== 'manual') add(errors, `${path}.${key}`, 'invalid-time-mode', '時間模式必須是 auto 或 manual。');
      }
      for (const key of ['etaUtc', 'etbUtc', 'etcUtc', 'etdUtc'] as const) {
        const value = row[key];
        if (value !== null && (typeof value !== 'string' || !normalizeInstant(value))) add(errors, `${path}.${key}`, 'invalid-instant', '時間必須是 UTC instant 或空白。');
      }
      for (const key of Object.keys(numericLimits) as (keyof ItineraryRow)[]) validateNullableNumber(errors, row, key, path);
      if (typeof row.portTimeZone === 'string' && row.portTimeZone && !isValidIanaTimeZone(row.portTimeZone)) add(errors, `${path}.portTimeZone`, 'invalid-time-zone', '請選擇有效的 IANA 港口時區。');
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: document };
}

import type { ItineraryRow } from './itineraryTypes';
import { resolveItineraryTimeZone } from './itineraryTypes';
import { addHoursToInstant, isValidItineraryTimeZone } from './itineraryTime';

export type ItineraryCalculationIssueCode =
  | 'invalid-distance'
  | 'invalid-speed'
  | 'invalid-operation-quantity'
  | 'invalid-operation-rate'
  | 'invalid-berth-wait'
  | 'invalid-channel-sailing'
  | 'invalid-pre-completion-delay'
  | 'invalid-post-completion-delay'
  | 'invalid-time-zone'
  | 'missing-calculation-start'
  | 'missing-previous-etd';

export interface ItineraryCalculationIssue {
  rowId: string;
  field: keyof ItineraryRow;
  code: ItineraryCalculationIssueCode;
  message: string;
}

export interface ItineraryCalculationResult {
  rows: ItineraryRow[];
  issues: ItineraryCalculationIssue[];
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function durationOrZero(value: number | null | undefined): number {
  const finite = finiteOrNull(value);
  return finite !== null && finite >= 0 ? finite : 0;
}

function rowHasBusinessInput(row: ItineraryRow): boolean {
  return Boolean(
    row.voyageNumber.trim()
      || row.portDockName.trim()
      || row.operation
      || row.cargoQuantityText.trim()
      || row.etaUtc
      || row.etbUtc
      || row.etcUtc
      || row.etdUtc
      || row.oceanDistanceNm !== null
      || row.speedKnots !== null,
  );
}

function validateNonNegative(
  issues: ItineraryCalculationIssue[],
  row: ItineraryRow,
  field: keyof ItineraryRow,
  code: ItineraryCalculationIssueCode,
  message: string,
): void {
  const value = finiteOrNull(row[field] as number | null | undefined);
  if (value !== null && value < 0) issues.push({ rowId: row.rowId, field, code, message });
}

export function resequenceItineraryRows(rows: readonly ItineraryRow[]): ItineraryRow[] {
  return rows.map((row, index) => ({ ...row, sortOrder: index }));
}

export function recalculateItineraryRows(inputRows: readonly ItineraryRow[]): ItineraryCalculationResult {
  const issues: ItineraryCalculationIssue[] = [];
  const rows = resequenceItineraryRows(inputRows).map(row => ({ ...row }));

  for (const row of rows) {
    const distance = finiteOrNull(row.oceanDistanceNm);
    const speed = finiteOrNull(row.speedKnots);
    row.sailingHours = null;
    if (distance !== null && distance < 0) {
      issues.push({ rowId: row.rowId, field: 'oceanDistanceNm', code: 'invalid-distance', message: 'DTG 必須為 0 或正數。' });
    }
    if (speed !== null && speed <= 0) {
      issues.push({ rowId: row.rowId, field: 'speedKnots', code: 'invalid-speed', message: '預估航速必須大於 0。' });
    }
    if (distance !== null && distance >= 0 && speed !== null && speed > 0) row.sailingHours = distance / speed;

    const quantity = finiteOrNull(row.operationQuantityMt);
    const rate = finiteOrNull(row.operationRateMtPerHour);
    row.operationHours = null;
    if (quantity !== null && quantity < 0) {
      issues.push({ rowId: row.rowId, field: 'operationQuantityMt', code: 'invalid-operation-quantity', message: '作業數量必須為 0 或正數。' });
    }
    if (rate !== null && rate <= 0) {
      issues.push({ rowId: row.rowId, field: 'operationRateMtPerHour', code: 'invalid-operation-rate', message: '預計 L/D rate 必須大於 0。' });
    }
    if (quantity !== null && quantity >= 0 && rate !== null && rate > 0) row.operationHours = quantity / rate;

    validateNonNegative(issues, row, 'berthWaitHours', 'invalid-berth-wait', '預估等待時間（靠泊前）不可為負數。');
    validateNonNegative(issues, row, 'channelSailingHours', 'invalid-channel-sailing', '預計航道航行時間不可為負數。');
    validateNonNegative(issues, row, 'preCompletionDelayHours', 'invalid-pre-completion-delay', '預估等待／延誤時間（完貨前）不可為負數。');
    validateNonNegative(issues, row, 'postCompletionDelayHours', 'invalid-post-completion-delay', '預估等待／延誤時間（完貨後）不可為負數。');

    if (row.portTimeZone && !isValidItineraryTimeZone(row.portTimeZone)) {
      issues.push({ rowId: row.rowId, field: 'portTimeZone', code: 'invalid-time-zone', message: '請選擇有效的港口 UTC Offset。' });
    }
    for (const field of ['etaUtc', 'etbUtc', 'etcUtc', 'etdUtc'] as const) {
      const timeZone = resolveItineraryTimeZone(row, field);
      if (timeZone && !isValidItineraryTimeZone(timeZone)) {
        const zoneField = field === 'etaUtc' ? 'etaTimeZone' : field === 'etbUtc' ? 'etbTimeZone' : field === 'etcUtc' ? 'etcTimeZone' : 'etdTimeZone';
        issues.push({ rowId: row.rowId, field: zoneField, code: 'invalid-time-zone', message: `${field.slice(0, 3).toUpperCase()} UTC Offset 無效。` });
      }
    }
    if (row.calculationStartTimeZone && !isValidItineraryTimeZone(row.calculationStartTimeZone)) {
      issues.push({ rowId: row.rowId, field: 'calculationStartTimeZone', code: 'invalid-time-zone', message: '首列 ETA 起算 UTC Offset 無效。' });
    }
  }

  rows.forEach((row, index) => {
    const previous = index > 0 ? rows[index - 1] : null;

    if (row.etaMode === 'auto') {
      const base = index === 0 ? row.calculationStartUtc : previous?.etdUtc;
      row.etaUtc = base ? addHoursToInstant(base, durationOrZero(row.sailingHours)) : null;
      if (!base && rowHasBusinessInput(row)) {
        issues.push(index === 0
          ? { rowId: row.rowId, field: 'calculationStartUtc', code: 'missing-calculation-start', message: '請輸入首列 ETA 起算時間與 UTC Offset。' }
          : { rowId: row.rowId, field: 'etaUtc', code: 'missing-previous-etd', message: '前一港 ETD 尚未建立，無法自動計算本列 ETA。' });
      }
    }

    if (row.etbMode === 'auto') {
      const hours = durationOrZero(row.berthWaitHours) + durationOrZero(row.channelSailingHours);
      row.etbUtc = row.etaUtc ? addHoursToInstant(row.etaUtc, hours) : null;
    }

    if (row.etcMode === 'auto') {
      const hours = durationOrZero(row.preCompletionDelayHours) + durationOrZero(row.operationHours);
      row.etcUtc = row.etbUtc ? addHoursToInstant(row.etbUtc, hours) : null;
    }

    if (row.etdMode === 'auto') {
      const hasV2PostDelay = Object.prototype.hasOwnProperty.call(row, 'postCompletionDelayHours');
      const hours = hasV2PostDelay
        ? durationOrZero(row.postCompletionDelayHours)
        : durationOrZero(row.departureBufferDays) * 24;
      row.etdUtc = row.etcUtc ? addHoursToInstant(row.etcUtc, hours) : null;
    }
  });

  return { rows, issues };
}

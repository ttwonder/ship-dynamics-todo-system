import type { ItineraryRow } from './itineraryTypes';
import { addHoursToInstant, isValidIanaTimeZone } from './itineraryTime';

export type ItineraryCalculationIssueCode =
  | 'invalid-distance'
  | 'invalid-speed'
  | 'invalid-operation-quantity'
  | 'invalid-operation-rate'
  | 'invalid-berth-wait'
  | 'invalid-departure-buffer'
  | 'invalid-time-zone'
  | 'missing-previous-sailing-time';

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

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
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
      || row.etdUtc,
  );
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
    if (distance !== null || speed !== null) {
      if (distance === null || distance < 0) {
        issues.push({ rowId: row.rowId, field: 'oceanDistanceNm', code: 'invalid-distance', message: '大洋距離必須為 0 或正數。' });
      } else if (speed === null || speed <= 0) {
        issues.push({ rowId: row.rowId, field: 'speedKnots', code: 'invalid-speed', message: '速度必須大於 0 才能計算航行時間。' });
      } else {
        row.sailingHours = Math.ceil(distance / speed);
      }
    }

    const quantity = finiteOrNull(row.operationQuantityMt);
    const rate = finiteOrNull(row.operationRateMtPerHour);
    row.operationHours = null;
    if (quantity !== null || rate !== null) {
      if (quantity === null || quantity < 0) {
        issues.push({ rowId: row.rowId, field: 'operationQuantityMt', code: 'invalid-operation-quantity', message: '裝卸數量必須為 0 或正數。' });
      } else if (rate === null || rate <= 0) {
        issues.push({ rowId: row.rowId, field: 'operationRateMtPerHour', code: 'invalid-operation-rate', message: '裝卸速度必須大於 0 才能計算裝卸時間。' });
      } else {
        row.operationHours = quantity / rate;
      }
    }

    if (row.portTimeZone && !isValidIanaTimeZone(row.portTimeZone)) {
      issues.push({ rowId: row.rowId, field: 'portTimeZone', code: 'invalid-time-zone', message: '請選擇有效的 IANA 港口時區。' });
    }
  }

  rows.forEach((row, index) => {
    const validZone = isValidIanaTimeZone(row.portTimeZone);
    const previous = index > 0 ? rows[index - 1] : null;

    if (row.etaMode === 'auto' && previous) {
      if (validZone && previous.etdUtc && previous.sailingHours !== null) {
        row.etaUtc = addHoursToInstant(previous.etdUtc, previous.sailingHours);
      } else {
        row.etaUtc = null;
        if (rowHasBusinessInput(row)) {
          issues.push({ rowId: row.rowId, field: 'etaUtc', code: 'missing-previous-sailing-time', message: '前一港 ETD、航行距離或速度不足，無法自動計算 ETA。' });
        }
      }
    }

    if (row.etbMode === 'auto') {
      const wait = finiteOrNull(row.berthWaitHours);
      if (wait !== null && wait < 0) {
        row.etbUtc = null;
        issues.push({ rowId: row.rowId, field: 'berthWaitHours', code: 'invalid-berth-wait', message: '到碼頭／等泊時間不可為負數。' });
      } else {
        row.etbUtc = validZone && row.etaUtc && wait !== null ? addHoursToInstant(row.etaUtc, wait) : null;
      }
    }

    if (row.etcMode === 'auto') {
      row.etcUtc = validZone && row.etbUtc && row.operationHours !== null
        ? addHoursToInstant(row.etbUtc, row.operationHours)
        : null;
    }

    if (row.etdMode === 'auto') {
      const buffer = finiteOrNull(row.departureBufferDays);
      if (buffer !== null && buffer < 0) {
        row.etdUtc = null;
        issues.push({ rowId: row.rowId, field: 'departureBufferDays', code: 'invalid-departure-buffer', message: '預加時間不可為負數。' });
      } else {
        row.etdUtc = validZone && row.etcUtc && buffer !== null
          ? addHoursToInstant(row.etcUtc, buffer * 24)
          : null;
      }
    }
  });

  return { rows, issues };
}

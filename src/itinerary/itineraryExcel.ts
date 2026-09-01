import type ExcelJS from 'exceljs';
import { recalculateItineraryRows } from './itineraryDomain';
import { addHoursToInstant, formatUtcOffsetMinutes, instantToWallTime, isValidItineraryTimeZone, parseUtcOffsetMinutes, wallTimeToInstant } from './itineraryTime';
import { createBlankItineraryRow, createItineraryId, formatItineraryOperation, ITINERARY_SCHEMA_VERSION, ITINERARY_TIME_ZONE_FIELDS, normalizeItineraryOperation, resolveItineraryTimeZone, type ItineraryDocument, type ItineraryOperation, type ItineraryRow } from './itineraryTypes';

const META_SHEET = '_Itinerary_Meta';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXCEL_LAYOUT_VERSION = 2;
const EXCEL_MAX_COLUMN = 36;
const MERGED_COLUMNS = [1, 2, 3, 4, 7, ...Array.from({ length: 27 }, (_, index) => index + 10)];
const TIME_FIELDS = ['etaUtc', 'etbUtc', 'etcUtc', 'etdUtc'] as const;

type TimeField = typeof TIME_FIELDS[number];
type ExcelRuntime = { Workbook: new () => ExcelJS.Workbook; default?: { Workbook: new () => ExcelJS.Workbook } };

export interface ItineraryExcelIssue {
  code: 'invalid-template' | 'invalid-operation' | 'time-zone-required' | 'invalid-time' | 'calculation';
  message: string;
  rowNumber?: number;
  field?: string;
}

interface WallParts { date: string; time: string }
interface ImportedRowSource {
  row: ItineraryRow;
  excelRow: number;
  rawTimeZone: unknown;
  rawTimeZones: Partial<Record<TimeField, unknown>>;
  wallTimes: Partial<Record<TimeField, WallParts>>;
  calculationStartWall: WallParts | null;
  rawCalculationStartTimeZone: unknown;
  excelLayoutVersion: number;
  sourceIssues: ItineraryExcelIssue[];
}

export interface ParsedItinerarySheet {
  sheetName: string;
  embeddedVesselId: string | null;
  embeddedVesselName: string | null;
  embeddedRevision: number | null;
  rows: ItineraryRow[];
  issues: ItineraryExcelIssue[];
  timeZoneNeeds: Array<{ rowId: string; rowNumber: number; portDockName: string; legacyOffsetHours: number | null }>;
  sourceRows: ImportedRowSource[];
}

export interface ParsedItineraryWorkbook {
  schemaVersion: number | null;
  sheets: ParsedItinerarySheet[];
}

export type ItineraryExcelBuildStage = 'exceljs' | 'template' | 'sheets' | 'write' | 'done';

async function newWorkbook(): Promise<ExcelJS.Workbook> {
  const loaded = await import('exceljs') as unknown as ExcelRuntime;
  const Constructor = loaded.Workbook || loaded.default?.Workbook;
  if (!Constructor) throw new Error('ExcelJS Workbook constructor is unavailable.');
  return new Constructor();
}

function copyBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const source = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

function cloneStyle<T>(value: T): T {
  return value ? JSON.parse(JSON.stringify(value)) as T : value;
}

function cleanSheetName(value: string): string {
  const cleaned = value.replace(/[\\/*?:\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Itinerary').slice(0, 31);
}

function uniqueSheetName(value: string, used: Set<string>): string {
  const base = cleanSheetName(value);
  let candidate = base;
  let sequence = 2;
  while (used.has(candidate.toLocaleLowerCase())) {
    const suffix = ` (${sequence++})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

function copyTemplateLayout(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet, maxRow: number): void {
  target.properties = cloneStyle(source.properties);
  target.pageSetup = cloneStyle(source.pageSetup);
  target.headerFooter = cloneStyle(source.headerFooter);
  target.views = [{ state: 'frozen', ySplit: 3, topLeftCell: 'A4', activeCell: 'A4', showGridLines: false, zoomScale: 90, zoomScaleNormal: 100 }];
  for (let column = 1; column <= EXCEL_MAX_COLUMN; column += 1) {
    const from = source.getColumn(Math.min(column, 23));
    const to = target.getColumn(column);
    to.width = from.width;
    to.hidden = from.hidden;
    to.outlineLevel = from.outlineLevel;
    to.style = cloneStyle(from.style);
  }
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const templateRowNumber = rowNumber <= source.rowCount ? rowNumber : (rowNumber % 2 === 0 ? 4 : 5);
    const sourceRow = source.getRow(templateRowNumber);
    const targetRow = target.getRow(rowNumber);
    targetRow.height = sourceRow.height;
    targetRow.hidden = sourceRow.hidden;
    targetRow.outlineLevel = sourceRow.outlineLevel;
    for (let column = 1; column <= EXCEL_MAX_COLUMN; column += 1) {
      const from = sourceRow.getCell(Math.min(column, 23));
      const to = targetRow.getCell(column);
      to.style = cloneStyle(from.style);
      to.numFmt = from.numFmt;
      to.alignment = cloneStyle(from.alignment);
      to.border = cloneStyle(from.border);
      to.fill = cloneStyle(from.fill);
      to.font = cloneStyle(from.font);
      to.protection = cloneStyle(from.protection);
      if (rowNumber <= 3) to.value = from.value;
    }
  }
  for (const range of ['A1:M1', 'A2:B2', 'C2:D2', 'L2:M2']) target.mergeCells(range);
}

function wallDate(instant: string | null, timeZone: string): Date | null {
  if (!instant || !isValidItineraryTimeZone(timeZone)) return null;
  try {
    const wall = instantToWallTime(instant, timeZone);
    if (!wall.ok) return null;
    const [year, month, day] = wall.date.split('-').map(Number);
    const [hour, minute] = wall.time.split(':').map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour, minute));
  } catch {
    return null;
  }
}

function offsetHours(instant: string | null, timeZone: string): number | null {
  if (!isValidItineraryTimeZone(timeZone)) return null;
  const fixedOffset = parseUtcOffsetMinutes(timeZone);
  if (fixedOffset !== null) return fixedOffset / 60;
  if (!instant) return null;
  const local = wallDate(instant, timeZone);
  if (!local) return null;
  return (local.getTime() - new Date(instant).getTime()) / 3_600_000;
}

function formulaValue(formula: string, result: Date | number | string | null): ExcelJS.CellFormulaValue {
  return result === null ? { formula } : { formula, result };
}

function setTimePair(worksheet: ExcelJS.Worksheet, primary: number, column: number, instant: string | null, mode: ItineraryRow['etaMode'], formula: string | null, timeZone: string): void {
  const value = wallDate(instant, timeZone);
  for (const rowNumber of [primary, primary + 1]) {
    const cell = worksheet.getCell(rowNumber, column);
    cell.value = formula && mode === 'auto' ? formulaValue(formula, value) : value;
  }
}

function fillDocumentSheet(worksheet: ExcelJS.Worksheet, document: ItineraryDocument): void {
  worksheet.getCell('A1').value = "Ship's Itinerary";
  worksheet.getCell('A2').value = `Vsl name: ${document.vesselName}`;
  worksheet.getCell('K2').value = 'Update Date:';
  worksheet.getCell('L2').value = document.updatedAt ? new Date(document.updatedAt) : new Date();
  worksheet.getCell('L2').numFmt = 'yyyy-mm-dd hh:mm';

  const headers = [
    'Voy No.', 'Next Port & Dock Name', 'Purpose', 'B/F or I/F Qty (MT/BBLS)', 'ETA (LT)', 'ETB (LT)', '預計L/D rate (MT/h)',
    'ETC (LT)', 'ETD (LT)', 'Arr Draft', 'Dep Draft', 'Arr ROB', 'Dep ROB', 'UTC Offset', 'DTG(NM)', '預估航速(kn)',
    '剩餘航行時間(h)', '預估等待時間(靠泊前)(h)', '預計航道航行時間(h)', '作業艙號', '裝卸貨量(MT)', '預計L/D rate (MT/h)',
    '預計作業時間(h)', '預估等待/延誤時間(完貨前)(h)', '預估等待/延誤時間(完貨後)(h)', 'ETA UTC Offset', 'ETB UTC Offset',
    'ETC UTC Offset', 'ETD UTC Offset', '首列 ETA 起算時間(LT)', '首列 ETA 起算 UTC Offset', 'Start Offset (h)', 'ETA Offset (h)',
    'ETB Offset (h)', 'ETC Offset (h)', 'ETD Offset (h)',
  ];
  headers.forEach((header, index) => { worksheet.getCell(3, index + 1).value = header; });
  for (let column = 32; column <= 36; column += 1) {
    worksheet.getColumn(column).hidden = true;
    worksheet.getColumn(column).width = 12;
  }
  for (let column = 24; column <= 31; column += 1) worksheet.getColumn(column).width = column === 30 ? 22 : 18;

  document.rows.forEach((row, index) => {
    const primary = 4 + index * 2;
    const secondary = primary + 1;
    for (const column of MERGED_COLUMNS) worksheet.mergeCells(primary, column, secondary, column);

    worksheet.getCell(primary, 1).value = row.voyageNumber;
    worksheet.getCell(primary, 2).value = row.portDockName;
    worksheet.getCell(primary, 3).value = formatItineraryOperation(row.operation);
    worksheet.getCell(primary, 3).dataValidation = {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"To Load,To Unload,docking,waiting order,repair,inspection,To Load / To Unload"'],
    };
    worksheet.getCell(primary, 4).value = row.cargoQuantityText;
    worksheet.getCell(primary, 7).value = row.ldRateText;
    worksheet.getCell(primary, 10).value = row.arrivalDraftText;
    worksheet.getCell(primary, 11).value = row.departureDraftText;
    worksheet.getCell(primary, 12).value = row.arrivalRobText;
    worksheet.getCell(primary, 13).value = row.departureRobText;
    worksheet.getCell(primary, 14).value = row.portTimeZone;
    worksheet.getCell(primary, 15).value = row.oceanDistanceNm;
    worksheet.getCell(primary, 16).value = row.speedKnots;
    worksheet.getCell(primary, 17).value = row.sailingHours !== null
      ? formulaValue(`IF(OR(O${primary}="",P${primary}=""),"",O${primary}/P${primary})`, row.sailingHours) : null;
    worksheet.getCell(primary, 18).value = row.berthWaitHours;
    worksheet.getCell(primary, 19).value = row.channelSailingHours;
    worksheet.getCell(primary, 20).value = row.tanksText;
    worksheet.getCell(primary, 21).value = row.operationQuantityMt;
    worksheet.getCell(primary, 22).value = row.operationRateMtPerHour;
    worksheet.getCell(primary, 23).value = row.operationHours !== null
      ? formulaValue(`IF(OR(U${primary}="",V${primary}=""),"",U${primary}/V${primary})`, row.operationHours) : null;
    worksheet.getCell(primary, 24).value = row.preCompletionDelayHours;
    worksheet.getCell(primary, 25).value = row.postCompletionDelayHours;
    worksheet.getCell(primary, 26).value = row.etaTimeZone;
    worksheet.getCell(primary, 27).value = row.etbTimeZone;
    worksheet.getCell(primary, 28).value = row.etcTimeZone;
    worksheet.getCell(primary, 29).value = row.etdTimeZone;
    worksheet.getCell(primary, 30).value = wallDate(row.calculationStartUtc, row.calculationStartTimeZone);
    worksheet.getCell(primary, 30).numFmt = 'yyyy-mm-dd hh:mm';
    worksheet.getCell(primary, 31).value = row.calculationStartTimeZone;

    const etaZone = resolveItineraryTimeZone(row, 'etaUtc');
    const etbZone = resolveItineraryTimeZone(row, 'etbUtc');
    const etcZone = resolveItineraryTimeZone(row, 'etcUtc');
    const etdZone = resolveItineraryTimeZone(row, 'etdUtc');
    worksheet.getCell(primary, 32).value = offsetHours(row.calculationStartUtc, row.calculationStartTimeZone);
    worksheet.getCell(primary, 33).value = offsetHours(row.etaUtc, etaZone);
    worksheet.getCell(primary, 34).value = offsetHours(row.etbUtc, etbZone);
    worksheet.getCell(primary, 35).value = offsetHours(row.etcUtc, etcZone);
    worksheet.getCell(primary, 36).value = offsetHours(row.etdUtc, etdZone);

    const previousPrimary = primary - 2;
    const etaFormula = index === 0
      ? `IF(AD${primary}="","",AD${primary}+IF(Q${primary}="",0,Q${primary})/24-AF${primary}/24+AG${primary}/24)`
      : `IF(I${previousPrimary}="","",I${previousPrimary}+IF(Q${primary}="",0,Q${primary})/24-AJ${previousPrimary}/24+AG${primary}/24)`;
    const etbFormula = `IF(E${primary}="","",E${primary}+(IF(R${primary}="",0,R${primary})+IF(S${primary}="",0,S${primary}))/24-AG${primary}/24+AH${primary}/24)`;
    const etcFormula = `IF(F${primary}="","",F${primary}+(IF(X${primary}="",0,X${primary})+IF(W${primary}="",0,W${primary}))/24-AH${primary}/24+AI${primary}/24)`;
    const etdFormula = `IF(H${primary}="","",H${primary}+IF(Y${primary}="",0,Y${primary})/24-AI${primary}/24+AJ${primary}/24)`;
    setTimePair(worksheet, primary, 5, row.etaUtc, row.etaMode, etaFormula, etaZone);
    setTimePair(worksheet, primary, 6, row.etbUtc, row.etbMode, etbFormula, etbZone);
    setTimePair(worksheet, primary, 8, row.etcUtc, row.etcMode, etcFormula, etcZone);
    setTimePair(worksheet, primary, 9, row.etdUtc, row.etdMode, etdFormula, etdZone);
  });

  const lastRow = Math.max(5, 3 + document.rows.length * 2);
  worksheet.pageSetup.printArea = `A1:M${lastRow}`;
  worksheet.pageSetup.fitToPage = true;
  worksheet.pageSetup.fitToWidth = 1;
  worksheet.pageSetup.fitToHeight = 0;
  worksheet.pageSetup.orientation = 'landscape';
  worksheet.pageSetup.printTitlesRow = '1:3';
  worksheet.pageSetup.horizontalCentered = true;
}

export async function buildItineraryWorkbook(documents: ItineraryDocument[], template: ArrayBuffer, onStage?: (stage: ItineraryExcelBuildStage) => void): Promise<ArrayBuffer> {
  if (!documents.length) throw new Error('至少需要一艘船才能匯出 Excel。');
  onStage?.('exceljs');
  const templateWorkbook = await newWorkbook();
  onStage?.('template');
  await templateWorkbook.xlsx.load(template as unknown as ExcelJS.Buffer);
  const templateSheet = templateWorkbook.worksheets[0];
  if (!templateSheet || String(templateSheet.getCell('A3').value || '').trim() !== 'Voy No.') throw new Error('Itinerary Excel 模板格式不正確。');

  const workbook = await newWorkbook();
  workbook.creator = 'Ship Dynamics Itinerary';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const used = new Set<string>([META_SHEET.toLocaleLowerCase()]);
  const metadata: Array<{ sheetName: string; document: ItineraryDocument }> = [];

  onStage?.('sheets');
  for (const document of documents) {
    const sheetName = uniqueSheetName(document.vesselName, used);
    const maxRow = Math.max(30, 3 + document.rows.length * 2);
    const worksheet = workbook.addWorksheet(sheetName);
    copyTemplateLayout(templateSheet, worksheet, maxRow);
    fillDocumentSheet(worksheet, document);
    metadata.push({ sheetName, document });
  }

  const meta = workbook.addWorksheet(META_SHEET, { state: 'veryHidden' });
  meta.addRow(['sheetName', 'vesselId', 'vesselName', 'schemaVersion', 'revision', 'updatedAt', 'excelLayoutVersion']);
  for (const entry of metadata) meta.addRow([entry.sheetName, entry.document.vesselId, entry.document.vesselName, ITINERARY_SCHEMA_VERSION, entry.document.revision, entry.document.updatedAt, EXCEL_LAYOUT_VERSION]);
  meta.state = 'veryHidden';

  onStage?.('write');
  const output = await workbook.xlsx.writeBuffer();
  const result = copyBuffer(output as unknown as ArrayBufferView);
  onStage?.('done');
  return result;
}

export async function loadItineraryTemplate(): Promise<ArrayBuffer> {
  const response = await fetch(`${import.meta.env.BASE_URL}templates/itinerary-template-v1.xlsx`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`無法載入 Itinerary Excel 模板（HTTP ${response.status}）。`);
  return response.arrayBuffer();
}

export async function downloadItineraryWorkbook(documents: ItineraryDocument[], filename: string): Promise<void> {
  const output = await buildItineraryWorkbook(documents, await loadItineraryTemplate());
  const url = URL.createObjectURL(new Blob([output], { type: MIME }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

function rawCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value as unknown;
  if (value && typeof value === 'object' && 'formula' in (value as Record<string, unknown>)) return (value as { result?: unknown }).result ?? null;
  if (value && typeof value === 'object' && 'richText' in (value as Record<string, unknown>)) return (value as { richText: Array<{ text: string }> }).richText.map(part => part.text).join('');
  return value;
}

function isFormula(cell: ExcelJS.Cell): boolean {
  const value = cell.value as unknown;
  return Boolean(value && typeof value === 'object' && 'formula' in (value as Record<string, unknown>));
}

function textCell(cell: ExcelJS.Cell): string {
  const value = rawCellValue(cell);
  return value === null || value === undefined ? '' : String(value).trim();
}

function numberCell(cell: ExcelJS.Cell): number | null {
  const value = rawCellValue(cell);
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function operationCell(cell: ExcelJS.Cell): { value: ItineraryOperation; issue?: ItineraryExcelIssue } {
  const raw = textCell(cell);
  if (!raw) return { value: '' };
  const normalized = normalizeItineraryOperation(raw);
  if (normalized !== null) return { value: normalized };
  return { value: '', issue: { code: 'invalid-operation', message: `無法識別 Purpose：${raw}`, field: 'operation' } };
}

function pad(value: number): string { return String(value).padStart(2, '0'); }

function wallPartsFromCell(cell: ExcelJS.Cell, date1904: boolean): WallParts | null {
  const value = rawCellValue(cell);
  if (value === null || value === undefined || value === '') return null;
  let date: Date | null = null;
  if (value instanceof Date && Number.isFinite(value.getTime())) date = value;
  else if (typeof value === 'number' && Number.isFinite(value)) {
    const epochDays = date1904 ? value + 1462 : value;
    date = new Date(Math.round((epochDays - 25569) * 86_400_000));
  } else if (typeof value === 'string') {
    const normalized = value.trim();
    const iso = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(normalized);
    if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, time: `${pad(Number(iso[4] || 0))}:${iso[5] || '00'}` };
    const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(normalized);
    if (slash) return { date: `${slash[3]}-${pad(Number(slash[1]))}-${pad(Number(slash[2]))}`, time: `${pad(Number(slash[4] || 0))}:${slash[5] || '00'}` };
  }
  if (!date || !Number.isFinite(date.getTime())) return null;
  return { date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`, time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` };
}

function timeCell(primary: ExcelJS.Cell, secondary: ExcelJS.Cell, date1904: boolean): WallParts | null {
  return wallPartsFromCell(primary, date1904) || wallPartsFromCell(secondary, date1904);
}

function hasBusinessValue(worksheet: ExcelJS.Worksheet, rowNumber: number): boolean {
  for (let column = 1; column <= 31; column += 1) {
    const value = rawCellValue(worksheet.getCell(rowNumber, column));
    if (value !== null && value !== undefined && String(value).trim() !== '') return true;
  }
  return false;
}

function isInstructionFooterRow(worksheet: ExcelJS.Worksheet, rowNumber: number): boolean {
  if (textCell(worksheet.getCell(rowNumber, 1))) return false;
  const note = textCell(worksheet.getCell(rowNumber, 2));
  if (!note.startsWith('*')) return false;
  for (let column = 3; column <= 31; column += 1) {
    const value = rawCellValue(worksheet.getCell(rowNumber, column));
    if (value !== null && value !== undefined && String(value).trim() !== '') return false;
  }
  return true;
}

function timeZoneFromRaw(rawZone: unknown): string {
  if (typeof rawZone === 'number' && Number.isFinite(rawZone)) return formatUtcOffsetMinutes(Math.round(rawZone * 60));
  return typeof rawZone === 'string' ? rawZone.trim() : '';
}

function resolveSources(sourceRows: ImportedRowSource[], overrides: Record<string, string>): { rows: ItineraryRow[]; issues: ItineraryExcelIssue[]; needs: ParsedItinerarySheet['timeZoneNeeds'] } {
  const issues: ItineraryExcelIssue[] = [];
  const needs: ParsedItinerarySheet['timeZoneNeeds'] = [];
  const rows = sourceRows.map(source => {
    const row = structuredClone(source.row);
    issues.push(...source.sourceIssues.map(issue => ({ ...issue, rowNumber: source.excelRow })));
    const rawZone = source.rawTimeZone;
    const candidateZone = overrides[row.rowId] || timeZoneFromRaw(rawZone);
    const needsDefaultZone = TIME_FIELDS.some(field => Boolean(source.wallTimes[field]) && !timeZoneFromRaw(source.rawTimeZones[field]));
    if (candidateZone && isValidItineraryTimeZone(candidateZone)) row.portTimeZone = candidateZone;
    else if (needsDefaultZone) {
      row.portTimeZone = '';
      needs.push({ rowId: row.rowId, rowNumber: source.excelRow, portDockName: row.portDockName, legacyOffsetHours: typeof rawZone === 'number' ? rawZone : null });
      issues.push({ code: 'time-zone-required', rowNumber: source.excelRow, field: 'portTimeZone', message: `Excel 第 ${source.excelRow} 列時差無效，請為 ${row.portDockName || '該港口'} 選擇 UTC Offset。` });
    }

    for (const field of TIME_FIELDS) {
      const zoneField = ITINERARY_TIME_ZONE_FIELDS[field];
      const explicitZone = timeZoneFromRaw(source.rawTimeZones[field]);
      if (explicitZone) {
        if (isValidItineraryTimeZone(explicitZone)) row[zoneField] = explicitZone;
        else {
          row[zoneField] = '';
          issues.push({ code: 'time-zone-required', rowNumber: source.excelRow, field: zoneField, message: `Excel 第 ${source.excelRow} 列 ${field} UTC Offset 無效。` });
        }
      }
      const wall = source.wallTimes[field];
      if (!wall) continue;
      const resolvedZone = resolveItineraryTimeZone(row, field);
      if (!resolvedZone) continue;
      const converted = wallTimeToInstant(wall.date, wall.time, resolvedZone);
      if (converted.ok) row[field] = converted.instant;
      else issues.push({ code: 'invalid-time', rowNumber: source.excelRow, field, message: `Excel 第 ${source.excelRow} 列 ${field} 在 ${resolvedZone} 無效。` });
    }

    const startZone = timeZoneFromRaw(source.rawCalculationStartTimeZone);
    if (startZone) {
      if (isValidItineraryTimeZone(startZone)) row.calculationStartTimeZone = startZone;
      else issues.push({ code: 'time-zone-required', rowNumber: source.excelRow, field: 'calculationStartTimeZone', message: `Excel 第 ${source.excelRow} 列首列 ETA 起算 UTC Offset 無效。` });
    }
    if (source.calculationStartWall && row.calculationStartTimeZone) {
      const converted = wallTimeToInstant(source.calculationStartWall.date, source.calculationStartWall.time, row.calculationStartTimeZone);
      if (converted.ok) row.calculationStartUtc = converted.instant;
      else issues.push({ code: 'invalid-time', rowNumber: source.excelRow, field: 'calculationStartUtc', message: `Excel 第 ${source.excelRow} 列首列 ETA 起算時間無效。` });
    }
    return row;
  });
  const calculated = recalculateItineraryRows(rows);
  for (const issue of calculated.issues) issues.push({ code: 'calculation', rowNumber: sourceRows.find(source => source.row.rowId === issue.rowId)?.excelRow, field: issue.field, message: issue.message });
  return { rows: calculated.rows, issues, needs };
}

export function resolveParsedItinerarySheet(sheet: ParsedItinerarySheet, overrides: Record<string, string>): ParsedItinerarySheet {
  const resolved = resolveSources(sheet.sourceRows, overrides);
  return { ...sheet, rows: resolved.rows, issues: resolved.issues, timeZoneNeeds: resolved.needs };
}

export async function parseItineraryWorkbook(input: ArrayBuffer): Promise<ParsedItineraryWorkbook> {
  const workbook = await newWorkbook();
  await workbook.xlsx.load(input as unknown as ExcelJS.Buffer);
  const date1904 = Boolean(workbook.properties.date1904);
  const metaSheet = workbook.getWorksheet(META_SHEET);
  const metadata = new Map<string, { vesselId: string; vesselName: string; revision: number | null; schemaVersion: number | null; excelLayoutVersion: number }>();
  let schemaVersion: number | null = null;
  if (metaSheet) {
    for (let rowNumber = 2; rowNumber <= metaSheet.rowCount; rowNumber += 1) {
      const row = metaSheet.getRow(rowNumber);
      const name = String(row.getCell(1).value || '');
      const item = {
        vesselId: String(row.getCell(2).value || ''), vesselName: String(row.getCell(3).value || ''),
        schemaVersion: numberCell(row.getCell(4)), revision: numberCell(row.getCell(5)), excelLayoutVersion: numberCell(row.getCell(7)) || 1,
      };
      if (name) metadata.set(name, item);
      if (item.schemaVersion !== null) schemaVersion = item.schemaVersion;
    }
  }

  const sheets: ParsedItinerarySheet[] = [];
  for (const worksheet of workbook.worksheets) {
    if (worksheet.name === META_SHEET) continue;
    const meta = metadata.get(worksheet.name);
    const excelLayoutVersion = meta?.excelLayoutVersion === EXCEL_LAYOUT_VERSION || textCell(worksheet.getCell('S3')).includes('航道') ? EXCEL_LAYOUT_VERSION : 1;
    const sourceRows: ImportedRowSource[] = [];
    const templateIssue = textCell(worksheet.getCell('A3')) !== 'Voy No.' || !textCell(worksheet.getCell('B3')).includes('Port')
      ? [{ code: 'invalid-template' as const, message: `${worksheet.name} 不是可識別的 Itinerary A:W 模板。` }] : [];
    for (let primary = 4; primary <= Math.max(worksheet.rowCount, 4); primary += 2) {
      if (isInstructionFooterRow(worksheet, primary)) continue;
      if (!hasBusinessValue(worksheet, primary)) continue;
      const row = createBlankItineraryRow(createItineraryId('import-row'), sourceRows.length);
      const operation = operationCell(worksheet.getCell(primary, 3));
      const legacyDepartureDays = excelLayoutVersion === 1 ? numberCell(worksheet.getCell(primary, 23)) : null;
      Object.assign(row, {
        voyageNumber: textCell(worksheet.getCell(primary, 1)), portDockName: textCell(worksheet.getCell(primary, 2)), operation: operation.value,
        cargoQuantityText: textCell(worksheet.getCell(primary, 4)), ldRateText: textCell(worksheet.getCell(primary, 7)),
        arrivalDraftText: textCell(worksheet.getCell(primary, 10)), departureDraftText: textCell(worksheet.getCell(primary, 11)),
        arrivalRobText: textCell(worksheet.getCell(primary, 12)), departureRobText: textCell(worksheet.getCell(primary, 13)),
        oceanDistanceNm: numberCell(worksheet.getCell(primary, 15)), speedKnots: numberCell(worksheet.getCell(primary, 16)),
        berthWaitHours: numberCell(worksheet.getCell(primary, 18)),
        channelSailingHours: excelLayoutVersion === EXCEL_LAYOUT_VERSION ? numberCell(worksheet.getCell(primary, 19)) : null,
        tanksText: textCell(worksheet.getCell(primary, excelLayoutVersion === EXCEL_LAYOUT_VERSION ? 20 : 19)),
        operationQuantityMt: numberCell(worksheet.getCell(primary, excelLayoutVersion === EXCEL_LAYOUT_VERSION ? 21 : 20)),
        operationRateMtPerHour: numberCell(worksheet.getCell(primary, excelLayoutVersion === EXCEL_LAYOUT_VERSION ? 22 : 21)),
        preCompletionDelayHours: excelLayoutVersion === EXCEL_LAYOUT_VERSION ? numberCell(worksheet.getCell(primary, 24)) : null,
        postCompletionDelayHours: excelLayoutVersion === EXCEL_LAYOUT_VERSION ? numberCell(worksheet.getCell(primary, 25)) : (legacyDepartureDays === null ? null : legacyDepartureDays * 24),
        departureBufferDays: legacyDepartureDays,
        etaMode: isFormula(worksheet.getCell(primary, 5)) ? 'auto' : 'manual', etbMode: isFormula(worksheet.getCell(primary, 6)) ? 'auto' : 'manual',
        etcMode: isFormula(worksheet.getCell(primary, 8)) ? 'auto' : 'manual', etdMode: isFormula(worksheet.getCell(primary, 9)) ? 'auto' : 'manual',
      });
      sourceRows.push({
        row, excelRow: primary, rawTimeZone: rawCellValue(worksheet.getCell(primary, 14)),
        rawTimeZones: excelLayoutVersion === EXCEL_LAYOUT_VERSION ? {
          etaUtc: rawCellValue(worksheet.getCell(primary, 26)), etbUtc: rawCellValue(worksheet.getCell(primary, 27)),
          etcUtc: rawCellValue(worksheet.getCell(primary, 28)), etdUtc: rawCellValue(worksheet.getCell(primary, 29)),
        } : {},
        wallTimes: {
          etaUtc: timeCell(worksheet.getCell(primary, 5), worksheet.getCell(primary + 1, 5), date1904) || undefined,
          etbUtc: timeCell(worksheet.getCell(primary, 6), worksheet.getCell(primary + 1, 6), date1904) || undefined,
          etcUtc: timeCell(worksheet.getCell(primary, 8), worksheet.getCell(primary + 1, 8), date1904) || undefined,
          etdUtc: timeCell(worksheet.getCell(primary, 9), worksheet.getCell(primary + 1, 9), date1904) || undefined,
        },
        calculationStartWall: excelLayoutVersion === EXCEL_LAYOUT_VERSION ? wallPartsFromCell(worksheet.getCell(primary, 30), date1904) : null,
        rawCalculationStartTimeZone: excelLayoutVersion === EXCEL_LAYOUT_VERSION ? rawCellValue(worksheet.getCell(primary, 31)) : '',
        excelLayoutVersion,
        sourceIssues: operation.issue ? [operation.issue] : [],
      });
    }
    const resolved = resolveSources(sourceRows, {});
    sheets.push({
      sheetName: worksheet.name, embeddedVesselId: meta?.vesselId || null, embeddedVesselName: meta?.vesselName || null,
      embeddedRevision: meta?.revision ?? null, sourceRows, rows: resolved.rows,
      issues: [...templateIssue, ...resolved.issues], timeZoneNeeds: resolved.needs,
    });
  }
  return { schemaVersion, sheets };
}

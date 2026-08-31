import type ExcelJS from 'exceljs';
import { recalculateItineraryRows } from './itineraryDomain';
import { addHoursToInstant, isValidIanaTimeZone, wallTimeToInstant } from './itineraryTime';
import { createBlankItineraryRow, createItineraryId, ITINERARY_SCHEMA_VERSION, type ItineraryDocument, type ItineraryOperation, type ItineraryRow } from './itineraryTypes';

const META_SHEET = '_Itinerary_Meta';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MERGED_COLUMNS = [1, 2, 3, 4, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
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
  wallTimes: Partial<Record<TimeField, WallParts>>;
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
  for (let column = 1; column <= 23; column += 1) {
    const from = source.getColumn(column);
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
    for (let column = 1; column <= 23; column += 1) {
      const from = sourceRow.getCell(column);
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
  if (!instant || !isValidIanaTimeZone(timeZone)) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second || 0)));
  } catch {
    return null;
  }
}

function offsetHours(instant: string | null, timeZone: string): number | null {
  if (!instant || !isValidIanaTimeZone(timeZone)) return null;
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
  worksheet.getCell('X3').value = 'UTC Offset (h)';
  worksheet.getColumn(24).hidden = true;
  worksheet.getColumn(24).width = 14;

  document.rows.forEach((row, index) => {
    const primary = 4 + index * 2;
    const secondary = primary + 1;
    for (const column of MERGED_COLUMNS) worksheet.mergeCells(primary, column, secondary, column);

    worksheet.getCell(primary, 1).value = row.voyageNumber;
    worksheet.getCell(primary, 2).value = row.portDockName;
    worksheet.getCell(primary, 3).value = row.operation;
    worksheet.getCell(primary, 3).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Loading,Unloading"'] };
    worksheet.getCell(primary, 4).value = row.cargoQuantityText;
    worksheet.getCell(primary, 7).value = row.ldRateText;
    worksheet.getCell(primary, 10).value = row.arrivalDraftText;
    worksheet.getCell(primary, 11).value = row.departureDraftText;
    worksheet.getCell(primary, 12).value = row.arrivalRobText;
    worksheet.getCell(primary, 13).value = row.departureRobText;
    worksheet.getCell(primary, 14).value = row.portTimeZone;
    worksheet.getCell(primary, 15).value = row.oceanDistanceNm;
    worksheet.getCell(primary, 16).value = row.speedKnots;
    worksheet.getCell(primary, 17).value = row.oceanDistanceNm !== null && row.speedKnots !== null && row.speedKnots > 0
      ? formulaValue(`ROUNDUP(O${primary}/P${primary},0)`, Math.ceil(row.oceanDistanceNm / row.speedKnots)) : null;
    worksheet.getCell(primary, 18).value = row.berthWaitHours;
    worksheet.getCell(primary, 19).value = row.tanksText;
    worksheet.getCell(primary, 20).value = row.operationQuantityMt;
    worksheet.getCell(primary, 21).value = row.operationRateMtPerHour;
    worksheet.getCell(primary, 22).value = row.operationQuantityMt !== null && row.operationRateMtPerHour !== null && row.operationRateMtPerHour > 0
      ? formulaValue(`T${primary}/U${primary}`, row.operationQuantityMt / row.operationRateMtPerHour) : null;
    worksheet.getCell(primary, 23).value = row.departureBufferDays;
    worksheet.getCell(primary, 24).value = offsetHours(row.etaUtc || row.etdUtc, row.portTimeZone);

    const previousPrimary = primary - 2;
    const etaFormula = index > 0 ? `IF(D${primary}="","",I${previousPrimary}+ROUNDUP(O${previousPrimary}/P${previousPrimary},0)/24-X${previousPrimary}/24+X${primary}/24)` : null;
    const etbFormula = `IF(E${primary}="","",E${primary}+R${primary}/24)`;
    const etcFormula = `IF(F${primary}="","",F${primary}+V${primary}/24)`;
    const etdFormula = `IF(H${primary}="","",H${primary}+W${primary})`;
    setTimePair(worksheet, primary, 5, row.etaUtc, row.etaMode, etaFormula, row.portTimeZone);
    setTimePair(worksheet, primary, 6, row.etbUtc, row.etbMode, etbFormula, row.portTimeZone);
    setTimePair(worksheet, primary, 8, row.etcUtc, row.etcMode, etcFormula, row.portTimeZone);
    setTimePair(worksheet, primary, 9, row.etdUtc, row.etdMode, etdFormula, row.portTimeZone);
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
  meta.addRow(['sheetName', 'vesselId', 'vesselName', 'schemaVersion', 'revision', 'updatedAt']);
  for (const entry of metadata) meta.addRow([entry.sheetName, entry.document.vesselId, entry.document.vesselName, ITINERARY_SCHEMA_VERSION, entry.document.revision, entry.document.updatedAt]);
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
  const normalized = raw.toLocaleLowerCase().replace(/\s+/g, '');
  if (['loading', 'load', 'l'].includes(normalized)) return { value: 'Loading' };
  if (['unloading', 'unload', 'discharging', 'discharge', 'u'].includes(normalized)) return { value: 'Unloading' };
  return { value: '', issue: { code: 'invalid-operation', message: `無法識別 Loading / Unloading：${raw}`, field: 'operation' } };
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
  for (let column = 1; column <= 23; column += 1) {
    const value = rawCellValue(worksheet.getCell(rowNumber, column));
    if (value !== null && value !== undefined && String(value).trim() !== '') return true;
  }
  return false;
}

function isInstructionFooterRow(worksheet: ExcelJS.Worksheet, rowNumber: number): boolean {
  if (textCell(worksheet.getCell(rowNumber, 1))) return false;
  const note = textCell(worksheet.getCell(rowNumber, 2));
  if (!note.startsWith('*')) return false;
  for (let column = 3; column <= 23; column += 1) {
    const value = rawCellValue(worksheet.getCell(rowNumber, column));
    if (value !== null && value !== undefined && String(value).trim() !== '') return false;
  }
  return true;
}

function resolveSources(sourceRows: ImportedRowSource[], overrides: Record<string, string>): { rows: ItineraryRow[]; issues: ItineraryExcelIssue[]; needs: ParsedItinerarySheet['timeZoneNeeds'] } {
  const issues: ItineraryExcelIssue[] = [];
  const needs: ParsedItinerarySheet['timeZoneNeeds'] = [];
  const rows = sourceRows.map(source => {
    const row = structuredClone(source.row);
    issues.push(...source.sourceIssues.map(issue => ({ ...issue, rowNumber: source.excelRow })));
    const rawZone = source.rawTimeZone;
    const candidateZone = overrides[row.rowId] || (typeof rawZone === 'string' ? rawZone.trim() : '');
    const hasTimes = Object.keys(source.wallTimes).length > 0;
    if (candidateZone && isValidIanaTimeZone(candidateZone)) row.portTimeZone = candidateZone;
    else if (hasTimes) {
      row.portTimeZone = '';
      needs.push({ rowId: row.rowId, rowNumber: source.excelRow, portDockName: row.portDockName, legacyOffsetHours: typeof rawZone === 'number' ? rawZone : null });
      issues.push({ code: 'time-zone-required', rowNumber: source.excelRow, field: 'portTimeZone', message: `Excel 第 ${source.excelRow} 列只有空白／數字時差，請為 ${row.portDockName || '該港口'} 選擇 IANA 時區。` });
    }
    if (row.portTimeZone) {
      for (const field of TIME_FIELDS) {
        const wall = source.wallTimes[field];
        if (!wall) continue;
        const converted = wallTimeToInstant(wall.date, wall.time, row.portTimeZone);
        if (converted.ok) row[field] = converted.instant;
        else issues.push({ code: 'invalid-time', rowNumber: source.excelRow, field, message: `Excel 第 ${source.excelRow} 列 ${field} 在 ${row.portTimeZone} 不存在或有 DST 歧義。` });
      }
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
  const metadata = new Map<string, { vesselId: string; vesselName: string; revision: number | null; schemaVersion: number | null }>();
  let schemaVersion: number | null = null;
  if (metaSheet) {
    for (let rowNumber = 2; rowNumber <= metaSheet.rowCount; rowNumber += 1) {
      const row = metaSheet.getRow(rowNumber);
      const name = String(row.getCell(1).value || '');
      const item = {
        vesselId: String(row.getCell(2).value || ''), vesselName: String(row.getCell(3).value || ''),
        schemaVersion: numberCell(row.getCell(4)), revision: numberCell(row.getCell(5)),
      };
      if (name) metadata.set(name, item);
      if (item.schemaVersion !== null) schemaVersion = item.schemaVersion;
    }
  }

  const sheets: ParsedItinerarySheet[] = [];
  for (const worksheet of workbook.worksheets) {
    if (worksheet.name === META_SHEET) continue;
    const sourceRows: ImportedRowSource[] = [];
    const templateIssue = textCell(worksheet.getCell('A3')) !== 'Voy No.' || !textCell(worksheet.getCell('B3')).includes('Port')
      ? [{ code: 'invalid-template' as const, message: `${worksheet.name} 不是可識別的 Itinerary A:W 模板。` }] : [];
    for (let primary = 4; primary <= Math.max(worksheet.rowCount, 4); primary += 2) {
      if (isInstructionFooterRow(worksheet, primary)) continue;
      if (!hasBusinessValue(worksheet, primary)) continue;
      const row = createBlankItineraryRow(createItineraryId('import-row'), sourceRows.length);
      const operation = operationCell(worksheet.getCell(primary, 3));
      Object.assign(row, {
        voyageNumber: textCell(worksheet.getCell(primary, 1)), portDockName: textCell(worksheet.getCell(primary, 2)), operation: operation.value,
        cargoQuantityText: textCell(worksheet.getCell(primary, 4)), ldRateText: textCell(worksheet.getCell(primary, 7)),
        arrivalDraftText: textCell(worksheet.getCell(primary, 10)), departureDraftText: textCell(worksheet.getCell(primary, 11)),
        arrivalRobText: textCell(worksheet.getCell(primary, 12)), departureRobText: textCell(worksheet.getCell(primary, 13)),
        oceanDistanceNm: numberCell(worksheet.getCell(primary, 15)), speedKnots: numberCell(worksheet.getCell(primary, 16)),
        berthWaitHours: numberCell(worksheet.getCell(primary, 18)), tanksText: textCell(worksheet.getCell(primary, 19)),
        operationQuantityMt: numberCell(worksheet.getCell(primary, 20)), operationRateMtPerHour: numberCell(worksheet.getCell(primary, 21)),
        departureBufferDays: numberCell(worksheet.getCell(primary, 23)),
        etaMode: isFormula(worksheet.getCell(primary, 5)) ? 'auto' : 'manual', etbMode: isFormula(worksheet.getCell(primary, 6)) ? 'auto' : 'manual',
        etcMode: isFormula(worksheet.getCell(primary, 8)) ? 'auto' : 'manual', etdMode: isFormula(worksheet.getCell(primary, 9)) ? 'auto' : 'manual',
      });
      sourceRows.push({
        row, excelRow: primary, rawTimeZone: rawCellValue(worksheet.getCell(primary, 14)),
        wallTimes: {
          etaUtc: timeCell(worksheet.getCell(primary, 5), worksheet.getCell(primary + 1, 5), date1904) || undefined,
          etbUtc: timeCell(worksheet.getCell(primary, 6), worksheet.getCell(primary + 1, 6), date1904) || undefined,
          etcUtc: timeCell(worksheet.getCell(primary, 8), worksheet.getCell(primary + 1, 8), date1904) || undefined,
          etdUtc: timeCell(worksheet.getCell(primary, 9), worksheet.getCell(primary + 1, 9), date1904) || undefined,
        },
        sourceIssues: operation.issue ? [operation.issue] : [],
      });
    }
    const resolved = resolveSources(sourceRows, {});
    const meta = metadata.get(worksheet.name);
    sheets.push({
      sheetName: worksheet.name, embeddedVesselId: meta?.vesselId || null, embeddedVesselName: meta?.vesselName || null,
      embeddedRevision: meta?.revision ?? null, sourceRows, rows: resolved.rows,
      issues: [...templateIssue, ...resolved.issues], timeZoneNeeds: resolved.needs,
    });
  }
  return { schemaVersion, sheets };
}

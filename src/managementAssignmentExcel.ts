import type ExcelJS from 'exceljs';
import { assignmentCellText, assignmentColumnWidths, assignmentReportFileName, type ManagementAssignmentReport } from './managementAssignmentReport';
import { formatTaipeiDateTime } from './taipeiTime';

function styleSheet(sheet: ExcelJS.Worksheet, widths: number[], compactMatrix = false): void {
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  const border: Partial<ExcelJS.Borders> = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [side, { style: 'thin', color: { argb: 'FF808080' } }]));
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    let lines = 1;
    for (let column = 1; column <= widths.length; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.font = { name: compactMatrix ? 'Microsoft JhengHei' : 'Calibri', size: row === 1 ? 14 : compactMatrix ? 8.5 : 10, bold: row === 1 || row === 3 || row === 4, color: { argb: 'FF000000' } };
      cell.alignment = { vertical: 'middle', horizontal: row <= 4 ? 'center' : 'left', wrapText: !compactMatrix || row === 2, shrinkToFit: compactMatrix && row !== 2 };
      if (row >= 3) cell.border = border;
      if (row === 3 || row === 4) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF2' } };
      if (row >= 5 && !compactMatrix) {
        const count = cell.text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).reduce((n, char) => n + (/[^\x00-\x7f]/.test(char) ? 2 : 1), 0) / (widths[column - 1] - 2))), 0);
        lines = Math.max(lines, count);
      }
    }
    const metadataLines = row === 2 ? Math.max(2, Math.ceil(Array.from(sheet.getCell('A2').text).reduce((n, char) => n + (/[^\x00-\x7f]/.test(char) ? 2 : 1), 0) / (widths.reduce((sum, width) => sum + width, 0) - 4))) : 1;
    sheet.getRow(row).height = compactMatrix
      ? row === 1 ? 23 : row === 2 ? metadataLines * 12 : row <= 4 ? 15 : 13
      : row === 1 ? 28 : row === 2 ? metadataLines * 14 + 8 : row <= 4 ? 24 : lines * 14 + 6;
  }
  if (compactMatrix) {
    // Fit the physical content before Excel's printer scaling. Native PDF export
    // can otherwise enlarge its MediaBox inversely to the fitted print scale.
    const height = Array.from({ length: sheet.rowCount }, (_, index) => sheet.getRow(index + 1).height || 0).reduce((sum, value) => sum + value, 0);
    const scale = Math.min(1, 770 / Math.max(1, height));
    if (scale < 1) sheet.eachRow(row => {
      row.height = (row.height || 0) * scale;
      row.eachCell(cell => {
        if (!cell.isMerged || cell.master.address === cell.address) cell.font = { ...cell.font, size: (cell.font.size || 8.5) * scale };
      });
    });
  }
  delete sheet.properties.outlineProperties;
  sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  sheet.pageSetup = { orientation: compactMatrix ? 'portrait' : 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: compactMatrix ? 1 : 0, printTitlesRow: compactMatrix ? undefined : '1:4', printArea: `A1:${sheet.getColumn(widths.length).letter}${sheet.rowCount}`, ...(compactMatrix ? { margins: { left: 6 / 25.4, right: 6 / 25.4, top: 6 / 25.4, bottom: 6 / 25.4, header: 0, footer: 0 }, horizontalCentered: true } : {}) };
}

export async function buildManagementAssignmentWorkbook(report: ManagementAssignmentReport): Promise<ArrayBuffer> {
  const runtime = await import('exceljs');
  const workbook = new (runtime.Workbook || runtime.default.Workbook)();
  workbook.creator = 'Ship Dynamics';
  const summary = `匯出時間（台北）：${formatTaipeiDateTime(report.generatedAt)}｜全部啟用船舶 ${report.vessels.length} 艘\n僅列已啟用代理，不代表一對一職務代理關係`;
  const ships = workbook.addWorksheet('船舶分管');
  const columns = 4 + report.departments.length;
  ships.mergeCells(1, 1, 1, columns); ships.getCell('A1').value = '目前船舶分管表';
  ships.mergeCells(2, 1, 2, columns); ships.getCell('A2').value = summary;
  ships.mergeCells('A3:A4'); ships.getCell('A3').value = '船隊';
  ships.mergeCells('B3:B4'); ships.getCell('B3').value = '船型';
  ships.mergeCells('C3:D3'); ships.getCell('C3').value = '船名';
  if (columns > 5) ships.mergeCells(3, 5, 3, columns);
  ships.getCell('E3').value = '分管部門／人員';
  ['中文', '英文', ...report.departments].forEach((value, index) => { ships.getCell(4, index + 3).value = value; });
  for (const vessel of report.vessels) ships.addRow([vessel.fleet, vessel.shipType, vessel.chineseName || '—', vessel.englishName || '—', ...vessel.cells.map(cell => assignmentCellText(cell, ' '))]);
  if (!report.vessels.length) ships.getCell('A5').value = '目前無啟用船舶';
  styleSheet(ships, assignmentColumnWidths(report.departments).map(width => width * 0.84), true);

  const people = workbook.addWorksheet('人員分管');
  people.mergeCells('A1:D1'); people.getCell('A1').value = '目前人員分管明細';
  people.mergeCells('A2:D2'); people.getCell('A2').value = `匯出時間（台北）：${formatTaipeiDateTime(report.generatedAt)}｜啟用岸端人員 ${report.people.length} 人`;
  ['部門', '人員', '分管方式', '船舶（中文＋英文）'].forEach((label, index) => { people.mergeCells(3, index + 1, 4, index + 1); people.getCell(3, index + 1).value = label; });
  for (const person of report.people) {
    // One assignment per row keeps large portfolios readable and avoids Excel's row-height limit.
    for (const ship of person.directVessels) people.addRow([person.department, person.name, '直接經管', ship]);
    for (const ship of person.delegateVessels) people.addRow([person.department, person.name, '已啟用代理', ship]);
    if (!person.directVessels.length && !person.delegateVessels.length) people.addRow([person.department, person.name, '未指派', '—']);
  }
  if (!report.people.length) people.getCell('A5').value = '目前無啟用岸端人員';
  styleSheet(people, [22, 22, 18, 60]);
  const buffer = await workbook.xlsx.writeBuffer();
  return Uint8Array.from(new Uint8Array(buffer)).buffer;
}

export async function downloadManagementAssignmentWorkbook(report: ManagementAssignmentReport, isCurrent: () => boolean): Promise<boolean> {
  if (!isCurrent()) return false;
  const output = await buildManagementAssignmentWorkbook(report);
  if (!isCurrent()) return false;
  const url = URL.createObjectURL(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url; link.download = assignmentReportFileName(report, 'xlsx');
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

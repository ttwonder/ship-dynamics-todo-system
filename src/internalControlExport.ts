import type { InternalControlCase, Vessel } from './types';
import { vesselDisplayName } from './vesselDisplay';
import { richTextToPlainText } from './richText';

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const excelSafe = (value: unknown) => {
  const text = richTextToPlainText(String(value ?? '')).trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};

const downloadBlob = (content: string, mime: string, filename: string) => {
  const blob = new Blob(['\ufeff', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function buildInternalControlExcelHtml(cases: InternalControlCase[], vessels: Vessel[], title: string, filterSummary: string): string {
  const vesselMap = new Map(vessels.map(vessel => [vessel.id, vessel]));
  const rows = cases.map((item, index) => {
    const vessel = vesselMap.get(item.vesselId);
    const values = [
      index + 1,
      vessel ? vesselDisplayName(vessel) : item.vesselId,
      vessel?.shipType || '',
      item.reportDate,
      item.reportSource,
      item.priority,
      item.category,
      item.equipmentSubcategory || '',
      item.isAware ? '是' : '否',
      item.description,
      item.status,
      item.departments.join('、'),
      item.syncToTask ? '是' : '否',
      item.isClosed ? '已結案' : '未完',
      item.closedDate || '',
      item.updatedAt.slice(0, 16).replace('T', ' '),
    ];
    return `<tr>${values.map(value => `<td>${escapeHtml(excelSafe(value))}</td>`).join('')}</tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:"Microsoft JhengHei","Microsoft YaHei",sans-serif;color:#172033}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #b9c6d8;padding:7px 9px;vertical-align:top}
    .title{background:#173f63;color:#fff;font-size:20px;font-weight:700;text-align:left;padding:14px}
    .meta{background:#eaf2f8;color:#36536e;text-align:left}.header th{background:#2d6d8f;color:#fff;font-weight:700;white-space:nowrap}
    tr:nth-child(even) td{background:#f6f9fc}.urgent{color:#b42318}
  </style></head><body><table><thead><tr><th class="title" colspan="16">${escapeHtml(title)}</th></tr><tr><th class="meta" colspan="16">匯出條件：${escapeHtml(filterSummary)}｜共 ${cases.length} 件｜匯出時間 ${escapeHtml(new Date().toLocaleString('zh-TW'))}</th></tr><tr class="header">${['序號','船舶','船型','報告日期','報告來源','關注程度','分類','設備故障細項','知曉事項','事項內容','解決計劃／最新狀態','涉及部門','同步到要事','案件狀態','結案日期','最後更新'].map(item => `<th>${item}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export function downloadInternalControlExcel(cases: InternalControlCase[], vessels: Vessel[], filterSummary: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const html = buildInternalControlExcelHtml(cases, vessels, '內控異常清單', filterSummary);
  downloadBlob(html, 'application/vnd.ms-excel;charset=utf-8', `內控異常_${date}.xls`);
}

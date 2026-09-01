import { ITINERARY_MAIN_FIELD_LABELS } from './itineraryFieldLayout';
import { formatItineraryUtcOffset, instantToWallTime } from './itineraryTime';
import {
  formatItineraryOperation,
  resolveItineraryTimeZone,
  type ItineraryDocument,
  type ItineraryRow,
  type ItineraryTimeField,
} from './itineraryTypes';

export const ITINERARY_EMAIL_COPY_SUCCESS_MESSAGE = '已復製，請去郵箱客戶端粘貼';

const copyStartIndex = ITINERARY_MAIN_FIELD_LABELS.indexOf('Voy No.');
const copyEndIndex = ITINERARY_MAIN_FIELD_LABELS.indexOf('Dep ROB');

export const ITINERARY_EMAIL_COPY_FIELD_LABELS = ITINERARY_MAIN_FIELD_LABELS.slice(copyStartIndex, copyEndIndex + 1);

export interface ItineraryClipboardPayload {
  html: string;
  text: string;
}

interface ItineraryClipboardWriter {
  write?: (items: ClipboardItem[]) => Promise<void>;
  writeText?: (value: string) => Promise<void>;
}

type ClipboardItemParts = Record<string, Blob>;
type ClipboardItemFactory = (parts: ClipboardItemParts) => ClipboardItem;

export interface ItineraryClipboardOptions {
  clipboard?: ItineraryClipboardWriter | null;
  createClipboardItem?: ClipboardItemFactory | null;
}

export interface ItineraryCopyAndMailOptions extends ItineraryClipboardOptions {
  onCopied?: (message: string) => void;
  openMailClient?: (href: string) => void;
}

const dash = '—';

function displayText(value: string | null | undefined): string {
  return value?.trim() || dash;
}

function displayTime(row: ItineraryRow, field: ItineraryTimeField): string {
  const value = row[field];
  const zone = resolveItineraryTimeZone(row, field);
  const wall = value && zone ? instantToWallTime(value, zone) : null;
  const label = wall?.ok ? `${wall.date.slice(5)} ${wall.time}` : value ? '時區待確認' : dash;
  const offset = formatItineraryUtcOffset(zone, value);
  return offset ? `${label}\n${offset}` : label;
}

function rowUtcOffset(row: ItineraryRow): string {
  return formatItineraryUtcOffset(row.portTimeZone, row.etaUtc || row.etbUtc || row.etcUtc || row.etdUtc) || dash;
}

function projectEmailRow(row: ItineraryRow): string[] {
  return [
    displayText(row.voyageNumber),
    displayText(row.portDockName),
    rowUtcOffset(row),
    formatItineraryOperation(row.operation) || dash,
    displayText(row.cargoQuantityText),
    displayTime(row, 'etaUtc'),
    displayTime(row, 'etbUtc'),
    displayText(row.ldRateText),
    displayTime(row, 'etcUtc'),
    displayTime(row, 'etdUtc'),
    displayText(row.arrivalDraftText),
    displayText(row.departureDraftText),
    displayText(row.arrivalRobText),
    displayText(row.departureRobText),
  ];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlCell(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>');
}

function plainCell(value: string): string {
  return value.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' / ').replace(/\t/g, ' ').trim() || dash;
}

export function buildItineraryClipboardPayload(document: ItineraryDocument): ItineraryClipboardPayload {
  const rows = document.rows.map(projectEmailRow);
  const tableStyle = 'border-collapse:collapse;border:1px solid #7f8c8d;font-family:Arial,\"Microsoft JhengHei\",sans-serif;font-size:11pt;color:#172033;mso-table-lspace:0pt;mso-table-rspace:0pt;';
  const headingStyle = 'border:1px solid #7f8c8d;background:#e8eef5;color:#172033;padding:5px 7px;text-align:left;vertical-align:top;font-weight:700;white-space:nowrap;';
  const cellStyle = 'border:1px solid #7f8c8d;background:#ffffff;color:#172033;padding:5px 7px;text-align:left;vertical-align:top;mso-number-format:\"\\@\";';
  const headings = ITINERARY_EMAIL_COPY_FIELD_LABELS.map(label => `<th style="${headingStyle}">${htmlCell(label)}</th>`).join('');
  const body = rows.map(row => `<tr>${row.map(value => `<td style="${cellStyle}">${htmlCell(value)}</td>`).join('')}</tr>`).join('');
  const html = `<table border="1" cellpadding="0" cellspacing="0" style="${tableStyle}"><thead><tr>${headings}</tr></thead><tbody>${body}</tbody></table>`;
  const text = [ITINERARY_EMAIL_COPY_FIELD_LABELS, ...rows]
    .map(row => row.map(value => plainCell(value)).join('\t'))
    .join('\r\n');
  return { html, text };
}

function defaultClipboard(): ItineraryClipboardWriter | null {
  return typeof navigator !== 'undefined' ? navigator.clipboard : null;
}

function defaultClipboardItemFactory(): ClipboardItemFactory | null {
  return typeof ClipboardItem === 'function' ? parts => new ClipboardItem(parts) : null;
}

export async function copyItineraryTableToClipboard(
  document: ItineraryDocument,
  options: ItineraryClipboardOptions = {},
): Promise<'rich' | 'plain'> {
  const payload = buildItineraryClipboardPayload(document);
  const clipboard = options.clipboard === undefined ? defaultClipboard() : options.clipboard;
  const createClipboardItem = options.createClipboardItem === undefined
    ? defaultClipboardItemFactory()
    : options.createClipboardItem;

  if (clipboard?.write && createClipboardItem) {
    try {
      const item = createClipboardItem({
        'text/html': new Blob([payload.html], { type: 'text/html' }),
        'text/plain': new Blob([payload.text], { type: 'text/plain' }),
      });
      await clipboard.write([item]);
      return 'rich';
    } catch {
      // Some browsers expose ClipboardItem but reject rich MIME writes; continue with text.
    }
  }

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(payload.text);
      return 'plain';
    } catch {
      // Normalize permission and browser failures into one actionable UI error below.
    }
  }

  throw new Error('無法複製 Itinerary 表格，請確認瀏覽器已允許剪貼簿權限。');
}

export interface ItineraryMailtoInput {
  vesselName: string;
  fileName: string;
  revision: number;
}

export function buildItineraryMailto({ vesselName, fileName, revision }: ItineraryMailtoInput): string {
  const subject = `${vesselName} Itinerary - Revision ${revision}`;
  const body = [
    `Dear all,`,
    '',
    `Please find the latest ${vesselName} Itinerary (Revision ${revision}).`,
    '',
    `Excel file downloaded by the system: ${fileName}`,
    `Please attach this downloaded file before sending.`,
    '',
    `Best regards,`,
  ].join('\r\n');
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function buildItineraryPasteMailto(vesselName: string): string {
  return `mailto:?subject=${encodeURIComponent(`${vesselName} Itinerary`)}`;
}

export function requestItineraryMailClient(href: string): void {
  if (typeof document === 'undefined') throw new Error('目前環境無法開啟郵件客戶端。');
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.style.display = 'none';
  anchor.setAttribute('aria-hidden', 'true');
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

export async function copyItineraryAndOpenMail(
  document: ItineraryDocument,
  options: ItineraryCopyAndMailOptions = {},
): Promise<'rich' | 'plain'> {
  const mode = await copyItineraryTableToClipboard(document, options);
  options.onCopied?.(ITINERARY_EMAIL_COPY_SUCCESS_MESSAGE);
  (options.openMailClient || requestItineraryMailClient)(buildItineraryPasteMailto(document.vesselName));
  return mode;
}

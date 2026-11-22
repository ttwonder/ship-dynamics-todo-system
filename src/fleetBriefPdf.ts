import { PDFDocument, PageSizes, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { FleetBriefReport } from './fleetBriefTypes';

const title = '船隊重點摘要';
let fontBytes: Promise<ArrayBuffer> | undefined;
function loadFont() {
  // Only a fixed first-party asset is read. Never put report data in a URL.
  return fontBytes ??= fetch(`${import.meta.env.BASE_URL}fleet-brief-pdf/NotoSansTC-Regular.ttf.gz`, {
    mode: 'same-origin', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
  }).then(async response => {
    if (!response.ok) throw new Error('無法讀取摘要字型，請重試。');
    const asset = await response.blob();
    const [a, b, c, d] = new Uint8Array(await asset.slice(0, 4).arrayBuffer());
    // A static host may serve the .gz as a file or as Content-Encoding: gzip
    // (in which case fetch has already decoded the TrueType body).
    if (a === 0 && b === 1 && c === 0 && d === 0) return asset.arrayBuffer();
    if (a !== 0x1f || b !== 0x8b) throw new Error('摘要字型檔格式錯誤。');
    return new Response(asset.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }).catch(error => { fontBytes = undefined; throw error; });
}

type Section = FleetBriefReport['sections'][number];
const [height, width] = PageSizes.A4;
const margin = 24, available = width - 2 * margin;
const bodyTop = 58, bodyEnd = height - 40;
const size = 14, leading = 21, padX = 5, padY = 3;
const ink = rgb(0.09, 0.16, 0.22), navy = rgb(0.11, 0.25, 0.35);
const border = rgb(0.65, 0.72, 0.76), pale = rgb(0.95, 0.97, 0.98);
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const tallest = (cells: string[][]) => cells.reduce((n, cell) => Math.max(n, cell.length), 1);
const rowHeight = (lines: number) => 2 * padY + leading * lines;

function typesetter(font: PDFFont) {
  // Cache only bounded strings in this generation, never the report between calls.
  const cache = new Map<string, number>();
  const measure = (s: string, pt = size) => {
    let width = cache.get(s);
    if (width === undefined) {
      width = font.widthOfTextAtSize(s, 1);
      if (s.length <= 256) {
        if (cache.size >= 4096) cache.clear();
        cache.set(s, width);
      }
    }
    return width * pt;
  };
  const supported = new Set(font.getCharacterSet());
  function wrap(text: string, room: number, pt = size) {
    const lines: string[] = [];
    for (const paragraph of text.replace(/\t/g, '    ').split(/\r\n|[\n\r\u2028\u2029]/u)) {
      const chars = Array.from(paragraph);
      for (const ch of chars) {
        const cp = ch.codePointAt(0)!;
        if (!supported.has(cp)) throw new Error(`摘要字型不支援 U+${cp.toString(16).toUpperCase()}，無法完整產生 PDF。`);
      }
      if (!chars.length) lines.push('');
      for (let start = 0; start < chars.length;) {
        // Find the largest fitting prefix without ever measuring the entire tail
        // of an unbounded paragraph. Widths use the very same font as PDF text.
        const left = chars.length - start;
        const fits = (n: number) => measure(chars.slice(start, start + n).join(''), pt) <= room;
        let lo = 0, hi = Math.min(16, left);
        while (fits(hi)) {
          lo = hi;
          if (hi === left) break;
          hi = Math.min(hi * 2, left);
        }
        while (hi - lo > 1) {
          const mid = Math.floor((hi + lo) / 2);
          if (fits(mid)) lo = mid; else hi = mid;
        }
        if (!lo) throw new Error('摘要欄位過窄，無法容納文字。');
        // Prefer a word boundary; a long unbroken ID or CJK run still flows.
        if (lo < left && /[\w]/.test(chars[start + lo]) && /[\w]/.test(chars[start + lo - 1])) {
          for (let j = lo - 1; j >= Math.ceil(lo / 2); j--) {
            if (/\s/.test(chars[start + j - 1])) { lo = j; break; }
          }
        }
        lines.push(chars.slice(start, start + lo).join(''));
        start += lo;
      }
    }
    return lines;
  }
  return { measure, wrap };
}

type Measure = ReturnType<typeof typesetter>['measure'];
function columnWidths({ columns, rows }: Section, measure: Measure): number[] {
  // Use real header/value widths for metadata. Cap only the *width estimate*,
  // never the rendered value. Officer pairs need more room than a grade or ETA.
  const narrative = columns.map(c => (c.kind === 'note' || c.kind === 'content') && !/船長|大副|輪機長|大管輪/.test(c.label));
  const count = narrative.filter(Boolean).length;
  const floor = 2 * padX + size + 1;
  if (floor * columns.length > available) throw new Error('摘要欄數超過橫向頁面寬度。');
  const demand = columns.map((c, i) => {
    if (narrative[i]) return 0;
    const officer = /船長|大副|輪機長|大管輪/.test(c.label);
    const cap = officer ? 155 : c.kind === 'level' ? 70 : c.kind === 'risk' ? 130 : 160;
    let best = officer ? 83 : floor;
    const sample = (v: string) => {
      for (const line of v.slice(0, 128).split(/[\r\n]/)) best = Math.max(best, Math.min(cap, measure(line) + 2 * padX + 2));
    };
    sample(c.label);
    for (const row of rows) { if (best >= cap) break; sample(row[i] ?? ''); }
    return best;
  });
  const meta = columns.length - count;
  if (!meta) return columns.map(() => available / columns.length);
  const total = sum(demand);
  if (!count) return demand.map(w => floor + (available - meta * floor) * w / total);
  // Reserve at least 36% for one narrative even in the original eight-column
  // layout; short metadata releases all unused space to the narrative column(s).
  const reserved = Math.max(available * 0.36, Math.max(...demand) * count, floor * count);
  const metaBudget = Math.max(floor * meta, Math.min(total, available - reserved));
  const scale = total > meta * floor ? (metaBudget - meta * floor) / (total - meta * floor) : 1;
  return demand.map((w, i) => narrative[i] ? (available - metaBudget) / count : floor + (w - floor) * scale);
}

/** Serialize the supplied snapshot in memory; preview/download belongs to the caller. */
export async function buildFleetBriefPdf(report: FleetBriefReport): Promise<Blob> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setLanguage('zh-Hant');
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFont(), { subset: true });
  const { wrap, measure } = typesetter(font);
  const dateLines = wrap(report.date, available / 2);
  let page: PDFPage, y: number;
  const draw = (s: string, x: number, baseline: number, pt = size, color = ink) => {
    if (s) page.drawText(s, { x, y: height - baseline, font, size: pt, color });
  };
  function newPage() {
    page = doc.addPage([width, height]); y = bodyTop;
    draw(title, margin, 39, 22, navy);
    if (dateLines.length === 1) draw(report.date, width - margin - measure(report.date), 38);
    page.drawLine({start:{x:margin, y:height-48}, end:{x:width-margin, y:height-48}, color:navy, thickness:1});
    const folio = `第 ${doc.getPageCount()} 頁`;
    draw(folio, width - margin - measure(folio), height - 17, size, navy);
  }
  newPage();
  for (const text of [dateLines.length > 1 ? report.date : '', report.notice].filter(Boolean)) {
    for (const line of wrap(text, available)) {
      if (y + leading > bodyEnd) newPage();
      draw(line, margin, y + 16); y += leading;
    }
    y += 6;
  }
  function band(widths: number[], cells: string[][], start: number, n: number, header: boolean, stripe = false) {
    let x = margin;
    widths.forEach((w, i) => {
      page.drawRectangle({x, y:height-y-rowHeight(n), width:w, height:rowHeight(n), borderWidth:0.55,
        borderColor:border, color:header ? navy : stripe ? pale : rgb(1, 1, 1)});
      for (let k = 0; k < n; k++) draw(cells[i][start+k], x+padX, y+padY+16+k*leading, size, header ? rgb(1,1,1) : ink);
      x += w;
    });
    y += rowHeight(n);
  }
  for (const section of report.sections) {
    const widths = columnWidths(section, measure);
    const headings = section.columns.map((c, i) => wrap(c.label, widths[i] - 2 * padX));
    function heading(continued: boolean, firstLines = 1) {
      const lines = wrap(section.title + (continued ? '（續）' : ''), available, 16);
      const headerHeight = lines.length * 24 + (widths.length ? rowHeight(tallest(headings)) : 0);
      const fitsFresh = headerHeight + rowHeight(firstLines) <= bodyEnd-bodyTop;
      const needed = headerHeight + rowHeight(fitsFresh ? firstLines : 1);
      if (needed > bodyEnd-bodyTop) throw new Error('摘要表頭超出一頁，無法完整排列。');
      if (y + needed > bodyEnd) newPage();
      for (const line of lines) { draw(line, margin, y+18, 16, navy); y += 24; }
      if (widths.length) band(widths, headings, 0, tallest(headings), true);
    }
    for (const [index, row] of section.rows.entries()) {
      if (row.length > widths.length) throw new Error('摘要資料欄數與表頭不符。');
      const cells = widths.map((w, i) => wrap(row[i] ?? '', w - 2 * padX));
      const total = tallest(cells);
      if (index === 0) heading(false,total);
      else if (y + rowHeight(total) > bodyEnd && rowHeight(total)+rowHeight(tallest(headings))+24 <= bodyEnd-bodyTop) {
        newPage(); heading(true);
      }
      for (let offset = 0; offset < total;) {
        let capacity = Math.floor((bodyEnd - y - 2 * padY) / leading);
        if (capacity < 1) { newPage(); heading(true); capacity = Math.floor((bodyEnd - y - 2 * padY) / leading); }
        const n = Math.min(capacity, total - offset);
        band(widths, cells, offset, n, false, index % 2 === 1); offset += n;
      }
    }
    if (!section.rows.length) { heading(false); band([available], [['無符合項目']], 0, 1, false); }
    y += 10;
  }
  return new Blob([new Uint8Array(await doc.save())], { type: 'application/pdf' });
}

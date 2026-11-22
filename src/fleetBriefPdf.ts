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
const hex = (n:number) => rgb((n>>>16)/255, ((n>>>8)&255)/255, (n&255)/255);
const ink = hex(0x233844), navy = hex(0x174957), muted = hex(0x536b75);
const border = hex(0xbbcdd1), pale = hex(0xf7fafb), white = rgb(1,1,1);
const pair = (foreground:number, background:number) => ({ink:hex(foreground),fill:hex(background)});
const themes = {
  gulf:pair(0x086d70,0xdbf3f0), australia:pair(0x3e6b47,0xe4f1df), china:pair(0x315f92,0xe1edfb),
  dock:pair(0x64528c,0xede7f7), control:pair(0x785373,0xf5e8f2), task:pair(0x31667c,0xe1f2f7), hrs:pair(0x904a50,0xfae9e7),
} satisfies Record<NonNullable<Section['theme']>,ReturnType<typeof pair>>;
const lights = {
  HRS:pair(0x983632,0xd94941), SRS:pair(0x775515,0xe8b238), LRS:pair(0x256744,0x36a16a),
  unknown:pair(0x55616b,0x929aa3), urgent:pair(0x821f39,0xa82441),
};
type Light = (typeof lights)[keyof typeof lights];
const dotInset = 14;
function cellLight(section:Section, i:number, text:string):Light|undefined {
  const kind=section.columns[i].kind;
  if ((section.theme==='control'||section.theme==='task') && kind==='level')
    return text==='急'?lights.urgent:text==='高'?lights.HRS:text==='中'?lights.SRS:undefined;
  // Only the structured risk cell or system-generated first line of primary
  // remarks is eligible. A mention of HRS in an operator's note is not a grade.
  const primary=section.theme==='gulf'||section.theme==='australia'||section.theme==='china'||section.theme==='dock';
  const grade=kind==='risk' ? text : primary && kind==='note' && text.startsWith('Tokyo MOU：') ? text.slice('Tokyo MOU：'.length) : '';
  const value=grade.split(/[｜\n]/,1)[0];
  return value==='HRS'||value==='SRS'||value==='LRS'?lights[value]:value==='未知（未取得）'?lights.unknown:undefined;
}
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
  function wrap(text: string, room: number, pt = size, firstInset = 0) {
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
        const lineRoom=room-(lines.length===0?firstInset:0);
        const fits = (n: number) => measure(chars.slice(start, start + n).join(''), pt) <= lineRoom;
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
    // A small three-stroke wake replaces the heavy navy masthead rule.
    for(const [i,w] of [21,15,9].entries()) page.drawRectangle({x:margin+i*3,y:height-25-i*5,width:w,height:2.5,color:i===0?themes.gulf.ink:hex(0x78b9b3)});
    draw(title, margin+30, 39, 22, navy);
    if (dateLines.length === 1) {
      const w=measure(report.date);
      page.drawRectangle({x:width-margin-w-16,y:height-44,width:w+16,height:24,color:hex(0xeaf5f4)});
      draw(report.date,width-margin-w-8,37,size,navy);
    }
    page.drawLine({start:{x:margin,y:height-49},end:{x:width-margin,y:height-49},color:border,thickness:.65});
    const folio = `第 ${doc.getPageCount()} 頁`;
    draw(folio, width - margin - measure(folio), height - 17, size, muted);
  }
  newPage();
  for (const text of [dateLines.length > 1 ? report.date : '', report.notice].filter(Boolean)) {
    for (const line of wrap(text, available)) {
      if (y + leading > bodyEnd) newPage();
      draw(line, margin, y + 16,size,muted); y += leading;
    }
    y += 6;
  }
  function band(theme:ReturnType<typeof pair>, widths: number[], cells: string[][], start: number, n: number, header: boolean, stripe = false, markers:(Light|undefined)[] = []) {
    let x = margin;
    widths.forEach((w, i) => {
      page.drawRectangle({x, y:height-y-rowHeight(n), width:w, height:rowHeight(n), borderWidth:.5,
        borderColor:border, color:header ? theme.fill : stripe ? pale : white});
      for (let k = 0; k < n; k++) {
        const baseline=y+padY+16+k*leading, marker=start+k===0?markers[i]:undefined;
        if(marker){
          const center={x:x+padX+5,y:height-baseline+5};
          page.drawCircle({...center,size:marker===lights.urgent?3:4.2,color:marker.fill});
          if(marker===lights.urgent)page.drawCircle({...center,size:5.2,borderColor:marker.ink,borderWidth:1});
        }
        draw(cells[i][start+k], x+padX+(marker?dotInset:0),baseline,size,marker?.ink??(header?theme.ink:ink));
      }
      x += w;
    });
    y += rowHeight(n);
  }
  for (const section of report.sections) {
    const theme=themes[section.theme??'gulf'];
    const widths = columnWidths(section, measure);
    const headings = section.columns.map((c, i) => wrap(c.label, widths[i] - 2 * padX));
    function heading(continued: boolean, firstLines = 1) {
      const lines = wrap(section.title + (continued ? '（續）' : ''), available-12, 16);
      const headerHeight = lines.length * 24 + (widths.length ? rowHeight(tallest(headings)) : 0);
      const fitsFresh = headerHeight + rowHeight(firstLines) <= bodyEnd-bodyTop;
      const needed = headerHeight + rowHeight(fitsFresh ? firstLines : 1);
      if (needed > bodyEnd-bodyTop) throw new Error('摘要表頭超出一頁，無法完整排列。');
      if (y + needed > bodyEnd) newPage();
      page.drawRectangle({x:margin,y:height-y-19,width:4,height:15,color:theme.ink});
      for (const line of lines) { draw(line, margin+11, y+18, 16, theme.ink); y += 24; }
      if (widths.length) band(theme,widths, headings, 0, tallest(headings), true);
    }
    for (const [index, row] of section.rows.entries()) {
      if (row.length > widths.length) throw new Error('摘要資料欄數與表頭不符。');
      const markers=widths.map((_,i)=>cellLight(section,i,row[i]??''));
      const cells = widths.map((w, i) => wrap(row[i] ?? '', w - 2 * padX,size,markers[i]?dotInset:0));
      const total = tallest(cells);
      if (index === 0) heading(false,total);
      else if (y + rowHeight(total) > bodyEnd && rowHeight(total)+rowHeight(tallest(headings))+24 <= bodyEnd-bodyTop) {
        newPage(); heading(true);
      }
      for (let offset = 0; offset < total;) {
        let capacity = Math.floor((bodyEnd - y - 2 * padY) / leading);
        if (capacity < 1) { newPage(); heading(true); capacity = Math.floor((bodyEnd - y - 2 * padY) / leading); }
        const n = Math.min(capacity, total - offset);
        band(theme,widths, cells, offset, n, false, index % 2 === 1,markers); offset += n;
      }
    }
    if (!section.rows.length) { heading(false); band(theme,[available], [['無符合項目']], 0, 1, false); }
    y += 10;
  }
  return new Blob([new Uint8Array(await doc.save())], { type: 'application/pdf' });
}

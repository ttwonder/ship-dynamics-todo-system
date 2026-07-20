const BLOCK_END = /<\/(p|div|li|h[1-6]|blockquote)>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const TAG = /<[^>]*>/g;

const decodeCodePoint = (code: string, radix: number) => {
  const value = Number.parseInt(code, radix);
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
    ? String.fromCodePoint(value)
    : '\ufffd';
};

const decodeEntities = (value: string) => value
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(code, 10))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeCodePoint(code, 16));

export function richTextToPlainText(value = ''): string {
  return decodeEntities(value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(LINE_BREAK, '\n')
    .replace(BLOCK_END, '\n')
    .replace(TAG, ''))
    .replace(/\r/g, '')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function isRichTextEmpty(value = ''): boolean {
  return !richTextToPlainText(value);
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const safeColor = (value: string) => {
  const color = value.trim().toLowerCase();
  return /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/.test(color) ? color : '';
};

const safeFontSize = (value: string) => {
  const size = value.trim().toLowerCase();
  return /^(12|14|16|18|22|28)px$/.test(size) ? size : '';
};

const legacyFontSize: Record<string, string> = { '1':'12px', '2':'14px', '3':'16px', '4':'18px', '5':'22px', '6':'28px', '7':'28px' };
const allowedTags = new Set(['strong','b','em','i','u','ol','ul','li','p','div','br','span','font']);
const blockedTags = new Set(['script','style','iframe','object','embed','svg','math','img','video','audio','form','input','button','select','textarea','link','meta']);

export function sanitizeRichTextHtml(value = ''): string {
  if (!value) return '';
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    return escapeHtml(richTextToPlainText(value)).replace(/\n/g, '<br>');
  }
  const parsed = new DOMParser().parseFromString(`<div>${value}</div>`, 'text/html');
  const output = document.createElement('div');
  const cleanNode = (node: Node): Node | null => {
    if (node.nodeType === 3) return document.createTextNode(node.textContent || '');
    if (node.nodeType !== 1) return null;
    const source = node as HTMLElement;
    const tag = source.tagName.toLowerCase();
    if (blockedTags.has(tag)) return null;
    const fragment = document.createDocumentFragment();
    Array.from(source.childNodes).forEach(child => {
      const cleaned = cleanNode(child);
      if (cleaned) fragment.appendChild(cleaned);
    });
    if (!allowedTags.has(tag)) return fragment;
    const normalizedTag = tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag === 'font' ? 'span' : tag;
    const target = document.createElement(normalizedTag);
    if (tag === 'span' || tag === 'font') {
      const color = safeColor(source.getAttribute('color') || source.style.color || '');
      const fontSize = safeFontSize(source.style.fontSize || '') || legacyFontSize[source.getAttribute('size') || ''] || '';
      if (color) target.style.color = color;
      if (fontSize) target.style.fontSize = fontSize;
    }
    target.appendChild(fragment);
    return target;
  };
  Array.from(parsed.body.firstElementChild?.childNodes || []).forEach(node => {
    const cleaned = cleanNode(node);
    if (cleaned) output.appendChild(cleaned);
  });
  return output.innerHTML;
}

import assert from 'node:assert/strict';
import fs from 'node:fs';

const meetings = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.ok(styles.includes('@page meeting-detail{size:A4 portrait'), '單場臨會／專題 PDF 必須維持 A4 直向');
for (const label of ['召開日期', '預計完成', '關注程度', '會議範圍', '涉會船舶', '涉及部門', '與會人員', '追蹤窗口', '負責人']) {
  assert.ok(meetings.includes(`>${label}<`), `單場會議 PDF 不得刪除基本資訊「${label}」`);
}
for (const heading of ['召開緣由', '決議／會議結論', '待辦事項']) {
  assert.ok(meetings.includes(`<h2>${heading}</h2>`), `單場會議 PDF 必須保留核心區塊「${heading}」`);
}

const compactPrintStart = styles.indexOf('/* Second-batch compact meeting detail PDF */');
assert.ok(compactPrintStart >= 0, '必須有單場會議 PDF 的限定壓縮樣式');
const compactPrint = styles.slice(compactPrintStart);
assert.match(compactPrint, /\.meeting-print-meta\{[^}]*gap:0[^}]*margin:0 0 2mm[^}]*border:1px solid/, '日期等摘要資料必須改成無卡片間隙的密集網格');
assert.match(compactPrint, /\.meeting-print-meta>div\{[^}]*padding:1\.5mm 2mm[^}]*border-radius:0/, '摘要資料不得再使用高 padding 的大型獨立卡片');
assert.match(compactPrint, /\.meeting-print-grid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[^}]*gap:0/, '船舶、部門及人員資料必須壓成三欄密集網格');
assert.match(compactPrint, /\.meeting-print-grid \.meeting-print-section\.card-like\{[^}]*padding:1\.8mm 2\.2mm[^}]*box-shadow:none/, '基本資訊格必須移除大型卡片陰影並縮減內距');
assert.match(compactPrint, /\.meeting-print-page>\.meeting-print-section\.card-like\.wide\{[^}]*break-inside:auto/, '召開緣由、決議及待辦長內容必須能自然跨頁，避免整區被推到下一頁');
assert.match(compactPrint, /\.meeting-print-page>\.meeting-print-section\.card-like\{[^}]*margin:0 0 2mm[^}]*padding:2mm 2\.5mm/, '核心區塊必須縮減間距與內距');
// Only the meeting-detail namespace owns this font contract. Other report
// types deliberately have different typography; still inspect later overrides.
const meetingRules=[...styles.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([,selectors])=>selectors.split(',').some(selector=>selector.trim()==='body.printing-meeting-detail'||selector.trim().startsWith('body.printing-meeting-detail ')));
assert.ok(meetingRules.length>0,'會議列印字級檢查不可在缺少目標樣式時默默通過');
let checkedFonts=0;
for(const [,selectors,declarations] of meetingRules)for(const [,value] of declarations.matchAll(/(?:^|;)\s*font-size\s*:\s*([^;}!]+)/g)){
  const size=value.trim().match(/^(\d+(?:\.\d+)?)(pt|px)$/);
  assert.ok(size,`會議 PDF 字級單位必須可明確核對：${selectors.trim()}`);
  const points=Number(size[1])*(size[2]==='px'?0.75:1);checkedFonts++;
  assert.ok(points>=8,'PDF 壓縮不得以低於 8pt 的極端小字換頁數');
}
assert.ok(checkedFonts>0,'會議列印字級檢查必須實際核對字級');

console.log('Compact A4 portrait meeting-detail PDF contracts passed.');

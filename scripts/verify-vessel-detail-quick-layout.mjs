import assert from 'node:assert/strict';
import fs from 'node:fs';

const detail = fs.readFileSync('src/VesselDetailPage.tsx', 'utf8');
const modal = fs.readFileSync('src/EditModals.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');
const lastRule = selector => [...styles.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`, 'g'))].at(-1)?.[1] || '';
const secondBatchDetailStart = styles.indexOf('/* Second-batch single-vessel detail and quick-update layout */');
const desktopDetailStyles = styles.slice(secondBatchDetailStart, styles.indexOf('@media(max-width:1180px)', secondBatchDetailStart));

for (const [label, field] of [
  ['船長', 'captain'],
  ['大副', 'chiefOfficer'],
  ['輪機長', 'chiefEngineer'],
  ['大管輪', 'firstEngineer'],
]) {
  assert.ok(detail.includes(`<dt>${label}</dt><dd>{officerValue(vessel.note.${field})}</dd>`), `單船基本資料必須直接顯示 ${label} 的 VesselNote 欄位`);
}
assert.ok(detail.includes("const officerValue = (text?: string) => text?.trim() || '-';"), '四位姓名未填時必須顯示半形 -');
assert.ok(detail.includes('<div className="vessel-detail-column vessel-detail-primary-column">'), '基本資料與貨載資訊必須放在同一個獨立直欄中緊貼排列');
assert.ok(detail.includes('<div className="vessel-detail-secondary-column">'), '航行、時間及動態區必須放在獨立右側欄中，不能受左側高卡片列高拖動');
assert.ok(detail.includes('<div className="vessel-detail-secondary-top">'), '航行與時間卡必須保留桌面同列的兩欄外觀');
assert.ok(detail.indexOf('<h2>貨載資訊</h2>') < detail.indexOf('<div className="vessel-detail-secondary-column">'), '貨載資訊必須緊接在左側基本資料後，而不是等待共用 Grid row');
assert.match(desktopDetailStyles, /\.vessel-detail-grid\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,2fr\)/, '桌面版必須以一欄加右側兩欄維持三欄比例');
assert.match(desktopDetailStyles, /\.vessel-detail-primary-column,\.vessel-detail-secondary-column\{[^}]*display:flex[^}]*flex-direction:column[^}]*gap:9px/, '左右容器必須各自垂直緊貼排列，不共用卡片列高');
assert.match(desktopDetailStyles, /\.vessel-detail-secondary-top\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)/, '右側頂部必須保留航行與時間兩欄');
assert.match(styles, /@media\(max-width:1180px\)\{[^}]*\.vessel-detail-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, '中等螢幕單船詳情必須自然降為兩欄');
assert.ok(styles.includes('.vessel-detail-secondary-top{grid-template-columns:1fr}'), '中等螢幕右側卡片必須改為單欄緊貼，避免內容被擠窄');
assert.match(styles, /@media\(max-width:700px\)\{[^}]*\.vessel-detail-grid\{grid-template-columns:1fr/, '窄螢幕單船詳情必須自然降為一欄');
assert.match(lastRule('.vessel-info-panel h2'), /font-size:19px/, '單船資訊面板標題必須放大');
assert.match(lastRule('.vessel-info-panel dt'), /font-size:12px/, '單船欄位名稱必須放大');
assert.match(lastRule('.vessel-info-panel dd'), /font-size:15px/, '單船欄位內容必須放大');
assert.match(lastRule('.vessel-detail-metrics small'), /font-size:13px/, '單船摘要卡標題必須放大');
assert.match(lastRule('.vessel-detail-metrics b'), /font-size:21px/, '單船摘要卡內容必須放大');

assert.ok(modal.includes('<div className="grid cols-2 vessel-cargo-note-grid">'), '貨名貨量與人工備註必須使用獨立的明確兩欄容器，不能受前面日期欄位自動排位影響');
assert.ok(modal.includes('<div className="field vessel-manual-remark"><label>人工備註</label><textarea'), '人工備註必須是與貨名貨量同列同寬的 textarea');
assert.ok(modal.includes('<div className="grid cols-2 vessel-followup-officer-layout">'), '近期動態與四位姓名必須使用獨立的明確兩欄容器');
assert.ok(modal.includes('<div className="vessel-officer-grid">'), '四位姓名必須位於近期動態右側的兩欄兩列容器');
assert.ok(modal.indexOf('vessel-officer-grid') > modal.indexOf('近期／後續動態') && modal.indexOf('vessel-officer-grid') < modal.indexOf('vessel-dynamics-section'), '四位姓名必須與近期／後續動態並列，而不是留在底部');
assert.match(styles, /\.vessel-cargo-note-grid,\.vessel-followup-officer-layout\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, '兩組快速更新內容在桌面版都必須明確採兩欄排列');
assert.match(styles, /\.vessel-officer-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, '四位姓名必須固定為兩欄兩列');
assert.match(styles, /\.vessel-officer-grid\{[^}]*margin:0/, '四位姓名區必須與左側近期動態頂端對齊，不得沿用舊版外距下移');
assert.match(styles, /\.vessel-cargo-field textarea,\.vessel-manual-remark textarea\{[^}]*min-height:91px/, '人工備註與貨名貨量必須同高');
assert.ok(modal.includes('<section className="vessel-dynamics-section">'), '船舶狀態與作業／動態補充必須包在同一船舶動態區塊');
assert.ok(modal.includes('CheckboxMultiPicker label="船舶狀態"') && modal.includes('target.note.statusSupplement = value'), '視覺整合不得合併或刪除兩個獨立資料欄位');

console.log('Single-vessel detail and quick-update layout contracts passed.');

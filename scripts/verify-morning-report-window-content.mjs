import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
assert.match(app, /reportSnapshot\?:MorningReportSnapshot/,'PDF 預覽必須接收凍結快照的區間與本期 ID');
assert.match(app, /classifyMorningAgenda\(\{/,'PDF 必須沿用工作台的要事／內控區間分類器');
assert.match(app, /todayTaskIds:reportSnapshot\?\.todayTaskIds/,'歷史 PDF 必須沿用保存時的本期要事 ID');
assert.match(app, /todayInternalControlCaseIds:reportSnapshot\?\.todayInternalControlCaseIds/,'歷史 PDF 必須沿用保存時的本期內控 ID');
assert.match(app, /<h2>內控議題<\/h2>/,'PDF 必須有 canonical 內控議題區段');
assert.match(app, /internalCases\.map/,'內控議題必須實際投影到 PDF 列');
assert.match(app, /本期已結/,'PDF 必須標示區間內已結案內容');
assert.match(app, /reportSnapshot=\{reportPreviewSnapshot\}/,'正式預覽掛載點必須傳入選定歷史快照，而非只傳目前資料');
console.log('Morning report cutoff classification and internal-control content contracts passed.');

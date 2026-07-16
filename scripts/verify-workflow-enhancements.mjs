import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const management = readFileSync(new URL('../src/Management.tsx', import.meta.url), 'utf8');
const morning = readFileSync(new URL('../src/MorningWorkspace.tsx', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const source = `${app}\n${morning}`;

assert.ok(app.includes('最新保存'), '雲端狀態必須顯示最新保存時間');
assert.ok(!/setCloudStatus\([^\n]{0,160}rev\./.test(app), '雲端狀態不可再顯示 rev.xx');
assert.ok(management.includes('人員資料已保存'), '人員保存後必須顯示成功提示');
assert.ok(source.includes('全選討論船舶'), '早會左欄必須提供全選按鈕');
assert.ok(source.includes('selected.length === 0 || selected.length === visibleVessels.length'), '未選或全選時必須以全部船舶作為討論範圍');
assert.ok(app.includes("['meeting','臨時會議']"), '主導覽必須提供臨時會議頁');
assert.ok(types.includes('TemporaryMeetingStatus'), '臨時會議資料必須具有狀態型別');

console.log('Workflow enhancement contracts passed.');

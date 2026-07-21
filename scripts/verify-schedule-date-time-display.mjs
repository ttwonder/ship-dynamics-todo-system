import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const editModals = fs.readFileSync('src/EditModals.tsx', 'utf8');
const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const detail = fs.readFileSync('src/VesselDetailPage.tsx', 'utf8');

assert.ok(editModals.includes('ScheduleDateTimeField'), '快速更新 ETA／ETB／ETD 需使用日期＋可選時間欄位元件');
assert.ok(editModals.includes('type="date"') && editModals.includes('type="time"'), 'ETA／ETB／ETD 編輯需同時提供日期與小時分鐘輸入');
assert.ok(!editModals.includes('type="datetime-local"'), '不得再用 datetime-local，否則無法保存純日期');
assert.ok(dashboard.includes('formatScheduleDisplay'), '船舶看板需格式化 ETA／ETB／ETD 顯示');
assert.ok(detail.includes('formatScheduleDisplay'), '單船詳情需格式化 ETA／ETB／ETD 顯示');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const schedule = await server.ssrLoadModule('/src/scheduleTime.ts');
  assert.equal(schedule.scheduleDateValue('2026-07-17'), '2026-07-17');
  assert.equal(schedule.scheduleDateValue('2026-07-17T13:45'), '2026-07-17');
  assert.equal(schedule.scheduleDateValue('2026-07-17 13:45:00'), '2026-07-17');
  assert.equal(schedule.scheduleTimeValue('2026-07-17'), '', '純日期不應被補成 00:00');
  assert.equal(schedule.scheduleTimeValue('2026-07-17T13:45'), '13:45');
  assert.equal(schedule.scheduleTimeValue('2026-07-17 13:45:00'), '13:45');
  assert.equal(schedule.composeScheduleValue('2026-07-17', ''), '2026-07-17', '只輸入日期時需保存純日期');
  assert.equal(schedule.composeScheduleValue('2026-07-17', '13:45'), '2026-07-17T13:45', '輸入日期與時間時需保存到分鐘');
  assert.equal(schedule.composeScheduleValue('', '13:45'), '', '未輸入日期時不得只保存時間');
  assert.equal(schedule.formatScheduleDisplay('2026-07-17'), '2026-07-17');
  assert.equal(schedule.formatScheduleDisplay('2026-07-17T13:45'), '2026-07-17 13:45');
  assert.equal(schedule.formatScheduleDisplay('2026-07-17 13:45:00'), '2026-07-17 13:45');
  assert.equal(schedule.formatScheduleDisplay(''), '');
} finally {
  await server.close();
}
console.log('Schedule date/time display contracts passed.');

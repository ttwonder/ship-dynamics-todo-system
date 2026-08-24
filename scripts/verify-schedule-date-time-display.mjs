import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const editModals = fs.readFileSync('src/EditModals.tsx', 'utf8');
const normalizedApp = fs.readFileSync('src/NormalizedApp.tsx', 'utf8');
const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const detail = fs.readFileSync('src/VesselDetailPage.tsx', 'utf8');

assert.ok(editModals.includes('ScheduleDateTimeField'), '快速更新 ETA／ETB／ETD 需使用日期＋可選時間欄位元件');
assert.ok(editModals.includes('type="date"') && editModals.includes('type="time"'), 'ETA／ETB／ETD 編輯需同時提供日期與小時分鐘輸入');
assert.ok(!editModals.includes('type="datetime-local"'), '不得再用 datetime-local，否則無法保存純日期');
assert.match(editModals, /aria-label=\{`\$\{label\} 清除`\}/, 'ETA／ETB／ETD 元件需提供 App 自己的清除按鈕');
assert.ok(!normalizedApp.includes('type="datetime-local"'), 'normalized runtime 也不得退回手機無法可靠清除的 datetime-local');
assert.match(normalizedApp, /<ScheduleDateTimeField key=\{field\} label=\{field\.toUpperCase\(\)\}/, 'normalized runtime 的 ETA／ETB／ETD 必須共用同一清除元件');
assert.ok(dashboard.includes('formatCompleteScheduleDisplay'), '船舶看板需只顯示完整日期＋時間，缺值或缺時間顯示 TBA');
assert.ok(detail.includes('formatScheduleDisplay'), '單船詳情需格式化 ETA／ETB／ETD 顯示');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const schedule = await server.ssrLoadModule('/src/scheduleTime.ts');
  assert.equal(schedule.clearScheduleValue(), '', '清除必須保存真正空字串，使日期與時間同時清空');
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

  assert.equal(schedule.formatCompleteScheduleDisplay('2026-07-17T13:45'), '2026-07-17 13:45', '船舶看板需保留完整日期＋時間');
  assert.equal(schedule.formatCompleteScheduleDisplay('2026-07-17 13:45:00'), '2026-07-17 13:45', '含秒資料仍只顯示到分鐘');
  assert.equal(schedule.formatCompleteScheduleDisplay('2026-07-17'), '', '只有日期、未填時間時需由船舶看板顯示 TBA');
  assert.equal(schedule.formatCompleteScheduleDisplay(''), '', '未填日期時間時需由船舶看板顯示 TBA');

  const scheduleValues = { eta: '2026-08-12T10:00', etb: '2026-08-12T11:00', etd: '2026-08-12T12:00' };
  assert.equal(schedule.automaticScheduleKind(scheduleValues, new Date(2026, 7, 12, 9, 59)), 'ETA', 'ETA 尚未小於電腦時間時顯示 ETA');
  assert.equal(schedule.automaticScheduleKind(scheduleValues, new Date(2026, 7, 12, 10, 0)), 'ETA', 'ETA 等於電腦時間時仍顯示 ETA');
  assert.equal(schedule.automaticScheduleKind(scheduleValues, new Date(2026, 7, 12, 10, 1)), 'ETB', 'ETA 已小於電腦時間時顯示 ETB');
  assert.equal(schedule.automaticScheduleKind(scheduleValues, new Date(2026, 7, 12, 11, 1)), 'ETD', 'ETA 與 ETB 都已小於電腦時間時顯示 ETD');
  assert.equal(schedule.automaticScheduleKind({ ...scheduleValues, etb: '' }, new Date(2026, 7, 12, 10, 1)), 'ETB', 'ETA 已過但 ETB 未填時停在 ETB，由畫面顯示 TBA');
  assert.equal(schedule.automaticScheduleKind({ ...scheduleValues, eta: '2026-08-12' }, new Date(2026, 7, 13, 10, 1)), 'ETA', 'ETA 缺少時間時不能推定已過期');
  assert.equal(schedule.automaticScheduleKind({ ...scheduleValues, eta: 'invalid' }, new Date(2026, 7, 13, 10, 1)), 'ETA', '無效 ETA 不能推定已過期');

  assert.equal(schedule.nextScheduleKind('ETA'), 'ETB');
  assert.equal(schedule.nextScheduleKind('ETB'), 'ETD');
  assert.equal(schedule.nextScheduleKind('ETD'), 'ETA');

  const { ScheduleDateTimeField } = await server.ssrLoadModule('/src/EditModals.tsx');
  const scheduleEditorMarkup = renderToStaticMarkup(React.createElement(ScheduleDateTimeField, { label:'ETA', value:'2026-08-12T10:00', onChange(){} }));
  assert.match(scheduleEditorMarkup, /<button[^>]*aria-label="ETA 清除"[^>]*>清除<\/button>/, 'ETA 編輯器需渲染明確清除按鈕，手機不依賴原生日期重置');

  const { default: Dashboard } = await server.ssrLoadModule('/src/Dashboard.tsx');
  const user = {
    id: 'owner-1', department: '航運處', name: 'Owner', username: 'owner', role: 'owner', passwordHash: '',
    isActive: true, managedVesselIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const vessel = (id, scheduleValues) => ({
    id, name: id, shortName: id, fullName: id, shipType: '散裝船', fleetCategory: 'bulk fleet', fleetTags: [],
    assignedUserIds: [], delegateManagers: [], isActive: true,
    position: {
      source: 'manual', location: '高雄', speedKnots: 0, navigationStatus: '停泊', lastPort: '高雄', nextPort: '台中',
      ...scheduleValues, updatedAt: '2026-01-01T00:00:00.000Z', manualRemark: '',
    },
    cargo: { source: 'manual', loadStatus: '空載', name: '', quantity: '', items: [], updatedAt: '2026-01-01T00:00:00.000Z' },
    note: { statusList: [], statusSupplement: '', captain: '', chiefOfficer: '', chiefEngineer: '', firstEngineer: '', recentDynamics: '', subsequentDynamics: '', updatedAt: '2026-01-01T00:00:00.000Z' },
    weeklyAttention: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const vessels = [
    vessel('future-eta', { eta: '2999-01-01T10:00', etb: '2999-01-01T11:00', etd: '2999-01-01T12:00' }),
    vessel('future-etb', { eta: '2000-01-01T10:00', etb: '2999-01-01T11:00', etd: '2999-01-01T12:00' }),
    vessel('future-etd', { eta: '2000-01-01T10:00', etb: '2000-01-01T11:00', etd: '2999-01-01T12:00' }),
    vessel('incomplete-eta', { eta: '2999-01-01', etb: '2999-01-01T11:00', etd: '2999-01-01T12:00' }),
  ];
  const markup = renderToStaticMarkup(React.createElement(Dashboard, {
    user, users: [user], vessels, tasks: [], internalControlCases: [], meetings: [], selected: [], setSelected: () => {},
    batchSelected: [], setBatchSelected: () => {}, onOpenVessel: () => {}, onEdit: () => {}, onAddTask: () => {},
    onToggleAttention: () => {}, onAdjustAttention: () => {}, onStartMeeting: () => {}, onOpenReport: () => {},
    onTaskMetric: () => {}, onOpenBatchManagedVessels: () => {}, canEdit: false, canCreateTasks: false,
    canUseMeetings: false, canUseReports: false,
  }));
  const renderedSchedules = [...markup.matchAll(/class="ship-schedule"[^>]*><b class="ship-data-label">(ETA|ETB|ETD)<\/b><span class="ship-data-value">([^<]+)<\/span>/g)]
    .map(match => [match[1], match[2]]);
  assert.deepEqual(renderedSchedules, [
    ['ETA', '2999-01-01 10:00'],
    ['ETB', '2999-01-01 11:00'],
    ['ETD', '2999-01-01 12:00'],
    ['ETA', 'TBA'],
  ], '船舶面板需自動選 ETA／ETB／ETD，並且只顯示完整日期＋時間，缺時間顯示 TBA');
} finally {
  await server.close();
}
console.log('Schedule date/time display contracts passed.');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const app = read('src/App.tsx');
const dashboard = read('src/Dashboard.tsx');
const types = read('src/types.ts');
const modals = read('src/EditModals.tsx');
const normalizer = read('src/normalize.ts');
const morning = read('src/MorningWorkspace.tsx');
const meetings = read('src/TemporaryMeetings.tsx');
const api = fs.existsSync('src/smartShipApi.ts') ? read('src/smartShipApi.ts') : '';

assert.ok(types.includes("TaskPriority = '急' | '高' | '中' | '低'"), '关注程度需新增「急」等级');
assert.ok(types.includes('isAbnormal: boolean'), '要事需保存异常选项');
assert.ok(types.includes("NavigationStatus = '航行' | '拋錨' | '停泊'"), '需保存航行／抛锚／停泊状态');
assert.ok(types.includes("LoadStatus = '空載' | '非空載' | '滿載'"), '需保存空载／非空载／满载状态');
assert.ok(types.includes('etb: string') && types.includes('etd: string'), '需保存 ETA／ETB／ETD');
assert.ok(types.includes('items: VesselCargoItem[]'), '货名货量需支持多笔资料');
assert.ok(types.includes('weeklyAttention: WeeklyAttentionKey[]'), '需保存未来一周关注灯');

assert.ok(modals.includes('異常') && modals.includes('draft.isAbnormal'), '新增／编辑要事弹窗需提供异常选项');
for (const label of ['航行狀態', '載況', 'ETA', 'ETB', 'ETD', '多筆貨名／貨量']) {
  assert.ok(modals.includes(label), `快速更新需提供「${label}」手动修改`);
}
assert.ok(modals.includes('智慧船舶接口'), '快速更新需说明资料可由智慧船舶接口同步');

for (const label of ['異常存在', '位置', '貨名貨量', '重要摘要', '快速更新', '新增要事', '選入會議']) {
  assert.ok(dashboard.includes(label), `船舶看板需显示「${label}」`);
}
for (const label of ['換員操作', '加油加水', '物料配件', '維修', 'Survey', '稽核檢查', 'PSC窗開']) {
  assert.ok(dashboard.includes(label), `船舶看板需提供「${label}」一周关注灯`);
}
assert.ok(dashboard.includes("['ETA','ETB','ETD']") && dashboard.includes("||'TBA'"), 'ETA／ETB／ETD 需点击循环且空值显示 TBA');
assert.ok(dashboard.includes("priority === '急'") && dashboard.includes('急 {urgent}'), '看板需显示急等级统计');
assert.ok(app.includes('t.isAbnormal') && app.includes('異常</span>'), '清单及报告需显示异常资料');
assert.ok(morning.includes('急:0') && morning.includes('異常'), '早会需按急等级排序并显示异常');
assert.ok(meetings.includes("priority: savedDraft.priority") && meetings.includes('isAbnormal: false'), '临时会议产生的要事需带完整新资料契约');

assert.ok(normalizer.includes("const priorities: TaskPriority[] = ['急', '高', '中', '低']"), '正規化器需接受急等级');
assert.ok(normalizer.includes('isAbnormal: bool(item.isAbnormal)'), '正規化器需迁移异常选项');
assert.ok(normalizer.includes('weeklyAttention') && normalizer.includes('cargoItems'), '正規化器需迁移关注灯与多笔货物');

assert.ok(api.includes('interface SmartShipApiClient'), '需提供智慧船舶 API client 预留接口');
assert.ok(api.includes('TODO(SMART_SHIP_API)'), '智慧船舶预留接口需有明确源码备注');
assert.ok(api.includes('mergeSmartShipSnapshot'), '需提供智慧船舶资料合并入口并保留手动修改能力');

console.log('Dashboard smart-ship revision contracts passed.');

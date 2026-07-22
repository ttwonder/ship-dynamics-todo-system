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
const meetingTasks = read('src/meetingTaskWorkflow.ts');
const api = fs.existsSync('src/smartShipApi.ts') ? read('src/smartShipApi.ts') : '';
const styles = read('src/styles.css');

assert.ok(types.includes("TaskPriority = '急' | '高' | '中' | '低'"), '关注程度需新增「急」等级');
assert.ok(types.includes('isAbnormal: boolean'), '要事需保存异常选项');
assert.ok(types.includes("NavigationStatus = '航行' | '拋錨' | '進港中' | '出港中' | '停泊' | '漂航'"), '航行狀態需保存航行／拋錨／進港中／出港中／停泊／漂航');
assert.ok(types.includes("LoadStatus = '空載' | '非空載' | '滿載'"), '需保存空载／非空载／满载状态');
assert.ok(types.includes('etb: string') && types.includes('etd: string'), '需保存 ETA／ETB／ETD');
assert.ok(types.includes('items: VesselCargoItem[]'), '货名货量需支持多笔资料');
assert.ok(types.includes('weeklyAttention: WeeklyAttentionKey[]'), '需保存未来一周关注灯');

assert.ok(modals.includes('異常') && modals.includes('draft.isAbnormal'), '新增／编辑要事弹窗需提供异常选项');
for (const status of ['航行','拋錨','進港中','出港中','停泊','漂航']) {
  assert.ok(modals.includes(`<option>${status}</option>`), `快速更新航行狀態需提供「${status}」`);
}
assert.ok(modals.includes('智慧船舶接口'), '快速更新需说明资料可由智慧船舶接口同步');

for (const label of ['異常存在', '位置', '貨名貨量', '重要摘要', '快速更新', '新增要事', '選入會議']) {
  assert.ok(dashboard.includes(label), `船舶看板需显示「${label}」`);
}
for (const label of ['換員操作', '加油加水', '物料配件', '維修', 'Survey', '稽核檢查', 'PSC窗開']) {
  assert.ok(dashboard.includes(label), `船舶看板需提供「${label}」一周关注灯`);
}
assert.ok(dashboard.includes("['ETA','ETB','ETD']") && dashboard.includes("||'TBA'"), 'ETA／ETB／ETD 需点击循环且空值显示 TBA');
const schedulePosition = dashboard.indexOf('className="ship-schedule"');
const vesselStatusPosition = dashboard.indexOf('className="ship-status"');
const loadStatusPosition = dashboard.indexOf('className="ship-load"');
assert.ok(schedulePosition !== -1 && vesselStatusPosition !== -1 && loadStatusPosition !== -1, '船舶看板需同时渲染 ETA、船舶状态、载况区块');
assert.ok(schedulePosition < vesselStatusPosition && vesselStatusPosition < loadStatusPosition, '船舶看板 DOM 顺序应为 ETA、船舶状态、载况');
assert.ok(styles.includes('grid-template-areas:"route position navigation" "schedule status load" "cargo cargo cargo"'), '船舶看板桌面 CSS Grid 视觉顺序应为 ETA、船舶状态、载况');
assert.ok(styles.includes('grid-template-areas:"route route" "position navigation" "schedule status" "load load" "cargo cargo"'), '船舶看板窄屏 CSS Grid 视觉顺序应为 ETA、船舶状态、载况');
assert.ok(styles.includes('gap:6px;margin:10px 0 8px'), '船舶动态区块需缩小网格间距与上下留白');
assert.ok(styles.includes('.ship-route{grid-area:route;margin:0;padding:8px 7px'), '航线区块需使用紧凑高度');
assert.ok(styles.includes('.ship-route b{') && styles.includes('font-size:13px') && styles.includes('white-space:normal') && styles.includes('overflow-wrap:anywhere'), '看板上一港／下一港需小字並允許長港名自動換行');
assert.ok(styles.includes('min-height:112px') && styles.includes('.ship-summary{') && styles.includes('flex:1'), '重要摘要需取得更高的最小高度与剩余空间');
assert.ok(dashboard.includes("priority === '急'") && dashboard.includes('急 {urgent}'), '看板需显示急等级统计');
assert.ok(app.includes('t.isAbnormal') && app.includes('異常</span>'), '清单及报告需显示异常资料');
assert.ok(morning.includes('急:0') && morning.includes('異常'), '早会需按急等级排序并显示异常');
assert.ok(meetingTasks.includes('priority,') && meetingTasks.includes('isAbnormal: isAbnormal || isInternalControl') && meetingTasks.includes('isInternalControl,'), '臨會/專題產生的要事需帶完整新資料契約');

assert.ok(normalizer.includes("const priorities: TaskPriority[] = ['急', '高', '中', '低']"), '正規化器需接受急等级');
assert.ok(normalizer.includes('isAbnormal: bool(item.isAbnormal)'), '正規化器需迁移异常选项');
assert.ok(normalizer.includes('weeklyAttention') && normalizer.includes('cargoItems'), '正規化器需迁移关注灯与多笔货物');

assert.ok(api.includes('interface SmartShipApiClient'), '需提供智慧船舶 API client 预留接口');
assert.ok(api.includes('TODO(SMART_SHIP_API)'), '智慧船舶预留接口需有明确源码备注');
assert.ok(api.includes('mergeSmartShipSnapshot'), '需提供智慧船舶资料合并入口并保留手动修改能力');

console.log('Dashboard smart-ship revision contracts passed.');

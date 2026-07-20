import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
const { selectVesselDetailTasks } = await server.ssrLoadModule('/src/vesselDetail.ts');

const task = (id, vesselId, priority, isClosed, expectedDate, updatedAt, description, extras = {}) => ({
  id, vesselId, priority, isClosed, expectedDate, updatedAt, description,
  vesselIds: [], status: '', categories: [], departments: [], ...extras,
});
const tasks = [
  task('low-open','v1','低',false,'2026-07-30','2026-07-10','一般追蹤'),
  task('urgent-open','v1','急',false,'2026-07-20','2026-07-12','主機異常',{status:'等待船廠',categories:['維修'],departments:['海技組']}),
  task('high-closed','v1','高',true,'2026-07-18','2026-07-13','已完成檢查'),
  task('company-meeting','other','中',false,'2026-07-22','2026-07-14','公司層臨會決議',{vesselIds:['other','v1'],sourceType:'temporary',sourceMeetingId:'m1',attentionDimension:'meeting'}),
  task('distributed-meeting','other','高',false,'2026-07-21','2026-07-14','已分派臨會待辦',{vesselIds:['other','v1'],sourceType:'temporary',sourceMeetingId:'m2',attentionDimension:'meeting',distributeToVessels:true}),
  task('aggregate','other','中',false,'2026-07-22','2026-07-14','跨船普通要事',{vesselIds:['other','v1'],sourceType:'morning',attentionDimension:'task'}),
  task('foreign','v2','急',false,'2026-07-19','2026-07-15','其他船舶'),
];

assert.deepEqual(selectVesselDetailTasks(tasks,'v1',{closedMode:'all',priority:'all',query:'',sort:'priority'}).map(item=>item.id),['urgent-open','distributed-meeting','high-closed','aggregate','low-open'],'应依关注程度排序，排除未分派公司层会议决议，并纳入已分派会议待办');
assert.deepEqual(selectVesselDetailTasks(tasks,'v1',{closedMode:'open',priority:'all',query:'',sort:'due-asc'}).map(item=>item.id),['urgent-open','distributed-meeting','aggregate','low-open'],'未结筛选应依期限近到远，且只包含已分派的会议待办');
assert.deepEqual(selectVesselDetailTasks(tasks,'v1',{closedMode:'closed',priority:'all',query:'',sort:'updated-desc'}).map(item=>item.id),['high-closed'],'已结筛选只显示已结事项');
assert.deepEqual(selectVesselDetailTasks(tasks,'v1',{closedMode:'all',priority:'急',query:'海技',sort:'priority'}).map(item=>item.id),['urgent-open'],'关键字应检索状态、分类与部门，关注程度筛选应同时生效');

const dashboard = fs.readFileSync('src/Dashboard.tsx','utf8');
const app = fs.readFileSync('src/App.tsx','utf8');
assert.ok(dashboard.includes('onOpenVessel'), '船舶看板必须提供单船详情入口');
assert.ok(dashboard.includes('ship-name-link'), '船名必须是可存取的按钮而非普通文字');
assert.ok(fs.existsSync('src/VesselDetailPage.tsx'), '必须建立独立单船详情页组件');
const detail = fs.readFileSync('src/VesselDetailPage.tsx','utf8');
for (const label of ['回到船隊看板','船舶基本資料','航行與港口','時間與資料來源','貨載資訊','動態與備註','單船重要事項清單']) assert.ok(detail.includes(label), `详情页缺少 ${label}`);
for (const label of ['單船待辦關鍵字','單船待辦狀態篩選','單船待辦關注程度篩選','單船待辦排序']) assert.ok(detail.includes(label), `详情页缺少 ${label}`);
assert.ok(detail.includes('onEditVessel') && detail.includes('onEditTask') && detail.includes('onAddTask'), '详情页必须复用现有修改船舶／待办流程');
assert.ok(app.includes('selectedVesselDetailId') && app.includes('<VesselDetailPage'), 'App 必须管理详情页导航状态');
assert.ok(detail.includes('已勾選「分派到涉及船舶單船跟蹤」'), '單船詳情必須明確標示只有勾選分派的會議待辦才列入單船清單');

console.log('Vessel detail task filtering and sorting contracts passed.');
} finally {
  await server.close();
}

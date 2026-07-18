import assert from 'node:assert/strict';
import fs from 'node:fs';

const editors = fs.readFileSync('src/EditModals.tsx', 'utf8');

for (const label of ['ETA', 'ETB', 'ETD']) {
  const input = editors.match(new RegExp(`<label>${label}</label><input([^>]*)>`));
  assert.ok(input, `快速更新需提供 ${label} 輸入`);
  assert.match(input[1], /type="datetime-local"/, `${label} 必須使用日期時間選擇器`);
  assert.doesNotMatch(input[1], /\brequired\b/, `${label} 必須可以留空`);
}

const management = fs.readFileSync('src/Management.tsx', 'utf8');
assert.ok(
  management.includes('<label>部門<select aria-label="人員部門"'),
  '人員詳情的部門必須使用可切換的下拉選擇器',
);
assert.ok(!management.includes('list="management-departments"'), '不可继续使用 datalist 伪下拉');

const types = fs.readFileSync('src/types.ts', 'utf8');
const meetings = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const workCenter = fs.readFileSync('src/WorkCenter.tsx', 'utf8');
const normalizer = fs.readFileSync('src/normalize.ts', 'utf8');
const meetingTasks = fs.readFileSync('src/meetingTaskWorkflow.ts', 'utf8');

assert.ok(types.includes("TaskSource = 'morning' | 'temporary'"), '待辦必須有早會／臨會專題來源型別');
assert.ok(types.includes('sourceType: TaskSource'), '每筆待辦必須保存明确來源');
assert.ok(types.includes('taskDescription: string'), '臨會／專題必須保存獨立待辦事項');
assert.ok(meetings.includes('<label>待辦事項</label>'), '臨會／專題詳情必須可輸入待辦事項');
assert.ok(meetingTasks.includes("sourceType: 'temporary'"), '臨會／專題生成待辦必須標記來源');
assert.ok(meetings.includes('linkedTasks') && meetings.includes('關聯待辦事項'), '臨會／專題詳情必須呈現已生成待辦');
assert.ok(app.includes('<th>來源</th>') && app.includes('taskSourceLabel(t)'), '總清單必須呈現待辦來源');
assert.ok(workCenter.includes('taskSourceLabel(task)'), '個人待辦必須呈現待辦來源');
assert.ok(normalizer.includes("item.sourceMeetingId ? 'temporary' : 'morning'"), '舊資料必須安全補上來源');
assert.ok(app.includes("sourceType:'morning'"), '一般新增待辦必須标记為早會來源');
for (const source of [app, meetings]) {
  assert.ok(source.includes('臨會/專題'), '主要操作界面名稱必須統一為「臨會/專題」');
}
assert.ok(meetings.includes("'register'"), '臨會／專題頁必須提供獨立總清單視圖');
assert.ok(meetings.includes('臨會/專題總清單'), '必須提供清楚的臨會／專題總清單入口及標題');
for (const heading of ['召開日期', '狀態', '會議主題', '會議範圍', '船舶', '部門', '待辦', '期限']) {
  assert.ok(meetings.includes(`<th>${heading}</th>`), `臨會／專題總清單必須顯示「${heading}」欄`);
}
assert.ok(meetings.includes('meetingTaskCount'), '總清單必須顯示每場會議的關聯待辦數量');
assert.ok((meetings.match(/visibleIds\.has\(task\.vesselId\)/g) || []).length >= 2, '會議詳情及總清單待辦必須限制於目前可見船舶');
assert.ok(meetings.includes('進入詳情'), '總清單必須可以直接開啟會議詳情');

console.log('User follow-up contracts passed.');

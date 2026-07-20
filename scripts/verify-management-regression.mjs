import fs from 'node:fs';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/Dashboard.tsx', import.meta.url), 'utf8');
const management = fs.readFileSync(new URL('../src/Management.tsx', import.meta.url), 'utf8');
const source = `${app}\n${dashboard}\n${management}`;

const unsafeDeferredSelections = [
  /onChange=\{e=>updateUser\([^}]*e\.currentTarget\.selectedOptions/g,
  /onChange=\{e=>commit\([^}]*e\.currentTarget\.selectedOptions/g,
].flatMap(pattern => app.match(pattern) ?? []);

assert.equal(
  unsafeDeferredSelections.length,
  0,
  `管理頁不可在延後執行的資料更新 callback 中讀取 React event.currentTarget；找到 ${unsafeDeferredSelections.length} 處`,
);

for (const contract of [
  'management-shell',
  'management-sidebar',
  'management-master',
  'management-detail',
  '總清單',
  '自管船舶',
  "assignedUserIds.includes(user.id)",
  'canManageVesselAssignments',
  '經管部門篩選',
  'managerNames',
  'assignment-selected-summary',
]) {
  assert.ok(source.includes(contract), `缺少正式管理／自管篩選契約：${contract}`);
}

assert.ok(management.includes("user.role === 'admin'") && management.includes("user.role === 'operator'"), '船舶經管人員必須允許管理員與操作員，不得只限操作員');
assert.ok(!management.includes("users={activeUsers.filter(user => user.role === 'operator')}"), '船舶頁不可只把操作員傳入經管人員選擇器');
assert.ok(management.includes('`${count} 人`') && management.includes('`${managerNames(activeUsers, v.assignedUserIds).length} 人`'), '管理船舶列表只顯示船名與經管人數，不得列出經管人姓名');
const vesselListSnippet = management.slice(management.indexOf("section === 'vessels'"), management.indexOf('<VesselEditor', management.indexOf("section === 'vessels'")));
assert.ok(!vesselListSnippet.includes("join('、')") && !vesselListSnippet.includes(' 人｜'), '船舶列表不得顯示經管人姓名串列');
assert.ok(management.includes('className="assignment-selected-summary"') && management.indexOf('assignment-selected-summary') < management.indexOf('management-assignment-tools'), '已選經管人員摘要需放在篩選／搜尋工具列上方');
assert.ok(!management.includes('<span>已選 {count}'), '已選經管人員摘要不得再塞在搜尋框右側');

console.log('Management selection regression contract passed.');

import fs from 'node:fs';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const management = fs.readFileSync(new URL('../src/Management.tsx', import.meta.url), 'utf8');
const source = `${app}\n${management}`;

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
]) {
  assert.ok(source.includes(contract), `缺少正式管理／自管篩選契約：${contract}`);
}

console.log('Management selection regression contract passed.');

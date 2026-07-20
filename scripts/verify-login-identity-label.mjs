import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('src/App.tsx','utf8');
const start=source.indexOf('function Login(');
const end=source.indexOf('function ReportCenter(',start);
assert.ok(start>=0&&end>start,'找不到人員登入元件');
const login=source.slice(start,end);
assert.match(login,/aria-label="登入部門"/,'登入界面必须保留部门下拉');
assert.match(login,/aria-label="登入人員"/,'登入界面必须保留人员下拉');
assert.match(login,/<option key=\{user\.id\} value=\{user\.id\}>\{user\.name\}<\/option>/,'人员选项必须只显示姓名');
assert.ok(!login.includes('roleLabel('),'人员登入界面不得显示角色／操作层级');
assert.ok(!login.includes("user.name}｜"),'人员姓名后不得拼接操作层级');
assert.match(login,/type="password"/,'认证密码栏不得因本次显示调整而移除');
console.log('Login identity labels show department and name without role level.');

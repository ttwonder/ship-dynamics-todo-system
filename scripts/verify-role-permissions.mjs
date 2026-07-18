import assert from 'node:assert/strict';
import { createServer } from 'vite';
import fs from 'node:fs';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const permissions = await server.ssrLoadModule('/src/permissions.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const owner = { role: 'owner' };
  const admin = { role: 'admin' };
  const operator = { role: 'operator' };

  assert.equal(permissions.hasPermission(permissions.DEFAULT_ROLE_PERMISSIONS, owner, 'enterManagement'), true, 'Owner 固定可進管理');
  assert.equal(permissions.hasPermission(permissions.DEFAULT_ROLE_PERMISSIONS, admin, 'enterManagement'), true, '管理員固定可進管理');
  assert.equal(permissions.hasPermission(permissions.DEFAULT_ROLE_PERMISSIONS, operator, 'enterManagement'), false, '操作員固定不可進管理');
  assert.equal(permissions.hasPermission(permissions.DEFAULT_ROLE_PERMISSIONS, operator, 'editBusinessContent'), true, '操作員預設可輸入修改內容');

  const restricted = structuredClone(permissions.DEFAULT_ROLE_PERMISSIONS);
  restricted.operator.editBusinessContent = false;
  restricted.owner.editBusinessContent = false;
  assert.equal(permissions.hasPermission(restricted, operator, 'editBusinessContent'), false, 'Owner 可關閉操作員業務修改權');
  assert.equal(permissions.hasPermission(restricted, owner, 'editBusinessContent'), true, 'Owner 本身權限固定全開');

  const normalized = normalizeAppData({
    revision: 1,
    settings: { rolePermissions: { operator: { enterManagement: true, editBusinessContent: false }, admin: { enterManagement: false } } },
    users: [{ id: 'owner', name: 'Owner', role: 'owner' }],
    vessels: [], tasks: [], meetings: [], agendaReports: [], auditLogs: [],
  });
  assert.equal(normalized.settings.rolePermissions.operator.enterManagement, false, '正規化不得讓操作員取得管理頁');
  assert.equal(normalized.settings.rolePermissions.admin.enterManagement, true, '正規化不得關閉管理員的管理入口');
  assert.equal(normalized.settings.rolePermissions.operator.editBusinessContent, false, '可設定權限需保存');

  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const management = fs.readFileSync('src/Management.tsx', 'utf8');
  const meetings = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
  const meetingAccess = fs.readFileSync('src/meetingAccess.ts', 'utf8');
  assert.ok(app.includes("hasPermission(data.settings.rolePermissions, currentUser, 'enterManagement')"), 'App 管理入口需使用統一權限判斷');
  assert.ok(app.includes("hasPermission(data.settings.rolePermissions, currentUser, 'editBusinessContent')"), '內容修改需使用統一權限判斷');
  assert.ok(meetings.includes('canEditTemporaryMeetings(data.settings.rolePermissions, currentUser)') && meetingAccess.includes("hasPermission(matrix, user, 'manageMeetings')"), '臨時會議需使用精細權限');
  assert.ok(management.includes('RolePermissionMatrix') && management.includes('只有 Owner 可以調整'), '管理頁需提供 Owner 可調的權限矩陣');

  console.log('Role permission runtime contracts passed.');
} finally {
  await server.close();
}

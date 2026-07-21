import assert from 'node:assert/strict';
import { createServer } from 'vite';
import fs from 'node:fs';

const validHash = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);
const app = fs.readFileSync('src/App.tsx', 'utf8');
const management = fs.readFileSync('src/Management.tsx', 'utf8');
const permissions = fs.readFileSync('src/permissions.ts', 'utf8');
const utils = fs.readFileSync('src/utils.ts', 'utf8');

assert.match(app, /PersonalPasswordModal/, '點擊自己名字後應開啟個人密碼修改彈窗');
assert.match(app, /setPasswordModalOpen\(true\)/, '頁首自己的姓名需能打開密碼修改彈窗');
assert.match(app, /舊密碼/, '個人密碼彈窗需提供舊密碼欄位');
assert.match(app, /新密碼/, '個人密碼彈窗需提供新密碼欄位');
assert.match(app, /再次輸入新密碼/, '個人密碼彈窗需要求新密碼二次確認');
assert.match(app, /currentUser\.passwordHash[\s\S]*sha256\(oldPassword\)/, '已有密碼者更新前必須驗證舊密碼');
assert.match(app, /!newPassword&&!confirmPassword[\s\S]*passwordRequired[\s\S]*不可解除密碼[\s\S]*passwordHash=''/, '只輸入舊密碼且新密碼留空時，非 Owner／管理員需解除密碼');
assert.match(app, /const needsPassword=user\.role==='owner'\|\|user\.role==='admin'\|\|Boolean\(user\.passwordHash\)/, '登入密碼驗證需套用 Owner／管理員或已設定個人密碼者');
assert.match(app, /if\(!needsPassword\)\{setCurrentUserId\(user\.id\);return;\}/, '沒有密碼的非管理人員必須可直接登入');
assert.match(app, /Owner／管理員或已設定個人密碼者需輸入密碼/, '登入頁需說明已設定個人密碼者也需輸入密碼');
assert.doesNotMatch(app, /固定無密碼登入/, '非管理人員不得再固定禁止個人密碼');

assert.match(permissions, /admin: row\(\[[\s\S]*'manageUsers'/, '管理員預設需能看到並管理「人員」');
assert.match(permissions, /result\.admin\.manageUsers = true/, '既有權限矩陣正規化後，管理員仍固定可管理非 Owner 人員');
assert.match(management, /if \(!owner && \(targetUser\?\.role === 'owner' \|\| personDraft\.role === 'owner'\)\) return alert\('管理員不可建立或修改 Owner 帳號'\)/, '管理員不可建立或修改 Owner');
assert.match(management, /const passwordHash = personDraft\.password \? await sha256\(personDraft\.password\) : selected\?\.passwordHash \|\| ''/, '管理頁保存人員時需保留既有密碼，輸入新密碼時才重設');
assert.match(management, /const canClearPassword = !creating && manager && selectedUserId !== currentUser\.id && draft\.role !== 'owner' && draft\.role !== 'admin'/, 'Owner／管理員可清除非管理人員密碼，但不可清除 Owner／管理員密碼');
assert.doesNotMatch(management, /passwordVisible|Owner 可查看|具體密碼/, '管理頁不得顯示可回復明文密碼');
assert.match(utils, /passwordHash: user\.passwordHash/, '儲存時需保留已設定的非管理人員個人密碼 hash');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { sanitizeAppDataForStorage } = await server.ssrLoadModule('/src/utils.ts');
  const { normalizeRolePermissions, hasPermission } = await server.ssrLoadModule('/src/permissions.ts');
  const fixture = normalizeAppData({
    revision: 1,
    updatedAt: '2026-07-21T00:00:00.000Z',
    settings: { sitePasswordHash:'x', systemTitle:'x', departments:['管理層','航務部'], taskCategories:[], rolePermissions:{ admin: { manageUsers: false } }, nonOwnerPasswordResetVersion:2 },
    users: [
      { id:'owner', department:'管理層', name:'Owner', username:'owner', role:'owner', passwordHash:validHash, isActive:true, managedVesselIds:[] },
      { id:'admin', department:'管理層', name:'Admin', username:'admin', role:'admin', passwordHash:validHash, isActive:true, managedVesselIds:[] },
      { id:'operator-password', department:'航務部', name:'有密碼操作員', username:'op1', role:'operator', passwordHash:otherHash, isActive:true, managedVesselIds:[] },
      { id:'operator-blank', department:'航務部', name:'無密碼操作員', username:'op2', role:'operator', passwordHash:'', isActive:true, managedVesselIds:[] },
    ],
    vessels: [], tasks: [], meetings: [], agendaReports: [], notifications: [], auditLogs: [],
  });
  assert.equal(fixture.users.find(user => user.id === 'operator-password').passwordHash, otherHash, '非管理人員已設定個人密碼時，正規化後必須保留');
  assert.equal(fixture.users.find(user => user.id === 'operator-blank').passwordHash, '', '非管理人員沒有密碼時仍可無密碼登入');
  const stored = sanitizeAppDataForStorage(fixture);
  assert.equal(stored.users.find(user => user.id === 'operator-password').passwordHash, otherHash, '保存到本地／雲端 payload 時必須保留非管理人員已設定的個人密碼 hash');
  const normalizedPermissions = normalizeRolePermissions(fixture.settings.rolePermissions);
  assert.equal(normalizedPermissions.admin.manageUsers, true, '管理員 manageUsers 需固定開啟，不受舊設定關閉影響');
  assert.equal(hasPermission(normalizedPermissions, fixture.users.find(user => user.id === 'admin'), 'manageUsers'), true, '管理員需能進管理頁看到人員');
} finally {
  await server.close();
}

console.log('Personal password management contracts passed.');

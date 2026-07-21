import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const validHash = 'a'.repeat(64);
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const normalizer = await server.ssrLoadModule('/src/normalize.ts');
  const utils = await server.ssrLoadModule('/src/utils.ts');
  const normalized = normalizer.normalizeAppData({
    revision: 1,
    updatedAt: '2026-07-21T00:00:00.000Z',
    settings: { sitePasswordHash: 'x', systemTitle: 'x', departments: ['航運處'], taskCategories: [], rolePermissions: {} },
    users: [
      { id: 'owner', department: '管理層', name: 'Owner', username: 'owner', role: 'owner', passwordHash: validHash, isActive: true, managedVesselIds: [] },
      { id: 'admin', department: '管理層', name: 'Admin', username: 'admin', role: 'admin', passwordHash: validHash, isActive: true, managedVesselIds: [] },
      { id: 'operator', department: '航運處', name: 'Operator', username: 'operator', role: 'operator', passwordHash: validHash, isActive: true, managedVesselIds: [] },
      { id: 'vessel', department: '船舶帳戶', name: 'Vessel', username: 'vessel', role: 'vessel', passwordHash: validHash, isActive: true, managedVesselIds: ['v1'] },
    ],
    vessels: [], tasks: [], meetings: [], agendaReports: [], auditLogs: [], notifications: [],
  });
  assert.equal(normalized.users.find(user => user.id === 'owner').passwordHash, validHash, 'Owner password hash must be preserved');
  assert.equal(normalized.users.find(user => user.id === 'admin').passwordHash, validHash, 'Admin password hash must be preserved');
  assert.equal(normalized.users.find(user => user.id === 'operator').passwordHash, '', 'Operator password hash must be cleared for passwordless login');
  assert.equal(normalized.users.find(user => user.id === 'vessel').passwordHash, '', 'Vessel account password hash must be cleared unless promoted to admin/owner');
  const stored = utils.sanitizeAppDataForStorage({ ...normalized, users: normalized.users.map(user => user.id === 'operator' ? { ...user, passwordHash: validHash } : user) });
  assert.equal(stored.users.find(user => user.id === 'operator').passwordHash, '', 'Storage sanitization must not persist non-admin password hashes');
} finally {
  await server.close();
}

const app = fs.readFileSync('src/App.tsx', 'utf8');
const management = fs.readFileSync('src/Management.tsx', 'utf8');
assert.ok(app.includes("const needsPassword=user.role==='owner'||user.role==='admin'"), 'Login password gate must be role-based');
assert.ok(app.includes("if(!needsPassword){ setCurrentUserId(user.id); return; }") || app.includes('if(!needsPassword){setCurrentUserId(user.id);return;}'), 'Non-admin login must bypass password checks before comparing hashes');
assert.ok(management.includes("const passwordHash = passwordRequired ?"), 'Management save must clear passwordHash when role is not Owner/Admin');
assert.ok(management.includes("passwordRequired ? 'Owner／管理員登入必須使用密碼' : '操作員／船舶帳戶無密碼登入'"), 'Personnel editor must clearly state non-admin accounts are passwordless');
console.log('Passwordless non-admin login contracts passed.');

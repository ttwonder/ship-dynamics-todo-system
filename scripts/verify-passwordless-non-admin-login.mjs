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
  assert.equal(normalized.users.find(user => user.id === 'operator').passwordHash, '', 'Non-admin personal password hash must be cleared during normalization');
  assert.equal(normalized.users.find(user => user.id === 'vessel').passwordHash, '', 'Vessel account password hash must be cleared during normalization');
  const stored = utils.sanitizeAppDataForStorage(normalized);
  assert.equal(stored.users.find(user => user.id === 'operator').passwordHash, '', 'Storage sanitization must keep non-admin accounts passwordless');
  assert.equal(stored.users.find(user => user.id === 'vessel').passwordHash, '', 'Storage sanitization must keep vessel accounts passwordless');
} finally {
  await server.close();
}

const app = fs.readFileSync('src/App.tsx', 'utf8');
const management = fs.readFileSync('src/Management.tsx', 'utf8');
assert.ok(app.includes("const needsPassword=user.role==='owner'||user.role==='admin'"), 'Login password gate must be Owner/admin only');
assert.ok(!app.includes("||Boolean(user.passwordHash)"), 'Login must not require passwords for non-admin users even if legacy hashes exist');
assert.ok(app.includes('if(!needsPassword){setCurrentUserId(user.id);return;}'), 'Non-admin accounts must bypass password checks');
assert.ok(management.includes("const passwordHash = passwordRequired ?"), 'Management save must clear non-admin passwords and preserve/reset only Owner/admin passwords');
assert.ok(management.includes("passwordRequired ? 'Owner／管理員登入必須使用密碼' : '非 Owner／管理員固定無密碼登入'"), 'Personnel editor must explain non-admin passwordless behavior');
console.log('Passwordless non-admin login contracts passed.');

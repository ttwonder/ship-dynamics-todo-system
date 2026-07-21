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
      { id: 'vessel', department: '船舶帳戶', name: 'Vessel', username: 'vessel', role: 'vessel', passwordHash: '', isActive: true, managedVesselIds: ['v1'] },
    ],
    vessels: [], tasks: [], meetings: [], agendaReports: [], auditLogs: [], notifications: [],
  });
  assert.equal(normalized.users.find(user => user.id === 'owner').passwordHash, validHash, 'Owner password hash must be preserved');
  assert.equal(normalized.users.find(user => user.id === 'admin').passwordHash, validHash, 'Admin password hash must be preserved');
  assert.equal(normalized.users.find(user => user.id === 'operator').passwordHash, validHash, 'Non-admin personal password hash must be preserved when explicitly set');
  assert.equal(normalized.users.find(user => user.id === 'vessel').passwordHash, '', 'Non-admin blank password must remain passwordless');
  const stored = utils.sanitizeAppDataForStorage(normalized);
  assert.equal(stored.users.find(user => user.id === 'operator').passwordHash, validHash, 'Storage sanitization must persist optional non-admin password hashes');
  assert.equal(stored.users.find(user => user.id === 'vessel').passwordHash, '', 'Storage sanitization must preserve blank passwordless state');
} finally {
  await server.close();
}

const app = fs.readFileSync('src/App.tsx', 'utf8');
const management = fs.readFileSync('src/Management.tsx', 'utf8');
assert.ok(app.includes("const needsPassword=user.role==='owner'||user.role==='admin'||Boolean(user.passwordHash)"), 'Login password gate must be role-or-existing-password based');
assert.ok(app.includes('if(!needsPassword){setCurrentUserId(user.id);return;}'), 'Non-admin accounts without password must still bypass password checks');
assert.ok(management.includes("const passwordHash = personDraft.password ? await sha256(personDraft.password) : selected?.passwordHash || ''"), 'Management save must preserve existing optional passwords unless reset');
assert.ok(management.includes("passwordRequired ? 'Owner／管理員登入必須使用密碼' : '可設定個人密碼；無密碼時可空白登入'"), 'Personnel editor must explain optional non-admin password behavior');
console.log('Passwordless and optional personal password contracts passed.');

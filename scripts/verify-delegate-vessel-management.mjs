import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const types = fs.readFileSync('src/types.ts', 'utf8');
const management = fs.readFileSync('src/Management.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const batch = fs.readFileSync('src/BatchManagedVesselModal.tsx', 'utf8');
const workCenter = fs.readFileSync('src/workCenterScope.ts', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.ok(types.includes('VesselDelegateAssignment'), 'Vessel 需有代管人員資料型別');
assert.ok(types.includes('delegateManagers: VesselDelegateAssignment[]'), '每艘船需保存代管人員與激活狀態');
assert.ok(management.includes('代管') && management.includes('delegateManagers'), '管理頁船舶編輯需新增代管模組');
assert.ok(management.includes('toggleDelegateActive') && management.includes('delegate-manager-toggle'), '代管人員需可個別切換激活／未激活');
assert.ok(management.includes('delegateVessels') && management.includes('togglePersonDelegateVessel') && management.includes('togglePersonDelegateVesselActive'), '管理頁人員編輯需在經管船舶下方提供代管船舶模組並可個別切換激活');
assert.ok(management.includes('title="代管船舶"') && management.includes('selectedDelegateVesselNames'), '人員頁代管船舶需有獨立模組與已選摘要');
assert.ok((management.match(/isActive: false/g) || []).length >= 2, '人員頁與船舶頁新增代管時預設都必須為未激活');
assert.ok(styles.includes('.delegate-manager-toggle.active') && styles.includes('.delegate-manager-toggle.inactive'), '代管激活狀態需有綠色／灰色樣式');
assert.ok(app.includes('vesselMatchesUser') && app.includes('hasActiveVesselDelegation'), '可見船舶範圍需包含激活代管船舶');
assert.ok(workCenter.includes('hasActiveVesselDelegation'), '我的待辦需把激活代管船舶視為本人相關船舶');
assert.ok(batch.includes('managedVessels') && batch.includes('hasActiveVesselDelegation'), '批量更新自管船舶需包含激活代管船舶');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const delegation = await server.ssrLoadModule('/src/vesselDelegation.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const base = {
    revision: 1,
    updatedAt: '2026-07-21T00:00:00.000Z',
    settings: { systemTitle: 'QA', departments: [], rolePermissions: undefined },
    users: [
      { id:'u1', department:'航運處', name:'代管甲', username:'u1', role:'operator', passwordHash:'', isActive:true, managedVesselIds:[], createdAt:'2026-07-21T00:00:00.000Z', updatedAt:'2026-07-21T00:00:00.000Z' },
      { id:'u2', department:'航運處', name:'代管乙', username:'u2', role:'operator', passwordHash:'', isActive:true, managedVesselIds:[], createdAt:'2026-07-21T00:00:00.000Z', updatedAt:'2026-07-21T00:00:00.000Z' },
    ],
    vessels: [{ id:'v1', name:'船一', shortName:'船一', fullName:'船一', shipType:'', fleetCategory:'', fleetTags:[], assignedUserIds:[], delegateManagers:[{ userId:'u1', isActive:true }, { userId:'u2', isActive:false }, { userId:'', isActive:true }, { userId:'u1', isActive:false }], isActive:true, position:{}, cargo:{}, note:{}, weeklyAttention:[], createdAt:'2026-07-21T00:00:00.000Z', updatedAt:'2026-07-21T00:00:00.000Z' }],
    tasks: [], meetings: [], reports: [], notifications: [], auditLogs: [],
  };
  const normalized = normalizeAppData(base);
  assert.deepEqual(normalized.vessels[0].delegateManagers, [{ userId:'u1', isActive:true }, { userId:'u2', isActive:false }], '代管名單需去重、去空值並保留個別激活狀態');
  assert.equal(delegation.hasActiveVesselDelegation(normalized.vessels[0], 'u1'), true, '激活代管人員應取得代管關係');
  assert.equal(delegation.hasActiveVesselDelegation(normalized.vessels[0], 'u2'), false, '未激活代管人員不得取得代管關係');
} finally {
  await server.close();
}

console.log('Delegate vessel management contracts passed.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const vesselDisplay = fs.readFileSync('src/vesselDisplay.ts', 'utf8');

assert.ok(vesselDisplay.includes('dashboardVesselDisplayName'), 'vesselDisplay.ts 必須提供船舶看板專用顯示名稱 helper');
assert.ok(dashboard.includes('dashboardVesselDisplayName'), '船舶看板船名必須使用中文船名優先的 helper');
assert.ok(dashboard.includes('aria-label={`查看 ${dashboardVesselDisplayName(vessel)} 單船詳情`}'), '船舶看板詳情按鈕 aria-label 也必須包含中文船名');
assert.ok(!dashboard.includes('>{vesselDisplayName(vessel)}</button><small>{vessel.shipType}</small>'), '船舶看板卡片不得只顯示英文完整船名');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { dashboardVesselDisplayName } = await server.ssrLoadModule('/src/vesselDisplay.ts');
  assert.equal(
    dashboardVesselDisplayName({ id: 'v001', name: '安華', shortName: 'SA', fullName: 'FPMC S AMBER' }),
    '安華 FPMC S AMBER',
    '有中文船名時，船舶看板須在英文船名前加中文船名',
  );
  assert.equal(
    dashboardVesselDisplayName({ id: 'v002', name: 'F25', shortName: 'F25', fullName: 'FPMC 25' }),
    'FPMC 25',
    '沒有獨立中文船名時不得重複顯示代號',
  );
  assert.equal(
    dashboardVesselDisplayName({ id: 'v003', name: '  ', shortName: 'B104', fullName: 'FPMC B 104' }),
    'FPMC B 104',
    '空白中文船名需回退原本完整船名',
  );
} finally {
  await server.close();
}

console.log('Dashboard Chinese vessel name contracts passed.');

import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { deriveVesselAttention, nextManualVesselAttention, vesselAttentionClass, vesselAttentionLabel } = await server.ssrLoadModule('/src/vesselAttention.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');

  const vessel = (weeklyAttention = [], manualAttentionLevel = '') => ({ id:'v1', weeklyAttention, manualAttentionLevel });
  const task = (overrides = {}) => ({
    id:'t1', vesselId:'v1', priority:'低', isAware:false, isAbnormal:false, isInternalControl:false,
    sourceType:'morning', category:'貨品', categories:['貨品'], description:'例行事項', status:'待執行',
    expectedDate:'', departments:[], ownerUserIds:[], isClosed:false, createdBy:'u1', updatedBy:'u1',
    createdAt:'2026-07-18T00:00:00.000Z', updatedAt:'2026-07-18T00:00:00.000Z', statusLogs:[], ...overrides,
  });

  assert.equal(deriveVesselAttention(vessel(), []).effective, '低', '無未結事項且無燈號時應為低');
  assert.equal(deriveVesselAttention(vessel(['maintenance']), [task()]).automatic, '中', '一般指示燈點亮時至少為中');
  assert.equal(deriveVesselAttention(vessel(['psc-window']), [task()]).automatic, '高', 'PSC 窗口點亮時至少為高');
  assert.equal(deriveVesselAttention(vessel(), [task({ isAbnormal:true })]).automatic, '高', '異常事項至少為高，不應錯算為低');
  assert.equal(deriveVesselAttention(vessel(), [task({ categories:['事故'] })]).automatic, '高', '事故分類至少為高');
  assert.equal(deriveVesselAttention(vessel(), [task({ description:'主機事故待查' })]).automatic, '高', '舊資料內容含事故時至少為高');
  assert.equal(deriveVesselAttention(vessel(['psc-window']), [task({ priority:'急' })]).automatic, '急', '急件仍可高於 PSC 的高下限');

  const protectedResult = deriveVesselAttention(vessel(['psc-window'], '低'), [task()]);
  assert.equal(protectedResult.automatic, '高');
  assert.equal(protectedResult.effective, '高', '手動低不得把 PSC 降到高以下');
  const specialResult = deriveVesselAttention(vessel([], '特別關注'), []);
  assert.equal(specialResult.effective, '特別關注');
  assert.equal(vesselAttentionClass('特別關注'), 'special');
  assert.equal(vesselAttentionLabel(specialResult, []), '手動 特別關注');

  assert.equal(nextManualVesselAttention('', '高'), '高');
  assert.equal(nextManualVesselAttention('高', '高'), '急');
  assert.equal(nextManualVesselAttention('急', '高'), '特別關注');
  assert.equal(nextManualVesselAttention('特別關注', '高'), '');
  assert.equal(nextManualVesselAttention('低', '高'), '', '舊有低手動值遇到高下限時應先回到自動');

  const normalized = normalizeAppData({
    settings:{sitePasswordHash:'x',systemTitle:'x',departments:[],taskCategories:[],vesselStatuses:[],priorities:[],rolePermissions:{},nonOwnerPasswordResetVersion:1,meetingTaskAggregationVersion:1},
    users:[], vessels:[{id:'v1',name:'測試船',manualAttentionLevel:'特別關注',weeklyAttention:[]}], tasks:[], meetings:[], agendaReports:[], auditLogs:[], notifications:[],
  });
  assert.equal(normalized.vessels[0].manualAttentionLevel, '特別關注', '正規化器必须保留特别关注');

  console.log('Vessel attention rule runtime contracts passed.');
} finally {
  await server.close();
}

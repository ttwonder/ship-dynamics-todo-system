import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Real normalization, synthetic data only. No browser/production/cloud access.
// Tracer: a standalone tracking item must survive the normal application read
// without being turned into an internal-control case or an important task.
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createInitialData } = await vite.ssrLoadModule('/src/data/seed.ts');
  const { normalizeAppData } = await vite.ssrLoadModule('/src/normalize.ts');
  const data = createInitialData();
  const at = '2026-09-24T00:00:00.000Z';
  const item = {
    id: 'qa-tracking-standalone', kind: 'supply', vesselId: data.vessels[0].id,
    referenceNo: 'QA-00001', description: '測試配件，尚未同步內控',
    applicationDate: '2026-09-24', urgency: 'normal',
    progress: '', supplementalNotes: '', expectedDate: '',
    deliveryStatus: 'not-delivered', isClosed: false,
    createdBy: 'qa-owner', updatedBy: 'qa-owner', createdAt: at, updatedAt: at,
    statusLogs: [],
  };
  data.trackingItems = [item];
  const before = normalizeAppData({ ...data, trackingItems: [] });
  const result = normalizeAppData(JSON.parse(JSON.stringify(data)));
  assert.ok(result, 'synthetic application snapshot is valid');
  assert.equal(result.trackingItems?.length, 1, 'normal app read must retain the independent tracking item');
  assert.equal(result.trackingItems[0].id, item.id, 'stable source identity survives normalization');
  assert.equal(result.trackingItems[0].referenceNo, 'QA-00001', 'reference number is preserved as text');
  assert.equal(result.trackingItems[0].expectedDate, '', 'DL is optional');
  assert.equal(result.trackingItems[0].isClosed, false, 'no implicit closure');
  assert.deepEqual(result.internalControlCases, before.internalControlCases, 'standalone source creates no case');
  assert.deepEqual(result.tasks, before.tasks, 'standalone source creates no important task');
  const {buildCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudBlockPatch.ts');
  const patch=buildCloudBlockPatch(before,result);
  assert.ok(patch.some(op=>op.kind==='entity'&&op.collection==='trackingItems'&&op.entityId===item.id),'normal record patch must persist independent tracking sources');
  console.log('PASS: standalone tracking normalization and record patch retain identity and optional DL; creates no case/task');
} finally {
  await vite.close();
}

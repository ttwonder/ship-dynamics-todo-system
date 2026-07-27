import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const cloud = await readFile(new URL('../src/cloud.ts', import.meta.url), 'utf8');

assert.match(main, /import App from ['"]\.\/App['"];/,
  'production entry must render the complete accepted App UI');
assert.doesNotMatch(main, /import App from ['"]\.\/NormalizedApp['"];/,
  'the reduced normalized shell must not replace the accepted production UI');

for (const contract of [
  'acquireEditLockBundle',
  'claimEditLock',
  'releaseEditLock',
  'registerTrackedLease',
  'confirmedCloudData',
  'durableCloudRevisionFloors',
  'cloudWriteBlocked',
  'batchManaged',
  '正在保存批量更新',
  '同步最新（安全合併）',
]) {
  assert.ok(app.includes(contract), `complete App must retain collaboration contract: ${contract}`);
}

assert.match(cloud, /\.eq\(['"]revision['"],\s*expectedRevision\)/,
  'cloud saves must retain revision-based CAS');
assert.match(cloud, /CloudConflictError/,
  'cloud saves must surface conflicts rather than silently overwrite');

console.log('Complete production UI and collaboration entry contracts passed.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const recovery=await server.ssrLoadModule('/src/staleBrowserRecovery.ts');
  assert.equal('runStaleBrowserRecovery' in recovery,false,'legacy one-click destructive recovery must not remain available');
  assert.equal('clearStaleBrowserRecoveryState' in recovery,false,'storage deletion belongs to the explicit full-reset module only');

  assert.equal(recovery.shouldOfferStaleBrowserRecovery('authorization'),true,'authorization generation conflicts should offer one-click browser repair');
  for(const kind of ['safety','field','transport']){
    assert.equal(recovery.shouldOfferStaleBrowserRecovery(kind),false,`${kind} failures must not offer destructive browser repair`);
  }

  const app=fs.readFileSync('src/App.tsx','utf8');
  assert.match(app,/import \{ shouldOfferStaleBrowserRecovery \} from '\.\/staleBrowserRecovery';/,'App must retain the tested authorization-failure classifier');
  assert.ok(app.includes('const [staleBrowserRecoveryOffered,setStaleBrowserRecoveryOffered]=useState(false);'),'App must track whether a recoverable authorization conflict is visible');
  assert.ok((app.match(/shouldOfferStaleBrowserRecovery\(/g)||[]).length>=2,'save and sync authorization failures must both offer browser recovery');
  const confirmSnapshotStart=app.indexOf('const confirmCloudSnapshot=');
  const confirmSnapshotEnd=app.indexOf('const releaseBatchEditLockSnapshot=',confirmSnapshotStart);
  const confirmSnapshotSource=app.slice(confirmSnapshotStart,confirmSnapshotEnd);
  assert.ok(!confirmSnapshotSource.includes('setStaleBrowserRecoveryOffered(false);'),'generic bootstrap or realtime cloud reads must not hide an unresolved authorization recovery action');
  assert.match(app,/confirmCloudSnapshot\(activeCloudIdentity\.current,persisted\);\s*setStaleBrowserRecoveryOffered\(false\);/,'a completed durable cloud save must dismiss the stale-browser repair action');
  const syncLatestStart=app.indexOf('const syncLatest = async () =>');
  const syncLatestEnd=app.indexOf('const saveChanges = async () =>',syncLatestStart);
  assert.ok(app.slice(syncLatestStart,syncLatestEnd).includes('setStaleBrowserRecoveryOffered(false);'),'a completed safe sync must dismiss the stale-browser repair action');
  assert.doesNotMatch(app,/runStaleBrowserRecovery\(/,'App must not expose the legacy one-click destructive path');
  assert.ok(app.includes('const openBrowserRecovery=(advanced=false)=>{')&&app.includes('runFullBrowserReset'),'authorization recovery must use the explicit two-level flow');
  assert.match(app,/staleBrowserRecoveryOffered[\s\S]{0,500}<button[^>]*onClick=\{\(\)=>openBrowserRecovery\(true\)\}[^>]*>修復此瀏覽器<\/button>/,'the save strip must open the advanced recovery disclosure');

  console.log('Stale browser recovery storage contracts passed.');
}finally{
  await server.close();
}

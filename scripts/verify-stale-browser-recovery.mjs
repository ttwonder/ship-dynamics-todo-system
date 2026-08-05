import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const recovery=await server.ssrLoadModule('/src/staleBrowserRecovery.ts');
  const values=new Map([
    ['ship-dynamics-app-data-v1','stale-local-draft'],
    ['ship-dynamics-cloud-confirmed-base-v1','stale-confirmed-base'],
    ['ship-dynamics-current-user-v1','stale-user'],
    ['ship-dynamics-cloud-cache-identity-v1','trusted-workspace-binding'],
    ['ship-dynamics-cloud-revision-floors-v1','durable-floor'],
    ['ship-dynamics-supabase-config','cloud-config'],
    ['unrelated-site-key','keep-me'],
  ]);
  let clearCalls=0;
  const storage={
    getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key),
    clear:()=>{clearCalls+=1;values.clear();},
  };

  const result=recovery.clearStaleBrowserRecoveryState(storage);
  assert.deepEqual(result,{ok:true,removedKeys:[
    'ship-dynamics-app-data-v1',
    'ship-dynamics-cloud-confirmed-base-v1',
    'ship-dynamics-current-user-v1',
  ]});
  assert.equal(values.has('ship-dynamics-app-data-v1'),false);
  assert.equal(values.has('ship-dynamics-cloud-confirmed-base-v1'),false);
  assert.equal(values.has('ship-dynamics-current-user-v1'),false);
  assert.equal(values.get('ship-dynamics-cloud-cache-identity-v1'),'trusted-workspace-binding','workspace identity binding must survive browser recovery');
  assert.equal(values.get('ship-dynamics-cloud-revision-floors-v1'),'durable-floor','durable rollback floor must survive browser recovery');
  assert.equal(values.get('ship-dynamics-supabase-config'),'cloud-config','cloud configuration must survive browser recovery');
  assert.equal(values.get('unrelated-site-key'),'keep-me','unrelated browser data must survive browser recovery');
  assert.equal(clearCalls,0,'browser recovery must never call localStorage.clear()');

  const failingStorage={
    getItem:()=>null,
    setItem:()=>{},
    removeItem:key=>{if(key==='ship-dynamics-cloud-confirmed-base-v1')throw new Error('quota failure');},
    clear:()=>{throw new Error('must not clear all storage');},
  };
  const failed=recovery.clearStaleBrowserRecoveryState(failingStorage);
  assert.equal(failed.ok,false,'storage cleanup failure must be reported so the UI does not reload or claim success');
  assert.equal(failed.failedKey,'ship-dynamics-cloud-confirmed-base-v1');

  assert.equal(recovery.shouldOfferStaleBrowserRecovery('authorization'),true,'authorization generation conflicts should offer one-click browser repair');
  for(const kind of ['safety','field','transport']){
    assert.equal(recovery.shouldOfferStaleBrowserRecovery(kind),false,`${kind} failures must not offer destructive browser repair`);
  }

  const cancelledValues=new Map([['ship-dynamics-app-data-v1','keep-on-cancel']]);
  let cancelledReloads=0;
  const cancelled=recovery.runStaleBrowserRecovery({
    storage:{removeItem:key=>cancelledValues.delete(key)},
    confirm:()=>false,
    reload:()=>{cancelledReloads+=1;},
  });
  assert.equal(cancelled.status,'cancelled');
  assert.equal(cancelledValues.get('ship-dynamics-app-data-v1'),'keep-on-cancel');
  assert.equal(cancelledReloads,0);

  let failureReloads=0;
  const failedRun=recovery.runStaleBrowserRecovery({
    storage:failingStorage,
    confirm:message=>{
      assert.match(message,/雲端資料.*不受影響/,'confirmation must explain that durable cloud data is untouched');
      assert.match(message,/未上傳.*無法復原/,'confirmation must explain the local draft loss boundary');
      return true;
    },
    reload:()=>{failureReloads+=1;},
  });
  assert.equal(failedRun.status,'failed');
  assert.equal(failureReloads,0,'failed selective cleanup must never reload');

  const successValues=new Map([
    ['ship-dynamics-app-data-v1','discard'],
    ['ship-dynamics-cloud-confirmed-base-v1','discard'],
    ['ship-dynamics-current-user-v1','discard'],
    ['ship-dynamics-cloud-revision-floors-v1','keep'],
  ]);
  let successReloads=0;
  const successOrder=[];
  const succeeded=recovery.runStaleBrowserRecovery({
    storage:{removeItem:key=>{successOrder.push(`remove:${key}`);successValues.delete(key);}},
    confirm:()=>{successOrder.push('confirm');return true;},
    beforeReload:()=>{successOrder.push('before-reload');},
    reload:()=>{successOrder.push('reload');successReloads+=1;},
  });
  assert.equal(succeeded.status,'reloading');
  assert.equal(successReloads,1,'successful selective cleanup should reload exactly once');
  assert.equal(successValues.get('ship-dynamics-cloud-revision-floors-v1'),'keep');
  assert.deepEqual(successOrder,[
    'confirm',
    'remove:ship-dynamics-app-data-v1',
    'remove:ship-dynamics-cloud-confirmed-base-v1',
    'remove:ship-dynamics-current-user-v1',
    'before-reload',
    'reload',
  ],'session invalidation and unload-warning cleanup must happen after selective storage cleanup and before reload');

  const app=fs.readFileSync('src/App.tsx','utf8');
  assert.match(app,/import \{[^}]*runStaleBrowserRecovery[^}]*shouldOfferStaleBrowserRecovery[^}]*\} from '\.\/staleBrowserRecovery';/,'App must use the tested recovery helpers');
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
  assert.ok(app.includes('const repairStaleBrowser=()=>{')&&app.includes('runStaleBrowserRecovery({'),'App must expose a tested one-click repair handler');
  assert.ok(app.includes('hasUnsavedWork.current=false;')&&app.includes('identitySessionGeneration.current+=1;'),'intentional repair must disable unload warnings and invalidate the stale identity session before reload');
  assert.ok(app.includes("if(result.status==='failed')")&&app.includes('無法清除這台瀏覽器的舊暫存'),'storage cleanup failure must stay on-page with a plain-language error');
  assert.match(app,/staleBrowserRecoveryOffered&&<button[^>]*onClick=\{repairStaleBrowser\}[^>]*>修復此瀏覽器<\/button>/,'the save strip must offer a one-click repair button only when recovery is relevant');

  console.log('Stale browser recovery storage contracts passed.');
}finally{
  await server.close();
}

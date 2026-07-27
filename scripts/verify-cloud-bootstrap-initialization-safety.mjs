import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const {
    mayOfferFirstRunInitialization,
    mayPersistLocalSnapshot,
    trustedMatchingCloudIdentity,
  } = await server.ssrLoadModule('/src/cloudBootstrapSafety.ts');

  const freshConfiguredBrowser = {
    cloudConfigured: true,
    cloudBootstrapped: false,
    cloudWriteBlocked: false,
    activeCloudIdentity: '',
    currentCloudIdentity: 'cloud-workspace-v2:trusted',
    cloudInitializationAllowed: false,
    localInitializationAllowed: false,
  };
  assert.equal(
    mayPersistLocalSnapshot(freshConfiguredBrowser),
    false,
    'a fresh cloud-configured browser must not persist seed data before cloud bootstrap',
  );
  assert.equal(
    mayOfferFirstRunInitialization(freshConfiguredBrowser),
    false,
    'a fresh cloud-configured browser must not offer first-run setup before cloud bootstrap',
  );

  const failedBootstrap = {
    ...freshConfiguredBrowser,
    cloudBootstrapped: true,
    cloudWriteBlocked: true,
  };
  assert.equal(
    mayPersistLocalSnapshot(failedBootstrap),
    false,
    'a failed cloud bootstrap must not persist seed data',
  );
  assert.equal(
    mayOfferFirstRunInitialization(failedBootstrap),
    false,
    'a failed cloud bootstrap must never expose site-password or Owner initialization',
  );

  const trustedExistingCloud = {
    ...freshConfiguredBrowser,
    cloudBootstrapped: true,
    activeCloudIdentity: 'cloud-workspace-v2:trusted',
  };
  assert.equal(mayPersistLocalSnapshot(trustedExistingCloud), true);
  assert.equal(
    mayOfferFirstRunInitialization(trustedExistingCloud),
    false,
    'an existing trusted cloud workspace may cache data but must not be treated as a new installation',
  );

  const trustedDirtyConflict = {
    ...trustedExistingCloud,
    cloudWriteBlocked: true,
  };
  assert.equal(
    mayPersistLocalSnapshot(trustedDirtyConflict),
    true,
    'trusted local work must remain cached while a same-workspace cloud conflict is blocked',
  );
  assert.equal(mayOfferFirstRunInitialization(trustedDirtyConflict), false);

  const changedWorkspace = {
    ...trustedExistingCloud,
    currentCloudIdentity: 'cloud-workspace-v2:other',
  };
  assert.equal(
    mayPersistLocalSnapshot(changedWorkspace),
    false,
    'a captured cloud identity must never persist into a different current workspace',
  );

  const confirmedEmptyCloud = {
    ...trustedExistingCloud,
    cloudInitializationAllowed: true,
  };
  assert.equal(
    mayOfferFirstRunInitialization(confirmedEmptyCloud),
    false,
    'a production cloud workspace with missing main data must require controlled recovery, not browser initialization',
  );

  assert.equal(
    trustedMatchingCloudIdentity('cloud-workspace-v2:trusted', 'cloud-workspace-v2:trusted'),
    'cloud-workspace-v2:trusted',
  );
  assert.equal(trustedMatchingCloudIdentity('', 'cloud-workspace-v2:trusted'), '');
  assert.equal(trustedMatchingCloudIdentity('cloud-workspace-v2:other', 'cloud-workspace-v2:trusted'), '');

  const localOnly = {
    cloudConfigured: false,
    cloudBootstrapped: true,
    cloudWriteBlocked: false,
    activeCloudIdentity: '',
    currentCloudIdentity: '',
    cloudInitializationAllowed: true,
    localInitializationAllowed: false,
  };
  assert.equal(mayPersistLocalSnapshot(localOnly), false);
  assert.equal(mayOfferFirstRunInitialization(localOnly), false);

  const localDevelopment = {
    ...localOnly,
    localInitializationAllowed: true,
  };
  assert.equal(mayPersistLocalSnapshot(localDevelopment), true);
  assert.equal(mayOfferFirstRunInitialization(localDevelopment), true);

  const app = readFileSync('src/App.tsx', 'utf8');
  assert.ok(
    app.includes('mayPersistLocalSnapshot({') && app.includes('saveLocal(data);'),
    'App local persistence must use the cloud-bootstrap safety decision',
  );
  assert.ok(
    app.includes('mayOfferFirstRunInitialization({')
      && app.includes('雲端主資料尚未通過首次初始化安全檢查')
      && app.includes('已阻止設定進站密碼或建立 Owner'),
    'App must replace unsafe SiteGate/OwnerSetup with a fail-closed screen',
  );
  assert.ok(
    app.includes('setCloudInitializationAllowed(true)')
      && app.includes('setCloudInitializationAllowed(false)'),
    'cloud initialization permission must be explicit and default-deny',
  );
  assert.ok(
    app.includes('import.meta.env.DEV')
      && app.includes('正式環境未載入 Supabase 設定，已禁止本機初始化')
      && app.includes('雲端工作區沒有主資料，已禁止從瀏覽器初始化'),
    'production must fail closed when config or cloud main data is missing',
  );
  assert.ok(
    app.includes('trustedMatchingCloudIdentity(cachedIdentity,identity)')
      && app.includes('activeCloudIdentity.current=trustedLocalIdentity'),
    'trusted same-workspace divergent data must remain eligible for local cache persistence',
  );
  const syncLatestSource = app.slice(
    app.indexOf('const syncLatest = async () => {'),
    app.indexOf('const saveChanges = async () => {'),
  );
  const emptyRemoteBranch = syncLatestSource.slice(
    syncLatestSource.indexOf('if(durableRevisionFloor>=0)'),
    syncLatestSource.indexOf('} catch (error: any)'),
  );
  assert.ok(
    syncLatestSource.length > 0
      && emptyRemoteBranch.includes("throw new CloudRebaseConflictError(['雲端工作區沒有主資料，已禁止從瀏覽器初始化'])")
      && !emptyRemoteBranch.includes('activeCloudIdentity.current')
      && !emptyRemoteBranch.includes('lastCloudRevision.current = -1')
      && !emptyRemoteBranch.includes('confirmedCloudData.current = null')
      && !emptyRemoteBranch.includes('setCloudWriteBlocked(false)')
      && !emptyRemoteBranch.includes('rememberCloudIdentity()')
      && !app.includes('雲端尚無資料；已允許以目前本機資料初始化'),
    'manual sync empty-remote branch must never bind identity, unlock writes, or initialize production cloud data',
  );
  assert.equal(
    app.match(/currentCloudIdentity:\s*cloudIdentity\(getSupabaseConfig\(\)\)/g)?.length,
    2,
    'local persistence and first-run setup must compare the same workspace-identity type stored in activeCloudIdentity',
  );

  console.log('Cloud bootstrap initialization safety contracts passed.');
} finally {
  await server.close();
}

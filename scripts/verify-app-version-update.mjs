import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const module=await server.ssrLoadModule('/src/appVersionUpdate.ts');
  const {
    APP_VERSION_CHECK_INTERVAL_MS,
    APP_VERSION_QUERY_KEY,
    APP_RECOVERY_QUERY_KEY,
    appRecoveryReloadUrl,
    appUpdateBlockReason,
    appVersionManifestUrl,
    appVersionReloadUrl,
    checkForAppVersion,
  }=module;

  assert.equal(APP_VERSION_CHECK_INTERVAL_MS,300_000,'version polling must use a quiet five-minute cadence');
  assert.equal(APP_VERSION_QUERY_KEY,'__ship_dynamics_version');
  assert.equal(APP_RECOVERY_QUERY_KEY,'__ship_dynamics_repair');
  assert.equal(appVersionManifestUrl('/ship-dynamics/','123'),'/ship-dynamics/app-version.json?check=123');
  assert.equal(appVersionManifestUrl('/','a b'),'/app-version.json?check=a+b');

  let request;
  const available=await checkForAppVersion({
    currentVersion:'build-old',
    baseUrl:'/ship-dynamics/',
    nonce:'probe',
    fetchImpl:async(url,init)=>{
      request={url:String(url),init};
      return {ok:true,json:async()=>({version:'build-new'})};
    },
  });
  assert.deepEqual(available,{status:'available',version:'build-new'});
  assert.equal(request.url,'/ship-dynamics/app-version.json?check=probe');
  assert.equal(request.init.cache,'no-store');
  assert.equal(request.init.credentials,'same-origin');
  assert.equal(request.init.headers.Accept,'application/json');

  const current=await checkForAppVersion({
    currentVersion:'build-same',baseUrl:'/',nonce:1,
    fetchImpl:async()=>({ok:true,json:async()=>({version:'build-same'})}),
  });
  assert.deepEqual(current,{status:'current'});
  for(const fetchImpl of [
    async()=>({ok:false,json:async()=>({version:'build-new'})}),
    async()=>({ok:true,json:async()=>({version:'not valid / version'})}),
    async()=>{throw new Error('offline');},
  ]){
    assert.deepEqual(await checkForAppVersion({currentVersion:'build-old',baseUrl:'/',nonce:2,fetchImpl}),{status:'unavailable'},'network, HTTP, and malformed manifests must stay silent');
  }

  const clean={hasUnsavedWork:false,pendingSaveCount:0,saveInFlight:false,syncInFlight:false,saveTimerScheduled:false,savePhase:'saved',hasActiveEditLock:false,batchEditorActive:false};
  assert.equal(appUpdateBlockReason(clean),null);
  assert.equal(appUpdateBlockReason({...clean,hasUnsavedWork:true}),'unsaved');
  assert.equal(appUpdateBlockReason({...clean,savePhase:'dirty'}),'unsaved');
  assert.equal(appUpdateBlockReason({...clean,savePhase:'error'}),null,'a bootstrap or configuration error without local changes must not trap the browser on an old build');
  assert.equal(appUpdateBlockReason({...clean,savePhase:'error',hasUnsavedWork:true}),'unsaved');
  assert.equal(appUpdateBlockReason({...clean,pendingSaveCount:1}),'saving');
  assert.equal(appUpdateBlockReason({...clean,saveInFlight:true}),'saving');
  assert.equal(appUpdateBlockReason({...clean,syncInFlight:true}),'saving');
  assert.equal(appUpdateBlockReason({...clean,saveTimerScheduled:true}),'saving');
  assert.equal(appUpdateBlockReason({...clean,savePhase:'queued'}),'saving');
  assert.equal(appUpdateBlockReason({...clean,savePhase:'saving'}),'saving');
  assert.equal(appUpdateBlockReason({...clean,hasActiveEditLock:true}),'editing');
  assert.equal(appUpdateBlockReason({...clean,batchEditorActive:true}),'editing');

  const reloadUrl=appVersionReloadUrl('https://example.test/ship/?tab=work#item','build-new');
  const parsed=new URL(reloadUrl);
  assert.equal(parsed.pathname,'/ship/');
  assert.equal(parsed.searchParams.get('tab'),'work');
  assert.equal(parsed.searchParams.get(APP_VERSION_QUERY_KEY),'build-new');
  assert.equal(parsed.hash,'#item');
  assert.throws(()=>appVersionReloadUrl('https://example.test/','bad version/'),/invalid/i);

  const recoveryUrl=appRecoveryReloadUrl('https://example.test/ship/?tab=work#item','build-new','repair-123');
  const recoveryParsed=new URL(recoveryUrl);
  assert.equal(recoveryParsed.pathname,'/ship/');
  assert.equal(recoveryParsed.searchParams.get('tab'),'work');
  assert.equal(recoveryParsed.searchParams.get(APP_VERSION_QUERY_KEY),'build-new');
  assert.equal(recoveryParsed.searchParams.get(APP_RECOVERY_QUERY_KEY),'repair-123');
  assert.equal(recoveryParsed.hash,'#item');
  assert.throws(()=>appRecoveryReloadUrl('https://example.test/','build-new','bad token/'),/invalid/i);

  const viteConfig=fs.readFileSync(new URL('../vite.config.ts',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(viteConfig,/app-version\.json/,'build must emit a version manifest');
  assert.match(viteConfig,/Cache-Control.*no-store/,'dev manifest must not be cached');
  assert.match(viteConfig,/__SHIP_DYNAMICS_BUILD_VERSION__/,'runtime and manifest must share one build id');
  assert.match(app,/checkForAppVersion/,'App must poll the independent version manifest');
  assert.match(app,/visibilitychange/,'App must recheck when a background tab becomes visible');
  assert.match(app,/addEventListener\('focus'/,'App must recheck when the window regains focus');
  assert.match(app,/APP_VERSION_CHECK_INTERVAL_MS/,'App must use the bounded polling interval');
  assert.match(app,/系統已有新版本/);
  assert.match(app,/立即更新/);
  assert.match(app,/目前有未保存內容或正在編輯/);
  assert.match(app,/目前未偵測到保存中或未保存修改/,'ready copy must describe detection rather than promise that no child form draft exists');
  const updateHandlerStart=app.indexOf('const applyAppUpdate=()=>');
  const updateHandlerEnd=app.indexOf('const dashboardMeetings',updateHandlerStart);
  assert.ok(updateHandlerStart>=0&&updateHandlerEnd>updateHandlerStart,'version update handler must be reachable');
  const updateHandler=app.slice(updateHandlerStart,updateHandlerEnd);
  assert.match(updateHandler,/document\.querySelector\('\[role="dialog"\],\.modal-backdrop'/,'open draft dialogs must block reload at click time');
  assert.doesNotMatch(app,/localStorage\.clear\(/,'version updates must never clear App state');
  assert.doesNotMatch(updateHandler,/location\.reload\(\)/,'version updates must use a cache-busting URL');
  assert.match(css,/\.app-version-update/,'version notice needs a compact dedicated style');
}finally{
  await server.close();
}
console.log('App version update contracts passed.');

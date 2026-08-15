import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const storageFor=(values,failKey='')=>{
  let clearCalls=0;
  return{
    storage:{
      get length(){return values.size;},
      key:index=>Array.from(values.keys())[index]??null,
      getItem:key=>values.get(key)??null,
      setItem:(key,value)=>values.set(key,String(value)),
      removeItem:key=>{if(key===failKey)throw new Error('remove failed');values.delete(key);},
      clear:()=>{clearCalls+=1;values.clear();},
    },
    clearCalls:()=>clearCalls,
  };
};

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const recovery=await server.ssrLoadModule('/src/browserRecovery.ts');

  const hazardousUnloadState={hasUnsavedWork:true,savePhaseSaved:false,saveTimerPending:true,pendingCloudDataCount:1,pendingTaskCreationCount:1};
  assert.equal(recovery.shouldBlockAppBeforeUnload({...hazardousUnloadState,recoveryNavigation:false}),true,'ordinary error/pending state must retain the existing unload warning');
  assert.equal(recovery.shouldBlockAppBeforeUnload({...hazardousUnloadState,recoveryNavigation:true}),false,'an explicitly selected recovery navigation must not be trapped by the App unload warning');

  const localValues=new Map([
    ['ship-dynamics-app-data-v1','discard'],
    ['ship-dynamics-current-user-v1','discard'],
    ['ship-dynamics.pending-task-creation.v1:broken','discard'],
    ['ship-dynamics-cloud-cache-identity-v1','discard'],
    ['ship-dynamics-cloud-revision-floors-v1','discard'],
    ['ship-dynamics-supabase-config','discard'],
    ['ship-dynamics2-app-data-v1','keep-near-prefix'],
    ['other-project-key','keep'],
  ]);
  const sessionValues=new Map([
    ['ship-dynamics-site-unlocked-v1','discard'],
    ['ship-dynamics2-session','keep-near-prefix'],
    ['other-project-session','keep'],
  ]);
  const local=storageFor(localValues);
  const session=storageFor(sessionValues);
  const cleared=recovery.clearShipDynamicsBrowserStorage({localStorage:local.storage,sessionStorage:session.storage});
  assert.equal(cleared.status,'cleared');
  assert.deepEqual(Array.from(localValues.entries()),[['ship-dynamics2-app-data-v1','keep-near-prefix'],['other-project-key','keep']]);
  assert.deepEqual(Array.from(sessionValues.entries()),[['ship-dynamics2-session','keep-near-prefix'],['other-project-session','keep']]);
  assert.equal(local.clearCalls(),0,'must not call localStorage.clear()');
  assert.equal(session.clearCalls(),0,'must not call sessionStorage.clear()');

  const failingLocalValues=new Map([
    ['ship-dynamics-app-data-v1','discarded-first'],
    ['ship-dynamics-current-user-v1','fails'],
    ['other-project-key','keep'],
  ]);
  const failingLocal=storageFor(failingLocalValues,'ship-dynamics-current-user-v1');
  const untouchedSessionValues=new Map([['ship-dynamics-site-unlocked-v1','keep-after-failure']]);
  const untouchedSession=storageFor(untouchedSessionValues);
  const failed=recovery.clearShipDynamicsBrowserStorage({localStorage:failingLocal.storage,sessionStorage:untouchedSession.storage});
  assert.deepEqual(failed,{
    status:'failed',
    area:'localStorage',
    failedKey:'ship-dynamics-current-user-v1',
    removedLocalStorageKeys:['ship-dynamics-app-data-v1'],
    removedSessionStorageKeys:[],
  });
  assert.equal(untouchedSessionValues.get('ship-dynamics-site-unlocked-v1'),'keep-after-failure');
  assert.equal(failingLocalValues.get('other-project-key'),'keep');

  const deletedCaches=[];
  const cacheStorage={
    keys:async()=>['ship-dynamics-static-v1','ship-dynamics2-static','other-project-static','ship-dynamics:runtime'],
    delete:async name=>{deletedCaches.push(name);return true;},
  };
  const workerEvents=[];
  const registration=scope=>({scope,unregister:async()=>{workerEvents.push(scope);return true;}});
  const appWorker=registration('https://ttwonder.github.io/ship-dynamics/');
  const nestedAppWorker=registration('https://ttwonder.github.io/ship-dynamics/tools/');
  const rootWorker=registration('https://ttwonder.github.io/');
  const siblingWorker=registration('https://ttwonder.github.io/psc-atlas/');
  const repaired=await recovery.repairShipDynamicsResources({
    appBaseUrl:'/ship-dynamics/',
    origin:'https://ttwonder.github.io',
    cacheStorage,
    serviceWorkerContainer:{getRegistrations:async()=>[appWorker,nestedAppWorker,rootWorker,siblingWorker]},
  });
  assert.deepEqual(deletedCaches,['ship-dynamics-static-v1','ship-dynamics:runtime']);
  assert.deepEqual(workerEvents,[appWorker.scope,nestedAppWorker.scope]);
  assert.deepEqual(repaired,{deletedCacheNames:deletedCaches,unregisteredWorkerScopes:workerEvents});

  let rootUnregisterCalls=0;
  await recovery.repairShipDynamicsResources({
    appBaseUrl:'/',
    origin:'https://ttwonder.github.io',
    cacheStorage:null,
    serviceWorkerContainer:{getRegistrations:async()=>[{scope:'https://ttwonder.github.io/',unregister:async()=>{rootUnregisterCalls+=1;return true;}}]},
  });
  assert.equal(rootUnregisterCalls,0,'root-scoped workers must remain untouched');

  await assert.rejects(
    recovery.repairShipDynamicsResources({
      appBaseUrl:'/ship-dynamics/',
      origin:'https://ttwonder.github.io',
      cacheStorage:{keys:async()=>['ship-dynamics-static-v1'],delete:async()=>false},
      serviceWorkerContainer:null,
    }),
    /Cache Storage/,
  );

  const {default:BrowserRecoveryModal}=await server.ssrLoadModule('/src/BrowserRecoveryModal.tsx');
  const baseModalProps={
    phase:'idle',
    message:'',
    onClose:()=>{},
    onToggleAdvanced:()=>{},
    onSafeRepair:()=>{},
    onFullReset:()=>{},
  };
  const safeMarkup=renderToStaticMarkup(React.createElement(BrowserRecoveryModal,{...baseModalProps,advanced:false}));
  assert.match(safeMarkup,/安全重新載入最新版/);
  assert.match(safeMarkup,/不會刪除登入、業務資料或其他專案資料/);
  assert.match(safeMarkup,/尚未保存.*可能遺失/,'resource repair must disclose that navigation can discard in-memory edits');
  assert.doesNotMatch(safeMarkup,/確認完整重設/,'destructive action must stay behind the advanced disclosure');
  const advancedMarkup=renderToStaticMarkup(React.createElement(BrowserRecoveryModal,{...baseModalProps,advanced:true}));
  assert.match(advancedMarkup,/完整重設Ship Dynamics本機資料/);
  assert.match(advancedMarkup,/AppData、登入、進站狀態、草稿與pending資料/);
  assert.match(advancedMarkup,/Supabase雲端資料、GitHub程式及同網域其他專案/);
  assert.match(advancedMarkup,/確認完整重設/);

  const app=fs.readFileSync('src/App.tsx','utf8');
  const boundary=fs.readFileSync('src/ErrorBoundary.tsx','utf8');
  const css=fs.readFileSync('src/styles.css','utf8');
  const packageJson=JSON.parse(fs.readFileSync('package.json','utf8'));
  assert.match(app,/import \{ shouldOfferStaleBrowserRecovery \} from '\.\/staleBrowserRecovery';/);
  assert.match(app,/repairShipDynamicsResources/);
  assert.match(app,/clearShipDynamicsBrowserStorage/);
  assert.match(app,/appRecoveryReloadUrl/);
  assert.match(app,/const browserRecoveryNavigationRef=useRef\(false\)/);
  assert.match(app,/shouldBlockAppBeforeUnload\(\{[\s\S]{0,500}recoveryNavigation:browserRecoveryNavigationRef\.current/,'beforeunload must recognize deliberate recovery navigation');
  assert.doesNotMatch(app,/runStaleBrowserRecovery\(/,'the legacy destructive one-click path must not remain reachable');
  const safeHandler=app.slice(app.indexOf('const runSafeBrowserRepair='),app.indexOf('const runFullBrowserReset='));
  assert.match(safeHandler,/repairCurrentAppResources/);
  assert.match(safeHandler,/browserRecoveryNavigationRef\.current=true;[\s\S]{0,300}window\.location\.assign/);
  assert.match(safeHandler,/catch\(error\)\{[\s\S]{0,100}browserRecoveryNavigationRef\.current=false;/);
  assert.doesNotMatch(safeHandler,/clearShipDynamicsBrowserStorage|localStorage\.removeItem|sessionStorage\.removeItem/,'safe repair must preserve all storage');
  const resetHandler=app.slice(app.indexOf('const runFullBrowserReset='),app.indexOf('const syncLatest = async'));
  assert.match(resetHandler,/window\.confirm/,'full reset needs an explicit destructive confirmation');
  assert.match(resetHandler,/await repairCurrentAppResources\(\)/);
  assert.match(resetHandler,/clearShipDynamicsBrowserStorage/);
  assert.match(resetHandler,/browserRecoveryNavigationRef\.current=true;[\s\S]{0,300}window\.location\.assign\(resetUrl\)/);
  assert.match(resetHandler,/catch\(error\)\{[\s\S]{0,100}browserRecoveryNavigationRef\.current=false;/);
  assert.match(resetHandler,/window\.location\.assign\(resetUrl\)/);
  assert.doesNotMatch(resetHandler,/fetchCloudData|confirmedCloudData|pendingTaskCreationInFlight|withPendingTaskCreationStorageLock|activeEditLockRef|leaseCloudConfigs|browserRecoveryHasProtectedDraft/,'explicit destructive reset must not reintroduce cloud, pending, draft, or lease verification');
  assert.doesNotMatch(app,/localStorage\.clear\(|sessionStorage\.clear\(/);
  assert.match(app,/tab===['"]dashboard['"][\s\S]{0,500}>修復此瀏覽器<\/button>/,'dashboard header must expose the recovery entry');
  assert.match(app,/staleBrowserRecoveryOffered\?'red':'ghost'/,'authorization recovery must keep a visible red warning state');
  const openRecoveryHandler=app.slice(app.indexOf('const openBrowserRecovery='),app.indexOf('const closeBrowserRecovery='));
  assert.match(openRecoveryHandler,/const openBrowserRecovery=\(\)=>\{[\s\S]*setBrowserRecoveryAdvanced\(true\)/,'every recovery-dialog entry must show the complete-reset section immediately');
  assert.doesNotMatch(openRecoveryHandler,/advanced=false|setBrowserRecoveryAdvanced\(advanced\)/,'ordinary dashboard entry must not reopen the advanced section collapsed');
  assert.match(app,/onClick=\{\(\)=>openBrowserRecovery\(\)\}/,'dashboard recovery entry must use the always-expanded opening flow');
  assert.match(app,/browserRecoveryOpen&&<BrowserRecoveryModal/);

  assert.match(boundary,/repairShipDynamicsResources/,'outer render failures need the same resource-only repair');
  assert.match(boundary,/appRecoveryReloadUrl/,'outer recovery must use a cache-busting URL');
  assert.doesNotMatch(boundary,/clearShipDynamicsBrowserStorage|localStorage|sessionStorage|完整重設/,'outer failure recovery must remain non-destructive');
  assert.equal(packageJson.scripts['test:browser-recovery'],'node scripts/verify-browser-recovery.mjs');
  assert.match(css,/\.browser-recovery-modal/);
  assert.match(css,/\.browser-recovery-modal\{[^}]*max-height:calc\(100vh - 32px\)[^}]*overflow-y:auto/,'expanded recovery modal must remain usable in short viewports');
  assert.match(css,/\.browser-recovery-impact/);
  assert.match(css,/@media\(max-width:600px\)[^{]*\{[^}]*\.browser-recovery-impact\{grid-template-columns:1fr\}/,'destructive impact summary must stack on narrow screens');
}finally{
  await server.close();
}
console.log('Browser recovery core contracts passed.');

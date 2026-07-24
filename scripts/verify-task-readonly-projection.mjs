import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const projection = await server.ssrLoadModule('/src/taskReadOnlyProjection.ts');
  const appRuntime = await server.ssrLoadModule('/src/App.tsx');
  const { projectTaskForVisibleVessels, buildTaskReadOnlyEditorData } = projection;
  const { createTaskOpenRequestCoordinator, createAsyncConfigCoordinator, scheduleValidatedLeaseExpiry, transitionExpiredTaskLease, internalControlDeletionAuthorized, cloudIdentity } = appRuntime;
  const localValues = new Map();
  const sessionValues = new Map();
  const storage = values => ({
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  globalThis.localStorage = storage(localValues);
  globalThis.sessionStorage = storage(sessionValues);
  globalThis.window = { SHIP_DYNAMICS_SUPABASE_CONFIG: undefined };
  assert.equal(cloudIdentity(null), '', 'local mode must have a stable empty cloud identity');
  assert.doesNotThrow(() => {
    const html = renderToString(React.createElement(appRuntime.default));
    assert.match(html, /正在載入雲端主資料/);
  }, 'App must render safely with no Supabase config');
  const task = {
    id:'task-secret-scope', vesselId:'visible-vessel', vesselIds:['visible-vessel','hidden-vessel'],
    vesselScopeMode:'all', vesselTypeScopes:['hidden-type'],
    vesselProgress:[
      { vesselId:'visible-vessel', status:'visible status', isClosed:true, closedDate:'2026-07-23', closedBy:'visible-closer', updatedAt:'2026-07-24T01:00:00.000Z', updatedBy:'visible-updater', statusLogs:[{id:'visible-log',at:'2026-07-24T01:00:00.000Z',by:'Visible',text:'visible status'}] },
      { vesselId:'hidden-vessel', status:'hidden status', isClosed:false, statusLogs:[{id:'hidden-log',at:'2026-07-24T01:00:00.000Z',by:'Hidden',text:'hidden status'}] },
    ],
    description:'scope test', category:'其他', categories:['其他'], priority:'中', departments:['海務'], ownerUserIds:['secret-owner'],
    sourceType:'temporary', attentionDimension:'meeting', sourceMeetingId:'secret-meeting', sourceMeetingItemId:'secret-item', distributeToVessels:true,
    isAware:false, isAbnormal:false, isInternalControl:true, status:'overall secret', statusLogs:[{id:'overall-log',at:'2026-07-24T00:00:00.000Z',by:'Overall',text:'overall secret'}], isClosed:false,
    expectedDate:'2026-07-31', reportDate:'2026-07-24', createdBy:'secret-creator', updatedBy:'secret-updater', createdAt:'2026-07-24T00:00:00.000Z', updatedAt:'2026-07-24T00:00:00.000Z',
  };
  const visibleVessel = { id:'visible-vessel', name:'可見船', shortName:'可見', fullName:'VISIBLE', shipType:'散貨船', isActive:true, assignedUserIds:['secret-user'], managedVesselIds:['secret-managed'], position:{location:'secret-position'} };
  const hiddenVessel = { id:'hidden-vessel', name:'隱藏船', shortName:'隱藏', fullName:'HIDDEN', shipType:'油輪', isActive:true };
  const sourceData = {
    revision:17, updatedAt:'2026-07-24T00:00:00.000Z',
    settings:{
      priorities:['急','高','中','低'], departments:['海務'], taskCategories:['其他'], meetingTaskCategories:['機密會議分類'], equipmentFailureSubcategories:['設備'],
      sitePasswordHash:'secret-password', systemTitle:'secret-title', rolePermissions:{secret:true}, lastCloudSyncAt:'secret-sync', vesselStatuses:['loading'],
    },
    users:[{id:'secret-user',name:'Secret User',passwordHash:'secret-password'}], vessels:[visibleVessel,hiddenVessel], tasks:[task],
    meetings:[{id:'secret-meeting'}], internalControlCases:[{id:'secret-case'}], agendaReports:[{id:'secret-report'}], auditLogs:[{id:'secret-audit'}], notifications:[{id:'secret-notification'}],
  };

  const projected = projectTaskForVisibleVessels(task, ['visible-vessel']);
  assert.equal(projected.vesselId, 'visible-vessel');
  assert.equal(projected.status, 'visible status', 'single-vessel read-only projection must use that vessel status, never aggregate status');
  assert.equal(projected.isClosed, true);
  assert.equal(projected.closedDate, '2026-07-23');
  for (const forbidden of ['vesselIds','vesselTypeScopes','vesselProgress','vesselScopeMode','sourceMeetingId','sourceMeetingItemId','distributeToVessels']) {
    assert.equal(Object.hasOwn(projected, forbidden), false, `${forbidden} must not survive the read-only task whitelist`);
  }
  assert.equal(projected.sourceType, 'morning', 'source existence must be neutralized in read-only data');
  assert.equal(projected.attentionDimension, 'task', 'source scope metadata must be neutralized');
  assert.equal(projected.isInternalControl, false, 'internal-control existence must be neutralized');
  assert.deepEqual(projected.ownerUserIds, [], 'opaque user IDs are not required by the read-only editor');
  assert.ok(!JSON.stringify(projected).includes('hidden-vessel') && !JSON.stringify(projected).includes('hidden status') && !JSON.stringify(projected).includes('hidden-type') && !JSON.stringify(projected).includes('overall secret') && !JSON.stringify(projected).includes('secret-meeting'), 'serialized projected task must contain no hidden, aggregate, or source-scope signals');
  assert.throws(()=>projectTaskForVisibleVessels(task, []), /可見船舶範圍/, 'projection with no authorized vessel must fail closed');
  assert.throws(()=>projectTaskForVisibleVessels(task, ['visible-vessel','hidden-vessel']), /單一可見船舶/, 'read-only editor projection must never expose all-vessel counts');

  const editorData = buildTaskReadOnlyEditorData(sourceData, task, 'visible-vessel');
  assert.deepEqual(Object.keys(editorData).sort(), ['revision','settings','tasks','users','vessels'].sort(), 'read-only editor receives only its explicit top-level whitelist');
  assert.deepEqual(editorData.users, [], 'full users must never enter read-only editor state');
  assert.deepEqual(Object.keys(editorData.settings).sort(), ['departments','equipmentFailureSubcategories','meetingTaskCategories','priorities','rolePermissions','taskCategories'].sort(), 'settings must be a minimal editor whitelist');
  assert.deepEqual(editorData.settings.rolePermissions, {}, 'read-only eligibility computation needs no permission matrix');
  assert.deepEqual(Object.keys(editorData.vessels[0]).sort(), ['fullName','id','name','shipType','shortName'].sort(), 'read-only vessel projection must exclude assignments and operational data');
  assert.ok(!JSON.stringify(editorData).includes('secret-user') && !JSON.stringify(editorData).includes('secret-password') && !JSON.stringify(editorData).includes('secret-meeting') && !JSON.stringify(editorData).includes('secret-case') && !JSON.stringify(editorData).includes('secret-report'), 'minimal editor data must not preserve user/settings/meeting/scope existence signals');

  const opens = createTaskOpenRequestCoordinator();
  const gateA = deferred();
  const gateB = deferred();
  const tokenA = opens.begin({ vesselId:'return-a', batchManaged:false });
  const finishA = gateA.promise.then(() => opens.clearIfCurrent(tokenA));
  const tokenB = opens.begin({ vesselId:'return-b', batchManaged:false });
  const finishB = gateB.promise.then(() => opens.isCurrent(tokenB));
  gateB.resolve();
  assert.equal(await finishB, true);
  gateA.resolve();
  assert.equal(await finishA, false, 'older failed/cancelled open must not clear a newer return destination');
  assert.deepEqual(opens.peek(), { vesselId:'return-b', batchManaged:false });
  assert.deepEqual(opens.consumeIfCurrent(tokenB), { vesselId:'return-b', batchManaged:false }, 'close/save/delete consumes the exact latest destination once');
  assert.equal(opens.peek(), undefined);
  const closeGate = deferred();
  const closingToken = opens.begin({ vesselId:'must-not-reopen', batchManaged:false });
  const lateOpenStillCurrent = closeGate.promise.then(() => opens.isCurrent(closingToken));
  opens.invalidate();
  closeGate.resolve();
  assert.equal(await lateOpenStillCurrent, false, 'closing a read-only editor must invalidate an in-flight snapshot fetch so its late completion cannot reopen stale data');
  assert.equal(opens.peek(), undefined, 'closing/invalidation must clear the stale snapshot return destination');

  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const readOnlyStart = appSource.indexOf('const openTaskReadOnly = async');
  const readOnlyEnd = appSource.indexOf('\n  const openTaskEditor = async', readOnlyStart);
  const readOnlyBranch = appSource.slice(readOnlyStart, readOnlyEnd);
  assert.ok(readOnlyBranch.lastIndexOf("if(!requestIsCurrent())return 'cancelled';") < readOnlyBranch.indexOf('setTaskReadOnlyData(projectedData)') && readOnlyBranch.lastIndexOf("if(!requestIsCurrent())return 'cancelled';") >= 0, 'App must perform a final current-token check immediately before publishing the read-only snapshot');
  assert.ok(appSource.includes('taskOpenRequests.current.invalidate();') && appSource.includes('setTaskReadOnlyData(null);'), 'navigation, identity changes, and explicit invalidation must clear the read-only snapshot lifecycle');

  const configA = { supabaseUrl:'https://a.example', supabaseAnonKey:'key-a', workspaceKey:'workspace-a', tableName:'state' };
  const configB = { supabaseUrl:'https://b.example', supabaseAnonKey:'key-b', workspaceKey:'workspace-b', tableName:'state' };
  const io = createAsyncConfigCoordinator();
  const ioTokenA = io.begin(configA);
  assert.equal(Object.isFrozen(ioTokenA.config), true, 'I/O config snapshot must be immutable');
  const ioGate = deferred();
  let applied = '';
  const staleIo = io.run(ioTokenA, () => configA, async captured => { await ioGate.promise; return captured.workspaceKey; }).then(result => { applied = result; }, () => {});
  io.invalidate(); // A -> B
  io.begin(configB);
  io.invalidate(); // B -> A (ABA); equality alone is insufficient
  ioGate.resolve();
  await staleIo;
  assert.equal(applied, '', 'an ABA-stale completion must not apply after its generation was invalidated');
  const ioTokenB = io.begin(configB);
  assert.equal(await io.run(ioTokenB, () => configB, async captured => captured.workspaceKey), 'workspace-b');
  assert.equal(io.isCurrent(ioTokenB, configA), false, 'config equality is validated in addition to generation');

  const scheduled = [];
  const cleared = [];
  let now = 1000;
  const cleanup = scheduleValidatedLeaseExpiry(1600, () => scheduled.push('expired'), {
    now: () => now,
    setTimeout: (callback, delay) => { scheduled.push({callback,delay}); return 73; },
    clearTimeout: id => cleared.push(id),
  });
  assert.equal(scheduled[0].delay, 600, 'expiry timer must be scheduled exactly at validatedUntilMs');
  now = 1600;
  scheduled[0].callback();
  assert.deepEqual(scheduled.slice(1), ['expired'], 'timer expiry must synchronously invalidate the writable editor');
  cleanup();
  assert.deepEqual(cleared, [73], 'lease expiry timeout must be cleanable on renewal/close/navigation');

  const transitionGate = deferred();
  const transitionEvents = [];
  let leaseCurrent = true;
  const transition = transitionExpiredTaskLease({
    leaseIsCurrent: () => leaseCurrent,
    invalidateLease: () => { transitionEvents.push('invalidated'); leaseCurrent = false; },
    closeWritableAndBeginReadOnly: () => { transitionEvents.push('writable-closed'); return 91; },
    openLatestReadOnly: async request => { transitionEvents.push(`latest-request-${request}`); await transitionGate.promise; return 'opened'; },
    requestIsCurrent: request => request === 91,
    closeAfterFailure: () => transitionEvents.push('failed-closed'),
  });
  await Promise.resolve();
  assert.deepEqual(transitionEvents, ['invalidated','writable-closed','latest-request-91'], 'lease expiry must synchronously invalidate and unload the writable editor before latest-cloud I/O resolves');
  transitionGate.resolve();
  assert.equal(await transition, 'opened');
  assert.ok(!transitionEvents.includes('failed-closed'));

  let failureCloseCount = 0;
  assert.equal(await transitionExpiredTaskLease({
    leaseIsCurrent: () => true,
    invalidateLease: () => {},
    closeWritableAndBeginReadOnly: () => 7,
    openLatestReadOnly: async () => 'failed',
    requestIsCurrent: request => request === 7,
    closeAfterFailure: () => { failureCloseCount += 1; },
  }), 'failed');
  assert.equal(failureCloseCount, 1, 'current failed latest-cloud projection must close the transition cleanly');
  let staleTransitionTouched = false;
  assert.equal(await transitionExpiredTaskLease({
    leaseIsCurrent: () => false,
    invalidateLease: () => { staleTransitionTouched = true; },
    closeWritableAndBeginReadOnly: () => 1,
    openLatestReadOnly: async () => 'opened',
    requestIsCurrent: () => true,
    closeAfterFailure: () => {},
  }), 'cancelled');
  assert.equal(staleTransitionTouched, false, 'a stale expiry callback must not alter a renewed or replaced editor');

  assert.equal(internalControlDeletionAuthorized({deleteTasks:true,closeTasks:true,scopeCancellationAuthorized:true}), true);
  assert.equal(internalControlDeletionAuthorized({deleteTasks:true,closeTasks:false,scopeCancellationAuthorized:true}), false);
  assert.equal(internalControlDeletionAuthorized({deleteTasks:true,closeTasks:true,scopeCancellationAuthorized:false}), false);
  assert.equal(internalControlDeletionAuthorized({deleteTasks:false,closeTasks:true,scopeCancellationAuthorized:true}), false);

  console.log('Read-only projection and App race runtime contracts passed.');
} finally {
  await server.close();
}

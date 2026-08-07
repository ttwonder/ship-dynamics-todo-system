import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
  const receipts=await server.ssrLoadModule('/src/notificationReadReceipts.ts');
  const patch=await server.ssrLoadModule('/src/cloudBlockPatch.ts');
  const auth=await server.ssrLoadModule('/src/cloudAuthorization.ts');
  const rebase=await server.ssrLoadModule('/src/cloudRebase.ts');
  const base=createInitialData();
  const actor=base.users.find(user=>user.isActive&&user.role==='operator')||base.users.find(user=>user.isActive);
  assert.ok(actor,'seed must contain an active account');
  const other=base.users.find(user=>user.id!==actor.id&&user.isActive);
  assert.ok(other,'seed must contain another active account');
  const task=base.tasks[0];
  assert.ok(task,'seed must contain a task');
  const unread={
    id:'notification-read-regression',userId:actor.id,vesselId:task.vesselId,taskId:task.id,
    kind:'task-updated',title:'待辦已更新',message:'測試未讀更新',actorId:other.id,createdAt:'2026-08-07T01:00:00.000Z',
  };
  base.notifications=[unread];

  const loginOnly=structuredClone(base);
  assert.deepEqual(loginOnly,base,'selecting an identity alone must not mutate AppData');

  const readAt='2026-08-07T01:01:00.000Z';
  const explicitRead=receipts.markOwnNotificationsRead(base,actor.id,readAt);
  assert.notEqual(explicitRead,base,'an explicit mark-read action must return a new snapshot');
  assert.equal(explicitRead.notifications[0].readAt,readAt);
  assert.deepEqual(explicitRead.auditLogs,base.auditLogs,'notification read receipts must not append a business audit');
  assert.equal(explicitRead.revision,base.revision+1);
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(base,patch.buildCloudBlockPatch(base,explicitRead),actor.id));
  assert.equal(receipts.markOwnNotificationsRead(explicitRead,actor.id,readAt),explicitRead,'marking an already-read set must be a no-op');

  const legacy=structuredClone(base);
  legacy.notifications[0].readAt=readAt;
  legacy.auditLogs.unshift({
    id:'legacy-notification-read-audit',at:readAt,actorId:actor.id,actorName:actor.name,actorRole:actor.role,
    action:'查看待辦更新',entityType:'notification',entityId:task.id,detail:'標記此待辦未讀變動',
  });
  const legacyOps=patch.buildCloudBlockPatch(base,legacy);
  assert.doesNotThrow(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(base,legacyOps,actor.id),
    'the exact legacy self-notification read plus audit shape must drain once after upgrade',
  );

  const tamperedLegacy=structuredClone(legacy);
  tamperedLegacy.auditLogs[0].detail='遭修改的正文';
  assert.throws(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(base,patch.buildCloudBlockPatch(base,tamperedLegacy),actor.id),
    error=>error instanceof auth.CloudPatchAuthorizationError&&error.reason==='unaccompanied-auditLogs',
    'a legacy recovery allowance must not accept tampered audit business text',
  );
  const forgedNotification=structuredClone(legacy);
  forgedNotification.notifications[0].message='偽造通知正文';
  assert.throws(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(base,patch.buildCloudBlockPatch(base,forgedNotification),actor.id),
    error=>error instanceof auth.CloudPatchAuthorizationError&&error.reason==='unaccompanied-auditLogs',
    'legacy recovery must allow only an unread-to-read transition, not another notification field change',
  );
  const foreignRead=structuredClone(base);
  foreignRead.notifications[0]={...foreignRead.notifications[0],userId:other.id,readAt};
  foreignRead.auditLogs=structuredClone(legacy.auditLogs);
  assert.throws(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(base,patch.buildCloudBlockPatch(base,foreignRead),actor.id),
    auth.CloudPatchAuthorizationError,
    'one user must never drain or mark another user notification as read',
  );

  const cappedBase=structuredClone(base);
  cappedBase.auditLogs=Array.from({length:500},(_,index)=>({
    id:`existing-audit-${index}`,at:`2026-08-06T00:${String(index%60).padStart(2,'0')}:00.000Z`,
    actorId:other.id,actorName:other.name,actorRole:other.role,action:'既有紀錄',entityType:'task',entityId:task.id,detail:`既有 ${index}`,
  }));
  const cappedLegacy=structuredClone(cappedBase);
  cappedLegacy.notifications[0].readAt=readAt;
  cappedLegacy.auditLogs=[legacy.auditLogs[0],...cappedLegacy.auditLogs].slice(0,500);
  assert.doesNotThrow(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(cappedBase,patch.buildCloudBlockPatch(cappedBase,cappedLegacy),actor.id),
    'legacy recovery must recognize the exact oldest-record trim performed by withAudit at the 500-record cap',
  );

  const secondTask=base.tasks.find(item=>item.id!==task.id)||{...task,id:'notification-read-regression-task-2'};
  const secondReadAt='2026-08-07T01:02:00.000Z';
  const multiBase=structuredClone(base);
  multiBase.notifications.push({...unread,id:'notification-read-regression-2',taskId:secondTask.id});
  const multiLegacy=structuredClone(multiBase);
  multiLegacy.notifications[0].readAt=readAt;
  multiLegacy.notifications[1].readAt=secondReadAt;
  multiLegacy.auditLogs.unshift(
    {...legacy.auditLogs[0],id:'legacy-notification-read-audit-2',at:secondReadAt,entityId:secondTask.id},
    legacy.auditLogs[0],
  );
  assert.doesNotThrow(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(multiBase,patch.buildCloudBlockPatch(multiBase,multiLegacy),actor.id),
    'several exact legacy notification-read failures must drain together without clearing browser storage',
  );

  const concurrentBase=structuredClone(base);
  const commonAudit={
    id:'common-audit',at:'2026-08-07T00:00:00.000Z',actorId:other.id,actorName:other.name,actorRole:other.role,
    action:'既有紀錄',entityType:'task',entityId:task.id,detail:'共同基線',
  };
  concurrentBase.auditLogs=[commonAudit];
  const concurrentLocal=structuredClone(concurrentBase);
  concurrentLocal.notifications[0].readAt=readAt;
  concurrentLocal.auditLogs.unshift(legacy.auditLogs[0]);
  const concurrentRemote=structuredClone(concurrentBase);
  concurrentRemote.revision+=1;
  concurrentRemote.auditLogs.unshift({
    ...commonAudit,id:'newer-remote-audit',at:'2026-08-07T01:03:00.000Z',detail:'其他使用者稍後完成的更新',
  });
  const rebasedLegacy=rebase.rebaseDisjointAppData(
    concurrentBase,concurrentLocal,concurrentRemote,'2026-08-07T01:04:00.000Z',actor.id,
  );
  assert.deepEqual(
    rebasedLegacy.auditLogs.map(item=>item.id),
    ['newer-remote-audit','legacy-notification-read-audit','common-audit'],
    'rebase must retain chronological order when a newer remote audit arrives before recovery',
  );
  assert.doesNotThrow(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(
      concurrentRemote,patch.buildCloudBlockPatch(concurrentRemote,rebasedLegacy),actor.id,
    ),
    'a newer remote audit must not prevent an exact legacy notification-read snapshot from draining',
  );
  const reorderedLegacy=structuredClone(rebasedLegacy);
  reorderedLegacy.auditLogs=[legacy.auditLogs[0],...concurrentRemote.auditLogs];
  assert.throws(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(
      concurrentRemote,patch.buildCloudBlockPatch(concurrentRemote,reorderedLegacy),actor.id,
    ),
    auth.CloudPatchAuthorizationError,
    'recovery must not allow an older legacy audit to be moved ahead of a newer remote audit',
  );

  const appSource=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(
    appSource,
    /result==='opened'[\s\S]{0,500}查看待辦更新/,
    'opening an unchanged task must not mark notifications read or enqueue a cloud save',
  );
  const loginSource=appSource.slice(appSource.indexOf('function Login('),appSource.indexOf('function ReportCenter('));
  assert.doesNotMatch(loginSource,/setData\(|commit\(|withAudit\(/,'selecting an identity must not mutate AppData or enqueue a save');
  assert.match(appSource,/markOwnNotificationsRead/,'the explicit mark-all-read control must use the audit-free read-receipt helper');
  console.log('Notification read durability contracts passed.');
}finally{
  await server.close();
}

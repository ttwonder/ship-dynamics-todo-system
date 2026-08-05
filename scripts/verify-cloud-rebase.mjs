import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const { rebaseDisjointAppData, prepareCloudSyncSnapshot, CloudRebaseConflictError } = await server.ssrLoadModule('/src/cloudRebase.ts');
  const { cloudWorkspaceIdentity, cloudConfigIdentity, normalizeStoredCloudWorkspaceIdentity, serializeConfirmedCloudBase, parseConfirmedCloudBase, serializeDurableRevisionFloors, parseDurableRevisionFloors, updateDurableRevisionFloor, trustedPersistedBaseForRemote, bootstrapFailureHasUnsavedWork, withStableCreationAttemptProvenance, creationTaskCommitMatches } = await server.ssrLoadModule('/src/cloudRecovery.ts');
  const clone = value => structuredClone(value);
  const base = createInitialData();
  assert.ok(base.vessels.length >= 2, 'fixture requires at least two vessels');
  base.revision = 10;
  base.updatedAt = '2026-07-24T00:00:00.000Z';
  const configA={supabaseUrl:'https://example.supabase.co',tableName:'state',workspaceKey:'workspace-a',supabaseAnonKey:'key-old'};
  const configARotated={...configA,supabaseAnonKey:'key-new'};
  assert.equal(cloudWorkspaceIdentity(configA),cloudWorkspaceIdentity(configARotated),'anon key rotation must not change data workspace ownership');
  assert.notEqual(cloudConfigIdentity(configA),cloudConfigIdentity(configARotated),'anon key rotation must invalidate captured cloud I/O sessions');
  const legacyConfigAIdentity='https://example.supabase.co|state|workspace-a|key-old';
  assert.equal(normalizeStoredCloudWorkspaceIdentity(legacyConfigAIdentity,configARotated),cloudWorkspaceIdentity(configARotated),'legacy cache identity must migrate from workspace plus old anon key to the same data workspace after credential rotation');
  assert.equal(normalizeStoredCloudWorkspaceIdentity('https://example.supabase.co|state|workspace-b|old-key',configARotated),'https://example.supabase.co|state|workspace-b|old-key','legacy identity migration must not relabel a different workspace');
  const prefixWorkspace={...configA,workspaceKey:'alpha'};
  const delimiterWorkspace={...configA,workspaceKey:'alpha|tenant-b'};
  const delimiterLegacy='https://example.supabase.co|state|alpha|tenant-b|old-key';
  assert.equal(normalizeStoredCloudWorkspaceIdentity(delimiterLegacy,prefixWorkspace),delimiterLegacy,'legacy migration must reconstruct the full delimiter-bearing workspace instead of using an unsafe prefix match');
  assert.equal(normalizeStoredCloudWorkspaceIdentity(delimiterLegacy,delimiterWorkspace),cloudWorkspaceIdentity(delimiterWorkspace),'legacy delimiter-bearing workspace must still migrate when it exactly matches');
  assert.equal(normalizeStoredCloudWorkspaceIdentity(cloudWorkspaceIdentity(delimiterWorkspace),prefixWorkspace),cloudWorkspaceIdentity(delimiterWorkspace),'versioned data identity from another workspace must never be mistaken for a legacy identity');
  const persistedRaw=serializeConfirmedCloudBase(cloudWorkspaceIdentity(configA),base);
  const persistedBase=parseConfirmedCloudBase(persistedRaw,cloudWorkspaceIdentity(configARotated));
  assert.ok(persistedBase&&persistedBase.revision===base.revision,'trusted confirmed base must survive reload and credential rotation in the same workspace');
  assert.equal(parseConfirmedCloudBase(persistedRaw,cloudWorkspaceIdentity({...configA,workspaceKey:'workspace-b'})),null,'confirmed base must never cross workspace identity');
  const workspaceA=cloudWorkspaceIdentity(configA);
  const workspaceB=cloudWorkspaceIdentity({...configA,workspaceKey:'workspace-b'});
  let durableFloors=new Map();
  durableFloors=updateDurableRevisionFloor(durableFloors,workspaceA,10);
  durableFloors=updateDurableRevisionFloor(durableFloors,workspaceB,23);
  durableFloors=updateDurableRevisionFloor(durableFloors,workspaceA,9);
  const reloadedRegistry=parseDurableRevisionFloors(serializeDurableRevisionFloors(durableFloors));
  assert.equal(reloadedRegistry.valid,true);
  assert.equal(reloadedRegistry.floors.get(workspaceA),10,'workspace A floor must survive A -> B -> reload -> A');
  assert.equal(reloadedRegistry.floors.get(workspaceB),23,'workspace B floor must survive alongside workspace A');
  assert.equal(parseDurableRevisionFloors(null).valid,true,'an absent registry is a valid first-use state');
  assert.equal(parseDurableRevisionFloors('{"bad":true}').valid,false,'malformed floor registry must be distinguishable from first use');
  assert.equal(parseDurableRevisionFloors(JSON.stringify({version:1,floors:[[workspaceA,-1],[workspaceB,2.5],["legacy|ambiguous",8]]})).valid,false,'invalid revisions or non-v2 workspace identities must fail closed');
  assert.ok(trustedPersistedBaseForRemote(persistedBase,clone(persistedBase),(left,right)=>JSON.stringify(left)===JSON.stringify(right)),'persisted base equal to unchanged normalized remote must restore offline rebase path');
  assert.equal(bootstrapFailureHasUnsavedWork({
    local:clone(persistedBase),
    persistedConfirmedBase:persistedBase,
    hasLocalCache:true,
    equals:(left,right)=>JSON.stringify(left)===JSON.stringify(right),
  }),false,'bootstrap fetch failure must not mark an unchanged persisted cloud snapshot as unsaved');
  const dirtyBootstrapLocal=clone(persistedBase);
  dirtyBootstrapLocal.tasks.push({id:'bootstrap-dirty-task'});
  assert.equal(bootstrapFailureHasUnsavedWork({
    local:dirtyBootstrapLocal,
    persistedConfirmedBase:persistedBase,
    hasLocalCache:true,
    equals:(left,right)=>JSON.stringify(left)===JSON.stringify(right),
  }),true,'bootstrap fetch failure must retain a real local change as unsaved');
  assert.equal(bootstrapFailureHasUnsavedWork({
    local:clone(persistedBase),
    persistedConfirmedBase:null,
    hasLocalCache:true,
    equals:(left,right)=>JSON.stringify(left)===JSON.stringify(right),
  }),true,'bootstrap failure without a trusted base must fail closed when a local cache exists');
  assert.equal(bootstrapFailureHasUnsavedWork({
    local:clone(persistedBase),
    persistedConfirmedBase:null,
    hasLocalCache:false,
    equals:(left,right)=>JSON.stringify(left)===JSON.stringify(right),
  }),false,'bootstrap failure without any local cache must not invent unsaved work');
  const persistedRollbackRemote=clone(persistedBase);persistedRollbackRemote.revision=persistedBase.revision-1;
  assert.equal(trustedPersistedBaseForRemote(persistedBase,persistedRollbackRemote,(left,right)=>JSON.stringify(left)===JSON.stringify(right)),null,'remote revision below persisted durable base must be treated as rollback even when business content is equal');
  const rewrittenSameRevision=clone(persistedBase);rewrittenSameRevision.tasks.push({id:'rewritten'});
  assert.equal(trustedPersistedBaseForRemote(persistedBase,rewrittenSameRevision,(left,right)=>JSON.stringify(left)===JSON.stringify(right)),null,'same revision with different content must not be accepted as a trusted base');
  const submittedCreation={id:'creation-id',createdAt:'2026-07-25T00:00:00.000Z',createdBy:'owner-a',statusLogs:[{id:'initial-log',at:'2026-07-25T00:00:00.000Z',by:'Owner',text:'待處理'}]};
  assert.equal(creationTaskCommitMatches(submittedCreation,clone(submittedCreation)),true,'lost CAS acknowledgement must recognize the exact committed creation provenance');
  assert.equal(creationTaskCommitMatches(submittedCreation,{...clone(submittedCreation),createdAt:'2026-07-25T00:00:01.000Z'}),false,'same task id without matching trusted creation provenance must fail closed');
  const retryCreation=withStableCreationAttemptProvenance(submittedCreation,{...clone(submittedCreation),createdAt:'2026-07-25T00:00:02.000Z',statusLogs:[{id:'retry-log',at:'2026-07-25T00:00:02.000Z',by:'Owner',text:'重試內容'}]});
  assert.equal(creationTaskCommitMatches(submittedCreation,retryCreation),true,'a later successful retry must retain first-attempt provenance so its lost acknowledgement can still be classified');
  assert.equal(retryCreation.statusLogs[0].text,'重試內容','stable provenance may retain the current retry business content while reusing its idempotency identity');

  const local = clone(base);
  local.revision = 11;
  local.vessels[0].position.location = 'LOCAL-PORT';
  local.auditLogs.unshift({ id: 'audit-local', at: '2026-07-24T00:01:00.000Z', actorId: 'u-local', actorName: 'Local', actorRole: 'operator', action: 'local', entityType: 'vessel', entityId: local.vessels[0].id, detail: 'local change' });

  const remote = clone(base);
  remote.revision = 11;
  remote.vessels[1].position.location = 'REMOTE-PORT';
  remote.auditLogs.unshift({ id: 'audit-remote', at: '2026-07-24T00:01:01.000Z', actorId: 'u-remote', actorName: 'Remote', actorRole: 'operator', action: 'remote', entityType: 'vessel', entityId: remote.vessels[1].id, detail: 'remote change' });

  const rebased = rebaseDisjointAppData(base, local, remote, '2026-07-24T00:02:00.000Z');
  assert.equal(rebased.revision, 12, 'rebased payload must advance from the latest remote revision');
  assert.equal(rebased.vessels[0].position.location, 'LOCAL-PORT', 'local disjoint vessel edit must survive');
  assert.equal(rebased.vessels[1].position.location, 'REMOTE-PORT', 'remote disjoint vessel edit must survive');
  assert.deepEqual(new Set(rebased.auditLogs.slice(0, 2).map(item => item.id)), new Set(['audit-local', 'audit-remote']), 'independent audit entries must both survive');

  const sameEntityLocal = clone(base);
  sameEntityLocal.revision = 11;
  sameEntityLocal.vessels[0].position.location = 'LOCAL-SAME';
  sameEntityLocal.vessels[0].updatedAt = '2026-07-24T00:02:30.000Z';
  const sameEntityRemote = clone(base);
  sameEntityRemote.revision = 11;
  sameEntityRemote.vessels[0].note.recentDynamics = 'REMOTE-SAME';
  sameEntityRemote.vessels[0].updatedAt = '2026-07-24T00:02:40.000Z';
  const sameEntityRebased = rebaseDisjointAppData(base, sameEntityLocal, sameEntityRemote, '2026-07-24T00:03:00.000Z');
  assert.equal(sameEntityRebased.vessels[0].position.location, 'LOCAL-SAME', 'same vessel local field edit must survive');
  assert.equal(sameEntityRebased.vessels[0].note.recentDynamics, 'REMOTE-SAME', 'same vessel remote disjoint field edit must survive');
  assert.equal(sameEntityRebased.vessels[0].updatedAt, '2026-07-24T00:02:40.000Z', 'merged metadata must use the newest participating entity timestamp');

  const sameFieldLocal = clone(base);
  sameFieldLocal.revision = 11;
  sameFieldLocal.vessels[0].position.location = 'LOCAL-CONFLICT';
  const sameFieldRemote = clone(base);
  sameFieldRemote.revision = 11;
  sameFieldRemote.vessels[0].position.location = 'REMOTE-CONFLICT';
  assert.throws(
    () => rebaseDisjointAppData(base, sameFieldLocal, sameFieldRemote, '2026-07-24T00:03:10.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.includes(`vessels:${base.vessels[0].id}.position.location`),
    'different edits to the exact same field must fail closed with a precise path',
  );

  const workflowBase = clone(base);
  workflowBase.tasks.push({ id:'field-task', vesselId:base.vessels[0].id, status:'base-status', expectedDate:'2026-08-01', updatedAt:'2026-07-24T00:00:00.000Z', updatedBy:'Base', statusLogs:[] });
  workflowBase.tasks.push({ id:'field-task-remote', vesselId:base.vessels[1].id, status:'base-status', expectedDate:'2026-08-01', updatedAt:'2026-07-24T00:00:00.000Z', updatedBy:'Base', statusLogs:[] });
  workflowBase.internalControlCases.push({ id:'field-case', vesselId:base.vessels[0].id, status:'base-status', departments:['甲板部'], updatedAt:'2026-07-24T00:00:00.000Z', updatedBy:'Base', statusLogs:[] });
  workflowBase.internalControlCases.push({ id:'field-case-remote', vesselId:base.vessels[1].id, status:'base-status', departments:['甲板部'], updatedAt:'2026-07-24T00:00:00.000Z', updatedBy:'Base', statusLogs:[] });
  workflowBase.meetings.push({ id:'field-meeting', resolution:'base-resolution', expectedDate:'2026-08-01', updatedAt:'2026-07-24T00:00:00.000Z', statusLogs:[] });
  const workflowLocal = clone(workflowBase);
  workflowLocal.tasks.find(item=>item.id==='field-task').status='local-status';
  workflowLocal.tasks.find(item=>item.id==='field-task').updatedAt='2026-07-24T00:10:00.000Z';
  workflowLocal.tasks.find(item=>item.id==='field-task').updatedBy='Local';
  workflowLocal.tasks.find(item=>item.id==='field-task').statusLogs.unshift({id:'task-log-local',at:'2026-07-24T00:10:00.000Z',by:'Local',text:'local'});
  workflowLocal.internalControlCases.find(item=>item.id==='field-case').status='local-status';
  workflowLocal.internalControlCases.find(item=>item.id==='field-case').statusLogs.unshift({id:'case-log-local',at:'2026-07-24T00:10:00.000Z',by:'Local',text:'local'});
  workflowLocal.meetings.find(item=>item.id==='field-meeting').resolution='local-resolution';
  workflowLocal.meetings.find(item=>item.id==='field-meeting').statusLogs.unshift({id:'meeting-log-local',at:'2026-07-24T00:10:00.000Z',by:'Local',text:'local'});
  const workflowRemote = clone(workflowBase);
  workflowRemote.tasks.find(item=>item.id==='field-task-remote').expectedDate='2026-08-02';
  workflowRemote.tasks.find(item=>item.id==='field-task-remote').updatedAt='2026-07-24T00:11:00.000Z';
  workflowRemote.tasks.find(item=>item.id==='field-task-remote').updatedBy='Remote';
  workflowRemote.internalControlCases.find(item=>item.id==='field-case-remote').departments=['甲板部','輪機部'];
  workflowRemote.meetings.find(item=>item.id==='field-meeting').expectedDate='2026-08-02';
  workflowRemote.meetings.find(item=>item.id==='field-meeting').statusLogs.unshift({id:'meeting-log-remote',at:'2026-07-24T00:11:00.000Z',by:'Remote',text:'remote'});
  const workflowRebased = rebaseDisjointAppData(workflowBase,workflowLocal,workflowRemote,'2026-07-24T00:12:00.000Z');
  assert.equal(workflowRebased.tasks.find(item=>item.id==='field-task').status,'local-status');
  assert.equal(workflowRebased.tasks.find(item=>item.id==='field-task-remote').expectedDate,'2026-08-02');
  assert.deepEqual(workflowRebased.tasks.find(item=>item.id==='field-task').statusLogs.map(item=>item.id),['task-log-local']);
  assert.equal(workflowRebased.internalControlCases.find(item=>item.id==='field-case').status,'local-status');
  assert.deepEqual(workflowRebased.internalControlCases.find(item=>item.id==='field-case-remote').departments,['甲板部','輪機部']);
  assert.deepEqual(workflowRebased.internalControlCases.find(item=>item.id==='field-case').statusLogs.map(item=>item.id),['case-log-local']);
  assert.equal(workflowRebased.meetings.find(item=>item.id==='field-meeting').resolution,'local-resolution');
  assert.equal(workflowRebased.meetings.find(item=>item.id==='field-meeting').expectedDate,'2026-08-02');
  assert.deepEqual(new Set(workflowRebased.meetings.find(item=>item.id==='field-meeting').statusLogs.map(item=>item.id)),new Set(['meeting-log-local','meeting-log-remote']));

  const progressBase=clone(base);
  progressBase.tasks.push({id:'distributed-task',vesselId:base.vessels[0].id,vesselIds:[base.vessels[0].id,base.vessels[1].id],distributeToVessels:true,vesselProgress:[
    {vesselId:base.vessels[0].id,status:'A-base',isClosed:false,statusLogs:[]},
    {vesselId:base.vessels[1].id,status:'B-base',isClosed:false,statusLogs:[]},
  ]});
  const progressLocal=clone(progressBase);
  progressLocal.tasks.find(item=>item.id==='distributed-task').vesselProgress[0].status='A-local';
  progressLocal.tasks.find(item=>item.id==='distributed-task').vesselProgress[0].statusLogs.push({id:'progress-a-log',at:'2026-07-24T00:13:00.000Z',by:'A',text:'A'});
  const progressRemote=clone(progressBase);
  progressRemote.tasks.find(item=>item.id==='distributed-task').vesselProgress[1].status='B-remote';
  progressRemote.tasks.find(item=>item.id==='distributed-task').vesselProgress[1].statusLogs.push({id:'progress-b-log',at:'2026-07-24T00:13:10.000Z',by:'B',text:'B'});
  const progressRebased=rebaseDisjointAppData(progressBase,progressLocal,progressRemote,'2026-07-24T00:13:20.000Z');
  const mergedProgress=progressRebased.tasks.find(item=>item.id==='distributed-task').vesselProgress;
  assert.equal(mergedProgress.find(item=>item.vesselId===base.vessels[0].id).status,'A-local','different vessel member progress must preserve local update');
  assert.equal(mergedProgress.find(item=>item.vesselId===base.vessels[1].id).status,'B-remote','different vessel member progress must preserve remote update');
  const progressStatusLocal=clone(progressBase);
  Object.assign(progressStatusLocal.tasks.find(item=>item.id==='distributed-task').vesselProgress[0],{status:'A-local',statusLogs:[{id:'progress-local-status',at:'2026-07-24T00:13:30.000Z',by:'Local',text:'A-local'}]});
  const progressHistoryRemote=clone(progressBase);
  progressHistoryRemote.tasks.find(item=>item.id==='distributed-task').vesselProgress[0].statusLogs=[{id:'progress-remote-base-status',at:'2026-07-24T00:13:31.000Z',by:'Remote',text:'A-base'}];
  assert.throws(
    ()=>rebaseDisjointAppData(progressBase,progressStatusLocal,progressHistoryRemote,'2026-07-24T00:13:32.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes(`dependency:task-vessel-status:distributed-task:${base.vessels[0].id}`),
    'status and statusLogs for the same vessel-progress member are one atomic domain',
  );

  const syncLocal = clone(base);
  syncLocal.revision = 11;
  syncLocal.tasks.push({id:'sync-local-task',vesselId:base.vessels[0].id,marker:'local'});
  const syncRemote = clone(base);
  syncRemote.revision = 11;
  syncRemote.internalControlCases.push({id:'sync-remote-case',vesselId:base.vessels[1].id,marker:'remote'});
  const syncPrepared = prepareCloudSyncSnapshot(base,syncLocal,syncRemote,10,'2026-07-24T00:12:30.000Z');
  assert.ok(syncPrepared.tasks.some(item=>item.id==='sync-local-task'),'non-destructive sync must preserve dirty local work');
  assert.ok(syncPrepared.internalControlCases.some(item=>item.id==='sync-remote-case'),'non-destructive sync must include the latest remote work');
  const reloadRecovered=prepareCloudSyncSnapshot(base,syncLocal,syncRemote,11,'2026-07-24T00:12:35.000Z');
  assert.ok(reloadRecovered.tasks.some(item=>item.id==='sync-local-task')&&reloadRecovered.internalControlCases.some(item=>item.id==='sync-remote-case'),'persisted base behind the latest remote revision must restore offline dirty reload through a real three-way merge');
  const rolledBackLocal=clone(syncLocal);rolledBackLocal.revision=9;
  assert.throws(
    ()=>prepareCloudSyncSnapshot(base,rolledBackLocal,syncRemote,11,'2026-07-24T00:12:36.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('缺少可信的雲端合併基線'),
    'local data older than the persisted base must not be treated as a descendant eligible for rebase',
  );
  const cleanPrepared = prepareCloudSyncSnapshot(base,clone(base),syncRemote,10,'2026-07-24T00:12:40.000Z');
  assert.deepEqual(cleanPrepared,syncRemote,'sync without local changes may adopt a genuinely newer remote directly');
  const rewrittenSameRevisionRemote=clone(base);
  rewrittenSameRevisionRemote.tasks=rewrittenSameRevisionRemote.tasks.slice(1);
  assert.throws(
    ()=>prepareCloudSyncSnapshot(base,clone(base),rewrittenSameRevisionRemote,10,'2026-07-24T00:12:42.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('缺少可信的雲端合併基線'),
    'manual sync must reject same-revision remote content divergence even when local equals the confirmed base',
  );
  const equalRevisionDirtyLocal=clone(base);
  equalRevisionDirtyLocal.tasks.push({id:'equal-revision-local-task',vesselId:base.vessels[0].id,description:'must survive despite equal revision'});
  const equalRevisionPrepared=prepareCloudSyncSnapshot(base,equalRevisionDirtyLocal,syncRemote,10,'2026-07-24T00:12:45.000Z');
  assert.ok(equalRevisionPrepared.tasks.some(item=>item.id==='equal-revision-local-task'),'same-revision divergent local content is dirty and must not be replaced by remote');
  assert.throws(
    ()=>prepareCloudSyncSnapshot(null,syncLocal,syncRemote,10,'2026-07-24T00:12:50.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('缺少可信的雲端合併基線'),
    'dirty local work must never be replaced when the trusted base is unavailable',
  );
  const rollbackRemote=clone(base);
  rollbackRemote.revision=9;
  rollbackRemote.tasks=[];
  assert.throws(
    ()=>prepareCloudSyncSnapshot(base,clone(base),rollbackRemote,10,'2026-07-24T00:12:55.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('缺少可信的雲端合併基線'),
    'lower remote revision must fail before any clean-local adoption shortcut',
  );

  const immutableBase=clone(base);
  immutableBase.auditLogs.unshift({id:'immutable-audit',at:'2026-07-24T00:14:00.000Z',actorId:'actor',actorName:'Actor',actorRole:'operator',action:'base',entityType:'task',entityId:'task',detail:'base'});
  const immutableLocal=clone(immutableBase);
  immutableLocal.auditLogs.find(item=>item.id==='immutable-audit').action='local-tamper';
  const immutableRemote=clone(immutableBase);
  immutableRemote.auditLogs.find(item=>item.id==='immutable-audit').detail='remote-tamper';
  assert.throws(
    ()=>rebaseDisjointAppData(immutableBase,immutableLocal,immutableRemote,'2026-07-24T00:14:10.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('auditLogs:immutable-audit'),
    'same immutable audit ID with divergent content must conflict instead of field-merging forged provenance',
  );
  const unilateralAuditRemote=clone(immutableBase);
  assert.throws(
    ()=>rebaseDisjointAppData(immutableBase,immutableLocal,unilateralAuditRemote,'2026-07-24T00:14:11.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('auditLogs:immutable-audit'),
    'unilateral modification of an existing audit entry must fail closed',
  );
  const deletedAuditLocal=clone(immutableBase);
  deletedAuditLocal.auditLogs=deletedAuditLocal.auditLogs.filter(item=>item.id!=='immutable-audit');
  assert.throws(
    ()=>rebaseDisjointAppData(immutableBase,deletedAuditLocal,unilateralAuditRemote,'2026-07-24T00:14:12.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('auditLogs:immutable-audit'),
    'unilateral deletion of an existing audit entry must fail closed',
  );
  const retentionBase=clone(base);
  retentionBase.auditLogs=Array.from({length:500},(_,index)=>({id:`retained-audit-${index}`,at:`2026-07-23T${String(23-Math.floor(index/60)).padStart(2,'0')}:${String(index%60).padStart(2,'0')}:00.000Z`,actorId:'base',actorName:'Base',actorRole:'operator',action:'base',entityType:'task',entityId:'base',detail:`base-${index}`}));
  const retentionLocal=clone(retentionBase);
  retentionLocal.auditLogs=[{id:'retention-local-new',at:retentionBase.auditLogs[retentionBase.auditLogs.length-1].at,actorId:'local',actorName:'Local',actorRole:'operator',action:'local',entityType:'task',entityId:'local',detail:'local'},...retentionLocal.auditLogs].slice(0,500);
  const retentionRemote=clone(retentionBase);
  retentionRemote.auditLogs=[{id:'retention-remote-new',at:retentionBase.auditLogs[retentionBase.auditLogs.length-1].at,actorId:'remote',actorName:'Remote',actorRole:'operator',action:'remote',entityType:'task',entityId:'remote',detail:'remote'},...retentionRemote.auditLogs].slice(0,500);
  const retentionMerged=rebaseDisjointAppData(retentionBase,retentionLocal,retentionRemote,'2026-07-25T00:00:04.000Z');
  assert.equal(retentionMerged.auditLogs.length,500,'trusted audit retention must preserve the configured cap');
  assert.ok(retentionMerged.auditLogs.some(item=>item.id==='retention-local-new')&&retentionMerged.auditLogs.some(item=>item.id==='retention-remote-new'),'independent audit appends must survive cap retention');
  const overflowLocal=clone(retentionBase);
  const overflowRemote=clone(retentionBase);
  const freshAudits=(prefix,actor)=>Array.from({length:300},(_,index)=>({id:`${prefix}-${index}`,at:`2026-07-25T00:${String(Math.floor(index/60)).padStart(2,'0')}:${String(index%60).padStart(2,'0')}.000Z`,actorId:actor,actorName:actor,actorRole:'operator',action:'fresh',entityType:'task',entityId:prefix,detail:`${prefix}-${index}`}));
  overflowLocal.auditLogs=[...freshAudits('overflow-local','Local'),...overflowLocal.auditLogs.slice(0,200)];
  overflowRemote.auditLogs=[...freshAudits('overflow-remote','Remote'),...overflowRemote.auditLogs.slice(0,200)];
  assert.throws(
    ()=>rebaseDisjointAppData(retentionBase,overflowLocal,overflowRemote,'2026-07-25T00:00:04.500Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('auditLogs:retention-overflow'),
    'more than 500 independently accepted fresh audit records must fail closed rather than silently discard immutable evidence',
  );
  const middleDeletionLocal=clone(retentionBase);
  middleDeletionLocal.auditLogs.splice(200,1);
  assert.throws(
    ()=>rebaseDisjointAppData(retentionBase,middleDeletionLocal,clone(retentionBase),'2026-07-25T00:00:05.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('auditLogs:retained-audit-200'),
    'audit retention may remove only the oldest suffix, never a middle record',
  );

  const historyBase=clone(base);
  historyBase.tasks.push({id:'history-task',vesselId:base.vessels[0].id,status:'base',isClosed:false,statusLogs:[{id:'history-log',at:'2026-07-24T00:14:20.000Z',by:'Base',text:'base'}]});
  const tamperedHistoryLocal=clone(historyBase);
  tamperedHistoryLocal.tasks.find(item=>item.id==='history-task').statusLogs[0].text='tampered';
  assert.throws(
    ()=>rebaseDisjointAppData(historyBase,tamperedHistoryLocal,clone(historyBase),'2026-07-24T00:14:21.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('tasks:history-task.statusLogs:history-log'),
    'unilateral modification of an existing status history entry must fail closed',
  );
  const ordinaryRemoteWithTamperedLocal=clone(historyBase);
  ordinaryRemoteWithTamperedLocal.tasks.find(item=>item.id==='history-task').expectedDate='2026-08-31';
  assert.throws(
    ()=>rebaseDisjointAppData(historyBase,tamperedHistoryLocal,ordinaryRemoteWithTamperedLocal,'2026-07-24T00:14:21.500Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('tasks:history-task.statusLogs:history-log'),
    'history tampering must fail even when remote changed a different ordinary field on the same entity',
  );
  const deletedHistoryLocal=clone(historyBase);
  deletedHistoryLocal.tasks.find(item=>item.id==='history-task').statusLogs=[];
  assert.throws(
    ()=>rebaseDisjointAppData(historyBase,deletedHistoryLocal,clone(historyBase),'2026-07-24T00:14:22.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('tasks:history-task.statusLogs:history-log'),
    'unilateral deletion of an existing status history entry must fail closed',
  );
  const nestedHistoryBase=clone(base);
  nestedHistoryBase.tasks.push({id:'nested-history-task',vesselId:base.vessels[0].id,vesselIds:[base.vessels[0].id,base.vessels[1].id],distributeToVessels:true,status:'base',statusLogs:[],vesselProgress:[{vesselId:base.vessels[0].id,status:'base',statusLogs:[{id:'nested-history-log',at:'2026-07-24T00:14:23.000Z',by:'Base',text:'base'}]},{vesselId:base.vessels[1].id,status:'base',statusLogs:[]}]});
  const nestedHistoryLocal=clone(nestedHistoryBase);
  nestedHistoryLocal.tasks.find(item=>item.id==='nested-history-task').vesselProgress=nestedHistoryLocal.tasks.find(item=>item.id==='nested-history-task').vesselProgress.filter(item=>item.vesselId!==base.vessels[0].id);
  const nestedHistoryRemote=clone(nestedHistoryBase);
  nestedHistoryRemote.tasks.find(item=>item.id==='nested-history-task').expectedDate='2026-08-31';
  assert.throws(
    ()=>rebaseDisjointAppData(nestedHistoryBase,nestedHistoryLocal,nestedHistoryRemote,'2026-07-24T00:14:24.000Z'),
    error=>error instanceof CloudRebaseConflictError,
    'removing a vesselProgress member must not silently delete its existing nested status history during rebase',
  );

  const coupledBase=clone(base);
  coupledBase.tasks.push({id:'coupled-task',vesselId:base.vessels[0].id,description:'base',status:'open',isClosed:false,statusLogs:[]});
  const coupledScopeLocal=clone(coupledBase);
  coupledScopeLocal.tasks.find(item=>item.id==='coupled-task').description='local description';
  const coupledScopeRemote=clone(coupledBase);
  coupledScopeRemote.tasks.find(item=>item.id==='coupled-task').vesselId=base.vessels[1].id;
  assert.throws(
    ()=>rebaseDisjointAppData(coupledBase,coupledScopeLocal,coupledScopeRemote,'2026-07-24T00:14:30.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('dependency:task-scope:coupled-task'),
    'task scope changes must not be field-merged with another actor business edit',
  );
  const coupledStatusLocal=clone(coupledBase);
  Object.assign(coupledStatusLocal.tasks.find(item=>item.id==='coupled-task'),{status:'local-progress',statusLogs:[{id:'coupled-local-log',at:'2026-07-24T00:14:31.000Z',by:'Local',text:'local-progress'}]});
  const coupledStatusRemote=clone(coupledBase);
  Object.assign(coupledStatusRemote.tasks.find(item=>item.id==='coupled-task'),{isClosed:true,closedDate:'2026-07-24',closedBy:'Remote',statusLogs:[{id:'coupled-remote-log',at:'2026-07-24T00:14:32.000Z',by:'Remote',text:'closed'}]});
  assert.throws(
    ()=>rebaseDisjointAppData(coupledBase,coupledStatusLocal,coupledStatusRemote,'2026-07-24T00:14:33.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('dependency:task-status:coupled-task'),
    'coupled task status/closure/history fields changed on both sides must fail closed',
  );
  const statusHistoryOnlyRemote=clone(coupledBase);
  statusHistoryOnlyRemote.tasks.find(item=>item.id==='coupled-task').statusLogs=[{id:'remote-base-status-log',at:'2026-07-24T00:14:32.000Z',by:'Remote',text:'base'}];
  assert.throws(
    ()=>rebaseDisjointAppData(coupledBase,coupledStatusLocal,statusHistoryOnlyRemote,'2026-07-24T00:14:34.000Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('dependency:task-status:coupled-task'),
    'a status transition on one side and status-history append on the other are one atomic domain and must fail closed',
  );
  const ordinaryTaskRemote=clone(coupledBase);
  ordinaryTaskRemote.tasks.find(item=>item.id==='coupled-task').description='remote ordinary edit';
  assert.throws(
    ()=>rebaseDisjointAppData(coupledBase,coupledStatusLocal,ordinaryTaskRemote,'2026-07-24T00:14:34.100Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('dependency:task-status:coupled-task'),
    'a task status transaction must not auto-merge with another actor ordinary edit on the same task',
  );
  const caseStatusBase=clone(base);
  caseStatusBase.internalControlCases.push({id:'status-case',vesselId:base.vessels[0].id,status:'open',statusLogs:[],departments:['甲板部']});
  const caseStatusLocal=clone(caseStatusBase);
  Object.assign(caseStatusLocal.internalControlCases.find(item=>item.id==='status-case'),{status:'done',statusLogs:[{id:'case-status-log',at:'2026-07-24T00:14:34.200Z',by:'Local',text:'done'}]});
  const caseOrdinaryRemote=clone(caseStatusBase);
  caseOrdinaryRemote.internalControlCases.find(item=>item.id==='status-case').departments=['輪機部'];
  assert.throws(
    ()=>rebaseDisjointAppData(caseStatusBase,caseStatusLocal,caseOrdinaryRemote,'2026-07-24T00:14:34.300Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes('dependency:internal-control-status:status-case'),
    'an internal-control status transaction must not auto-merge with another actor ordinary edit on the same case',
  );
  const memberOrdinaryRemote=clone(progressBase);
  memberOrdinaryRemote.tasks.find(item=>item.id==='distributed-task').vesselProgress[0].note='remote same-member ordinary';
  assert.throws(
    ()=>rebaseDisjointAppData(progressBase,progressLocal,memberOrdinaryRemote,'2026-07-24T00:14:34.400Z'),
    error=>error instanceof CloudRebaseConflictError&&error.conflicts.includes(`dependency:task-vessel-status:distributed-task:${base.vessels[0].id}`),
    'a vessel-progress status transaction must not auto-merge with another actor ordinary edit on the same member',
  );

  const settingsLocal = clone(base);
  settingsLocal.revision = 11;
  settingsLocal.settings.systemTitle = 'LOCAL TITLE';
  const settingsRemote = clone(base);
  settingsRemote.revision = 11;
  settingsRemote.settings.departments = [...settingsRemote.settings.departments, 'REMOTE DEPT'];
  const settingsRebased = rebaseDisjointAppData(base, settingsLocal, settingsRemote, '2026-07-24T00:04:00.000Z');
  assert.equal(settingsRebased.settings.systemTitle, 'LOCAL TITLE');
  assert.ok(settingsRebased.settings.departments.includes('REMOTE DEPT'), 'disjoint settings keys may merge');

  const authorizationLocal = clone(base);
  authorizationLocal.vessels[0].position.location = 'LOCAL-AUTH-RACE';
  const authorizationRemote = clone(base);
  authorizationRemote.users[0].isActive = false;
  assert.throws(
    () => rebaseDisjointAppData(base, authorizationLocal, authorizationRemote, '2026-07-24T00:04:10.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.includes('authorization-domain'),
    'remote identity or authorization changes must prevent automatic reapplication of a local business mutation',
  );

  const vesselAuthorizationBase = clone(base);
  const assignedUserId = vesselAuthorizationBase.users.find(user=>user.isActive)?.id || 'qa-assigned-user';
  vesselAuthorizationBase.vessels[0].assignedUserIds=[assignedUserId];
  const vesselAuthorizationLocal = clone(vesselAuthorizationBase);
  vesselAuthorizationLocal.meetings.push({ id:'local-meeting-after-assignment', vesselIds:[vesselAuthorizationBase.vessels[0].id], marker:'local' });
  vesselAuthorizationLocal.agendaReports.push({ id:'local-report-after-assignment', vesselIds:[vesselAuthorizationBase.vessels[0].id], marker:'local' });
  const vesselAuthorizationRemote = clone(vesselAuthorizationBase);
  vesselAuthorizationRemote.vessels[0].assignedUserIds=[];
  assert.throws(
    () => rebaseDisjointAppData(vesselAuthorizationBase,vesselAuthorizationLocal,vesselAuthorizationRemote,'2026-07-24T00:04:15.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.includes('authorization-domain'),
    'remote vessel assignment/delegation revocation must prevent automatic reapplication of local meeting/report mutations',
  );

  const dependencyBase = clone(base);
  dependencyBase.tasks.push({ id:'dep-task', internalControlCaseId:'dep-case', vesselId:base.vessels[0].id, sourceMeetingId:'dep-meeting', marker:'base' });
  dependencyBase.internalControlCases.push({ id:'dep-case', linkedTaskId:'dep-task', vesselId:base.vessels[0].id, marker:'base' });
  dependencyBase.meetings.push({ id:'dep-meeting', marker:'base' });
  const taskLocal = clone(dependencyBase);
  taskLocal.tasks.find(item => item.id === 'dep-task').marker = 'local-task';
  const caseRemote = clone(dependencyBase);
  caseRemote.internalControlCases.find(item => item.id === 'dep-case').marker = 'remote-case';
  assert.throws(
    () => rebaseDisjointAppData(dependencyBase, taskLocal, caseRemote, '2026-07-24T00:04:20.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.some(item => item.startsWith('dependency:internal-control')),
    'linked task and internal-control case changes are one dependency domain even across collections',
  );
  const meetingRemote = clone(dependencyBase);
  meetingRemote.meetings.find(item => item.id === 'dep-meeting').marker = 'remote-meeting';
  assert.throws(
    () => rebaseDisjointAppData(dependencyBase, taskLocal, meetingRemote, '2026-07-24T00:04:30.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.includes('dependency:meeting-task'),
    'meeting-derived task changes must conflict with concurrent source-meeting changes',
  );
  const vesselRemote = clone(dependencyBase);
  vesselRemote.vessels[0].isActive = false;
  assert.throws(
    () => rebaseDisjointAppData(dependencyBase, taskLocal, vesselRemote, '2026-07-24T00:04:40.000Z'),
    error => error instanceof CloudRebaseConflictError && error.conflicts.includes('dependency:vessel-scope'),
    'task changes must not be reapplied when their vessel scope changes remotely',
  );

  const disjointTaskBase = clone(base);
  disjointTaskBase.tasks.push({ id:'task-vessel-a', vesselId:base.vessels[0].id, marker:'base' }, { id:'task-vessel-b', vesselId:base.vessels[1].id, marker:'base' });
  const disjointTaskLocal = clone(disjointTaskBase);
  disjointTaskLocal.tasks.find(item => item.id === 'task-vessel-a').marker = 'local';
  const disjointTaskRemote = clone(disjointTaskBase);
  disjointTaskRemote.tasks.find(item => item.id === 'task-vessel-b').marker = 'remote';
  const disjointTasksRebased = rebaseDisjointAppData(disjointTaskBase, disjointTaskLocal, disjointTaskRemote, '2026-07-24T00:04:50.000Z');
  assert.equal(disjointTasksRebased.tasks.find(item => item.id === 'task-vessel-a').marker, 'local');
  assert.equal(disjointTasksRebased.tasks.find(item => item.id === 'task-vessel-b').marker, 'remote');

  const collectionKeys = ['users', 'vessels', 'tasks', 'internalControlCases', 'meetings', 'agendaReports', 'auditLogs', 'notifications'];
  const snapshotNames = ['base', 'local', 'remote'];
  for (const collectionKey of collectionKeys) {
    for (const snapshotName of snapshotNames) {
      const snapshots = { base: clone(base), local: clone(base), remote: clone(base) };
      snapshots[snapshotName][collectionKey].push(
        { id: '__duplicate-id__', marker: 'first' },
        { id: '__duplicate-id__', marker: 'second' },
      );
      assert.throws(
        () => rebaseDisjointAppData(snapshots.base, snapshots.local, snapshots.remote, '2026-07-24T00:05:00.000Z'),
        error => error instanceof CloudRebaseConflictError && error.conflicts.includes(`${collectionKey}:${snapshotName}:duplicate-id:__duplicate-id__`),
        `${snapshotName}.${collectionKey} duplicate IDs must fail closed before merge indexing`,
      );
    }
  }

  const invalidIds = [
    { label: 'blank', value: '   ' },
    { label: 'non-string', value: 42 },
  ];
  for (const collectionKey of collectionKeys) {
    for (const snapshotName of snapshotNames) {
      for (const invalidId of invalidIds) {
        const snapshots = { base: clone(base), local: clone(base), remote: clone(base) };
        snapshots[snapshotName][collectionKey].push({ id: invalidId.value, marker: invalidId.label });
        assert.throws(
          () => rebaseDisjointAppData(snapshots.base, snapshots.local, snapshots.remote, '2026-07-24T00:06:00.000Z'),
          error => error instanceof CloudRebaseConflictError && error.conflicts.includes(`${collectionKey}:${snapshotName}:invalid-id`),
          `${snapshotName}.${collectionKey} ${invalidId.label} IDs must fail closed before merge indexing`,
        );
      }
    }
  }

  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const syncLatestStart=appSource.indexOf('const syncLatest = async () =>');
  const saveChangesStart=appSource.indexOf('const saveChanges = async () =>');
  assert.ok(syncLatestStart>=0&&saveChangesStart>syncLatestStart, 'must locate syncLatest source for non-destructive sync contracts');
  const syncLatestSource=appSource.slice(syncLatestStart,saveChangesStart);
  assert.ok(syncLatestSource.includes('prepareCloudSyncSnapshot('), '同步最新必須先以可信base合併本機dirty snapshot');
  assert.ok(syncLatestSource.includes('appDataContentEqual(localSnapshot,baseSnapshot)'), 'App必須以本機與可信base的內容差異判定dirty，不能只比較revision');
  assert.ok(syncLatestSource.includes('classifyCloudSyncFailure(error)')&&syncLatestSource.includes('failure.message'), '同步錯誤必須區分真欄位衝突、權限撤銷及安全基線阻擋');
  const compactSyncLatestSource=syncLatestSource.replace(/\s+/g,'');
  assert.ok(compactSyncLatestSource.includes('constcachedCloudIdentity=cachedCloudIdentityFor(syncConfig)'), '同步必須透過migration-aware helper讀取本機資料cache identity，不能信任bootstrap已切到新設定的active ref');
  assert.ok(compactSyncLatestSource.includes("consthasUnboundLocalCache=!cachedCloudIdentity&&localStorage.getItem(STORAGE_KEY)!==null"), '沒有identity的既有本機cache必須被視為未綁定資料，而非自動視作目前workspace');
  assert.ok(compactSyncLatestSource.includes('if(workspaceChanged||hasUnboundLocalCache)throw'), '不同workspace及未綁定cache一律拒絕，空白remote也不得把來源不明資料綁到新workspace');
  const crossWorkspaceGuardIndex=compactSyncLatestSource.indexOf("previousCloudIdentity&&previousCloudIdentity!==syncIdentity");
  const activateWorkspaceIndex=compactSyncLatestSource.indexOf('activeCloudIdentity.current=syncIdentity');
  assert.ok(crossWorkspaceGuardIndex>=0&&activateWorkspaceIndex>crossWorkspaceGuardIndex, '跨workspace dirty cache必須先拒絕，通過身份檢查後才可切換active identity，避免第二次同步繞過隔離');
  const compactAppSource=appSource.replace(/\s+/g,'');
  assert.ok(compactAppSource.includes('normalizeStoredCloudWorkspaceIdentity(stored,config)')&&compactAppSource.includes('localStorage.setItem(CLOUD_CACHE_IDENTITY_KEY,normalized)'), '舊workspace+anon identity必須在不改動資料的情況下遷移為data workspace identity');
  const bootstrapStart=appSource.indexOf('const cfg = getSupabaseConfig();');
  const bootstrapRemoteThen=appSource.indexOf('.then(remote =>',bootstrapStart);
  assert.ok(bootstrapStart>=0&&bootstrapRemoteThen>bootstrapStart,'must locate bootstrap fetch boundary');
  const bootstrapBeforeRemote=appSource.slice(bootstrapStart,bootstrapRemoteThen);
  assert.ok(!bootstrapBeforeRemote.includes('activeCloudIdentity.current = identity'), 'bootstrap在fetch及workspace/content驗證前不得提交active identity');
  assert.ok(compactAppSource.includes('constpersistedConfirmedBase=parseConfirmedCloudBase(localStorage.getItem(CLOUD_CONFIRMED_BASE_KEY),identity)')&&compactAppSource.includes('trustedPersistedBaseForRemote(persistedConfirmedBase,remote,appDataContentEqual)'), 'bootstrap必須只從同workspace的持久化confirmed envelope恢復可信共同base');
  assert.ok(compactAppSource.includes('constlocalContentDiverged=hasLocalCache&&!appDataContentEqual(data,remote)'), 'bootstrap必須以內容比較偵測同revision分歧，不能只看revision或updatedAt');
  assert.ok(compactAppSource.includes('constpersistedDurableFloor=durableCloudRevisionFloors.current.get(identity)??-1')&&compactAppSource.includes('constpersistedRemoteRollback=remote.revision<persistedDurableFloor')&&compactAppSource.includes('localContentDiverged||persistedRemoteRollback'), 'bootstrap必須拒絕低於workspace-persisted durable floor的remote rollback，即使單一confirmed envelope目前屬於其他workspace');
  assert.ok(compactAppSource.includes('parseDurableRevisionFloors(localStorage.getItem(CLOUD_REVISION_FLOORS_KEY))')&&compactAppSource.includes('durableRevisionFloorRegistryValid')&&compactAppSource.includes('updateDurableRevisionFloor(durableCloudRevisionFloors.current,identity,snapshot.revision)')&&compactAppSource.includes('localStorage.setItem(CLOUD_REVISION_FLOORS_KEY,serializeDurableRevisionFloors(')&&compactSyncLatestSource.includes('durableCloudRevisionFloors.current.get(syncIdentity)??-1')&&compactSyncLatestSource.includes('remote.revision<durableRevisionFloor'), 'durable revision floor registry must survive A -> B -> reload -> A, remain monotonic per workspace, and distinguish corruption from first use');
  assert.ok(compactAppSource.includes('assertRemoteExtendsDurableHistory(activeCloudIdentity.current,base,remote)')&&compactAppSource.includes('assertRemoteExtendsDurableHistory(cloudIdentity(token.config),confirmedCloudData.current,remote)'), 'autosave conflict and batch discard must reject rollback or same-revision rewritten remotes before adoption');
  assert.ok(compactAppSource.includes('constpersistedRemoteMissing=persistedDurableFloor>=0')&&compactAppSource.includes('identityChanged||unknownDirtyCache||persistedRemoteMissing')&&compactAppSource.includes('confirmedCloudData.current=persistedConfirmedBase')&&compactAppSource.includes('durablerevision${persistedDurableFloor}'), 'bootstrap remote-null after any persisted workspace floor must block autosave/reinitialization even when the single confirmed-base envelope belongs to another workspace');
  assert.ok(compactAppSource.includes('confirmedCloudData.current=recoveredBase')&&compactAppSource.includes('constrecoveredBase=!identityChanged&&!unknownDirtyCache?'), '分歧cache不得把剛抓到的remote升格為偽base；只可使用驗證後持久化base');
  assert.ok(compactAppSource.includes('localStorage.setItem(CLOUD_CONFIRMED_BASE_KEY,serializeConfirmedCloudBase(identity,snapshot))'), '每次雲端確認都必須持久化workspace-bound共同base供離線重載恢復');
  assert.ok(compactAppSource.includes("exportconstcloudIdentity=cloudWorkspaceIdentity")&&compactAppSource.includes('cloudConfigIdentity(getSupabaseConfig())'), '資料workspace identity必須排除anon key，但operation/config token仍須包含key');
  assert.ok(compactAppSource.includes('creationTaskCommitMatches(submittedTask,recoveredTask)')&&compactAppSource.includes('已確認先前回應遺失的新增要事已保存雲端'), 'creation CAS回應遺失時必須以穩定ID與可信建立provenance確認既有remote commit');
  assert.ok(appSource.includes('同步最新（安全合併）'), '雲端工具列必須明示同步採安全合併語義');
  assert.ok(appSource.includes('請按「同步最新（安全合併）」重試；真正同欄位衝突時本機內容仍會保留'), '保存阻擋提示不得再暗示直接採用雲端版本');
  const enqueueStart=appSource.indexOf('const enqueueCloudSave =');
  const enqueueEnd=appSource.indexOf('\n  const flushCloudBeforeBatchRelease=',enqueueStart);
  const enqueueSource=appSource.slice(enqueueStart,enqueueEnd);
  const firstIntentShift=enqueueSource.indexOf('let pendingEntry=pendingCloudData.current.shift();');
  const firstIntentResolve=enqueueSource.indexOf('pendingEntry.resolve();',firstIntentShift);
  const nextIntentShift=enqueueSource.indexOf('pendingEntry=pendingCloudData.current.shift();',firstIntentResolve);
  assert.ok(enqueueSource.includes('const turnEntry=pendingCloudData.current.peek();')&&firstIntentShift>=0&&firstIntentResolve>firstIntentShift&&nextIntentShift>firstIntentResolve, 'block retry must leave every newer queued snapshot untouched until the current intent has its own durable completion receipt');
  const patchCatch=enqueueSource.indexOf('}catch(error){');
  assert.ok(patchCatch>=0&&enqueueSource.indexOf('if(!isCurrent())break;',patchCatch)<enqueueSource.indexOf('error instanceof CloudBlockPatchUnavailableError',patchCatch), 'stale caller must be ignored before fallback or conflict handling can block the new session');

  console.log('Cloud disjoint rebase runtime contracts passed.');
} finally {
  await server.close();
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const editor = fs.readFileSync('src/EditModals.tsx', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { taskCreationLockKey, taskCreationLockMatchesVessel, isTaskCreationLockKey } = await server.ssrLoadModule('/src/taskCreationLock.ts');
  const { runDurableCreationHandoff, waitForDurableCreationHandoff } = await server.ssrLoadModule('/src/durableCreationHandoff.ts');
  const { consumeCurrentTaskEditorSession } = await server.ssrLoadModule('/src/taskEditorSession.ts');
  const appModule = await server.ssrLoadModule('/src/App.tsx');
  assert.equal(typeof appModule.selectCreationDraftForQuarantine,'function','automatic create invalidation needs a tested owner/lease-bound quarantine selector');
  const baseDraft={id:'draft-q',vesselId:'vessel-a',description:'initial'};
  const selectedQuarantine=appModule.selectCreationDraftForQuarantine({
    ownerUserId:'owner-a',leaseOwnerId:'lease-a',currentTask:baseDraft,
    latest:{leaseOwnerId:'lease-a',task:{...baseDraft,description:'latest'}},
    attempt:{leaseOwnerId:'lease-a',task:{...baseDraft,description:'attempt'}},
  });
  assert.equal(selectedQuarantine.task.description,'latest','automatic invalidation must preserve the latest submitted/modal candidate before the stable attempt or initial draft');
  assert.equal(selectedQuarantine.ownerUserId,'owner-a');
  assert.equal(selectedQuarantine.leaseOwnerId,'lease-a');
  assert.equal(appModule.selectCreationDraftForQuarantine({ownerUserId:'owner-a',leaseOwnerId:'lease-a',currentTask:null,latest:{leaseOwnerId:'other',task:baseDraft},attempt:{leaseOwnerId:'other',task:baseDraft}}),null,'a foreign lease candidate must never be quarantined for this session');

  assert.equal(taskCreationLockKey('vessel-a'), 'task-create:vessel-a');
  assert.equal(taskCreationLockKey('vessel-b'), 'task-create:vessel-b');
  assert.notEqual(taskCreationLockKey('vessel-a'), taskCreationLockKey('vessel-b'), 'different vessels must not block one another');
  assert.equal(taskCreationLockMatchesVessel('task-create:vessel-a', 'vessel-a'), true);
  assert.equal(taskCreationLockMatchesVessel('task-create:vessel-a', 'vessel-b'), false);
  assert.equal(isTaskCreationLockKey('task-create:vessel-a'), true);
  assert.equal(isTaskCreationLockKey('task:vessel-a'), false);

  let resolvePersist;
  let committed=null;
  let current=true;
  const handoff=runDurableCreationHandoff({
    snapshot:{id:'draft-a'},
    persist:()=>new Promise(resolve=>{resolvePersist=resolve;}),
    isCurrent:()=>current,
    commit:value=>{committed=value;},
  });
  await Promise.resolve();
  assert.equal(committed,null,'creation snapshot must not commit before durable persistence resolves');
  resolvePersist({id:'confirmed-a'});
  assert.equal(await handoff,true);
  assert.deepEqual(committed,{id:'confirmed-a'},'durably confirmed snapshot must commit while the same session is current');
  committed=null;current=true;
  let classifiedStaleSuccess=null;
  const staleHandoff=runDurableCreationHandoff({
    snapshot:{id:'draft-b'},
    persist:async()=>{current=false;return {id:'confirmed-b'};},
    isCurrent:()=>current,
    onDurable:value=>{classifiedStaleSuccess=value;},
    commit:value=>{committed=value;},
  });
  assert.equal(await staleHandoff,false,'stale creation session must not commit into successor UI');
  assert.equal(committed,null);
  assert.deepEqual(classifiedStaleSuccess,{id:'confirmed-b'},'durable success classification must survive caller staleness so duplicate-recovery UI can be suppressed');
  let settleRelease;
  const releaseBarrier=new Promise(resolve=>{settleRelease=resolve;});
  let releaseMayProceed=false;
  const waitedRelease=waitForDurableCreationHandoff({leaseOwnerId:'lease-a',promise:releaseBarrier},'lease-a').then(()=>{releaseMayProceed=true;});
  await Promise.resolve();
  assert.equal(releaseMayProceed,false,'matching task-create lease release must wait while durable handoff is in flight');
  settleRelease();
  await waitedRelease;
  assert.equal(releaseMayProceed,true,'matching task-create lease release may proceed only after durable handoff settles');
  const sessionCoordinator=(()=>{let generation=0;let destination;return{begin(next){destination=next;return ++generation;},isCurrent(token){return token===generation;},consumeIfCurrent(token){if(token!==generation)return undefined;const value=destination;destination=undefined;generation+=1;return value;},peek(){return destination;}}})();
  const oldSession=sessionCoordinator.begin({vesselId:'old'});
  const newSession=sessionCoordinator.begin({vesselId:'new'});
  assert.equal(consumeCurrentTaskEditorSession(sessionCoordinator,oldSession),undefined,'stale editor close must not consume a successor session');
  assert.equal(sessionCoordinator.isCurrent(newSession),true,'stale editor close must not invalidate the successor generation');
  assert.deepEqual(sessionCoordinator.peek(),{vesselId:'new'});
  assert.deepEqual(consumeCurrentTaskEditorSession(sessionCoordinator,newSession),{vesselId:'new'});

  assert.match(app, /const addTaskForVessel = async[\s\S]*?claimEditingLock\(taskCreationLockKey\(vesselId\)/, 'every ordinary add-task entry must claim the per-vessel creation lock before opening');
  assert.ok(app.includes("if(getSupabaseConfig()&&cloudWriteBlocked){alert('雲端寫入已阻擋"), 'cloud-blocked state must not open a creation editor that could bypass safe sync');
  assert.ok(app.includes("taskCreationLockKey(candidate.vesselId)") && app.includes('requireMutationLease'), 'create save must revalidate the exact vessel creation lease');
  const saveTaskStart=app.slice(app.indexOf('const saveTask = async'),app.indexOf('let applied=false;',app.indexOf('const saveTask = async')));
  const mutationLeaseGuard=app.slice(app.indexOf('const requireMutationLease='),app.indexOf('const requireLogin =',app.indexOf('const requireMutationLease=')));
  assert.ok(saveTaskStart.indexOf('latestCreationDrafts.current.set(candidate.id')>=0&&saveTaskStart.indexOf('latestCreationDrafts.current.set(candidate.id')<saveTaskStart.indexOf('requireMutationLease(taskCreationLockKey(candidate.vesselId))')&&mutationLeaseGuard.includes('quarantineCreationDraftForLock(activeEditLock)'), 'lease-invalid create submit must retain the latest candidate and quarantine it before hiding/releasing');
  assert.ok(editor.includes('onDraftChange?: (task: TaskItem) => void')&&editor.includes('onDraftChange?.(clone(draft))')&&app.includes('onDraftChange={captureCreationDraft}')&&app.includes('latestCreationDrafts.current.set(draft.id,{leaseOwnerId:lock.leaseOwnerId,task:clone(draft)})'),'every pre-submit modal change must be captured by the exact opaque creation lease so TTL/config/auth invalidation cannot fall back to the initial empty parent draft');
  assert.ok(app.includes('isTaskCreationLockKey(lock.sectionKey)') && app.includes('setCreatingTask(null)'), 'creation editor must close when its lease becomes invalid');
  assert.ok(editor.includes('disabled={globalReadOnly||creating}'), 'a creation draft must not change vessels after claiming its vessel-scoped lock');
  assert.ok(editor.includes('const [saving,setSaving]=useState(false)')&&editor.includes('await onSave(saved, creating')&&editor.includes('disabled={saving} onClick={close}'), 'creation editor must await durable save and disable duplicate submit/cancel');
  assert.match(app,/const saveTask = async[\s\S]*?runDurableCreationHandoff[\s\S]*?persist:async snapshot=>\{[\s\S]*?await enqueueCloudSave\(snapshot,creationIsCurrent,false\)/, 'creation save must hold the task-create lease until cloud CAS acknowledgement');
  assert.ok(app.includes('await enqueueCloudSave(liveData.current,creationIsCurrent)')&&app.includes('const creationBase=confirmedBeforeCreation&&confirmedBeforeCreation.revision===lastCloudRevision.current?confirmedBeforeCreation:liveData.current'), 'creation handoff must durably flush prior local work and build from the confirmed base');
  assert.ok(app.includes('const submittedOrLive=liveData.current.revision>next.revision?liveData.current:next'), 'CAS conflict rebase must retain an unrendered submitted creation snapshot');
  assert.ok(app.includes("const creationAttempts=useRef(new Map<string,{leaseOwnerId:string;task:TaskItem}>())")&&app.includes('creationAttempts.current.set(candidate.id,{leaseOwnerId:creationLock.leaseOwnerId,task:clone(submittedCreationTask)})')&&app.includes('withStableCreationAttemptProvenance(existingAttempt.task,submittedCreationTask)')&&app.includes("const submittedTask=attempt?.leaseOwnerId===creationLock.leaseOwnerId?attempt.task:undefined"), 'lost-ack recovery must retain and apply first-attempt creation provenance across user retries, bind it to the exact lease, and retain the latest stable retry draft');
  const leaveIdentityStart=app.indexOf('const leaveCurrentIdentity = () => {');
  const leaveIdentityEnd=app.indexOf('\n  const readOnlyTask=',leaveIdentityStart);
  const leaveIdentityBranch=app.slice(leaveIdentityStart,leaveIdentityEnd);
  assert.ok(app.includes('latestCreationDrafts.current.set(candidate.id,{leaseOwnerId:creationLock.leaseOwnerId,task:clone(candidate)})')&&leaveIdentityBranch.includes('const latestDraft=latestCreationDrafts.current.get(creatingTask.id)'),'quarantine must capture the latest modal candidate before any flush/CAS await, not only the initial empty task or later generated snapshot');
  assert.ok(leaveIdentityBranch.indexOf('setQuarantinedCreationDrafts(current=>({...current,[currentUser.id]')>=0&&leaveIdentityBranch.indexOf('setQuarantinedCreationDrafts(current=>({...current,[currentUser.id]')<leaveIdentityBranch.indexOf("setCurrentUserId('')"),'identity exit during a matching handoff must quarantine the submitted draft by owner before immediately hiding the identity UI');
  assert.ok(app.includes('quarantinedCreationDrafts[currentUser.id]||null')&&app.includes('...current,[currentUser.id]'),'different users switching in the same browser must retain isolated quarantine slots instead of overwriting or exposing each other drafts');
  assert.ok(app.includes('quarantined.ownerUserId!==currentUser.id')&&app.includes('setCreatingTask(clone(quarantined.task))')&&app.includes('已隔離並以唯讀方式恢復')&&app.includes('quarantinedCreationVisible'),'only the same re-authorized user may restore a quarantined creation draft, and it must remain read-only without the expired lease');
  assert.ok(app.includes('if(creationHandoffInFlight.current?.leaseOwnerId===quarantined.leaseOwnerId)return;')&&app.includes('authorizationEpoch,creationHandoffVersion,activeVessels.map'), 'matching quarantine must remain hidden until durable CAS/outcome classification settles; handoff settlement must re-run restore eligibility');
  assert.ok(app.includes('const capturedCreationConfig=capturedCreationLease.config')&&app.includes('recoveredRemote=await fetchCloudData(capturedCreationConfig)')&&app.includes('if(creationIsCurrent()){')&&app.includes('confirmCloudSnapshot(cloudIdentity(capturedCreationConfig),recoveredRemote)'), 'creation outcome classification must use captured immutable config even after session/config staleness, while publishing recovery only for the current session');
  assert.ok(app.includes('identitySessionGeneration.current+=1')&&app.includes('identitySessionGeneration.current===capturedIdentitySessionGeneration')&&app.includes('taskOpenRequests.current.isCurrent(capturedCreationRequestGeneration)'), 'same-user logout/login ABA and successor editor sessions must permanently stale the old creation handoff before it can publish into successor UI');
  assert.ok(app.includes('const confirmedCreationLeases=useRef(new Set<string>())')&&app.includes('if(confirmedCreationLeases.current.has(lock.leaseOwnerId))return false')&&app.includes('onDurable:()=>{')&&app.includes('confirmedCreationLeases.current.add(creationLock.leaseOwnerId)'),'durable-success classification must be recorded by opaque lease independently of stale/current UI publication');
  const durableOutcomeHandler=app.slice(app.indexOf('onDurable:()=>{'),app.indexOf('commit:confirmed=>',app.indexOf('onDurable:()=>{')));
  assert.ok(durableOutcomeHandler.includes('clearCreationAttempt(candidate.id,creationLock.leaseOwnerId)')&&durableOutcomeHandler.includes('previous?.leaseOwnerId!==creationLock.leaseOwnerId'),'stale durable success must remove only its exact attempt/quarantine so it cannot be offered as a new draft or touch a successor');
  assert.ok(app.includes('clearCreationAttempt(creatingTask?.id,activeEditLock?.leaseOwnerId||quarantinedCreationDraft?.leaseOwnerId)')&&app.includes('if(creationAttempts.current.get(taskId)?.leaseOwnerId===leaseOwnerId)')&&app.includes('if(latestCreationDrafts.current.get(taskId)?.leaseOwnerId===leaseOwnerId)'), 'closing an editor may clear only its exact active or quarantined task/lease attempt and stale callbacks must not clear a successor');
  assert.ok(app.includes('const closeTaskEditor = (requestGeneration=taskEditorRequestGeneration)')&&app.includes('consumeCurrentTaskEditorSession(taskOpenRequests.current,requestGeneration)'), 'task editor close must be bound to the exact editor session token');
  assert.ok(app.includes("const closeVesselEditor=(lock:ActiveEditLock|null)=>{")&&app.includes("!lockCoordinator.current.isCurrent(lock.generation)")&&app.includes('close={()=>closeVesselEditor(activeEditLock)}'), 'vessel editor close must ignore stale callbacks from an older lock generation');
  assert.ok(app.includes('creationHandoffInFlight.current')&&app.includes('await waitForDurableCreationHandoff(pendingHandoff,lock.leaseOwnerId)'), 'all task-create release paths must await the matching durable creation handoff');
  assert.ok(app.includes("if(creationHandoffMatches(lock)){setSensitiveCloudStatus('雲端設定已變更：正在完成目前新增要事的耐久保存，暫不釋放協作鎖',lock.sectionKey);return;}")&&app.includes("if(creationHandoffMatches(lock)){setSensitiveCloudStatus('協作鎖有效期已到：正在等待新增要事耐久保存完成，暫不交出協作鎖',lock.sectionKey);return;}"), 'config change and lease-expiry callbacks must defer invalidation while the durable task-create handoff is in flight');
  assert.ok(app.includes('if((authorizationChanged||staleLock)&&activeEditLock&&creationHandoffMatches(activeEditLock))')&&app.includes('creationHandoffVersion'), 'authorization changes must defer destructive cleanup until handoff settlement and then re-run invalidation');
  assert.ok(app.includes('const matchingCreationHandoff=creationHandoffInFlight.current?.leaseOwnerId===lock.leaseOwnerId?creationHandoffInFlight.current:null')&&app.includes('if(matchingCreationHandoff&&(!renewed.ok||!renewalStillCurrent()))')&&app.includes('await waitForDurableCreationHandoff(matchingCreationHandoff,lock.leaseOwnerId)'), 'post-renewal stale compensation and failed-renewal handling must wait for the matching creation handoff before release or close');
  const configInvalidation=app.slice(app.indexOf('const checkConfig=()=>{'),app.indexOf('const onStorage=',app.indexOf('const checkConfig=()=>{')));
  const expiryInvalidation=app.slice(app.indexOf('return scheduleValidatedLeaseExpiry'),app.indexOf('},[activeEditLock?.sectionKey',app.indexOf('return scheduleValidatedLeaseExpiry')));
  const authorizationInvalidation=app.slice(app.indexOf('const previousAuthorizationEpochValue='),app.indexOf('const claimEditingLock=',app.indexOf('const previousAuthorizationEpochValue=')));
  const renewalStaleSuffix=app.slice(app.indexOf('if(!renewalStillCurrent())'),app.indexOf('if(!renewed.ok){',app.indexOf('if(!renewalStillCurrent())')));
  assert.ok(configInvalidation.includes('closeEditorForLock(lock,true)')&&expiryInvalidation.includes('closeEditorForLock(lock,true)')&&authorizationInvalidation.includes('quarantineCreationDraftForLock(activeEditLock)')&&renewalStaleSuffix.includes('quarantineCreationDraftForLock(lock)'), 'config, authorization, TTL, and post-renewal invalidation must all quarantine the owner/lease draft after handoff settlement before hide/release');
  const automaticQuarantine=app.slice(app.indexOf('const quarantineCreationDraftForLock='),app.indexOf('const closeEditorForLock=',app.indexOf('const quarantineCreationDraftForLock=')));
  assert.ok(automaticQuarantine.includes('setQuarantinedCreationDrafts')&&!automaticQuarantine.includes('clearCreationAttempt('),'automatic invalidation must preserve latest draft and lost-ack provenance; only exact user cancel may clear them');
  assert.ok(app.includes("if(isTaskCreationLockKey(lock.sectionKey)&&liveCreatingTaskId.current)")&&app.includes("草稿已唯讀保留")&&app.includes('mutationLeaseIsOwned(taskCreationLockKey(editingTask!.vesselId))||preservedCreationDraft'), 'a task-create renewal loss after handoff settlement must preserve the draft visibly in read-only mode instead of unmounting it');
  assert.match(app, /onAddTask=\{async id=>\{if\(await closeBatchManaged\(renderedBatchManagedAuthorization\)\)addTaskForVessel\(id,false,true\);\}\}/, 'batch-managed add-task must release the exact captured batch session bundle, then use the common creation-lock entry');
  assert.ok(app.includes('其他使用者正在新增此船要事'), 'blocked creation must show a clear vessel-specific conflict notice');
  assert.equal(pkg.scripts['test:task-creation-lock'], 'node scripts/verify-task-creation-lock.mjs');

  console.log('Per-vessel task creation lock contracts passed.');
} finally {
  await server.close();
}

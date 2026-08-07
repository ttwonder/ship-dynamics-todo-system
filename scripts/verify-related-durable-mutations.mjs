import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('src/App.tsx','utf8');
const meetings=fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
const internal=fs.readFileSync('src/InternalControlPage.tsx','utf8');

const wrapperStart=app.indexOf('const runDurableRelatedMutation=');
const wrapperEnd=app.indexOf('\n  const createInternalCases',wrapperStart);
assert.ok(wrapperStart>=0&&wrapperEnd>wrapperStart,'App must centralize related durable mutations');
const wrapper=app.slice(wrapperStart,wrapperEnd);
assert.ok(wrapper.includes('relatedEntityLockKeysForSection(planningRemote,sectionKey)'),'the wrapper must plan all related existing entity locks from fresh cloud data');
assert.ok(wrapper.includes('acquireEditLockBundle(')&&wrapper.includes('renewEditLock('),'the wrapper must claim and renew the related lock bundle');
assert.ok(wrapper.includes('relatedEntityLockKeysForSection(remote,sectionKey)')&&wrapper.includes('sameLockKeySet'),'the post-lock refresh must reject relation drift');
assert.ok(wrapper.includes('await enqueueCloudSave(liveData.current,sessionIsCurrent)')&&wrapper.includes('appDataContentEqual(liveData.current,confirmedCloudData.current)'),'success must require authoritative cloud confirmation');
assert.match(wrapper,/applied=apply\(\);[\s\S]*?if\(saveTimer\.current\)\{window\.clearTimeout\(saveTimer\.current\);saveTimer\.current=null;\}[\s\S]*?await enqueueCloudSave\(liveData\.current,sessionIsCurrent\)/,'an explicit durable related mutation must cancel its redundant autosave timer before enqueueing the authoritative snapshot');

const saveTaskStart=app.indexOf('const saveTask = async');
const saveTaskEnd=app.indexOf('\n  const saveTaskVesselProgress',saveTaskStart);
const saveTask=app.slice(saveTaskStart,saveTaskEnd);
assert.match(saveTask,/await runDurableRelatedMutation\(\s*`task:\$\{candidate\.id\}`[\s\S]*?taskVesselIds\(candidate\)[\s\S]*?\.map\(vesselId=>`vessel:\$\{vesselId\}`\)/, 'an existing task save must hold its task/relation/vessel lock closure and await authoritative cloud confirmation before the editor can close');
assert.match(saveTask,/taskInternalControlCreationLockKeys\(snapshot,candidate,isMeetingTaskSource\(candidate\)\)/, 'an existing task save that can create an internal-control case must include the matching creation guard in its additional lock closure');
const progressStart=app.indexOf('const saveTaskVesselProgress =');
const progressEnd=app.indexOf('\n  const deleteTask',progressStart);
assert.match(app.slice(progressStart,progressEnd),/const saveTaskVesselProgress = async[\s\S]*?await runDurableRelatedMutation\(\s*`task:\$\{candidate\.id\}`/, 'single-vessel progress must return success only after its task/relation mutation is durably confirmed');
const deleteStart=app.indexOf('const deleteTask =');
const deleteEnd=app.indexOf('\n  const runTaskMutationWithLockBundle',deleteStart);
assert.match(app.slice(deleteStart,deleteEnd),/const deleteTask = async[\s\S]*?await runDurableRelatedMutation\(\s*`task:\$\{task\.id\}`/, 'single-task deletion must hold its complete task/meeting/internal-control lock closure until durable confirmation');

assert.ok(meetings.includes('runDurableRelatedMutation: (sectionKey:string,label:string,apply:()=>boolean)=>Promise<boolean>'),'the meeting page must receive the durable related mutation boundary');
const meetingSave=meetings.slice(meetings.indexOf('const save = async'),meetings.indexOf('\n  const deleteMeeting'));
assert.ok(meetingSave.includes('await runDurableRelatedMutation('),'meeting save must await the durable boundary');
assert.ok(meetingSave.indexOf('await runDurableRelatedMutation(')<meetingSave.indexOf('setNotice(`✓'),'meeting success feedback must follow cloud confirmation');
const meetingDelete=meetings.slice(meetings.indexOf('const deleteMeeting'),meetings.indexOf('\n  const exportMeetings'));
assert.ok(meetingDelete.includes('await runDurableRelatedMutation('),'meeting deletion must await the same durable relation boundary');
const startNew=meetings.slice(meetings.indexOf('const startNew = async'),meetings.indexOf('\n  const toggleVessel'));
assert.ok(startNew.includes('meetingCreationLockKey(')&&startNew.includes('await claimItemLease('),'a new meeting draft must own an independent creation lease before editing');
assert.ok(meetingSave.includes("const sectionKey=wasCreating?meetingCreationLockKey(id):meetingEditLockKey(id)")&&meetingSave.includes('await runDurableRelatedMutation(sectionKey'),'meeting creation must use the same durable boundary with its creation lease');
assert.ok(meetingSave.indexOf('await runDurableRelatedMutation(sectionKey')<meetingSave.indexOf('setNotice(`✓'),'new meeting success feedback must also follow cloud confirmation');

for(const name of ['saveInternalCase','removeInternalCase']){
  const start=app.indexOf(`const ${name} = async`);
  assert.ok(start>=0,`${name} must be asynchronous`);
  const end=app.indexOf('\n  const ',start+10);
  assert.ok(app.slice(start,end).includes('await runDurableRelatedMutation('),`${name} must await the durable relation boundary`);
}
const createInternalStart=app.indexOf('const createInternalCases = async');
const createInternalEnd=app.indexOf('\n  const saveInternalCase',createInternalStart);
const createInternal=app.slice(createInternalStart,createInternalEnd);
assert.ok(createInternalStart>=0&&createInternal.includes('internalControlCreationLockKey(')&&createInternal.includes('await claimExclusiveItemLease('),'batch internal-control creation must claim its own creation lease');
assert.ok(createInternal.includes('await runDurableRelatedMutation(')&&createInternal.includes('await releaseExclusiveItemLease('),'batch internal-control creation must confirm cloud durability before releasing its creation lease');
assert.ok(internal.includes('if (await onUpdate(')&&internal.includes('if (await onDelete('),'internal-control modal closure must remain behind the awaited parent result');
assert.ok(app.includes('onDelete={()=>deleteTask(editingTask)}')&&fs.readFileSync('src/EditModals.tsx','utf8').includes('if(await onDelete())close()'),'task deletion modal closure must remain behind the awaited durable parent result');
console.log('Related durable mutation source contracts passed.');

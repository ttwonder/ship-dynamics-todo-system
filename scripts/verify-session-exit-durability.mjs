import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('src/App.tsx','utf8');
const management=fs.readFileSync('src/Management.tsx','utf8');

const leaveStart=app.indexOf('const leaveCurrentIdentity = async');
const leaveEnd=app.indexOf('\n  const readOnlyTask',leaveStart);
const leave=app.slice(leaveStart,leaveEnd);
const openEditorGuard=leave.indexOf('if(activeEditLockRef.current||batchManagedOpenRef.current)');
assert.ok(openEditorGuard>=0&&openEditorGuard<leave.indexOf('taskOpenRequests.current.invalidate()'),'identity switching must refuse to unmount any local modal draft while an item or batch editing session is open');
assert.ok(leave.includes('請先保存或關閉目前編輯器'),'the refusal must tell the user how to preserve the draft');
const durableIndex=leave.indexOf('ensureCloudDurableBeforeLeaseRelease(');
const releaseIndex=leave.indexOf('releaseCurrentEditLock(');
const clearIndex=leave.indexOf('taskOpenRequests.current.invalidate()');
assert.ok(leaveStart>=0&&durableIndex>=0&&releaseIndex>durableIndex,'identity exit must confirm durability and release the active lease');
assert.ok(clearIndex>releaseIndex,'identity exit must not clear editors or drafts until durability and release succeed');
assert.ok(leave.indexOf('closeBatchManaged(')<clearIndex,'identity exit must close the batch lease bundle before clearing UI state');

const configEffectStart=app.indexOf("const checkConfig=()=>{");
const configEffectEnd=app.indexOf("const onStorage=",configEffectStart);
const configEffect=app.slice(configEffectStart,configEffectEnd);
const mismatchStart=configEffect.indexOf("if(record&&sameCloudConfig");
const mismatch=configEffect.slice(mismatchStart);
assert.ok(mismatch.includes('status:\'error\'')&&mismatch.includes('保留'),'an external config change must freeze and preserve the editor');
assert.ok(!mismatch.includes('closeEditorForLock(lock')&&!mismatch.includes('void releaseCurrentEditLock()'),'an external config change must not clear or release an unpersisted old-workspace editor');

assert.ok(app.includes('const saveCloudConfiguration = async'),'App must own cloud-config transition durability');
const saveConfigStart=app.indexOf('const saveCloudConfiguration = async');
const saveConfigEnd=app.indexOf('\n  const ',saveConfigStart+10);
const saveConfig=app.slice(saveConfigStart,saveConfigEnd);
assert.ok(saveConfig.includes('activeEditLockRef.current')&&saveConfig.includes('return false'),'controlled config changes must reject while an item editor is active');
assert.ok(saveConfig.indexOf('ensureCloudDurableBeforeLeaseRelease(')<saveConfig.indexOf('saveSupabaseConfig('),'pending cloud state must be durable before config replacement');
assert.ok(management.includes('onSaveSupabaseConfig')&&!management.includes('saveSupabaseConfig(config); window.location.reload()'),'Management must delegate config transition to the durable App handler');
console.log('Identity and cloud-config transition durability contracts passed.');

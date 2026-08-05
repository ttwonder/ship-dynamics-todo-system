import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const app=fs.readFileSync('src/App.tsx','utf8');
const work=fs.readFileSync('src/WorkCenter.tsx','utf8');
const commands=fs.readFileSync('src/normalizedCommands.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260806090000_task_dismissals.sql','utf8');
const normalizedCore=fs.readFileSync('supabase/normalized-core-domain.sql','utf8');
const normalizedAppContract=fs.readFileSync('supabase/normalized-app-contract.sql','utf8');

assert.ok(app.includes('dismissFromMyWorkCenter')&&app.includes('enqueueCloudSave(candidate,isCurrent,false)'),'legacy authority path must wait for a cloud-confirmed dismissal patch');
assert.ok(work.includes('從我的待辦移除（{selectionCount}）')&&work.includes('永久刪除共用待辦（{selectionCount}）'),'personal hiding and privileged permanent deletion must remain distinct actions');
assert.ok(commands.includes("command_ship_dynamics_dismiss_work_center_items"),'normalized authority must use an explicit command RPC');
assert.match(migration,/create policy sd_task_dismissals_read_own[\s\S]*user_id=auth\.uid\(\)/,'RLS must expose only the signed-in user dismissal rows');
assert.match(migration,/sd_task_owner_reset_personal_dismissal/,'new task owner assignment must restore the task for the newly assigned person');
assert.match(migration,/sharedDataDeleted/,'dismissal audit must declare that shared data was not deleted');
assert.match(migration,/v_kind='task' and not public\.sd_can_read_task\(p_workspace_id,v_item_id\)/,'task dismissal must fail closed through the authoritative task visibility helper');
assert.match(migration,/v_kind='internal-control' and not public\.sd_can_read_internal_case\(p_workspace_id,v_item_id\)/,'internal-control dismissal must not expose hidden case existence');
assert.match(normalizedCore,/delete from public\.sd_task_owners[\s\S]*not \(owner_id = any\(v_owners\)\)[\s\S]*on conflict \(workspace_id, task_id, owner_id\) do update/,'task relation replacement must preserve existing owner rows and insert only genuinely new owners');
assert.match(migration,/TG_OP='UPDATE' and old\.is_active/,'unchanged active vessel assignments must not reset personal dismissals');
assert.match(migration,/sd_task_vessel_reset_personal_dismissals/,'new task vessel scope must restore the task for managers and delegates newly brought into scope');
assert.match(normalizedAppContract,/not exists \([\s\S]*jsonb_array_elements\(v_assignments\)/,'user assignment replacement must deactivate only relations absent from the next set');

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const dismissal=await server.ssrLoadModule('/src/taskDismissals.ts');
  const base={taskDismissals:[],tasks:[{id:'t1'}],internalControlCases:[{id:'c1'}]};
  const hidden=dismissal.dismissWorkCenterItems(base,{userId:'u1',taskIds:['t1'],internalControlCaseIds:['c1'],at:'2026-08-06T03:00:00.000Z'});
  assert.equal(hidden.taskDismissals.length,2);
  assert.equal(dismissal.isWorkCenterItemDismissed(hidden,'u1','task','t1'),true);
  assert.equal(dismissal.isWorkCenterItemDismissed(hidden,'u2','task','t1'),false,'one user dismissal must not hide another user work item');
  const reassignedDismissals=dismissal.clearDismissalsForNewTaskAssignments(hidden.taskDismissals,{id:'t1',ownerUserIds:[]},{id:'t1',ownerUserIds:['u1']});
  assert.equal(dismissal.isWorkCenterItemDismissed({taskDismissals:reassignedDismissals},'u1','task','t1'),false,'new assignment must restore a previously dismissed task');
}finally{await server.close();}
console.log('Personal work-center dismissal contracts passed.');

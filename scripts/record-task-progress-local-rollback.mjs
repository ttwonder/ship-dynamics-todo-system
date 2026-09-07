import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

// DEVELOPMENT/SYNTHETIC ONLY. Not a hosted migration runner. Restore old function
// definitions, NEVER an old data backup: newly committed leaves are hydrated too.
export const progressRollbackBase = 'ece55206dde4aa851eb8a1a0c8680c6b9fa7e9c7';
export const progressSqlFiles = ['20260906_appdata_record_store.sql','20260906_appdata_record_delta.sql','20260906_appdata_record_data_management.sql','20260906_record_daily_morning_scheduler.sql'].map(n=>'supabase/development/'+n);
export const oldProgressSql = file => execFileSync('git',['show',`${progressRollbackBase}:${file}`],{encoding:'utf8'});
export const transactionBody = sql => sql.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
export async function upgradeLocalTaskProgress(db) {
 if(!(db instanceof PGlite))throw new Error('LOCAL_SYNTHETIC_PGLITE_ONLY');
 return db.transaction(async tx=>{
  for(const file of progressSqlFiles)await tx.exec(transactionBody(fs.readFileSync(file,'utf8')));
 });
}
export async function rollbackLocalTaskProgress(db) {
 if(!(db instanceof PGlite))throw new Error('LOCAL_SYNTHETIC_PGLITE_ONLY');
 return db.transaction(async tx=>{
  await tx.exec('lock table ship_dynamics_record_workspaces,ship_dynamics_records,ship_dynamics_record_history,ship_dynamics_record_task_progress,ship_dynamics_record_task_progress_history in share row exclusive mode');
  const snapshots=async()=>{
   const rows=(await tx.query('select workspace_key,revision from ship_dynamics_record_versions order by workspace_key,revision')).rows;
   const versions=[];
   for(const r of rows)versions.push((await tx.query('select read_ship_dynamics_record_history_v1($1,$2) result',[r.workspace_key,r.revision])).rows[0].result);
   const current=[];
   for(const r of (await tx.query('select workspace_key from ship_dynamics_record_workspaces order by workspace_key')).rows)current.push((await tx.query('select read_ship_dynamics_records_v1($1) result',[r.workspace_key])).rows[0].result);
   return {versions,current};
  };
  // Reentrant preflight checks every retained body interval (even pruned roots).
  await tx.exec(transactionBody(fs.readFileSync(progressSqlFiles[0],'utf8')));
  const before=await snapshots();
  await tx.exec(`update ship_dynamics_record_history h set value=ship_dynamics_record_hydrate_v1(h.workspace_key,h.collection,h.entity_id,h.value,h.task_progress_meta,h.valid_from_revision),task_progress_meta=null where h.task_progress_meta is not null;
    update ship_dynamics_records r set value=ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision),task_progress_meta=null where r.task_progress_meta is not null;`);
  for(const file of progressSqlFiles)await tx.exec(transactionBody(oldProgressSql(file)));
  await tx.exec(`drop function ship_dynamics_record_progress_write_v1(text,text,jsonb,integer,integer);
    drop function ship_dynamics_record_hydrate_v1(text,text,text,jsonb,jsonb,integer);
    alter table ship_dynamics_records drop column task_progress_meta;
    alter table ship_dynamics_record_history drop column task_progress_meta;
    drop table ship_dynamics_record_task_progress,ship_dynamics_record_task_progress_history;`);
  assert.deepEqual(await snapshots(),before,'reverse must reconstruct ALL readable versions including post-upgrade commits');
  return {versions:before.versions.map(v=>({workspace:v.workspace_key,revision:v.revision})),current:before.current.length};
 });
}

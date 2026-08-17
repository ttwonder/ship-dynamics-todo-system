import assert from 'node:assert/strict';
import fs from 'node:fs';

const management = fs.readFileSync('src/Management.tsx', 'utf8');
const panel = fs.readFileSync('src/DataManagementPanel.tsx', 'utf8');
const client = fs.readFileSync('src/dataManagement.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260817143000_data_management_storage.sql', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.match(management, /type Section = [^;]*'data'/, 'management section union must include data management');
assert.ok(management.includes("label: '操作紀錄'") && management.includes("label: '數據管理'"), 'management sidebar must include audit and data management');
assert.ok(management.indexOf("label: '操作紀錄'") < management.indexOf("label: '數據管理'"), '數據管理 must be immediately after operation records in nav order');
assert.match(management, /currentUser\.role === 'owner' \|\| currentUser\.role === 'admin'/, 'Owner and Admin must be able to view data management');
assert.match(management, /section === 'data'/, 'data management panel must be mounted by the production Management view');

for (const label of [
  'Supabase 資料庫總用量',
  '本系統資料表用量',
  'Supabase Storage 檔案',
  '網站程式檔',
  '單項資料用量',
  '歷史版本選擇性清理',
  '目前正式版本｜不可刪',
  '只供人工判斷',
  '對帳上次操作',
]) assert.ok(panel.includes(label), `missing data-management UI contract: ${label}`);

assert.match(panel, /currentUser\.role === 'owner'/, 'destructive controls must be Owner-only');
assert.match(panel, /expectedRevisions: stats\.revisions\.map/, 'client must send the complete previewed revision set');
assert.match(panel, /writePendingRevisionPrune\(envelope/, 'client must persist the exact pending operation before deletion');
assert.match(panel, /無法保存刪除對帳資料.*未送出任何刪除/, 'local pending persistence failure must stop before the destructive RPC');
const pruneHandler = panel.slice(panel.indexOf('const performPrune'), panel.indexOf('const startPrune'));
assert.ok(pruneHandler.indexOf('await refresh()') < pruneHandler.lastIndexOf('setErrorText(message)'), 'revision-set conflict refresh must preserve the user-visible rejection message');
assert.match(panel, /目前正式 Revision r\$\{stats\.currentRevision\}.*正常資料都不會刪除/s, 'confirmation must state the protected scope');
assert.doesNotMatch(panel, /刪除所選.*待辦|刪除所選.*船舶|刪除所選.*會議/, 'data management must not expose generic business-data deletion');

assert.ok(client.includes("rpc(name, params)") && client.includes("get_ship_dynamics_storage_stats") && client.includes("prune_ship_dynamics_revision_history"), 'cloud client must call both data-management RPCs');
assert.ok(client.includes('RPC_TIMEOUT_MS') && client.includes('DataManagementRpcError'), 'RPC timeout and error classification are required');
assert.ok(client.includes('configIdentity') && client.includes('workspaceKey') && client.includes('actorUserId'), 'pending deletion must be bound to project/workspace/actor identity');

for (const contract of [
  'pg_database_size(current_database())',
  'pg_total_relation_size(c.oid)',
  "to_regclass('storage.objects')",
  'pg_column_size(r)',
  'ship_dynamics_data_management_operations',
  'CURRENT_REVISION_PROTECTED',
  'CURRENT_REVISION_HISTORY_MISSING',
  'REVISION_SET_CHANGED',
  'IDEMPOTENCY_MISMATCH',
  "actor_role is distinct from 'owner'",
  "delete from public.ship_dynamics_app_revisions",
]) assert.ok(migration.includes(contract), `missing SQL safety contract: ${contract}`);

assert.match(migration, /current_revisions is distinct from normalized_expected/, 'server must fail closed when the full revision set changed');
assert.doesNotMatch(migration, /delete from public\.ship_dynamics_app_state/i, 'data cleanup must never delete the current authority row');
assert.doesNotMatch(migration, /delete from storage\.objects/i, 'data cleanup must never delete Storage objects');
assert.ok(pkg.scripts['test:data-management'], 'package.json must expose the focused data-management gate');

console.log('Data management source/UI/SQL contract passed.');

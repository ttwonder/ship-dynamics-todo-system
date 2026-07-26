import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';

const requiredNames = [
  'STAGING_SUPABASE_URL',
  'STAGING_SUPABASE_ANON_KEY',
  'STAGING_WORKSPACE_ID',
  'STAGING_WORKSPACE_KEY',
  'STAGING_SITE_PASSWORD',
  'STAGING_OWNER_ALIAS',
  'STAGING_OWNER_PASSWORD',
  'STAGING_VESSEL_ALIAS',
  'STAGING_VESSEL_PASSWORD',
  'STAGING_VISIBLE_TASK_ID',
  'STAGING_HIDDEN_TASK_ID',
];
const missing = requiredNames.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`staging_runtime=BLOCKED missing=${missing.join(',')}`);
  process.exit(2);
}
const env = Object.fromEntries(requiredNames.map(name => [name, process.env[name]]));
const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../public/supabase-config.js', import.meta.url), 'utf8'), sandbox);
const productionUrl = String(sandbox.window.SHIP_DYNAMICS_SUPABASE_CONFIG?.supabaseUrl || '').replace(/\/$/, '');
const stagingUrl = env.STAGING_SUPABASE_URL.replace(/\/$/, '');
if (!productionUrl || stagingUrl === productionUrl) {
  console.error('staging_runtime=BLOCKED reason=production-target-refused');
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const gateClient = createClient(stagingUrl, env.STAGING_SUPABASE_ANON_KEY, options);
const gate = await gateClient.functions.invoke('site-unlock', {
  body: { workspaceKey: env.STAGING_WORKSPACE_KEY, password: env.STAGING_SITE_PASSWORD },
});
assert.equal(gate.error, null);
assert.ok(gate.data?.gateToken);
const directory = await gateClient.functions.invoke('login-directory', {
  body: { action: 'directory', workspaceKey: env.STAGING_WORKSPACE_KEY },
  headers: { 'x-site-gate-token': gate.data.gateToken },
});
assert.equal(directory.error, null);
assert.ok(Array.isArray(directory.data?.people));
assert.ok(directory.data.people.every(person => person.authAlias && !person.userId && !person.passwordHash));

async function signedIn(alias, password) {
  const client = createClient(stagingUrl, env.STAGING_SUPABASE_ANON_KEY, options);
  const login = await client.auth.signInWithPassword({ email: alias, password });
  assert.equal(login.error, null);
  assert.ok(login.data.session);
  const verified = await client.auth.getUser();
  assert.equal(verified.error, null);
  assert.equal(verified.data.user?.id, login.data.user?.id);
  return client;
}
const ownerA = await signedIn(env.STAGING_OWNER_ALIAS, env.STAGING_OWNER_PASSWORD);
const ownerB = await signedIn(env.STAGING_OWNER_ALIAS, env.STAGING_OWNER_PASSWORD);
const vessel = await signedIn(env.STAGING_VESSEL_ALIAS, env.STAGING_VESSEL_PASSWORD);

const ownerMembership = await ownerA.from('sd_memberships')
  .select('role,is_active,version')
  .eq('workspace_id', env.STAGING_WORKSPACE_ID)
  .eq('user_id', (await ownerA.auth.getUser()).data.user.id)
  .single();
assert.equal(ownerMembership.error, null);
assert.equal(ownerMembership.data.role, 'owner');
assert.equal(ownerMembership.data.is_active, true);

const visible = await vessel.from('sd_tasks').select('id').eq('workspace_id', env.STAGING_WORKSPACE_ID)
  .eq('id', env.STAGING_VISIBLE_TASK_ID).maybeSingle();
const hidden = await vessel.from('sd_tasks').select('id').eq('workspace_id', env.STAGING_WORKSPACE_ID)
  .eq('id', env.STAGING_HIDDEN_TASK_ID).maybeSingle();
assert.equal(visible.error, null);
assert.ok(visible.data);
assert.equal(hidden.error, null);
assert.equal(hidden.data, null);
const directDml = await vessel.from('sd_tasks').update({ description: 'forbidden' })
  .eq('workspace_id', env.STAGING_WORKSPACE_ID).eq('id', env.STAGING_VISIBLE_TASK_ID);
assert.ok(directDml.error, 'vessel direct DML must be rejected');

const ownerSessionA = crypto.randomUUID();
const ownerSessionB = crypto.randomUUID();
const leaseKey = `task:${env.STAGING_VISIBLE_TASK_ID}`;
const claimA = await ownerA.rpc('claim_ship_dynamics_entity_lease', {
  p_workspace_id: env.STAGING_WORKSPACE_ID,
  p_lease_key: leaseKey,
  p_entity_type: 'task',
  p_entity_id: env.STAGING_VISIBLE_TASK_ID,
  p_owner_session: ownerSessionA,
  p_ttl_seconds: 75,
});
assert.equal(claimA.error, null);
assert.equal(claimA.data.ok, true);
const claimBBlocked = await ownerB.rpc('claim_ship_dynamics_entity_lease', {
  p_workspace_id: env.STAGING_WORKSPACE_ID,
  p_lease_key: leaseKey,
  p_entity_type: 'task',
  p_entity_id: env.STAGING_VISIBLE_TASK_ID,
  p_owner_session: ownerSessionB,
  p_ttl_seconds: 75,
});
assert.equal(claimBBlocked.error, null);
assert.equal(claimBBlocked.data.ok, false);
await ownerA.rpc('release_ship_dynamics_entity_lease', {
  p_workspace_id: env.STAGING_WORKSPACE_ID,
  p_lease_key: leaseKey,
  p_owner_session: ownerSessionA,
  p_fencing_token: claimA.data.fencingToken,
});
const claimB = await ownerB.rpc('claim_ship_dynamics_entity_lease', {
  p_workspace_id: env.STAGING_WORKSPACE_ID,
  p_lease_key: leaseKey,
  p_entity_type: 'task',
  p_entity_id: env.STAGING_VISIBLE_TASK_ID,
  p_owner_session: ownerSessionB,
  p_ttl_seconds: 75,
});
assert.equal(claimB.error, null);
assert.equal(claimB.data.ok, true);
assert.ok(Number(claimB.data.fencingToken) > Number(claimA.data.fencingToken));
const staleRenew = await ownerA.rpc('renew_ship_dynamics_entity_lease', {
  p_workspace_id: env.STAGING_WORKSPACE_ID,
  p_lease_key: leaseKey,
  p_owner_session: ownerSessionA,
  p_fencing_token: claimA.data.fencingToken,
  p_ttl_seconds: 75,
});
assert.ok(staleRenew.error || staleRenew.data === false);

const task = await ownerB.from('sd_tasks').select('*').eq('workspace_id', env.STAGING_WORKSPACE_ID)
  .eq('id', env.STAGING_VISIBLE_TASK_ID).single();
assert.equal(task.error, null);
const relationQueries = await Promise.all([
  ownerB.from('sd_task_vessels').select('vessel_id').eq('workspace_id', env.STAGING_WORKSPACE_ID).eq('task_id', env.STAGING_VISIBLE_TASK_ID).eq('is_active_scope', true).order('vessel_id'),
  ownerB.from('sd_task_categories').select('category').eq('workspace_id', env.STAGING_WORKSPACE_ID).eq('task_id', env.STAGING_VISIBLE_TASK_ID).order('ordinal'),
  ownerB.from('sd_task_departments').select('department').eq('workspace_id', env.STAGING_WORKSPACE_ID).eq('task_id', env.STAGING_VISIBLE_TASK_ID).order('ordinal'),
  ownerB.from('sd_task_owners').select('owner_id').eq('workspace_id', env.STAGING_WORKSPACE_ID).eq('task_id', env.STAGING_VISIBLE_TASK_ID).order('ordinal'),
  ownerB.from('sd_task_type_scopes').select('ship_type').eq('workspace_id', env.STAGING_WORKSPACE_ID).eq('task_id', env.STAGING_VISIBLE_TASK_ID).order('ordinal'),
]);
for (const query of relationQueries) assert.equal(query.error, null);
const content = {
  description: task.data.description,
  status: task.data.status,
  priority: task.data.priority,
  expectedDate: task.data.expected_date || '',
  reportDate: task.data.report_date || '',
  equipmentSubcategory: task.data.equipment_subcategory || '',
  isAware: task.data.is_aware,
  isAbnormal: task.data.is_abnormal,
  vesselIds: relationQueries[0].data.map(row => row.vessel_id),
  categories: relationQueries[1].data.map(row => row.category),
  departments: relationQueries[2].data.map(row => row.department),
  ownerUserIds: relationQueries[3].data.map(row => row.owner_id),
  typeScopes: relationQueries[4].data.map(row => row.ship_type),
};

let resolveRealtime;
const realtimeSeen = new Promise((resolve, reject) => {
  resolveRealtime = resolve;
  setTimeout(() => reject(new Error('realtime-timeout')), 10000);
});
const channel = ownerB.channel(`staging-${crypto.randomUUID()}`)
  .on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'sd_tasks', filter: `workspace_id=eq.${env.STAGING_WORKSPACE_ID}`,
  }, payload => {
    if (payload.new?.id === env.STAGING_VISIBLE_TASK_ID) resolveRealtime(payload);
  }).subscribe();
const operationId = crypto.randomUUID();
const command = await ownerB.rpc('command_ship_dynamics_update_ordinary_task', {
  p_operation_id: operationId,
  p_workspace_id: env.STAGING_WORKSPACE_ID,
  p_task_id: env.STAGING_VISIBLE_TASK_ID,
  p_base_version: task.data.version,
  p_lease_key: leaseKey,
  p_owner_session: ownerSessionB,
  p_fencing_token: claimB.data.fencingToken,
  p_content: content,
});
assert.equal(command.error, null);
assert.equal(command.data.status, 'committed');
await realtimeSeen;
const refetched = await ownerB.from('sd_tasks').select('version').eq('workspace_id', env.STAGING_WORKSPACE_ID)
  .eq('id', env.STAGING_VISIBLE_TASK_ID).single();
assert.equal(Number(refetched.data.version), Number(task.data.version) + 1);
const replay = await ownerB.rpc('command_ship_dynamics_update_ordinary_task', {
  p_operation_id: operationId,
  p_workspace_id: env.STAGING_WORKSPACE_ID,
  p_task_id: env.STAGING_VISIBLE_TASK_ID,
  p_base_version: task.data.version,
  p_lease_key: leaseKey,
  p_owner_session: ownerSessionB,
  p_fencing_token: claimB.data.fencingToken,
  p_content: content,
});
assert.equal(replay.error, null);
assert.equal(replay.data.replayed, true);
await ownerB.removeChannel(channel);
await ownerB.rpc('release_ship_dynamics_entity_lease', {
  p_workspace_id: env.STAGING_WORKSPACE_ID,
  p_lease_key: leaseKey,
  p_owner_session: ownerSessionB,
  p_fencing_token: claimB.data.fencingToken,
});
await Promise.all([ownerA.auth.signOut(), ownerB.auth.signOut(), vessel.auth.signOut()]);
console.log('staging_supabase_runtime=PASS');

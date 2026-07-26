import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, 'src');
const extensions = ['.ts', '.tsx'];
const exists = async path => { try { return (await stat(path)).isFile(); } catch { return false; } };
const resolveImport = async (from, specifier) => {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, ...extensions.map(ext => base + ext), ...extensions.map(ext => resolve(base, 'index' + ext))]) {
    if (await exists(candidate)) return candidate;
  }
  return null;
};

const queue = [resolve(sourceRoot, 'main.tsx')];
const reachable = new Map();
while (queue.length) {
  const path = queue.shift();
  if (!path || reachable.has(path)) continue;
  const source = await readFile(path, 'utf8');
  reachable.set(path, source);
  const imports = [...source.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map(match => match[1]);
  for (const specifier of imports) {
    const target = await resolveImport(path, specifier);
    if (target && !reachable.has(target)) queue.push(target);
  }
}

const combined = [...reachable.entries()].map(([path, source]) => `\n/* ${path.slice(sourceRoot.length + 1)} */\n${source}`).join('\n');
const forbidden = [
  ['legacy whole-payload load', /\bloadCloudData\b/],
  ['legacy whole-payload save', /\bsaveCloudData\b/],
  ['legacy whole-payload fetch', /\bfetchCloudData\b/],
  ['legacy whole-payload subscription', /\bsubscribeCloudData\b/],
  ['legacy local AppData load', /\bloadLocal\s*\(/],
  ['legacy local AppData save', /\bsaveLocal\s*\(/],
  ['legacy AppData storage key', /ship-dynamics-app-data-v1/],
  ['legacy local identity key', /ship-dynamics-current-user-v1/],
  ['legacy app-state table', /ship_dynamics_app_state/],
  ['client whole-AppData rebase', /\b(?:prepareCloudSyncSnapshot|rebaseDisjointAppData|trustedPersistedBaseForRemote)\b/],
  ['client durable creation authority', /\b(?:runDurableCreationHandoff|waitForDurableCreationHandoff|CLOUD_CONFIRMED_BASE_KEY|CLOUD_REVISION_FLOORS_KEY)\b/],
  ['client password hashing', /\bsha256\s*\(/],
  ['non-persistent Supabase Auth session', /persistSession\s*:\s*false/],
  ['browser service-role secret', /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role/i],
];
const violations = forbidden.filter(([, pattern]) => pattern.test(combined)).map(([name]) => name);
assert.deepEqual(violations, [], `reachable legacy/security violations: ${violations.join(', ')}`);

const reachableNames = new Set([...reachable.keys()].map(path => basename(path)));
for (const legacyModule of ['App.tsx', 'cloud.ts', 'cloudRebase.ts', 'cloudRecovery.ts', 'Management.tsx', 'TemporaryMeetings.tsx']) {
  assert.equal(reachableNames.has(legacyModule), false, `${legacyModule} must not be reachable from main.tsx`);
}
for (const [path, source] of reachable) {
  if (!/\b(?:localStorage|sessionStorage)\b/.test(source)) continue;
  assert.ok(
    ['normalizedAuth.ts', 'normalizedRepository.ts'].includes(basename(path)),
    `${basename(path)} contains unapproved browser storage access`,
  );
}

assert.match(combined, /\.auth\.(?:getUser|getSession)\s*\(/, 'reachable client must authenticate through Supabase Auth session');
assert.match(combined, /onAuthStateChange\s*\(/, 'reachable client must invalidate on auth generation changes');
assert.match(combined, /class\s+NormalizedRepository|createNormalizedRepository/, 'reachable typed normalized repository is required');
assert.match(combined, /reserve_ship_dynamics_operation/, 'every reachable command must use the reservation RPC');
assert.match(combined, /get_ship_dynamics_operation_status/, 'ambiguous commands must recover through operation status');
assert.match(combined, /fetchApplicationProjection|refetchInvalidatedProjection/, 'normalized projection/refetch reader is required');
assert.match(combined, /subscribeInvalidations/, 'Realtime must be used only as invalidation input');
assert.match(combined, /task-progress:|internal-case:|settings:/, 'entity-scoped normalized adapters are required');
assert.match(combined, /operationId/, 'operation recovery contract is required');
assert.match(combined, /fencingToken/, 'lease fencing contract is required');
assert.doesNotMatch(combined, /save(?:AppData|CloudData)\s*\([^)]*AppData/, 'no whole-AppData write API may be reachable');

console.log(`normalized_cutover_reachable_files=${reachable.size}`);
console.log('normalized_cutover_client=PASS');

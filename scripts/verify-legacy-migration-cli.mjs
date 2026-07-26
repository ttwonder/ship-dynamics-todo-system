import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  buildMigrationPlan,
  postgresJsonbText,
  runMigrationCli,
} from './migrate-legacy-to-normalized.mjs';

const payload = {
  users: [{ id: 'owner', role: 'owner', isActive: true }],
  vessels: [], tasks: [], meetings: [], internalControlCases: [],
  notifications: [], auditLogs: [], agendaReports: [],
  settings: {
    departments: [], taskCategories: [], meetingTaskCategories: [], priorities: [],
    equipmentFailureSubcategories: [], rolePermissions: {},
  },
};
const mapping = [{
  legacyUserId: 'owner',
  authUserId: '11111111-1111-4111-8111-111111111111',
  authAlias: 'opaque@internal.invalid',
  activationState: 'precreated',
}];
const plan = buildMigrationPlan(payload, 7, mapping);
assert.equal(plan.ready, true);
assert.equal(plan.revision, 7);
assert.equal(plan.counts.users, 1);
assert.equal(plan.quarantineCount, 0);
assert.match(plan.payloadSha256, /^[0-9a-f]{64}$/);
assert.equal(postgresJsonbText({ b: [true, 'x'], a: 1 }), '{"a": 1, "b": [true, "x"]}');

const directory = await mkdtemp(join(tmpdir(), 'ship-migration-cli-'));
try {
  const payloadPath = join(directory, 'payload.json');
  const mappingPath = join(directory, 'mapping.json');
  await writeFile(payloadPath, JSON.stringify(payload));
  await writeFile(mappingPath, JSON.stringify(mapping));
  const messages = [];
  const originalLog = console.log;
  console.log = message => messages.push(String(message));
  try {
    const code = await runMigrationCli([
      '--payload', payloadPath,
      '--revision', '7',
      '--mapping', mappingPath,
      '--workspace-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '--workspace-key', 'fixture',
      '--workspace-name', 'Fixture',
    ], {});
    assert.equal(code, 0);
  } finally {
    console.log = originalLog;
  }
  const output = JSON.parse(messages.at(-1));
  assert.equal(output.ready, true);
  assert.equal(output.counts.users, 1);
  assert.ok(!JSON.stringify(output).includes('opaque@internal.invalid'));

  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(new URL('../public/supabase-config.js', import.meta.url), 'utf8'), sandbox);
  await assert.rejects(
    () => runMigrationCli([
      '--payload', payloadPath,
      '--revision', '7',
      '--mapping', mappingPath,
      '--workspace-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '--workspace-key', 'fixture',
      '--workspace-name', 'Fixture',
      '--apply',
      '--confirm', 'staging:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:7',
    ], {
      MIGRATION_SUPABASE_URL: sandbox.window.SHIP_DYNAMICS_SUPABASE_CONFIG.supabaseUrl,
      MIGRATION_SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key',
    }),
    /production-target-refused/,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log('legacy_migration_cli=PASS');

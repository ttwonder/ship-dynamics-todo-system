import assert from 'node:assert/strict';
import fs from 'node:fs';

const types = fs.readFileSync('src/types.ts', 'utf8');
const normalize = fs.readFileSync('src/normalize.ts', 'utf8');
const management = fs.readFileSync('src/Management.tsx', 'utf8');
const normalizedManagement = fs.readFileSync('src/NormalizedManagement.tsx', 'utf8');
const projection = fs.readFileSync('src/normalizedProjection.ts', 'utf8');
const normalizedCommands = fs.readFileSync('src/normalizedCommands.ts', 'utf8');
const schema = fs.readFileSync('supabase/schema.sql', 'utf8');
const normalizedSchema = fs.readFileSync('supabase/normalized-schema.sql', 'utf8');
const migrationPath = 'supabase/migrations/20260806183000_audit_request_context.sql';

assert.match(types, /ipAddress\?: string/);
assert.match(types, /ipCountryCode\?: string/);
assert.match(normalize, /ipAddress: text\(item\.ipAddress\) \|\| undefined/);
assert.match(normalize, /ipCountryCode: text\(item\.ipCountryCode\) \|\| undefined/);

assert.ok(fs.existsSync('src/auditPresentation.ts'), 'must provide one shared human-readable audit presenter');
const presentation = fs.readFileSync('src/auditPresentation.ts', 'utf8');
for (const contract of [
  "update_vessel_manual_attention: '更新船舶手動關注度'",
  "create_ordinary_task: '新增一般要事'",
  "update_internal_case: '更新內控異常'",
  "update_site_gate: '更新進站密碼'",
  'vesselDisplayName',
  'richTextToPlainText',
  'Intl.DisplayNames',
]) assert.ok(presentation.includes(contract), `missing audit presentation contract: ${contract}`);
const commandCodes = [...normalizedCommands.matchAll(/command: '([a-z_]+)'/g)].map(match => match[1]);
for (const command of commandCodes) {
  assert.ok(presentation.includes(`${command}: '`), `normalized command is missing a human-readable label: ${command}`);
}
for (const command of ['delete_ordinary_task', 'cancel_internal_case', 'reopen_internal_case',
  'resolve_migration_quarantine', 'complete_password_activation', 'legacy_import']) {
  assert.ok(presentation.includes(`${command}: '`), `server-only audit command is missing a human-readable label: ${command}`);
}
assert.match(presentation, /password\|hash\|token\|secret/i, 'normalized JSON details must filter sensitive fields');

for (const source of [management, normalizedManagement]) {
  assert.ok(source.includes("from './auditPresentation'"), 'both management surfaces must use the shared presenter');
  assert.ok(source.includes('presentAuditLog('), 'both management surfaces must render human-readable audit details');
  assert.ok(source.includes('IP號碼'), 'both management surfaces must label the IP address');
  assert.ok(source.includes('IP歸屬地'), 'both management surfaces must label the optional location');
  assert.ok(source.includes('具體操作'), 'both management surfaces must foreground the concrete action');
}

assert.match(projection, /ipAddress: text\(row\.ip_address\) \|\| undefined/);
assert.match(projection, /ipCountryCode: text\(row\.ip_country_code\) \|\| undefined/);

for (const sql of [schema, normalizedSchema]) {
  assert.ok(sql.includes("current_setting('request.headers', true)"), 'database must derive network context from the Supabase request');
  assert.ok(sql.includes("'x-forwarded-for'"), 'database must use Supabase X-Forwarded-For');
  assert.ok(sql.includes("'cf-ipcountry'"), 'database may retain proxy-provided country code without a third party lookup');
}
assert.ok(schema.includes("audit_item - 'ipAddress' - 'ipCountryCode'"), 'legacy trigger must remove browser-supplied network fields');
assert.ok(schema.includes('returning payload into working_payload'), 'block RPC must return the server-stamped payload');
assert.ok(normalizedSchema.includes('ip_address inet'));
assert.ok(normalizedSchema.includes('ip_country_code text'));
assert.ok(normalizedSchema.includes('sd_stamp_audit_request_context'));
assert.ok(fs.existsSync(migrationPath), 'deployed workspaces need an explicit migration');
const migration = fs.readFileSync(migrationPath, 'utf8');
assert.ok(migration.includes('stamp_ship_dynamics_audit_network_context'));
assert.ok(migration.includes('sd_stamp_audit_request_context'));

console.log('Human-readable audit activity and request-context contracts passed.');

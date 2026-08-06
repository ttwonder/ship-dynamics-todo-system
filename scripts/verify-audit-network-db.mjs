import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(fs.readFileSync('supabase/schema.sql', 'utf8'));
  await db.exec('create table public.sd_audit_events (id text primary key)');
  await db.exec(fs.readFileSync('supabase/migrations/20260806183000_audit_request_context.sql', 'utf8'));
  // Reproduce the already-deployed first migration before its search-path hardening.
  await db.exec(`
    alter function public.ship_dynamics_request_client_ip() set search_path = public;
    alter function public.ship_dynamics_request_country_code() set search_path = public;
    alter function public.stamp_ship_dynamics_audit_network_context() set search_path = public;
    alter function public.sd_stamp_audit_request_context() set search_path = public;
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20260807090000_harden_audit_request_context_search_path.sql', 'utf8'));
  const unsafeRequestContextDefiners = await db.query(`
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'ship_dynamics_request_client_ip',
        'ship_dynamics_request_country_code',
        'stamp_ship_dynamics_audit_network_context',
        'sd_stamp_audit_request_context'
      )
      and p.prosecdef
      and not ('search_path=pg_catalog, public'=any(coalesce(p.proconfig,'{}'::text[])))
    order by p.proname
  `);
  assert.deepEqual(unsafeRequestContextDefiners.rows, [], 'request-context SECURITY DEFINER functions must pin pg_catalog before public');
  const actor = { id: 'owner-1', name: 'Owner', role: 'owner', isActive: true, managedVesselIds: [] };
  const payload = {
    revision: 1,
    updatedAt: '2026-08-06T10:00:00.000Z',
    settings: { rolePermissions: { owner: {} }, sitePasswordHash: '' },
    users: [actor], vessels: [], tasks: [], internalControlCases: [], meetings: [], agendaReports: [], taskDismissals: [], notifications: [], auditLogs: [],
  };
  await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values ($1,$2::jsonb,$3,$4)', ['audit-network', JSON.stringify(payload), 1, 'seed']);
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': '203.0.113.42, 10.0.0.4', 'cf-ipcountry': 'TW' })]);
  const actorGuard = (await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2) as value', [JSON.stringify(payload), actor.id])).rows[0].value;
  const clientAudit = {
    id: 'audit-1', at: '2026-08-06T10:01:00.000Z', actorId: actor.id, actorName: actor.name, actorRole: actor.role,
    action: '更新船舶', entityType: 'vessel', entityId: 'vessel-1', detail: '測試',
    ipAddress: '198.51.100.99', ipCountryCode: 'US',
  };
  const applied = (await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value', [
    'audit-network', JSON.stringify([{ kind: 'entity', collection: 'auditLogs', entityId: clientAudit.id, expected: null, value: clientAudit }]), actor.name, actor.id, JSON.stringify(actorGuard), null, '[]',
  ])).rows[0].value;
  assert.equal(applied.ok, true);
  assert.equal(applied.payload.auditLogs[0].ipAddress, '203.0.113.42', 'RPC response must contain the server-derived address');
  assert.equal(applied.payload.auditLogs[0].ipCountryCode, 'TW', 'RPC response may contain proxy-provided country code');
  assert.notEqual(applied.payload.auditLogs[0].ipAddress, clientAudit.ipAddress, 'browser-supplied IP must never win');

  const stored = (await db.query("select payload from public.ship_dynamics_app_state where workspace_key='audit-network'")).rows[0].payload;
  assert.equal(stored.auditLogs[0].ipAddress, '203.0.113.42');
  stored.auditLogs[0].ipAddress = '192.0.2.77';
  stored.auditLogs[0].ipCountryCode = 'JP';
  stored.revision += 1;
  await db.query("update public.ship_dynamics_app_state set payload=$1::jsonb, revision=revision+1 where workspace_key='audit-network'", [JSON.stringify(stored)]);
  const protectedPayload = (await db.query("select payload from public.ship_dynamics_app_state where workspace_key='audit-network'")).rows[0].payload;
  assert.equal(protectedPayload.auditLogs[0].ipAddress, '203.0.113.42', 'existing audit IP must be immutable');
  assert.equal(protectedPayload.auditLogs[0].ipCountryCode, 'TW', 'existing audit country must be immutable');

  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': 'not-an-ip', 'cf-ipcountry': 'invalid' })]);
  protectedPayload.auditLogs.push({ ...clientAudit, id: 'audit-2', ipAddress: '192.0.2.99', ipCountryCode: 'JP' });
  protectedPayload.revision += 1;
  await db.query("update public.ship_dynamics_app_state set payload=$1::jsonb, revision=revision+1 where workspace_key='audit-network'", [JSON.stringify(protectedPayload)]);
  const invalidHeaderPayload = (await db.query("select payload from public.ship_dynamics_app_state where workspace_key='audit-network'")).rows[0].payload;
  assert.equal(invalidHeaderPayload.auditLogs.length, 2, 'invalid location lookup must not block the core audit write');
  assert.equal(invalidHeaderPayload.auditLogs[1].ipAddress, undefined, 'invalid request IP must fail closed instead of accepting the browser value');
  assert.equal(invalidHeaderPayload.auditLogs[1].ipCountryCode, undefined, 'invalid proxy country must fail closed');

  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': '203.0.113.42, 10.0.0.4', 'cf-ipcountry': 'TW' })]);
  await db.query('insert into public.sd_audit_events(id) values ($1)', ['normalized-audit-1']);
  const normalizedAudit = (await db.query("select host(ip_address) as ip_address, ip_country_code from public.sd_audit_events where id='normalized-audit-1'")).rows[0];
  assert.equal(normalizedAudit.ip_address, '203.0.113.42', 'normalized audit inserts must receive the same server-derived IP');
  assert.equal(normalizedAudit.ip_country_code, 'TW');

  console.log('Audit request-context database contracts passed.');
} finally {
  await db.close();
}

import assert from 'node:assert/strict';
import { createServer } from 'vite';

class FakeClient {
  calls = [];
  handler;
  constructor(handler) { this.handler = handler; }
  async rpc(name, args) {
    this.calls.push({ name, args });
    return this.handler(name, args, this.calls);
  }
}

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const cloud = await server.ssrLoadModule('/src/itinerary/itineraryCloud.ts');
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const document = types.createEmptyItineraryDocument({ workspaceKey: 'default', vesselId: 'v1', vesselName: 'Vessel One', rowId: 'r1' });
  document.revision = 1;
  document.updatedAt = '2026-08-31T00:00:00Z';
  document.updatedActorKind = 'office';
  document.updatedActorLabel = 'Owner';
  document.rows[0].voyageNumber = 'V001';
  const serverDocument = { ...structuredClone(document), updatedAt: '2026-08-31T00:00:00+00:00' };
  const config = { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key', workspaceKey: 'default', tableName: 'state' };

  const officeClient = new FakeClient((name) => {
    if (name === 'sd_itinerary_load_many') return { data: [{ vesselId: 'v1', document: serverDocument }], error: null };
    if (name === 'sd_itinerary_claim_office_lease') return { data: { ok: true, leaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fencingToken: 7, expiresAt: '2026-08-31T01:00:00Z' }, error: null };
    if (name === 'sd_itinerary_save_office') return { data: null, error: { message: 'network response lost' } };
    if (name === 'sd_itinerary_operation_status_office') return { data: { document: serverDocument, revision: 1 }, error: null };
    throw new Error(`unexpected office RPC ${name}`);
  });
  const office = new cloud.OfficeItineraryCloudRepository(config, officeClient);
  assert.equal((await office.loadDocument('v1')).revision, 1);
  const claim = await office.claimLease('v1', { holderId: 'tab-1', holderLabel: 'Owner' });
  assert.equal(claim.ok, true);
  const recovered = await office.save({ document, expectedRevision: 0, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lease: claim.lease, actorLabel: 'Owner' });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.replayed, true);
  const saveCall = officeClient.calls.find(call => call.name === 'sd_itinerary_save_office');
  assert.deepEqual(saveCall.args.p_rows, document.rows);
  assert.equal('p_document' in saveCall.args, false);
  assert.ok(officeClient.calls.some(call => call.name === 'sd_itinerary_operation_status_office'));

  const publicClient = new FakeClient((name) => {
    if (name === 'sd_itinerary_public_list_vessels') return { data: [{ id: 'v1', name: '安華', shortName: 'SA', fullName: 'FPMC S AMBER' }], error: null };
    if (name === 'sd_itinerary_public_load') return { data: { ...serverDocument, updatedActorKind: 'public' }, error: null };
    throw new Error(`unexpected public RPC ${name}`);
  });
  const publicRepo = new cloud.PublicItineraryCloudRepository(config, publicClient, 'public-browser');
  assert.deepEqual(await publicRepo.listVessels(), [{ id: 'v1', name: '安華', shortName: 'SA', fullName: 'FPMC S AMBER' }]);
  const publicDoc = await publicRepo.loadDocument('v1');
  assert.equal(publicDoc.updatedActorKind, 'vessel');
  assert.equal(publicDoc.updatedAt, '2026-08-31T00:00:00Z');

  const rolloutClient = new FakeClient((name) => {
    if (name === 'sd_itinerary_owner_update_rollout') return { data: { ok: true, version: 2, mainEnabled: true, shipPortalEnabled: true, replayed: false }, error: null };
    throw new Error(`unexpected rollout RPC ${name}`);
  });
  const rolloutOperationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const rolloutUpdate = await cloud.updateOwnerItineraryRollout({ expectedVersion: 1, mainEnabled: true, shipPortalEnabled: true, operationId: rolloutOperationId }, config, rolloutClient);
  assert.equal(rolloutUpdate.version, 2);
  assert.equal(rolloutUpdate.shipPortalEnabled, true);
  const rolloutCall = rolloutClient.calls[0];
  assert.equal(rolloutCall.name, 'sd_itinerary_owner_update_rollout');
  assert.equal(rolloutCall.args.p_expected_version, 1);
  assert.equal(rolloutCall.args.p_operation_id, rolloutOperationId);
  assert.equal(rolloutCall.args.p_main_enabled, true);
  assert.equal(rolloutCall.args.p_ship_portal_enabled, true);
  assert.deepEqual(rolloutCall.args.p_role_permissions, {
    admin: { view: true, edit: true, import: true, export: true, calendar: true },
    operator: { view: true, edit: true, import: true, export: true, calendar: true },
    vessel: { view: false, edit: false, import: false, export: false, calendar: false },
  });

  const rolloutRecoveryClient = new FakeClient((name) => {
    if (name === 'sd_itinerary_owner_update_rollout') return { data: null, error: { message: 'network response lost' } };
    if (name === 'sd_itinerary_operation_status_office') return { data: { ok: true, version: 2, mainEnabled: true, shipPortalEnabled: true, replayed: false }, error: null };
    throw new Error(`unexpected rollout recovery RPC ${name}`);
  });
  const recoveredRollout = await cloud.updateOwnerItineraryRollout({ expectedVersion: 1, mainEnabled: true, shipPortalEnabled: true, operationId: rolloutOperationId }, config, rolloutRecoveryClient);
  assert.equal(recoveredRollout.replayed, true);
  assert.deepEqual(rolloutRecoveryClient.calls.map(call => call.name), ['sd_itinerary_owner_update_rollout', 'sd_itinerary_operation_status_office']);
  assert.equal(rolloutRecoveryClient.calls[1].args.p_operation_id, rolloutOperationId);

  const unknownClient = new FakeClient((name) => {
    if (name === 'sd_itinerary_save_public') return { data: null, error: { message: 'connection closed before response' } };
    if (name === 'sd_itinerary_operation_status_public') return { data: { status: 'missing' }, error: null };
    throw new Error(`unexpected unknown-outcome RPC ${name}`);
  });
  const unknownRepo = new cloud.PublicItineraryCloudRepository(config, unknownClient, 'public-browser');
  const unknown = await unknownRepo.save({
    document,
    expectedRevision: 1,
    operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    lease: { workspaceKey: 'default', vesselId: 'v1', leaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', leaseToken: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', holderId: 'public-tab', holderLabel: '船端使用者', fence: 9, expiresAt: '2026-08-31T01:00:00Z' },
    actorLabel: '船端使用者',
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'unknown-outcome');
  assert.equal(unknownClient.calls.find(call => call.name === 'sd_itinerary_save_public').args.p_actor_key, 'public-browser');
  assert.equal(unknownClient.calls.find(call => call.name === 'sd_itinerary_operation_status_public').args.p_actor_key, 'public-browser');

  console.log('itinerary_cloud_adapter=PASS');
} finally {
  await server.close();
}

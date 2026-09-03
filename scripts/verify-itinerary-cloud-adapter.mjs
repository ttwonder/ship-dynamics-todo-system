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
  document.updatedActorKind = 'owner';
  document.updatedActorLabel = 'Owner';
  document.rows[0].voyageNumber = 'V001';
  const serverDocument = { ...structuredClone(document), updatedAt: '2026-08-31T00:00:00+00:00' };
  const config = { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key', workspaceKey: 'default', tableName: 'state' };
  const actor = { userId: 'legacy-owner' };

  const officeClient = new FakeClient((name) => {
    if (name === 'sd_itinerary_main_load_many') return { data: [{ vesselId: 'v1', document: serverDocument }], error: null };
    if (name === 'sd_itinerary_main_claim_lease') return { data: { ok: true, leaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fencingToken: 7, expiresAt: '2026-08-31T01:00:00Z' }, error: null };
    if (name === 'sd_itinerary_main_renew_lease') return { data: { ok: true, leaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fencingToken: 7, expiresAt: '2026-08-31T01:01:00Z' }, error: null };
    if (name === 'sd_itinerary_main_release_lease') return { data: true, error: null };
    if (name === 'sd_itinerary_main_save') return { data: null, error: { message: 'network response lost' } };
    if (name === 'sd_itinerary_main_operation_status') return { data: { document: serverDocument, revision: 1 }, error: null };
    throw new Error(`unexpected office RPC ${name}`);
  });
  const office = new cloud.OfficeItineraryCloudRepository(actor, config, officeClient);
  assert.equal((await office.loadDocument('v1')).revision, 1);
  const claim = await office.claimLease('v1', { holderId: 'tab-1', holderLabel: 'Owner' });
  assert.equal(claim.ok, true);
  assert.equal((await office.renewLease(claim.lease)).ok, true);
  assert.equal(await office.releaseLease(claim.lease), true);
  const recovered = await office.save({ document, expectedRevision: 0, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lease: claim.lease, actorLabel: 'Owner' });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.replayed, true);
  const saveCall = officeClient.calls.find(call => call.name === 'sd_itinerary_main_save');
  assert.deepEqual(saveCall.args.p_rows, document.rows);
  assert.equal('p_document' in saveCall.args, false);
  assert.ok(officeClient.calls.some(call => call.name === 'sd_itinerary_main_operation_status'));
  for (const call of officeClient.calls) {
    assert.equal(call.args.p_actor_user_id, actor.userId, `${call.name} must use the normal-login actor id`);
    assert.equal('p_actor_guard' in call.args, false, `${call.name} must not require a second Itinerary guard`);
  }
  const expectedOfficeArgumentNames = {
    sd_itinerary_main_load_many: ['p_actor_user_id', 'p_vessel_ids', 'p_workspace_key'],
    sd_itinerary_main_claim_lease: ['p_actor_user_id', 'p_holder_label', 'p_holder_session', 'p_ttl_seconds', 'p_vessel_id', 'p_workspace_key'],
    sd_itinerary_main_renew_lease: ['p_actor_user_id', 'p_fencing_token', 'p_holder_session', 'p_lease_id', 'p_ttl_seconds', 'p_vessel_id', 'p_workspace_key'],
    sd_itinerary_main_release_lease: ['p_actor_user_id', 'p_fencing_token', 'p_holder_session', 'p_lease_id', 'p_vessel_id', 'p_workspace_key'],
    sd_itinerary_main_save: ['p_actor_label', 'p_actor_user_id', 'p_expected_revision', 'p_fencing_token', 'p_holder_session', 'p_lease_id', 'p_operation_id', 'p_rows', 'p_vessel_id', 'p_workspace_key'],
    sd_itinerary_main_operation_status: ['p_actor_user_id', 'p_operation_id', 'p_workspace_key'],
  };
  for (const [name, expectedNames] of Object.entries(expectedOfficeArgumentNames)) {
    const call = officeClient.calls.find(candidate => candidate.name === name);
    assert.ok(call, `${name} must be exercised by the adapter contract`);
    assert.deepEqual(Object.keys(call.args).sort(), expectedNames);
  }
  const vesselOffice = new cloud.OfficeItineraryCloudRepository({ userId: 'legacy-vessel' }, config, officeClient);
  assert.equal((await vesselOffice.loadDocument('v1')).revision, 1, 'Vessel must use the same main-site repository when normally logged in');
  assert.equal(cloud.updateOwnerItineraryRollout, undefined, 'the historical Owner rollout API must be removed');

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


  const unknownClient = new FakeClient((name) => {
    if (name === 'sd_itinerary_save_public') return { data: null, error: { message: 'connection closed before response' } };
    if (name === 'sd_itinerary_operation_status_public') return { data: { status: 'missing' }, error: null };
    throw new Error(`unexpected unknown-outcome RPC ${name}`);
  });
  const unknownRepo = new cloud.PublicItineraryCloudRepository(config, unknownClient, 'public-browser');
  document.rows[0].previousPortName = '   ';
  const rejectedMissingPreviousPort = await unknownRepo.save({
    document,
    expectedRevision: 1,
    operationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    lease: { workspaceKey: 'default', vesselId: 'v1', leaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', leaseToken: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', holderId: 'public-tab', holderLabel: '船端使用者', fence: 9, expiresAt: '2026-08-31T01:00:00Z' },
    actorLabel: '船端使用者',
  });
  assert.equal(rejectedMissingPreviousPort.ok, false);
  assert.equal(rejectedMissingPreviousPort.code, 'invalid-document');
  assert.equal(unknownClient.calls.length, 0, 'missing previous port must be rejected before any public save RPC');
  document.rows[0].previousPortName = 'BUSAN';
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

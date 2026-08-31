import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  deriveLegacyBridgePassword,
  sha256Hex,
  verifyLegacyCredential,
  verifyLegacyPayloadCredential,
} from '../supabase/functions/login-directory/legacy-login.mjs';

const oldPassword = 'legacy-personal-password';
const oldHash = await sha256Hex(oldPassword);
assert.equal(oldHash.length, 64);
assert.equal(await verifyLegacyCredential({
  loginMode: 'legacy-password',
  legacyPasswordHash: oldHash,
  password: oldPassword,
}), true, 'the exact legacy password must be accepted');
assert.equal(await verifyLegacyCredential({
  loginMode: 'legacy-password',
  legacyPasswordHash: oldHash,
  password: 'wrong-password',
}), false, 'an incorrect legacy password must be rejected');
assert.equal(await verifyLegacyCredential({
  loginMode: 'legacy-password',
  legacyPasswordHash: 'malformed',
  password: oldPassword,
}), false, 'a malformed stored hash must fail closed');
assert.equal(await verifyLegacyCredential({
  loginMode: 'passwordless',
  legacyPasswordHash: null,
  password: '',
}), true, 'a passwordless account must accept an exactly blank password');
assert.equal(await verifyLegacyCredential({
  loginMode: 'passwordless',
  legacyPasswordHash: null,
  password: 'unexpected',
}), false, 'a passwordless account must reject a supplied password');
assert.equal(await verifyLegacyCredential({
  loginMode: 'supabase',
  legacyPasswordHash: null,
  password: '',
}), false, 'native Supabase accounts must never enter the compatibility path');

const ownerPayload = { users: [{ id: 'legacy-owner', passwordHash: oldHash }] };
assert.equal(await verifyLegacyPayloadCredential({
  payload: ownerPayload,
  legacyUserId: 'legacy-owner',
  password: oldPassword,
}), true, 'the exact linked Owner website password must be accepted');
assert.equal(await verifyLegacyPayloadCredential({
  payload: ownerPayload,
  legacyUserId: 'legacy-owner',
  password: 'wrong-password',
}), false, 'an incorrect Owner website password must be rejected');
assert.equal(await verifyLegacyPayloadCredential({
  payload: { users: [{ id: 'legacy-owner', passwordHash: oldHash }, { id: 'legacy-owner', passwordHash: oldHash }] },
  legacyUserId: 'legacy-owner',
  password: oldPassword,
}), false, 'a duplicate legacy identity must fail closed');
assert.equal(await verifyLegacyPayloadCredential({
  payload: { users: [{ id: 'other-owner', passwordHash: oldHash }] },
  legacyUserId: 'legacy-owner',
  password: oldPassword,
}), false, 'a wrong legacy identity must fail closed');

const bridgeA = await deriveLegacyBridgePassword('server-only-secret', 'workspace-a', 'user-a');
const bridgeARepeat = await deriveLegacyBridgePassword('server-only-secret', 'workspace-a', 'user-a');
const bridgeB = await deriveLegacyBridgePassword('server-only-secret', 'workspace-a', 'user-b');
assert.equal(bridgeA, bridgeARepeat, 'bridge credentials must be deterministic to avoid concurrent-login races');
assert.notEqual(bridgeA, bridgeB, 'bridge credentials must be bound to the exact user');
assert.ok(bridgeA.length >= 40, 'bridge credentials must have sufficient entropy');
assert.equal(bridgeA.includes('server-only-secret'), false, 'bridge credentials must not disclose the server secret');

const edge = await readFile(new URL('../supabase/functions/login-directory/index.ts', import.meta.url), 'utf8');
assert.match(edge, /action !== 'directory'[\s\S]*action !== 'legacy-session'[\s\S]*action !== 'owner-password-session'/,
  'the Edge function must explicitly allow only directory, compatibility-session, and Owner password-session actions');
assert.match(edge, /verifyLegacyCredential\(/,
  'the Edge function must use the reviewed server-only legacy verifier');
assert.match(edge, /auth\.admin\.updateUserById\(/,
  'compatibility login must establish a real Supabase Auth credential server-side');
assert.match(edge, /auth\.signInWithPassword\(/,
  'compatibility login must exchange the bridge credential for a real Supabase session');
const sessionResponse = edge.match(/return jsonResponse\(\{\s*session:[\s\S]*?\}, 200, corsHeaders\);/)?.[0] || '';
assert.ok(sessionResponse, 'the compatibility session response must be structurally identifiable');
assert.doesNotMatch(sessionResponse, /legacyPasswordHash|legacy_password_hash/,
  'the Edge response must never expose the legacy credential hash');
assert.doesNotMatch(sessionResponse, /bridgePassword/,
  'the Edge response must never expose the bridge credential');
assert.match(edge, /role === 'owner'/,
  'Owner must be denied from the legacy compatibility path');
assert.match(edge, /action === 'owner-password-session'[\s\S]*role !== 'owner'/,
  'the Owner password-session path must require the exact Owner role');
assert.match(edge, /legacy_user_id/,
  'the Owner password-session path must use the persisted legacy identity link');
assert.match(edge, /ship_dynamics_app_state/,
  'the Owner password-session path must read the authoritative AppData payload server-side');
assert.match(edge, /verifyLegacyPayloadCredential\(/,
  'the Owner password-session path must verify the current website password server-side');
assert.match(edge, /authPassword = body\.password/,
  'the verified Owner website password must become the Supabase Auth password');
assert.match(edge, /password: authPassword/,
  'both Auth update and sign-in must use the verified Owner password');
assert.match(edge, /role === 'admin' && loginOption\.login_mode === 'passwordless'/,
  'an administrator must never receive passwordless compatibility login');
assert.match(edge, /legacy-login-network/);
assert.match(edge, /legacy-login-identity/);
assert.match(edge, /owner-password-login-network/);
assert.match(edge, /owner-password-login-identity/);

console.log('Normalized legacy-login Edge contracts passed.');

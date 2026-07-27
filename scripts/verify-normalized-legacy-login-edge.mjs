import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  deriveLegacyBridgePassword,
  sha256Hex,
  verifyLegacyCredential,
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

const bridgeA = await deriveLegacyBridgePassword('server-only-secret', 'workspace-a', 'user-a');
const bridgeARepeat = await deriveLegacyBridgePassword('server-only-secret', 'workspace-a', 'user-a');
const bridgeB = await deriveLegacyBridgePassword('server-only-secret', 'workspace-a', 'user-b');
assert.equal(bridgeA, bridgeARepeat, 'bridge credentials must be deterministic to avoid concurrent-login races');
assert.notEqual(bridgeA, bridgeB, 'bridge credentials must be bound to the exact user');
assert.ok(bridgeA.length >= 40, 'bridge credentials must have sufficient entropy');
assert.equal(bridgeA.includes('server-only-secret'), false, 'bridge credentials must not disclose the server secret');

const edge = await readFile(new URL('../supabase/functions/login-directory/index.ts', import.meta.url), 'utf8');
assert.match(edge, /action !== 'directory' && action !== 'legacy-session'/,
  'the Edge function must explicitly allow only directory and compatibility-session actions');
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
assert.match(edge, /role === 'admin' && loginOption\.login_mode === 'passwordless'/,
  'an administrator must never receive passwordless compatibility login');
assert.match(edge, /legacy-login-network/);
assert.match(edge, /legacy-login-identity/);

console.log('Normalized legacy-login Edge contracts passed.');

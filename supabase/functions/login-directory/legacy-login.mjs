const encoder = new TextEncoder();

function bytesFromHex(value) {
  if (!/^[0-9a-f]{64}$/.test(value || '')) return null;
  return Uint8Array.from(value.match(/.{2}/g), pair => Number.parseInt(pair, 16));
}

function constantTimeEqual(left, right) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length, 1);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % Math.max(left.length, 1)] ?? 0)
      ^ (right[index % Math.max(right.length, 1)] ?? 0);
  }
  return difference === 0;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyLegacyCredential({ loginMode, legacyPasswordHash, password }) {
  if (typeof password !== 'string' || password.length > 256) return false;
  if (loginMode === 'passwordless') {
    return legacyPasswordHash == null && password === '';
  }
  if (loginMode !== 'legacy-password') return false;
  const expected = bytesFromHex(legacyPasswordHash);
  if (!expected) return false;
  const supplied = bytesFromHex(await sha256Hex(password));
  return supplied !== null && constantTimeEqual(expected, supplied);
}

export async function deriveLegacyBridgePassword(secret, workspaceId, userId) {
  if (!secret || !workspaceId || !userId) throw new Error('bridge-secret-input-required');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`ship-dynamics-legacy-auth-bridge\u0000${workspaceId}\u0000${userId}`),
  ));
  return `${base64Url(digest)}.Aa1!`;
}

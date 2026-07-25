import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    throw new HttpError(401, 'invalid-token');
  }
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % Math.max(left.length, 1)] ?? 0)
      ^ (right[index % Math.max(right.length, 1)] ?? 0);
  }
  return difference === 0;
}

export async function secretFingerprint(value: string, secret: string): Promise<string> {
  return base64UrlEncode(await hmac(value, secret));
}

export function requestNetworkIdentity(request: Request): string {
  const direct = request.headers.get('cf-connecting-ip')?.trim();
  if (direct) return direct;
  const forwarded = request.headers.get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim();
  return forwarded || 'unknown-network';
}

export async function enforceRateLimit(
  service: SupabaseClient,
  input: {
    scope: string;
    keyMaterial: string;
    limit: number;
    windowSeconds: number;
    secret: string;
  },
): Promise<void> {
  const keyHash = await secretFingerprint(
    `${input.scope}\u0000${input.keyMaterial}`,
    input.secret,
  );
  const { data, error } = await service.rpc('consume_ship_dynamics_rate_limit', {
    p_scope: input.scope,
    p_key_hash: keyHash,
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  });
  if (error) throw new HttpError(503, 'rate-limit-unavailable');
  const allowed = data === true || (
    Boolean(data)
    && typeof data === 'object'
    && (data as Record<string, unknown>).allowed === true
  );
  if (!allowed) throw new HttpError(429, 'rate-limited');
}

export function requiredEnv(name: string, supplied?: string | null): string {
  const value = supplied ?? Deno.env.get(name);
  if (!value) throw new HttpError(500, 'server-misconfigured');
  return value;
}

export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  if (!origin || !configuredOrigins.includes(origin)) {
    throw new HttpError(403, 'origin-not-allowed');
  }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-site-gate-token',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    vary: 'Origin',
  };
}

export function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(
  error: unknown,
  headers: Record<string, string> = {},
): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.code }, error.status, headers);
  }
  return jsonResponse({ error: 'internal-error' }, 500, headers);
}

export async function readJsonObject(request: Request, maximumBytes = 8192) {
  const declaredLength = Number(request.headers.get('content-length') || '0');
  if (declaredLength > maximumBytes) throw new HttpError(413, 'request-too-large');
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, 'invalid-json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid-input');
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  value: unknown,
  field: string,
  maximum = 256,
): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > maximum) {
    throw new HttpError(400, `invalid-${field}`);
  }
  return normalized;
}

export function requiredUuid(value: unknown, field: string): string {
  const normalized = requiredString(value, field, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new HttpError(400, `invalid-${field}`);
  }
  return normalized;
}

export function requiredPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) {
    throw new HttpError(400, 'password-required');
  }
  return value;
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new HttpError(401, 'authentication-required');
  return match[1];
}

export function createServiceClient(
  supabaseUrl: string,
  serverCredential: string,
): SupabaseClient {
  return createClient(supabaseUrl, serverCredential, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireJwtUser(
  request: Request,
  supabaseUrl: string,
  browserCredential: string,
): Promise<{ user: User; accessToken: string }> {
  const accessToken = bearerToken(request);
  const sessionClient = createClient(supabaseUrl, browserCredential, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await sessionClient.auth.getUser(accessToken);
  if (error || !data.user) throw new HttpError(401, 'invalid-session');
  return { user: data.user, accessToken };
}

export interface GateClaims {
  version: 1;
  workspaceKey: string;
  expiresAt: number;
  nonce: string;
}

export async function signGateToken(
  workspaceKey: string,
  secret: string,
  ttlSeconds: number,
): Promise<{ gateToken: string; expiresAt: string }> {
  const expiresAt = Math.floor(Date.now() / 1000) + Math.min(600, Math.max(60, ttlSeconds));
  const claims: GateClaims = {
    version: 1,
    workspaceKey,
    expiresAt,
    nonce: crypto.randomUUID(),
  };
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signature = base64UrlEncode(await hmac(payload, secret));
  return {
    gateToken: `${payload}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifyGateToken(
  token: string,
  workspaceKey: string,
  secret: string,
): Promise<GateClaims> {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) throw new HttpError(401, 'invalid-gate-token');
  const expectedSignature = await hmac(payload, secret);
  if (!constantTimeEqual(expectedSignature, base64UrlDecode(suppliedSignature))) {
    throw new HttpError(401, 'invalid-gate-token');
  }
  let claims: GateClaims;
  try {
    claims = JSON.parse(decoder.decode(base64UrlDecode(payload))) as GateClaims;
  } catch {
    throw new HttpError(401, 'invalid-gate-token');
  }
  if (
    claims.version !== 1
    || claims.workspaceKey !== workspaceKey
    || !Number.isSafeInteger(claims.expiresAt)
    || claims.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    throw new HttpError(401, 'invalid-gate-token');
  }
  return claims;
}

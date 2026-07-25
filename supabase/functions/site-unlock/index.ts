import {
  corsHeadersFor,
  createServiceClient,
  enforceRateLimit,
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonObject,
  requestNetworkIdentity,
  requiredEnv,
  requiredString,
  signGateToken,
} from '../_shared/security.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SITE_GATE_JWT_SECRET = Deno.env.get('SITE_GATE_JWT_SECRET');
const SITE_GATE_TOKEN_TTL_SECONDS = Deno.env.get('SITE_GATE_TOKEN_TTL_SECONDS');
const RATE_LIMIT_HMAC_SECRET = Deno.env.get('RATE_LIMIT_HMAC_SECRET');

Deno.serve(async request => {
  let corsHeaders: Record<string, string> = {};
  try {
    corsHeaders = corsHeadersFor(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') throw new HttpError(405, 'method-not-allowed');

    const body = await readJsonObject(request, 2048);
    const workspaceKey = requiredString(body.workspaceKey, 'workspace-key', 128);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || password.length > 256) throw new HttpError(400, 'invalid-password');

    const service = createServiceClient(
      requiredEnv('SUPABASE_URL', SUPABASE_URL),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
    );
    const rateSecret = requiredEnv('RATE_LIMIT_HMAC_SECRET', RATE_LIMIT_HMAC_SECRET);
    await enforceRateLimit(service, {
      scope: 'site-unlock-network',
      keyMaterial: `${workspaceKey}\u0000${requestNetworkIdentity(request)}`,
      limit: 10,
      windowSeconds: 300,
      secret: rateSecret,
    });
    await enforceRateLimit(service, {
      scope: 'site-unlock-workspace',
      keyMaterial: workspaceKey,
      limit: 100,
      windowSeconds: 300,
      secret: rateSecret,
    });
    const { data, error } = await service.rpc('verify_ship_dynamics_site_password', {
      p_workspace_key: workspaceKey,
      p_password: password,
    });
    const verified = data === true || (
      Boolean(data)
      && typeof data === 'object'
      && (data as Record<string, unknown>).ok === true
    );
    if (error || !verified) throw new HttpError(401, 'gate-denied');

    const configuredTtl = Number(SITE_GATE_TOKEN_TTL_SECONDS || 300);
    const grant = await signGateToken(
      workspaceKey,
      requiredEnv('SITE_GATE_JWT_SECRET', SITE_GATE_JWT_SECRET),
      Number.isFinite(configuredTtl) ? configuredTtl : 300,
    );
    return jsonResponse({
      gateToken: grant.gateToken,
      expiresAt: grant.expiresAt,
    }, 200, corsHeaders);
  } catch (error) {
    return errorResponse(error, corsHeaders);
  }
});

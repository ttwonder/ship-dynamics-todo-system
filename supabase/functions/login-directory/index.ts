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
  verifyGateToken,
} from '../_shared/security.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SITE_GATE_JWT_SECRET = Deno.env.get('SITE_GATE_JWT_SECRET');
const RATE_LIMIT_HMAC_SECRET = Deno.env.get('RATE_LIMIT_HMAC_SECRET');

type ProfileJoin = {
  display_name: string;
  username_label: string;
};

function profileOf(value: unknown): ProfileJoin | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== 'object') return null;
  const profile = candidate as Record<string, unknown>;
  if (typeof profile.display_name !== 'string' || typeof profile.username_label !== 'string') return null;
  return {
    display_name: profile.display_name,
    username_label: profile.username_label,
  };
}

Deno.serve(async request => {
  let corsHeaders: Record<string, string> = {};
  try {
    corsHeaders = corsHeadersFor(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') throw new HttpError(405, 'method-not-allowed');

    const body = await readJsonObject(request, 4096);
    const action = requiredString(body.action, 'action', 32);
    if (!['directory', 'login'].includes(action)) throw new HttpError(400, 'invalid-action');
    const workspaceKey = requiredString(body.workspaceKey, 'workspace-key', 128);
    const gateToken = requiredString(
      request.headers.get('x-site-gate-token'),
      'gate-token',
      4096,
    );
    await verifyGateToken(
      gateToken,
      workspaceKey,
      requiredEnv('SITE_GATE_JWT_SECRET', SITE_GATE_JWT_SECRET),
    );

    const service = createServiceClient(
      requiredEnv('SUPABASE_URL', SUPABASE_URL),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
    );
    const rateSecret = requiredEnv('RATE_LIMIT_HMAC_SECRET', RATE_LIMIT_HMAC_SECRET);
    await enforceRateLimit(service, {
      scope: action === 'login' ? 'login-network' : 'login-directory-network',
      keyMaterial: `${workspaceKey}\u0000${requestNetworkIdentity(request)}`,
      limit: action === 'login' ? 30 : 60,
      windowSeconds: action === 'login' ? 900 : 60,
      secret: rateSecret,
    });
    const { data: workspace, error: workspaceError } = await service
      .from('sd_workspaces')
      .select('id')
      .eq('legacy_key', workspaceKey)
      .eq('is_active', true)
      .maybeSingle();
    if (workspaceError || !workspace) throw new HttpError(401, 'gate-denied');

    if (action === 'directory') {
      const { data, error } = await service
        .from('sd_memberships')
        .select('department,profile:sd_profiles!inner(display_name,username_label)')
        .eq('workspace_id', workspace.id)
        .eq('is_active', true)
        .order('department', { ascending: true });
      if (error) throw new HttpError(500, 'directory-unavailable');
      const people = (data || []).flatMap(row => {
        const profile = profileOf(row.profile);
        return profile ? [{
          department: String(row.department),
          usernameLabel: profile.username_label,
          displayName: profile.display_name,
        }] : [];
      });
      return jsonResponse({ people }, 200, corsHeaders);
    }

    const department = requiredString(body.department, 'department', 128);
    const usernameLabel = requiredString(body.usernameLabel, 'username-label', 128);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || password.length > 256) throw new HttpError(401, 'login-denied');
    await enforceRateLimit(service, {
      scope: 'login-account',
      keyMaterial: `${workspace.id}\u0000${department.toLocaleLowerCase()}\u0000${usernameLabel.toLocaleLowerCase()}`,
      limit: 8,
      windowSeconds: 900,
      secret: rateSecret,
    });

    const { data: matches, error: lookupError } = await service
      .from('sd_memberships')
      .select('user_id,profile:sd_profiles!inner(username_label)')
      .eq('workspace_id', workspace.id)
      .eq('department', department)
      .eq('is_active', true)
      .eq('sd_profiles.username_label', usernameLabel)
      .limit(2);
    if (lookupError || matches?.length !== 1) throw new HttpError(401, 'login-denied');

    const userId = String(matches[0].user_id);
    const { data: authUser, error: authUserError } = await service.auth.admin.getUserById(userId);
    const syntheticEmail = authUser.user?.email;
    if (authUserError || !syntheticEmail) throw new HttpError(401, 'login-denied');

    const authBaseUrl = requiredEnv('SUPABASE_URL', SUPABASE_URL).replace(/\/+$/, '');
    const authResponse = await fetch(
      `${authBaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          apikey: requiredEnv('SUPABASE_ANON_KEY', SUPABASE_ANON_KEY),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: syntheticEmail, password }),
      },
    );
    const session = await authResponse.json().catch(() => null);
    if (
      !authResponse.ok
      || !session
      || typeof session.access_token !== 'string'
      || typeof session.refresh_token !== 'string'
    ) {
      throw new HttpError(401, 'login-denied');
    }
    return jsonResponse({
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
      },
    }, 200, corsHeaders);
  } catch (error) {
    return errorResponse(error, corsHeaders);
  }
});

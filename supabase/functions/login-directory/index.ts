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
import {
  deriveLegacyBridgePassword,
  verifyLegacyCredential,
} from './legacy-login.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SITE_GATE_JWT_SECRET = Deno.env.get('SITE_GATE_JWT_SECRET');
const RATE_LIMIT_HMAC_SECRET = Deno.env.get('RATE_LIMIT_HMAC_SECRET');
const LOGIN_MODES = new Set(['supabase', 'legacy-password', 'passwordless']);

Deno.serve(async request => {
  let corsHeaders: Record<string, string> = {};
  try {
    corsHeaders = corsHeadersFor(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') throw new HttpError(405, 'method-not-allowed');

    const body = await readJsonObject(request, 4096);
    const action = body.action === undefined ? 'directory' : requiredString(body.action, 'action', 32);
    if (action !== 'directory' && action !== 'legacy-session') {
      throw new HttpError(400, 'invalid-action');
    }
    const workspaceKey = requiredString(body.workspaceKey, 'workspace-key', 128);
    const gateToken = requiredString(request.headers.get('x-site-gate-token'), 'gate-token', 4096);
    const claims = await verifyGateToken(
      gateToken,
      workspaceKey,
      requiredEnv('SITE_GATE_JWT_SECRET', SITE_GATE_JWT_SECRET),
    );
    if (claims.workspaceKey !== workspaceKey) throw new HttpError(403, 'gate-workspace-mismatch');

    const supabaseUrl = requiredEnv('SUPABASE_URL', SUPABASE_URL);
    const service = createServiceClient(
      supabaseUrl,
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
    );
    const rateLimitSecret = requiredEnv('RATE_LIMIT_HMAC_SECRET', RATE_LIMIT_HMAC_SECRET);
    const networkIdentity = requestNetworkIdentity(request);
    await enforceRateLimit(service, {
      scope: action === 'directory' ? 'directory-network' : 'legacy-login-network',
      keyMaterial: `${workspaceKey}\u0000${networkIdentity}`,
      limit: action === 'directory' ? 60 : 20,
      windowSeconds: action === 'directory' ? 60 : 300,
      secret: rateLimitSecret,
    });

    const { data: workspace, error: workspaceError } = await service
      .from('sd_workspaces')
      .select('id')
      .eq('legacy_key', workspaceKey)
      .eq('is_active', true)
      .maybeSingle();
    if (workspaceError || !workspace) throw new HttpError(404, 'workspace-not-found');

    if (action === 'directory') {
      const { data: people, error } = await service
        .from('sd_login_options')
        .select('department,username_label,display_name,auth_alias,login_mode,must_change_password')
        .eq('workspace_id', workspace.id)
        .eq('is_active', true)
        .order('department', { ascending: true })
        .order('display_name', { ascending: true });
      if (error) throw new HttpError(503, 'directory-unavailable');

      return jsonResponse({
        people: (people || []).map(person => ({
          department: person.department,
          usernameLabel: person.username_label,
          displayName: person.display_name,
          authAlias: person.auth_alias,
          loginMode: LOGIN_MODES.has(person.login_mode) ? person.login_mode : 'supabase',
          mustChangePassword: person.must_change_password === true,
        })),
      }, 200, corsHeaders);
    }

    const authAlias = requiredString(body.authAlias, 'auth-alias', 320).toLowerCase();
    if (typeof body.password !== 'string' || body.password.length > 256) {
      throw new HttpError(400, 'invalid-login');
    }
    await enforceRateLimit(service, {
      scope: 'legacy-login-identity',
      keyMaterial: `${workspace.id}\u0000${authAlias}`,
      limit: 8,
      windowSeconds: 300,
      secret: rateLimitSecret,
    });

    const { data: loginOption, error: loginError } = await service
      .from('sd_login_options')
      .select('user_id,auth_alias,login_mode,legacy_password_hash')
      .eq('workspace_id', workspace.id)
      .eq('auth_alias', authAlias)
      .eq('is_active', true)
      .maybeSingle();
    if (loginError || !loginOption) throw new HttpError(401, 'invalid-login');

    const { data: membership, error: membershipError } = await service
      .from('sd_memberships')
      .select('role')
      .eq('workspace_id', workspace.id)
      .eq('user_id', loginOption.user_id)
      .eq('is_active', true)
      .maybeSingle();
    if (membershipError || !membership) throw new HttpError(401, 'invalid-login');
    const role = membership.role;
    if (role === 'owner'
      || (role === 'admin' && loginOption.login_mode === 'passwordless')) {
      throw new HttpError(401, 'invalid-login');
    }
    const accepted = await verifyLegacyCredential({
      loginMode: loginOption.login_mode,
      legacyPasswordHash: loginOption.legacy_password_hash,
      password: body.password,
    });
    if (!accepted) throw new HttpError(401, 'invalid-login');

    const bridgePassword = await deriveLegacyBridgePassword(
      rateLimitSecret,
      workspace.id,
      loginOption.user_id,
    );
    const { error: updateError } = await service.auth.admin.updateUserById(
      loginOption.user_id,
      { password: bridgePassword },
    );
    if (updateError) throw new HttpError(503, 'legacy-session-unavailable');

    const browserAuth = createServiceClient(
      supabaseUrl,
      requiredEnv('SUPABASE_ANON_KEY', SUPABASE_ANON_KEY),
    );
    const { data: authData, error: authError } = await browserAuth.auth.signInWithPassword({
      email: loginOption.auth_alias,
      password: bridgePassword,
    });
    if (authError || !authData.session?.access_token || !authData.session?.refresh_token) {
      throw new HttpError(503, 'legacy-session-unavailable');
    }
    return jsonResponse({
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      },
    }, 200, corsHeaders);
  } catch (error) {
    return errorResponse(error, corsHeaders);
  }
});

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
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SITE_GATE_JWT_SECRET = Deno.env.get('SITE_GATE_JWT_SECRET');
const RATE_LIMIT_HMAC_SECRET = Deno.env.get('RATE_LIMIT_HMAC_SECRET');

Deno.serve(async request => {
  let corsHeaders: Record<string, string> = {};
  try {
    corsHeaders = corsHeadersFor(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') throw new HttpError(405, 'method-not-allowed');

    const body = await readJsonObject(request, 4096);
    const action = body.action === undefined ? 'directory' : requiredString(body.action, 'action', 16);
    if (action !== 'directory') throw new HttpError(400, 'invalid-action');
    const workspaceKey = requiredString(body.workspaceKey, 'workspace-key', 128);
    const gateToken = requiredString(request.headers.get('x-site-gate-token'), 'gate-token', 4096);
    const claims = await verifyGateToken(
      gateToken,
      workspaceKey,
      requiredEnv('SITE_GATE_JWT_SECRET', SITE_GATE_JWT_SECRET),
    );
    if (claims.workspaceKey !== workspaceKey) throw new HttpError(403, 'gate-workspace-mismatch');

    const service = createServiceClient(
      requiredEnv('SUPABASE_URL', SUPABASE_URL),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
    );
    await enforceRateLimit(service, {
      scope: 'directory-network',
      keyMaterial: `${workspaceKey}\u0000${requestNetworkIdentity(request)}`,
      limit: 60,
      windowSeconds: 60,
      secret: requiredEnv('RATE_LIMIT_HMAC_SECRET', RATE_LIMIT_HMAC_SECRET),
    });

    const { data: workspace, error: workspaceError } = await service
      .from('sd_workspaces')
      .select('id')
      .eq('legacy_key', workspaceKey)
      .eq('is_active', true)
      .maybeSingle();
    if (workspaceError || !workspace) throw new HttpError(404, 'workspace-not-found');

    const { data: people, error } = await service
      .from('sd_login_options')
      .select('department,username_label,display_name,auth_alias')
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
      })),
    }, 200, corsHeaders);
  } catch (error) {
    return errorResponse(error, corsHeaders);
  }
});

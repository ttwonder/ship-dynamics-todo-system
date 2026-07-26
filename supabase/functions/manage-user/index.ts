import {
  corsHeadersFor,
  createServiceClient,
  createSessionClient,
  enforceRateLimit,
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonObject,
  requiredEnv,
  requiredPassword,
  requiredString,
  requiredUuid,
  requireJwtUser,
  secretFingerprint,
} from '../_shared/security.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const AUTH_SYNTHETIC_EMAIL_DOMAIN = Deno.env.get('AUTH_SYNTHETIC_EMAIL_DOMAIN');
const USER_OPERATION_HMAC_SECRET = Deno.env.get('USER_OPERATION_HMAC_SECRET');
const RATE_LIMIT_HMAC_SECRET = Deno.env.get('RATE_LIMIT_HMAC_SECRET');

const actions = new Set([
  'create',
  'disable',
  'change-role',
  'transfer-owner',
  'reset-password',
]);
const roles = new Set(['admin', 'operator', 'vessel']);

type ServiceClient = ReturnType<typeof createServiceClient>;
type AuthUser = { id: string; email?: string | null };

function operationResult(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function syntheticDomain(): string {
  const domain = requiredString(
    requiredEnv('AUTH_SYNTHETIC_EMAIL_DOMAIN', AUTH_SYNTHETIC_EMAIL_DOMAIN),
    'synthetic-email-domain',
    190,
  ).replace(/^@/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new HttpError(500, 'server-misconfigured');
  }
  return domain.toLowerCase();
}

async function deterministicSyntheticEmail(
  workspaceId: string,
  operationId: string,
): Promise<string> {
  const fingerprint = await secretFingerprint(
    `create-user\u0000${workspaceId}\u0000${operationId}`,
    requiredEnv('USER_OPERATION_HMAC_SECRET', USER_OPERATION_HMAC_SECRET),
  );
  const local = fingerprint.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 48);
  if (local.length < 24) throw new HttpError(500, 'server-misconfigured');
  return `${local}@${syntheticDomain()}`;
}

async function findAuthUserByEmail(
  service: ServiceClient,
  email: string,
): Promise<AuthUser | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new HttpError(503, 'auth-recovery-unavailable');
    const match = data.users.find(user => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  throw new HttpError(503, 'auth-recovery-unavailable');
}

async function markExternalEffect(
  service: ServiceClient,
  workspaceId: string,
  operationId: string,
  authUserId: string,
) {
  const { error } = await service.rpc('mark_ship_dynamics_user_operation_effect', {
    p_workspace_id: workspaceId,
    p_operation_id: operationId,
    p_auth_user_id: authUserId,
  });
  if (error) throw new HttpError(503, 'operation-recovery-required');
}

Deno.serve(async request => {
  let corsHeaders: Record<string, string> = {};
  let operationContext: { operationId: string; workspaceId: string } | null = null;
  let service: ServiceClient | null = null;
  let actorDatabase: ServiceClient | null = null;
  let operationBegan = false;
  let externalSideEffectMayHaveOccurred = false;
  try {
    corsHeaders = corsHeadersFor(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') throw new HttpError(405, 'method-not-allowed');

    const supabaseUrl = requiredEnv('SUPABASE_URL', SUPABASE_URL);
    const browserCredential = requiredEnv('SUPABASE_ANON_KEY', SUPABASE_ANON_KEY);
    const serverCredential = requiredEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY);
    const { user: actor, accessToken } = await requireJwtUser(request, supabaseUrl, browserCredential);
    const body = await readJsonObject(request, 8192);
    const action = requiredString(body.action, 'action', 32);
    if (!actions.has(action)) throw new HttpError(400, 'invalid-action');
    const operationId = requiredUuid(body.operationId, 'operation-id');
    const workspaceId = requiredUuid(body.workspaceId, 'workspace-id');
    operationContext = { operationId, workspaceId };
    service = createServiceClient(supabaseUrl, serverCredential);
    actorDatabase = createSessionClient(supabaseUrl, browserCredential, accessToken);
    await enforceRateLimit(service, {
      scope: 'manage-user-actor',
      keyMaterial: `${workspaceId}\u0000${actor.id}`,
      limit: 120,
      windowSeconds: 60,
      secret: requiredEnv('RATE_LIMIT_HMAC_SECRET', RATE_LIMIT_HMAC_SECRET),
    });

    const targetUserId = action === 'create'
      ? null
      : requiredUuid(body.targetUserId, 'target-user-id');
    const validated: Record<string, string | null> = { action, targetUserId };
    let password: string | null = null;
    if (action === 'create') {
      validated.displayName = requiredString(body.displayName, 'display-name', 128);
      validated.usernameLabel = requiredString(body.usernameLabel, 'username-label', 128);
      validated.department = requiredString(body.department, 'department', 128);
      const role = requiredString(body.role, 'role', 32);
      validated.role = role;
      if (!roles.has(role)) throw new HttpError(400, 'invalid-role');
      password = requiredPassword(body.password);
    } else if (action === 'change-role') {
      const role = requiredString(body.role, 'role', 32);
      validated.role = role;
      if (role !== 'owner' && !roles.has(role)) throw new HttpError(400, 'invalid-role');
    } else if (action === 'reset-password') {
      password = requiredPassword(body.password);
    }

    const requestForLedger: Record<string, unknown> = { ...validated };
    if (password) {
      requestForLedger.credentialFingerprint = await secretFingerprint(
        password,
        requiredEnv('USER_OPERATION_HMAC_SECRET', USER_OPERATION_HMAC_SECRET),
      );
    }

    const { data: membership, error: membershipError } = await service
      .from('sd_memberships')
      .select('role,is_active')
      .eq('workspace_id', workspaceId)
      .eq('user_id', actor.id)
      .eq('is_active', true)
      .maybeSingle();
    if (membershipError || !membership || membership.role !== 'owner') {
      throw new HttpError(403, 'owner-required');
    }

    const { data: begun, error: beginError } = await actorDatabase.rpc(
      'begin_ship_dynamics_user_operation',
      {
        p_workspace_id: workspaceId,
        p_operation_id: operationId,
        p_action: action,
        p_target_user_id: targetUserId,
        p_request: requestForLedger,
      },
    );
    if (beginError) throw new HttpError(409, 'operation-rejected');
    operationBegan = true;
    const begunResult = operationResult(begun);
    if (begunResult?.status === 'committed') {
      return jsonResponse(begunResult.result, 200, corsHeaders);
    }
    if (begunResult?.status === 'rejected') {
      throw new HttpError(409, 'operation-rejected');
    }

    let result: Record<string, unknown>;
    if (action === 'create') {
      const email = await deterministicSyntheticEmail(workspaceId, operationId);
      const recordedAuthUserId = typeof begunResult?.authUserId === 'string'
        ? begunResult.authUserId
        : null;
      let authUser: AuthUser | null = null;
      if (recordedAuthUserId) {
        const { data, error } = await service.auth.admin.getUserById(recordedAuthUserId);
        if (error || !data.user || data.user.email?.toLowerCase() !== email) {
          throw new HttpError(409, 'auth-correlation-mismatch');
        }
        authUser = data.user;
      } else {
        authUser = await findAuthUserByEmail(service, email);
      }
      if (!authUser) {
        externalSideEffectMayHaveOccurred = true;
        const { data: created, error: createError } = await service.auth.admin.createUser({
          email,
          password: password as string,
          email_confirm: true,
          app_metadata: { ship_dynamics_operation_id: operationId },
        });
        if (createError || !created.user) {
          authUser = await findAuthUserByEmail(service, email);
          if (!authUser) throw new HttpError(503, 'operation-recovery-required');
        } else {
          authUser = created.user;
        }
      } else {
        externalSideEffectMayHaveOccurred = true;
      }
      await markExternalEffect(actorDatabase, workspaceId, operationId, authUser.id);
      const { error: provisionError } = await actorDatabase.rpc('provision_ship_dynamics_user', {
        p_workspace_id: workspaceId,
        p_user_id: authUser.id,
        p_display_name: validated.displayName,
        p_username_label: validated.usernameLabel,
        p_department: validated.department,
        p_role: validated.role,
        p_auth_alias: email,
        p_operation_id: operationId,
      });
      if (provisionError) throw new HttpError(503, 'operation-recovery-required');
      result = { userId: authUser.id, role: validated.role };
    } else {
      const targetId = targetUserId as string;
      const { data: target, error: targetError } = await service
        .from('sd_memberships')
        .select('role,is_active')
        .eq('workspace_id', workspaceId)
        .eq('user_id', targetId)
        .maybeSingle();
      if (targetError || !target) throw new HttpError(404, 'user-not-found');

      if (action === 'disable') {
        if (target.role === 'owner') throw new HttpError(409, 'owner-transfer-required');
        externalSideEffectMayHaveOccurred = true;
        const { error: disableMembershipError } = await actorDatabase.rpc(
          'disable_ship_dynamics_user',
          {
            p_workspace_id: workspaceId,
            p_user_id: targetId,
            p_operation_id: operationId,
          },
        );
        if (disableMembershipError) throw new HttpError(503, 'operation-recovery-required');
        const { error: banError } = await service.auth.admin.updateUserById(targetId, {
          ban_duration: '876000h',
        });
        if (banError) throw new HttpError(503, 'operation-recovery-required');
        await markExternalEffect(actorDatabase, workspaceId, operationId, targetId);
        result = { userId: targetId, disabled: true };
      } else if (action === 'reset-password') {
        externalSideEffectMayHaveOccurred = true;
        const { error: resetError } = await service.auth.admin.updateUserById(targetId, {
          password: password as string,
        });
        if (resetError) throw new HttpError(503, 'operation-recovery-required');
        await markExternalEffect(actorDatabase, workspaceId, operationId, targetId);
        result = { userId: targetId, credentialReset: true };
      } else if (action === 'transfer-owner' || validated.role === 'owner') {
        if (!target.is_active) throw new HttpError(409, 'target-inactive');
        externalSideEffectMayHaveOccurred = true;
        const { data: transferred, error: transferError } = await actorDatabase.rpc(
          'transfer_ship_dynamics_owner',
          {
            p_workspace_id: workspaceId,
            p_new_owner_id: targetId,
            p_operation_id: operationId,
          },
        );
        if (transferError) throw new HttpError(503, 'operation-recovery-required');
        result = operationResult(transferred) || { userId: targetId, role: 'owner' };
      } else {
        const role = validated.role as string;
        if (target.role === 'owner') throw new HttpError(409, 'owner-transfer-required');
        externalSideEffectMayHaveOccurred = true;
        const { error: roleError } = await actorDatabase.rpc('change_ship_dynamics_user_role', {
          p_workspace_id: workspaceId,
          p_user_id: targetId,
          p_role: role,
          p_operation_id: operationId,
        });
        if (roleError) throw new HttpError(503, 'operation-recovery-required');
        result = { userId: targetId, role };
      }
    }

    const { error: completeError } = await actorDatabase.rpc(
      'complete_ship_dynamics_user_operation',
      {
        p_workspace_id: workspaceId,
        p_operation_id: operationId,
        p_result: result,
      },
    );
    if (completeError) throw new HttpError(503, 'operation-recovery-required');
    return jsonResponse(result, 200, corsHeaders);
  } catch (error) {
    if (actorDatabase && operationContext && operationBegan) {
      const rpc = externalSideEffectMayHaveOccurred
        ? 'mark_ship_dynamics_user_operation_recovery_required'
        : 'reject_ship_dynamics_user_operation';
      try {
        await actorDatabase.rpc(rpc, {
          p_workspace_id: operationContext.workspaceId,
          p_operation_id: operationContext.operationId,
          p_error_code: error instanceof HttpError ? error.code : 'internal-error',
        });
      } catch {
        // The client retries the same operation ID; no alternative definitive state is invented here.
      }
    }
    return errorResponse(error, corsHeaders);
  }
});

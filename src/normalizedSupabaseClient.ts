import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

export interface NormalizedSupabaseConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  workspaceId: string;
  storageKey?: string;
}

export interface NormalizedRequestToken {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly generation: number;
}

export class StaleNormalizedResponseError extends Error {
  constructor() {
    super('The response belongs to an expired authentication or workspace generation.');
    this.name = 'StaleNormalizedResponseError';
  }
}

export class NormalizedAuthenticationRequiredError extends Error {
  constructor() {
    super('An authenticated Supabase session is required.');
    this.name = 'NormalizedAuthenticationRequiredError';
  }
}

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  const segment = value.split('.')[1];
  if (!segment) return null;
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = typeof atob === 'function'
      ? atob(normalized)
      : '';
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function assertBrowserSafeNormalizedConfig(
  config: NormalizedSupabaseConfig,
): NormalizedSupabaseConfig {
  const supabaseUrl = config.supabaseUrl?.trim();
  const supabaseAnonKey = config.supabaseAnonKey?.trim();
  const workspaceId = config.workspaceId?.trim();
  if (!supabaseUrl || !supabaseAnonKey || !workspaceId) {
    throw new Error('Supabase URL, browser credential, and workspace identity are required.');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error('Supabase URL is invalid.');
  }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new Error('Supabase URL must use HTTP or HTTPS.');
  }
  const privilegedRole = ['service', 'role'].join('_');
  const jwtPayload = decodeJwtPayload(supabaseAnonKey);
  if (
    supabaseAnonKey.toLowerCase().includes(privilegedRole)
    || jwtPayload?.role === privilegedRole
  ) {
    throw new Error('A privileged server credential is never valid browser configuration.');
  }
  return {
    ...config,
    supabaseUrl,
    supabaseAnonKey,
    workspaceId,
  };
}

export function createNormalizedSupabaseClient(
  rawConfig: NormalizedSupabaseConfig,
): SupabaseClient {
  const config = assertBrowserSafeNormalizedConfig(rawConfig);
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: config.storageKey || 'ship-dynamics.normalized.supabase-session',
    },
    global: {
      headers: { 'x-application-name': 'ship-dynamics-normalized-client' },
    },
  });
}

/**
 * A request token is an authority boundary, not merely a loading-state helper.
 * Every repository request captures one and validates it after its await.
 */
export class NormalizedRequestScope {
  #workspaceId: string;
  #actorId: string | null = null;
  #generation = 0;

  constructor(workspaceId: string) {
    const normalized = workspaceId?.trim();
    if (!normalized) throw new Error('A stable workspace identity is required.');
    this.#workspaceId = normalized;
  }

  get workspaceId() { return this.#workspaceId; }
  get actorId() { return this.#actorId; }
  get generation() { return this.#generation; }

  setWorkspace(workspaceId: string) {
    const normalized = workspaceId?.trim();
    if (!normalized) throw new Error('A stable workspace identity is required.');
    if (normalized === this.#workspaceId) return;
    this.#workspaceId = normalized;
    this.#generation += 1;
  }

  acceptSession(
    session: Pick<Session, 'user'> | { user: { id: string } } | null,
    forceGenerationChange = false,
  ) {
    const nextActor = session?.user?.id?.trim() || null;
    if (forceGenerationChange || nextActor !== this.#actorId) this.#generation += 1;
    this.#actorId = nextActor;
  }

  invalidateAuthentication() {
    this.#actorId = null;
    this.#generation += 1;
  }

  capture(): NormalizedRequestToken {
    if (!this.#actorId) throw new NormalizedAuthenticationRequiredError();
    return Object.freeze({
      workspaceId: this.#workspaceId,
      actorId: this.#actorId,
      generation: this.#generation,
    });
  }

  isCurrent(token: NormalizedRequestToken) {
    return token.generation === this.#generation
      && token.workspaceId === this.#workspaceId
      && token.actorId === this.#actorId;
  }

  assertCurrent(token: NormalizedRequestToken) {
    if (!this.isCurrent(token)) throw new StaleNormalizedResponseError();
  }

  async guard<T>(token: NormalizedRequestToken, request: PromiseLike<T>): Promise<T> {
    const value = await request;
    this.assertCurrent(token);
    return value;
  }
}

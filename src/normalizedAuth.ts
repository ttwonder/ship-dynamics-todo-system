import type { Session } from '@supabase/supabase-js';
import type { NormalizedRequestScope } from './normalizedSupabaseClient';

interface AuthResult<T> {
  data: T;
  error: unknown;
}

interface NormalizedAuthClient {
  auth: {
    getSession(): Promise<AuthResult<{ session: Session | null }>>;
    getUser(): Promise<AuthResult<{ user: Session['user'] | null }>>;
    onAuthStateChange(
      callback: (event: string, session: Session | null) => void,
    ): { data: { subscription: { unsubscribe(): void } } };
    signInWithPassword(credentials: { email: string; password: string }): Promise<AuthResult<{
      session: Session | null;
      user: { id: string } | null;
    }>>;
    signOut(): Promise<{ error: unknown }>;
    updateUser(attributes: { password: string }): Promise<AuthResult<unknown>>;
  };
  functions: {
    invoke<T = unknown>(
      name: string,
      options: { body: Record<string, unknown>; headers?: Record<string, string> },
    ): Promise<AuthResult<T>>;
  };
  rpc<T>(name: string, parameters: Record<string, unknown>): Promise<AuthResult<T>>;
}

export interface SiteGateGrant {
  gateToken: string;
  expiresAt: string;
}

export interface LoginDirectoryPerson {
  department: string;
  usernameLabel: string;
  displayName: string;
  authAlias: string;
  mustChangePassword: boolean;
}

export interface PasswordlessCutoverCandidate {
  legacyUserId: string;
  displayName: string;
  hasPassword: boolean;
}

export interface PasswordlessCutoverFlag {
  legacyUserId: string;
  displayName: string;
  reason: 'passwordless-account';
}

export function flagPasswordlessCutoverAccounts(
  candidates: PasswordlessCutoverCandidate[],
): PasswordlessCutoverFlag[] {
  return candidates
    .filter(candidate => !candidate.hasPassword)
    .map(candidate => ({
      legacyUserId: candidate.legacyUserId,
      displayName: candidate.displayName,
      reason: 'passwordless-account',
    }));
}

function requiredText(value: unknown, label: string, maximum = 256): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > maximum) throw new Error(`${label} is invalid.`);
  return normalized;
}

function throwFunctionError(error: unknown): never {
  if (error instanceof Error) throw error;
  throw new Error('The authentication service rejected the request.');
}

function defaultGateStorage(): Storage | null {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

export class NormalizedAuth {
  #client: NormalizedAuthClient;
  #scope: NormalizedRequestScope;
  #gateStorage: Storage | null;
  #subscription: { unsubscribe(): void } | null = null;

  constructor(
    client: NormalizedAuthClient,
    scope: NormalizedRequestScope,
    options: { gateStorage?: Storage | null } = {},
  ) {
    this.#client = client;
    this.#scope = scope;
    this.#gateStorage = options.gateStorage === undefined
      ? defaultGateStorage()
      : options.gateStorage;
  }

  get actorId() { return this.#scope.actorId; }

  requireActor() {
    return this.#scope.capture().actorId;
  }

  async initialize(): Promise<Session | null> {
    const { data, error } = await this.#client.auth.getSession();
    if (error) {
      this.#scope.invalidateAuthentication();
      throwFunctionError(error);
    }
    let session = data.session;
    if (session) {
      const verified = await this.#client.auth.getUser();
      if (verified.error || !verified.data.user) {
        this.#scope.invalidateAuthentication();
        await this.#client.auth.signOut();
        if (verified.error) throwFunctionError(verified.error);
        throw new Error('The persisted authentication session is invalid.');
      }
      session = { ...session, user: verified.data.user };
    }
    this.#scope.acceptSession(session);
    this.#subscription?.unsubscribe();
    this.#subscription = this.#client.auth.onAuthStateChange((_event, changedSession) => {
      this.#scope.acceptSession(changedSession, true);
    }).data.subscription;
    return session;
  }

  dispose() {
    this.#subscription?.unsubscribe();
    this.#subscription = null;
  }

  async unlockSite(input: {
    workspaceKey: string;
    password: string;
  }): Promise<SiteGateGrant> {
    const workspaceKey = requiredText(input.workspaceKey, 'Workspace key', 128);
    if (!input.password || input.password.length > 256) throw new Error('Site password is invalid.');
    const { data, error } = await this.#client.functions.invoke<SiteGateGrant>('site-unlock', {
      body: { workspaceKey, password: input.password },
    });
    if (error) throwFunctionError(error);
    if (!data?.gateToken || !data?.expiresAt) throw new Error('The site gate returned an invalid grant.');
    this.#gateStorage?.setItem('ship-dynamics.normalized.gate', data.gateToken);
    return data;
  }

  readGateToken() {
    return this.#gateStorage?.getItem('ship-dynamics.normalized.gate') || null;
  }

  clearGateToken() {
    this.#gateStorage?.removeItem('ship-dynamics.normalized.gate');
  }

  async getLoginDirectory(input: {
    workspaceKey: string;
    gateToken?: string;
  }): Promise<LoginDirectoryPerson[]> {
    const gateToken = requiredText(
      input.gateToken || this.readGateToken(),
      'Gate token',
      4096,
    );
    const { data, error } = await this.#client.functions.invoke<{ people: LoginDirectoryPerson[] }>(
      'login-directory',
      {
        body: {
          action: 'directory',
          workspaceKey: requiredText(input.workspaceKey, 'Workspace key', 128),
        },
        headers: { 'x-site-gate-token': gateToken },
      },
    );
    if (error) throwFunctionError(error);
    if (!Array.isArray(data?.people)) throw new Error('The login directory response is invalid.');
    return data.people.map(person => ({
      department: requiredText(person.department, 'Department', 128),
      usernameLabel: requiredText(person.usernameLabel, 'Person label', 128),
      displayName: requiredText(person.displayName, 'Display name', 128),
      authAlias: requiredText(person.authAlias, 'Authentication alias', 320),
      mustChangePassword: person.mustChangePassword === true,
    }));
  }

  async signInWithDirectoryPassword(input: {
    authAlias: string;
    password: string;
    gateToken?: string;
  }): Promise<Session> {
    requiredText(
      input.gateToken || this.readGateToken(),
      'Gate token',
      4096,
    );
    if (!input.password || input.password.length > 256) throw new Error('Password is invalid.');
    const accepted = await this.#client.auth.signInWithPassword({
      email: requiredText(input.authAlias, 'Authentication alias', 320),
      password: input.password,
    });
    if (accepted.error) throwFunctionError(accepted.error);
    if (!accepted.data.session) throw new Error('Supabase rejected the login.');
    this.#scope.acceptSession(accepted.data.session, true);
    return accepted.data.session;
  }

  async changePersonalPassword(password: string): Promise<void> {
    this.requireActor();
    if (password.length < 12 || password.length > 256) {
      throw new Error('A personal password must contain 12 to 256 characters.');
    }
    const { error } = await this.#client.auth.updateUser({ password });
    if (error) throwFunctionError(error);
  }

  async passwordActivationRequired(workspaceId: string): Promise<boolean> {
    this.requireActor();
    const { data, error } = await this.#client.rpc<boolean>(
      'get_my_ship_dynamics_password_activation_status',
      { p_workspace_id: requiredText(workspaceId, 'Workspace ID', 64) },
    );
    if (error) throwFunctionError(error);
    return data !== false;
  }

  async activatePersonalPassword(workspaceId: string, password: string): Promise<void> {
    await this.changePersonalPassword(password);
    const { data, error } = await this.#client.rpc<boolean>(
      'complete_my_ship_dynamics_password_activation',
      { p_workspace_id: requiredText(workspaceId, 'Workspace ID', 64) },
    );
    if (error) throwFunctionError(error);
    if (data !== true) throw new Error('Password activation was not confirmed.');
  }

  async signOut(): Promise<void> {
    this.#scope.invalidateAuthentication();
    const { error } = await this.#client.auth.signOut();
    if (error) throwFunctionError(error);
  }
}

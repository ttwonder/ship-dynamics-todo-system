import type { Session } from '@supabase/supabase-js';
import {
  StaleNormalizedResponseError,
  type NormalizedRequestScope,
} from './normalizedSupabaseClient';

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

export interface NormalizedAuthTransition {
  readonly event: string;
  readonly previousActorId: string | null;
  readonly actorId: string | null;
  readonly requestGeneration: number;
  readonly authorityChanged: boolean;
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
  #transitionGeneration = 0;
  #latestTransition: NormalizedAuthTransition | null = null;
  #onTransition: ((transition: NormalizedAuthTransition) => void) | null;

  constructor(
    client: NormalizedAuthClient,
    scope: NormalizedRequestScope,
    options: {
      gateStorage?: Storage | null;
      onTransition?: (transition: NormalizedAuthTransition) => void;
    } = {},
  ) {
    this.#client = client;
    this.#scope = scope;
    this.#gateStorage = options.gateStorage === undefined
      ? defaultGateStorage()
      : options.gateStorage;
    this.#onTransition = options.onTransition || null;
  }

  get actorId() { return this.#scope.actorId; }

  requireActor() {
    return this.#scope.capture().actorId;
  }

  #acceptTransition(event: string, session: Session | null, forceGenerationChange = true) {
    const previousActorId = this.#scope.actorId;
    this.#scope.acceptSession(session, forceGenerationChange);
    const transition = Object.freeze({
      event,
      previousActorId,
      actorId: this.#scope.actorId,
      requestGeneration: this.#scope.generation,
      authorityChanged: previousActorId !== this.#scope.actorId,
    });
    this.#transitionGeneration += 1;
    this.#latestTransition = transition;
    this.#onTransition?.(transition);
  }

  #assertOperationCurrent(generation: number) {
    if (generation !== this.#transitionGeneration) throw new StaleNormalizedResponseError();
  }

  #installSubscription() {
    this.#subscription?.unsubscribe();
    this.#subscription = this.#client.auth.onAuthStateChange((event, changedSession) => {
      const nextActorId = changedSession?.user?.id?.trim() || null;
      if (event === 'INITIAL_SESSION'
        && this.#latestTransition?.event === 'INITIAL_SESSION'
        && this.#latestTransition.actorId === nextActorId) return;
      this.#acceptTransition(event, changedSession, true);
    }).data.subscription;
  }

  async initialize(): Promise<Session | null> {
    const operationGeneration = this.#transitionGeneration;
    const { data, error } = await this.#client.auth.getSession();
    this.#assertOperationCurrent(operationGeneration);
    if (error) {
      this.#acceptTransition('SESSION_ERROR', null, true);
      throwFunctionError(error);
    }
    let session = data.session;
    if (session) {
      const verified = await this.#client.auth.getUser();
      this.#assertOperationCurrent(operationGeneration);
      if (verified.error || !verified.data.user) {
        this.#acceptTransition('INVALID_SESSION', null, true);
        await this.#client.auth.signOut();
        if (verified.error) throwFunctionError(verified.error);
        throw new Error('The persisted authentication session is invalid.');
      }
      session = { ...session, user: verified.data.user };
    }
    this.#installSubscription();
    if (this.#transitionGeneration === operationGeneration) {
      this.#acceptTransition('INITIAL_SESSION', session, false);
    } else {
      const expectedActorId = session?.user?.id?.trim() || null;
      const expectedCallback = this.#transitionGeneration === operationGeneration + 1
        && this.#latestTransition?.event === 'INITIAL_SESSION'
        && this.#latestTransition.actorId === expectedActorId;
      if (!expectedCallback) throw new StaleNormalizedResponseError();
    }
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
    const operationGeneration = this.#transitionGeneration;
    const accepted = await this.#client.auth.signInWithPassword({
      email: requiredText(input.authAlias, 'Authentication alias', 320),
      password: input.password,
    });
    if (accepted.error) throwFunctionError(accepted.error);
    if (!accepted.data.session) throw new Error('Supabase rejected the login.');
    if (this.#transitionGeneration === operationGeneration) {
      this.#acceptTransition('SIGNED_IN', accepted.data.session, true);
    } else {
      const expectedCallback = this.#transitionGeneration === operationGeneration + 1
        && this.#latestTransition?.event === 'SIGNED_IN'
        && this.#latestTransition.actorId === accepted.data.session.user.id;
      if (!expectedCallback) throw new StaleNormalizedResponseError();
    }
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
    this.#acceptTransition('SIGNED_OUT', null, true);
    const { error } = await this.#client.auth.signOut();
    if (error) throwFunctionError(error);
  }
}

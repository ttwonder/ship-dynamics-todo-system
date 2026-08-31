import type { Session } from '@supabase/supabase-js';
import { getSupabaseConfig, type ResolvedSupabaseConfig } from '../cloud';
import type { UserAccount, UserRole } from '../types';
import { getItineraryOfficeClient, ITINERARY_OFFICE_SESSION_STORAGE_KEY } from './itineraryCloud';

interface AuthResult<T> { data: T; error: unknown }

export interface ItineraryOfficeAuthClient {
  auth: {
    getSession?(): Promise<AuthResult<{ session: Session | null }>>;
    getUser?(): Promise<AuthResult<{ user: Session['user'] | null }>>;
    signInWithPassword(credentials: { email: string; password: string }): Promise<AuthResult<{ session: Session | null }>>;
    setSession(credentials: { access_token: string; refresh_token: string }): Promise<AuthResult<{ session: Session | null }>>;
    signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<{ error: unknown }>;
  };
  functions: {
    invoke<T = unknown>(name: string, options: { body: Record<string, unknown>; headers?: Record<string, string> }): Promise<AuthResult<T>>;
  };
  rpc<T = unknown>(name: string, parameters: Record<string, unknown>): Promise<AuthResult<T>>;
}

export interface ItineraryOfficeIdentity {
  department: string;
  displayName: string;
  usernameLabel: string;
  role: UserRole;
}

export type ItineraryOfficeSessionInspection =
  | { status: 'verified'; rollout: unknown; identity: ItineraryOfficeIdentity }
  | { status: 'authentication-required'; message: string }
  | { status: 'unavailable'; message: string };

export interface ItineraryOfficeCredentials {
  sitePassword: string;
  personalPassword: string;
}

interface LoginDirectoryPerson {
  department: string;
  usernameLabel: string;
  displayName: string;
  authAlias: string;
  loginMode: 'supabase' | 'legacy-password' | 'passwordless';
  mustChangePassword: boolean;
}

const norm = (value: unknown) => typeof value === 'string' ? value.trim().normalize('NFKC') : '';
const normFold = (value: unknown) => norm(value).toLocaleLowerCase('en-US');

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return [value.message, value.details, value.hint, value.code].filter(Boolean).join(' ');
  }
  return String(error || 'unknown-error');
}

function authClient(value: unknown): ItineraryOfficeAuthClient {
  if (!value) throw new Error('Itinerary Supabase client is unavailable.');
  return value as ItineraryOfficeAuthClient;
}

function requiredConfig(value: ResolvedSupabaseConfig | null = getSupabaseConfig()): ResolvedSupabaseConfig {
  if (!value) throw new Error('Itinerary Supabase 設定不存在。');
  return value;
}

function rawRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}

function roleOf(value: unknown): UserRole | null {
  return value === 'owner' || value === 'admin' || value === 'operator' || value === 'vessel' ? value : null;
}

export function parseItineraryOfficeIdentity(value: unknown): ItineraryOfficeIdentity | null {
  const payload = rawRecord(value);
  const identity = rawRecord(payload?.office_identity ?? payload?.officeIdentity);
  const role = roleOf(identity?.role);
  const department = norm(identity?.department);
  const displayName = norm(identity?.display_name ?? identity?.displayName);
  const usernameLabel = norm(identity?.username_label ?? identity?.usernameLabel);
  if (!role || !department || !displayName || !usernameLabel) return null;
  return { department, displayName, usernameLabel, role };
}

export function itineraryIdentityMatchesUser(identity: ItineraryOfficeIdentity | null, user: Pick<UserAccount, 'department' | 'name' | 'username' | 'role'>): boolean {
  return Boolean(identity
    && identity.role === user.role
    && normFold(identity.department) === normFold(user.department)
    && normFold(identity.displayName) === normFold(user.name)
    && normFold(identity.usernameLabel) === normFold(user.username));
}

function directoryMatchesUser(person: LoginDirectoryPerson, user: Pick<UserAccount, 'department' | 'name' | 'username'>): boolean {
  return normFold(person.department) === normFold(user.department)
    && normFold(person.displayName) === normFold(user.name)
    && normFold(person.usernameLabel) === normFold(user.username);
}

function browserStorage(): Pick<Storage, 'removeItem'> | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function shouldClearItineraryOfficeSession(previousUserId: string, currentUserId: string): boolean {
  return !currentUserId || Boolean(previousUserId && previousUserId !== currentUserId);
}

export async function clearItineraryOfficeSession(
  rawConfig: ResolvedSupabaseConfig | null = getSupabaseConfig(),
  rawClient: ItineraryOfficeAuthClient | null = getItineraryOfficeClient(rawConfig) as unknown as ItineraryOfficeAuthClient | null,
  rawStorage: Pick<Storage, 'removeItem'> | null = browserStorage(),
): Promise<void> {
  const removeStoredSession = () => {
    try { rawStorage?.removeItem(ITINERARY_OFFICE_SESSION_STORAGE_KEY); } catch { /* storage may be unavailable */ }
  };
  removeStoredSession();
  if (!rawConfig || !rawClient) return;
  try { await rawClient.auth.signOut({ scope: 'local' }); } catch { /* storage was already cleared fail-closed */ }
  finally { removeStoredSession(); }
}

async function rolloutFor(client: ItineraryOfficeAuthClient, config: ResolvedSupabaseConfig) {
  const { data, error } = await client.rpc('sd_itinerary_get_rollout', { p_workspace_key: config.workspaceKey });
  if (error) throw new Error(messageOf(error));
  return data;
}

export async function inspectExistingItineraryOfficeSession(
  user: Pick<UserAccount, 'department' | 'name' | 'username' | 'role'>,
  rawConfig: ResolvedSupabaseConfig | null = getSupabaseConfig(),
  rawClient: ItineraryOfficeAuthClient | null = getItineraryOfficeClient(rawConfig) as unknown as ItineraryOfficeAuthClient | null,
): Promise<ItineraryOfficeSessionInspection> {
  if (!rawConfig || !rawClient) return { status: 'unavailable', message: 'Itinerary Supabase 尚未設定。' };
  const client = authClient(rawClient);
  if (!client.auth.getSession || !client.auth.getUser) return { status: 'unavailable', message: 'Itinerary 身份驗證介面不完整。' };
  try {
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error) return { status: 'unavailable', message: '暫時無法讀取 Itinerary 雲端身份。' };
    if (!sessionResult.data.session) return { status: 'authentication-required', message: '首次進入 Itinerary 需驗證雲端身份。' };
    const verified = await client.auth.getUser();
    if (verified.error) return { status: 'unavailable', message: '暫時無法向伺服器驗證 Itinerary 身份。' };
    if (!verified.data.user || verified.data.user.id !== sessionResult.data.session.user.id) {
      await clearItineraryOfficeSession(rawConfig, client);
      return { status: 'authentication-required', message: 'Itinerary 雲端 session 已失效，請重新驗證。' };
    }
    const rollout = await rolloutFor(client, rawConfig);
    const identity = parseItineraryOfficeIdentity(rollout);
    if (!itineraryIdentityMatchesUser(identity, user)) {
      await clearItineraryOfficeSession(rawConfig, client);
      return { status: 'authentication-required', message: 'Itinerary 雲端身份與目前網站使用者不一致，已清除該 session。' };
    }
    return { status: 'verified', rollout, identity: identity! };
  } catch (error) {
    return { status: 'unavailable', message: `Itinerary 身份檢查失敗：${messageOf(error)}` };
  }
}

export async function authenticateItineraryOffice(
  user: Pick<UserAccount, 'department' | 'name' | 'username' | 'role'>,
  credentials: ItineraryOfficeCredentials,
  rawConfig: ResolvedSupabaseConfig | null = getSupabaseConfig(),
  rawClient: ItineraryOfficeAuthClient | null = getItineraryOfficeClient(rawConfig) as unknown as ItineraryOfficeAuthClient | null,
): Promise<ItineraryOfficeSessionInspection> {
  const config = requiredConfig(rawConfig);
  const client = authClient(rawClient);
  if (!credentials.sitePassword || credentials.sitePassword.length > 256) throw new Error('請輸入有效的進站密碼。');
  if (credentials.personalPassword.length > 256) throw new Error('Itinerary 個人密碼格式不正確。');

  const unlocked = await client.functions.invoke<{ gateToken?: string; expiresAt?: string }>('site-unlock', {
    body: { workspaceKey: config.workspaceKey, password: credentials.sitePassword },
  });
  if (unlocked.error || !unlocked.data?.gateToken) throw new Error('進站密碼未通過 Itinerary 雲端驗證。');

  const directory = await client.functions.invoke<{ people?: LoginDirectoryPerson[] }>('login-directory', {
    body: { action: 'directory', workspaceKey: config.workspaceKey },
    headers: { 'x-site-gate-token': unlocked.data.gateToken },
  });
  if (directory.error || !Array.isArray(directory.data?.people)) throw new Error('無法讀取 Itinerary 雲端身份名冊。');
  const matches = directory.data.people.filter(person => directoryMatchesUser(person, user));
  if (matches.length !== 1) throw new Error('目前網站使用者無法唯一對應 Itinerary 雲端身份。');
  const person = matches[0];
  if (person.mustChangePassword && user.role !== 'owner') throw new Error('此 Itinerary 雲端帳號尚未完成個人密碼啟用。');

  const establishOwnerPasswordSession = async () => {
    if (!credentials.personalPassword) throw new Error('請輸入 Owner 個人登入密碼。');
    const unified = await client.functions.invoke<{ session?: { access_token?: string; refresh_token?: string } }>('login-directory', {
      body: { action: 'owner-password-session', workspaceKey: config.workspaceKey, authAlias: person.authAlias, password: credentials.personalPassword },
      headers: { 'x-site-gate-token': unlocked.data.gateToken },
    });
    const accessToken = unified.data?.session?.access_token;
    const refreshToken = unified.data?.session?.refresh_token;
    if (unified.error || !accessToken || !refreshToken) throw new Error('Owner 個人登入密碼錯誤或雲端密碼統一失敗。');
    const accepted = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (accepted.error || !accepted.data.session) throw new Error('Owner 雲端 session 建立失敗。');
  };

  if (person.loginMode === 'supabase') {
    if (!credentials.personalPassword) throw new Error(user.role === 'owner' ? '請輸入 Owner 個人登入密碼。' : '請輸入 Itinerary 雲端個人密碼。');
    if (user.role === 'owner' && person.mustChangePassword) {
      await establishOwnerPasswordSession();
    } else {
      const accepted = await client.auth.signInWithPassword({ email: person.authAlias, password: credentials.personalPassword });
      if (accepted.error || !accepted.data.session) {
        if (user.role !== 'owner') throw new Error('Itinerary 雲端個人密碼錯誤或登入失敗。');
        await establishOwnerPasswordSession();
      }
    }
  } else {
    if (user.role === 'owner') throw new Error('Owner 雲端登入模式不正確，已停止驗證。');
    const compatibility = await client.functions.invoke<{ session?: { access_token?: string; refresh_token?: string } }>('login-directory', {
      body: { action: 'legacy-session', workspaceKey: config.workspaceKey, authAlias: person.authAlias, password: credentials.personalPassword },
      headers: { 'x-site-gate-token': unlocked.data.gateToken },
    });
    const accessToken = compatibility.data?.session?.access_token;
    const refreshToken = compatibility.data?.session?.refresh_token;
    if (compatibility.error || !accessToken || !refreshToken) throw new Error('Itinerary 相容身份登入失敗。');
    const accepted = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (accepted.error || !accepted.data.session) throw new Error('Itinerary 雲端 session 建立失敗。');
  }

  try {
    const rollout = await rolloutFor(client, config);
    const identity = parseItineraryOfficeIdentity(rollout);
    if (!itineraryIdentityMatchesUser(identity, user)) {
      await clearItineraryOfficeSession(config, client);
      return { status: 'authentication-required', message: '登入成功，但伺服器身份與目前網站使用者不一致；已清除 Itinerary session。' };
    }
    return { status: 'verified', rollout, identity: identity! };
  } catch (error) {
    await clearItineraryOfficeSession(config, client);
    return { status: 'unavailable', message: `Itinerary 雲端身份確認失敗：${messageOf(error)}` };
  }
}

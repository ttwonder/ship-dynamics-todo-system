import { useEffect, useState } from 'react';
import type { UserAccount, UserRole } from '../types';
import { getSupabaseClient, getSupabaseConfig } from '../cloud';
import { getItineraryOfficeClient } from './itineraryCloud';
import { inspectExistingItineraryOfficeSession, type ItineraryOfficeAuthClient } from './itineraryOfficeAuth';

export type ItineraryPermissionAction = 'view' | 'edit' | 'import' | 'export' | 'calendar';
export type ItineraryPermissions = Record<ItineraryPermissionAction, boolean>;

export interface ItineraryRollout {
  version: number | null;
  mainEnabled: boolean;
  shipPortalEnabled: boolean;
  permissions: ItineraryPermissions;
  demoMode: boolean;
  loading: boolean;
  source: 'disabled' | 'local-demo' | 'cloud';
  authStatus: 'not-required' | 'required' | 'unavailable' | 'verified';
  authMessage: string;
}

export interface LocationLike {
  hostname: string;
  search: string;
}

const noPermissions = (): ItineraryPermissions => ({ view: false, edit: false, import: false, export: false, calendar: false });

export function disabledItineraryRollout(
  _role: UserRole,
  authStatus: ItineraryRollout['authStatus'] = 'not-required',
  authMessage = '',
): ItineraryRollout {
  return { version: null, mainEnabled: false, shipPortalEnabled: false, permissions: noPermissions(), demoMode: false, loading: false, source: 'disabled', authStatus, authMessage };
}

export function localItineraryDemoRequested(location: LocationLike): boolean {
  const hostname = location.hostname.toLowerCase();
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  if (!loopback) return false;
  return new URLSearchParams(location.search).get('itineraryDemo') === '1';
}

export function localDemoRollout(role: UserRole, location: LocationLike): ItineraryRollout {
  if (role === 'vessel' || !localItineraryDemoRequested(location)) return disabledItineraryRollout(role);
  return {
    version: null,
    mainEnabled: true,
    shipPortalEnabled: false,
    permissions: { view: true, edit: true, import: true, export: true, calendar: true },
    demoMode: true,
    loading: false,
    source: 'local-demo',
    authStatus: 'verified',
    authMessage: '',
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseItineraryRollout(value: unknown, role: UserRole): ItineraryRollout {
  const payload = Array.isArray(value) ? record(value[0]) : record(value);
  const rolePermissions = record(payload?.role_permissions);
  const permissionRow = record(rolePermissions?.[role]);
  const rawVersion = payload?.version;
  const version = typeof rawVersion === 'number' && Number.isSafeInteger(rawVersion) && rawVersion > 0 ? rawVersion : null;
  if (role === 'vessel' || payload?.main_enabled !== true || !permissionRow || permissionRow.view !== true) {
    return {
      ...disabledItineraryRollout(role, 'verified'),
      version,
      shipPortalEnabled: payload?.ship_portal_enabled === true,
    };
  }
  const permissions: ItineraryPermissions = {
    view: permissionRow.view === true,
    edit: permissionRow.edit === true,
    import: permissionRow.import === true,
    export: permissionRow.export === true,
    calendar: permissionRow.calendar === true,
  };
  return {
    version,
    mainEnabled: true,
    shipPortalEnabled: payload.ship_portal_enabled === true,
    permissions,
    demoMode: false,
    loading: false,
    source: 'cloud',
    authStatus: 'verified',
    authMessage: '',
  };
}

export function ownerCanBootstrapItinerary(role: UserRole, rollout: ItineraryRollout): boolean {
  return role === 'owner' && !rollout.loading && !rollout.demoMode && rollout.authStatus !== 'verified';
}

export function ownerCanManageItineraryRollout(role: UserRole, rollout: ItineraryRollout): boolean {
  return role === 'owner'
    && !rollout.loading
    && !rollout.demoMode
    && rollout.authStatus === 'verified'
    && rollout.version !== null;
}

export async function fetchItineraryRollout(user: Pick<UserAccount, 'department' | 'name' | 'username' | 'role'>, location?: LocationLike): Promise<ItineraryRollout> {
  const role = user.role;
  if (location) {
    const demo = localDemoRollout(role, location);
    if (demo.mainEnabled) return demo;
  }
  const config = getSupabaseConfig();
  const client = getItineraryOfficeClient(config);
  const publicClient = getSupabaseClient(config);
  if (!config || !client || !publicClient) return disabledItineraryRollout(role, 'unavailable', 'Itinerary 雲端尚未設定。');
  try {
    const inspected = await inspectExistingItineraryOfficeSession(user, config, client as unknown as ItineraryOfficeAuthClient);
    if (inspected.status === 'verified') return parseItineraryRollout(inspected.rollout, role);
    if (inspected.status === 'unavailable') return disabledItineraryRollout(role, 'unavailable', inspected.message);
    const { data, error } = await publicClient.rpc('sd_itinerary_get_office_entry', { p_workspace_key: config.workspaceKey, p_role: role });
    if (error) return disabledItineraryRollout(role, 'unavailable', '暫時無法確認 Itinerary 入口。');
    return data === true
      ? disabledItineraryRollout(role, 'required', inspected.message)
      : disabledItineraryRollout(role);
  } catch {
    return disabledItineraryRollout(role, 'unavailable', 'Itinerary 身份驗證暫時無法使用。');
  }
}

export function useItineraryRollout(user: Pick<UserAccount, 'department' | 'name' | 'username' | 'role'>, authGeneration = 0): ItineraryRollout {
  const role = user.role;
  const location = typeof window === 'undefined' ? undefined : { hostname: window.location.hostname, search: window.location.search };
  const immediate = location ? localDemoRollout(role, location) : disabledItineraryRollout(role);
  const [rollout, setRollout] = useState<ItineraryRollout>(() => immediate.mainEnabled ? immediate : { ...immediate, loading: true });

  useEffect(() => {
    let current = true;
    const local = location ? localDemoRollout(role, location) : disabledItineraryRollout(role);
    if (local.mainEnabled) {
      setRollout(local);
      return () => { current = false; };
    }
    setRollout({ ...disabledItineraryRollout(role), loading: true });
    void fetchItineraryRollout(user, location).then(result => { if (current) setRollout(result); });
    return () => { current = false; };
  }, [role, user.department, user.name, user.username, authGeneration, location?.hostname, location?.search]);

  return rollout;
}

export interface ShipPortalRollout {
  enabled: boolean;
  demoMode: boolean;
  loading: boolean;
  source: 'disabled' | 'local-demo' | 'cloud';
}

const disabledShipPortalRollout = (loading = false): ShipPortalRollout => ({ enabled: false, demoMode: false, loading, source: 'disabled' });

export function localShipPortalDemoRequested(location: LocationLike): boolean {
  return localItineraryDemoRequested(location);
}

export async function fetchShipPortalRollout(location?: LocationLike): Promise<ShipPortalRollout> {
  if (location && localShipPortalDemoRequested(location)) return { enabled: true, demoMode: true, loading: false, source: 'local-demo' };
  const config = getSupabaseConfig();
  const client = getSupabaseClient(config);
  if (!config || !client) return disabledShipPortalRollout();
  try {
    const { data, error } = await client.rpc('sd_itinerary_get_public_rollout', { p_workspace_key: config.workspaceKey });
    if (error) return disabledShipPortalRollout();
    const payload = Array.isArray(data) ? record(data[0]) : record(data);
    return payload?.ship_portal_enabled === true
      ? { enabled: true, demoMode: false, loading: false, source: 'cloud' }
      : disabledShipPortalRollout();
  } catch {
    return disabledShipPortalRollout();
  }
}

export function useShipPortalRollout(): ShipPortalRollout {
  const location = typeof window === 'undefined' ? undefined : { hostname: window.location.hostname, search: window.location.search };
  const local = location && localShipPortalDemoRequested(location)
    ? { enabled: true, demoMode: true, loading: false, source: 'local-demo' } as ShipPortalRollout
    : disabledShipPortalRollout(true);
  const [rollout, setRollout] = useState<ShipPortalRollout>(local);

  useEffect(() => {
    let current = true;
    if (location && localShipPortalDemoRequested(location)) {
      setRollout({ enabled: true, demoMode: true, loading: false, source: 'local-demo' });
      return () => { current = false; };
    }
    setRollout(disabledShipPortalRollout(true));
    void fetchShipPortalRollout(location).then(result => { if (current) setRollout(result); });
    return () => { current = false; };
  }, [location?.hostname, location?.search]);

  return rollout;
}

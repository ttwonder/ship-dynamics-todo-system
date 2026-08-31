import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const auth = await server.ssrLoadModule('/src/itinerary/itineraryOfficeAuth.ts');
  const main = fs.readFileSync('src/main.tsx', 'utf8');
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const shipHtml = fs.readFileSync('ship-itinerary.html', 'utf8');
  const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
  const cloudAdapter = fs.readFileSync('src/itinerary/itineraryCloud.ts', 'utf8');

  assert.match(main, /import App from ['"]\.\/App['"]/);
  assert.doesNotMatch(main, /NormalizedApp/);
  assert.match(app, /const setCurrentUserId=.*shouldClearItineraryOfficeSession\(previousUserId,nextUserId\).*clearItineraryOfficeSession\(\).*setCurrentUserIdState\(nextUserId\)/);
  assert.match(app, /if\(!liveCurrentUserId\.current\)void clearItineraryOfficeSession\(\)/);
  assert.match(shipHtml, /%BASE_URL%supabase-config\.js/);
  assert.match(dashboard, /ItineraryOfficeAuthDialog/);
  assert.match(cloudAdapter, /storageKey:\s*ITINERARY_OFFICE_SESSION_STORAGE_KEY/);
  assert.match(cloudAdapter, /ship-dynamics\.itinerary\.supabase-session/);

  const uiUser = { id: 'legacy-owner', department: '管理部', name: 'Owner One', username: 'owner.one', role: 'owner' };
  const officeIdentity = { department: '管理部', displayName: 'Owner One', usernameLabel: 'owner.one', role: 'owner' };
  assert.equal(auth.itineraryIdentityMatchesUser(officeIdentity, uiUser), true);
  assert.equal(auth.itineraryIdentityMatchesUser({ ...officeIdentity, usernameLabel: 'other' }, uiUser), false);
  assert.equal(auth.itineraryIdentityMatchesUser({ ...officeIdentity, role: 'admin' }, uiUser), false);
  assert.equal(auth.shouldClearItineraryOfficeSession('', ''), true);
  assert.equal(auth.shouldClearItineraryOfficeSession('', 'legacy-owner'), false);
  assert.equal(auth.shouldClearItineraryOfficeSession('legacy-owner', 'legacy-owner'), false);
  assert.equal(auth.shouldClearItineraryOfficeSession('legacy-owner', 'legacy-admin'), true);
  assert.equal(auth.shouldClearItineraryOfficeSession('legacy-owner', ''), true);

  const config = { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon', workspaceKey: 'ship-dynamics' };
  const rollout = {
    main_enabled: true,
    ship_portal_enabled: false,
    office_identity: { department: '管理部', display_name: 'Owner One', username_label: 'owner.one', role: 'owner' },
    role_permissions: { owner: { view: true, edit: true, import: true, export: true, calendar: true } },
  };
  let signOuts = 0;
  const verifiedClient = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'auth-owner' } } }, error: null }),
      getUser: async () => ({ data: { user: { id: 'auth-owner' } }, error: null }),
      signOut: async () => { signOuts += 1; return { error: null }; },
    },
    rpc: async (name) => ({ data: name === 'sd_itinerary_get_rollout' ? rollout : null, error: null }),
  };
  const verified = await auth.inspectExistingItineraryOfficeSession(uiUser, config, verifiedClient);
  assert.equal(verified.status, 'verified');
  assert.equal(signOuts, 0);

  const mismatchedClient = {
    ...verifiedClient,
    rpc: async () => ({ data: { ...rollout, office_identity: { ...rollout.office_identity, username_label: 'other' } }, error: null }),
  };
  const mismatch = await auth.inspectExistingItineraryOfficeSession(uiUser, config, mismatchedClient);
  assert.equal(mismatch.status, 'authentication-required');
  assert.equal(signOuts, 1);

  const calls = [];
  const loginClient = {
    auth: {
      signInWithPassword: async credentials => { calls.push(['signIn', credentials.email]); return { data: { session: { user: { id: 'auth-owner' } } }, error: null }; },
      setSession: async () => ({ data: { session: null }, error: new Error('not-used') }),
      signOut: async () => ({ error: null }),
    },
    functions: {
      invoke: async (name, options) => {
        calls.push([name, options.body.action || 'unlock']);
        if (name === 'site-unlock') return { data: { gateToken: 'gate', expiresAt: '2026-08-31T10:00:00Z' }, error: null };
        return { data: { people: [{ department: '管理部', displayName: 'Owner One', usernameLabel: 'owner.one', authAlias: 'opaque@example.invalid', loginMode: 'supabase', mustChangePassword: false }] }, error: null };
      },
    },
    rpc: async () => ({ data: rollout, error: null }),
  };
  const authenticated = await auth.authenticateItineraryOffice(uiUser, { sitePassword: 'site-pass', personalPassword: 'personal-pass' }, config, loginClient);
  assert.equal(authenticated.status, 'verified');
  assert.deepEqual(calls, [['site-unlock', 'unlock'], ['login-directory', 'directory'], ['signIn', 'opaque@example.invalid']]);

  let clearScope = null;
  const removedKeys = [];
  await auth.clearItineraryOfficeSession(
    config,
    { auth: { signOut: async options => { clearScope = options?.scope; throw new Error('offline'); } } },
    { removeItem: key => { removedKeys.push(key); } },
  );
  assert.equal(clearScope, 'local');
  assert.deepEqual(removedKeys, ['ship-dynamics.itinerary.supabase-session', 'ship-dynamics.itinerary.supabase-session']);

  console.log('itinerary_office_auth_entry=PASS');
} finally {
  await server.close();
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const rollout = await server.ssrLoadModule('/src/itinerary/itineraryRollout.ts');
  const dashboardSource = fs.readFileSync('src/Dashboard.tsx', 'utf8');
  const itineraryDashboardSource = fs.readFileSync('src/itinerary/ItineraryDashboard.tsx', 'utf8');

  assert.equal(rollout.localItineraryDemoRequested({ hostname: '127.0.0.1', search: '?itineraryDemo=1' }), true);
  assert.equal(rollout.localItineraryDemoRequested({ hostname: 'localhost', search: '?x=1&itineraryDemo=1' }), true);
  assert.equal(rollout.localItineraryDemoRequested({ hostname: 'ttwonder.github.io', search: '?itineraryDemo=1' }), false);
  assert.equal(rollout.localItineraryDemoRequested({ hostname: '127.0.0.1', search: '' }), false);

  const demo = rollout.localDemoRollout('owner', { hostname: '127.0.0.1', search: '?itineraryDemo=1' });
  assert.equal(demo.mainEnabled, true);
  assert.equal(demo.demoMode, true);
  assert.equal(demo.permissions.view, true);
  assert.equal(demo.permissions.edit, true);

  const nonOwnerDemo = rollout.localDemoRollout('admin', { hostname: '127.0.0.1', search: '?itineraryDemo=1' });
  assert.equal(nonOwnerDemo.mainEnabled, false);
  assert.equal(nonOwnerDemo.permissions.view, false);

  const disabled = rollout.disabledItineraryRollout('owner');
  assert.equal(disabled.mainEnabled, false);
  assert.equal(disabled.permissions.view, false);

  const parsed = rollout.parseItineraryRollout({
    main_enabled: true,
    ship_portal_enabled: false,
    role_permissions: {
      owner: { view: true, edit: true, import: true, export: true, calendar: true },
      admin: { view: false, edit: false, import: false, export: false, calendar: false },
    },
  }, 'owner');
  assert.equal(parsed.mainEnabled, true);
  assert.equal(parsed.permissions.calendar, true);
  assert.equal(rollout.parseItineraryRollout({ main_enabled: true, role_permissions: {} }, 'owner').mainEnabled, false);

  assert.match(dashboardSource, /lazy\(\(\)\s*=>\s*import\('\.\/itinerary\/ItineraryDashboard'\)\)/);
  assert.match(dashboardSource, /itineraryRollout\.permissions\.view/);
  assert.match(dashboardSource, /切換 Itinerary 視圖/);
  assert.match(dashboardSource, /返回船舶卡片/);
  assert.match(dashboardSource, /<ItineraryDashboard[\s\S]*vessels=\{visible\}/);
  assert.doesNotMatch(itineraryDashboardSource, /user\.role\s*[!=]==?\s*['"]owner['"]/, 'cloud action permissions must remain configurable after the Owner-only pilot');
  assert.match(itineraryDashboardSource, /backend&&displayMode==='table'/, 'the cloud repository must mount the same production table path as local demo');

  console.log('itinerary_owner_rollout_and_dashboard_contract=PASS');
} finally {
  await server.close();
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const rollout = await server.ssrLoadModule('/src/itinerary/itineraryRollout.ts');
  const dashboardSource = fs.readFileSync('src/Dashboard.tsx', 'utf8');
  const itineraryDashboardSource = fs.readFileSync('src/itinerary/ItineraryDashboard.tsx', 'utf8');
  const vesselDisplayPath = 'src/itinerary/itineraryVesselDisplay.ts';
  assert.equal(fs.existsSync(vesselDisplayPath), true, 'Itinerary must project the same vessel display name used by vessel cards');
  const vesselDisplay = await server.ssrLoadModule(`/${vesselDisplayPath}`);
  const demoData = await server.ssrLoadModule('/src/itinerary/itineraryDemoData.ts');
  const itineraryTypes = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const amber = {
    id: 'vessel-amber',
    name: '安華',
    shortName: 'S AMBER',
    fullName: 'FPMC S AMBER',
    position: { lastPort: '', location: '', nextPort: '' },
    cargo: { loadStatus: '空載', items: [] },
  };
  const cloudDocument = { vesselId: amber.id, vesselName: '安華' };
  const projectedDocuments = vesselDisplay.projectItineraryDocumentsForDisplay({ [amber.id]: cloudDocument }, [amber]);
  assert.equal(projectedDocuments[amber.id].vesselName, '安華 FPMC S AMBER', 'cloud documents must use the vessel-card display name');
  assert.equal(cloudDocument.vesselName, '安華', 'display projection must not rewrite the authoritative cloud document');
  assert.equal(demoData.createDemoItineraryDocument(amber, 0, Date.parse('2026-08-31T08:00:00Z')).vesselName, '安華 FPMC S AMBER', 'local demo must use the vessel-card display name');
  assert.equal(typeof vesselDisplay.resolveItineraryEditorDocument, 'function', 'Owner must be able to edit a displayed blank Itinerary before any ship-side save');
  const blankPreview = itineraryTypes.createEmptyItineraryDocument({ workspaceKey: 'ship-dynamics', vesselId: amber.id, vesselName: '安華' });
  const blankEditorDocument = vesselDisplay.resolveItineraryEditorDocument(null, blankPreview, amber);
  assert.equal(blankEditorDocument.revision, 0, 'a missing cloud document must open from the displayed revision-0 placeholder');
  assert.equal(blankEditorDocument.vesselName, '安華 FPMC S AMBER');
  const savedCloudDocument = { ...blankPreview, revision: 3 };
  assert.equal(vesselDisplay.resolveItineraryEditorDocument(savedCloudDocument, blankPreview, amber).revision, 3, 'a real cloud document must win over the placeholder');
  assert.match(itineraryDashboardSource, /resolveItineraryEditorDocument\(loaded,\s*displayDocuments\[vesselId\],\s*vessel\)/, 'the editor opening path must use the blank-document fallback');
  const itineraryPanel = await server.ssrLoadModule('/src/itinerary/ItineraryPanel.tsx');
  const panelHtml = renderToStaticMarkup(createElement(itineraryPanel.default, {
    document: {
      workspaceKey: 'ship-dynamics',
      vesselId: amber.id,
      vesselName: '安華 FPMC S AMBER',
      revision: 7,
      schemaVersion: 1,
      rows: [],
      updatedAt: '2026-08-31T06:00:00Z',
      updatedActorKind: 'office',
      updatedActorLabel: 'Owner',
    },
    selected: false,
    nowMs: Date.parse('2026-08-31T08:00:00Z'),
    canEdit: true,
    onToggleSelected() {},
    onEdit() {},
  }));
  assert.doesNotMatch(panelHtml, /Revision/i, 'ordinary Itinerary cards must not expose the internal revision');
  assert.match(panelHtml, /class="itinerary-panel-meta"><span>2 小時前更新<\/span>/, 'the card meta area must show relative update time');
  assert.equal(panelHtml.match(/2 小時前更新/g)?.length, 1, 'relative update time must be shown exactly once');

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
  assert.equal(disabled.version, null);

  const bootstrap = rollout.parseItineraryRollout({
    version: 1,
    main_enabled: false,
    ship_portal_enabled: false,
    role_permissions: {
      owner: { view: true, edit: true, import: true, export: true, calendar: true },
    },
  }, 'owner');
  assert.equal(bootstrap.mainEnabled, false);
  assert.equal(bootstrap.version, 1);
  assert.equal(bootstrap.authStatus, 'verified');
  assert.equal(rollout.ownerCanBootstrapItinerary('owner', bootstrap), false);
  assert.equal(rollout.ownerCanManageItineraryRollout('owner', bootstrap), true);
  assert.equal(rollout.ownerCanManageItineraryRollout('admin', bootstrap), false);

  const ownerWithoutSession = rollout.disabledItineraryRollout('owner');
  assert.equal(rollout.ownerCanBootstrapItinerary('owner', ownerWithoutSession), true);
  assert.equal(rollout.ownerCanBootstrapItinerary('admin', ownerWithoutSession), false);

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
  assert.match(dashboardSource, /ItineraryOwnerRolloutDialog/);
  assert.match(dashboardSource, /驗證 Itinerary Owner/);
  assert.match(dashboardSource, /Itinerary 試行設定/);
  assert.match(dashboardSource, /<ItineraryDashboard[\s\S]*vessels=\{visible\}/);
  assert.doesNotMatch(itineraryDashboardSource, /user\.role\s*[!=]==?\s*['"]owner['"]/, 'cloud action permissions must remain configurable after the Owner-only pilot');
  assert.match(itineraryDashboardSource, /backend&&displayMode==='table'/, 'the cloud repository must mount the same production table path as local demo');
  const officeEditConfirmation = "if (!window.confirm('請盡量以船端修改為主，確定要修改嗎？')) return;";
  const confirmationIndex = itineraryDashboardSource.indexOf(officeEditConfirmation);
  const leaseClaimIndex = itineraryDashboardSource.indexOf('await backend.claimLease', confirmationIndex);
  assert.ok(confirmationIndex >= 0, 'office manual edit must show the exact ship-first confirmation');
  assert.ok(leaseClaimIndex > confirmationIndex, 'cancelling the office edit confirmation must happen before claiming a vessel lease');
  const importApplyBlock = itineraryDashboardSource.slice(itineraryDashboardSource.indexOf('const applyImports = async'), itineraryDashboardSource.indexOf('return <section'));
  const importClaimIndex = importApplyBlock.indexOf('backend.claimLease');
  const importLoadIndex = importApplyBlock.indexOf('backend.loadDocument');
  const importSaveIndex = importApplyBlock.indexOf('backend.save');
  assert.ok(importClaimIndex >= 0 && importLoadIndex > importClaimIndex && importSaveIndex > importLoadIndex, 'office Excel overwrite must claim, reload authority, then CAS-save over the latest revision');

  console.log('itinerary_owner_rollout_and_dashboard_contract=PASS');
} finally {
  await server.close();
}

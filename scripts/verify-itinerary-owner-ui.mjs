import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const dashboardModule = await server.ssrLoadModule('/src/Dashboard.tsx');
  const dashboardSource = fs.readFileSync('src/Dashboard.tsx', 'utf8');
  const itineraryDashboardSource = fs.readFileSync('src/itinerary/ItineraryDashboard.tsx', 'utf8');
  const itineraryCssSource = fs.readFileSync('src/itinerary/itinerary.css', 'utf8');
  const fullPermissions = { view: true, edit: true, import: true, export: true, calendar: true };
  const at = '2026-09-02T00:00:00.000Z';

  for (const role of ['owner', 'admin', 'operator', 'vessel']) {
    const user = {
      id: `${role}-id`, department: '測試部', name: role, username: role, role,
      passwordHash: '', isActive: true, managedVesselIds: [], createdAt: at, updatedAt: at,
    };
    const html = renderToStaticMarkup(createElement(dashboardModule.default, {
      user,
      itineraryActor: { userId: user.id },
      users: [user],
      vessels: [],
      tasks: [],
      internalControlCases: [],
      meetings: [],
      selected: [],
      setSelected() {},
      batchSelected: [],
      setBatchSelected() {},
      onOpenVessel() {},
      onEdit() {},
      onAddTask() {},
      onToggleAttention() {},
      onAdjustAttention() {},
      onStartMeeting() {},
      onOpenReport() {},
      onTaskMetric() {},
      onOpenBatchManagedVessels() {},
      canEdit: false,
      canCreateTasks: false,
      canUseMeetings: false,
      canUseReports: false,
    }));
    assert.match(html, /切換顯示Itinerary信息/, `${role} must see the direct Itinerary switch immediately after normal login`);
    assert.doesNotMatch(html, /Itinerary 開放設定|驗證 Itinerary 身份/, `${role} must not see a historical access control`);
  }

  assert.match(dashboardSource, /lazy\(\(\)\s*=>\s*import\('\.\/itinerary\/ItineraryDashboard'\)\)/);
  assert.doesNotMatch(dashboardSource, /itineraryRollout|ItineraryOwnerRolloutDialog|user\.role\s*[!=]==?\s*['"]vessel['"]/, 'all logged-in roles must share one ungated path');
  assert.match(dashboardSource, /切換顯示Itinerary信息/);
  assert.match(dashboardSource, /返回船舶卡片/);
  assert.match(dashboardSource, /<ItineraryDashboard[\s\S]*actor=\{itineraryActor\}[\s\S]*vessels=\{visible\}/);
  assert.match(itineraryDashboardSource, /const UNRESTRICTED_ITINERARY_PERMISSIONS[\s\S]*view:\s*true[\s\S]*edit:\s*true[\s\S]*import:\s*true[\s\S]*export:\s*true[\s\S]*calendar:\s*true/);
  assert.match(itineraryDashboardSource, /new OfficeItineraryCloudRepository\(actor\)/);
  assert.match(itineraryDashboardSource, /backend&&displayMode==='table'/, 'the cloud repository must mount the same production table path as local demo');
  assert.match(itineraryDashboardSource, /displayMode==='table'\?'切換行事曆':'返回 Itinerary'/, 'calendar toggle labels must describe both destinations');
  assert.match(itineraryDashboardSource, /className="btn small itinerary-view-toggle"/, 'calendar toggle must use its prominent semantic class');
  assert.match(itineraryCssSource, /\.itinerary-view-toggle\{[^}]*background:[^}]*color:#fff/i, 'calendar toggle must have a colored high-contrast treatment');

  const vesselDisplay = await server.ssrLoadModule('/src/itinerary/itineraryVesselDisplay.ts');
  const demoData = await server.ssrLoadModule('/src/itinerary/itineraryDemoData.ts');
  const itineraryTypes = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const amber = {
    id: 'vessel-amber', name: '安華', shortName: 'S AMBER', fullName: 'FPMC S AMBER',
    position: { lastPort: '', location: '', nextPort: '' },
    cargo: { loadStatus: '空載', items: [] },
  };
  const cloudDocument = { vesselId: amber.id, vesselName: '安華' };
  const projectedDocuments = vesselDisplay.projectItineraryDocumentsForDisplay({ [amber.id]: cloudDocument }, [amber]);
  assert.equal(projectedDocuments[amber.id].vesselName, '安華 FPMC S AMBER');
  assert.equal(cloudDocument.vesselName, '安華');
  assert.equal(demoData.createDemoItineraryDocument(amber, 0, Date.parse('2026-08-31T08:00:00Z')).vesselName, '安華 FPMC S AMBER');
  const blankPreview = itineraryTypes.createEmptyItineraryDocument({ workspaceKey: 'ship-dynamics', vesselId: amber.id, vesselName: '安華' });
  assert.equal(vesselDisplay.resolveItineraryEditorDocument(null, blankPreview, amber).revision, 0);
  assert.match(itineraryDashboardSource, /resolveItineraryEditorDocument\(loaded,\s*displayDocuments\[vesselId\],\s*vessel\)/);

  const itineraryPanel = await server.ssrLoadModule('/src/itinerary/ItineraryPanel.tsx');
  const panelHtml = renderToStaticMarkup(createElement(itineraryPanel.default, {
    document: {
      workspaceKey: 'ship-dynamics', vesselId: amber.id, vesselName: '安華 FPMC S AMBER',
      revision: 7, schemaVersion: 1, rows: [], updatedAt: '2026-08-31T06:00:00Z',
      updatedActorKind: 'office', updatedActorLabel: 'Owner',
    },
    selected: false,
    nowMs: Date.parse('2026-08-31T08:00:00Z'),
    canEdit: fullPermissions.edit,
    onToggleSelected() {},
    onEdit() {},
  }));
  assert.doesNotMatch(panelHtml, /Revision/i);
  assert.match(panelHtml, /2 小時前更新/);
  assert.match(panelHtml, /顯示更多預估參數/);

  const officeEditConfirmation = "if (!window.confirm('請盡量以船端修改為主，確定要修改嗎？')) return;";
  const confirmationIndex = itineraryDashboardSource.indexOf(officeEditConfirmation);
  const leaseClaimIndex = itineraryDashboardSource.indexOf('await backend.claimLease', confirmationIndex);
  assert.ok(confirmationIndex >= 0 && leaseClaimIndex > confirmationIndex);
  const importApplyBlock = itineraryDashboardSource.slice(itineraryDashboardSource.indexOf('const applyImports = async'), itineraryDashboardSource.indexOf('return <section'));
  const importClaimIndex = importApplyBlock.indexOf('backend.claimLease');
  const importLoadIndex = importApplyBlock.indexOf('backend.loadDocument');
  const importSaveIndex = importApplyBlock.indexOf('backend.save');
  assert.ok(importClaimIndex >= 0 && importLoadIndex > importClaimIndex && importSaveIndex > importLoadIndex);

  const utcOffsetSelect = await server.ssrLoadModule('/src/itinerary/UtcOffsetSelect.tsx');
  const utcOffsetHtml = renderToStaticMarkup(createElement(utcOffsetSelect.default, { value: 'UTC+5:45', onChange() {} }));
  assert.match(utcOffsetHtml, /UTC-12/);
  assert.match(utcOffsetHtml, /UTC\+5:45/);
  assert.match(utcOffsetHtml, /UTC\+14/);
  assert.doesNotMatch(utcOffsetHtml, /Asia\//);

  console.log('itinerary_universal_dashboard_contract=PASS');
} finally {
  await server.close();
}

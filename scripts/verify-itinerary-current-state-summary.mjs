import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const cases = [];
const test = (name, fn) => { fn(); cases.push(name); };
try {
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const Panel = (await server.ssrLoadModule('/src/itinerary/ItineraryPanel.tsx')).default;
  const d = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'qa-v1', vesselName: 'QA VESSEL 1', rowId: 'r1' });
  d.rows[0].currentVesselState = { location: 'QA Taiwan Strait', navigationStatus: '航行', loadStatus: '滿載', statusList: ['loading', 'drydock/repiar'] };
  d.rows[0].previousPortName = 'QA PREVIOUS';
  d.rows[0].calculationStartTimeZone = 'UTC+8';
  const before = JSON.stringify(d);
  const renderPanel = (document, canEdit = false) => renderToStaticMarkup(React.createElement(Panel, { document, selected: false, nowMs: 0, canEdit, onToggleSelected() {}, onNotice() {}, onEdit() {} }));
  test('office browse shows all four labels and saved values without editing', () => {
    const html = renderPanel(d);
    for (const text of ['目前位置', '目前航行狀態', '目前載況', '目前船舶狀態', 'QA Taiwan Strait', '航行', '滿載', 'loading', 'drydock/repair']) assert.ok(html.includes(text), 'missing browse text: ' + text);
    assert.ok(!html.includes('drydock/repiar'));
    assert.ok(!html.includes('手動修改'));
    assert.ok(html.includes('現在所處時區') && html.includes('QA PREVIOUS'));
  });
  const Summary = (await server.ssrLoadModule('/src/itinerary/ItineraryCurrentVesselStateSummary.tsx')).default;
  const render = document => renderToStaticMarkup(React.createElement(Summary, { document }));
  test('summary is labelled read-only text, not form controls', () => {
    const html = render(d);
    assert.ok(html.includes('aria-label="目前船舶狀態摘要"'));
    assert.equal((html.match(/<dt>/g) || []).length, 4);
    assert.equal((html.match(/<dd>/g) || []).length, 4);
    assert.ok(!/<(?:input|select|textarea|button)\b/.test(html));
  });
  test('new summary stays between vessel heading and original office actions', () => {
    const html = renderPanel(d, true);
    assert.ok(html.indexOf('itinerary-vessel-heading') < html.indexOf('itinerary-current-state-summary'));
    assert.ok(html.indexOf('itinerary-current-state-summary') < html.indexOf('itinerary-panel-meta'));
    assert.ok(html.includes('手動修改'));
  });
  test('empty legacy metadata does not invent vessel-card defaults', () => {
    const legacy = structuredClone(d); delete legacy.rows[0].currentVesselState;
    const html = render(legacy); assert.equal((html.match(/未填/g) || []).length, 4);
  });
  test('partial metadata and intentional empty values are safe', () => {
    const partial = structuredClone(d); partial.rows[0].currentVesselState = { location: '', statusList: [], navigationStatus: '停泊' };
    const html = render(partial); assert.equal((html.match(/未填/g) || []).length, 3); assert.ok(html.includes('停泊'));
  });
  test('empty document still shows all four labelled slots', () => {
    const empty = structuredClone(d); empty.rows = [];
    assert.equal((render(empty).match(/未填/g) || []).length, 4);
  });
  test('uses sorted first formal row; never later or alternative state', () => {
    const reordered = structuredClone(d);
    const trap = { ...types.createBlankItineraryRow('r2', 1), currentVesselState: { location: 'NEVER SECOND' } };
    reordered.rows = [trap, reordered.rows[0]];
    reordered.alternativePlans = [{ planId: 'a', sortOrder: 0, rows: [{ ...trap, currentVesselState: { location: 'NEVER ALTERNATIVE' } }] }];
    const html = render(reordered); assert.ok(html.includes('QA Taiwan Strait')); assert.ok(!html.includes('NEVER'));
  });
  test('long text remains complete and HTML is escaped', () => {
    const long = structuredClone(d); long.rows[0].currentVesselState.location = '<script>alert(1)</script>' + 'Long Area '.repeat(20);
    const html = render(long); assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('Long Area '.repeat(19))); assert.ok(!html.includes('<script>'));
  });
  test('render does not mutate formal state or aliases', () => assert.equal(JSON.stringify(d), before));
  test('ship browse mounts the same summary between heading and action controls', () => {
    const src = fs.readFileSync('src/itinerary/ShipItineraryPortal.tsx', 'utf8');
    const browse = src.slice(src.indexOf('<div className="ship-latest-head">'), src.indexOf('<ItineraryBrowseTable rows={latest.rows}'));
    assert.equal((browse.match(/<ItineraryCurrentVesselStateSummary document=\{latest\}/g) || []).length, 1);
    assert.ok(browse.indexOf('<ShipItineraryLatestHeading') < browse.indexOf('<ItineraryCurrentVesselStateSummary'));
    assert.ok(browse.indexOf('<ItineraryCurrentVesselStateSummary') < browse.indexOf('<ItineraryCopyEmailButton'));
  });
  console.log(JSON.stringify({ status: 'PASS', layer: 'SSR/model and ship mount wiring', cases }));
} finally { await server.close(); }

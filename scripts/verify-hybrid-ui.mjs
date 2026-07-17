import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/Dashboard.tsx', import.meta.url), 'utf8');
const appRuntime = `${app}\n${dashboard}`;
const morning = readFileSync(new URL('../src/MorningWorkspace.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const requiredAppContracts = [
  ['早會工作台 navigation', '早會工作台'],
  ['待辦總表 navigation', '待辦總表'],
  ['報告中心 navigation', '報告中心'],
  ['fleet card grid', 'fleet-card-grid'],

  ['report preview modal', 'report-preview-modal'],
  ['selected vessel count', 'selected-vessel-count'],
];

const requiredCssContracts = [
  ['macaron purple token', '--macaron-purple'],
  ['ship card styling', '.ship-card'],
  ['three-column meeting layout', '.morning-workspace'],
  ['report paper styling', '.report-paper'],
];

for (const [label, needle] of requiredAppContracts) {
  assert.ok(appRuntime.includes(needle), `Missing accepted hybrid UI contract: ${label}`);
}
assert.ok(morning.includes('morning-workspace'), 'Missing accepted hybrid UI contract: morning meeting workspace');
for (const [label, needle] of requiredCssContracts) {
  assert.ok(css.includes(needle), `Missing accepted hybrid style contract: ${label}`);
}

console.log('Hybrid UI acceptance contracts are present.');

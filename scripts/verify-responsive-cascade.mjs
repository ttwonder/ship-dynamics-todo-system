import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const globalMobile = '@media(max-width:600px){.fleet-card-grid,.metric-grid{grid-template-columns:1fr}';
const detailMobile = '@media(max-width:600px){.vessel-detail-top{align-items:flex-start;flex-direction:column}';
const globalIndex = styles.lastIndexOf(globalMobile);
const detailIndex = styles.lastIndexOf(detailMobile);

assert.ok(globalIndex >= 0, 'global 600px card/grid rules must exist');
assert.ok(detailIndex >= 0, 'single-vessel 600px card rules must exist');
assert.ok(globalIndex > styles.lastIndexOf('.fleet-card-grid{display:grid'), 'mobile fleet cards must appear after all desktop fleet-card declarations');
assert.ok(globalIndex > styles.lastIndexOf('.metric-grid{display:grid'), 'mobile metric cards must appear after all desktop metric-grid declarations');
assert.ok(detailIndex > styles.lastIndexOf('.vessel-detail-metrics{display:grid'), 'mobile vessel detail cards must appear after the desktop detail metric declaration');
assert.ok(styles.slice(detailIndex).includes('.vessel-detail-metrics{grid-template-columns:1fr 1fr}'), 'single-vessel mobile metrics must remain two compact columns');
assert.ok(styles.slice(globalIndex).includes('.temporary-meeting-workspace{display:block}'), 'mobile temporary-meeting card workspace must not be overridden by a later desktop grid rule');

console.log('Responsive cascade contracts passed.');

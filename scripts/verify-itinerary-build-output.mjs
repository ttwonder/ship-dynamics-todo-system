import assert from 'node:assert/strict';
import fs from 'node:fs';

const htmlPath = 'dist/ship-itinerary.html';
assert.ok(fs.existsSync(htmlPath), 'production build must emit dist/ship-itinerary.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const configMatch = html.match(/<script\s+src="[^"]*supabase-config\.js"><\/script>/);
assert.ok(configMatch, 'built ship portal must load supabase-config.js');
const moduleIndex = html.indexOf('<script type="module"');
assert.ok(moduleIndex >= 0, 'built ship portal must load its module entry');
assert.ok(html.indexOf(configMatch[0]) < moduleIndex, 'supabase config must load before the ship portal module');
assert.ok(fs.existsSync('dist/supabase-config.js'), 'production build must copy public/supabase-config.js');
assert.ok(fs.statSync('dist/supabase-config.js').size > 0, 'built Supabase config must not be empty');

const assetDirectory = 'dist/assets';
const cssAssets = fs.readdirSync(assetDirectory).filter(name => name.endsWith('.css'));
const jsAssets = fs.readdirSync(assetDirectory).filter(name => name.endsWith('.js'));
assert.ok(cssAssets.length > 0, 'production build must emit CSS assets');
assert.ok(jsAssets.length > 0, 'production build must emit JavaScript assets');
const builtCss = cssAssets.map(name => fs.readFileSync(`${assetDirectory}/${name}`, 'utf8')).join('\n');
const builtJs = jsAssets.map(name => fs.readFileSync(`${assetDirectory}/${name}`, 'utf8')).join('\n');
assert.ok(builtJs.includes('一鍵複製並發送郵件'), 'production JavaScript must include the shared copy-and-email action');
assert.ok(builtJs.includes('已復製，請去郵箱客戶端粘貼'), 'production JavaScript must include the exact copy confirmation');
assert.ok(builtJs.includes('text/html') && builtJs.includes('text/plain'), 'production JavaScript must include rich and plain clipboard MIME types');
assert.ok(builtJs.includes('mailto:?subject='), 'production JavaScript must request the standard mailto protocol');
assert.ok(builtJs.includes('Arr ROB\n(Cargo/Fuel/FW)'), 'production JavaScript must include the two-line Arr ROB heading');
assert.ok(builtJs.includes('Dep ROB\n(Cargo/Fuel/FW)'), 'production JavaScript must include the two-line Dep ROB heading');
const findCssRule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return builtCss.match(new RegExp(`${escaped}\\{[^}]*\\}`))?.[0] || '';
};
const assertRuleIncludes = (selector, declarations) => {
  const rule = findCssRule(selector);
  assert.ok(rule, `production CSS must include ${selector}`);
  for (const declaration of declarations) assert.ok(rule.includes(declaration), `${selector} must retain ${declaration}`);
};
assertRuleIncludes('.itinerary-calendar-controls', ['font-size:12px', 'min-height:42px']);
assertRuleIncludes('.itinerary-calendar-axis .itinerary-calendar-vessel-label', ['background:#eef3f8', 'color:#243142']);
assertRuleIncludes('.itinerary-calendar-day-track', ['height:36px', 'background:#eef3f8', 'color:#243142']);
assertRuleIncludes('.itinerary-calendar-event', ['height:28px', 'background:#176b5b', 'color:#fff', 'font-size:12px']);
assertRuleIncludes('.itinerary-browse-table th.itinerary-field-heading-multiline', ['white-space:pre-line']);
assertRuleIncludes('.itinerary-editor-table th.itinerary-field-heading-multiline', ['white-space:pre-line']);
assertRuleIncludes('.ship-editor-grid th.itinerary-field-heading-multiline', ['white-space:pre-line']);
assert.doesNotMatch(builtCss, /@media\(prefers-color-scheme:dark\)\{\.itinerary-calendar/, 'production CSS must not restore the partial dark calendar override');

console.log('itinerary_build_output=PASS');

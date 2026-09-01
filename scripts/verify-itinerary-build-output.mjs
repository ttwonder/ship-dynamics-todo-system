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
assert.ok(cssAssets.length > 0, 'production build must emit CSS assets');
const builtCss = cssAssets.map(name => fs.readFileSync(`${assetDirectory}/${name}`, 'utf8')).join('\n');
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
assertRuleIncludes('.itinerary-calendar-day-track', ['height:36px', 'background:#243142', 'color:#f8fafc']);
assertRuleIncludes('.itinerary-calendar-event', ['height:28px', 'background:#176b5b', 'color:#fff', 'font-size:12px']);
assert.doesNotMatch(builtCss, /@media\(prefers-color-scheme:dark\)\{\.itinerary-calendar/, 'production CSS must not restore the partial dark calendar override');

console.log('itinerary_build_output=PASS');

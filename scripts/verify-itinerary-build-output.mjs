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
assert.ok(!builtJs.includes('Itinerary 開放設定'), 'production JavaScript must not retain the historical Owner rollout control');
assert.ok(!builtJs.includes('Vessel 主頁始終不開放'), 'production JavaScript must not retain the Vessel exclusion');
assert.ok(!builtJs.includes('Admin／Operator／Vessel 的主頁權限始終保持關閉'), 'production JavaScript must not retain the Owner-only pilot copy');
assert.ok(builtJs.includes('目前只在本機 Itinerary demo 模式顯示'), 'production JavaScript must use the shared demo label');
assert.ok(!builtJs.includes('Owner demo 模式'), 'production JavaScript must not retain the Owner-only demo label');
assert.ok(builtJs.includes('切換顯示Itinerary信息'), 'production JavaScript must include the exact universal-entry label');
assert.ok(!builtJs.includes('切換為Itinerary信息'), 'production JavaScript must not retain the superseded label');
assert.ok(!builtJs.includes('驗證 Itinerary 身份'), 'production JavaScript must not retain the second Itinerary login trigger');
assert.ok(!builtJs.includes('設定並驗證 Itinerary'), 'production JavaScript must not retain the second Itinerary login dialog copy');
assert.ok(builtJs.includes('sd_itinerary_main_load_many'), 'production JavaScript must use the universal main-session load RPC');
assert.ok(builtJs.includes('sd_itinerary_main_save'), 'production JavaScript must use the universal main-session save RPC');
assert.ok(!builtJs.includes('sd_itinerary_main_get_rollout'), 'production JavaScript must not retain the historical main rollout RPC');
assert.ok(!builtJs.includes('sd_itinerary_main_owner_update_rollout'), 'production JavaScript must not retain Owner-only rollout management');
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

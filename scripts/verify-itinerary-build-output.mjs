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

console.log('itinerary_build_output=PASS');

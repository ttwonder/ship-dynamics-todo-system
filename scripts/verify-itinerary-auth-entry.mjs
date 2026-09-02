import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const normalizedApp = fs.readFileSync('src/NormalizedApp.tsx', 'utf8');
const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const cloudAdapter = fs.readFileSync('src/itinerary/itineraryCloud.ts', 'utf8');

assert.doesNotMatch(app, /clearItineraryOfficeSession|shouldClearItineraryOfficeSession/, 'normal logout or user switching must not manage a second Itinerary Auth session');
assert.match(app, /itineraryActor=\{\{\s*userId:\s*currentUser\.id\s*\}\}/, 'legacy main login must pass only the active user id');
assert.match(normalizedApp, /itineraryActor=\{\{\s*userId:\s*user\.id\s*\}\}/, 'normalized main login must pass only the active user id');
assert.doesNotMatch(dashboard, /ItineraryOfficeAuthDialog|itineraryAuthOpen|驗證 Itinerary 身份|設定並驗證 Itinerary/, 'the dashboard must not mount or advertise a second Itinerary login');
assert.doesNotMatch(dashboard, /itineraryRollout|ItineraryOwnerRolloutDialog|Itinerary 開放設定/, 'the historical rollout and Owner controls must not gate the dashboard');
assert.match(dashboard, /切換顯示Itinerary信息/, 'the direct-entry button label must match the latest approved wording exactly');
assert.doesNotMatch(cloudAdapter, /p_actor_guard|guard:\s*unknown|updateOwnerItineraryRollout/, 'main-site Itinerary must not retain a separate guard or Owner rollout API');
assert.match(cloudAdapter, /export interface ItineraryMainActor\s*\{\s*userId:\s*string;\s*\}/, 'the office actor must be the already active main-site user id only');

for (const removedPath of [
  'src/itinerary/ItineraryOfficeAuthDialog.tsx',
  'src/itinerary/itineraryOfficeAuth.ts',
  'src/itinerary/ItineraryOwnerRolloutDialog.tsx',
  'src/itinerary/itineraryRollout.ts',
  'src/itinerary/useItineraryRollout.ts',
]) {
  assert.equal(fs.existsSync(removedPath), false, `${removedPath} must be removed after universal access replaces the historical gate`);
}

console.log('itinerary_direct_entry=PASS');

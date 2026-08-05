import assert from 'node:assert/strict';
import fs from 'node:fs';

const files=[
  'supabase/normalized-core-domain.sql',
  'supabase/normalized-meeting.sql',
  'supabase/normalized-internal-control.sql',
];
const [core,...dependants]=files.map(path=>fs.readFileSync(path,'utf8'));
const sql=[core,...dependants].join('\n');

assert.match(core,/create or replace function public\.sd_taipei_date\(p_at timestamptz\)/i,'normalized core must define the shared Taipei business-date helper');
assert.match(core,/\(p_at at time zone 'Asia\/Taipei'\)::date/i,'Taipei business-date helper must derive the calendar date explicitly');
assert.doesNotMatch(sql,/\bcurrent_date\b/i,'normalized business commands must not depend on the PostgreSQL session timezone');
assert.doesNotMatch(sql,/clock_timestamp\(\)\s*::\s*date/i,'normalized business commands must not cast timestamptz to a session-timezone date');
assert.equal((sql.match(/public\.sd_taipei_date\(clock_timestamp\(\)\)/gi)||[]).length,14,'all 14 persisted business-date sites must use the Taipei helper');

console.log('Normalized Taipei business-date SQL contracts passed.');

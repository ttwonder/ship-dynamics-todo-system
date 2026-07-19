import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const createTaskBlock = app.match(/const addTaskForVessel\s*=[\s\S]*?const saveTask\s*=/)?.[0] || '';

assert.ok(createTaskBlock, 'createTask flow must exist');
assert.match(createTaskBlock, /expectedDate\s*:\s*''/, 'new tasks must start with a blank expected completion date');
assert.doesNotMatch(createTaskBlock, /expectedDate\s*:\s*todayDate\(\)/, 'new tasks must not default the expected completion date to today');

console.log('New task blank expected-date contract passed.');

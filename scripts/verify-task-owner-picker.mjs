import assert from 'node:assert/strict';
import fs from 'node:fs';

const taskEditor = fs.readFileSync(new URL('../src/EditModals.tsx', import.meta.url), 'utf8');
const picker = fs.readFileSync(new URL('../src/MeetingPeoplePicker.tsx', import.meta.url), 'utf8');

assert.ok(taskEditor.includes("currentUser.role!=='vessel'&&<MeetingPeoplePicker"), 'task owner picker must render for both create and update flows');
assert.ok(!taskEditor.includes("creating&&currentUser.role!=='vessel'&&<MeetingPeoplePicker"), 'task owner picker must not be limited to create flow');
assert.ok(taskEditor.includes('users={eligibleOwnerUsers}') && taskEditor.includes('departments={data.settings.departments}'), 'task owner picker must retain permission filtering and department filtering');
assert.ok(taskEditor.includes('disabled={globalReadOnly}'), 'read-only task view must explicitly disable the owner picker');
assert.match(picker, /disabled\s*=\s*false/, 'shared people picker must support a disabled mode');
assert.ok(picker.includes('aria-disabled={disabled}') && picker.includes('if(disabled)event.preventDefault()'), 'disabled people picker must expose ARIA and block opening');
assert.ok(picker.includes("event.key === 'Escape'") && picker.includes("removeAttribute('open')"), 'Escape must close the people picker without closing the task dialog');
assert.ok(picker.includes('部門篩選') && picker.includes('姓名搜尋') && picker.includes('全選目前篩選'), 'task people picker must provide meeting-style department/search controls');
console.log('Task owner department-filtered picker contracts passed.');

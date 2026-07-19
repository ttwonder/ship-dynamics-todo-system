import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/EditModals.tsx', import.meta.url), 'utf8');
const taskEditor = source.slice(source.indexOf('export function TaskEditModal'));
const picker = source.slice(source.indexOf('function DropdownMultiPicker'), source.indexOf('export function VesselEditModal'));

assert.ok(taskEditor.includes("currentUser.role!=='vessel'&&<DropdownMultiPicker"), 'task owner picker must render for both create and update flows');
assert.ok(!taskEditor.includes("creating&&currentUser.role!=='vessel'&&<DropdownMultiPicker"), 'task owner picker must not be limited to create flow');
assert.ok(taskEditor.includes('disabled={readOnly}'), 'read-only task view must explicitly disable the owner picker');
assert.match(picker, /disabled\s*=\s*false/, 'owner picker must support a disabled mode');
assert.ok(picker.includes('disabled={disabled}') && picker.includes('aria-disabled={disabled}'), 'disabled owner picker must expose native and ARIA semantics');
assert.ok(picker.includes("event.key === 'Escape'") && picker.includes('setOpen(false)'), 'Escape must close the owner picker without closing the task dialog');
assert.ok(picker.includes('aria-label="搜尋涉及人員"'), 'owner picker must remain searchable');

console.log('Task owner searchable picker contracts passed.');

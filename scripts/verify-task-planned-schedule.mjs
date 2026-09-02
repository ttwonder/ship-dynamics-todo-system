import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const schedule = await server.ssrLoadModule('/src/taskPlannedSchedule.ts');

  assert.equal(schedule.isValidPlannedDurationDays(0.5), true);
  assert.equal(schedule.isValidPlannedDurationDays(1), true);
  assert.equal(schedule.isValidPlannedDurationDays(12), true);
  for (const invalid of [undefined, null, '', '1', 0, -1, 1.5, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(schedule.isValidPlannedDurationDays(invalid), false, `${String(invalid)} must not be a valid duration`);
  }

  assert.deepEqual(schedule.parsePlannedDurationInput(''), { ok: true, value: undefined });
  assert.deepEqual(schedule.parsePlannedDurationInput('0.5'), { ok: true, value: 0.5 });
  assert.deepEqual(schedule.parsePlannedDurationInput('3'), { ok: true, value: 3 });
  assert.equal(schedule.isPlannedDurationEditingInput(''), true);
  assert.equal(schedule.isPlannedDurationEditingInput('0'), true);
  assert.equal(schedule.isPlannedDurationEditingInput('0.'), true);
  assert.equal(schedule.isPlannedDurationEditingInput('0.5'), true);
  assert.equal(schedule.isPlannedDurationEditingInput('12'), true);
  assert.equal(schedule.plannedDurationInputAfterDateChange('2026-09-02', ''), '1');
  assert.equal(schedule.plannedDurationInputAfterDateChange('2026-09-03', '0.5'), '0.5');
  assert.equal(schedule.plannedDurationInputAfterDateChange('2026-09-03', '3'), '3');
  assert.equal(schedule.plannedDurationInputAfterDateChange('', ''), '');
  for (const invalid of ['0', '-1', '1.5', '2.5', '1e2', 'text', ' 1']) {
    assert.deepEqual(schedule.parsePlannedDurationInput(invalid), { ok: false }, `${invalid} must be rejected`);
  }

  const halfDay = schedule.buildPlannedTaskSchedule('2026-09-02', 0.5, 'UTC+8');
  assert.equal(halfDay.ok, true);
  assert.equal(halfDay.startInstant, '2026-09-01T16:00:00Z');
  assert.equal(halfDay.endInstant, '2026-09-02T04:00:00Z');
  assert.equal(halfDay.rangeLabel, '2026-09-02 00:00～12:00');

  const threeDays = schedule.buildPlannedTaskSchedule('2026-09-02', 3, 'UTC+8');
  assert.equal(threeDays.ok, true);
  assert.equal(threeDays.endInstant, '2026-09-04T16:00:00Z');
  assert.equal(threeDays.rangeLabel, '2026-09-02～2026-09-04');
  assert.deepEqual(schedule.buildPlannedTaskSchedule('', 1, 'UTC+8'), { ok: false, reason: 'missing-date' });
  assert.deepEqual(schedule.buildPlannedTaskSchedule('2026-09-31', 1, 'UTC+8'), { ok: false, reason: 'invalid-date' });
  assert.deepEqual(schedule.buildPlannedTaskSchedule('2026-09-02', 1.5, 'UTC+8'), { ok: false, reason: 'invalid-duration' });

  const vessel = { id: 'v1', vesselName: 'TEST VESSEL' };
  const unscheduled = { id: 't1', vesselId: 'v1', description: '先建立、暫不排程' };
  assert.deepEqual(schedule.projectTaskPlannedCalendarEvents([unscheduled], [vessel], 'UTC+8'), []);

  const scheduledLater = { ...unscheduled, plannedStartDate: '2026-09-02', plannedDurationDays: 1 };
  const projected = schedule.projectTaskPlannedCalendarEvents([scheduledLater], [vessel], 'UTC+8');
  assert.equal(projected.length, 1, 'editing an existing unscheduled task must create a calendar event');
  assert.equal(projected[0].eventId, 'task:t1:v1');
  assert.equal(projected[0].source, 'task');
  assert.equal(projected[0].startInstant, '2026-09-01T16:00:00Z');
  assert.equal(projected[0].endInstant, '2026-09-02T16:00:00Z');

  const clearedLater = { ...scheduledLater, plannedDurationDays: undefined };
  assert.deepEqual(schedule.projectTaskPlannedCalendarEvents([clearedLater], [vessel], 'UTC+8'), [], 'clearing either schedule field must remove the event');

  const multiVessel = { ...scheduledLater, vesselIds: ['v1', 'v2'] };
  const multiProjected = schedule.projectTaskPlannedCalendarEvents(
    [multiVessel],
    [vessel, { id: 'v2', vesselName: 'SECOND VESSEL' }, { id: 'v3', vesselName: 'NOT IN TASK' }],
    'UTC+8',
  );
  assert.deepEqual(multiProjected.map(event => event.eventId), ['task:t1:v1', 'task:t1:v2']);

  const rescheduled = schedule.projectTaskPlannedCalendarEvents(
    [{ ...scheduledLater, plannedStartDate: '2026-09-03' }],
    [vessel],
    'UTC+8',
  );
  assert.deepEqual(
    schedule.changedTaskPlannedCalendarEvents(projected, rescheduled).map(event => event.eventId),
    ['task:t1:v1'],
    'moving an existing task schedule must be reported as a changed projection',
  );
  assert.deepEqual(schedule.changedTaskPlannedCalendarEvents(rescheduled, rescheduled), [], 'unchanged projections must not notify');
  assert.deepEqual(schedule.changedTaskPlannedCalendarEvents(rescheduled, []), [], 'clearing a schedule removes an event without a new-schedule notice');

  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const raw = createInitialData();
  const baseTask = raw.tasks[0];
  raw.tasks = [
    { ...baseTask, id: 'valid-schedule', plannedStartDate: '2026-09-02', plannedDurationDays: 0.5 },
    { ...baseTask, id: 'legacy-no-schedule' },
    { ...baseTask, id: 'invalid-schedule', plannedStartDate: '2026-09-31', plannedDurationDays: 1.5 },
  ];
  const normalized = normalizeAppData(raw);
  assert.equal(normalized.tasks[0].plannedStartDate, '2026-09-02', 'valid planned start date must survive cloud normalization');
  assert.equal(normalized.tasks[0].plannedDurationDays, 0.5, 'valid duration must survive cloud normalization');
  assert.equal(normalized.tasks[1].plannedStartDate, undefined, 'legacy tasks remain valid without schedule fields');
  assert.equal(normalized.tasks[1].plannedDurationDays, undefined, 'legacy tasks remain valid without schedule fields');
  assert.equal(normalized.tasks[2].plannedStartDate, undefined, 'invalid historical date must be discarded');
  assert.equal(normalized.tasks[2].plannedDurationDays, undefined, 'invalid historical duration must be discarded');

  const editSource = fs.readFileSync('src/EditModals.tsx', 'utf8');
  const styles = fs.readFileSync('src/styles.css', 'utf8');
  const editModals = await server.ssrLoadModule('/src/EditModals.tsx');
  const owner = normalized.users.find(user => user.role === 'owner') || normalized.users[0];
  const editorHtml = renderToStaticMarkup(React.createElement(editModals.TaskEditModal, {
    task: normalized.tasks[0],
    data: normalized,
    visibleVessels: normalized.vessels,
    currentUser: owner,
    canClose: true,
    canDelete: true,
    canCancelInternalControl: true,
    canEditOverall: true,
    close: () => undefined,
    onSave: () => true,
    onSaveVesselProgress: () => true,
    onDelete: () => true,
  }));
  for (const label of ['期望完成日期/DL', '報告日期', '預計執行時間', '預計執行日期', '預計執行天數', '內部管控（台面下異常管控）', '標記為知曉事項', '近期需特別關注的異常（勾選後看板顯示「異常存在」）']) {
    assert.ok(editorHtml.includes(label), `task editor must render ${label}`);
  }
  assert.ok(editorHtml.indexOf('內部管控（台面下異常管控）') < editorHtml.indexOf('標記為知曉事項'));
  assert.ok(editorHtml.indexOf('標記為知曉事項') < editorHtml.indexOf('近期需特別關注的異常（勾選後看板顯示「異常存在」）'));
  assert.match(editorHtml, /aria-label="預計執行日期"[^>]*value="2026-09-02"/);
  assert.match(editorHtml, /aria-label="預計執行天數"[^>]*value="0.5"/);
  assert.match(editorHtml, /預計執行區間[\s\S]*2026-09-02 00:00～12:00/);
  assert.ok(!editorHtml.includes('<label>預計完成日期</label>'));
  assert.match(editSource, /plannedDurationInputAfterDateChange/);
  assert.match(editSource, /parsePlannedDurationInput/);
  assert.match(editSource, /請輸入 0\.5 或正整數的預計執行天數/);
  assert.match(styles, /\.task-planned-time-group\{/);
  assert.match(styles, /\.task-planned-time-fields\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:900px\)\{[\s\S]*\.task-planned-time-group[\s\S]*\.task-planned-time-fields\{grid-template-columns:1fr\}/);
  assert.match(styles, /@media\(max-width:600px\)\{\.edit-modal\{width:100%;max-width:100%;padding:12px\}/, 'mobile task editor must stay inside the padded viewport');
  assert.match(styles, /\.edit-modal \.modal-header\{[^}]*flex-direction:column[^}]*\}/, 'mobile task editor header must stack above its actions');
  assert.match(styles, /\.edit-modal \.heading-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'mobile task actions must wrap into a bounded two-column grid');

  const appSource = fs.readFileSync('src/App.tsx', 'utf8');
  const dashboardSource = fs.readFileSync('src/Dashboard.tsx', 'utf8');
  const itineraryDashboardSource = fs.readFileSync('src/itinerary/ItineraryDashboard.tsx', 'utf8');
  assert.match(appSource, /calendarTasks=\{data\.tasks\}/, 'calendar projection must receive complete saved tasks');
  assert.doesNotMatch(appSource, /calendarTasks=\{roleVisibleTasks\}/, 'calendar projection must not reuse ordinary-page task filtering');
  assert.match(dashboardSource, /calendarTasks[\s\S]*<ItineraryDashboard[\s\S]*vessels=\{visible\}\s+calendarTaskVessels=\{vessels\}\s+calendarTasks=\{calendarTasks\}/, 'visual lanes stay filtered while notification diffs use the stable authorized vessel denominator');
  assert.match(itineraryDashboardSource, /<ItineraryCalendar documents=\{selectedDocuments\} tasks=\{calendarTasks\}/);
  assert.match(itineraryDashboardSource, /projectTaskPlannedCalendarEvents\([\s\S]*calendarTasks,[\s\S]*calendarTaskVessels\.map/, 'notification event baselines must not be rebuilt from UI-filtered lanes');
  assert.match(itineraryDashboardSource, /changedTaskPlannedCalendarEvents/);
  assert.match(itineraryDashboardSource, /有新的預計執行要事，行事曆已同步更新。/);

  console.log('task_planned_schedule=PASS');
} finally {
  await server.close();
}

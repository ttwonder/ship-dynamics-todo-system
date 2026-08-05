import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const controls = await server.ssrLoadModule('/src/listVesselControls.ts');
  const selectorSource = await readFile(new URL('../src/VesselListFilter.tsx', import.meta.url), 'utf8');
  const workCenterSource = await readFile(new URL('../src/WorkCenter.tsx', import.meta.url), 'utf8');
  const internalControlSource = await readFile(new URL('../src/InternalControlPage.tsx', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const normalizedSource = await readFile(new URL('../src/NormalizedApp.tsx', import.meta.url), 'utf8');

  const user = { id: 'u1', role: 'operator', managedVesselIds: ['v-managed'] };
  const vessels = [
    { id: 'v-managed', isActive: true, assignedUserIds: [], delegateManagers: [] },
    { id: 'v-assigned', isActive: true, assignedUserIds: ['u1'], delegateManagers: [] },
    { id: 'v-delegated', isActive: true, assignedUserIds: [], delegateManagers: [{ userId: 'u1', isActive: true }] },
    { id: 'v-inactive-delegation', isActive: true, assignedUserIds: [], delegateManagers: [{ userId: 'u1', isActive: false }] },
    { id: 'v-inactive', isActive: false, assignedUserIds: ['u1'], delegateManagers: [] },
  ];
  const managedIds = controls.managedListVesselIds(user, vessels);
  assert.deepEqual(managedIds, ['v-managed', 'v-assigned', 'v-delegated'], '我的經管必須聯集正式經管、分管與有效代管，並排除停用船舶／停用代管');
  assert.deepEqual(
    controls.sanitizeListVesselIds(['v-delegated', 'missing', 'v-managed', 'v-delegated'], vessels),
    ['v-delegated', 'v-managed'],
    '自訂多選只能保留目前授權且有效的exact vessel IDs，並去重但不擴張',
  );

  assert.equal(controls.matchesListVesselSelection(['v-other'], { mode: 'all', vesselIds: [] }, managedIds, 'u1', []), true, '全部模式不得限制船舶');
  assert.equal(controls.matchesListVesselSelection(['v-other'], { mode: 'mine', vesselIds: [] }, managedIds, 'u1', ['u1']), true, '我的經管模式必須保留由本人負責的事項');
  assert.equal(controls.matchesListVesselSelection(['v-assigned'], { mode: 'mine', vesselIds: [] }, managedIds, 'u1', []), true, '我的經管模式必須保留經管船舶事項');
  assert.equal(controls.matchesListVesselSelection(['v-other'], { mode: 'mine', vesselIds: [] }, managedIds, 'u1', []), false, '我的經管模式不得納入無關船舶／事項');
  assert.equal(controls.matchesListVesselSelection(['v-delegated'], { mode: 'custom', vesselIds: ['v-delegated', 'v-managed'] }, managedIds, 'u1', []), true, '自訂多選採所選船舶聯集');
  assert.equal(controls.matchesListVesselSelection(['v-assigned'], { mode: 'custom', vesselIds: ['v-delegated', 'v-managed'] }, managedIds, 'u1', []), false, '自訂多選不得擴到未選船舶');
  assert.equal(controls.matchesListVesselSelection(['v-assigned'], { mode: 'custom', vesselIds: [] }, managedIds, 'u1', []), false, '自訂模式沒有選項時必須是零結果，不得悄悄變成全部');

  const records = [
    { id: 'b-empty', vessel: 'Bravo', date: '', closedDate: '', createdAt: '2026-08-05T03:00:00.000Z' },
    { id: 'a-late', vessel: 'Alpha', date: '2026-08-20', closedDate: '2026-08-22', createdAt: '2026-08-05T02:00:00.000Z' },
    { id: 'a-early', vessel: 'Alpha', date: '2026-08-10', closedDate: '2026-08-12', createdAt: '2026-08-05T01:00:00.000Z' },
  ];
  const sort = value => controls.sortListRecords(records, value, item => item.vessel, item => item.date, item => item.closedDate).map(item => item.id);
  assert.deepEqual(sort('vessel-asc').slice(0, 2).sort(), ['a-early', 'a-late'], '船舶正序必須把同船資料排在一起');
  assert.equal(sort('vessel-desc')[0], 'b-empty', '再次點擊船舶標題必須可反向排序');
  assert.deepEqual(sort('date-asc'), ['a-early', 'a-late', 'b-empty'], '日期近到遠且空日期最後');
  assert.deepEqual(sort('date-desc'), ['a-late', 'a-early', 'b-empty'], '日期遠到近仍須把空日期放最後');
  assert.deepEqual(sort('closed-date-asc'), ['a-early', 'a-late', 'b-empty'], '內控結案日期必須可排序且空值最後');
  assert.equal(controls.nextListColumnSort('vessel-asc', 'vessel'), 'vessel-desc');
  assert.equal(controls.nextListColumnSort('date-desc', 'vessel'), 'vessel-asc');
  assert.equal(controls.nextListColumnSort('date-asc', 'date'), 'date-desc');

  for (const label of ['選擇船舶', '全部', '只看我的經管船舶/事項', '指定船舶（可複選）']) {
    assert.ok(selectorSource.includes(label), `共用船舶選擇器缺少「${label}」`);
  }
  assert.ok(selectorSource.includes("mode: 'custom'") && selectorSource.includes('sanitizeListVesselIds'), '船名checkbox必須產生經授權清理的custom exact-ID集合');
  assert.ok(workCenterSource.includes('<VesselListFilter') && workCenterSource.includes('ariaLabel="我的待辦船舶篩選"'), '我的待辦必須使用共用多船選擇器');
  assert.ok(workCenterSource.includes('value="vessel-asc"') && workCenterSource.includes('value="vessel-desc"'), '我的待辦上方排序必須提供船舶正反向');
  assert.ok(!workCenterSource.includes("if(taskVesselMode==='custom'&&!next.length)setTaskVesselMode('all')"), '權限變更不可把空的自訂船舶範圍擴張為全部');
  assert.ok(appSource.includes('<VesselListFilter') && appSource.includes('ariaLabel="待辦清單船舶篩選"'), '待辦總表與已結案共用FilterBar必須使用共用多船選擇器');
  assert.ok(appSource.includes("onClick={()=>setColumnSort(nextListColumnSort(columnSort,'vessel'))}") && appSource.includes("onClick={()=>setColumnSort(nextListColumnSort(columnSort,'date'))}"), '待辦總表與已結案的船舶／期限標題必須可點擊排序');
  assert.ok(internalControlSource.includes('<VesselListFilter') && internalControlSource.includes('ariaLabel="內控清單船舶篩選"'), '內控未完與結案必須使用共用多船選擇器');
  assert.ok(internalControlSource.includes("nextListColumnSort(columnSort,'vessel')") && internalControlSource.includes("nextListColumnSort(columnSort,'date')") && internalControlSource.includes("nextListColumnSort(columnSort,'closed-date')"), '內控表格必須可依船舶、報告日期及結案日期正反排序');
  assert.ok(normalizedSource.includes("'歸一化已結案船舶篩選':'歸一化待辦清單船舶篩選'"), 'normalized待辦總表與已結案必須使用授權船舶共用選擇器');
  assert.ok(normalizedSource.includes("nextListColumnSort(columnSort,'vessel')") && normalizedSource.includes("nextListColumnSort(columnSort,'date')"), 'normalized待辦總表與已結案必須提供相同船舶／期限表頭排序');
  assert.ok(normalizedSource.includes('<td>{taskVesselLabel(task,vessels)}</td>') && !normalizedSource.includes("?.shortName || id).join('、')"), 'normalized清單列不得輸出不在授權集合內的船舶ID');
  assert.ok(workCenterSource.includes('sanitizeTaskSelection(previous,selectableTasks)') && internalControlSource.includes('sanitizeInternalControlSelection(previous,selectableCases)') && appSource.includes('sanitizeTaskSelection(previous,tasks)'), '篩選後已勾選項目只能依目前可執行動作的結果縮減，不得自動擴張');
  assert.equal((appSource.match(/<ListPanel title=/g) || []).length, 2, '共用ListPanel接線必須只覆蓋待辦總表與已結案兩頁');

  console.log('Five-list vessel multi-filter and header sorting contracts passed.');
} finally {
  await server.close();
}

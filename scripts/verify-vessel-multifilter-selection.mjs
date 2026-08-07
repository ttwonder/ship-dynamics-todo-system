import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const dashboardSource = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const morningSource = fs.readFileSync('src/MorningWorkspace.tsx', 'utf8');
const controlsSource = fs.readFileSync('src/VesselFilterControls.tsx', 'utf8');
const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });

try {
  const filters = await server.ssrLoadModule('/src/vesselDashboardFilters.ts');

  assert.deepEqual(
    filters.shipTypeFilterOptions([
      { shipType: '兩岸油化' },
      { shipType: '超油' },
      { shipType: '兩岸油化' },
      { shipType: '  ' },
      { shipType: '海峽散貨' },
    ]),
    ['兩岸油化', '超油', '海峽散貨'],
    '船型篩選必須直接來自實際 shipType、去重並保留資料順序',
  );

  assert.deepEqual(filters.toggleFilterValue([], '超油'), ['超油'], '第一次點擊船型必須選取');
  assert.deepEqual(filters.toggleFilterValue(['兩岸油化', '超油'], '超油'), ['兩岸油化'], '再次點擊已選船型必須取消');

  const activeFilters = {
    selfManagedOnly: true,
    shipTypes: ['兩岸油化', '超油'],
    attentionGroups: ['urgent-high', 'medium'],
    meetingOnly: true,
    supervisorIds: ['supervisor-a', 'supervisor-b'],
  };
  const matching = {
    id: 'vessel-a',
    selfManaged: true,
    shipType: '超油',
    attentionGroup: 'medium',
    selectedForMeeting: true,
    supervisorIds: ['supervisor-b'],
  };

  assert.equal(filters.matchesVesselFilterGroups(matching, activeFilters), true, '同組採聯集、跨組採交集的船舶必須符合');
  assert.equal(filters.matchesVesselFilterGroups({ ...matching, shipType: '成品油' }, activeFilters), false, '未符合任何已選船型時必須排除');
  assert.equal(filters.matchesVesselFilterGroups({ ...matching, attentionGroup: 'other' }, activeFilters), false, '未符合急高或中關注時必須排除');
  assert.equal(filters.matchesVesselFilterGroups({ ...matching, supervisorIds: ['supervisor-c'] }, activeFilters), false, '未由任何已選督導分管時必須排除');
  assert.equal(filters.matchesVesselFilterGroups({ ...matching, selectedForMeeting: false }, activeFilters), false, '要求進入會議時不得包含未選入船舶');
  assert.equal(filters.matchesVesselFilterGroups({ ...matching, selfManaged: false }, activeFilters), false, '要求自管船舶時不得包含非自管船舶');

  const matchedIds = filters.matchingVesselIds([
    matching,
    { ...matching, id: 'vessel-b', shipType: '兩岸油化', attentionGroup: 'urgent-high', supervisorIds: ['supervisor-a'] },
    { ...matching, id: 'vessel-c', shipType: '海峽散貨' },
  ], activeFilters);
  assert.deepEqual(matchedIds, ['vessel-a', 'vessel-b'], '早會自動勾選必須使用完整分組篩選結果');
  assert.equal(filters.hasActiveVesselFilters(filters.emptyVesselFilterState()), false, '全部篩選清除時必須回到未啟用狀態');

  const supervisorUsers = [
    { id: 'u1', name: 'Supervisor One', department: '督導', isActive: true, role: 'operator', managedVesselIds: ['v1'] },
    { id: 'u2', name: 'Supervisor Two', department: '督導', isActive: true, role: 'operator', managedVesselIds: [] },
    { id: 'u3', name: 'Assigned Non-Supervisor', department: '管理組', isActive: true, role: 'operator', managedVesselIds: ['v1'] },
    { id: 'u4', name: 'Active Delegate', department: '航運處', isActive: true, role: 'operator', managedVesselIds: [] },
    { id: 'u5', name: 'Inactive Delegate', department: '航運處', isActive: true, role: 'operator', managedVesselIds: [] },
    { id: 'u6', name: 'Disabled Manager', department: '航運處', isActive: false, role: 'operator', managedVesselIds: ['v1'] },
    { id: 'u7', name: 'Vessel Account', department: '船舶帳戶', isActive: true, role: 'vessel', managedVesselIds: ['v1'] },
  ];
  const supervisedVessels = [{ id: 'v1', assignedUserIds: ['u2', 'u3', 'u6', 'u7'], delegateManagers: [{ userId: 'u4', isActive: true }, { userId: 'u5', isActive: false }] }];
  assert.deepEqual(
    filters.effectiveVesselManagerNames(supervisedVessels[0], supervisorUsers),
    ['Supervisor One', 'Supervisor Two', 'Assigned Non-Supervisor', 'Active Delegate'],
    '船卡必須顯示所有有效直接經管與已激活代管人員，且排除未激活、停用與船舶帳號',
  );
  assert.deepEqual(filters.vesselSupervisorOptions(supervisedVessels, supervisorUsers).map(option => option.id), ['u1', 'u2'], '督導下拉不得混入其他部門的分管人員');
  assert.ok(controlsSource.includes('搜尋督導姓名'), '督導多選下拉必須支援姓名搜尋');

  assert.match(dashboardSource, /VesselFilterControls/, '船隊看板必須掛載共同多選篩選控制');
  assert.match(morningSource, /matchingVesselIds/, '早會點分類標籤後必須用共同邏輯自動勾選符合船舶');
  assert.match(morningSource, /VesselFilterControls/, '早會必須使用與船隊看板相同的分類控制');

  console.log('Vessel multi-filter and morning auto-selection contracts passed.');
} finally {
  await server.close();
}

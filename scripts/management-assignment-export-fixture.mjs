export function assignmentExportFixture(base) {
  const stamp = '2026-09-17T01:00:00Z';
  const user = (id, name, department, role = 'operator', managedVesselIds = [], isActive = true) => ({ id, name, department, role, managedVesselIds, isActive, username: `PRIVATE_LOGIN_${id}`, passwordHash: 'PRIVATE_HASH_NOT_FOR_EXPORT', createdAt: stamp, updatedAt: stamp });
  const users = [
    user('owner', '測試 Owner', '管理', 'owner', ['v1']),
    user('a', '測試督導甲', '船東督導', 'admin', ['v1']),
    user('b', '測試海技乙', '海技', 'operator', ['v2']),
    user('c', '測試代理丙', '船東督導'),
    user('d', '未激活代理丁', '海技'),
    user('e', '停用人員戊', '資材', 'operator', ['v1'], false),
    user('ship', '船舶帳戶', '船舶帳戶', 'vessel', ['v1']),
    user('f', '未分管人員己', '資材'),
    user('g', '未設定部門庚', '', 'operator', ['v2']),
  ];
  const vessel = (id, name, fullName, shipType, assignedUserIds, delegateManagers = [], isActive = true) => ({
    ...structuredClone(base.vessels[0]), id, name, shortName: id.toUpperCase(), fullName, shipType,
    fleetCategory: 'tanker fleet', assignedUserIds, delegateManagers, isActive, createdAt: stamp, updatedAt: stamp,
  });
  return {
    ...base, revision: 123, users,
    vessels: [
      vessel('v1', '測試甲輪', 'QA ALPHA', '油輪', ['a', 'a', 'e', 'ship', 'owner', 'missing'], [{ userId: 'c', isActive: true }, { userId: 'd', isActive: false }, { userId: 'a', isActive: true }]),
      vessel('v2', 'QA BETA', 'FPMC QA BETA', '化學船', [], []),
      vessel('v3', '純中文測試輪', '', '油輪', []),
      vessel('v4', '停用船', 'INACTIVE SHIP', '油輪', ['a'], [], false),
    ],
    tasks: [], meetings: [], agendaReports: [], internalControlCases: [], auditLogs: [],
    settings: { ...base.settings, departments: ['船東督導', '海技', '資材', '船舶帳戶'] },
  };
}

// Full-width matrix: all six office groups, two supervisors, and enabled delegates.
export function assignmentPrintFixture(base, extraCount = 50) {
  const data = assignmentExportFixture(base);
  Object.assign(data.vessels[0], { yearLabel: '2021.06', tonnageLabel: '2.0萬' });
  const groups = ['管理組', '資材組', '營業組', '航運處', '船員組', '海技組'];
  data.settings.departments = ['督導', ...groups];
  data.users.filter(user => user.department === '船東督導').forEach(user => { user.department = '督導'; });
  data.users.find(user => user.id === 'b').department = '海技組';
  data.users.find(user => user.id === 'g').department = '航運處';
  const added = [
    { id: 'supervisor-2', name: '林督乙', department: '督導' },
    ...groups.map((department, index) => ({ id: 'group-' + index, name: ['林管甲', '陳資乙', '王營丙', '李航丁', '黃員戊', '吳技己'][index], department })),
  ];
  data.users.push(...added.map(person => ({ ...data.users[2], ...person, managedVesselIds: [] })));
  data.vessels[0].assignedUserIds.push(...added.map(person => person.id));
  for (let n = 1; n <= extraCount; n++) data.vessels.push({
    ...structuredClone(data.vessels[0]), id: 'extra-' + n, name: '測試船' + String(n).padStart(2, '0'),
    shortName: 'QA ' + n, fullName: 'FPMC QA EXTRA ' + String(n).padStart(2, '0'),
    assignedUserIds: ['a', ...added.map(person => person.id)],
    delegateManagers: n % 5 === 0 ? [{ userId: 'c', isActive: true }] : [],
  });
  return data;
}

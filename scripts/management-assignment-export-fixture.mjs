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

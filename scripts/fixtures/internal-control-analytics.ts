import { createInitialData } from '../../src/data/seed';
import type { InternalControlCase } from '../../src/types';

// Deliberately synthetic; no remote data, account credentials or cloud calls.
export function createAnalyticsFixture() {
  const data = createInitialData();
  const at = '2026-01-01T00:00:00.000Z';
  const owner = { ...data.users[0], id: 'qa-analytics-owner', name: '測試管理員', username: 'qa-analytics', passwordHash: '', role: 'owner' as const, managedVesselIds: [], createdAt: at, updatedAt: at };
  const vessels = [
    ['qa-a', '測試甲輪', 'QA ALPHA', '散貨船'],
    ['qa-b', '測試乙輪', 'QA BETA', '油輪'],
    ['qa-c', '測試丙輪', 'QA GAMMA', '散貨船'],
  ].map(([id, name, fullName, shipType]) => ({ ...structuredClone(data.vessels[0]), id, name, shortName: id.toUpperCase(), fullName, shipType, assignedUserIds: [], delegateManagers: [], isActive: true }));
  const make = (id: string, vesselId: string, reportDate: string, patch: Partial<InternalControlCase>): InternalControlCase => ({
    id, vesselId, reportDate, reportSource: '日常', description: `測試案件 ${id}`, priority: '低', category: '設備故障', equipmentSubcategory: '动力与推进', isAware: false, status: '', departments: ['輪機'], syncToTask: false, origin: 'internal-control', isClosed: false, createdBy: owner.id, updatedBy: owner.id, createdAt: at, updatedAt: at, statusLogs: [], ...patch,
  });
  const cases = [
    make('ic-1', 'qa-a', '2026-01-02', { priority: '急', reportSource: '訪船', departments: ['輪機', '海務'], isClosed: true, closedDate: '2026-01-20' }),
    make('ic-2', 'qa-a', '2026-01-10', { priority: '高' }),
    make('ic-3', 'qa-b', '2026-01-11', { priority: '中', equipmentSubcategory: '救生、消防、应急及安全设备', departments: ['海務'], isClosed: true, closedDate: '2026-03-05' }),
    make('ic-4', 'qa-c', '2026-01-18', { category: '船舶管理', equipmentSubcategory: '', reportSource: '外部', departments: ['海務'], isClosed: true, closedDate: '2026-01-31' }),
    make('ic-5', 'qa-a', '2026-03-01', { priority: '高', isClosed: true, closedDate: '2026-05-01' }),
    make('ic-6', 'qa-b', '2026-03-14', { priority: '高', category: '物料備件', equipmentSubcategory: '', departments: ['資材'] }),
    make('ic-7', 'qa-b', '2026-03-30', { priority: '中', category: '船舶管理', equipmentSubcategory: '', departments: ['海務'] }),
    make('ic-8', 'qa-c', '2026-05-03', { priority: '高', reportSource: '隨船', equipmentSubcategory: '救生、消防、应急及安全设备', departments: ['輪機', '海務'], isAware: true }),
    make('ic-9', 'qa-a', '2026-05-04', { category: '船舶管理', equipmentSubcategory: '', reportSource: '外部', departments: ['海務'], isClosed: true, closedDate: '2026-05-08' }),
    make('ic-10', 'qa-b', '2026-05-15', { priority: '高', equipmentSubcategory: '', departments: [] }),
  ];
  Object.assign(data, { users: [owner], vessels, internalControlCases: cases, tasks: [], meetings: [], agendaReports: [], notifications: [], taskDismissals: [], auditLogs: [], revision: 1, updatedAt: at });
  data.settings.taskCategories = ['設備故障', '船舶管理', '物料備件'];
  data.settings.departments = ['輪機', '海務', '資材'];
  data.settings.equipmentFailureSubcategories = ['动力与推进', '救生、消防、应急及安全设备'];
  return { data, owner, vessels, cases };
}

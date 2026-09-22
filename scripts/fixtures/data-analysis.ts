import { createInitialData } from '../../src/data/seed';
import type { TaskItem } from '../../src/types';

// Synthetic component QA only: no remote data, credentials or cloud calls.
export function createDataAnalysisFixture() {
  const data = createInitialData();
  const at = '2026-01-01T00:00:00.000Z';
  data.users = [
    ['qa-a', '測試甲員', '機務'], ['qa-b', '測試乙員', '海務'], ['qa-c', '測試丙員', '海務'],
  ].map(([id, name, department]) => ({ ...data.users[0], id, name, department, username: id, passwordHash: '', role: 'operator' as const, isActive: true, managedVesselIds: [], createdAt: at, updatedAt: at }));
  data.vessels = [
    ['qa-v1', 'QA ALPHA', 'qa-a'], ['qa-v2', 'QA BETA', 'qa-b'], ['qa-hidden', 'QA HIDDEN', ''],
  ].map(([id, fullName, assignee]) => ({ ...structuredClone(data.vessels[0]), id, name: fullName, shortName: fullName, fullName, assignedUserIds: assignee ? [assignee] : [], delegateManagers: [], weeklyAttention: [], manualAttentionLevel: '' as const, isActive: true }));
  const make = (id: string, vesselId: string, date: string, patch: Partial<TaskItem> = {}): TaskItem => ({
    id, vesselId, vesselIds: [vesselId], priority: '低', category: '維修', categories: ['維修'], description: `測試事項 ${id}`, status: '待處理', expectedDate: '', reportDate: date.slice(0, 10), departments: [], ownerUserIds: [], isClosed: false, isAware: false, isAbnormal: false, isInternalControl: false, sourceType: 'morning', createdBy: 'qa-a', updatedBy: 'qa-a', createdAt: date, updatedAt: at, statusLogs: [], ...patch,
  });
  data.tasks = [
    make('a', 'qa-v1', '2026-01-02T00:00:00.000Z', { categories: ['維修', '事故', '維修'], priority: '急', isClosed: true, isAware: true, createdBy: 'qa-b' }),
    make('b', 'qa-v1', '2026-01-10T00:00:00.000Z', { priority: '高', isInternalControl: true, isAbnormal: true, expectedDate: '2000-01-01' }),
    make('c', 'qa-v2', '2026-03-01T00:00:00.000Z', { category: '事故', categories: ['事故'], createdBy: 'qa-b' }),
    make('d', 'qa-v1', '2026-03-14T00:00:00.000Z', { vesselIds: ['qa-v1', 'qa-v2'], sourceType: 'temporary', sourceMeetingId: 'qa-meeting', distributeToVessels: true, priority: '急', ownerUserIds: ['qa-c'], createdBy: 'qa-c', vesselProgress: [{ vesselId: 'qa-v1', status: '完成', isClosed: true, statusLogs: [] }, { vesselId: 'qa-v2', status: '處理中', isClosed: false, statusLogs: [] }] }),
    make('e', 'qa-v2', '2026-05-02T00:00:00.000Z', { sourceType: 'temporary', category: '船員管理', categories: ['船員管理'], priority: '高', isClosed: true, createdBy: 'qa-b' }),
    make('f', 'qa-v2', '2026-05-03T00:00:00.000Z', { category: '', categories: [], priority: '中', expectedDate: '2099-01-01' }),
    make('g', 'qa-v1', 'invalid-date'),
    make('hidden', 'qa-hidden', '2026-01-02T00:00:00.000Z', { isClosed: true }),
  ];
  Object.assign(data, { internalControlCases: [], meetings: [], agendaReports: [], notifications: [], taskDismissals: [], auditLogs: [], revision: 1, updatedAt: at });
  data.settings.departments = ['機務', '海務'];
  const vessels = data.vessels.filter(vessel => vessel.id !== 'qa-hidden');
  return { data, vessels };
}

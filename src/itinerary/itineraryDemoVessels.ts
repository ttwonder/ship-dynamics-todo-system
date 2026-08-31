import type { UserAccount, Vessel } from '../types';

const DEMO_NOW = '2026-08-31T08:00:00Z';

export const ITINERARY_DEMO_OWNER: UserAccount = {
  id: 'qa-owner', department: 'QA', name: 'Owner 測試員', username: 'qa-owner', role: 'owner', passwordHash: '', isActive: true,
  managedVesselIds: [], createdAt: DEMO_NOW, updatedAt: DEMO_NOW,
};

function demoVessel(id: string, name: string, lastPort: string, nextPort: string, index: number): Vessel {
  return {
    id, name, shortName: name, fullName: `測試 ${name}`, shipType: index % 2 ? '成品油' : '兩岸油化', fleetCategory: 'tanker fleet', fleetTags: ['QA'],
    assignedUserIds: [ITINERARY_DEMO_OWNER.id], delegateManagers: [], isActive: true,
    position: { source: 'manual', location: lastPort, speedKnots: 12, navigationStatus: '航行', lastPort, nextPort, eta: DEMO_NOW, etb: DEMO_NOW, etd: DEMO_NOW, updatedAt: DEMO_NOW, manualRemark: '去敏測試資料' },
    cargo: { source: 'manual', loadStatus: index % 2 ? '非空載' : '空載', name: 'TEST CARGO', quantity: `${5000 + index * 1000} MT`, items: [{ name: 'TEST CARGO', quantity: `${5000 + index * 1000} MT` }], updatedAt: DEMO_NOW },
    note: { statusList: [], statusSupplement: '本機 QA', captain: '測試船長', chiefOfficer: '測試大副', chiefEngineer: '測試輪機長', firstEngineer: '測試大管', recentDynamics: '測試資料', maintenanceOverview: '', subsequentDynamics: '', updatedAt: DEMO_NOW },
    weeklyAttention: [], createdAt: DEMO_NOW, updatedAt: DEMO_NOW,
  };
}

export const ITINERARY_DEMO_VESSELS: Vessel[] = [
  demoVessel('qa-v1', 'FPMC TEST ALPHA', 'KAOHSIUNG', 'ULSAN', 0),
  demoVessel('qa-v2', 'FPMC TEST BRAVO', 'YOKOHAMA', 'SINGAPORE', 1),
  demoVessel('qa-v3', 'FPMC TEST CHARLIE', 'MAILIAO', 'ROTTERDAM', 2),
];

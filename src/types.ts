export type UserRole = 'owner' | 'admin' | 'operator';
export type TaskPriority = '高' | '中' | '低';
export type ShipStatus = '裝載' | '空載' | '去卸貨' | '去裝貨' | '等待order';

export interface UserAccount {
  id: string;
  department: string;
  name: string;
  username: string;
  role: UserRole;
  passwordHash: string;
  isActive: boolean;
  managedVesselIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VesselPosition {
  source: 'mock-smart-ship-api' | 'manual' | 'smart-ship-api';
  location: string;
  speedKnots: number;
  lastPort: string;
  nextPort: string;
  eta: string;
  updatedAt: string;
  manualRemark: string;
}

export interface VesselCargo {
  name: string;
  quantity: string;
  updatedAt: string;
}

export interface VesselNote {
  statusList: ShipStatus[];
  recentDynamics: string;
  subsequentDynamics: string;
  updatedAt: string;
}

export interface Vessel {
  id: string;
  name: string;
  shortName: string;
  fullName: string;
  shipType: string;
  fleetCategory: 'tanker fleet' | 'bulk fleet' | string;
  fleetTags: string[];
  assignedUserIds: string[];
  isActive: boolean;
  position: VesselPosition;
  cargo: VesselCargo;
  note: VesselNote;
  createdAt: string;
  updatedAt: string;
}

export interface StatusLog {
  id: string;
  at: string;
  by: string;
  text: string;
}

export interface TaskItem {
  id: string;
  vesselId: string;
  priority: TaskPriority;
  isAware: boolean;
  category: string;
  description: string;
  status: string;
  expectedDate: string;
  departments: string[];
  ownerUserIds: string[];
  isClosed: boolean;
  closedDate?: string;
  closedBy?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  statusLogs: StatusLog[];
}

export interface TemporaryMeeting {
  id: string;
  subject: string;
  meetingDate: string;
  vessels: string[];
  reason: string;
  departments: string[];
  resolution: string;
  expectedDate: string;
  priority: TaskPriority;
  createdBy: string;
  createdAt: string;
}

export interface AgendaReport {
  id: string;
  title: string;
  vesselIds: string[];
  createdBy: string;
  createdAt: string;
  taskCount: number;
}

export interface AuditLog {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole | 'system';
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
}

export interface AppSettings {
  sitePasswordHash: string;
  systemTitle: string;
  departments: string[];
  taskCategories: string[];
  vesselStatuses: ShipStatus[];
  priorities: TaskPriority[];
  lastCloudSyncAt: string;
}

export interface AppData {
  revision: number;
  settings: AppSettings;
  users: UserAccount[];
  vessels: Vessel[];
  tasks: TaskItem[];
  meetings: TemporaryMeeting[];
  agendaReports: AgendaReport[];
  auditLogs: AuditLog[];
  updatedAt: string;
}

export interface FilterState {
  keyword: string;
  departments: string[];
  vesselIds: string[];
  fleetTags: string[];
  priorities: TaskPriority[];
  categories: string[];
  ownerMode: 'all' | 'mine';
  fromDate: string;
  toDate: string;
  closedMode: 'all' | 'open' | 'closed';
}

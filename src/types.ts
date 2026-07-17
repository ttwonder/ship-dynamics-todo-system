export type UserRole = 'owner' | 'admin' | 'operator' | 'vessel';
export type PermissionKey = 'viewAllVessels' | 'editBusinessContent' | 'createTasks' | 'closeTasks' | 'deleteTasks' | 'manageMeetings' | 'exportReports' | 'enterManagement' | 'manageUsers' | 'manageVessels' | 'viewAuditLogs' | 'manageRolePermissions' | 'manageSystemSettings';
export type RolePermissions = Record<UserRole, Record<PermissionKey, boolean>>;
export type TaskPriority = '急' | '高' | '中' | '低';
export type ShipStatus = '裝載' | '空載' | '去卸貨' | '去裝貨' | '等待order';
export type NavigationStatus = '航行' | '拋錨' | '停泊';
export type LoadStatus = '空載' | '非空載' | '滿載';
export type ScheduleKind = 'ETA' | 'ETB' | 'ETD';
export type WeeklyAttentionKey = 'crew-operation' | 'bunkering-water' | 'materials-parts' | 'maintenance' | 'survey' | 'audit-inspection' | 'psc-window';
export type TemporaryMeetingStatus = '待開會' | '進行中' | '追蹤中' | '已完成';
export type MeetingVesselScopeMode = 'all' | 'types' | 'vessels';

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
  navigationStatus: NavigationStatus;
  lastPort: string;
  nextPort: string;
  eta: string;
  etb: string;
  etd: string;
  updatedAt: string;
  manualRemark: string;
}

export interface VesselCargoItem {
  name: string;
  quantity: string;
}

export interface VesselCargo {
  source: 'mock-smart-ship-api' | 'manual' | 'smart-ship-api';
  loadStatus: LoadStatus;
  name: string;
  quantity: string;
  items: VesselCargoItem[];
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
  weeklyAttention: WeeklyAttentionKey[];
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
  isAbnormal: boolean;
  isInternalControl: boolean;
  internalControlCancelledAt?: string;
  internalControlCancelledBy?: string;
  category: string;
  description: string;
  status: string;
  expectedDate: string;
  departments: string[];
  ownerUserIds: string[];
  isClosed: boolean;
  closedDate?: string;
  closedBy?: string;
  sourceMeetingId?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  statusLogs: StatusLog[];
}

export type NotificationKind = 'task_created' | 'task_updated' | 'internal_control_cancelled' | 'task_deleted';
export interface UserNotification {
  id: string;
  userId: string;
  vesselId: string;
  taskId: string;
  kind: NotificationKind;
  title: string;
  message: string;
  actorId: string;
  createdAt: string;
  readAt?: string;
}

export interface TemporaryMeeting {
  id: string;
  subject: string;
  status?: TemporaryMeetingStatus;
  meetingDate: string;
  vesselScopeMode?: MeetingVesselScopeMode;
  vesselTypeScopes?: string[];
  vessels: string[];
  reason: string;
  departments: string[];
  resolution: string;
  expectedDate: string;
  priority: TaskPriority;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
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
  rolePermissions: RolePermissions;
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
  notifications: UserNotification[];
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
  overdueOnly: boolean;
  internalControlOnly: boolean;
}

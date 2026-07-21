export type UserRole = 'owner' | 'admin' | 'operator' | 'vessel';
export type PermissionKey = 'viewAllVessels' | 'editBusinessContent' | 'createTasks' | 'closeTasks' | 'deleteTasks' | 'manageMeetings' | 'exportReports' | 'enterManagement' | 'manageUsers' | 'manageVessels' | 'viewAuditLogs' | 'manageRolePermissions' | 'manageSystemSettings';
export type RolePermissions = Record<UserRole, Record<PermissionKey, boolean>>;
export type TaskPriority = '急' | '高' | '中' | '低';
export type TaskAttentionDimension = 'task' | 'meeting';
export type VesselAttentionLevel = TaskPriority | '特別關注';
export type ShipStatus = 'loading' | 'unloading' | 'to load' | 'to unload' | 'waiting order' | 'drydock/repiar';
export type NavigationStatus = '航行' | '拋錨' | '停泊';
export type LoadStatus = '空載' | '非空載' | '滿載';
export type ScheduleKind = 'ETA' | 'ETB' | 'ETD';
export type TaskSource = 'morning' | 'temporary';
export type WeeklyAttentionKey = 'crew-operation' | 'bunkering-water' | 'materials-parts' | 'maintenance' | 'survey' | 'audit-inspection' | 'psc-window';
export type TemporaryMeetingStatus = '待召開' | '追蹤中' | '已完成';
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
  manualAttentionLevel?: VesselAttentionLevel | '';
  createdAt: string;
  updatedAt: string;
}

export interface StatusLog {
  id: string;
  at: string;
  by: string;
  byUserId?: string;
  text: string;
}

export interface TaskVesselProgress {
  vesselId: string;
  status: string;
  isClosed: boolean;
  closedDate?: string;
  closedBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  statusLogs: StatusLog[];
}

export interface TaskItem {
  id: string;
  vesselId: string;
  vesselIds?: string[];
  vesselScopeMode?: MeetingVesselScopeMode;
  vesselTypeScopes?: string[];
  priority: TaskPriority;
  attentionDimension?: TaskAttentionDimension;
  isAware: boolean;
  isAbnormal: boolean;
  isInternalControl: boolean;
  internalControlCancelledAt?: string;
  internalControlCancelledBy?: string;
  category: string;
  categories: string[];
  description: string;
  status: string;
  expectedDate: string;
  reportDate: string;
  departments: string[];
  ownerUserIds: string[];
  isClosed: boolean;
  closedDate?: string;
  closedBy?: string;
  sourceMeetingId?: string;
  sourceMeetingItemId?: string;
  distributeToVessels?: boolean;
  sourceType: TaskSource;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  statusLogs: StatusLog[];
  vesselProgress?: TaskVesselProgress[];
}

export type NotificationKind = 'task_created' | 'task_updated' | 'task_archived' | 'internal_control_cancelled' | 'task_deleted';
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

export interface MeetingTaskItem {
  id: string;
  description: string;
  categories: string[];
  distributeToVessels?: boolean;
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
  participantUserIds: string[];
  trackingUserIds: string[];
  responsibleUserIds: string[];
  resolution: string;
  taskDescription: string;
  taskItems: MeetingTaskItem[];
  expectedDate: string;
  completedDate?: string;
  completedBy?: string;
  priority: TaskPriority;
  includeInMorning?: boolean;
  latestStatus?: string;
  statusLogs?: StatusLog[];
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
  taskCategorySchemaVersion: number;
  meetingTaskCategories: string[];
  meetingTaskCategorySchemaVersion: number;
  vesselStatuses: ShipStatus[];
  priorities: TaskPriority[];
  rolePermissions: RolePermissions;
  nonOwnerPasswordResetVersion?: number;
  meetingTaskAggregationVersion?: number;
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
  meetingCategories: string[];
  ownerMode: 'all' | 'mine';
  fromDate: string;
  toDate: string;
  closedMode: 'all' | 'open' | 'closed';
  overdueOnly: boolean;
  internalControlOnly: boolean;
}

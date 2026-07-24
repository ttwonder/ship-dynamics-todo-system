import type { AppData, AppSettings, StatusLog, TaskItem, TaskPriority, Vessel } from './types';

export type TaskReadOnlyEditorSettings = Pick<AppSettings,
  'priorities' | 'departments' | 'taskCategories' | 'meetingTaskCategories' | 'equipmentFailureSubcategories' | 'rolePermissions'
>;
export type TaskReadOnlyVessel = Pick<Vessel, 'id' | 'name' | 'shortName' | 'fullName' | 'shipType'>;
export type TaskReadOnlyEditorData = {
  revision: number;
  settings: TaskReadOnlyEditorSettings;
  users: [];
  vessels: TaskReadOnlyVessel[];
  tasks: [TaskItem];
};

const cleanStrings = (values: unknown): string[] => Array.from(new Set(
  (Array.isArray(values) ? values : []).filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean),
));
const cleanLogs = (logs: StatusLog[] | undefined): StatusLog[] => (logs || []).map(log => ({
  id: String(log.id || ''), at: String(log.at || ''), by: String(log.by || ''), text: String(log.text || ''),
}));

/**
 * Fail-closed task DTO for the read-only editor. It always represents exactly one
 * authorized vessel, so aggregate counts, hidden vessel IDs and source lineage can
 * never be inferred by the modal.
 */
export function projectTaskForVisibleVessels(task: TaskItem, visibleTaskVesselIds: string[]): TaskItem {
  const ids = cleanStrings(visibleTaskVesselIds);
  if (!ids.length) throw new Error('待辦沒有可見船舶範圍');
  if (ids.length !== 1) throw new Error('只讀投影僅允許單一可見船舶');
  const vesselId = ids[0];
  const perVesselProgress = (task.vesselProgress || []).find(item => item.vesselId === vesselId);
  if ((task.distributeToVessels || (task.vesselProgress?.length || 0) > 0) && !perVesselProgress) {
    throw new Error('單船進度不存在，已拒絕建立只讀投影');
  }
  const status = perVesselProgress?.status ?? task.status;
  const isClosed = perVesselProgress?.isClosed ?? task.isClosed;
  const projected: TaskItem = {
    id: String(task.id),
    vesselId,
    priority: task.priority,
    attentionDimension: 'task',
    isAware: Boolean(task.isAware),
    isAbnormal: Boolean(task.isAbnormal),
    isInternalControl: false,
    category: String(task.category || ''),
    categories: cleanStrings(task.categories?.length ? task.categories : [task.category]),
    ...(task.equipmentSubcategory ? { equipmentSubcategory: String(task.equipmentSubcategory) } : {}),
    description: String(task.description || ''),
    status: String(status || ''),
    expectedDate: String(task.expectedDate || ''),
    reportDate: String(task.reportDate || ''),
    departments: cleanStrings(task.departments),
    ownerUserIds: [],
    isClosed: Boolean(isClosed),
    ...(perVesselProgress?.closedDate || (!perVesselProgress && task.closedDate)
      ? { closedDate: String(perVesselProgress?.closedDate || task.closedDate) }
      : {}),
    sourceType: 'morning',
    createdBy: '',
    updatedBy: '',
    createdAt: String(task.createdAt || ''),
    updatedAt: String(perVesselProgress?.updatedAt || task.updatedAt || ''),
    statusLogs: cleanLogs(perVesselProgress?.statusLogs ?? task.statusLogs),
  };
  return projected;
}

/** Build the complete, minimal data contract accepted by TaskEditModal in read-only mode. */
export function buildTaskReadOnlyEditorData(source: AppData, task: TaskItem, visibleVesselId: string): TaskReadOnlyEditorData {
  const vessel = source.vessels.find(item => item.id === visibleVesselId && item.isActive);
  if (!vessel) throw new Error('只讀投影的可見船舶不存在');
  const projectedTask = projectTaskForVisibleVessels(task, [visibleVesselId]);
  const categories = cleanStrings(projectedTask.categories?.length ? projectedTask.categories : [projectedTask.category]);
  const equipmentFailureSubcategories = projectedTask.equipmentSubcategory ? [projectedTask.equipmentSubcategory] : [];
  return {
    revision: source.revision,
    settings: {
      priorities: [projectedTask.priority].filter(Boolean) as TaskPriority[],
      departments: cleanStrings(projectedTask.departments),
      taskCategories: categories,
      meetingTaskCategories: [],
      equipmentFailureSubcategories,
      rolePermissions: {} as AppSettings['rolePermissions'],
    },
    users: [],
    vessels: [{
      id: vessel.id,
      name: String(vessel.name || ''),
      shortName: String(vessel.shortName || ''),
      fullName: String(vessel.fullName || ''),
      shipType: String(vessel.shipType || ''),
    }],
    tasks: [projectedTask],
  };
}

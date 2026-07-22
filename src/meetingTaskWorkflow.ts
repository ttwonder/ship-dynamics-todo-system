import type { MeetingTaskItem, MeetingVesselScopeMode, NotificationKind, TaskItem, TaskPriority, TemporaryMeeting } from './types';
import { uid } from './utils';
import { reconcileTaskVesselScope, taskIsClosedForScope } from './taskVesselProgress';
import { normalizeMeetingTaskCategoryList } from './taskCategories';
import { canonicalizeMeetingTaskItemIds } from './meetingTaskItemIds';

interface ReconcileMeetingTasksInput {
  tasks: TaskItem[];
  meetingId: string;
  vesselIds: string[];
  vesselScopeMode?: MeetingVesselScopeMode;
  vesselTypeScopes?: string[];
  followUp?: string;
  followUps?: MeetingTaskItem[];
  priority: TaskPriority;
  isAbnormal?: boolean;
  isInternalControl?: boolean;
  expectedDate: string;
  departments: string[];
  ownerUserIds?: string[];
  meetingTaskCategories?: string[];
  initialStatus: string;
  actorId: string;
  actorName: string;
  at: string;
  preserveExistingDescriptions?: boolean;
  preserveExistingDescriptionItemIds?: string[];
  previousMeetingItems?: MeetingTaskItem[];
  internalControlCancellation?: { authorized: boolean; at: string; by: string };
  createTaskId?: () => string;
}

export interface ReconcileMeetingTasksResult {
  created: TaskItem[];
  updatedIds: string[];
  archivedIds: string[];
  internalControlCancelledIds: string[];
}

export function resolveMeetingTaskItemIdForDeletion(
  task: Pick<TaskItem, 'sourceMeetingItemId' | 'description'>,
  meeting: Pick<TemporaryMeeting, 'taskItems'>,
): string | null | undefined {
  if (!meeting.taskItems.length) return undefined;
  if (task.sourceMeetingItemId && meeting.taskItems.some(item => item.id === task.sourceMeetingItemId)) return task.sourceMeetingItemId;
  const matches=meeting.taskItems.filter(item=>item.description.trim()===task.description.trim());
  return matches.length===1?matches[0].id:null;
}

export type MeetingTaskNotificationKind = Extract<NotificationKind, 'task_created' | 'task_updated' | 'task_archived' | 'internal_control_cancelled'>;
export interface MeetingTaskNotificationEvent {
  task: TaskItem;
  kind: MeetingTaskNotificationKind;
}

type MeetingWithTaskItems = { id: string; taskDescription?: unknown; taskItems?: unknown };

type MeetingTaskMutationSource = Pick<TaskItem,
  'sourceType' | 'attentionDimension' | 'sourceMeetingId' | 'sourceMeetingItemId' |
  'vesselId' | 'vesselIds' | 'vesselScopeMode' | 'vesselTypeScopes' | 'distributeToVessels' | 'isInternalControl'
>;

export function meetingTaskLinkIsValidForMutation(
  task: MeetingTaskMutationSource,
  meetings: Pick<TemporaryMeeting, 'id' | 'vessels' | 'vesselScopeMode' | 'vesselTypeScopes' | 'isInternalControl' | 'taskItems'>[],
): boolean {
  const hasMeetingSemantics = task.sourceType === 'temporary'
    || task.attentionDimension === 'meeting'
    || Boolean(task.sourceMeetingId)
    || Boolean(task.sourceMeetingItemId);
  if (!hasMeetingSemantics) return true;
  if (task.sourceType !== 'temporary' || task.attentionDimension !== 'meeting' || !task.sourceMeetingId || !task.sourceMeetingItemId) return false;
  const meeting = meetings.find(item => item.id === task.sourceMeetingId);
  const meetingItem = meeting?.taskItems.find(item => item.id === task.sourceMeetingItemId);
  if (!meeting || !meetingItem) return false;
  const taskVesselIds = Array.from(new Set((task.vesselIds?.length ? task.vesselIds : [task.vesselId]).filter(Boolean)));
  const meetingVesselIds = new Set(meeting.vessels.filter(Boolean));
  const taskScopeMode=task.vesselScopeMode||'vessels';
  const meetingScopeMode=meeting.vesselScopeMode||'vessels';
  const taskTypeScopes=taskScopeMode==='types'?Array.from(new Set((task.vesselTypeScopes||[]).filter(Boolean))).sort():[];
  const meetingTypeScopes=meetingScopeMode==='types'?Array.from(new Set((meeting.vesselTypeScopes||[]).filter(Boolean))).sort():[];
  return taskVesselIds.length === meetingVesselIds.size
    && taskVesselIds.every(vesselId => meetingVesselIds.has(vesselId))
    && taskScopeMode===meetingScopeMode
    && JSON.stringify(taskTypeScopes)===JSON.stringify(meetingTypeScopes)
    && task.isInternalControl === meeting.isInternalControl
    && task.distributeToVessels === (meetingItem.distributeToVessels === true);
}

export const canonicalMeetingTaskItems = (items: MeetingTaskItem[], meetingId: string, meetingTaskCategories?: string[]): MeetingTaskItem[] =>
  canonicalizeMeetingTaskItemIds(items.map((item,index)=>({
    id:item.id||`${meetingId}-task-${index + 1}`,
    description:item.description.trim(),
    categories:normalizeMeetingTaskCategoryList(item.categories,meetingTaskCategories),
    distributeToVessels:item.distributeToVessels===true,
  })),`${meetingId}-task`).filter(item=>item.id&&item.description);

export const meetingTaskItems = (
  meeting: MeetingWithTaskItems,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description' | 'categories' | 'distributeToVessels'>[] = [],
  meetingTaskCategories?: string[],
): MeetingTaskItem[] => {
  if (Object.prototype.hasOwnProperty.call(meeting, 'taskItems')) {
    if (!Array.isArray(meeting.taskItems)) return [];
    return canonicalMeetingTaskItems(meeting.taskItems.flatMap((value, index) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as { id?: unknown; description?: unknown; categories?: unknown; distributeToVessels?: unknown };
      const id = typeof item.id === 'string' && item.id ? item.id : `${meeting.id}-task-${index + 1}`;
      return [{ id, description: typeof item.description === 'string' ? item.description : '', categories: normalizeMeetingTaskCategoryList(item.categories, meetingTaskCategories), distributeToVessels: item.distributeToVessels === true }];
    }), meeting.id, meetingTaskCategories);
  }
  const hasSavedDescription = Object.prototype.hasOwnProperty.call(meeting, 'taskDescription');
  const savedDescription = typeof meeting.taskDescription === 'string' ? meeting.taskDescription : '';
  if (hasSavedDescription) return savedDescription.trim() ? [{ id: `${meeting.id}-task-1`, description: savedDescription, categories: normalizeMeetingTaskCategoryList([], meetingTaskCategories), distributeToVessels: false }] : [];
  const linkedTask = tasks.find(task => task.sourceMeetingId === meeting.id && task.description.trim());
  return linkedTask ? [{ id: linkedTask.sourceMeetingItemId || `${meeting.id}-task-1`, description: linkedTask.description, categories: normalizeMeetingTaskCategoryList(linkedTask.categories, meetingTaskCategories), distributeToVessels: linkedTask.distributeToVessels === true }] : [];
};

export const meetingTaskDescription = (
  meeting: MeetingWithTaskItems,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description' | 'categories' | 'distributeToVessels'>[] = [],
): string => meetingTaskItems(meeting, tasks)[0]?.description || '';

export const unchangedMeetingTaskItemIds = (
  meeting: MeetingWithTaskItems | null | undefined,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description' | 'categories' | 'distributeToVessels'>[],
  nextItems: MeetingTaskItem[],
): string[] => {
  if (!meeting) return [];
  const previous = new Map(meetingTaskItems(meeting, tasks).map(item => [item.id, item.description]));
  return nextItems.filter(item => previous.get(item.id) === item.description).map(item => item.id);
};

export const shouldPreserveMeetingTaskDescriptions = (
  meeting: MeetingWithTaskItems | null | undefined,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description' | 'categories' | 'distributeToVessels'>[],
  nextDescription: string,
): boolean => {
  if (!meeting) return false;
  return nextDescription === meetingTaskDescription(meeting, tasks);
};

const archiveLinkedTask = (
  task: TaskItem,
  reason: string,
  actorId: string,
  actorName: string,
  at: string,
) => {
  const scopeIds=Array.from(new Set((task.vesselIds?.length?task.vesselIds:[task.vesselId]).filter(Boolean)));
  const wasClosed = taskIsClosedForScope(task,scopeIds);
  const logText = wasClosed ? `解除會議關聯：${reason}` : reason;
  task.isClosed = true;
  task.closedDate = task.closedDate || at.slice(0, 10);
  task.closedBy = task.closedBy || actorId;
  if (!wasClosed) task.status = reason;
  task.updatedBy = actorId;
  task.updatedAt = at;
  delete task.sourceMeetingId;
  delete task.sourceMeetingItemId;
  task.statusLogs.unshift({ id: uid('log'), at, by: actorName, byUserId: actorId, text: logText });
  return !wasClosed;
};

export interface MeetingTaskInternalControlTransitionInput {
  tasks: TaskItem[];
  meetingId: string;
  nextVesselIds: string[];
  nextItemIds: string[];
  nextItems?: Array<Pick<MeetingTaskItem, 'id' | 'description'>>;
  previousItems?: Array<Pick<MeetingTaskItem, 'id' | 'description'>>;
  nextIsInternalControl: boolean;
}

const meetingTaskVesselIds = (task: Pick<TaskItem, 'vesselId' | 'vesselIds'>) =>
  Array.from(new Set((task.vesselIds?.length ? task.vesselIds : [task.vesselId]).filter(Boolean)));

const meetingTaskIsClosed = (task: TaskItem) => taskIsClosedForScope(task, meetingTaskVesselIds(task));
const resolvedMeetingTaskItemId = (task: TaskItem, nextItems: Array<Pick<MeetingTaskItem, 'id' | 'description'>>, _fallbackId: string, previousItems: Array<Pick<MeetingTaskItem, 'id' | 'description'>> = []) => {
  if (task.sourceMeetingItemId && nextItems.some(item=>item.id===task.sourceMeetingItemId)) return task.sourceMeetingItemId;
  if (task.sourceMeetingItemId && previousItems.some(item=>item.id===task.sourceMeetingItemId)) return `__removed__:${task.id}`;
  const matches=nextItems.filter(item=>item.description.trim()===task.description.trim());
  if(matches.length===1)return matches[0].id;
  return `__unresolved__:${task.id}`;
};

interface MeetingTaskLinkResolutionConflictInput {
  tasks: TaskItem[];
  meetingId: string;
  nextItems: MeetingTaskItem[];
  previousItems: MeetingTaskItem[];
}

export function meetingTaskLinkResolutionConflict({tasks,meetingId,nextItems,previousItems}:MeetingTaskLinkResolutionConflictInput):boolean {
  const nextIds=new Set(nextItems.map(item=>item.id));
  const previousIds=new Set(previousItems.map(item=>item.id));
  return tasks.filter(task=>task.sourceMeetingId===meetingId).some(task=>{
    if(task.sourceMeetingItemId&&nextIds.has(task.sourceMeetingItemId)) return false;
    if(task.sourceMeetingItemId&&previousIds.has(task.sourceMeetingItemId)) return false;
    const matches=nextItems.filter(item=>item.description.trim()===task.description.trim());
    if(matches.length===1) return false;
    return true;
  });
}

interface MeetingTaskClosedLinkConflictInput {
  tasks: TaskItem[];
  meetingId: string;
  nextVesselIds: string[];
  nextItems: MeetingTaskItem[];
  previousItems?: MeetingTaskItem[];
  nextVesselScopeMode?: MeetingVesselScopeMode;
  nextVesselTypeScopes?: string[];
  nextIsInternalControl?: boolean;
}

export function meetingTaskClosedLinkConflict({
  tasks,
  meetingId,
  nextVesselIds,
  nextItems,
  previousItems = [],
  nextVesselScopeMode = 'vessels',
  nextVesselTypeScopes = [],
  nextIsInternalControl = false,
}: MeetingTaskClosedLinkConflictInput): boolean {
  const targetItemById = new Map(nextItems.map(item => [item.id, item]));
  const fallbackId = nextItems[0]?.id || `${meetingId}-task-1`;
  const groups = new Map<string, TaskItem[]>();
  tasks.filter(task => task.sourceMeetingId === meetingId).forEach(task => {
    const itemId = resolvedMeetingTaskItemId(task, nextItems, fallbackId, previousItems);
    groups.set(itemId, [...(groups.get(itemId) || []), task]);
  });
  const targetIds = Array.from(new Set(nextVesselIds.filter(Boolean)));
  const targetIdSet = new Set(targetIds);
  const targetTypeScopes = nextVesselScopeMode === 'types' ? Array.from(new Set(nextVesselTypeScopes.filter(Boolean))).sort() : [];

  return [...groups.entries()].some(([itemId, group]) => {
    const targetItem = targetItemById.get(itemId);
    if (!targetItem) return false;
    const canonical = [...group].sort((left, right) =>
      Number(meetingTaskIsClosed(left)) - Number(meetingTaskIsClosed(right))
      || (Date.parse(right.updatedAt || right.createdAt || '') || 0) - (Date.parse(left.updatedAt || left.createdAt || '') || 0)
      || left.id.localeCompare(right.id)
    )[0];
    if (!canonical || !meetingTaskIsClosed(canonical)) return false;
    const historicalIds = meetingTaskVesselIds(canonical);
    const safelyExpandsScope = historicalIds.every(id => targetIdSet.has(id)) && targetIds.some(id => !historicalIds.includes(id));
    const projectedIds = safelyExpandsScope ? targetIds : historicalIds;
    const projectedScopeMode = safelyExpandsScope ? nextVesselScopeMode : (canonical.vesselScopeMode || 'vessels');
    const projectedTypeScopes = projectedScopeMode === 'types'
      ? Array.from(new Set((safelyExpandsScope ? targetTypeScopes : canonical.vesselTypeScopes || []).filter(Boolean))).sort()
      : [];
    const projectedDistribution = safelyExpandsScope ? targetItem.distributeToVessels === true : canonical.distributeToVessels === true;
    return projectedIds.length !== targetIdSet.size
      || projectedIds.some(id => !targetIdSet.has(id))
      || projectedScopeMode !== nextVesselScopeMode
      || JSON.stringify(projectedTypeScopes) !== JSON.stringify(targetTypeScopes)
      || projectedDistribution !== (targetItem.distributeToVessels === true)
      || canonical.isInternalControl !== nextIsInternalControl;
  });
}

export function meetingTaskInternalControlTransitionRequired({
  tasks, meetingId, nextVesselIds, nextItemIds, nextItems = [], previousItems = [], nextIsInternalControl,
}: MeetingTaskInternalControlTransitionInput): boolean {
  const targetVesselIds = new Set(nextVesselIds.filter(Boolean));
  const targetItemIds = new Set(nextItemIds.filter(Boolean));
  const legacyItemId = nextItemIds[0] || `${meetingId}-task-1`;
  const linkedTasks = tasks.filter(task => task.sourceMeetingId === meetingId);
  const activeInternalTasks = linkedTasks.filter(task => task.isInternalControl && !meetingTaskIsClosed(task));
  if (activeInternalTasks.some(task => {
    const itemId = resolvedMeetingTaskItemId(task,nextItems,legacyItemId,previousItems);
    return !nextIsInternalControl
      || !targetVesselIds.size
      || !targetItemIds.has(itemId)
      || meetingTaskVesselIds(task).some(vesselId => !targetVesselIds.has(vesselId));
  })) return true;
  const groups = new Map<string, TaskItem[]>();
  linkedTasks.forEach(task => {
    const itemId = resolvedMeetingTaskItemId(task,nextItems,legacyItemId,previousItems);
    groups.set(itemId, [...(groups.get(itemId) || []), task]);
  });
  return [...groups.entries()].some(([itemId, group]) => {
    if (!targetItemIds.has(itemId) || group.length < 2) return false;
    const ordered = [...group].sort((left,right) =>
      Number(meetingTaskIsClosed(left))-Number(meetingTaskIsClosed(right))
      || (Date.parse(right.updatedAt||right.createdAt||'')||0)-(Date.parse(left.updatedAt||left.createdAt||'')||0)
      || left.id.localeCompare(right.id)
    );
    return ordered.slice(1).some(task => task.isInternalControl && !meetingTaskIsClosed(task));
  });
}

export const reconcileMeetingTasks = ({
  tasks,
  meetingId,
  vesselIds,
  vesselScopeMode = 'vessels',
  vesselTypeScopes = [],
  followUp = '',
  followUps,
  priority,
  isAbnormal = false,
  isInternalControl = false,
  expectedDate,
  departments,
  ownerUserIds = [],
  meetingTaskCategories = [],
  initialStatus,
  actorId,
  actorName,
  at,
  preserveExistingDescriptions = false,
  preserveExistingDescriptionItemIds = [],
  previousMeetingItems,
  internalControlCancellation,
  createTaskId = () => uid('task'),
}: ReconcileMeetingTasksInput): ReconcileMeetingTasksResult => {
  const existingTaskIds=tasks.map(task=>task.id);
  if(new Set(existingTaskIds).size!==existingTaskIds.length)throw new Error('偵測到重複待辦 ID，未執行會議待辦對帳');
  const originalTasksById=new Map(tasks.map(task=>[task.id,structuredClone(task)]));
  const comparableTask=(task:TaskItem)=>{
    const comparable=structuredClone(task);
    delete comparable.updatedAt;
    delete comparable.updatedBy;
    return JSON.stringify(comparable);
  };
  const normalizedFollowUps = canonicalMeetingTaskItems(
    (followUps ?? [{ id: `${meetingId}-task-1`, description: followUp, categories: normalizeMeetingTaskCategoryList([], meetingTaskCategories) }])
      .map((item, index) => ({ id: item.id || `${meetingId}-task-${index + 1}`, description: item.description, categories: normalizeMeetingTaskCategoryList(item.categories, meetingTaskCategories), distributeToVessels: item.distributeToVessels === true })),
    meetingId,
    meetingTaskCategories,
  );
  const targetVesselIds = Array.from(new Set(vesselIds.filter(Boolean)));
  const normalizedTypeScopes = vesselScopeMode === 'types' ? Array.from(new Set(vesselTypeScopes.filter(Boolean))) : [];
  if(previousMeetingItems&&meetingTaskLinkResolutionConflict({tasks,meetingId,nextItems:normalizedFollowUps,previousItems:previousMeetingItems})){
    throw new Error('既有會議待辦的父事項關聯損壞或不明確，未保存任何變更');
  }
  if (meetingTaskClosedLinkConflict({
    tasks,
    meetingId,
    nextVesselIds: targetVesselIds,
    nextItems: normalizedFollowUps,
    previousItems: previousMeetingItems,
    nextVesselScopeMode: vesselScopeMode,
    nextVesselTypeScopes: normalizedTypeScopes,
    nextIsInternalControl: isInternalControl,
  })) throw new Error('已結案會議待辦與新的父會議範圍、內部管控或分船設定衝突');
  const legacyItemId = normalizedFollowUps[0]?.id || `${meetingId}-task-1`;
  const targetItemIds = new Set(normalizedFollowUps.map(item => item.id));
  const originallyClosedTaskIds = new Set(tasks.filter(task => task.sourceMeetingId === meetingId && meetingTaskIsClosed(task)).map(task => task.id));
  const grouped = new Map<string, TaskItem[]>();
  const expandedClosedTaskIds=new Set<string>();
  tasks.filter(task => task.sourceMeetingId === meetingId).forEach(task => {
    const itemId = resolvedMeetingTaskItemId(task,normalizedFollowUps,legacyItemId,previousMeetingItems);
    const group = grouped.get(itemId) || [];
    group.push(task);
    grouped.set(itemId, group);
  });
  const reservedTaskIds=new Set(existingTaskIds);
  const allocatedTaskIds=new Map<string,string>();
  if(targetVesselIds.length){
    normalizedFollowUps.filter(item=>!grouped.has(item.id)).forEach(item=>{
      let allocated='';
      for(let attempt=0;attempt<32;attempt+=1){
        const candidate=createTaskId().trim();
        if(candidate&&!reservedTaskIds.has(candidate)){allocated=candidate;break;}
      }
      if(!allocated)throw new Error('無法配置唯一 ID，未執行會議待辦對帳');
      reservedTaskIds.add(allocated);
      allocatedTaskIds.set(item.id,allocated);
    });
  }
  const nextVesselIdSet = new Set(targetVesselIds);
  const transitionTasks=isInternalControl?tasks.map(task=>task.sourceMeetingId===meetingId&&!meetingTaskIsClosed(task)?{...task,isInternalControl:true,isAbnormal:true}:task):tasks;
  const internalControlCancellationRequested = meetingTaskInternalControlTransitionRequired({
    tasks:transitionTasks,
    meetingId,
    nextVesselIds: targetVesselIds,
    nextItemIds: normalizedFollowUps.map(item => item.id),
    nextItems: normalizedFollowUps,
    previousItems: previousMeetingItems,
    nextIsInternalControl: isInternalControl,
  });
  if (internalControlCancellationRequested && !internalControlCancellation?.authorized) {
    throw new Error('目前帳戶無權取消內部管控');
  }
  if(isInternalControl){
    tasks.filter(task=>task.sourceMeetingId===meetingId&&!meetingTaskIsClosed(task)).forEach(task=>{task.isInternalControl=true;task.isAbnormal=true;});
  }

  const archivedIds: string[] = [];
  const internalControlCancelledIds: string[] = [];
  const recordInternalControlCancellation = (task: TaskItem, reason: string, clearFlag: boolean) => {
    if (!internalControlCancellation?.authorized) throw new Error('目前帳戶無權取消內部管控');
    if (clearFlag) task.isInternalControl = false;
    if (internalControlCancelledIds.includes(task.id)) return;
    task.internalControlCancelledAt = internalControlCancellation.at;
    task.internalControlCancelledBy = internalControlCancellation.by;
    task.updatedBy = actorId;
    task.updatedAt = at;
    task.statusLogs.unshift({ id: uid('log'), at, by: actorName, byUserId: actorId, text: `取消內部管控：${reason}` });
    internalControlCancelledIds.push(task.id);
  };
  if (!targetVesselIds.length) {
    grouped.forEach(group => group.forEach(task => {
      if (task.isInternalControl && !meetingTaskIsClosed(task)) recordInternalControlCancellation(task, '臨會/專題未指定涉會船舶', true);
      if (archiveLinkedTask(task, '已取消（臨會/專題未指定涉會船舶）', actorId, actorName, at)) archivedIds.push(task.id);
    }));
    return { created: [], updatedIds: [], archivedIds, internalControlCancelledIds };
  }

  const canonicalByItemId = new Map<string, TaskItem>();
  grouped.forEach((group, itemId) => {
    if (!targetItemIds.has(itemId)) {
      const reason = normalizedFollowUps.length ? '已取消（臨會/專題待辦事項已移除）' : '已取消（臨會/專題待辦已清空）';
      group.forEach(task => {
        if (task.isInternalControl && !meetingTaskIsClosed(task)) recordInternalControlCancellation(task, reason, true);
        if (archiveLinkedTask(task, reason, actorId, actorName, at)) archivedIds.push(task.id);
      });
      return;
    }
    const orderedGroup = [...group].sort((left,right) =>
      Number(meetingTaskIsClosed(left))-Number(meetingTaskIsClosed(right))
      || (Date.parse(right.updatedAt||right.createdAt||'')||0)-(Date.parse(left.updatedAt||left.createdAt||'')||0)
      || left.id.localeCompare(right.id)
    );
    const canonical = orderedGroup[0];
    if(meetingTaskIsClosed(canonical)){
      orderedGroup.slice(1).forEach(task=>{
        archiveLinkedTask(task,'已取消（舊版已結案重複待辦已解除關聯）',actorId,actorName,at);
      });
      const historicalVesselIds=meetingTaskVesselIds(canonical);
      const onlyExpandsScope=historicalVesselIds.every(id=>nextVesselIdSet.has(id))&&targetVesselIds.some(id=>!historicalVesselIds.includes(id));
      if(onlyExpandsScope){
        const targetDistributes=normalizedFollowUps.find(item=>item.id===itemId)?.distributeToVessels===true;
        if(targetDistributes){
          reconcileTaskVesselScope(canonical,targetVesselIds,orderedGroup);
          if(targetVesselIds.length>1){canonical.isClosed=false;delete canonical.closedDate;delete canonical.closedBy;}
        }else{
          canonical.vesselId=targetVesselIds[0];
          canonical.vesselIds=[...targetVesselIds];
        }
        expandedClosedTaskIds.add(canonical.id);
      }
      canonicalByItemId.set(itemId,canonical);
      return;
    }
    const removesInternalControlVessel = canonical.isInternalControl && !meetingTaskIsClosed(canonical) && meetingTaskVesselIds(canonical).some(vesselId => !nextVesselIdSet.has(vesselId));
    reconcileTaskVesselScope(canonical,targetVesselIds,orderedGroup);
    if (removesInternalControlVessel) recordInternalControlCancellation(canonical, '臨會/專題涉船範圍縮小或替換', false);
    canonicalByItemId.set(itemId, canonical);
    orderedGroup.slice(1).forEach(task => {
      if (task.isInternalControl && !meetingTaskIsClosed(task)) recordInternalControlCancellation(task, '舊版逐船重複待辦已合併', true);
      if (archiveLinkedTask(task, '已取消（舊版逐船重複待辦已合併）', actorId, actorName, at)) archivedIds.push(task.id);
    });
  });

  const preserveItemIds = new Set(preserveExistingDescriptionItemIds);
  const created: TaskItem[] = [];
  const updatedIds: string[] = [];
  normalizedFollowUps.forEach(item => {
    const existingTask = canonicalByItemId.get(item.id);
    if (existingTask) {
      const originallyClosed = originallyClosedTaskIds.has(existingTask.id);
      if(originallyClosed){
        let changed=false;
        if(existingTask.sourceMeetingItemId!==item.id){existingTask.sourceMeetingItemId=item.id;changed=true;}
        if(expandedClosedTaskIds.has(existingTask.id)){
          Object.assign(existingTask,{sourceMeetingId:meetingId,sourceMeetingItemId:item.id,distributeToVessels:item.distributeToVessels===true,vesselScopeMode,vesselTypeScopes:[...normalizedTypeScopes]});
          changed=true;
        }
        if(changed){existingTask.updatedBy=actorId;existingTask.updatedAt=at;updatedIds.push(existingTask.id);}
        return;
      }
      const activeInternalControl = existingTask.isInternalControl;
      const cancelsInternalControl = activeInternalControl && !isInternalControl;
      const nextInternalControl = isInternalControl;
      Object.assign(existingTask, {
        sourceMeetingId: meetingId,
        sourceMeetingItemId: item.id,
        distributeToVessels: item.distributeToVessels === true,
        sourceType: 'temporary' as const,
        vesselId: targetVesselIds[0],
        vesselIds: [...targetVesselIds],
        vesselScopeMode,
        vesselTypeScopes: [...normalizedTypeScopes],
        priority,
        isAbnormal: nextInternalControl ? true : isAbnormal,
        isInternalControl: nextInternalControl,
        attentionDimension: 'meeting' as const,
        category: item.categories[0] || '',
        categories: [...item.categories],
        expectedDate,
        departments: [...departments],
        ownerUserIds: [...ownerUserIds],
        updatedBy: actorId,
        updatedAt: at,
      });
      if (cancelsInternalControl) recordInternalControlCancellation(existingTask, '會議取消內部管控', true);
      if (!preserveExistingDescriptions && !preserveItemIds.has(item.id)) existingTask.description = item.description;
      updatedIds.push(existingTask.id);
      return;
    }
    const task: TaskItem = {
      id: allocatedTaskIds.get(item.id)!,
      sourceMeetingId: meetingId,
      sourceMeetingItemId: item.id,
      distributeToVessels: item.distributeToVessels === true,
      sourceType: 'temporary',
      vesselId: targetVesselIds[0],
      vesselIds: [...targetVesselIds],
      vesselScopeMode,
      vesselTypeScopes: [...normalizedTypeScopes],
      priority,
      attentionDimension: 'meeting',
      isAware: true,
      isAbnormal: isAbnormal || isInternalControl,
      isInternalControl,
      category: item.categories[0] || '',
      categories: [...item.categories],
      description: item.description,
      status: initialStatus.trim() || '待執行',
      expectedDate,
      reportDate: at.slice(0, 10),
      departments: [...departments],
      ownerUserIds: [...ownerUserIds],
      isClosed: false,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: at,
      updatedAt: at,
      statusLogs: [{ id: uid('log'), at, by: actorName, byUserId: actorId, text: initialStatus.trim() || '建立臨會/專題待辦' }],
      vesselProgress: [],
    };
    tasks.unshift(task);
    created.push(task);
  });

  const actualUpdatedIds=Array.from(new Set(updatedIds)).filter(taskId=>{
    const original=originalTasksById.get(taskId);
    const current=tasks.find(task=>task.id===taskId);
    if(!original||!current) return true;
    if(comparableTask(original)!==comparableTask(current)) return true;
    current.updatedAt=original.updatedAt;
    current.updatedBy=original.updatedBy;
    return false;
  });
  return { created, updatedIds:actualUpdatedIds, archivedIds, internalControlCancelledIds };
};

export const meetingTaskNotificationEvents = (
  tasks: TaskItem[],
  result: ReconcileMeetingTasksResult,
): MeetingTaskNotificationEvent[] => {
  const taskById = new Map([...tasks, ...result.created].map(task => [task.id, task]));
  const cancelledIds = new Set(result.internalControlCancelledIds || []);
  const refs: Array<{ taskId: string; kind: MeetingTaskNotificationKind }> = [
    ...result.created.map(task => ({ taskId: task.id, kind: 'task_created' as const })),
    ...result.updatedIds.filter(taskId => !cancelledIds.has(taskId)).map(taskId => ({ taskId, kind: 'task_updated' as const })),
    ...[...cancelledIds].map(taskId => ({ taskId, kind: 'internal_control_cancelled' as const })),
    ...result.archivedIds.filter(taskId => !cancelledIds.has(taskId)).map(taskId => ({ taskId, kind: 'task_archived' as const })),
  ];
  const seen = new Set<string>();
  return refs.flatMap(({ taskId, kind }) => {
    const key = `${kind} ${taskId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const task = taskById.get(taskId);
    return task ? [{ task, kind }] : [];
  });
};

import type { MeetingTaskItem, MeetingVesselScopeMode, NotificationKind, TaskItem, TaskPriority, TemporaryMeeting } from './types';
import { uid } from './runtimeUtils';
import { reconcileTaskVesselScope, taskIsClosedForScope } from './taskVesselProgress';
import { normalizeMeetingTaskCategoryList } from './taskCategories';
import { canonicalizeMeetingTaskItemIds } from './meetingTaskItemIds';
import { taipeiDateKey } from './taipeiTime';

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

type MeetingWithTaskItems = {
  id: string;
  taskDescription?: unknown;
  taskItems?: unknown;
  vessels?: unknown;
  vesselScopeMode?: MeetingVesselScopeMode;
  vesselTypeScopes?: unknown;
  isInternalControl?: unknown;
};

type MeetingTaskProjection = Pick<TaskItem,
  'sourceMeetingId' | 'sourceMeetingItemId' | 'description' | 'categories' | 'distributeToVessels'
> & Partial<Pick<TaskItem, 'vesselId' | 'vesselIds' | 'vesselProgress' | 'isClosed' | 'closedDate' | 'closedBy'>>;

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
    isClosed:item.isClosed===true,
    closedDate:item.isClosed===true&&item.closedDate?item.closedDate:undefined,
    closedBy:item.isClosed===true&&item.closedBy?item.closedBy:undefined,
  })),`${meetingId}-task`).filter(item=>item.id&&item.description);

export function meetingDecisionLifecycleFromTask(task: TaskItem) {
  const vesselIds=Array.from(new Set((task.vesselIds?.length?task.vesselIds:[task.vesselId]).filter(Boolean)));
  const isClosed=taskIsClosedForScope(task,vesselIds);
  if(!isClosed)return {isClosed:false,closedDate:undefined,closedBy:undefined};
  if(task.distributeToVessels===true&&vesselIds.length>1){
    const closedProgress=vesselIds
      .map(vesselId=>task.vesselProgress?.find(progress=>progress.vesselId===vesselId))
      .filter((progress):progress is NonNullable<typeof progress>=>Boolean(progress?.isClosed))
      .sort((left,right)=>(left.updatedAt||'').localeCompare(right.updatedAt||''));
    const finalProgress=closedProgress[closedProgress.length-1];
    return {isClosed:true,closedDate:finalProgress?.closedDate||task.closedDate,closedBy:finalProgress?.closedBy||task.closedBy};
  }
  return {isClosed:true,closedDate:task.closedDate,closedBy:task.closedBy};
}

const persistedMeetingTaskItems = (
  meeting: MeetingWithTaskItems,
  tasks: MeetingTaskProjection[] = [],
  meetingTaskCategories?: string[],
): MeetingTaskItem[] => {
  if (Object.prototype.hasOwnProperty.call(meeting, 'taskItems')) {
    if (!Array.isArray(meeting.taskItems)) return [];
    const savedItems=canonicalMeetingTaskItems(meeting.taskItems.flatMap((value, index) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as { id?: unknown; description?: unknown; categories?: unknown; distributeToVessels?: unknown; isClosed?: unknown; closedDate?: unknown; closedBy?: unknown };
      const id = typeof item.id === 'string' && item.id ? item.id : `${meeting.id}-task-${index + 1}`;
      const isClosed=item.isClosed===true;
      return [{ id, description: typeof item.description === 'string' ? item.description : '', categories: normalizeMeetingTaskCategoryList(item.categories, meetingTaskCategories), distributeToVessels: item.distributeToVessels === true, isClosed, closedDate:isClosed&&typeof item.closedDate==='string'?item.closedDate:undefined, closedBy:isClosed&&typeof item.closedBy==='string'?item.closedBy:undefined }];
    }), meeting.id, meetingTaskCategories);
    return savedItems;
  }
  const hasSavedDescription = Object.prototype.hasOwnProperty.call(meeting, 'taskDescription');
  const savedDescription = typeof meeting.taskDescription === 'string' ? meeting.taskDescription : '';
  if (hasSavedDescription) return savedDescription.trim() ? [{ id: `${meeting.id}-task-1`, description: savedDescription, categories: normalizeMeetingTaskCategoryList([], meetingTaskCategories), distributeToVessels: false }] : [];
  const linkedTask = tasks.find(task => task.sourceMeetingId === meeting.id && task.description.trim());
  return linkedTask ? [{ id: linkedTask.sourceMeetingItemId || `${meeting.id}-task-1`, description: linkedTask.description, categories: normalizeMeetingTaskCategoryList(linkedTask.categories, meetingTaskCategories), distributeToVessels: linkedTask.distributeToVessels === true }] : [];
};

export const meetingTaskItems = (
  meeting: MeetingWithTaskItems,
  tasks: MeetingTaskProjection[] = [],
  meetingTaskCategories?: string[],
): MeetingTaskItem[] => persistedMeetingTaskItems(meeting,tasks,meetingTaskCategories);

export type MeetingDecisionCompletionState = 'open' | 'closed' | 'missing' | 'duplicate' | 'invalid';

export interface MeetingDecisionCompletionItem {
  item: MeetingTaskItem;
  task?: TaskItem;
  state: MeetingDecisionCompletionState;
  lifecycleConflict?: boolean;
  distributed: boolean;
  completedVesselCount: number;
  vesselCount: number;
}

export interface MeetingDecisionCompletionSummary {
  items: MeetingDecisionCompletionItem[];
  totalCount: number;
  completedCount: number;
  hasLinkConflict: boolean;
  orphanTaskIds: string[];
  allCompleted: boolean;
}

export function meetingDecisionCompletionSummary(
  meeting: MeetingWithTaskItems,
  tasks: TaskItem[],
): MeetingDecisionCompletionSummary {
  const items = persistedMeetingTaskItems(meeting, tasks);
  const meetingForLinkValidation = {
    id: meeting.id,
    vessels: Array.isArray(meeting.vessels) ? meeting.vessels.filter((value): value is string => typeof value === 'string' && Boolean(value)) : [],
    vesselScopeMode: meeting.vesselScopeMode || 'vessels',
    vesselTypeScopes: Array.isArray(meeting.vesselTypeScopes) ? meeting.vesselTypeScopes.filter((value): value is string => typeof value === 'string' && Boolean(value)) : [],
    isInternalControl: meeting.isInternalControl === true,
    taskItems: items,
  };
  const hasNoVesselScope=meetingForLinkValidation.vessels.length===0;
  const itemIds = new Set(items.map(item => item.id));
  const linkedTasks = tasks.filter(task => task.sourceMeetingId === meeting.id);
  const orphanTaskIds = linkedTasks
    .filter(task => !task.sourceMeetingItemId || !itemIds.has(task.sourceMeetingItemId))
    .map(task => task.id);
  const completionItems = items.map(item => {
    const matches = linkedTasks.filter(task => task.sourceMeetingItemId === item.id);
    if(matches.length===0&&hasNoVesselScope){
      return {
        item,
        state:item.isClosed===true?'closed':'open',
        distributed:false,
        completedVesselCount:0,
        vesselCount:0,
      } satisfies MeetingDecisionCompletionItem;
    }
    if (matches.length !== 1) {
      return {
        item,
        state: matches.length ? 'duplicate' : 'missing',
        distributed: item.distributeToVessels === true,
        completedVesselCount: 0,
        vesselCount: 0,
      } satisfies MeetingDecisionCompletionItem;
    }
    const task = matches[0];
    const vesselIds = Array.from(new Set((task.vesselIds?.length ? task.vesselIds : [task.vesselId]).filter(Boolean)));
    const distributed = task.distributeToVessels === true && vesselIds.length > 1;
    if(hasNoVesselScope||!meetingTaskLinkIsValidForMutation(task,[meetingForLinkValidation])){
      return {
        item,
        task,
        state:'invalid',
        distributed,
        completedVesselCount:0,
        vesselCount:vesselIds.length,
      } satisfies MeetingDecisionCompletionItem;
    }
    const lifecycle=meetingDecisionLifecycleFromTask(task);
    const closed=lifecycle.isClosed;
    const lifecycleMatches=item.isClosed===closed
      &&String(item.closedDate||'')===String(lifecycle.closedDate||'')
      &&String(item.closedBy||'')===String(lifecycle.closedBy||'');
    if(!lifecycleMatches){
      return {
        item,
        task,
        state:'invalid',
        lifecycleConflict:true,
        distributed,
        completedVesselCount:0,
        vesselCount:vesselIds.length,
      } satisfies MeetingDecisionCompletionItem;
    }
    const completedVesselCount = distributed
      ? vesselIds.filter(vesselId => task.vesselProgress?.find(progress => progress.vesselId === vesselId)?.isClosed === true).length
      : (closed ? vesselIds.length : 0);
    return {
      item,
      task,
      state: closed ? 'closed' : 'open',
      distributed,
      completedVesselCount,
      vesselCount: vesselIds.length,
    } satisfies MeetingDecisionCompletionItem;
  });
  const hasLinkConflict = orphanTaskIds.length > 0 || completionItems.some(item => item.state === 'missing' || item.state === 'duplicate' || item.state === 'invalid');
  const completedCount = completionItems.filter(item => item.state === 'closed').length;
  return {
    items: completionItems,
    totalCount: completionItems.length,
    completedCount,
    hasLinkConflict,
    orphanTaskIds,
    allCompleted: !hasLinkConflict && completionItems.every(item => item.state === 'closed'),
  };
}

export type UnlinkedMeetingDecisionTransitionFailureReason =
  | 'meeting-missing-or-duplicate'
  | 'relationship-changed'
  | 'meeting-closed'
  | 'already-applied';

export type UnlinkedMeetingDecisionTransitionPlan =
  | { ok: false; reason: UnlinkedMeetingDecisionTransitionFailureReason }
  | {
      ok: true;
      meeting: TemporaryMeeting;
      expectedUpdatedAt: string;
      mustClaimLease: boolean;
    };

export function planUnlinkedMeetingDecisionTransition(input: {
  meetings: TemporaryMeeting[];
  tasks: TaskItem[];
  meetingId: string;
  itemId: string;
  transition: 'complete' | 'reopen';
  sectionKey: string;
  activeItemLeaseKey: string;
  savedBeforeTransition: boolean;
}): UnlinkedMeetingDecisionTransitionPlan {
  const matches=input.meetings.filter(meeting=>meeting.id===input.meetingId);
  if(matches.length!==1)return {ok:false,reason:'meeting-missing-or-duplicate'};
  const meeting=matches[0];
  const summary=meetingDecisionCompletionSummary(meeting,input.tasks);
  const item=summary.items.find(candidate=>candidate.item.id===input.itemId);
  if(!item||item.task||summary.hasLinkConflict||meeting.vessels.length)return {ok:false,reason:'relationship-changed'};
  if((meeting.status||'追蹤中')==='已完成')return {ok:false,reason:'meeting-closed'};
  if((input.transition==='complete'&&item.state==='closed')||(input.transition==='reopen'&&item.state!=='closed'))return {ok:false,reason:'already-applied'};
  return {
    ok:true,
    meeting,
    expectedUpdatedAt:meeting.updatedAt,
    mustClaimLease:input.savedBeforeTransition||input.activeItemLeaseKey!==input.sectionKey,
  };
}

export function meetingDecisionLifecycleIsConsistent(
  meeting: MeetingWithTaskItems,
  tasks: TaskItem[],
  taskId: string,
): boolean {
  const task=tasks.find(item=>item.id===taskId);
  if(!task)return false;
  const completion=meetingDecisionCompletionSummary(meeting,tasks).items.find(item=>item.task?.id===taskId);
  if(!completion)return false;
  const expectedState=meetingDecisionLifecycleFromTask(task).isClosed?'closed':'open';
  return completion.state===expectedState&&completion.lifecycleConflict!==true;
}

export type MeetingDecisionTaskTransition = 'complete' | 'reopen';

export interface MeetingDecisionTaskTransitionContext {
  actorId: string;
  actorName: string;
  at: string;
  closedDate: string;
}

export function synchronizeLinkedMeetingDecisionLifecycle(
  meeting: TemporaryMeeting,
  task: TaskItem,
  context: MeetingDecisionTaskTransitionContext,
): TemporaryMeeting {
  if(!meetingTaskLinkIsValidForMutation(task,[meeting]))throw new Error('待辦與父會議關聯不一致');
  const nextMeeting=structuredClone(meeting);
  const matches=nextMeeting.taskItems.filter(item=>item.id===task.sourceMeetingItemId);
  if(matches.length!==1)throw new Error('父會議決議待辦不存在或識別碼重複');
  const lifecycle=meetingDecisionLifecycleFromTask(task);
  const nextItem=matches[0];
  nextItem.isClosed=lifecycle.isClosed;
  if(lifecycle.isClosed){
    if(lifecycle.closedDate)nextItem.closedDate=lifecycle.closedDate;
    else delete nextItem.closedDate;
    if(lifecycle.closedBy)nextItem.closedBy=lifecycle.closedBy;
    else delete nextItem.closedBy;
  }else{
    delete nextItem.closedDate;
    delete nextItem.closedBy;
  }
  const status=lifecycle.isClosed?'決議待辦已完成':'決議待辦重新開啟';
  nextMeeting.latestStatus=status;
  nextMeeting.updatedAt=context.at;
  nextMeeting.statusLogs=[
    {id:uid('log'),at:context.at,by:context.actorName,byUserId:context.actorId,text:status},
    ...(meeting.statusLogs||[]),
  ];
  return nextMeeting;
}

export function transitionMeetingDecisionTask(
  task: TaskItem,
  transition: MeetingDecisionTaskTransition,
  context: MeetingDecisionTaskTransitionContext,
): TaskItem {
  if (task.sourceType !== 'temporary' || task.attentionDimension !== 'meeting' || !task.sourceMeetingId || !task.sourceMeetingItemId) {
    throw new Error('待辦缺少有效的會議來源關聯');
  }
  const vesselIds = Array.from(new Set((task.vesselIds?.length ? task.vesselIds : [task.vesselId]).filter(Boolean)));
  if (!vesselIds.length) throw new Error('會議待辦缺少完整涉船範圍');
  if (task.distributeToVessels === true && vesselIds.length > 1) {
    throw new Error('分船待辦必須依各船進度完成，不得覆寫整體狀態');
  }
  const closed = taskIsClosedForScope(task, vesselIds);
  if ((transition === 'complete' && closed) || (transition === 'reopen' && !closed)) {
    throw new Error(transition === 'complete' ? '會議待辦已完成' : '會議待辦尚未完成');
  }
  const status = transition === 'complete' ? '由臨會/專題標記完成' : '由臨會/專題重新開啟';
  const next: TaskItem = {
    ...task,
    status,
    isClosed: transition === 'complete',
    updatedAt: context.at,
    updatedBy: context.actorId,
    statusLogs: [{ id: uid('log'), at: context.at, by: context.actorName, byUserId: context.actorId, text: status }, ...(task.statusLogs || [])],
  };
  if (transition === 'complete') {
    next.closedDate = context.closedDate;
    next.closedBy = context.actorId;
  } else {
    delete next.closedDate;
    delete next.closedBy;
  }
  return next;
}

export function transitionLinkedMeetingDecision(
  meeting: TemporaryMeeting,
  task: TaskItem,
  transition: MeetingDecisionTaskTransition,
  context: MeetingDecisionTaskTransitionContext,
): { meeting: TemporaryMeeting; task: TaskItem; repairedOnly: boolean } {
  const verifiedResult=(nextMeeting:TemporaryMeeting,nextTask:TaskItem,repairedOnly:boolean)=>{
    if(!meetingDecisionLifecycleIsConsistent(nextMeeting,[nextTask],nextTask.id))throw new Error('父會議與關聯待辦狀態同步未完成');
    return {meeting:nextMeeting,task:nextTask,repairedOnly};
  };
  const lifecycle=meetingDecisionLifecycleFromTask(task);
  const parentItem=meeting.taskItems.find(item=>item.id===task.sourceMeetingItemId);
  const parentMatches=Boolean(parentItem
    &&parentItem.isClosed===lifecycle.isClosed
    &&String(parentItem.closedDate||'')===String(lifecycle.closedDate||'')
    &&String(parentItem.closedBy||'')===String(lifecycle.closedBy||''));
  const desiredClosed=transition==='complete';
  if(lifecycle.isClosed===desiredClosed&&!parentMatches){
    const nextTask=structuredClone(task);
    return verifiedResult(synchronizeLinkedMeetingDecisionLifecycle(meeting,nextTask,context),nextTask,true);
  }
  const nextTask = transitionMeetingDecisionTask(task, transition, context);
  const nextMeeting=synchronizeLinkedMeetingDecisionLifecycle(meeting,nextTask,context);
  return verifiedResult(nextMeeting,nextTask,false);
}

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
      .map((item, index) => ({ id: item.id || `${meetingId}-task-${index + 1}`, description: item.description, categories: normalizeMeetingTaskCategoryList(item.categories, meetingTaskCategories), distributeToVessels: item.distributeToVessels === true, isClosed:item.isClosed===true, closedDate:item.isClosed===true?item.closedDate:undefined, closedBy:item.isClosed===true?item.closedBy:undefined })),
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
    const itemClosed=item.isClosed===true;
    const inheritedClosedDate=item.closedDate||taipeiDateKey(at);
    const inheritedClosedBy=item.closedBy||actorId;
    const distributedClosed=itemClosed&&item.distributeToVessels===true&&targetVesselIds.length>1;
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
      status: itemClosed?'由臨會/專題既有完成狀態建立':initialStatus.trim() || '待執行',
      expectedDate,
      reportDate: at.slice(0, 10),
      departments: [...departments],
      ownerUserIds: [...ownerUserIds],
      isClosed: itemClosed&&!distributedClosed,
      closedDate:itemClosed&&!distributedClosed?inheritedClosedDate:undefined,
      closedBy:itemClosed&&!distributedClosed?inheritedClosedBy:undefined,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: at,
      updatedAt: at,
      statusLogs: [{ id: uid('log'), at, by: actorName, byUserId: actorId, text: itemClosed?'由臨會/專題既有完成狀態建立':initialStatus.trim() || '建立臨會/專題待辦' }],
      vesselProgress: distributedClosed?targetVesselIds.map(vesselId=>({vesselId,status:'由臨會/專題既有完成狀態建立',isClosed:true,closedDate:inheritedClosedDate,closedBy:inheritedClosedBy,updatedAt:at,updatedBy:actorId,statusLogs:[{id:uid('log'),at,by:actorName,byUserId:actorId,text:'由臨會/專題既有完成狀態建立'}]})):[],
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

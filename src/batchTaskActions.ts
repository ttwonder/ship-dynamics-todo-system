import type { TaskItem, TemporaryMeeting } from './types';
import { uid } from './runtimeUtils';
import { meetingDecisionLifecycleIsConsistent, meetingTaskLinkIsValidForMutation, synchronizeLinkedMeetingDecisionLifecycle } from './meetingTaskWorkflow';
import { taskVesselIds } from './taskVesselScope';
import { usesPerVesselProgress } from './taskVesselProgress';

export interface BatchCompletionContext {
  actorId: string;
  actorName: string;
  at: string;
  closedDate: string;
}

export function sanitizeTaskSelection(selectedIds: string[], visibleTasks: Pick<TaskItem, 'id'>[]): string[] {
  const visibleIds = new Set(visibleTasks.map(task => task.id));
  return selectedIds.filter(id => visibleIds.has(id));
}

export type BatchTaskAction = 'complete' | 'delete';
export type BatchTaskSelection =
  | { ok: true; taskIds: string[]; tasks: TaskItem[] }
  | { ok: false; taskIds: []; tasks: []; reason: 'empty' | 'stale-or-inaccessible' };

export function validateBatchTaskSelection(tasks: TaskItem[], selectedIds: string[], visibleVesselIds: Set<string>, action: BatchTaskAction): BatchTaskSelection {
  const taskIds = [...new Set(selectedIds)];
  if (!taskIds.length) return { ok: false, taskIds: [], tasks: [], reason: 'empty' };
  const selectedTasks = taskIds.map(id => {
    const matches=tasks.filter(task=>task.id===id);
    return matches.length===1?matches[0]:undefined;
  });
  if (selectedTasks.some(task => !task || (action === 'complete' && (task.isClosed || usesPerVesselProgress(task))) || !taskVesselIds(task).every(id => visibleVesselIds.has(id)))) {
    return { ok: false, taskIds: [], tasks: [], reason: 'stale-or-inaccessible' };
  }
  return { ok: true, taskIds, tasks: selectedTasks as TaskItem[] };
}

export function completeSelectedTasks(tasks: TaskItem[], selectedIds: string[], context: BatchCompletionContext): { tasks: TaskItem[]; completedIds: string[] } {
  const selected = new Set(selectedIds);
  if([...selected].some(id=>tasks.filter(task=>task.id===id).length>1))return {tasks,completedIds:[]};
  const completedIds: string[] = [];
  const nextTasks = tasks.map(task => {
    if (!selected.has(task.id) || task.isClosed || usesPerVesselProgress(task)) return task;
    completedIds.push(task.id);
    return {
      ...task,
      isClosed: true,
      status: '批量完成待辦',
      closedDate: context.closedDate,
      closedBy: context.actorId,
      updatedAt: context.at,
      updatedBy: context.actorId,
      statusLogs: [{ id: uid('log'), at: context.at, by: context.actorName, byUserId: context.actorId, text: '批量完成待辦' }, ...task.statusLogs],
    };
  });
  return { tasks: nextTasks, completedIds };
}

export function completeSelectedTasksWithMeetingSync(
  tasks: TaskItem[],
  meetings: TemporaryMeeting[],
  selectedIds: string[],
  context: BatchCompletionContext,
): { tasks: TaskItem[]; meetings: TemporaryMeeting[]; completedIds: string[] } {
  const selectedTaskIds=[...new Set(selectedIds)];
  const unchanged=()=>({tasks,meetings,completedIds:[] as string[]});
  const completed=completeSelectedTasks(tasks,selectedTaskIds,context);
  if(completed.completedIds.length!==selectedTaskIds.length||selectedTaskIds.some(id=>!completed.completedIds.includes(id)))return unchanged();
  const nextTasks=completed.tasks;
  const nextMeetings=structuredClone(meetings);
  try{
    selectedTaskIds.forEach(taskId=>{
      const task=nextTasks.find(item=>item.id===taskId);
      if(!task)throw new Error('待辦不存在');
      const hasMeetingSemantics=task.sourceType==='temporary'||task.attentionDimension==='meeting'||Boolean(task.sourceMeetingId||task.sourceMeetingItemId);
      if(!hasMeetingSemantics)return;
      if(!task.sourceMeetingId||!meetingTaskLinkIsValidForMutation(task,nextMeetings))throw new Error('會議來源待辦關聯無效');
      const meetingMatches=nextMeetings.map((meeting,index)=>({meeting,index})).filter(({meeting})=>meeting.id===task.sourceMeetingId);
      if(meetingMatches.length!==1)throw new Error('父會議不存在或識別碼重複');
      const {meeting,index}=meetingMatches[0];
      const synced=synchronizeLinkedMeetingDecisionLifecycle(meeting,task,context);
      nextMeetings[index]=synced;
      if(!meetingDecisionLifecycleIsConsistent(synced,nextTasks,taskId))throw new Error('父會議與關聯待辦狀態同步未完成');
    });
  }catch{
    return unchanged();
  }
  return {tasks:nextTasks,meetings:nextMeetings,completedIds:completed.completedIds};
}

export function deleteSelectedTasks(tasks: TaskItem[], selectedIds: string[]): { tasks: TaskItem[]; deletedIds: string[] } {
  const selected = new Set(selectedIds);
  if([...selected].some(id=>tasks.filter(task=>task.id===id).length>1))return {tasks,deletedIds:[]};
  const deletedIds = tasks.filter(task => selected.has(task.id)).map(task => task.id);
  return { tasks: tasks.filter(task => !selected.has(task.id)), deletedIds };
}

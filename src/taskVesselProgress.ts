import type { TaskItem, TaskVesselProgress } from './types';
import { taskVesselIds } from './taskVesselScope';

type UpdateMeta = { at: string; actorId: string };

export function usesPerVesselProgress(task: Pick<TaskItem,'sourceMeetingId'|'vesselId'|'vesselIds'|'distributeToVessels'>): boolean {
  return Boolean(task.sourceMeetingId) && task.distributeToVessels === true && taskVesselIds(task).length > 1;
}

export function emptyTaskVesselProgress(vesselId: string): TaskVesselProgress {
  return { vesselId, status: '', isClosed: false, statusLogs: [] };
}

export function taskProgressForVessel(task: TaskItem, vesselId: string): TaskVesselProgress {
  if (!usesPerVesselProgress(task)) {
    return {
      vesselId,
      status: task.status,
      isClosed: task.isClosed,
      closedDate: task.closedDate,
      closedBy: task.closedBy,
      updatedAt: task.updatedAt,
      updatedBy: task.updatedBy,
      statusLogs: task.statusLogs,
    };
  }
  const progress=task.vesselProgress?.find(item=>item.vesselId===vesselId);
  return progress ? structuredClone(progress) : emptyTaskVesselProgress(vesselId);
}

function cloneProgress(progress: TaskVesselProgress): TaskVesselProgress {
  return { ...progress, statusLogs: structuredClone(progress.statusLogs || []) };
}

function topLevelProgress(task: TaskItem, vesselId: string): TaskVesselProgress {
  return {
    vesselId,
    status: task.status,
    isClosed: task.isClosed,
    closedDate: task.closedDate,
    closedBy: task.closedBy,
    updatedAt: task.updatedAt,
    updatedBy: task.updatedBy,
    statusLogs: structuredClone(task.statusLogs || []),
  };
}

export function reconcileTaskVesselScope(task: TaskItem, nextVesselIds: string[], sourceTasks: TaskItem[] = [task]): void {
  const targetIds=Array.from(new Set(nextVesselIds.filter(Boolean)));
  const wasPerVessel=usesPerVesselProgress(task);
  const snapshots=new Map<string,TaskVesselProgress>();

  sourceTasks.forEach(source=>{
    const sourceIds=taskVesselIds(source).filter(id=>targetIds.includes(id));
    if(usesPerVesselProgress(source)){
      (source.vesselProgress||[]).forEach(progress=>{
        if(sourceIds.includes(progress.vesselId)&&!snapshots.has(progress.vesselId)) snapshots.set(progress.vesselId,cloneProgress(progress));
      });
      return;
    }
    if(sourceIds.length===1&&!snapshots.has(sourceIds[0])) snapshots.set(sourceIds[0],topLevelProgress(source,sourceIds[0]));
  });

  if(targetIds.length>1){
    task.vesselProgress=targetIds.flatMap(vesselId=>{
      const progress=snapshots.get(vesselId);
      return progress ? [{...progress,vesselId}] : [];
    });
  }else if(targetIds.length===1){
    const progress=snapshots.get(targetIds[0])||(wasPerVessel?topLevelProgress(task,targetIds[0]):null);
    if(progress){
      task.status=progress.status;
      task.isClosed=progress.isClosed;
      task.closedDate=progress.closedDate;
      task.closedBy=progress.closedBy;
      task.updatedAt=progress.updatedAt||task.updatedAt;
      task.updatedBy=progress.updatedBy||task.updatedBy;
      task.statusLogs=structuredClone(progress.statusLogs||[]);
    }
    task.vesselProgress=[];
  }else{
    task.vesselProgress=[];
  }
  if(targetIds[0]) task.vesselId=targetIds[0];
  task.vesselIds=targetIds;
}

export function taskIsClosedForVessel(task: TaskItem, vesselId: string) {
  return taskProgressForVessel(task, vesselId).isClosed;
}

export function taskIsClosedForScope(task: TaskItem, vesselIds: string[]) {
  if (!usesPerVesselProgress(task)) return task.isClosed;
  const relevant=taskVesselIds(task).filter(vesselId=>vesselIds.includes(vesselId));
  return relevant.length>0&&relevant.every(vesselId=>taskIsClosedForVessel(task,vesselId));
}

export function updateTaskVesselProgress(
  task: TaskItem,
  vesselId: string,
  mutate: (current: TaskVesselProgress) => TaskVesselProgress,
  meta: UpdateMeta,
): TaskItem {
  if (!usesPerVesselProgress(task)) throw new Error('该待辦不使用單船進度');
  if (!taskVesselIds(task).includes(vesselId)) throw new Error('船舶不在待辦範圍');
  const next=structuredClone(task);
  const current=taskProgressForVessel(next,vesselId);
  const updated=mutate(current);
  updated.vesselId=vesselId;
  updated.updatedAt=meta.at;
  updated.updatedBy=meta.actorId;
  const entries=(next.vesselProgress||[]).filter(item=>item.vesselId!==vesselId&&taskVesselIds(next).includes(item.vesselId));
  next.vesselProgress=[updated,...entries];
  next.updatedAt=meta.at;
  next.updatedBy=meta.actorId;
  return next;
}

export function taskVesselProgressSummary(task: TaskItem, vesselIds=taskVesselIds(task)) {
  const scoped=vesselIds.filter(id=>taskVesselIds(task).includes(id));
  const completed=scoped.filter(id=>taskIsClosedForVessel(task,id)).length;
  return { completed, total: scoped.length };
}

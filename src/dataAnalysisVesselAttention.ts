import type { TaskItem } from './types';
import { contributesToVesselAttention, isVesselDelegatedMeetingTask } from './taskAttention';
import { taskHasVessel } from './taskVesselScope';
import { taskIsClosedForVessel } from './taskVesselProgress';

export function dataAnalysisVesselAbnormalCount(
  tasks: TaskItem[],
  abnormalMeetingIds: string[],
  vesselId: string,
): number {
  const vesselTasks=tasks.filter(task=>taskHasVessel(task,vesselId));
  const delegatedMeetingIds=new Set(
    vesselTasks
      .filter(isVesselDelegatedMeetingTask)
      .map(task=>task.sourceMeetingId)
      .filter((id):id is string=>Boolean(id)),
  );
  const openAbnormalTasks=vesselTasks.filter(task=>(contributesToVesselAttention(task)||isVesselDelegatedMeetingTask(task))
    &&task.isAbnormal
    &&!taskIsClosedForVessel(task,vesselId));
  const unrepresentedMeetingIds=new Set(abnormalMeetingIds.filter(id=>id&&!delegatedMeetingIds.has(id)));
  return openAbnormalTasks.length+unrepresentedMeetingIds.size;
}

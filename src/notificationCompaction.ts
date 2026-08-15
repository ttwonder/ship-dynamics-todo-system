import type { AppData, TaskItem, UserNotification } from './types';

const NOTIFICATION_LIMIT=1000;
type NotificationSnapshot=Pick<AppData,'tasks'|'notifications'>;

const eventSecond=(value:string)=>{
  const match=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.exec(value);
  return match?.[0]||value;
};

const companyLevelTaskIds=(tasks:readonly TaskItem[])=>new Set(
  tasks
    .filter(task=>Boolean(task.sourceMeetingId)&&task.distributeToVessels===false)
    .map(task=>task.id),
);

const companyEventKey=(notice:UserNotification)=>JSON.stringify([
  notice.userId,
  notice.taskId,
  notice.kind,
  notice.actorId,
  notice.title,
  notice.message,
  eventSecond(notice.createdAt),
]);

function compactCompanyLevelNotifications(
  notifications:readonly UserNotification[],
  taskIds:ReadonlySet<string>,
):{notifications:UserNotification[];removed:number}{
  const compacted:UserNotification[]=[];
  const eventIndexes=new Map<string,number>();
  let removed=0;
  for(const notice of notifications){
    if(!taskIds.has(notice.taskId)){
      compacted.push(notice);
      continue;
    }
    const key=companyEventKey(notice);
    const existingIndex=eventIndexes.get(key);
    if(existingIndex===undefined){
      eventIndexes.set(key,compacted.length);
      compacted.push(notice);
      continue;
    }
    removed+=1;
    const existing=compacted[existingIndex];
    if(!existing.readAt&&notice.readAt)compacted[existingIndex]={...existing,readAt:notice.readAt};
  }
  return{notifications:compacted,removed};
}

export function repairPendingCompanyLevelNotificationOverflow<T extends NotificationSnapshot>(
  base:T,
  local:T,
  limit=NOTIFICATION_LIMIT,
):T{
  const tasksById=new Map(base.tasks.map(task=>[task.id,task]));
  local.tasks.forEach(task=>tasksById.set(task.id,task));
  const taskIds=companyLevelTaskIds([...tasksById.values()]);
  if(!taskIds.size)return local;
  const compactedLocal=compactCompanyLevelNotifications(local.notifications,taskIds);
  if(!compactedLocal.removed)return local;

  const notifications=[...compactedLocal.notifications];
  if(local.notifications.length>=limit){
    const compactedBase=compactCompanyLevelNotifications(base.notifications,taskIds).notifications;
    const retainedIds=new Set(notifications.map(notice=>notice.id));
    for(const notice of compactedBase){
      if(retainedIds.has(notice.id))continue;
      retainedIds.add(notice.id);
      notifications.push(notice);
    }
  }
  return{...local,notifications:notifications.slice(0,limit)};
}

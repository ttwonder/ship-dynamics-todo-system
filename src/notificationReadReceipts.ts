import type { AppData } from './types';

export function markOwnNotificationsRead(data:AppData,userId:string,readAt:string):AppData{
  if(!userId||!readAt)return data;
  let changed=false;
  const notifications=data.notifications.map(notification=>{
    if(notification.userId!==userId||notification.readAt)return notification;
    changed=true;
    return{...notification,readAt};
  });
  if(!changed)return data;
  return{
    ...data,
    revision:(data.revision||0)+1,
    updatedAt:readAt,
    notifications,
  };
}

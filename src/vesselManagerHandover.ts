import type { AppData, Vessel, UserAccount, VesselResponsibility, TemporaryMeeting } from './types';
import { taskVesselIds } from './taskVesselScope';
import { taskIsClosedForScope } from './taskVesselProgress';
import { hasActiveVesselDelegation } from './vesselDelegation';
import type { RecordTarget } from './cloudRecordScopes';

// Permanent manager teams are distinct from common contacts and temporary delegates.
// Legacy absence is a read projection, never a load-time mutation/backfill.
export const primaryVesselTeam = (data: Pick<AppData,'users'|'vessels'>, vesselId: string): string[] => {
 const vessel=data.vessels.find(v=>v.id===vesselId);
 if(!vessel?.isActive)return [];
 return data.users.filter(u=>u.isActive&&(u.role==='admin'||u.role==='operator')&&
  (vessel.assignedUserIds.includes(u.id)||u.managedVesselIds.includes(vesselId))).map(u=>u.id);
};
export function changedVesselTeams(before:AppData,after:AppData):string[]{
 return before.vessels.filter(v=>v.isActive&&after.vessels.some(n=>n.id===v.id&&n.isActive)).filter(v=>{
  const a=primaryVesselTeam(before,v.id),b=primaryVesselTeam(after,v.id);
  // Empty assignments and lifecycle edits retain their pre-existing behavior.
  // No pairing, remembered previous save, or delegate-as-successor inference.
  return b.length>0&&JSON.stringify([...a].sort())!==JSON.stringify([...b].sort())&&
   [...new Set([...a,...b])].every(id=>{const p=before.users.find(u=>u.id===id),n=after.users.find(u=>u.id===id);return p&&n&&p.isActive===n.isActive&&p.role===n.role;});
 }).map(v=>v.id);
}
// Match the original meeting selector: saved scope wins; legacy absence falls
// back to the selected all/type scope. Do not rewrite the saved scope itself.
export function meetingHandoverVesselIds(data:Pick<AppData,'vessels'>,meeting:TemporaryMeeting):string[]{
 if(meeting.vessels.length)return meeting.vessels;
 if(meeting.vesselScopeMode==='all')return data.vessels.filter(v=>v.isActive).map(v=>v.id);
 if(meeting.vesselScopeMode==='types')return data.vessels.filter(v=>v.isActive&&meeting.vesselTypeScopes?.includes(v.shipType)).map(v=>v.id);
 return [];
}
export function handoverReadTargets(data:AppData,ids:string[]):RecordTarget[]{
 return [
  ...data.tasks.filter(t=>taskVesselIds(t).some(id=>ids.includes(id))).map(t=>({collection:'tasks' as const,id:t.id})),
  ...data.internalControlCases.filter(c=>ids.includes(c.vesselId)).map(c=>({collection:'internalControlCases' as const,id:c.id})),
  ...data.meetings.filter(m=>meetingHandoverVesselIds(data,m).some(id=>ids.includes(id))).map(m=>({collection:'meetings' as const,id:m.id})),
 ];
}
export function applyVesselManagerHandover(before:AppData,after:AppData):string[]{
 const changed=changedVesselTeams(before,after);
 if(!changed.length)return [];
 const apply=(row:{vesselResponsibilities?:VesselResponsibility[]},scope:string[],open:(id:string)=>boolean)=>{
  const affected=scope.filter(id=>changed.includes(id)&&open(id));if(!affected.length)return;
  const rows=structuredClone(row.vesselResponsibilities||scope.map(vesselId=>({vesselId,managerUserIds:primaryVesselTeam(before,vesselId)})));
  for(const vesselId of affected){const team=primaryVesselTeam(after,vesselId),entry=rows.find(r=>r.vesselId===vesselId);if(entry)entry.managerUserIds=team;else rows.push({vesselId,managerUserIds:team});}
  row.vesselResponsibilities=rows;
 };
 for(const task of after.tasks)apply(task,taskVesselIds(task),id=>!task.isClosed&&!taskIsClosedForScope(task,[id])&&!after.meetings.some(m=>m.id===task.sourceMeetingId&&m.status==='已完成'));
 for(const item of after.internalControlCases)apply(item,[item.vesselId],()=>!item.isClosed);
 for(const meeting of after.meetings){
  const scope=[...new Set([...meetingHandoverVesselIds(before,meeting),...after.tasks.filter(t=>t.sourceMeetingId===meeting.id).flatMap(taskVesselIds)])];
  apply(meeting,scope,()=>meeting.status!=='已完成');
 }
 return changed;
}
// Only an explicit closed -> open transition refreshes a stored team. Legacy
// absence remains a projection; unchanged/closed members and common contacts stay.
export function rebindReopenedVesselResponsibilities(before:AppData,after:AppData):void{
 const rebind=(old:{vesselResponsibilities?:VesselResponsibility[]},next:{vesselResponsibilities?:VesselResponsibility[]},reopened:(id:string)=>boolean)=>{
  if(!old.vesselResponsibilities?.some(r=>reopened(r.vesselId)))return;
  next.vesselResponsibilities=old.vesselResponsibilities.map(r=>reopened(r.vesselId)?{...r,managerUserIds:primaryVesselTeam(after,r.vesselId)}:structuredClone(r));
 };
 for(const next of after.tasks){const old=before.tasks.find(t=>t.id===next.id);if(old)rebind(old,next,id=>taskVesselIds(old).includes(id)&&taskVesselIds(next).includes(id)&&taskIsClosedForScope(old,[id])&&!taskIsClosedForScope(next,[id]));}
 for(const next of after.internalControlCases){const old=before.internalControlCases.find(c=>c.id===next.id);if(old)rebind(old,next,id=>old.vesselId===id&&next.vesselId===id&&old.isClosed&&!next.isClosed);}
 for(const next of after.meetings){const old=before.meetings.find(m=>m.id===next.id);if(old)rebind(old,next,id=>meetingHandoverVesselIds(before,old).includes(id)&&meetingHandoverVesselIds(after,next).includes(id)&&old.status==='已完成'&&next.status!=='已完成');}
}
export function vesselResponsibilityIncludes(row:{vesselResponsibilities?:VesselResponsibility[]},vessel:Vessel,user:Pick<UserAccount,'id'|'managedVesselIds'>):boolean{
 const team=row.vesselResponsibilities?.find(r=>r.vesselId===vessel.id);
 const primary=vessel.assignedUserIds.includes(user.id)||user.managedVesselIds.includes(vessel.id);
 return (primary&&(!team||team.managerUserIds.includes(user.id)))||hasActiveVesselDelegation(vessel,user.id);
}
// Retention is not assignment eligibility or actor authorization. Only an
// existing active common contact on an already handed-over record may survive.
export function canRetainVesselCommonContact(row:{vesselResponsibilities?:VesselResponsibility[]}|undefined,id:string,previousIds:string[],user:Pick<UserAccount,'id'|'isActive'|'role'>|undefined):boolean{
 return Boolean(row?.vesselResponsibilities&&previousIds.includes(id)&&user?.id===id&&user.isActive&&user.role!=='vessel');
}
export function retainedVesselResponsibilities(value:unknown):{vesselResponsibilities?:VesselResponsibility[]}{
 if(value===undefined)return {};
 if(!Array.isArray(value)||value.some(r=>!r||typeof r.vesselId!=='string'||!Array.isArray(r.managerUserIds)||r.managerUserIds.some((id:unknown)=>typeof id!=='string')))throw new Error('invalid-vessel-responsibilities');
 return {vesselResponsibilities:structuredClone(value)};
}

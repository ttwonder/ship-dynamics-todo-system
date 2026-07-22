import type { StatusLog, TemporaryMeeting, UserAccount } from './types';

type MeetingStatusState = Pick<TemporaryMeeting, 'latestStatus' | 'statusLogs'>;
type MeetingStatusActor = Pick<UserAccount, 'id' | 'name' | 'role'>;
type SanitizedMeetingStatusMutation =
  | { ok: true; logs: StatusLog[]; latestStatus: string }
  | { ok: false; logs?: undefined; latestStatus?: undefined };

export function addMeetingStatusRecord(
  meeting: MeetingStatusState,
  rawText: string,
  actorName: string,
  at: string,
  id: string,
  actorId?: string,
): { latestStatus: string; statusLogs: StatusLog[] } | null {
  const text = rawText.trim();
  if (!text) return null;
  return {
    latestStatus: text,
    statusLogs: [{ id, at, by: actorName, byUserId: actorId, text }, ...(meeting.statusLogs || [])],
  };
}

export function sanitizeMeetingStatusMutation(
  candidateLogs: StatusLog[],
  previousLogs: StatusLog[],
  actor: MeetingStatusActor,
  at: string,
  createId: () => string,
): SanitizedMeetingStatusMutation {
  if (!Array.isArray(candidateLogs) || !Array.isArray(previousLogs)) return { ok: false };
  const previousById = new Map(previousLogs.map(log => [log.id, log]));
  if (previousById.size !== previousLogs.length) return { ok: false };
  const candidateIds = new Set<string>();
  const survivingIds: string[] = [];
  const newTexts: string[] = [];
  let reachedExisting = false;

  for (const log of candidateLogs) {
    if (!log || typeof log !== 'object' || typeof log.id !== 'string' || candidateIds.has(log.id)) return { ok: false };
    candidateIds.add(log.id);
    const previous = previousById.get(log.id);
    if (previous) {
      reachedExisting = true;
      if (JSON.stringify(log) !== JSON.stringify(previous)) return { ok: false };
      survivingIds.push(log.id);
      continue;
    }
    if (reachedExisting || typeof log.text !== 'string' || !log.text.trim()) return { ok: false };
    newTexts.push(log.text.trim());
  }

  const expectedSurvivingIds = previousLogs.filter(log => candidateIds.has(log.id)).map(log => log.id);
  if (JSON.stringify(survivingIds) !== JSON.stringify(expectedSurvivingIds)) return { ok: false };
  const canDelete = (log: StatusLog) => actor.role === 'owner'
    || actor.role === 'admin'
    || log.byUserId === actor.id
    || (!log.byUserId && log.by === actor.name);
  if (previousLogs.some(log => !candidateIds.has(log.id) && !canDelete(log))) return { ok: false };

  const reservedIds=new Set(previousLogs.map(log=>log.id));
  const trustedNewLogs:StatusLog[]=[];
  for(const text of newTexts){
    let id='';
    for(let attempt=0;attempt<64;attempt+=1){
      let candidate='';
      try{candidate=createId();}catch{return {ok:false};}
      if(typeof candidate==='string'&&candidate.trim()&&!reservedIds.has(candidate)){id=candidate;break;}
    }
    if(!id)return {ok:false};
    reservedIds.add(id);
    trustedNewLogs.push({id,at,by:actor.name,byUserId:actor.id,text});
  }
  const trustedExistingLogs = previousLogs.filter(log => candidateIds.has(log.id));
  const logs = [...trustedNewLogs, ...trustedExistingLogs];
  return { ok: true, logs, latestStatus: logs[0]?.text || '' };
}

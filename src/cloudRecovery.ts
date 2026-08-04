import type { AppData, TaskItem } from './types';
import type { ResolvedSupabaseConfig } from './cloud';
import { normalizeAppData } from './normalize';
import { sanitizeAppDataForStorage } from './utils';

export type StoredConfirmedCloudBase={identity:string;data:AppData};
export type StoredDurableRevisionFloors={version:1;floors:[string,number][]};
export type ParsedDurableRevisionFloors={valid:boolean;floors:Map<string,number>};

export function serializeDurableRevisionFloors(floors:Map<string,number>):string{
  return JSON.stringify({version:1,floors:[...floors].sort(([left],[right])=>left.localeCompare(right))} satisfies StoredDurableRevisionFloors);
}

export function parseDurableRevisionFloors(raw:string|null):ParsedDurableRevisionFloors{
  if(!raw)return{valid:true,floors:new Map()};
  try{
    const envelope=JSON.parse(raw) as Partial<StoredDurableRevisionFloors>;
    if(envelope.version!==1||!Array.isArray(envelope.floors))return{valid:false,floors:new Map()};
    const parsed=new Map<string,number>();
    for(const entry of envelope.floors){
      if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||!entry[0].startsWith('cloud-workspace-v2:')||!Number.isSafeInteger(entry[1])||entry[1]<0)return{valid:false,floors:new Map()};
      parsed.set(entry[0],Math.max(parsed.get(entry[0])??-1,entry[1]));
    }
    return{valid:true,floors:parsed};
  }catch{return{valid:false,floors:new Map()};}
}

export function updateDurableRevisionFloor(floors:Map<string,number>,identity:string,revision:number):Map<string,number>{
  if(!identity.startsWith('cloud-workspace-v2:')||!Number.isSafeInteger(revision)||revision<0)return new Map(floors);
  const next=new Map(floors);next.set(identity,Math.max(next.get(identity)??-1,revision));return next;
}

export function cloudWorkspaceIdentity(config:ResolvedSupabaseConfig|null|undefined):string{
  return config?`cloud-workspace-v2:${JSON.stringify([config.supabaseUrl,config.tableName,config.workspaceKey])}`:'';
}

export function cloudConfigIdentity(config:ResolvedSupabaseConfig|null|undefined):string{
  return config?`cloud-config-v2:${JSON.stringify([config.supabaseUrl,config.tableName,config.workspaceKey,config.supabaseAnonKey])}`:'';
}

export function normalizeStoredCloudWorkspaceIdentity(storedIdentity:string|null|undefined,config:ResolvedSupabaseConfig|null|undefined):string{
  const stored=storedIdentity||'';
  const workspace=cloudWorkspaceIdentity(config);
  if(!stored||!workspace||!config)return stored;
  if(stored===workspace)return workspace;
  const parts=stored.split('|');
  if(parts.length<4)return stored;
  const [legacyUrl,legacyTable,...legacyTail]=parts;
  legacyTail.pop();
  const legacyWorkspace=legacyTail.join('|');
  return legacyUrl===config.supabaseUrl&&legacyTable===config.tableName&&legacyWorkspace===config.workspaceKey?workspace:stored;
}

export function serializeConfirmedCloudBase(identity:string,data:AppData):string{
  return JSON.stringify({identity,data:sanitizeAppDataForStorage(data)} satisfies StoredConfirmedCloudBase);
}

export function parseConfirmedCloudBase(raw:string|null,identity:string):AppData|null{
  if(!raw||!identity)return null;
  try{
    const envelope=JSON.parse(raw) as Partial<StoredConfirmedCloudBase>;
    if(envelope.identity!==identity)return null;
    return normalizeAppData(envelope.data)||null;
  }catch{return null;}
}

export function trustedPersistedBaseForRemote(base:AppData|null,remote:AppData,contentEqual:(left:AppData,right:AppData)=>boolean):AppData|null{
  if(!base||base.revision>remote.revision)return null;
  if(base.revision===remote.revision&&!contentEqual(base,remote))return null;
  return base;
}

export function bootstrapFailureHasUnsavedWork(input:{
  local:AppData;
  persistedConfirmedBase:AppData|null;
  hasLocalCache:boolean;
  equals:(left:AppData,right:AppData)=>boolean;
}):boolean{
  return input.persistedConfirmedBase
    ? !input.equals(input.local,input.persistedConfirmedBase)
    : input.hasLocalCache;
}

export function withStableCreationAttemptProvenance(firstAttempt:TaskItem,retry:TaskItem):TaskItem{
  const stable=structuredClone(retry);
  stable.createdAt=firstAttempt.createdAt;
  stable.createdBy=firstAttempt.createdBy;
  const retryLogs=stable.statusLogs||[];
  stable.statusLogs=[
    ...(firstAttempt.statusLogs||[]).map((stableLog,index)=>{
      const currentLog=retryLogs[index]||stableLog;
      return {...currentLog,id:stableLog.id,at:stableLog.at,by:stableLog.by,byUserId:stableLog.byUserId};
    }),
    ...retryLogs.slice((firstAttempt.statusLogs||[]).length),
  ];
  return stable;
}

export function creationTaskCommitMatches(submitted:TaskItem,remote:TaskItem|undefined):boolean{
  if(!remote||remote.id!==submitted.id)return false;
  if(!submitted.createdAt||!submitted.createdBy)return false;
  if(remote.createdAt!==submitted.createdAt||remote.createdBy!==submitted.createdBy)return false;
  const submittedInitialLogs=new Set((submitted.statusLogs||[]).map(log=>log.id).filter(Boolean));
  if(!submittedInitialLogs.size)return false;
  const remoteLogIds=new Set((remote.statusLogs||[]).map(log=>log.id));
  return [...submittedInitialLogs].every(id=>remoteLogIds.has(id));
}

export const APP_VERSION_MANIFEST_FILE='app-version.json';
export const APP_VERSION_CHECK_INTERVAL_MS=300_000;
export const APP_VERSION_QUERY_KEY='__ship_dynamics_version';
export const APP_RECOVERY_QUERY_KEY='__ship_dynamics_repair';

export type AppVersionCheckResult=
  |{status:'current'}
  |{status:'available';version:string}
  |{status:'unavailable'};

export type AppUpdateBlockReason='unsaved'|'saving'|'editing';

export type AppUpdateSafetySnapshot={
  hasUnsavedWork:boolean;
  pendingSaveCount:number;
  pendingTaskCreations?: number;
  saveInFlight:boolean;
  syncInFlight:boolean;
  saveTimerScheduled:boolean;
  savePhase:'saved'|'dirty'|'queued'|'saving'|'error';
  hasActiveEditLock:boolean;
  batchEditorActive:boolean;
};

type VersionFetchResponse={ok:boolean;json:()=>Promise<unknown>};
type VersionFetch=(input:string,init:{cache:'no-store';credentials:'same-origin';headers:{Accept:'application/json'}})=>Promise<VersionFetchResponse>;

const validVersion=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128&&/^[A-Za-z0-9._-]+$/.test(value);

export function appVersionManifestUrl(baseUrl:string,nonce:string|number){
  const base=baseUrl.endsWith('/')?baseUrl:`${baseUrl}/`;
  return `${base}${APP_VERSION_MANIFEST_FILE}?${new URLSearchParams({check:String(nonce)})}`;
}

export async function checkForAppVersion(input:{currentVersion:string;baseUrl:string;nonce:string|number;fetchImpl?:VersionFetch}):Promise<AppVersionCheckResult>{
  const fetchImpl=input.fetchImpl||(fetch as unknown as VersionFetch);
  try{
    const response=await fetchImpl(appVersionManifestUrl(input.baseUrl,input.nonce),{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
    if(!response.ok)return {status:'unavailable'};
    const payload=await response.json();
    const version=typeof payload==='object'&&payload!==null?'version' in payload?(payload as {version?:unknown}).version:undefined:undefined;
    if(!validVersion(version))return {status:'unavailable'};
    return version===input.currentVersion?{status:'current'}:{status:'available',version};
  }catch{
    return {status:'unavailable'};
  }
}

export function appUpdateBlockReason(snapshot:AppUpdateSafetySnapshot):AppUpdateBlockReason|null{
  if(snapshot.hasUnsavedWork||snapshot.savePhase==='dirty')return 'unsaved';
  if((snapshot.pendingTaskCreations||0)>0||snapshot.pendingSaveCount>0||snapshot.saveInFlight||snapshot.syncInFlight||snapshot.saveTimerScheduled||snapshot.savePhase==='queued'||snapshot.savePhase==='saving')return 'saving';
  if(snapshot.hasActiveEditLock||snapshot.batchEditorActive)return 'editing';
  return null;
}

export function appVersionReloadUrl(currentHref:string,nextVersion:string){
  if(!validVersion(nextVersion))throw new Error('invalid app version');
  const url=new URL(currentHref);
  url.searchParams.set(APP_VERSION_QUERY_KEY,nextVersion);
  return url.toString();
}

export function appRecoveryReloadUrl(currentHref:string,currentVersion:string,recoveryToken:string){
  if(!validVersion(recoveryToken))throw new Error('invalid app recovery token');
  const url=new URL(appVersionReloadUrl(currentHref,currentVersion));
  url.searchParams.set(APP_RECOVERY_QUERY_KEY,recoveryToken);
  return url.toString();
}

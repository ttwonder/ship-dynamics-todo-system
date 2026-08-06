export const SHIP_DYNAMICS_BROWSER_STORAGE_PREFIX='ship-dynamics';

export type ShipDynamicsBrowserStorageClearResult=
  |{
    status:'cleared';
    removedLocalStorageKeys:string[];
    removedSessionStorageKeys:string[];
  }
  |{
    status:'failed';
    area:'localStorage'|'sessionStorage';
    failedKey:string;
    removedLocalStorageKeys:string[];
    removedSessionStorageKeys:string[];
  };

type BrowserStorage=Pick<Storage,'length'|'key'|'removeItem'>;
type AppCacheStorage={keys:()=>Promise<string[]>;delete:(cacheName:string)=>Promise<boolean>};
type AppWorkerRegistration={scope:string;unregister:()=>Promise<boolean>};
type AppServiceWorkerContainer={getRegistrations:()=>Promise<readonly AppWorkerRegistration[]>};

const SHIP_DYNAMICS_NAME_SEPARATORS=new Set(['-',':','.', '_','/']);
const isShipDynamicsName=(value:string)=>{
  if(!value.startsWith(SHIP_DYNAMICS_BROWSER_STORAGE_PREFIX))return false;
  const next=value.charAt(SHIP_DYNAMICS_BROWSER_STORAGE_PREFIX.length);
  return next===''||SHIP_DYNAMICS_NAME_SEPARATORS.has(next);
};

export function shouldBlockAppBeforeUnload(input:{
  recoveryNavigation:boolean;
  hasUnsavedWork:boolean;
  savePhaseSaved:boolean;
  saveTimerPending:boolean;
  pendingCloudDataCount:number;
  pendingTaskCreationCount:number;
}):boolean{
  if(input.recoveryNavigation)return false;
  return Boolean(input.hasUnsavedWork||!input.savePhaseSaved||input.saveTimerPending||input.pendingCloudDataCount>0||input.pendingTaskCreationCount>0);
}

function appStorageKeys(storage:BrowserStorage):string[]{
  const keys:string[]=[];
  for(let index=0;index<storage.length;index+=1){
    const key=storage.key(index);
    if(key&&isShipDynamicsName(key))keys.push(key);
  }
  return keys;
}

export function clearShipDynamicsBrowserStorage(input:{
  localStorage:BrowserStorage;
  sessionStorage:BrowserStorage;
}):ShipDynamicsBrowserStorageClearResult{
  const removedLocalStorageKeys:string[]=[];
  const removedSessionStorageKeys:string[]=[];
  let localKeys:string[];
  try{localKeys=appStorageKeys(input.localStorage);}catch{
    return{status:'failed',area:'localStorage',failedKey:'（無法讀取鍵名）',removedLocalStorageKeys,removedSessionStorageKeys};
  }
  for(const key of localKeys){
    try{input.localStorage.removeItem(key);removedLocalStorageKeys.push(key);}catch{
      return{status:'failed',area:'localStorage',failedKey:key,removedLocalStorageKeys,removedSessionStorageKeys};
    }
  }
  let sessionKeys:string[];
  try{sessionKeys=appStorageKeys(input.sessionStorage);}catch{
    return{status:'failed',area:'sessionStorage',failedKey:'（無法讀取鍵名）',removedLocalStorageKeys,removedSessionStorageKeys};
  }
  for(const key of sessionKeys){
    try{input.sessionStorage.removeItem(key);removedSessionStorageKeys.push(key);}catch{
      return{status:'failed',area:'sessionStorage',failedKey:key,removedLocalStorageKeys,removedSessionStorageKeys};
    }
  }
  return{status:'cleared',removedLocalStorageKeys,removedSessionStorageKeys};
}

function appWorkerScope(scope:string,appBaseUrl:string,origin:string):boolean{
  try{
    const normalizedOrigin=new URL(origin).origin;
    const appBase=new URL(appBaseUrl,`${normalizedOrigin}/`);
    if(appBase.origin!==normalizedOrigin)return false;
    const basePath=appBase.pathname.endsWith('/')?appBase.pathname:`${appBase.pathname}/`;
    if(basePath==='/')return false;
    const workerScope=new URL(scope);
    return workerScope.origin===normalizedOrigin&&(workerScope.pathname===basePath.slice(0,-1)||workerScope.pathname.startsWith(basePath));
  }catch{return false;}
}

export async function repairShipDynamicsResources(input:{
  appBaseUrl:string;
  origin:string;
  cacheStorage:AppCacheStorage|null;
  serviceWorkerContainer:AppServiceWorkerContainer|null;
}):Promise<{deletedCacheNames:string[];unregisteredWorkerScopes:string[]}>{
  const deletedCacheNames:string[]=[];
  const unregisteredWorkerScopes:string[]=[];
  if(input.cacheStorage){
    let cacheNames:string[];
    try{cacheNames=await input.cacheStorage.keys();}catch(error){
      throw new Error(`無法讀取Ship Dynamics Cache Storage：${error instanceof Error?error.message:String(error)}`);
    }
    for(const cacheName of cacheNames.filter(isShipDynamicsName)){
      let removed=false;
      try{removed=await input.cacheStorage.delete(cacheName);}catch(error){
        throw new Error(`無法清除Ship Dynamics Cache Storage「${cacheName}」：${error instanceof Error?error.message:String(error)}`);
      }
      if(!removed)throw new Error(`無法清除Ship Dynamics Cache Storage「${cacheName}」`);
      deletedCacheNames.push(cacheName);
    }
  }
  if(input.serviceWorkerContainer){
    let registrations:readonly AppWorkerRegistration[];
    try{registrations=await input.serviceWorkerContainer.getRegistrations();}catch(error){
      throw new Error(`無法讀取Ship Dynamics Service Worker：${error instanceof Error?error.message:String(error)}`);
    }
    for(const registration of registrations.filter(item=>appWorkerScope(item.scope,input.appBaseUrl,input.origin))){
      let removed=false;
      try{removed=await registration.unregister();}catch(error){
        throw new Error(`無法移除Ship Dynamics Service Worker「${registration.scope}」：${error instanceof Error?error.message:String(error)}`);
      }
      if(!removed)throw new Error(`無法移除Ship Dynamics Service Worker「${registration.scope}」`);
      unregisteredWorkerScopes.push(registration.scope);
    }
  }
  return{deletedCacheNames,unregisteredWorkerScopes};
}

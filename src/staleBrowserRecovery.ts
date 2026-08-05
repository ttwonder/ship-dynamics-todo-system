import {
  CLOUD_CONFIRMED_BASE_KEY,
  CURRENT_USER_KEY,
  STORAGE_KEY,
} from './utils';
import type { CloudSyncFailureKind } from './cloudSyncError';

export const STALE_BROWSER_RECOVERY_KEYS = [
  STORAGE_KEY,
  CLOUD_CONFIRMED_BASE_KEY,
  CURRENT_USER_KEY,
] as const;

export type StaleBrowserRecoveryResult =
  | { ok:true; removedKeys:string[] }
  | { ok:false; removedKeys:string[]; failedKey:string };

export function clearStaleBrowserRecoveryState(
  storage:Pick<Storage,'removeItem'>,
):StaleBrowserRecoveryResult{
  const removedKeys:string[]=[];
  for(const key of STALE_BROWSER_RECOVERY_KEYS){
    try{
      storage.removeItem(key);
      removedKeys.push(key);
    }catch{
      return{ok:false,removedKeys,failedKey:key};
    }
  }
  return{ok:true,removedKeys};
}

export const STALE_BROWSER_RECOVERY_CONFIRMATION =
  '這會清除此瀏覽器中尚未上傳的舊暫存，未上傳內容將無法復原；已保存的雲端資料完全不受影響。確定修復並重新載入嗎？';

export function shouldOfferStaleBrowserRecovery(kind:CloudSyncFailureKind):boolean{
  return kind==='authorization';
}

export function runStaleBrowserRecovery(input:{
  storage:Pick<Storage,'removeItem'>;
  confirm:(message:string)=>boolean;
  beforeReload?:()=>void;
  reload:()=>void;
}):{status:'cancelled'}|{status:'failed';result:Extract<StaleBrowserRecoveryResult,{ok:false}>}|{status:'reloading'}{
  if(!input.confirm(STALE_BROWSER_RECOVERY_CONFIRMATION))return{status:'cancelled'};
  const result=clearStaleBrowserRecoveryState(input.storage);
  if(result.ok===false)return{status:'failed',result};
  input.beforeReload?.();
  input.reload();
  return{status:'reloading'};
}

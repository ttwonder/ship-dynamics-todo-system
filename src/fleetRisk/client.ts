import type {SupabaseConfig} from '../cloud';
import {parseFleetRiskState, type FleetRiskState} from './model';

export interface FleetRiskClient {
  read(signal:AbortSignal):Promise<FleetRiskState>;
  refresh(requestId:string,signal:AbortSignal):Promise<{state:FleetRiskState;runId:string|null;started:boolean}>;
}
export function createFleetRiskClient(config:SupabaseConfig|null, transport:typeof fetch=fetch):FleetRiskClient {
  async function call(path:string,body:unknown,signal:AbortSignal):Promise<any>{
    if(!config)throw new Error('尚未設定雲端連線，無法讀取船隊風險清單。');
    const timeout=new AbortController();
    const stop=()=>timeout.abort(signal.reason);
    if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
    const timer=setTimeout(()=>timeout.abort(new Error('risk-request-timeout')),20_000);
    try{
      const response=await transport(`${config.supabaseUrl.replace(/\/$/,'')}${path}`,{
        method:'POST',cache:'no-store',signal:timeout.signal,
        headers:{apikey:config.supabaseAnonKey,Authorization:`Bearer ${config.supabaseAnonKey}`,'Content-Type':'application/json'},
        body:JSON.stringify(body),
      });
      if(!response.ok){
        if(response.status===404)throw new Error('船隊風險後端尚未部署，原船舶資料不受影響。');
        throw new Error(`船隊風險服務未能回應（HTTP ${response.status}），原清單未被替換。`);
      }
      const data=await response.json();
      if(data?.ok===false)throw new Error('風險更新未獲確認，請讀取更新狀態；不要重複提交。');
      return data;
    }catch(error){
      if(signal.aborted)throw error;
      if(timeout.signal.aborted)throw new Error('讀取逾時；更新可能仍在雲端進行，請按「讀取更新狀態」。');
      throw error;
    }finally{clearTimeout(timer);signal.removeEventListener('abort',stop);}
  }
  return {
    read:async signal=>parseFleetRiskState(await call('/rest/v1/rpc/read_ship_fleet_risk_v1',{},signal)),
    refresh:async(requestId,signal)=>{
      const result=await call('/functions/v1/fleet-risk',{action:'refresh',requestId},signal);
      if(result?.ok!==true||typeof result.started!=='boolean'||!(result.runId===null||typeof result.runId==='string'))throw new Error('更新回覆不完整，請讀取更新狀態；不要重複提交。');
      return {state:parseFleetRiskState(result.state),runId:result.runId,started:result.started};
    },
  };
}

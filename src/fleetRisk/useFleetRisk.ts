import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {getSupabaseConfig} from '../cloud';
import {createFleetRiskClient} from './client';
import type {FleetRiskState} from './model';

export interface FleetRiskReadResult {state:FleetRiskState|null;error:string}

/** One authenticated-app snapshot, shared by cards, detail and report captures.
 * Reads never start a source crawl; no business records or persistent cache are written.
 */
export function useFleetRisk({enabled=true,scopeKey=''}:{enabled?:boolean;scopeKey?:string}={}) {
  const config=typeof window==='undefined'?null:getSupabaseConfig();
  const client=useMemo(()=>createFleetRiskClient(config),[config?.supabaseUrl,config?.supabaseAnonKey,config?.workspaceKey]);
  const [state,setStateValue]=useState<FleetRiskState|null>(null);
  const [loading,setLoading]=useState(false),[submitting,setSubmitting]=useState(false);
  const [error,setErrorValue]=useState(''),[unknown,setUnknown]=useState(false);
  const latest=useRef<FleetRiskReadResult>({state:null,error:''});
  const setState=(value:FleetRiskState|null)=>{latest.current.state=value;setStateValue(value);};
  const setError=(value:string)=>{latest.current.error=value;setErrorValue(value);};
  const alive=useRef(false);
  const active=useRef<{kind:'read'|'refresh';controller:AbortController;promise?:Promise<void>}|null>(null);
  const read=useCallback(():Promise<void>=>{
    if(!enabled||!alive.current)return Promise.resolve();
    // Opening the dialog while a read/dispatch is pending joins it, not another request.
    if(active.current)return active.current.promise||Promise.resolve();
    const task={kind:'read' as const,controller:new AbortController(),promise:undefined as Promise<void>|undefined};
    active.current=task;setLoading(true);setError('');
    task.promise=(async()=>{
      try{const next=await client.read(task.controller.signal);if(alive.current&&active.current===task){setState(next);setUnknown(false);}}
      catch(e){if(alive.current&&active.current===task&&!task.controller.signal.aborted)setError(e instanceof Error?e.message:'無法讀取風險清單，原清單未變更。');}
      finally{if(alive.current&&active.current===task){active.current=null;setLoading(false);}}
    })();
    return task.promise;
  },[client,enabled]);
  const readSnapshot=useCallback(async():Promise<FleetRiskReadResult>=>{
    await read();
    return structuredClone(latest.current);
  },[read]);
  useEffect(()=>{
    alive.current=enabled;setState(null);setError('');setLoading(false);setSubmitting(false);setUnknown(false);
    if(enabled)void read();
    return()=>{alive.current=false;active.current?.controller.abort();active.current=null;};
  },[read,enabled,scopeKey]);
  useEffect(()=>{
    if(!enabled||state?.attempt?.status!=='running'||error||submitting)return;
    const timer=setTimeout(()=>void read(),2500);
    return()=>clearTimeout(timer);
  },[state,error,submitting,read,enabled]);
  const refresh=useCallback(async()=>{
    if(!enabled||!alive.current||!state||active.current?.kind==='refresh'||state.attempt?.status==='running'||unknown)return;
    active.current?.controller.abort();
    const task={kind:'refresh' as const,controller:new AbortController(),promise:undefined as Promise<void>|undefined};
    active.current=task;setLoading(false);setSubmitting(true);setError('');
    task.promise=(async()=>{
      try{
        const result=await client.refresh(crypto.randomUUID(),task.controller.signal);
        if(alive.current&&active.current===task){setState(result.state);setUnknown(false);}
      }catch(e){if(alive.current&&active.current===task&&!task.controller.signal.aborted){setUnknown(true);setError(e instanceof Error?e.message:'更新請求結果未確認，請讀取更新狀態。');}}
      finally{if(alive.current&&active.current===task){active.current=null;setSubmitting(false);}}
    })();
    return task.promise;
  },[client,state,unknown,enabled]);
  return {state,loading,submitting,error,unknown,read,readSnapshot,refresh};
}
export type FleetRiskController=ReturnType<typeof useFleetRisk>;
